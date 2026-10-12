# OPPORTUNITIES.md — Comparación, puntuación y decisión

Evaluación: 2026-10-12. Las fuentes de cada afirmación están en `RESEARCH.md`.

## 1. Sistema de evaluación reproducible

- **Datos:** `research/opportunities.json` (criterios, pesos y puntuaciones de 1 a 5).
- **Cálculo:** `node scripts/score-opportunities.mjs` (ranking por escenario) o `--markdown` (tabla).
- **Fórmula:** media ponderada normalizada a 0–100 (1 → 0, 5 → 100). El script falla si los pesos base no suman 100 o si alguna puntuación está fuera de rango.
- **Escala:** 5 es siempre lo más favorable para nosotros. En coste, competencia, complejidad, dependencia y riesgo, un 5 significa que son **bajos**.

### Criterios y pesos

| Criterio | Peso | Por qué este peso |
|---|---|---|
| Demanda demostrable | 14 | Sin demanda no hay negocio. Es el criterio más importante. |
| Disposición a pagar | 12 | Usuarios que no pagan no cubren costes (lección de la publicidad y la afiliación). |
| Facilidad para conseguir usuarios | 10 | Sin presupuesto de anuncios, la distribución orgánica decide. |
| Posibilidad de automatización | 8 | Requisito explícito del proyecto: mínima intervención humana. |
| Competencia (5 = baja) | 7 | Importa, pero un mercado con competidores que cobran también confirma la demanda. |
| Diferenciación posible | 6 | |
| Coste mensual (5 = bajo) | 6 | El presupuesto es limitado y el coste recurrente es lo que mata los proyectos pequeños. |
| Margen potencial | 6 | |
| Coste inicial (5 = bajo) | 5 | |
| Tiempo de desarrollo (5 = corto) | 5 | |
| Compatibilidad con recursos disponibles | 5 | Sin claves de API ni cuentas externas; solo Node, Python y pruebas locales. |
| Complejidad técnica (5 = baja) | 4 | |
| Potencial de crecimiento | 4 | Se prioriza la viabilidad sobre el tamaño. |
| Dependencia de terceros (5 = baja) | 4 | |
| Riesgo legal (5 = bajo) | 4 | |

### Análisis de sensibilidad
El script recalcula el ranking con tres juegos de pesos alternativos:
- **pesos iguales**;
- **prioridad a demanda y pago** (sobre todo demanda, pago y captación);
- **prioridad a coste y rapidez**.

## 2. Resultados

| # | Oportunidad | Puntuación base (0-100) | Posición con «pesos_iguales» | Posición con «prioridad_demanda_y_pago» | Posición con «prioridad_coste_y_rapidez» |
|---|---|---|---|---|---|
| 1 | Generador de remesas SEPA (Excel/CSV → XML pain.008) para asociaciones, clubes y pymes en España | 71.5 | 1 | 1 | 1 |
| 2 | Conversor de ficheros Norma 43 (extractos bancarios españoles) → Excel/OFX | 58.3 | 2 | 8 | 4 |
| 3 | Sitio de calculadoras fiscales/laborales en español (tráfico orgánico + anuncios/afiliación) | 54.3 | 5 | 4 | 5 |
| 4 | Plantillas descargables (Excel/Notion) para autónomos | 54.3 | 3 | 6 | 3 |
| 5 | Extensión de navegador freemium (problema por concretar) | 52.5 | 6 | 5 | 6 |
| 6 | Conversor de extractos bancarios PDF → Excel/CSV | 52.3 | 7 | 2 | 8 |
| 7 | API de validación de IBAN/NIF de pago por uso | 51 | 4 | 11 | 2 |
| 8 | Software de facturación conforme a VeriFactu para autónomos | 47 | 11 | 3 | 12 |
| 9 | Web de comparación y afiliación en un nicho | 41.3 | 8 | 12 | 7 |
| 10 | Herramienta de IA generativa de propósito concreto (wrapper sobre API de LLM) | 40.5 | 9 | 10 | 9 |
| 11 | Automatización de solicitudes de reseñas (Google) para negocios locales | 40.2 | 10 | 9 | 10 |
| 12 | Recordatorios de citas por WhatsApp para peluquerías y clínicas | 37.5 | 12 | 7 | 11 |

**La ganadora es robusta frente a los pesos.** SEPA es primera en los cuatro escenarios.

**No es robusta frente a las puntuaciones:** las asigné yo, con la evidencia disponible.

- **Sesgo posible:** investigué SEPA con más profundidad que las demás, y eso puede favorecerla.
- **Corrección aplicada:** al encontrar más competidores (una herramienta gratuita en el navegador y los conversores de los bancos), **bajé su puntuación de competencia de 3 a 2**. Sigue primera, con 71,5 frente a 58,3.

## 3. Justificación resumida de las puntuaciones

| Oportunidad | Puntos fuertes (evidencia) | Puntos débiles (evidencia) |
|---|---|---|
| SEPA | Competidores que cobran (20 €/mes + IVA; 3,15 €/lote; licencias de 155 €). Estándar público con XSD verificable. Sin coste variable ni APIs. | Herramientas gratuitas, conversores Excel de CaixaBank y Santander, software de gestión de socios. Nicho limitado a España (de momento). |
| Norma 43 | Barato, rápido, sin dependencias. | Existen conversores gratuitos (norma43.net, Bankinter, csb43). La única oferta de pago encontrada cuesta 5,95 €. El software contable ya importa N43. Disposición a pagar ≈ nula. |
| Calculadoras SEO | Coste casi nulo, demanda de búsqueda. | Competencia con miles de calculadoras. RPM de 0,5–2,5 $. Caída del CTR por los AI Overviews. Los usuarios no pagan. |
| Plantillas | Muy rápido. | Plantillas gratuitas de Quipu, Stelorder, Qonto e InfoAutónomos. Saturación en Etsy (más de 50.000 anuncios). |
| PDF → Excel | Demanda alta y pagos probados (9–79 $/mes). | Mercado saturado. Precisión imposible de verificar aquí sin extractos reales. Probable coste de OCR o IA. |
| VeriFactu | Obligación legal masiva desde 2027. | Complejidad (AEAT, certificados), responsabilidad del productor del software, sanciones de hasta 50.000 €, grandes competidores. |
| IA wrapper | Demanda general. | No hay clave de API. Márgenes erosionados por la inferencia. Competencia enorme. |
| Resto | Ver `RESEARCH.md`. | Distribución difícil (venta local), costes variables (SMS, WhatsApp) o falta de un problema concreto. |

