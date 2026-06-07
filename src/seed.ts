import { DateTime } from 'luxon';
import { prisma, disconnect } from './db.js';
import { localMinuteToUtc } from './time.js';

/**
 * Идемпотентный сид: повторный запуск не плодит дубли (upsert по фиксированным
 * id). Контрольный кейс таймзон — мастер Анна в Europe/Moscow (UTC+3).
 */

const MASTERS = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Анна',
    timezone: 'Europe/Moscow',
    schedule: { weekdays: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 18 * 60 },
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Борис',
    timezone: 'Asia/Yekaterinburg',
    schedule: { weekdays: [1, 2, 3, 4, 5, 6], startMinute: 10 * 60, endMinute: 19 * 60 },
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Вера',
    timezone: 'Europe/Kaliningrad',
    schedule: { weekdays: [2, 3, 4, 5, 6], startMinute: 8 * 60, endMinute: 16 * 60 },
  },
];

const SERVICES = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000030', name: 'Стрижка', durationMin: 30, priceCents: 150000 },
  { id: 'aaaaaaaa-0000-0000-0000-000000000060', name: 'Маникюр', durationMin: 60, priceCents: 250000 },
  { id: 'aaaaaaaa-0000-0000-0000-000000000090', name: 'Окрашивание', durationMin: 90, priceCents: 500000 },
];

const LINKS: Record<string, string[]> = {
  '11111111-1111-1111-1111-111111111111': [
    'aaaaaaaa-0000-0000-0000-000000000030',
    'aaaaaaaa-0000-0000-0000-000000000060',
    'aaaaaaaa-0000-0000-0000-000000000090',
  ],
  '22222222-2222-2222-2222-222222222222': [
    'aaaaaaaa-0000-0000-0000-000000000030',
    'aaaaaaaa-0000-0000-0000-000000000060',
  ],
  '33333333-3333-3333-3333-333333333333': [
    'aaaaaaaa-0000-0000-0000-000000000030',
    'aaaaaaaa-0000-0000-0000-000000000090',
  ],
};

// Ближайшая будущая дата с нужным днём недели (ISO 1=Пн..7=Вс), начиная с завтра.
function nextWeekday(targetWeekday: number, zone: string): string {
  let d = DateTime.now().setZone(zone).startOf('day').plus({ days: 1 });
  for (let i = 0; i < 7; i++) {
    if (d.weekday === targetWeekday) break;
    d = d.plus({ days: 1 });
  }
  return d.toFormat('yyyy-MM-dd');
}

async function main(): Promise<void> {
  for (const m of MASTERS) {
    await prisma.master.upsert({
      where: { id: m.id },
      update: { name: m.name, timezone: m.timezone },
      create: { id: m.id, name: m.name, timezone: m.timezone },
    });
    for (const weekday of m.schedule.weekdays) {
      await prisma.schedule.upsert({
        where: { masterId_weekday: { masterId: m.id, weekday } },
        update: { startMinute: m.schedule.startMinute, endMinute: m.schedule.endMinute },
        create: {
          masterId: m.id,
          weekday,
          startMinute: m.schedule.startMinute,
          endMinute: m.schedule.endMinute,
        },
      });
    }
  }

  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { id: s.id },
      update: { name: s.name, durationMin: s.durationMin, priceCents: s.priceCents },
      create: { id: s.id, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents },
    });
  }

  for (const [masterId, serviceIds] of Object.entries(LINKS)) {
    for (const serviceId of serviceIds) {
      await prisma.masterService.upsert({
        where: { masterId_serviceId: { masterId, serviceId } },
        update: {},
        create: { masterId, serviceId },
      });
    }
  }

  // Исключения графика — идемпотентны по фиксированным id, даты вычисляются динамически.
  const annaTz = 'Europe/Moscow';
  const annaFriday = nextWeekday(5, annaTz);
  await prisma.scheduleException.upsert({
    where: { id: 'eeeeeeee-1111-1111-1111-111111111111' },
    update: {
      masterId: '11111111-1111-1111-1111-111111111111',
      startAt: localMinuteToUtc(annaFriday, 0, annaTz).toJSDate(),
      endAt: localMinuteToUtc(annaFriday, 24 * 60, annaTz).toJSDate(),
      reason: 'Отпуск',
    },
    create: {
      id: 'eeeeeeee-1111-1111-1111-111111111111',
      masterId: '11111111-1111-1111-1111-111111111111',
      startAt: localMinuteToUtc(annaFriday, 0, annaTz).toJSDate(),
      endAt: localMinuteToUtc(annaFriday, 24 * 60, annaTz).toJSDate(),
      reason: 'Отпуск',
    },
  });

  const borisTz = 'Asia/Yekaterinburg';
  const borisTuesday = nextWeekday(2, borisTz);
  await prisma.scheduleException.upsert({
    where: { id: 'eeeeeeee-2222-2222-2222-222222222222' },
    update: {
      masterId: '22222222-2222-2222-2222-222222222222',
      startAt: localMinuteToUtc(borisTuesday, 13 * 60, borisTz).toJSDate(),
      endAt: localMinuteToUtc(borisTuesday, 14 * 60, borisTz).toJSDate(),
      reason: 'Перерыв',
    },
    create: {
      id: 'eeeeeeee-2222-2222-2222-222222222222',
      masterId: '22222222-2222-2222-2222-222222222222',
      startAt: localMinuteToUtc(borisTuesday, 13 * 60, borisTz).toJSDate(),
      endAt: localMinuteToUtc(borisTuesday, 14 * 60, borisTz).toJSDate(),
      reason: 'Перерыв',
    },
  });

  console.log('Сид готов:');
  console.log(`  Анна (Europe/Moscow): отпуск ${annaFriday}`);
  console.log(`  Борис (Asia/Yekaterinburg): перерыв ${borisTuesday} 13:00–14:00`);
  console.log('  Вера (Europe/Kaliningrad)');
  console.log('  Услуги: Стрижка 30 / Маникюр 60 / Окрашивание 90');
}

main()
  .then(() => disconnect())
  .catch(async (err) => {
    console.error(err);
    await disconnect();
    process.exit(1);
  });
