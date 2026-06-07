import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { IDS, MOSCOW, YEKAT, api, body, firstFutureWeekday, postJson } from './setup.js';

function slotsUrl(date: string, tz: string): string {
  return api(
    `/api/slots?masterId=${IDS.anna}&serviceId=${IDS.haircut}&date=${date}&tz=${encodeURIComponent(tz)}`,
  );
}

describe('health и каталог', () => {
  it('GET /health → ok', async () => {
    const res = await fetch(api('/health'));
    expect(res.status).toBe(200);
    expect((await body(res)).status).toBe('ok');
  });

  it('GET /api/masters возвращает мастеров с услугами', async () => {
    const res = await fetch(api('/api/masters'));
    expect(res.status).toBe(200);
    const masters = await body(res);
    const anna = masters.find((m: any) => m.id === IDS.anna);
    expect(anna).toBeTruthy();
    expect(anna.timezone).toBe(MOSCOW);
    expect(anna.services.length).toBeGreaterThan(0);
  });

  it('GET /api/services возвращает три услуги', async () => {
    const res = await fetch(api('/api/services'));
    const services = await body(res);
    expect(services.length).toBe(3);
  });
});

describe('слоты и таймзоны', () => {
  it('слот 09:00 у мастера (МСК) виден клиенту в Екатеринбурге как 11:00', async () => {
    const date = firstFutureWeekday(MOSCOW);
    const res = await fetch(slotsUrl(date, YEKAT));
    const data = await body(res);
    const nine = data.slots.find((s: any) => s.master.time === '09:00');
    expect(nine).toBeTruthy();
    expect(nine.client.time).toBe('11:00');
  });

  it('в выходной день мастера слотов нет', async () => {
    // Ближайшее воскресенье — Анна работает только Пн–Пт.
    let d = DateTime.now().setZone(MOSCOW).startOf('day').plus({ days: 1 });
    while (d.weekday !== 7) d = d.plus({ days: 1 });
    const sunday = d.toFormat('yyyy-MM-dd');
    const res = await fetch(slotsUrl(sunday, MOSCOW));
    const data = await body(res);
    expect(data.slots.length).toBe(0);
  });

  it('после брони слот пропадает из доступных', async () => {
    const date = firstFutureWeekday(MOSCOW);
    const before = await body(await fetch(slotsUrl(date, MOSCOW)));
    expect(before.slots.length).toBeGreaterThan(0);
    const slot = before.slots[0];

    const booked = await postJson('/api/bookings', {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt: slot.startUtc,
      customerName: 'Занявший слот',
    });
    expect(booked.status).toBe(201);

    const after = await body(await fetch(slotsUrl(date, MOSCOW)));
    const stillThere = after.slots.some((s: any) => s.startUtc === slot.startUtc);
    expect(stillThere).toBe(false);
  });
});

describe('админка', () => {
  it('без пароля день мастера недоступен (401)', async () => {
    const res = await fetch(api(`/api/admin/day?masterId=${IDS.anna}&date=${firstFutureWeekday(MOSCOW)}`));
    expect(res.status).toBe(401);
  });

  it('с паролем возвращается день мастера (200)', async () => {
    const res = await fetch(
      api(`/api/admin/day?masterId=${IDS.anna}&date=${firstFutureWeekday(MOSCOW)}`),
      { headers: { Authorization: 'Bearer admin-secret' } },
    );
    expect(res.status).toBe(200);
    const data = await body(res);
    expect(data.master.id).toBe(IDS.anna);
    expect(Array.isArray(data.bookings)).toBe(true);
  });

  it('админ может поставить ручную блокировку времени', async () => {
    const date = firstFutureWeekday(MOSCOW);
    const res = await postJson(
      '/api/admin/block',
      { masterId: IDS.anna, date, startMinute: 10 * 60, endMinute: 11 * 60, reason: 'Учёба' },
      { Authorization: 'Bearer admin-secret' },
    );
    expect(res.status).toBe(201);
    const blocked = await body(res);
    expect(blocked.booking.kind).toBe('BLOCK');
  });
});
