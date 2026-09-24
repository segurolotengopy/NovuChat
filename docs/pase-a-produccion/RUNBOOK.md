# Pase de un comercio de PRUEBA a PRODUCCIÓN, con la activación del prepago

**Versión 1 · 22-sep-2026.** Pedido de Andres: «un procedimiento de pase de
PRUEBA a PRODUCCIÓN de un cliente determinado y, como parte de ese proceso, que
se active el prepago». Hoy ningún comercio es real: todos son demo o prueba.
Este documento fija el camino para el primero que pague, y se aplica a cada
cliente en su `CLIENTES/<NOMBRE>/pase-a-produccion.md` (carpeta no versionada).

Es la **etapa siguiente a la aceptación** del alta
(`docs/alta-cliente/RUNBOOK.md`, etapa 6). **No confundir** con la etapa 7 del
alta ni con la skill `pase-a-produccion`: esas son el pase *de una versión del
código* (acta, etiqueta, Environment `production`). Esto es el pase *de un
comercio*: del modo de prueba al servicio que se cobra.

No contiene secretos ni identificadores. **Costo en mensajes del procedimiento: 0**
por conversación (ver §9).

---

## 0 · Qué significa PRUEBA y PRODUCCIÓN, y quién nunca pasa

| Lo que ve el comercio en el encabezado de la consola | `cuenta/estado.modalidad` | Qué pasa con su servicio |
|---|---|---|
| **PRUEBA** | `demostracion` (o ausente) | Sin cargo, sin cobranza, nunca se corta |
| **PRUEBA** | `prueba` | Un mes (`periodoPrueba`) con una bolsa de 20 conversaciones; sin cobranza, solo el aviso de conversión |
| **PRODUCCIÓN** | `prepago` | Pagó al menos una mensualidad (`periodoPagado`); recibe la cobranza; se corta por falta de pago **solo si el corte está encendido** |

La regla del encabezado es una sola: **PRODUCCIÓN ⇔ `modalidad === 'prepago'`**.
La está construyendo otro agente (rama `consola/encabezado-comercio-y-modo`); la
consola no calcula nada, lee la modalidad. Y `modalidad: 'prepago'` **solo la
escribe un pago confirmado** (`aplicarPago`), o una decisión explícita de Andres
con `migrar-prepago.mjs` (§3.5). No hay otra forma de «pasar a producción».

**Nunca pasan a producción** (el script de §1 sale con código 3 y lo dice):

- **Demo A y Demo B** (`plan: 'demostracion'`): son los números de prueba de Meta,
  solo responden a 5 destinatarios registrados (`CLAUDE.md`, prohibición 6) y
  sirven para las demos comerciales y para el ensayo (`docs/ensayo/LEEME.md`).
- **`novuchat`**: el número de captación de la propia NovuChat. No es un comercio
  que paga: queda en demostración. `migrar-prepago.mjs` lo rechaza por nombre.
- **`ensayo`**: el comercio del ensayo, que vive en el número del Demo A.

---

## Etapas y quién hace qué

**Andres autoriza; Claude opera.** Cada escritura la corre Claude después del
«sí» de Andres en el chat, y reporta el resultado real. Lo único de Andres es lo
que el sistema exige a una persona: una pantalla de Meta, un teléfono, el
Environment `production`, una etiqueta, una sesión de propietario en la consola.

| Etapa | Qué | Quién | Puerta que escribe |
|---|---|---|---|
| 1 · Precondiciones | El comercio, el plan, el número, la configuración, el flujo y la aceptación | Claude lee y diagnostica | `pase-a-produccion.mjs` (solo lectura) |
| 2 · Canal | Número real, WABA del comercio, plantillas aprobadas | persona en Meta, guiada; Claude corre los scripts | los del PR #148 (§2) |
| 3 · Activación del prepago | Prueba → primer pago → prepago | admin del comercio (teléfonos, pagar); propietario (pago manual); Claude (TCO, prueba) | `migrar-prepago.mjs`, `fijar-tipo-cambio.mjs`, `fijarTelefonosPago`, `crearCobroPrepago`, `registrarPagoManual` |
| 4 · Observación | Un ciclo de cobranza completo con el corte apagado | Claude mira; nadie escribe | — |
| 5 · Corte en este comercio | Encender el corte solo en él | **decisión de Andres**; propietario en la consola | `fijarCortePrepago` con `tenantId` |
| 6 · Comunicación | Lo que se le dice y se firma con el comercio | Andres (y Silvana en el material) | — |

