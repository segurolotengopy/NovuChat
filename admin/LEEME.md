# admin/ — Panel administrativo de NovuChat

Pista **paralela** a los demos del 9 y 10 de septiembre. No los bloquea y no toca
nada de `Flujos/`.

- **`DISENO.md`** — arquitectura, modelo de datos, matriz de roles, la decisión
  sobre el proyecto Firebase y la integración con n8n.
- **`SEGURIDAD.md`** — cada regla de seguridad mapeada al diseño, más el modelo
  de amenazas del aislamiento multi-tenant.
- **`firestore.rules`** — el corazón del aislamiento. Está comentado de punta a
  punta: si va a tocar una sola cosa de este directorio, lea eso.

## Estado

| | |
|---|---|
| Andamiaje | escrito y compilando |
| Pruebas de reglas | **179 de 179 en verde**, ejecutadas contra el emulador |
| Pruebas puras (saneo, ranuras, índices, rótulos) | **31 de 31 en verde** |
| Prueba a mano del panel | **recorrida de punta a punta** contra los emuladores, con datos sembrados |
| Recursos de nube | **ninguno creado.** Ver `DISENO.md` §11 |

## Probar el panel a mano (secuencia completa y probada)

Requiere Node 24, pnpm y un JDK. Todo local, con un proyecto ficticio `demo-*`:
no toca ningún recurso en la nube ni usa ninguna sesión de Firebase o gcloud.

### ⚠️ Antes que nada: el límite de inotify

**En esta máquina hay que arreglar esto primero, o nada arranca.** El kernel
tiene un tope de *instancias* de inotify y ya está casi lleno:

```bash
cat /proc/sys/fs/inotify/max_user_instances      # 128
find /proc/*/fd -lname 'anon_inode:inotify' | wc -l   # 110
```

Cuando se agotan, **el emulador de Firestore y el servidor de Vite fallan los
dos** con el mismo error de fondo:

```
Error: ENOSPC: System limit for number of file watchers reached,
       watch '.../admin/firestore.rules'
```

…que el CLI de Firebase tapa con un **`Error: An unexpected error has
occurred.`** genérico. Ese mensaje hizo perder un buen rato: parece «puerto
ocupado» y no lo es.

**El arreglo, una sola vez, requiere sudo** (por eso no lo puede hacer un
agente):

```bash
echo 'fs.inotify.max_user_instances=1024' | sudo tee /etc/sysctl.d/99-inotify.conf
sudo sysctl --system
```

Mientras tanto hay rodeos, y son los que usan los scripts de acá:
`scripts/emuladores.sh` arranca Firestore por el jar (sin el vigilante del CLI) y
Auth por separado, y `pnpm web:dev:sondeo` hace que Vite vigile por sondeo en vez
de por inotify. **Si el emulador no arranca, mire esto antes de sospechar del
script.**

### Los tres pasos

```bash
# Terminal 1 — emuladores de Auth y Firestore (dejar abierta)
cd admin && pnpm emuladores

# Terminal 2 — datos de prueba (idempotente: se puede repetir)
cd admin && pnpm sembrar

# Terminal 3 — el panel
cd admin && pnpm web:dev:sondeo      # con el arreglo de inotify: pnpm web:dev
```

Y entrar a **http://127.0.0.1:5230**.

### Con qué usuario entrar

| Pestaña | Usuario | Rol | Contraseña |
|---|---|---|---|
| Soy de NovuChat | `andres@ejemplo.com` | superadministrador | *(Google, sin contraseña)* |
| Soy de NovuChat | `silvana@ejemplo.com` | superadministrador | *(Google, sin contraseña)* |
| Soy un comercio | `admin.aurora@ejemplo.com` | admin de Salón Aurora (**activo**) | `NovuChat-Demo-2026` |
| Soy un comercio | `operador.aurora@ejemplo.com` | operador de Salón Aurora | `NovuChat-Demo-2026` |
| Soy un comercio | `admin.fogon@ejemplo.com` | admin de Parrilla El Fogón (**suspendido**) | `NovuChat-Demo-2026` |

Con Google, el emulador abre un selector con las dos cuentas **ya creadas**: se
elige una y listo, no hace falta *Add new account*.

