import crypto from 'crypto';
import { promisify } from 'util';
import jwt from 'jsonwebtoken';
import { Business } from '@prisma/client';
import prisma from '../config/db';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const TOKEN_TTL = '7d';
export const TOKEN_ISSUER = 'pollystock-api';
export const TOKEN_AUDIENCE = 'pollystock-app';

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET no está configurado (mínimo 32 caracteres).');
  }
  return secret;
}

// ---------- Contraseñas ----------
// scrypt (incluido en Node) con salt aleatorio de 16 bytes y comparación en tiempo constante.
// Se conserva este formato para que las contraseñas ya registradas sigan siendo válidas.

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

// ---------- JWT (HS256 firmado con AUTH_SECRET) ----------

export function createToken(userId: string): string {
  return jwt.sign({}, getSecret(), {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: TOKEN_TTL,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });
}

/** Devuelve el id del usuario si el token es válido y vigente; si no, null. */
export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, getSecret(), {
      algorithms: ['HS256'],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ---------- Datos públicos (nunca incluyen passwordHash) ----------

export type PublicUser = { id: string; name: string; email: string; businessId: string; createdAt: Date };
export type PublicBusiness = Business & { isConfigured: boolean };

export const toPublicUser = (u: { id: string; name: string; email: string; businessId: string; createdAt: Date }): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  businessId: u.businessId,
  createdAt: u.createdAt,
});

/** El negocio está configurado cuando ya completó la configuración inicial. */
export const toPublicBusiness = (b: Business): PublicBusiness => ({ ...b, isConfigured: b.businessType.trim() !== '' });

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) }, include: { business: true } });
}

export async function findUserWithBusiness(id: string) {
  return prisma.user.findUnique({ where: { id }, include: { business: true } });
}

/**
 * Crea el negocio y su cuenta en una misma transacción: si algo falla,
 * no queda un usuario sin negocio ni un negocio sin usuario.
 */
export async function registerAccount(input: { name: string; email: string; password: string; businessName: string }) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.create({ data: { name: input.businessName.trim() } });
    const user = await tx.user.create({
      data: {
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        passwordHash,
        businessId: business.id,
      },
    });
    return { user, business };
  });
}
