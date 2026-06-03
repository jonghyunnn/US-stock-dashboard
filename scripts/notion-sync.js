// scripts/notion-sync.js
// GitHub Actions에서 30분마다 실행 → 노션 DB에 시장 데이터 기록

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DB_ID  = process.env.NOTION_DATABASE_ID;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockDashboard/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ── 데이터 수집 ───────────────────────────────────────────────────────────
async function fetchFng() {
  const d = await get('https://api.alternative.me/fng/?limit=1');
  return {
    value: parseInt(d.data[0].value),
    label: d.data[0].value_classification
  };
}

async function fetchRates() {
  const d = await get('https://open.er-api.com/v6/latest/USD');
  return {
    usdKrw: round(d.rates.KRW, 2),
    eurUsd: round(1 / d.rates.EUR, 4),
    usdJpy: round(d.rates.JPY, 2),
    gbpUsd: round(1 / d.rates.GBP, 4),
    dxy:    null   // DXY는 별도 소스 필요 — 향후 추가
  };
}

async function fetchStock(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const d   = await get(url);
  const meta = d.chart.result[0].meta;
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose;
  return {
    price:   round(price, 2),
    changePct: round((price - prev) / prev * 100, 2)
  };
}

async function fetchStocks() {
  const symbols = ['NVDA','AAPL','MSFT','GOOGL','AMZN','META','TSLA','AVGO','PLTR'];
  const out = {};
  await Promise.allSettled(
    symbols.map(async s => {
      try   { out[s] = await fetchStock(s); }
      catch { out[s] = { price: null, changePct: null }; }
    })
  );
  return out;
}

// ── 노션 동기화 ───────────────────────────────────────────────────────────
const FNG_KR = {
  'Extreme Fear': '극단적 공포',
  'Fear':         '공포',
  'Neutral':      '중립',
  'Greed':        '탐욕',
  'Extreme Greed':'극단적 탐욕'
};

async function syncToNotion(fng, rates, stocks) {
  const nowKr = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

  const props = {
    '날짜':       { title:  [{ text: { content: nowKr } }] },
    '공포탐욕지수': { number: fng.value },
    '공포탐욕 라벨':{ select: { name: FNG_KR[fng.label] || fng.label } },
    'USD/KRW':    { number: rates.usdKrw },
    'EUR/USD':    { number: rates.eurUsd },
    'USD/JPY':    { number: rates.usdJpy },
    'GBP/USD':    { number: rates.gbpUsd },
  };

  // 종목 가격 추가
  const fields = {
    NVDA:'NVDA', AAPL:'AAPL', MSFT:'MSFT', GOOGL:'GOOGL',
    AMZN:'AMZN', META:'META', TSLA:'TSLA', AVGO:'AVGO', PLTR:'PLTR'
  };
  for (const [sym, col] of Object.entries(fields)) {
    if (stocks[sym]?.price !== null) {
      props[col + ' 가격']  = { number: stocks[sym].price };
      props[col + ' 등락(%)'] = { number: stocks[sym].changePct };
    }
  }

  await notion.pages.create({ parent: { database_id: DB_ID }, properties: props });
  console.log(`✅ 노션 동기화 완료: ${nowKr}`);
}

// ── 실행 ──────────────────────────────────────────────────────────────────
function round(n, dp) { return Math.round(n * 10 ** dp) / 10 ** dp; }

async function main() {
  console.log('🔄 데이터 수집 시작...');

  const [fng, rates, stocks] = await Promise.all([
    fetchFng(),
    fetchRates(),
    fetchStocks()
  ]);

  console.log(`📊 공포탐욕지수 : ${fng.value} (${FNG_KR[fng.label] || fng.label})`);
  console.log(`💱 USD/KRW     : ${rates.usdKrw}`);
  console.log(`📈 NVDA        : $${stocks.NVDA?.price ?? 'N/A'} (${stocks.NVDA?.changePct ?? '?'}%)`);
  console.log(`📈 AAPL        : $${stocks.AAPL?.price ?? 'N/A'}`);
  console.log(`📈 TSLA        : $${stocks.TSLA?.price ?? 'N/A'}`);

  await syncToNotion(fng, rates, stocks);
}

main().catch(e => {
  console.error('❌ 오류:', e.message);
  process.exit(1);
});
