// ============================================================
// 芒果訂購網站 — Google Apps Script
// 部署方式：擴充功能 → Apps Script → 部署 → 網頁應用程式
//   執行身分：我自己 / 存取權限：任何人
// ============================================================

const SHEET_PRODUCTS = '商品';
const SHEET_ORDERS = '訂單';
const SHEET_SETTINGS = '設定';

// 輸入長度上限（防 abuse）
const MAX_NAME_LEN = 50;
const MAX_PHONE_LEN = 20;
const MAX_ADDRESS_LEN = 200;
const MAX_NOTE_LEN = 500;
const MAX_BANK_CODE_LEN = 10;
const MAX_ITEMS = 20;

// 兩箱折扣：同商品＋同規格，每滿 2 箱折 100（累加）。
// 折扣金額一律以後端為準，前端僅供顯示。
const PAIR_DISCOUNT = 100;

// Rate limit
const RATE_ORDER_WINDOW_SEC = 60;   // 同電話 60 秒內最多 1 單
const RATE_QUERY_WINDOW_SEC = 60;   // 同電話 60 秒內最多 10 次查詢
const RATE_QUERY_MAX = 10;

// ---------- 路由 ----------

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  let result;

  switch (action) {
    case 'products':
      result = getProducts();
      break;
    case 'query':
      result = queryOrders(e.parameter.phone || '');
      break;
    default:
      result = { success: false, error: '未知的 action' };
  }

  return jsonResponse(result);
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    return jsonResponse({ success: false, error: '無效的 JSON' });
  }

  const action = body.action || '';
  let result;

  switch (action) {
    case 'order':
      result = createOrder(body);
      break;
    default:
      result = { success: false, error: '未知的 action' };
  }

  return jsonResponse(result);
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- GET products ----------

function getProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 商品
  const prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  const prodData = prodSheet.getDataRange().getValues();
  const products = [];

  const parsePrice = v => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  for (let i = 1; i < prodData.length; i++) {
    const row = prodData[i];
    const name = String(row[0]).trim();
    if (!name) continue;

    const soldOut = String(row[4]).trim() === '是';
    const prices = {};
    const p5 = parsePrice(row[1]); if (p5 !== null) prices['5'] = p5;
    const p10 = parsePrice(row[2]); if (p10 !== null) prices['10'] = p10;
    const p20 = parsePrice(row[3]); if (p20 !== null) prices['20'] = p20;

    products.push({ name, prices, soldOut });
  }

  // 設定
  const setSheet = ss.getSheetByName(SHEET_SETTINGS);
  const setData = setSheet.getDataRange().getValues();
  const settingsMap = {};
  for (let i = 0; i < setData.length; i++) {
    const key = String(setData[i][0]).trim();
    const val = String(setData[i][1]).trim();
    if (key) settingsMap[key] = val;
  }

  const pick = (...keys) => {
    for (const k of keys) {
      if (settingsMap[k]) return settingsMap[k];
    }
    return '';
  };

  const settings = {
    bankName: pick('匯款銀行', '銀行'),
    bankBranch: pick('分行', '匯款分行'),
    accountNumber: pick('匯款帳號', '帳號'),
    accountHolder: pick('匯款戶名', '戶名'),
    announcement: pick('公告訊息', '公告'),
    paymentNote: pick('匯款期限說明', '付款備註', '付款說明'),
    // 選填：在 header 顯示稀缺/採收期 chip（無設定即不顯示）
    scarcity: pick('稀缺資訊', '採收期', '限量資訊'),
  };

  return { success: true, data: { products, settings } };
}

// ---------- GET query ----------

function queryOrders(phone) {
  const normalize = s => String(s == null ? '' : s).replace(/\D/g, '').replace(/^0+/, '');
  const queryPhone = normalize(phone);
  if (!queryPhone) {
    return { success: false, error: '請輸入電話號碼' };
  }

  // Rate limit（同電話 60 秒內最多 N 次）
  const cache = CacheService.getScriptCache();
  const rateKey = 'rate_query_' + queryPhone;
  const count = parseInt(cache.get(rateKey) || '0', 10);
  if (count >= RATE_QUERY_MAX) {
    return { success: false, error: '查詢過於頻繁，請稍後再試' };
  }
  cache.put(rateKey, String(count + 1), RATE_QUERY_WINDOW_SEC);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();

  // 欄位索引 (0-based)：
  // 0:訂單編號 1:訂購時間 2:訂購人姓名 3:訂購人電話 4:訂購人地址
  // 5:收件人姓名 6:收件人電話 7:收件地址 8:送貨時段 9:付款方式
  // 10:匯款後五碼 11:備註 12:商品 13:規格 14:數量 15:金額 16:訂單狀態
  // 17:運送編號

  const ordersMap = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (normalize(row[3]) !== queryPhone) continue;

    const orderId = String(row[0]).trim();
    if (!ordersMap[orderId]) {
      ordersMap[orderId] = {
        orderId: orderId,
        time: formatDate(row[1]),
        buyerName: maskName(String(row[2]).trim()),
        buyerPhone: maskPhone(String(row[3]).trim()),
        buyerAddress: maskAddress(String(row[4]).trim()),
        receiverName: maskName(String(row[5]).trim()),
        receiverPhone: maskPhone(String(row[6]).trim()),
        receiverAddress: maskAddress(String(row[7]).trim()),
        paymentMethod: String(row[9]).trim(),
        deliveryTime: String(row[8]).trim(),
        items: [],
        total: 0,
      };
    }

    const amount = Number(row[15]) || 0;
    ordersMap[orderId].items.push({
      product: String(row[12]).trim(),
      spec: String(row[13]).trim(),
      qty: Number(row[14]) || 0,
      amount: amount,
      status: String(row[16]).trim(),
      shippingNumber: String(row[17] == null ? '' : row[17]).trim(),
    });
    ordersMap[orderId].total += amount;
  }

  const orders = Object.values(ordersMap).sort((a, b) => {
    return b.orderId.localeCompare(a.orderId);
  });

  // 查無資料屬正常結果，不算錯誤
  return { success: true, data: orders };
}

