import { DateTime } from 'luxon';

/**
 * Вся арифметика времени. Чистые функции без БД — поэтому таймзонный
 * контрольный кейс проверяется детерминированно юнит-тестом.
 *
 * Принцип: в БД хранится только UTC. График мастера задан в ЕГО локальном
 * времени (минуты от полуночи). Слоты вычисляются в таймзоне мастера, затем
 * переводятся в UTC. Клиенту те же мгновения показываются в его таймзоне.
 */

export const SLOT_STEP_MIN = 30;

export interface DayWindow {
  startMinute: number; // минут от полуночи (локально у мастера)
  endMinute: number;
}

export interface RawSlot {
  startUtc: DateTime;
  endUtc: DateTime;
}

export interface ZonedLabel {
  date: string; // yyyy-MM-dd в целевой зоне
  time: string; // HH:mm в целевой зоне
  iso: string; // ISO-строка с offset целевой зоны
}

/** Валидна ли IANA-таймзона. */
export function isValidZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

/** ISO-день недели (1=Пн..7=Вс) для календарной даты в заданной зоне. */
export function isoWeekday(dateISO: string, zone: string): number {
  return DateTime.fromISO(dateISO, { zone }).weekday;
}

/** Локальное «настенное» время (дата + минуты от полуночи) в зоне → мгновение UTC. */
export function localMinuteToUtc(dateISO: string, minute: number, zone: string): DateTime {
  return DateTime.fromISO(dateISO, { zone }).startOf('day').plus({ minutes: minute }).toUTC();
}

/**
 * Кандидаты-слоты длительностью durationMin, помещающиеся в [startMinute,endMinute)
 * по сетке шагом stepMin. Возвращаются мгновения UTC.
 */
export function buildDaySlots(
  dateISO: string,
  zone: string,
  window: DayWindow,
  durationMin: number,
  stepMin: number = SLOT_STEP_MIN,
): RawSlot[] {
  const slots: RawSlot[] = [];
  for (let m = window.startMinute; m + durationMin <= window.endMinute; m += stepMin) {
    const startUtc = localMinuteToUtc(dateISO, m, zone);
    const endUtc = startUtc.plus({ minutes: durationMin });
    slots.push({ startUtc, endUtc });
  }
  return slots;
}

/** Пересечение полуинтервалов [aStart,aEnd) и [bStart,bEnd). */
export function overlaps(aStart: DateTime, aEnd: DateTime, bStart: DateTime, bEnd: DateTime): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Подписать мгновение UTC в целевой зоне (дата/время/ISO). */
export function labelInZone(utc: DateTime, zone: string): ZonedLabel {
  const z = utc.setZone(zone);
  return {
    date: z.toFormat('yyyy-MM-dd'),
    time: z.toFormat('HH:mm'),
    iso: z.toISO() ?? '',
  };
}

/** Минуты от полуночи для мгновения UTC, выраженного в локальной зоне. */
export function minuteOfDayInZone(utc: DateTime, zone: string): number {
  const z = utc.setZone(zone);
  return z.hour * 60 + z.minute;
}

/** Календарная дата (yyyy-MM-dd) мгновения UTC в зоне. */
export function dateInZone(utc: DateTime, zone: string): string {
  return utc.setZone(zone).toFormat('yyyy-MM-dd');
}