### Qué mirar

- **El aislamiento, a ojo.** Entre como `admin.aurora` y pida a mano
  `/negocio/parrilla-el-fogon/conversaciones`: sale «Sin permiso». Después entre
  como `admin.fogon` y compruebe que solo ve lo suyo.
- **El comercio suspendido.** `admin.fogon` ve sus conversaciones, su
  configuración y sus métricas, **pero no puede editar nada**, y en *Cuenta* lee
  el motivo de la suspensión. Es la coherencia del diseño: si conserva la vista,
  tiene que ver por qué se le cortó el servicio.
- **Los roles en el menú.** El operador ve tres entradas (Conversaciones, Uso,
  Reclamos); el administrador ve siete.
- **El escapado.** En Salón Aurora hay una conversación *«Prueba de escapado»*
  con `<img onerror>`, `<script>` y un intento de inyección de prompt. **Tiene
  que verse como texto**. Si aparece una imagen rota, o cambia el título de la
  pestaña, hay un defecto de seguridad.
- **La columna «Aviso» de Reclamos.** Uno de los tres figura como *Pendiente*:
  es el que no se notificó por correo. Sin ese caso, un canal de correo caído
  sería invisible.

### Detalles del entorno

- **Puertos.** El entorno de trabajo a mano usa Firestore **8232** y Auth
  **9299**; las pruebas usan Firestore **8231**. Están separados a propósito:
  se puede dejar todo levantado y correr `pnpm pruebas:reglas` igual.
