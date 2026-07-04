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
    { current: data.wood, max: data.goals?.wood ?? 1000000 },
    { current: data.stone, max: data.goals?.stone ?? 600000 },
    { current: data.coal, max: data.goals?.coal ?? 400000 },
    { current: data.metal, max: data.goals?.metal ?? 50000 },
    { current: data.cooked_fish_meat, max: data.goals?.cooked_fish_meat ?? 50000 },
  ];
  let total = 0;
  resources.forEach(r => {
    const pct = Math.min(100, ((r.current ?? 0) / (r.max ?? 1)) * 100);
    total += pct;
  });
  return total / resources.length;
}

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// Milestone tiers, defined in ascending order with their own state key and message.
// 15% is the earliest alert — gives players a heads up early since the merchant
// now visits twice a day with halved donation goals, so time windows are shorter.
const TIERS = [
  { pct: 15, key: 'sent15', label: '15%', emoji: '🔔', title: 'Merchant Donations Starting!', body: (p) => `Donations are at ${p}% — the merchant cycle has begun, start contributing wood, stone, coal, metal & fish!` },
  { pct: 50, key: 'sent50', label: '50%', emoji: '📢', title: 'Merchant Halfway There!', body: (p) => `Donations are at ${p}% filled — keep contributing wood, stone, coal, metal & fish!` },
  { pct: 75, key: 'sent75', label: '75%', emoji: '⚡', title: 'Merchant Three-Quarters Full!', body: (p) => `Donations are at ${p}% — getting close, keep the momentum going!` },
  { pct: 90, key: 'sent90', label: '90%', emoji: '🚨', title: 'Merchant Almost Ready!', body: (p) => `Donations are at ${p}% — final push needed before he heads out for gold!` },
  { pct: 96, key: 'sent96', label: '96%', emoji: '🔥', title: 'Merchant On The Verge!', body: (p) => `Donations are at ${p}% — practically there, last few contributions will seal it!` },
];

export default async function handler(req) {
  const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
  try {
    const data = await getMerchantData();
    if (!data) {
      return new Response(JSON.stringify({ ok: false, error: 'Could not fetch or parse merchant data' }), { status: 200, headers: corsHeaders });
    }

    const avgPct = calcAvgPct(data);
    const isComplete = data?.complete === true || data?.goldTradeEnabled === true;

    let state = await redis.get('merchant-alert-state');
    if (!state || typeof state !== 'object') {
      state = {};
    }
    TIERS.forEach(t => { if (typeof state[t.key] !== 'boolean') state[t.key] = false; });
    if (typeof state.sentReturned !== 'boolean') state.sentReturned = false;

    let messageSent = null;

    if (isComplete && !state.sentReturned) {
      await sendTelegramMessage(
        `🎉 <b>The Merchant Has Returned!</b>\n\nGold is back in stock — head to the marketplace now!\n\n🐘 Tracked live by KINTARA BIRDEYE`
      );
      state.sentReturned = true;
      TIERS.forEach(t => { state[t.key] = false; });
      messageSent = 'returned';
    } else if (!isComplete) {
      // Reset the "returned" flag once a fresh collection cycle clearly starts,
      // and announce that donations are open again.
      if (state.sentReturned && avgPct < 10) {
        state.sentReturned = false;
        await sendTelegramMessage(
          `🆕 <b>Donations Are Open Again!</b>\n\nThe Traveling Merchant is collecting resources once more — start donating wood, stone, coal, metal & fish to bring him back with gold!\n\n🐘 Tracked live by KINTARA BIRDEYE`
        );
        messageSent = 'reopened';
      }

      // Walk tiers from lowest to highest and fire EVERY crossed-but-unsent tier,
      // so a jump that skips past multiple thresholds in one check still fires all of them.
      const sentThisRun = [];
      for (let i = 0; i < TIERS.length; i++) {
        const tier = TIERS[i];
        if (avgPct >= tier.pct && !state[tier.key]) {
          await sendTelegramMessage(
            `${tier.emoji} <b>${tier.title}</b>\n\n${tier.body(Math.round(avgPct))}\n\n🐘 Tracked live by KINTARA BIRDEYE`
          );
          state[tier.key] = true;
          sentThisRun.push(tier.label);
        }
      }
      if (sentThisRun.length > 0) {
        messageSent = messageSent ? `${messageSent}, ${sentThisRun.join(', ')}` : sentThisRun.join(', ');
      }

      // Reset all tiers when avgPct drops below the lowest tier (new cycle started).
      // With 15% as the first tier, this resets when a fresh visit begins.
      if (avgPct < TIERS[0].pct) {
        TIERS.forEach(t => { state[t.key] = false; });
      }
    }

    await redis.set('merchant-alert-state', state);

    return new Response(JSON.stringify({ ok: true, avgPct, isComplete, messageSent, state }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