// ---------- POST order ----------

function createOrder(body) {
  // 驗證必填
  const required = ['buyerName', 'buyerPhone', 'buyerAddress', 'receiverName', 'receiverPhone', 'receiverAddress'];
  for (const field of required) {
    if (!body[field] || !String(body[field]).trim()) {
      return { success: false, error: '必填欄位不完整：' + field };
    }
  }

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return { success: false, error: '請至少選擇一項商品' };
  }
  if (body.items.length > MAX_ITEMS) {
    return { success: false, error: '單筆訂單品項過多' };
  }

  // 匯款後五碼驗證（目前僅支援匯款）
  const bankCodeRaw = String(body.bankCode || '').trim().substring(0, MAX_BANK_CODE_LEN);
  if (!/^\d{5}$/.test(bankCodeRaw)) {
    return { success: false, error: '匯款後五碼需為 5 位數字' };
  }

  // Rate limit：同電話 60 秒最多 1 單
  const rawPhone = String(body.buyerPhone).trim();
  const phoneKey = rawPhone.replace(/\D/g, '');
  const cache = CacheService.getScriptCache();
  const rateKey = 'rate_order_' + phoneKey;
  if (cache.get(rateKey)) {
    return { success: false, error: '訂單建立過於頻繁，請稍候 60 秒再試' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 讀商品價格（金額一律以後端為準，前端 data-price 僅供顯示，不可信任）
  const prodSheet = ss.getSheetByName(SHEET_PRODUCTS);
  const prodData = prodSheet.getDataRange().getValues();
  const priceMap = {}; // { "愛文芒果": { "5": 450, "10": 850, "20": 1600 } }

  for (let i = 1; i < prodData.length; i++) {
    const name = String(prodData[i][0]).trim();
    if (!name) continue;
    const soldOut = String(prodData[i][4]).trim() === '是';
    if (soldOut) continue; // 售罄不可訂

    const p = {};
    if (prodData[i][1] !== '' && prodData[i][1] !== null) p['5'] = Number(prodData[i][1]);
    if (prodData[i][2] !== '' && prodData[i][2] !== null) p['10'] = Number(prodData[i][2]);
    if (prodData[i][3] !== '' && prodData[i][3] !== null) p['20'] = Number(prodData[i][3]);
    priceMap[name] = p;
  }

  // 驗證 items 並計算金額
  const specNameMap = { '5': '五斤', '10': '十斤', '20': '二十斤' };
  let totalAmount = 0;
  const validatedItems = [];

  for (const item of body.items) {
    const product = String(item.product || '').trim().substring(0, MAX_NAME_LEN);
    const spec = String(item.spec || '').trim();
    const qty = parseInt(item.qty, 10);

    if (!priceMap[product]) {
      return { success: false, error: '商品不存在或已售罄：' + product };
    }
    if (!priceMap[product][spec]) {
      return { success: false, error: product + ' 無此規格：' + spec };
    }
    if (!qty || qty < 1 || qty > 99) {
      return { success: false, error: '數量不正確：' + product };
    }

    const unitPrice = priceMap[product][spec];
    // 同商品同規格每滿 2 箱折 PAIR_DISCOUNT（累加），折扣後寫入該列金額。
    const discount = Math.floor(qty / 2) * PAIR_DISCOUNT;
    const amount = unitPrice * qty - discount;
    totalAmount += amount;

    validatedItems.push({
      product,
      spec: specNameMap[spec] || spec,
      qty,
      amount,
    });
  }

  // ----- 上鎖避免並發訂單號碰撞 / 列交錯 -----
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    return { success: false, error: '系統忙碌中，請稍後再試' };
  }

  let orderId;
  try {
    orderId = generateOrderId(ss);

    const orderSheet = ss.getSheetByName(SHEET_ORDERS);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

    // 截斷各欄位至上限
    const buyerName = String(body.buyerName).trim().substring(0, MAX_NAME_LEN);
    const buyerPhone = String(body.buyerPhone).trim().substring(0, MAX_PHONE_LEN);
    const buyerAddress = String(body.buyerAddress).trim().substring(0, MAX_ADDRESS_LEN);
    const receiverName = String(body.receiverName).trim().substring(0, MAX_NAME_LEN);
    const receiverPhone = String(body.receiverPhone).trim().substring(0, MAX_PHONE_LEN);
    const receiverAddress = String(body.receiverAddress).trim().substring(0, MAX_ADDRESS_LEN);
    const deliveryTime = String(body.deliveryTime || '不指定').trim().substring(0, 10);
    const note = String(body.note || '').trim().substring(0, MAX_NOTE_LEN);
    const paymentMethod = '匯款';

    const firstNewRow = orderSheet.getLastRow() + 1;

    // 一次寫入所有列（每筆品項一列）
    const rows = validatedItems.map(item => ([
      orderId,
      timeStr,
      buyerName,
      buyerPhone,
      buyerAddress,
      receiverName,
      receiverPhone,
      receiverAddress,
      deliveryTime,
      paymentMethod,
      bankCodeRaw,
      note,
      item.product,
      item.spec,
      item.qty,
      item.amount,
      '訂單確認中',
    ]));

    orderSheet.getRange(firstNewRow, 1, rows.length, 17).setValues(rows);

    // 強制電話/匯款末五碼為純文字格式，避免開頭 0 被 Sheets 吃掉
    // （D=4 訂購人電話, G=7 收件人電話, K=11 匯款後五碼）
    orderSheet.getRange(firstNewRow, 4, rows.length, 1).setNumberFormat('@');
    orderSheet.getRange(firstNewRow, 7, rows.length, 1).setNumberFormat('@');
    orderSheet.getRange(firstNewRow, 11, rows.length, 1).setNumberFormat('@');

    // 交替底色（同 orderId 永遠同色）
    // 只塗 A~P 欄 + R 欄，避開 Q 欄（訂單狀態下拉色標）
    const seqMatch = orderId.match(/-(\d+)$/);
    const seq = seqMatch ? parseInt(seqMatch[1], 10) : 0;
    const bgColor = seq % 2 === 1 ? '#FFF8DC' : '#E8F5E9';
    orderSheet.getRange(firstNewRow, 1, rows.length, 16).setBackground(bgColor);
    orderSheet.getRange(firstNewRow, 18, rows.length, 1).setBackground(bgColor);

    // 訂單成功後才設 rate limit token（失敗讓使用者可重試）
    cache.put(rateKey, '1', RATE_ORDER_WINDOW_SEC);
  } finally {
    lock.releaseLock();
  }

  return { success: true, orderId: orderId, total: totalAmount };
}

