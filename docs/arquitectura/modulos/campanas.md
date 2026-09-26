# Módulo Campañas

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | `campanas.ts`, `verificarCampanas.ts`, `config/campanas`; `Campanas.tsx` |
| **Depende de** | — |
| **Límite por plan** | campañas (0 / 3 / 10; BYOC 10; propuesta del 24/09 a confirmar). Hecho el 24/09 en `firestore.rules` en `config/campanas`: `lista.size() <= limiteCampanas()`, con la copia `cuenta/estado.limites.campanas` o el plan; `configuracionFlujo` recorta al tope. Ver `limites.md` |
| **Configuración** | `config/campanas`: texto exacto, vigencia, tope |
| **Colecciones** | `config/campanas` |
| **Pestañas** | Campañas (`admin`) |
| **Prompt** | las campañas vigentes recortadas al tope entran al contexto de turno |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | ninguno propio |
| **Ganchos** | `antesDelTurno` (recorta al tope), `despuesDelTurno`, `alCambiarConfig` (verificación) |
| **Mensajes por conversación** | 0 |
| **Pruebas** | `campanas.test.ts`, `campanas-reglas.test.ts`, `campanas-consola.test.ts`, `origen-del-anuncio.test.ts` |

**Observación:** límite 0 = módulo apagado. Las reglas hoy lo tratan como común; decisión del 25/09: **es módulo** (el plan de entrada no lo trae; eso es «se enciende por tenant»)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.

## Secciones movidas desde `admin/DISENO.md`

Texto original, sin cambios. Cada bloque dice de qué sección viene.


<!-- movido de admin/DISENO.md §4sexdecies (25/09/2026, líneas 2934-2943) -->

## 4sexdecies. Campañas de Meta: texto exacto, vigencia y tope por plan

**Decidido por Andres el 24/09/2026.** Un anuncio de clic a WhatsApp deja
escrito en el chat un texto que el comercio eligió al crear el anuncio. El
comercio carga ese **texto exacto** en la pestaña «Campañas», con fecha de
inicio y de fin, y puede tener **varias a la vez** hasta el tope de su plan.
Cuando llega ese texto, el flujo **salta el menú**: si el texto es igual a
una opción del menú, entra directo a esa rama; si no, va al asistente con la
campaña en el contexto. Una campaña nunca dispara la emergencia por su título.


<!-- movido de admin/DISENO.md §4sexdecies.1 (25/09/2026, líneas 2944-2957) -->

### 4sexdecies.1 Dónde vive, y por qué un documento

Capa **común** (§4sexies): un anuncio lleva al número del comercio, no a un
flujo. Un solo documento, `tenants/{t}/config/campanas`:

| Campo | Quién lo escribe | Qué es |
|---|---|---|
| `lista` | la consola (admin del comercio) | lo **propuesto**: `{id, texto, inicio, fin}`, fechas `AAAA-MM-DD` de Bolivia, fin inclusivo |
| `revision` | solo `verificarCampanas` | el veredicto por campaña (`aprobada`, `rechazada`, `pendiente`, `fuera_del_plan`), con motivo, campo y el hash de la lista |
| `vigentes` | solo `verificarCampanas` | las aprobadas: lo único que lee `configuracionFlujo` |

Un documento y no una colección porque así la regla hace cumplir el tope con
`lista.size()`, sin contador aparte (el tope máximo es 10).


<!-- movido de admin/DISENO.md §4sexdecies.2 (25/09/2026, líneas 2958-2978) -->

### 4sexdecies.2 El tope por plan, en el servidor

`planes.ts`: `campanas` por plan (Impulso 0, Crecimiento 3, Pro 10, BYOC 10,
demostración 10; **confirmado por Andres el 24/09/2026**) y `limiteDeCampanas`,
que lee la copia `cuenta/estado.limites.campanas` si es un entero de 0 a 10.
Va **fuera** de `Limites` porque ahí todo vale de 1 en adelante y la copia se
juzga completa con los tres de siempre.

La regla de `config/campanas` exige admin, comercio operativo, sello, que no se
toquen `revision` ni `vigentes` (por el diff), y `lista.size() <=
limiteCampanas()`, con la tabla escrita a mano y comparada con `planes.ts` por
la suite. **Una excepción deliberada:** si el plan bajó con campañas cargadas,
pasa una escritura que ACHICA la lista, para que el comercio pueda borrar.
`configuracionFlujo` recorta además al tope de hoy.

**La regla valida solo la forma mínima** de cada campaña (mapa de cuatro
claves, texto de hasta 300): una petición tiene un tope de 1.000 expresiones
evaluadas y validar campo por campo diez campañas lo agotaba desde la quinta
(medido en el emulador). El formato, las fechas y el contenido los decide el
servidor; una campaña mal escrita queda cargada y **nunca** se aplica.


<!-- movido de admin/DISENO.md §4sexdecies.3 (25/09/2026, líneas 2979-2991) -->

### 4sexdecies.3 La verificación antes de aplicar

`verificarCampanas` es un disparador sobre el documento, como
`verificarComportamiento` (§4quater.5), y solo actúa si cambió `lista`.
`campanas.ts` (puro) decide, en este orden: tope del plan, forma, fechas (fin
pasado, inicio pasado para una campaña nueva o con el inicio cambiado, inicio a
más de seis meses, más de un año de duración), duplicados por palabras,
palabras de emergencia, la capa 1 de patrones del comportamiento, y el modelo:
¿es algo que un cliente de ESTE negocio escribiría, sin contradecir su
configuración ni prometer precios o promociones que la información del negocio
no respalda? Con el mismo texto ya aprobado no se le vuelve a preguntar. Un
modelo caído deja la campaña `pendiente`, y una pendiente no se aplica.


<!-- movido de admin/DISENO.md §4sexdecies.4 (25/09/2026, líneas 2992-3004) -->

### 4sexdecies.4 El flujo

`configuracionFlujo` manda `campanas: [{id, texto, inicio, fin}]` con instantes
ISO: solo las `vigentes`, en curso hoy y dentro del tope. `Config del negocio`
vuelve a mirar la vigencia contra el reloj y deja `campanasActivas`.
`Normalizar entrada` compara las **palabras** del mensaje (sin mayúsculas,
tildes, signos ni emojis) con las de cada campaña, y lee además el `referral`
del anuncio de Meta. El estado de la conversación de Bellido salta el menú.
La consola compara con la misma cuenta; `campanas-consola.test.ts` lo fija.

**Mensajes:** −1 por cada conversación que entra por una campaña reconocida en
un flujo con menú (el menú no sale); 0 en el resto.
