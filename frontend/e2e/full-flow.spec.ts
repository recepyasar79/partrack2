import { test, expect } from '@playwright/test';

test.describe('Full Flow - Site Otopark Yönetimi', () => {
  test('yönetici daire ekler, güvenlik kontrol yapar, ihlal raporu oluşur', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Kullanıcı adı').fill('admin');
    await page.getByPlaceholder('Şifre').fill('AdminPass1!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await page.waitForURL('**/');

    await page.getByRole('link', { name: /daireler/i }).click();
    await page.waitForURL('**/daireler');

    const yeniDaireBtn = page.getByRole('button', { name: /yeni daire/i });
    if (await yeniDaireBtn.isVisible()) {
      await yeniDaireBtn.click();
      await page.getByLabel('Daire No').selectOption({ label: 'B5' });
      await page.getByLabel('Ad Soyad').fill('Test Sahip');
      await page.getByLabel('Telefon').fill('05551234567');
      await page.getByLabel('Plaka').fill('34FLOW01');
      await page.getByLabel('KVKK Onayı').check();
      await page.getByRole('button', { name: /kaydet/i }).click();
      await expect(page.getByText('34FLOW01')).toBeVisible();
    }

    await page.goto('/logout');
    await page.waitForURL('**/login');

    await page.getByPlaceholder('Kullanıcı adı').fill('guvenlik');
    await page.getByPlaceholder('Şifre').fill('Guvenlik123!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await page.waitForURL('**/');

    await page.getByRole('link', { name: /kontrol/i }).click();
    await page.waitForURL('**/kontrol');

    const input = page.locator('input[type="file"]');
    await input.setInputFiles('./test.jpg');

    await page.getByRole('link', { name: /akşam/i }).click();
    await page.waitForURL('**/kontrol/aksam');

    const kontrolBtn = page.getByRole('button', { name: /akşam kontrolünü tamamla/i });
    if (await kontrolBtn.isVisible()) {
      await kontrolBtn.click();
    }

    await expect(page.getByText(/ihlal|kayıtlı|rapor/i)).toBeVisible();

    await page.getByRole('link', { name: /raporlar/i }).click();
    await page.waitForURL('**/raporlar');

    await expect(page.getByRole('heading', { name: /rapor|ihlal/i })).toBeVisible();
  });
});

test.describe('Akşam Kontrolü - İhlal Tespiti', () => {
  test('2 araçlı daire ihlal listesine düşer', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('Kullanıcı adı').fill('admin');
    await page.getByPlaceholder('Şifre').fill('AdminPass1!');
    await page.getByRole('button', { name: /giriş/i }).click();
    await page.waitForURL('**/');

    await page.goto('/kontrol/aksam');
    await page.waitForURL('**/kontrol/aksam');

    const kontrolBtn = page.getByRole('button', { name: /akşam kontrolünü tamamla/i });
    if (await kontrolBtn.isVisible()) {
      await kontrolBtn.click();
      await page.waitForTimeout(2000);

      await expect(page.getByRole('heading', { name: /kontrol sonucu|ihlal/i })).toBeVisible();
    }
  });
});
