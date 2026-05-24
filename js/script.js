// ============================================================
// 芒果訂購網站 — 前端邏輯
// ============================================================

// ⚠️ 部署時請將此 URL 換成你的 Google Apps Script Web App URL
const API_URL = 'https://script.google.com/macros/s/AKfycbwb7Ok_BZW1eLwpYOEbl4nME9o0F9NZvOSdn-tedjJhrKWpozybBwS0XQj17PCyMcniUg/exec';

// fetch timeout（GAS 偶爾會 hang）
const FETCH_TIMEOUT_MS = 20000;

// 全域狀態
let productsData = [];
let settingsData = {};

// 帶 timeout 的 fetch
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 初始化 ----------

document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  setupSameAsBuyer();
  restoreBuyerInfo();
});

// ---------- Tab 切換 ----------

function switchTab(tab) {
  const orderSection = document.getElementById('section-order');
  const querySection = document.getElementById('section-query');
  const successSection = document.getElementById('section-success');
  const tabOrder = document.getElementById('tab-order');
  const tabQuery = document.getElementById('tab-query');
  const floatingBar = document.getElementById('floating-bar');

  successSection.classList.add('hidden');

  if (tab === 'order') {
    orderSection.classList.remove('hidden');
    querySection.classList.add('hidden');
    tabOrder.classList.add('active');
    tabQuery.classList.remove('active');
    tabOrder.setAttribute('aria-selected', 'true');
    tabQuery.setAttribute('aria-selected', 'false');
    // 重新評估浮動 bar（含 aria-hidden）
    updateSummary();
  } else {
    orderSection.classList.add('hidden');
    querySection.classList.remove('hidden');
    tabQuery.classList.add('active');
    tabOrder.classList.remove('active');
    tabQuery.setAttribute('aria-selected', 'true');
    tabOrder.setAttribute('aria-selected', 'false');
    hideFloatingBar();
  }
}

function showFloatingBar() {
  const bar = document.getElementById('floating-bar');
  if (!bar) return;
  bar.classList.add('show');
  bar.setAttribute('aria-hidden', 'false');
}

function hideFloatingBar() {
  const bar = document.getElementById('floating-bar');
  if (!bar) return;
  bar.classList.remove('show');
  bar.setAttribute('aria-hidden', 'true');
}

// ---------- 載入商品 ----------

async function loadProducts() {
  const errorEl = document.getElementById('products-error');

  try {
    const res = await fetchWithTimeout(API_URL + '?action=products', { redirect: 'follow' });
    const json = await res.json();

    if (!json.success) throw new Error(json.error || '載入失敗');

    productsData = json.data.products;
    settingsData = json.data.settings;

    renderProducts();
    renderSettings();
  } catch (err) {
    console.error('載入商品失敗:', err);
    errorEl.classList.remove('hidden');
  } finally {
    hidePageLoader();
  }
}

function hidePageLoader() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.classList.add('fade-out');
  loader.setAttribute('aria-busy', 'false');
  // 動畫結束後從文件流移除，避免 transparent 但仍佔位
  setTimeout(() => loader.remove(), 350);
}

