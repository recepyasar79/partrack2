const request = require('supertest');
const { hashPassword, signToken } = require('../src/utils/auth');
const db = require('../src/db');
const app = require('../src/server');

function makeToken(payload) {
  return signToken(payload);
}

async function createTestUser(overrides = {}) {
  const hash = await hashPassword(overrides.sifre || 'TestPass123!');
  const [user] = await db('users')
    .insert({
      kullanici_adi: overrides.kullanici_adi || 'testuser',
      sifre_hash: hash,
      rol: overrides.rol || 'guvenlik',
      aktif: overrides.aktif !== undefined ? overrides.aktif : true,
    })
    .returning('*');
  return user;
}

async function createTestDaire(overrides = {}) {
  const daire_no = overrides.daire_no || 'A1';
  const blok = daire_no[0];
  const sira_no = parseInt(daire_no.slice(1), 10);
  const [daire] = await db('daireler')
    .insert({
      daire_no,
      blok,
      sira_no,
      sahip_ad: overrides.sahip_ad || 'Test Sahip',
      sahip_tel: overrides.sahip_tel || '05551234567',
      kvkk_riza: true,
      kvkk_riza_tarihi: db.fn.now(),
      bildirim_opt_in: overrides.bildirim_opt_in !== undefined ? overrides.bildirim_opt_in : true,
      aktif: true,
    })
    .returning('*');
  return daire;
}

async function createTestArac(overrides = {}) {
  const [arac] = await db('araclar')
    .insert({
      daire_id: overrides.daire_id,
      plaka: overrides.plaka || '34ABC123',
      aktif: true,
    })
    .returning('*');
  return arac;
}

module.exports = {
  app,
  request,
  db,
  makeToken,
  createTestUser,
  createTestDaire,
  createTestArac,
};