---

## 1 · Precondiciones: el diagnóstico, leído entero

```bash
cd <worktree>/admin
node scripts/pase-a-produccion.mjs --proyecto <proyecto> --tenant <id> \
  --aceptacion ~/NovuChat/CLIENTES/<NOMBRE>/aceptacion.md
```

- **Solo lectura.** No tiene `--aplicar` y lo rechaza. No imprime secretos ni
  datos personales: de números, WABA y teléfonos, solo los últimos 4.
- `<proyecto>` es el de la consola: el `quota_project_id` de las credenciales de
  `~/.config/gcloud-novuchat-prod`, **no** `${GCP_PROJECT_ID}` (que es el de los
  demos). Se lee con `grep`, sin copiarlo a ningún documento.
- Cada línea es `✓` (se cumple), `✗` (falta) o `·` (lo mira una persona: Meta,
  n8n, un teléfono). Al final dice **en qué etapa está el pase** (1 a 4 de este
  documento). Salida 0 = todo lo que ve se cumple; 1 = falta algo; 3 = este
  comercio no pasa nunca.
- Probado contra el emulador en `admin/pruebas/pase-a-produccion.test.ts`
  (listo, sin plan, demo, `novuchat`, marcadores y supuestos, WABA compartida,
  en prueba, corte encendido sin precondiciones, sin TCO, aceptación a medias).

| Precondición | Qué mira el script | Si falta, se arregla con (primero en seco, leído entero) |
|---|---|---|
| **Comercio activo** con sus flujos | `tenants/{id}.estado`, `flujos` | `reactivarTenant` (consola del propietario) |
| **Plan del catálogo** con su copia de límites | `cuenta/estado.plan`, `limites` = `limitesDe(plan)` | `asignar-plan.mjs --plan <impulso\|crecimiento\|pro>` |
| Agendas y productos **dentro del plan** | funcionarios activos, catálogo | subir de plan, o dar de baja en la consola. El tope de agendas **todavía no lo hacen cumplir las reglas** (`CLAUDE.md` §7): lo mira este script |
| **Umbrales** coherentes | `umbralesDeAtencion` | `fijar-umbrales.mjs` (o dejar los de respaldo 50 / 100) |
| **Número** con ruta activa, alias `clienteNN`, flujo de la ficha, sin ensayo | `rutasWhatsApp` | `asignar-numero.mjs` (y `ensayo.mjs --restaurar` si quedó desviada) |
| **WABA exclusiva** del comercio | ninguna otra ruta comparte `wabaId` | §2 |
| `config/negocio` con nombre y **recepción válida** | `numeroRecepcion` de 8 a 15 dígitos | `cargar-negocio.mjs` desde `main` |
| **Sin marcadores** `REEMPLAZAR_` ni datos «supuesto» | todos los textos de `config/negocio` y `config/{flujo}` | confirmar con el comercio, corregir `admin/scripts/datos/negocio-<id>.json` en un PR, recargar desde `main` |
| **Comportamiento vigente** = propuesto | `instruccionesVigentes` | `verificarComportamiento` (consola) o `migrar-instrucciones.mjs` |
| **Flujo versionado** que manda `telefono` a `Traer configuración` | `Flujos/<id>-*.json` | el flujo del cliente sale de su JSON (`CLAUDE.md`, «Nunca editar a mano el flujo de un cliente») |
| **Datos versionados sin supuestos** | `admin/scripts/datos/negocio-<id>.json` sin `_supuestos` ni notas «SUPUESTO» | un PR con lo que confirmó el comercio |
| **Aceptación completa**, con teléfono real y resultado real | la columna «Resultado real» de `CLIENTES/<NOMBRE>/aceptacion.md` sin celdas vacías | correr lo que falta, con dos teléfonos, y anotar lo que pasó, no lo esperado |

Lo que el script **no puede ver**, y confirma una persona antes de seguir (sale
como `·`):

- el **flujo publicado en n8n es el de `main`**: `publicar-flujo.sh --env
  .env.<cliente>` en seco, leído entero, sin diferencias. Una rama publicada sin
  fusionar, o una fusión sin publicar, deja el repositorio y producción
  diciendo cosas distintas (memoria «publicar solo desde main»);
