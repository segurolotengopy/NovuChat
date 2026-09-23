# BYOC: el comercio trae su portafolio, su número y su tarjeta

**23-sep-2026.** Evaluación del modelo BYOC («Bring Your Own Card») propuesto
por Silvana el 23/09, pedida por Andres. Tarifas de Meta de `Analisis/14`;
unidad de cobro de `Analisis/27`; el caso Dhermacore, de `Analisis/38`. Modelo
reproducible: `Analisis/39-byoc-modelo.py`.

**La decisión de Andres (23/09):** BYOC se adopta, **las dos modalidades
conviven** —los planes 25/50/90 con Meta incluido siguen para el comercio
chico— y **Dhermacore es el piloto**.

---

## 0. Conclusión, adelantada

| | |
|---|---|
| **Qué decide BYOC** | **No el margen: el techo.** El modelo con Meta incluido no se queda sin rentabilidad, se queda sin **cupo de Meta**. Con varios clientes en cola, la cola no entra (§1) |
| **Por qué Dhermacore es el piloto correcto** | Ya opera Meta y paga sus campañas ahí: trae **portafolio verificado**, número, línea y tarjeta. No consume ninguno de los cupos de NovuChat, y se lleva por delante el tope de 250 conversaciones iniciadas por día que sus campañas iban a romper primero |
| **¿Se sostiene USD 50 por 2.000?** | **Sí, con Gemini**: deja +20,3 USD netos a plena carga, y el equilibrio real está en **3.873** conversaciones. Con Haiku 4.5 el equilibrio cae a 1.542 —por debajo del tope vendido— y con Sonnet 5 a 771 (§2) |
| **La regla que sale de ahí** | **El tope se fija contra el modelo que corre**, y el contrato dice que la elección de modelo es de NovuChat. Hoy los cinco JSON de `Flujos/` corren `gemini-3.5-flash-lite` |
| **Dónde BYOC gana de verdad** | **Desde las ~1.159 conversaciones al mes.** Por debajo, el plan con Meta incluido deja más margen; por encima, el plan incluido pierde plata y el comercio tendría que comprar bolsas por 400 USD (§3) |
| **El riesgo que hay que decir** | La factura de Meta del comercio **no son «centavos»**: va de 21 a 112 USD al mes con 800 conversaciones, según cuánto de su tráfico nazca de un anuncio. Prometerla como calderilla es presentar un cobro como algo que no es (§4) |
| **Lo que BYOC NO resuelve** | Un webhook por app ⇒ **un flujo de n8n por cliente** (`Analisis/20` §2). El segundo muro de la cola queda en pie; solo lo cierra Tech Provider |
| **Lo que falta en el servidor** | El servidor **sabe leer** un límite a medida pero **no hay camino para escribirlo**, y un pago de mensualidad solo acepta planes vendibles. Diseño en §6 |
| **Tres cláusulas del PDF hay que corregirlas** | La imagen que «consume 2 mensajes» **sigue sin existir** (segunda vez); la definición de conversación con «o»; y las 48-72 horas (§5) |

---

## 1. Lo que se agota no es el margen: son los cupos de Meta

Este es el argumento que decide, y es operativo, no económico. Los techos están
documentados y ya los estamos tocando:

| Techo | Valor | Dónde |
|---|---|---|
| Portafolios por cuenta personal **sin verificar** | **2** — «es el límite duro» | `GUIA-META-NOVUCHAT.md:158` |
| Números por portafolio sin verificar | **2** | `Analisis/13` §30 |
| Usuarios de sistema **administrador** por portafolio sin verificar | **1** | memoria del alta de NovuChat, punto 2 |
| Conversaciones iniciadas por el negocio, por día | **250** | `Analisis/13` §30 |
| Chip y teléfono libres de cuenta previa, por alta | 1 | memoria del alta, punto 4 |

