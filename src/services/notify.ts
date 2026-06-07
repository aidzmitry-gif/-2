import { DateTime } from 'luxon';
import { config } from '../config.js';

/**
 * Бонус: уведомления мастеру в Telegram. Если токен/чат не заданы в .env —
 * функции тихо ничего не делают (no-op), чтобы основная логику работала и без
 * настроенного Telegram. Все вызовы — fire-and-forget и никогда не бросают
 * исключений наружу.
 */

function fmt(when: Date, zone: string): string {
  return DateTime.fromJSDate(when).setZone(zone).toFormat('yyyy-MM-dd HH:mm');
}

async function sendTelegram(text: string): Promise<void> {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) return; // Telegram не настроен — пропускаем
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    // Уведомления не должны влиять на основной сценарий.
    console.warn('[notify] не удалось отправить сообщение в Telegram:', (err as Error).message);
  }
}

interface MasterLike {
  name: string;
  timezone: string;
}
interface ServiceLike {
  name: string;
}
interface BookingLike {
  customerName: string | null;
  startAt: Date;
}

export async function notifyBookingCreated(
  master: MasterLike,
  service: ServiceLike,
  booking: BookingLike,
): Promise<void> {
  const when = fmt(booking.startAt, master.timezone);
  await sendTelegram(
    `🟢 <b>Новая запись</b>\nМастер: ${master.name}\nУслуга: ${service.name}\nКлиент: ${booking.customerName ?? '—'}\nВремя (${master.timezone}): ${when}`,
  );
}

export async function notifyBookingCancelled(
  masterId: string,
  startAt: Date,
  endAt: Date,
): Promise<void> {
  // Зоны мастера здесь нет под рукой — показываем в UTC, этого достаточно для уведомления.
  const s = fmt(startAt, 'UTC');
  const e = DateTime.fromJSDate(endAt).toUTC().toFormat('HH:mm');
  await sendTelegram(`🔴 <b>Отмена записи</b>\nМастер: ${masterId}\nСлот (UTC): ${s}–${e}`);
}

export async function notifyWaitlistPromoted(
  customerName: string,
  masterId: string,
  startAt: Date,
  endAt: Date,
): Promise<void> {
  const s = fmt(startAt, 'UTC');
  const e = DateTime.fromJSDate(endAt).toUTC().toFormat('HH:mm');
  await sendTelegram(
    `⭐️ <b>Автозапись из листа ожидания</b>\nКлиент: ${customerName}\nМастер: ${masterId}\nСлот (UTC): ${s}–${e}`,
  );
}
