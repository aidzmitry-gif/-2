import { Router } from 'express';
import { asyncHandler } from '../middleware/async.js';
import { createBooking } from '../services/booking.js';
import { joinWaitlist, cancelBooking } from '../services/waitlist.js';

export const bookingsRouter = Router();

// Создать запись. Необязательный заголовок Idempotency-Key делает повтор
// безопасным: тот же ключ вернёт уже созданную запись (200), а не дубль.
bookingsRouter.post(
  '/bookings',
  asyncHandler(async (req, res) => {
    const { masterId, serviceId, startAt, customerName, customerTimezone } = req.body ?? {};
    const idempotencyKey = req.header('idempotency-key') ?? undefined;
    const result = await createBooking({
      masterId,
      serviceId,
      startAt,
      customerName,
      customerTimezone,
      idempotencyKey,
    });
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  }),
);

// Встать в лист ожидания на занятый слот.
bookingsRouter.post(
  '/bookings/waitlist',
  asyncHandler(async (req, res) => {
    const { masterId, serviceId, startAt, customerName, customerTimezone } = req.body ?? {};
    const result = await joinWaitlist({
      masterId,
      serviceId,
      startAt,
      customerName,
      customerTimezone,
    });
    res.status(201).json(result);
  }),
);

// Отменить запись. Если на слот есть очередь — первый автоматически займёт место.
bookingsRouter.post(
  '/bookings/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await cancelBooking(req.params.id);
    res.json(result);
  }),
);
