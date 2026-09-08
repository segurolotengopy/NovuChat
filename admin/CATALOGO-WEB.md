# Catálogo web propio — cómo funciona y cómo se pone en marcha

> El comercio publica su catálogo como una página web con su marca. El asistente
> le manda el enlace a un cliente por WhatsApp. El cliente navega, elige y
> confirma. **El carrito vuelve solo a la conversación, de servidor a servidor.**
>
> Diseño y decisiones: `admin/DISENO.md` §4octies. Amenazas: `admin/SEGURIDAD.md`
> T-35, T-36 y T-37. El análisis que lo originó:
> `Analisis/11-catalogo-web-propio.md`.
>
> Este documento es **público** (el repositorio lo es). Todo identificador de
> infraestructura aparece como marcador `${...}`, según
> `CONVENCIONES-REPO-PUBLICO.md`.

---

## 0. Solo para el flujo de venta

**Decidido el 08/09.** Un catálogo con carrito y checkout es una tienda, y el
flujo de agendamiento no vende: su catálogo es referencial y sus ítems son en
buena parte «a consultar», que ni siquiera se publican (§7bis). Es la misma
decisión que se tomó para el catálogo nativo de Meta.

Un comercio sin el flujo `venta` **no puede encender el catálogo web** —lo
rechazan las reglas—, no recibe ficha y, si tuviera una emitida antes, deja de
abrir la página. Ver `DISENO.md` §4octies.0bis.

## 1. La garantía, dicha primero

**El navegador del cliente nunca manda precios.** El checkout viaja con
identificadores de ítem y cantidades; `checkoutCatalogo` vuelve a leer cada ítem
de `/tenants/{t}/catalogo` y calcula el total con esos valores.

Es lo que separa este camino de GloriaFood, TakeApp o cualquier carrito de
plantilla, donde el pedido vuelve como un mensaje que el cliente puede editar
antes de mandarlo. Acá no hay nada que editar porque no hay ningún número del
cliente en el que el sistema confíe.

Si alguien va a tocar `catalogoWeb.ts`, esa es la propiedad que no se puede
perder. Hay pruebas que la cubren en `pruebas/catalogo-web.test.ts`.

---

## 2. Las tres direcciones

Todas cuelgan del sitio de Hosting. n8n puede llamarlas por la reescritura
(`https://${DOMINIO}/api/catalogo/…`) o directo a la función
(`https://${REGION}-${GCP_PROJECT_ID}.cloudfunctions.net/enlaceCatalogo`).

### 2.1 `POST /api/catalogo/enlace` — la llama n8n

Autenticación: **la misma de la ingesta**. Cabecera `X-NovuChat-Numero` con el
`phone_number_id`, y firma HMAC o `Authorization: Bearer` con el secreto de ese
número (ver `functions/src/firma.ts`). El comercio sale de `/rutasWhatsApp`,
**nunca del cuerpo**.

```jsonc
// Petición
{ "telefono": "59170000001" }

// Respuesta 200
{
  "url": "https://${DOMINIO}/c/0f3a…",   // 32 hexadecimales
  "caducaEn": "2026-09-10T20:15:00.000Z",
  "items": 137,
  "catalogoGrande": true                  // más de 40 ítems: no está en el prompt
}
```

Respuestas de error, y qué significan de verdad:

| Código | Qué pasó | Qué debe hacer el flujo |
|---|---|---|
| `401` | firma o token inválidos | no reintentar: está mal configurado |
| `409 catalogo web apagado` | el comercio no lo encendió en la consola | seguir la conversación sin enlace |
| `409 catalogo sin items vendibles` | no hay ningún ítem activo **con precio** | ídem: mandar a alguien a una tienda vacía es peor que no mandarlo. No alcanza con que haya ítems: un salón cuyo catálogo entero se cotiza tiene ítems activos y una vitrina vacía |
| `500 sitio no configurado` | falta `SITIO_PUBLICO` y no se pudo derivar | avisar a NovuChat |

### 2.2 `GET /api/catalogo/{ficha}` — la llama el navegador del cliente

Sin sesión. La ficha es la única llave. Devuelve la marca del comercio, las
condiciones de entrega y los ítems **activos y con precio** (hasta 500) — ver
§8 sobre por qué los «a consultar» se quedan afuera. `Cache-Control: no-store`:
la respuesta está atada a una conversación y una copia guardada en un teléfono
prestado es el catálogo —y el enlace— de otra persona.

