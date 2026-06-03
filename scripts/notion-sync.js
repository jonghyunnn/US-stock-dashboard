// scripts/notion-sync.js
// 첫 실행 시 DB 컬럼 자동 생성 + 30분마다 시장 데이터 기록

const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DB_ID  = process.env.NOTION_DATABASE_ID;

// ── DB 자동 설정 (첫 실행 시 컬럼 생성) ──────────────────────────────────
async function setupDatabase() {
  console.log('🔧 DB 구조 확인 중...');
  const db   = await notion.databases.retrieve({ database_id: DB_ID });
  const existing = Object.keys(db.properties);
  const updates  = {};

  // 기본 컬럼명 "이름" → "날짜" 로 변경
  if (existing.includes('이름') && !existing.includes('날짜')) {
    updates['이름'] = { name: '날짜' };
  }
  if (existing.includes('Name') && !existing.includes('날짜')) {
    updates['Name'] = { name: '날짜' };
  }

  // 숫자형 컬럼
  const numCols = [
    '공포탐욕지수',
    'USD/KRW', 'EUR/USD', 'USD/JPY', 'GBP/USD',
    'NVDA 가격', 'NVDA 등락(%)',
    'AAPL 가격', 'AAPL 등락(%)',
    'TSLA 가격', 'TSLA 등락(%)',
    'MSFT 가격', 'MSFT 등락(%)',
    'GOOGL 가격', 'GOOGL 등락(%)',
    'META 가격', 'META 등락(%)',
    'AMZN 가격', 'AMZN 등락(%)',
    'AVGO 가격', 'AVGO 등락(%)',
    'PLTR 가격', 'PLTR 등락(%)',
  ];
  for (const col of numCols) {
    if (!existing.includes(col)) updates[col] = { number: { format: 'number' } };
  }

  // 선택형 컬럼
  if (!existing.includes('공포탐욕 라벨')) {
    updates['공포탐욕 라벨'] = {
      select: {
        options: [
          { name: '극단적 공포', color: 'red'    },
          { name: '공포',       color: 'orange'  },
          { name: '중립',       color: 'yellow'  },
          { name: '탐욕',       color: 'green'   },
          { name: '극단적 탐욕', color: 'blue'   },
        ]
      }
    };
  }

  if (Object.keys(updates).length > 0) {
    await notion.databases.update({ database_id: DB_ID, properties: updates });
    console.log(`✅ DB 설정 완료: ${Object.keys(updates).length}개 속성 추가`);
  } else {
    console.log('✅ DB 구조 이미 최신 상태');
  }
}

// ── 데이터 수집 ───────────────────────────────────────────────────────────
async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockDashboard/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function fetchFng() {
  const d = await get('https://api.alternative.me/fng/?limit=1');
  return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
}

async function fetchRates() {
  const d = await get('https://open.er-api.com/v6/latest/USD');
  return {
    usdKrw: round(d.rates.KRW, 2),
    eurUsd: round(1 / d.rates.EUR, 4),
    usdJpy: round(d.rates.JPY, 2),
    gbpUsd: round(1 / d.rates.GBP, 4),
  };
}

async function fetchStock(symbol) {
  const d    = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
  const meta = d.chart.result[0].meta;
  const price = meta.regularMarketPrice;
  const prev  = meta.chartPreviousClose;
  return { price: round(price, 2), changePct: round((price - prev) / prev * 100, 2) };
}

async function fetchStocks() {
  const symbols = ['NVDA','AAPL','MSFT','GOOGL','AMZN','META','TSLA','AVGO','PLTR'];
  const out = {};
  await Promise.allSettled(symbols.map(async s => {
    try   { out[s] = await fetchStock(s); }
    catch { out[s] = { price: null, changePct: null }; }
  }));
  return out;
}

// ── 노션 동기화 ───────────────────────────────────────────────────────────
const FNG_KR = {
  'Extreme Fear':'극단적 공포', 'Fear':'공포', 'Neutral':'중립',
  'Greed':'탐욕', 'Extreme Greed':'극단적 탐욕'
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

  const syms = ['NVDA','AAPL','TSLA','MSFT','GOOGL','META','AMZN','AVGO','PLTR'];
  for (const s of syms) {
    if (stocks[s]?.price !== null) {
      props[`${s} 가격`]    = { number: stocks[s].price };
      props[`${s} 등락(%)`] = { number: stocks[s].changePct };
    }
  }

  await notion.pages.create({ parent: { database_id: DB_ID }, properties: props });
  console.log(`✅ 노션 동기화 완료: ${nowKr}`);
}

// ── 실행 ──────────────────────────────────────────────────────────────────
function round(n, dp) { return Math.round(n * 10 ** dp) / 10 ** dp; }

async function main() {
  await setupDatabase();   // 컬럼 자동 생성

  console.log('🔄 데이터 수집 중...');
  const [fng, rates, stocks] = await Promise.all([fetchFng(), fetchRates(), fetchStocks()]);

  console.log(`📊 공포탐욕지수: ${fng.value} (${FNG_KR[fng.label] || fng.label})`);
  console.log(`💱 USD/KRW: ${rates.usdKrw}`);
  console.log(`📈 NVDA: $${stocks.NVDA?.price ?? 'N/A'} | AAPL: $${stocks.AAPL?.price ?? 'N/A'} | TSLA: $${stocks.TSLA?.price ?? 'N/A'}`);

  await syncToNotion(fng, rates, stocks);
}

main().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
