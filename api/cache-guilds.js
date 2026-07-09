import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    if (!body?.guilds?.length) {
      return new Response(JSON.stringify({ ok: false, error: 'No guild data in request' }), { status: 200, headers: corsHeaders });
    }

    // Enrich with score and rank
    const enriched = body.guilds.map(g => ({
      ...g,
      totalKills: (g.mobKills || 0) + (g.pvpKills || 0) + (g.bossKills || 0),
      score: (g.bossKills || 0) * 3 + (g.pvpKills || 0) * 2 + (g.mobKills || 0),
    })).sort((a, b) => b.score - a.score)
      .map((g, i) => ({ ...g, rank: i + 1 }));

    const snapshot = { guilds: enriched, fetchedAt: Date.now() };
    await redis.set('guild-leaderboard', snapshot);

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 200, headers: corsHeaders });
  }
}
