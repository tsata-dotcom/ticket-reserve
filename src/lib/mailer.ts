import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'kanifactory.com',
  port: 587,
  secure: false,
  auth: {
    user: 'info@kanifactory.com',
    pass: process.env.SMTP_PASSWORD!,
  },
});

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: nodemailer.SendMailOptions['attachments'];
}) {
  return transporter.sendMail({
    from: '"かにファクトリー" <info@kanifactory.com>',
    to: options.to,
    subject: options.subject,
    html: options.html,
    attachments: options.attachments,
  });
}
