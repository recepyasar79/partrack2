const path = require('path');
const fs = require('fs');

describe('storage', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
    delete process.env.R2_BUCKET;
  });

  test('isR2Configured: env yokken false', () => {
    const { isR2Configured } = require('../src/services/storage');
    expect(isR2Configured()).toBe(false);
  });

  test('isR2Configured: env varken true', () => {
    process.env.R2_ACCOUNT_ID = 'a';
    process.env.R2_ACCESS_KEY_ID = 'b';
    process.env.R2_SECRET_ACCESS_KEY = 'c';
    process.env.R2_BUCKET = 'd';
    const { isR2Configured } = require('../src/services/storage');
    expect(isR2Configured()).toBe(true);
  });

  test('disk modu uploadDir oluşturur', () => {
    const tmpDir = path.join(__dirname, 'tmp_uploads_' + Date.now());
    process.env.UPLOAD_DIR = tmpDir;
    const { buildUpload } = require('../src/services/storage');
    const s = buildUpload();
    expect(s.mode).toBe('disk');
    expect(fs.existsSync(tmpDir)).toBe(true);
    expect(s.publicUrl('foo.jpg')).toBe('/uploads/foo.jpg');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  test('ALLOWED_MIME yalnızca image tipleri içerir', () => {
    const { ALLOWED_MIME } = require('../src/services/storage');
    expect(ALLOWED_MIME).toContain('image/jpeg');
    expect(ALLOWED_MIME).toContain('image/png');
    expect(ALLOWED_MIME).toContain('image/webp');
    expect(ALLOWED_MIME).not.toContain('application/pdf');
  });
});