Hoy hay **un** portafolio propio (`NovuChat Produccion`, heredado del Demo B) y
cinco flujos vivos. Con 2 × 2 = 4 números como techo estructural, la cola de
clientes no entra. Y cada alta consume además un chip, un teléfono sin cuenta
previa y una verificación que WhatsApp bloquea si se reintenta.

**Un comercio que trae su portafolio ya verificado no consume ninguno de esos
cupos.** Ese es el valor de BYOC, y no aparece en ninguna planilla de márgenes.

### 1.1 Lo que BYOC no levanta

**Cada app de Meta tiene una sola URL de webhook**, así que un comercio dueño de
su app **sigue necesitando su propio flujo de n8n** (`Analisis/20` §2). BYOC
levanta el techo de portafolios, números y chips; **no** levanta el de trabajo de
alta ni el de propagación de cambios. Ese lo cierra Tech Provider con Embedded
Signup, y BYOC no lo acerca ni lo estorba.

Conviene saberlo antes de que la cola choque contra el segundo muro.

---

## 2. El tope se fija contra el modelo de IA, no contra el precio

Con BYOC, Meta sale de la cuenta de NovuChat y **el modelo de IA pasa a ser
prácticamente todo el costo**. Eso invierte una conclusión vieja: hasta hoy
«optimizar tokens ya casi no rinde» porque Meta era el 94 %. En BYOC, el modelo
es el 99 %.

| Modelo | USD por conversación (14 msj) | Margen a 2.000 conv. | Equilibrio |
|---|---|---|---|
| **Gemini 3.5 Flash-Lite** (el que corre hoy) | 0,0108 | **+20,3** | **3.873** |
| Claude Haiku 4.5 | 0,0272 | −12,5 | **1.542** ⚠ |
| Claude Sonnet 5 | 0,0544 | −66,8 | **771** ⚠ |

Dos consecuencias, y las dos son obligatorias:

- **El tope de 2.000 no protege el margen; lo protege el modelo.** `CLAUDE.md`
  dice «Gemini en demos, Claude en producción». El día que ese cambio se haga,
  **el mismo contrato pasa a perder plata sin que nadie toque el precio.**
- **El contrato tiene que decir que la elección de modelo es de NovuChat.** Es
  lo que hace que la frase «la decisión de modelo puede tomarse por calidad»
  (`CLAUDE.md` §1) siga siendo cierta en esta modalidad.

La estimación de la propuesta —0,02 USD por atención— es **1,9 veces** el costo
real con Gemini. El instinto de poner un tope era correcto; el número del que
salía, no.

---

## 3. Dónde conviene cada modalidad

Margen de NovuChat, a 14 mensajes por conversación y con 70 % del tráfico
naciendo de un anuncio en el caso con Meta incluido:

| Conversaciones/mes | Meta incluido (USD 99) | BYOC (USD 50) | Diferencia |
|---|---|---|---|
| 500 | +71,0 | +36,6 | −34,4 |
| 800 | +53,1 | +33,3 | −19,7 |
| **1.159** | — | — | **cruce** |
| 1.200 | +26,7 | +29,0 | +2,3 |
| 2.000 | **−26,0** | **+20,3** | +46,3 |

**BYOC es la respuesta a «¿qué hacemos cuando este cliente escale?», no a
«¿cómo bajamos la mensualidad?».** Por debajo del cruce, pasar a BYOC resigna
margen sin resolver ningún techo —salvo que el comercio traiga su portafolio,
que es el otro motivo, y el que manda en la cola.

**De ahí sale el criterio de asignación de modalidad:**

| El comercio… | Modalidad |
|---|---|
| es chico, no pauta, y no tiene portafolio propio | **plan con Meta incluido** (25/50/90) |
| **trae portafolio verificado**, o proyecta más de ~1.100 conversaciones/mes | **BYOC** |
| tiene portafolio pero no llega al volumen | BYOC igual: **el cupo pesa más que el margen** |

---

## 4. La factura de Meta del comercio no son «centavos»

