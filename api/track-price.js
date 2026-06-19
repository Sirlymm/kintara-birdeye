import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function fetchGoldPrice() {
  const url = 'https://kintara.gg/api/marketplace/listings?sort=latest&currency=all&category=cat_gold&limit=50&offset=0';
  const response = await fetch(url, {
    headers: {
      'Origin': 'https://kintara.gg',
      'Referer': 'https://kintara.gg/play',
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    }
  });
  const data = await response.json();
  const listings = data?.listings ?? [];

  const validListings = listings.filter(l => l.priceUsd && l.priceGold);
  if (!validListings.length) return null;

  const rates = validListings.map(l => l.priceUsd / l.priceGold);
  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  return avgRate;
}

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const price = await fetchGoldPrice();
    if (price === null) {
      return new Response(JSON.stringify({ ok: false, error: 'No valid listings found' }), { status: 200, headers: corsHeaders });
    }

    const snapshot = { price, timestamp: Date.now() };
    const key = 'gold-price-history';

    let history = await redis.get(key) || [];
    if (!Array.isArray(history)) history = [];
    history.push(snapshot);
    if (history.length > 500) history = history.slice(-500);
    await redis.set(key, history);

    return new Response(JSON.stringify({ ok: true, snapshot, totalPoints: history.length }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