- el número es **el real del comercio**, `CONNECTED` (`registrar-numero.sh
  --estado`), y no el de prueba de Meta;
- las **plantillas de utilidad que el flujo usa**, `APPROVED` en la WABA del
  comercio (`listar-plantillas.sh --env .env.<cliente> --detalle`, con el número
  de variables que el flujo manda: si no calzan, `#132000` en producción);
- **método de pago y alerta de gasto** en la WABA;
- el administrador revisó en la consola recepción, horario, catálogo y trato;
- **el candado contra la doble reserva**, probado contra un teléfono real
  insistiendo sobre una hora ocupada (regla mandatoria del 17/09). Sin esa fila
  en la aceptación, un comercio de reservas no pasa.

---

## 2 · El canal: número real y WABA del comercio

**No se rehace: se reutiliza el procedimiento del PR #148** («pase de un cliente
a su propia WABA, y el ensayo antes de producción»). Su aplicación completa a un
cliente está en `CLIENTES/PLATINUM/pase-a-produccion-waba-propia.md`, que sirve
de modelo para cualquier otro:

| Caso del comercio | Qué se hace |
|---|---|
| Número real **en su propio portafolio** (así se dio de alta) | Nada que mover. Confirmar que el dueño es administrador del portafolio y que la WABA tiene su método de pago |
| Número real **en el portafolio de NovuChat** | Camino B del documento de Platinum: baja en la Cloud API de NovuChat (`registrar-numero.sh --dar-de-baja`), alta en la WABA del comercio, entorno nuevo (`configurar-cliente.sh`, que conserva los datos del flujo), `registrar-numero.sh --registrar`, credenciales de n8n sin mostrar valores (`actualizar-credenciales-cliente.sh`), webhook (`webhook-meta.sh`), ruta con el mismo alias (`asignar-numero.mjs --reemplaza`), flujos desde `main`, plantillas de nuevo. Camino A (migración oficial) solo con los dos portafolios verificados |
| Número **de prueba de Meta** | No pasa. Primero un alta real (`docs/alta-cliente/RUNBOOK.md`, etapas 1 a 6) |
| El chat **cambia de número y de portafolio**, operado por NovuChat como **Tech Provider** (la app de AAB1 sobre la WABA del comercio, compartida como socio) | El mismo camino B, **sin baja ni alta de número**: el viejo se queda y la app vieja se desuscribe de su WABA (`verificar-meta.sh --desuscribir`). **Una app tiene una sola URL de webhook**, y la app Tech Provider (`AAB1-WA-Prod`) es también la de otro producto (prohibición 5): su URL no se toca. El webhook va **a nivel de WABA** (`webhook-meta.sh --alta-waba`, `override_callback_uri`; `--ver-waba` lo muestra), y el flujo filtra por `phone_number_id` en `¿Es un mensaje?`: un evento de otro número que entre por la app compartida no pasa. El token sale de un usuario de sistema propio, solo con esa app y esa WABA. La plantilla se vuelve a pedir con el mismo texto (`listar-plantillas.sh --texto` → `crear-plantilla.sh --encabezado/--pie`). Primer caso: el chat interno de NovuChat, 24/09/2026 (`CLIENTES/NOVUCHAT/traspaso-tech-provider.md`) |

**Si el portafolio queda en NovuChat** (decisión de Andres, por ejemplo mientras
el comercio no tenga Facebook de empresa), se anota en su `ficha.md` con la
consecuencia: la factura de Meta le llega a quien tenga el método de pago en la
WABA, y **el contrato tiene que decir quién le paga a Meta** (decisión 2 del
documento de Platinum). El script solo exige que la WABA no la comparta otro
comercio.

**Todo cambio que pida el comercio desde este momento se prueba primero en el
ensayo** (`docs/ensayo/LEEME.md`), nunca en su número.

---

## 3 · La activación del prepago

El orden importa: cada paso es precondición del siguiente.

### 3.1 [Claude, con el OK de Andres] La cuenta pasa a `prueba`

Un comercio sin modalidad **es demostración** para el servidor: no se le cobra
ni se le corta. El primer paso visible es la prueba:

```bash
node scripts/migrar-prepago.mjs --proyecto <proyecto> --tenant <id> --modalidad prueba   # seco, leído entero
node scripts/migrar-prepago.mjs --proyecto <proyecto> --tenant <id> --modalidad prueba --aplicar
```

