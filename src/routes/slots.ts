import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { BadRequestError } from '../errors.js';
import { getAvailableSlots } from '../services/slots.js';

export const slotsRouter = Router();

// GET /api/slots?masterId=&serviceId=&date=YYYY-MM-DD&tz=Area/City
// Возвращает свободные слоты мастера на дату, подписанные в зоне мастера и клиента.
slotsRouter.get(
  '/slots',
  asyncHandler(async (req, res) => {
    const masterId = String(req.query.masterId ?? '');
    const serviceId = String(req.query.serviceId ?? '');
    const date = String(req.query.date ?? '');
    const tz = String(req.query.tz ?? 'UTC');
    if (!masterId || !serviceId || !date) {
      throw new BadRequestError('Нужны параметры masterId, serviceId и date');
    }
    const result = await getAvailableSlots({
      masterId,
      serviceId,
      dateISO: date,
      clientTimezone: tz,
    });
    res.json(result);
  }),
);
