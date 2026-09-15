# Rotar el secreto de ingesta de un número

**Versión 1 · 15-sep-2026.** Escrito a raíz del incidente del 15/09 (abajo, §6),
que obligó a rotar `INGESTA_CLIENTE01` sin que el proyecto tuviera un
procedimiento. No contiene secretos ni identificadores.

Cada número de WhatsApp tiene un **alias de ingesta** (`demoA`, `demoB`,
`cliente01`…`cliente20`) y un secreto propio en Secret Manager
(`INGESTA_DEMOA`, `INGESTA_CLIENTE01`…), declarado con `defineSecret` en
`admin/functions/src/firma.ts` (`SECRETOS_POR_ALIAS`). El mismo valor vive en
dos lugares y **tienen que coincidir**:

| Dónde | Qué | Quién lo lee |
|---|---|---|
| Secret Manager, `INGESTA_<ALIAS>` | La versión que la Function tiene **fijada** | `rutaAutenticada()` compara contra ella |
| n8n, credencial Header Auth «NovuChat ingesta (alias del número)» del flujo del cliente | `Authorization` = `Bearer <valor>` | Los nodos `Traer configuración`, `Reportar mensaje (entrante)` y `Reportar mensaje (saliente)` |

---

## 1. Lo que hay que saber antes de empezar

### 1.1 Agregar una versión NO tiene efecto hasta redesplegar

No es una suposición: está en el código de las dos piezas.

- **firebase-tools resuelve `latest` al desplegar y fija el número.**
  `lib/deploy/functions/validate.js`, `validateSecretVersions()`: línea 242 pide
  la versión `latest` a Secret Manager y la línea 265 la escribe como número
  (`s.version = …versionId`) en cada Function que declara el secreto. Leído en
  firebase-tools 15.27.0. El CI fija la 15.28.1, y
  `.github/DESPLIEGUE-FIREBASE.md` («Estado real») documenta el mismo recorrido
  por `params.ts` y `validate.ts` en esa versión.
- **La Function no consulta Secret Manager.** `SecretParam.value()` lee
  `process.env[nombre]` (firebase-functions 6.6.0,
  `lib/params/types.js`, líneas 272-291). Esa variable la inyecta la plataforma
  al arrancar cada instancia, **con la versión fijada en el despliegue**.

Consecuencia: después de `gcloud secrets versions add`, las instancias que
arrancan **siguen recibiendo la versión vieja**, hoy, mañana y hasta el próximo
despliegue de Functions. Eso es lo que hace segura la preparación (se puede
crear la versión con calma) y lo que obliga a redesplegar para cerrar la
rotación. (El comentario de `firma.ts` sobre la reserva de alias dice que las
instancias «siguen con la versión vieja hasta reciclarse». Es más estricto que
eso: siguen con ella hasta el próximo despliegue. La conclusión de ese
comentario, no crear versiones en el alta, vale igual y con más razón.)

### 1.2 Redesplegar la misma etiqueta alcanza, y no hace falta código nuevo

firebase-tools se salta las Functions «sin cambios» comparando un hash
(`lib/deploy/functions/release/planner.js`, líneas 27-31). **Ese hash incluye
la versión de cada secreto**: `cache/hash.js`, `getSecretsHash()` (líneas
17-19), sobre `getSecretVersions()` de `lib/functions/secrets.js` (líneas
133-137). Y se calcula **después** de fijar la versión nueva: en `prepare.js`,
`secretsAreValid` (línea 340) va antes que `applyBackendHashToBackends`
(línea 346). Por lo tanto, redesplegar la etiqueta que ya está en producción
actualiza exactamente las Functions que declaran el secreto:

`ingesta`, `configuracionFlujo`, `registrarCierre`, `enlaceCatalogo` y
`checkoutCatalogo`. Las cinco declaran `secrets: Object.values(SECRETOS_POR_ALIAS)`.

