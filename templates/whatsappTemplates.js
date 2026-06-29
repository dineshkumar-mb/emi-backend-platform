/**
 * WhatsApp Message Templates with placeholder replacement
 */

export const replacePlaceholders = (templateText, data) => {
  if (!templateText) return '';
  let result = templateText;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value === null || value === undefined ? '' : value);
  }
  return result;
};

export const WhatsAppTemplates = {
  DUE_IN_3_DAYS: `⏰ *Upcoming EMI*

Hi {{name}}

Your EMI of ₹{{emiAmount}}

for:

{{loanName}}

will be due in 3 days on {{dueDate}}.

Please ensure your account is funded.`,

  LOW_BALANCE_ALERT: `⚠️ *Low Balance Alert*

Hi {{name}}

Your EMI of ₹{{emiAmount}} is due soon, but your predicted account balance is only ₹{{currentBalance}}.

Expected Shortfall: ₹{{shortfall}}

Please deposit funds immediately to avoid bounce penalties.`,

  EMI_DUE_TOMORROW: `⏰ *EMI Reminder*

Hi {{name}}

Your EMI of ₹{{emiAmount}}

for:

{{loanName}}

is due tomorrow.

Due Date:
{{dueDate}}

Please ensure sufficient balance.`,

  EMI_DUE_TODAY: `🚨 *EMI Due Today*

Your EMI payment of ₹{{emiAmount}}

for {{loanName}}

is due today.

Avoid late penalties by paying before midnight.`,

  EMI_PAID: `🎉 *EMI Payment Received*

Hi {{name}},

We have received your EMI payment of ₹{{emiAmount}} for:

🏦 {{loanName}}

📅 Paid On: {{paymentDate}}

Remaining Balance:
₹{{remainingBalance}}

Keep up the great financial discipline!

Team EMI Intelligence`,

  LOAN_CLOSED: `🎉 *Congratulations!*

Your loan:

{{loanName}}

has been fully repaid.

Total Amount Paid:
₹{{totalPaid}}

Loan Closure Date:
{{closureDate}}

Thank you for using EMI Intelligence.`,

  MISSED_PAYMENT: `⚠️ *EMI Overdue*

Loan:
{{loanName}}

Amount:
₹{{emiAmount}}

Days Overdue:
{{days}}

Please make payment immediately.`,

  MONTHLY_SUMMARY: `📊 *Monthly Loan Summary*

Active Loans:
{{activeLoans}}

Outstanding:
₹{{outstanding}}

EMIs Paid:
₹{{paid}}

Upcoming EMIs:
{{upcoming}}`,

  AUTOPAY_FAILED: `❌ *Auto-Pay Failed*

Loan:
{{loanName}}

EMI:
₹{{emiAmount}}

Reason:
{{reason}}

Please complete payment manually.`,

  AUTOPAY_SUCCESS: `✅ *Auto-Pay Successful*

Loan:
{{loanName}}

Amount:
₹{{emiAmount}}

Paid Successfully.`,

  CREDIT_TIPS: `💡 *Smart Financial Insight*

Hi {{name}},

{{insightMessage}}

Best,
EMI Intelligence Team`,

  WELCOME: `🎉 *WhatsApp Connected Successfully*

You will now receive:

✅ EMI Reminders
✅ Payment Confirmations
✅ Overdue Alerts
✅ Monthly Summaries
✅ Loan Closure Notifications

Welcome to EMI Intelligence.`
};
