export async function proxyRequest(params: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}) {
  const response = await fetch(process.env.PROXY_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Proxy-Secret': process.env.PROXY_SECRET!,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Proxy request failed (${response.status}): ${text}`);
  }

  return response.json();
}
