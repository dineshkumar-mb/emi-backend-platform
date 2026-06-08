/**
 * Service to dispatch notifications to Telegram using the Bot API.
 */

/**
 * Sends a raw text message to a specific Telegram Chat ID
 * @param {string} chatId - User's Telegram Chat ID
 * @param {string} message - Message body (supports basic HTML tags)
 * @returns {Promise<boolean>} - Success status
 */
export const sendTelegramMessage = async (chatId, message) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'PLACEHOLDER') {
    console.warn('Telegram Bot Token not configured in .env file.');
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Telegram API Error:', data.description);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Telegram Request Error:', error.message);
    return false;
  }
};

const getGeoFormatting = (geo) => {
  switch (geo) {
    case 'US': return { symbol: '$', locale: 'en-US' };
    case 'GB': return { symbol: '£', locale: 'en-GB' };
    case 'EU': return { symbol: '€', locale: 'de-DE' };
    case 'AE': return { symbol: 'د.إ', locale: 'en-AE' };
    case 'IN':
    default:
      return { symbol: '₹', locale: 'en-IN' };
  }
};

/**
 * Sends a structured EMI payment reminder alert
 * @param {string} chatId - User's Telegram Chat ID
 * @param {Object} loan - Loan details
 * @param {number} daysRemaining - Days remaining until next due date
 * @returns {Promise<boolean>} - Success status
 */
export const sendEmiReminder = async (chatId, loan, daysRemaining) => {
  const geo = loan.userId && typeof loan.userId === 'object' ? loan.userId.geo : 'IN';
  const { symbol, locale } = getGeoFormatting(geo);

  const dueDateStr = new Date(loan.nextDueDate).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const message = `🔔 <b>EMI Due Reminder</b>

Hello! This is a reminder regarding your upcoming EMI payment:

🏛️ <b>Provider:</b> ${loan.provider}
📋 <b>Loan Type:</b> ${loan.loanType}
💰 <b>EMI Amount:</b> ${symbol}${loan.emiAmount.toLocaleString(locale)}
📅 <b>Due Date:</b> ${dueDateStr}
⌛ <b>Time Left:</b> ${daysRemaining === 0 ? 'Due Today!' : `In ${daysRemaining} day(s)`}

<i>Please ensure your account has sufficient funds for the auto-debit transfer.</i>`;

  return await sendTelegramMessage(chatId, message);
};
