# RESEARCH.md — Investigación de mercado

Fecha de la investigación: 2026-10-12.

## Cómo se investigó (y sus límites)

| Herramienta | Estado en este entorno | Consecuencia |
|---|---|---|
| WebSearch (motor de búsqueda con resumen) | Disponible | Fuente principal. Cada dato procede de un resultado de búsqueda con su URL. |
| WebFetch (abrir páginas) | **No disponible**: falla con `getaddrinfo ENOTFOUND` | No pude abrir páginas de precios de competidores para leerlas enteras. Los precios citados vienen de los fragmentos que devuelve el buscador. |
| `curl` directo a Internet | Bloqueado por la política de red (403 en el proxy), salvo registros de paquetes (npm, PyPI) | No hay acceso a Google Trends, Keyword Planner, Reddit ni Product Hunt. **No tengo volúmenes de búsqueda reales.** |
| Entrevistas o encuestas | No posibles desde aquí | No hay validación con usuarios reales. Ver `EXPERIMENTS.md`. |

**Convención en este documento**

- **[H] Hecho:** dato publicado por una fuente identificable. Se cita la URL. Puede estar desactualizado; la fecha de consulta es 2026-10-12.
- **[E] Estimación:** cifra de un tercero sin metodología verificable (blogs de proveedores, agregadores).
- **[Hip] Hipótesis:** razonamiento propio todavía no comprobado.

Muchas cifras sobre ingresos de micro-SaaS o plantillas salen de blogs de empresas que venden servicios a esos fundadores (Dodo Payments, Fungies, Kupkaike). Las trato como estimaciones interesadas.

---

## 1. Generador de remesas SEPA (Excel → XML pain.008) — **oportunidad seleccionada**

### Problema
Asociaciones, clubes deportivos, AMPAs, academias, comunidades de propietarios y pymes cobran cuotas por domiciliación bancaria. Para cobrar varias a la vez, el banco pide una «remesa», un fichero XML ISO 20022 `pain.008` (en España, «Cuaderno 19.14 XML»). Ese formato no se puede generar directamente desde Excel.

