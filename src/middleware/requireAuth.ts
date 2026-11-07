import { Request, Response, NextFunction } from 'express';
import prisma from '../config/db';
import { verifyToken } from '../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Usuario autenticado (del JWT verificado). */
      userId?: string;
      /** Negocio del usuario, leído de la base de datos: nunca del cliente. */
      businessId?: string;
    }
  }
}

const unauthorized = (res: Response, message: string) =>
  res.status(401).json({ success: false, code: 'UNAUTHORIZED', message });

/**
 * Exige un JWT válido y obtiene el negocio del usuario desde la base de datos.
 * Todas las rutas de inventario usan req.businessId para filtrar sus consultas.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    unauthorized(res, 'Debes iniciar sesión.');
    return;
  }

  const userId = verifyToken(token);
  if (!userId) {
    unauthorized(res, 'Tu sesión expiró. Inicia sesión de nuevo.');
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, businessId: true } });
    if (!user) {
      unauthorized(res, 'La cuenta ya no existe.');
      return;
    }
    req.userId = user.id;
    req.businessId = user.businessId;
    next();
  } catch (error) {
    console.error('[requireAuth]', error);
    res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: 'No se pudo validar la sesión.' });
  }
}
