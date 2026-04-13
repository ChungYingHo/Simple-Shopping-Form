# mango-order — 芒果訂購網站

一頁式芒果線上訂購系統，使用靜態網站 + Google Sheets 作為後端，零伺服器成本。

## 功能總覽

### 訂購表單
- 商品列表從 Google Sheet 動態載入（品名、規格、價格、售罄狀態）
- 三種規格：五斤 / 十斤 / 二十斤，未填價格的規格自動隱藏
- 售罄商品灰掉並禁止選購
- 即時計算訂單總金額
- 填寫聯絡資訊（姓名、電話、地址、備註）
- 送出後資料寫入 Google Sheet，每個商品獨立一列（方便分批出貨）
- 頁尾顯示匯款帳號（先付款再出貨）

### 訂單查詢
- 輸入電話號碼查詢所有歷史訂單
- 顯示每筆訂單狀態：待付款 / 已確認 / 已出貨

## 技術選型

| 層級 | 技術 | 理由 |
|------|------|------|
| 前端 | 純 HTML + CSS + Vanilla JS | 需求單純，無需框架，載入快 |
| 後端 | Google Apps Script (Web App) | 免費、免部署伺服器 |
| 資料庫 | Google Sheets | 店家可直接用試算表管理商品與訂單 |
| 部署 | GitHub Pages 或 Netlify | 靜態網站免費託管 |
| 樣式 | 手刻 CSS（Mobile-first） | 保持輕量，訂購多用手機操作 |

## 專案結構（預計）

```
mango-order/
├── index.html          # 訂購表單 + 查詢頁（單頁 tab 切換）
├── css/
│   └── style.css       # 樣式（mobile-first）
├── js/
│   ├── app.js          # 主邏輯：載入商品、表單互動、送出訂單
│   └── query.js        # 查詢訂單邏輯
├── gas/
│   └── Code.gs         # Google Apps Script 原始碼（供複製貼上到 GAS 編輯器）
├── docs/
│   └── plan.md         # 完整開發計畫
└── README.md
```

## 快速開始（開發完成後）

1. 建立 Google Sheet，按 `docs/plan.md` 的欄位設計設定兩張工作表
2. 將 `gas/Code.gs` 貼入 Google Apps Script 編輯器，部署為 Web App
3. 把 Web App URL 填入 `js/app.js` 的設定常數
4. 將前端檔案部署到 GitHub Pages / Netlify
5. 把網址分享給客人下單

## 文件

- [完整開發計畫](docs/plan.md) — 技術規劃、API 設計、UI 結構、開發步驟

## 授權

私人專案，僅供內部使用。
