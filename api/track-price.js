import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function fetchGoldPrice() {
  const url = 'https://kintara.gg/api/marketplace/listings?sort=latest&currency=all&category=all&limit=50&offset=0';
  const response = await fetch(url, {
    headers: {
      'Origin': 'https://kintara.gg',
      'Referer': 'https://kintara.gg/play',
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    }
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }

  const listings = data?.listings ?? [];

  const goldListings = listings.filter(l =>
    l.itemType === 'gold' &&
    l.currency === 'token' &&
    typeof l.priceUsd === 'number' &&
    l.priceUsd > 0
  );

  if (!goldListings.length) return null;

  const cheapest = goldListings.reduce((min, l) => {
    const unitPrice = l.priceUsd / (l.quantity || 1);
    const minUnitPrice = min.priceUsd / (min.quantity || 1);
    return unitPrice < minUnitPrice ? l : min;
  });

  return cheapest.priceUsd / (cheapest.quantity || 1);
}

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const price = await fetchGoldPrice();
    if (price === null) {
      return new Response(JSON.stringify({ ok: false, error: 'No valid gold listings found' }), { status: 200, headers: corsHeaders });
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