- La prueba es el mes en curso de Bolivia (o `--periodo-prueba aaaa-mm`) con su
  bolsa de 20 conversaciones; sin cobranza, solo el aviso de conversión
  (`prueba_termina`) cuando esté A-4.
- Lo mismo hace `actualizarEstadoCuenta({ modalidad: 'prueba' })` desde la
  consola del propietario cuando exista su pantalla (A-3).
- Se niega con un comercio de plan `demostracion` (asignar el plan primero) y
  con `novuchat`.
- **Lo que ve el comercio:** el encabezado sigue diciendo **PRUEBA**.

### 3.2 [Admin del comercio] Los teléfonos de pago

`fijarTelefonosPago({ tenantId, telefonos })`: **los fija el administrador del
comercio** (o el propietario), hasta 5, solo dígitos con código de país,
auditados con sus últimos 4. Son los que recibirán la cobranza y, con A-4, los
únicos que podrán pagar por WhatsApp.

- **Se verifica cada uno con su titular** antes de dar el pase: una llamada o
  un mensaje desde ese número. Un teléfono equivocado manda la cobranza de un
  comercio a un tercero. La verificación automática del titular es
  precondición de A-4, no de esta callable.
- Por rol, no por número: el dueño o quien paga, y a lo sumo la administración.
  Nunca recepción si recepción no decide pagos.
- **Hoy ninguna pantalla la llama** (la edición en «Estado de cuenta» es de
  A-3). Mientras tanto el paso espera: no se escribe `telefonosPago` con un
  script, porque no existe esa puerta y no se crea una nueva.

### 3.3 [Claude, con el OK de Andres] El TCO del día

```bash
node scripts/fijar-tipo-cambio.mjs --proyecto <proyecto> --tco <valor del BCB> --fecha <aaaa-mm-dd> --por andres            # seco
node scripts/fijar-tipo-cambio.mjs --proyecto <proyecto> --tco <valor del BCB> --fecha <aaaa-mm-dd> --por andres --aplicar
```

Sin TCO vigente (más de 4 días, fuera de 5..40, fecha futura) **no se emite
ningún cobro**. El valor lo lee una persona del sitio del BCB; NovuChat no
publica un tipo de cambio propio (`CLAUDE.md` §3). Se carga el mismo día del
primer pago.

### 3.4 El primer pago: la cuenta pasa a `prepago`

Solo dos cosas confirman un pago (`admin/functions/src/pagos.ts`): **el banco**
o **el propietario con evidencia**. Un comprobante que manda el comercio por
WhatsApp es una imagen, y una imagen se edita.

| Camino | Cuándo | Quién | Qué queda |
|---|---|---|---|
| **QR del cobrador** (`crearCobroPrepago`) | Cuando el cobrador esté conectado: secretos `COBRADOR_*`, IAM, Scheduler, `plataforma/prepago.cobrador.baseUrl` y la pantalla «Pagar» (A-3). Lista de «Lo que espera a Andres», puntos 7 y 11 de `Prompts/COORDINACION.md` | el admin del comercio paga el QR desde su banco | `confirmadoPor.origen: 'banco'`, la única forma de un pago **de punta a punta** |
| **Manual** (`registrarPagoManual`) | Efectivo o transferencia, antes de que el cobrador esté conectado | **el propietario** (sesión de Google reciente), con `tcoAplicado`/`tcoFuente`/`tcoFecha`, `montoRecibidoBs`, referencia, y **evidencia en Storage** si es transferencia; `motivoDiferencia` si entró otro importe | `confirmadoPor.origen: 'propietario'`, auditado. Anula antes el QR vivo si lo hay |

En los dos, `aplicarPago` suma los meses, pone `modalidad: 'prepago'`, escribe
`periodoPagado` y recalcula los derivados. **Desde ese momento el encabezado
dice PRODUCCIÓN.**

- **El plan pagado pasa a ser el plan de la cuenta** («cambiar de plan es pagar
  el plan nuevo»): el plan del pago tiene que ser el que se acordó, y el
  diagnóstico de §1 se vuelve a correr después para ver la copia de límites.
- **El primer pago es una mensualidad**, no una bolsa: una bolsa comprada desde
  demostración también pasa la cuenta a prepago, pero sin `periodoPagado`: el
  comercio quedaría en PRODUCCIÓN sin ningún mes cubierto.
