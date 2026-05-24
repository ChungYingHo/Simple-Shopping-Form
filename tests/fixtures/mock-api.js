// @ts-check
// 共用 GAS API mock
// script.js 的 API_URL 指向 script.google.com/macros/s/**，我們攔截整段 host

const GAS_HOST_PATTERN = 'https://script.google.com/**';

export const SAMPLE_PRODUCTS_RESPONSE = {
  success: true,
  data: {
    products: [
      { name: '愛文芒果', prices: { '5': 450, '10': 850, '20': 1600 }, soldOut: false },
      { name: '金煌芒果', prices: { '10': 750, '20': 1400 }, soldOut: false },
      { name: '土芒果', prices: { '5': 350 }, soldOut: true },
    ],
    settings: {
      bankName: '台灣銀行',
      bankBranch: '屏東分行',
      accountNumber: '012-345678-901234',
      accountHolder: '王大芒',
      announcement: '今年產季預計 6 月開始出貨',
      paymentNote: '請於下單後三日內完成匯款',
      scarcity: '採收期：6/15–7/30 · 限量',
    },
  },
};

export const EMPTY_PRODUCTS_RESPONSE = {
  success: true,
  data: { products: [], settings: {} },
};

/**
 * 攔截 GAS API，根據 query / method 回傳預設或自訂回應。
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {object} [opts.productsResponse]   - GET ?action=products 的回應 body
 * @param {object} [opts.queryResponse]      - GET ?action=query 的回應 body
 * @param {object} [opts.orderResponse]      - POST action=order 的回應 body
 * @param {(req: import('@playwright/test').Request) => void} [opts.onOrderRequest]
 *        - POST action=order 收到時的 callback（給 assertion 用）
 */
export async function mockGasApi(page, opts = {}) {
  const productsResponse = opts.productsResponse || SAMPLE_PRODUCTS_RESPONSE;
  const queryResponse = opts.queryResponse || { success: true, data: [] };
  const orderResponse = opts.orderResponse || {
    success: true,
    orderId: 'MG-20260524-0001',
    total: 850,
  };

  await page.route(GAS_HOST_PATTERN, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.searchParams.get('action') === 'products') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(productsResponse),
      });
      return;
    }

    if (method === 'GET' && url.searchParams.get('action') === 'query') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(queryResponse),
      });
      return;
    }

    if (method === 'POST') {
      if (opts.onOrderRequest) opts.onOrderRequest(request);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(orderResponse),
      });
      return;
    }

    // 未預期的請求 → 視為錯誤
    await route.fulfill({ status: 500, body: 'Unhandled mock request' });
  });
}
