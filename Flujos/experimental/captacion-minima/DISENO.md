# NovuChat — Captación mínima (v0): diseño

Reformulación del chat de captación (`Flujos/novuchat-onboarding.json`, 51 nodos, un agente con memoria y un Code de 900
líneas que corrige lo que el modelo escribió) con el principio de **Agenda mínima**: **el código calcula y escribe el guion; el
modelo solo pone una línea de empatía, contesta preguntas sueltas con los datos y clasifica**. El contrato es `CONTRATO.md`
(del coordinador; este documento solo lo implementa y precisa firmas). Flujo **experimental**: vive en
`Flujos/experimental/captacion-minima/` y no se publica sin el «sí» de Andres.

## Archivos

| Archivo | Qué es |
|---|---|
| `flujo.plantilla.json` | El flujo sin el código ni los datos: cada nodo Code lleva `"jsCode": "@@…:nodos/<archivo>.js"`; las credenciales, `@@cred:<nombre>`; los textos, `@@dato:<ruta>@@`. Es lo que se edita |
| `src/lib/captacion.js` | Librería PURA (prefijo `cc`): estado, detectores por palabra entera, modelo, mensajes, y las dos funciones del turno `ccDecidir` y `ccCompletar`. Sin reloj, sin red, sin `$…` de n8n, sin `URL`/`Buffer`/`crypto` |
| `src/nodos/_comun.js` | Utilidades `cn*` de los nodos (leer otro nodo por nombre, texto y JSON de Gemini, atención, ficha) |
| `src/nodos/*.js` | El código de cada nodo Code. `decidir-fila-de-la-planilla.js` es copia TAL CUAL de `8173a00:Flujos/src/modulos/captacion/decidir-fila-de-la-planilla.js` |
| `construir.mjs` | Arma los dos JSON con el armador genérico `../comun-sin-agente/construir.mjs`, valida los datos, inyecta guion y corpus y aplica las guardias. `--verificar` no escribe |
| `captacion-minima.novuchat.json` | **Producción**: con «WhatsApp Trigger», sin «Entrada de prueba» |
| `captacion-minima.prueba.json` | **Prueba**: con «Entrada de prueba» (Webhook POST con Header Auth), sin «WhatsApp Trigger» |
| `admin/scripts/datos/captacion-minima/{novuchat,ensayo}.json` | Datos del tenant (zona Tenants): solo marcadores `REEMPLAZAR_*` para identificadores, el guion (por rubro: `dolor`, `pregunta`, `impacto`, `cierre`; las claves son los ids VIVOS de la consola) y el corpus |
| `admin/pruebas/captacion-minima-lib.test.ts` | La librería, el armador y el JSON armado |
| `admin/pruebas/captacion-minima-flujo.test.ts` | Punta a punta, de caja negra (otro agente) |

Para cambiar el flujo: editar la plantilla o un archivo de `src/nodos/`, correr `node construir.mjs` y
`pnpm -s vitest run --project puras pruebas/captacion-minima-lib.test.ts pruebas/captacion-minima-flujo.test.ts` desde `admin/`.

## Cómo se arma

1. `construir.mjs` lee y valida TODOS los archivos de datos (`hereda`, credenciales, `configBase`, guion, corpus; cada error nombra
   el campo) antes de tocar la plantilla.
2. Por cada archivo de datos quita el disparador que no corresponde, reemplaza `@@dato:…@@` y `@@cred:…`, llena «Config base» con
   `configBase` y deja que el armador genérico pegue DELANTE de cada nodo, en este orden: `src/lib/captacion.js`,
   `src/nodos/_comun.js`, y los paquetes `mensajes` y `filtro` de `comun-sin-agente` (el Code de n8n no tiene módulos).
3. Marcas de la plantilla: `@@todo+mensajes+filtro:` (librería + comunes + `cm*`), `@@todo:` (librería + comunes), `@@comun:` (solo
   comunes) y `@@solo:` (solo el archivo). **Quien use `ccLeerModelo`, `ccLista`, `ccOferta`, `ccPlanes`, `ccTraspaso`, `ccFijo` o
   `ccCompletar` pega `+mensajes+filtro`** (hoy solo «Armar mensajes»): las usan al ser llamadas, no al cargarse. «Decidir turno» no usa
   ninguna `cm*` y pega solo la librería y los comunes; «Interpretar entrada» solo los comunes (`cnYaVisto`).
4. Inyección: la línea `const CM_GUION = null; // @@guion` (en «Config del negocio») y `const CM_CONOCIMIENTO = null; // @@conocimiento`
   (en «Decidir turno») se reemplazan por el literal del archivo de datos; cada una tiene que aparecer EXACTAMENTE una vez.
5. Guardias (sobre lo armado y sobre lo versionado): «Entrada de prueba» nunca en producción; «WhatsApp Trigger» nunca en la prueba y con
   credencial explícita que no coincida con `/aab1|wa-prod/i`; ni `subscriptions` ni `subscribed_apps`; anfitriones HTTP
   `graph.facebook.com`, `generativelanguage.googleapis.com` y `us-east1-novuchat-demo.cloudfunctions.net`, y solo dos URL por
   expresión («Descargar medio» y «Guardar prospecto»); ningún `agent`, memoria ni `lmChat*`; retención de solo lo que falla (éxito `none`, error `all`, sin `errorWorkflow`), `executionOrder: v1` y
   zona de La Paz; rangos `A3:J` y `A3:A`, `USER_ENTERED` y `RAW`; `REEMPLAZAR_` solo en «Config base» y en la ruta de prueba; huérfanos.