- [H] Los ficheros de texto plano (TXT) se sustituyeron por XML a partir del 1 de febrero de 2016. Fuente: [AECE](https://aece.es/descargararchivo_docnoticias_1200).
- [H] Una remesa de recibos es un XML pain.008, conocido en España como Cuaderno 19.14 o «norma 19». Para cada recibo hace falta un mandato con IBAN y fecha de firma, y el acreedor necesita un identificador de acreedor. Fuente: [Finantres](https://finantres.com/como-crear-subir-fichero-sepa-recibos/), [GoCardless](https://gocardless.com/es/guias/consejos/domiciliacion-recibos-sepa).
- [H] Hay rechazos frecuentes por:
  - caracteres no válidos en la referencia del mandato (`MndtId`) o espacios en `InstrId` ([guía de CaixaBank](https://www.caixabank.es/deployedfiles/empresas/Estaticos/pdf/Transferenciasyficheros/Guia_motivos_impagos_tecnicos_ca.pdf));
  - IBAN o BIC erróneos, códigos AC01 y RC01 ([GoCardless](https://gocardless.com/es/guias/sepa/recibir-mensajes-sepa));
  - un elemento de esquema incorrecto tras actualizar Sage 50 ([foro Sage](https://communityhub.sage.com/es/sage-50/f/discusion-general/270318/error-en-remesa-bancaria)).
- [H] El identificador de acreedor en España tiene el formato `ES` + 2 dígitos de control + sufijo de 3 caracteres (normalmente `000`) + NIF. Los dígitos de control siguen ISO 7064 Mod 97-10. Fuentes: [Quipu](https://getquipu.com/blog/identificador-del-acreedor-sepa/), [python-stdnum](https://arthurdejong.org/python-stdnum/doc/1.4/stdnum.eu.at_02.html).

### Evidencia de demanda y de disposición a pagar
- [H] **ConversorSEPA.es** cobra **20 €/mes + IVA** por conversiones ilimitadas, validación de IBAN y generador de mandatos en PDF. El complemento de API cuesta +10 €/mes. Fuente: [conversorsepa.es/precios](https://www.conversorsepa.es/precios) (vía buscador).
- [H] **conversorsepa.com** (dominio antiguo, páginas de hace unos 4 años) vendía licencias de pago único, por ejemplo un conversor PLUS a 155 € + IVA. Fuente: [conversorsepa.com](https://www.conversorsepa.com/categoria-producto/conversores-sepa/).
- [H] **YourSEPA** ofrece prueba gratuita y cobra **3,15 € por lote**. Fuente: [yoursepa.com](https://yoursepa.com/excel-a-sepa-xml/) (fragmento del buscador; no se pudo abrir la página).
- [H] **SEPA Generator** (escritorio): la edición gratuita solo hace transferencias. Los adeudos (pain.008) están en Pro, a unos 11 $/mes. Fuente: [AlternativeTo](https://alternativeto.net/software/sepa-generator/about/).
- [H] **JAM SEPA-Transfer** (escritorio, de pago) importa Excel y tiene una prueba de 30 días. Fuente: [jam-software.com](https://jam-software.com/sepa-transfer/create-sepa-xml-files.shtml).
- [H] Hay al menos dos herramientas **gratuitas** que procesan los datos en el navegador:
  - CuotaSEPA ([dgayosoberlanga-ui.github.io](https://dgayosoberlanga-ui.github.io/)). No pude verificar sus funciones.
  - [jota-ele-ene/remesas_sepa](https://github.com/jota-ele-ene/remesas_sepa).
- [H] Otras alternativas:
  - **Infosepa (Fytel)** elimina los datos tras la conversión ([infosepa.es](https://www.infosepa.es/miembros/conversor%20adeudos.aspx)).
  - **Mobilefish** es gratuito, pero está orientado a bancos neerlandeses y admite hasta 350 operaciones por lote ([mobilefish.com](https://www.mobilefish.com/services/sepa_xml/sepa_xml.php)).
- [H] **Sustitutos bancarios:**
  - El «Auxiliar online» de CaixaBank permite importar un Excel para crear recibos ([caixabank.es](https://www.caixabank.es/empresa/cobrosypagos/gestionrecibosdomiciliados_es.html)).
  - Santander ofrece plantillas Excel, conversores y generadores de remesas ([bancosantander.es](https://www.bancosantander.es/empresas/cobros-pagos/cobros/cobro-recibos/)).
- [H] **Software de gestión de socios** con cobros SEPA: Playoff ([academy.playoffinformatica.com](https://academy.playoffinformatica.com/article/212-crear-modificar-remesas)), Berrly (más de 800 organizaciones según la empresa, precio inicial de 75 € en [Capterra](https://www.capterra.es/software/1048562/berrly)), Socius/Baarasoft y Frapp ([softwaredoit.es](https://www.softwaredoit.es/gestion-de-asociaciones/gestion-de-asociaciones.html)).
- [E] Tamaño del público. No encontré una cifra nacional oficial reciente.
  - La Comunitat Valenciana tenía **60.738 asociaciones activas** a 31-03-2025 ([valencianews.es](https://valencianews.es/?p=365157)).
  - CIRIEC estimó unas **239.700 asociaciones activas en España en 2016** extrapolando datos de 2008 ([ciriec.es](https://ciriec.es/wp-content/uploads/2018/12/17-asoc.pdf)).
  - No todas cobran por domiciliación.

**Lectura [Hip]:** la existencia de varios productos de pago sostenidos en el tiempo (licencias desde hace años, suscripción de 20 €/mes, pago por lote) es la mejor señal disponible de que hay demanda y disposición a pagar. A la vez, hay herramientas gratuitas y los grandes bancos ofrecen alternativas. Por eso **la competencia es real** y la diferenciación debe basarse en calidad de validación, precio y facilidad, no en la existencia de la función.

### Contexto normativo y técnico
- [H] Hay dos versiones del esquema: pain.008.001.02 (ISO 2009) y pain.008.001.08 (ISO 2019). En Alemania (EBICS), las versiones antiguas deben sustituirse en noviembre de 2026 ([Deutsche Bank](https://corporates.db.com/files/documents/in-focus/focus-topics/iso20022/Deutsche-Bank-ISO-20022-Changes-in-Payments-and-Account-Statements.pdf)). **No pude confirmar qué exigen los bancos españoles.**
- [H] En septiembre de 2026 el EPC **aplazó** el fin de las direcciones no estructuradas, previsto para el 15-11-2026, y todavía no hay nueva fecha ([EPC](https://www.europeanpaymentscouncil.eu/what-we-do/epc-payment-schemes/sepa-credit-transfer-sct/sepa-credit-transfer-rulebook-and), [regreportingdesk](https://regreportingdesk.com/epc-sepa-structured-address-migration-delay/)). Algunas webs siguen diciendo lo contrario ([foro Sage](https://communityhub.sage.com/es/sage-50/f/discusion-general/270318/error-en-remesa-bancaria/649675)), así que hay confusión en el mercado. **No uso esta fecha como argumento de venta.**
- [H] El esquema B2B solo puede usarse entre empresas o autónomos, no con consumidores. Para socios particulares se usa CORE ([CaixaBank](https://caixabank.cat/empresa/transferenciaficheros/queesunfichero_es.html)).
- [H] Los esquemas XSD oficiales de pain.008.001.02 y .08 se distribuyen con el paquete open-source `sepaxml` (PyPI, MIT) y los he podido usar para las pruebas automáticas.

---

## 2. Conversor de extractos bancarios PDF → Excel
- [H] Mercado con precios publicados ([BankConv en TrustMRR](https://trustmrr.com/startup/bankconv), [xpay](https://www.xpay.sh/agent-ready-index/convert-my-bank-statement/), [Capterra](https://www.capterra.com/p/10038177/Statements-to-Sheets/), [Capterra BankFormats](https://www.capterra.com/p/10048315/BankFormats/)):
  - BankConv: 2,99 $ por documento o 29–79 $/mes.
  - Convert My Bank Statement: 10 $/mes por 400 páginas.
  - Statements to Sheets: 9 $/mes por 500 transacciones.
  - BankFormats: 9 €/mes.
- [Hip] Hay alta demanda y alta competencia. Que funcione bien depende de analizar formatos de muchos bancos o de usar OCR o IA (con coste variable). No puedo verificar la precisión sin extractos reales.

## 3. Calculadoras fiscales/laborales en español (SEO + anuncios)
- [H] Competencia consolidada:
  - hacecuentas.com: más de 2.700 calculadoras según su ficha de plugin ([wordpress.org](https://wordpress.org/plugins/?p=330936)).
  - Otras: Billeo, Declarando, NettoCalc, Richify ([hacecuentas.com](https://hacecuentas.com/es), [billeo.es](https://www.billeo.es/herramientas/calculadora-sueldo-neto-bruto), [declarando.es](https://declarando.es/tramites-autonomo/nueva-cuota-autonomos)).
- [E] RPM típico de AdSense: 0,5–2,5 $ por 1.000 vistas ([themediaant](https://www.themediaant.com/calculators/digital/adsense-rpm-calculator)). No hay datos específicos del mercado hispano.
- [H] Ahrefs midió una caída del CTR del 34,5 % cuando aparece un AI Overview ([ahrefs.com/blog/es](https://ahrefs.com/blog/es/las-5-etapas-del-duelo-seo)). Las cifras más alarmistas (−58 %) no las he verificado ([ecosistemastartup](https://ecosistemastartup.com/google-search-2026-30-menos-trafico-y-que-hacer/)).

## 4. Plantillas descargables (Excel/Notion) para autónomos
- [H] Hay plantillas gratuitas de calidad publicadas por marcas grandes: Stelorder, Quipu, InfoAutónomos y Qonto ([stelorder](https://www.stelorder.com/blog/plantilla-excel-ingresos-gastos/), [quipu](https://getquipu.com/blog/hoja-excel-ingresos-gastos-plantilla/), [qonto](https://qonto.com/es/blog/creacion/autonomos/libro-de-ingresos-y-gastos-autonomos-gratis)).
- [E] Hay más de 50.000 anuncios de «Notion template» en Etsy. Gumroad cobra un 10 %; Etsy cobra 0,20 $ por anuncio más un 6,5 % ([kupkaike](https://kupkaike.com/blog/is-selling-notion-templates-still-profitable-2026), [fungies](https://fungies.io/how-to-sell-notion-templates-online/)).

## 5. Herramienta de IA generativa (wrapper de LLM)
- [E] La inferencia supone de media un 23 % de los ingresos en empresas B2B de IA. Los márgenes brutos rondan el 50–60 %, frente al 70–90 % del SaaS tradicional (ICONIQ y Bessemer citados en [Medium](https://medium.com/@svnkrmkr/ai-for-startups-in-2026-what-actually-matters-now-8e17b6fd0150)). La cifra de abandono del 65 % a 90 días no tiene fuente primaria ([alexcloudstar](https://www.alexcloudstar.com/blog/ai-wrappers-dead-what-to-build-instead-2026/)).
- [H] **No hay clave de API de LLM disponible en este proyecto.** Sin ella, el producto no puede funcionar de verdad.

## 6. Software de facturación VeriFactu
- [H] El RDL 15/2025 (BOE, 3-12-2025) aplazó VeriFactu al 1-1-2027 para las sociedades y al 1-7-2027 para el resto. Las sanciones llegan hasta 50.000 € ([genbeta](https://www.genbeta.com/actualidad/gobierno-retrasa-pesadilla-para-empresas-autonomos-verifactu-no-sera-obligatorio-2027), [infoautonomos](https://www.infoautonomos.com/blog/verifactu-cuando-es-obligatorio-a-quien-afecta/)).
- [H] El RD 238/2026 aprueba la factura electrónica B2B, aplicable previsiblemente desde octubre de 2027 o 2028 según el tamaño ([cuatrecasas](https://www.cuatrecasas.com/es/spain/fiscalidad/art/reglamento-facturacion-electronica-obligatorio-operaciones)).
- [Hip] La demanda es enorme, pero el producto exige integración con la AEAT, certificados, encadenamiento de registros y una declaración responsable del productor. Implica responsabilidad legal y competidores muy grandes. No es viable con nuestros recursos.

## 7. Automatización de solicitudes de reseñas
- [H] ReviewNudger cuesta 29 $/mes por local y BusinessReviewAlerts 4,99 $/mes ([getapp](https://www.getapp.co.uk/software/2143139/reviewnudger), [capterra](https://www.capterra.co.uk/software/1111668/businessreviewalerts)).
- [Hip] Exige venta local puerta a puerta, costes de SMS y cumplir las políticas de Google sobre reseñas.

## 8. Extensión de navegador freemium
- [E] Una extensión freemium convierte del 2 al 5 % de sus usuarios en clientes de pago (estimación de un proveedor, [fungies](https://fungies.io/monetize-chrome-extension-2026)). El fundador de ExtensionPay publicó ingresos bajos y concentrados en pocas extensiones ([indiehackers](https://www.indiehackers.com/product/extensionpay/100-signups-payments-for-browser-extensions--McjDSU2w7IFS9M_z9U1)).
- [Hip] No hay un problema concreto validado. Como «idea», es una categoría y no una oportunidad.

## 9. API de validación IBAN/NIF
- [H] Precios de mercado:
  - Apify: 0,90 $ por 1.000 validaciones ([apify](https://apify.com/maximedupre/iban-validator)).
  - iban.com: 530 al año por 2.000 consultas ([iban.com](https://www.iban.com/pricing)).
  - oanor.com: capa gratuita de 250 llamadas al mes ([oanor.com](https://oanor.com/api/iban-api)).
- [Hip] Es un producto genérico con poco margen y difícil de diferenciar.

## 10. Conversor Norma 43 → Excel
- [H] Alternativas gratuitas:
  - norma43.net (online, [norma43.net](https://norma43.net/)).
  - El conversor de Bankinter.
  - SimplySoft (escritorio, 2005).
  - csb43 (open source, [pypi](https://pypi.org/project/csb43)).
- [H] La única oferta de pago encontrada es una plantilla Excel de Z1 Gestión a 5,95 € + IVA ([z1gestion.es](https://z1gestion.es/product/conversor-norma-43-a-excel/)).
- [Hip] La disposición a pagar parece muy baja: el software contable ya importa Norma 43.

## 11. Web de afiliación/comparación
- [Hip] Depende del SEO a medio plazo, en un contexto de caída del CTR por los AI Overviews (ver punto 3), y de programas de afiliación de terceros. No encontré datos fiables de comisiones de comparadores españoles.

## 12. Recordatorios de citas por WhatsApp
- [H] Competidores con planes gratuitos o baratos:
  - SimplyBook.me tiene versión gratuita y EasyWeek ofrece una página de reservas gratis.
  - Vagaro cuesta desde 25 $/mes.
  - Booksy es la referencia en España.

  Fuentes: [capterra.es](https://www.capterra.es/alternatives/142741/booksy), [booksy](https://biz.booksy.com/es-es/blog/la-mejor-app-de-reservas-para-tu-peluqueria).
- [Hip] Requiere la API de WhatsApp Business (con coste por conversación y aprobación de Meta) y venta local. En clínicas implicaría tratar datos de salud.

---

## Infraestructura, pagos y requisitos legales (transversal)

### Alojamiento
- [E] Vercel Hobby **prohíbe el uso comercial**. El plan gratuito de Cloudflare Workers y Pages no tiene restricción comercial según fuentes secundarias. Los servicios gratuitos de Render se suspenden por inactividad (arranque en frío de 30–60 s). Netlify Starter permitiría uso comercial. Fuentes: [agentdeals.dev](https://agentdeals.dev/hosting-free-tier-comparison-2026), [toolradar](https://toolradar.com/guides/best-free-hosting-platforms). **Hay que verificarlo en las condiciones oficiales antes de contratar.**

### Pagos
- [H] Comisiones:
  - Polar: 4 % + 0,40 $ (+1,5 % con tarjetas no estadounidenses y +0,5 % en suscripciones), según su documentación ([docs.polar.sh](https://docs.polar.sh/documentation/polar-as-merchant-of-record/fees)). Un tercero afirma que desde el 27-05-2026 es 5 % + 0,50 $ ([fungies](https://fungies.io/polar-sh-review-2026.md)), sin confirmar.
  - Paddle: 5 % + 0,50 $.
  - Gumroad: 10 %.
  - Lemon Squeezy: 5 % + 0,50 $. Está en transición tras su compra por Stripe ([fungies](https://fungies.io/lemon-squeezy-stripe-acquisition-saas-founders-2026/)).
- [E] Stripe Managed Payments (Stripe como «merchant of record») entró en vista previa pública en febrero de 2026 ([fungies](https://fungies.io/lemon-squeezy-stripe-acquisition-saas-founders-2026/)).

### Edad mínima
- [H] Stripe: las cuentas Standard están abiertas desde los 13 años, pero **un tutor legal debe ser el titular** para cobrar. Las cuentas Express y Custom exigen 18 años ([support.stripe.com](https://support.stripe.com/questions/age-requirement-to-create-a-stripe-account)). Para Paddle y Polar no encontré la regla; hay que comprobarla en sus términos.

### Legal en España
- [H] Los datos bancarios (IBAN) son datos personales sujetos al RGPD y la LOPDGDD ([protecciondatos-lopd.com](https://protecciondatos-lopd.com/empresas/bancarios/)).
- [H] El artículo 22.2 de la LSSI exige consentimiento para las cookies no exentas ([AEPD](https://www.aepd.es/documento/e-07129-2017.pdf)). Nuestro diseño no usa cookies.

## Fuentes generales sobre micro-SaaS
- [E] Coinciden en que los nichos verticales «aburridos» funcionan mejor que las herramientas genéricas, y en validar antes de construir:
  - [redwerk](https://redwerk.com/blog/micro-saas-ideas-that-print-money/)
  - [lovable.dev](https://lovable.dev/guides/micro-saas-ideas-for-solopreneurs-2026)
  - [nxcode](https://www.nxcode.io/resources/news/micro-saas-ideas-2026)
  - [superframeworks](https://superframeworks.com/articles/best-micro-saas-ideas-solopreneurs)

  Son blogs de proveedores.
