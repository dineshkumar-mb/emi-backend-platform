import Goal from '../models/Goal.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// @desc    Get user's goals
// @route   GET /api/goals
// @access  Private
export const getGoals = async (req, res) => {
  try {
    const goals = await Goal.find({ userId: req.user._id });
    res.json(goals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper: Call Gemini to generate a goal contribution recommendation
const generateGoalRecommendation = async (name, category, targetAmount, currentAmount, targetDate) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'PLACEHOLDER') {
    return 'Save regularly in liquid funds to achieve your target on time.';
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a financial advisor. Generate a one-sentence, actionable savings and investment suggestion for this goal:
- Goal Name: ${name}
- Category: ${category}
- Target Amount: ${targetAmount}
- Current Accumulated: ${currentAmount}
- Target Date: ${targetDate} (Today is ${new Date().toISOString().split('T')[0]})

Format: Tell them how much they need to save monthly, and recommend a specific asset class (e.g., Equity Mutual Funds, Recurring Deposit, Debt Funds) appropriate for the time horizon. Keep it concise.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Goal advisor warning:', error.message);
    const months = Math.max(1, Math.ceil((new Date(targetDate) - Date.now()) / (1000 * 60 * 60 * 24 * 30)));
    const needed = Math.max(0, targetAmount - currentAmount);
    const monthly = Math.round(needed / months);
    return `To achieve this goal, save approximately ${monthly.toLocaleString()} monthly in safe instruments.`;
  }
};

// @desc    Create new financial goal
// @route   POST /api/goals
// @access  Private
export const createGoal = async (req, res) => {
  const { name, category, targetAmount, currentAmount, targetDate } = req.body;
  try {
    const recommendation = await generateGoalRecommendation(
      name,
      category,
      Number(targetAmount),
      Number(currentAmount || 0),
      targetDate
    );

    const goal = await Goal.create({
      userId: req.user._id,
      name,
      category,
      targetAmount: Number(targetAmount),
      currentAmount: Number(currentAmount || 0),
      targetDate: new Date(targetDate),
      recommendation,
    });

    res.status(201).json(goal);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete goal
// @route   DELETE /api/goals/:id
// @access  Private
export const deleteGoal = async (req, res) => {
  try {
    const goal = await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    res.json({ message: 'Goal removed' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
