import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    let history = await redis.get('gold-price-history') || [];
    if (!Array.isArray(history)) history = [];
    return new Response(JSON.stringify({ ok: true, history }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message, history: [] }), { status: 200, headers: corsHeaders });
  }
}
