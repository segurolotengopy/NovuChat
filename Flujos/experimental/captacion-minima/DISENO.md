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
| `admin/scripts/datos/captacion-minima/{novuchat,ensayo}.json` | Datos del tenant (zona Tenants): solo marcadores `REEMPLAZAR_*` para identificadores, el guion y el corpus |
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
   comunes) y `@@solo:` (solo el archivo). **Quien use `ccLeerModelo`, `ccLista`, `ccOferta`, `ccPlanes`, `ccTraspaso`, `ccFijo`,
   `ccCompletar` o `ccDecidir` pega `+mensajes+filtro`**: las usan al ser llamadas, no al cargarse.
4. Inyección: la línea `const CM_GUION = null; // @@guion` (en «Config del negocio») y `const CM_CONOCIMIENTO = null; // @@conocimiento`
   (en «Decidir turno») se reemplazan por el literal del archivo de datos; cada una tiene que aparecer EXACTAMENTE una vez.
5. Guardias (sobre lo armado y sobre lo versionado): «Entrada de prueba» nunca en producción; «WhatsApp Trigger» nunca en la prueba y con
   credencial explícita que no coincida con `/aab1|wa-prod/i`; ni `subscriptions` ni `subscribed_apps`; anfitriones HTTP
   `graph.facebook.com`, `generativelanguage.googleapis.com` y `us-east1-novuchat-demo.cloudfunctions.net`, y solo dos URL por
   expresión («Descargar medio» y «Guardar prospecto»); ningún `agent`, memoria ni `lmChat*`; retención `none`, `executionOrder: v1` y
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
| Armar mensajes | Decidir turno, Llamar al modelo, Comercio no operativo, Uso extendido, la ficha | **un ítem por mensaje**: `para` (número destino), `destino` (`cliente`/`recepcion`), `payload`, `texto`, `respaldo`, `tipoReporte`, `evento`, `esInteractivo`, `esAviso`, `marcaAvisado`, `reportar`, `phoneNumberId`, `waGraphVersion`, `from`, `sinMensajes`. **Solo el primero** trae además `resumen`, `guardarPlanilla`, `prospectoPlanilla`, `guardarCrm`, `crmUrl`, `cuerpoCrm`. Sin mensajes (bloqueado sin aviso): un ítem `sinMensajes:true` |
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

`$getWorkflowStaticData('global').captacionMinima[<messages[0].from>]`, clave `^\d{6,20}$` (§4 del contrato). **Un solo escritor:** «Armar
mensajes» (la ficha completa, el id de Meta, `ultimoMensajeMs` y el barrido de las de más de 48 h, con tope de 5.000). «Confirmar envío»
escribe solo `avisado` y `avisoFalla` con lo que contestó Meta. «Interpretar entrada» y «Decidir turno» solo leen. Una ficha ilegible se
sanea campo por campo (`ccEstadoVigente`); `conversaciones` (la del flujo viejo) no se lee ni se toca.

## Firmas que precisé respecto del contrato

- `ccPideAsesor(t, campanas?)`: devuelve false si el texto es el de una campaña.
- `ccCampana` devuelve `{id, texto, destino?}`; un `destino` fuera de `rubro:<id>`, `planes`, `asesor` se descarta.
- `ccLeerToque(id, rubros)`: `rubro:otro` y el rubro «a medida» de la consola dan `{tipo:'otro', id:'otro'}`; un id que ya no existe, `{tipo:'vencida', id}`.
- `ccRubroPorNombre` devuelve el id, `'otro'` o `''`. `ccUnaPregunta(t)` es booleana. `ccRubroLibreValido(v, textos)` devuelve el texto limpio o `''`.
- `ccEsIdentidad` solo ve mensajes de hasta 10 palabras (una orden con «eres una persona» dentro de un texto largo va al modelo).
- `ccDescarteAceptado({descarte, via, hechos, soporte, textoCliente})`; `via`: `texto`, `audio` o `campana`; el resto se rechaza.
- `ccCuerpoModelo` recibe además `rubro` y `conocimiento`; `ccLeerModelo` además `nombreNegocio`, `asesor` y `aclaraciones:[{id,texto}]`, y devuelve `motivo` (`vacio`, `json`, `esquema`).
- «Otro / a medida» es una fila fija `rubro:otro`; los rubros «a medida» de la consola se descartan de la lista y del esquema.
- Límites nuevos del contrato: `empatia` ≤100 caracteres; `impacto` ≤160 caracteres y ≤20 palabras. La oferta máxima real mide 44 palabras
  y 3 oraciones (con palabras de longitud normal: 92 caracteres de empatía, 121 de impacto y la pregunta fija de 9 palabras).
- Funciones nuevas: `ccDecidir`, `ccCompletar`, `ccCuerpoLista`, `ccTituloAsesor`, `ccTituloDeFila`, `ccFijo`, `ccRetomar`, `ccPreguntaDelPaso`, `ccGuionDe` y las
  ayudas `ccAplicarRubro`, `ccAplicarPlanes`, `ccPedirPlanes`.
- `ccProspecto` agrega `consulta` («Quiere hablar con una persona», «Pidió los planes»): sin ella, «Decidir fila de la planilla» (copia exacta) no
  reescribe el resumen de quien ya tenía uno («Descalificado») cuando sube a Alta y no tiene rubro.

## Decisiones del diseño que el contrato no fijaba

- **Mensajes del flujo propios del código** (fijos, en tuteo, sin nombre de comercio): «Ya te mostré los planes. ¿Quieres hablar con {asesor}?» (un segundo
  pedido de planes no los repite), el texto de cada descarte, el de comprobante, el de medios ilegibles y el de falla.
- **Empresa:** mientras el cliente no diga un nombre válido el paso sigue en `esperando_empresa` (el nombre se anota cuando llegue); lo que se repregunta
  UNA sola vez es la pregunta.
- **Un toque no es texto:** un id de lista o de botón con forma rara no elige nada ni llama al modelo; el paso se repite.
- **Un modelo que dice `pide_planes`** solo lleva a los planes si el texto también los pide por palabra entera; `pide_asesor` ofrece el botón, no el traspaso.
- **En la variante de prueba** la planilla también se escribe (si «Config base» trae un id válido); no se reporta nada a la ingesta; todo va al teléfono de prueba.
- `Armar mensajes` escribe la ficha antes de que Meta conteste; si Meta rechaza el mensaje, «Confirmar envío» corta la ejecución pero la ficha ya avanzó.

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
- **Retención `none` (D13):** pendiente de ratificar por Andres antes de publicar.
- Cargar `impacto` por rubro (hoy vacío) y los identificadores reales en una copia `*.local.json` (ignorada por git).
- `cmLista` (común) manda `description: ''` en las filas sin descripción; `ccLista` evita la clave. Revisar `cmLista` antes de que otro flujo la use.
- La plantilla `solicitud_contacto` debe estar aprobada en el WABA del tenant (seis parámetros).
- Probar contra un teléfono real y ensayar en el número del Demo A antes de publicar.
