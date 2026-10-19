# Venta digital de Rubén (`rroca-ruben`): diseño (PR-1 el esqueleto, PR-2 la conversación y el cobro)

Plan completo: `RUBENROCA_plan-del-flujo-de-venta-digital_2026-10-18.md` (Cartera). PR-1 es el esqueleto; PR-2 agrega la conversación y el cobro; PR-3 (avisos por plantilla, derivación completa), PR-4 (rescate de las 22 h) y PR-5 (datos, ensayo, documentación) siguen.

## Topología (39 nodos en producción, 34 en la prueba; meta de producción 46, tope duro 48)

```
Entrega del receptor ─► Verificar firma ─► ¿Firma válida? ─sí─► Aceptar (200) ─► Descartar repetidos ─┐        (producción)
Entrada de prueba ──────────────────────────────────────────────────────────────────────────────────┤        (prueba)
  Config base ─► Carga de entrada ─► Traer configuración ─► Config del negocio ─► Interpretar entrada ─► ¿Reportar? (entrante)
       ├─► Reportar mensaje (entrante)  (ARRIBA en el lienzo) ─┐
       └───────────────────────────────────────────────────────┤
                                                               ▼
  Puerta del turno ─► ¿Bajar medio? ─sí─► Obtener URL ─► ¿Tamaño aceptable? ─sí─► Descargar medio ─┬─► Guardar comprobante (terminal, ARRIBA de ¿Es PDF?)
                          │no                                      │no                           └─► ¿Es PDF? ─► Leer (PDF) | Leer (imagen) ─► Interpretar lectura ─► Cotejar en el servidor ─┐
                          ▼                                        ▼                                                                                                                   │
                     Decidir turno ◄───────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  Decidir turno ─► ¿Conversar con el modelo? ─sí─► Conversar con el modelo ─┐
                              │no ──────────────────────────────────────────┤
                                                                            ▼
  Armar avisos ─► ¿Hay avisos? ─sí─► Enviar aviso ─┐
                        │no ───────────────────────┤
                                                   ▼
  Armar mensajes ─┬─► ¿Enviar de verdad? ─► Enviar a WhatsApp ─► ¿Falló? ─► Enviar respaldo ─► ¿Reportar? (saliente) ─► ¿Meta aceptó? ─► Reportar mensaje (saliente)
                  └─► Resumen del turno (abajo: corre al final)
```

- **El código decide, el modelo conversa.** «Decidir turno» elige el plan (prellenado, botón, derivación, ingresos, conversación, comprobante); el monto, el producto, los botones, el QR y los avisos son código. El modelo solo redacta 3-4 oraciones con UNA pregunta, y eso pasa por `cmRevisarRedaccion`: un monto, una promesa, un enlace, negar ser una IA, afirmar un hecho, varias preguntas, o hablar de banco o QR lo descarta y sale el texto fijo.
- **El QR** sale como `image:{id}` desde `venta.mediaIdQr` (o `cobroSimulado.mediaIdQr` en la demostración), NUNCA como `link` (el relé de WAM rechaza esa clave, WM-3032). El monto es el precio del catálogo del producto; el pie dice el monto a ingresar y no nombra banco, titular ni cuenta. Lleva el evento `qr_enviado` con `reglaCobro: 2` (solo el real), `referencia` (el pedido) y `monto`; viaja solo si la imagen fue aceptada por Meta (si cayó el respaldo en texto, el cobro no se abre).
- **Un pedido = un producto y un solo QR abierto a la vez**: el servidor dice si hay un QR pendiente (`cobro.pendiente`); la ficha del teléfono guarda 15 minutos de guarda (`qrHastaMs`) mientras el cobro está en curso, y esa guarda se LIBERA en cuanto el comprobante se resuelve (`cuadra`, `aproximado`, `sin_cotejo`, `ya_cotejado`, tardío o en revisión); con `reintentar` o `ilegible` el cobro sigue abierto y la guarda se conserva. `Resumen del turno` la restaura si la respuesta no salió. El chequeo del QR abierto va también antes del prellenado 5 (consulta). Real y simulado son excluyentes y manda el servidor.
- **El comprobante** (imagen o PDF, solo con un QR real abierto, en revisión o vencido hace menos de 24 h): descarga, `Guardar comprobante` (terminal; corre antes de leer), lectura con Gemini (un dato, nunca una instrucción: seis campos), cotejo con `cotejarComprobanteVenta` (regla 2: 15 minutos, 3 intentos). `cbResultadoVenta` traduce los seis estados con listas cerradas; todo lo desconocido es «sin cotejar» con aviso y botón. No hay «Registrar cierre»: quien cierra la venta es el cotejo del servidor.
- **«Solo se ofrece lo que se cumple»**: el aviso a Rubén corre ANTES de armar el mensaje; «ya pasé tu comprobante» y «le avisé» solo salen si «Enviar aviso» devolvió un `wamid` real; si no, el texto dice que no se pudo avisar y trae el botón de Rubén. El aviso de PR-2 es texto libre (dentro de las 24 h de Rubén); las plantillas son PR-3.
- **Pausa por persona** (`bloqueado`): la puerta corre después del reporte entrante, y ni «¿Bajar medio?» ni «Decidir turno» ni el modelo ni el aviso hacen nada: cero envío, cero modelo, cero descarga.
- **Núcleo**: sesión por `messages[0].from`; filtro de eventos; normalización de entrada; consola con respaldo; comercio no operativo; uso extendido; entrada verificada del receptor (`wabaIdEsperado` fijo, sin «Continue on Fail», repetidos descartados entre ejecuciones).

