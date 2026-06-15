export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  const allowed = [
    'ktra-server-b.onrender.com',
    'kintara.gg/api'
  ];
  const isAllowed = allowed.some(domain => url.includes(domain));
  if (!isAllowed) return res.status(403).json({ error: 'Domain not allowed' });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Origin': 'https://kintara.gg',
        'Referer': 'https://kintara.gg/play?embed=outfit&_=1781519192124',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      }
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(200).json(data);
    } else {
      const text = await response.text();
      return res.status(200).send(text);
    }
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy fetch failed', detail: err.message });
  }
}
