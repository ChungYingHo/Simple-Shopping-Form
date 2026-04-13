// ============================================================
// 芒果訂購網站 — 前端邏輯
// ============================================================

// ⚠️ 部署時請將此 URL 換成你的 Google Apps Script Web App URL
const API_URL = 'YOUR_GAS_WEB_APP_URL_HERE';

// 全域狀態
let productsData = [];
let settingsData = {};

// ---------- 初始化 ----------

document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  setupSameAsBuyer();
  setupPaymentMethod();
  restoreBuyerInfo();
});

// ---------- Tab 切換 ----------

function switchTab(tab) {
  const orderSection = document.getElementById('section-order');
  const querySection = document.getElementById('section-query');
  const successSection = document.getElementById('section-success');
  const tabOrder = document.getElementById('tab-order');
  const tabQuery = document.getElementById('tab-query');

  successSection.classList.add('hidden');

  if (tab === 'order') {
    orderSection.classList.remove('hidden');
    querySection.classList.add('hidden');
    tabOrder.classList.add('border-b-2', 'border-amber-500', 'text-amber-800', 'bg-white');
    tabOrder.classList.remove('text-gray-500', 'bg-amber-100');
    tabQuery.classList.remove('border-b-2', 'border-amber-500', 'text-amber-800', 'bg-white');
    tabQuery.classList.add('text-gray-500', 'bg-amber-100');
  } else {
    orderSection.classList.add('hidden');
    querySection.classList.remove('hidden');
    tabQuery.classList.add('border-b-2', 'border-amber-500', 'text-amber-800', 'bg-white');
    tabQuery.classList.remove('text-gray-500', 'bg-amber-100');
    tabOrder.classList.remove('border-b-2', 'border-amber-500', 'text-amber-800', 'bg-white');
    tabOrder.classList.add('text-gray-500', 'bg-amber-100');
  }
}

// ---------- 載入商品 ----------

async function loadProducts() {
  const loading = document.getElementById('products-loading');
  const container = document.getElementById('products-container');
  const errorEl = document.getElementById('products-error');

  try {
    const res = await fetch(API_URL + '?action=products', { redirect: 'follow' });
    const json = await res.json();

    if (!json.success) throw new Error(json.error || '載入失敗');

    productsData = json.data.products;
    settingsData = json.data.settings;

    renderProducts();
    renderSettings();

    loading.classList.add('hidden');
    container.classList.remove('hidden');
  } catch (err) {
    console.error('載入商品失敗:', err);
    loading.classList.add('hidden');
    errorEl.classList.remove('hidden');
  }
}

