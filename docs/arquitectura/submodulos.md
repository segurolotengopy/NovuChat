# Lo general sube, lo específico es dato: el sub-módulo del anfitrión

> Decisión de Andres, 22/10/2026. Sustituye a la regla anterior («la segunda
> vez que otro cliente pide una pieza propia, pasa a módulo»). Complementa a
> `tenants.md` (sección «El flujo de un cliente») y a `registro.md` (frontera
> de zonas).

## La regla

Lo **general** (lógica y textos base) sube a core o a un módulo común. Lo
**específico** de un cliente (tratamiento, tono, calendario, catálogo, reglas
comerciales) es un **dato de su tenant**, en su config. Si lo específico es
**código** y otro cliente también lo necesita, se adjunta como **sub-módulo**
del cliente anfitrión, sin copiarlo y sin mezclar datos.

**Frontera de seguridad:** ni datos, ni secretos, ni rutas compartidas entre
tenants. Solo se comparte código declarado.

## Clasificación: general o específico

| Pieza | Clase | Dónde vive |
|---|---|---|
| Párrafos separados (una idea por párrafo, línea en blanco) | General | core |
| «No repetir»: mecanismo y textos alternos | General | core / módulo común |
| QR abierto completo | General | módulo Cobros |
| Cotejo de comprobantes completo | General | módulo Cobros |
| Filtro de promesas sin respaldo | General | core |
| Medios entrantes (audio, imagen, documento) | General | core |
| Fichas por teléfono | General | core / módulo común |
| Topes (límites del plan, leídos del plan) | General | core |
| Extranjeros (números y nombres de fuera del país) | General | core |
| Puerta y resumen del turno | General | core / coordinador |
| Tratamiento «usted» frente a «tú» | Específico | dato del tenant |
| Tono cálido del Puente de Antonio | Específico | dato del tenant |
| No agendar en el Google Calendar de las doctoras | Específico | dato del tenant |
| Catálogo y oferta propios | Específico | dato del tenant |
| Reglas comerciales propias | Específico | dato del tenant |
| Redacción protectora de recordatorios de Bellido | Específico | dato del tenant (y, si es código que otro necesita, sub-módulo de Bellido) |

Criterio: si la pieza se escribe igual para cualquier cliente cambiando solo
datos, es general o es dato; solo es sub-módulo cuando es **código** propio de
un cliente que un segundo cliente necesita tal cual.

## Declaración del sub-módulo

> **Estado: declarado, la prueba aún no existe.** `submodulos.test.ts` y la
> extensión de `fronteras.test.ts` descritas abajo no están construidas; hasta
> que estén en verde esto es una regla escrita, no una garantía.

- **Carpeta:** `Flujos/clientes/<anfitrión>/submodulos/<nombre>/`, con un
  `SUBMODULO.md` que describe qué hace, sus entradas y salidas.
- **Manifiesto** en el `PROPIO.md` del anfitrión: nombre, versión, funciones
  exportadas, consumidores autorizados por tenant y la lista de prohibidos
  (datos, secretos, rutas, colecciones, ids de números).
- **Consumo:** el consumidor declara en su `PROPIO.md`
  `usa anfitrion/nombre@versión`.
- **Inclusión, nunca copia:** `construir.mjs` incluye el código del sub-módulo
  y lo compara byte a byte contra la fuente; nunca se copia ni se edita en el
  consumidor.

## Pruebas (futuras)

- **`submodulos.test.ts`:** el consumo está declarado en ambos lados; el código
  incluido es idéntico a la fuente; no hay ids, rutas, phone ids, nombres ni
  credenciales de ningún tenant; el sub-módulo importa solo de core.
- **`fronteras.test.ts`:** falla si un cliente importa de otro fuera de este
  mecanismo.

## Seguridad

- La configuración entra **por parámetro**; el sub-módulo no lee datos de otro
  tenant.
- El estado vive solo en el tenant que corre el código.
- Todo cambio del anfitrión avisa a los consumidores y pasa por el agente
  `seguridad` antes de fusionarse.
