// ============================================================
// 芒果訂購網站 — Google Apps Script
// 部署方式：擴充功能 → Apps Script → 部署 → 網頁應用程式
//   執行身分：我自己 / 存取權限：任何人
// ============================================================

const SHEET_PRODUCTS = '商品';
const SHEET_ORDERS = '訂單';
const SHEET_SETTINGS = '設定';

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

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
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
        buyerName: String(row[2]).trim(),
        buyerPhone: String(row[3]).trim(),
        buyerAddress: String(row[4]).trim(),
        receiverName: String(row[5]).trim(),
        receiverPhone: String(row[6]).trim(),
        receiverAddress: String(row[7]).trim(),
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

  if (orders.length === 0) {
    return { success: false, error: '查無此電話的訂單紀錄' };
  }

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

  const paymentMethod = String(body.paymentMethod || '').trim();
  if (paymentMethod !== '匯款' && paymentMethod !== '現金付款') {
    return { success: false, error: '請選擇付款方式' };
  }

  if (paymentMethod === '匯款') {
    const bankCode = String(body.bankCode || '').trim();
    if (!bankCode) {
      return { success: false, error: '匯款付款請填寫匯款後五碼' };
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 讀商品價格
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
    const product = String(item.product || '').trim();
    const spec = String(item.spec || '').trim();
    const qty = parseInt(item.qty, 10);

    if (!priceMap[product]) {
      return { success: false, error: '商品不存在或已售罄：' + product };
    }
    if (!priceMap[product][spec]) {
      return { success: false, error: product + ' 無此規格：' + spec };
    }
    if (!qty || qty < 1) {
      return { success: false, error: '數量不正確：' + product };
    }

    const unitPrice = priceMap[product][spec];
    const amount = unitPrice * qty;
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
    lock.waitLock(10000); // 最多等 10 秒
  } catch (_) {
    return { success: false, error: '系統忙碌中，請稍後再試' };
  }

  let orderId;
  try {
    orderId = generateOrderId(ss);

    const orderSheet = ss.getSheetByName(SHEET_ORDERS);
    const now = new Date();
    const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm');

    const buyerName = String(body.buyerName).trim();
    const buyerPhone = String(body.buyerPhone).trim();
    const buyerAddress = String(body.buyerAddress).trim();
    const receiverName = String(body.receiverName).trim();
    const receiverPhone = String(body.receiverPhone).trim();
    const receiverAddress = String(body.receiverAddress).trim();
    const deliveryTime = String(body.deliveryTime || '不指定').trim();
    const bankCode = paymentMethod === '匯款' ? String(body.bankCode || '').trim() : '';
    const note = String(body.note || '').trim();

    const firstNewRow = orderSheet.getLastRow() + 1;

    for (const item of validatedItems) {
      orderSheet.appendRow([
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
        bankCode,
        note,
        item.product,
        item.spec,
        item.qty,
        item.amount,
        '訂單確認中',
      ]);

      // 強制電話/匯款末五碼為純文字，避免開頭 0 被 Sheets 吃掉
      const lastRow = orderSheet.getLastRow();
      orderSheet.getRange(lastRow, 4).setNumberFormat('@').setValue(buyerPhone);    // D 欄：訂購人電話
      orderSheet.getRange(lastRow, 7).setNumberFormat('@').setValue(receiverPhone); // G 欄：收件人電話
      if (bankCode) {
        orderSheet.getRange(lastRow, 11).setNumberFormat('@').setValue(bankCode);   // K 欄：匯款後五碼
      }
    }

    // 交替底色，方便視覺區分不同訂單（同 orderId 永遠同色）
    // 用訂單編號尾碼奇偶決定：粉黃 / 粉綠
    // 只塗 A~P 欄（cols 1-16），避開 Q 欄（訂單狀態下拉色標）；R 欄（運送編號）也一起塗
    const seqMatch = orderId.match(/-(\d+)$/);
    const seq = seqMatch ? parseInt(seqMatch[1], 10) : 0;
    const bgColor = seq % 2 === 1 ? '#FFF8DC' : '#E8F5E9'; // 粉黃 / 粉綠
    orderSheet.getRange(firstNewRow, 1, validatedItems.length, 16).setBackground(bgColor);
    orderSheet.getRange(firstNewRow, 18, validatedItems.length, 1).setBackground(bgColor);
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
  const data = sheet.getDataRange().getValues();
  let maxSeq = 0;

  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0]);
    if (id.startsWith(prefix)) {
      const seq = parseInt(id.substring(prefix.length), 10);
      if (seq > maxSeq) maxSeq = seq;
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
