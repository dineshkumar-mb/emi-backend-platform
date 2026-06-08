import Asset from '../models/Asset.js';
import Loan from '../models/Loan.js';

// @desc    Get user's assets
// @route   GET /api/assets
// @access  Private
export const getAssets = async (req, res) => {
  try {
    const assets = await Asset.find({ userId: req.user._id });
    res.json(assets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new asset
// @route   POST /api/assets
// @access  Private
export const createAsset = async (req, res) => {
  const { name, category, value } = req.body;
  try {
    const asset = await Asset.create({
      userId: req.user._id,
      name,
      category,
      value: Number(value),
    });
    res.status(201).json(asset);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete asset
// @route   DELETE /api/assets/:id
// @access  Private
export const deleteAsset = async (req, res) => {
  try {
    const asset = await Asset.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    res.json({ message: 'Asset removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Calculate Net Worth
// @route   GET /api/assets/net-worth
// @access  Private
export const getNetWorth = async (req, res) => {
  try {
    const assets = await Asset.find({ userId: req.user._id });
    const loans = await Loan.find({ userId: req.user._id, status: 'active' });

    const totalAssets = assets.reduce((sum, a) => sum + a.value, 0);
    const totalLiabilities = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
    const netWorth = totalAssets - totalLiabilities;

    // Get asset class aggregates for chart distribution
    const assetDistribution = assets.reduce((acc, a) => {
      acc[a.category] = (acc[a.category] || 0) + a.value;
      return acc;
    }, {});

    const distributionArray = Object.keys(assetDistribution).map(k => ({
      category: k,
      value: assetDistribution[k],
    }));

    res.json({
      totalAssets,
      totalLiabilities,
      netWorth,
      distribution: distributionArray,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
