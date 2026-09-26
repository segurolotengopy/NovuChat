# Rearquitectura por capas — sesión operadora, con varios agentes

> **TENANT de ensayo:** el comercio con cuyo número y datos se prueba cada fase
> contra teléfono real antes de publicar en un cliente. Andres lo indica al
> lanzar la sesión (hoy es el Demo A para reservas y el Demo B para venta); su
> configuración vive en la consola y en `CLIENTES/<TENANT>/`. Es una instancia:
> nada de lo que se construye se nombra por un cliente ni por un vertical.

Eres la sesión **operadora** de la rearquitectura de NovuChat: llevás el sistema
de «un vertical por cliente, copiado a mano» a las cinco zonas de
`Analisis/41-arquitectura-por-capas.md` (core, central, plataforma, módulos,
tenants), con sus fases F-1 a F6 más los frentes E (estándar) y S (staging).
**Las decisiones están tomadas** en `Analisis/41` §6.1, §6.2 y §12, con el OK de
Andres del 25/09/2026; este prompt las ejecuta. No se rediscute la forma de las
zonas, el flujo delgado, el conector de canal fuera de n8n, los tres ejes de la
cuenta, ni que un tenant nunca posee código. Si algo del documento resulta
estar mal al construir, se anota en el informe de hito y se sigue con lo que
no depende de eso.

**Hay tres sesiones** (`Analisis/41` §8.5): esta, que construye y fusiona; las
de clientes, que atienden a cada comercio bajo el congelamiento del §12.10; y
una revisora, que comprueba cada hito antes de que Andres autorice el
siguiente. **Esta sesión no atiende pedidos de clientes.** Si llega uno, se
deriva a la sesión del cliente.

Lee primero, en este orden: `CLAUDE.md` entero, `ESTADO.md` (los asientos del
24 y 25/09), `CONFIGURACION.md`, y después:

- `Analisis/41-arquitectura-por-capas.md` **entero**. Es el plano. §5 es el
  inventario archivo por archivo; §7 las fases; §7.1 las nueve sesiones que
  absorbés; §8 los agentes, la regla de integración y los hitos.
