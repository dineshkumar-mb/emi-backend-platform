import Feedback from '../models/Feedback.js';
import CrashReport from '../models/CrashReport.js';
import AnalyticsEvent from '../models/AnalyticsEvent.js';
import jwt from 'jsonwebtoken';

// @desc    Submit feedback or support ticket
// @route   POST /api/support/feedback
// @access  Private
export const createFeedback = async (req, res) => {
  const { subject, message, category } = req.body;
  
  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message fields are required.' });
  }

  try {
    const feedback = await Feedback.create({
      userId: req.user._id,
      subject,
      message,
      category: category || 'feedback',
    });
    res.status(201).json(feedback);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get user's past feedback and support history
// @route   GET /api/support/feedback
// @access  Private
export const getFeedback = async (req, res) => {
  try {
    const tickets = await Feedback.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Post client crash reports
// @route   POST /api/support/crash
// @access  Public/Private
export const createCrashReport = async (req, res) => {
  const { errorMessage, errorStack, deviceInfo, appVersion, platform } = req.body;
  
  if (!errorMessage) {
    return res.status(400).json({ message: 'errorMessage is required.' });
  }

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (e) {}
  }

  try {
    const report = await CrashReport.create({
      userId,
      errorMessage,
      errorStack,
      deviceInfo,
      appVersion: appVersion || '1.0.0',
      platform: platform || 'unknown',
    });
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Log client analytics events
// @route   POST /api/support/analytics
// @access  Public/Private
export const createAnalyticsEvent = async (req, res) => {
  const { eventName, eventProperties, platform, appVersion } = req.body;
  
  if (!eventName) {
    return res.status(400).json({ message: 'eventName is required.' });
  }

  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      userId = decoded.id;
    } catch (e) {}
  }

  try {
    const event = await AnalyticsEvent.create({
      userId,
      eventName,
      eventProperties,
      platform: platform || 'unknown',
      appVersion: appVersion || '1.0.0',
    });
    res.status(201).json(event);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

