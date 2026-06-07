import { Router } from 'express';
import { prisma } from '../db.js';
import { asyncHandler } from '../middleware/async.js';

export const catalogRouter = Router();

// Список мастеров вместе с их графиком и услугами.
catalogRouter.get(
  '/masters',
  asyncHandler(async (_req, res) => {
    const masters = await prisma.master.findMany({
      orderBy: { name: 'asc' },
      include: {
        schedules: { orderBy: { weekday: 'asc' } },
        services: { include: { service: true } },
      },
    });
    res.json(
      masters.map((m) => ({
        id: m.id,
        name: m.name,
        timezone: m.timezone,
        schedule: m.schedules.map((s) => ({
          weekday: s.weekday,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        })),
        services: m.services.map((ms) => ({
          id: ms.service.id,
          name: ms.service.name,
          durationMin: ms.service.durationMin,
          priceCents: ms.service.priceCents,
        })),
      })),
    );
  }),
);

// Все услуги.
catalogRouter.get(
  '/services',
  asyncHandler(async (_req, res) => {
    const services = await prisma.service.findMany({ orderBy: { durationMin: 'asc' } });
    res.json(
      services.map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
      })),
    );
  }),
);
