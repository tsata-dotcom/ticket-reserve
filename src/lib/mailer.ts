type Attachment = {
  filename: string;
  content: string;
  content_type: string;
  cid?: string;
};

async function sendViaSakura(
  to: string,
  subject: string,
  html: string,
  attachments?: Attachment[]
) {
  const response = await fetch(`${process.env.PROXY_URL}send-mail.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': process.env.PROXY_SECRET!,
    },
    body: JSON.stringify({
      to,
      subject,
      html,
      from_name: 'かにファクトリー',
      from_email: 'info@kanifactory.com',
      attachments: attachments || [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mail send failed (${response.status}): ${text}`);
  }

  return response.json();
}

async function sendViaResend(
  to: string,
  subject: string,
  html: string,
  attachments?: Attachment[]
) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'かにファクトリー <info@kanifactory.com>',
      to: [to],
      subject,
      html,
      attachments:
        attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.content_type,
        })) || [],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error: ${response.status} ${body}`);
  }

  return response.json();
}

export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: Attachment[];
}) {
  const provider = process.env.MAIL_PROVIDER || 'sakura';
  if (provider === 'resend') {
    return sendViaResend(options.to, options.subject, options.html, options.attachments);
  }
  return sendViaSakura(options.to, options.subject, options.html, options.attachments);
}
