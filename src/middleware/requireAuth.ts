import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Debes iniciar sesión.' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Tu sesión expiró. Inicia sesión de nuevo.' });
    return;
  }

  req.userId = payload.sub;
  next();
}
