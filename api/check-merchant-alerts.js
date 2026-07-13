import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function getMerchantData() {
  const url = 'https://kintara.gg/api/world/merchant-campaign';
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
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function calcAvgPct(data) {
  if (!data) return 0;
  const resources = [
    { current: data.wood, max: data.goals?.wood ?? 1250000 },
    { current: data.stone, max: data.goals?.stone ?? 750000 },
    { current: data.coal, max: data.goals?.coal ?? 500000 },
    { current: data.metal, max: data.goals?.metal ?? 200000 },
    { current: data.cooked_fish_meat, max: data.goals?.cooked_fish_meat ?? 100000 },
  ];
  let total = 0;
  resources.forEach(r => {
    const pct = Math.min(100, ((r.current ?? 0) / (r.max ?? 1)) * 100);
    total += pct;
  });
  return total / resources.length;
}

// Returns true ONLY if Telegram actually accepted the message.
// Never mark a tier as "sent" unless this returns true.
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    return json?.ok === true;
  } catch (e) {
    return false;
  }
}

const TIERS = [
  { pct: 5,  key: 'sent5',  label: '5%',  emoji: '🔔', title: 'Merchant Donations Open!',     body: (p) => `Donations are at ${p}% — the merchant cycle has begun! Start contributing wood, stone, coal, metal & fish now!` },
  { pct: 50, key: 'sent50', label: '50%', emoji: '📢', title: 'Merchant Halfway There!',       body: (p) => `Donations are at ${p}% filled — keep contributing wood, stone, coal, metal & fish!` },
  { pct: 75, key: 'sent75', label: '75%', emoji: '⚡', title: 'Merchant Three-Quarters Full!', body: (p) => `Donations are at ${p}% — getting close, keep the momentum going!` },
  { pct: 90, key: 'sent90', label: '90%', emoji: '🚨', title: 'Merchant Almost Ready!',        body: (p) => `Donations are at ${p}% — final push needed before he heads out for gold!` },
  { pct: 96, key: 'sent96', label: '96%', emoji: '🔥', title: 'Merchant On The Verge!',        body: (p) => `Donations are at ${p}% — practically there, last few contributions will seal it!` },
];

const VALID_KEYS = [...TIERS.map(t => t.key), 'sentReturned', 'cycleId'];

function freshState(cycleId) {
  const s = { sentReturned: false, cycleId: cycleId ?? null };
  TIERS.forEach(t => { s[t.key] = false; });
  return s;
}

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const data = await getMerchantData();
    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: 'Could not fetch or parse merchant data' }), { status: 200, headers: corsHeaders });
    }

    const avgPct = calcAvgPct(data);
    const isComplete = data?.complete === true || data?.goldTradeEnabled === true;
    const cycleId = data?.cycleId ?? null;

    let state = await redis.get('merchant-alert-state');
    if (!state || typeof state !== 'object') state = freshState(cycleId);

    // Strip any stale/unknown keys from older versions (e.g. sent15).
    Object.keys(state).forEach(k => { if (!VALID_KEYS.includes(k)) delete state[k]; });
    TIERS.forEach(t => { if (typeof state[t.key] !== 'boolean') state[t.key] = false; });
    if (typeof state.sentReturned !== 'boolean') state.sentReturned = false;
    if (typeof state.cycleId === 'undefined') state.cycleId = null;

    let messageSent = null;
    let cycleRolled = false;

    // ── CYCLE ROLLOVER ────────────────────────────────────────────────
    // This is the reset. It is event-driven, not threshold-driven, so it
    // cannot be missed no matter how fast a cycle fills between cron ticks.
    if (cycleId !== null && state.cycleId !== null && cycleId !== state.cycleId) {
      state = freshState(cycleId);
      cycleRolled = true;
    }
    state.cycleId = cycleId;

    if (isComplete) {
      if (!state.sentReturned) {
        const anyTierFired = TIERS.some(t => state[t.key]);

        // Fast-fill: cycle completed before we ever observed the early tiers.
        // Send ONE alert, not the whole skipped backlog.
        const text = anyTierFired
          ? `🎉 <b>The Merchant Has Returned!</b>\n\nGold is back in stock — head to the marketplace now!\n\n🐘 Tracked live by KINTARA BIRDEYE`
          : `🎉 <b>The Merchant Has Returned!</b>\n\nThe donation goals filled fast this cycle — gold is back in stock. Head to the marketplace now!\n\n🐘 Tracked live by KINTARA BIRDEYE`;

        const ok = await sendTelegramMessage(text);
        if (ok) {
          state.sentReturned = true;
          // Tiers are irrelevant now; the next cycleId change re-arms them.
          TIERS.forEach(t => { state[t.key] = true; });
          messageSent = anyTierFired ? 'returned' : 'returned (fast-fill)';
        }
      }
    } else {
      // Collection phase.
      if (state.sentReturned) {
        const ok = await sendTelegramMessage(
          `🆕 <b>Donations Are Open Again!</b>\n\nThe Traveling Merchant is collecting resources once more — start donating wood, stone, coal, metal & fish to bring him back with gold!\n\n🐘 Tracked live by KINTARA BIRDEYE`
        );
        if (ok) {
          state.sentReturned = false;
          TIERS.forEach(t => { state[t.key] = false; });
          messageSent = 'reopened';
        }
      }

      // Walk tiers LOW → HIGH and fire EVERY crossed-but-unsent tier.
      const sentThisRun = [];
      for (let i = 0; i < TIERS.length; i++) {
        const tier = TIERS[i];
        if (avgPct >= tier.pct && !state[tier.key]) {
          const ok = await sendTelegramMessage(
            `${tier.emoji} <b>${tier.title}</b>\n\n${tier.body(Math.round(avgPct))}\n\n🐘 Tracked live by KINTARA BIRDEYE`
          );
          if (ok) {
            state[tier.key] = true;
            sentThisRun.push(tier.label);
          }
        }
      }
      if (sentThisRun.length > 0) {
        messageSent = messageSent ? `${messageSent}, ${sentThisRun.join(', ')}` : sentThisRun.join(', ');
      }
    }

    await redis.set('merchant-alert-state', state);

    return new Response(JSON.stringify({ ok: true, avgPct, isComplete, cycleId, cycleRolled, messageSent, state }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
