-- 0001_init — базовая схема «Бронирование 2.0».
-- Всё время хранится в timestamptz (UTC). Имена столбцов snake_case
-- соответствуют @map(...) в prisma/schema.prisma.

-- Enum-типы
CREATE TYPE "BookingStatus"  AS ENUM ('CONFIRMED', 'CANCELLED');
CREATE TYPE "BookingKind"    AS ENUM ('BOOKING', 'BLOCK');
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'PROMOTED', 'CANCELLED');

-- Мастера
CREATE TABLE "masters" (
    "id"         TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "timezone"   TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "masters_pkey" PRIMARY KEY ("id")
);

-- Недельный график (часы в локальном времени мастера, минуты от полуночи)
CREATE TABLE "schedules" (
    "id"           TEXT NOT NULL,
    "master_id"    TEXT NOT NULL,
    "weekday"      INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute"   INTEGER NOT NULL,
    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "schedules_master_id_weekday_key" ON "schedules" ("master_id", "weekday");

-- Исключения графика (отпуск/перерыв) — диапазон в UTC
CREATE TABLE "schedule_exceptions" (
    "id"        TEXT NOT NULL,
    "master_id" TEXT NOT NULL,
    "start_at"  TIMESTAMPTZ(6) NOT NULL,
    "end_at"    TIMESTAMPTZ(6) NOT NULL,
    "reason"    TEXT NOT NULL DEFAULT '',
    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "schedule_exceptions_master_id_idx" ON "schedule_exceptions" ("master_id");

-- Услуги
CREATE TABLE "services" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "price_cents"  INTEGER NOT NULL,
    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- Связь мастер<->услуга (many-to-many)
CREATE TABLE "master_services" (
    "master_id"  TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    CONSTRAINT "master_services_pkey" PRIMARY KEY ("master_id", "service_id")
);

-- Записи (и ручные блокировки времени админом, kind = BLOCK)
CREATE TABLE "bookings" (
    "id"                TEXT NOT NULL,
    "master_id"         TEXT NOT NULL,
    "service_id"        TEXT,
    "customer_name"     TEXT,
    "customer_timezone" TEXT,
    "start_at"          TIMESTAMPTZ(6) NOT NULL,
    "end_at"            TIMESTAMPTZ(6) NOT NULL,
    "status"            "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "kind"              "BookingKind"   NOT NULL DEFAULT 'BOOKING',
    "idempotency_key"   TEXT,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings" ("idempotency_key");
CREATE INDEX "bookings_master_id_status_idx" ON "bookings" ("master_id", "status");

-- Лист ожидания
CREATE TABLE "waitlist_entries" (
    "id"                  TEXT NOT NULL,
    "master_id"           TEXT NOT NULL,
    "service_id"          TEXT NOT NULL,
    "customer_name"       TEXT NOT NULL,
    "customer_timezone"   TEXT,
    "start_at"            TIMESTAMPTZ(6) NOT NULL,
    "end_at"              TIMESTAMPTZ(6) NOT NULL,
    "status"              "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "promoted_booking_id" TEXT,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "waitlist_entries_master_id_start_at_end_at_status_idx"
    ON "waitlist_entries" ("master_id", "start_at", "end_at", "status");

-- Внешние ключи
ALTER TABLE "schedules"
    ADD CONSTRAINT "schedules_master_id_fkey"
    FOREIGN KEY ("master_id") REFERENCES "masters" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "schedule_exceptions"
    ADD CONSTRAINT "schedule_exceptions_master_id_fkey"
    FOREIGN KEY ("master_id") REFERENCES "masters" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "master_services"
    ADD CONSTRAINT "master_services_master_id_fkey"
    FOREIGN KEY ("master_id") REFERENCES "masters" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "master_services"
    ADD CONSTRAINT "master_services_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_master_id_fkey"
    FOREIGN KEY ("master_id") REFERENCES "masters" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_master_id_fkey"
    FOREIGN KEY ("master_id") REFERENCES "masters" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waitlist_entries"
    ADD CONSTRAINT "waitlist_entries_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