Qué implica ese redespliegue en este proyecto:

- Se lanza desde **Actions → «CI/CD Node → Firebase» → Run workflow**
  (`workflow_dispatch`), con `destino=produccion`, `tag=<etiqueta en
  producción>` y `confirmar=DESPLEGAR`. **No hace falta crear una etiqueta
  nueva**, y `release.yml` no serviría: exige commits nuevos desde la última.
- El job `desplegar-produccion` verifica que la etiqueta exista, no sea
  prerelease y sea ancestro de `main`, y que quien lo lanza esté en
  `vars.APROBADORES_PROD`. Después **espera la aprobación del revisor del
  Environment `production`**.
- Despliega todo lo de `FIREBASE_DEPLOY_ONLY` (hosting, reglas, índices y
  Functions), con el mismo código. Hosting y reglas quedan iguales.
- **Re-fija TODOS los secretos a su `latest`**, no solo el que se rota. Si otro
  `INGESTA_*` o `GEMINI_API_KEY` tiene una versión nueva a medio preparar, entra
  también (paso 2 de §3).
- El pipeline **nunca ve el valor**: la cuenta de despliegue tiene el rol
  `desplegadorSecretos`, sin `versions.access`.

### 1.3 Hoy el servidor acepta UN solo valor por alias: hay un corte breve

`rutaAutenticada()` compara contra un único `secreto.value()`, y n8n manda un
único valor. Entre el momento en que las Functions pasan a la versión nueva y el
momento en que una persona pega el valor nuevo en n8n, las llamadas de n8n
reciben 401. Si se pega antes del despliegue, el corte es igual de largo pero en
el otro sentido, y encima dura lo que tarde la aprobación. **Por eso el orden es:
preparar la versión, desplegar, y pegar en n8n apenas terminan las Functions.**

Qué se pierde durante el corte, y por qué es tolerable. Los tres nodos que usan
la credencial tienen `onError: continueRegularOutput`
(`Flujos/novuchat-onboarding.json`), así que **el cliente final sigue
recibiendo respuesta**:

- `Traer configuración` falla y el flujo sigue con el respaldo de `Config base`.
  Si la consola cambió algo reciente, se pierde; los umbrales de atención no se
  aplican en esos minutos.
- `Reportar mensaje` falla y **esos mensajes no se cuentan** (conversaciones y
  bloques de 25). Es facturación que se pierde, no un error visible.

Las cinco Functions no se actualizan en el mismo segundo. Durante unos minutos
puede haber una con la versión nueva y otra con la vieja. Es inevitable sin el
cambio de §5.

---

## 2. Cuándo rotar

| Disparador | Urgencia |
|---|---|
| **El valor salió de Secret Manager y de la credencial de n8n**: un pedido a otro host (el incidente de §6), un log, una captura, un chat, un archivo versionado | El mismo día |
| **Baja de un cliente** o **liberación de su número**, antes de reasignar el alias a otro comercio | Antes de reasignar. Si no, el flujo del cliente anterior sigue teniendo una clave válida para el alias |
| **Sale alguien con acceso a n8n** o al proyecto de producción | En la semana |
| **Sospecha sobre la instancia de n8n** (acceso no explicado, respaldo de credenciales perdido) | Todos los alias, el mismo día, en un solo despliegue (§3, «varios alias») |
| **Rutina: cada 12 meses** | Programada, en horario de poco tráfico |

Por qué 12 meses y no menos: cada rotación cuesta una aprobación de despliegue y
unos minutos de corte (§1.3), y el valor solo vive en Secret Manager y en el
almacén cifrado de credenciales de n8n. Una rotación más frecuente no compra
casi nada mientras esas dos cosas se mantengan.

---

## 3. Procedimiento

