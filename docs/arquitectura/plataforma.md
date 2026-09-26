# Plataforma: lo que ve NovuChat como operador

> Zona de la arquitectura por capas (`Analisis/41-arquitectura-por-capas.md`
> §1 y §1.2). Manifiesto en prosa de la zona y destino de las secciones de
> `admin/DISENO.md` que le pertenecen; el mapa está en `indice.md`. Sin
> secretos ni identificadores.

## Definición

**Lo que ve NovuChat como operador: la consola del propietario.** La cambia
NovuChat.

Ejemplos: Negocios (alta, baja, suspensión, número, plan, modalidad,
titularidad), bitácora de plataforma, notificaciones, corte global del prepago,
rótulos del cobro simulado, tipo de cambio manual.

**Por qué una zona propia y no parte de Central** (`Analisis/41` §1.2): la
página Negocios, la bitácora de plataforma, las notificaciones y el corte global
son centrales en el sentido de que no dependen de ningún módulo, pero su
público es NovuChat, su proveedor de identidad es Google y no contraseña, y su
regla es «el propietario no lee conversaciones salvo ventana de soporte».
Mezclarlos con lo que ve el comercio es lo que hoy hace que `Tenants.tsx` y
`Bitacora.tsx` tengan dos caras. Separarlos evita que una pestaña del comercio
herede por accidente un permiso del operador.

**Dependencias permitidas:** Plataforma depende de Central y de Core.

**Es el único lugar donde se asignan los tres ejes de la cuenta** (plan,
modalidad, titularidad) y el modelo de IA por tenant (`tenants/{t}.modelo`).

## Inventario: qué es plataforma hoy y adónde va (`Analisis/41` §5)

| Pieza | Va a | Nota |
|---|---|---|
| `index.ts` (alta, baja, suspensión, número, plan, corte, soporte) | `functions/src/plataforma/tenants.ts` | Seis callables sin llamador (`liberarNumero`, `quitarUsuario`, `otorgarAccesoSoporte`, `revocarAccesoSoporte`, `configuracionParaFlujo`, `moverReclamo`): se conservan si un script o la consola los va a usar, si no se retiran |
| `/tenants/{t}` (ficha: `estado`, `flujos`, `plan`, `waPhoneNumberId`) | Plataforma escribe, Core lee | `flujos` → `modulos`; `vertical` se retira; se agrega `modelo` |
| `accesosSoporte`, `/plataforma/*`, `/cobrosPendientes`, `/cobrosResueltos` | Plataforma (y Central) | |
| `Tenants`, `Bitacora` (de plataforma) | `web/src/plataforma/paginas/` | Negocios asigna los tres ejes y el modelo |
| `admin/scripts/alta-comercio`, `asignar-numero`, `asignar-plan`, `asignar-rol`, `fijar-umbrales`, `superadmin`, `cargar-plataforma`, `fijar-tipo-cambio`, `migrar-*` | `admin/scripts/plataforma/` | `asignar-plan` escribe los tres ejes; nuevo `asignar-modulos` |

**F1 absorbe A-3b del prepago:** la página Negocios carga un pago a mano con
comprobante, suspende y reactiva, cambia plan, modalidad, titularidad y
umbrales, y enciende el corte.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4bis.3 (25/09/2026, líneas 497-548) -->

### 4bis.3 Habilitar y deshabilitar un comercio

**Suspender no es dar de baja.** Son cosas distintas y mezclarlas sale caro:

| | `suspendido` | `dado_de_baja` |
|---|---|---|
| Motivo típico | falta de pago | fin de contrato |
| El asistente atiende a los clientes finales | **no** | no |
| El comercio ve sus conversaciones, config y métricas | **sí** | no |
| El comercio edita algo | no | no |
| n8n escribe conversaciones nuevas | no | no |
| Claims de los usuarios | **intactos** | revocados |
| Cómo se revierte | un clic, instantáneo | hay que volver a invitar a cada usuario |

**Qué deja de funcionar exactamente al suspender:**

- La ingesta se cierra: la regla `tenantOperativo()` niega toda escritura de
  conversaciones, mensajes, datos privados y métricas.
- La edición se cierra: configuración, catálogo, contactos y gestión interna de
  los hilos.
- `configuracionFlujo` devuelve **409** con el estado y un `mensajeCortesia`.

**Qué sigue funcionando:** la lectura del panel. La regla `tenantLegible()`
admite `activo` y `suspendido`. El comercio sigue viendo sus conversaciones
históricas, su configuración y sus métricas. Son sus datos, y quitarle la vista
no ayuda a cobrarle: le quita la manera de verificar lo que se le factura.

**Qué hace n8n.** Al recibir el 409, envía el `mensajeCortesia` y corta el turno:

> Gracias por escribirnos. En este momento no podemos atenderle por este medio.
> Le pedimos comunicarse directamente con el negocio.

