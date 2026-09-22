# Plantillas de Meta para la cobranza del prepago

**20/09/2026 · bloque A-5 del frente Prepago estricto** (`Prompts/prepago-estricto.md`,
bloque 5; `Analisis/36-prepago-estricto-y-dunning.md` §3.1, §3.3, §2.1 y §6).
**Estado: redactadas y documentadas; ninguna presentada a Meta.** La presentación
espera la compuerta del demo del 21/09 (§7 de este documento).

> **Dónde se documentan las plantillas.** Hasta hoy no había un lugar único:
> cada plantilla vive en el flujo que la usa (`Flujos/LEEME-flujos.md`,
> «La plantilla `solicitud_cita_sin_confirmar`»), por su nombre en
> `CONFIGURACION.md` §1.b (`solicitud_contacto`) y, las de un cliente, como
> datos dentro de `scripts/plantillas-cliente.sh`. Este es el primer documento
> dedicado a un juego de plantillas; sigue el formato de `LEEME-flujos.md`
> (nombre, categoría, idioma, cuerpo, ejemplos, el comando de
> `crear-plantilla.sh` sin `--aplicar`) y lo amplía con encabezado, pie,
> botones, validez, motivo de la categoría y costo, que las anteriores no
> necesitaban.

## 0. Lo común a las ocho

| | |
|---|---|
| **Quién las envía** | El **número de NovuChat** (`.env.novuchat`: WABA propia `NovuChat`, `CONFIGURACION.md` §1.b). Nunca el número del comercio |
| **A quién** | Al **administrador del comercio**, registrado con rol admin en `usuarios` del tenant (`Analisis/36` §4.2). **Jamás al cliente final**: el mensaje al cliente final no menciona pagos (decisión 6 del prompt, T-18) |
| **Qué son** | El **estado de una cuenta que ya existe** entre NovuChat y el comercio: vence, venció, se cortó, se agotó, se cubrió. No hay invitación, promoción, urgencia comercial ni «aprovechá». Es lo que hizo pasar a `solicitud_contacto` (memoria `meta-plantillas-restricciones`, punto 3) |
| **Categoría** | `UTILITY`. Si Meta clasifica alguna como `MARKETING`, **no se acepta**: ese aviso va por correo (`Prompts/prepago-estricto.md`, bloque 5; memoria, punto 4) |
| **Idioma** | `es` |
| **Validez** | `message_send_ttl_seconds: 43200` (12 h), el máximo que Meta admite para utilidad. Por defecto serían 10 min y un teléfono apagado descartaría el aviso (memoria, punto 5). Lo no entregado no se cobra |
| **Encabezado** | `IMAGE` en las seis que llevan QR: la imagen es el **QR del cobro** que emite el proyecto de cobros para NovuChat (decisión 2 del prompt paralelo: es el QR de NovuChat cobrándole al comercio, con la cuenta de cobro de NovuChat; **no** es `cobro.ts`, que es el comercio cobrándole a su cliente) |
| **Pie** | `Estado de cuenta de NovuChat.` (25 caracteres; Meta admite hasta 60, sin variables) |
| **Botones** | Solo **respuesta rápida** (`QUICK_REPLY`, hasta 25 caracteres, sin URL). Meta rechaza `wa.me` en botones (memoria, punto 1) y un botón «Llamar» marcaría al número de NovuChat, donde nadie atiende (punto 2). La respuesta rápida abre la ventana de 24 h del comercio, que es lo que necesita el pago por WhatsApp (§4.2 del análisis) |
| **Variables** | `{{1}}`, `{{2}}`… en orden; el cuerpo no empieza ni termina con una; nunca dos seguidas ni separadas solo por puntuación; sin saltos de línea; nunca vacías (el flujo pone «no indicado» antes que dejar una vacía) |
| **Ejemplos** | Sin dígitos reales: fechas escritas, importes de tres cifras, un teléfono de ocho dígitos inventado. Nada con diez o más dígitos (`verificar-saneo.sh`) |
| **Importes** | `Bs {{n}}` es el importe en bolivianos al TCO del BCB del día en que se emite el cobro (`CLAUDE.md` Base comercial §3; `Analisis/36` §2.2). El plan se nombra como en `admin/functions/src/planes.ts`: Impulso, Crecimiento, Pro. La unidad es «conversación»; la bolsa se llama «bolsa» |
| **Vocabulario vetado** | Lo que `crear-plantilla.sh` rechaza y Meta lee como Marketing: «interés», «promoción», «oferta», «descuento», «te esperamos», «continuar la atención», «prospecto», «gratis», «precio». Ninguno aparece abajo |
| **Costo por envío** | **0,0113 USD, a cargo de NovuChat** (tarifa de Bolivia desde el 01/10/2026). Cae dentro de la **franquicia de 1.000 mensajes por mes del número de NovuChat**: hasta ese volumen, cero. La plantilla con imagen cuesta lo mismo que sin ella |
| **Lo que cada una NO dice** | «Pago acreditado» o «pago verificado» por un comprobante: solo `pago_confirmado` habla de pago confirmado, y solo la dispara la confirmación del **banco** que entrega el proyecto de cobros (prohibición 3; `Analisis/36` §0: «acá, y solo acá, la consola puede decir "pago confirmado por el banco"») |

