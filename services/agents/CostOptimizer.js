/**
 * CostOptimizer
 *
 * Selects the correct WhatsApp Business API template based on:
 *  - Notification type (DUE_TOMORROW, DUE_TODAY, OVERDUE)
 *  - User region (determines language code)
 *  - Whether an AI-optimized message is available
 *
 * Template names must match exactly what is registered in your
 * WhatsApp Business Manager account.
 */

// Map of notification type → default template config
const TEMPLATE_MAP = {
  DUE_TOMORROW: {
    name: 'emi_due_tomorrow_v2',
    language: 'en',
    fallbackText: (p) =>
      `Hi ${p.userName}, your EMI of ₹${p.emiAmount.toLocaleString('en-IN')} is due tomorrow. Please ensure your account is funded. Contact us if you need help.`
  },
  DUE_IN_3_DAYS: {
    name: 'emi_due_in_3_days_v1',
    language: 'en',
    fallbackText: (p) =>
      `Hi ${p.userName}, your EMI of ₹${p.emiAmount.toLocaleString('en-IN')} will be due in 3 days on ${new Date(p.nextDueDate).toLocaleDateString()}. Please ensure your account is funded.`
  },
  LOW_BALANCE_ALERT: {
    name: 'emi_low_balance_alert_v1',
    language: 'en',
    fallbackText: (p) =>
      `Hi ${p.userName}, your EMI of ₹${p.emiAmount.toLocaleString('en-IN')} is due soon, but your predicted account balance is low. Please deposit funds immediately.`
  },
  DUE_TODAY: {
    name: 'emi_due_today_v2',
    language: 'en',
    fallbackText: (p) =>
      `Hi ${p.userName}, your EMI of ₹${p.emiAmount.toLocaleString('en-IN')} is due today. Pay now to avoid late fees.`
  },
  OVERDUE: {
    name: 'emi_overdue_v2',
    language: 'en',
    fallbackText: (p) =>
      `Hi ${p.userName}, your EMI of ₹${p.emiAmount.toLocaleString('en-IN')} is overdue by ${p.daysOverdue} day(s). Please pay now to avoid penalties.`
  }
};

// Regional language overrides (ISO 639-1 codes)
const REGION_LANGUAGE_MAP = {
  'TN': 'ta',   // Tamil Nadu → Tamil
  'KA': 'kn',   // Karnataka → Kannada
  'MH': 'mr',   // Maharashtra → Marathi
  'DL': 'hi',   // Delhi → Hindi
  // Add more states as templates are registered in WhatsApp BM
};

export class CostOptimizer {
  /**
   * @param {Object} options
   * @param {string}  options.notificationType
   * @param {string}  [options.region]             - State code (e.g., 'TN')
   * @param {boolean} options.hasOptimizedMessage  - If true, template is used as container only
   * @returns {{ name: string, language: string, fallbackText: Function }}
   */
  static selectTemplate({ notificationType, region, hasOptimizedMessage }) {
    const base = TEMPLATE_MAP[notificationType] ?? TEMPLATE_MAP['DUE_TOMORROW'];

    // Attempt regional language override
    const languageCode = (region && REGION_LANGUAGE_MAP[region]) ?? base.language;

    // If a regional template exists in WhatsApp BM, use it; otherwise fall back to English
    // Convention: regional templates are named e.g. "emi_due_tomorrow_v2_ta"
    const regionalTemplateName = region && REGION_LANGUAGE_MAP[region]
      ? `${base.name}_${languageCode}`
      : base.name;

    return {
      name: regionalTemplateName,
      language: languageCode,
      fallbackText: base.fallbackText
    };
  }
}
