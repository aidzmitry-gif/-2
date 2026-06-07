import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { config, transactionOptions } from '../config.js';
import {
  BadRequestError,
  NotFoundError,
  SlotTakenError,
  SlotUnavailableError,
  isExclusionViolation,
  isUniqueViolation,
} from '../errors.js';
import { isoWeekday, minuteOfDayInZone, dateInZone } from '../time.js';
import { slotBus } from '../events/bus.js';
import { notifyBookingCreated } from './notify.js';

export interface CreateBookingInput {
  masterId: string;
  serviceId: string;
  startAt: string; // ISO (UTC или с offset) — мгновение начала
  customerName: string;
  customerTimezone?: string;
  idempotencyKey?: string;
}

export interface BookingResult {
  booking: {
    id: string;
    masterId: string;
    serviceId: string | null;
    startAt: string;
    endAt: string;
    status: string;
    kind: string;
  };
  idempotentReplay: boolean; // true, если вернули уже существующую запись по ключу
}

/**
 * Создание записи с защитой от пересечений на ТРЁХ уровнях:
 *   1) проверка в коде (внутри транзакции, после блокировки);
 *   2) транзакция + SELECT ... FOR UPDATE по строке мастера (сериализует
 *      попытки записи к одному мастеру);
 *   3) EXCLUDE-constraint в БД (bookings_no_overlap) — последний рубеж.
 *
 * Плюс идемпотентность по Idempotency-Key.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const { masterId, serviceId, customerName } = input;

  if (!customerName || !customerName.trim()) {
    throw new BadRequestError('Не указано имя клиента');
  }

  const start = DateTime.fromISO(input.startAt, { setZone: true });
  if (!start.isValid) {
    throw new BadRequestError('Некорректная дата начала (startAt)');
  }
  const startUtc = start.toUTC();

  // Идемпотентность: повторный запрос с тем же ключом не создаёт дубль.
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return toResult(existing, true);
  }

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new NotFoundError('Услуга не найдена');

  const master = await prisma.master.findUnique({
    where: { id: masterId },
    include: { schedules: true },
  });
  if (!master) throw new NotFoundError('Мастер не найден');

  const link = await prisma.masterService.findUnique({
    where: { masterId_serviceId: { masterId, serviceId } },
  });
  if (!link) throw new BadRequestError('Мастер не оказывает эту услугу');

  const endUtc = startUtc.plus({ minutes: service.durationMin });

  // Слот должен попадать в рабочее окно мастера и не пересекать исключение.
  await assertWithinSchedule(master, startUtc, endUtc);

  const customerTimezone = input.customerTimezone ?? null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      // --- Уровень 2: блокировка строки мастера ---
      // FOR UPDATE заставляет параллельные попытки к ОДНОМУ мастеру идти строго
      // по очереди. Под READ COMMITTED следующий в очереди после коммита первого
      // перечитает данные и увидит свежую бронь на уровне 1.
      if (config.serializeBookings) {
        await tx.$queryRaw`SELECT id FROM masters WHERE id = ${masterId} FOR UPDATE`;
      }

      // --- Уровень 1: проверка пересечения в коде ---
      // Полуинтервал [start,end) — соседние записи (…11:00 и 11:00…) не считаются
      // пересечением, ровно как в EXCLUDE-constraint.
      const conflict = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM bookings
        WHERE master_id = ${masterId}
          AND status = 'CONFIRMED'
          AND tstzrange(start_at, end_at, '[)') && tstzrange(${startUtc.toJSDate()}, ${endUtc.toJSDate()}, '[)')
        LIMIT 1
      `;
      if (conflict.length > 0) {
        throw new SlotTakenError();
      }

      // Вставка. --- Уровень 3 (EXCLUDE-constraint) сработает здесь, если две
      // транзакции каким-то образом проскочили уровни 1–2 (например, блокировка
      // отключена для демонстрации на защите).
      return tx.booking.create({
        data: {
          masterId,
          serviceId,
          customerName: customerName.trim(),
          customerTimezone,
          startAt: startUtc.toJSDate(),
          endAt: endUtc.toJSDate(),
          status: 'CONFIRMED',
          kind: 'BOOKING',
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    }, transactionOptions);

    publishCreated(created.masterId, created.startAt, created.endAt, 'BOOKING');
    void notifyBookingCreated(master, service, created);
    return toResult(created, false);
  } catch (err) {
    // Гонка по Idempotency-Key: два запроса с одним ключом одновременно.
    if (input.idempotencyKey && isUniqueViolation(err, 'idempotency_key')) {
      const existing = await prisma.booking.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return toResult(existing, true);
    }
    // Уровень 3: нарушение EXCLUDE-constraint → слот занят.
    if (isExclusionViolation(err)) {
      throw new SlotTakenError();
    }
    throw err;
  }
}

/** Проверка, что [startUtc,endUtc) укладывается в график мастера на этот день. */
async function assertWithinSchedule(
  master: { id: string; timezone: string; schedules: Array<{ weekday: number; startMinute: number; endMinute: number }> },
  startUtc: DateTime,
  endUtc: DateTime,
): Promise<void> {
  if (endUtc <= startUtc) {
    throw new BadRequestError('Конец слота должен быть позже начала');
  }

  const startDate = dateInZone(startUtc, master.timezone);
  const endDate = dateInZone(endUtc, master.timezone);
  // Слот не должен переходить через полночь в локальном времени мастера.
  if (startDate !== endDate) {
    throw new SlotUnavailableError('Слот выходит за пределы рабочего дня');
  }

  const weekday = isoWeekday(startDate, master.timezone);
  const schedule = master.schedules.find((s) => s.weekday === weekday);
  if (!schedule) {
    throw new SlotUnavailableError('В этот день мастер не работает');
  }

  const startMin = minuteOfDayInZone(startUtc, master.timezone);
  const endMin = minuteOfDayInZone(endUtc, master.timezone);
  if (startMin < schedule.startMinute || endMin > schedule.endMinute) {
    throw new SlotUnavailableError('Слот вне рабочего времени мастера');
  }

  // Пересечение с исключением (отпуск/перерыв).
  const exception = await prisma.scheduleException.findFirst({
    where: {
      masterId: master.id,
      startAt: { lt: endUtc.toJSDate() },
      endAt: { gt: startUtc.toJSDate() },
    },
  });
  if (exception) {
    throw new SlotUnavailableError('Время попадает в исключение графика');
  }
}

