# Q'Taco: ¿seguir en Crecimiento o pasar a BYOC?

> Sesión de análisis comercial y financiero, 04/10/2026, a pedido de Andres.
> Modelo reproducible: `Analisis/48-modelo-qtaco-crecimiento-o-byoc.py`.
> Fuentes: `docs/base-comercial.md` §2 y §3; `Analisis/39` (BYOC); `Analisis/47`
> (tarifas y fijos); `admin/functions/src/central/cuenta/planes.ts` y `ejes.ts`;
> `Flujos/experimental/venta-minima/DISENO.md` («Mensajes por conversación» y
> apartamiento nº 8); y la carpeta del cliente (no versionada), leída sin
> copiar identificadores. Sin secretos ni identificadores.

## 0. Conclusión, adelantada

| Pregunta | Respuesta |
|---|---|
| **¿Pasar a BYOC ahora?** | **No.** El piloto empieza el 05/10 con lo pactado el 28/09: NovuChat pone el chip y paga Meta. Pasar a BYOC a mitad del piloto mete en el camino crítico un portafolio de Meta del dueño, su tarjeta, la migración del número y la reaprobación de las plantillas. |
| **¿Cuánto se podría cobrar en BYOC?** | **Entre USD 33 y 50 al mes**, al volumen esperado (unas 225 conversaciones). **USD 33** deja a NovuChat el mismo margen en dólares que hoy. **USD 50**, la lista de BYOC, deja +14,5 USD al mes, pero Q'Taco pagaría unos 63 USD (50 más unos 13 de Meta) contra los 50 de hoy. |
| **¿Qué nos conviene?** | **En el pase a producción (noviembre), BYOC por contrato: USD 45 por 500 conversaciones, con bolsa encima**, si Q'Taco pone portafolio, número y tarjeta. Si no puede, **Crecimiento de lista (50/220)**. En ningún caso conviene seguir con el contrato de 40: es el margen más bajo de la cartera (49 %). |
| **¿Por qué BYOC, si el margen no lo exige?** | Por lo que no está en la planilla (§3): **el cupo de Meta** (`NovuChat Produccion` ya tiene sus 2 números, y uno es el de Q'Taco), **el nombre visible** (hoy el cliente del restaurante ve «NovuChat») y **las promociones de Facebook**, que piden la página del restaurante enlazada a su número. |
| **¿Por qué no BYOC de lista, 50 por 2.000?** | Porque regala el crecimiento. Si las promociones llevan a Q'Taco a 600 conversaciones, el plan de lista deja a NovuChat 37 USD y el contrato de 45/500, 67 USD. Las 2.000 conversaciones se pensaron para comercios desde unas 1.159 al mes (`Analisis/39` §3), y Q'Taco anda en una quinta parte de eso. |

## 1. Las condiciones de hoy

- **Plan:** Crecimiento por contrato, a **USD 40** por 220 conversaciones, en modalidad **prueba**. La cuenta se armó en seco el 03/10 (`asignar-plan --plan crecimiento --modalidad prueba --precio 40`).
  - Crecimiento de lista: 50/220, 100 productos, 5 agendas, 3 campañas y 1 cambio incluido.
  - La carta de Q'Taco tiene 79 ítems y por eso no cabe en Impulso, que admite 20.
- **Canal:** la línea …326, que es de NovuChat, en la WABA de `NovuChat Produccion`. El portafolio quedó lleno, con 2 números. Los mensajes entran por el receptor de AAB1 (camino B).
  - **Titularidad `novuchat`**: NovuChat paga Meta y la franquicia de 1.000 mensajes es la de ese número.
  - El nombre visible todavía es «NovuChat».
- **Lo pactado el 28/09:** NovuChat pone el chip y paga Meta.
- **El flujo** («Venta mínima», 50 nodos) sigue el patrón de Bellido: el código calcula y el modelo solo entiende.
  - Llama a Gemini Flash-Lite en `Extraer` (como mucho una vez por turno), al leer el comprobante y al transcribir audios. Son unos 0,004 USD por conversación, marginal.
  - **Lo caro son los mensajes:**

| Conversación | Al cliente | Al restaurante (ventanas abiertas) |
|---|---|---|
| Pedido con QR | 5, más 1 por cada aclaración | 5 (2 plantillas, 2 detalles y la imagen del comprobante) |
| Reserva | 4, más 1 si faltan datos | 4 |
| Promoción o derivación | 1 | 0 a 2 |

Con la mezcla del diseño (60 % pedidos, 25 % reservas, 15 % consultas), cada conversación lleva unos **5,3 mensajes al cliente y 4,2 al restaurante**: unos 9,5 en total. **Los avisos al restaurante pesan más que las respuestas:** con 225 conversaciones son unos 950 mensajes al mes, alrededor de 10,7 USD. Las respuestas al cliente apenas pasan la franquicia de 1.000 (unos 2,2 USD).

## 2. Los números (USD al mes)

«Cobra» es lo que paga Q'Taco a NovuChat, con las bolsas de 30 conversaciones por USD 10 cuando se acaban las incluidas. «Margen» es lo que le queda a NovuChat después de impuestos (16 %), Meta, Gemini, el fijo prorrateado y el chip. «Q paga» es lo que paga Q'Taco en total; en BYOC suma su factura de Meta.

| Conv/mes | Meta | Crecimiento 40/220 (hoy) | Crecimiento 50/220 | Pro 90/500 | BYOC 50/2.000 | **BYOC 45/500** |
|---|---|---|---|---|---|---|
| 150 | 7 | 40 · **22** (55 %) · 40 | 50 · 31 · 50 | 90 · 64 · 90 | 50 · 39 · 57 | 45 · **35** · 52 |
| **225** | 13 | 50 · **24** (49 %) · 50 | 60 · 33 · 60 | 90 · 58 · 90 | 50 · 39 · 63 | 45 · **35** · 58 |
| 300 | 21 | 70 · 33 · 70 | 80 · 41 · 80 | 90 · 50 · 90 | 50 · 39 · 71 | 45 · 34 · 66 |
| 400 | 32 | 100 · 47 · 100 | 110 · 55 · 110 | 90 · 39 · 90 | 50 · 38 · 82 | 45 · 34 · 77 |
| 600 | 53 | 170 · 83 · 170 | 180 · 92 · 180 | 130 · 50 · 130 | 50 · 37 · 103 | 85 · **67** · 138 |
| 1.000 | 97 | 300 · 148 · 300 | 310 · 156 · 310 | 260 · 114 · 260 | 50 · 36 · 147 | 215 · 174 · 312 |

Formato de cada celda: cobra · margen · Q paga.

Lo que dice la tabla:

1. **Al volumen esperado (unas 225), BYOC le deja a NovuChat más dólares que hoy**: 35 a 39 USD contra 24. La razón es que NovuChat deja de pagar unos 13 USD de Meta y 1,5 de chip.
   - **El precio de BYOC que iguala el margen de hoy es USD 33.** Por debajo, NovuChat pierde con el cambio.
2. **Para Q'Taco, BYOC sale más caro hasta unas 330 conversaciones** y más barato por encima, porque deja de comprar bolsas.
   - Con 225 pagaría 58 USD en BYOC 45/500 contra 50 hoy: unos 8 USD más al mes por tener su canal y su nombre.
   - Con 400 pagaría 77 contra 100.
3. **BYOC de lista (50/2.000) no sube con el volumen.** A 600 o 1.000 conversaciones, NovuChat queda en unos 36 USD mientras la factura de Meta de Q'Taco pasa de 50 USD. Ese tope está pensado para un comercio grande con portafolio verificado (Dhermacore), no para un restaurante que recién empieza.
4. **El contrato de 40 es el peor caso**: 47 % a 55 % de margen, debajo de lo que dejan Bellido (67 %) y la lista de Crecimiento.
   - El descuento de la propuesta del 11/09 se pensó con la unidad vieja (tope de 25 con corte) y con el Demo B, que no avisaba al restaurante.
   - Hoy cada pedido manda 5 avisos.

## 3. Lo que no está en la planilla y decide

| Condición | Con el canal de NovuChat (hoy) | Con BYOC (canal de Q'Taco) |
|---|---|---|
| **Cupo de Meta** | Ocupa uno de los 2 números de `NovuChat Produccion`, y Andres ya tiene 5 portafolios. El próximo cliente no entra sin un portafolio verificado o sin Tech Provider | No consume cupo: es justamente lo que `base-comercial` §3 dice que decide BYOC |
| **Nombre visible** | «NovuChat». Pedir «Q'Taco» en un portafolio que es de NovuChat no está verificado y puede rechazarse | «Q'Taco», desde su propio portafolio |
| **Promociones de Facebook** | La página del restaurante tendría que enlazarse a un número que no es suyo (a verificar en Meta) | La página, la cuenta publicitaria y el número quedan del mismo dueño |
| **De quién es el número** | Es un chip de NovuChat. Si Q'Taco se va, el número que aprendieron sus clientes por los anuncios se queda con nosotros. Nos da poder de negociación, pero a ellos les da riesgo y frena la venta | Es suyo |
| **Quién paga Meta** | NovuChat: 7 a 53 USD al mes según el volumen. Hay que decirlo en el contrato | Q'Taco, con su tarjeta. **Si la tarjeta falla, no salen las plantillas**: los avisos a cocina se cortan y los pedidos no llegan. Es un riesgo de servicio, aunque la deuda no sea nuestra |
| **Lo que cuesta pasar** | 0 | El dueño en una sesión de Meta (portafolio, verificación, tarjeta); migrar o reemplazar el número; volver a aprobar las plantillas en la WABA nueva; repetir el alta en el receptor de AAB1 con la WABA nueva; poner titularidad `comercio` y el plan en la consola (el servidor ya separa los tres ejes, `central/ejes.ts`) |

**Hay una tercera vía, la de Bellido:** el portafolio y el número son del comercio, pero la tarjeta cargada es la de Andres. Libera el cupo y le da a Q'Taco su nombre, sin trasladarle el riesgo de la tarjeta. En plata es igual a hoy: NovuChat sigue pagando Meta, así que corresponde el precio de Crecimiento de lista o de Pro, no el de BYOC.

## 4. Qué conviene, en orden

1. **Ahora (piloto de octubre): no tocar nada.** Seguir con Crecimiento a 40 en prueba, como se pactó. Medir dos o tres semanas lo que falta: conversaciones al mes, la mezcla real, mensajes al restaurante por pedido y qué parte llega desde un anuncio. Los scripts de medición de Gemini ya leen ejecuciones de n8n; para Meta hace falta el `pricing_analytics` de la WABA (FinOps).
2. **En el pase a producción (noviembre), elegir según lo medido:**
   - **Si Q'Taco puede poner portafolio, número y tarjeta: BYOC por contrato a USD 45 por 500 conversaciones, con bolsa encima.** Al volumen esperado deja unos 35 USD al mes (77 %), contra 24 hoy. A Q'Taco le cuesta unos 8 USD más que hoy a cambio de su nombre y su número. Si las promociones despegan, sigue dejando margen.
     - Se escribe con `asignar-plan --plan byoc --conversaciones 500 --precio 45` y con titularidad `comercio` en la ruta del número.
   - **Si no puede o no quiere manejar Meta: la vía de Bellido**, con Crecimiento de lista 50/220 (55 % de margen al volumen esperado), o Pro 90/500 si pasa de unas 350 conversaciones al mes.
   - **El contrato de 40 no se renueva** con el flujo actual: se pactó cuando el restaurante no recibía avisos.
3. **Bajar el costo de los avisos, que es lo que más pesa**, sirva el plan que sirva:
   - un solo destinatario en lugar de dos;
   - la imagen del comprobante dentro del detalle y no aparte.
   
   Cada mensaje menos por pedido son unos 0,0113 USD por 135 pedidos al mes, cerca de 1,5 USD. En BYOC ese ahorro es de Q'Taco y en el canal de NovuChat es nuestro. Cualquier cambio al flujo declara sus mensajes (`CLAUDE.md`).

## 5. Lo que hay que decir al ofrecer BYOC

- **La factura de Meta no son «centavos»**: unos 13 USD al mes con 225 conversaciones y unos 53 con 600 (alrededor de 165 y 670 Bs al TCO de 12,60). Es la regla de `base-comercial` §3 y de la prohibición 3.
- **No prometer la ventana gratuita de las conversaciones que nacen de un anuncio** hasta medirla (`base-comercial` §6). Si existe, baja la factura de Meta de Q'Taco y no cambia la nuestra.
- **El modelo de IA lo elige NovuChat**: el tope de BYOC se fija contra Gemini Flash-Lite (`Analisis/39` §2).
- **Sin tarjeta no hay avisos.** El contrato dice qué pasa si la tarjeta de Meta falla, y la consola tiene que mostrarlo.

## 6. Supuestos y límites

- Los mensajes salen del diseño y de la suite, no de producción: el piloto empieza el 05/10.
- La mezcla 60/25/15 y las 225 conversaciones son supuestos del diseño (150 pedidos y 40 reservas). Los avisos al restaurante se cobran todos a 0,0113 USD, sin franquicia. Es conservador: con las ventanas cerradas, un pedido manda 2 plantillas y no 5.
- Tarifas, impuestos, fijo prorrateado (21,82 USD entre 10 comercios) y chip (1,50 USD): los de `Analisis/47`. Gemini, a 0,004 USD por conversación, sigue el patrón medido en Bellido (`Analisis/43` §8). El factor contra la factura real de Google se ajusta cuando FinOps cierre septiembre.
- No incluye la instalación (USD 65 de lista; la propuesta del 11/09 decía 125) ni el valor de los cambios incluidos (Crecimiento 1; BYOC 2, a USD 15 de referencia cada uno, `Analisis/43` §3.3).
