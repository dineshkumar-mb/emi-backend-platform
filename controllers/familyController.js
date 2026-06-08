import Family from '../models/Family.js';
import User from '../models/User.js';
import Loan from '../models/Loan.js';
import Asset from '../models/Asset.js';

// @desc    Create family group
// @route   POST /api/families
// @access  Private
export const createFamily = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ message: 'Family group name is required' });

  try {
    const family = await Family.create({
      name,
      admin: req.user._id,
      members: [{ userId: req.user._id, role: 'admin' }],
      sharedLoans: [],
      sharedAssets: [],
    });
    res.status(201).json(family);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Invite member to family
// @route   POST /api/families/invite
// @access  Private
export const inviteMember = async (req, res) => {
  const { familyId, email } = req.body;
  try {
    const family = await Family.findById(familyId);
    if (!family) return res.status(404).json({ message: 'Family group not found' });
    
    // Auth check
    const isMember = family.members.some(m => m.userId.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Not authorized to invite to this group' });

    const targetUser = await User.findOne({ email: email.toLowerCase() });
    if (!targetUser) return res.status(404).json({ message: 'User with this email does not exist' });

    const alreadyMember = family.members.some(m => m.userId.toString() === targetUser._id.toString());
    if (alreadyMember) return res.status(400).json({ message: 'User is already a member' });

    family.members.push({ userId: targetUser._id, role: 'member' });
    await family.save();
    
    const updatedFamily = await Family.findById(familyId).populate('members.userId', 'name email');
    res.json(updatedFamily);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Share loan with family
// @route   POST /api/families/share-loan
// @access  Private
export const shareLoan = async (req, res) => {
  const { familyId, loanId } = req.body;
  try {
    const family = await Family.findById(familyId);
    if (!family) return res.status(404).json({ message: 'Family group not found' });

    // Validate membership
    const isMember = family.members.some(m => m.userId.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Not authorized' });

    // Verify user owns the loan
    const loan = await Loan.findOne({ _id: loanId, userId: req.user._id });
    if (!loan) return res.status(404).json({ message: 'Loan not found or not owned by you' });

    if (family.sharedLoans.includes(loanId)) {
      return res.status(400).json({ message: 'Loan is already shared with this family' });
    }

    family.sharedLoans.push(loanId);
    await family.save();
    res.json(family);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Share asset with family
// @route   POST /api/families/share-asset
// @access  Private
export const shareAsset = async (req, res) => {
  const { familyId, assetId } = req.body;
  try {
    const family = await Family.findById(familyId);
    if (!family) return res.status(404).json({ message: 'Family group not found' });

    // Validate membership
    const isMember = family.members.some(m => m.userId.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Not authorized' });

    // Verify user owns asset
    const asset = await Asset.findOne({ _id: assetId, userId: req.user._id });
    if (!asset) return res.status(404).json({ message: 'Asset not found or not owned by you' });

    if (family.sharedAssets.includes(assetId)) {
      return res.status(400).json({ message: 'Asset is already shared' });
    }

    family.sharedAssets.push(assetId);
    await family.save();
    res.json(family);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user's family groups
// @route   GET /api/families
// @access  Private
export const getFamilies = async (req, res) => {
  try {
    const families = await Family.find({ 'members.userId': req.user._id })
      .populate('members.userId', 'name email')
      .populate('sharedLoans')
      .populate('sharedAssets');
    res.json(families);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get family dashboard metrics
// @route   GET /api/families/:familyId/dashboard
// @access  Private
export const getFamilyDashboard = async (req, res) => {
  const { familyId } = req.params;
  try {
    const family = await Family.findById(familyId)
      .populate('members.userId', 'name email')
      .populate('sharedLoans')
      .populate('sharedAssets');

    if (!family) return res.status(404).json({ message: 'Family group not found' });

    const isMember = family.members.some(m => m.userId._id.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ message: 'Not authorized' });

    // Aggregations
    const totalDebt = family.sharedLoans.reduce((sum, loan) => sum + loan.outstandingBalance, 0);
    const monthlyOutflow = family.sharedLoans.reduce((sum, loan) => sum + loan.emiAmount, 0);
    const totalAssets = family.sharedAssets.reduce((sum, asset) => sum + asset.value, 0);
    const netWorth = totalAssets - totalDebt;

    res.json({
      family,
      metrics: {
        totalDebt,
        monthlyOutflow,
        totalAssets,
        netWorth,
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
