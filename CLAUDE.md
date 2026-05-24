# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

One-page mango pre-order site for a small seasonal business. Static frontend (HTML/CSS/Vanilla JS, no framework, no build step) talks to a Google Apps Script Web App backed by Google Sheets. Zero-server, zero-cost.

UI copy and comments are in Traditional Chinese — keep them that way when editing.

## Architecture

Three pieces, deployed independently:

1. **Static site** — [index.html](index.html), [css/style.css](css/style.css), [js/script.js](js/script.js). Single page with two tabs (訂購 / 查詢) and a confirmation modal. No bundler; just open in a browser.
2. **Google Apps Script** — [gas/Code.gs](gas/Code.gs). One file pasted into the Apps Script editor attached to the Google Sheet. Exposes `doGet` (actions: `products`, `query`) and `doPost` (action: `order`).
3. **Google Sheet** — three tabs hardcoded by name in `Code.gs`: `商品` (products), `訂單` (orders), `設定` (settings).

Data flow on order submit: client validates → opens confirm modal → POST `action=order` with items `{product, spec, qty}` only (no price) → GAS re-reads price from `商品` sheet, recomputes total, generates `MG-YYYYMMDD-NNNN` ID under `LockService`, writes one row per item (sharing orderId) into `訂單`.

### Cross-cutting invariants (easy to break, hard to notice)

- **Server is the source of truth for price.** Client sends `qty/product/spec` only. `data-price` attributes are display-only. Don't add `price` or `amount` to the POST payload — `createOrder` deliberately ignores them.
- **`訂單` column order is positional.** `Code.gs` reads/writes by index (0=訂單編號 … 16=訂單狀態, 17=運送編號). Reordering or inserting a column in the sheet breaks both order writes and `queryOrders` reads. The map is documented at [gas/Code.gs:155-159](gas/Code.gs#L155-L159).
- **One order = N rows.** Multi-item orders share `orderId`; each item gets its own row with its own `訂單狀態` and optional `運送編號`. The query API regroups rows by `orderId` and computes an overall status (`pending` if any item differs).
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
