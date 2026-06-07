// ============================================================
// 芒果訂購網站 — 前端邏輯
// ============================================================

(function () {
  'use strict';

  // ⚠️ 部署時請將此 URL 換成你的 Google Apps Script Web App URL
  const API_URL = 'https://script.google.com/macros/s/AKfycbwb7Ok_BZW1eLwpYOEbl4nME9o0F9NZvOSdn-tedjJhrKWpozybBwS0XQj17PCyMcniUg/exec';

  // fetch timeout（GAS 偶爾會 hang）
  const FETCH_TIMEOUT_MS = 20000;

  // 兩箱折扣：同規格（不限品項）每滿 2 箱折 100（累加）。僅供前端顯示，金額以後端為準。
  const PAIR_DISCOUNT = 100;

  // 依規格(不限品項)加總箱數計算折扣：每滿 2 箱折 PAIR_DISCOUNT，累加。
  function computeDiscount(items) {
    const qtyBySpec = {};
    items.forEach(function (i) {
      qtyBySpec[i.spec] = (qtyBySpec[i.spec] || 0) + i.qty;
    });
    var discount = 0;
    Object.keys(qtyBySpec).forEach(function (spec) {
      discount += Math.floor(qtyBySpec[spec] / 2) * PAIR_DISCOUNT;
    });
    return discount;
  }

  // 全域狀態
  let productsData = [];
  let settingsData = {};
  let pendingSubmit = null;   // 確認 modal 按「確認送出」時呼叫的送出函式（單一 / 分送多人）
  let recipientSeq = 0;       // 分送多人：收件人卡片流水號（給欄位 id 用）
  let multiBuilt = false;     // 分送多人分頁是否已建好（首次切過去才建，避免初始就多出商品卡）

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
    setupEventHandlers();
  });

  function setupEventHandlers() {
    // Tabs
    document.getElementById('tab-order').addEventListener('click', () => switchTab('order'));
    document.getElementById('tab-multi').addEventListener('click', () => switchTab('multi'));
    document.getElementById('tab-query').addEventListener('click', () => switchTab('query'));

    // 訂購表單送出 → 開啟確認 modal（不直接送出）
    document.getElementById('order-form').addEventListener('submit', e => {
      e.preventDefault();
      requestConfirm();
    });

    // 分送多人：表單送出 → 確認 modal
    document.getElementById('multi-form').addEventListener('submit', e => {
      e.preventDefault();
      requestMultiConfirm();
    });
    document.getElementById('add-recipient-btn').addEventListener('click', addRecipient);
    document.querySelectorAll('input[name="multi-mode"]').forEach(r => {
      r.addEventListener('change', () => { applyMultiMode(); updateMultiSummary(); });
    });

    // 查詢表單
    document.getElementById('query-form').addEventListener('submit', e => {
      e.preventDefault();
      queryOrders();
    });

    // 商品載入失敗 → 重新整理
    document.getElementById('products-retry').addEventListener('click', () => location.reload());

    // 成功頁按鈕
    document.getElementById('success-continue-btn').addEventListener('click', resetForm);
    document.getElementById('success-query-btn').addEventListener('click', () => switchTab('query'));

    // 確認 modal 按鈕
    document.getElementById('confirm-cancel-btn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-submit-btn').addEventListener('click', () => {
      closeConfirmModal();
      if (pendingSubmit) pendingSubmit();
    });
    // 點 overlay 背景關閉
    document.getElementById('confirm-modal').addEventListener('click', e => {
      if (e.target.id === 'confirm-modal') closeConfirmModal();
    });
    // Esc 關閉
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeConfirmModal();
    });
  }

  // ---------- Tab 切換 ----------

  function switchTab(tab) {
    const map = {
      order: ['section-order', 'tab-order'],
      multi: ['section-multi', 'tab-multi'],
      query: ['section-query', 'tab-query'],
    };

    document.getElementById('section-success').classList.add('hidden');

    Object.keys(map).forEach(key => {
      const [sectionId, tabId] = map[key];
      const active = key === tab;
      const section = document.getElementById(sectionId);
      const tabBtn = document.getElementById(tabId);
      if (section) section.classList.toggle('hidden', !active);
      if (tabBtn) {
        tabBtn.classList.toggle('active', active);
        tabBtn.setAttribute('aria-selected', active ? 'true' : 'false');
      }
    });

    if (tab === 'order') {
      updateSummary();
    } else {
      hideFloatingBar();
      if (tab === 'multi') {
        ensureMultiBuilt();
        updateMultiSummary();
      }
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
    setTimeout(() => loader.remove(), 350);
  }

  function showSubmitLoader() {
    const el = document.getElementById('submit-loader');
    if (!el) return;
    el.classList.remove('hidden');
    el.setAttribute('aria-busy', 'true');
  }

  function hideSubmitLoader() {
    const el = document.getElementById('submit-loader');
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-busy', 'false');
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
        hint.textContent = '單價為一箱（含運費，約 15–18 顆）';
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
          // data-price 僅供前端顯示總計；實際金額以後端為準（不可信任）
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

    // 稀缺資訊（採收期/限量等）— 從「稀缺資訊」「採收期」「限量」任一鍵讀取
    const scarcityEl = document.getElementById('scarcity-info');
    const scarcityText = settingsData.scarcity || settingsData.harvestWindow || '';
    if (scarcityEl && scarcityText) {
      scarcityEl.textContent = scarcityText;
      scarcityEl.classList.remove('hidden');
    }

    // 匯款資訊（訂購分頁 + 分送多人分頁共用同一份設定）
    setText('bank-name-display', settingsData.bankName || '-');
    setText('bank-branch-display', settingsData.bankBranch || '');
    setText('bank-account-display', settingsData.accountNumber || '-');
    setText('multi-bank-name-display', settingsData.bankName || '-');
    setText('multi-bank-branch-display', settingsData.bankBranch || '');
    setText('multi-bank-account-display', settingsData.accountNumber || '-');

    [['payment-note-display', settingsData.paymentNote],
     ['multi-payment-note-display', settingsData.paymentNote]].forEach(([id, text]) => {
      const noteEl = document.getElementById(id);
      if (!noteEl) return;
      if (text) {
        noteEl.textContent = text;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }
    });
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
    // 限訂購區：分送多人分頁同樣使用 .spec-row，全域選取會誤抓且無對應 qtyval id
    const checkboxes = document.querySelectorAll('#products-container .spec-row input[type="checkbox"]:checked');
    checkboxes.forEach(cb => {
      const qtyInput = document.getElementById('qtyval-' + cb.id);
      const qty = parseInt(qtyInput.value, 10) || 1;
      const price = parseInt(cb.dataset.price, 10);
      items.push({
        product: cb.dataset.product,
        spec: cb.dataset.spec,
        qty: qty,
        price: price,
        amount: price * qty,                      // 折扣前小計
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
    let subtotal = 0;
    const discountTotal = computeDiscount(items);

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
      subtotal += item.amount;
    });

    if (discountTotal > 0) {
      const row = document.createElement('div');
      row.className = 'summary-line is-discount';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = '兩箱折扣';
      const amountSpan = document.createElement('span');
      amountSpan.className = 'summary-line-amount';
      amountSpan.textContent = '−$' + discountTotal.toLocaleString();
      row.appendChild(labelSpan);
      row.appendChild(amountSpan);
      itemsEl.appendChild(row);
    }

    const total = subtotal - discountTotal;
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

  function persistBuyer(name, phone, address) {
    try {
      localStorage.setItem('mango_buyer', JSON.stringify({ name, phone, address }));
    } catch (_) {}
  }

  function saveBuyerInfo() {
    persistBuyer(
      document.getElementById('buyer-name').value,
      document.getElementById('buyer-phone').value,
      document.getElementById('buyer-address').value
    );
  }

  function restoreBuyerInfo() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem('mango_buyer'));
    } catch (_) { return; }
    if (!data) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('buyer-name', data.name);
    setVal('buyer-phone', data.phone);
    setVal('buyer-address', data.address);
    setVal('multi-buyer-name', data.name);
    setVal('multi-buyer-phone', data.phone);
    setVal('multi-buyer-address', data.address);
  }

  // ---------- 收集表單資料 + 驗證 ----------

  function collectOrderData() {
    const buyerName = document.getElementById('buyer-name').value.trim();
    const buyerPhone = document.getElementById('buyer-phone').value.trim();
    const buyerAddress = document.getElementById('buyer-address').value.trim();

    const sameAsBuyer = document.getElementById('same-as-buyer').checked;
    const receiverName = sameAsBuyer ? buyerName : document.getElementById('receiver-name').value.trim();
    const receiverPhone = sameAsBuyer ? buyerPhone : document.getElementById('receiver-phone').value.trim();
    const receiverAddress = sameAsBuyer ? buyerAddress : document.getElementById('receiver-address').value.trim();

    const deliveryTime = document.querySelector('input[name="delivery-time"]:checked').value;
    const bankCode = document.getElementById('bank-code').value.trim();
    const note = document.getElementById('order-note').value.trim();

    return {
      buyerName, buyerPhone, buyerAddress,
      sameAsBuyer,
      receiverName, receiverPhone, receiverAddress,
      deliveryTime, bankCode, note,
      items: getSelectedItems(),
    };
  }

  function validateOrderData(data) {
    const errors = [];
    if (!data.buyerName) errors.push('請填寫訂購人姓名');
    if (!data.buyerPhone) errors.push('請填寫訂購人電話');
    if (!data.buyerAddress) errors.push('請填寫訂購人地址');
    if (!data.sameAsBuyer) {
      if (!data.receiverName) errors.push('請填寫收件人姓名');
      if (!data.receiverPhone) errors.push('請填寫收件人電話');
      if (!data.receiverAddress) errors.push('請填寫收件地址');
    }
    if (data.items.length === 0) errors.push('請至少選擇一項商品');
    if (!data.bankCode) errors.push('請先完成匯款，並填寫匯款後五碼');
    else if (!/^\d{5}$/.test(data.bankCode)) errors.push('匯款後五碼需為 5 位數字');
    return errors;
  }

  function showOrderError(message) {
    const errorEl = document.getElementById('order-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- 確認 Modal ----------

  function requestConfirm() {
    const errorEl = document.getElementById('order-error');
    errorEl.classList.add('hidden');

    const data = collectOrderData();
    const errors = validateOrderData(data);
    if (errors.length > 0) {
      showOrderError(errors.join('、'));
      return;
    }
    pendingSubmit = submitOrder;
    openConfirmModal(data);
  }

  function openConfirmModal(data) {
    const specLabels = { '5': '五斤', '10': '十斤', '20': '二十斤' };

    // 品項
    const itemsEl = document.getElementById('confirm-items');
    itemsEl.innerHTML = '';
    let subtotal = 0;
    const discountTotal = computeDiscount(data.items);
    data.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'modal-item';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.product + ' ' + (specLabels[item.spec] || item.spec) + ' ×' + item.qty + ' (箱)';
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = '$' + item.amount.toLocaleString();
      row.appendChild(name);
      row.appendChild(amount);
      itemsEl.appendChild(row);
      subtotal += item.amount;
    });

    if (discountTotal > 0) {
      const row = document.createElement('div');
      row.className = 'modal-item is-discount';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = '兩箱折扣';
      const amount = document.createElement('span');
      amount.className = 'amount';
      amount.textContent = '−$' + discountTotal.toLocaleString();
      row.appendChild(name);
      row.appendChild(amount);
      itemsEl.appendChild(row);
    }

    setText('confirm-total', '$' + (subtotal - discountTotal).toLocaleString());

    // 訂購人
    fillModalLines('confirm-buyer', [data.buyerName, data.buyerPhone, data.buyerAddress]);

    // 收件人
    if (data.sameAsBuyer) {
      fillModalLines('confirm-receiver', ['同訂購人']);
    } else {
      fillModalLines('confirm-receiver', [data.receiverName, data.receiverPhone, data.receiverAddress]);
    }

    // 送貨時段 / 匯款五碼
    setText('confirm-delivery', data.deliveryTime);
    setText('confirm-bank-code', data.bankCode);

    // 備註（有才顯示）
    const noteSection = document.getElementById('confirm-note-section');
    if (data.note) {
      setText('confirm-note', data.note);
      noteSection.classList.remove('hidden');
    } else {
      noteSection.classList.add('hidden');
    }

    const modal = document.getElementById('confirm-modal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // 對焦取消鈕（避免不小心 Enter 直接確認）
    setTimeout(() => document.getElementById('confirm-cancel-btn').focus(), 50);
  }

  function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (!modal.classList.contains('show')) return;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function fillModalLines(id, lines) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    lines.filter(Boolean).forEach(line => {
      const span = document.createElement('span');
      span.className = 'line';
      span.textContent = line;
      el.appendChild(span);
    });
  }

  // ---------- 送出訂單（已通過確認） ----------

  async function submitOrder() {
    const errorEl = document.getElementById('order-error');
    errorEl.classList.add('hidden');

    const data = collectOrderData();
    const errors = validateOrderData(data);
    if (errors.length > 0) {
      showOrderError(errors.join('、'));
      return;
    }

    const btn = document.getElementById('submit-btn');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    showSubmitLoader();

    const payload = {
      action: 'order',
      buyerName: data.buyerName,
      buyerPhone: data.buyerPhone,
      buyerAddress: data.buyerAddress,
      receiverName: data.receiverName,
      receiverPhone: data.receiverPhone,
      receiverAddress: data.receiverAddress,
      deliveryTime: data.deliveryTime,
      bankCode: data.bankCode,
      note: data.note,
      items: data.items.map(i => ({ product: i.product, spec: i.spec, qty: i.qty })),
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

      saveBuyerInfo();
      showSuccess(json.orderId, json.total);
    } catch (err) {
      console.error('送出訂單失敗:', err);
      showOrderError(err.name === 'AbortError'
        ? '送出逾時，請稍後再試'
        : (err.message || '送出失敗，請稍後再試'));
    } finally {
      hideSubmitLoader();
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  function showSuccess(orderId, total) {
    document.getElementById('section-order').classList.add('hidden');
    document.getElementById('section-multi').classList.add('hidden');
    document.getElementById('section-query').classList.add('hidden');
    document.getElementById('section-success').classList.remove('hidden');
    hideFloatingBar();

    setText('success-order-id', orderId);
    setText('success-total', '$' + (total || 0).toLocaleString());

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    // 取消所有勾選（限訂購區，避免動到分送多人分頁同樣使用 .spec-row 的選單）
    document.querySelectorAll('#products-container .spec-row input[type="checkbox"]').forEach(cb => {
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

    // 一併重置分送多人分頁
    resetMultiForm();

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
        errorEl.textContent = json.error || '查詢失敗';
        errorEl.classList.remove('hidden');
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

    // 物流商不固定，故不在頁面顯示運送編號/查詢連結；如需查件請聯絡店家。
    // shippingNumber 仍由後端維護於 Sheet「運送編號」欄，僅不渲染至前台。

    return block;
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

  // ============================================================
  // 分送多人（multi-recipient）
  //   一張單 → 多位收件人，逐筆 item 帶各自收件人；折扣每位各算（同舊版邏輯，
  //   只是分組單位變成「每位收件人」）。後端 createOrder 收到攤平後的 items。
  // ============================================================

  // 依「商品選單」的勾選讀出品項。scopeEl 限定範圍、scopeClass 區分共用/各卡。
  function readPickerItems(scopeEl, scopeClass) {
    const items = [];
    if (!scopeEl) return items;
    scopeEl.querySelectorAll('input.' + scopeClass + ':checked').forEach(cb => {
      const row = cb.closest('.spec-row');
      const qtyInput = row ? row.querySelector('.qty-input') : null;
      const qty = qtyInput ? (parseInt(qtyInput.value, 10) || 1) : 1;
      const price = parseInt(cb.dataset.price, 10) || 0;
      items.push({
        product: cb.dataset.product,
        spec: cb.dataset.spec,
        qty: qty,
        price: price,
        amount: price * qty, // 折扣前小計
      });
    });
    return items;
  }

  // 通用商品選單建構（與訂購分頁同結構，但用 scopeClass 區分範圍；以 onChange 回呼更新）
  function buildProductCards(container, scopeClass, onChange) {
    container.innerHTML = '';

    productsData.forEach(product => {
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
        container.appendChild(card);
        return;
      }

      [{ key: '5', label: '五斤' }, { key: '10', label: '十斤' }, { key: '20', label: '二十斤' }]
        .forEach(spec => {
          const price = product.prices[spec.key];
          if (price === undefined || price === null) return;

          const row = document.createElement('div');
          row.className = 'spec-row';

          const label = document.createElement('label');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'spec-check ' + scopeClass;
          checkbox.dataset.product = product.name;
          checkbox.dataset.spec = spec.key;
          checkbox.dataset.price = String(price);
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

          const minusBtn = document.createElement('button');
          minusBtn.type = 'button';
          minusBtn.className = 'qty-btn';
          minusBtn.textContent = '−';
          minusBtn.setAttribute('aria-label', '減少數量');
          qtyWrap.appendChild(minusBtn);

          const qtyInput = document.createElement('input');
          qtyInput.type = 'number';
          qtyInput.className = 'qty-input';
          qtyInput.value = '1';
          qtyInput.min = '1';
          qtyInput.max = '99';
          qtyInput.inputMode = 'numeric';
          qtyWrap.appendChild(qtyInput);

          const plusBtn = document.createElement('button');
          plusBtn.type = 'button';
          plusBtn.className = 'qty-btn';
          plusBtn.textContent = '+';
          plusBtn.setAttribute('aria-label', '增加數量');
          qtyWrap.appendChild(plusBtn);

          row.appendChild(qtyWrap);

          checkbox.addEventListener('change', () => {
            qtyWrap.classList.toggle('visible', checkbox.checked);
            if (!checkbox.checked) qtyInput.value = '1';
            onChange();
          });
          const bump = delta => {
            let val = parseInt(qtyInput.value, 10) || 1;
            val = Math.max(1, Math.min(99, val + delta));
            qtyInput.value = String(val);
            onChange();
          };
          minusBtn.addEventListener('click', () => bump(-1));
          plusBtn.addEventListener('click', () => bump(1));
          qtyInput.addEventListener('change', () => {
            let val = parseInt(qtyInput.value, 10);
            if (!val || val < 1) val = 1;
            if (val > 99) val = 99;
            qtyInput.value = String(val);
            onChange();
          });

          card.appendChild(row);
        });

      container.appendChild(card);
    });
  }

  function getMultiMode() {
    const el = document.querySelector('input[name="multi-mode"]:checked');
    return el ? el.value : 'same';
  }

  // 建一個 .field（label + input），回傳該 field 元素
  function buildField(labelText, inputClass, type, placeholder, maxlen, id) {
    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = id;
    label.appendChild(document.createTextNode(labelText + ' '));
    const star = document.createElement('span');
    star.className = 'required';
    star.textContent = '*';
    label.appendChild(star);

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.className = 'form-input ' + inputClass;
    input.placeholder = placeholder;
    input.maxLength = maxlen;

    field.appendChild(label);
    field.appendChild(input);
    return field;
  }

  function createRecipientCard() {
    recipientSeq += 1;
    const seq = recipientSeq;

    const card = document.createElement('section');
    card.className = 'recipient-card';

    const head = document.createElement('div');
    head.className = 'recipient-head';
    const title = document.createElement('span');
    title.className = 'recipient-title';
    head.appendChild(title);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'recipient-remove';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => removeRecipient(card));
    head.appendChild(removeBtn);
    card.appendChild(head);

    const nameField = buildField('收件人姓名', 'rcp-name', 'text', '請輸入收件人姓名', 50, 'rcp-name-' + seq);
    card.appendChild(nameField);
    card.appendChild(buildField('收件人電話', 'rcp-phone', 'tel', '例：0912345678', 20, 'rcp-phone-' + seq));
    card.appendChild(buildField('收件地址', 'rcp-address', 'text', '請輸入收件地址', 200, 'rcp-address-' + seq));

    // 姓名變動 → 摘要列即時帶名字
    const nameInput = nameField.querySelector('.rcp-name');
    if (nameInput) nameInput.addEventListener('input', updateMultiSummary);

    // 各自挑商品（custom 模式才顯示）
    const products = document.createElement('div');
    products.className = 'rcp-products';
    const plabel = document.createElement('p');
    plabel.className = 'rcp-products-label';
    plabel.textContent = '這位收件人的商品';
    products.appendChild(plabel);
    const pcontainer = document.createElement('div');
    pcontainer.className = 'rcp-products-container';
    products.appendChild(pcontainer);
    card.appendChild(products);
    buildProductCards(pcontainer, 'rcp-spec-check', updateMultiSummary);

    // 小計
    const subtotal = document.createElement('div');
    subtotal.className = 'rcp-subtotal hidden';
    const slabel = document.createElement('span');
    slabel.className = 'label';
    slabel.appendChild(document.createTextNode('小計 '));
    const note = document.createElement('span');
    note.className = 'discount-note';
    slabel.appendChild(note);
    const samount = document.createElement('span');
    samount.className = 'amount';
    samount.textContent = '$0';
    subtotal.appendChild(slabel);
    subtotal.appendChild(samount);
    card.appendChild(subtotal);

    return card;
  }

  function renumberRecipients() {
    const cards = document.querySelectorAll('#recipients-container .recipient-card');
    cards.forEach((card, i) => {
      const title = card.querySelector('.recipient-title');
      if (title) title.textContent = '收件人 ' + (i + 1);
      const removeBtn = card.querySelector('.recipient-remove');
      if (removeBtn) removeBtn.disabled = cards.length <= 1; // 至少留一位
    });
  }

  function addRecipient() {
    const container = document.getElementById('recipients-container');
    if (!container) return;
    container.appendChild(createRecipientCard());
    renumberRecipients();
    applyMultiMode();
    updateMultiSummary();
  }

  function removeRecipient(card) {
    const container = document.getElementById('recipients-container');
    if (!container) return;
    if (container.querySelectorAll('.recipient-card').length <= 1) return;
    card.remove();
    renumberRecipients();
    updateMultiSummary();
  }

  // 切換「大家都一樣 / 每人各自挑」的顯示
  function applyMultiMode() {
    const same = getMultiMode() === 'same';
    const sharedWrap = document.getElementById('multi-shared-wrap');
    if (sharedWrap) sharedWrap.classList.toggle('hidden', !same);
    document.querySelectorAll('#recipients-container .rcp-products').forEach(el => {
      el.classList.toggle('hidden', same);
    });
    const hint = document.getElementById('multi-mode-hint');
    if (hint) {
      hint.textContent = same
        ? '挑一次商品，每位收件人都收到同一份；每張卡只要填地址即可。'
        : '每位收件人各自挑選自己的商品（可不一樣）。';
    }
  }

  // 重算每位收件人小計 + 整單摘要
  function updateMultiSummary() {
    const itemsEl = document.getElementById('multi-summary-items');
    const summaryEl = document.getElementById('multi-summary');
    const totalEl = document.getElementById('multi-summary-total');
    if (!itemsEl || !summaryEl || !totalEl) return;

    const mode = getMultiMode();
    const sharedItems = readPickerItems(document.getElementById('multi-shared-container'), 'shared-spec-check');
    const cards = Array.from(document.querySelectorAll('#recipients-container .recipient-card'));

    itemsEl.innerHTML = '';
    let grandGross = 0;
    let grandDiscount = 0;
    let anyItems = false;

    cards.forEach((card, idx) => {
      const items = mode === 'same' ? sharedItems : readPickerItems(card, 'rcp-spec-check');
      const gross = items.reduce((s, it) => s + it.amount, 0);
      const discount = computeDiscount(items);
      const net = gross - discount;
      if (items.length > 0) anyItems = true;
      grandGross += gross;
      grandDiscount += discount;

      // 卡內小計
      const sub = card.querySelector('.rcp-subtotal');
      if (sub) {
        sub.classList.toggle('hidden', items.length === 0);
        const amt = sub.querySelector('.amount');
        if (amt) amt.textContent = '$' + net.toLocaleString();
        const dnote = sub.querySelector('.discount-note');
        if (dnote) dnote.textContent = discount > 0 ? '（折 −$' + discount.toLocaleString() + '）' : '';
      }

      // 摘要列（每位一列）
      const nameInput = card.querySelector('.rcp-name');
      const name = nameInput ? nameInput.value.trim() : '';
      const count = items.reduce((s, it) => s + it.qty, 0);
      const line = document.createElement('div');
      line.className = 'summary-line';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = '收件人 ' + (idx + 1) + (name ? '（' + name + '）' : '') + ' ×' + count + ' 箱';
      const amountSpan = document.createElement('span');
      amountSpan.className = 'summary-line-amount';
      amountSpan.textContent = '$' + gross.toLocaleString();
      line.appendChild(labelSpan);
      line.appendChild(amountSpan);
      itemsEl.appendChild(line);
    });

    if (grandDiscount > 0) {
      const line = document.createElement('div');
      line.className = 'summary-line is-discount';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = '兩箱折扣（各收件人合計）';
      const amountSpan = document.createElement('span');
      amountSpan.className = 'summary-line-amount';
      amountSpan.textContent = '−$' + grandDiscount.toLocaleString();
      line.appendChild(labelSpan);
      line.appendChild(amountSpan);
      itemsEl.appendChild(line);
    }

    totalEl.textContent = '$' + (grandGross - grandDiscount).toLocaleString();
    summaryEl.classList.toggle('hidden', !anyItems);
  }

  function collectMultiData() {
    const mode = getMultiMode();
    const sharedItems = readPickerItems(document.getElementById('multi-shared-container'), 'shared-spec-check');
    const cards = Array.from(document.querySelectorAll('#recipients-container .recipient-card'));

    const recipients = cards.map(card => {
      const val = sel => {
        const el = card.querySelector(sel);
        return el ? el.value.trim() : '';
      };
      const items = mode === 'same'
        ? sharedItems.map(it => Object.assign({}, it))
        : readPickerItems(card, 'rcp-spec-check');
      return {
        name: val('.rcp-name'),
        phone: val('.rcp-phone'),
        address: val('.rcp-address'),
        items: items,
      };
    });

    const deliveryEl = document.querySelector('input[name="multi-delivery-time"]:checked');

    return {
      mode,
      buyerName: document.getElementById('multi-buyer-name').value.trim(),
      buyerPhone: document.getElementById('multi-buyer-phone').value.trim(),
      buyerAddress: document.getElementById('multi-buyer-address').value.trim(),
      recipients,
      deliveryTime: deliveryEl ? deliveryEl.value : '不指定',
      bankCode: document.getElementById('multi-bank-code').value.trim(),
      note: document.getElementById('multi-order-note').value.trim(),
    };
  }

  function validateMultiData(data) {
    const errors = [];
    if (!data.buyerName) errors.push('請填寫訂購人姓名');
    if (!data.buyerPhone) errors.push('請填寫訂購人電話');
    if (!data.buyerAddress) errors.push('請填寫訂購人地址');

    if (data.recipients.length === 0) {
      errors.push('請至少新增一位收件人');
    }
    data.recipients.forEach((r, i) => {
      const tag = '收件人 ' + (i + 1);
      if (!r.name) errors.push(tag + '：請填姓名');
      if (!r.phone) errors.push(tag + '：請填電話');
      if (!r.address) errors.push(tag + '：請填地址');
      if (data.mode === 'custom' && r.items.length === 0) errors.push(tag + '：請選擇商品');
    });

    if (data.mode === 'same') {
      const shared = readPickerItems(document.getElementById('multi-shared-container'), 'shared-spec-check');
      if (shared.length === 0) errors.push('請先在上方挑選要分送的商品');
    }

    // 總列數對齊後端 MAX_ITEMS（40）
    const totalItems = data.recipients.reduce((s, r) => s + r.items.length, 0);
    if (totalItems > 40) errors.push('品項列數過多（最多 40 列），請拆成兩張單');

    if (!data.bankCode) errors.push('請先完成匯款，並填寫匯款後五碼');
    else if (!/^\d{5}$/.test(data.bankCode)) errors.push('匯款後五碼需為 5 位數字');

    return errors;
  }

  function showMultiError(message) {
    const errorEl = document.getElementById('multi-order-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function requestMultiConfirm() {
    document.getElementById('multi-order-error').classList.add('hidden');
    const data = collectMultiData();
    const errors = validateMultiData(data);
    if (errors.length > 0) {
      showMultiError(errors.join('、'));
      return;
    }
    pendingSubmit = submitMultiOrder;
    openMultiConfirmModal(data);
  }

  function openMultiConfirmModal(data) {
    const specLabels = { '5': '五斤', '10': '十斤', '20': '二十斤' };
    const itemsEl = document.getElementById('confirm-items');
    itemsEl.innerHTML = '';

    let grand = 0;
    data.recipients.forEach((r, idx) => {
      const block = document.createElement('div');
      block.className = 'modal-recipient';

      const nameP = document.createElement('p');
      nameP.className = 'modal-recipient-name';
      nameP.textContent = '收件人 ' + (idx + 1) + '：' + r.name + '（' + r.phone + '）';
      block.appendChild(nameP);

      const addrP = document.createElement('p');
      addrP.className = 'modal-recipient-addr';
      addrP.textContent = r.address;
      block.appendChild(addrP);

      r.items.forEach(it => {
        const row = document.createElement('div');
        row.className = 'modal-item';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = it.product + ' ' + (specLabels[it.spec] || it.spec) + ' ×' + it.qty + ' (箱)';
        const amount = document.createElement('span');
        amount.className = 'amount';
        amount.textContent = '$' + it.amount.toLocaleString();
        row.appendChild(name);
        row.appendChild(amount);
        block.appendChild(row);
      });

      const gross = r.items.reduce((s, it) => s + it.amount, 0);
      const discount = computeDiscount(r.items);
      const net = gross - discount;
      grand += net;

      const subRow = document.createElement('div');
      subRow.className = 'modal-item modal-subtotal';
      const subName = document.createElement('span');
      subName.className = 'name';
      subName.textContent = discount > 0 ? '小計（折 −$' + discount.toLocaleString() + '）' : '小計';
      const subAmount = document.createElement('span');
      subAmount.className = 'amount';
      subAmount.textContent = '$' + net.toLocaleString();
      subRow.appendChild(subName);
      subRow.appendChild(subAmount);
      block.appendChild(subRow);

      itemsEl.appendChild(block);
    });

    setText('confirm-total', '$' + grand.toLocaleString());
    fillModalLines('confirm-buyer', [data.buyerName, data.buyerPhone, data.buyerAddress]);
    fillModalLines('confirm-receiver', ['分送 ' + data.recipients.length + ' 位收件人（明細見上方品項）']);
    setText('confirm-delivery', data.deliveryTime);
    setText('confirm-bank-code', data.bankCode);

    const noteSection = document.getElementById('confirm-note-section');
    if (data.note) {
      setText('confirm-note', data.note);
      noteSection.classList.remove('hidden');
    } else {
      noteSection.classList.add('hidden');
    }

    const modal = document.getElementById('confirm-modal');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('confirm-cancel-btn').focus(), 50);
  }

  async function submitMultiOrder() {
    const errorEl = document.getElementById('multi-order-error');
    errorEl.classList.add('hidden');

    const data = collectMultiData();
    const errors = validateMultiData(data);
    if (errors.length > 0) {
      showMultiError(errors.join('、'));
      return;
    }

    const btn = document.getElementById('multi-submit-btn');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    showSubmitLoader();

    // 攤平：每位收件人的每個品項各一筆，逐筆附上該收件人資訊
    const items = [];
    data.recipients.forEach(r => {
      r.items.forEach(it => {
        items.push({
          product: it.product,
          spec: it.spec,
          qty: it.qty,
          receiverName: r.name,
          receiverPhone: r.phone,
          receiverAddress: r.address,
        });
      });
    });

    const first = data.recipients[0];
    const payload = {
      action: 'order',
      buyerName: data.buyerName,
      buyerPhone: data.buyerPhone,
      buyerAddress: data.buyerAddress,
      // 後端必填欄位回退用第一位收件人；真正依據是逐筆 items 各自帶的收件人
      receiverName: first.name,
      receiverPhone: first.phone,
      receiverAddress: first.address,
      deliveryTime: data.deliveryTime,
      bankCode: data.bankCode,
      note: data.note,
      items: items,
    };

    try {
      const res = await fetchWithTimeout(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // 同訂購流程，避開 CORS preflight
        body: JSON.stringify(payload),
        redirect: 'follow',
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error || '送出失敗');

      persistBuyer(data.buyerName, data.buyerPhone, data.buyerAddress);
      showSuccess(json.orderId, json.total);
    } catch (err) {
      console.error('送出分送訂單失敗:', err);
      showMultiError(err.name === 'AbortError'
        ? '送出逾時，請稍後再試'
        : (err.message || '送出失敗，請稍後再試'));
    } finally {
      hideSubmitLoader();
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  // 取消某商品選單的所有勾選（重置用）
  function clearPicker(scopeEl, scopeClass) {
    if (!scopeEl) return;
    scopeEl.querySelectorAll('input.' + scopeClass + ':checked').forEach(cb => {
      cb.checked = false;
      const row = cb.closest('.spec-row');
      if (row) {
        const qc = row.querySelector('.qty-control');
        if (qc) qc.classList.remove('visible');
        const qi = row.querySelector('.qty-input');
        if (qi) qi.value = '1';
      }
    });
  }

  function resetMultiForm() {
    if (!multiBuilt) return; // 分送多人分頁尚未開啟過，無需重置
    const noteEl = document.getElementById('multi-order-note');
    if (noteEl) noteEl.value = '';
    const codeEl = document.getElementById('multi-bank-code');
    if (codeEl) codeEl.value = '';

    clearPicker(document.getElementById('multi-shared-container'), 'shared-spec-check');

    const container = document.getElementById('recipients-container');
    if (container) {
      container.innerHTML = '';
      recipientSeq = 0;
      container.appendChild(createRecipientCard());
      renumberRecipients();
    }

    const sameRadio = document.querySelector('input[name="multi-mode"][value="same"]');
    if (sameRadio) sameRadio.checked = true;
    const defaultDelivery = document.querySelector('input[name="multi-delivery-time"][value="不指定"]');
    if (defaultDelivery) defaultDelivery.checked = true;
    const errEl = document.getElementById('multi-order-error');
    if (errEl) errEl.classList.add('hidden');

    applyMultiMode();
    updateMultiSummary();
  }

  // 首次切到分送多人分頁時才建（商品已載入才建，避免初始就在隱藏分頁多出商品卡）
  function ensureMultiBuilt() {
    if (multiBuilt) return;
    if (!productsData || productsData.length === 0) return; // 商品尚未載入，待下次切換再建
    initMultiTab();
    multiBuilt = true;
  }

  // 初始化分送多人分頁（建共用商品選單 + 第一張收件人卡）
  function initMultiTab() {
    const sharedContainer = document.getElementById('multi-shared-container');
    if (sharedContainer) buildProductCards(sharedContainer, 'shared-spec-check', updateMultiSummary);

    const container = document.getElementById('recipients-container');
    if (container && container.querySelectorAll('.recipient-card').length === 0) {
      container.appendChild(createRecipientCard());
      renumberRecipients();
    }
    applyMultiMode();
    updateMultiSummary();
  }

})();
