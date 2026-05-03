const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 10;
const SECRET = () => process.env.JWT_SECRET || 'dev-insecure-secret';
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
