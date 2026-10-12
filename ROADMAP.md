# ROADMAP.md — Fases, prioridades, dependencias y próximos pasos

## Fase 1 — Investigación y MVP técnico ✅ (2026-10-12)
- [x] 12 oportunidades investigadas y puntuadas; decisión documentada.
- [x] Núcleo SEPA verificado (stdnum y XSD oficiales).
- [x] Servidor con límites de plan, licencias, webhook de Stripe, lista de espera y métricas sin datos personales.
- [x] Automatizaciones: correo con reintentos y alertas, caducidad de licencias, limpieza, copias e informe diario.
- [x] Interfaz web, calculadora, 2 guías y textos legales (plantilla).
- [x] 71 pruebas automáticas y 10 E2E.

## Fase 2 — Publicación y validación de demanda (bloqueada por decisiones humanas)
| Paso | Depende de | Quién |
|---|---|---|
| Elegir alojamiento y crear la cuenta | Tarjeta y autorización | Persona |
| Comprar el dominio | Autorización de gasto (≈ 10–15 €) | Persona |
| Completar los datos del titular y revisar los textos legales | Identidad del titular (adulto) | Persona |
| Crear la cuenta de Resend y verificar el dominio | Dominio | Persona |
| Desplegar (`DEPLOYMENT.md` §4) y superar el preflight | Lo anterior | Agente con acceso o persona |
| DAST contra *staging* | Despliegue y `HAWK_API_KEY` | Agente o persona |
| Search Console y sitemap | Dominio | Persona |
| EXP-01 (uso) y EXP-02 fase A (lista de espera) | Despliegue | Automático (métricas en el informe diario) |
| EXP-03 (alianzas) y acciones en comunidades | Autorización de publicaciones | Persona y agente |
| EXP-04 (aceptación en bancos) | Primeros usuarios | Usuarios |

## Fase 3 — Monetización (solo si EXP-01 y EXP-02 dan señal positiva)
- Stripe en modo test → compra de prueba de extremo a extremo → modo real **con autorización explícita**.
- Pase anual (precio de hipótesis: 49 €). Medir EXP-02 fase B durante 60 días.
- Alta fiscal del titular (gestor).

## Fase 4 — Mejoras según los datos (priorizadas por impacto, coste y riesgo)
| Mejora | Impacto esperado | Coste | Disparador (dato que la justifica) |
|---|---|---|---|
| Informe de recibos en PDF o CSV para el archivo del tesorero | Medio | Bajo | Peticiones de usuarios |
| Lectura directa de `.xlsx` | Medio | Medio (dependencia) | Interés `xlsx` o abandonos tras `data_loaded` |
| Transferencias SEPA (`pain.001`) para pagos a proveedores y nóminas | Medio–alto | Medio | Interés `transferencias` en la lista de espera |
| Lectura del fichero de devoluciones (`pain.002` o `camt`) | Medio | Medio | Interés `devoluciones` |
| Plantillas de mandato SEPA en PDF | Medio | Bajo | Competidor lo ofrece; medir antes |
| Conversor Norma 43 como herramienta gratuita de captación | Bajo–medio | Bajo | SEO |
| Plan para gestorías (varios acreedores) | Alto si EXP-05 | Medio | EXP-02 negativo con particulares |

## Fuera de alcance (decidido)
- VeriFactu o facturación: complejidad y responsabilidad legal desproporcionadas (`OPPORTUNITIES.md`).
- Guardar las listas de socios en el servidor: aumentaría el riesgo RGPD; no se hará sin una demanda clara y una evaluación de impacto.
