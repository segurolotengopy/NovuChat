# Cobro real con el QR del comercio, y lectura del comprobante

**Escrito el 2026-09-06**, a partir de **cuatro muestras reales** que pasó
Andres: un QR de cobro del BNB y comprobantes de pago de tres bancos
(Mercantil Santa Cruz, BNB y Banco de Crédito de Bolivia).

Sin esas muestras, este documento habría descrito un sistema que no funciona.
Cada apartado dice qué se creía y qué resultó ser.

---

## 1. La diferencia que ordena todo lo demás

| | Cobro **simulado** | Cobro **real** |
|---|---|---|
| De quién es el QR | de NovuChat | del comercio |
| ¿Se mueve dinero? | no | **sí, a la cuenta del comercio** |
| Rótulos | «SIMULADO» impreso y en el epígrafe | ninguno: es un cobro de verdad |
| Qué confirma el sistema | nada, es una demostración | que el comprobante **cuadra** |
| Quién confirma que entró la plata | nadie | **el banco, y el negocio** |

**La regla que no se negocia:** el asistente nunca dice «pago acreditado»,
«pago verificado» ni «recibimos tu pago». Dice que **recibió el comprobante y
que los datos coinciden**. Una imagen se edita, y un comprobante editado con los
tres datos correctos pasa cualquier cotejo. Lo que esto reemplaza no es al
banco: es al dueño mirando cincuenta capturas por día para encontrar la que no
cuadra. Ahí ahorra casi todo el trabajo, sin prometer nada falso.

Esto **no contradice** la prohibición 3 de `CLAUDE.md`, la extiende: mientras el
cobro sea simulado, va rotulado; cuando es real, no se afirma una acreditación
que no se tiene.

---

## 2. El QR: lo que se creía y lo que es

**Se creía** que el QR Simple boliviano seguía la especificación EMVCo, donde
todo se lee del propio código: si es reutilizable, si tiene monto fijo, el
nombre y la cuenta. Se implementó completo, con verificación de CRC.

**Lo que es.** El QR real del BNB **no es EMVCo**. Su contenido son 256 bytes
**cifrados** en base64, una barra vertical, y una etiqueta de 12 bytes en
hexadecimal. Solo la red bancaria puede leerlo.

```
pU3KGCUw…Qx+16g==|D440E50454F31AF3176813E0
└──── 256 bytes cifrados, en base64 ────┘ └─ etiqueta ─┘
```

De haberlo dado por sentado, el sistema habría rechazado **todos** los QR
bolivianos con el mensaje «esa imagen no contiene un QR de cobro».

**Cómo quedó.** Se reconocen dos familias y se rechaza cualquier otra cosa:

| Familia | Qué se puede comprobar | Qué tiene que declarar el comercio |
|---|---|---|
| `emvco` | todo: reutilizable, monto abierto, nombre, cuenta, integridad por CRC | nada |
| `cifrado` | solo la **forma**: que es un código de cobro bancario y no un enlace, una red wifi, una tarjeta de contacto ni una foto | titular, **número de cuenta**, vencimiento, y confirmar reutilizable y monto abierto |

En la familia cifrada **el número de cuenta es obligatorio**: es lo único con lo
que después se puede verificar un pago.

### El vencimiento es un problema de producto, no de programación

El QR real que se probó **vencía el mismo día en que se generó**. Si eso es lo
que entrega la aplicación por defecto, el modelo «carga tu QR una vez» no se
sostiene: el comercio tendría que subir uno nuevo cada día.

**Hay que averiguarlo con los bancos antes de prometer esto a un cliente.** Lo
más probable es que exista un QR de comercio con vigencia larga, y que ese sea
el que hay que pedir. La consola ya lo dice en pantalla, pero es una pregunta
comercial abierta.

### El QR no se guarda como imagen: se vuelve a dibujar

El navegador lee el código de la foto y manda el **texto**. El servidor lo
valida, lo guarda, y cada vez que hay que enviarlo lo dibuja de nuevo.

1. **No hay hueco entre lo validado y lo enviado.** Guardando la imagen, alguien
   podría subir una foto que muestra un QR y declarar otro texto: se validaría
   un código y se enviaría otro, y el cliente pagaría a una cuenta ajena.
2. **Se lee siempre.** Una foto de la pantalla del banco escanea mal.
3. No hace falta almacenamiento de archivos.

Comprobado: el PNG que genera el servidor se leyó con `zxing-cpp` —un
decodificador independiente— y devuelve exactamente el texto de entrada,
también con acentos.

---

## 3. El comprobante: lo que se creía y lo que es

**Se creía** que bastaba comparar **importe**, **nombre de la cuenta** y **fecha
y hora**.

**Lo que es**, mirando los tres bancos:

| | Mercantil Santa Cruz | BNB | Banco de Crédito |
|---|---|---|---|
| Importe | `Bs 92.50` | `La suma de Bs.: 6.5` | `Bs 5.00`, con los centavos en letra más chica |
| Fecha y hora | juntas: `05/09/2026 15:08:32` | **separadas**, en dos renglones | juntas |
| Cuenta destino | completa | **enmascarada**: `201*****307` | completa |
| **Nombre del destinatario** | sí | sí | **NO** |

