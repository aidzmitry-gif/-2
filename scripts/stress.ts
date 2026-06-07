import { DateTime } from 'luxon';
import { prisma, disconnect } from '../src/db.js';
import { localMinuteToUtc } from '../src/time.js';

/**
 * Нагрузочная проверка третьего рубежа защиты: STRESS_N запросов одновременно
 * пытаются занять ОДИН слот. Ожидаемый результат — ровно одна запись, остальные
 * получают 409, и в БД на слот ровно одна бронь.
 *
 * Запуск: сначала поднять сервер (`npm run dev` или `npm start`), затем `npm run stress`.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const N = Number(process.env.STRESS_N ?? 50);

const ANNA = '11111111-1111-1111-1111-111111111111';
const HAIRCUT = 'aaaaaaaa-0000-0000-0000-000000000030';
const ZONE = 'Europe/Moscow';

// Идемпотентно гарантируем, что Анна + Стрижка + график существуют.
async function ensureSeeded(): Promise<void> {
  await prisma.master.upsert({
    where: { id: ANNA },
    update: {},
    create: { id: ANNA, name: 'Анна', timezone: ZONE },
  });
  await prisma.service.upsert({
    where: { id: HAIRCUT },
    update: {},
    create: { id: HAIRCUT, name: 'Стрижка', durationMin: 30, priceCents: 150000 },
  });
  for (const weekday of [1, 2, 3, 4, 5]) {
    await prisma.schedule.upsert({
      where: { masterId_weekday: { masterId: ANNA, weekday } },
      update: {},
      create: { masterId: ANNA, weekday, startMinute: 9 * 60, endMinute: 18 * 60 },
    });
  }
  await prisma.masterService.upsert({
    where: { masterId_serviceId: { masterId: ANNA, serviceId: HAIRCUT } },
    update: {},
    create: { masterId: ANNA, serviceId: HAIRCUT },
  });
}

// Ближайший будущий слот Пн–Чт 12:00 по Москве.
function pickFutureSlotUtc(): { startUtc: DateTime; label: string } {
  let d = DateTime.now().setZone(ZONE).startOf('day').plus({ days: 1 });
  for (let i = 0; i < 7; i++) {
    if (d.weekday >= 1 && d.weekday <= 4) break;
    d = d.plus({ days: 1 });
  }
  const date = d.toFormat('yyyy-MM-dd');
  const startUtc = localMinuteToUtc(date, 12 * 60, ZONE);
  return { startUtc, label: startUtc.setZone(ZONE).toFormat('ccc yyyy-MM-dd HH:mm') };
}

// Освобождаем слот перед прогоном (без каста ::uuid — master_id это text).
async function cleanSlot(startUtc: DateTime, endUtc: DateTime): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM bookings
    WHERE master_id = ${ANNA}
      AND tstzrange(start_at, end_at, '[)') && tstzrange(${startUtc.toJSDate()}, ${endUtc.toJSDate()}, '[)')
  `;
  await prisma.waitlistEntry.deleteMany({
    where: { masterId: ANNA, startAt: startUtc.toJSDate(), endAt: endUtc.toJSDate() },
  });
}

async function main(): Promise<void> {
  console.log(`\nСтресс-тест: ${N} параллельных запросов → ${BASE_URL}\n`);

  try {
    const h = await fetch(`${BASE_URL}/health`);
    if (!h.ok) throw new Error(`health вернул ${h.status}`);
  } catch (err) {
    console.error(`Сервер недоступен на ${BASE_URL}. Запустите его: npm run dev`);
    console.error(`Причина: ${(err as Error).message}`);
    await disconnect();
    process.exit(1);
  }

  await ensureSeeded();

  const { startUtc, label } = pickFutureSlotUtc();
  const endUtc = startUtc.plus({ minutes: 30 });
  console.log(`Слот: ${label} (МСК) = ${startUtc.toISO()}`);

  await cleanSlot(startUtc, endUtc);

  const statuses = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterId: ANNA,
          serviceId: HAIRCUT,
          startAt: startUtc.toISO(),
          customerName: `Нагрузка ${i + 1}`,
        }),
      }).then((r) => r.status),
    ),
  );

  const created = statuses.filter((s) => s === 201).length;
  const conflict = statuses.filter((s) => s === 409).length;
  const other = statuses.length - created - conflict;

  const dbCount = await prisma.booking.count({
    where: { masterId: ANNA, status: 'CONFIRMED', startAt: startUtc.toJSDate(), endAt: endUtc.toJSDate() },
  });

  console.log(`  201 Created : ${created}`);
  console.log(`  409 Conflict: ${conflict}`);
  console.log(`  Прочие коды: ${other}`);
  console.log(`  В БД броней на слот: ${dbCount}`);

  const ok = created === 1 && conflict === N - 1 && dbCount === 1;
  if (ok) {
    console.log(`✅ УСПЕХ: ровно 1 запись из ${N}, остальные отклонены.`);
  } else {
    console.log(`❌ ПРОВАЛ: ожидалось 1 успех и ${N - 1} отказов при 1 записи в БД.`);
  }

  await disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await disconnect();
  process.exit(1);
});
