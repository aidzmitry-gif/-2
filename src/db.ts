import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from './config.js';

/**
 * Prisma поверх driver-adapter @prisma/adapter-pg (node-postgres).
 * Клиент использует WASM query-compiler и не требует нативного Rust-движка.
 *
 * Размер пула node-postgres задаём ЯВНО (max), потому что connection_limit из
 * строки подключения — это параметр Prisma, а сам Pool его не читает.
 * Для стресс-теста пул должен вмещать все параллельные транзакции: каждая
 * держит соединение, пока ждёт блокировку строки мастера (FOR UPDATE).
 */
const adapter = new PrismaPg({
  connectionString: config.databaseUrl,
  max: config.poolMax,
  connectionTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({ adapter });

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
