import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import {
  buildDaySlots,
  dateInZone,
  isValidZone,
  isoWeekday,
  labelInZone,
  localMinuteToUtc,
  minuteOfDayInZone,
  overlaps,
  type RawSlot,
} from '../time.js';

export interface SlotView {
  startUtc: string; // ISO Z — это значение клиент присылает обратно при записи
  endUtc: string;
  durationMin: number;
  master: { date: string; time: string }; // в таймзоне мастера
  client: { date: string; time: string }; // в таймзоне клиента
}

export interface SlotsResult {
  master: { id: string; name: string; timezone: string };
  service: { id: string; name: string; durationMin: number; priceCents: number };
  date: string;
  clientTimezone: string;
  slots: SlotView[];
}

interface Interval {
  start: DateTime;
  end: DateTime;
}

/**
 * Доступные слоты мастера на конкретную календарную дату (в таймзоне мастера),
 * подписанные также в таймзоне клиента.
 */
export async function getAvailableSlots(params: {
  masterId: string;
  serviceId: string;
  dateISO: string;
  clientTimezone: string;
}): Promise<SlotsResult> {
  const { masterId, serviceId, dateISO } = params;
  const clientTimezone = params.clientTimezone;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new BadRequestError('Дата должна быть в формате YYYY-MM-DD');
  }
  if (!isValidZone(clientTimezone)) {
    throw new BadRequestError(`Неизвестная таймзона клиента: ${clientTimezone}`);
  }

  const master = await prisma.master.findUnique({
    where: { id: masterId },
    include: { schedules: true },
  });
  if (!master) throw new NotFoundError('Мастер не найден');

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new NotFoundError('Услуга не найдена');

  const link = await prisma.masterService.findUnique({
    where: { masterId_serviceId: { masterId, serviceId } },
  });
  if (!link) throw new BadRequestError('Мастер не оказывает эту услугу');

  const base = {
    master: { id: master.id, name: master.name, timezone: master.timezone },
    service: {
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      priceCents: service.priceCents,
    },
    date: dateISO,
    clientTimezone,
  };

  const weekday = isoWeekday(dateISO, master.timezone);
  const schedule = master.schedules.find((s) => s.weekday === weekday);
  if (!schedule) {
    return { ...base, slots: [] }; // выходной день у мастера
  }

  const candidates = buildDaySlots(
    dateISO,
    master.timezone,
    { startMinute: schedule.startMinute, endMinute: schedule.endMinute },
    service.durationMin,
  );

  // Границы рабочего окна в UTC — чтобы выбрать пересекающиеся брони/исключения.
  const windowStart = localMinuteToUtc(dateISO, schedule.startMinute, master.timezone);
  const windowEnd = localMinuteToUtc(dateISO, schedule.endMinute, master.timezone);

  const [exceptions, bookings] = await Promise.all([
    prisma.scheduleException.findMany({
      where: {
        masterId,
        startAt: { lt: windowEnd.toJSDate() },
        endAt: { gt: windowStart.toJSDate() },
      },
    }),
    prisma.booking.findMany({
      where: {
        masterId,
        status: 'CONFIRMED',
        startAt: { lt: windowEnd.toJSDate() },
        endAt: { gt: windowStart.toJSDate() },
      },
    }),
  ]);

  const busy: Interval[] = [
    ...exceptions.map((e) => ({
      start: DateTime.fromJSDate(e.startAt),
      end: DateTime.fromJSDate(e.endAt),
    })),
    ...bookings.map((b) => ({
      start: DateTime.fromJSDate(b.startAt),
      end: DateTime.fromJSDate(b.endAt),
    })),
  ];

  const now = DateTime.utc();
  const free = candidates.filter((c: RawSlot) => {
    if (c.startUtc <= now) return false; // прошедшее не предлагаем
    return !busy.some((t) => overlaps(c.startUtc, c.endUtc, t.start, t.end));
  });

  const slots: SlotView[] = free.map((c) => ({
    startUtc: c.startUtc.toISO() ?? '',
    endUtc: c.endUtc.toISO() ?? '',
    durationMin: service.durationMin,
    master: {
      date: dateInZone(c.startUtc, master.timezone),
      time: formatMinute(minuteOfDayInZone(c.startUtc, master.timezone)),
    },
    client: labelInZone(c.startUtc, clientTimezone),
  }));

  return { ...base, slots };
}

function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
