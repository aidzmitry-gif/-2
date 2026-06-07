-- 0002_exclude_constraint — третий, последний рубеж защиты от пересечений.
--
-- Prisma не умеет декларативно описывать EXCLUDE-ограничения, поэтому пишем
-- его вручную сырым SQL. Это БД-гарантия: даже если код и транзакция дали
-- сбой (гонка, баг, прямой psql-INSERT), сама база не даст создать вторую
-- пересекающуюся запись у одного мастера.
--
-- Механика:
--   btree_gist  — даёт GiST оператор `=` для скалярного master_id;
--   tstzrange(start_at, end_at, '[)')
--               — полуинтервал [начало, конец): соседние записи 10:00–11:00 и
--                 11:00–12:00 НЕ считаются пересечением;
--   WHERE status = 'CONFIRMED'
--               — отменённые записи (CANCELLED) слот не занимают; блокировки
--                 админа (kind = BLOCK) тоже CONFIRMED, поэтому участвуют.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_no_overlap"
    EXCLUDE USING gist (
        "master_id" WITH =,
        tstzrange("start_at", "end_at", '[)') WITH &&
    )
    WHERE ("status" = 'CONFIRMED');
