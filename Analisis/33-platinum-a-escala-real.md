# Platinum a escala real: 40 a 80 conversaciones al mes, y conversaciones más largas

**16-sep-2026.** Cuarta vuelta sobre la oferta a Clínica Platinum. Dos datos
nuevos de Andres cambian la cuenta de `Analisis/32`:

1. **La clínica tiene hoy 40 conversaciones al mes y se espera que llegue a
   80.** Las 500 del plan son seis veces su uso.
2. **La conversación se alargó** con los ajustes de redacción de
   `platinum/ajustes-de-conversacion` (commit `580cb29`, aplicados en
   producción en `instruccionesExtra`): responder primero la duda completa,
   no repetir el precio, ofrecer la cita recién cuando la duda está resuelta.
   No hay medición todavía; se toman **15 a 18 mensajes** por conversación,
   y se prueba hasta 25.

Oferta en estudio, la de `Analisis/32`: **USD 120 al mes** por 500
conversaciones, recordatorios, seña por QR, un recordatorio de solicitud
pendiente por lead, aviso de horario liberado dentro de las 48 h, y
reactivación aparte a 30 mensajes por USD 10.

---

## 0. Conclusión

**Conviene, y con mucha más holgura que antes: el margen es del 86 al 99 %.**
A 80 conversaciones por mes la clínica **vive dentro de la franquicia de
1.000 mensajes gratis de su número**: Meta cuesta cero a 12 mensajes por
conversación, 5 USD a 18, y 11 USD si todas llenaran el bloque. El largo de
la conversación, que en `Analisis/30` y `32` era la condición número uno,
**acá no pesa nada**: una conversación más larga que convierte mejor es
gratis hasta las 1.000 respuestas del mes.

Lo que sí cambia es **de qué se está cobrando**. A 80 conversaciones, USD
120 son 1,50 USD (19 Bs) por conversación: no se puede vender por volumen.
Se vende por lo que la lista ya obliga y por los servicios:

- **Siete agendas ponen a la clínica en Corporativo (USD 90) por lista**,
  sin importar cuántas conversaciones tenga (`CLAUDE.md` §3: 1 / 5 / hasta
  10 agendas). No es un plan de USD 25 «estirado»: es el de 90.
- **Los USD 30 restantes son la seña, el seguimiento y la consola operada.**

Y dos condiciones de `Analisis/32` siguen en pie, porque no dependen de Meta:
**instalación a medida aparte** y **cupo de operación de la consola**. A esta
escala el margen es tiempo de NovuChat, no tarifa.

---

## 1. La cuenta, a escala real

Ingreso neto 100,80 USD. Costo con recordatorio, aviso a recepción y OCR en el
40 % de las conversaciones, más los seguimientos incluidos (`Analisis/31`)
sobre los leads sin cita.

| Conversaciones | 12 msj | **15 msj** | **18 msj** | 25 msj (todas llenas) |
|---|---|---|---|---|
| **40 (hoy)** | +99,8 (99 %) · Meta 0 | +99,7 · Meta 0 | +99,6 · Meta 0 | +99,4 · Meta 0 |
| **80 (esperado)** | +98,8 (98 %) · Meta 0 | **+96,3 (96 %) · Meta 2,3** | **+93,5 (93 %) · Meta 5,0** | +86,8 (86 %) · Meta 11,3 |
| 120 | +92,8 · Meta 5 | +88,5 · Meta 9 | +84,2 · Meta 13 | +74,1 · Meta 23 |
| 200 | +79,9 · Meta 16 | +72,7 · Meta 23 | +65,5 · Meta 29 | +48,8 · Meta 45 |
| 300 | +63,8 · Meta 29 | +53,0 · Meta 40 | +42,2 · Meta 50 | +17,1 · Meta 73 |

La franquicia cubre **83 conversaciones a 12 mensajes, 55 a 18 y 40 a 25**.
El punto donde Meta empieza a pesar de verdad está en las 200, y el plan
tiene 500: hay tres años de crecimiento antes de que la cuenta de
`Analisis/32` §1 vuelva a ser la que manda.

**Lo que no cambia con la escala:** el techo por ventana desbocada sigue
siendo 1,19 USD con los umbrales 50/100 (`Analisis/27` §5.4) y un bucle a
200 respuestas, 2,4 USD. Con 1,50 USD de ingreso por conversación, un solo
bucle sin umbrales se come el ingreso de dos conversaciones; sigue siendo
obligatorio publicarlos en el flujo de Platinum antes del 01/10.

---

## 2. Qué significa el largo de la conversación acá

`CLAUDE.md` §1 dice «gastar el tiempo en acortar la conversación». Vale para
la cartera y para los clientes que salen de la franquicia. **Para Platinum,
hasta las 1.000 respuestas por mes, la regla se invierte:** el mensaje extra
que resuelve la duda antes de ofrecer la cita cuesta cero y convierte mejor.
No hay que pelear el largo con este cliente mientras use menos de ~60
conversaciones de 18 mensajes.