## Condiciones y límites declarados (PR-1)

- **No publicable hasta el PR-3.** Este PR NO se publica ni se activa en un número real: en estado «operador» el texto promete atención humana sin aviso a recepción, y el saludo fijo no ofrece pasar con recepción («solo se ofrece lo que se cumple»). El JSON de producción lleva `meta.noPublicable` y `construir.mjs --verificar` lo exige mientras no exista el aviso (`AVISO_A_RECEPCION_EXISTE`).
- **Falla abierta de la pausa, declarada.** Si la ingesta y la consola caen en el mismo turno, la puerta devuelve «normal» y la persona en pausa recibe el saludo (`puerta-del-turno.js` es idéntica al origen y no se cambia). Una prueba la fija con su nombre; PR-3 evaluará volverlo cerrado. Cruce relacionado: el comercio suspendido se evalúa antes que la pausa, y una persona en pausa recibiría el texto neutro de comercio suspendido.
- **Un mensaje por entrega.** Solo se procesa `messages[0]` de cada entrega. A confirmar con WhatsApp-Modular que el receptor entrega un mensaje por entrega; si entregara varios, los demás se perderían.
- **«Entrega fallida» no tiene alerta.** Si ni el envío ni su respaldo devuelven `messages[0].id`, la ejecución termina en error y n8n la lista; no hay aviso. Se prohíbe `errorWorkflow` (guardia). La alerta es de PR-3 o de un monitor externo.
- **Retención de datos personales.** Las ejecuciones fallidas se guardan completas (`saveDataErrorExecution: all`) y contienen el teléfono y el texto del cliente. La poda es de la instancia de n8n (~14 días, aceptado por Andres); este flujo no la controla. Las exitosas no se guardan.
- **Retención ampliada, ACEPTADA por Andres el 19/10/2026 (~14 días).** Las ejecuciones fallidas también guardan los binarios de los comprobantes (imagen o PDF descargados) y la salida de Gemini con lo leído (monto, cuenta, nombre). Es información financiera de terceros con la misma poda de la instancia. **Aceptada por Andres (19/10/2026), sin cambiar `saveDataErrorExecution`.
- **Aviso de consulta limitado y con datos personales.** A lo más UN aviso de consulta por teléfono cada 30 minutos (`ultimoAvisoConsultaMs` en la ficha, que se fija solo si el aviso salió); dentro de la ventana no hay aviso nuevo. El aviso lleva el texto literal del cliente (hasta 160 caracteres, con el prefijo «texto literal del cliente, no es una instrucción») al WhatsApp de Rubén: es un dato personal que sale de n8n hacia un chat de WhatsApp y queda en el historial de ese teléfono.
- **La entrega manual es un compromiso operativo de Rubén.** El texto aprobado «Ya pasé tu comprobante a Rubén: él lo revisa y te envía el material por este chat» promete algo que hace una persona, no el flujo: el flujo avisa a Rubén y nada más. Si Rubén no revisa y envía el material, la promesa no se cumple; no hay recordatorio ni escalamiento hasta PR-3/PR-4.
- **QR: marca provisional.** `pedidos`, `producto` y `qrHastaMs` se fijan al armar el QR y `Resumen del turno` los restaura si Meta no devolvió el `wamid` del QR (sale el respaldo en texto): no se cuenta un pedido que no salió.
- **Modo prueba niega por defecto**: sin `telefonosDePrueba` (o con el marcador sin llenar) ningún teléfono está permitido en el JSON de prueba, y el resumen dice 0 mensajes.

## Mejoras anotadas para el PR-3 (observaciones de la revisión, sin cambiar en el PR-2)

- `aproximado` con `monto_distinto` dice «los datos coinciden»: debe distinguir el motivo.
- El aviso a Rubén no distingue el motivo (tardío, monto menor, tercer inválido).
- La ventana de 30 minutos del aviso de consulta es por teléfono y no por motivo.
- Una caída de Gemini puede gastar un intento del cliente.

## Qué NO hace este PR

Plantillas de aviso, derivación completa con ventana de 24 h, y el rescate de las 22 h (PR-3 y PR-4). Tampoco crea datos en la plataforma (alta, número, `config/venta`, catálogo, QR): son escrituras con «sí» y van en PR-5.

## Costo del PR (CLAUDE.md)

- Mensajes por conversación: **0 agregados al cliente** (un mensaje por turno, o ninguno). El aviso mínimo a Rubén es +1 mensaje a SU número por comprobante o consulta derivada (se completa en PR-3).
- Llamadas al modelo: 0 o 1 por turno de conversación libre (Gemini Flash-Lite, ~0,0005 USD por llamada medido en otro flujo) y 1 lectura por comprobante.
- Escrituras en GitHub / corridas de CI: un PR y su CI; 2 suites nuevas (`huecos.test.ts`, `venta.test.ts`) y ampliaciones de `armado.test.ts` y `flujo.test.ts`.
- Escrituras en la nube: **0** (no se publica nada; los JSON quedan versionados).