interface BookingRow {
  id: string;
  masterId: string;
  serviceId: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
  kind: string;
}

function toResult(b: BookingRow, idempotentReplay: boolean): BookingResult {
  return {
    booking: {
      id: b.id,
      masterId: b.masterId,
      serviceId: b.serviceId,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
      kind: b.kind,
    },
    idempotentReplay,
  };
}

/**
 * Ручная блокировка времени админом (kind = BLOCK). Тоже проходит все три
 * уровня защиты, поэтому блокировка не может пересечься с существующей бронью.
 */
export async function createBlock(input: {
  masterId: string;
  startAt: string;
  endAt: string;
  reason?: string;
}): Promise<BookingResult> {
  const master = await prisma.master.findUnique({ where: { id: input.masterId } });
  if (!master) throw new NotFoundError('Мастер не найден');

  const start = DateTime.fromISO(input.startAt, { setZone: true });
  const end = DateTime.fromISO(input.endAt, { setZone: true });
  if (!start.isValid || !end.isValid) {
    throw new BadRequestError('Некорректные даты блокировки');
  }
  const startUtc = start.toUTC();
  const endUtc = end.toUTC();
  if (endUtc <= startUtc) {
    throw new BadRequestError('Конец блокировки должен быть позже начала');
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      if (config.serializeBookings) {
        await tx.$queryRaw`SELECT id FROM masters WHERE id = ${input.masterId} FOR UPDATE`;
      }
      const conflict = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM bookings
        WHERE master_id = ${input.masterId}
          AND status = 'CONFIRMED'
          AND tstzrange(start_at, end_at, '[)') && tstzrange(${startUtc.toJSDate()}, ${endUtc.toJSDate()}, '[)')
        LIMIT 1
      `;
      if (conflict.length > 0) throw new SlotTakenError('Время пересекается с существующей записью');

      return tx.booking.create({
        data: {
          masterId: input.masterId,
          serviceId: null,
          customerName: input.reason?.trim() || 'Блокировка',
          customerTimezone: null,
          startAt: startUtc.toJSDate(),
          endAt: endUtc.toJSDate(),
          status: 'CONFIRMED',
          kind: 'BLOCK',
          idempotencyKey: null,
        },
      });
    }, transactionOptions);

    publishCreated(created.masterId, created.startAt, created.endAt, 'BLOCK');
    return toResult(created, false);
  } catch (err) {
    if (isExclusionViolation(err)) throw new SlotTakenError('Время пересекается с существующей записью');
    throw err;
  }
}

export function publishCreated(
  masterId: string,
  startAt: Date,
  endAt: Date,
  kind: 'BOOKING' | 'BLOCK',
): void {
  slotBus.publish({
    type: 'booking_created',
    masterId,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    kind,
  });
}
