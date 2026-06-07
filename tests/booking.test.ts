import { describe, it, expect } from 'vitest';
import { IDS, YEKAT, body, futureWeekdaySlotUtc, postJson } from './setup.js';

// 14:00 в Екатеринбурге = 09:00 UTC = 12:00 в Москве — валидный слот Анны.
function annaSlot(): string {
  return futureWeekdaySlotUtc(YEKAT, 14);
}

async function bookN(startAt: string, n: number) {
  const requests = Array.from({ length: n }, (_, i) =>
    postJson('/api/bookings', {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt,
      customerName: `Клиент ${i + 1}`,
      customerTimezone: YEKAT,
    }),
  );
  const responses = await Promise.all(requests);
  const created = responses.filter((r) => r.status === 201).length;
  const conflict = responses.filter((r) => r.status === 409).length;
  return { created, conflict, responses };
}

describe('конкурентная запись на один слот', () => {
  it('50 параллельных запросов → ровно 1 успех (201) и 49 отказов (409)', async () => {
    const { created, conflict } = await bookN(annaSlot(), 50);
    expect(created).toBe(1);
    expect(conflict).toBe(49);
  });

  it('повторный прогон так же стабилен (ещё раз 1 из 50)', async () => {
    const { created, conflict } = await bookN(annaSlot(), 50);
    expect(created).toBe(1);
    expect(conflict).toBe(49);
  });
});

describe('идемпотентность и повторное бронирование', () => {
  it('один Idempotency-Key возвращает ту же запись, а не дубль', async () => {
    const startAt = futureWeekdaySlotUtc(YEKAT, 15);
    const payload = {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt,
      customerName: 'Идемпотент',
      customerTimezone: YEKAT,
    };
    const key = 'test-idem-key-1';

    const first = await postJson('/api/bookings', payload, { 'Idempotency-Key': key });
    const a = await body(first);
    expect(first.status).toBe(201);

    const second = await postJson('/api/bookings', payload, { 'Idempotency-Key': key });
    const b = await body(second);
    expect(second.status).toBe(200);
    expect(b.idempotentReplay).toBe(true);
    expect(b.booking.id).toBe(a.booking.id);
  });

  it('повторная запись на занятый слот отклоняется (409)', async () => {
    const startAt = futureWeekdaySlotUtc(YEKAT, 16);
    const first = await postJson('/api/bookings', {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt,
      customerName: 'Первый',
    });
    expect(first.status).toBe(201);

    const second = await postJson('/api/bookings', {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt,
      customerName: 'Второй',
    });
    expect(second.status).toBe(409);
  });
});