**PROHIBIDO revelarle al cliente final el motivo comercial.** Quien escribe por
WhatsApp es un tercero que no tiene nada que ver con la relación entre NovuChat y
el comercio. Un mensaje que diga o insinúe que el negocio debe dinero daña al
comercio, daña a NovuChat y no cobra la deuda. El motivo se guarda en
`motivoSuspension` y en `/auditoria`, y no sale de ahí.

**Por qué la suspensión no toca los claims.** Es lo que la hace inmediata **en
los dos sentidos**. Si suspender revocara los claims, reactivar exigiría
reemitirlos y que cada usuario renovara su token: el comercio que acaba de pagar
seguiría sin servicio un rato largo, que es justo el peor momento para hacerlo
esperar. Al depender solo del campo `estado`, que las reglas consultan en cada
operación, el corte y la reanudación son instantáneos en ambas direcciones.

**Auditoría.** `suspenderTenant` y `reactivarTenant` escriben en `/auditoria` con
quién, cuándo y con qué motivo, y `/auditoria` no es escribible desde ningún
navegador: nadie puede fabricar ni borrar el registro de una suspensión.

**Requisito para n8n: no cachear la configuración más de 60 segundos.** Una
palanca comercial con un caché de una hora no es una palanca.


<!-- movido de admin/DISENO.md §6 (25/09/2026, líneas 3084-3103) -->

## 6. Alta de un cliente en 48 horas

La función `altaTenant` hace en una operación lo que hoy es una tarde de trabajo
manual:

1. Crea `/tenants/{id}` con `estado: 'activo'`.
2. Crea `/tenants/{id}/config/negocio` con los valores por defecto de Bolivia
   (`America/La_Paz`, `BOB`).
3. Crea el primer administrador y **le emite el custom claim**.
4. Escribe el evento en `/auditoria`.

**Pero `altaTenant` no alcanzaba para un cliente real**, y eso se descubrió el
2026-09-07 revisando el alta de punta a punta: la función exige que el
administrador **ya haya ingresado una vez** (`getUserByEmail`, y si no está,
`failed-precondition`). Un administrador de comercio entra con correo y
contraseña, y la consola **no tiene pantalla de registro**: nadie podía crearse
la cuenta. O sea que el alta era imposible, y el único script que creaba
usuarios —`usuarios-prueba.mjs`— usaba contraseñas escritas en el propio
archivo.


<!-- movido de admin/DISENO.md §6.1 (25/09/2026, líneas 3104-3136) -->

### 6.1 El procedimiento real, paso por paso

```bash
# 1. El negocio y su administrador, con enlace para que ponga su contraseña.
node admin/scripts/alta-comercio.mjs --proyecto <id> \
  --tenant salon-rosa --nombre "Salón Rosa" --flujos agendamiento \
  --admin ana@ejemplo.com --nombre-admin "Ana Quispe" --aplicar

# 2. El secreto del alias libre que sigue (cliente01, cliente02, …).
gcloud secrets versions access latest --secret=INGESTA_CLIENTE01 --project <id>
#    → se carga como credencial de cabecera en n8n, y NUNCA se escribe en el repo.

# 3. El número de WhatsApp y su alias. NO hay camino desde la consola: ninguna
#    pantalla llama a `asignarNumero`, las reglas prohíben escribir
#    /rutasWhatsApp desde un navegador, y la Function no escribe `aliasSecreto`
#    (descubierto el 2026-09-14, alta de NovuChat). Se hace con el SDK Admin:
node admin/scripts/asignar-numero.mjs --proyecto <id> --listar     # alias libres
node admin/scripts/asignar-numero.mjs --proyecto <id> --tenant salon-rosa \
  --numero <phone_number_id> --waba <waba_id> --flujo agendamiento \
  --alias cliente01 --aplicar
```

**Ni una línea de código, ni un despliegue.** Antes, cada cliente obligaba a
editar `SECRETOS_POR_ALIAS` y desplegar Functions: un procedimiento de
ingeniería en medio de una gestión comercial. La reserva de veinte alias
—declarada el 2026-09-07— lo eliminó. Ver el comentario de `firma.ts` para por
qué son veinte secretos separados y no un mapa, y por qué nacen con un valor
real en vez de un marcador.

**Cuando se acaben los veinte**, se amplía la reserva y se despliega UNA vez, no
una por cliente. Conviene hacerlo con holgura, no con el cliente veinte ya
firmado.


<!-- movido de admin/DISENO.md §6.2 (25/09/2026, líneas 3137-3150) -->

### 6.2 Lo que sigue siendo manual, por diseño

Conectar el número de WhatsApp del cliente en Meta: son trámites ante un tercero
que se miden en días y no dependen de NovuChat. Ver §4bis.4 para el techo de
crecimiento que imponen.

**Los identificadores de negocio no se reutilizan jamás**, ni siquiera los dados
de baja. Si se reutilizara `salon-x`, un claim viejo que todavía dijera
`{"salon-x": "admin"}` le daría al antiguo dueño acceso de administrador al
negocio nuevo que heredó el identificador. La baja es lógica y el identificador
queda quemado; `altaTenant` rechaza un identificador ya usado.

---
