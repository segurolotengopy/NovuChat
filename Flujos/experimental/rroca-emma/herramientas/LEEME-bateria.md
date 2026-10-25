# Batería de casos del asistente nuevo de la Dra. Emma (`rroca-emma`)

`bateria-casos.json` son DATOS (64 casos, unos 400 chequeos), adaptados de los de Evy (`Flujos/experimental/rroca-evy-bateria/`, mismo vocabulario de chequeos: ver su `LEEME.md`) y puestos al día con lo propio de Emma:

| Grupo | Qué cubre |
|---|---|
| A Bienvenida | Saludo, texto prellenado del anuncio («Hola Dra. Emma, vi su anuncio de bioestimuladores…»), primer mensaje con la duda «Sculptra o Radiesse» (sin imagen: la comparativa no existe), nombre y deseo sin repetir la bienvenida. |
| B Caso B | Las TRES capturas de Emma (bata «Activa tu colágeno natural», antes y después «Resultados reales, sigues siendo tú», espejo «Te sientes joven por dentro»), la comparativa que aún no existe (la visión la ve como «otra») y una selfie ajena. |
| C Ver resultados | «Quiero ver cómo queda», «¿Cómo quedan?», «¿Cuál caso?», «¿me va a quedar igual?»; etiqueta del antes y después con «cada piel (o rostro) responde distinto». |
| D Productos | Diferencia Sculptra/Radiesse (la doctora decide; sin imagen), «¿cuál me conviene?», cada producto en particular, quién aplica, y cómo funciona (etiqueta de autoridad = bata). |
| Costo | NINGUNA cifra de dinero, ni siquiera un «valor habitual» (Emma no tiene ancla de monto). |
| Objeciones | ¿Gratis de verdad (sin pago de reserva)?, no hacerme nada, relleno de hialurónico, dolor (sin lidocaína: la doctora explica en la valoración), artificial, recuperación, «ya probé otros», «lo voy a pensar», ubicación en texto, **horario de turno partido que sale de la Consola**, «¿desde la primera sesión?». |
| Cierre | Acepta agendar, horarios sin nombre, charla larga, «gracias» tras el cierre, intención vaga, **Emma no agenda** («reservame el martes a las 10»). |
| Barreras | IA, doctora «de verdad», garantía, urgencia, embarazo, pareja, baja, inyecciones, audio, sticker… (las mismas de Evy con los datos de Emma). |
| Invariantes | Sin repetir, botón que no reaparece, el cierre completo UNA vez, «Quiero ver cómo queda» no deriva (humo del 24/10), y la invariante H-i10: ningún dato de otra doctora. |

## Cómo correrla (la corre Andres o la coordinación, con clave de PRUEBAS y gasto autorizado)

```
node Flujos/experimental/rroca-emma/herramientas/bateria.mjs --seco                  # sin costo: 372 chequeos del código, 0 fallos
node Flujos/experimental/rroca-emma/herramientas/bateria.mjs --env <archivo> --n 1 --confirmo-gasto --motivo [--grupos G,E] [--duros]
```

- La clave de pruebas tiene un límite bajo de peticiones por minuto: el motor pausa 4500 ms entre llamadas (`--pausa-ms`). Una corrida completa con `--n 1` cuesta del orden de 0,15 USD (previsto por el propio motor en seco); por grupos, mucho menos.
- Criterio: al menos 85 % de los chequeos y 100 % de las barreras duras.
- Para activar la comparativa algún día hay que cambiar A3, B4, D1 y D2 (hoy exigen que NO salga la imagen comparativa).
