import 'dotenv/config';

/**
 * Единая точка чтения окружения. dotenv подхватывает .env локально;
 * в CI переменные приходят напрямую из окружения раннера.
 */

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    throw new Error(`Не задана обязательная переменная окружения ${name}`);
  }
  return v;
}

const databaseUrl = required(
  'DATABASE_URL',
  'postgresql://postgres:postgres@localhost:5432/booking?schema=public',
);

// Размер пула берём из connection_limit в URL (Prisma-параметр, который сам
// node-postgres не понимает), иначе дефолт 50 — чтобы все параллельные
// запросы стресс-теста получили соединение и сериализовались на блокировке
// строки, а не падали по таймауту пула.
function poolMaxFromUrl(url: string, fallback: number): number {
  const m = url.match(/[?&]connection_limit=(\d+)/);
  return m ? Number(m[1]) : fallback;
}

export const config = {
  databaseUrl,
  poolMax: poolMaxFromUrl(databaseUrl, 50),
  port: Number(process.env.PORT ?? 3000),
  adminPassword: process.env.ADMIN_PASSWORD ?? 'admin-secret',
  // "off" выключает SELECT ... FOR UPDATE — для демонстрации на защите,
  // что последним рубежом остаётся EXCLUDE-constraint.
  serializeBookings: (process.env.BOOKING_SERIALIZE ?? 'on').toLowerCase() !== 'off',
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
} as const;

export const transactionOptions = {
  // Запас по времени: при 50 параллельных запросах последний ждёт, пока
  // освободится блокировка строки мастера.
  maxWait: 20_000,
  timeout: 20_000,
} as const;