- **La instalación** (USD 65) va como pago aparte, `tipo: 'instalacion'`, si
  corresponde. No suma meses ni cambia la modalidad.
- **Hoy ninguna pantalla llama a `registrarPagoManual` ni a
  `crearCobroPrepago`** (A-3 está encolado). El paso espera a A-3. No se crea
  un script que registre pagos: el diseño exige sesión de propietario, TCO
  declarado y evidencia comprobada en Storage, y eso no se reproduce en un
  script sin volverlo una puerta sin auditoría.

### 3.5 La excepción: un comercio que ya pagó por fuera

Si un comercio pagó antes de que existieran los pagos del prepago, Andres puede
decidir migrarlo directo, con su último mes cubierto:

```bash
node scripts/migrar-prepago.mjs --proyecto <proyecto> --tenant <id> --modalidad prepago --periodo-pagado aaaa-mm   # seco
```

Es la vía que `admin/DISENO.md` §4undecies.2 reserva para «una decisión
explícita de Andres». Deja auditoría `migrar_prepago`, pero **no deja un pago**:
no cuenta como el «pago confirmado de punta a punta» del §5. Para un comercio
nuevo, el camino es §3.4.

---

## 4 · Observación: un ciclo entero con el corte apagado

Con `modalidad: 'prepago'`, el servidor ya calcula todo —vencimiento, gracia de
48 h, corte por falta de pago, conversaciones agotadas— pero **no corta**
mientras la bandera esté apagada (global y del comercio). Anota el corte con
`aplicado: false`, cuenta `perdidas` y `mensajesPerdidos` («lo que se habría
perdido»), deja auditoría `corte_observado` y **atiende igual**. El comercio no
ve un corte observado.

Lo que se mira durante un ciclo (un mes), sin escribir nada:

1. **Los recordatorios**: D-5 (`mensualidad_vence_pronto`) y D-1
   (`mensualidad_vence_manana`) marcados en `cuenta/estado.recordatorios` y
   **recibidos** en un teléfono de pago. Salen del número de NovuChat, por
   plantilla aprobada en su WABA (`docs/plantillas-cobranza.md` §7) y por el
   flujo programado de cobranza (A-4). **Hoy no existen ni las plantillas
   aprobadas ni ese flujo**: el ciclo no se puede observar todavía.
2. El **pago del mes siguiente** llega y se confirma (§3.4), y la cuenta queda
   al día sin intervención.
3. Si no paga a tiempo: la fase `gracia` y el corte observado aparecen en el
   diagnóstico con la fecha correcta (día 3 a las 00:00 de Bolivia).

El script de §1 da el ciclo por visto cuando hay marca de D-5 y de D-1 del mismo
mes. Lo demás lo confirma una persona y se anota en `CLIENTES/<NOMBRE>/estado.md`.

---

## 5 · Encender el corte, solo en este comercio

**Es una decisión de Andres, con motivo, no una operación.** Precondiciones, todas:

- `modalidad: 'prepago'` por un **pago confirmado de punta a punta** (por el
  banco, §3.4);
- **un ciclo de recordatorios observado** (§4);
- **teléfonos de pago** fijados y verificados con su titular;
- **todos los flujos publicados del comercio mandan `telefono` a
  `Traer configuración`** (lo mira el script en el JSON versionado; que lo
  publicado sea igual a `main`, el seco de `publicar-flujo.sh`);
- el comercio **sabe** que el corte existe y cómo se evita (§6).

Se enciende con la callable `fijarCortePrepago({ corteActivo: true, motivo,
tenantId })`, propietario, con motivo de al menos 10 caracteres. Deja historial
en `plataforma/prepago/historial` y auditoría `corte_prepago` en el comercio.
**No hay script con `--aplicar` para esto, a propósito** (`index.ts`, «es una
decisión, no una operación»). El botón es de la franja del propietario en
`Tenants.tsx` (A-3); hasta entonces el paso espera.

Después de encenderlo: el script de §1 tiene que decir `corte APLICADO (tenant
encendido, global apagado)` y la etapa 4. **Si dice «SIN sus precondiciones»,
se apaga.**

El **corte global** (`fijarCortePrepago` sin `tenantId`) es otra decisión, para
toda la plataforma, y va después (`Prompts/COORDINACION.md`, punto 12).

---

## 6 · Lo que ve el comercio y lo que se le dice

