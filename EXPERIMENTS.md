# EXPERIMENTS.md — Hipótesis, pruebas, resultados y conclusiones

Regla: los umbrales para **continuar / cambiar / descartar** se fijan **antes** de tener datos y no se mueven después para que el resultado «salga bien».

Cómo medir sin cookies ni analítica de terceros: el servidor guarda contadores diarios sin datos personales en la tabla `usage_daily` y los envía en el informe diario. Eventos disponibles:
- `client_visit_app`, `client_data_loaded`, `client_validate_ok`, `client_validate_errors`, `client_limit_hit`, `client_pro_click`, `client_calc_creditor_id`, `client_template_download`;
- `generate_ok` (con número de recibos), `generate_invalid`, `generate_blocked_plan`, `interest_pro`.

**Limitación conocida:** sin cookies no se pueden contar usuarios únicos, solo eventos. Las conversiones se expresan sobre eventos (p. ej. `pro_click / visit_app`).

---

## EXP-00 — ¿Se puede generar un fichero técnicamente correcto? ✅ Ejecutado

| | |
|---|---|
| Hipótesis | El núcleo genera XML pain.008.001.02 y .08 válidos para cualquier entrada que supere la validación. |
| Método | (1) Verificación cruzada de IBAN, NIF/NIE/CIF e identificador de acreedor contra la biblioteca independiente `python-stdnum`: 2.840 casos. (2) Validación con `xmllint` contra los XSD oficiales ISO 20022: muestras fijas y 60 remesas aleatorias × 2 versiones. (3) E2E: el XML **descargado por el navegador** se valida con XSD. |
| Resultado | Todo pasa (`npm test`, `npm run test:e2e`). Las pruebas encontraron y obligaron a corregir 3 defectos reales: NIF con prefijo K/L/M, importe ambiguo «12,345» y detección de cabeceras parciales. |
| Límite | Los XSD ISO **no** garantizan que un banco concreto acepte el fichero. Ver EXP-04. |
| Conclusión | Continuar. |

## EXP-01 — ¿Hay uso real? (demanda)

| | |
|---|---|
| Hipótesis | Tesoreros y gestores que buscan cómo generar una remesa usarán una herramienta gratuita sin registro. |
| Requisitos | Producción desplegada, indexación en buscadores y acciones de comunidad autorizadas. |
| Duración | 8 semanas desde que Search Console muestre las páginas indexadas. |
| Métricas | `generate_ok` total, `client_visit_app`, días con al menos un `generate_ok`. |
| **Continuar si** | `generate_ok` ≥ 40 **y** `generate_ok` en ≥ 15 días distintos. |
| **Cambiar si** | 10–39 `generate_ok`: el problema probablemente es de distribución. Probar EXP-03 (alianzas) antes de decidir. |
| **Descartar si** | < 10 `generate_ok` tras EXP-01 y EXP-03 juntos. |
| Estado | ⏳ Bloqueado: requiere despliegue (decisión humana). |

## EXP-02 — ¿Pagarían? (disposición a pagar)

**Fase A (sin cobrar):** con los pagos sin configurar, Pro aparece como «Próximamente» con lista de espera. Es honesto: no se muestra precio ni se cobra.

| | |
|---|---|
| Métricas | `client_limit_hit`, `generate_blocked_plan`, `client_pro_click`, `interest_pro`. |
| **Señal positiva si** | ≥ 10 altas en la lista de espera **o** `pro_click / visit_app` ≥ 3 % en 8 semanas. |
| **Señal negativa si** | < 3 altas y `limit_hit` ≈ 0: el límite gratuito no molesta a nadie. Revisar el valor del límite antes de concluir. |

**Fase B (cobro real, requiere autorización):** pase anual de 49 € con IVA mediante Stripe Payment Link.

| | |
|---|---|
| **Continuar si** | ≥ 3 pagos en los primeros 60 días con pagos activos. |
| **Ajustar precio si** | Hay `pro_click` (≥ 20) pero 0 pagos: probar 29 €/año o un pago por remesa. |
| **Descartar Pro si** | 0 pagos y < 5 `pro_click` en 60 días. Valorar el modelo B2B2C (EXP-05). |
| Estado | ⏳ Fase A lista en el código; falta desplegar. Fase B requiere cuentas y autorización. |

## EXP-03 — ¿Funcionan las alianzas como canal?

| | |
|---|---|
| Hipótesis | Federaciones y asociaciones paraguas recomendarán una herramienta gratuita útil a sus miembros. |
| Método | Contactar de forma individual con 15 federaciones o entidades paraguas por canales públicos (formulario o email de contacto publicado para colaboraciones), ofreciendo la herramienta gratis. **Sin envíos masivos (LSSI art. 21).** |
| **Éxito** | ≥ 3 entidades la difunden y se observa un aumento de `visit_app` en la semana siguiente. |
| Estado | ⏳ Requiere autorización humana para contactar. |

## EXP-04 — ¿Aceptan los bancos los ficheros?

| | |
|---|---|
| Hipótesis | Los bancos españoles principales aceptan los ficheros generados (versión .02, sin BIC, identificador ES con sufijo 000). |
| Método | Pedir a los primeros usuarios (lista de espera o comunidades) que confirmen si su banco aceptó la remesa, y con qué banco. Registrar los resultados en una tabla. |
| **Éxito** | Aceptación confirmada en ≥ 3 entidades distintas sin cambios. |
| **Si falla** | Analizar el mensaje de rechazo, ajustar la generación y añadir una prueba de regresión. |
| Estado | ⏳ Necesita usuarios reales. **No se puede simular.** |

## EXP-05 — Alternativa B2B2C (solo si EXP-02 falla)

Hipótesis: gestorías y administradores de fincas que preparan remesas para muchos clientes pagarían por remesas grandes y procesamiento por lotes. Se diseñará en detalle solo si los datos de EXP-02 lo justifican.

---

## Registro de resultados

| Fecha | Experimento | Resultado | Decisión |
|---|---|---|---|
| 2026-10-12 | EXP-00 | Pasa (79 pruebas automáticas; 3 defectos encontrados y corregidos) | Continuar |