## 1. Resumen

| # | Nombre técnico | Cuándo | Encabezado | Variables | Botón | Costo (USD) |
|---|---|---|---|---|---|---|
| 1 | `mensualidad_vence_pronto` | D-5 | Imagen (QR) | 4 | Pagar más meses | 0,0113 |
| 2 | `mensualidad_vence_manana` | D-1 | Imagen (QR) | 4 | Pagar más meses | 0,0113 |
| 3 | `mensualidad_vencida_gracia` | D0 (48 h de gracia) | Imagen (QR) | 4 | Pagar más meses | 0,0113 |
| 4 | `asistente_sin_atender` | D+2 (corte) | Imagen (QR) | 5 | Pagar más meses | 0,0113 |
| 5 | `asistente_sin_atender_perdidas` | D+4 (corte, con `perdidas`) | Imagen (QR) | 5 | Pagar más meses | 0,0113 |
| 6 | `conversaciones_agotadas` | Al agotarse incluidas y bolsas | Imagen (QR de bolsa) | 3 | Cambiar de plan | 0,0113 |
| 7 | `prueba_termina` | Antes del fin de la PRUEBA | Ninguno | 1 | Elegir un plan | 0,0113 |
| 8 | `pago_confirmado` | Al confirmar el banco | Ninguno | 3 | Ninguno | 0,0113 |

Todas: `UTILITY`, `es`, validez 43200 s, pie «Estado de cuenta de NovuChat.».
El D+30 (baja comercial) **va por correo, no por plantilla** (`Analisis/36` §3.1).

## 2. Las plantillas

Cada cuerpo va en un bloque ```` ```cuerpo ```` y sus ejemplos, separados por
`|` y en el orden de las variables, en un bloque ```` ```ejemplos ````: son los
mismos textos que reciben `--cuerpo` y `--ejemplos` de `crear-plantilla.sh`.

### 1. `mensualidad_vence_pronto` — D-5

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, el QR del cobro de la mensualidad (vigencia 72 h desde D-5, para que cubra el D-1; `Analisis/36` §6).
- **Cuerpo:**

```cuerpo
Tu mensualidad de NovuChat vence el {{1}}. El QR de este mensaje la renueva: Bs {{2}}, plan {{3}}, por {{4}}. Al confirmarse el pago en el banco, tu cuenta queda cubierta y no hace falta que avises.
```

- **Variables:** `{{1}}` fecha de vencimiento · `{{2}}` importe en Bs · `{{3}}` plan · `{{4}}` período que cubre el QR («1 mes», «3 meses»: la variable lleva el número y la palabra, así el cuerpo no tiene que resolver el plural).

