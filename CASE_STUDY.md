# Case Study — Hidden Movers Dashboard

> Financial intelligence platform for high-growth equities below mainstream radar.

---

## Problem

Most financial dashboards surface the same 30 large-cap stocks everyone already knows. The interesting investment ideas — companies growing 40%+ YoY with expanding margins, not yet in every ETF — require digging through SEC filings, earnings calls, and niche analyst write-ups. That research lives in scattered tabs, not a unified view.

The problem: build a dashboard that centralizes intelligence on a curated watchlist of non-obvious high-growth companies, with the operational KPIs and forward-looking indicators that matter — not just price.

---

## Approach

Rather than building a generic stock screener, built a **curated intelligence platform** around a specific watchlist. The key distinction: the companies are handpicked (not algorithmically filtered), and each gets bespoke operational KPIs that reflect how that specific business actually operates.

**Data architecture:**
- `data.json` — static fundamentals (revenue history, margins, FCF, company profile, bull/bear thesis)
- `live_data.json` — price and market data (updated on deploy or via scheduled refresh)
- `watchlist.json` — company configuration: which KPIs to show, which comparisons to enable

This separation keeps the static analytical content (the research) separate from the dynamic market data (the prices), so the dashboard works even when a live data refresh fails.

---

## Key Features & Design Decisions

**Operational KPIs over generic metrics** — Standard dashboards show EPS, P/E, and revenue. Hidden Movers shows DAU/MAU for consumer tech companies, backlog for defense/infrastructure plays, customer count trajectories for SaaS. The KPIs are configured per company in `watchlist.json` because what matters for a $2B SaaS company is different from what matters for a $5B industrial.

**Bull/bear summary with linked articles** — Every company has a 2–3 bullet bull case and bear case, each linked to a primary source (earnings call transcript, analyst note, SEC filing). This forces the research to be grounded and auditable, not just opinion.

**Ranking history with localStorage** — As the watchlist evolves and companies move up or down in conviction, the history log persists in `localStorage`. No backend needed. This lets you track how your thesis evolves over time without a database.

**Pre/after-hours detection** — The market session banner detects whether markets are open, in pre-market, or after-hours, and adjusts displayed prices accordingly. A small UX detail that matters when you're looking at the dashboard at 7am.

**Dark mode by default** — Financial dashboards are often open for extended periods. Dark mode reduces eye strain during long research sessions. Light mode available via toggle.

**Zero dependencies** — No React, no charting library (charts are canvas-based), no build step. The dashboard loads instantly. For a tool that gets opened repeatedly throughout a trading day, load time matters.

---

## Takeaways

- Demonstrates financial analytics product thinking: not just data visualization, but curation and information architecture
- Shows ability to work with market data APIs and SEC fundamentals
- Relevant to roles in: business intelligence, financial analytics, data-driven product, investment research tools
- The "curated over comprehensive" approach is a product decision that reflects understanding of the audience — serious investors who already know the S&P 500 and want differentiated intelligence