## Total de nodos

**44 en la plantilla; 43 en cada variante** (la de producción quita «Entrada de prueba»; la de prueba, «WhatsApp Trigger»). Comparación:
el flujo viejo de captación tiene **51** (agente, modelo, memoria y un Code de corrección de 900 líneas); Agenda mínima, **44** por variante.
De los 43: 11 Code (uno, el de la planilla, es copia del viejo), 14 IF, 1 Set, 9 HTTP (configuración, ingesta ×2, medios ×2, Gemini,
envío, respaldo, CRM), 4 Google Sheets, 3 Gemini de medios y el disparador.

## El grafo

```
WhatsApp Trigger (prod) ─┐
Entrada de prueba (prueba)┴→ Carga de entrada → Config base → ¿Es un mensaje? → Traer configuración → Config del negocio
  → Interpretar entrada → ¿Reportar? (entrante) ─sí→ Reportar mensaje (entrante) ─┐
                                                └no────────────────────────────────┴→ ¿Comercio operativo?
  ¿Comercio operativo? ─no→ Comercio no operativo ──────────────────────────────────────────────→ Armar mensajes
        └sí→ ¿Atención normal? ─no→ Uso extendido ───────────────────────────────────────────→ Armar mensajes
                  └sí→ ¿Bajar medio? ─no───────────────────────────────────────────────────────→ Decidir turno
                              └sí→ Obtener URL del medio → ¿Tamaño aceptable? ─no──────────────→ Decidir turno
                                                              └sí→ Descargar medio → ¿Es audio? ─sí→ Transcribir audio ─→ Decidir turno
                                                                                              └no→ ¿Es un documento? ─sí→ Describir documento ─→ Decidir turno
                                                                                                                       └no→ Describir imagen ──→ Decidir turno
  Decidir turno → ¿Llamar al modelo? ─sí→ Llamar al modelo ─→ Armar mensajes
                                     └no───────────────────→ Armar mensajes
  Armar mensajes (un ítem por mensaje) ─┬→ ¿Enviar de verdad? ─sí→ Enviar a WhatsApp → ¿Falló el interactivo? ─sí→ Enviar texto de respaldo
   (hijos, de arriba abajo)             ├→ ¿Guardar prospecto? ─sí→ Guardar prospecto
                                        ├→ Prospecto para la planilla → Buscar teléfono → Leer IDs → Decidir fila → ¿Agregar fila? → Agregar fila
                                        │                                                                     └→ ¿Actualizar fila? → Actualizar fila
                                        ├→ Confirmar envío → Reportar mensaje (saliente)      (el hijo más bajo salvo el resumen)
                                        └→ Resumen del turno                                  (la última rama)
```

Con `executionOrder: v1` cada rama termina entera antes de la siguiente, de arriba abajo. De ahí tres reglas de posición: «Reportar
mensaje (entrante)» va arriba (se reporta el mensaje antes que su respuesta); «Confirmar envío» va debajo de los envíos, el aviso, el CRM
y la planilla (lee lo que contestaron); «Resumen del turno» va al final (la prueba responde con él).

## El contrato de ítems entre nodos

Cada nodo lee lo que necesita **por nombre** (`$('Nodo')`, solo si corrió) y no depende de lo que le llegue por la conexión, salvo donde
se dice. Los campos que viajan:

