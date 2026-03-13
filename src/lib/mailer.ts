import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: 'denshoku-corp.sakura.ne.jp',
  port: 587,
  secure: false,
  auth: {
    type: 'LOGIN',
    user: 'info@kanifactory.com',
    pass: process.env.SMTP_PASSWORD!,
  },
  tls: {
    rejectUnauthorized: false,
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
