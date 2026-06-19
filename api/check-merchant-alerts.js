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
  return response.json();
}

function calcAvgPct(data) {
  const resources = [
    { current: data.wood, max: data.goals?.wood ?? 1000000 },
    { current: data.stone, max: data.goals?.stone ?? 600000 },
    { current: data.coal, max: data.goals?.coal ?? 400000 },
    { current: data.metal, max: data.goals?.metal ?? 50000 },
    {
