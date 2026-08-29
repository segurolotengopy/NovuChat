# ESTADO — bitácora del proyecto NovuChat

> Se actualiza al final de cada sesión y antes de cualquier pausa. Al retomar,
> leer esto primero. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos.

**Última actualización:** 2026-08-28 (sesión de tarde/noche)

---

## Dónde estamos

**Demo A (Agendamiento — Belleza y Salud): CONVERSANDO POR WHATSAPP REAL.**
Los ajustes de latencia están aplicados **al JSON versionado, no a la
instancia**: falta reimportar en n8n, reponer `Trigger On = Messages` y las
credenciales, y pulsar **Publish**. Después hay que medir contra un teléfono
real: nada de lo aplicado está comprobado en producción.

**Demo B (Venta y cobro — Gastronomía y Retail): DISEÑADO Y CORREGIDO,
esperando el segundo número.** El flujo tiene 18 nodos y quedó listo; el
bloqueo se resolvió por la opción (a), portafolio comercial nuevo.

**Sitio administrativo multi-tenant: ANDAMIADO, pista paralela.** No bloquea
las demos. 42 de 42 pruebas de aislamiento pasan contra el emulador.

**Repositorio: PÚBLICO y saneado.** `git init` hecho, un commit local, **sin
remoto y sin push**. El verificador de saneo da 0 hallazgos.

---

## Logros (2026-08-28)

- Análisis de los documentos preliminares de Silvana → `Analisis/`.
- Recursos del demo: calendario de relleno, QR simulado, checklist, guion y
  Simulador v2 offline → `Demo-Recursos/`.
- App de Meta `NovuChat-Demo-A` creada, publicada y con webhook operativo.
- Google Cloud `${GCP_PROJECT_ID}` con OAuth de Calendar y API de Gemini.
- Demo A funcionando de punta a punta contra WhatsApp real.
- **Latencia del Demo A:** identificada la causa probable —el agente encadena
  llamadas innecesarias a `consultar_disponibilidad`, no el tamaño del
  prompt— y aplicados los ajustes. Protocolo de medición y criterio de
  aceptación en `Analisis/04-latencia-demo-a.md`.
- **Demo B:** corregido un defecto que mandaba la respuesta de un cliente al
  teléfono de otro, y las prohibiciones 3 y 4 pasaron de ser reglas del prompt
  a compuertas por código.
- **Guía de Meta reescrita** (687 líneas, once bloques pausables) con los once
  hallazgos incorporados y los pasos del segundo número.
- **Saneo del repositorio público** con marcadores, `CONFIGURACION.local.md`
  ignorado, y `scripts/verificar-saneo.sh`.
- **Estándar DevSecOps v2** aplicado, con despliegue por federación de
  identidades OIDC y cero claves de cuenta de servicio.
- **Panel administrativo** diseñado y andamiado en `admin/`.

---

## Hallazgos que costaron tiempo (no volver a tropezar)

1. **El número de prueba es UNO POR PORTAFOLIO COMERCIAL, no por app.** Al
   crear `NovuChat-Demo-A` se colgó de la WABA que ya existía del proyecto
   WhatsApp-Modular. Por eso el hilo de WhatsApp mostraba mensajes viejos.
2. **`subscribed_apps` es obligatorio y NO existe en la interfaz de Meta.**
   Suscribir el campo `messages` no basta: la WABA debe estar suscrita a la
   app, y eso solo se hace por API. Era la causa de "no entra nada a n8n".
   Script: `scripts/verificar-meta.sh`.
3. **La app de Meta debe estar publicada (Live).** En modo Desarrollo, Meta
   solo entrega los webhooks de prueba disparados desde el panel. Publicar
   exige URL de política de privacidad y categoría; no requiere Business
   Verification.
4. **El token de verificación del webhook NO se configura en n8n.** El nodo
   responde el `hub.challenge` automáticamente: se inventa la cadena en Meta
   y no se pega en ningún lado.
5. **La credencial de Calendar debe ser del tipo `Google Calendar OAuth2 API`**,
   no la genérica `Google OAuth2 API` (esa exige el campo Scope y el nodo no
   la acepta). Crearla **desde el nodo** evita el error.
6. **Un Client ID y un Client Secret de clientes OAuth distintos** producen
   `Client authentication failed`. Descargar el JSON del cliente y copiar de
   ahí, nunca de la pantalla.
7. **La URL del webhook debe ser la de Production**, no la de Test
   (`/webhook-test/`), que solo vive mientras el editor está escuchando.
8. **Los datos fijados (pin) no afectan las ejecuciones de producción**, solo
   las manuales. No bloquean el webhook.
9. **Gemini devuelve 503 en picos de demanda.** Mitigación: elegir el modelo
   desde el desplegable (nunca escribirlo a mano), activar *Retry On Fail*, y
   evaluar habilitar facturación para tener capacidad prioritaria.
10. **El parámetro `Trigger On` del WhatsApp Trigger llega vacío** al importar
    el JSON generado: hay que seleccionar **Messages** a mano, y dejar
    *Receive Message Status Updates* **sin valores** para no generar
    ejecuciones basura.
