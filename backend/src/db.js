const knex = require('knex');
const { types } = require('pg');
const config = require('../knexfile');

// DATE (OID 1082) kolonlarını JS Date'e çevirme, düz 'YYYY-MM-DD' string
// olarak geçir. Varsayılan davranış '2026-06-12' değerini sunucu saat
// diliminde gece yarısı Date objesi yapıyor; JSON'a serileşince
// '2026-06-11T21:00:00.000Z' oluyor ve frontend tarihi 1 gün geri
// gösteriyordu (raporlardaki "12.06 kayıtları 11.06 görünüyor" bug'ı).
// DATE'in saat dilimi kavramı yok — string en doğru temsil.
types.setTypeParser(1082, (v) => v);

const env = process.env.NODE_ENV || 'development';
const db = knex(config[env]);

module.exports = db;