Lo que sí vale es **medir**: el ajuste de `580cb29` no tiene número. La
distribución de mensajes por conversación de los primeros dos meses
(`ventanas.respuestas` cuando exista, `Analisis/27` §8; hasta entonces, las
ejecuciones de n8n) dice cuánto se alargó y a qué volumen la franquicia deja
de alcanzar. Ese dato es el que hace falta para todos los clientes de
agendamiento que vengan, y Platinum es el primero que lo produce con tráfico
real.

---

## 3. Los servicios incluidos, a 40–80 conversaciones

| Servicio | A esta escala | Recomendación |
|---|---|---|
| **Seña por QR** | Es lo que pidió el cliente y lo que le ahorra las citas perdidas: con 30–40 citas al mes, cada inasistencia evitada son 500 Bs | **Construir primero** (3–4 jornadas, `Analisis/30` §4) |
| **Recordatorio de solicitud pendiente** | 16–32 leads sin cita al mes; a 20 % de respuesta, **3 a 6 citas recuperadas**: 120–240 USD de valor para la clínica por 0,40 USD de Meta | **Construir segundo** (2 jornadas). Es lo que hace visible el valor de NovuChat en el primer mes |
| **Aviso de horario liberado** | Con 7 odontólogos y 80 conversaciones **la agenda no está llena**: casi nadie espera un horario que no existe | **No construir ahora.** Se ofrece como «disponible cuando la agenda se llene»; ahorra 1 jornada |
| **Reactivación, 30 por USD 10** | 16–32 leads al mes: **un paquete por mes, como mucho**, USD 10 | Construir cuando la clínica lo pida; hasta entonces no hay volumen que lo justifique (2 jornadas) |
| **Consola operada** | Con 40–80 conversaciones los cambios son pocos: precio de campaña, horario, una campaña nueva | Cupo de 4 por mes; el margen (≈ 95 USD) son unas 6 horas al mes a valor de mercado, y eso es **todo** lo que la cuenta paga |

**Orden de construcción: seña → seguimiento pendiente → (medir) → lo demás.**
De 9–10 jornadas se baja a **5–6 antes de cobrar el primer mes**, y las otras
se hacen cuando el volumen las pida.

---

## 4. Precio: ¿120 es el número?

| Opción | Por qué sí | Por qué no |
|---|---|---|
| **USD 120 por 500** (la propuesta) | Corporativo por lista (7 agendas) más 30 por los servicios; margen 93–96 %; las 500 son «sin límite» para la clínica y cuestan cero | A 80 conversaciones, 19 Bs por conversación es un número que la clínica puede calcular. Hay que vender servicios, no volumen |
| USD 120 por 200 | Mismo ingreso; deja las 500 para un escalón futuro | No cambia el costo; solo abre una conversación de bolsas que hoy no hace falta |
| USD 90 por 500 (Corporativo con los servicios incluidos) | Cierra más fácil; margen 90 % igual | Regala los servicios y fija que valen cero para el siguiente cliente |

**Se mantiene 120 por 500.** La justificación en la mesa es una línea: «su
clínica está en el plan Corporativo por las siete agendas; los 30 restantes
son la seña, el seguimiento de leads y que NovuChat opere la consola». Y un
argumento con número propio: 3 a 6 citas recuperadas al mes son 1.500 a
3.000 Bs contra 1.512 Bs de cuota.

Un punto de atención: **80 es una estimación de la clínica sobre su
WhatsApp de hoy, atendido a mano.** Un asistente que contesta a las 23:00 y
campañas de Facebook con clic a WhatsApp suelen subir el volumen; si llegan
a 200, la cuenta del §1 sigue dando 65–80 %. No hay escenario en el que
haya que volver a tocar el precio antes de que pasen de 300.

---

## 5. Lo que va distinto en la propuesta escrita respecto de `Analisis/32` §4

- El aviso de horario liberado se ofrece **como servicio a activar cuando la
  agenda se llene**, no como incluido desde el día uno.
- La reactivación queda en la propuesta al mismo precio, **sin fecha de
  disponibilidad**: se construye cuando la clínica compre el primer paquete.
- La revisión a los tres meses lleva un dato más: **mensajes por
  conversación después del ajuste de redacción**, y a qué volumen la
  franquicia deja de alcanzar. Es la primera medición real del proyecto con
  conversaciones largas.
- Se mantiene: instalación a medida (USD 250–350, ahora por 5–6 jornadas
  reales), cupo de consola, seña confirmada por la clínica, TCO del BCB,
  bloque de 25, escalón a 180 por 1.000 si pasa de 800.