| Nodo | Lee | Emite (campos del ítem) |
|---|---|---|
| WhatsApp Trigger / Entrada de prueba | — | La carga de Meta (`messages`, `contacts`, `metadata`, `statuses`); la prueba la trae en `body` y suma `modoPrueba`, `telefonoDePrueba`, `enviarDeVerdad` |
| Carga de entrada | el ítem de entrada; «Entrada de prueba» si corrió | `messaging_product`, `metadata`, `contacts`, `messages` (arreglo), `statuses` (arreglo), `phoneNumberId`, `ahoraMs`, `prueba` (`{modoPrueba, telefonoDePrueba, enviarDeVerdad}` o `null`; solo `modoPrueba === true` del cuerpo de «Entrada de prueba» la activa) |
| Config base | — | el ítem anterior + los `configBase` del tenant (`waGraphVersion`, `phoneNumberIdEsperado`, `numeroRecepcion`, `nombreNegocio`, `horarioAtencion`, `plantillaAviso`, `idiomaPlantillaAviso`, `planillaProspectosId`, `planillaProspectosHoja`, `crmUrl`, `prefijosPermitidos`, `nivelEmojis`, `mensajeComercioSuspendido`, `limiteInteractivo`) |
| ¿Es un mensaje? | Carga de entrada, Config base | pasa el ítem si hay `messages`, no hay `statuses` y `phone_number_id` = `phoneNumberIdEsperado` |
| Traer configuración | `$json` | `{statusCode, body}` del panel (`neverError`); cabecera `X-NovuChat-Numero` = `phone_number_id`, cuerpo `{telefono}` |
| Config del negocio | Traer configuración, Config base, Carga de entrada, el literal `CM_GUION` | `nombreNegocio`, `nombreAsistente`, `asesor` (nombre de pila o ''), `numeroRecepcion` (dígitos), `plantillaAviso`, `idiomaPlantillaAviso`, `nivelEmojis`, `prefijosPermitidos`, `rubros`, `planes`, `cargosUnicos`, `aclaraciones`, `archivoPlanes`, `campanas` (vigentes, con `destino?`), `guion`, `estadoComercio`, `mensajeComercioSuspendido`, `atencionEstado/MensajeFijo/AvisarRecepcion/Respuestas/VenceEn`, `planillaProspectosId/Hoja`, `crmUrl`, `limiteInteractivo`, `waGraphVersion`, `phoneNumberId`, `modoPrueba`, `telefonoDePrueba`, `enviarDeVerdad`, `configDeLaConsola` |
| Interpretar entrada | Carga de entrada, Config del negocio, la ficha (solo lectura) | `from`, `nombrePerfil`, `phoneNumberId`, `mensajeId`, `tipo`, `via` (`texto`/`audio`/`toque`/`imagen`/`documento`/`otro`), `texto` (escrito, pie de foto o botón; un toque NO trae texto), `idToque`, `textoReporte`, `anuncio`, `origen`, `esAudio`, `esVisual`, `esDocumento`, `mediaId`, `ahoraMs`, `prueba`. **Devuelve vacío** si no hay mensaje, la clave no son 6 a 20 dígitos, el prefijo no está permitido o el id ya está en `ultimosIds` |
| ¿Reportar? (entrante) | Config del negocio | pasa el ítem; falso en modo prueba |
| Reportar mensaje (entrante) | Interpretar entrada | la respuesta de la ingesta (`atencion`, `servicio`) |
| ¿Comercio operativo? / ¿Atención normal? | respuesta del reporte o `$json`, Config del negocio | pasan el ítem |
| Comercio no operativo | Config del negocio | `accion:'suspendido'`, `texto`, `from` |
| Uso extendido | Reportar (entrante), Config del negocio | `accion:'uso_extendido'`, `responder`, `texto`, `transferir` (¿avisar a recepción?), `motivo` |
| Obtener URL / ¿Tamaño aceptable? / Descargar medio | Interpretar entrada (`mediaId`, `esAudio`) | `{url, mime_type, file_size}`; el binario `data` |
| Transcribir audio / Describir documento / Describir imagen | el binario `data` | `{content:{parts:[{text}]}}`; para imagen o PDF el texto es el JSON `{categoria, texto}` |
| Decidir turno | Interpretar entrada, Config del negocio, la ficha, los nodos de medios | `plan` (ver abajo), `llamarModelo`, `cuerpoModelo` (null si no hay modelo), `from` |
| ¿Llamar al modelo? | `$json` | `llamarModelo === true` |
| Llamar al modelo | `$json.cuerpoModelo` | la respuesta de `generateContent` (o `{error}`) |
| Armar mensajes | Decidir turno, Llamar al modelo, Comercio no operativo, Uso extendido, la ficha | **un ítem por mensaje**: `para` (número destino), `destino` (`cliente`/`recepcion`), `payload`, `texto`, `respaldo`, `tipoReporte`, `evento`, `esInteractivo`, `esAviso`, `marcaAvisado`, `reportar`, `phoneNumberId`, `waGraphVersion`, `from`, `sinMensajes`. **Solo el primero** trae además `resumen` (con `avisos`), `avisos` (`['rubro_sin_guion']` o `[]`, §13), `guardarPlanilla`, `prospectoPlanilla`, `guardarCrm`, `crmUrl`, `cuerpoCrm`. Sin mensajes (bloqueado sin aviso): un ítem `sinMensajes:true` |
| ¿Enviar de verdad? | Config del negocio | pasa el ítem si no es `sinMensajes` y (no es prueba, o hay `enviarDeVerdad` y teléfono de prueba) |
| Enviar a WhatsApp | `$json.payload` | `{statusCode, body}` (`fullResponse`, `neverError`); un mensaje cada 1,5 s |
| ¿Falló el interactivo? | Enviar a WhatsApp, Armar mensajes (`esInteractivo`) | pasa el ítem si falló y era interactivo |
| Enviar texto de respaldo | Armar mensajes (`para`, `respaldo`) | `{statusCode, body}` |
| ¿Guardar prospecto? / Guardar prospecto | Armar mensajes (`guardarCrm`, `crmUrl`, `cuerpoCrm`) | `{statusCode, body}` del CRM. En la v0 `crmUrl` va vacío: no corre |
| Prospecto para la planilla | Armar mensajes | `{telefono, nombre, empresa, rubro, flujos, consulta, estado, anuncio, hechos}` (solo si `guardarPlanilla`) |
| Buscar teléfono / Leer IDs / Decidir fila / ¿Agregar? / Agregar / ¿Actualizar? / Actualizar | Prospecto para la planilla, Config del negocio | los del flujo viejo (copia exacta de «Decidir fila») |
| Confirmar envío | Armar mensajes, Enviar a WhatsApp, Enviar texto de respaldo, Config del negocio | un ítem por mensaje al cliente que Meta aceptó (y no en modo prueba): `from`, `phoneNumberId`, `tipo`, `texto`, `idMeta`, `evento`. **`throw`** si Meta rechaza un mensaje al cliente y su respaldo |
| Reportar mensaje (saliente) | `$json` de Confirmar | la respuesta de la ingesta |
| Resumen del turno | Armar mensajes, Config del negocio | `{ok, modoPrueba, mensajes[], resumen}` |

