# 何爸爸芒果訂購

一頁式線上訂購站，後端用 Google Sheets（零成本）。

## 🚀 快速連結

| | |
|---|---|
| **編輯 GAS 程式碼** | <https://script.google.com/u/0/home/projects/1q1yxIt-0grDK8bGmhPlSMzGlWIfMUcsTKFKRrJOrIDtH86JZuy7gq4HO> |
| **線上網站** | （部署後填入 GitHub Pages / Netlify URL）|
| **首次部署步驟** | [TODO.md](TODO.md) |
| **開發者文件** | [CLAUDE.md](CLAUDE.md) |

---

## 改 GAS 程式碼後要怎麼上線

1. 改本機 [gas/Code.gs](gas/Code.gs) 後 push（保留版本記錄）
2. 點上方「編輯 GAS 程式碼」連結進編輯器
3. 把 `Code.gs` 內容**全選貼上覆蓋**
4. 右上角 **部署 → 管理部署 → 鉛筆編輯 → 版本選「新增版本」→ 部署**

> ⚠️ **不按「新增版本」舊版會繼續服務**，前端會看到舊行為。URL 不會變，不用改前端。

---

## 日常操作（全部在 Google Sheet 上做）

| 想做的事 | 在哪裡改 |
|---|---|
| 改商品價格 | 「商品」工作表 → 改數字即可 |
| 新增商品 | 「商品」工作表新增一列 |
| 標記售罄 | 「商品」E 欄改 `是` / `否` |
| 改匯款資訊 | 「設定」工作表 B 欄 |
| 改公告 | 「設定」工作表「公告訊息」那列 B 欄 |
| 更新訂單狀態 | 「訂單」Q 欄改 `訂單已確認` / `物流運送中` / `訂單已完成` 等 |
| 填運送編號 | 「訂單」R 欄填單號，狀態設為 `物流運送中`，客人查詢就會看到 |

> 同一筆訂單有多列（多項商品）時，**每列狀態都要分別更新**。

---

## 技術棧

- **前端**：純 HTML + CSS + Vanilla JS，無 build step
- **後端**：Google Apps Script（Web App）
- **資料庫**：Google Sheets
- **託管**：GitHub Pages / Netlify
- **E2E 測試**：Playwright（chromium + mobile Pixel 7）

詳細架構與不變式請見 [CLAUDE.md](CLAUDE.md)。

---

## 跑測試

```bash
npm install                # 第一次裝 Playwright 與 http-server
npx playwright install     # 第一次裝瀏覽器（~110MB）
npm test                   # 跑所有 E2E
npm run test:ui            # 互動式 UI 模式（推薦除錯時用）
npm run test:headed        # 顯示瀏覽器執行過程
```

測試會 mock GAS API（**不會打到正式 sheet**），含 15 個測試案例覆蓋：商品載入、訂單流程、確認 modal、查詢、localStorage 帶入等。詳見 [tests/e2e/](tests/e2e/)。
