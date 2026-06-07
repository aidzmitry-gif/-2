import { Router } from 'express';
import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { asyncHandler } from '../middleware/async.js';
import { requireAdmin } from '../middleware/admin.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { localMinuteToUtc, labelInZone } from '../time.js';
import { createBlock } from '../services/booking.js';
import { cancelBooking } from '../services/waitlist.js';

export const adminRouter = Router();

// Вся админка под паролем.
adminRouter.use(requireAdmin);

// День мастера: записи и блокировки за календарный день (в зоне мастера).
adminRouter.get(
  '/day',
  asyncHandler(async (req, res) => {
    const masterId = String(req.query.masterId ?? '');
    const date = String(req.query.date ?? '');
    if (!masterId || !date) throw new BadRequestError('Нужны параметры masterId и date');

    const master = await prisma.master.findUnique({ where: { id: masterId } });
    if (!master) throw new NotFoundError('Мастер не найден');

    const dayStart = localMinuteToUtc(date, 0, master.timezone);
    const dayEnd = localMinuteToUtc(date, 24 * 60, master.timezone);

    const bookings = await prisma.booking.findMany({
      where: {
        masterId,
        status: 'CONFIRMED',
        startAt: { lt: dayEnd.toJSDate() },
        endAt: { gt: dayStart.toJSDate() },
      },
      orderBy: { startAt: 'asc' },
      include: { service: true },
    });

    res.json({
      master: { id: master.id, name: master.name, timezone: master.timezone },
      date,
      bookings: bookings.map((b) => ({
        id: b.id,
        kind: b.kind,
        status: b.status,
        customerName: b.customerName,
        service: b.service ? { id: b.service.id, name: b.service.name } : null,
        startUtc: b.startAt.toISOString(),
        endUtc: b.endAt.toISOString(),
        local: labelInZone(DateTime.fromJSDate(b.startAt).toUTC(), master.timezone),
      })),
    });
  }),
);

// Отмена записи администратором.
adminRouter.post(
  '/cancel',
  asyncHandler(async (req, res) => {
    const { bookingId } = req.body ?? {};
    if (!bookingId) throw new BadRequestError('Не указан bookingId');
    const result = await cancelBooking(String(bookingId));
    res.json(result);
  }),
);

// Ручная блокировка времени (kind = BLOCK). Часы задаются в локальном времени мастера.
adminRouter.post(
  '/block',
  asyncHandler(async (req, res) => {
    const { masterId, date, startMinute, endMinute, reason } = req.body ?? {};
    if (!masterId || !date || startMinute == null || endMinute == null) {
      throw new BadRequestError('Нужны masterId, date, startMinute, endMinute');
    }
    const master = await prisma.master.findUnique({ where: { id: String(masterId) } });
    if (!master) throw new NotFoundError('Мастер не найден');

    const startAt = localMinuteToUtc(String(date), Number(startMinute), master.timezone).toISO() ?? '';
    const endAt = localMinuteToUtc(String(date), Number(endMinute), master.timezone).toISO() ?? '';

    const result = await createBlock({ masterId: String(masterId), startAt, endAt, reason });
    res.status(201).json(result);
  }),
);