```ejemplos
5 de octubre de 2026|315|Impulso|1 mes
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Pagar más meses» (abre el camino del §4.2 del análisis: el flujo del número de NovuChat ofrece 1, 3 o 6 meses y emite otro QR).
- **Por qué no es Marketing:** es el vencimiento de una mensualidad que el comercio ya contrató, con el importe que ya paga; no ofrece nada nuevo ni apura.
- **Costo:** 0,0113 USD a cargo de NovuChat.

### 2. `mensualidad_vence_manana` — D-1

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, **el mismo QR** del D-5 si sigue vigente (renovación versionada del proyecto de cobros) o uno nuevo. El texto del análisis decía «con el QR de arriba»; una plantilla no puede apuntar al mensaje anterior, así que **cada una lleva el suyo**.
- **Cuerpo:**

```cuerpo
Mañana, {{1}}, vence tu mensualidad de NovuChat. Con el QR de este mensaje tu asistente sigue atendiendo sin cortes: Bs {{2}}, plan {{3}}, por {{4}}.
```

- **Variables:** `{{1}}` fecha de mañana, escrita · `{{2}}` importe en Bs · `{{3}}` plan · `{{4}}` período.

```ejemplos
5 de octubre de 2026|315|Impulso|1 mes
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Pagar más meses».
- **Por qué no es Marketing:** mismo aviso de vencimiento, un día antes; «sigue atendiendo sin cortes» describe la consecuencia de pagar, no un beneficio promocional.
- **Costo:** 0,0113 USD.

### 3. `mensualidad_vencida_gracia` — D0

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, QR **nuevo** (el del D-5 ya venció).
- **Cuerpo:**

```cuerpo
Tu mensualidad de NovuChat venció hoy, {{1}}. El asistente sigue atendiendo durante 48 horas más; pasado ese plazo deja de responder a tus clientes hasta que el banco confirme el pago. El QR de este mensaje la cubre: Bs {{2}}, plan {{3}}, por {{4}}.
```

- **Variables:** `{{1}}` fecha de hoy · `{{2}}` importe · `{{3}}` plan · `{{4}}` período.

```ejemplos
5 de octubre de 2026|315|Impulso|1 mes
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Pagar más meses».
- **Por qué no es Marketing:** informa un vencimiento ocurrido y un plazo de gracia que ya corre; el «hasta que el banco confirme el pago» es la condición real, no una presión inventada.
- **Costo:** 0,0113 USD.

### 4. `asistente_sin_atender` — D+2

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, QR nuevo.
- **Cuerpo:**

```cuerpo
Estado de tu cuenta de NovuChat: sin pago desde el {{1}}. Tu asistente dejó de atender a tus clientes; a quien escribe se le indica comunicarse con tu negocio al {{2}}. Al confirmarse el pago en el banco se reactiva solo, en menos de dos minutos. El QR de este mensaje la cubre: Bs {{3}}, plan {{4}}, por {{5}}.
```

- **Variables:** `{{1}}` fecha del vencimiento · `{{2}}` teléfono de recepción del comercio (el que el mensaje neutro le da al cliente final, decisión 6) · `{{3}}` importe · `{{4}}` plan · `{{5}}` período.

```ejemplos
5 de octubre de 2026|78000000|315|Impulso|1 mes
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Pagar más meses».
- **Por qué no es Marketing:** es la notificación de un cambio de estado del servicio (corte) y de cómo se revierte; «en menos de dos minutos» es una promesa que el sistema cumple (`Analisis/36` §3.2.3), no un gancho.
- **Costo:** 0,0113 USD.

### 5. `asistente_sin_atender_perdidas` — D+4

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, QR nuevo.
- **Cuerpo:**

```cuerpo
Desde el corte de tu cuenta de NovuChat, {{1}} clientes te escribieron y no fueron atendidos por el asistente. La cuenta sigue sin pago desde el {{2}}. El QR de este mensaje la reactiva en menos de dos minutos: Bs {{3}}, plan {{4}}, por {{5}}.
```

- **Variables:** `{{1}}` `corte.perdidas` (teléfonos distintos que escribieron desde el corte) · `{{2}}` fecha del vencimiento · `{{3}}` importe · `{{4}}` plan · `{{5}}` período.
- **Regla del flujo:** si `perdidas` es 0, **no se manda esta**: se repite `asistente_sin_atender`. «0 clientes te escribieron» es cierto pero no dice nada.

