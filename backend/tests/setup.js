process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
process.env.BOOTSTRAP_ADMIN_USER = 'testadmin';
process.env.BOOTSTRAP_ADMIN_PASS = 'TestPass123!';

jest.setTimeout(30000);
