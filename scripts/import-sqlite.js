/**
 * Copia los datos de la base SQLite local (prisma/dev.db) a la base Postgres de DATABASE_URL.
 * Uso (una sola vez, con la base Postgres ya migrada):
 *   npm run db:import-sqlite
 * Es idempotente: si un registro ya existe (mismo id), lo deja como está.
 */
require('dotenv').config();
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');

const SQLITE_PATH = process.argv[2] || path.join(__dirname, '..', 'prisma', 'dev.db');
const sqlite = new DatabaseSync(SQLITE_PATH, { readOnly: true });
const prisma = new PrismaClient();

const rows = (table) => sqlite.prepare(`SELECT * FROM "${table}"`).all();
const date = (v) => (v == null ? null : new Date(typeof v === 'number' ? v : Date.parse(v)));
const bool = (v) => v === 1 || v === true || v === '1';

async function insert(model, items, map) {
  let created = 0;
  for (const it of items) {
    const exists = await prisma[model].findUnique({ where: { id: it.id } });
    if (exists) continue;
    await prisma[model].create({ data: map(it) });
    created++;
  }
  console.log(`${model}: ${created} copiados (${items.length} en SQLite)`);
}

(async () => {
  console.log('Origen:', SQLITE_PATH);
  // Orden según las relaciones: usuarios → negocios → características/productos → movimientos
  await insert('user', rows('User'), (u) => ({
    id: u.id, name: u.name, email: u.email, passwordHash: u.passwordHash,
    createdAt: date(u.createdAt), updatedAt: date(u.updatedAt),
  }));
  await insert('business', rows('Business'), (b) => ({
    id: b.id, userId: b.userId, name: b.name, businessType: b.businessType, productType: b.productType,
    defaultUnit: b.defaultUnit, useCategories: bool(b.useCategories), useProductCodes: bool(b.useProductCodes),
    useMinStock: bool(b.useMinStock), minStock: b.minStock, useExpirationDates: bool(b.useExpirationDates),
    theme: b.theme, createdAt: date(b.createdAt), updatedAt: date(b.updatedAt),
  }));
  await insert('attribute', rows('Attribute'), (a) => ({
    id: a.id, businessId: a.businessId, name: a.name, dataType: a.dataType, isRequired: bool(a.isRequired),
    options: a.options, createdAt: date(a.createdAt), updatedAt: date(a.updatedAt),
  }));
  await insert('product', rows('Product'), (p) => ({
    id: p.id, businessId: p.businessId, name: p.name, sku: p.sku, category: p.category,
    basePrice: p.basePrice, stockQuantity: p.stockQuantity, imageUrl: p.imageUrl,
    dynamicAttributes: p.dynamicAttributes, createdAt: date(p.createdAt), updatedAt: date(p.updatedAt),
  }));
  await insert('movement', rows('Movement'), (m) => ({
    id: m.id, productId: m.productId, type: m.type, quantity: m.quantity, note: m.note, date: date(m.date),
  }));
  console.log('Listo.');
})()
  .catch((e) => {
    console.error('Error al importar:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
