/**
 * /api/refresh — Vercel Serverless Function (CommonJS)
 *
 * 1. Fetches live market caps for ALL ~50 watchlist tickers via Yahoo Finance
 * 2. Ranks by market cap → picks top N (10 or 15, via ?count= param)
 * 3. Compares against previous top N → reports any entries/exits
 * 4. Fetches quotes + news for the live top N
 * 5. Fetches SEC EDGAR fundamentals (revenue, net income, EPS, recent filings)
 * 6. Returns full payload so the frontend can re-render the entire dashboard
 *
 * Data sources:
 *   Primary quotes/market cap : Yahoo Finance v7 (no API key)
 *   Fallback quote             : Yahoo Finance v8 chart (no API key)
 *   News primary               : Yahoo Finance search (no API key)
 *   News fallback              : Finnhub (free key — set FINNHUB_API_KEY env var)
 *   Fundamentals               : SEC EDGAR XBRL API (free, no API key)
 *   Insider filings            : SEC EDGAR submissions API (free, no API key)
 */

const path = require('path');
const watchlistData = require('../watchlist.json');

const ALL_TICKERS = watchlistData.tickers;          // ~50 tickers
const COMPANY_META = watchlistData.companies;       // static metadata per ticker

// ── NYSE Market Status ─────────────────────────────────────────────────────
const NYSE_HOLIDAYS = new Set([
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]);

function getMarketStatus() {
  const etString = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etString);
  const dow = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const dateStr = `${et.getFullYear()}-${String(et.getMonth()+1).padStart(2,'0')}-${String(et.getDate()).padStart(2,'0')}`;

  if (dow === 0 || dow === 6)
    return { isOpen: false, status: 'closed', reason: 'weekend',
      message: "Markets are closed — it's the weekend. Trading resumes Monday 9:30 AM ET." };
  if (NYSE_HOLIDAYS.has(dateStr))
    return { isOpen: false, status: 'closed', reason: 'holiday',
      message: "Markets closed today for a US market holiday. Showing last available prices." };
  if (mins >= 240 && mins < 570)
    return { isOpen: false, status: 'pre_market', reason: 'pre_market',
      message: `Pre-market session (4:00–9:30 AM ET). Regular trading opens at 9:30 AM ET.` };
  if (mins >= 570 && mins < 960) {
    const left = 960 - mins;
    return { isOpen: true, status: 'open', reason: null,
      message: `Markets are OPEN · closes in ${Math.floor(left/60)}h ${left%60}m (4:00 PM ET)` };
  }
  if (mins >= 960 && mins < 1200)
    return { isOpen: false, status: 'after_hours', reason: 'after_hours',
      message: "After-hours session (4:00–8:00 PM ET). Regular session closed at 4:00 PM ET." };
  return { isOpen: false, status: 'closed', reason: 'overnight',
    message: "Markets closed. Pre-market opens 4:00 AM ET, regular session 9:30 AM ET." };
}

