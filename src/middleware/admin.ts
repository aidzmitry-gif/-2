import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { UnauthorizedError } from '../errors.js';

/**
 * Простая авторизация админки по паролю из .env.
 * Принимаем пароль либо в `Authorization: Bearer <pwd>`, либо в заголовке
 * `X-Admin-Password`.
 */
function extractPassword(req: Request): string | null {
  const auth = req.header('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  const header = req.header('x-admin-password');
  return header ? header.trim() : null;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const provided = extractPassword(req);
  if (!provided || provided !== config.adminPassword) {
    throw new UnauthorizedError('Неверный пароль администратора');
  }
  next();
}