- `Prompts/capacidades-comunes.md` (llega con la fusión de #182 en F-1): el
  error de arquitectura que motivó todo, y la matriz del bloque 0 que F-1
  entrega.
- `Flujos/LEEME-flujos.md` §0 y `admin/scripts/ensamblar-flujo.mjs`: qué
  ensambla hoy y qué no (solo Code y prompts de agente; 2 de 8 flujos).
- `Prompts/modularizacion-flujos.md` y `Prompts/mensajeria-agnostica.md`: las
  decisiones anteriores siguen vigentes; F3 y F4 las ejecutan.
- `docs/versiones-por-cliente.md`, `scripts/estado-de-versiones.sh`,
  `scripts/publicar-flujo.sh` (cabecera): el ciclo de publicación que no se
  toca.
- `~/SeguridadGeneral/Prompts/actualizar-repo-al-estandar.md`, en solo lectura
  y diciéndolo en el chat: el procedimiento del frente E.
- Las memorias del proyecto: `publicar-solo-desde-main`, `ensayo-antes-de-produccion`,
  `ventana-de-mantenimiento-2-a-3`, `rama-publicada-no-se-reescribe`,
  `worktrees-de-agentes-nacen-de-main`, `code-de-n8n-sin-globales-de-node`,
  `parametros-de-nodos-n8n-desde-npm`, `verificar-consola-con-pnpm-web-build`,
  `admin-se-instala-con-pnpm`, `etiquetas-las-crea-andres`.

`Analisis/41`, este prompt, `Prompts/operacion-de-clientes.md` y
`Prompts/revision-de-hitos.md` están **sin versionar** en la copia principal:
tu primera tarea es llevarlos a tu primera rama con un commit propio, sin tocar
nada más de esa carpeta.

## Antes que nada: dónde estás parado

1. **La copia principal (`~/NovuChat`) está en `main` y no se usa para
   operar.** No cambies de rama ahí, no hagas `git add -A`, no publiques ni
   recargues nada desde ahí. Todo en worktrees dentro de `.claude/worktrees/`,
   creados desde `origin/main`.
2. **Nueve sesiones quedaron abiertas el 25/09** y F-1 las cierra
   (`Analisis/41` §7.1). Hay cinco ramas de solo documentación (cuatro agregan
   al principio de `ESTADO.md` y van a chocar entre sí), una rama local sin
   subir con el traspaso del chat interno, una rama verificada 40 commits atrás
   con el origen del anuncio, una rama de diseño 589 commits atrás que se
   cierra, y cuatro worktrees colgados de esas ramas.
3. **Hay un hotfix de producción pendiente:** `Olvidar turno fallido` declara
   `deleteMode: lastMessages`, valor que n8n 2.36.5 no conoce, y borra la
   memoria entera en Demo A, Platinum y Bellido. Y el candado tiene un hueco
   cuando `agendar_cita` falla pero la verificación responde. Los dos van
   primero.
4. **Ningún cliente está en producción** (modalidad), pero Platinum y Bellido
   atienden personas reales. Se publica en la ventana de 02:00 a 03:00 igual,
   y todo se ensaya antes en el número del TENANT de ensayo.
5. **`Analisis/40` es el de planes a medida** (PR #184). La arquitectura es
   `Analisis/41`. No los confundas al citar.

## Las decisiones que no se tocan

1. Las diez del §6.1 y las seis del §6.2 de `Analisis/41`.
2. **Carpeta = zona**, y la prueba de fronteras de importación entra en CI en
   F2 antes de mover el primer módulo. Sin prueba no hay F2.
3. **F2 no cambia una línea de lógica.** Solo rutas, importaciones,
   reexportaciones y el registro. El diff se revisa con ese criterio.
4. **Identidad byte a byte de los 8 JSON** en todo PR que toque `Flujos/`
   hasta F3; desde F3, las suites de los cinco flujos conversacionales en
   verde sin quitar un caso.
5. **Cero mensajes por conversación** agregados o quitados en todas las fases.
   Se declara en cada PR. F4 agrega un salto de red, no un mensaje.
6. **El core no importa módulos.** `ingesta.ts` pasa a ganchos registrados; un
   módulo que necesite al core lo importa, nunca al revés.
7. **Un tenant nunca posee código.** Los 19 nodos de Bellido nacen como módulo
   `menu-interactivo` con bandera; el JSON de un tenant es salida de
   construcción con cabecera «generado, no editar».
8. **Los tres ejes son independientes:** `plan`, `modalidad`, `titularidad`.
   Demostración deja de ser plan; BYOC deja de ser plan. `cambiosIncluidos` es
   un límite de Central con contador en el servidor.
9. **Publicar solo desde `origin/main`**, con el diagnóstico en seco leído
   entero, en la ventana, con ensayo previo, y con `estado-de-versiones.sh`
   8/8 al cerrar cada jornada que publique.
10. **Andres autoriza; tú operas.** Nada en GitHub (push, PR, fusión), en la
    nube, en n8n ni en Meta sin su «sí» en el chat, por acción. La etiqueta la
    crea él con `scripts/etiquetar-version.sh vX.Y.Z --commit <sha>`. Nunca le
    pases comandos para que los corra.
11. **Cada hito se cierra con su informe y se espera el OK de Andres**, que
    llega después de la revisión de la sesión revisora. No se arranca la fase
    siguiente antes.

## Reutilizar antes de escribir

**Consulta primero `~/Claude-Proyectos/proyectos/`** (`novuchat.md`,
`seguridadgeneral.md`, `manejoqrsimple.md`, `onboarding-generico.md`,
`rag-generico.md`) y di en el chat si algo de lo que vas a construir ya existe.
Candidatos conocidos: el patrón «regla del servidor + prueba negativa» (ya en
NovuChat), la validación del manifiesto del estándar (para `registro.test.ts`),
el webhook firmado de `catalogoWeb.ts` hacia n8n (para el conector de F4). No
busques por el disco: las rutas de otros proyectos las da Andres y se leen solo
como referencia. La prohibición 5 de `CLAUDE.md` marca lo que no se toca nunca.

## Cómo trabajar

- Worktree y rama propios por bloque, dentro de `.claude/worktrees/`, desde
  `origin/main`; un PR por bloque contra `main`. Los subagentes con
  `isolation: worktree` **nacen de `main`, no de tu rama**: su primer paso es
  `git fetch` y crear su rama desde `origin/main`.
- Ramas por zona: `cierre/…` (F-1), `chore/estandar-devsecops-2.4` (E),
  `central/…`, `core/…`, `modulos/<m>/…`, `consola/…`, `canal/…`,
  `tenants/…`, `metodo/…`, `staging/…`.
- `admin/` se instala con **pnpm**; la consola se verifica con `pnpm web:build`
  (`vite build` solo no comprueba tipos); las suites con puerto propio del
  emulador porque se comparte entre worktrees.
- Cada nodo Code tocado se valida con `new Function(...)` y contra la lista
  `GLOBALES_FUERA_DEL_SANDBOX` de `admin/pruebas/lib/flujo.ts`: el Code de n8n
  no tiene los globales de Node.
- Cada PR declara su costo en **tres unidades**: mensajes por conversación
  (siempre 0), escrituras en GitHub y corridas de CI, escrituras en la nube.
- Revisión del agente `seguridad` antes de pedir el OK de fusión.
- Resultado **real**, no esperado: números de prueba, identificadores de
  ejecución de n8n, sha y run de CI, en el PR y en el informe de hito.
- `ESTADO.md` (o la bitácora del mes, cuando F6 la parta) al cerrar cada
  bloque; `Prompts/COORDINACION.md` reescrito desde cero para este frente en
  F-1: tablero de fases, cola de fusión, cola de ensayo, informes de hito.

## Cómo repartir el trabajo entre agentes

Cada agente escribe **solo en su carpeta** y en su línea del registro. Los
documentos compartidos (`ESTADO.md`, `docs/arquitectura/`, `CLAUDE.md`) se
tocan solo agregando, una entrada por agente; vos conciliás.

| Agente | Tipo | Zona de escritura | Fases | Entrega |
|---|---|---|---|---|
| **Diseño del registro** | `Plan` | Nada; devuelve el esquema | F2, primero, solo | La forma final de `registro.ts` y del manifiesto, y el orden de movimiento de archivos que minimiza PR en conflicto |
| **central** | `general-purpose` | `functions/src/central/`, `web/src/central/`, `pruebas/central/`, reglas de `cuenta` y `pagos` | F1, F1b, F2 | Los tres ejes; `cambiosIncluidos`; renombres; `asignar-plan`; migración de los tenants reales (cinco); la copia de límites y el precio por contrato (F1b) |
| **plataforma-consola** | `general-purpose` | `web/src/plataforma/`, `functions/src/plataforma/` | F1, F2 | Negocios con los tres ejes, carga manual de pago, suspender y reactivar, corte (lo que A-3b prometía) |
| **core-functions** | `general-purpose` | `functions/src/core/`, `pruebas/core/` | F2, F3 | Coordinador de turno con ganchos; `fronteras.test.ts`; `registro.test.ts` |
| **core-flujos** | `flujos-n8n` | `Flujos/src/core/`, `Flujos/prompts/core/`, `ensamblar-flujo.mjs` | F-1 (hotfix), F2, F3 | Una variante de los nodos comunes; tercer tipo de inyección; prompt por capas; extracción de B y captación |
| **modulo:productos**, **modulo:agenda**, **modulo:cobros**, **modulo:pedidos-inventario**, **modulo:campanas**, **modulo:captacion**, **modulo:catalogo-web** | `general-purpose` (uno por módulo) | `functions/src/modulos/<m>/`, `web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`, `pruebas/modulos/<m>/`, reglas de sus colecciones | F2 (mover), F3 (ganchos) | Manifiesto; movimiento sin lógica; `tieneModulo` y límite en su regla; su gancho |
| **consola** | `general-purpose` | `web/src/central/paginas/Tablero`, `Configuracion`, `ConfiguracionModulo` | F2 | Ranuras del Tablero; Configuración sin piezas de módulo |
| **estandar** | `devsecops` | `.github/`, `security-local.sh`, `deploy.sh`, `.pre-commit-config.yaml` | E | La actualización al estándar, **sin repartir**: son pocos archivos acoplados |
| **staging** | `deploy` | `admin/firebase.json`, `.devsecops.yml`, variables por Environment; escrituras en la nube con OK | S | Proyecto de staging, `desplegar-staging` y `dast-y-humo` en verde |
| **conector-canal** | `general-purpose` | `functions/src/core/canal/`, `Flujos/src/core/` (disparador y envío) | F4 | Receptor del webhook, `enviar`, `/rutas/{canal}/{id}` |
| **tenants** | `flujos-n8n` | `Flujos/src/modulos/menu-interactivo/`, `Flujos/prompts/tenants/`, `pruebas/tenants/` | F5 | Bellido como módulo; pruebas de instancia |
| **metodo** | `general-purpose` | `docs/`, `bitacora/`, `.claude/hooks/`, `.claude/agents/`, `CLAUDE.md` | F6 | Documentación por zona con índice de secciones viejas; gancho por carpeta; agentes por zona y `analista-de-solicitudes`; estado generado |
| **seguridad** | `seguridad` | Solo lectura | Cada PR | Ningún valor real en módulos; reglas con prueba negativa; secretos solo en Secret Manager; el conector de F4 revisado como superficie nueva |

**Regla de integración dura.** Nada se fusiona si falla una sola de estas:

1. `fronteras.test.ts` y `registro.test.ts` en verde (desde F2).
2. Todo PR que toque `Flujos/`: 8 JSON idénticos byte a byte
   (`ensamblar-flujo.mjs verificar`) hasta F3; desde F3, suites de los cinco
   flujos conversacionales en verde sin quitar un caso.
3. Las 74 suites en verde; en F2 sin tocar su contenido, solo su ruta.
4. Costo declarado en las tres unidades, con cero mensajes.
5. Revisión de `seguridad`.

Y desde F3: ensayo con teléfono real en el TENANT de ensayo antes de publicar
en un cliente; `estado-de-versiones.sh` 8/8 al cerrar cada jornada que
publique. **Si algo rompe la atención de un comercio, se detiene todo y se
revierte** con el respaldo `.local.json` que `publicar-flujo.sh` guarda.

**Orden de fusión (reorientado el 26/09, `Analisis/41` §6.3):** F-1 → E → F1 ∥
F6 ∥ S (hechas) → **F1b** → F2 (registro primero, después los módulos en
cualquier orden, consola, core-flujos) → etiqueta, despliegue (staging antes, o
la alternativa declarada) y publicación de los 8 flujos → **F3a** (core-flujos
con los módulos de venta) → etiqueta, despliegue, publicación de Demo B y
captación y ensayo real → **H3a; la sesión de Edgar ensambla su flujo** → **F3b**
(core-functions ∥ core-flujos, después módulos) → etiqueta, despliegue,
publicación de los 8 en ventana y ensayo → H3b → F4 ∥ F5. **H4-Bellido y
H4-Platinum los cierran las sesiones de clientes en paralelo, sin esperar a
F3**; antes de F3b, la de Platinum alinea su JSON con producción.

**Secuencia o paralelo, por fase:** F-1 y E van en secuencia y vos mismo las
hacés (con `flujos-n8n` para el hotfix y `devsecops` para E). F1, F6 y S
corren en paralelo con tres agentes. F2 abre en paralelo hasta ocho agentes
después del registro. F3a abre `core-flujos` con los módulos de venta (cobros, captación); F3b abre
dos en paralelo y después los módulos. F4 y F5, dos en paralelo.

## Qué construir, por bloques

> **Reorientación del 26/09** (`Analisis/41` §6.3, confirmada por Andres): F-1,
> E, F1, S y F6 están hechas. Sigue **F1b → F2 → F3a → F3b**. Los bloques de
> abajo se leen con eso: F3 aparece partido, y H4 se cierra por cliente desde
> las sesiones de clientes. El primer PR de esta reorientación es de solo
> documentación y ya está en `main`; el tablero (`Prompts/COORDINACION.md`)
> lo actualizás vos como primer paso.

### F-1 — Cierre de las sesiones abiertas (1,5 jornadas; rama `cierre/25-09`)
En este orden, cada paso con OK:
1. **Hotfix** en rama propia: `deleteMode` correcto en los tres flujos de
   reservas, verificado primero contra el paquete de npm
   (`npm pack @n8n/n8n-nodes-langchain@2.36.5`, memoria
   `parametros-de-nodos-n8n-desde-npm`), con prueba que lo fije; el hueco del
   candado cuando `agendar_cita` falla, en `Comprobar reserva`, con el caso
   «la herramienta falló y Verificar responde» en `candado-agenda`. Ensayo,
   PR, fusión, publicación en ventana de los tres flujos.
2. **Fusión de las cinco ramas de solo documentación**, en este orden y
   conservando ambos lados de `ESTADO.md`: `origin/estado/v0.9.0` (#182) más
   el commit local `estado/v0.9.0` con `Prompts/capacidades-comunes.md`;
   `prepago/tablero-al-dia`; `cierre/traspaso-25-09`;
   `claude/topes-campanas-confirmados`; `docs/planes-a-medida` (#184).
3. **Traspaso del chat interno:** subir la rama local
   `claude/novuchat-silvana-transfer-c40177`, PR, fusión. Los pasos de Meta
   quedan para la sesión de clientes de NovuChat.
4. **Origen del anuncio:** traer `main` a `medicion/origen-del-anuncio` (nunca
   reescribirla: está publicada), resolver el conflicto de
   `normalizar-entrada.js` derivando el origen del objeto `anuncio` que `main`
   ya arma, correr `ensamblar-flujo.mjs verificar`, la suite completa y
   `verificar-saneo.sh`; PR y fusión.
5. **Ayudante de configuración:** guardar el diseño de
   `claude/ai-config-helper-e3b434` como `Analisis/42-ayudante-de-configuracion-diseno.md`
   con una nota de que se rehace sobre `central/asistente` después de F6;
   cerrar la rama sin fusionar.
6. **Worktrees:** quitar los colgados de ramas ya fusionadas o cerradas.
7. **Matriz de capacidades** de los cinco flujos conversacionales (bloque 0 de
   `Prompts/capacidades-comunes.md`), solo lectura, entregada como
   `Analisis/41` anexo A.
8. `Prompts/COORDINACION.md` reescrito para este frente.
9. Los primeros commits con `Analisis/41` y los tres prompts.

**Costo:** 0 mensajes; unas 8 escrituras en GitHub y sus corridas de CI; 3
publicaciones en n8n. **Cierra H0 junto con E.**

### E — Actualización al estándar DevSecOps (1 jornada; rama `chore/estandar-devsecops-2.4`)
Según `~/SeguridadGeneral/Prompts/actualizar-repo-al-estandar.md`, bloques 0 a
3, **sin repartir entre agentes**. Estado medido el 25/09: al día
`release.yml`, `scorecard.yml`, `trivy.yaml`, el esquema y los dos scripts;
atrasados `_reusable-security.yml` (base del 14/09, falta 2.4),
`_reusable-dast.yml`, `codeql.yml`, `semgrep.yml`, `zap-rules.tsv` (solo
cabeceras del 22/09); modificados en NovuChat `gitleaks.toml`,
`security-local.sh`, `deploy.sh` y `.pre-commit-config.yaml` (fusión de tres
vías conservando lo propio). La excepción de Trivy por `uuid` vence el 31/10:
revisar si el PR de Dependabot de `firebase-admin` la cierra. **Costo:** 1 PR,
una corrida de CI por push. **Cierra H0.**

### F1 — Ejes de la cuenta, vocabulario y consola del propietario (2,5 jornadas)
Lo del §7 de `Analisis/41`: `modalidad` independiente del plan; `titularidad`
por número en `rutasWhatsApp`; `modelo` por tenant; `cambiosIncluidos` con
contador en el servidor y prueba negativa; renombres en consola (Producción,
Cobros, Pagar); `asignar-plan` escribe los tres ejes; migración por script de
`plan: 'demostracion'` y `pagaMeta` en los tenants reales (cinco), en seco primero y
releída después; Negocios (Plataforma) con carga manual de pago, suspender y
reactivar, cambiar plan, modalidad, titularidad y umbrales, y encender el
corte. **Costo:** 0 mensajes; PR por agente; un despliegue (etiqueta) al
cerrar. **Cierra H1.** *(Hecha el 26/09, `v0.10.0`.)*

### F1b — Copia de límites y precio por contrato (0,5 a 1 jornada, agente `central`, antes de F2)
Lo del §4 punto 5 de `Analisis/41`: `asignar-plan.mjs --conversaciones`,
`--cambios` y `--precio` escriben la copia `cuenta/estado.limites` y el precio
mensual del comercio, con `--operador` obligatorio y auditoría; `asignarEjes` lo
mismo desde Negocios; Negocios lo muestra; el pago manual de Negocios acepta el
precio del contrato y rechaza otro. Pruebas negativas: un admin no lo escribe,
la copia manda sobre el plan, un precio fuera de contrato se rechaza. No mueve
archivos ni toca flujos. **Costo:** 0 mensajes; un PR; sin despliegue propio,
entra con la etiqueta de F2. **Cierra H1b.** Platinum lo espera (USD 120 por
500); Dhermacore, los cambios pactados.

### F6 — Método (1,5 jornadas, en paralelo con F1 a F3)
`docs/arquitectura/` por zona y por módulo con `indice.md` que mapea cada
sección vieja de `DISENO.md` a su archivo; `bitacora/<aaaa-mm>.md` solo para
agregar y `ESTADO.md` de una pantalla que se reescribe; script de estado
generado (etiqueta viva, Functions desplegadas, flujos publicados con versión
de módulos, tenants con modalidad); `CLAUDE.md` con solo invariantes (las
cifras y la tabla del §7 van a `docs/arquitectura/` y a la base comercial);
gancho de Claude Code sobre Edit y Write que limita a cada agente a su
carpeta, probado con un intento fuera de carpeta; agentes por zona en
`.claude/agents/`, y el agente `analista-de-solicitudes` (solo lectura,
produce `solicitudes/<n>.md` según `Analisis/41` §12.4); separar pruebas puras
de las del emulador; `docs/clientes/CICLO-DE-VIDA.md` con las ocho etapas del
§12.2. **Costo:** 0 mensajes; PR por bloque. **Cierra H6**, que puede
cerrarse antes que H3.

### S — Staging (1 jornada, agente `deploy`, en paralelo con F1 y F2)
Proyecto Firebase de staging con variables `VITE_*` por Environment (nunca las
de producción), secreto de ingesta propio, `desplegar-staging` y `dast-y-humo`
sin omitirse, humo según `Analisis/28`. Escrituras en la nube solo con OK por
paso. **Tiene que existir antes del ensayo de F3.** **Cierra con H3.**

### F2 — Carpetas, registro y frontera (2,5 jornadas)
Primero el agente de diseño (`Plan`) entrega la forma de `registro.ts` y el
orden de movimiento. Después, en paralelo: mover archivos a `core/`,
`central/`, `plataforma/`, `modulos/<m>/` en Functions, consola, `Flujos/src`
y pruebas **sin cambiar lógica** (`index.ts` reexporta desde las carpetas
nuevas para no cambiar lo desplegado); `registro.ts` con los manifiestos;
`fronteras.test.ts` y `registro.test.ts`; extraer los Code de Demo B y
captación con `ensamblar-flujo.mjs extraer`; `tenants.modulos` reemplaza a
`flujos` con migración; `tieneModulo` en reglas; límite de agendas por plan;
chequeos que faltan en inventario y catálogo; `Flujos/manifiestos/` para los 8
flujos; `Flujos/<tenant>.json` con cabecera «generado» y gancho de pre-commit
que exige `verificar`. **Costo:** 0 mensajes; un PR por agente. **Es el primer
despliegue con clientes pagando:** staging con facturación antes, o `firebase
deploy --dry-run` leído entero en la aprobación y verificación de las Functions
HTTP después, declarado en el informe; la migración de `tenants.modulos` en
ventana, con respaldo y vuelta atrás escrita antes de correrla. **Cierra H2**,
con etiqueta, despliegue y publicación de los 8 flujos.

### F3a — Esqueleto de venta (2 jornadas, después de H2)
La mitad de F3 que todo cliente de venta necesita (Edgar, Dhermacore, Q'Taco);
los flujos de reservas ya la tienen (anexo A). Sobre `Flujos/src` extraído en
F2, agentes `core-flujos` y `modulo` (cobros, captacion): medios (audio,
imagen, documento) en el core para los tres esqueletos, con categorías por
módulo (bloques 1 a 3 de `Prompts/capacidades-comunes.md`); transferencia con
aviso y botón, y fallo del modelo con botón, en el esqueleto de venta y en
captación (la política del 21/09); prohibición 4 en código en la variante común
(`NIEGA_IA`); campaña por texto en venta; embudo único de salida; gancho de
Inventario que respeta `agotado`; ids de credencial vacíos y `REEMPLAZAR_*` solo
en `Config base` o declarado (anexo A, brechas 1 a 6, 8 y 9). Ensayo real en el
TENANT de ensayo de venta con audio, foto, PDF y foto sin contexto, y el caso
«verbo no previsto y la herramienta sí corrió», con identificadores de
ejecución. **Costo:** 0 mensajes; etiqueta, despliegue y publicación de Demo B
y captación desde `main`. **Cierra H3a.** La sesión de Edgar ensambla su flujo
de esta salida, sin nodo propio.

### F3b — Core unificado de reservas (2 jornadas, después de H3a)
Ganchos registrados en lugar de importaciones en `ingesta.ts`; una sola
variante de `Normalizar entrada`, `Config del negocio`, `Procesar respuesta`,
`Uso extendido` y `Comercio no operativo` para los tres esqueletos; el estado de
la conversación por teléfono en el servidor (`Analisis/41` §2.2: hoy en
`$getWorkflowStaticData` por #197 y en un nodo propio de Bellido); prompt por
capas (base + módulos + variables del tenant); las suites importan
`Flujos/src/` en vez de `new Function`; el corpus de captación sale del nodo
Code; barrera de horas libres rechazadas en `modulos/agenda`. Ensayo real en el
TENANT de ensayo de reservas; Bellido se porta con
`sincronizar-flujo-cliente.mjs --base` y se ensaya antes de publicar. **Platinum
no se publica hasta que su sesión haya alineado `platinum-agendamiento.json` y
`negocio-platinum.json` con producción** (tercera agenda, estética facial,
emojis, Maps). **Costo:** 0 mensajes; etiqueta, despliegue y publicación de los
8 flujos en ventana; las sesiones de Bellido y Platinum re-aceptan solo el
delta. **Cierra H3b.** Ya no bloquea a ningún cliente.

### F4 — Conector de canal fuera de n8n (5 jornadas, después de H3b y del primer cliente pagador)
Function receptora del webhook de Meta (firma con el App Secret por
`phone_number_id`, acuse inmediato, deduplicación, descarga de medios,
normalización) que llama a n8n por webhook genérico firmado con el patrón de
`catalogoWeb.ts`; Function `enviar` con la credencial en Secret Manager y
traducción de opciones; `/rutas/{canal}/{id}`; `contactoId` con prefijo; el
flujo cambia el disparador y quita envío y descarga; instancias mínimas;
latencia p50 medida antes y después. Un número por ventana de mantenimiento,
con vuelta atrás = reactivar el disparador anterior. **Costo:** 0 mensajes;
un salto de red por mensaje. **Cierra H5 con F5.**

### F5 — Tenants como datos (2 jornadas, junto con F4)
Los 19 nodos de Bellido a `modulos/menu-interactivo/` con bandera;
`platinum-flujo` y `bellido-flujo` repartidas en módulos y pruebas de instancia
cortas; `docs/versiones-por-cliente.md` con versión de módulo por tenant;
`estado-de-versiones.sh` compara además el JSON del cliente con sus módulos;
el ensayo sirve para clientes con módulos propios. **Costo:** 0 mensajes;
publicación de Bellido y Platinum en ventana.

### Lo que NO se construye ahora (y por qué)
- **Partir las Functions en varios paquetes de despliegue**: espera medir el
  arranque en frío y confirmar que Firebase mueve una función viva sin
  borrarla.
- **Messenger, Instagram, Telegram, chat web**: módulos del conector que F4
  habilita; se construyen con su oferta.
- **Tech Provider**: trámite de Meta en paralelo, no bloquea nada.
- **El ayudante de configuración**: se rehace después de F6.
- **Actualizaciones mayores de dependencias** mezcladas con cualquier fase.
- **Cambiar precios, planes, unidad de cobro ni umbrales.**
- **Atender pedidos de clientes**: es de las sesiones de clientes.

## Entregables al cerrar cada hito
- El **informe de hito** en `Prompts/COORDINACION.md` (Andres lo pega en la
  sesión revisora): PR y sha fusionados; pruebas con sus números reales y los
  identificadores de ejecución del ensayo; costo en las tres unidades; lo que
  quedó fuera y por qué; lo que encontraste mal en `Analisis/41`.
- Un PR por bloque, con costo, pruebas, resultado real y revisión de
  `seguridad`.
- `ESTADO.md` (o la bitácora) al cerrar cada bloque; `estado-de-versiones.sh`
  8/8 cuando se publicó algo.
- Al cerrar el frente: la ficha `~/Claude-Proyectos/proyectos/novuchat.md`
  con las zonas, el registro de módulos y el conector como módulos
  reutilizables; y las memorias del proyecto que hayan quedado viejas
  (`modularizacion-*`, `campanas-estado-al-cierre-24-09`,
  `planes-a-medida-vitrina-y-mostrador`) corregidas.
