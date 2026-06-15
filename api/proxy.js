export const config = { runtime: 'edge' };

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const reqUrl = new URL(req.url);
  const url = reqUrl.searchParams.get('url');

  if (!url) return new Response(JSON.stringify({ error: 'Missing url' }), { status: 400, headers: corsHeaders });

  const allowed = ['ktra-server-b.onrender.com', 'kintara.gg/api'];
  if (!allowed.some(d => url.includes(d))) {
    return new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403, headers: corsHeaders });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'Origin': 'https://kintara.gg',
        'Referer': 'https://kintara.gg/play',
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      }
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': response.headers.get('content-type') || 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
