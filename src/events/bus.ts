import { EventEmitter } from 'node:events';

/**
 * Простая шина событий внутри процесса. Сервисы публикуют изменения слотов,
 * SSE-роут (`/api/events`) ретранслирует их подключённым вкладкам.
 */
export type SlotEvent =
  | { type: 'booking_created'; masterId: string; startAt: string; endAt: string; kind: 'BOOKING' | 'BLOCK' }
  | { type: 'booking_cancelled'; masterId: string; startAt: string; endAt: string }
  | { type: 'waitlist_promoted'; masterId: string; startAt: string; endAt: string; bookingId: string };

class SlotBus extends EventEmitter {
  publish(event: SlotEvent): void {
    this.emit('slot', event);
  }
  subscribe(listener: (event: SlotEvent) => void): () => void {
    this.on('slot', listener);
    return () => this.off('slot', listener);
  }
}

// Чуть больше слушателей, чем дефолтные 10 (много открытых вкладок).
export const slotBus = new SlotBus();
slotBus.setMaxListeners(1000);
