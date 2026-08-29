# Guía de Meta para NovuChat — de cero al segundo número de prueba

> **Fuente única.** Esta es la única copia de la guía. `Flujos/` solo tiene un
> puntero a este archivo.
>
> **Objetivo de esta versión (2026-08-28):** obtener un **segundo número de
> prueba** de la WhatsApp Cloud API para el **Demo B (Venta y cobro)**, sin
> tocar nada de lo que ya funciona.
>
> **Tiempo:** 2 h 30 min efectivas para quien nunca usó Meta Business, en
> bloques pausables. Ninguno de los bloques cuesta dinero.
>
> **Estado de la decisión:** Andres resolvió el 2026-08-28 la **opción (a)**:
> portafolio comercial nuevo → segunda WABA → segundo número → dos flujos
> separados en n8n. Esta guía ejecuta esa decisión; no la discute.

---

## ⛔ Lo primero: qué NO se toca (prohibición 5 de CLAUDE.md)

En la misma cuenta de Facebook de Andres conviven **dos proyectos distintos**
que comparten la VM y, hoy, la WABA:

| | NovuChat (este proyecto) | WhatsApp-Modular (**ajeno, en producción**) |
|---|---|---|
| App de Meta | `NovuChat-Demo-A`, y ahora `NovuChat-Demo-B` | `Demo SeguroLo Tengo` |
| App ID | `${WA_APP_ID}` / `${WA_APP_ID_B}` | `${OTRA_APP_ID}` |
| Qué hace | demos comerciales | **sistema financiero real**: OTP por WhatsApp |
| Webhook | n8n en `${N8N_BASE_URL}` | `otp-service` en la misma VM |

**`Demo SeguroLo Tengo` y su WABA son un sistema financiero en producción.**
Si le cambia el webhook, le quita la suscripción o le revoca el token, deja de
llegar el OTP a usuarios reales.

### Cómo distinguirlos en pantalla, sin equivocarse

1. **En `developers.facebook.com` → Mis Apps**: la lista muestra el **nombre**
   y el **App ID** de cada app. Antes de tocar cualquier cosa, confirme que
   arriba de la pantalla dice `NovuChat-Demo-B` y que el App ID coincide con
   `${WA_APP_ID_B}`. Si dice `Demo SeguroLo Tengo`, salga.
2. **En `business.facebook.com`**: arriba a la izquierda hay un **selector de
   portafolio comercial**. Después del Bloque 1 habrá dos: el viejo (donde
   viven `Demo SeguroLo Tengo` y `NovuChat-Demo-A`) y el nuevo
   (`${WA_PORTFOLIO_B}`, solo NovuChat B). **Todo el trabajo del Demo B se
   hace con el portafolio nuevo seleccionado.**
3. **Regla práctica:** si en una pantalla ve aparecer la WABA `${WABA_ID}` (la
   compartida) mientras trabaja en el Demo B, está en el lugar equivocado. La
   del Demo B es `${WABA_ID_B}` y nace vacía en el Bloque 3.
4. **Nunca** agregue la app `NovuChat-Demo-B` como activo del usuario de
   sistema viejo si eso implica seleccionar la WABA compartida. El Bloque 6
   crea un usuario de sistema propio justamente para eso.

> Los valores reales de cada marcador `${...}` están en
> `CONFIGURACION.local.md` (ignorado por git). Este repositorio es **público**:
> ver `CONVENCIONES-REPO-PUBLICO.md`.

---

## Por qué hace falta un portafolio nuevo (el hallazgo que costó la mañana)

**El número de prueba gratuito es uno por PORTAFOLIO COMERCIAL, no por app.**

Cuando se creó `NovuChat-Demo-A` dentro del portafolio que ya existía, Meta no
creó una WABA nueva: colgó la app de la WABA que ya estaba ahí, la de
WhatsApp-Modular. Por eso el hilo de WhatsApp mostraba mensajes viejos del
otro proyecto.

La consecuencia para el Demo B es la que bloqueaba el diseño: **si dos apps se
suscriben a la misma WABA, cada mensaje entrante dispara los dos flujos**. El
cliente escribiría "Hola" y le contestarían Sofía (Demo A) y el asistente de
ventas (Demo B) a la vez. No hay forma de evitarlo desde n8n.

Un portafolio nuevo trae su propia WABA y su propio número de prueba. A partir
de ahí, cada demo tiene su número, su app, su webhook y su flujo, sin
interferencia.

### Los cuatro objetos que Meta mezcla y hay que saber separar

