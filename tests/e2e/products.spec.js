// @ts-check
import { test, expect } from '@playwright/test';
import { mockGasApi, EMPTY_PRODUCTS_RESPONSE } from '../fixtures/mock-api.js';

test.describe('商品載入與渲染', () => {
  test('載入完成後顯示商品 + 設定資訊', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');

    // 載入蓋版會在資料 ready 後消失
    await expect(page.locator('#page-loader')).toBeHidden({ timeout: 5000 });

    // 三項商品都應該渲染（含售罄）
    await expect(page.getByRole('heading', { name: '愛文芒果' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '金煌芒果' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '土芒果' })).toBeVisible();

    // 售罄商品有「已售罄」徽章與 sold-out class
    const soldCard = page.locator('.product-card.sold-out');
    await expect(soldCard).toContainText('已售罄');

    // 公告 / 稀缺資訊 / 銀行帳號渲染
    await expect(page.locator('#announcement')).toContainText('產季預計 6 月');
    await expect(page.locator('#scarcity-info')).toContainText('採收期');
    await expect(page.locator('#bank-account-display')).toHaveText('012-345678-901234');
  });

  test('未填價格的規格不出現', async ({ page }) => {
    await mockGasApi(page);
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();

    // 金煌芒果只有 10 / 20，不該有 5（五斤）規格 checkbox
    const jinhuangCard = page.locator('.product-card').filter({ hasText: '金煌芒果' });
    await expect(jinhuangCard.locator('input.spec-check[data-spec="5"]')).toHaveCount(0);
    await expect(jinhuangCard.locator('input.spec-check[data-spec="10"]')).toHaveCount(1);
    await expect(jinhuangCard.locator('input.spec-check[data-spec="20"]')).toHaveCount(1);
  });

  test('API 失敗時顯示錯誤提示與重新整理按鈕', async ({ page }) => {
    await page.route('https://script.google.com/**', (route) => route.abort());
    await page.goto('/');

    await expect(page.locator('#products-error')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('#products-retry')).toBeVisible();
  });

  test('沒有商品時不會壞掉', async ({ page }) => {
    await mockGasApi(page, { productsResponse: EMPTY_PRODUCTS_RESPONSE });
    await page.goto('/');
    await expect(page.locator('#page-loader')).toBeHidden();
    await expect(page.locator('#products-container')).toBeEmpty();
  });
});
