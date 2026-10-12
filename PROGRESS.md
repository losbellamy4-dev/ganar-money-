# PROGRESS.md — Estado real del proyecto

Última actualización: **2026-10-12**.

## Resumen por dimensión (no se usa un único porcentaje)

| Dimensión | Estado | Justificación verificable |
|---|---|---|
| **Desarrollo técnico del MVP** | **≈ 92 %** (12 de 13 tareas) | Tabla de tareas. Falta la lectura directa de `.xlsx`, aplazada (se cubre con copiar y pegar o CSV). |
| **Pruebas completadas** | **≈ 70 %** de las categorías de prueba (14 de 20; 2 parciales) | 81 pruebas automáticas pasan (71 unitarias o de integración y 10 E2E). Pendientes: Stripe y Resend reales, compra en modo test, construcción de la imagen Docker, DAST, aceptación por bancos y otros navegadores. |
| **Automatización verificada** | **5 de 5 tareas programadas y 2 de 2 flujos de eventos**, verificados en un proceso real en modo producción **con proveedores simulados** | `test/e2e/automation.e2e.js`. **0 % verificado contra proveedores reales.** |
| **Despliegue** | **No desplegado** (configuración preparada y sin probar) | `Dockerfile`, `fly.toml` y `deploy/`. No hay demonio Docker ni cuentas. |
| **Validación comercial** | **Ninguna** | Sin usuarios no hay datos. Los experimentos están diseñados con umbrales previos (`EXPERIMENTS.md`). |
| **Usuarios reales** | **0** | — |
| **Ingresos efectivos** | **0 €** | — |

## Tareas

| Tarea | Estado | Evidencia | Pruebas ejecutadas | Resultado | Problemas pendientes | Siguiente acción |
|---|---|---|---|---|---|---|
| Inspección del entorno | ✅ | Este documento, §Entorno | — | Hecho | — | — |
| Investigación de 12 oportunidades | ✅ | `RESEARCH.md` | — | Hecho, con fuentes | Sin volúmenes de búsqueda (herramientas bloqueadas) | Medir con Search Console tras publicar |
| Puntuación reproducible y decisión | ✅ | `research/opportunities.json`, `npm run score`, `OPPORTUNITIES.md` | Ejecutado en 4 escenarios de pesos | SEPA primera en los 4 | Las puntuaciones son juicio propio | Revisar con datos de EXP-01/02 |
| Núcleo SEPA (IBAN, AT-02, NIF, texto, importes, fechas, XML .02/.08) | ✅ | `src/sepa/` | `sepa-core`, `table` y `validate-xml` (29 pruebas): 2.840 casos contra `python-stdnum` y 120 XML aleatorios contra XSD | Pasa; 3 defectos encontrados y corregidos | XSD ISO ≠ reglas de cada banco | EXP-04 |
| API de generación con límites en el servidor | ✅ | `src/server/app.js` | `server.test.js` | Pasa | — | — |
| Licencias (HMAC, CLI, caducidad) | ✅ | `src/server/licenses.js`, `scripts/license.js` | `server`, `worker` y E2E (licencia por CLI → Pro en el navegador) | Pasa | — | — |
| Webhook de Stripe (firma, idempotencia, revocación) | ✅ código | `src/server/stripe.js` | 6 pruebas de integración y 2 de flujo completo (`worker.test.js` y `automation.e2e.js`) con firmas según la especificación pública | Pasa | **No probado con Stripe real** | Compra en modo test (`DEPLOYMENT.md` §5) |
| Cola de correo con reintentos y alertas | ✅ código | `src/worker/jobs.js`, `src/server/email.js` | `worker.test.js` y servidor HTTP que imita Resend | Pasa | **No probado con Resend real** | Licencia manual de prueba tras desplegar |
| Tareas programadas (caducidad, limpieza, copia, informe) | ✅ | `src/worker/` | Pruebas unitarias y proceso real (las 5 en estado `ok`) | Pasa | Requiere que la máquina no se suspenda | `fly.toml` ya lo configura |
| Interfaz web (pegar o CSV, validación por fila, descarga) | ✅ | `public/` | 10 E2E con Chromium: el XML descargado se valida con XSD; sin errores de consola ni CSP | Pasa | Solo probado en Chromium | Probar en Firefox y Safari |
| Adaptación a móvil y accesibilidad básica | ✅ | Capturas en `docs/screenshots/` | E2E de 375 px sin desbordamiento; etiquetas, `aria-live`, foco visible | Pasa | Sin auditoría de accesibilidad completa | Auditoría con lector de pantalla |
| SEO (títulos, canónicas, sitemap, robots, 3 páginas útiles) | ✅ | `public/` | Plantillas probadas | Hecho | Sin indexar | Search Console |
| Textos legales | ⚠️ plantilla | `public/legal/` | Prueba de marcadores «PENDIENTE» | Pendiente de datos del titular | **Requiere persona y revisión profesional** | Completar `OWNER_*` |
| Seguridad (revisión y pruebas) | ✅ parcial | `SECURITY.md`, `test/security.test.js` | 8 pruebas específicas (incluido el borrado RGPD de la lista de espera); `npm audit`: 0 | 5 problemas corregidos | **DAST (HawkScan) no ejecutado**: sin CLI, sin clave y dominio bloqueado | DAST contra *staging* |
| Rendimiento | ✅ | Prueba con 5.000 recibos | Menos de 3 s por la API (≈125 ms del núcleo) | Pasa | — | — |
| Instalación limpia | ✅ | `npm ci` desde cero | Todas las pruebas repetidas | Pasa | — | — |
| Configuración de despliegue | ⚠️ escrita | `Dockerfile`, `fly.toml`, `deploy/`, `.env.example`, `scripts/preflight.js` | Preflight probado; arranque seguro probado | Imagen **no construida** | Sin Docker ni cuentas | Desplegar con autorización |
| Lectura directa de `.xlsx` | ⏸ aplazada | `ROADMAP.md` | — | — | Requiere una dependencia | Solo si hay demanda |
| Despliegue y publicación | ❌ | — | — | — | **Requiere decisiones humanas** (`BUSINESS_PLAN.md` §8) | Ver «Bloqueos» |
| Experimentos de demanda y pago | ❌ | `EXPERIMENTS.md` | — | — | Requieren publicación | Tras desplegar |

