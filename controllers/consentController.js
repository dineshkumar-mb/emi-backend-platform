import * as accountAggregatorService from '../services/accountAggregatorService.js';
import { logSecurityEvent } from '../utils/securityAudit.js';
import Consent from '../models/Consent.js';

export const requestConsentController = async (req, res) => {
  try {
    const { vua } = req.body;
    if (!vua) {
      return res.status(400).json({ message: 'VUA (Virtual Unified Address) is required' });
    }

    const consent = await accountAggregatorService.requestConsent(req.user._id, vua);

    // Log the security/data consent creation
    await logSecurityEvent(req, {
      action: 'consent_change',
      status: 'success',
      details: { vua, consentId: consent.consentId, status: 'PENDING' }
    });

    res.status(201).json(consent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getConsentStatusController = async (req, res) => {
  try {
    const { consentId } = req.params;
    const consent = await Consent.findOne({ consentId });
    if (!consent) {
      return res.status(404).json({ message: 'Consent not found' });
    }
    res.json(consent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const mockApproveConsentController = async (req, res) => {
  try {
    const { consentId } = req.body;
    if (!consentId) {
      return res.status(400).json({ message: 'Consent ID is required' });
    }

    const consent = await accountAggregatorService.approveConsent(consentId);

    // Log the security/data consent change
    await logSecurityEvent(req, {
      action: 'consent_change',
      status: 'success',
      details: { consentId, status: 'APPROVED' }
    });

    res.json(consent);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const syncConsentDataController = async (req, res) => {
  try {
    const { consentId } = req.body;
    if (!consentId) {
      return res.status(400).json({ message: 'Consent ID is required' });
    }

    const syncedData = await accountAggregatorService.syncConsentData(consentId);

    // Log the data import event
    await logSecurityEvent(req, {
      action: 'statement_upload', // statement_upload represents external bank data import in our security log
      status: 'success',
      details: { consentId, syncedCount: { assets: syncedData.assets.length, loans: syncedData.loans.length } }
    });

    res.json({
      message: 'Financial data synced successfully from Account Aggregator.',
      data: syncedData
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
