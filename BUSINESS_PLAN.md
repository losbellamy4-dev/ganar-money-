# BUSINESS_PLAN.md — RemesaLista

> **Estado (2026-10-12):** producto funcional y probado en local. **Sin desplegar, sin usuarios y sin ingresos.**
> Todas las cifras de este documento son estimaciones o hipótesis, salvo que se indique lo contrario.

## 1. Problema y público

- **Problema [H]:** para cobrar cuotas por domiciliación, el banco exige un XML ISO 20022 `pain.008`. Hay que generarlo desde Excel con conversores, software de gestión o plantillas con macros. Los errores de formato y de datos provocan rechazos (fuentes en `RESEARCH.md` §1).
- **Público principal [Hip]:** tesoreros, a menudo voluntarios, de asociaciones, AMPAs y clubes deportivos.
- **Público secundario [Hip]:**
  - academias y gimnasios pequeños;
  - administradores de fincas pequeños;
  - autónomos y pymes con cuotas recurrentes.

  El perfil común es una organización sin un software de gestión que genere el fichero, o cuyo banco no ofrece conversor.
- **Tamaño del público [E]:** decenas de miles de entidades potenciales. Solo la Comunitat Valenciana tenía 60.738 asociaciones activas en 2025. No hay dato de cuántas cobran por domiciliación.

## 2. Propuesta de valor

«Pega tu Excel, corrige lo que el banco rechazaría y descarga el XML. Sin registro y sin guardar los datos de tus socios.»

Diferencias frente a la competencia [Hip, pendiente de validar]:

| | RemesaLista | ConversorSEPA.es | Herramientas gratuitas | Conversor del banco |
|---|---|---|---|---|
| Precio | Gratis ≤ 25 recibos; Pro (hipótesis): 49 €/año | 20 €/mes + IVA | Gratis | Gratis (solo clientes de ese banco) |
| Registro | No | Sí (cuenta) | No | Banca online |
| Explicación de errores en castellano llano | Sí, por fila y campo | Desconocido | Variable | Variable |
| Calculadora de identificador de acreedor | Sí | Desconocido | No | No |
| Versiones .02 y .08 | Sí | Desconocido | Variable | Su versión |
| Almacenamiento de datos | No se guardan | Se borran a los 10 min | En el navegador | Banco |

## 3. Modelo de ingresos

**Freemium con licencia Pro.**

- **Gratis:** CORE, hasta 25 recibos por remesa. El límite es configurable y es un parámetro del experimento.
- **Pro:** hasta 5.000 recibos por remesa y esquema B2B.

**Modalidad de lanzamiento recomendada:** **pase anual de pago único** (Stripe Payment Link en modo *payment*). Motivos:

1. Encaja con el presupuesto anual de una asociación.
2. Evita la comisión de Stripe Billing (0,7 %) y la gestión de impagos.
3. El código ya lo soporta: licencia con caducidad, recordatorio 14 días antes y aviso de caducidad automáticos.

La suscripción mensual también está implementada (licencia revocada al cancelar) para probarla después.

**Precio [Hip]:** 49 €/año IVA incluido. Es menos de la quinta parte de lo que cuesta un año del competidor de suscripción, unos 290 € con IVA. Se valida en EXP-02 y no se publicará hasta que los pagos estén configurados.

> No se cobra nada ni se muestra precio mientras `CHECKOUT_URL` no esté configurado. En ese caso, el plan Pro aparece como «Próximamente» con lista de espera, y las funciones Pro existentes solo se activan con una licencia emitida manualmente.

## 4. Economía unitaria (estimaciones)

Supuestos:
- 49 € con IVA → base imponible de 40,50 € e IVA de 8,50 €, que se ingresa a Hacienda.
- Comisión de Stripe para una tarjeta de la UE: ≈ 1,5 % + 0,25 € ≈ 0,99 € (fuentes secundarias, `RESEARCH.md`; verificar en stripe.com).

| Concepto | Por cliente y año |
|---|---|
| Ingreso neto de IVA | 40,50 € |
| Comisión de pago | −0,99 € |
| **Margen de contribución** | **≈ 39,5 €/año ≈ 3,29 €/mes** |

### Costes fijos mensuales estimados (ver `COSTS.md`)
- **Infraestructura:** ≈ 4 €/mes (máquina pequeña con volumen, dominio prorrateado, plan gratuito de correo).
- **Si el titular debe darse de alta como autónomo:** la cuota mensual domina todo el cálculo. Las calculadoras consultadas dan cifras distintas (desde unos 80 € de tarifa plana el primer año hasta más de 200 €/mes), así que **hay que confirmarlo con un gestor**.

### Punto de equilibrio [E]

