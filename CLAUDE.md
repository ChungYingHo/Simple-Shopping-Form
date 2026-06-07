# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

One-page mango pre-order site for a small seasonal business. Static frontend (HTML/CSS/Vanilla JS, no framework, no build step) talks to a Google Apps Script Web App backed by Google Sheets. Zero-server, zero-cost.

UI copy and comments are in Traditional Chinese — keep them that way when editing.

## Architecture

Three pieces, deployed independently:

1. **Static site** — [index.html](index.html), [css/style.css](css/style.css), [js/script.js](js/script.js). Single page with three tabs (訂購 / 分送多人 / 查詢) and a confirmation modal. No bundler; just open in a browser.
2. **Google Apps Script** — [gas/Code.gs](gas/Code.gs). One file pasted into the Apps Script editor attached to the Google Sheet. Exposes `doGet` (actions: `products`, `query`) and `doPost` (action: `order`).
3. **Google Sheet** — three tabs hardcoded by name in `Code.gs`: `商品` (products), `訂單` (orders), `設定` (settings).

Data flow on order submit: client validates → opens confirm modal → POST `action=order` with items `{product, spec, qty}` only (no price; the 分送多人 flow additionally tags each item with its own `receiverName/receiverPhone/receiverAddress`) → GAS re-reads price from `商品` sheet, recomputes total, generates `MG-YYYYMMDD-NNNN` ID under `LockService`, writes one row per item (sharing orderId) into `訂單`.

The **分送多人** (split-shipment) tab is a second client flow over the *same* `order` endpoint: one buyer / one payment / one orderId, but items fan out to multiple recipients. See the multi-recipient invariant below; it required **no Google Sheet schema change** because the per-row 收件人 columns already existed.

### Cross-cutting invariants (easy to break, hard to notice)

- **Server is the source of truth for price.** Client sends `qty/product/spec` only. `data-price` attributes are display-only. Don't add `price` or `amount` to the POST payload — `createOrder` deliberately ignores them.
- **Two-box discount is server-computed and baked into the row amounts.** Grouped by **(receiver, spec)** — within a single recipient, boxes of the same spec (`5`/`10`/`20`) across different products combine; boxes going to *different* recipients never combine (separate addresses = separate freight, so no shared-box discount). Every 2 boxes of a spec **for one recipient** deducts `PAIR_DISCOUNT` (100), cumulative — `floor(specQtyForThatReceiver/2)*100`. The per-row `金額` is distributed in two steps so each row reads naturally and the rows still sum to the discounted total: (1) each item is discounted for its own pairs — `floor(qty/2)*100`; (2) leftover odd boxes of the same spec **and same recipient** are paired across products, each cross-pair deducting another 100 (booked on the higher-priced row of the pair). There is no separate discount column (don't add one; it breaks the positional invariant). The frontend mirrors the same grouping for display only (`computeDiscount` / `PAIR_DISCOUNT` in `script.js`; the 分送多人 flow calls `computeDiscount` once **per recipient**); keep the constant and the grouping in sync. A normal single-recipient 訂購 order is the degenerate case (one receiver group) — its numbers are identical to before this feature.
- **`訂單` column order is positional.** `Code.gs` reads/writes by index (0=訂單編號 … 16=訂單狀態, 17=運送編號). Reordering or inserting a column in the sheet breaks both order writes and `queryOrders` reads. The map is documented at [gas/Code.gs:155-159](gas/Code.gs#L155-L159).
- **One order = N rows.** Multi-item orders share `orderId`; each item gets its own row with its own `收件人` (姓名/電話/地址), `訂單狀態` and optional `運送編號`. A 分送多人 order writes *different* receivers on different rows of the same `orderId`. The query API regroups rows by `orderId`, attaches the (masked) receiver to **each item**, and computes an overall status (`pending` if any item differs); the frontend shows a per-item recipient breakdown when an order's rows don't all share one receiver.
- **Multi-recipient (分送多人) rides the same `order` endpoint.** The frontend flattens every recipient's items into one `items` array, each item carrying its own `receiverName/receiverPhone/receiverAddress`. `createOrder` writes those **per row**, falling back to the top-level `receiver*` when an item omits them — that fallback is exactly how the single-recipient 訂購 flow still works unchanged. A multi payload sets the top-level `receiver*` to the *first* recipient only to satisfy the required-field check. Grouping key for the discount is the receiver triple (`receiverKey`). `MAX_ITEMS` (40) caps total rows, not recipients. **No sheet schema change** — the per-row 收件人 columns (indices 5/6/7) always existed; this feature just lets them vary within one order.
- **POST uses `Content-Type: text/plain`** to dodge CORS preflight on GAS. Don't change it to `application/json` — the request will fail in browsers. See [js/script.js:594](js/script.js#L594).
- **`fetch(..., { redirect: 'follow' })` is required.** GAS Web Apps respond with a 302 to `script.googleusercontent.com`.
- **PII is masked in `queryOrders` responses** (`maskName`, `maskPhone`, `maskAddress`). Anyone with a phone number can query; never return raw PII from that endpoint.
- **Phone normalization for matching:** strip non-digits and leading zeros (`queryOrders` and the order rate-limit key). Apply the same `normalize` if you add new phone-keyed logic.
- **Rate limits use `CacheService`:** 1 order / 60s and 10 queries / 60s per normalized phone. The order token is only set *after* a successful write so failures stay retryable ([gas/Code.gs:357](gas/Code.gs#L357)).
- **Settings sheet keys are fuzzy.** `pick()` accepts multiple Chinese key names per setting (e.g. `匯款銀行` or `銀行`). When adding a setting, prefer extending `pick(...)` with synonyms rather than forcing one canonical key.
- **Order rows are written with explicit `setNumberFormat('@')`** on phone and bank-code columns so leading zeros survive. Preserve this when changing the write logic.

## Working on it

No build or lint tooling. To preview the frontend, open `index.html` directly in a browser (the live `API_URL` in `js/script.js` points at a deployed GAS, so the page works as-is).

### Tests

E2E only, via Playwright. Tests mock the GAS endpoint (`page.route('https://script.google.com/**')`) so they never touch the live sheet.

- `npm install` + `npx playwright install` (first time)
- `npm test` — headless run (chromium + mobile-chrome projects)
- `npm run test:ui` — interactive UI mode, best for debugging
- Specs live in [tests/e2e/](tests/e2e/); shared API mock in [tests/fixtures/mock-api.js](tests/fixtures/mock-api.js)

When you change `script.js` selectors / IDs / dataset attributes, the locators in the specs are the canary — run `npm test` before pushing.

### Deploying changes

- **Frontend** — push to `main`; the host (GitHub Pages / Netlify Drop per `README.md`) serves the files directly.
- **`gas/Code.gs`** — this repo is *not* connected to Apps Script. After editing, the user must paste the file into the Apps Script editor attached to the sheet and create a **new deployment** (existing deployment URLs keep serving the old code). The `API_URL` constant at [js/script.js:9](js/script.js#L9) must match the active deployment.
- When `Code.gs` and `script.js` change together (e.g. new field on the order payload), both the GAS redeploy and the frontend push are required for the change to take effect end-to-end.

## Reference docs in repo

- [README.md](README.md) — concise shop-owner view: quick GAS link, daily sheet ops.
- [TODO.md](TODO.md) — from-zero deploy checklist (sheet schema, GAS deploy, smoke tests).
