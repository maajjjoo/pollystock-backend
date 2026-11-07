/**
 * Crea la cuenta de un negocio que quedó sin dueño (por ejemplo, tras importar datos antiguos),
 * sin tocar su inventario.
 *
 * Uso:
 *   OWNER_PASSWORD='<contraseña de 8+ caracteres>' node scripts/assign-owner.js <businessId> <correo> "<nombre>"
 *
 * La contraseña se lee de una variable de entorno (no queda en el historial de comandos
 * ni se imprime). El script se niega a continuar si:
 * - el negocio no existe o ya tiene una cuenta,
 * - el correo ya está registrado.
 */
require('dotenv').config();
const crypto = require('crypto');
const { promisify } = require('util');
const { PrismaClient } = require('@prisma/client');

const scrypt = promisify(crypto.scrypt);
const prisma = new PrismaClient();

async function hashPassword(password) {
  // Mismo formato que src/services/authService.ts (salt:hash con scrypt)
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

(async () => {
  const [businessId, rawEmail, name] = process.argv.slice(2);
  const password = process.env.OWNER_PASSWORD || '';
  if (!businessId || !rawEmail || !name) throw new Error('Uso: node scripts/assign-owner.js <businessId> <correo> "<nombre>"');
  if (password.length < 8) throw new Error('Define OWNER_PASSWORD con al menos 8 caracteres.');
  const email = rawEmail.trim().toLowerCase();

  const business = await prisma.business.findUnique({ where: { id: businessId }, include: { user: true } });
  if (!business) throw new Error('No existe un negocio con ese id.');
  if (business.user) throw new Error(`Ese negocio ya tiene cuenta (${business.user.email}).`);
  if (await prisma.user.findUnique({ where: { email } })) throw new Error('Ese correo ya está registrado.');

  const user = await prisma.user.create({
    data: { name: name.trim(), email, passwordHash: await hashPassword(password), businessId },
  });
  console.log(`Cuenta creada para "${business.name}": ${user.email}`);
})()
  .catch((e) => {
    console.error('No se asignó el dueño:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
