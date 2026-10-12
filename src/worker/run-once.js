// Ejecuta una vez los trabajos pendientes y termina. Útil si la plataforma ofrece cron externo
// en lugar de un proceso siempre encendido. Uso: npm run worker:once [-- --force]
import { loadConfig } from '../server/config.js';
import { openDatabase } from '../server/db.js';
import { createEmailer } from '../server/email.js';
import { createJobs } from './jobs.js';
import { createScheduler } from './scheduler.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const emailer = createEmailer(config);
const scheduler = createScheduler({ db, config, jobs: createJobs({ db, config, emailer }) });
const results = await scheduler.tick({ force: process.argv.includes('--force') });
console.log(JSON.stringify(results, null, 2));
db.close();
process.exitCode = results.some((r) => r.status === 'error') ? 1 : 0;
