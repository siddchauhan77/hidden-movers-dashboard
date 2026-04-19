# Hidden Movers Dashboard

> Financial intelligence platform tracking high-growth equities below mainstream radar — live market data, SEC fundamentals, sparkline charts, quarterly trends, and bull/bear case summaries in one dark-mode interface.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=flat&logo=vercel&logoColor=white)

**[Live Dashboard →](https://hidden-movers-dashboard.vercel.app)**

---

## What It Tracks

A curated watchlist of high-growth companies that don't show up in mainstream screeners — the kind that show up in SEC filings before they show up on CNBC.

**Per company:**
| Section | What it shows |
|---------|--------------|
| Price + Sparkline | Live price with mini trend chart |
| Revenue & FCF | Quarterly revenue and free cash flow trends |
| Margin Trends | Gross/operating margin trajectory |
| Operational KPIs | Company-specific metrics (DAU/MAU, backlog, customer counts) |
| Bull/Bear Summary | Linked analyst arguments for and against |
| Ranking History | Historical rank changes with localStorage persistence |
| Compare | Cross-company chart overlay |
| News | Latest headlines per ticker |

---

## Features

- **Dark/light theme toggle** with CSS custom properties
- **Pre-market / after-hours banner** — detects market session and displays status
- **Company navigation pills** — jump between watchlist companies
- **Cross-company comparison charts** — overlay any two companies on the same axis
- **Ranking history log** — persisted in localStorage, tracks how rankings shift over time
- **Data pipeline**: `data.json` (static fundamentals) + `live_data.json` (price/market data) + `watchlist.json` (company config)

---

## Stack

- **Pure HTML/CSS/JavaScript** — zero build step, zero dependencies
- Fluid typography with `clamp()` for all screen sizes
- CSS custom properties for full theme system
- Deployed as static site on Vercel

→ See full build decisions and data sourcing in [`CASE_STUDY.md`](./CASE_STUDY.md)