**El plan** (lo que `ccDecidir` deja y `ccCompletar` ejecuta): `accion` (`lista`, `dolor`, `abierta`, `planes`, `planes_ya`, `traspaso`,
`soporte`, `identidad`, `fijo`, `empresa`, `oferta`, `retomar`, o `modelo`), `e` (la ficha tras lo decidido sin modelo), `paso0`, `via`,
`texto`, `textoDeImagen`, `from`, `nombrePerfil`, `llamarModelo`, `modo` (`eligiendo`, `dolor`, `negocio`, `libre`, `empresa`) y `extra`
(opciones de la acción: `presentar`, `promesa`, `vencida`, `conAsesor`, `pideEmpresa`, `texto`, …).

## La ficha por teléfono

`$getWorkflowStaticData('global').captacionMinima[<messages[0].from>]`, clave `^\d{6,20}$` (§4 del contrato). **Un solo escritor** de la
conversación: «Armar mensajes» (la ficha completa, los últimos 5 ids de Meta, `ultimoMensajeMs` y el barrido de las de más de 48 h: escribe
primero y barra después, así el total no pasa de 5.000). «Confirmar envío» escribe `avisado` y `avisoFalla` con lo que contestó Meta y,
**si Meta rechaza el mensaje al cliente y su respaldo, restaura la ficha de antes del turno** (R8: «Armar mensajes» la deja en el primer
ítem, `fichaAntes`), conservando `ultimosIds` y `ultimoMensajeMs` y el `avisado` de un aviso que sí salió. «Interpretar entrada» y «Decidir
turno» solo leen y no crean el mapa en los datos estáticos. Una ficha ilegible se sanea campo por campo (`ccEstadoVigente`). Lo que dejó el
flujo viejo (`conversaciones`, `vistos`) no se lee y «Armar mensajes» lo borra (S6: se publica en el mismo workflow).

## Firmas que precisé respecto del contrato

- `ccPideAsesor(t, campanas?)`: devuelve false si el texto es el de una campaña.
- `ccCampana` devuelve `{id, texto, destino?}`; un `destino` fuera de `rubro:<id>`, `planes`, `asesor` se descarta.
- `ccLeerToque(id, rubros)`: `rubro:otro` y el rubro «a medida» de la consola dan `{tipo:'otro', id:'otro'}`; un id que ya no existe, `{tipo:'vencida', id}`.
- `ccRubroPorNombre` devuelve el id, `'otro'` o `''`. `ccUnaPregunta(t)` es booleana. `ccRubroLibreValido(v, textos)` devuelve el texto limpio o `''`.
- `ccEsIdentidad` solo ve mensajes de hasta 10 palabras (una orden con «eres una persona» dentro de un texto largo va al modelo).
- `ccDescarteAceptado({descarte, via, hechos, soporte, textoCliente})`; `via`: `texto`, `audio` o `campana`; el resto se rechaza.
- `ccCuerpoModelo` recibe además `rubro` y `conocimiento`; `ccLeerModelo` además `nombreNegocio`, `asesor` y `aclaraciones:[{id,texto}]`, y devuelve `motivo` (`vacio`, `json`, `esquema`).
- «Otro / a medida» es una fila fija `rubro:otro`; los rubros «a medida» de la consola se descartan de la lista y del esquema.
- Límites del contrato (§12, reemplazados por los del §13, ver abajo): `empatia` ≤140 caracteres y ≤25 palabras; `impacto` ≤160 caracteres y ≤24 palabras;
  mensaje general ≤4 oraciones y ≤60 palabras (la oferta máxima mide 60: 25 + 24 + 11); el de PLANES ≤5 oraciones y ≤70 palabras.
- Funciones nuevas: `ccDecidir`, `ccCompletar`, `ccCuerpoLista`, `ccTituloAsesor`, `ccTituloDeFila`, `ccFijo`, `ccRetomar`, `ccPreguntaDelPaso`, `ccGuionDe` y las
  ayudas `ccAplicarRubro`, `ccAplicarPlanes`, `ccPedirPlanes`.
- `ccProspecto` agrega `consulta` («Quiere hablar con una persona», «Pidió los planes»): sin ella, «Decidir fila de la planilla» (copia exacta) no
  reescribe el resumen de quien ya tenía uno («Descalificado») cuando sube a Alta y no tiene rubro.

## Decisiones del diseño que el contrato no fijaba

