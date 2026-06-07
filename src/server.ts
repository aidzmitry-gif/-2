import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Booking 2.0 слушает http://localhost:${config.port}`);
  console.log(`Клиент:  http://localhost:${config.port}/`);
  console.log(`Админка: http://localhost:${config.port}/admin`);
});