// ---------- 工具函式 ----------

function generateOrderId(ss) {
  const now = new Date();
  const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  const prefix = 'MG-' + dateStr + '-';

  const sheet = ss.getSheetByName(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  let maxSeq = 0;

  if (lastRow >= 2) {
    // 只讀 A 欄（訂單編號），不需讀整張表
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const id = String(ids[i][0]);
      if (id.startsWith(prefix)) {
        const seq = parseInt(id.substring(prefix.length), 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(4, '0');
  return prefix + nextSeq;
}

function formatDate(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');
  }
  return String(val);
}

// ---------- PII 遮罩 ----------

// 王小明 → 王*明 ／ 王明 → 王* ／ 王 → 王
function maskName(name) {
  if (!name) return '';
  const chars = Array.from(name); // 正確處理多 byte 字元
  if (chars.length <= 1) return name;
  if (chars.length === 2) return chars[0] + '*';
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
}

// 0912345678 → 0912***678
function maskPhone(phone) {
  if (!phone) return '';
  if (phone.length <= 6) return phone;
  return phone.substring(0, 4) + '***' + phone.substring(phone.length - 3);
}

// 台北市大安區忠孝東路100號 → 台北市大安區****
// 屏東縣三地門鄉中正路1號 → 屏東縣三地門鄉****（避免 4 字鄉/區被切字）
// 規則：保留到「縣市 + 區/鄉/鎮/市」為止，街道號碼遮罩
function maskAddress(addr) {
  if (!addr) return '';
  // 匹配「X縣/X市」+「Y區/Y鄉/Y鎮/Y市」
  const m = addr.match(/^(.+?[市縣].+?[區鄉鎮市])/);
  if (m) return m[1] + '****';
  // 找不到行政區結構（罕見：跨國地址 / 自由輸入）→ fallback 前 6 字
  const chars = Array.from(addr);
  if (chars.length <= 6) return addr;
  return chars.slice(0, 6).join('') + '****';
}
