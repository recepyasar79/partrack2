import { test, expect } from '@playwright/test';

test.describe('Auth - Mobile', () => {
  test('güvenlik kullanıcısı daire ekleyemez', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Kullanıcı adı').fill('guvenlik');
    await page.getByPlaceholder('Şifre').fill('Guvenlik123!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await page.waitForURL('**/');

    await page.goto('/daireler');

    const ekleButon = page.getByRole('button', { name: /yeni daire/i });
    const isVisible = await ekleButon.isVisible().catch(() => false);
    if (isVisible) {
      await ekleButon.click();
      await expect(page.getByText('Bu işlem için yetkiniz yok')).toBeVisible();
    }
  });

  test('login olmadan korunan sayfalara erişilemez', async ({ page }) => {
    await page.goto('/daireler');
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');

    await page.goto('/kontrol');
    await page.waitForURL('**/login');
    expect(page.url()).toContain('/login');
  });
});

test.describe('Auth - Desktop', () => {
  test('yanlış şifre ile hata mesajı görünür', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Kullanıcı adı').fill('admin');
    await page.getByPlaceholder('Şifre').fill('YanlisSifre1!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await expect(page.getByText(/hatalı/i)).toBeVisible();
  });

  test('doğru credentials ile giriş başarılı', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Kullanıcı adı').fill('admin');
    await page.getByPlaceholder('Şifre').fill('AdminPass1!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await page.waitForURL('**/');
    expect(page.url()).not.toContain('/login');
  });
});
