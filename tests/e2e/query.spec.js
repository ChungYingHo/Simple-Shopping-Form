// @ts-check
import { test, expect } from '@playwright/test';
import { mockGasApi } from '../fixtures/mock-api.js';

const MASKED_ORDER = {
  orderId: 'MG-20260524-0001',
  time: '2026/05/24 14:30',
  buyerName: '王*明',
  buyerPhone: '0912***678',
  buyerAddress: '台北市大安區****',
  receiverName: '王*明',
  receiverPhone: '0912***678',
  receiverAddress: '台北市大安區****',
  paymentMethod: '匯款',
  deliveryTime: '上午',
  items: [
    { product: '愛文芒果', spec: '十斤', qty: 2, amount: 1700, status: '物流運送中', shippingNumber: 'TC1234567890' },
    { product: '金煌芒果', spec: '二十斤', qty: 1, amount: 1400, status: '訂單已確認', shippingNumber: '' },
  ],
  total: 3100,
};

test.describe('查詢訂單', () => {
  test('未輸入電話 → 即時錯誤', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();

    await page.locator('#tab-query').click();
    await page.locator('#query-btn').click();

    await expect(page.locator('#query-error')).toContainText('請輸入電話號碼');
  });

  test('查無資料 → 顯示 empty state', async ({ page }) => {
    await mockGasApi(page, {
      queryResponse: { success: true, data: [] },
    });
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();

    await page.locator('#tab-query').click();
    await page.locator('#query-phone').fill('0900000000');
    await page.locator('#query-btn').click();

    await expect(page.locator('#query-empty')).toBeVisible();
  });

  test('有資料 → 顯示訂單卡片、品項、物流追蹤', async ({ page }) => {
    await mockGasApi(page, {
      queryResponse: { success: true, data: [MASKED_ORDER] },
    });
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();

    await page.locator('#tab-query').click();
    await page.locator('#query-phone').fill('0912345678');
    await page.locator('#query-btn').click();

    const card = page.locator('.order-card').first();
    await expect(card).toContainText('MG-20260524-0001');
    await expect(card).toContainText('愛文芒果');
    await expect(card).toContainText('金煌芒果');
    await expect(card).toContainText('$3,100');

    // PII 應為遮罩格式（驗證遮罩有被前端原樣顯示）
    await expect(card).toContainText('王*明');
    await expect(card).toContainText('台北市大安區****');

    // 物流運送中的品項應顯示運送編號 + 黑貓查詢連結
    await expect(card).toContainText('TC1234567890');
    await expect(card.locator('a.track-link')).toHaveAttribute('href', /t-cat\.com\.tw/);
  });

  test('整筆訂單品項狀態不同 → 顯示「分批處理中」', async ({ page }) => {
    await mockGasApi(page, {
      queryResponse: { success: true, data: [MASKED_ORDER] },
    });
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();

    await page.locator('#tab-query').click();
    await page.locator('#query-phone').fill('0912345678');
    await page.locator('#query-btn').click();

    const headerBadge = page.locator('.order-card .order-head .status-badge');
    await expect(headerBadge).toHaveText('分批處理中');
  });
});