Una ficha vencida, inexistente o de un comercio suspendido devuelve **el mismo
404**. Distinguirlos le confirmaría a quien prueba fichas al azar que acertó una.

### 2.3 `POST /api/catalogo/{ficha}/checkout` — la llama el navegador

```jsonc
// Petición: NO hay precios acá, y no es un olvido.
{
  "items": [{ "id": "pizza-muzzarella", "cantidad": 2 }],
  "entrega": "envio",              // o "retiro"
  "direccion": "Calle Falsa 100",  // obligatoria si es envío
  "nota": "sin cebolla"
}

// Respuesta 200
{
  "ok": true, "pedidoId": "cat_m0x…", "total": 105, "moneda": "BOB",
  "descartados": [],
  "siguiente": "respuesta"          // o "notificacion" si la ventana se cerró
}
```

Qué escribe, en un solo lote:

- `/tenants/{t}/pedidos/{id}` — el pedido, con los precios que leyó el servidor.
- un mensaje `tipo: 'order'` en el hilo de la conversación, para que aparezca en
  el visor, en orden y sin pantalla nueva.
- el resumen del hilo (`ultimoMensaje`, `ultimoEn`, `mensajesTotal`).

**No toca los contadores de facturación.** `atenciones` e `interacciones` las
cuenta la ingesta con sus propias marcas; un carrito que entra por la web no debe
moverlas por un camino paralelo. Si algún día se decide que un carrito es una
interacción, se decide una vez y se cuenta allá.

---

## 3. Cómo despierta al flujo

Después de guardar, la función hace `POST` al webhook del flujo con el pedido
adentro. El destino sale de `/rutasWhatsApp/{numero}.webhookCarrito`, que **no
escribe ningún navegador**: lo registra NovuChat con la función
`fijarWebhookCarrito`. Si fuera configurable desde la consola, el primer comercio
curioso apuntaría el webhook a un servidor suyo y se llevaría el secreto.

```jsonc
// Lo que recibe n8n
{
  "tenantId": "panaderia-x", "tipo": "carrito",
  "pedidoId": "cat_m0x…", "conversacionId": "wa_59170000001",
  "telefono": "59170000001",
  "items": [{ "id": "…", "nombre": "…", "cantidad": 2, "precio": 45,
              "moneda": "BOB", "subtotal": 90, "imagenUrl": "https://…" }],
  "total": 105, "moneda": "BOB", "costoEnvio": 15,
  "entrega": "envio", "direccion": "…", "nota": "…",
  "descartados": [],
  "ventanaAbierta": false,
  "accion": "plantilla_carrito_espera",   // o "responder"
  "fichaCompartida": false
}
```

Cabeceras: `Authorization: Bearer <secreto del número>` —que es lo que n8n sabe
verificar hoy con una credencial de autenticación por cabecera— **y además** la
firma HMAC (`X-NovuChat-Timestamp`, `X-NovuChat-Signature`), que viaja para el día
que el flujo la verifique. Poner las dos hoy hace que ese día no haya que tocar la
función.

**Si el webhook falla, el pedido YA está guardado.** Se contesta 200 al cliente
igual —no es su problema— y queda `entregadoAlFlujo: false` en el pedido más un
`error_flujo` en la bitácora. Hoy hay que mirar la consola: **no hay reentrega
automática**, y está anotado como pendiente en `DISENO.md` §4octies.7.

---

## 4. Lo que hay que hacer en n8n (dos nodos y una plantilla)

**No se tocó ningún JSON de `Flujos/`.** Son la exportación de lo que corre en
n8n, y editarlos a mano los separaría de la realidad —además de que el
congelamiento de los demos es el 8 de septiembre—. Esto es lo que hay que agregar
cuando se decida ponerlo en marcha.

### 4.1 Nodo «Derivar al catálogo» (herramienta del agente)

Un `HTTP Request` que el agente puede invocar cuando el cliente pide ver
productos:

- **URL** `https://${DOMINIO}/api/catalogo/enlace`
- **Método** POST, cuerpo `{ "telefono": "{{ $json.messages[0].from }}" }`
- **Credencial** la misma de autenticación por cabecera que ya usa la ingesta,
  más `X-NovuChat-Numero` con el `phone_number_id`.
