import Subscription from '../models/Subscription.js';
import Transaction from '../models/Transaction.js';

// @desc    Get user's subscriptions
// @route   GET /api/subscriptions
// @access  Private
export const getSubscriptions = async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user._id });
    res.json(subscriptions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create new subscription
// @route   POST /api/subscriptions
// @access  Private
export const createSubscription = async (req, res) => {
  const { name, amount, frequency, nextBillingDate } = req.body;
  try {
    const nextDate = nextBillingDate ? new Date(nextBillingDate) : undefined;
    const subscription = await Subscription.create({
      userId: req.user._id,
      name,
      amount: Number(amount),
      frequency,
      nextBillingDate: nextDate,
      status: 'active',
    });
    res.status(201).json(subscription);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete subscription
// @route   DELETE /api/subscriptions/:id
// @access  Private
export const deleteSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Subscription not found' });
    res.json({ message: 'Subscription removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Detect subscriptions and calculate burden
// @route   GET /api/subscriptions/detect
// @access  Private
export const detectSubscriptions = async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.user._id, status: 'active' });
    const pastTx = await Transaction.find({ userId: req.user._id }).sort({ date: -1 });
    
    // Calculate total monthly burden
    const totalMonthlyBurden = subs.reduce((sum, s) => {
      if (s.frequency === 'monthly') return sum + s.amount;
      return sum + (s.amount / 12); // Pro-rate annual subscriptions
    }, 0);

    const duplicates = [];
    const priceIncreases = [];
    const inactiveSubs = [];
    const annualRenewals = [];
    const recommendations = [];

    const seenNames = {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const sub of subs) {
      const nameKey = sub.name.toLowerCase().trim();
      
      // 1. Detect duplicates
      if (seenNames[nameKey]) {
        duplicates.push({
          subscriptionId: sub._id,
          name: sub.name,
          reason: `Duplicate detected: identical name matches subscription ID ${seenNames[nameKey]._id}`
        });
        recommendations.push({
          id: sub._id,
          name: sub.name,
          recommendation: `⚠️ Duplicate subscription detected. Consolidate or cancel immediately to save ₹${sub.amount}/mo.`
        });
        continue;
      }
      seenNames[nameKey] = sub;

      // 2. Inactivity matching (check if transactions exist in 30 days)
      const matchingTx = pastTx.filter(t => t.description.toLowerCase().includes(nameKey));
      const hasRecentTx = matchingTx.some(t => new Date(t.date) >= thirtyDaysAgo);
      if (matchingTx.length > 0 && !hasRecentTx) {
        inactiveSubs.push(sub._id);
        recommendations.push({
          id: sub._id,
          name: sub.name,
          recommendation: `📉 Unused Subscription: No transactions matching "${sub.name}" in the last 30 days. Consider cancelling.`
        });
      }

      // 3. Price deviation analysis
      if (matchingTx.length > 1) {
        const amounts = matchingTx.map(t => t.amount);
        const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length;
        if (sub.amount > avgAmount * 1.05) {
          priceIncreases.push({
            subscriptionId: sub._id,
            name: sub.name,
            amount: sub.amount,
            historicalAvg: Math.round(avgAmount)
          });
          recommendations.push({
            id: sub._id,
            name: sub.name,
            recommendation: `📈 Price Increase: Current charge is higher than historical average of ₹${Math.round(avgAmount)}.`
          });
        }
      }

      // 4. Annual renewal alert
      if (sub.frequency === 'yearly' && sub.nextBillingDate) {
        const daysToRenewal = Math.ceil((new Date(sub.nextBillingDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysToRenewal > 0 && daysToRenewal <= 30) {
          annualRenewals.push({
            subscriptionId: sub._id,
            name: sub.name,
            daysRemaining: daysToRenewal
          });
          recommendations.push({
            id: sub._id,
            name: sub.name,
            recommendation: `🔔 Annual Renewal: "${sub.name}" renews in ${daysToRenewal} days (Charge: ₹${sub.amount}).`
          });
        }
      }

      // Default recommendation if no flags triggered
      const hasRecommendation = recommendations.some(r => r.id.toString() === sub._id.toString());
      if (!hasRecommendation) {
        recommendations.push({
          id: sub._id,
          name: sub.name,
          recommendation: sub.amount > 500 
            ? `High cost subscription (₹${sub.amount}/mo). Review usage requirements.`
            : `Keep active. Payment is stable.`
        });
      }
    }

    res.json({
      totalMonthlyBurden: Math.round(totalMonthlyBurden),
      recommendations,
      duplicates,
      priceIncreases,
      inactiveSubs,
      annualRenewals
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