## Pruebas: inventario

Comandos: `npm test` (71) y `npm run test:e2e` (10). Todas pasan a 2026-10-12, también tras una instalación limpia.

| Categoría (Fase 11) | Estado |
|---|---|
| Instalación limpia | ✅ |
| Compilación | N/A (sin paso de compilación) |
| Unitarias | ✅ |
| Integración (servidor HTTP real y BD) | ✅ |
| Flujos principales (E2E con navegador) | ✅ |
| Validación de formularios | ✅ |
| Entradas inválidas | ✅ |
| Errores de red | ⚠️ parcial: errores de red del proveedor de correo probados; los errores de red en el navegador tienen gestión, pero no prueba |
| Persistencia | ✅ |
| Autenticación y permisos (licencias) | ✅ |
| Seguridad básica | ✅ (sin DAST) |
| Dependencias vulnerables | ✅ (`npm audit`: 0) |
| Rendimiento | ✅ |
| Compatibilidad | ⚠️ solo Chromium |
| Automatizaciones | ✅ (con proveedores simulados) |
| Control de costes (límites) | ✅ |
| Integraciones externas reales | ❌ |
| Pagos en modo test | ❌ (sin cuenta de Stripe) |
| Construcción de la imagen Docker | ❌ (sin demonio Docker) |
| DAST | ❌ (ver `SECURITY.md`) |

## Bloqueos (requieren intervención humana)

1. **Autorización para publicar** y elegir el alojamiento (Fly.io requiere tarjeta).
2. **Gasto:** dominio (≈ 10–15 €/año) y alojamiento (≈ 3–6 €/mes).
3. **Identidad del titular**, que debe ser un adulto, para el aviso legal, Stripe y la fiscalidad.
4. **Cuentas:** Stripe (empezar en modo test) y Resend (verificar el dominio).
5. **Consulta a un gestor** sobre el alta fiscal antes de cobrar.
6. **Autorización de acciones públicas de captación** (foros, federaciones, directorios).
7. **`HAWK_API_KEY` o acceso de red** para el escaneo DAST.

## Entorno inspeccionado (estado inicial)

- **Repositorio:** vacío, sin commits.
- **Herramientas:** Node 22.22, Python 3.13, Bun, Go, xmllint, lxml, Chromium y LibreOffice.
- **Docker:** CLI instalada, pero sin demonio.
- **Red:**
  - solo registros de paquetes (npm, PyPI);
  - WebSearch disponible; WebFetch falla (DNS);
  - dominios de StackHawk, Stripe y alojadores bloqueados.
- **Recursos:** 4 CPU, 15 GB de RAM y 30 GB de disco.
- **Conectores disponibles sin usar:** Vercel (el plan Hobby no permite uso comercial y no encaja con SQLite) y Hugging Face. No se publicó nada sin autorización.