**Regla:** el valor lo lee o lo pega **una persona**. Un agente puede preparar
comandos y correr los que solo leen **metadatos** (versiones, estados, qué
versión tiene fijada cada Function), pero **nunca** `gcloud secrets versions
access`, y nada que escriba sin confirmación en el momento
(`.claude/hooks/acciones-sensibles.sh`).

| # | Paso | Quién |
|---|---|---|
| 0 | Corregir la causa, si hubo fuga | persona + agente `flujos-n8n` |
| 1 | Sesión con las credenciales aisladas | persona |
| 2 | Revisar versiones y qué fija cada Function | persona (o agente, solo metadatos) |
| 3 | Crear la versión nueva sin mostrarla | persona |
| 4 | Comprobar su forma sin mostrarla | persona |
| 5 | Redesplegar la etiqueta en producción | persona que lanza + revisor de `production` |
| 6 | Pegar el valor en n8n | persona |
| 7 | Verificar | persona + agente |
| 8 | Deshabilitar la versión vieja; destruirla a los 7 días | persona |

### Paso 0 — Si hubo fuga, cortar la causa primero

Rotar sin corregir la causa hace que el valor nuevo salga por el mismo lado. En
el incidente de §6 la causa fue la asignación de credenciales al importar.
Antes de seguir, confirmar que ningún nodo que llama a `graph.facebook.com` usa
la credencial de ingesta:

```bash
cd "$HOME/NovuChat" && ./scripts/publicar-flujo.sh --flujo Flujos/<flujo>.json --env .env.<cliente>
```

Sin `--aplicar` solo informa. Si aparece «credencial corregida» sobre un nodo de
Graph, el flujo vivo sigue mal: aplicarlo (con confirmación) antes de rotar.

### Paso 1 — Credenciales aisladas

En una terminal nueva, que no se comparte con otras sesiones:

```bash
unset CLOUDSDK_ACTIVE_CONFIG_NAME
export CLOUDSDK_CONFIG="$HOME/.config/gcloud-novuchat-prod"
PROYECTO=<proyecto de producción, tabla §0 de CONFIGURACION.local.md>
export SECRETO=INGESTA_<ALIAS> # p. ej. INGESTA_CLIENTE01; exportado: el bucle del paso 2 lo lee
```

`HISTCONTROL=ignorespace` no hace falta: ningún comando de abajo lleva el valor
en la línea.

### Paso 2 — Estado de partida (solo metadatos)

```bash
gcloud secrets versions list "$SECRETO" --project "$PROYECTO" \
  --format='table(name.basename():label=VERSION,state,createTime)'

for f in ingesta configuracionFlujo registrarCierre enlaceCatalogo checkoutCatalogo; do
  printf '%-20s ' "$f"
  gcloud functions describe "$f" --gen2 --region us-east1 --project "$PROYECTO" --format=json \
    | python3 -c 'import json,sys,os; d=json.load(sys.stdin); print({s["key"]: s.get("version") for s in d.get("serviceConfig",{}).get("secretEnvironmentVariables",[])}.get(os.environ["SECRETO"]))'
done
```

Lo esperado es que la
versión más alta de la lista y la fijada en las cinco Functions **sean la
misma**. Si la lista tiene una versión más nueva que la fijada, alguien dejó una
rotación a medio hacer: averiguar cuál antes de seguir, porque el despliegue del
paso 5 la va a activar.

**Revisar lo mismo para los demás secretos que el despliegue re-fija.** Basta
con comparar la versión más alta de cada `INGESTA_*` y de `GEMINI_API_KEY`
contra lo que muestra `describe` para `ingesta` (sin el filtro por clave).

### Paso 3 — Crear la versión nueva sin que aparezca en pantalla

```bash
openssl rand -hex 32 | tr -d '\n' \
  | gcloud secrets versions add "$SECRETO" --data-file=- --project "$PROYECTO"
```

El valor va de `openssl` a Secret Manager por la tubería: no pasa por la
pantalla, ni por el historial, ni por un archivo. La salida es solo
`Created version [N] of the secret [...]`. **Anotar N.**