11. **La imagen del QR no necesita hosting público**: se sube con
    `POST /{PHONE_NUMBER_ID}/media` y se envía por media ID (válido 30 días).

---

## Decisiones tomadas

| Decisión | Resolución | Fecha |
|---|---|---|
| Canal de WhatsApp | Meta Cloud API, número de prueba | 28/08 |
| LLM de los demos | Gemini (Google AI Studio) | 28/08 |
| LLM de producción | Claude API (Anthropic) | 28/08 |
| Evolution API | Prohibido, ni siquiera para demos | 22/08 |
| Cobro por QR | Simulacro rotulado, impuesto por código | 28/08 |
| Transparencia del agente | No niega ser una IA, impuesto por código | 28/08 |
| Diseño del Demo B | Opción (a): portafolio nuevo y segundo número | 28/08 |
| Visibilidad del repositorio | Público, con saneo por marcadores | 28/08 |
| Fuente de verdad de los flujos | Los JSON de `Flujos/`; `build_flows.py` retirado | 28/08 |
| Alcance del panel admin | Pista paralela, no bloquea las demos | 28/08 |

## Decisiones pendientes

- **Proyecto Firebase del panel.** Recomendación del agente de arquitectura:
  dos proyectos nuevos y dedicados, `novuchat-admin-dev` y `-prod`, dejando el
  proyecto de demos como está. El argumento decisivo es que el proyecto de
  demos ya emitió credenciales que hoy viven en la VM de OCI, una máquina con
  co-inquilinos. **Falta la decisión de Andres.**
- **Política de retención de conversaciones.** Hay que decidirla antes del
  primer cliente real: son datos personales de terceros que nunca consintieron
  nada ante NovuChat.
- **Silvana como segunda propietaria** de plataforma y como revisora en
  GitHub. Hoy hay un único punto de falla humano y la §4 no se puede cumplir.
- **Facturación de Gemini** para reducir los 503 durante los demos.
- **Memoria persistente** (Postgres Chat Memory) para producción.

---

## Riesgos vivos para el 9–10 de septiembre

- **Latencia del Demo A**: sigue siendo el pendiente número uno. Los ajustes
  están aplicados pero **sin medir**. Si la ejecución de 48 s todavía figura
  en n8n, abrirla y contar las iteraciones del agente cierra la pregunta en
  dos minutos.
- **Límite de portafolios de Meta**: son 2 por cuenta personal sin verificar.
  Si ya están agotados, **la opción (a) del Demo B se cae** y hay que volver a
  la mesa. Verificarlo antes de invertir las tres horas de trámites.
- **`executionTimeout` de 60 s**: si vence, el cliente no recibe nada. Sesenta
  segundos de silencio ante un prospecto son peores que una respuesta lenta:
  el guion necesita una salida manual a los ~20 s.
- **Agente sin herramientas en el Demo B**: algunas versiones de n8n exigen al
  menos una para el *Tools Agent*. Si falla al importar, el reemplazo es un
  *Basic LLM Chain* con la misma memoria, media hora.
- **Solo 5 destinatarios**: el guion contempla prestar un celular al público.
- **503 de Gemini**: mitigado con reintentos; se cierra con facturación.
- **Business Verification de AAB1**: no bloquea los demos, pero sin ella no
  hay plantillas, así que **no se prometen recordatorios "24 h antes" en
  vivo**.

## Riesgos del repositorio público

- La historia de git es permanente: cualquier valor que se cuele hay que
  sacarlo con `commit --amend` **antes** del primer push, no con un commit
  nuevo.
- `.env` lo protege el gancho de pre-commit, no el estándar. Sin
  `pre-commit install` el modo exacto del verificador nunca corre.
- **La §4 no se puede hacer cumplir técnicamente**: GitHub no permite aprobar
  el propio PR y es una cuenta con un solo dueño. Hasta sumar a Silvana como
  revisora, la separación de funciones es un acuerdo de proceso.
- **Conviene rotar la ruta UUID del webhook**: es el único control de acceso
  real del flujo y no se puede saber si estuvo en algún historial previo.
- En la Fase 1 la ingesta escribe con el SDK Admin, que se salta las reglas:
  el aislamiento depende de una línea de código. Migrar al rol `ingesta`
  **antes del segundo cliente**.

## Próximos pasos

1. Verificar el límite de portafolios de Meta. Cinco minutos, y condiciona
   todo el Demo B.
2. Reimportar el Demo A en n8n, publicar y **medir** con el protocolo de
   `Analisis/04-latencia-demo-a.md`. Criterio: p50 ≤ 6 s, p90 ≤ 10 s.
3. Decidir el proyecto Firebase del panel.
4. Trámites de Meta del segundo número, en el orden de la guía. Los pasos 4
   (publicar en Live) y 7 (`subscribed_apps`) fallan en silencio.
5. Recorrer la suite A completa de `Demo-Recursos/checklist-ensayo.md`.
6. Agregar al guion la salida manual a los ~20 s.
7. Ensayo general 6–7/09 con Silvana; video de respaldo; Simulador al día.
8. 8/09 congelamiento y exportación de flujos al repositorio.