```ejemplos
12|5 de octubre de 2026|315|Impulso|1 mes
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Pagar más meses».
- **Por qué no es Marketing:** es un dato de operación de la cuenta (cuántos no fueron atendidos), el mismo que muestra la consola; es la presión real del §3.2.1 y no una urgencia inventada.
- **Costo:** 0,0113 USD.

### 6. `conversaciones_agotadas` — sin conversaciones

Otro tono: no es morosidad, es éxito (`Analisis/36` §3.3). El aviso del 80 %
que ya está en `main` hace de D-5 de este caso; esta es la del corte por
`sin_conversaciones`.

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** imagen, QR de **una bolsa** (30 conversaciones por USD 10, que no vencen; `Analisis/23`).
- **Cuerpo:**

```cuerpo
Tu cuenta de NovuChat usó las {{1}} conversaciones incluidas en tu plan {{2}} este mes. El asistente deja de responder a clientes nuevos hasta que se sume una bolsa o cambie el plan. El QR de este mensaje suma una bolsa de 30 conversaciones, que no vencen: Bs {{3}}, que son USD 10 al cambio oficial del día. Para cambiar de plan, toca el botón.
```

- **Variables:** `{{1}}` conversaciones incluidas del plan (100 / 220 / 500) · `{{2}}` plan · `{{3}}` importe de la bolsa en Bs al TCO del día.

```ejemplos
100|Impulso|126
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Cambiar de plan» (el flujo del §4.2 cobra la diferencia prorrateada, `Analisis/36` §2.3).
- **Por qué no es Marketing:** describe un límite del plan contratado que se alcanzó y las dos formas que el contrato ya prevé para seguir; el importe de la bolsa es el de lista, no una oferta.
- **Riesgo, y su salida:** de las ocho es la más expuesta al clasificador, por «cambie el plan» y «toca el botón». Si Meta la marca Marketing, se presenta de nuevo **sin la última oración y sin el botón**, con la bolsa como única salida en el mensaje y el cambio de plan solo en la consola. No se acepta Marketing.
- **Costo:** 0,0113 USD.

### 7. `prueba_termina` — conversión de PRUEBA

Solo conversión: **sin QR, sin importe, sin cobranza** (`Analisis/36` §2.1: en
prueba no hay recordatorios de cobro; el único aviso es «tu prueba termina el
día X; elige un plan»).

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** ninguno.
- **Cuerpo:**

```cuerpo
Tu prueba de NovuChat termina el {{1}}. Hasta esa fecha el asistente atiende con normalidad; desde el día siguiente deja de responder a tus clientes salvo que tu cuenta tenga un plan activo. El plan se elige desde tu consola o respondiendo este mensaje.
```

- **Variables:** `{{1}}` último día de la prueba.

