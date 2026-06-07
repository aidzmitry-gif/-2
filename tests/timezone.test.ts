import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  SLOT_STEP_MIN,
  buildDaySlots,
  dateInZone,
  isValidZone,
  isoWeekday,
  labelInZone,
  localMinuteToUtc,
  minuteOfDayInZone,
  overlaps,
} from '../src/time.js';

const MOSCOW = 'Europe/Moscow'; // UTC+3, без перехода на летнее время
const YEKAT = 'Asia/Yekaterinburg'; // UTC+5
const DATE = '2026-06-08'; // понедельник

describe('таймзоны: чистые функции', () => {
  it('isValidZone отличает корректные зоны от мусора', () => {
    expect(isValidZone(MOSCOW)).toBe(true);
    expect(isValidZone(YEKAT)).toBe(true);
    expect(isValidZone('Nowhere/Nope')).toBe(false);
  });

  it('09:00 по Москве сохраняется как 06:00 UTC', () => {
    const utc = localMinuteToUtc(DATE, 9 * 60, MOSCOW);
    expect(utc.hour).toBe(6);
    expect(utc.minute).toBe(0);
  });

  it('контрольный кейс: 09:00 у мастера (МСК) = 11:00 у клиента (Екатеринбург)', () => {
    const instant = localMinuteToUtc(DATE, 9 * 60, MOSCOW);
    expect(labelInZone(instant, MOSCOW).time).toBe('09:00');
    expect(labelInZone(instant, YEKAT).time).toBe('11:00');
  });

  it('minuteOfDayInZone возвращает локальные минуты от полуночи', () => {
    const instant = DateTime.fromISO('2026-06-08T06:00:00', { zone: 'utc' });
    expect(minuteOfDayInZone(instant, MOSCOW)).toBe(9 * 60);
  });

  it('dateInZone зависит от зоны на границе суток', () => {
    const instant = DateTime.fromISO('2026-06-08T20:00:00', { zone: 'utc' });
    expect(dateInZone(instant, MOSCOW)).toBe('2026-06-08'); // 23:00 того же дня
    expect(dateInZone(instant, YEKAT)).toBe('2026-06-09'); // 01:00 следующего дня
  });

  it('isoWeekday: 2026-06-08 — понедельник (1)', () => {
    expect(isoWeekday('2026-06-08', MOSCOW)).toBe(1);
    expect(isoWeekday('2026-06-07', MOSCOW)).toBe(7);
  });

  it('overlaps: пересекающиеся интервалы дают true', () => {
    const a = DateTime.fromISO('2026-06-08T09:00:00Z');
    const aEnd = DateTime.fromISO('2026-06-08T09:30:00Z');
    const b = DateTime.fromISO('2026-06-08T09:15:00Z');
    const bEnd = DateTime.fromISO('2026-06-08T09:45:00Z');
    expect(overlaps(a, aEnd, b, bEnd)).toBe(true);
  });

  it('overlaps: смежные интервалы [..) не считаются пересечением', () => {
    const a = DateTime.fromISO('2026-06-08T09:00:00Z');
    const aEnd = DateTime.fromISO('2026-06-08T09:30:00Z');
    const cEnd = DateTime.fromISO('2026-06-08T10:00:00Z');
    expect(overlaps(a, aEnd, aEnd, cEnd)).toBe(false);
  });

  it('buildDaySlots: окно 09:00–18:00, услуга 30 мин → 18 слотов по сетке 30', () => {
    const slots = buildDaySlots(DATE, MOSCOW, { startMinute: 9 * 60, endMinute: 18 * 60 }, 30, SLOT_STEP_MIN);
    expect(slots.length).toBe(18);
    expect(slots[0].startUtc.hour).toBe(6); // 09:00 МСК = 06:00 UTC
  });

  it('buildDaySlots: услуга 90 мин укладывается реже → 16 слотов', () => {
    const slots = buildDaySlots(DATE, MOSCOW, { startMinute: 9 * 60, endMinute: 18 * 60 }, 90, SLOT_STEP_MIN);
    expect(slots.length).toBe(16);
  });
});
