# COSTS.md — Costes reales, estimaciones y dependencias económicas

## Costes reales a 2026-10-12

| Concepto | Importe |
|---|---|
| Desarrollo, investigación y pruebas (en este entorno) | **0 €** |
| Servicios contratados | **0 €** (ninguno) |
| Publicidad | **0 €** |
| **Total gastado** | **0 €** |

No se ha comprado, contratado ni suscrito nada.

## Costes estimados de funcionamiento

Los precios proceden de fuentes secundarias consultadas el 2026-10-12 (`RESEARCH.md` y abajo). **Verificar en la web de cada proveedor antes de contratar.**

| Concepto | Opción | Estimación | Fuente / nota |
|---|---|---|---|
| Servidor | Fly.io `shared-cpu-1x` con 256 MB | ≈ 2–2,5 $/mes | [fly.io/docs/about/pricing](https://fly.io/docs/about/pricing/), [costbench](https://costbench.com/software/developer-tools/flyio). Requiere tarjeta. |
| Volumen persistente (SQLite) | Fly.io, 1 GB | ≈ 0,15 $/mes | Mismas fuentes. |
| Alternativa: VPS | Hetzner CX23 (2 vCPU, 4 GB) | ≈ 5,49 €/mes | [kimmo.suominen.com](https://kimmo.suominen.com/stuff/cpc-2026-08.txt). Hubo subidas en 2026; requiere administrar el sistema. |
| Dominio `.es` o `.com` | Cualquier registrador | ≈ 10–15 €/año | Estimación. |
| Correo transaccional | Resend Free | 0 € (3.000/mes, 100/día) | [automationatlas](https://automationatlas.io/answers/resend-free-tier-explained-2026/). Pro: 20 $/mes por 50.000. |
| Pagos (pase anual) | Stripe, tarjeta de la UE | ≈ 1,5 % + 0,25 € por cobro | [checkoutpage](https://checkoutpage.com/blog/stripe-international-fees). Algunas fuentes dan 1,9 %. |
| Suscripciones (si se usan) | Stripe Billing | +0,7 % del volumen | [usagebox](https://usagebox.com/articles/stripe-billing-fees-2026-the-07-percent-math). |
| APIs de IA u otras | — | **0 €** | El producto no depende de APIs de pago. |

### Total estimado
- **Con Fly.io:** ≈ 3–4 €/mes (servidor, volumen y dominio prorrateado), más las comisiones de cada venta.
- **Con un VPS:** ≈ 6–7 €/mes.

**Coste variable por remesa:** prácticamente 0 €. Generar el XML es un cálculo local de milisegundos y no se guardan datos.

### Control de consumo implementado
- Límite de peticiones por IP (gratuito) y por licencia (Pro).
- Cuerpo de petición de 3 MB como máximo.
- Hasta 5.000 recibos por fichero.
- Tiempo máximo por petición de 30 s.
- Limpieza diaria de datos temporales y retención de copias de seguridad de 14 días.
- Límite del plan gratuito de Resend: 100 correos/día. Con el volumen esperado (licencias, avisos, informe diario) sobra margen. Si se supera, los correos se reintentan con espera creciente y, si fallan definitivamente, se genera una alerta.

## Costes que dependen de una decisión humana
- **Alta como autónomo o sociedad** para facturar. Es la partida mayor: cuota mensual de autónomos, gestoría y posibles impuestos. Ver `BUSINESS_PLAN.md` §4 y §7. **No incluida en el total técnico.**
- **Revisión legal** de los textos (opcional, recomendable).

## Dependencias económicas
| Dependencia | Riesgo | Alternativa |
|---|---|---|
| Stripe | Cambio de comisiones o rechazo de la cuenta | Webhook aislado en `src/server/stripe.js`. Se puede añadir otro proveedor emitiendo licencias con `issueLicense`, y la CLI permite licencias manuales (p. ej. pago por transferencia). |
| Resend | Cambios en el plan gratuito | Interfaz `send()` de 20 líneas en `src/server/email.js`. Cambiar de proveedor afecta solo a ese fichero. |
| Alojamiento | Subidas de precio (Hetzner subió en 2026) | Imagen Docker estándar y servidor Node sin dependencias. Se puede mover a cualquier VPS o PaaS con disco persistente. |