**El `tr -d '\n'` no es cosmético.** `openssl rand -hex` termina con un salto de
línea. `tokenValido()` recorta la cabecera que llega, pero **no** el secreto
guardado, y un secreto con salto de línea no coincide nunca: 401 en todas las
llamadas, idéntico al de una clave equivocada.

Desde acá, `latest` es N. Las Functions siguen con la versión anterior (§1.1):
todavía no cambió nada en producción.

### Paso 4 — Comprobar la forma, sin ver el valor

```bash
gcloud secrets versions access N --secret="$SECRETO" --project "$PROYECTO" | wc -c
```

Tiene que decir **64**. Si dice 65, tiene salto de línea: crear otra versión
(paso 3 bien hecho) y usar esa. **No deshabilitar ni destruir la mala**: lo que
arregla es la versión nueva, porque firebase-tools exige que `latest` —la
versión **creada más recientemente**, esté como esté— esté habilitada
(`validate.js`, línea 251). Una `latest` deshabilitada rompe **todo**
despliegue de Functions.

### Paso 5 — Redesplegar la etiqueta que está en producción

Averiguar cuál es: la última con despliegue exitoso a `production` (Actions →
Deployments, o `gh release list --repo segurolotengopy/NovuChat --limit 3` y
cruzarlo con Deployments). **Tiene que ser la que está viva**: otra etiqueta
cambiaría también el código.

Elegir una hora de poco tráfico para ese número y **tener lista la pantalla del
paso 6** antes de lanzar:

```bash
gh workflow run ci-node-firebase.yml --repo segurolotengopy/NovuChat \
  --ref <etiqueta> -f destino=produccion -f tag=<etiqueta> -f confirmar=DESPLEGAR
```

(o lo mismo desde la pantalla de Actions). Lo lanza alguien de
`vars.APROBADORES_PROD`, y lo **aprueba el revisor de `production`**. En el log
del paso «Desplegar hosting + reglas (producción)», firebase-tools informa cada
Function actualizada. Las que importan para n8n son `ingesta` y
`configuracionFlujo`.

### Paso 6 — Pegar el valor en n8n, sin verlo

Apenas el log muestre `ingesta` y `configuracionFlujo` actualizadas:

```bash
# Wayland (Ubuntu por defecto): sirve UN solo pegado y se borra solo
gcloud secrets versions access N --secret="$SECRETO" --project "$PROYECTO" \
  | wl-copy --trim-newline --paste-once
# X11:
# gcloud secrets versions access N --secret="$SECRETO" --project "$PROYECTO" \
#   | xclip -selection clipboard -loops 1
```

En n8n: **Credentials** → la credencial de ingesta de ese flujo («NovuChat
ingesta (alias del número)» en el de NovuChat) → campo **Value**: escribir
`Bearer ` (con el espacio) y pegar. Guardar. No hace falta volver a publicar el
flujo: la credencial se lee en cada ejecución.

Si hay un gestor de historial de portapapeles instalado, el valor queda ahí:
borrarlo de su historial.

### Paso 7 — Verificar

1. **Qué versión tiene fijada cada Function:** el bucle del paso 2. Las cinco
   tienen que decir N.
2. **Un mensaje real**, desde uno de los teléfonos registrados, al número del
   cliente. El asistente contesta. Eso por sí solo **no prueba nada**: contesta
   también con la ingesta en 401 (§1.3).
3. **La prueba de verdad es la ejecución:**

   ```bash
   cd "$HOME/NovuChat" && ./scripts/ver-ejecuciones.sh --env .env.<cliente> --n 3
   ./scripts/ver-ejecuciones.sh --env .env.<cliente> --id <id> --nodo "Reportar mensaje (entrante)"
   ./scripts/ver-ejecuciones.sh --env .env.<cliente> --id <id> --nodo "Traer configuración"
   ```

   Con `continueRegularOutput` la ejecución figura como correcta aunque el nodo
   haya recibido 401: hay que mirar la **salida del nodo**, no el estado de la
   ejecución. Un 401 aparece como un ítem con `error`. Lo correcto es la
   respuesta de la Function.
