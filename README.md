# E‑commerce Insights Dashboard (GitHub Pages)

Static dashboard that reads `data/orders.csv`, `data/customers.csv`, and `data/products.csv` and renders accurate, non‑hallucinatory metrics and charts client‑side.

## Files

- `index.html` — main dashboard (loads CDN Chart.js + PapaParse)
- `assets/style.css` — dark theme styles
- `assets/app.js` — data loading, metric computations, and chart rendering
- `data/` — CSV files: `orders.csv`, `customers.csv`, `products.csv`

## Run Locally

1. Ensure CSVs exist in `data/` at repo root.
2. Open `index.html` in a browser (or run a local server like `python3 -m http.server`).

## Deploy to GitHub Pages

- Option A (root): Ensure `index.html` is at repo root. Enable Pages on `main` branch, root.
- Option B (`docs/`): Move the dashboard files into `docs/` and enable Pages from `docs` folder.

## What’s Shown

- KPIs: Total revenue, AOV, repeat rate among buyers, repeat revenue share, weekend and evening revenue shares.
- Charts: Monthly revenue, category mix (overall vs holidays vs summer), Pareto curve (buyers only), channel AOV with 95% bootstrap CI, payment share, geography revenue share.
- Promotions: BF/Cyber window vs non‑BF — revenue share, discount rate, and average discount among discounted orders only.

## Data Integrity Notes

- All metrics are computed directly from the CSVs on the client. No synthetic assumptions.
- Repeat rate uses buyers as the denominator (customers with ≥1 order).
- Pareto curve is based on buyer revenues only.
- Channel AOV difference includes a 95% bootstrap confidence interval to avoid overconfident conclusions.
- Promotions compare both discount penetration and depth among discounted orders.