| Objeto | Dónde vive | Qué identifica | Marcador |
|---|---|---|---|
| **Portafolio comercial** (*Business Portfolio*) | `business.facebook.com` | la empresa | `${WA_PORTFOLIO_B}` |
| **App** | `developers.facebook.com` | el objeto técnico: App ID + App Secret | `${WA_APP_ID_B}` |
| **WABA** (*WhatsApp Business Account*) | dentro del portafolio | la cuenta de WhatsApp: contiene números y plantillas | `${WABA_ID_B}` |
| **Número** | dentro de la WABA | el emisor | `${WA_PHONE_ID_B}` |

Cadena: **Portafolio → App → producto WhatsApp → WABA → número.**

Y el dato que confunde a todo el mundo: **`PHONE_NUMBER_ID` no es el número de
teléfono.** Es un ID numérico largo que asigna Meta. El número que se ve
(`${WA_TEST_NUMBER_B}`) no se usa en ninguna llamada a la API.

---

## Regla de oro sobre secretos

Ningún valor secreto se pega en el chat, en un nodo de n8n, en un sticky note
ni en Git. Cada secreto va a **dos lugares y solo dos**:

1. El **gestor de contraseñas**.
2. La **credencial correspondiente en n8n** (almacén cifrado con
   `N8N_ENCRYPTION_KEY`, incluida en el respaldo diario de la VM).

En el nodo `Config del negocio` de los flujos solo van valores **no secretos**:
`phoneNumberId`, número del dueño, media ID del QR, versión del Graph API.

Para los comandos `curl` de esta guía, el token se carga en una variable de
entorno **sin que quede en el historial del shell**:

```bash
read -rs -p 'Token permanente: ' TOKEN; echo      # no se ve al escribir
```

---

## Bloque 0 · Preparación (10 min, sin computadora)

- [ ] Cuenta personal de **Facebook** activa (la misma sirve; Meta exige una
      cuenta personal para crear apps y portafolios).
- [ ] Los **5 destinatarios de prueba** del Demo B, en formato internacional.
      Sugerido: el celular de Andres, el de Silvana, el que hará de "dueño del
      negocio" en la mesa, y dos de reserva para el público.
      **El celular del "dueño" es imprescindible en el Demo B**: es el que
      suena con la alerta del pedido.
- [ ] Gestor de contraseñas abierto.
- [ ] Los tres teléfonos a mano: en varios pasos llega un código por WhatsApp
      que hay que tipear en el momento.

**Pausa segura:** sí.

---

## Bloque 1 · Crear el portafolio comercial nuevo (~15 min)

Este es el bloque que resuelve el bloqueo. Es nuevo respecto de la versión
anterior de esta guía.

1. Vaya a **https://business.facebook.com**.
2. Arriba a la izquierda hay un **selector con el nombre del portafolio
   actual**. Haga clic y elija **"Crear un portafolio comercial nuevo"**
   (en algunas versiones: *Crear una cuenta* / *Add new portfolio*).
3. Meta pide tres datos:
   - **Nombre del portafolio**: use algo inequívoco, por ejemplo
     `NovuChat Demos B`. Va a verlo muchas veces en el selector: que no se
     parezca al del otro proyecto.
   - **Su nombre** y **correo electrónico de trabajo**.
4. Confirme el correo desde el enlace que llega a la bandeja.

### Punto de verificación

En el selector de arriba a la izquierda ahora aparecen **dos portafolios**.
Al elegir el nuevo, **Configuración del negocio → Cuentas → Cuentas de
WhatsApp** está **vacío**. Eso es correcto: la WABA nace en el Bloque 3.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| "Ya alcanzaste el límite de portafolios comerciales" | Meta limita a 2 portafolios por cuenta personal sin verificación | Es el límite duro. Con dos alcanza para A y B. Si ya tenía dos, use el segundo existente **siempre que no contenga la WABA de WhatsApp-Modular** |
| El correo de confirmación no llega | Filtro de spam | Revise spam; reenvíe desde el aviso amarillo del panel |
| El portafolio nuevo aparece "restringido" | Meta pide verificación de identidad | No bloquea el número de prueba. Siga adelante; la restricción afecta anuncios, no la Cloud API de prueba |

**Pausa segura:** sí.

---

## Bloque 2 · Crear la app `NovuChat-Demo-B` (~15 min)

