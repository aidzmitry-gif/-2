/** Доменные ошибки с привязкой к HTTP-статусу. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Слот занят (пересечение) — отдаём 409. Ключевой статус для стресс-теста. */
export class SlotTakenError extends AppError {
  constructor(message = 'Это время уже занято') {
    super(409, message, 'SLOT_TAKEN');
  }
}

/** Некорректный запрос — 400. */
export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message, 'BAD_REQUEST');
  }
}

/** Не найдено — 404. */
export class NotFoundError extends AppError {
  constructor(message = 'Не найдено') {
    super(404, message, 'NOT_FOUND');
  }
}

/** Слот вне рабочего времени / в исключении — 422. */
export class SlotUnavailableError extends AppError {
  constructor(message = 'Слот недоступен для записи') {
    super(422, message, 'SLOT_UNAVAILABLE');
  }
}

/** Нет авторизации в админке — 401. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Требуется авторизация') {
    super(401, message, 'UNAUTHORIZED');
  }
}

// --- Распознавание ошибок PostgreSQL по коду SQLSTATE ---
// Под driver-adapter ошибки БД могут всплывать в разной обёртке, поэтому
// ищем сигнатуру по всему дереву ошибки (message/meta/cause).

function deepString(err: unknown): string {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (v == null || depth > 6 || seen.has(v)) return;
    if (typeof v === 'string') {
      parts.push(v);
      return;
    }
    if (typeof v === 'object') {
      seen.add(v);
      for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
    }
  };
  if (err instanceof Error) {
    parts.push(err.message);
    walk((err as { meta?: unknown }).meta, 0);
    walk((err as { cause?: unknown }).cause, 0);
    walk((err as { code?: unknown }).code, 0);
  } else {
    walk(err, 0);
  }
  return parts.join(' | ');
}

/** 23P01 — exclusion_violation (наш EXCLUDE-constraint bookings_no_overlap). */
export function isExclusionViolation(err: unknown): boolean {
  const s = deepString(err);
  return s.includes('23P01') || s.includes('bookings_no_overlap');
}

/** 23505 — unique_violation на конкретном поле (например, idempotency_key). */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  const s = deepString(err);
  const isUnique =
    s.includes('23505') ||
    (err as { code?: string })?.code === 'P2002'; // Prisma known error
  if (!isUnique) return false;
  return field ? s.includes(field) : true;
}
