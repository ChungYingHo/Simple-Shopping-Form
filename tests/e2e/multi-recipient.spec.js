// @ts-check
import { test, expect } from '@playwright/test';
import { mockGasApi } from '../fixtures/mock-api.js';

// 取得某商品選單範圍(scope)內、指定商品+規格的那一列 spec-row
function pickerRow(scope, product, spec) {
  return scope
    .locator('.product-card', { hasText: product })
    .locator('.spec-row', { has: scope.page().locator(`input.spec-check[data-spec="${spec}"]`) });
}

async function pick(scope, product, spec, qty = 1) {
  const row = pickerRow(scope, product, spec);
  await row.locator('input.spec-check').check();
  if (qty !== 1) {
    const qtyInput = row.locator('.qty-input');
    await qtyInput.fill(String(qty));
    await qtyInput.blur();
  }
}

async function fillRecipient(page, idx, { name, phone, address }) {
  const card = page.locator('.recipient-card').nth(idx);
  await card.locator('.rcp-name').fill(name);
  await card.locator('.rcp-phone').fill(phone);
  await card.locator('.rcp-address').fill(address);
  return card;
}

async function fillMultiBuyer(page) {
  await page.locator('#multi-buyer-name').fill('王訂購');
  await page.locator('#multi-buyer-phone').fill('0911222333');
  await page.locator('#multi-buyer-address').fill('高雄市三民區建工路100號');
}

async function openMulti(page, opts = {}) {
  await mockGasApi(page, opts);
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await expect(page.locator('#page-loader')).toBeHidden();
  await page.locator('#tab-multi').click();
  await expect(page.locator('#section-multi')).toBeVisible();
}

