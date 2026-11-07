/**
 * Copia los datos de la base SQLite anterior (prisma/dev.db) a la base Postgres de DATABASE_URL.
 *
 * Uso (una sola vez, con las migraciones de Postgres ya aplicadas):
 *   npm run db:import-sqlite
 *
 * Seguridad de los datos:
 * - Es idempotente: si un registro ya existe (mismo id), no se modifica ni se duplica.
 * - Conserva ids, relaciones, fechas y hashes de contraseña (los usuarios siguen entrando
 *   con su misma contraseña).
 * - En SQLite el dueño estaba en Business.userId; en Postgres está en User.businessId.
 *   El script traduce esa relación. Un usuario que no tenía negocio recibe uno
 *   pendiente de configurar (igual que la migración 1_owner_on_user).
 * - Los negocios sin dueño se importan tal cual y quedan sin cuenta asociada; ver
 *   README de despliegue (asignar dueño) para vincularlos de forma segura.
 */
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
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
  const businesses = rows('Business');
  const ownerOf = new Map(businesses.filter((b) => b.userId).map((b) => [b.userId, b.id]));

  // 1) Negocios (sin dueño todavía: la relación vive en User.businessId)
  await insert('business', businesses, (b) => ({
    id: b.id,
    name: b.name,
    businessType: b.businessType ?? '',
    productType: b.productType ?? '',
    defaultUnit: b.defaultUnit ?? 'Unidad',
    useCategories: bool(b.useCategories),
    useProductCodes: bool(b.useProductCodes),
    useMinStock: bool(b.useMinStock),
    minStock: b.minStock,
    useExpirationDates: bool(b.useExpirationDates),
    theme: b.theme,
    createdAt: date(b.createdAt),
    updatedAt: date(b.updatedAt),
  }));

  // 2) Usuarios, cada uno con su negocio
  let users = 0;
  for (const u of rows('User')) {
    if (await prisma.user.findUnique({ where: { id: u.id } })) continue;
    let businessId = ownerOf.get(u.id);
    if (!businessId) {
      const pending = await prisma.business.create({ data: { id: crypto.randomUUID(), name: `Negocio de ${u.name}` } });
      businessId = pending.id;
    }
    await prisma.user.create({
      data: {
        id: u.id,
        name: u.name,
        email: u.email,
        passwordHash: u.passwordHash,
        businessId,
        createdAt: date(u.createdAt),
        updatedAt: date(u.updatedAt),
      },
    });
    users++;
  }
  console.log(`user: ${users} copiados`);

  // 3) Inventario de cada negocio
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

  const orphans = await prisma.business.count({ where: { user: null } });
  if (orphans) console.log(`Aviso: ${orphans} negocio(s) sin cuenta asociada (ver "Asignar dueño").`);
  console.log('Listo.');
})()
  .catch((e) => {
    console.error('Error al importar:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
