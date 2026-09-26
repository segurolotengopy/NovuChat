# Coordinación: la rearquitectura por capas (F-1 a F6, E y S)

> Tablero de la sesión **operadora** (`Prompts/rearquitectura-por-capas.md`),
> reescrito desde cero el 25/09/2026 para este frente. El tablero anterior
> (prepago y modularización, del 20 al 25/09) vive en la historia de git de
> este archivo; lo que seguía pendiente de él está en «Heredado» al final.
> Se actualiza en cada cambio de estado. Sin secretos ni identificadores.
> Fechas en absoluto. El plano es `Analisis/41-arquitectura-por-capas.md`.

**Base de trabajo:** `origin/main` en `941363e` (26/09/2026, con la
reorientación de #216; `v0.10.0` en producción). Al abrir el frente era
`061e20b` (25/09, `v0.9.0`). Cada bloque nace de `origin/main` en un worktree dentro de
`.claude/worktrees/`. La copia principal `~/NovuChat` está en `main` y **no
se opera nada desde ahí**.

**Las tres sesiones** (`Analisis/41` §8.5): esta (operadora), las de clientes
(`Prompts/operacion-de-clientes.md`, una por comercio, bajo el congelamiento
del §12.10) y la revisora (`Prompts/revision-de-hitos.md`). Los informes de
hito de abajo son lo que Andres le pega a la revisora.

## Tablero de fases

| Fase | Qué | Estado | Cierra |
|---|---|---|---|
| **F-1** Cierre de las nueve sesiones | Hotfix (memoria y candado), cinco ramas de documentación, traspaso, origen del anuncio, ayudante, worktrees, matriz, este tablero, los primeros commits; más los dos hallazgos del ensayo (#196, #197) | **cerrada el 26/09** | H0 (con E) |
| **E** Estándar DevSecOps 2.4 | Reusable 2.4, cabeceras del 22/09, fusión de tres vías de dos copias con lo propio | **cerrado el 26/09**: #191 fusionado, primer run de `main` en verde | H0 |
| **F1** Ejes de la cuenta y consola del propietario | `modalidad`, `titularidad`, `modelo`, `cambiosIncluidos`, renombres, `asignar-plan`, migración de los tenants reales, Negocios (A-3b) | **cerrada el 26/09**: #207 y #203 fusionados, 5 tenants migrados, `v0.10.0` desplegada y verificada. Informe H1 abajo | H1 |
| **F6** Método | `docs/arquitectura/`, bitácora por mes, estado generado, `CLAUDE.md` con invariantes, gancho por carpeta, agentes por zona, `analista-de-solicitudes`, `CICLO-DE-VIDA.md` | **fusionada el 26/09**: #200, #201, #202, #204, #206 y #208 | H6 |
| **S** Staging | Proyecto de staging, `desplegar-staging` y `dast-y-humo` en verde | **fusionada el 26/09 (#205)**. `v0.10.0` fue con la alternativa (`--dry-run` y verificación HTTP) porque el proyecto no tenía facturación («Cloud billing quota exceeded»); **tiene facturación desde el 26/09** y se estrena con la etiqueta de F2 | H2 |
| **F1b** Copia de límites y precio por contrato | `asignar-plan.mjs --conversaciones`, `--cambios`, `--precio`, `--periodo-prueba aaaa-mm` y `--bolsa-prueba N` con `--operador` y auditoría; lo mismo desde Negocios; el pago manual acepta el precio del contrato; negativas (un admin no lo escribe, la copia manda sobre el plan, precio fuera de contrato rechazado). Agente `central`, un PR, 0 mensajes, sin despliegue propio: entra con la etiqueta de F2 | **siguiente**, antes de F2. Ya en `main` (#212): `--cambios` y el marcador `limitesPorContrato`; el pago no cambia la modalidad (opción B) | H1b |
| **F2** Carpetas, registro y frontera | Diseño del registro primero; mover sin lógica; `fronteras` y `registro` en CI; `tenants.modulos`; límite de agendas. Sin cambios de alcance | **diseño en curso desde el 26/09**; sus PR se fusionan después de F1b; primer PR `registro.ts` solo; gancho corregido en #210. Condición de la etiqueta abajo (Reglas para F2) | H2 |
| **F3a** Esqueleto de venta | Medios entrantes en el core para los tres esqueletos; transferencia con aviso y botón; fallo del modelo con botón; `NIEGA_IA` en la variante común; campaña por texto; embudo único; brechas 8 y 9 del anexo A. Agentes `core-flujos` y `modulo` | espera H2 | H3a |
| **F3b** Core unificado de reservas | Una variante de los cinco nodos comunes; prompt por capas; suites sin `new Function`; corpus de captación fuera del nodo; los 8 publicados desde `main`, Bellido y Platinum en ventana con ensayo previo | espera H3a; Platinum además espera su PR de datos | H3b |
| **H4-Bellido** Pase de Bellido | Lo cierra la sesión de Bellido, sobre la versión publicada | **ahora** (ver «Coordinación con las sesiones de clientes») | H4-Bellido |
| **H4-Platinum** Pase de Platinum | Lo cierra la sesión de Platinum | cuando cierren anexo y datos; necesita H1b | H4-Platinum |
| **H4-Edgar** Alta y pase de Edgar | Lo cierra la sesión de Edgar; alta en paralelo | su flujo sale de F3a: producción en H3a | H4-Edgar |
| **F4** Conector de canal ∥ **F5** Tenants como datos | Receptor y `enviar` fuera de n8n; Bellido como módulo | esperan H3b y el primer cliente pagador; antes del quinto número | H5 |

## Cola de fusión (F-1), en orden

Cada paso escribe en GitHub y necesita el «sí» de Andres. Lo que está
«listo» ya tiene commit local, suites en verde y revisión de seguridad.

| # | Bloque | Rama | Estado (25/09) | Costo |
|---|---|---|---|---|
| 1 | Hotfix: `deleteMode` y hueco del candado, tres flujos de reservas | `cierre/hotfix-memoria-y-candado`, **PR #186, fusionado el 25/09** | 1076 pruebas de flujos + suite completa 3266 en verde; seguridad aprobado con 2 observaciones atendidas. Falta: **ensayo en el Demo A** y **publicación de los 3 flujos en la ventana de 02:00 a 03:00** (atraso declarado en `docs/versiones-por-cliente.md`) | 0 mensajes; 1 PR; 3 publicaciones |
| 2 | Cinco ramas de documentación, en este orden: `estado/v0.9.0` (#182, más el commit local con `Prompts/capacidades-comunes.md`, que hay que subir) → `prepago/tablero-al-dia` (#183) → `cierre/traspaso-25-09` (#185) → `claude/topes-campanas-confirmados` (**#189**) → `docs/planes-a-medida` (#184) | las cinco | **fusionadas el 25/09 en ese orden** (#182, #183, #185, #189, #184). A #185 y #184 se les trajo `main` a la rama resolviendo `ESTADO.md` y `Prompts/LEEME.md` con la receta que conserva los dos lados | 0 mensajes; 5 fusiones, 1 push, 1 PR nuevo, hasta 3 pushes de resolución |
| 3 | Traspaso del chat interno | `claude/novuchat-silvana-transfer-c40177`, **PR #187, fusionado el 25/09** | 138 pruebas de captación, saneo 0, identidad ok. Los pasos de Meta: sesión de clientes de NovuChat | 0 mensajes; 1 push, 1 PR |
| 4 | Origen del anuncio | `medicion/origen-del-anuncio`, **PR #188, fusionado el 25/09** | `main` fusionado dos veces sin reescribir la rama (la segunda, ya con el hotfix adentro: 1409 pruebas de flujos en verde), `origen` derivado del objeto `anuncio`, suite completa 3285 en verde, saneo 0. Las Functions entran con la siguiente etiqueta | 0 mensajes; 1 push, 1 PR |
| 5 | Ayudante de configuración | `claude/ai-config-helper-e3b434` | **diseño guardado** como `Analisis/42` (en `cierre/25-09`). Falta: borrar la rama remota, con OK | 0 |
| 6 | Worktrees colgados | `novuchat-byoc-pricing-4e0c69` (origen), `novuchat-modularization-0fc59d` (tablero), `optimistic-fermi-a6a02d` (traspaso), `planes` | se quitan después de fusionar sus ramas; los de esta sesión (`cierre-25-09`, `hotfix`, `origen-anuncio`, `traspaso`, `cola-docs`) se quitan al cerrar F-1 | 0 |
| 7 | Matriz de capacidades (anexo A de `Analisis/41`) | `cierre/25-09` (`b768b0c`) | **hecho**: `Analisis/41-anexo-A-matriz-de-capacidades.md`; ninguna brecha es regresión, todas van a F3 | 0 |
| 8 | Este tablero | `cierre/25-09` | **hecho** | 0 |
| 9 | `Analisis/41` y los tres prompts | `cierre/25-09`, **PR #190** | **en PR**, con `Analisis/42`, el anexo A y este tablero; `main` traído a la rama (este tablero reemplaza al anterior, que #183 había actualizado; `LEEME.md` conserva las dos filas) | 0 mensajes; 1 push, 1 PR |

**Autorización general de Andres (25/09):** push y apertura de PR sin pedir OK
por cada uno; fusionar, ensayar, publicar, desplegar y Meta siguen con «sí»
por acción.

**Decidido por Andres (25/09, tarde):** fusionar en el orden de la cola con CI en verde; el comprobante en simulado del Demo B va en PR propio; la excepción de `uuid` se corrige. Queda por decidir `ruta` (recomendación abajo). Antes se preguntaba si el comprobante en simulado del Demo B (`Analisis/41` §7.1 lo
manda «con el hotfix», el prompt acota el hotfix a los tres flujos de
reservas) entra en este PR con una cuarta publicación o va en un PR propio.

## Cola de ensayo (número del Demo A)

Un ensayo a la vez (`Analisis/41` §12.9). Se anota antes de correr
`ensayo.mjs --preparar`, y se cierra con `--restaurar` de los dos scripts.

| Cuándo | Qué se ensaya | Con qué JSON | Estado |
|---|---|---|---|
| 26/09 00:37–00:43 | Hotfix de memoria y candado | El propio Demo A, publicado desde `main` (`0655cd3`): es uno de los tres flujos | **hecho por Andres**: reserva buena #6054/#6059 (`agendarSinEvento: false`, id anclado, verificada); cruce #6063 (candado, `Olvidar turno fallido` `{success: true}`, reintento con alternativas); memoria conservada #6067/#6082. «¿Eres un robot?» no se hizo. Dos hallazgos previos: falso «duplicadas» por título (#6072) y **cancelación de la cita equivocada** (#6086/#6091), ver `ESTADO.md` |

## Informes de hito

**Plantilla de cada informe** (`Analisis/41` §8.5; desde H1b en adelante):

1. PR y sha fusionados en `main`, en orden.
2. Lo publicado o desplegado, con el seco leído entero y la verificación
   después.
3. Pruebas con sus números reales y los identificadores de ejecución del
   ensayo.
4. Costo en las tres unidades (mensajes por conversación; escrituras en GitHub
   y corridas de CI; escrituras en la nube).
5. Lo que quedó fuera y por qué.
6. Lo que se encontró mal o incompleto en `Analisis/41`.
7. **Qué cliente quedó habilitado con ese hito y qué le falta que no es
   construcción** (contrato, anexo, Meta, pago, datos, aceptación). Nuevo desde
   la reorientación del 26/09.
8. Decisiones de Andres en el hito y lo que le toca a Andres.

**Cómo verifica la revisora**, como en H0 y H1: por **sha** (lo fusionado en
`main` es lo que el informe dice), por **CI** (las corridas de ese sha en
verde) y por **lectura de producción en seco** (flujos vivos con
`estado-de-versiones.sh`, Functions desplegadas, `cuenta/estado` de los
tenants con los diagnósticos sin `--aplicar`). El informe no se da por bueno
por sí solo.

### H0 — F-1 y E (cerrado el 26/09/2026, madrugada; para la revisora)

**PR y sha fusionados en `main`, en orden:** #186 (hotfix `deleteMode` y
candado), #182, #183, #185, #189, #184 (cinco de documentación), #187
(traspaso), #188 (origen del anuncio), #190 (plano, prompts, anexo A,
`Analisis/42`, tablero), #191 (E, estándar 2.4), #192 (Demo B comprobante en
simulado), #193 (`uuid`), #194 (registro de versiones), #195 (asiento de F-1),
#196 (duplicadas por título y hora), #197 (hotfix de cancelación). `main` en
`e02a756`. Las nueve sesiones del 25/09 cerradas; la del ayudante sin fusionar,
con su diseño en `Analisis/42`; once más dos ramas remotas borradas; worktrees
colgados quitados.

**Publicado desde `origin/main`**, cada uno con el seco leído entero,
credenciales heredadas y ninguna corregida, respaldo en `Flujos/respaldo-*`:
Demo A, Demo B y captación (desde `0655cd3`, 25/09 20:10); Platinum y Bellido
(`0655cd3`, 26/09 00:55, fuera de la ventana por decisión de Andres: nadie está
en modalidad producción); los tres de reservas de nuevo desde `e02a756`
(26/09 01:3x) con #196 y #197. **`estado-de-versiones.sh`: 8 de 8 al día.**

**Pruebas, con números reales:** hotfix 1076 de flujos + suite completa 3266;
origen 3285; `uuid` 3301; cancelación 1119 de flujos + suite completa 3342
(5 de `pagos.test.ts` por tiempo del cobrador; sola, 60/60); duplicadas 965;
estándar: suites del reusable iguales antes y después, `security-local` 2.5
aprobado, primer run de `main` verde. **Ensayo real de Andres en el Demo A**:
#6041 a #6098 (tabla en `ESTADO.md` del 26/09): reserva buena con
`agendarSinEvento: false` y el id anclado (#6054, #6059); cruce, borrado,
`Olvidar turno fallido` `{success: true}` y reintento con alternativas (#6063);
memoria conservada (#6067, #6082). «¿Eres un robot?» queda para la aceptación.

**Costo en las tres unidades:** 0 mensajes por conversación (y −1 aviso falso
a recepción en el caso de duplicadas); 16 fusiones, 12 PR propios y unas 25
corridas de CI; 8 publicaciones en n8n; 0 despliegues (las Functions del
origen del anuncio y de `uuid` entran con la próxima etiqueta).

**Lo que quedó fuera y por qué:** `pedidos.md`, cláusulas de Q'Taco y
Dhermacore, limpieza del calendario de Bellido y Meta de Platinum son de las
sesiones de clientes (§8.5); el ensayo por `ensayo-flujo.sh` no hizo falta
porque el Demo A es uno de los tres flujos; las citas de prueba del 26/09 en el
calendario del demo (corte 10:00 y 14:00) quedan hasta que se borren a mano.

**Lo que se encontró mal o incompleto en `Analisis/41`:** (1) §7.1 mezcla en
F-1 tareas de las sesiones de clientes; (2) §7.1 ubica el conflicto del origen
en `normalizar-entrada.js` y estaba en los tres JSON (el módulo fusionó solo);
(3) §7.1 pone «comprobante en simulado con el hotfix» y fue PR propio; (4) el
plano no prevé **estado por teléfono en n8n** como barrera por hecho
(`$getWorkflowStaticData`): #197 lo necesitó, y en F3 conviene decidir si ese
estado vive en el servidor (`configuracionFlujo` ya recibe `telefono`).

**Hallazgos para F3 (anexo A y ensayo):** medios y transferencia en Demo B y
captación; prohibición 4 solo en el prompt en reservas; ids de credencial en
Demo A y Demo B; concurrencia de datos estáticos y `.first()` (riesgos
aceptados en `ESTADO.md`).

**Decisiones de Andres en este hito:** push y PR sin pedir OK (25/09); fusión
en orden con CI en verde; Demo B en PR propio; corregir `uuid`; publicar sin
ventana mientras nadie esté en producción; `ruta: '.'` se mantiene
(recomendación aceptada por omisión: se revisa en F6).

**Lo que le toca a Andres:** pegar este informe en la sesión revisora y, con su
veredicto, autorizar F1 (con S y F6 en paralelo).

### H1 — F1 (cerrado el 26/09/2026, madrugada; para la revisora)

**PR fusionados:** #207 (los tres ejes: plan, modalidad, titularidad; modelo
por tenant; contador de cambios; `asignar-plan.mjs` con `--operador`
obligatorio; `migrar-ejes.mjs`), #203 (Negocios asigna los tres ejes; Cuenta
y Pagar los muestran; «Producción» en lugar de «prepago»). En paralelo S
(#205) y F6 (#200 a #206, #208). `main` en `4f7e091`; suite completa 3498 en
verde.

**Migración:** 5 tenants reales (el plano estimaba 6), seco leído entero,
aplicado con el «sí» de Andres, releído, y un segundo seco con 0 cambios;
auditoría `migrar_ejes` en los cinco. Demos: Pro en modalidad demostración.
Bellido y Platinum: sin modalidad explícita (demostración para el código).

**Despliegue:** `v0.10.0` sobre `4f7e091`, con la alternativa de la revisora
porque S no tiene facturación: `--dry-run` del pipeline y verificación de las
Functions HTTP después (55/55 revisiones listas, 0 errores, las tres callables
nuevas con `allUsers` y respondiendo con nuestro código). Detalle en la
bitácora del 26/09 (madrugada, 3).

**Costo en las tres unidades:** 0 mensajes por conversación; 2 PR de F1 más
7 de F6 y 1 de S, con sus corridas de CI; 15 escrituras y 5 auditorías en
Firestore, 1 despliegue.

**Zonas efectivas frente al §8.1** (`docs/arquitectura/agentes.md`):
1. **F1 escribió fuera de las carpetas de zona**, y era inevitable: los ejes
   viven en `planes.ts`, `prepago.ts`, `pagos.ts`, `ingesta.ts` y
   `limiteCatalogo.ts` en la raíz de `functions/src/`, en `admin/scripts/`,
   en `admin/pruebas/` y en `web/src/lib` y `web/src/paginas`, que recién F2
   mueve a `central/` y `plataforma/`. #207 tocó 7 archivos en carpetas de zona
   y 29 fuera; #203, 12 y 17. El gancho (#202) entró después del
   trabajo de F1: **F2 es la primera fase que corre con el gancho activo**.
2. `agentes.md` tiene la fila **`plataforma-consola`**, que el §8.1 no tiene
   (ahí Negocios era de `consola`); y le da a `consola` solo Tablero,
   Configuración y componentes, sin `plataforma/`. Conviene que el §8.1 adopte
   la separación.
3. `plataforma-consola` escribe en `admin/scripts/plataforma/`, carpeta que el
   plano no nombra.

**Lo que se encontró mal o incompleto en `Analisis/41`:** la migración de
«seis tenants» (son cinco); el plano supone que el plan `demostracion`
desaparece sin decir que las reglas dejan de reconocerlo, lo que obliga a
migrar **antes** de desplegar; y S depende de facturación, que el plano no
lista como precondición.

**Para F2:** borrar los puentes deprecados de `planes.ts`; mover los ejes a
`central/`.

**Decisiones de Andres en este hito:** migrar con los demos en Pro; etiqueta
sin S (alternativa de la revisora); modelo sin cambiar (3.7-flash-lite no
existe). Pendientes: facturación de staging y el modelo por defecto.

**Lo que le toca a Andres:** pegar este informe en la sesión revisora y, con
su veredicto, autorizar F2.

## Reglas para F2 (recomendaciones de la revisora sobre H1, 26/09)

- **Copia por contrato antes de F2 o en su primera tanda:** `--cambios N` en
  `asignar-plan.mjs` y el campo en Negocios, con la prueba de que la copia
  manda sobre el plan. Es de Central y no mueve archivos. La coordinadora
  agregó al bloque lo que la revisora no vio: hoy `--plan` reescribe la copia
  entera, así que **un cambio de plan posterior borraba el contrato en
  silencio**; el bloque lo cierra con prueba negativa (script y callable).
  Platinum queda en 4 antes de H4. En obra: agente `central`,
  `central/copia-por-contrato`.
- **Modalidad de Platinum y Bellido por las sesiones de clientes**, leyendo
  antes `estadoDeServicio` en prueba. **Advertencia de la coordinadora, antes
  de escribirla:** `asignar-plan.mjs --modalidad prueba` fija como mes de
  prueba el mes EN CURSO, sin opción para elegir otro. Hecho el 26/09, la
  prueba dura hasta el 30/09; el aviso de conversión (5 días antes del fin)
  queda debido de inmediato y sale por el flujo de captación si el comercio
  tiene `telefonosPago`, entre las 09:00 y las 19:00; y desde el 03/10 la
  cuenta queda «sin pago» (en observación, se atiende igual). Además, en el
  mes de prueba **no rigen las conversaciones del plan: solo la bolsa de 20**.
  Decisión de Andres (ver abajo).
- **F2 arranca con el gancho activo, y el primer PR es `registro.ts` solo**,
  midiendo ahí cuánto del árbol no cabe en las zonas antes de lanzar los
  módulos en paralelo. **Hallazgo de la coordinadora al preparar F2:** el
  gancho **no rechazaba nada dentro del worktree de un subagente** (buscaba
  `.claude/zona` en `CLAUDE_PROJECT_DIR`, que para el subagente es la copia
  principal). Medido con un agente de prueba; corregido en #210 (la zona sale
  del `cwd` del evento), con ocho casos nuevos que fallan con el gancho
  anterior. Rige cuando la copia principal se ponga al día; antes de lanzar
  agentes con zona, se repite el agente de prueba. **F1 y todo lo anterior
  corrieron sin gancho efectivo.**
- `ruta: '.'` pasa a `./admin` en el mismo PR que mueva `functions/src`.
- **La etiqueta de F2 no sale sin staging.** El `--dry-run` sirvió para F1,
  pero F2 y F3 mueven mucho más código y publican los ocho flujos.
  **Reescrita por la decisión de Andres del 26/09 (reorientación, punto 4):**
  F2 no cambia de alcance, y su etiqueta es el primer despliegue con clientes
  pagando. Si el staging tiene facturación, aterriza ahí primero; si no,
  `--dry-run` leído entero y verificación de las Functions HTTP después, y se
  declara en el informe. **El staging tiene facturación desde el 26/09**, así
  que el camino es el primero. La migración de `tenants.modulos` va en
  ventana, con respaldo y vuelta atrás escrita antes de correrla.
- **Medir en H2:** el segundo seco de `migrar-ejes.mjs` sigue dando 0 después
  de mover los ejes a `central/`; `estado-de-versiones.sh` compara también
  contra los módulos.

## Coordinación con las sesiones de clientes (reorientación del 26/09)

Decisión de Andres del 26/09/2026, después de H1 (`Analisis/41` §6.3 y §8.5).
Lo que no cambia: cinco zonas y carpeta = zona, cero código a medida, cero
mensajes por conversación, F4 y F5 después del quinto número, la regla de
integración del §8.2 y las tres sesiones. Las sesiones de clientes siguen sin
tocar `Flujos/src/`, Functions ni consola: lo que exige código va a
`pedidos.md` con fecha «después de F3b»; los **cambios incluidos** del
contrato son de **configuración** y su SLA de dos días hábiles se cumple
durante la obra (§12.10).

**Reglas comunes a las cinco sesiones:**
- **El pago no cambia la modalidad** (opción B, #212): el pase a prepago
  (producción en la consola) lo hace **el propietario después de confirmar el
  pago**, nunca el pago solo.
- Cada informe de hito dice qué cliente quedó habilitado y qué le falta que no
  es construcción (plantilla arriba, punto 7).
- Un ensayo a la vez en el número del Demo A, anotado en la «Cola de ensayo».

| Cliente | Ahora | Con qué hito | Lo que le falta que no es construcción |
|---|---|---|---|
| **Bellido** (reservas) | **En prueba desde el 26/09** (mes de septiembre, con `asignar-plan.mjs --modalidad prueba`: la prueba del mes en curso vence el 30/09). **El 01/10 se extiende a octubre** con `--periodo-prueba 2026-10` (F1b), cubierta hasta el 31/10: F1b tiene que estar en `main` antes del 01/10. Antes de escribir la modalidad, leer la advertencia de «Reglas para F2» (aviso de conversión y bolsa de 20) | **H4-Bellido, ahora**, sobre la versión publicada; re-aceptación del delta tras F3b | Contrato con **cero cambios incluidos** y quién paga Meta; aceptación de las **46 filas** sobre la versión publicada, con identificador de ejecución; pase a prepago por pago confirmado (el propietario, regla común); **fila de excepción de versión** en `docs/versiones-por-cliente.md` hasta la re-aceptación tras F3b (este PR) |
| **Platinum** (reservas) | Ejes en prueba **cuando F1b esté fusionado**, con **`--bolsa-prueba 100` por contrato**: su volumen es de unas 55 conversaciones al mes y la bolsa de prueba por defecto es 20 | **H4-Platinum**, cuando cierren anexo y datos; **no después de H3** | Precio y cambios con F1b (USD 120 por 500 conversaciones; los cambios del contrato); anexo corregido (`cumplimiento.md` en cero); **PR de solo datos** que alinee `platinum-agendamiento.json` y `negocio-platinum.json` con producción (tercera agenda, estética, emojis, Maps): **sin ese PR, F3b no publica Platinum** |
| **Edgar** (venta, BYOC) | **Alta completa en paralelo**: Meta en su portafolio, configuración, catálogo en el chat sin catálogo web, QR de monto abierto, aviso a Edgar; titularidad `comercio` y plan `byoc` | **Producción en H3a** (H4-Edgar): su flujo se ensambla de la salida de F3a, sin nodo propio | Todo lo del alta, que no espera a la obra; la aceptación, sobre el flujo de F3a |
| **Dhermacore** | `cumplimiento.md` y contrato | Sus módulos (enrutamiento por campaña, reactivación) nacen **después de F3a**, como módulos con bandera, para todos | Contrato y anexo; los cambios pactados se escriben con `--cambios` (ya en `main`, #212) |
| **Q'Taco** | `cumplimiento.md` y contrato | Su módulo (mesas) nace **después de F3a**, como módulo con bandera, para todos | Contrato y anexo |

**F1b suma a su alcance**, por estas decisiones: `--periodo-prueba aaaa-mm`
(elegir el mes de prueba, que hoy es siempre el mes en curso) y
`--bolsa-prueba N` (la bolsa de conversaciones del mes de prueba por contrato,
hoy fija en 20), los dos con `--operador` y auditoría como el resto del
bloque. `Analisis/41` §7 (fila F1b) todavía no los nombra: va en el informe de
H1b para la revisora.

## Heredado del tablero anterior (prepago y modularización), y adónde va

| Pendiente al 25/09 | Adónde va en este frente |
|---|---|
| **A-3b** consola del propietario (pago manual con evidencia, suspender, umbrales, corte) | **F1** (`Analisis/41` §7): la página Negocios de Plataforma |
| **A-4** intención «pagar / estado» por el WhatsApp interno | Fuera de este frente; se retoma como módulo después de F3, con la verificación del titular de cada teléfono de pago |
| **A-5** presentar a Meta las ocho plantillas de cobranza (`docs/plantillas-cobranza.md` §7), ampliando antes `crear-plantilla.sh` | Fuera de este frente; trámite de Meta, en paralelo, con OK por acción. El traspaso (paso 3) amplía `crear-plantilla.sh` con encabezado y botón |
| **B-2** el resto de los flujos al ensamblador (Demo B, captación, Bellido) | **F2**: `ensamblar-flujo.mjs extraer` de Demo B y captación; Bellido en **F5** |
| **B-3** el corpus del sitio fuera del nodo Code | **F3** (y su alarma de huella que no corre en CI, antes de moverlo) |
| **B-4** runbook etapa 5, agente `flujos-n8n`, gancho de pre-commit | **F2** (gancho que exige `verificar`) y **F6** (agentes por zona, runbook) |
| **C** contrato del cobrador (otro proyecto): cuenta `novuchat`, URL pública, `rotar-cobrador.sh` | Fuera de este frente; su proyecto |
| Encender el corte del prepago (`fijarCortePrepago`) | Decisión de Andres después de un pago de punta a punta; **F1** deja el botón en Negocios |

## Reglas para F1 (recomendaciones de la revisora sobre H0, 26/09)

- **S cierra antes de la etiqueta de F1.** Ese despliegue es el primero desde
  `v0.9.0` y carga las Functions del origen del anuncio y `uuid` 11 en el
  runtime, que nunca corrió en la nube: aterriza primero en staging. Si S no
  llega, `firebase deploy --dry-run` en la aprobación y verificación de las
  Functions HTTP después (memoria de despliegues).
- **Migración de los ejes:** contar primero los tenants reales en Firestore,
  seco leído entero, aplicar, releer. Los seis del plano son una estimación.
- La sesión de **Platinum** se abre en paralelo con `Prompts/operacion-de-clientes.md`:
  H1 es lo que espera para escribir plan, modalidad y titularidad; Meta es de
  calendario.
- Copia principal al día (`988c223`), ramas locales fusionadas borradas (156),
  citas de prueba del 26/09 borradas por Andres.

## Decisiones abiertas para Andres (E, del relevamiento)

- `ruta: '.'` con el `package.json` en `admin/`: la auditoría nativa de pnpm se
  salta y solo Trivy cubre `admin/`; pasar a `./admin` la activa pero crea
  categorías nuevas de Code Scanning. No lo cambia el bloque 1.
- La excepción de Trivy por `uuid` (CVE-2026-41907, hoy MEDIUM, inerte con
  `bloquear_en: CRITICAL,HIGH`) vence el 31/10. El PR #11 de Dependabot
  (`firebase-admin` 14) **no la cierra**: `uuid@9` sigue por `firebase-tools`.
  Lo que la cerraría es un `firebase-tools` con `gaxios ≥ 7` o un
  `pnpm.overrides`. Además #11 tiene `construir` en rojo y está desactualizado.
- Para SeguridadGeneral (no se arregla desde acá): `security-local.sh` del
  estándar sigue con `cd "$RUTA"` sin `|| exit 1`; el de NovuChat lo tiene.

## Bitácora del frente

- **25/09/2026** — Arranca la sesión operadora. Leído el plano y los prompts.
  Hotfix construido y probado (memoria: `lastN` verificado contra el paquete
  de n8n; candado cerrado por hecho cuando `agendar_cita` corre sin devolver
  cita); fusión de `main` en el origen del anuncio resuelta; diseño del
  ayudante guardado; cola de documentación simulada; traspaso verificado.
  Todo en local, a la espera del primer punto de control con Andres.
- **25/09/2026 (tarde)** — Andres autoriza push y PR en general. Subidas las
  cinco ramas y abiertos **#186** (hotfix), **#187** (traspaso), **#188**
  (origen), **#189** (topes), **#190** (documentación); #182 recibió el commit
  del prompt de capacidades. Anexo A entregado. Relevamiento de E cerrado;
  bloque 1 de E en construcción con el agente `devsecops`.
- **25/09/2026 (noche)** — Andres autoriza fusionar en orden con CI en verde.
  Fusionados **#186, #182, #183, #185, #189, #184, #187, #188**, en ese orden;
  cuatro de ellos recibieron `main` con la receta de conservar los dos lados.
  #190 y #191 abiertos. Decisiones de Andres: Demo B en PR propio; corregir
  `uuid`; `ruta` pendiente de recomendación.
- **26/09/2026 (madrugada)** — #191, #192 y #193 fusionados; ramas remotas
  borradas. Publicados Demo A, Demo B y captación desde `0655cd3`. Andres
  verificó el hotfix en el Demo A (#6041–#6098): memoria conservada, candado y
  reintento en orden. Dos hallazgos previos al hotfix, anotados en `ESTADO.md`.
  Falta la ventana de 02:00 a 03:00 para Platinum y Bellido.
- **26/09/2026 (madrugada, 2)** — Andres autoriza fusionar #196 y #197 y
  publicar los tres flujos de reservas: hecho desde `e02a756`, 8 de 8 al día.
  #191 y #193 fusionados antes. **H0 cerrado**: informe arriba, para la
  revisora.
- **26/09/2026 (mañana)** — La revisora da por pasado H0 con cinco
  recomendaciones (arriba). Arrancan **F1** (dos agentes), **S** y **F6**,
  cuatro worktrees desde `origin/main` (`988c223`).
- **26/09/2026 (F6, agente `metodo`)** — Seis PR, cada uno desde
  `origin/main` y fusionables en cualquier orden: **#200** `admin/DISENO.md`
  §4–§6 movidos por zona y módulo a `docs/arquitectura/` (112 bloques, 2.977
  líneas movidas + 466 que quedan = 3.443), `indice.md` de secciones viejas,
  `docs/base-comercial.md` y `limites.md`; **#201** `docs/clientes/CICLO-DE-VIDA.md`
  (§12 de `Analisis/41` con los punteros a los runbooks); **#202** gancho
  `zona-de-escritura.sh` sobre Edit y Write, con `.claude/zona` como segunda
  fuente (lo escribe quien lanza al agente, nunca se versiona: en
  `.gitignore`), realpath, fallo cerrado y prefijos amplios rechazados, 38
  casos del gancho + 2 comprobaciones de git, todos en verde;
  **#204** ocho agentes por zona más `analista-de-solicitudes`, con
  `docs/arquitectura/agentes.md` (zonas efectivas y diferencias con §8.1);
  **#206** dos proyectos de vitest: `puras` 42 suites / 2.275 pruebas sin
  emulador y herméticas (`FIRESTORE_EMULATOR_HOST=127.0.0.1:1`) en 13 s,
  `emulador` 34 suites (con `asignar-rol`, que abre Firebase antes del modo
  seco); y el **PR final**:
  `bitacora/2026-08.md` (14 asientos) y `2026-09.md` (65), `ESTADO.md` de una
  pantalla, `scripts/estado-generado.sh` (etiqueta viva, Functions, flujos con
  `estado-de-versiones.sh`, tenants con modalidad por ADC), `CLAUDE.md` solo
  invariantes con la regla de zonas. Dos vueltas de seguridad cerradas en
  las ramas (#202, #204, #206, #208). Costo: 0 mensajes; 6 PR y 12 pushes; 0
  nube. Lo que queda para la coordinadora: `indice.md` gana las filas de
  `zona-de-escritura.md` y `agentes.md` cuando #200, #202 y #204 estén en
  `main`; las diferencias con §8.1 van al informe de H1 para la revisora.
- **26/09/2026 (madrugada, 3)** — Andres autoriza la migración de los ejes:
  5 tenants, aplicada y releída. Andres crea `v0.10.0`; desplegada y
  verificada. **F1 cerrada; H1 arriba, para la revisora.**
- **26/09/2026 (madrugada, 4)** — H1 pasa con seis recomendaciones (arriba).
  Andres autoriza: tablero, copia por contrato y F2 con `registro.ts` primero.
  Al preparar F2 se midió el gancho de zona mudo en los subagentes: #210.
- **26/09/2026 — Reorientación después de H1 (decisión de Andres).** Es de
  orden y cortes, no de arquitectura. La revisora la aplicó al plano en #216
  (`Analisis/41` §6.3, §7, §8.1, §8.5, §12.10 y los prompts de la operadora y
  la revisora). Este tablero la recoge: **F1b** antes de F2 (copia de límites
  y precio por contrato, más `--periodo-prueba` y `--bolsa-prueba`); **F3 se
  parte** en F3a (esqueleto de venta) y F3b (core unificado de reservas);
  **H4 se parte por cliente** (H4-Bellido ahora, H4-Platinum con anexo y
  datos, Edgar con H3a); la etiqueta de F2 aterriza primero en staging, que
  tiene facturación desde el 26/09; cada informe de hito dice qué cliente
  quedó habilitado y qué le falta que no es construcción, y la revisora
  verifica por sha, CI y lectura en seco. Decisiones de Andres del mismo día:
  Bellido en prueba desde hoy y extendida a octubre el 01/10 con
  `--periodo-prueba 2026-10`; Platinum en prueba con `--bolsa-prueba 100`
  cuando F1b esté fusionado; el pago no cambia la modalidad (opción B, #212).
  Fila de excepción de Bellido en `docs/versiones-por-cliente.md`.