- **La interfaz del emulador** (http://127.0.0.1:4231/auth) muestra **solo
  Authentication**, porque Firestore se arranca por fuera del hub para esquivar
  el problema de inotify. Los datos de Firestore se ven en el panel.
- `web/.env.local` lo genera `pnpm emuladores` y está en `.gitignore`.
- `pnpm sembrar:limpio` borra lo sembrado y vuelve a empezar.

## Cómo trabajar

Requiere Node 24, pnpm y un JDK (para el emulador de Firestore).

```bash
cd admin
pnpm install

pnpm pruebas:reglas     # emulador + 164 pruebas (155 de reglas, 26 puras)
pnpm emuladores         # Auth + Firestore para probar a mano
pnpm sembrar            # datos de prueba (idempotente)
pnpm csp                # sirve dist con las cabeceras REALES de Hosting
pnpm web:build          # compila el frontend
pnpm functions:build    # compila las Cloud Functions
pnpm verificar          # las tres cosas
```

**Antes de dar por bueno cualquier cambio en `firestore.rules`, corra
`pnpm pruebas:reglas`.** Es el único control automático que impide que una
edición bienintencionada abra el paso entre negocios.

⚠️ **Y si agrega pruebas, agregue también el documento a la semilla.** Casi todas
las pruebas son `assertFails`, y una prueba así pasa igual de bien cuando la
regla deniega que cuando el documento **no existe**: el error es
`permission-denied` en los dos casos. Ya pasó una vez —ocho pruebas de contactos
en verde sin que existiera un solo contacto—. El bloque *Control de la semilla*
está justamente para detectarlo: verifica que cada documento que las demás
pruebas dan por sentado exista de verdad.

### Dos rarezas del entorno, ya documentadas

1. `firebase emulators:exec` falla en la máquina de desarrollo (reporta "port
   taken" en cualquier puerto y deja el proceso Java huérfano). Por eso
   `pnpm pruebas:reglas` llama a `pruebas/correr.sh`, que invoca el jar del
   emulador directamente. En GitHub Actions el CLI funciona normalmente.
2. Los `evaluation error` en el log del emulador son **benignos**: los produce la
   doble evaluación de las escrituras con `serverTimestamp()`. Explicado en la
   cabecera de `pruebas/reglas.test.ts` y en `SEGURIDAD.md`.

## Antes del primer despliegue

Lea `DISENO.md` §11: hay 16 pasos que requieren una persona con acceso a Google
Cloud y a GitHub. Los tres que más fácil se hacen mal:

- **La condición de atributos de Workload Identity Federation.** El repositorio
  es público; una condición laxa deja que un fork obtenga credenciales.
  `SEGURIDAD.md` §4 tiene la expresión concreta.
- **El workflow ya está en `.github/workflows/despliegue-admin.yml`** y convive
  con el pipeline del estándar DevSecOps. Revise que los dos no se pisen: ambos
  disparan sobre `admin/**`.
- **Presupuesto con alerta en el plan Blaze.** No tiene tope duro.

## Prohibiciones propias de este directorio

1. **Ninguna clave JSON de cuenta de servicio.** Ni en el repositorio, ni en n8n,
   ni en los secretos de GitHub. El despliegue usa OIDC; la ingesta usa HMAC por
   negocio.
2. **Nunca `dangerouslySetInnerHTML`, `innerHTML`, `eval` ni `new Function`.** El
   panel muestra texto escrito por desconocidos. El CI rompe la compilación si
   aparecen.
3. **Nunca borrar la negación final de `firestore.rules`.** El CI también la
   verifica.
4. **El rol nunca sale de un documento de Firestore**, siempre de los custom
   claims. `/tenants/{t}/miembros` es un espejo para pintar la interfaz.
5. **Los identificadores de negocio no se reutilizan**, ni los dados de baja.
   Tampoco los `phone_number_id`: un número asignado a un comercio no se
   reasigna a otro sin liberarlo primero.
6. **Nunca revelarle al cliente final el motivo comercial de una suspensión.** El
   mensaje de cortesía es neutro y está fijo en el código.
7. **Una identidad, un proveedor.** Superadministradores solo con Google;
   comercios solo con contraseña; ingesta solo con token personalizado. El
   vínculo vive dentro de los predicados base de `firestore.rules` y en
   `claims.ts`. **No lo saque de los predicados** para "simplificar": ahí es
   donde lo heredan todas las reglas, incluidas las que se escriban mañana.
8. **El texto de un reclamo sale ESCAPADO desde `saneo.ts`, y el destino del
   correo nunca sale del reclamo.** Las dos cosas son controles, no detalles.
   El proveedor es **FormSubmit** (sin credencial) y compone el correo en HTML:
   por eso el escapado se hace en origen. Si algún día se vuelve a Resend, el
   escapado se puede aflojar pero conviene no hacerlo (DISENO.md §4ter.4).
   **Nunca vuelque los campos del reclamo al cuerpo de la petición con un
   spread:** `_cc`, `_replyto` y compañía son instrucciones de FormSubmit.
9. **Al editar `firestore.rules`, REINICIE `pnpm emuladores`.** Invocar el jar
   directamente —el rodeo por inotify— pierde la recarga en caliente que hacía el
   vigilante del CLI. Si no reinicia, sigue probando contra las reglas viejas.
10. **El emulador NO exige índices compuestos.** Un filtro nuevo puede pasar todo
    lo local y fallar en producción. Declare la forma de consulta en
    `web/src/lib/bitacora.ts` y corra `pnpm pruebas:reglas`:
    `pruebas/indices.test.ts` le va a decir qué índice falta.
11. **La CSP no se puede probar con `pnpm web:dev`.** Vite no aplica las
    cabeceras de `firebase.json`: un error de política aparece recién en
    producción. Use `pnpm csp` y mire la consola del navegador — cualquier
    «Refused to» es una violación. Si toca la política, pruébela ahí.
12. **Los rótulos del cobro simulado y `mediaIdQr` NO los edita el comercio.**
    Sostienen la prohibición 3 de CLAUDE.md. Viven en `/plataforma/cobroSimulado`
    y los registra NovuChat. No los mueva a la configuración del comercio.
13. **El ID de calendario se valida con 64 hexadecimales EXACTOS**, y el sufijo
    decide antes que la forma de correo. Las dos trampas están explicadas en
    `firestore.rules` y en `scripts/fijar-calendario.sh`. No aflojar ninguna.
14. **Datos de prueba:** teléfonos con seis o más ceros seguidos
   (`59170000001`) y correos `@ejemplo.com`. Es lo que acepta la lista de
   admitidos de `scripts/verificar-saneo.sh`.
15. Se respeta `CONVENCIONES-REPO-PUBLICO.md`: ningún valor real de
    infraestructura en un archivo versionado.
