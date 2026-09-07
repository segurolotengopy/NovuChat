# QR Simple: lo que cambia después de leer ManejoQRSimple

**07-sep-2026.** Andrés señaló que la vigencia corta del QR no es la norma del
estándar boliviano y apuntó a su otro proyecto, `~/ManejoQRSimple`, que tiene la
investigación hecha. Leída, hay que **corregir una conclusión mía** y **revisar
el diseño del cobro real de NovuChat**.

---

## 1. La corrección

**Lo que dije el 06-sep:** «el QR real vencía el mismo día; con eso el modelo
*carga tu QR una vez* no se sostiene».

**Lo que estaba mal:** generalicé desde **una sola muestra** —el QR que la app
del BNB genera por defecto para una persona— a todo el ecosistema. Es el mismo
error de método que ya cometí con el formato EMVCo: una muestra no es un
estándar.

**Lo que dice el estándar.** Bolivia opera **Pagos Inmediatos QR BCB**, un
estándar universal e interoperable: un QR emitido por cualquier entidad se paga
desde la app de cualquier otra. El QR codifica beneficiario y, **opcionalmente,
monto y vigencia**. La vigencia es un parámetro que se elige al emitir, no un
límite del estándar: en la API de Banco Económico es el campo `dueDate` en
formato `yyyy-MM-dd`, y el ejemplo de su propio manual usa `2026-12-31`.

**Lo que sigue sin saberse, y conviene no inventar:** el máximo real. En
`ManejoQRSimple/docs/Integraciones/baneco/01-preguntas-al-banco.md` es la
pregunta **C1**, todavía sin respuesta del banco. Y en
`docs/02-qr-simple-bolivia.md` §4 es una casilla sin marcar. O sea que el propio
proyecto que más sabe de esto **decidió no asumir un número**, y hace bien.

**Conclusión corregida:** el modelo se sostiene. Lo que no sirve es el QR por
defecto de una billetera personal — que es el instrumento equivocado, no el
estándar.

---

## 2. Lo que descubrí, y es más importante que la corrección

`ManejoQRSimple` analizó la **API oficial de Banco Económico** (API Market
v1.3.0). Cubre de forma nativa exactamente lo que NovuChat está construyendo a
mano:

| Necesidad de NovuChat | Cómo lo resuelve la API |
|---|---|
| Un QR por pedido, con el importe exacto | `POST /api/qrsimple/generateQR` con `singleUse=true` y `modifyAmount=false`. **El banco rechaza un pago de importe distinto.** |
| Saber si pagaron | Tres capas: webhook `notifyPaymentQR`, consulta activa `statusQR`, y conciliación diaria `paidQR` |
| Anular un cobro | `DELETE /api/qrsimple/cancelQR` |
| Vencimiento | `dueDate` por cobro, y renovar cuesta una llamada |

**Eso hace innecesario el OCR como fuente de verdad.** Con la API, el banco dice
si entró la plata; el comprobante que manda el cliente pasa a ser una cortesía,
no una prueba.

Y hay una coincidencia que vale la pena marcar: la **regla inviolable #1** de
ManejoQRSimple es *«solo la consola de la billetera (o la API oficial) confirma
un pago; un comprobante de WhatsApp nunca confirma nada por sí mismo»*. Es
exactamente la línea que se trazó en NovuChat el 06-sep, sin conocer ese
documento. Dos análisis independientes llegaron a la misma frontera.

Su análisis va más lejos en un punto que NovuChat todavía no había pensado:
**el webhook del banco no trae firma ni autenticación** en la especificación, así
que tampoco confirma por sí solo — dispara la detección y la confirmación se
corrobora con una llamada saliente autenticada. Si algún día NovuChat integra un
banco, esa regla se hereda tal cual.

---

## 3. Qué significa para el cobro real de NovuChat

El diseño actual —el comercio sube un QR estático y el asistente coteja el
comprobante por OCR— **no está mal, pero no es el camino principal**. Es el
camino para el comercio que **no tiene API**: la mayoría, hoy.

Conviene ordenarlo en dos niveles y decirlo así al cliente:

| | Sin API del banco | Con API del banco |
|---|---|---|
| El QR | estático, lo sube el comercio | uno por pedido, con el importe exacto |
| Quién dice que se pagó | **el negocio**, mirando su banco | **el banco** |
| Qué hace el asistente | recibe el comprobante y **coteja** importe, cuenta y fecha | confirma con respaldo del banco |
| Qué NO puede decir | «pago acreditado» | puede decirlo, porque lo sabe |

El cotejo por OCR que ya está escrito y probado **no se tira**: es lo que
sostiene el primer nivel, y sigue siendo útil en el segundo para detectar
temprano un comprobante que no cuadra.

---

## 4. Lo que hay que decidir, y no es técnico

1. **¿NovuChat integra bancos, o se queda en el primer nivel?** Integrar es
   entrar en certificaciones, credenciales y responsabilidad sobre dinero ajeno.
   El primer nivel se vende hoy y no exige nada de eso.
2. **Si se integra, ¿se reimplementa o se reutiliza `ManejoQRSimple`?** Ese
   proyecto ya tiene el análisis, los puertos (`QrProvider`, `PaymentWatcher`) y
   la máquina de estados pensados. Reimplementarlo en NovuChat sería escribir
   dos veces lo mismo, con dos oportunidades de equivocarse.
3. **OpenBCB.** El BCB anunció en octubre de 2025 una iniciativa de APIs
   estandarizadas para pagos QR. Si prospera, la integración deja de ser por
   banco y pasa a ser una sola. Conviene seguirla antes de invertir en
   integraciones banco por banco.

---

## 5. Lo que cambia hoy en NovuChat

Nada del código. Cambian dos textos y una expectativa:

- La advertencia de la consola sobre el vencimiento **queda**, pero deja de
  sugerir que el estándar es el problema: el problema es usar el QR personal de
  una billetera en vez del QR de comercio.
- `ESTADO.md` corrige la conclusión del 06-sep.
- El cobro real de NovuChat queda **explícitamente posicionado como el nivel
  «sin API»**, para que nadie lo confunda con una confirmación bancaria.

## Fuentes

Todo lo de arriba sale de `~/ManejoQRSimple`, que **no es este repositorio** y
tiene sus propias reglas de secretos —parte de su documentación del banco está
fuera de GitHub a propósito—:

- `docs/02-qr-simple-bolivia.md` — el estándar, la vigencia y las casillas sin verificar
- `docs/Integraciones/baneco/00-analisis-modulo-baneco.md` — el análisis de la API
- `docs/Integraciones/baneco/01-preguntas-al-banco.md` — la pregunta C1, sin responder