// ── Yahoo Finance v7 bulk quote ────────────────────────────────────────────
async function fetchYahooBulk(tickers) {
  try {
    const symbols = tickers.join(',');
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,fiftyTwoWeekHigh,fiftyTwoWeekLow,marketCap,trailingPE,regularMarketVolume,preMarketPrice,postMarketPrice&formatted=false&lang=en-US&region=US`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`Yahoo v7 HTTP ${res.status}`);
    const data = await res.json();
    const results = data?.quoteResponse?.result || [];
    const out = {};
    for (const r of results) {
      out[r.symbol] = {
        price: r.regularMarketPrice,
        change: r.regularMarketChange,
        change_pct: r.regularMarketChangePercent,
        prev_close: r.regularMarketPreviousClose,
        open: r.regularMarketOpen,
        day_high: r.regularMarketDayHigh,
        day_low: r.regularMarketDayLow,
        week52_high: r.fiftyTwoWeekHigh,
        week52_low: r.fiftyTwoWeekLow,
        market_cap: r.marketCap,
        market_cap_b: r.marketCap ? r.marketCap / 1e9 : null,
        pe_ratio: r.trailingPE || null,
        volume: r.regularMarketVolume,
        pre_market_price: r.preMarketPrice || null,
        post_market_price: r.postMarketPrice || null,
        source: 'yahoo_finance',
      };
    }
    return out;
  } catch (e) {
    console.error('Yahoo v7 bulk failed:', e.message);
    return {};
  }
}

// ── Yahoo Finance v8 single fallback ──────────────────────────────────────
async function fetchYahooV8Single(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`v8 HTTP ${res.status}`);
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) throw new Error('no meta');
    const price = meta.regularMarketPrice;
    const prev = meta.previousClose || meta.chartPreviousClose || price;
    return {
      price,
      change: price - prev,
      change_pct: ((price - prev) / prev) * 100,
      prev_close: prev,
      day_high: meta.regularMarketDayHigh,
      day_low: meta.regularMarketDayLow,
      week52_high: meta.fiftyTwoWeekHigh,
      week52_low: meta.fiftyTwoWeekLow,
      market_cap: null,
      market_cap_b: null,
      pe_ratio: null,
      volume: meta.regularMarketVolume,
      pre_market_price: null,
      post_market_price: null,
      source: 'yahoo_finance_v8',
    };
  } catch (e) {
    return null;
  }
}

// ── Yahoo Finance news ─────────────────────────────────────────────────────
async function fetchYahooNews(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=5&quotesCount=0&enableFuzzyQuery=false`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)', 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`news HTTP ${res.status}`);
    const data = await res.json();
    return (data?.news || []).slice(0, 4).map(n => ({
      headline: n.title,
      summary: n.summary || '',
      url: n.link ? `https://finance.yahoo.com${n.link}` : `https://finance.yahoo.com/quote/${ticker}/news/`,
      source: n.publisher || 'Yahoo Finance',
      published_at: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString() : null,
    }));
  } catch (e) { return []; }
}