- **Mensajes del flujo propios del código** (fijos, en tuteo, sin nombre de comercio; los textos exactos son los del §13): «¡Ya te los mostré arriba! 😊» + «¿Te gustaría hablar con {asesor}?»
  (un segundo pedido de planes no los repite), el texto de cada descarte, el de comprobante, el de medios ilegibles y el de falla. Todos pasan por `ccConEmojis` según el nivel de la consola.
- **Empresa:** mientras el cliente no diga un nombre válido el paso sigue en `esperando_empresa` (el nombre se anota cuando llegue); lo que se repregunta
  UNA sola vez es la pregunta.
- **Un toque no es texto:** un id de lista o de botón con forma rara no elige nada ni llama al modelo; el paso se repite.
- **Un modelo que dice `pide_planes`** solo lleva a los planes si el texto también los pide por palabra entera; `pide_asesor` ofrece el botón, no el traspaso.
- **En la variante de prueba** la planilla también se escribe (si «Config base» trae un id válido); no se reporta nada a la ingesta; todo va al teléfono de prueba.
- `Armar mensajes` escribe la ficha antes de que Meta conteste; si Meta rechaza el mensaje y su respaldo, «Confirmar envío» restaura la ficha de antes (R8) y corta la ejecución.

## Mensajes por conversación

**0 agregados y 0 quitados** respecto del flujo viejo en el camino principal: un mensaje por entrante (lista, dolor, oferta, planes, traspaso o
«Gracias, quedó anotado.») y la plantilla a recepción UNA vez, la primera vez que se pide una persona. El camino C1 (belleza, con planes, hasta
la empresa) son 6 mensajes y 1 plantilla con 1 llamada al modelo. Lo que cambia es el costo del modelo: antes cada turno lo llamaba; ahora solo
los turnos de texto libre, y como mucho una vez.

## Lo que NO hace, a propósito

Imágenes (la única que sale es la de precios, `archivoPlanes`, en el mensaje de PLANES; D16); guion en la consola; trato de usted; memoria de
conversación; consulta del cliente en la planilla; CRM real; segundo tenant; batería contra el modelo; ensayo y publicación. No calcula precios
con el modelo ni los deja pasar por su redacción. No niega ser una IA ni promete lo que no cumple (todo lo que ofrece al asesor lleva botón, fila o
enlace). No lee `conversaciones`.

## Pendientes para publicar

- **Credencial del disparador:** `credenciales.trigger` vale «WhatsApp Trigger NovuChat», un nombre provisional (el flujo viejo no trae la credencial en el JSON).
  Confirmarlo contra n8n; nunca la de AAB1-WA-Prod.
- **Retención (D13, Andres 03/10/2026):** se guardan solo las ejecuciones que fallan; una ejecución fallida guarda el texto del turno que falló.
- El `impacto` y el `cierre` por rubro ya están en el archivo de datos (§13); la cifra de Harvard NO entra: se carga después, verificada.
  Los identificadores reales van en una copia `*.local.json` (ignorada por git).
- `cmLista` (común) manda `description: ''` en las filas sin descripción; `ccLista` evita la clave. Revisar `cmLista` antes de que otro flujo la use.
- La plantilla `solicitud_contacto` debe estar aprobada en el WABA del tenant (seis parámetros).
- Probar contra un teléfono real y ensayar en el número del Demo A antes de publicar.

## Correcciones de la revisión (§12 del contrato)

Resumen de lo que cambió respecto de la primera entrega (cada punto tiene su prueba en `captacion-minima-lib.test.ts` o en
`captacion-minima-flujo.test.ts`, la segunda ya no se omite si falta el JSON):

- **Identidad, promesas y montos (S1 a S3):** `ccEsIdentidad(t, asesor)` reconoce «¿eres Silvana?», «¿me atiende una persona?», «¿esto es
  automático?»; `ccLeerModelo` rechaza en `empatia` y `respuesta` la primera persona, «te habla», las promesas de contacto y los montos, y
  en la `empatia` todo dígito, el nombre del asesor y «gratis», «descuento», «promo», «oferta»; una `respuesta` solo trae números que
  están en lo que ve el modelo (`opciones.datos`). Un solo patrón de precios (`CC_PRECIO`, que `construir.mjs` lee de la librería) para
  `ccTieneMonto` y el corpus. El fragmento `contacto` del corpus va en `excluidos`.
- **Enlaces y dígitos (S4), medios (S5), datos viejos (S6), prueba (S7), delimitadores (S8):** `rubroLibre` y `empresa` rechazan enlaces y
  6 o más dígitos; «¿Tamaño aceptable?» exige `https://lookaside.fbsbx.com/`; «Armar mensajes» borra `conversaciones` y `vistos`; en
  prueba no se escribe la planilla, `ensayo.json` no trae planilla y `configBase.telefonosDePrueba` (opcional; el marcador no restringe)
  limita a qué números puede ir una ejecución de prueba; `RUBRO` y lo leído en la imagen van en `[[[…]]]`; ids de rubro `__proto__`,
  `constructor` y `prototype` se rechazan; se recuerdan 5 ids por ficha.