- **Uso de la respuesta** el agente manda `url` al cliente. Si `catalogoGrande`
  es `true`, además tiene que decir explícitamente que el detalle está en el
  enlace: en ese caso **no recibió el catálogo en su configuración** y no lo
  puede recitar.

### 4.2 Nodo «Webhook de carrito» (entrada nueva)

Un `Webhook` con autenticación por cabecera (la misma credencial), cuya URL se
registra con `fijarWebhookCarrito`. Al recibir un carrito:

1. Si `accion` es `responder` → mensaje libre con el resumen del pedido.
2. Si `accion` es `plantilla_carrito_espera` → **plantilla** (§4.3).
3. Si `fichaCompartida` es `true` → confirmar de quién es el pedido antes de
   despachar. El enlace pudo haberse compartido.
4. Si `descartados` no está vacío → decir qué no entró y por qué.
5. Si `descartados` trae algo, puede ser porque lo dieron de baja **o porque le
   sacaron el precio** mientras el cliente elegía. Desde el webhook no se
   distingue: hay que preguntarlo, no suponerlo.

### 4.3 La plantilla «tu carrito te espera»

Hay que darla de alta en Meta (`GUIA-META-NOVUCHAT.md`, la WABA es la misma) y
esperar la aprobación, que no es inmediata. Categoría **UTILITY** —es el
seguimiento de una transacción que el cliente inició, no marketing—.

```
Nombre     carrito_te_espera
Idioma     es
Categoría  UTILITY
Cuerpo     Hola{{1}}, recibimos tu pedido de {{2}} por {{3}}.
           Responde este mensaje y lo confirmamos.
```

`{{1}}` el nombre si se lo tiene (o vacío), `{{2}}` la cantidad de ítems, `{{3}}`
el total. **No dice «pago» ni «cobro»**: no se cobró nada todavía, y la
prohibición 3 de `CLAUDE.md` gobierna igual acá.

---

## 5. Puesta en marcha, en orden

1. **Desplegar** Functions, reglas y Hosting. Nada más que el despliegue normal.
2. **`SITIO_PUBLICO`** (opcional). Si no se define, el enlace sale como
   `https://${GCP_PROJECT_ID}.web.app/c/<ficha>`, que es correcto. Se define el
   día que haya dominio propio.
3. **En la consola**, el comercio: pestaña de catálogo → cargar o importar los
   ítems con sus fotos; pestaña de configuración → encender «Publicar mi
   catálogo como página web», poner logo y color.
4. **NovuChat**: `fijarWebhookCarrito` con la URL del webhook de n8n.
5. **En n8n**: los dos nodos de §4 y la plantilla aprobada.
6. **Probar contra un teléfono real** y reportar el resultado real, no el
   esperado.

---

## 5bis. El enlace desde la consola: andamio de demostración

La pestaña de catálogo puede mostrar **«Ver el catálogo web como lo ve un
cliente»**, para que en una demostración se pase de la lista de productos a la
página del cliente sin pegar una dirección a mano delante del prospecto.

**No es una función terminada, y conviene saber por qué.** El catálogo público
exige una **ficha por conversación**: sin una conversación de WhatsApp detrás no
hay ficha que emitir, y emitirla desde la consola le daría al comercio una llave
a una página que en producción solo debería abrir un cliente derivado por el
asistente. Lo correcto es un **endpoint de vista previa autenticado como el
administrador** —que no cuente como conversación ni gaste una ficha— y todavía no
existe.

Mientras tanto el enlace sale de una variable de compilación:

```bash
VITE_CATALOGO_DEMO_URL="http://127.0.0.1:5241/c/<ficha>" pnpm web:build
```

**Sin la variable no se pinta ningún enlace**, y la URL tampoco queda en el
bundle: comprobado compilando de las dos maneras y buscándola en `web/dist`. O
sea que la consola de un cliente real no puede mostrarlo por accidente — hay que
ponerlo a propósito, en la máquina donde se hace la demostración. Es la
diferencia entre un andamio que se ve y uno que se queda puesto.

Para la demostración local, la dirección es la que imprime
`scripts/catalogo-demo.mjs` al arrancar.