function renderProducts() {
  const container = document.getElementById('products-container');
  container.innerHTML = '';

  productsData.forEach((product, idx) => {
    const card = document.createElement('div');
    card.className = 'product-card' + (product.soldOut ? ' sold-out' : '');

    const title = document.createElement('h3');
    title.className = 'product-title';
    title.textContent = product.name;
    if (product.soldOut) {
      const badge = document.createElement('span');
      badge.className = 'sold-badge';
      badge.textContent = '已售罄';
      title.appendChild(badge);
    }
    card.appendChild(title);

    if (product.soldOut) {
      const msg = document.createElement('p');
      msg.className = 'product-hint';
      msg.textContent = '此商品目前無法訂購';
      card.appendChild(msg);
    } else {
      const hint = document.createElement('p');
      hint.className = 'product-hint';
      hint.textContent = '單價為一箱（含運費）';
      card.appendChild(hint);

      const specs = [
        { key: '5', label: '五斤' },
        { key: '10', label: '十斤' },
        { key: '20', label: '二十斤' },
      ];

      specs.forEach(spec => {
        const price = product.prices[spec.key];
        if (price === undefined || price === null) return;

        const specId = 'spec-' + idx + '-' + spec.key;

        const row = document.createElement('div');
        row.className = 'spec-row';

        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = specId;
        checkbox.className = 'spec-check';
        checkbox.dataset.product = product.name;
        checkbox.dataset.spec = spec.key;
        checkbox.dataset.price = String(price);
        checkbox.addEventListener('change', () => onSpecChange(checkbox));
        label.appendChild(checkbox);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'spec-name';
        nameSpan.textContent = spec.label;
        label.appendChild(nameSpan);

        const priceSpan = document.createElement('span');
        priceSpan.className = 'spec-price';
        priceSpan.textContent = '$' + price.toLocaleString();
        label.appendChild(priceSpan);

        row.appendChild(label);

        const qtyWrap = document.createElement('div');
        qtyWrap.className = 'qty-control';
        qtyWrap.id = 'qty-' + specId;

        const minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'qty-btn';
        minusBtn.textContent = '−';
        minusBtn.setAttribute('aria-label', '減少數量');
        minusBtn.addEventListener('click', () => changeQty(specId, -1));
        qtyWrap.appendChild(minusBtn);

        const qtyInput = document.createElement('input');
        qtyInput.type = 'number';
        qtyInput.id = 'qtyval-' + specId;
        qtyInput.className = 'qty-input';
        qtyInput.value = '1';
        qtyInput.min = '1';
        qtyInput.max = '99';
        qtyInput.inputMode = 'numeric';
        qtyInput.dataset.product = product.name;
        qtyInput.dataset.spec = spec.key;
        qtyInput.dataset.price = String(price);
        qtyInput.addEventListener('change', () => onQtyChange(qtyInput));
        qtyWrap.appendChild(qtyInput);

        const plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'qty-btn';
        plusBtn.textContent = '+';
        plusBtn.setAttribute('aria-label', '增加數量');
        plusBtn.addEventListener('click', () => changeQty(specId, 1));
        qtyWrap.appendChild(plusBtn);

        row.appendChild(qtyWrap);
        card.appendChild(row);
      });
    }

    container.appendChild(card);
  });
}

function renderSettings() {
  // 公告
  const annEl = document.getElementById('announcement');
  if (settingsData.announcement) {
    annEl.textContent = settingsData.announcement;
    annEl.classList.remove('hidden');
  }

  // 匯款資訊
  setText('bank-name-display', settingsData.bankName || '-');
  setText('bank-branch-display', settingsData.bankBranch || '');
  setText('bank-account-display', settingsData.accountNumber || '-');
  setText('bank-holder-display', settingsData.accountHolder || '-');

  const noteEl = document.getElementById('payment-note-display');
  if (noteEl) {
    if (settingsData.paymentNote) {
      noteEl.textContent = settingsData.paymentNote;
      noteEl.classList.remove('hidden');
    } else {
      noteEl.classList.add('hidden');
    }
  }
}

// ---------- 規格勾選 / 數量 ----------

function onSpecChange(checkbox) {
  const qtyControl = document.getElementById('qty-' + checkbox.id);
  if (checkbox.checked) {
    qtyControl.classList.add('visible');
  } else {
    qtyControl.classList.remove('visible');
    document.getElementById('qtyval-' + checkbox.id).value = 1;
  }
  updateSummary();
}

function changeQty(specId, delta) {
  const input = document.getElementById('qtyval-' + specId);
  let val = parseInt(input.value, 10) || 1;
  val = Math.max(1, Math.min(99, val + delta));
  input.value = val;
  updateSummary();
}

function onQtyChange(input) {
  let val = parseInt(input.value, 10);
  if (!val || val < 1) val = 1;
  if (val > 99) val = 99;
  input.value = val;
  updateSummary();
}

function getSelectedItems() {
  const items = [];
  const checkboxes = document.querySelectorAll('.spec-row input[type="checkbox"]:checked');
  checkboxes.forEach(cb => {
    const qtyInput = document.getElementById('qtyval-' + cb.id);
    const qty = parseInt(qtyInput.value, 10) || 1;
    const price = parseInt(cb.dataset.price, 10);
    items.push({
      product: cb.dataset.product,
      spec: cb.dataset.spec,
      qty: qty,
      price: price,
      amount: price * qty,
    });
  });
  return items;
}