**En la consola:** el encabezado con su nombre y **PRUEBA** o **PRODUCCIÓN**
(§0), «Estado de cuenta» con plan, estado de pago, próximo vencimiento, el
consumo contra las conversaciones del plan y el aviso del 80 %. Un corte solo si
está aplicado.

**Lo que se le dice, y va en el contrato** (misma frase que el sitio y la
consola, `CLAUDE.md` «Base comercial» §2 y §3):

- **La unidad es la conversación:** hasta 25 respuestas del asistente a un
  mismo teléfono en una ventana fija de 24 h; la 26 abre otra conversación. El
  asistente no se corta a las 25.
- El **plan**, en dólares, que se cobra en bolivianos al TCO del BCB del día del
  pago; la **bolsa** (30 conversaciones por USD 10, no vencen) — se llama
  «bolsa», nunca «excedente».
- **Es prepago:** el mes se paga por adelantado; vence el último día del mes
  pagado; hay 48 h de gracia; después, si el corte está encendido, el asistente
  deja de atender y quien escribe recibe un mensaje neutro con el teléfono del
  comercio (nunca dice «pago» ni «deuda»).
- **Quién le paga a Meta**, si la WABA está en su portafolio (§2).
- Los umbrales de uso extendido (50 / 100 respuestas en la ventana) se muestran
  en «Estado de cuenta»; no hace falta publicarlos.

**Lo que NO se promete, porque no está hecho:** pagar por WhatsApp (A-4); el
QR del cobrador mientras no esté conectado; la ventana gratuita de las
conversaciones que nacen de un anuncio; más de 10 agendas; y, en reservas, un
recordatorio de 24 h que el flujo del comercio no tenga.

---

## 7 · Cómo se deshace

| Qué | Cómo | Qué queda |
|---|---|---|
| **Apagar el corte** del comercio | `fijarCortePrepago({ corteActivo: false, motivo, tenantId })` | Vuelve a observación en el siguiente mensaje (`configuracionFlujo` no cachea); historial y auditoría |
| **Volver a PRUEBA** | `actualizarEstadoCuenta({ tenantId, modalidad: 'prueba' })` o `migrar-prepago.mjs --modalidad prueba` (seco primero) | Los pagos confirmados **no se borran**: un pago no se corrige, se compensa con otro asiento. `periodoPagado` queda escrito |
| **Sacarlo del prepago** | `migrar-prepago.mjs --modalidad demostracion` | Sin cargo ni corte; el encabezado dice PRUEBA |
| **Devolver el número** al portafolio de NovuChat | Rollback del camino B (`CLIENTES/PLATINUM/pase-a-produccion-waba-propia.md` §7) | Otra ventana de 30 a 60 min sin respuesta |
| **Un pago mal cargado** | No se anula un confirmado. Se registra la compensación y se anota el motivo | La auditoría de los dos |

Cada vuelta atrás se anota en `CLIENTES/<NOMBRE>/estado.md` con la fecha y el
motivo, igual que el pase.

---

## 8 · Por cliente

Cada comercio tiene su `CLIENTES/<NOMBRE>/pase-a-produccion.md` (no versionado:
lleva datos del comercio), con este procedimiento aplicado a su vertical, su
número, su WABA, sus nodos propios, el plan sugerido por su volumen, quiénes
serían sus teléfonos de pago (por rol) y la lista de pasos en orden con el
estado de cada uno. El de la propia NovuChat dice por qué **no** pasa.

---

## 9 · Costo en mensajes

| Parte | Mensajes | Quién los paga |
|---|---|---|
| El pase en sí (diagnóstico, prueba, TCO, pago, bandera) | **0** | — |
| Flujos del comercio | **0 agregados** por conversación: el corte reutiliza el 409 que ya manda la cortesía | — |
| Con el corte aplicado | **1** cortesía por mensaje entrante, desde el número del comercio, como una suspensión | el comercio (dentro de su franquicia), solo mientras está cortado |
| Cobranza (A-4, cuando exista) | 3 plantillas por ciclo sin corte, 5 con corte, 1 de conversión en prueba, 2 por pago por WhatsApp | **NovuChat**, desde su número y su franquicia (`docs/plantillas-cobranza.md` §3: ≈ 0,045 USD por comercio y mes sin corte, ≈ 0,07 con corte) |
| La aceptación de §1 | lo que anota cada fila de `aceptacion.md` | NovuChat |
