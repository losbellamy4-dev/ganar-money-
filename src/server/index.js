// Punto de entrada: servidor HTTP + planificador de tareas en el mismo proceso.
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createEmailer } from './email.js';
import { createApp } from './app.js';
import { createJobs } from '../worker/jobs.js';
import { createScheduler } from '../worker/scheduler.js';
import * as logger from './log.js';

const config = loadConfig();
if (config.production && !config.appSecret) {
  logger.error('config_invalid', { error: 'APP_SECRET es obligatorio en producción. Ejecuta «npm run preflight» para ver qué falta.' });
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const emailer = createEmailer(config);
const scheduler = config.schedulerEnabled ? createScheduler({ db, config, jobs: createJobs({ db, config, emailer }) }) : null;
const app = createApp({ config, db, emailerInfo: emailer.provider, scheduler });

const server = createServer(app);
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(config.port, config.host, () => {
  logger.info('server_started', { port: config.port, production: config.production, email: emailer.provider, scheduler: Boolean(scheduler) });
  scheduler?.start();
});

let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info('server_stopping', { signal });
  scheduler?.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => logger.error('unhandled_rejection', { error: String(e?.message ?? e) }));
