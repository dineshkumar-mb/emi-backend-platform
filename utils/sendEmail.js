import nodemailer from 'nodemailer';

const sendEmail = async (options) => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    throw new Error('SMTP credentials are not configured in the environment variables.');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_PORT == 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const message = {
    from: `${process.env.FROM_NAME || 'EMI Tracker Support'} <${process.env.FROM_EMAIL || 'noreply@emitracker.com'}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html,
  };

  const info = await transporter.sendMail(message);

  console.log('Message sent: %s', info.messageId);
};

export default sendEmail;
