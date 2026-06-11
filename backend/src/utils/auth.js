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

function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: EXPIRES() });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
