import { Router } from 'express';
import { slotBus, type SlotEvent } from '../events/bus.js';

export const eventsRouter = Router();

// Server-Sent Events: живое обновление слотов в открытых вкладках.
eventsRouter.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.write('event: ready\ndata: {"ok":true}\n\n');

  const send = (event: SlotEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = slotBus.subscribe(send);

  // Пинг, чтобы прокси не закрывали простаивающее соединение.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});
