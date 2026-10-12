# DEPLOYMENT.md — Instalación, configuración y despliegue

## 0. Estado del despliegue (2026-10-12)

| Entorno | Estado | Evidencia |
|---|---|---|
| Local (desarrollo) | ✅ Funciona | `npm start`; pruebas E2E con Chromium. |
| Proceso en modo producción (local) | ✅ Funciona con proveedores simulados | `test/e2e/automation.e2e.js`: HSTS, webhook → correo, tareas programadas, copia de seguridad. |
| Imagen Docker | ⚠️ Escrita, **no construida** | No hay demonio Docker en el entorno de desarrollo. |
| Entorno de pruebas público (*staging*) | ❌ No existe | Requiere cuenta de alojamiento y autorización. |
| Producción | ❌ No desplegado | Igual. |
| Disponibilidad pública | ❌ **La web no está publicada** | — |

## 1. Requisitos
- Node.js ≥ 22.13 (se usa `node:sqlite`). Comprobado con 22.22.0.
- Un disco persistente para `DATA_DIR` (base de datos y copias de seguridad).
- Opcional para desarrollo: `xmllint` (pruebas XSD) y Chromium (pruebas E2E).

## 2. Ejecución local
```bash
npm install          # solo instala la dependencia de desarrollo (playwright-core)
npm start            # http://localhost:3000 (correos simulados en el log; datos en ./data)
npm test             # 71 pruebas unitarias y de integración
npm run test:e2e     # 10 pruebas E2E (requiere Chromium; ver CHROMIUM_PATH)
```

## 3. Comparación de alojamiento

Fuentes y fechas en `RESEARCH.md` y `COSTS.md`. **Verifica las condiciones actuales antes de contratar.**

| Opción | Coste aprox. | Tarjeta | ¿Se suspende sin uso? | Disco persistente | Uso comercial | Encaje |
|---|---|---|---|---|---|---|
| **Fly.io** (1 máquina de 256 MB + volumen de 1 GB) | ≈ 2–3 $/mes | Sí | No, si `auto_stop_machines = "off"` | Sí (volumen) | Sí | ✅ **Recomendada**: barata, HTTPS incluido, región Madrid, `fly.toml` incluido. |
| **VPS** (p. ej. Hetzner CX23) + Caddy | ≈ 5,5 €/mes | Sí | No | Sí | Sí | ✅ Alternativa: más control, pero hay que administrar el sistema operativo y las actualizaciones. Ficheros en `deploy/`. |
| Render (plan gratuito) | 0 € | No | **Sí** (arranque en frío de 30–60 s) | No en el gratuito | Sí | ❌ Sin disco persistente se perderían licencias, y el planificador no corre mientras está suspendido. |
| Vercel Hobby | 0 € | No | Modelo *serverless* | No | **No (uso no comercial)** | ❌ Prohibido para un producto de pago e incompatible con SQLite y el planificador. |
| Cloudflare Workers | 0 € / bajo | No | Modelo *serverless* | D1 (otra base de datos) | Sí | ⚠️ Exigiría reescribir el servidor para el runtime de Workers. No compensa ahora. |

## 4. Despliegue en Fly.io (recomendado). **Requiere persona: cuenta, tarjeta y autorización.**
```bash
fly auth login
fly launch --no-deploy --copy-config --name <nombre-libre>   # usa fly.toml
fly volumes create remesalista_data --region mad --size 1
fly secrets set APP_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  BASE_URL=https://<tu-dominio> OWNER_NAME="..." OWNER_TAX_ID="..." OWNER_ADDRESS="..." OWNER_EMAIL="..." \
  SUPPORT_EMAIL="..." EMAIL_PROVIDER=resend RESEND_API_KEY=re_... EMAIL_FROM="RemesaLista <hola@tu-dominio>" \
  ADMIN_EMAIL="..." HEALTH_TOKEN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
fly deploy
fly certs add <tu-dominio>      # y crea los registros DNS que indique
```
Antes de desplegar, comprueba la configuración: `fly ssh console -C "npm run preflight"` (o en local, con las mismas variables).

**Importante:** guarda `APP_SECRET` en un gestor de contraseñas. Si se pierde o se cambia, las licencias emitidas dejan de validar.

## 5. Activar los pagos (Stripe). **Requiere persona: cuenta de Stripe a nombre de un adulto titular.**
1. En Stripe, en **modo de prueba**, crea el producto «RemesaLista Pro» con un precio. Recomendado: pago único anual (ver `BUSINESS_PLAN.md`).
2. Crea un **Payment Link** para ese precio. Configura la página de confirmación para que indique «Recibirás tu clave por correo».
3. Crea el **webhook** apuntando a `https://<tu-dominio>/api/webhooks/stripe` con estos eventos:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `customer.subscription.deleted`
4. Define `CHECKOUT_URL` (URL del Payment Link), `STRIPE_WEBHOOK_SECRET` (`whsec_...`) y `PRO_PRICE_LABEL` (p. ej. `49 €/año IVA incluido`).
5. **Prueba de extremo a extremo en modo test:**
   - haz una compra con la tarjeta de prueba `4242 4242 4242 4242`;
   - comprueba que llega el correo con la clave;
   - comprueba que la clave desbloquea una remesa de más de 25 recibos;
   - comprueba que el panel de Stripe marca el webhook como entregado (200).
