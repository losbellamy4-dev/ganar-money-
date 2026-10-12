# TECHNICAL_DECISIONS.md — Decisiones de arquitectura

Formato: decisión → motivo → alternativas descartadas → consecuencias.

## TD-01. Node.js 22 sin dependencias de producción
- **Decisión:** servidor con `node:http`, base de datos con `node:sqlite` y criptografía con `node:crypto`. Sin frameworks ni paquetes npm en producción.
- **Motivo:**
  - mínima superficie de ataque (`npm audit` limpio de forma trivial);
  - sin actualizaciones de dependencias que vigilar;
  - imagen pequeña;
  - el entorno ya tenía Node 22.
- **Descartado:**
  - Express o Fastify: añaden poco para unas pocas rutas.
  - `better-sqlite3`: módulo nativo con compilación.
- **Consecuencias:** `node:sqlite` aún emite un aviso de característica experimental (se silencia con `--disable-warning=ExperimentalWarning`). Si su API cambiara, el uso está concentrado en `src/server/db.js` y en unas pocas consultas. Requiere Node ≥ 22.13.

## TD-02. El XML se genera solo en el servidor; la validación, en ambos lados
- **Decisión:** el navegador carga los módulos de validación (`/lib/sepa/*.js`, lista blanca) para dar respuesta inmediata. `xml.js` **no** se sirve al navegador: el fichero lo construye el servidor.
- **Motivo:** los límites del plan (número de recibos, B2B) deben aplicarse en el servidor. Si el generador estuviera en el navegador, saltarse el límite sería trivial.
- **Descartado:** todo en el navegador. Daba más privacidad (los IBAN no saldrían del equipo), pero el plan Pro no se podría hacer cumplir.
- **Consecuencias:**
  - Los datos de los recibos viajan al servidor, que los procesa **en memoria, sin guardarlos ni registrarlos**. Una prueba verifica que no aparecen en los logs.
  - Comunicarlo con honestidad: la web no dice «tus datos no salen de tu equipo», sino «no se guardan».

## TD-03. Un solo núcleo SEPA isomórfico y verificado contra fuentes independientes
- **Decisión:** `src/sepa/` (ES modules sin dependencias) se usa en Node y en el navegador.
- **Verificación:**
  - Contra `python-stdnum`: oráculo independiente; fixtures generados con `scripts/crosscheck/gen_fixtures.py`.
  - Contra los XSD oficiales ISO 20022 (`test/fixtures/xsd`, tomados del paquete MIT `sepaxml`) con `xmllint`.
- **Límite conocido:** los XSD ISO son más permisivos que las guías del EPC y de cada banco. Las reglas EPC (juego de caracteres, identificadores sin espacios, longitudes) se implementan en el validador. Los XSD restringidos del EPC no estaban disponibles sin acceso web.

## TD-04. pain.008.001.02 por defecto, .08 opcional
- **Motivo:** la .02 es la versión que más tiempo llevan aceptando los bancos españoles. La .08 (ISO 2019) se ofrece para quien la necesite. No se pudo confirmar la exigencia concreta de los bancos españoles (`RESEARCH.md`).
- **Sin dirección postal:** el EPC aplazó en 2026 la retirada de direcciones no estructuradas y no es obligatoria para adeudos domésticos. Si fuera necesaria, se añadiría como campo opcional estructurado.

## TD-05. Licencias propias con clave aleatoria y HMAC en la base de datos
- **Decisión:**
  - clave `RL-XXXXX-XXXXX-XXXXX-XXXXX` (≈100 bits aleatorios, base32 de Crockford);
  - en la base de datos solo se guarda `HMAC-SHA256(APP_SECRET, clave)`;
  - el correo con la clave se borra de la cola tras enviarse.
- **Motivo:** se puede revocar, verificar en el servidor y no depende del proveedor de pagos. Un robo de la base de datos no revela claves utilizables.
- **Descartado:**
  - Licencias firmadas sin base de datos: no se pueden revocar sin una lista.
  - API de licencias del proveedor (Polar, Lemon Squeezy): dependencia de red en cada verificación y proveedor en transición.
