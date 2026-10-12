// Registro estructurado (una línea JSON por evento). Nunca registrar IBAN, nombres ni claves de licencia.
let sink = (line) => process.stdout.write(`${line}\n`);

export function setLogSink(fn) {
  sink = fn;
}

export function log(level, msg, fields = {}) {
  sink(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
}

export const info = (msg, f) => log('info', msg, f);
export const warn = (msg, f) => log('warn', msg, f);
export const error = (msg, f) => log('error', msg, f);
// Las alertas llevan level=alert para poder filtrarlas en la plataforma de logs.
export const alert = (msg, f) => log('alert', msg, f);
