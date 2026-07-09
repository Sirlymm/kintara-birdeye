import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const KINTARA_HEADERS = {
  'Origin': 'https://kintara.gg',
  'Referer': 'https://kintara.gg/play',
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'Cookie': `__Host-kintara_session=${process.env.KINTARA_SESSION}`,
};

async function fetchLeaderboard() {
  const res = await fetch('https://kintara.gg/api/guilds/leaderboard', {
    headers: KINTARA_HEADERS,
  });
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const data = await res.json();
  return data?.guilds ?? [];
}

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const guilds = await fetchLeaderboard();

    if (!guilds.length) {
      return new Response(JSON.stringify({ ok: false, error: 'No guild data returned — session may have expired' }), { status: 200, headers: corsHeaders });
    }

    // Enrich with computed score and rank
    const enriched = guilds.map(g => ({
      ...g,
      totalKills: (g.mobKills || 0) + (g.pvpKills || 0) + (g.bossKills || 0),
      score: (g.bossKills || 0) * 3 + (g.pvpKills || 0) * 2 + (g.mobKills || 0),
    })).sort((a, b) => b.score - a.score)
      .map((g, i) => ({ ...g, rank: i + 1 }));

    const snapshot = {
      guilds: enriched,
      fetchedAt: Date.now(),
    };

    await redis.set('guild-leaderboard', snapshot);

    return new Response(JSON.stringify({ ok: true, ...snapshot }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200, headers: corsHeaders });
  }
}