- **Consecuencia:** `APP_SECRET` no se puede cambiar sin invalidar las licencias (lo advierten el preflight y `.env.example`).

## TD-06. Stripe por webhook, sin SDK, idempotente
- **Decisión:**
  - verificación de la cabecera `Stripe-Signature` (HMAC-SHA256, tolerancia de 5 min, comparación en tiempo constante);
  - registro del `event.id` en la **misma transacción** que sus efectos (licencia y correo en la cola);
  - si hay un error, respuesta 500 para que Stripe reintente, y alerta al administrador.
- **Motivo:** Payment Links no requiere programar el checkout. El webhook es el único punto que hay que asegurar.
- **Riesgo reconocido:** **no se ha probado contra Stripe real** (sin cuenta ni red). El formato de firma y los campos del evento siguen la documentación pública de Stripe. Hay que hacer una compra de prueba en modo test antes de lanzar (`DEPLOYMENT.md` §5).

## TD-07. Patrón *outbox* para el correo
- **Decisión:** los correos se escriben en la tabla `outbox` dentro de la transacción del hecho que los origina. Un trabajo los envía con reintentos (1 min, 5 min, 30 min, 2 h y 12 h; máximo 6 intentos), distingue errores transitorios de permanentes y, si fallan definitivamente, alerta.
- **Motivo:** no puede existir una licencia pagada sin su correo, ni un correo sin licencia. Una caída del proveedor de correo no pierde mensajes.
- **Consecuencia:** entrega «al menos una vez». Si el proceso cae justo tras enviar y antes de marcar el correo, podría reenviarse uno.

## TD-08. Planificador dentro del proceso con bloqueo en la base de datos
- **Decisión:** `setInterval` cada 30 s, con trabajos idempotentes y bloqueo por fila en `job_runs`. Estado visible en `/healthz` con token. `npm run worker:once` permite usar un cron externo.
- **Motivo:** una sola máquina es suficiente para este volumen y no necesita más infraestructura. El bloqueo evita ejecuciones dobles si alguna vez hay dos procesos.
- **Consecuencia:** la máquina no debe apagarse por inactividad (`auto_stop_machines = "off"` en `fly.toml`). Los planes gratuitos que suspenden el proceso no sirven.

## TD-09. Sin cookies ni analítica de terceros
- **Decisión:** solo contadores diarios agregados en el servidor (`usage_daily`), enviados por el navegador mediante una lista blanca de eventos. `localStorage` solo si el usuario lo pide (datos del acreedor) o al activar una licencia.
- **Motivo:** privacidad y cero banners de cookies. Es suficiente para los experimentos.
- **Consecuencia:** no se pueden contar usuarios únicos (ver `EXPERIMENTS.md`).

## TD-10. Interfaz en HTML y JavaScript sin compilación, con CSP estricta
- **Decisión:** HTML estático con plantillas mínimas (`{{BASE_URL}}`, datos del titular), módulos ES nativos y una sola hoja de estilos. CSP sin `unsafe-inline`; el modo oscuro respeta la preferencia del sistema.
- **Motivo:** rapidez, mantenimiento sencillo y protección frente a XSS (todo valor dinámico pasa por `esc()` y, además, la CSP impide ejecutar scripts en línea).
- **Excel .xlsx:** no se lee directamente (haría falta una dependencia como SheetJS). Se resuelve con «copiar y pegar», que funciona con cualquier hoja de cálculo, y con la subida de CSV, que detecta la codificación UTF-8 o Windows-1252 de Excel. Pendiente en `ROADMAP.md` si los usuarios lo piden (hay un evento de interés `xlsx` preparado).

## TD-11. SQLite en un volumen persistente con copia diaria
- **Motivo:** el volumen de datos es mínimo (licencias, contadores, cola). Copia diaria con `VACUUM INTO` (consistente en caliente) y retención de 14 días.
- **Consecuencia:** escala vertical en una máquina. Para varias regiones haría falta otra base de datos; no es necesario ahora.