## 4. Las tres mejores, en profundidad

### 4.1 Remesas SEPA (puntuación 71,5)
- **Demanda:** varios productos de pago sobreviven desde hace años, desde licencias hasta una suscripción mensual, y los bancos publican guías y conversores propios.
- **Riesgo principal:** que la gente use el conversor de su banco o una herramienta gratuita.
- **Mitigación [Hip]:**
  1. Capa gratuita útil de verdad, para competir con lo gratis.
  2. Validación en castellano llano que **explica** cada error antes de que el banco rechace el fichero (rechazos documentados: caracteres no válidos, IBAN, mandato).
  3. Calculadora del identificador de acreedor, que también sirve como imán de SEO.
  4. Precio Pro claramente inferior a 20 €/mes.

### 4.2 Conversor Norma 43 (58,3)
- La alternativa gratuita online (norma43.net) ya existe. No encontré ningún competidor que cobre más de 5,95 €.
- **Conclusión:** podría ser un buen *módulo gratuito* de captación dentro de un producto bancario, no un negocio en sí. Queda en `ROADMAP.md` como posible herramienta complementaria.

### 4.3 Calculadoras SEO (54,3, empatada con plantillas; desempata el orden alfabético del identificador)
- Hay que competir con hacecuentas.com y otros sitios consolidados. El modelo de anuncios exige un tráfico muy alto para cubrir costes.
- **Conclusión:** descartada como negocio principal. Sí se reutiliza la idea: **una calculadora útil (identificador de acreedor SEPA) dentro del producto ganador** para atraer tráfico cualificado.

## 5. Ganadora provisional: **RemesaLista** — generador de remesas SEPA de adeudos

1. **Qué problema resuelve.** Pasar de una lista de socios o clientes en Excel a un fichero XML pain.008 que el banco acepte a la primera, detectando antes los errores que causan rechazos (IBAN inválido, caracteres no SEPA, mandatos incompletos, identificador de acreedor mal calculado).
2. **Quién lo usaría.** Tesoreros (a menudo voluntarios) de asociaciones, AMPAs y clubes; academias, gimnasios y escuelas pequeñas; administradores de fincas pequeños; autónomos y pymes con cuotas recurrentes. Organizaciones sin software de gestión, o con uno que no genera el XML, o cuyo banco no ofrece conversor.
3. **Por qué nos elegirían [Hip].**
   - Gratis para remesas pequeñas, sin registro.
   - Explicación de cada error y corrección automática de caracteres.
   - Los datos no se guardan.
   - Admite las versiones .02 y .08.
   - Precio Pro inferior al del competidor de suscripción.
4. **Cómo conseguir los primeros usuarios.**
   - Guías útiles que respondan a búsquedas con intención clara: «generar remesa SEPA XML», «calcular identificador de acreedor», «errores de remesa».
   - Presencia honesta (sin spam) en comunidades de tesoreros, AMPAs y clubes.
   - Contacto con federaciones o asociaciones paraguas, ofreciendo la herramienta gratis a sus miembros.

   Todas estas acciones requieren autorización humana (ver `BUSINESS_PLAN.md`).
5. **Cómo genera ingresos.** Freemium. La capa gratuita es CORE hasta N recibos por remesa (N = 25 por defecto, configurable). Pro, por suscripción o pase anual, ofrece remesas sin límite y el esquema B2B. El cobro se hace con Stripe Checkout y un webhook que emite la licencia automáticamente.
6. **Coste.** Desarrollo: 0 € de caja (hecho en este entorno). Mantenimiento estimado: unos 5–10 €/mes de alojamiento más unos 10–15 €/año de dominio. Ver `COSTS.md`.
7. **Qué puede hacerla fracasar.**
   - Los bancos y las herramientas gratuitas cubren la necesidad y nadie paga.
   - La captación por SEO es demasiado lenta.
   - Una incompatibilidad con un banco concreto daña la confianza.
   - El público (voluntarios) es poco digital y sensible al precio.
8. **Experimento para decidir si continuar.** Ver `EXPERIMENTS.md` (EXP-01 a EXP-04). En resumen: publicar el MVP con las guías y medir, en 8 semanas desde la indexación, las remesas válidas generadas, los usuarios distintos que llegan al límite gratuito y las conversiones a Pro. Los umbrales para continuar, cambiar o descartar están fijados de antemano.

## 6. Ideas descartadas y por qué
- **VeriFactu y factura electrónica:** complejidad y responsabilidad legal desproporcionadas para un equipo pequeño; competidores con mucha financiación.
- **IA wrapper:** no hay clave de API, el coste variable es alto y los márgenes, bajos.
- **Reseñas y recordatorios:** requieren venta local y costes de mensajería.
- **Afiliación y calculadoras:** ingresos por visita demasiado bajos y SEO en retroceso.
- **API IBAN/NIF:** producto genérico de precio muy bajo.
- **Norma 43:** sin disposición a pagar. Se reutiliza como posible módulo gratuito.