```ejemplos
30 de septiembre de 2026
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** `QUICK_REPLY` «Elegir un plan».
- **Por qué no es Marketing:** es el vencimiento de un período de prueba ya activo y lo que pasa al vencer; no nombra planes, importes ni ventajas. Meta lista el fin de una suscripción o prueba entre los avisos de cuenta de utilidad; **lo que la volvería Marketing es agregar la lista de planes o un «aprovechá»**, y por eso no van.
- **Costo:** 0,0113 USD.

### 8. `pago_confirmado` — al confirmar el banco

**Va como plantilla, no como texto libre.** El argumento, con la regla de las
24 h:

1. Una plantilla que **envía la empresa no abre** la ventana de 24 h; la abre
   solo un mensaje **del comercio** al número de NovuChat (un texto, o tocar
   una respuesta rápida).
2. El camino más probable del pago es **escanear el QR de la imagen del
   recordatorio desde la app del banco, sin responder nada**. En ese caso no
   hay ventana: un texto libre falla en Meta con error de reenganche
   (`131047`) y la confirmación no llega. Lo mismo si el comercio paga desde
   la consola.
3. Hay ventana solo si tocó «Pagar más meses» o escribió «pagar» (§4.2). El
   flujo podría bifurcar como `agendamiento-seguimientos.json` (`¿En
   ventana?` → texto o plantilla), pero **no ahorra nada**: desde el 01/10
   el texto libre dentro de la ventana también cuesta 0,0113 USD
   (`CLAUDE.md` Base comercial §1). Mismo costo, dos caminos contra uno.

Por eso la confirmación se manda **siempre por plantilla**: un solo camino que
entrega en todos los casos.

- **Categoría / idioma / validez:** `UTILITY` · `es` · 43200 s.
- **Encabezado:** ninguno.
- **Cuerpo:**

```cuerpo
Pago confirmado por el banco: Bs {{1}}, plan {{2}}. Tu cuenta de NovuChat queda cubierta hasta el {{3}}. No hace falta que hagas nada más.
```

- **Variables:** `{{1}}` importe confirmado · `{{2}}` plan (o «bolsa de 30 conversaciones» cuando el cobro fue una bolsa) · `{{3}}` último día cubierto. Para una bolsa, `{{3}}` es el último día que la cuenta ya tenía cubierto: la bolsa suma conversaciones, no mueve el período.

```ejemplos
315|Impulso|5 de noviembre de 2026
```

- **Pie:** `Estado de cuenta de NovuChat.`
- **Botones:** ninguno.
- **Solo la dispara el banco:** el proyecto de cobros confirma contra la consulta autenticada al banco y avisa con firma; NovuChat no la manda por un comprobante, por OCR ni por un webhook sin verificar (prohibición 3; `Analisis/36` §6, primera fila). Un pago manual cargado por el superadministrador la manda también, porque ese pago tiene evidencia y auditoría (§4.3).
- **Por qué no es Marketing:** es el acuse de una transacción concluida, el caso de utilidad más claro que hay.
- **Costo:** 0,0113 USD. En `Analisis/36` §5.1 está contado aparte, en «QR y confirmación por WhatsApp (2 mensajes)», no entre las plantillas de recordatorio.

## 3. Costo por ciclo de cobranza

| Ciclo | Envíos | Cuenta | USD | `Analisis/36` |
|---|---|---|---|---|
| Paga entre D-5 y D-1 | D-5 (+ D-1 si paga el mismo D-1) | 1 a 2 × 0,0113 | 0,011 a 0,023 | dentro de «0,045» |
| Paga en gracia | D-5, D-1, D0 | 3 × 0,0113 | 0,034 | dentro de «0,045» |
| **Techo sin corte** | D-5, D-1, D0 y una plantilla más (la confirmación, o un reenvío) | **4 × 0,0113** | **0,0452 ≈ 0,045** | §3.1 y §5.1: **0,045** ✓ |
| **Con corte** | las 4 anteriores + D+2 + D+4 | **6 × 0,0113** | **0,0678 ≈ 0,07** | §3.1 y §5.1: **0,07** ✓ |
| Sin conversaciones | `conversaciones_agotadas` (+ `pago_confirmado`) | 1 a 2 × 0,0113 | 0,011 a 0,023 | fuera del ciclo mensual |
| Prueba | `prueba_termina` | 1 × 0,0113 | 0,011 | §2.1: solo conversión |

Las cifras coinciden con `Analisis/36` §5.1 (0,045 sin corte; 0,07 con corte).
Una precisión que el análisis no hace: el calendario del §3.1 tiene **cinco**
momentos por plantilla (D-5, D-1, D0, D+2, D+4); el «4 y 6» del §5.1 cierra
solo si el ciclo sin corte incluye la confirmación (o un reenvío) y el ciclo
con corte suma los dos avisos de corte. Como techo, 0,07 sigue siendo
correcto: **7 USD al mes por cada 100 clientes**, y cero mientras el número de
NovuChat no pase de 1.000 mensajes en el mes (a 6 envíos por cliente, la
franquicia alcanza para unos 160 clientes cortados o 250 al día).

**Mensajes por conversación de clientes finales: 0.** Ninguna de las ocho sale
por el número de un comercio ni se factura a un comercio; todas son del número
de NovuChat y a cargo de NovuChat.

## 4. Cómo las envía el flujo (para el bloque que las consuma)

Hoy ningún flujo del repositorio manda una plantilla **con encabezado de
imagen**: `demo-a-recordatorios.json` y `agendamiento-seguimientos.json`
(`Enviar plantilla`, `httpRequest` a `/{PHONE_ID}/messages`) arman solo el
componente `body`. Con encabezado y botón, el JSON que ese mismo nodo tiene que
armar es:

```json
{
  "messaging_product": "whatsapp",
  "to": "<teléfono del administrador>",
  "type": "template",
  "template": {
    "name": "mensualidad_vence_pronto",
    "language": { "code": "es" },
    "components": [
      { "type": "header", "parameters": [ { "type": "image", "image": { "id": "<media id del QR>" } } ] },
      { "type": "body", "parameters": [
        { "type": "text", "text": "5 de octubre de 2026" },
        { "type": "text", "text": "315" },
        { "type": "text", "text": "Impulso" },
        { "type": "text", "text": "1 mes" }
      ] },
      { "type": "button", "sub_type": "quick_reply", "index": "0",
        "parameters": [ { "type": "payload", "payload": "pagar_mas_meses" } ] }
    ]
  }
}
```

- **El QR entra como `media id`**, subido antes a `/{WA_PHONE_ID_NOVUCHAT}/media`
  igual que hace `scripts/subir-qr.sh` (el id vale 30 días y queda ligado al
  número que lo subió: tiene que subirlo el número de NovuChat). La
  alternativa `image.link` exigiría publicar el QR del cobro en una URL; no
  hace falta.
- El `payload` del botón es opcional; si se omite, la respuesta llega con el
  texto del botón. Fijarlo evita que el flujo dependa del texto.
- Se envía por `httpRequest` con el JSON armado a mano, **no** por el nodo de
  WhatsApp de n8n, que manda `template.language` sin `code` (`ESTADO.md`,
  06/09).
- Después de aprobada, `listar-plantillas.sh --env .env.novuchat --detalle`
  tiene que mostrar `HEADER, BODY(n var), FOOTER, BUTTONS(1)` con el `n` de
  la tabla del §1: la aprobación no comprueba que el flujo mande la misma
  cantidad de parámetros, y si no calzan Meta falla en producción con
  `#132000`.

