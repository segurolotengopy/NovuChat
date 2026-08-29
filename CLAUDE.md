# NovuChat — instrucciones de proyecto

Asistentes conversacionales de WhatsApp para PyMEs bolivianas, construidos con
**n8n + IA**. Proyecto conjunto de **Andres** (arquitectura, infraestructura,
comercial) y **Silvana** (diseño funcional, guiones, material comercial).

**Objetivo inmediato:** dos demos comerciales el **9 y 10 de septiembre de
2026**. Congelamiento de cambios el **8 de septiembre**.

Antes de trabajar, leé `ESTADO.md` (dónde estamos) y `CONFIGURACION.md`
(parámetros e identificadores). Al terminar una sesión, actualizá `ESTADO.md`.

## Idioma y estilo

Español latinoamericano (Bolivia), sin voceo. Respuestas técnicas rigurosas y
detalladas; interactivas en los puntos críticos. Andres tiene 25 años de
experiencia en arquitectura y gestión de proyectos, y experiencia media
programando: explicá el *porqué* de las decisiones, no solo el *cómo*.

## Arquitectura

```
WhatsApp (Meta Cloud API)
   └── webhook ──► n8n autoalojado en OCI (2.36.5)
                     └── AI Agent (Gemini en demos, Claude en producción)
                           ├── memoria por número de teléfono
                           ├── Google Calendar (consultar / agendar)
                           └── envío de respuesta + alerta al negocio
```

## PROHIBICIONES DURAS

1. **NUNCA** reintroducir un canal NO oficial de WhatsApp — Evolution API,
   Baileys, WPPConnect, dispositivos vinculados o equivalentes. Se probó y se
   retiró el 2026-08-22 por rotura silenciosa y riesgo de baneo. El único
   canal es la **Cloud API oficial de Meta**. Referencia:
   `~/WhatsApp-Modular/docs/13-laboratorio-evolution.md`.
2. **NUNCA** escribir un token, App Secret, Client Secret o API key en un
   archivo del repositorio — incluidos los JSON de flujos exportados, los
   sticky notes de n8n y los ejemplos. Solo en `.env` (ignorado) y en el
   gestor de contraseñas.
3. **NUNCA** presentar un cobro simulado como real. El QR de demostración
   lleva el rótulo impreso en la imagen **y** en el caption, y la confirmación
   dice "simulado". Sin webhook de acreditación bancaria no hay cobro real.
4. **NUNCA** hacer que el agente niegue ser una IA. Se presenta como asistente
   virtual y, si le preguntan, lo dice con naturalidad.
5. **NUNCA** tocar la app de Meta `Demo SeguroLo Tengo` ni el `otp-service`:
   son de WhatsApp-Modular, un sistema financiero en producción. Comparten la
   VM y la WABA, pero son productos distintos.
6. **NUNCA** publicar el número de prueba a terceros: solo responde a los 5
   destinatarios registrados (ver ESTADO.md, riesgo de demo).

## Reglas de diseño de los flujos n8n

- **Memoria con clave de sesión explícita** = número de origen
  (`messages[0].from`). Sin esto, dos clientes comparten memoria. Es el
  defecto más grave que puede tener uno de estos flujos.
- **Filtro de eventos** antes del agente: solo pasan payloads con `messages`.
  Los acuses de estado se descartan.
- **Normalización de entrada** que cubra `text`, `interactive`, `order`,
  `image` y cualquier otro tipo con respuesta cortés. Nunca acceder a
  `.text.body` sin pasar por ahí.
- **Fecha, hora y zona inyectadas al prompt** (`America/La_Paz`, UTC-4 fijo).
  Sin esto, "mañana en la tarde" se calcula mal.
- **Modelo como sub-nodo intercambiable**: cambiar Gemini por Anthropic no
  debe requerir tocar nada más del flujo.
- **Todo lo configurable por negocio** vive en el nodo `Config del negocio`,
  no disperso por el lienzo. Es lo que sostiene la promesa de instalar un
  cliente nuevo en 48 horas.
- **Nodos Code en JavaScript**: la imagen de n8n desplegada no trae Python.

## Flujo de trabajo

- Los JSON de `Flujos/` son la fuente de verdad versionada. Tras editar en la
  interfaz de n8n, **exportar** (⋯ → Download) y reemplazar el archivo.
- En n8n cada cambio exige volver a pulsar **Publish** para que llegue a
  producción.
- n8n Community no comparte flujos entre usuarios: la cuenta de Andres es
  dueña de lo productivo; Silvana desarrolla e intercambia por export/import.
- Antes de dar algo por terminado, probarlo contra un teléfono real y
  reportar el resultado **real**, no el esperado.
