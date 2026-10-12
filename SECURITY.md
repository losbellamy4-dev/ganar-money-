# SECURITY.md — Medidas de seguridad y riesgos conocidos

## Datos que maneja el sistema

| Dato | Dónde | Protección |
|---|---|---|
| Datos de remesas (nombres, IBAN, importes, mandatos) | Solo en memoria durante la petición | No se escriben en BD ni en logs (verificado por la prueba `automation.e2e.js`). HTTPS en producción (HSTS). |
| Claves de licencia | BD: HMAC-SHA256 con `APP_SECRET`; navegador: `localStorage` si el usuario la activa | La clave en claro solo existe en el correo, cuyo cuerpo se borra de la cola tras enviarse. |
| Emails de clientes y de la lista de espera | BD | Lista de espera con consentimiento explícito. Sin exportación pública ni panel web. |
| IP de los visitantes | BD: HMAC diario truncado, borrado a los 2 días | Nunca se guarda en claro. |
| Secretos (`APP_SECRET`, Stripe, Resend) | Variables de entorno | Fuera del repositorio (`.gitignore` incluye `.env`). |

## Medidas implementadas (con prueba automática)

- **Límites del plan en el servidor:** número de recibos y B2B (`server.test.js`).
- **Límite de peticiones** por IP seudonimizada y por licencia, con `Retry-After`. Con `TRUST_PROXY` se usa la última IP de `X-Forwarded-For` para que no se pueda falsificar (`security.test.js`).
- **Protección contra fuerza bruta de licencias:** ≈100 bits de entropía y límite de intentos tanto en `/api/license/verify` como en `/api/generate`.
- **Webhook de Stripe:**
  - firma HMAC verificada en tiempo constante, tolerancia de 5 minutos e idempotencia por `event.id`;
  - sin secreto configurado responde 503 y no acepta eventos.
- **Validación de entradas:**
  - tipo de contenido JSON obligatorio y JSON mal formado → 400;
  - tamaño máximo con drenaje sin acumular en memoria, y corte inmediato si el tamaño declarado es desproporcionado;
  - lista blanca de eventos;
  - correo y consentimiento obligatorios en la lista de espera;
  - caracteres de control eliminados.
- **Ficheros estáticos:**
  - sin salir de `public/` (pruebas de *path traversal* con varias codificaciones);
  - lista blanca de módulos servidos al navegador; el generador XML no se expone.
- **Cabeceras:**
  - CSP estricta sin `unsafe-inline`;
  - `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`;
  - HSTS en producción.
- **Escapado:** escapado XML en el generador y HTML en la interfaz. La CSP es una segunda barrera frente a XSS.
- **Errores sin detalles internos:** las trazas de pila solo van al log del servidor.
- **`/healthz` público mínimo:** el detalle (trabajos, cola de correo) requiere `HEALTH_TOKEN`, comparado en tiempo constante.
- **Arranque seguro en producción:** el servidor se niega a arrancar sin `APP_SECRET` o con pagos activos y correo simulado. `npm run preflight` bloquea la publicación si falta configuración.
- **Sin superficie de administración web:** las licencias se gestionan por CLI con acceso al servidor.
- **Derechos RGPD:** `npm run license -- interest-list` permite consultar y `npm run license -- interest-delete --email …` borrar los datos de la lista de espera. Los IBAN de las remesas no se conservan, así que no hay nada que entregar ni suprimir.
- **Dependencias:** cero en producción. `npm audit` informa 0 vulnerabilidades (la única dependencia de desarrollo es `playwright-core`).

## Lo que NO se ha podido hacer (y por qué)

- **Escaneo DAST con HawkScan (StackHawk):** el CLI `hawk` no está instalado, no hay `HAWK_API_KEY` y la política de red del entorno bloquea `api.stackhawk.com`. **No se ha ejecutado.**
  - En su lugar se escribieron pruebas de seguridad específicas (`test/security.test.js` y partes de `server.test.js`) y se hizo una revisión manual del código.
  - Esa revisión encontró y corrigió:
    - IP falsificable con `X-Forwarded-For`;
    - intentos con licencias inválidas sin límite en `/api/generate`;
    - error 500 con URL mal codificada;
    - detalles internos expuestos en `/healthz`;
    - posible arranque con pagos activos sin correo real.
  - **Recomendación:** ejecutar HawkScan u otro escáner DAST contra el entorno de pruebas desplegado antes de abrir los pagos.
- **Pruebas contra Stripe y Resend reales:** no hay cuentas ni red. La lógica se probó con firmas generadas según la especificación pública y con un servidor HTTP que imita la API de Resend.

## Riesgos conocidos y aceptados

| Riesgo | Valoración | Mitigación / siguiente paso |
|---|---|---|
| `node:sqlite` es experimental en Node 22 | Bajo | Uso concentrado. Se puede cambiar a `better-sqlite3` si hiciera falta. |
| Entrega de correo «al menos una vez» (posible duplicado tras una caída) | Bajo | Aceptable para licencias y avisos. |
| La licencia guardada en `localStorage` es accesible a scripts de la página | Bajo | CSP estricta y sin scripts de terceros. |
| El límite gratuito se puede rodear dividiendo la remesa | Aceptado | Es fricción comercial, no un control de seguridad. Lo mide EXP-02. |
| Un atacante con muchas IP puede consumir CPU | Medio | Los límites por IP más el límite de tamaño acotan el coste por petición (milisegundos). En producción, añadir el límite o WAF de la plataforma si aparece abuso. |
| Responsabilidad si un fichero válido según XSD es rechazado por un banco | Medio | EXP-04, avisos en la web y limitación de responsabilidad en las condiciones. |

## Cómo informar de una vulnerabilidad
Escribir a la dirección de `SUPPORT_EMAIL` (configurada en producción). No abrir incidencias públicas con detalles explotables.
