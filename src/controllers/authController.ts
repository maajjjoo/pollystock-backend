import { Request, Response } from 'express';
import * as authService from '../services/authService';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
const MAX_PASSWORD = 64;
const MAX_NAME = 60;
const MAX_EMAIL = 100;

const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ success: false, code, message });

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > MAX_NAME) {
      fail(res, 400, 'VALIDATION_ERROR', `El nombre debe tener entre 2 y ${MAX_NAME} caracteres.`);
      return;
    }
    if (typeof email !== 'string' || email.trim().length > MAX_EMAIL || !EMAIL_RE.test(email.trim())) {
      fail(res, 400, 'VALIDATION_ERROR', 'Ingresa un correo electrónico válido.');
      return;
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      fail(res, 400, 'VALIDATION_ERROR', `La contraseña debe tener entre ${MIN_PASSWORD} y ${MAX_PASSWORD} caracteres.`);
      return;
    }

    if (await authService.findUserByEmail(email)) {
      fail(res, 409, 'EMAIL_IN_USE', 'Ya existe una cuenta con ese correo.');
      return;
    }

    const user = await authService.createUser(name, email, password);
    const token = authService.createToken(user.id);
    res.status(201).json({ success: true, data: { token, user } });
  } catch (error) {
    console.error('[auth/register]', error);
    fail(res, 500, 'INTERNAL_ERROR', 'No se pudo crear la cuenta.');
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password || email.length > MAX_EMAIL || password.length > MAX_PASSWORD) {
      fail(res, 400, 'VALIDATION_ERROR', 'Ingresa tu correo y contraseña.');
      return;
    }

    const user = await authService.findUserByEmail(email);
    const valid = user ? await authService.verifyPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      fail(res, 401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
      return;
    }

    const token = authService.createToken(user.id);
    res.json({ success: true, data: { token, user: authService.toPublic(user) } });
  } catch (error) {
    console.error('[auth/login]', error);
    fail(res, 500, 'INTERNAL_ERROR', 'No se pudo iniciar sesión.');
  }
};

export const me = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.userId ? await authService.findPublicUserById(req.userId) : null;
    if (!user) {
      fail(res, 401, 'UNAUTHORIZED', 'La cuenta ya no existe.');
      return;
    }
    res.json({ success: true, data: user });
  } catch (error) {
    console.error('[auth/me]', error);
    fail(res, 500, 'INTERNAL_ERROR', 'No se pudo obtener el usuario.');
  }
};
