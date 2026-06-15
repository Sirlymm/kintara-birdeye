export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (!url) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), { status: 400, headers: corsHeaders });
  }

  const allowed = ['ktra-server-b.onrender.com', 'kintara.gg/api'];
  const isAllowed = allowed.some(domain => url.includes(domain));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Domain not allowed' }), { status: 403, headers: corsHeaders });
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Origin': 'https://kintara.gg',
        'Referer': 'https://kintara.gg/play?embed=outfit&_=1781519192124',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
      }
    });

    const data = await response.text();
    return new Response(data, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': response.headers.get('content-type') || 'application/json',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy failed', detail: err.message }), { status: 500, headers: corsHeaders });
  }
}
