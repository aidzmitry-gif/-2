import { describe, it, expect } from 'vitest';
import { IDS, body, futureWeekdaySlotUtc, postJson } from './setup.js';

const YEKAT = 'Asia/Yekaterinburg';

// 13:00 в Екатеринбурге = 08:00 UTC = 11:00 в Москве — валидный слот Анны.
function annaSlot(): string {
  return futureWeekdaySlotUtc(YEKAT, 13);
}

async function bookAnna(startAt: string, customerName: string) {
  const res = await postJson('/api/bookings', {
    masterId: IDS.anna,
    serviceId: IDS.haircut,
    startAt,
    customerName,
  });
  return res;
}

describe('лист ожидания', () => {
  it('после отмены первый из очереди автоматически получает запись', async () => {
    const startAt = annaSlot();

    const a = await bookAnna(startAt, 'Анна-клиент A');
    expect(a.status).toBe(201);
    const bookingA = (await body(a)).booking;

    const b = await postJson('/api/bookings/waitlist', {
      masterId: IDS.anna,
      serviceId: IDS.haircut,
      startAt,
      customerName: 'Очередь B',
    });
    expect(b.status).toBe(201);
    const waitB = await body(b);
    expect(waitB.position).toBe(1);

    const cancel = await postJson(`/api/bookings/${bookingA.id}/cancel`, {});
    const cancelBody = await body(cancel);
    expect(cancelBody.alreadyCancelled).toBe(false);
    expect(cancelBody.promoted).not.toBeNull();
    expect(cancelBody.promoted.customerName).toBe('Очередь B');

    // Слот снова занят — теперь уже клиентом из листа ожидания.
    const retry = await bookAnna(startAt, 'Поздний C');
    expect(retry.status).toBe(409);
  });

  it('повторная отмена той же записи помечается alreadyCancelled', async () => {
    const startAt = annaSlot();
    const a = await bookAnna(startAt, 'Клиент');
    const bookingA = (await body(a)).booking;

    const first = await postJson(`/api/bookings/${bookingA.id}/cancel`, {});
    expect((await body(first)).alreadyCancelled).toBe(false);

    const second = await postJson(`/api/bookings/${bookingA.id}/cancel`, {});
    expect((await body(second)).alreadyCancelled).toBe(true);
  });

  it('отмена без листа ожидания: promoted = null', async () => {
    const startAt = annaSlot();
    const a = await bookAnna(startAt, 'Одиночка');
    const bookingA = (await body(a)).booking;

    const cancel = await postJson(`/api/bookings/${bookingA.id}/cancel`, {});
    expect((await body(cancel)).promoted).toBeNull();
  });
});