Lo que Meta le cobra al comercio depende casi por completo de cuánto de su
tráfico nazca de un anuncio de clic a WhatsApp, porque esa ventana de 72 horas
es gratuita. Con 800 conversaciones de 14 mensajes y dos franquicias de 1.000:

| Tráfico por anuncio | Meta le cobra | Total que paga (50 + Meta) | Con Meta incluido |
|---|---|---|---|
| 70 % (lo que declara Dhermacore) | 21,4 | **71,4** | 99 |
| 40 % | 60,5 | **110,5** | 99 |
| 0 % (campañas apagadas) | 112,5 | **162,5** | 99 |

**En el escenario en que el comercio apaga las campañas —que es cuando peor la
está pasando— la factura de Meta le llega igual, y le sale 64 % más caro que el
plan con Meta incluido.**

Eso no invalida BYOC: invalida **contarlo como «los centavos de WhatsApp»**. La
propuesta tiene que decir que el consumo de Meta es variable, que depende del
mix de tráfico, y que NovuChat no lo factura ni lo controla. Es el mismo
criterio de la prohibición 3: **no se presenta un cobro como algo que no es.**

**Y una pérdida de visibilidad que hay que anotar:** con BYOC, NovuChat deja de
ver la factura de Meta. Lo que sí sigue viendo —y ahora importa más, porque es
la cifra que le predice la factura al comercio— es **los mensajes del asistente
del mes contra los 1.000 gratis del número**, que los cuenta el servidor de
NovuChat (`CLAUDE.md` §4). Esa fila de la consola deja de ser un lujo.

---

## 5. Las cláusulas del PDF

### 5.1 «Cada imagen consume 2 mensajes de la cuota» — segunda vez

`Analisis/38` §4.1 ya la marcó el 22/09 y volvió a aparecer el 23/09. **El
servidor cuenta uno:** `ingesta.ts` hace `mensajesVentana = previasVentana + 1`
por cada saliente, sea texto, imagen, documento o QR. Es el caso de `CLAUDE.md`
§7: un límite que solo existe en el contrato no existe. **Quitarla.**

### 5.2 La definición de conversación

El PDF dice «una ventana de 24 horas continuas de interacción **o** hasta 25
respuestas de la IA». La «o» invierte el modelo de `Analisis/27`: son hasta 25
respuestas **dentro** de la ventana de 24 h, la 26 abre un bloque nuevo y
factura otra conversación, y **el asistente no se corta a las 25**. Tiene que
decirse con la misma frase que el sitio y la consola.

### 5.3 Las 48 a 72 horas

El canal sí puede ser rápido ahora que el portafolio está verificado. El
desarrollo no: **el enrutamiento por campaña a la recepción de cada doctor no
existe** (1 a 2 jornadas, `Analisis/38` §5) y la galería por campaña tampoco
(½ jornada). Prometer 48-72 h choca con la política del 21/09: solo se ofrece lo
que se cumple.

### 5.4 El setup de USD 175

El argumento —«asesoría para configurar el Business Manager»— describe trabajo
que **ya se hacía en toda alta**: `Analisis/13` §132 define el procedimiento
estándar como «el dueño crea su portafolio con NovuChat al lado», y el RUNBOOK
de pase a producción ya contempla «número real en su propio portafolio (así se
dio de alta)». Con el portafolio de Dhermacore ya verificado, **el trabajo
incremental de BYOC es cargar una tarjeta**.

Subir el setup está bien —`Analisis/38` §7 recomendó **250** contra 3 a 6
jornadas reales—, pero con el argumento correcto: las dos líneas, el flujo
nuevo y el adaptado. No la tarjeta.

### 5.5 Dos cláusulas nuevas que BYOC obliga

- **Si el comercio no le paga a Meta, el canal se cae** y NovuChat no puede
  reponerlo. Hoy ese riesgo no existe; en BYOC hay que decirlo.
