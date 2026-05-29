// @ts-check
import { test, expect } from '@playwright/test';
import { mockGasApi } from '../fixtures/mock-api.js';

async function selectMango(page, spec = '10', qty = 1) {
  const card = page.locator('.product-card').filter({ hasText: '愛文芒果' });
  const checkbox = card.locator(`input.spec-check[data-spec="${spec}"]`);
  await checkbox.check();
  if (qty !== 1) {
    const qtyInput = card.locator(`#qtyval-spec-0-${spec}`);
    await qtyInput.fill(String(qty));
    await qtyInput.blur();
  }
}

async function fillBuyer(page) {
  await page.getByLabel('姓名', { exact: false }).first().fill('王小明');
  await page.getByLabel('電話', { exact: false }).first().fill('0912345678');
  await page.getByLabel('地址', { exact: false }).first().fill('台北市大安區忠孝東路 100 號');
}

test.beforeEach(async ({ context }) => {
  // 避免 localStorage 殘留前一輪測試的 buyer 資訊
  await context.clearCookies();
});

test.describe('下單流程', () => {
  test('總額隨數量更新；浮動 bar 出現', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10', 2); // 850 × 2 = 1700，兩箱折 100 → 1600

    await expect(page.locator('#floating-total')).toHaveText('$1,600');
    await expect(page.locator('#floating-bar')).toHaveClass(/show/);
  });

  test('同商品同規格滿 2 箱顯示兩箱折扣，總額扣除 100', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    // 1 箱不折
    await selectMango(page, '10', 1); // 850
    await expect(page.locator('#summary-items .is-discount')).toHaveCount(0);
    await expect(page.locator('#summary-total')).toHaveText('$850');

    // 3 箱：850×3 = 2550，floor(3/2)×100 = 100 折 → 2450
    const qtyInput = page.locator('.product-card').filter({ hasText: '愛文芒果' }).locator('#qtyval-spec-0-10');
    await qtyInput.fill('3');
    await qtyInput.blur();

    const discountLine = page.locator('#summary-items .is-discount');
    await expect(discountLine).toHaveCount(1);
    await expect(discountLine).toContainText('兩箱折扣');
    await expect(discountLine).toContainText('−$100');
    await expect(page.locator('#summary-total')).toHaveText('$2,450');
  });

  test('不同品項但同規格可合併折扣', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    // 愛文十斤×1 (850) + 金煌十斤×1 (750) = 1600，兩箱十斤折 100 → 1500
    await page.locator('.product-card').filter({ hasText: '愛文芒果' })
      .locator('input.spec-check[data-spec="10"]').check();
    await page.locator('.product-card').filter({ hasText: '金煌芒果' })
      .locator('input.spec-check[data-spec="10"]').check();

    const discountLine = page.locator('#summary-items .is-discount');
    await expect(discountLine).toHaveCount(1);
    await expect(discountLine).toContainText('−$100');
    await expect(page.locator('#summary-total')).toHaveText('$1,500');
  });

  test('不同規格不合併折扣', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    // 愛文五斤×1 (450) + 愛文十斤×1 (850) = 1300，規格不同 → 不折
    const aiwen = page.locator('.product-card').filter({ hasText: '愛文芒果' });
    await aiwen.locator('input.spec-check[data-spec="5"]').check();
    await aiwen.locator('input.spec-check[data-spec="10"]').check();

    await expect(page.locator('#summary-items .is-discount')).toHaveCount(0);
    await expect(page.locator('#summary-total')).toHaveText('$1,300');
  });

  test('未填欄位時送出 → 顯示驗證錯誤、不開 modal', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#order-error')).toBeVisible();
    await expect(page.locator('#order-error')).toContainText('請填寫訂購人姓名');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/show/);
  });

  test('匯款後五碼格式錯誤時擋下', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await fillBuyer(page);
    await page.locator('#bank-code').fill('123'); // 太短
    await page.locator('#submit-btn').click();

    await expect(page.locator('#order-error')).toContainText('5 位數字');
  });

  test('完整流程：填表 → 確認 modal → 送出 → 成功頁', async ({ page }) => {
    let orderPayload = null;
    await mockGasApi(page, {
      onOrderRequest: (req) => {
        orderPayload = JSON.parse(req.postData() || '{}');
      },
      orderResponse: {
        success: true,
        orderId: 'MG-20260524-0042',
        total: 850,
      },
    });

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await fillBuyer(page);
    await page.locator('#bank-code').fill('12345');
    await page.locator('#submit-btn').click();

    // 確認 modal 開啟，顯示摘要
    const modal = page.locator('#confirm-modal');
    await expect(modal).toHaveClass(/show/);
    await expect(modal).toContainText('愛文芒果');
    await expect(modal).toContainText('王小明');
    await expect(modal).toContainText('$850');
    await expect(modal).toContainText('12345');

    // 「再檢查一下」可關閉 modal
    await page.locator('#confirm-cancel-btn').click();
    await expect(modal).not.toHaveClass(/show/);
    // 表單還在
    await expect(page.locator('#section-order')).toBeVisible();

    // 再次送出 → 確認送出
    await page.locator('#submit-btn').click();
    await expect(modal).toHaveClass(/show/);
    await page.locator('#confirm-submit-btn').click();

    // 成功頁顯示
    await expect(page.locator('#section-success')).toBeVisible();
    await expect(page.locator('#success-order-id')).toHaveText('MG-20260524-0042');
    await expect(page.locator('#success-total')).toHaveText('$850');

    // POST payload 應含基本欄位、不含 price/amount
    expect(orderPayload.action).toBe('order');
    expect(orderPayload.buyerName).toBe('王小明');
    expect(orderPayload.items).toHaveLength(1);
    expect(orderPayload.items[0]).toEqual({ product: '愛文芒果', spec: '10', qty: 1 });
    expect(orderPayload.items[0]).not.toHaveProperty('price');
    expect(orderPayload.items[0]).not.toHaveProperty('amount');
  });

  test('「同訂購人」勾選時隱藏收件人欄位，取消勾選時顯示', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await expect(page.locator('#receiver-fields')).toBeHidden();
    await page.locator('#same-as-buyer').uncheck();
    await expect(page.locator('#receiver-fields')).toBeVisible();
    await page.locator('#same-as-buyer').check();
    await expect(page.locator('#receiver-fields')).toBeHidden();
  });

  test('Esc 鍵與點背景皆可關閉確認 modal', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await fillBuyer(page);
    await page.locator('#bank-code').fill('12345');

    // Esc 關閉
    await page.locator('#submit-btn').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/show/);

    // 點背景關閉
    await page.locator('#submit-btn').click();
    await expect(page.locator('#confirm-modal')).toHaveClass(/show/);
    await page.locator('#confirm-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#confirm-modal')).not.toHaveClass(/show/);
  });

  test('送出時蓋版顯示，過程中無法再次點擊', async ({ page }) => {
    // 攔截 POST 並延遲回應 800ms，模擬慢速 GAS
    let postCount = 0;
    await page.route('https://script.google.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'GET') {
        const url = new URL(req.url());
        if (url.searchParams.get('action') === 'products') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                products: [{ name: '愛文芒果', prices: { '10': 850 }, soldOut: false }],
                settings: { bankName: '台灣銀行', accountNumber: '012-345' },
              },
            }),
          });
          return;
        }
      }
      if (req.method() === 'POST') {
        postCount += 1;
        await new Promise((r) => setTimeout(r, 800));
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, orderId: 'MG-20260524-0099', total: 850 }),
        });
        return;
      }
      await route.fulfill({ status: 500 });
    });

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await fillBuyer(page);
    await page.locator('#bank-code').fill('12345');
    await page.locator('#submit-btn').click();
    await page.locator('#confirm-submit-btn').click();

    // 蓋版應該立即出現並阻擋互動
    const loader = page.locator('#submit-loader');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('送出訂單中');
    await expect(loader).toHaveAttribute('aria-busy', 'true');

    // 送出按鈕進入 disabled 狀態，無法再觸發
    await expect(page.locator('#submit-btn')).toBeDisabled();

    // 即使用 force 模擬連點，因 disabled + 蓋版攔截，不應產生第二次 POST
    await page.locator('#submit-btn').dispatchEvent('click').catch(() => {});

    // 等送出完成
    await expect(page.locator('#section-success')).toBeVisible({ timeout: 5000 });
    await expect(loader).toBeHidden();
    await expect(loader).toHaveAttribute('aria-busy', 'false');

    // 確認只送出一次（沒有重複觸發）
    expect(postCount).toBe(1);
  });

  test('成功後再下單，訂購人資訊由 localStorage 自動帶入', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await expect(page.locator('#page-loader')).toBeHidden();

    await selectMango(page, '10');
    await fillBuyer(page);
    await page.locator('#bank-code').fill('12345');
    await page.locator('#submit-btn').click();
    await page.locator('#confirm-submit-btn').click();
    await expect(page.locator('#section-success')).toBeVisible();

    // 重新整理（不清 localStorage）
    await page.reload();
    await expect(page.locator('#page-loader')).toBeHidden();

    await expect(page.locator('#buyer-name')).toHaveValue('王小明');
    await expect(page.locator('#buyer-phone')).toHaveValue('0912345678');
    await expect(page.locator('#buyer-address')).toHaveValue('台北市大安區忠孝東路 100 號');
  });
});
