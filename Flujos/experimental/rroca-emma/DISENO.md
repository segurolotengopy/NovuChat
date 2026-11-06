# El flujo nuevo de la Dra. Emma (tenant `rroca-emma`, cliente07): conversación libre, imágenes por etiqueta, barreras en código

Encargo (24/10/2026): el flujo nuevo de Emma por la **vía A: adaptar el flujo nuevo de Evy ya probado** (`../rroca-evy/`, fusionado con #643, #656 y sus rondas de revisión). Lo único que Emma hace es (1) mandar todo mensaje a un agente de IA que conversa libre, con memoria de 15 mensajes, y (2) usar como prompt el MD de la doctora del 24/10/2026 con las correcciones acordadas. Todo lo que el prompt no puede garantizar lo garantiza el código. **No se publica nada en este PR.**
Armador: `../comun-sin-agente/construir.mjs`, importado. `node construir.mjs` escribe `rroca-emma.json` y `rroca-emma.prueba.json`; `--verificar` y `--publicable [--etapa crear|prueba|encender]` no escriben.

## Qué es igual que Evy (y por eso no se repite aquí)
Topología (36 nodos en producción, 31 en la prueba; tope duro 36), receptor verificado, puerta del turno, medios (audio, imagen, documento), ficha por teléfono de 48 h, etiquetas de imagen y de derivación, todas las barreras de `evPulirSalida` (precios, garantías, consejo médico, cuidados posteriores, identidad/NIEGA_IA, promesas sin respaldo, agenda), la derivación que solo se honra si el cliente pidió agendar, el cierre completo UNA vez, el texto fijo de gratuidad, el recorte por oración con objetivo de 700 caracteres, el reintento del modelo y el motor de la batería (`--pausa-ms`, `--motivo`). Léase `../rroca-evy/DISENO.md` para el detalle y los porqués. La copia es literal salvo lo que sigue.

## Lo que cambia respecto de Evy
1. **Sin ancla de monto.** Evy puede decir «250 Bs» (valor habitual de la valoración bonificada); Emma **nunca menciona una cifra de dinero**. Las funciones del ancla quedan como identidad y cualquier monto cae al fallo con botón (prueba negada con «250 Bs», «1500 Bs» y rangos).
2. **La valoración es gratuita y SIN pago de reserva:** el cierre y el texto fijo de gratuidad lo dicen («100% gratuita y sin compromiso, sin pago de reserva»); no hay «bonificada».
3. **Imágenes:** dos activas (bata = `AUTORIDAD`, y `ANTES_DESPUES`). El espejo solo se reconoce (visión). La comparativa «¿Sculptra® o Radiesse®?» no existe: etiqueta preparada, inactiva y tolerada por la guardia (ver `PROPIO.md` §4).
4. **Caso B con los tres anuncios de Emma** y su lista cerrada de visión (`bata`, `antes_despues`, `espejo`, `otra`), en el prompt y en el nodo «Ver imagen».
5. **Horario y dirección de la Consola** (turno partido: lo lee del texto libre `operacion.horarioAtencion`; ni el prompt ni el código lo repiten). Si la Consola no responde, el asistente dice que la Dra. lo confirma en la valoración. Los ordinales de la dirección («2do y 3er anillo») se escriben con palabras antes de las barreras para que no parezcan un rango de precio.
6. **Identidad aislada:** «Config base» con `tenantId` = `rroca-emma`; la guardia de publicación y el publicador (`scripts/publicar-flujo.sh`) lo reconocen por contenido y nunca lo dejan reemplazar el flujo de Evy ni el de otro cliente (ni con `--forzar`).
7. **Datos versionados:** solo marcadores (`REEMPLAZAR_*`) para ruta, WABA, phone id, recepción, teléfonos de prueba, etapa de prueba y los ids de las imágenes; el número real de recepción nunca va en git. La guardia exige ids en el FLUJO que se publica, y acepta el marcador del id en los DATOS versionados.

## Costo declarado (base comercial, §1)
- **Mensajes por conversación:** 0 agregados sobre el flujo de Evy. Una conversación puede recibir hasta 2 imágenes de apoyo (la comparativa está inactiva; el tope general sigue en 3) y **+1 aviso a recepción por derivación** (texto libre dentro de la ventana de 23,5 h de la recepción o plantilla UTILITY `aviso_solicitud_valoracion` fuera de ella; una vez por motivo y teléfono cada 30 minutos).
- **Llamadas a Gemini:** 0 a 1 por turno (como Evy); la visión de una imagen suma una llamada de lectura.
- **Escrituras en GitHub y CI:** 1 PR; **nube:** ninguna en este PR (la carga de datos del negocio y la tabla local son pasos posteriores, con el «sí» de Andres).

## Lo que falta antes de publicar (nada de esto se hace en este PR)
- La plantilla `aviso_solicitud_valoracion` de la cuenta de Emma, con estado APPROVED (la etapa completa lo exige; la de prueba no).
- Los ids de medio de las dos imágenes activas (WAM ya los tiene) en la tabla local, y la ruta del receptor, el WABA y el phone id de Emma.
- La batería real con clave de PRUEBAS y gasto autorizado (`herramientas/LEEME-bateria.md`); guardar sus respuestas reales en `respuestas-reales.json` y agregar la regresión de G3 y G13 como en Evy.
- La recepción y el horario ya están en la Consola de rroca-emma (24/10/2026).
