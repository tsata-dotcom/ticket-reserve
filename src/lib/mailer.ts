export async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string;
    content_type: string;
    cid?: string;
  }>;
}) {
  const response = await fetch(`${process.env.PROXY_URL}send-mail.php`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': process.env.PROXY_SECRET!,
    },
    body: JSON.stringify({
      to: options.to,
      subject: options.subject,
      html: options.html,
      from_name: 'かにファクトリー',
      from_email: 'info@kanifactory.com',
      attachments: options.attachments || [],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mail send failed (${response.status}): ${text}`);
  }

  return response.json();
}