- **Guion (R1 a R7):** el pedido de planes del primer mensaje y de la lista exige `ccPideListaPlanes` (mensaje corto, «?» o verbo de pedido);
  una pregunta por el precio va a los planes en cualquier paso; cortesías y evasivas nuevas no son una empresa; «soporte» solo con forma de
  cliente; el descarte solo se bloquea con la palabra «descarte» o un motivo literal con guion bajo; `pide_asesor` ofrece la fila o el botón
  sin traspaso; `guion.rubros.otro.preguntaDolor` evita volver a preguntar de qué trata el negocio.
- **Ficha adelantada (R8), retención (R9), medios sin conversación (R10):** ver «La ficha por teléfono»; retención éxito `none` / error
  `all`; `reaction`, `sticker`, `request_welcome`, `system` y `ephemeral` no se reportan ni se responden.
- **Tamaño (R11) y menores (R12):** se quitaron `ccEsSaludo` y `cnNorm`; una sola `ccQuien`, `ccPresentacion`, `ccArchivoDePlanes` y
  `ccRubrosComunes`; la campaña con destino vencido se presenta sin «Esa opción ya no está»; en la oferta el modelo recibe la pregunta de la
  oferta (`ccPreguntaHecha`); el modo `negocio` respeta `rubroId`; un agradecimiento en `libre` no repite la oferta (`ccEsAgradecimiento`); una
  aclaración se recorta (`ccAcotar`); «No pude leer tu documento»; `cnMapaDeFichas(escribir)`; «Reportar mensaje (saliente)» con `timeout` de 4000.

## Tono y rubros vivos (§13 del contrato, 03/10/2026 noche)

Andres probó el flujo publicado: «muy muy mal, robotizado, nada amable». Dos causas, dos arreglos, cada uno con su prueba.

### C1: los ids de rubro del guion no eran los de la consola VIVA
La consola de NovuChat usa `salud-y-belleza`, `gastronomia`, `comercio-y-retail`, `educacion` y `otro-a-medida` (el slug del nombre); el guion tenía `salud-belleza`, `comercio` y `otro`,
así que «Salud y Belleza» y «Comercio y Retail» caían en la pregunta de «Otro» sin que nadie lo notara (la suite y la batería usaban los mismos ids equivocados).
- `ccGuionDe(cfg, rubroId)` busca la entrada por el **id** del rubro y, si no está, por el **slug de su nombre** (`ccSlug`: minúsculas, sin tildes, lo que no es letra ni número, un guion). Las claves de `guion.rubros` en `novuchat.json` son los ids vivos.
- Un rubro de la consola sin entrada en el guion (y que no sea el «a medida») sigue tratándose como «Otro», pero **ya no en silencio**: `ccCompletar` devuelve `avisos: ['rubro_sin_guion']`
  (`ccAvisosDelTurno`), «Armar mensajes» lo deja en el primer ítem (`avisos`) y en el `resumen` del turno. La suite de punta a punta falla ante cualquier turno con aviso (salvo la prueba que lo provoca) y la batería lo cuenta como violación (`rubro_sin_guion`) y lo imprime como FALLO DE CONFIGURACIÓN.
- Pruebas: «REGRESIÓN: tocar CADA rubro de la consola viva da SU frase de dolor» (`captacion-minima-flujo.test.ts`, con la consola viva como fixture, por toque, por nombre escrito y por campaña), `ccGuionDe`/`ccSlug`/`rubro_sin_guion` en `captacion-minima-lib.test.ts`, y el caso de la batería con el guion sin la clave.

### C2: el tono
Se sigue `CLIENTES/NOVUCHAT/Opciones de Conversaciones Novuchat.pdf`: cálido, cercano, con exclamaciones y emojis, de tú.
- `nivelEmojis: muchos` en `novuchat.json` (la consola de NovuChat lo declara); todos los textos fijos pasan por `ccConEmojis` (`ccEm`) según el nivel, y al quitar un emoji no queda un espacio delante de la puntuación.
- **Textos fijos** (los del §13): lista («¡Hola! 👋 Soy el asistente virtual de {negocio} 🤖✨, con inteligencia artificial. Para darte la info exacta, ¿de qué rubro es tu negocio?»), oferta
  («empatía + impacto + ¿Te gustaría ver los planes o prefieres hablar con {asesor}?»), planes («¡Claro! 😊 {resumen} {cierre}»), traspaso («¡Perfecto! 🙌 Toca el botón para escribirle directo a {asesor}, que te cuenta cómo armarlo para tu negocio. Y para dejarlo anotado, ¿cómo se llama tu negocio?»),
  gracias por la empresa, falla del modelo, identidad, «sin datos», descartes y medios ilegibles.
- **El `resumen` de precios lo arma el código desde la consola** (`ccResumenDePrecios`): «La instalación sale desde USD {mínimo de `cargosUnicos`} (pago único) y los planes mensuales desde USD {mínimo de los planes `mes`}, cobrados en bolivianos.»
  Un plan anual no entra al mínimo mensual (no se afirma un precio mensual que no existe); sin cargos queda solo la mitad de los planes (y al revés); sin ninguno, «¡Claro! 😊» y el cierre. Nunca lo escribe el modelo: la empatía rechaza todo dígito y la respuesta, todo monto.