## 5. Restricciones de Meta que afectan lo pedido

| Pedido | Qué exige Meta | Consecuencia |
|---|---|---|
| Encabezado de imagen | Al **crear** la plantilla hay que adjuntar una imagen de muestra por el **Resumable Upload API**: `POST /{WA_APP_ID}/uploads?file_length=…&file_type=image/png` abre una sesión y `POST /{id de sesión}` con los bytes devuelve un `h:…`, que va en `components[HEADER].example.header_handle`. Necesita el **App ID** (está en `.env.novuchat` como `WA_APP_ID`) además del token | `crear-plantilla.sh` no lo hace (§6). La muestra puede ser `Demo-Recursos/qr-demo.png`, que ya lleva el rótulo de demostración: honesto para el revisor. Meta revisa la imagen: no puede ser un QR de un cobro real |
| «Validez máxima» | Utilidad: 30 s a **12 h** (43200). Solo Marketing llega a 30 días | Un teléfono apagado más de 12 h pierde el D-5; el D-1 lo cubre. Es el mismo valor de `solicitud_cita_sin_confirmar` |
| Botón «Pagar más meses» | `QUICK_REPLY` sí está permitido en utilidad; lo vetado es la URL a `wa.me` y el botón de llamada | Se cumple tal como está pedido |
| Relación texto/variables | Meta rechaza cuerpos con muchas variables y poco texto («too many variable parameters relative to the message length») | Los cuerpos tienen entre 138 y 345 caracteres para 1 a 5 variables; ninguno es una lista de variables |
| «Bs {{2}} ({{3}}, {{4}} mes/meses)» tal como estaba pedido | Dos variables separadas solo por «, » se toman como pegadas, y «mes/meses» no resuelve el plural | Se reescribió «Bs {{2}}, plan {{3}}, por {{4}}» con `{{4}}` = «1 mes» / «3 meses» |
| Importe y USD en el cuerpo | Un importe **de lista** de un servicio contratado es utilidad (recordatorio de pago); lo que la vuelve Marketing es un importe de oferta o un descuento | Se escribe el importe del plan o de la bolsa, nunca «por solo», «ahorra», «promo» |
| `conversaciones_agotadas` con «cambiar de plan» | Riesgo de que el clasificador lo lea como venta cruzada | Salida escrita en la plantilla 6: reenviar sin esa oración ni el botón |
| Plantilla de PRUEBA | Fin de una prueba activa es aviso de cuenta; sumar la lista de planes o un llamado a comprar la vuelve Marketing | No nombra planes ni importes |
| Editar una plantilla ya presentada | Se puede (`POST /{id de plantilla}`, hasta 10 veces al mes) pero **vuelve a revisión** y no se puede cambiar la categoría | No presentar una versión sin encabezado «para ganar tiempo» y editarla después: se paga la revisión dos veces |
| Aprobación | Minutos a días: `solicitud_contacto` se presentó el 14/09 y estaba aprobada el 15/09; `solicitud_cita_sin_confirmar`, presentada el 18/09, seguía `PENDING` la noche del 19/09 (`ESTADO.md`) | Presentar las ocho **el mismo día** que se abra la compuerta: es lo único del frente que depende de un tercero |
| Volumen inicial | Un número nuevo inicia hasta 250 conversaciones por 24 h hasta que Meta lo suba (`Analisis/31`) | A 6 envíos por cliente, alcanza para más de 40 comercios cortados en un día; hoy sobra |

