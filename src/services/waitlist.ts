import { DateTime } from 'luxon';
import { prisma } from '../db.js';
import { transactionOptions, config } from '../config.js';
import { BadRequestError, NotFoundError } from '../errors.js';
import { slotBus } from '../events/bus.js';
import { publishCreated } from './booking.js';
import { notifyBookingCancelled, notifyWaitlistPromoted } from './notify.js';

export interface JoinWaitlistInput {
  masterId: string;
  serviceId: string;
  startAt: string;
  customerName: string;
  customerTimezone?: string;
}

export interface WaitlistResult {
  id: string;
  masterId: string;
  serviceId: string;
  startAt: string;
  endAt: string;
  status: string;
  position: number; // место в очереди на этот слот (1 = первый)
}

/** Встать в лист ожидания на конкретный слот. */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<WaitlistResult> {
  const { masterId, serviceId, customerName } = input;
  if (!customerName || !customerName.trim()) {
    throw new BadRequestError('Не указано имя клиента');
  }

  const start = DateTime.fromISO(input.startAt, { setZone: true });
  if (!start.isValid) throw new BadRequestError('Некорректная дата начала (startAt)');
  const startUtc = start.toUTC();

  const service = await prisma.service.findUnique({ where: { id: serviceId } });
  if (!service) throw new NotFoundError('Услуга не найдена');

  const master = await prisma.master.findUnique({ where: { id: masterId } });
  if (!master) throw new NotFoundError('Мастер не найден');

  const link = await prisma.masterService.findUnique({
    where: { masterId_serviceId: { masterId, serviceId } },
  });
  if (!link) throw new BadRequestError('Мастер не оказывает эту услугу');

  const endUtc = startUtc.plus({ minutes: service.durationMin });

  const entry = await prisma.waitlistEntry.create({
    data: {
      masterId,
      serviceId,
      customerName: customerName.trim(),
      customerTimezone: input.customerTimezone ?? null,
      startAt: startUtc.toJSDate(),
      endAt: endUtc.toJSDate(),
      status: 'WAITING',
    },
  });

  const position = await prisma.waitlistEntry.count({
    where: {
      masterId,
      startAt: startUtc.toJSDate(),
      endAt: endUtc.toJSDate(),
      status: 'WAITING',
      createdAt: { lte: entry.createdAt },
    },
  });

  return {
    id: entry.id,
    masterId: entry.masterId,
    serviceId: entry.serviceId,
    startAt: entry.startAt.toISOString(),
    endAt: entry.endAt.toISOString(),
    status: entry.status,
    position,
  };
}

export interface CancelResult {
  cancelledId: string;
  alreadyCancelled: boolean;
  promoted: {
    waitlistEntryId: string;
    bookingId: string;
    customerName: string;
  } | null;
}

/**
 * Отмена записи. Если на освободившийся слот есть лист ожидания — первый в
 * очереди (по времени постановки) автоматически получает запись.
 *
 * Всё в одной транзакции с блокировкой строки мастера, чтобы отмена и
 * автозапись были атомарны и не гонялись с обычными бронированиями.
 */
export async function cancelBooking(bookingId: string): Promise<CancelResult> {
  const result = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundError('Запись не найдена');

    if (booking.status === 'CANCELLED') {
      return {
        cancelledId: booking.id,
        alreadyCancelled: true,
        promoted: null,
        masterId: booking.masterId,
        slotStart: booking.startAt,
        slotEnd: booking.endAt,
        promotedBookingSlot: null as null | { masterId: string; startAt: Date; endAt: Date },
      };
    }

    // Сериализуем работу с этим мастером.
    if (config.serializeBookings) {
      await tx.$queryRaw`SELECT id FROM masters WHERE id = ${booking.masterId} FOR UPDATE`;
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: { status: 'CANCELLED' },
    });

    // Первый ожидающий на ровно этот слот.
    const next = await tx.waitlistEntry.findFirst({
      where: {
        masterId: booking.masterId,
        startAt: booking.startAt,
        endAt: booking.endAt,
        status: 'WAITING',
      },
      orderBy: { createdAt: 'asc' },
    });

    let promoted: CancelResult['promoted'] = null;
    let promotedBookingSlot: { masterId: string; startAt: Date; endAt: Date } | null = null;

    if (next) {
      // Слот только что освободился в этой же транзакции — вставка пройдёт
      // сквозь EXCLUDE-constraint без конфликта.
      const newBooking = await tx.booking.create({
        data: {
          masterId: next.masterId,
          serviceId: next.serviceId,
          customerName: next.customerName,
          customerTimezone: next.customerTimezone,
          startAt: next.startAt,
          endAt: next.endAt,
          status: 'CONFIRMED',
          kind: 'BOOKING',
        },
      });

      await tx.waitlistEntry.update({
        where: { id: next.id },
        data: { status: 'PROMOTED', promotedBookingId: newBooking.id },
      });

      promoted = {
        waitlistEntryId: next.id,
        bookingId: newBooking.id,
        customerName: next.customerName,
      };
      promotedBookingSlot = {
        masterId: newBooking.masterId,
        startAt: newBooking.startAt,
        endAt: newBooking.endAt,
      };
    }

    return {
      cancelledId: booking.id,
      alreadyCancelled: false,
      promoted,
      masterId: booking.masterId,
      slotStart: booking.startAt,
      slotEnd: booking.endAt,
      promotedBookingSlot,
    };
  }, transactionOptions);

  // Публикуем события ПОСЛЕ коммита.
  if (!result.alreadyCancelled) {
    slotBus.publish({
      type: 'booking_cancelled',
      masterId: result.masterId,
      startAt: result.slotStart.toISOString(),
      endAt: result.slotEnd.toISOString(),
    });
    void notifyBookingCancelled(result.masterId, result.slotStart, result.slotEnd);

    if (result.promoted && result.promotedBookingSlot) {
      const slot = result.promotedBookingSlot;
      // Новая запись заняла слот — для живого обновления это снова "создано".
      publishCreated(slot.masterId, slot.startAt, slot.endAt, 'BOOKING');
      slotBus.publish({
        type: 'waitlist_promoted',
        masterId: slot.masterId,
        startAt: slot.startAt.toISOString(),
        endAt: slot.endAt.toISOString(),
        bookingId: result.promoted.bookingId,
      });
      void notifyWaitlistPromoted(result.promoted.customerName, slot.masterId, slot.startAt, slot.endAt);
    }
  }

  return {
    cancelledId: result.cancelledId,
    alreadyCancelled: result.alreadyCancelled,
    promoted: result.promoted,
  };
}