// ── Finnhub news fallback ──────────────────────────────────────────────────
async function fetchFinnhubNews(ticker, key) {
  if (!key) return [];
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const res = await fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${key}`);
    if (!res.ok) throw new Error(`finnhub ${res.status}`);
    const data = await res.json();
    return (data||[]).slice(0,4).map(n => ({
      headline: n.headline, summary: n.summary||'',
      url: n.url, source: n.source||'Finnhub',
      published_at: n.datetime ? new Date(n.datetime*1000).toISOString() : null,
    }));
  } catch (e) { return []; }
}

// ── Simple keyword sentiment ───────────────────────────────────────────────
function scoreSentiment(articles) {
  const text = articles.map(a => (a.headline||'') + ' ' + (a.summary||'')).join(' ').toLowerCase();
  const bull = ['beat','record','raised','upgrade','buy','outperform','growth','strong','contract','profit','surpass','expand','win'].filter(k=>text.includes(k)).length;
  const bear = ['miss','downgrade','cut','concern','risk','loss','decline','fall','drop','sell','underperform','warn','lawsuit','probe','investigation','weak'].filter(k=>text.includes(k)).length;
  return { bull_score: bull, bear_score: bear, signal: bull>bear?'bullish':bear>bull?'bearish':'neutral' };
}

// ── Derive bull/bear text from articles ───────────────────────────────────
function bullBearText(articles, sentiment) {
  const bullTitles = articles.filter(a => /beat|growth|record|raised|upgrade|buy|strong|contract|win|expand|profit/i.test(a.headline||'')).map(a=>a.headline).slice(0,2);
  const bearTitles = articles.filter(a => /miss|downgrade|cut|risk|loss|decline|fall|sell|warn|lawsuit|probe|weak/i.test(a.headline||'')).map(a=>a.headline).slice(0,2);
  return {
    bull: bullTitles.length ? bullTitles.join('. ') : (sentiment.signal==='bullish' ? 'Positive momentum and analyst coverage.' : 'Monitoring for bullish catalysts.'),
    bear: bearTitles.length ? bearTitles.join('. ') : (sentiment.signal==='bearish' ? 'Caution warranted — check recent coverage.' : 'Key risks: valuation, macro headwinds.'),
  };
}

// ── SEC EDGAR: Company facts (revenue, net income, EPS) ───────────────────
async function fetchSecFundamentals(cik) {
  if (!cik) return null;
  try {
    const paddedCik = cik.replace(/^0+/, '').padStart(10, '0');
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'HiddenMoversDashboard contact@example.com',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) throw new Error(`SEC facts HTTP ${res.status}`);
    const data = await res.json();
    const usgaap = data.facts?.['us-gaap'] || {};
    const dei    = data.facts?.dei || {};

    // Helper: get the N most recent quarterly values for a concept
    function getQuarterly(concept, n = 8) {
      const units = usgaap[concept]?.units?.USD || dei[concept]?.units?.shares || [];
      return units
        .filter(u => u.form === '10-Q' || u.form === '10-K')
        .filter(u => u.fp && u.end)
        .sort((a, b) => new Date(b.end) - new Date(a.end))
        .slice(0, n)
        .reverse();
    }

    // Revenue
    const revConcept = usgaap['RevenueFromContractWithCustomerExcludingAssessedTax']
      ? 'RevenueFromContractWithCustomerExcludingAssessedTax'
      : usgaap['Revenues'] ? 'Revenues'
      : usgaap['SalesRevenueNet'] ? 'SalesRevenueNet' : null;
    const revenue = revConcept ? getQuarterly(revConcept) : [];

    // Net income
    const netIncome = getQuarterly('NetIncomeLoss');

    // EPS (diluted)
    const epsRaw = (usgaap['EarningsPerShareDiluted']?.units?.['USD/shares'] || [])
      .filter(u => u.form === '10-Q' || u.form === '10-K')
      .sort((a, b) => new Date(b.end) - new Date(a.end))
      .slice(0, 8)
      .reverse();

    // Recent filings (10-K and 10-Q only)
    const subUrl = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
    const subRes = await fetch(subUrl, {
      headers: { 'User-Agent': 'HiddenMoversDashboard contact@example.com' },
    });
    let recentFilings = [];
    if (subRes.ok) {
      const subData = await subRes.json();
      const filings = subData.filings?.recent || {};
      const forms   = filings.form || [];
      const dates   = filings.filingDate || [];
      const accNos  = filings.accessionNumber || [];
      const docs    = filings.primaryDocument || [];
      for (let i = 0; i < forms.length && recentFilings.length < 6; i++) {
        if (forms[i] === '10-K' || forms[i] === '10-Q' || forms[i] === '4') {
          recentFilings.push({
            form: forms[i],
            filed: dates[i],
            accession: accNos[i],
            url: `https://www.sec.gov/Archives/edgar/data/${parseInt(paddedCik, 10)}/${accNos[i].replace(/-/g,'')}/${docs[i]}`,
          });
        }
      }
    }

    return {
      revenue: revenue.map(r => ({ period: r.end, value: r.val, form: r.form })),
      net_income: netIncome.map(r => ({ period: r.end, value: r.val, form: r.form })),
      eps_diluted: epsRaw.map(r => ({ period: r.end, value: r.val, form: r.form })),
      recent_filings: recentFilings,
      source: 'SEC EDGAR (free)',
    };
  } catch (e) {
    console.error(`SEC fundamentals failed for CIK ${cik}:`, e.message);
    return null;
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const FINNHUB_KEY = process.env.FINNHUB_API_KEY || '';
  const marketStatus = getMarketStatus();
  const fetchedAt = new Date().toISOString();

  try {
    // ── STEP 1: Fetch quotes for ALL ~50 watchlist tickers ─────────────────
    // Yahoo v7 can handle up to 50 symbols in one request
    const allQuotes = await fetchYahooBulk(ALL_TICKERS);

    // Fallback: for any tickers missing market cap, fetch individually
    const missingMcap = ALL_TICKERS.filter(t => !allQuotes[t]?.market_cap);
    if (missingMcap.length > 0) {
      // Batch in chunks of 20 to avoid rate limits
      for (let i = 0; i < missingMcap.length; i += 20) {
        const chunk = missingMcap.slice(i, i+20);
        const chunkQuotes = await fetchYahooBulk(chunk);
        Object.assign(allQuotes, chunkQuotes);
        if (i + 20 < missingMcap.length) await new Promise(r => setTimeout(r, 300));
      }
    }

    // Still missing? Try v8 individual
    const stillMissing = ALL_TICKERS.filter(t => !allQuotes[t]);
    if (stillMissing.length > 0) {
      const fallbacks = await Promise.all(stillMissing.map(fetchYahooV8Single));
      stillMissing.forEach((t, i) => { if (fallbacks[i]) allQuotes[t] = fallbacks[i]; });
    }

    // ── STEP 2: Rank all tickers by live market cap → pick top N ───────────
    // Accept ?count=10 or ?count=15 (default 10)
    const requestedCount = parseInt((req.query && req.query.count) || '10', 10);
    const TOP_N = (requestedCount === 15) ? 15 : 10;

    const ranked = ALL_TICKERS
      .map(ticker => {
        const q = allQuotes[ticker];
        const mcap = (q?.market_cap_b) || (q?.market_cap ? q.market_cap / 1e9 : 0) || (COMPANY_META[ticker]?.market_cap_b_baseline || 0);
        return { ticker, market_cap_b: mcap, quote: q };
      })
      .filter(r => r.market_cap_b > 0)
      .sort((a, b) => b.market_cap_b - a.market_cap_b);

    const top10 = ranked.slice(0, TOP_N);
    const top10Tickers = top10.map(r => r.ticker);

    // Previous top N (passed as query param by client so we can diff)
    const prevParam = (req.query && req.query.prev) ? req.query.prev : '';
    const prevTop10 = prevParam.split(',').filter(Boolean);
    const entered = top10Tickers.filter(t => !prevTop10.includes(t) && prevTop10.length > 0);
    const exited  = prevTop10.filter(t => !top10Tickers.includes(t));

    // ── STEP 3: Fetch news + SEC fundamentals in parallel ──────────────────
    const [newsResults, secResults] = await Promise.all([
      Promise.all(
        top10Tickers.map(async (ticker) => {
          let articles = await fetchYahooNews(ticker);
          if (articles.length < 2 && FINNHUB_KEY) {
            const fh = await fetchFinnhubNews(ticker, FINNHUB_KEY);
            articles = [...articles, ...fh].slice(0, 4);
          }
          const sentiment = scoreSentiment(articles);
          const { bull, bear } = bullBearText(articles, sentiment);
          return [ticker, { headline: articles[0]?.headline || `${ticker} — no recent news`, summary: articles[0]?.summary || '', bull, bear, sentiment: sentiment.signal, articles }];
        })
      ),
      Promise.all(
        top10Tickers.map(ticker => {
          const cik = (COMPANY_META[ticker] && COMPANY_META[ticker].cik) || null;
          return fetchSecFundamentals(cik);
        })
      ),
    ]);
    const newsData = Object.fromEntries(newsResults);
    const secData  = {};
    top10Tickers.forEach((ticker, i) => { if (secResults[i]) secData[ticker] = secResults[i]; });

    // ── STEP 4: Build company objects for the top 10 ─────────────────────
    const top10Companies = {};
    for (const { ticker, market_cap_b, quote } of top10) {
      const meta = COMPANY_META[ticker] || {};
      top10Companies[ticker] = {
        ticker,
        name: meta.name || ticker,
        sector: meta.sector || 'Unknown',
        description: meta.description || meta.why_hidden_mover || '',
        market_cap_b: parseFloat(market_cap_b.toFixed(2)),
        unique_metrics: meta.unique_metrics || [],
        rank: top10Tickers.indexOf(ticker) + 1,
      };
    }

    // ── STEP 5: Build live_quotes for top 10 ──────────────────────────
    const liveQuotes = {};
    for (const { ticker, quote } of top10) {
      if (quote) liveQuotes[ticker] = quote;
    }

    return res.status(200).json({
      fetched_at: fetchedAt,
      market_status: marketStatus,
      // Ranking info
      top10_tickers: top10Tickers,
      ranking_changed: entered.length > 0 || exited.length > 0,
      entered,   // tickers newly in top 10
      exited,    // tickers that fell out
      full_ranking: ranked.slice(0, 20).map(r => ({ ticker: r.ticker, market_cap_b: parseFloat(r.market_cap_b.toFixed(2)), name: (COMPANY_META[r.ticker] && COMPANY_META[r.ticker].name) || r.ticker })),
      // Data for top 10
      top10_companies: top10Companies,
      live_quotes: liveQuotes,
      news_data: newsData,
      sec_fundamentals: secData,
      // Meta
      top_n: TOP_N,
      watchlist_size: ALL_TICKERS.length,
      sources_used: ['Yahoo Finance v7', 'SEC EDGAR', FINNHUB_KEY ? 'Finnhub' : null].filter(Boolean),
    });

  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({
      error: 'Failed to fetch live data',
      message: err.message,
      market_status: marketStatus,
      fetched_at: fetchedAt,
    });
  }
};