- **`cierre`** por rubro (dato del guion; el de «otro» para quien no tiene guion propio; el genérico «¿Qué te parece si {asesor} te cuenta cómo armaríamos esto para tu negocio? 👇» si falta) e **`impacto`** por rubro en la oferta.
- **El modelo escribe la empatía con calidez:** `ccInstrucciones` trae una sección «Tono» con los dos ejemplos genéricos del contrato. La empatía admite **hasta 2 oraciones** (una exclamación inicial cuenta como oración: el propio ejemplo del contrato «¡Uff, te entiendo! 😅 Responder todo a mano le quita tiempo a cualquiera.» tiene dos),
  hasta 140 caracteres (emojis incluidos) y **hasta 25 palabras** (60 − 24 del impacto − 11 de la pregunta de la oferta: así la oferta máxima nunca pasa de 60 palabras aunque el modelo use palabras cortas), sin «?», cifras, saludos ni promesas, y con al menos una letra.
  El respaldo cuando no pasa el filtro es «¡Te entiendo! 😊».
- **Límites** (`construir.mjs`, la librería, las suites y el detector de la batería): `dolor` hasta 2 oraciones y 200 caracteres; `dolor` + `pregunta` hasta 3 oraciones y 50 palabras; `impacto` hasta 160 caracteres y 24 palabras; `cierre` hasta 2 oraciones, 160 caracteres y una sola «?»;
  mensaje general hasta 4 oraciones y 60 palabras; mensaje de PLANES (el único con encabezado) hasta 5 y 70; sigue siendo una «?» y un mensaje por turno.
- **Mensajes por conversación: 0 agregados y 0 quitados** (los mismos mensajes, con otro texto).
- **Batería** (`herramientas/bateria.mjs`, `bateria-casos.json`): la consola ficticia usa los ids y los nombres VIVOS, el nivel «muchos» y un cargo de instalación; los casos `P1` a `P5` son las conversaciones del PDF (belleza completa, gastronomía,
  estudio contable, importadora con ERP y comercio); el resumen de precios del código no cuenta como monto del modelo; `rubro_sin_guion` cuenta como violación; el informe mide también la calidez (mensajes sin ningún emoji, empatías con emoji). La corrida contra el modelo real es de la coordinadora.

## Cordialidad, sin repeticiones innecesarias (§14, 04/10/2026)

Andres probó el flujo real y dijo «hay repeticiones innecesarias, poca cordialidad». Lo que se corrigió (0 mensajes agregados o quitados; mismos límites de longitud):
- **A. El traspaso no repite «negocio»:** «¡Perfecto! 🙌 Toca el botón para escribirle directo a {asesor}, que te cuenta cómo armarlo. Y para dejarlo anotado, ¿cómo se llama tu negocio? 😊» (sin pregunta del negocio: «…cómo armarlo para tu negocio.»).
- **B. Un acuse** (`ccEsAcuse`: «ok», «gracias», «listo», «dale», «vale», «perfecto», «entendido», «de acuerdo», «muchas gracias», un 👍…, sin «?» ni otra palabra) **en `esperando_empresa`** no repite la pregunta ni llama al modelo: «¡Con gusto! 😊 Cuando quieras, toca el botón para escribirle directo a {asesor}.»
  (con el `cta_url`: toda oferta del asesor lleva su botón; sin recepción, «…cuéntame el nombre de tu negocio.» sin botón ni promesa). El paso sigue en `esperando_empresa`, la repregunta no se gasta, no se avisa a recepción y, si llega el nombre, se anota.
  Una pregunta o algo distinto sigue por el camino de antes (modelo y UNA sola repregunta).
- **C. Cierre tras el nombre:** «¡Gracias! 😊 Anoté «{empresa}». ¡Cuando quieras, escríbele a {asesor} con el botón!» (con el `cta_url`; sin recepción, solo «¡Gracias! 😊 Anoté «{empresa}».»). La empresa ya pasó `ccNombreDeEmpresa`; para mostrarla `ccEmpresaVisible` quita
  `«»"“”` ` ` `[]{}<>*_~` y la corta a 60 caracteres; si no queda nada, «Quedó anotado.».
- **D. La pregunta de la oferta rota** entre tres formulaciones (`ccPreguntaDeOferta`) con `ofertas` (0 a 2) en la ficha: «¿Te gustaría ver los planes o prefieres hablar con {asesor}?», «¿Quieres que te muestre los planes o prefieres hablar con {asesor}?», «¿Te cuento los planes o prefieres hablar directo con {asesor}?»
  (sin planes: «¿Te gustaría hablar con…?», «¿Quieres hablar directo con…?», «¿Te animas a hablar con…?»). **Tras una respuesta suelta** en la oferta la pregunta no se repite cada vez: `sueltas` (0 o 1) cuenta las respuestas sueltas desde la última pregunta; la 1.ª cierra sin pregunta (los botones siguen),
  la 2.ª la hace (con la formulación que toca) y reinicia la cuenta; una oferta con su pregunta también la reinicia. En los demás pasos la pregunta del paso siempre se retoma. La identidad y «sin datos» no cambian esto. `ofertas` y `sueltas` los escribe «Armar mensajes» como el resto de la ficha, `ccEstadoVigente` los sanea (enteros acotados) y vencen con la ventana de 24 h.
  «PREGUNTA QUE HICISTE» para el modelo es la formulación que salió (`ccPreguntaHecha`).