6. Solo después, y **con autorización explícita**, cambia a claves y enlace de modo real.

Si algo falla, el webhook responde 500, Stripe reintenta y el administrador recibe una alerta por correo. Las licencias también se pueden emitir a mano:
```bash
npm run license -- issue --email cliente@ejemplo.es --days 365 --note "transferencia 2026-10-20"
```

## 6. Correo (Resend). **Requiere persona.**
1. Crea una cuenta y verifica el dominio de envío (registros DNS SPF/DKIM).
2. Define `RESEND_API_KEY` y `EMAIL_FROM` con ese dominio.
3. El informe diario y las alertas llegan a `ADMIN_EMAIL`.

## 7. Despliegue en un VPS (alternativa)
```bash
# Como root en Debian/Ubuntu con Node 22 y Caddy instalados:
useradd --system --home /opt/remesalista remesalista
git clone <repo> /opt/remesalista && cd /opt/remesalista && npm ci --omit=dev
mkdir -p /var/lib/remesalista && chown remesalista /var/lib/remesalista
cp .env.example /etc/remesalista.env && chmod 600 /etc/remesalista.env   # edítalo: DATA_DIR=/var/lib/remesalista, TRUST_PROXY=1
cp deploy/remesalista.service /etc/systemd/system/ && systemctl enable --now remesalista
cp deploy/Caddyfile /etc/caddy/Caddyfile   # cambia el dominio
systemctl reload caddy
```
⚠️ El unit de systemd y el Caddyfile no se han probado en un servidor real.

## 8. Comprobaciones de salud y supervisión
- `GET /healthz` → `{status: "ok" | "degraded", problems: [...]}`. Responde 200 mientras el proceso y la base de datos respondan.
- Con `Authorization: Bearer $HEALTH_TOKEN` incluye además el estado de cada tarea programada, la cola de correo y si los pagos están configurados.
- Problemas que se notifican:
  - `scheduler_stalled`: el planificador no ha hecho ningún ciclo en 5 minutos;
  - `job_error`: ha fallado la última ejecución de alguna tarea;
  - `outbox_backlog`: hay correos pendientes desde hace más de 15 minutos;
  - `outbox_failed`: hay correos fallidos que requieren revisión.
- Los logs son JSON por línea. Las alertas llevan `"level":"alert"`. Además se envía un correo a `ADMIN_EMAIL` cuando falla una tarea, un webhook o un correo.
- Recomendado: un monitor externo gratuito (p. ej. UptimeRobot) contra `/healthz`. **Requiere persona.**

## 9. Copias de seguridad y recuperación
- **Copia automática diaria** (04:00, hora de Madrid) en `DATA_DIR/backups/remesalista-AAAA-MM-DD.sqlite`, con una retención de 14 días (`BACKUP_RETENTION_DAYS`).
- **Restaurar:**
  1. Detén el servicio.
  2. Sustituye `remesalista.sqlite` por la copia y borra los ficheros `-wal` y `-shm`.
  3. Arranca el servicio.
- Las copias están en el mismo volumen. Para protegerse de la pérdida del volumen, descárgalas periódicamente: `fly ssh sftp get` o `rsync`.
- **Recuperación tras una interrupción:**
  - los trabajos son idempotentes;
  - los correos pendientes se reintentan al volver;
  - los bloqueos de tareas caducan solos a los 10 minutos;
  - Stripe reintenta los webhooks durante días.

## 10. Actualizar
```bash
git pull && npm test && fly deploy        # o, en un VPS: git pull && systemctl restart remesalista
```
Las migraciones de la base de datos son automáticas y versionadas (`schema_version`) al arrancar.

## 11. Lista de comprobación antes de publicar
- [ ] `NODE_ENV=production npm run preflight` sin fallos.
- [ ] Datos del titular revisados en `/legal/aviso-legal`.
- [ ] Textos legales revisados por una persona (idealmente un profesional).
- [ ] Correo de prueba recibido (licencia manual con la CLI).
- [ ] Remesa real pequeña aceptada por el banco del titular (EXP-04).
- [ ] Monitor externo de `/healthz`.
- [ ] Escaneo DAST contra *staging* (HawkScan u otro).
- [ ] Alta en Google Search Console y envío de `sitemap.xml`.
