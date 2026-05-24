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
  const prodHeader = prodData[0]; // 第一列為標題
  const products = [];

  for (let i = 1; i < prodData.length; i++) {
    const row = prodData[i];
    const name = String(row[0]).trim();
    if (!name) continue;

    const soldOut = String(row[4]).trim() === '是';
    const prices = {};
    if (row[1] !== '' && row[1] !== null && row[1] !== undefined) prices['5'] = Number(row[1]);
    if (row[2] !== '' && row[2] !== null && row[2] !== undefined) prices['10'] = Number(row[2]);
    if (row[3] !== '' && row[3] !== null && row[3] !== undefined) prices['20'] = Number(row[3]);

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

  const settings = {
    bankName: settingsMap['匯款銀行'] || '',
    bankBranch: settingsMap['分行'] || '',
    accountNumber: settingsMap['帳號'] || '',
    accountHolder: settingsMap['戶名'] || '',
    announcement: settingsMap['公告訊息'] || '',
    paymentNote: settingsMap['匯款期限說明'] || '',
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
        status: String(row[16]).trim(),
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

  // 產生訂單編號
  const orderId = generateOrderId(ss);

  // 寫入
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
