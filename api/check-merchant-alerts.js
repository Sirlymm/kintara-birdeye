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
      state = { sent50: false, sent90: false, sentReturned: false };
    }

    let messageSent = null;

    if (isComplete && !state.sentReturned) {
      await sendTelegramMessage(
        `🎉 <b>The Merchant Has Returned!</b>\n\nGold is back in stock — head to the marketplace now!\n\n🐘 Tracked live by KINTARA BIRDEYE`
      );
      state.sentReturned = true;
      state.sent50 = false;
      state.sent90 = false;
      messageSent = 'returned';
    } else if (!isComplete) {
      if (state.sentReturned && avgPct < 10) {
        state.sentReturned = false;
      }
      if (avgPct >= 90 && !state.sent90) {
        await sendTelegramMessage(
          `🚨 <b>Merchant Almost Ready!</b>\n\nDonations are at ${Math.round(avgPct)}% — final push needed before he heads out for gold!\n\n🐘 Tracked live by KINTARA BIRDEYE`
        );
        state.sent90 = true;
        messageSent = '90%';
      } else if (avgPct >= 50 && !state.sent50) {
        await sendTelegramMessage(
          `📢 <b>Merchant Halfway There!</b>\n\nDonations are at ${Math.round(avgPct)}% filled — keep contributing wood, stone, coal, metal & fish!\n\n🐘 Tracked live by KINTARA BIRDEYE`
        );
        state.sent50 = true;
        messageSent = '50%';
      }
      if (avgPct < 50) { state.sent50 = false; state.sent90 = false; }
    }

    await redis.set('merchant-alert-state', state);

    return new Response(JSON.stringify({ ok: true, avgPct, isComplete, messageSent, state, rawData: data }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: corsHeaders });
  }
}
