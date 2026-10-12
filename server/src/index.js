import { config } from './config.js';
import { createApp } from './app.js';
import { startSheetsWorker } from './services/sheetsSync.js';

const app = createApp();

const server = app.listen(config.PORT, () => {
  console.log(`server listening on :${config.PORT} (${config.NODE_ENV})`);
});

const stopSheetsWorker = startSheetsWorker();

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  stopSheetsWorker();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