4. En la consola, el contador de conversaciones de ese comercio se movió con el
   mensaje de prueba.

### Paso 8 — Retirar la versión vieja

Con el paso 7 en verde, **ese mismo día**:

```bash
gcloud secrets versions disable <N-1> --secret="$SECRETO" --project "$PROYECTO"
```

Deshabilitar es reversible (`gcloud secrets versions enable …`) y no afecta a
las Functions, que ya tienen fijada la N. Desde ese momento el valor viejo ya
no sirve para arrancar ninguna instancia, tampoco una revisión anterior.

**A los 7 días**, si nada pidió volver atrás:

```bash
gcloud secrets versions destroy <N-1> --secret="$SECRETO" --project "$PROYECTO"
```

Destruir es **irreversible**. Nunca destruir ni deshabilitar la versión más
nueva (paso 4).

### Varios alias a la vez

Paso 3 y 4 para cada secreto, **un solo despliegue** (paso 5), y el paso 6 para
cada credencial. El despliegue re-fija todos juntos. Cada aprobación cuesta
horas, así que juntar rotaciones es ahorro real.

---

## 4. Vuelta atrás

| Situación | Qué hacer |
|---|---|
| Se creó la versión (paso 3) y se decide **no seguir** | Nada en producción cambió. Pero el próximo despliegue, por cualquier otro motivo, la activa y corta n8n. O se termina la rotación, o se neutraliza copiando el valor vigente a una versión nueva: `gcloud secrets versions access <N-1> --secret="$SECRETO" --project "$PROYECTO" \| gcloud secrets versions add "$SECRETO" --data-file=- --project "$PROYECTO"`. **No** deshabilitar la N (paso 4). |
| Después del despliegue, **n8n recibe 401 con el valor nuevo** | Casi siempre es el pegado: faltó `Bearer `, se pegó un espacio de más, o se pegó otra versión. Repetir el paso 6 con la versión N explícita. |
| Hay que **volver al valor anterior** | En n8n, pegar la versión N-1 (paso 6 con `<N-1>`; si ya se deshabilitó, `enable` primero). En Secret Manager, copiar N-1 a una versión nueva (comando de la primera fila) y **redesplegar** (paso 5). Mientras tanto hay corte: por eso la N-1 no se deshabilita hasta verificar. |
| El despliegue falla con «Expected secret … to be in state ENABLED» | Alguien deshabilitó o destruyó la versión más nueva de algún secreto. Crear una versión nueva y habilitada (paso 3, o la copia de la primera fila) y relanzar. |

---

## 5. Mejora posible: aceptar dos valores durante la rotación (no implementada)

**Qué resolvería:** el corte de §1.3. El servidor aceptaría la versión nueva y
la anterior a la vez, y n8n se podría cambiar en cualquier momento, sin
sincronizarse con el despliegue.

**Diseño, sin crear 22 secretos más.** El valor de la versión puede traer hasta
**dos claves separadas por un salto de línea**. La primera es la vigente y las
dos se aceptan:

- `admin/functions/src/firma.ts`: una función pura exportada
  `clavesDe(valor: string): string[]`, que parte por `\n`, recorta, **descarta
  las vacías** y se queda con dos como máximo. En `rutaAutenticada()`, la firma
  HMAC y `tokenValido()` se aceptan si coinciden con **alguna** de las claves.
  Cada comparación sigue en tiempo constante. Un valor de una sola línea, que es
  lo que hay hoy en los 22 secretos, se comporta igual que ahora: no hay
  migración.