const R1 = { name: '李大華', phone: '0912345678', address: '台北市大安區忠孝東路100號' };
const R2 = { name: '陳小美', phone: '0922333444', address: '台中市西區民生路50號' };

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test.describe('分送多人', () => {
  test('開啟分頁：預設「大家都一樣」，共用商品選單與一張收件人卡出現', async ({ page }) => {
    await openMulti(page);
    // 共用商品選單可見、收件人卡至少一張
    await expect(page.locator('#multi-shared-wrap')).toBeVisible();
    await expect(page.locator('#multi-shared-container .product-card').first()).toBeVisible();
    await expect(page.locator('.recipient-card')).toHaveCount(1);
    // 只有一張卡時不顯示移除鈕
    await expect(page.locator('.recipient-card .recipient-remove')).toBeDisabled();
  });

  test('大家都一樣：2 位收件人各 1 箱 → 無折扣，合計為兩份相加', async ({ page }) => {
    await openMulti(page);
    const shared = page.locator('#multi-shared-container');
    await pick(shared, '愛文芒果', '10', 1); // 850

    await page.locator('#add-recipient-btn').click();
    await expect(page.locator('.recipient-card')).toHaveCount(2);

    // 每人 1 箱、分屬不同地址 → 各自不滿 2 箱 → 無折扣
    await expect(page.locator('#multi-summary-items .is-discount')).toHaveCount(0);
    await expect(page.locator('#multi-summary-total')).toHaveText('$1,700'); // 850 × 2
  });

  test('大家都一樣：每人 2 箱 → 折扣每位各算（2 人共 −$200）', async ({ page }) => {
    await openMulti(page);
    const shared = page.locator('#multi-shared-container');
    await pick(shared, '愛文芒果', '10', 2); // 1700/人，滿 2 箱折 100 → 1600/人

    await page.locator('#add-recipient-btn').click();
    await expect(page.locator('.recipient-card')).toHaveCount(2);

    const discount = page.locator('#multi-summary-items .is-discount');
    await expect(discount).toHaveCount(1);
    await expect(discount).toContainText('−$200'); // 每人 −100，兩人 −200
    await expect(page.locator('#multi-summary-total')).toHaveText('$3,200'); // 1600 × 2
  });

  test('每人各自挑：跨收件人同規格不合併折扣（各 1 箱十斤 → 不折）', async ({ page }) => {
    await openMulti(page);
    await page.locator('label.radio-card', { hasText: '每人各自挑' }).click();

    await page.locator('#add-recipient-btn').click();
    await expect(page.locator('.recipient-card')).toHaveCount(2);

    const r1 = page.locator('.recipient-card').nth(0);
    const r2 = page.locator('.recipient-card').nth(1);
    await pick(r1, '愛文芒果', '10', 1); // 850
    await pick(r2, '愛文芒果', '10', 1); // 850

    // 若錯誤地整單合併，2 箱十斤會折 100；正確應為各自 1 箱 → 不折
    await expect(page.locator('#multi-summary-items .is-discount')).toHaveCount(0);
    await expect(page.locator('#multi-summary-total')).toHaveText('$1,700');
  });

  test('完整送出（大家都一樣）：payload 逐筆帶各自收件人，頂層收件人為第一位', async ({ page }) => {
    let payload = null;
    await openMulti(page, {
      onOrderRequest: (req) => { payload = JSON.parse(req.postData() || '{}'); },
      orderResponse: { success: true, orderId: 'MG-20260607-0007', total: 1700 },
    });

    const shared = page.locator('#multi-shared-container');
    await pick(shared, '愛文芒果', '10', 1);

    await page.locator('#add-recipient-btn').click();
    await fillRecipient(page, 0, R1);
    await fillRecipient(page, 1, R2);
    await fillMultiBuyer(page);
    await page.locator('#multi-bank-code').fill('54321');

    await page.locator('#multi-submit-btn').click();

    // 確認 modal 顯示分送資訊
    const modal = page.locator('#confirm-modal');
    await expect(modal).toHaveClass(/show/);
    await expect(modal).toContainText('分送 2 位收件人');
    await expect(modal).toContainText('李大華');
    await expect(modal).toContainText('陳小美');
    await page.locator('#confirm-submit-btn').click();

    await expect(page.locator('#section-success')).toBeVisible();
    await expect(page.locator('#success-order-id')).toHaveText('MG-20260607-0007');

    // payload 檢查
    expect(payload.action).toBe('order');
    expect(payload.buyerName).toBe('王訂購');
    // 頂層收件人 = 第一位（給後端必填回退用）
    expect(payload.receiverName).toBe('李大華');
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toEqual({
      product: '愛文芒果', spec: '10', qty: 1,
      receiverName: '李大華', receiverPhone: '0912345678', receiverAddress: '台北市大安區忠孝東路100號',
    });
    expect(payload.items[1]).toEqual({
      product: '愛文芒果', spec: '10', qty: 1,
      receiverName: '陳小美', receiverPhone: '0922333444', receiverAddress: '台中市西區民生路50號',
    });
    // 不可夾帶價格
    expect(payload.items[0]).not.toHaveProperty('price');
    expect(payload.items[0]).not.toHaveProperty('amount');
  });

  test('完整送出（每人各自挑）：不同收件人不同商品，逐筆對應正確', async ({ page }) => {
    let payload = null;
    await openMulti(page, {
      onOrderRequest: (req) => { payload = JSON.parse(req.postData() || '{}'); },
      orderResponse: { success: true, orderId: 'MG-20260607-0008', total: 2250 },
    });

    await page.locator('label.radio-card', { hasText: '每人各自挑' }).click();
    await page.locator('#add-recipient-btn').click();

    const r1 = page.locator('.recipient-card').nth(0);
    const r2 = page.locator('.recipient-card').nth(1);
    await pick(r1, '愛文芒果', '10', 1); // 850
    await pick(r2, '金煌芒果', '10', 2); // 1500，滿 2 箱折 100 → 1400

    await fillRecipient(page, 0, R1);
    await fillRecipient(page, 1, R2);
    await fillMultiBuyer(page);
    await page.locator('#multi-bank-code').fill('54321');

    // r2 折扣顯示於摘要
    await expect(page.locator('#multi-summary-items .is-discount')).toContainText('−$100');
    await expect(page.locator('#multi-summary-total')).toHaveText('$2,250'); // 850 + 1400

    await page.locator('#multi-submit-btn').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/show/);
    await page.locator('#confirm-submit-btn').click();
    await expect(page.locator('#section-success')).toBeVisible();

    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toEqual({
      product: '愛文芒果', spec: '10', qty: 1,
      receiverName: '李大華', receiverPhone: '0912345678', receiverAddress: '台北市大安區忠孝東路100號',
    });
    expect(payload.items[1]).toEqual({
      product: '金煌芒果', spec: '10', qty: 2,
      receiverName: '陳小美', receiverPhone: '0922333444', receiverAddress: '台中市西區民生路50號',
    });
  });

  test('驗證：缺收件人欄位時不開 modal、顯示錯誤', async ({ page }) => {
    await openMulti(page);
    const shared = page.locator('#multi-shared-container');
    await pick(shared, '愛文芒果', '10', 1);
    await fillMultiBuyer(page);
    await page.locator('#multi-bank-code').fill('54321');
    // 收件人地址留空
    await page.locator('#multi-submit-btn').click();

    await expect(page.locator('#confirm-modal')).not.toHaveClass(/show/);
    await expect(page.locator('#multi-order-error')).toBeVisible();
    await expect(page.locator('#multi-order-error')).toContainText('收件人 1');
  });

  test('模式切換：custom 時隱藏共用商品、顯示每張卡的商品選單', async ({ page }) => {
    await openMulti(page);
    await expect(page.locator('#multi-shared-wrap')).toBeVisible();
    await expect(page.locator('.recipient-card .rcp-products').first()).toBeHidden();

    await page.locator('label.radio-card', { hasText: '每人各自挑' }).click();
    await expect(page.locator('#multi-shared-wrap')).toBeHidden();
    await expect(page.locator('.recipient-card .rcp-products').first()).toBeVisible();
  });
});