function updateSummary() {
  const items = getSelectedItems();
  const summaryEl = document.getElementById('order-summary');
  const itemsEl = document.getElementById('summary-items');
  const totalEl = document.getElementById('summary-total');
  const floatingTotal = document.getElementById('floating-total');

  if (items.length === 0) {
    summaryEl.classList.add('hidden');
    hideFloatingBar();
    return;
  }

  summaryEl.classList.remove('hidden');
  itemsEl.innerHTML = '';

  const specLabels = { '5': '五斤', '10': '十斤', '20': '二十斤' };
  let total = 0;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'summary-line';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.product + ' ' + (specLabels[item.spec] || item.spec) + ' ×' + item.qty + ' (箱)';
    const amountSpan = document.createElement('span');
    amountSpan.className = 'summary-line-amount';
    amountSpan.textContent = '$' + item.amount.toLocaleString();
    row.appendChild(labelSpan);
    row.appendChild(amountSpan);
    itemsEl.appendChild(row);
    total += item.amount;
  });

  const totalStr = '$' + total.toLocaleString();
  totalEl.textContent = totalStr;
  if (floatingTotal) floatingTotal.textContent = totalStr;
  showFloatingBar();
}

// ---------- 收件人「同訂購人」----------

function setupSameAsBuyer() {
  const checkbox = document.getElementById('same-as-buyer');
  const fields = document.getElementById('receiver-fields');

  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      fields.classList.add('hidden');
    } else {
      fields.classList.remove('hidden');
    }
  });
}

// ---------- localStorage 暫存訂購人資訊 ----------

function saveBuyerInfo() {
  const data = {
    name: document.getElementById('buyer-name').value,
    phone: document.getElementById('buyer-phone').value,
    address: document.getElementById('buyer-address').value,
  };
  try {
    localStorage.setItem('mango_buyer', JSON.stringify(data));
  } catch (_) {}
}

function restoreBuyerInfo() {
  try {
    const data = JSON.parse(localStorage.getItem('mango_buyer'));
    if (data) {
      if (data.name) document.getElementById('buyer-name').value = data.name;
      if (data.phone) document.getElementById('buyer-phone').value = data.phone;
      if (data.address) document.getElementById('buyer-address').value = data.address;
    }
  } catch (_) {}
}

// ---------- 送出訂單 ----------