**El defecto que esto destapó.** El comprobante del Banco de Crédito no muestra
el nombre de quien recibe: su rótulo «A nombre de» corresponde a la cuenta de
**origen**. Un cotejo que exigiera el nombre habría rechazado **todos** los
pagos hechos desde ese banco, y el motivo habría sido invisible.

**Y otro más.** La misma cuenta aparece con **catorce dígitos** en un banco y
enmascarada a **trece caracteres** en otro: los asteriscos no reemplazan un
dígito cada uno. Comparar los largos rechazaba pagos buenos.

### Cómo quedó el cotejo

- **Importe y fecha: obligatorios.** Atrapan los dos fraudes simples —pagar de
  menos y reenviar la captura de un pago viejo—. La fecha tiene que caer entre
  el envío del QR y la llegada de la imagen, con diez minutos de gracia por
  desfase de relojes.
- **Destinatario: por cuenta O por nombre.** Basta uno, porque no todos los
  bancos imprimen los dos. Pero al menos uno hace falta: sin eso, un pago del
  importe correcto a la cuenta de otra persona pasaría por bueno.
- **Si un dato figura y no coincide, se rechaza**, aunque el otro sí coincida.

Todo esto está en `admin/functions/src/cotejo.ts`, con pruebas que usan los
formatos reales de los tres bancos (con los números y los nombres cambiados: el
repositorio es público).

---

## 4. Lo que falta hacer en el flujo de n8n

Nada de esto se puede probar sin un teléfono, así que queda **para después del
congelamiento del 8**. El flujo actual **no cambia** y sigue con el cobro
simulado.

### 4.1 El comprobante ya llega, pero no se lee

Comprobado en el JSON del Demo B: `Normalizar entrada` contempla `document` y
`¿Hay comprobante?` acepta `['image', 'document']`. O sea, **un PDF ya entra**.

Lo que falta es leerlo. Y hay una trampa: **el PDF del Banco de Crédito no tiene
ni un carácter de texto**, es una imagen adentro de un PDF. `pdftotext` devuelve
vacío. Hace falta OCR de verdad, no extracción de texto.

### 4.2 Los tres nodos nuevos

1. **Descargar el archivo de Meta.** `GET /{media-id}` devuelve una URL
   temporal; después hay que descargarla **con el token**, que es el paso que se
   olvida.
2. **Leerlo con el modelo.** Gemini acepta imágenes y PDF como datos en línea.
   El PDF va tal cual, sin convertir.
3. **Cotejar** con las funciones ya escritas y probadas.

### 4.3 El prompt de lectura, listo para pegar

```
Este es un comprobante de una transferencia bancaria boliviana. Devuelve SOLO
un objeto JSON, sin texto alrededor, con estas claves:

  monto           el importe transferido, tal cual figura, con su separador
  cuentaDestino   el número de la cuenta que RECIBIÓ, tal cual, con asteriscos
                  si está enmascarada
  nombreCuenta    el nombre de quien RECIBIÓ
  fecha           la fecha de la transacción
  hora            la hora de la transacción
  banco           el banco de destino

Si un dato no aparece, pon cadena vacía. NO lo deduzcas ni lo inventes.

CUIDADO con estas tres cosas:
- Varios comprobantes muestran también quién PAGÓ. Nunca lo pongas como
  destinatario. Un rótulo «A nombre de» puede referirse a la cuenta de origen:
  fíjate a qué cuenta acompaña.
- El importe puede tener los centavos en letra más chica: «Bs 5.00» son cinco,
  no quinientos.
- Copia los números tal como están, sin quitar asteriscos ni guiones.
```

**Ante la duda, cadena vacía.** Un campo vacío hace que el cotejo no confirme y
que un humano mire; un campo inventado hace que se confirme un pago que no
existió.

### 4.4 Lo que el asistente tiene que decirle al cliente

Al enviar el QR, junto al importe:

> Cuando termines de pagar, **guarda o comparte el comprobante antes de salir de
> la aplicación de tu banco**: después no siempre se puede recuperar. Mándamelo
> por acá, como imagen o PDF.

Lo pidió Andres y no es un detalle de redacción: sin comprobante no hay nada que
cotejar, y muchas aplicaciones no permiten volver atrás a buscarlo.

### 4.5 Qué responder según el resultado

| Resultado | Al cliente | Al negocio |
|---|---|---|
| Cuadra todo | «Recibí tu comprobante y coincide con el pedido. Ya le avisé a [negocio] para que lo confirme.» | pedido + comprobante + «los datos coinciden» |
| Algo no cuadra | «Recibí tu comprobante. Hay un dato que no me coincide, así que lo va a revisar una persona de [negocio].» | pedido + comprobante + **qué** no cuadró |
| No se pudo leer | «Recibí tu comprobante pero no pude leerlo bien. ¿Me lo mandas de nuevo, más nítido?» | aviso de que llegó algo ilegible |

En ningún caso se dice que el pago está acreditado.