function renderProducts() {
  const container = document.getElementById('products-container');
  container.innerHTML = '';

  productsData.forEach((product, idx) => {
    const card = document.createElement('div');
    card.className = 'product-card bg-white rounded-xl shadow p-4' + (product.soldOut ? ' sold-out' : '');

    const title = document.createElement('h3');
    title.className = 'font-bold text-lg text-amber-800 mb-2';
    title.textContent = product.name;
    if (product.soldOut) {
      const badge = document.createElement('span');
      badge.className = 'ml-2 text-xs bg-gray-300 text-gray-600 px-2 py-0.5 rounded-full';
      badge.textContent = '已售罄';
      title.appendChild(badge);
    }
    card.appendChild(title);

    if (product.soldOut) {
      const msg = document.createElement('p');
      msg.className = 'text-sm text-gray-400';
      msg.textContent = '此商品目前無法訂購';
      card.appendChild(msg);
    } else {
      const specs = [
        { key: '5', label: '五斤' },
        { key: '10', label: '十斤' },
        { key: '20', label: '二十斤' },
      ];

      specs.forEach(spec => {
        const price = product.prices[spec.key];
        if (price === undefined || price === null) return;

        const row = document.createElement('div');
        row.className = 'spec-row';

        const specId = 'spec-' + idx + '-' + spec.key;

        row.innerHTML =
          '<label>' +
            '<input type="checkbox" id="' + specId + '" class="w-5 h-5 rounded text-amber-500 focus:ring-amber-500 flex-shrink-0" ' +
              'data-product="' + escapeAttr(product.name) + '" data-spec="' + spec.key + '" data-price="' + price + '" ' +
              'onchange="onSpecChange(this)">' +
            '<span class="text-sm">' + escapeHtml(spec.label) + '</span>' +
            '<span class="text-sm font-semibold text-amber-700">$' + price.toLocaleString() + '</span>' +
          '</label>' +
          '<div class="qty-control" id="qty-' + specId + '">' +
            '<button type="button" class="qty-btn" onclick="changeQty(\'' + specId + '\', -1)">−</button>' +
            '<input type="number" class="qty-input" id="qtyval-' + specId + '" value="1" min="1" max="99" inputmode="numeric" ' +
              'data-product="' + escapeAttr(product.name) + '" data-spec="' + spec.key + '" data-price="' + price + '" ' +
              'onchange="onQtyChange(this)">' +
            '<button type="button" class="qty-btn" onclick="changeQty(\'' + specId + '\', 1)">+</button>' +
          '</div>';

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
    annEl.textContent = '📢 ' + settingsData.announcement;
    annEl.classList.remove('hidden');
  }

  // 匯款資訊
  setText('bank-name-display', settingsData.bankName || '-');
  setText('bank-branch-display', settingsData.bankBranch || '');
  setText('bank-account-display', settingsData.accountNumber || '-');
  setText('bank-holder-display', settingsData.accountHolder || '-');
  setText('payment-note-display', settingsData.paymentNote || '');
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

  if (items.length === 0) {
    summaryEl.classList.add('hidden');
    return;
  }

  summaryEl.classList.remove('hidden');
  itemsEl.innerHTML = '';

  const specLabels = { '5': '五斤', '10': '十斤', '20': '二十斤' };
  let total = 0;

  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'flex justify-between text-gray-700';
    const label = escapeHtml(item.product) + ' ' + (specLabels[item.spec] || item.spec) + ' ×' + item.qty;
    row.innerHTML = '<span>' + label + '</span><span class="font-semibold">$' + item.amount.toLocaleString() + '</span>';
    itemsEl.appendChild(row);
    total += item.amount;
  });

  totalEl.textContent = '$' + total.toLocaleString();
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

// ---------- 付款方式切換 ----------

function setupPaymentMethod() {
  const radios = document.querySelectorAll('input[name="payment-method"]');
  const bankInfo = document.getElementById('bank-info');

  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === '匯款' && radio.checked) {
        bankInfo.classList.remove('hidden');
      } else if (radio.value === '現金付款' && radio.checked) {
        bankInfo.classList.add('hidden');
      }
    });
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
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
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
    const res = await fetch(API_URL, {
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
    showSuccess(json.orderId, json.total, paymentMethod);
  } catch (err) {
    console.error('送出訂單失敗:', err);
    errorEl.textContent = err.message || '送出失敗，請稍後再試';
    errorEl.classList.remove('hidden');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

function showSuccess(orderId, total, paymentMethod) {
  document.getElementById('section-order').classList.add('hidden');
  document.getElementById('section-success').classList.remove('hidden');

  setText('success-order-id', orderId);
  setText('success-total', '$' + (total || 0).toLocaleString());

  const bankInfoEl = document.getElementById('success-bank-info');
  if (paymentMethod === '匯款' && settingsData.bankName) {
    bankInfoEl.classList.remove('hidden');
    const details = document.getElementById('success-bank-details');
    details.innerHTML = '';
    appendText(details, 'p', '銀行：' + settingsData.bankName + ' ' + (settingsData.bankBranch || ''));
    appendText(details, 'p', '帳號：' + settingsData.accountNumber);
    appendText(details, 'p', '戶名：' + settingsData.accountHolder);
    if (settingsData.paymentNote) {
      appendText(details, 'p', '⚠ ' + settingsData.paymentNote, 'text-amber-600 mt-1');
    }
  } else {
    bankInfoEl.classList.add('hidden');
  }

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

  // 重設付款方式為匯款
  document.querySelector('input[name="payment-method"][value="匯款"]').checked = true;
  document.getElementById('bank-info').classList.remove('hidden');

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
    const res = await fetch(API_URL + '?action=query&phone=' + encodeURIComponent(phone), { redirect: 'follow' });
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
      const card = document.createElement('div');
      card.className = 'bg-white rounded-xl shadow p-4';

      // 標題列
      const header = document.createElement('div');
      header.className = 'flex justify-between items-start mb-3 flex-wrap gap-2';
      const titleSpan = document.createElement('span');
      titleSpan.className = 'font-mono text-sm font-bold text-amber-800';
      titleSpan.textContent = order.orderId;
      header.appendChild(titleSpan);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'status-badge ' + getStatusClass(order.status);
      statusBadge.textContent = getStatusIcon(order.status) + ' ' + order.status;
      header.appendChild(statusBadge);
      card.appendChild(header);

      // 時間
      const timeLine = document.createElement('p');
      timeLine.className = 'text-xs text-gray-400 mb-3';
      timeLine.textContent = '下單時間：' + order.time;
      card.appendChild(timeLine);

      // 品項
      order.items.forEach(item => {
        const itemRow = document.createElement('div');
        itemRow.className = 'flex justify-between text-sm py-1';
        const itemLabel = document.createElement('span');
        itemLabel.className = 'text-gray-700';
        itemLabel.textContent = item.product + ' ' + item.spec + ' ×' + item.qty;
        const itemAmount = document.createElement('span');
        itemAmount.className = 'font-semibold text-gray-800';
        itemAmount.textContent = '$' + (item.amount || 0).toLocaleString();
        itemRow.appendChild(itemLabel);
        itemRow.appendChild(itemAmount);
        card.appendChild(itemRow);
      });

      // 合計
      const totalRow = document.createElement('div');
      totalRow.className = 'border-t border-gray-200 mt-2 pt-2 flex justify-between font-bold text-amber-800';
      const totalLabel = document.createElement('span');
      totalLabel.textContent = '合計';
      const totalVal = document.createElement('span');
      totalVal.textContent = '$' + (order.total || 0).toLocaleString();
      totalRow.appendChild(totalLabel);
      totalRow.appendChild(totalVal);
      card.appendChild(totalRow);

      // 付款方式
      if (order.paymentMethod) {
        const payLine = document.createElement('p');
        payLine.className = 'text-xs text-gray-400 mt-2';
        payLine.textContent = '付款方式：' + order.paymentMethod;
        if (order.deliveryTime && order.deliveryTime !== '不指定') {
          payLine.textContent += '｜送貨時段：' + order.deliveryTime;
        }
        card.appendChild(payLine);
      }

      resultsEl.appendChild(card);
    });
  } catch (err) {
    console.error('查詢失敗:', err);
    loadingEl.classList.add('hidden');
    errorEl.textContent = '查詢失敗，請稍後再試';
    errorEl.classList.remove('hidden');
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// ---------- 工具函式 ----------

function getStatusClass(status) {
  if (status === '已確認') return 'confirmed';
  if (status === '已出貨') return 'shipped';
  return 'pending';
}

function getStatusIcon(status) {
  if (status === '已確認') return '✅';
  if (status === '已出貨') return '🚚';
  return '⏳';
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function appendText(parent, tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  parent.appendChild(el);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
