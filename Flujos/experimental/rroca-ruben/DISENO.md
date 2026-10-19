# Venta digital de Rubén (`rroca-ruben`): diseño del esqueleto (PR-1)

Plan completo: `RUBENROCA_plan-del-flujo-de-venta-digital_2026-10-18.md` (Cartera). Este PR cubre solo el esqueleto; lo demás son PR-2 a PR-5.

## Topología (23 nodos en producción, 18 en la prueba; tope duro 48)

```
Entrega del receptor ─► Verificar firma con el receptor ─► ¿Firma válida? ─sí─► Aceptar (200) ─► Descartar repetidos ─┐
                                                            └no─► Rechazar (401)                                      │
Entrada de prueba (solo en la prueba) ──────────────────────────────────────────────────────────────────────────────┤
                                                                                                                     ▼
  Config base ─► Carga de entrada ─► Traer configuración ─► Config del negocio ─► Interpretar entrada ─► ¿Reportar? (entrante)
                                                                                                      ├─► Reportar mensaje (entrante) ─┐   (arriba en el lienzo)
                                                                                                      └────────────────────────────────┤
                                                                                                                                       ▼
                                                              Puerta del turno ─► Armar mensajes ─┬─► ¿Enviar de verdad? ─► Enviar a WhatsApp ─► ¿Falló? ─► Enviar respaldo
                                                                                                  │        ─► ¿Reportar? (saliente) ─► ¿Meta aceptó? ─► Reportar mensaje (saliente)
                                                                                                  └─► Resumen del turno (abajo: corre al final)
```

- **Producción** (`rroca-ruben.json`): la entrada verificada del receptor; sin «Entrada de prueba» ni WhatsApp Trigger (prohibición 7). **Prueba** (`rroca-ruben.prueba.json`): solo «Entrada de prueba» (credencial de cabecera) y sin receptor; se importa para ensayar y se borra.
- **Orden del lienzo** (`executionOrder: v1`): «Reportar mensaje (entrante)» va ARRIBA de la rama que responde; la puerta corre después porque la atención (pausa, uso extendido) viene de la respuesta de ese reporte. Una prueba lo verifica por posición y por orden de ejecución.
- **Núcleo**: sesión por `messages[0].from`; filtro de eventos (solo `messages`, sin `statuses`, del número esperado); normalización de entrada (text, interactive, button, audio, image, document, location, sticker, contacts y otros, con respuesta cortés); consola con respaldo; comercio no operativo; uso extendido; **pausa por persona** (`bloqueado`: cero envío y cero modelo, el entrante sí se cuenta).
- **Envío mínimo**: un saludo fijo del asistente virtual de Rubén para cualquier entrada, armado por código y pasado por NIEGA_IA. Sin modelo.

## Condiciones y límites declarados (PR-1)

- **No publicable hasta el PR-3.** Este PR NO se publica ni se activa en un número real: en estado «operador» el texto promete atención humana sin aviso a recepción, y el saludo fijo no ofrece pasar con recepción («solo se ofrece lo que se cumple»). El JSON de producción lleva `meta.noPublicable` y `construir.mjs --verificar` lo exige mientras no exista el aviso (`AVISO_A_RECEPCION_EXISTE`).
- **Falla abierta de la pausa, declarada.** Si la ingesta y la consola caen en el mismo turno, la puerta devuelve «normal» y la persona en pausa recibe el saludo (`puerta-del-turno.js` es idéntica al origen y no se cambia). Una prueba la fija con su nombre; PR-3 evaluará volverlo cerrado. Cruce relacionado: el comercio suspendido se evalúa antes que la pausa, y una persona en pausa recibiría el texto neutro de comercio suspendido.
- **Un mensaje por entrega.** Solo se procesa `messages[0]` de cada entrega. A confirmar con WhatsApp-Modular que el receptor entrega un mensaje por entrega; si entregara varios, los demás se perderían.
- **«Entrega fallida» no tiene alerta.** Si ni el envío ni su respaldo devuelven `messages[0].id`, la ejecución termina en error y n8n la lista; no hay aviso. Se prohíbe `errorWorkflow` (guardia). La alerta es de PR-3 o de un monitor externo.
- **Retención de datos personales.** Las ejecuciones fallidas se guardan completas (`saveDataErrorExecution: all`) y contienen el teléfono y el texto del cliente. La poda es de la instancia de n8n (~14 días, aceptado por Andres); este flujo no la controla. Las exitosas no se guardan.
- **Modo prueba niega por defecto**: sin `telefonosDePrueba` (o con el marcador sin llenar) ningún teléfono está permitido en el JSON de prueba, y el resumen dice 0 mensajes.

## Qué NO hace este PR

Catálogo, total, QR, cobro (simulado o real), comprobante, cotejo, avisos a Rubén, derivación y rescate de las 22 h. Tampoco crea datos en la plataforma (alta, número, `config/venta`): son escrituras con «sí» y van en PR-5.

## Costo del PR (CLAUDE.md)

- Mensajes por conversación: **0 agregados** (un saludo por turno; ninguno si la persona está en pausa).
- Escrituras en GitHub / corridas de CI: un PR y su CI; 2 suites nuevas (86 pruebas, menos de 1 s).
- Escrituras en la nube: **0** (no se publica nada; los JSON quedan versionados).
