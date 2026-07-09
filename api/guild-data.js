import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    // Try to serve from cache first
    let data = await redis.get('guild-leaderboard');

    // If no cache, fetch fresh
    if (!data) {
      const freshRes = await fetch(new URL('/api/fetch-guilds', req.url).toString());
      data = await freshRes.json();
    }

    return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200, headers: corsHeaders });
  }
}
