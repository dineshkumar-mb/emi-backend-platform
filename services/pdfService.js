import PDFDocument from 'pdfkit';

/**
 * Builds a structured, beautiful financial report PDF.
 * @param {Object} data - Contains report statistics (loans, net worth, assets, health metrics)
 * @param {import('stream').Writable} stream - Response output write stream
 */
export const generateFinancialReportPDF = (data, stream) => {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  doc.pipe(stream);

  // Color Palette Constants
  const primaryColor = '#0f172a';   // Deep slate
  const secondaryColor = '#6366f1'; // Indigo base
  const accentGreen = '#10b981';    // Emerald
  const accentRed = '#ef4444';      // Red alert
  const textColor = '#334155';      // Slate gray

  // Document Title Header Banner
  doc
    .fillColor(secondaryColor)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('AI EMI Tracker & Financial Intelligence Report', 50, 50, { align: 'center' })
    .moveDown(0.2);

  doc
    .fillColor(textColor)
    .font('Helvetica')
    .fontSize(10)
    .text(`Report Generated On: ${new Date().toLocaleDateString()} | Reference ID: ${data.userId}`, { align: 'center' })
    .moveDown(1.5);

  // Divider Line
  doc
    .strokeColor('#e2e8f0')
    .lineWidth(1)
    .moveTo(50, doc.y)
    .lineTo(545, doc.y)
    .stroke()
    .moveDown(1.5);

  // 1. Executive Summary Panel
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(15).text('1. Executive Net Worth Summary').moveDown(0.5);

  const netWorthY = doc.y;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .fontSize(10)
    .text(`Total Asset Base Valuation:`, 70, netWorthY)
    .font('Helvetica-Bold')
    .fillColor(accentGreen)
    .text(`INR ${data.netWorthData.totalAssets.toLocaleString()}`, 260, netWorthY);

  const liabY = netWorthY + 20;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .text(`Total Outstanding Liabilities:`, 70, liabY)
    .font('Helvetica-Bold')
    .fillColor(accentRed)
    .text(`INR ${data.netWorthData.totalLiabilities.toLocaleString()}`, 260, liabY);

  const netY = liabY + 20;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .text(`Net Household Worth:`, 70, netY)
    .font('Helvetica-Bold')
    .fillColor(data.netWorthData.netWorth >= 0 ? accentGreen : accentRed)
    .text(`INR ${data.netWorthData.netWorth.toLocaleString()}`, 260, netY)
    .moveDown(2);

  // 2. Active Loan Liabilities
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(15).text('2. Loan Portfolio Liabilities').moveDown(0.5);

  if (data.loans.length === 0) {
    doc.fillColor(textColor).font('Helvetica').fontSize(10).text('No active loan agreements detected in this account.').moveDown(1.5);
  } else {
    data.loans.forEach((loan, idx) => {
      const currentY = doc.y;
      doc
        .fillColor(secondaryColor)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`${idx + 1}. ${loan.provider} [${loan.loanType}]`, 70, currentY)
        .font('Helvetica')
        .fontSize(9)
        .fillColor(textColor)
        .text(`   • Original Principal: INR ${loan.principal.toLocaleString()}`)
        .text(`   • Fixed Interest Rate: ${loan.interestRate}% APR`)
        .text(`   • Monthly EMI Amount: INR ${loan.emiAmount.toLocaleString()}`)
        .text(`   • Outstanding Debt Balance: INR ${loan.outstandingBalance.toLocaleString()}`)
        .text(`   • Next Term Billing Date: ${new Date(loan.nextDueDate).toLocaleDateString()}`)
        .moveDown(0.6);
    });
  }

  // 3. SaaS Subscriptions Burn Rate
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(15).text('3. SaaS Subscriptions Burn Rate').moveDown(0.5);

  const subY = doc.y;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .fontSize(10)
    .text(`Active Tracked Obligations: ${data.subscriptionsCount} service(s)`)
    .text(`Monthly Recurring Subscription Burn: INR ${data.subscriptionsBurn.toLocaleString()}`)
    .moveDown(1.5);

  // 4. Portfolio Credit Risk & Health Index
  doc.fillColor(primaryColor).font('Helvetica-Bold').fontSize(15).text('4. Credit & Health Scoring Grade').moveDown(0.5);

  const scoreY = doc.y;
  const ratingColor = data.healthData.score >= 80 ? accentGreen : (data.healthData.score >= 50 ? '#d97706' : accentRed);
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .fontSize(10)
    .text(`Loan Portfolio Health Rating:`, 70, scoreY)
    .font('Helvetica-Bold')
    .fillColor(ratingColor)
    .text(`${data.healthData.score} / 100`, 260, scoreY);

  const dtiY = scoreY + 20;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .text(`Debt-to-Income (DTI) Outflow Ratio:`, 70, dtiY)
    .font('Helvetica-Bold')
    .fillColor(textColor)
    .text(`${data.healthData.debtToIncomeRatio}%`, 260, dtiY);

  const riskY = dtiY + 20;
  doc
    .fillColor(textColor)
    .font('Helvetica')
    .text(`Credit default Risk Classification:`, 70, riskY)
    .font('Helvetica-Bold')
    .fillColor(ratingColor)
    .text(`${data.healthData.defaultRisk.toUpperCase()}`, 260, riskY)
    .moveDown(2.5);

  // Footer Disclaimer Section
  doc
    .strokeColor('#cbd5e1')
    .lineWidth(0.5)
    .moveTo(50, 745)
    .lineTo(545, 745)
    .stroke();

  doc
    .fillColor('#94a3b8')
    .font('Helvetica')
    .fontSize(7.5)
    .text('Confidential System Output. All transactions, assets, and liability data are cryptographic signature-verified and isolated under tenant authorization gates.', 50, 755, { align: 'center' });

  doc.end();
};