- **E. Empatía natural:** la sección de tono de `ccInstrucciones` pide frases simples y cotidianas, sin dramatizar ni rebuscar («da una pena tremenda» es lo que NO debe salir), una sola idea y no repetir lo del cliente palabra por palabra. Los ejemplos se mantienen.
- **F. Otras correcciones:** el segundo pedido del botón no recibe el mismo texto («¡Claro! 😊 Aquí tienes otra vez el botón para escribirle directo a {asesor}.»); quien ya es cliente (soporte) recibe «¡Claro! 😊 Toca el botón para escribirle directo a {asesor} y contarle lo que necesitas.»
  (antes le decían «cómo armarlo»); la pregunta de los rubros repetida tras algo que no es un rubro es «Para ayudarte mejor, ¿de qué rubro es tu negocio? 😊» (antes, la frase seca de siempre, siete veces seguidas ante una orden del cliente).
- **G. Revisión del PR #412 (código y seguridad):** el nombre que se muestra de vuelta se valida DESPUÉS de limpiarlo (NFKC, sin invisibles ni bidireccionales, sin `*_~` ni comillas): sin enlace ni teléfono armados al quitar marcas, y sin que el eco diga por el negocio una promesa, un monto, una oferta o una acreditación; si no pasa, «Quedó anotado.» (la ficha conserva el nombre). Una despedida o un acuse compuesto («Chau listo», «Hasta luego ok») ya no se anota como nombre: `ccNombreDeEmpresa` rechaza el texto hecho solo de palabras de acuse. `ccPreguntaHecha` nombra la variante que salió (con o sin planes). El acuse admite el tono de piel de un 👍.

## Más detalle y orientación comercial; sin nombre de persona (§15, 06/10/2026)

Resumen de lo que cambió (el contrato, §15, tiene las decisiones, la tabla de límites antes/después y el porqué):
- **Límites** en una sola fuente, `ccLimites()` de la librería: mensaje general 6 oraciones y 95 palabras; PLANES 7 y 110; empatía 2 oraciones, 220 caracteres y 34 palabras; `respuesta` del modelo 3 oraciones y 420 caracteres;
  `maxOutputTokens` 600. `construir.mjs` lee de la librería los topes de palabras del guion (`CC_MAX_PALABRAS_QUE_HACEMOS`, `_IMPACTO`, `_COMO_FUNCIONA`) y la regex de promesas.
- **La oferta tras el dolor** (`ccOferta`): empatía (modelo) + `orientacion` (`guion.rubros.<id>.queHacemos`) + `impacto` (Harvard, una vez por ficha: `impactoDicho`) + la pregunta de cierre (3 formulaciones con un porqué). `ccResolverModelo` pasa
  `orientacion` e `impacto` del rubro (el de «otro» si no tiene guion propio). El mensaje de PLANES lleva `comoFunciona` entre el resumen y el cierre (`ccPlanes(cfg, asesor, cierre, comoFunciona)`).
- **Variantes** (`ccVariante(e, clave, n, base)`): `rot` en la ficha (`saludo`, `rubros`, `traspaso`, `acuse`, `cierre`, `sinDatos`, `identidad`; enteros 0 a 11, saneados por `ccRotSaneada` con solo propiedades propias); se eligen en `ccMensajesDe`/`ccResolverModelo`
  (donde se escribe la ficha) y por eso «Confirmar envío» los restaura con `fichaAntes`. Vencen con la ventana salvo `rot.saludo`. El saludo parte del último dígito del teléfono (`ccUltimoDigito`).
- **Invitación sin pregunta** (`ccCierreSinPregunta`) cuando la pregunta de la oferta se omite tras una respuesta suelta, salvo si el prefijo ya ofrece al asesor («sin datos»).
- **«Un asesor»:** `asesor.nombre` vacío en `novuchat.json`; `validarDatos` acepta `asesor` ausente; `ccInicial` capitaliza al inicio de una oración; los `cierre` del guion dicen «un asesor».
- **Batería** (`bateria.mjs`, `bateria-casos.json`): casos `L1` (todo por escrito, sin botones), `L2` (cinco preguntas sueltas seguidas) y `L3` («ok» repetidos y acuses tras el traspaso); un teléfono sintético por caso y corrida
  (`telefonoDe`: 59100000010 a 59100000019, nunca el de recepción ni el del negocio); el informe mide las palabras por mensaje (media, mediana, máximo), los mensajes idénticos seguidos (0 esperado, cuenta como violación
  `mensaje_repetido_seguido`), las oraciones repetidas de un mensaje al siguiente (informativo: retomar la pregunta pendiente es a propósito) y las apariciones del dato de Harvard por conversación (hasta 1; más es `harvard_mas_de_una_vez`).
- **Mensajes por conversación: 0 agregados y 0 quitados.**