| Escenario | Costes fijos/mes | Clientes Pro anuales necesarios |
|---|---|---|
| Solo infraestructura | ≈ 4 € | **2** |
| Infraestructura + cuota reducida (≈ 80 €) | ≈ 84 € | **≈ 26** |
| Infraestructura + cuota ordinaria (≈ 230 €) | ≈ 234 € | **≈ 72** |

El coste variable por remesa es prácticamente cero (CPU local, sin APIs de pago). El margen bruto sobre la infraestructura es alto, pero **el negocio solo es rentable si se consiguen decenas de clientes de pago**. Eso todavía no se ha demostrado.

## 5. Adquisición de usuarios

Sin presupuesto de publicidad. Canales por orden de prioridad:

| Canal | Acción | Coste | Métrica | Objetivo (no es un resultado) |
|---|---|---|---|---|
| SEO de intención clara | 3 páginas útiles ya creadas: guía de remesa, errores y códigos de devolución, calculadora del identificador de acreedor. Alta en Google Search Console y Bing Webmaster (requiere persona). | 0 € | Impresiones y clics (Search Console) y evento `visit_app` | 500 visitas/mes a los 4 meses de la indexación |
| Comunidades | Responder de forma útil a preguntas sobre remesas en foros (comunidad Sage, grupos de tesoreros, foros de AMPAs y clubes), siempre identificándose y sin spam. | 0 € (tiempo) | Visitas por referencia | 10 respuestas útiles en 8 semanas |
| Alianzas | Ofrecer la herramienta gratis a federaciones (de AMPAs, deportivas) y a asesorías de entidades sin ánimo de lucro para que la recomienden. | 0 € | Entidades que la difunden | 3 acuerdos de difusión |
| Boca a boca | Herramienta gratuita que funciona: el tesorero se la pasa al siguiente. | 0 € | Uso recurrente mensual | — |
| Directorios | Alta en directorios de herramientas gratuitas en español. | 0 € | Enlaces entrantes | 5 |

**Restricción legal [H]:** el artículo 21 de la LSSI prohíbe enviar comunicaciones comerciales por email sin consentimiento previo, también a empresas. **No se harán envíos masivos ni correos en frío.** El contacto será a través de canales públicos o formularios, de forma individual y transparente, y siempre con autorización del titular.

Toda publicación pública (alta en directorios, mensajes en foros, contacto con federaciones) **requiere autorización humana**.

## 6. Riesgos principales

| Riesgo | Probabilidad [Hip] | Mitigación |
|---|---|---|
| Nadie paga: el banco y las herramientas gratuitas bastan | Alta | Medirlo pronto (EXP-02). Si se confirma, explorar el modelo B2B2C con gestorías y administradores de fincas (EXP-05) o cerrar. |
| Fichero rechazado por un banco concreto | Media | Validación contra XSD oficial y reglas EPC. Pedir a los primeros usuarios que confirmen la aceptación (EXP-04). Versión .02 por defecto. |
| SEO lento o insuficiente | Alta | Comunidades y alianzas en paralelo. |
| Responsabilidad por errores en cobros | Baja–media | Condiciones con limitación de responsabilidad, avisos claros y recomendación de remesa de prueba. |
| Normativa (cambios ISO/EPC) | Media | Arquitectura con versiones intercambiables; seguimiento de los anuncios del EPC. |
| Protección de datos (IBAN) | Baja | No se almacenan, no se registran y se procesan en memoria. Encargo de tratamiento en las condiciones. |

## 7. Requisitos legales y fiscales (requieren persona)

- **Identidad del titular** en el aviso legal (LSSI art. 10). La web lo muestra como «PENDIENTE» y `npm run preflight` bloquea la publicación hasta completarlo.
- **Alta fiscal:** facturar de forma habitual requiere, en general, darse de alta como autónomo o constituir una sociedad, y declarar el IVA. Si las ventas son a particulares de otros países de la UE, se aplica el régimen OSS. **Consultar con un gestor antes de cobrar.**
- **Edad:** si el responsable es menor de edad, Stripe exige que un tutor legal sea el titular de la cuenta para recibir pagos, y las cuentas Express o Custom exigen 18 años (`RESEARCH.md`). Los contratos con clientes y el alta fiscal también requieren a un adulto responsable. **No se debe falsear la edad ni la identidad.**
- **Revisión legal:** los textos legales (`public/legal/*`) son una plantilla razonable, no asesoramiento jurídico. Conviene que los revise un profesional antes de cobrar.

## 8. Qué decisiones humanas faltan

1. **Autorizar la publicación** y elegir el proveedor de alojamiento. Fly.io requiere tarjeta; un VPS requiere administración (`DEPLOYMENT.md`).
2. **Comprar un dominio**, unos 10–15 €/año.
3. **Datos del titular** para el aviso legal.
4. **Abrir las cuentas de Stripe y Resend** y verificar el dominio de correo.
5. **Aprobar el precio** y la modalidad: pase anual frente a suscripción.
6. **Autorizar las acciones de captación públicas** de la sección 5.
