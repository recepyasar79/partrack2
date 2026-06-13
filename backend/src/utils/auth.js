const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
const SECRET = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Production'da bilinen bir fallback secret'a SESSİZCE düşmek token
  // sahteciliğine kapı açar — secret kaybolduysa (yanlış deploy, eksik
  // fly secret) uygulama açıkça hata versin.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET env var production ortamında zorunlu.');
  }
  return 'dev-insecure-secret';
};
const EXPIRES = () => process.env.JWT_EXPIRES_IN || '7d';

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Algoritma açıkça HS256'ya pinlenir. Pin olmadan jwt.verify token
// header'ındaki `alg`'ı kabul eder → algoritma karıştırma / `alg:none`
// saldırılarına kapı aralar. Simetrik secret kullandığımız için sign +
// verify her zaman HS256.
const JWT_ALG = 'HS256';

function signToken(payload) {
  return jwt.sign(payload, SECRET(), { algorithm: JWT_ALG, expiresIn: EXPIRES() });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET(), { algorithms: [JWT_ALG] });
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
