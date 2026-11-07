import crypto from 'crypto';
import { promisify } from 'util';
import prisma from '../config/db';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 días
const KEY_LENGTH = 64;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET no está configurado (mínimo 32 caracteres) en el archivo .env');
  }
  return secret;
}

// ---------- Contraseñas (scrypt + salt aleatorio) ----------

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

// ---------- Tokens firmados con HMAC-SHA256 ----------

export interface TokenPayload {
  sub: string;
  exp: number;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function sign(data: string): string {
  return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

export function createToken(userId: string): string {
  const payload: TokenPayload = { sub: userId, exp: Date.now() + TOKEN_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// ---------- Usuarios ----------

export type PublicUser = { id: string; name: string; email: string; createdAt: Date };

const toPublic = (u: { id: string; name: string; email: string; createdAt: Date }): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  createdAt: u.createdAt,
});

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function findPublicUserById(id: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({ where: { id } });
  return user ? toPublic(user) : null;
}

export async function createUser(name: string, email: string, password: string): Promise<PublicUser> {
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
    },
  });
  return toPublic(user);
}

export { toPublic };