- **NovuChat necesita acceso de administrador sostenido** al portafolio y la
  app del comercio. Si le revocan el token o le cambian el webhook, el asistente
  deja de responder y no hay forma de arreglarlo desde acá.

---

## 6. Lo que falta en el servidor

**El servidor sabe leer un límite a medida, pero no hay camino para
escribirlo.** `limitesDeCuenta` (`planes.ts`) ya prefiere la copia de
`cuenta/estado.limites` sobre el plan, y acepta hasta `LIMITE_MAXIMO` = 100.000.
Lo que no existe:

| Hueco | Detalle |
|---|---|
| **No hay cómo escribir 2.000** | `asignar-plan.mjs` «rechaza un plan que no está en el catálogo (no hay texto libre)» y escribe la copia entera de los límites **del plan**. `actualizarEstadoCuenta({ plan })` hace lo mismo |
| **Un pago de mensualidad no acepta BYOC** | `Pago` declara `{ tipo: 'mensualidad'; plan: IdPlanVendible }` y `montoUsdDe` lee `PLANES[pago.plan]`. Con BYOC fuera de los vendibles, **la mensualidad de Dhermacore no se puede registrar** |
| **`montoMensual` se derivaría mal** | Es derivado de `PLANES_ASIGNABLES[plan].precioUsd` (`prepago.ts:496`). Un límite suelto sin plan propio dejaría la cuenta diciendo un precio que no es el contratado |

**Por eso BYOC no puede ser «un número escrito a mano en la cuenta»: tiene que
ser un plan del catálogo.** Es lo que manda `CLAUDE.md` §7.4 —«el límite se lee
del plan, no se escribe en el código»— y lo que hace que la factura se pueda
reconstruir.

### 6.1 El cambio propuesto

1. **`byoc` entra en `PLANES` como plan vendible**, con `precioUsd: 50`,
   `conversaciones: 2000`, y los `productos`/`agendas` de Pro. Con eso
   `asignar-plan.mjs`, `actualizarEstadoCuenta`, `aplicarPago`, `montoUsdDe` y
   `camposDerivados` funcionan **sin tocar ninguno**.
2. **`PLANES` deja de significar «lo que publica el sitio»** y pasa a significar
   «lo que se puede contratar y pagar». La prueba que compara contra el sitio y
   contra `CLAUDE.md` se acota a los tres publicados, que ya los nombra uno por
   uno.
3. **`Plan` gana `pagaMeta: 'novuchat' | 'comercio'`.** No es un límite —no se
   copia a la cuenta— sino una propiedad del plan que la consola lee para
   decidir qué mostrar en «Estado de cuenta» y qué decir el contrato.
4. **La prueba se escribe negando**, como pide `CLAUDE.md` §7.3: un comercio con
   plan BYOC **no puede** pasar de 2.000 conversaciones, ni armando la petición
   a mano.

Lo que **no** cambia: el corte sigue en modo observación hasta que Andres
encienda `plataforma/prepago.corteActivo` (`DISENO.md` §4undecies), y una
demostración no se corta nunca.

---

## 7. Lo que hay que resolver antes de firmar

| | Estado |
|---|---|
| **El origen del anuncio no llega al servidor** | El flujo lee el `referral` y lo deja en `anuncio`, pero `Reportar mensaje (entrante)` no lo manda a `ingesta.ts`. Sin eso no se sabe qué fracción entró por campaña — y en BYOC ese número es **del comercio**, que ahora absorbe toda la varianza (`Analisis/38` §2) |
| **Las dos líneas van en UN tenant con dos flujos** | Nunca como dos comercios: con dos tenants la bolsa compartida no se puede hacer cumplir. Las dos franquicias de 1.000 se aprovechan igual, porque son por número |
| **El cobro por QR está apagado** | Construido y entregado en `false`; el QR de `demo-venta` venció el 15/09. Encenderlo es un acto aparte (`activar-cobro-real.mjs`) |
| **El plan BYOC no existe en el servidor** | §6 |
