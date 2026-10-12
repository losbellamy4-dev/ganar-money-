// Envío de correo. Proveedores: 'log' (desarrollo: escribe en el log y no envía nada) y 'resend' (API HTTP).
import { info } from './log.js';

export class EmailError extends Error {
  constructor(message, { retryable }) {
    super(message);
    this.retryable = retryable;
  }
}

export function createEmailer(config, { fetchImpl = globalThis.fetch } = {}) {
  if (config.emailProvider === 'resend') {
    if (!config.resendApiKey) throw new Error('EMAIL_PROVIDER=resend requiere RESEND_API_KEY.');
    return {
      provider: 'resend',
      async send({ to, subject, text }) {
        let res;
        try {
          res = await fetchImpl(config.resendApiUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text }),
            signal: AbortSignal.timeout(15000),
          });
        } catch (e) {
          throw new EmailError(`Error de red: ${e.message}`, { retryable: true });
        }
        if (res.ok) return { id: (await res.json().catch(() => ({}))).id ?? null };
        const detail = (await res.text().catch(() => '')).slice(0, 300);
        // 429 y 5xx son transitorios; el resto de 4xx (dirección inválida, dominio no verificado…) no.
        throw new EmailError(`Resend respondió ${res.status}: ${detail}`, { retryable: res.status === 429 || res.status >= 500 });
      },
    };
  }
  return {
    provider: 'log',
    async send({ to, subject }) {
      // No se registra el cuerpo: puede contener una clave de licencia.
      info('email_simulated', { to_domain: String(to).split('@')[1], subject });
      return { id: null };
    },
  };
}