Ninguna restricción impide una plantilla tal como fue pedida; las tres
adaptaciones son la separación de variables (fila 5), la salida de la 6 y que
el encabezado de imagen exige el paso extra de la muestra.

## 6. Lo que le falta a `crear-plantilla.sh` (no se modifica acá: es de otro bloque)

El script hoy manda **solo el componente `BODY`** y rechaza lo demás por
diseño («sin botones», por el `wa.me` del 14/09). Para estas plantillas le
falta:

1. `--encabezado-imagen <archivo.png>`: subir la muestra por el Resumable
   Upload API con `WA_APP_ID` del entorno y sumar
   `{ "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["<h>"] } }`.
2. `--pie '<texto>'`: `{ "type": "FOOTER", "text": "…" }` (≤ 60 caracteres, sin variables).
3. `--boton-respuesta '<texto>'`, repetible hasta 3:
   `{ "type": "BUTTONS", "buttons": [ { "type": "QUICK_REPLY", "text": "…" } ] }`,
   manteniendo el veto a `URL` con `wa.me` y a `PHONE_NUMBER`.
4. Que la comprobación de vocabulario recorra también el pie y los botones,
   porque el clasificador los lee igual que el cuerpo.
5. Nada que cambiar en la lista de palabras vetadas: ninguna de las ocho usa
   «precio» ni «gratis».

Mientras tanto, los comandos del §7 valen para **comprobar en seco cuerpo,
variables, ejemplos y vocabulario** (el script lo hace sin `--aplicar` y sin
imprimir ningún valor del entorno); la presentación real necesita el script
completo o la carga útil del §7.2.

## 7. Presentación a Meta: en espera de la compuerta del demo

**No se ejecuta nada de esta sección hasta que Andres escriba en el chat que
el demo del 21/09 terminó.** Después, cada `--aplicar` lo corre Claude con el
«sí» de Andres, desde la carpeta principal `~/NovuChat` con `origin/main` al
día y con `.env.novuchat` (escrito por
`scripts/configurar-cliente.sh --cliente NOVUCHAT`). Andres nunca corre nada;
nadie imprime el entorno.

### 7.1 Comprobación en seco con el script de hoy (cuerpo, variables, ejemplos, vocabulario)

```bash
./scripts/crear-plantilla.sh --env .env.novuchat --nombre mensualidad_vence_pronto --idioma es \
  --cuerpo 'Tu mensualidad de NovuChat vence el {{1}}. El QR de este mensaje la renueva: Bs {{2}}, plan {{3}}, por {{4}}. Al confirmarse el pago en el banco, tu cuenta queda cubierta y no hace falta que avises.' \
  --ejemplos '5 de octubre de 2026|315|Impulso|1 mes'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre mensualidad_vence_manana --idioma es \
  --cuerpo 'Mañana, {{1}}, vence tu mensualidad de NovuChat. Con el QR de este mensaje tu asistente sigue atendiendo sin cortes: Bs {{2}}, plan {{3}}, por {{4}}.' \
  --ejemplos '5 de octubre de 2026|315|Impulso|1 mes'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre mensualidad_vencida_gracia --idioma es \
  --cuerpo 'Tu mensualidad de NovuChat venció hoy, {{1}}. El asistente sigue atendiendo durante 48 horas más; pasado ese plazo deja de responder a tus clientes hasta que el banco confirme el pago. El QR de este mensaje la cubre: Bs {{2}}, plan {{3}}, por {{4}}.' \
  --ejemplos '5 de octubre de 2026|315|Impulso|1 mes'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre asistente_sin_atender --idioma es \
  --cuerpo 'Estado de tu cuenta de NovuChat: sin pago desde el {{1}}. Tu asistente dejó de atender a tus clientes; a quien escribe se le indica comunicarse con tu negocio al {{2}}. Al confirmarse el pago en el banco se reactiva solo, en menos de dos minutos. El QR de este mensaje la cubre: Bs {{3}}, plan {{4}}, por {{5}}.' \
  --ejemplos '5 de octubre de 2026|78000000|315|Impulso|1 mes'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre asistente_sin_atender_perdidas --idioma es \
  --cuerpo 'Desde el corte de tu cuenta de NovuChat, {{1}} clientes te escribieron y no fueron atendidos por el asistente. La cuenta sigue sin pago desde el {{2}}. El QR de este mensaje la reactiva en menos de dos minutos: Bs {{3}}, plan {{4}}, por {{5}}.' \
  --ejemplos '12|5 de octubre de 2026|315|Impulso|1 mes'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre conversaciones_agotadas --idioma es \
  --cuerpo 'Tu cuenta de NovuChat usó las {{1}} conversaciones incluidas en tu plan {{2}} este mes. El asistente deja de responder a clientes nuevos hasta que se sume una bolsa o cambie el plan. El QR de este mensaje suma una bolsa de 30 conversaciones, que no vencen: Bs {{3}}, que son USD 10 al cambio oficial del día. Para cambiar de plan, toca el botón.' \
  --ejemplos '100|Impulso|126'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre prueba_termina --idioma es \
  --cuerpo 'Tu prueba de NovuChat termina el {{1}}. Hasta esa fecha el asistente atiende con normalidad; desde el día siguiente deja de responder a tus clientes salvo que tu cuenta tenga un plan activo. El plan se elige desde tu consola o respondiendo este mensaje.' \
  --ejemplos '30 de septiembre de 2026'

./scripts/crear-plantilla.sh --env .env.novuchat --nombre pago_confirmado --idioma es \
  --cuerpo 'Pago confirmado por el banco: Bs {{1}}, plan {{2}}. Tu cuenta de NovuChat queda cubierta hasta el {{3}}. No hace falta que hagas nada más.' \
  --ejemplos '315|Impulso|5 de noviembre de 2026'
```