- `admin/functions/src/catalogoWeb.ts`, `despertarFlujo()` (líneas 1032 y 1039):
  hoy manda `secreto.value()` entero como `Bearer` y como clave HMAC hacia el
  webhook de carrito de n8n. Tendría que usar **solo la primera** clave. Si se
  olvida, sale el par completo en una cabecera: es el defecto que hay que
  impedir con una prueba.
- Prueba nueva `admin/pruebas/firma.test.ts` (vitest, importando
  `../functions/src/firma.ts`, como ya hace `catalogo-web.test.ts` con su
  módulo). Para no depender de Firestore, extraer la comparación a una función
  pura (`credencialValida(peticion, claves, crudo)`). Escrita negando:
  - un valor que no es ninguna de las dos se rechaza, por token y por HMAC;
  - `"nueva\n\n"` **no** acepta una cabecera vacía ni `Bearer ` a secas;
  - una tercera línea se ignora;
  - una sola línea acepta exactamente lo que acepta hoy;
  - lo que sale de `despertarFlujo` es la primera clave, nunca el par.

**Cuánto cuesta:** unas 40 líneas de código y 60 de prueba, una o dos horas, y
un pase a producción con acta. Y **cada rotación pasa a necesitar dos
despliegues**: uno con `nueva\nvieja` y otro con `nueva` sola. La vieja sigue
siendo válida hasta el segundo, así que en un incidente ese segundo despliegue
tiene que salir el mismo día.

**Recomendación: no hacerlo todavía.** Hoy el corte cuesta unos minutos de
mensajes sin contar, sin que el cliente final lo note (§1.3). Duplicar las
aprobaciones por rotación cuesta más que eso. Conviene cuando haya comercios con
tráfico sostenido en todo horario, donde no exista una «hora de poco tráfico»,
o cuando algún flujo dependa de `configuracionFlujo` sin respaldo.

---

## 6. Primer uso: `INGESTA_CLIENTE01` (incidente del 15/09/2026)

**Qué pasó.** Al importar el flujo de captación de NovuChat
(`Flujos/novuchat-onboarding.json`), n8n asignó la credencial de ingesta
también a nodos que llaman a `graph.facebook.com` (en ese flujo son `Enviar a
WhatsApp`, `Enviar texto de respaldo` y `Avisar a NovuChat`). El valor de
`INGESTA_CLIENTE01` salió en tres pedidos a la API de Meta, que los rechazó con
el error 190. Riesgo bajo: el destino fue Meta, por TLS, y el valor solo sirve
para escribir mensajes y conteos del número de NovuChat en la ingesta. Pero
salió del perímetro, y se rota.

**Causa corregida** en el commit `8a0079a`: `publicar-flujo.sh` asigna a cada
nodo la credencial que **nombra** el JSON versionado.

**Pasos concretos** (alias `cliente01`, número de NovuChat, env `.env.novuchat`):

1. Paso 0 con `--flujo Flujos/novuchat-onboarding.json --env .env.novuchat`:
   ningún nodo de Graph con «NovuChat ingesta (alias del número)».
2. Paso 1 con `SECRETO=INGESTA_CLIENTE01`, y `export SECRETO`.
3. Paso 2: anotar la versión vigente (V) y confirmar que las cinco Functions la
   tienen fijada y que ningún otro secreto tiene versiones pendientes.
4. Paso 3: crear la versión V+1. Paso 4: `wc -c` = 64.
5. Paso 5: redesplegar la etiqueta viva, en horario de poco tráfico para el
   número de NovuChat.
6. Paso 6: pegar V+1 en «NovuChat ingesta (alias del número)».
7. Paso 7 con `--env .env.novuchat`: un mensaje desde un teléfono registrado, y
   la salida de `Traer configuración` y `Reportar mensaje (entrante)` sin 401.
8. Paso 8: deshabilitar V ese día y destruirla el 22/09 o después.
9. Anotar en `ESTADO.md` la fecha y la versión vigente (el número de versión,
   nunca el valor).