## 6. Importar un catálogo desde una planilla

La pestaña de catálogo tiene «Importar o exportar en lote». Acepta CSV, TSV y lo
que se copie de una planilla; entiende el punto y coma que exporta Excel en
español y la marca de bytes que le pone adelante.

| Columna | Obligatoria | Notas |
|---|---|---|
| `nombre` | **sí** | de acá sale el identificador del ítem |
| `descripcion`, `area` | no | `area` agrupa el catálogo en la página |
| `precio` | no | **vacío = a consultar**, que NO es cero. Cero significa gratis. Ojo: lo que quede sin precio **no se publica en el catálogo web** (§8) |
| `moneda` | no | `BOB` (por defecto) o `USD` |
| `duracionMin` | solo con agenda | se redondea a cuartos de hora y se avisa |
| `imagenUrl` | no | tiene que ser `https://` |
| `activo` | no | `si`/`no`; por defecto activo |

Se entienden los sinónimos que la gente usa de verdad: `producto`, `servicio`,
`categoría`, `costo`, `foto`, `disponible`.

**Dos cosas que conviene saber antes de subir un archivo:**

- **Lo que el archivo no traiga, no se toca.** Un CSV sin columna de precios
  actualiza nombres y fotos y **deja los precios como están**. Si la columna está
  y la celda viene vacía, eso sí significa «a consultar» y borra el precio.
- **No borra lo que no menciona.** Un ítem que existía y no viene en el archivo se
  queda. La mayoría de los archivos que sube un comercio son parciales —«los
  precios nuevos de las pizzas»— y una importación que borra lo que no menciona
  sería una trampa. Para sacar algo del catálogo está «Dar de baja».

El precio se lee como lo escribe una persona: `1.234` son mil doscientos treinta y
cuatro, `1.234,50` son mil doscientos treinta y cuatro con cincuenta, `Bs 45` son
cuarenta y cinco. **Leer `1.234` como decimal inglés daría 1,23** y el comercio
vendería a la milésima parte del precio sin que nadie revise doscientas filas; hay
una prueba dedicada a ese caso exacto.

---

## 7bis. Qué NO se publica, y por qué

**Los ítems sin precio no llegan al catálogo web.** Se siguen ofreciendo por
chat, donde el asistente puede cotizarlos; en la página, no aparecen.

La razón es comercial antes que técnica (`Analisis/19` §5): publicar algo que no
se puede comprar es la forma más cara de generar una conversación — el cliente
pregunta, el asistente no puede cerrar, y desde el 1 de octubre cada mensaje del
asistente se paga. Un ítem sin precio en la vitrina no es una oportunidad de
venta: es una conversación garantizada que no puede terminar en nada.

Se aplica en los tres lugares, y no solo en la vitrina:

- **no se publica** en `GET /api/catalogo/{ficha}`;
- **no entra al checkout**, ni con el `id` puesto a mano. Si el comercio le sacó
  el precio mientras el cliente elegía, el ítem cae en `descartados`, igual que
  uno dado de baja: es lo mismo, dejó de poder comprarse por acá;
- **no se manda el enlace** si el catálogo entero se cotiza.

**Lo que esta regla no cubre.** El análisis nombra tres clases que tampoco
deberían publicarse —sin stock, a medida, y lo que necesita instalación— y de las
tres el sistema solo sabe reconocer esta. Para las otras, por ahora, se da de
baja el ítem.

## 7. Las fotos son del comercio, no nuestras

NovuChat **no guarda ninguna imagen**: guarda la dirección de una que el comercio
ya tiene publicada. Eso ahorra montar un depósito de archivos con su subida, sus
reglas y su CORS, y —lo que importa más— evita que NovuChat pase a custodiar
archivos de terceros.

La contrapartida, dicha con todas las letras: **si el comercio borra la foto de
donde está, deja de verse**. La consola muestra la casilla vacía con el rótulo
«sin foto» en vez del ícono roto del navegador, justamente para que el comercio
entienda de quién es el problema.

Tienen que ser `https://`. Una `http://` la bloquea el navegador del cliente **sin
decir nada**, y el síntoma —«no se ven mis fotos», sin ninguna pista— es peor que
un rechazo al guardar. Por eso se rechaza al guardar.
