import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// itemType values as seen on the live marketplace API.
// 'fish' includes a fallback alias in case Kintara's API string for
// cooked fish meat differs slightly from the merchant-campaign field name.
const MATERIAL_ITEM_TYPES = {
  wood: ['wood'],
  stone: ['stone'],
  coal: ['coal'],
  metal: ['metal'],
  fish: ['cooked_fish_meat', 'cooked_fish'],
};

async function fetchListings() {
  const url = 'https://kintara.gg/api/marketplace/listings?sort=latest&currency=all&category=all&limit=200&offset=0';
  const response = await fetch(url, {
    headers: {
      'Origin': 'https://kintara.gg',
      'Referer': 'https://kintara.gg/play',
      'Accept': '*/*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    }
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data?.listings ?? [];
  } catch (e) {
    return [];
  }
}

function cheapestUnitPrice(listings, itemTypes) {
  const matches = listings.filter(l =>
    itemTypes.includes(l.itemType) &&
    l.currency === 'token' &&
    typeof l.priceUsd === 'number' &&
    l.priceUsd > 0
  );
  if (!matches.length) return null;
  const cheapest = matches.reduce((min, l) => {
    const unitPrice = l.priceUsd / (l.quantity || 1);
    const minUnitPrice = min.priceUsd / (min.quantity || 1);
    return unitPrice < minUnitPrice ? l : min;
  });
  return cheapest.priceUsd / (cheapest.quantity || 1);
}

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const listings = await fetchListings();
    if (!listings.length) {
      return new Response(JSON.stringify({ ok: false, error: 'Could not fetch listings' }), { status: 200, headers: corsHeaders });
    }

    // Diagnostic: any item types we don't recognize, useful for confirming
    // the correct itemType string for cooked fish meat if it ever comes back null.
    const knownTypes = new Set(['gold', ...Object.values(MATERIAL_ITEM_TYPES).flat()]);
    const unknownItemTypesSeen = [...new Set(
      listings.filter(l => !knownTypes.has(l.itemType)).map(l => l.itemType)
    )];

    // ─── GOLD (unchanged behavior) ───
    const goldPrice = cheapestUnitPrice(listings, ['gold']);
    if (goldPrice !== null) {
      const snapshot = { price: goldPrice, timestamp: Date.now() };
      let goldHistory = await redis.get('gold-price-history') || [];
      if (!Array.isArray(goldHistory)) goldHistory = [];
      goldHistory.push(snapshot);
      if (goldHistory.length > 500) goldHistory = goldHistory.slice(-500);
      await redis.set('gold-price-history', goldHistory);
    }

    // ─── MATERIALS (new) ───
    const materialPrices = {};
    for (const [key, itemTypes] of Object.entries(MATERIAL_ITEM_TYPES)) {
      materialPrices[key] = cheapestUnitPrice(listings, itemTypes);
    }
    const materialSnapshot = { ...materialPrices, timestamp: Date.now() };
    let materialsHistory = await redis.get('materials-price-history') || [];
    if (!Array.isArray(materialsHistory)) materialsHistory = [];
    materialsHistory.push(materialSnapshot);
    if (materialsHistory.length > 500) materialsHistory = materialsHistory.slice(-500);
    await redis.set('materials-price-history', materialsHistory);

    return new Response(JSON.stringify({
      ok: true,
      goldPrice,
      materialPrices,
      unknownItemTypesSeen,
    }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