**Con `--aplicar` tal como está, el script presentaría solo el cuerpo**, sin
encabezado, pie ni botón: para `prueba_termina` y `pago_confirmado` eso solo
omite el pie y el botón; para las seis con QR **no sirve** (§5, fila «Editar»).
Por eso `--aplicar` espera al script completo del §6.

### 7.2 La carga útil completa que el script tiene que mandar (una por plantilla)

`POST /{WABA_ID}/message_templates`, con el token de `.env.novuchat`. Para la
primera; las demás cambian `name`, `text`, `example` y `buttons` según el §2, y
`prueba_termina` y `pago_confirmado` van sin `HEADER` (la última también sin
`BUTTONS`):

```json
{
  "name": "mensualidad_vence_pronto",
  "language": "es",
  "category": "UTILITY",
  "message_send_ttl_seconds": 43200,
  "components": [
    { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["<handle h:… de la muestra>"] } },
    { "type": "BODY",
      "text": "Tu mensualidad de NovuChat vence el {{1}}. El QR de este mensaje la renueva: Bs {{2}}, plan {{3}}, por {{4}}. Al confirmarse el pago en el banco, tu cuenta queda cubierta y no hace falta que avises.",
      "example": { "body_text": [["5 de octubre de 2026", "315", "Impulso", "1 mes"]] } },
    { "type": "FOOTER", "text": "Estado de cuenta de NovuChat." },
    { "type": "BUTTONS", "buttons": [ { "type": "QUICK_REPLY", "text": "Pagar más meses" } ] }
  ]
}
```

Botones por plantilla: 1 a 5 «Pagar más meses»; 6 «Cambiar de plan»; 7
«Elegir un plan»; 8 ninguno.

### 7.3 Después de presentar

1. `./scripts/listar-plantillas.sh --env .env.novuchat --detalle`: estado
   (`PENDING` → `APPROVED` / `REJECTED`) y **componentes**, cotejados con la
   tabla del §1.
2. Si alguna vuelve `REJECTED` con categoría Marketing: la 6 se reenvía con la
   salida escrita en el §2; cualquier otra se reescribe una vez más como
   estado de cuenta; si vuelve a fallar, ese aviso va por correo. **Nunca se
   acepta Marketing.**
3. Anotar en `ESTADO.md` la fecha de presentación y la de aprobación de cada
   una: es el dato que hoy falta para estimar cuánto tarda Meta.
4. Recién con las ocho `APPROVED` se activa el flujo de cobranza que las
   consuma (mismo criterio que `agendamiento-seguimientos.json`: sin plantilla
   aprobada el modo plantilla falla en Meta y la marca ya quedó puesta).
