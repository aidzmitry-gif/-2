import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { createApp } from '../src/app.js';
import { prisma, disconnect } from '../src/db.js';
import { localMinuteToUtc } from '../src/time.js';

export const MOSCOW = 'Europe/Moscow';
export const YEKAT = 'Asia/Yekaterinburg';

// Фиксированные id — те же, что в сиде, чтобы тесты были читаемыми.
export const IDS = {
  anna: '11111111-1111-1111-1111-111111111111',
  boris: '22222222-2222-2222-2222-222222222222',
  haircut: 'aaaaaaaa-0000-0000-0000-000000000030',
  manicure: 'aaaaaaaa-0000-0000-0000-000000000060',
  coloring: 'aaaaaaaa-0000-0000-0000-000000000090',
} as const;

// Живая привязка: значение проставляется в beforeAll и видно импортёрам.
export let baseURL = '';

let server: Server;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await disconnect();
});

// Перед каждым тестом — чистая, детерминированная база.
beforeEach(async () => {
  await truncateAll();
  await seedFixtures();
});

export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "waitlist_entries", "bookings", "master_services", "schedule_exceptions", "schedules", "services", "masters" RESTART IDENTITY CASCADE',
  );
}

/**
 * Минимальные фикстуры: Анна (Пн–Пт 09:00–18:00, Europe/Moscow) и Борис
 * (Пн–Сб 10:00–19:00, Asia/Yekaterinburg). Исключений графика НЕТ — чтобы
 * тесты были предсказуемыми. Услуги: Стрижка/Маникюр/Окрашивание.
 */
export async function seedFixtures(): Promise<void> {
  await prisma.master.createMany({
    data: [
      { id: IDS.anna, name: 'Анна', timezone: MOSCOW },
      { id: IDS.boris, name: 'Борис', timezone: YEKAT },
    ],
  });

  await prisma.service.createMany({
    data: [
      { id: IDS.haircut, name: 'Стрижка', durationMin: 30, priceCents: 150000 },
      { id: IDS.manicure, name: 'Маникюр', durationMin: 60, priceCents: 250000 },
      { id: IDS.coloring, name: 'Окрашивание', durationMin: 90, priceCents: 500000 },
    ],
  });

  const annaDays = [1, 2, 3, 4, 5].map((weekday) => ({
    masterId: IDS.anna,
    weekday,
    startMinute: 9 * 60,
    endMinute: 18 * 60,
  }));
  const borisDays = [1, 2, 3, 4, 5, 6].map((weekday) => ({
    masterId: IDS.boris,
    weekday,
    startMinute: 10 * 60,
    endMinute: 19 * 60,
  }));
  await prisma.schedule.createMany({ data: [...annaDays, ...borisDays] });

  await prisma.masterService.createMany({
    data: [
      { masterId: IDS.anna, serviceId: IDS.haircut },
      { masterId: IDS.anna, serviceId: IDS.coloring },
      { masterId: IDS.boris, serviceId: IDS.haircut },
      { masterId: IDS.boris, serviceId: IDS.manicure },
    ],
  });
}

// Ближайший будущий день недели Пн–Чт (в указанной зоне). Такой слот точно
// попадает в рабочее окно Анны и лежит в будущем.
export function firstFutureWeekday(zone: string): string {
  let d = DateTime.now().setZone(zone).startOf('day').plus({ days: 1 });
  for (let i = 0; i < 7; i++) {
    if (d.weekday >= 1 && d.weekday <= 4) break;
    d = d.plus({ days: 1 });
  }
  return d.toFormat('yyyy-MM-dd');
}

// Мгновение UTC (ISO) для локального часа hourLocal в зоне на ближайший Пн–Чт.
export function futureWeekdaySlotUtc(zone: string, hourLocal: number): string {
  const date = firstFutureWeekday(zone);
  return localMinuteToUtc(date, hourLocal * 60, zone).toISO() ?? '';
}

export function api(path: string): string {
  return `${baseURL}${path}`;
}

export async function postJson(
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
}

// Типизированный разбор JSON-ответа.
export async function body<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
