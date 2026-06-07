import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AppError } from './errors.js';
import { catalogRouter } from './routes/catalog.js';
import { slotsRouter } from './routes/slots.js';
import { bookingsRouter } from './routes/bookings.js';
import { eventsRouter } from './routes/events.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');

/**
 * Сборка Express-приложения. Вынесено отдельно от server.ts, чтобы
 * интеграционные тесты могли поднять app на случайном порту (app.listen(0)).
 */
export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // REST API
  app.use('/api', catalogRouter);
  app.use('/api', slotsRouter);
  app.use('/api', bookingsRouter);
  app.use('/api', eventsRouter);
  app.use('/api/admin', adminRouter);

  // 404 для неизвестных API-маршрутов (до отдачи статики).
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Не найдено' } });
  });

  // Статика: клиент (index.html) и админка (admin.html).
  app.use(express.static(publicDir));
  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  // Централизованная обработка ошибок: AppError → свой статус, иначе 500.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    console.error('[error]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Внутренняя ошибка сервера' } });
  });

  return app;
}