async function submitOrder() {
  const errorEl = document.getElementById('order-error');
  errorEl.classList.add('hidden');

  // 收集資料
  const buyerName = document.getElementById('buyer-name').value.trim();
  const buyerPhone = document.getElementById('buyer-phone').value.trim();
  const buyerAddress = document.getElementById('buyer-address').value.trim();

  const sameAsBuyer = document.getElementById('same-as-buyer').checked;
  const receiverName = sameAsBuyer ? buyerName : document.getElementById('receiver-name').value.trim();
  const receiverPhone = sameAsBuyer ? buyerPhone : document.getElementById('receiver-phone').value.trim();
  const receiverAddress = sameAsBuyer ? buyerAddress : document.getElementById('receiver-address').value.trim();

  const deliveryTime = document.querySelector('input[name="delivery-time"]:checked').value;
  const paymentMethod = '匯款'; // 目前僅支援匯款
  const bankCode = document.getElementById('bank-code').value.trim();
  const note = document.getElementById('order-note').value.trim();

  const items = getSelectedItems();

  // 驗證
  const errors = [];
  if (!buyerName) errors.push('請填寫訂購人姓名');
  if (!buyerPhone) errors.push('請填寫訂購人電話');
  if (!buyerAddress) errors.push('請填寫訂購人地址');
  if (!sameAsBuyer) {
    if (!receiverName) errors.push('請填寫收件人姓名');
    if (!receiverPhone) errors.push('請填寫收件人電話');
    if (!receiverAddress) errors.push('請填寫收件地址');
  }
  if (items.length === 0) errors.push('請至少選擇一項商品');
  if (paymentMethod === '匯款' && !bankCode) errors.push('請填寫匯款後五碼');
  if (paymentMethod === '匯款' && bankCode && !/^\d{5}$/.test(bankCode)) errors.push('匯款後五碼需為 5 位數字');

  if (errors.length > 0) {
    errorEl.textContent = errors.join('、');
    errorEl.classList.remove('hidden');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // 送出
  const btn = document.getElementById('submit-btn');
  btn.classList.add('btn-loading');
  btn.disabled = true;

  const payload = {
    action: 'order',
    buyerName,
    buyerPhone,
    buyerAddress,
    receiverName,
    receiverPhone,
    receiverAddress,
    deliveryTime,
    paymentMethod,
    bankCode: paymentMethod === '匯款' ? bankCode : '',
    note,
    items: items.map(i => ({ product: i.product, spec: i.spec, qty: i.qty })),
  };

  try {
    const res = await fetchWithTimeout(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' }, // GAS doPost 需要 text/plain 避免 CORS preflight
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
    const json = await res.json();

    if (!json.success) throw new Error(json.error || '送出失敗');

    // 儲存訂購人資訊
    saveBuyerInfo();

    // 顯示成功畫面
    showSuccess(json.orderId, json.total);
  } catch (err) {
    console.error('送出訂單失敗:', err);
    errorEl.textContent = err.name === 'AbortError'
      ? '送出逾時，請稍後再試'
      : (err.message || '送出失敗，請稍後再試');
    errorEl.classList.remove('hidden');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

function showSuccess(orderId, total) {
  document.getElementById('section-order').classList.add('hidden');
  document.getElementById('section-success').classList.remove('hidden');
  hideFloatingBar();

  setText('success-order-id', orderId);
  setText('success-total', '$' + (total || 0).toLocaleString());

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  // 取消所有勾選
  document.querySelectorAll('.spec-row input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
    const qtyControl = document.getElementById('qty-' + cb.id);
    if (qtyControl) qtyControl.classList.remove('visible');
    const qtyInput = document.getElementById('qtyval-' + cb.id);
    if (qtyInput) qtyInput.value = 1;
  });

  // 清空欄位（但保留訂購人資訊 from localStorage）
  document.getElementById('order-note').value = '';
  document.getElementById('bank-code').value = '';
  document.getElementById('same-as-buyer').checked = true;
  document.getElementById('receiver-fields').classList.add('hidden');
  document.getElementById('order-error').classList.add('hidden');

  // 重設送貨時段
  document.querySelector('input[name="delivery-time"][value="不指定"]').checked = true;

  updateSummary();
  switchTab('order');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 查詢訂單 ----------

async function queryOrders() {
  const phone = document.getElementById('query-phone').value.trim();
  const loadingEl = document.getElementById('query-loading');
  const errorEl = document.getElementById('query-error');
  const emptyEl = document.getElementById('query-empty');
  const resultsEl = document.getElementById('query-results');

  errorEl.classList.add('hidden');
  emptyEl.classList.add('hidden');
  resultsEl.innerHTML = '';

  if (!phone) {
    errorEl.textContent = '請輸入電話號碼';
    errorEl.classList.remove('hidden');
    return;
  }

  loadingEl.classList.remove('hidden');
  const btn = document.getElementById('query-btn');
  btn.classList.add('btn-loading');
  btn.disabled = true;

  try {
    const res = await fetchWithTimeout(API_URL + '?action=query&phone=' + encodeURIComponent(phone), { redirect: 'follow' });
    const json = await res.json();

    loadingEl.classList.add('hidden');

    if (!json.success) {
      emptyEl.textContent = json.error || '查無訂單紀錄';
      emptyEl.classList.remove('hidden');
      return;
    }

    const orders = json.data;
    if (!orders || orders.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }

    orders.forEach(order => {
      resultsEl.appendChild(renderOrderCard(order));
    });
  } catch (err) {
    console.error('查詢失敗:', err);
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.name === 'AbortError'
      ? '查詢逾時，請稍後再試'
      : '查詢失敗，請稍後再試';
    errorEl.classList.remove('hidden');
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

function renderOrderCard(order) {
  const items = Array.isArray(order.items) ? order.items : [];

  const card = document.createElement('div');
  card.className = 'order-card';

  // 標題列（訂單編號 + overall 狀態）
  const header = document.createElement('div');
  header.className = 'order-head';

  const idSpan = document.createElement('span');
  idSpan.className = 'order-id';
  idSpan.textContent = order.orderId;
  header.appendChild(idSpan);

  if (items.length > 0) {
    const statuses = items.map(i => i.status || '訂單確認中');
    const allSame = statuses.every(s => s === statuses[0]);
    const overall = document.createElement('span');
    if (allSame) {
      overall.className = 'status-badge ' + getStatusClass(statuses[0]);
      overall.textContent = statuses[0];
    } else {
      overall.className = 'status-badge pending';
      overall.textContent = '分批處理中';
    }
    header.appendChild(overall);
  }
  card.appendChild(header);

  // 時間
  const timeLine = document.createElement('p');
  timeLine.className = 'order-time';
  timeLine.textContent = '下單時間：' + order.time;
  card.appendChild(timeLine);

  // 訂購人 / 收件人
  card.appendChild(renderParties(order));

  // 品項
  if (items.length > 0) {
    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'order-items';
    items.forEach(item => itemsWrap.appendChild(renderItemBlock(item)));
    card.appendChild(itemsWrap);
  }

  // 合計
  const totalRow = document.createElement('div');
  totalRow.className = 'order-total';
  const totalLabel = document.createElement('span');
  totalLabel.className = 'label';
  totalLabel.textContent = '合計';
  const totalAmount = document.createElement('span');
  totalAmount.className = 'amount';
  totalAmount.textContent = '$' + (order.total || 0).toLocaleString();
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalAmount);
  card.appendChild(totalRow);

  // 付款方式 + 送貨時段
  if (order.paymentMethod) {
    const meta = document.createElement('p');
    meta.className = 'order-meta';
    let txt = '付款方式：' + order.paymentMethod;
    if (order.deliveryTime && order.deliveryTime !== '不指定') {
      txt += '　|　送貨時段：' + order.deliveryTime;
    }
    meta.textContent = txt;
    card.appendChild(meta);
  }

  return card;
}

function renderParties(order) {
  const wrap = document.createElement('div');
  wrap.className = 'order-parties';

  const sameAsBuyer =
    order.receiverName === order.buyerName &&
    order.receiverPhone === order.buyerPhone &&
    order.receiverAddress === order.buyerAddress;

  wrap.appendChild(renderParty('訂購人', [order.buyerName, order.buyerPhone, order.buyerAddress]));
  if (sameAsBuyer) {
    wrap.appendChild(renderParty('收件人', ['同訂購人']));
  } else {
    wrap.appendChild(renderParty('收件人', [order.receiverName, order.receiverPhone, order.receiverAddress]));
  }

  return wrap;
}

function renderParty(label, lines) {
  const row = document.createElement('div');
  row.className = 'party';

  const labelEl = document.createElement('div');
  labelEl.className = 'party-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const info = document.createElement('div');
  info.className = 'party-info';
  lines.filter(Boolean).forEach(line => {
    const span = document.createElement('span');
    span.textContent = line;
    info.appendChild(span);
  });
  row.appendChild(info);

  return row;
}

function renderItemBlock(item) {
  const block = document.createElement('div');
  block.className = 'order-item-block';

  const itemRow = document.createElement('div');
  itemRow.className = 'order-item';

  const main = document.createElement('div');
  main.className = 'item-main';

  const statusText = item.status || '訂單確認中';
  const status = document.createElement('span');
  status.className = 'item-status status-badge ' + getStatusClass(statusText);
  status.textContent = statusText;
  main.appendChild(status);

  const product = document.createElement('span');
  product.className = 'product';
  product.textContent = item.product + ' ' + item.spec + ' ×' + item.qty + ' (箱)';
  main.appendChild(product);

  itemRow.appendChild(main);

  const amount = document.createElement('span');
  amount.className = 'amount';
  amount.textContent = '$' + (item.amount || 0).toLocaleString();
  itemRow.appendChild(amount);

  block.appendChild(itemRow);

  // 物流運送中 → 運送資訊
  if (item.status === '物流運送中') {
    block.appendChild(renderTrackBox(item.shippingNumber));
  }

  return block;
}

function renderTrackBox(shippingNumber) {
  const box = document.createElement('div');
  box.className = 'track-box';

  const title = document.createElement('p');
  title.className = 'track-title';
  title.textContent = '🚚 物流查詢';
  box.appendChild(title);

  if (shippingNumber) {
    const numLine = document.createElement('p');
    numLine.className = 'track-number';
    numLine.appendChild(document.createTextNode('運送編號'));
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = shippingNumber;
    numLine.appendChild(num);
    box.appendChild(numLine);
  }

  const link = document.createElement('a');
  link.className = 'track-link';
  link.href = 'https://www.t-cat.com.tw/inquire/trace.aspx';
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = '前往黑貓宅急便查詢 →';
  box.appendChild(link);

  return box;
}

// ---------- 工具函式 ----------

function getStatusClass(status) {
  if (status === '訂單已確認') return 'confirmed';
  if (status === '物流運送中') return 'shipping';
  if (status === '訂單已完成') return 'completed';
  if (status === '待付款')     return 'unpaid';
  return 'pending'; // 訂單確認中 / 其他
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