1. **https://developers.facebook.com** → **Mis Apps** → **Crear app**.
2. Caso de uso: la opción de **WhatsApp / Mensajería** ("WhatsApp Business
   Platform"; el rótulo exacto cambia seguido).
3. Tipo de app: **Empresa / Business**.
4. Nombre: `NovuChat-Demo-B`. **No incluya la palabra "WhatsApp"**: Meta
   rechaza los nombres que usan sus marcas.
5. **Portafolio comercial: elija el NUEVO** (`${WA_PORTFOLIO_B}`, el del
   Bloque 1). **Este es el paso que decide todo.** Si acá elige el portafolio
   viejo, la app volverá a colgarse de la WABA compartida y estará de nuevo en
   el bloqueo del principio.

Al terminar cae en el panel de la app. **Anote en el gestor:**

| Valor | Dónde está en pantalla | Destino |
|---|---|---|
| **App ID** (`${WA_APP_ID_B}`) | Arriba del panel, siempre visible | Gestor + `CONFIGURACION.local.md` + credencial *WhatsApp Trigger* en n8n |
| **App Secret** | **Configuración → Básica → Mostrar** (pide su contraseña de Facebook) | Gestor + credencial *WhatsApp Trigger* en n8n. **Nunca al repositorio** |

> El App Secret es la llave con la que n8n valida la firma de los webhooks.
> Trátelo como contraseña de producción desde el día uno.

### Punto de verificación

En **Configuración → Básica**, el campo **"Portafolio comercial"** dice el
nombre del portafolio **nuevo**. Si dice el viejo, borre la app y rehágala: es
más rápido que migrarla.

**Pausa segura:** sí.

---

## Bloque 3 · Agregar WhatsApp y obtener el segundo número (~15 min)

1. Panel izquierdo de la app → **Agregar producto → WhatsApp → Configurar**.
2. Meta pregunta a qué portafolio asociar el producto: **el nuevo**, otra vez.
3. Meta crea automáticamente una **WABA de prueba** y un **número de prueba**
   gratuito (típicamente +1 de EE. UU.).
4. En la pantalla **WhatsApp → API Setup / Configuración de la API**, anote:

| Valor | Aspecto | Destino |
|---|---|---|
| `PHONE_NUMBER_ID` (`${WA_PHONE_ID_B}`) | número largo bajo el número de teléfono | Nodo `Config del negocio` del flujo B (no es secreto) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` (`${WABA_ID_B}`) | otro número largo, más abajo | Credencial *WhatsApp* de n8n + `.env` para los scripts |
| Número visible (`${WA_TEST_NUMBER_B}`) | con formato `+1 (555) …` | Solo para saber a quién escribir en el ensayo |
| Token temporal | empieza con `EAA…` | **Caduca en 24 h.** Sirve para probar hoy; el definitivo sale en el Bloque 6 |

### Punto de verificación — el más importante de la guía

El `PHONE_NUMBER_ID` y el `WABA_ID` de esta pantalla **deben ser distintos**
de los del Demo A (`${WA_PHONE_ID}` y `${WABA_ID}`). Compárelos carácter por
carácter contra `CONFIGURACION.local.md`.

**Si son iguales, el número de prueba es el mismo y el bloqueo sigue vivo**:
la app quedó en el portafolio viejo. Vuelva al Bloque 2.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| No aparece ningún número de prueba, solo "Agregar número de teléfono" | El portafolio ya gastó su número de prueba (es el viejo) | Confirme el portafolio en Configuración → Básica |
| "Este portafolio ya tiene una cuenta de WhatsApp Business" y le ofrece la existente | Está en el portafolio viejo | Bloque 2, de nuevo |

**Pausa segura:** sí (el token temporal se regenera con un clic).

---

## Bloque 4 · Publicar la app en modo Live (~15 min) — ⚠️ crítico

**Por qué hace falta, y por qué esto costó horas la primera vez.** Una app de
Meta nace en **modo Desarrollo**. En ese modo, Meta **solo entrega los
webhooks de prueba que usted dispara a mano desde el panel**. Los mensajes
reales de WhatsApp **no llegan nunca** a n8n, y el panel no muestra ningún
error: simplemente no pasa nada. Se ve exactamente igual que un webhook mal
configurado, y se pierde la tarde buscando en el lugar equivocado.

1. Panel de la app → arriba, junto al nombre, hay un **interruptor
   Desarrollo / Activo (Live)**.
2. Al intentar moverlo, Meta pide dos cosas:
   - **URL de la política de privacidad**: en **Configuración → Básica**.
     Sirve cualquier URL pública que describa el tratamiento de datos (puede
     ser una página del sitio de NovuChat o un documento público).
   - **Categoría** de la app: *Empresa* / *Business* alcanza.
3. Guarde y mueva el interruptor a **Activo**.

### Punto de verificación

El interruptor queda en **Activo (Live)** y en verde, y en **Configuración →
Básica** no queda ningún campo obligatorio en rojo.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| El interruptor no se deja mover | Falta la URL de privacidad o la categoría | Complételas en Configuración → Básica y guarde antes de reintentar |
| "Se requiere verificación del negocio" | Está intentando publicar algo que no es el número de prueba | La **Business Verification NO hace falta** para el número de prueba. Revise que no haya agregado un número propio |
| Publicó, pero los mensajes siguen sin llegar | Falta `subscribed_apps` (Bloque 7) | Es la causa más frecuente. Vaya al Bloque 7 |

**Pausa segura:** sí.

---

## Bloque 5 · Registrar los destinatarios permitidos (~20 min)

Un número de prueba **solo puede escribirle a 5 números registrados**. A
cualquier otro, la API responde error y el mensaje se pierde. Es un límite de
Meta, no configurable.

1. **WhatsApp → API Setup**, campo **"Para" / "To"** → **Administrar lista de
   números de teléfono**.
2. Agregue cada celular en formato internacional (`+591…`, `+595…`).
3. A cada número le llega un **código por WhatsApp** que hay que tipear en el
   panel. Coordine con Silvana y con quien haga de "dueño" para que le pasen
   el suyo en el momento: el código vence en minutos.
4. Botón **Enviar mensaje** (plantilla `hello_world`).

### Punto de verificación

El `hello_world` llega a **cada uno de los 5 celulares**. Si llega, la cadena
Meta → WhatsApp funciona y todo lo que falle después está de n8n para acá.

Todo lo que envíe este número de prueba es **gratuito**.

### Si salió mal

| Error de la API | Causa | Solución |
|---|---|---|
| `(#131030) Recipient phone number not in allowed list` | El destino no está entre los 5 | Paso 1 de este bloque. **Es el error que verá si un asistente al demo escribe desde su propio celular** |
| `(#190) Access token has expired` | Pasaron 24 h del token temporal | Regenérelo, o complete el Bloque 6 |
| `(#100) Invalid parameter` en `to` | El número lleva `+`, espacios o guiones | Por API van **solo dígitos**: `59170000000` |
| `(#131047) Re-engagement message` | Mensaje libre fuera de la ventana de 24 h | En los demos no ocurre: el cliente siempre inicia |

**Pausa segura:** sí.

---

## Bloque 6 · Token permanente del usuario de sistema (~20 min) — ⚠️ crítico

El token temporal muere a las 24 horas. **Un token vencido a mitad de demo es
la falla clásica.** Se reemplaza por el de un *usuario del sistema*, que no
vence.

1. **business.facebook.com** → **seleccione el portafolio NUEVO** en el
   selector de arriba a la izquierda → ⚙️ **Configuración del negocio**.
2. Menú izquierdo: **Usuarios → Usuarios del sistema** → **Agregar**.
3. Nombre: `novuchat-demo-b-service`. Rol: **Administrador del sistema**.
   > **No reutilice** el usuario de sistema del portafolio viejo: eso lo
   > obligaría a manipular activos que pertenecen a WhatsApp-Modular.
4. Con el usuario seleccionado: **Agregar activos → Aplicaciones** →
   `NovuChat-Demo-B` → **Control total**.
5. **Agregar activos → Cuentas de WhatsApp** → la WABA nueva (`${WABA_ID_B}`)
   → **Control total**.
   > En esta pantalla debe aparecer **una sola** WABA. Si aparece también la
   > compartida, está en el portafolio equivocado: vuelva al paso 1.
6. **Generar nuevo token**:
   - **App:** `NovuChat-Demo-B`
   - **Vencimiento:** **Nunca**
   - **Permisos** (los dos, sin ninguno de más):
     - `whatsapp_business_messaging` — permite **enviar y recibir** mensajes.
     - `whatsapp_business_management` — permite **administrar la WABA**, y es
       el que habilita la llamada `subscribed_apps` del Bloque 7. Sin este, el
       Bloque 7 falla con un error de permisos que no dice cuál falta.
7. **Cópielo en el momento**: Meta no lo vuelve a mostrar. Va al gestor, a las
   credenciales de n8n (Bloque 8) y a la variable `WA_TOKEN` del `.env`.

### Punto de verificación

Con el token cargado en la variable `TOKEN` (ver *Regla de oro*):

```bash
curl -s "https://graph.facebook.com/v26.0/debug_token?input_token=$TOKEN&access_token=$TOKEN" \
  | python3 -m json.tool
```

En la respuesta debe leer:

- `"app_id"` = el App ID de `NovuChat-Demo-B` (`${WA_APP_ID_B}`) — **no** el
  del Demo A, y **no** el de `Demo SeguroLo Tengo`;
- `"expires_at": 0` (nunca vence);
- `"scopes"` incluye `whatsapp_business_messaging` **y**
  `whatsapp_business_management`.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| `app_id` es el del Demo A | En el paso 6 eligió la app equivocada del desplegable | Genere otro token con la app correcta |
| `expires_at` distinto de 0 | Dejó el vencimiento en 60 días | Genere otro con **Nunca** |
| Falta un scope | Se desmarcó un permiso | Genere otro; los tokens viejos se pueden invalidar después |
| `(#200) Requires business_management permission` más adelante | Falta `whatsapp_business_management` | Ídem |

**Pausa segura:** sí.

---

## Bloque 7 · `subscribed_apps` — el paso que NO existe en la interfaz (~10 min)

**⚠️ Este es el paso invisible.** Suscribir el campo `messages` en la pantalla
de webhooks **no alcanza**. Además hay que declarar que **esa WABA entrega sus
eventos a esa app**, y eso **no tiene ninguna pantalla en Meta**: solo se hace
por API. Fue la causa exacta de "no entra nada a n8n" en el Demo A, con el
webhook en verde y la app publicada.

Dicho en criollo: el webhook es *dónde* entregar; `subscribed_apps` es *que*
haya algo que entregar.

Con el token del Bloque 6 en la variable `TOKEN` y el `WABA_ID` del Demo B:

```bash
read -rs -p 'Token permanente: ' TOKEN; echo
WABA_B='...'        # el ${WABA_ID_B} de CONFIGURACION.local.md

# 1. Suscribir la app a la WABA
curl -s -X POST "https://graph.facebook.com/v26.0/${WABA_B}/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 2. Verificar
curl -s "https://graph.facebook.com/v26.0/${WABA_B}/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Punto de verificación

El paso 1 responde `{"success": true}`.

El paso 2 devuelve una lista donde figura **`NovuChat-Demo-B`** con su App ID
(`${WA_APP_ID_B}`).

**Y, sobre todo, la lista NO debe contener `Demo SeguroLo Tengo`.** Si lo
contiene, está operando sobre la WABA compartida y acaba de meter el flujo del
Demo B en el camino del sistema de OTP: quite la suscripción de inmediato con

```bash
curl -s -X DELETE "https://graph.facebook.com/v26.0/${WABA_B}/subscribed_apps" \
  -H "Authorization: Bearer $TOKEN"
```

y revise que `WABA_B` sea `${WABA_ID_B}` y no `${WABA_ID}`.

### Atajo con el script del repositorio

`scripts/verificar-meta.sh` hace esta comprobación y otras tres, pero lee sus
valores de `.env`, que hoy apunta al Demo A. Para usarlo con el Demo B hay que
cargar las variables del B (`WA_TOKEN`, `WA_APP_ID`, `WABA_ID`, `WA_PHONE_ID`,
`N8N_WEBHOOK_URL`) antes de invocarlo. `--suscribir` corrige la suscripción
faltante sin salir del script.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| `(#200) Requires business_management permission` | Al token le falta `whatsapp_business_management` | Bloque 6 |
| `(#100) Unsupported post request … does not exist` | El `WABA_ID` está mal, o puso el `PHONE_NUMBER_ID` en su lugar | Son dos IDs distintos. Tome el `WABA_ID` de WhatsApp → API Setup |
| `{"data": []}` en la verificación | El POST no se ejecutó | Reintente el paso 1 y mire su respuesta |
| Todo en verde pero no entra nada a n8n | Falta el webhook (Bloque 9) o el flujo no está publicado | Bloque 9 |

**Pausa segura:** sí. **Este bloque y el 9 se hacen juntos o no funciona nada.**

---

## Bloque 8 · Importar el flujo B y cargar credenciales en n8n (~30 min)

Todo en `${N8N_BASE_URL}`, con la **cuenta propietaria** (en n8n Community los
flujos no se comparten entre usuarios: la cuenta de Andres es la dueña de lo
productivo).

### 8.1 Importar primero

**Workflows → ⋯ (tres puntos, arriba a la derecha) → Import from File** →
`NovuChat/Flujos/demo-b-venta-cobro.json`.

Los avisos rojos de "credencial no seleccionada" son esperables: se resuelven
abajo. Guarde (**Save**) pero **no publique todavía**.

### 8.2 Corregir el disparador a mano — ⚠️ trampa conocida

Abra el nodo **WhatsApp Trigger**. **El parámetro `Trigger On` llega vacío al
importar un JSON generado fuera de n8n.** Hay que:

- seleccionar **Messages** a mano;
- dejar **Receive Message Status Updates** **sin ningún valor** — si se
  marca, cada acuse de entrega genera una ejecución basura que ensucia el
  historial y consume cuota.

### 8.3 Credenciales

**Credentials → Add credential**, tres credenciales nuevas y propias del
Demo B (no reutilice las del Demo A: apuntan a otra app):

1. **WhatsApp Trigger** — tipo *WhatsApp Trigger*. App ID y App Secret del
   Bloque 2.
2. **WhatsApp** — tipo *WhatsApp API*. Token permanente (Bloque 6) y
   Business Account ID `${WABA_ID_B}` (Bloque 3). Se asigna a los nodos
   **Responder al cliente** y **Avisar al dueño**.
3. **Header Auth** — Name: `Authorization`, Value: `Bearer <token
   permanente>`. Se asigna a los dos nodos HTTP: **Lista interactiva de
   bienvenida** y **Enviar QR (imagen DEMO)**. El token queda en la
   credencial, nunca en el nodo.
4. **Google Gemini** — API key de Google AI Studio.
   **Elija el modelo del desplegable, nunca lo escriba a mano.** Gemini
   devuelve **503 en picos de demanda**; el nodo del modelo ya viene con
   *Retry On Fail* activado en el JSON. Para cerrar el riesgo del todo,
   evalúe habilitar facturación en AI Studio: da capacidad prioritaria y el
   costo de un demo conversacional es marginal.

> **Solo para el Demo A, que sí usa calendario:** la credencial de Google
> Calendar debe ser del tipo **`Google Calendar OAuth2 API`**, no la genérica
> `Google OAuth2 API` (esa exige el campo *Scope* y el nodo no la acepta).
> Créela **desde el nodo**, así queda del tipo correcto. Y el Client ID y el
> Client Secret tienen que salir del **mismo** cliente OAuth: mezclar dos
> clientes produce `Client authentication failed`. Descargue el JSON del
> cliente desde Google Cloud y copie de ahí, nunca de la pantalla.

### 8.4 Completar `Config del negocio`

Es el **único** nodo que se toca para poner en marcha el flujo (y el único que
se edita para instalar un cliente nuevo). Campos `REEMPLAZAR_…`:

| Campo | De dónde sale |
|---|---|
| `phoneNumberId` | `${WA_PHONE_ID_B}` del Bloque 3 |
| `numeroDueno` | El celular que sonará "del negocio" en la mesa, **solo dígitos, sin `+`**. Tiene que estar entre los 5 registrados del Bloque 5 |
| `qrMediaId` | Bloque 10 |

El resto (`nombreNegocio`, menú, catálogo, precios, costo de delivery,
recargo de flota, tiempos, moneda, horario y los textos del rótulo de
demostración) ya trae valores de demostración y se edita solo si Silvana
quiere otros. **No hay contenido de negocio fuera de este nodo:** el System
Message del agente lee todo por expresión.

### Punto de verificación

Ningún nodo con triángulo rojo. El nodo **WhatsApp Trigger**, ya con
credencial, muestra dos URLs: **Test** y **Production**.

**Pausa segura:** sí.

---

## Bloque 9 · Conectar el webhook (~15 min) — ⚠️ crítico

1. En n8n, **publique** el flujo (botón **Publish** / interruptor *Active*,
   arriba a la derecha). **Sin publicar, la URL de producción no responde y la
   verificación de Meta falla.** En n8n cada cambio posterior exige volver a
   pulsar **Publish** para que llegue a producción.
2. Copie del nodo WhatsApp Trigger la **URL de Production**.
   **No la de Test.** La de Test (`/webhook-test/…`) solo vive mientras el
   editor está escuchando: sirve para probar a mano y **muere al cerrar la
   pestaña**. Si la pega en Meta, la verificación pasa en verde una vez y
   después no llega nada nunca más.
3. Panel de la app en `developers.facebook.com` → **WhatsApp → Configuración
   → Webhooks → Editar**:
   - **URL de devolución de llamada:** la URL de Production.
   - **Token de verificación:** una cadena **que usted inventa en ese
     momento**. **No se configura en n8n.** El nodo WhatsApp Trigger responde
     el `hub.challenge` automáticamente, así que esa cadena no se pega en
     ningún otro lado; guárdela en el gestor solo por si Meta la vuelve a
     pedir.
   - **Verificar y guardar**.
4. **Administrar → suscribirse a `messages`.** Es imprescindible: incluye los
   mensajes entrantes. Los acuses de estado que llegan por el mismo campo los
   descarta el nodo `¿Es un mensaje?` del flujo. Opcional y recomendable:
   `account_update` (avisos de calidad del número).

### Punto de verificación

El webhook queda **en verde** y el campo `messages` aparece **suscrito**. Con
el flujo publicado:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "<URL_DE_PRODUCTION>?hub.mode=subscribe&hub.verify_token=x&hub.challenge=12345"
```

debe devolver **200**.

### Si salió mal

| Qué ve | Qué pasó | Qué hacer |
|---|---|---|
| "No se pudo validar la URL de devolución de llamada" | El flujo no está publicado, o pegó la URL de Test | Publique y use la de Production |
| Verde, pero no entra nada | Falta `subscribed_apps` (Bloque 7) o la app está en Desarrollo (Bloque 4) | Los dos son invisibles desde esta pantalla |
| El `curl` devuelve 404 | Flujo despublicado, o la URL está incompleta | La URL termina en `/webhook`; cópiela entera |

> **No toque el webhook de `Demo SeguroLo Tengo`.** Cada app tiene **una sola**
> URL de webhook, y la de esa app apunta al `otp-service`. Por eso NovuChat usa
> apps propias.

**Pausa segura:** sí.

---

## Bloque 10 · El QR de demostración por media ID (~10 min)

**La imagen del QR no necesita hosting público.** Se sube una vez a la propia
Cloud API y Meta devuelve un **media ID válido 30 días**. Evita depender de un
servidor de imágenes en plena demostración.

```bash
read -rs -p 'Token permanente: ' TOKEN; echo
PHONE_B='...'       # el ${WA_PHONE_ID_B}

curl -s -X POST "https://graph.facebook.com/v26.0/${PHONE_B}/media" \
  -H "Authorization: Bearer $TOKEN" \
  -F "messaging_product=whatsapp" \
  -F "file=@Demo-Recursos/qr-demo.png;type=image/png" | python3 -m json.tool
```

(`scripts/subir-qr.sh` hace exactamente esto leyendo del `.env`.)

Pegue el `id` devuelto en el campo **`qrMediaId`** del nodo `Config del
negocio`. El nodo `Enviar QR (imagen DEMO)` lo usa automáticamente; si deja
`qrMediaId` vacío, cae en `qrUrl` (URL pública).

> **El media ID queda ligado al número que lo subió.** El del Demo A **no
> sirve** para el Demo B: hay que subir la imagen de nuevo con el token y el
> `PHONE_NUMBER_ID` del Demo B.

### Punto de verificación

La respuesta trae `{"id": "…"}`. Al ejecutar el demo, el QR llega al celular
**con la imagen rotulada y con el epígrafe de demostración**.

> **Prohibición 3 de CLAUDE.md, innegociable:** el rótulo va **impreso en la
> imagen** *y* en el epígrafe. Si alguna vez cambia `qr-demo.png`, la imagen
> nueva tiene que llevar el rótulo impreso. El flujo garantiza el epígrafe y
> el texto, pero **no puede rotular una imagen que llegue sin rótulo**.

**Pausa segura:** sí (el media ID dura 30 días: si lo sube el 1/09, cubre los
demos del 9 y 10/09 con holgura).

---

## Bloque 11 · Prueba de humo de punta a punta (~20 min)

Desde uno de los 5 celulares registrados, al número `${WA_TEST_NUMBER_B}`:

1. **"Hola"** → llega la **lista interactiva** de 3 opciones con el pie
   "Demostración NovuChat · los cobros son simulados".
2. **Un sticker** → respuesta cortés "por ahora atiendo por texto", sin
   ejecución fallida.
3. **"¿sos un robot?"** → el agente dice que es un asistente virtual con IA.
   No lo niega (prohibición 4).
4. **Pedido completo** → total desglosado → llega el **QR rotulado** →
   foto del comprobante → confirmación que dice **"simulado"** → y la
   **alerta al celular del dueño**, también rotulada como demostración.
5. **Dos celulares a la vez**, conversaciones distintas → cero cruce de
   contexto.
6. **Escribir al número del Demo A mientras el B está publicado** → responde
   **solo** Sofía. Si responden los dos, las dos apps siguen colgadas de la
   misma WABA: vuelva al Bloque 3.

### Cómo diagnosticar cuando algo no responde

En n8n → **Executions**:

- **No aparece ninguna ejecución** → el problema está antes de n8n: webhook
  (Bloque 9), `subscribed_apps` (Bloque 7) o app en Desarrollo (Bloque 4).
- **Aparece con error** → el mensaje señala el nodo; casi siempre es una
  credencial sin asignar.
- **Aparece y termina bien pero no llega el mensaje** → el destinatario no
  está entre los 5 registrados (error `131030` en la salida del nodo).

> **Los datos fijados (*pin*) no afectan a las ejecuciones de producción**,
> solo a las manuales del editor. No bloquean el webhook: si sospecha de ellos,
> está buscando en el lugar equivocado.

---

## Resumen: los once tropiezos que ya pagamos

| # | Hallazgo | Dónde está resuelto |
|---|---|---|
| 1 | El número de prueba es **uno por portafolio comercial**, no por app | Bloques 1–3 |
| 2 | **`subscribed_apps` es obligatorio y no existe en la interfaz**: solo por API | Bloque 7 |
| 3 | La app debe estar **publicada (Live)**; en Desarrollo no llegan mensajes reales | Bloque 4 |
| 4 | El **token de verificación del webhook no se configura en n8n**: se inventa en Meta y no se pega en ningún lado | Bloque 9.3 |
| 5 | La credencial de Calendar debe ser **`Google Calendar OAuth2 API`**, creada desde el nodo | Bloque 8.3 |
| 6 | Client ID y Client Secret **del mismo** cliente OAuth: copiarlos del JSON descargado | Bloque 8.3 |
| 7 | La URL del webhook es la de **Production**, nunca la de Test | Bloque 9.2 |
| 8 | Los **datos fijados no afectan a producción** | Bloque 11 |
| 9 | **Gemini devuelve 503** en picos: modelo desde el desplegable, *Retry On Fail*, evaluar facturación | Bloque 8.3 |
| 10 | **`Trigger On` llega vacío** al importar el JSON: seleccionar *Messages* a mano | Bloque 8.2 |
| 11 | El **QR no necesita hosting**: `POST /{PHONE_NUMBER_ID}/media` da un media ID de 30 días | Bloque 10 |

---

## Qué NO hay que hacer

- **Business Verification:** no se necesita para el número de prueba. La de
  AAB1 sigue su curso para producción; **no la toque desde estas apps**.
- **Plantillas:** los demos no usan ninguna (el cliente inicia la conversación
  y todo corre dentro de la ventana de 24 h). No cree plantillas desde estas
  WABA de prueba.
- **Método de pago / tarjeta:** no se agrega. El número de prueba no factura.
- **Número propio:** queda para producción, tras la verificación.
- **Publicar el número de prueba a terceros:** solo responde a los 5
  destinatarios registrados (prohibición 6 de CLAUDE.md).
- **Tocar `Demo SeguroLo Tengo`, su WABA, su webhook o su usuario de sistema.**

---

## Checkpoint final

- [ ] Existen **dos portafolios comerciales** y el nuevo contiene **solo** la
      WABA del Demo B
- [ ] `${WA_PHONE_ID_B}` ≠ `${WA_PHONE_ID}` y `${WABA_ID_B}` ≠ `${WABA_ID}`
- [ ] `NovuChat-Demo-B` en **Live**
- [ ] 5 destinatarios registrados en el número nuevo, `hello_world` recibido
- [ ] Token permanente (**Nunca**) con los **dos** permisos; `debug_token`
      muestra `app_id` = `${WA_APP_ID_B}` y `expires_at: 0`
- [ ] `subscribed_apps` de la WABA B lista `NovuChat-Demo-B` y **no** lista
      `Demo SeguroLo Tengo`
- [ ] Webhook **en verde** contra la URL de **Production**, campo `messages`
      suscrito, flujo **publicado**
- [ ] Media ID del QR cargado en `qrMediaId`, subido con el número del Demo B
- [ ] Los 6 pasos del Bloque 11 en verde
- [ ] Escribir al Demo A responde **solo** Sofía; escribir al Demo B responde
      **solo** el asistente de ventas
- [ ] Ningún secreto en nodos, en flujos exportados, en el repositorio ni en
      el chat; valores reales solo en `CONFIGURACION.local.md` y `.env`
