# Límites comerciales: dónde se hace cumplir cada uno

> Copia del §7 de `docs/base-comercial.md` (antes `CLAUDE.md` «Base comercial»
> §7), puesta junto a los manifiestos porque cada módulo declara sus límites y
> esta tabla dice en qué zona se hacen cumplir y en qué estado están. **La
> fuente es `docs/base-comercial.md`**; si las dos difieren, manda aquélla y se
> corrige ésta. Con el registro de módulos (F2), cada fila de la tabla pasa a
> ser la clave `limites` del manifiesto del módulo dueño, o de Central cuando
> el límite no es de ningún módulo (`conversaciones`, `cambiosIncluidos`).

| Límite | Zona dueña |
|---|---|
| Agendas por plan | módulo Agenda |
| Conversaciones incluidas | Central (cuenta), lo cuenta el Core |
| Bloque de 25 respuestas por conversación | Core (conteo) |
| Umbrales de operador y bloqueo | Core (conteo), parametrizables por empresa desde Plataforma |
| Ítems del catálogo que van al prompt | módulo Productos |
| Productos del catálogo por plan | módulo Productos |
| Campañas simultáneas por plan | módulo Campañas |
| Aviso de consumo al 80 % | Central (cuenta) |
| Cambios de configuración incluidos al mes (`cambiosIncluidos`, F1) | Central (cuenta) |

### 7. Todo límite comercial se hace cumplir en el SERVIDOR

**Un límite que solo existe en la pantalla no existe.** La consola arma la
petición desde el navegador: esconder un campo, deshabilitar un botón o no
dibujar una fila **no impide nada**. Es el mismo criterio que `admin/DISENO.md`
§4sexies.2 ya aplica a la política de capas, ahora extendido a lo comercial.

**Dónde va cada límite:**

| Límite | Se hace cumplir en | Estado |
|---|---|---|
| **Agendas por plan** (1 / 5 / hasta 10) | `firestore.rules`, al crear un funcionario: contar los activos y leer el plan de `cuenta/estado` | **No existe todavía.** Hoy se pueden cargar sin tope. El número ya viaja en la copia `cuenta/estado.limites.agendas` (`planes.ts`); falta la regla, con un contador como el del catálogo |
| **Conversaciones incluidas** (100 / 220 / 500) | `ingesta.ts`, dentro de la transacción que ya cuenta: `estadoDeServicio` (`prepago.ts`, puro) decide `sin_conversaciones` con la copia `cuenta.limites.conversaciones`, descuenta la bolsa y anota `cuenta.corte`; `configuracionFlujo` corta con el 409 que los flujos ya obedecen | **En `main` en modo observación** desde el 20/09 (`prepago/modulo-y-cortes`, `DISENO.md` §4undecies): el corte se calcula, se anota con `aplicado: false` y se cuenta lo perdido, pero **no corta** hasta que Andres encienda `plataforma/prepago.corteActivo` con `fijarCortePrepago`. Solo con `modalidad`; una demostración no se corta nunca. `pruebas/prepago-ingesta.test.ts`, `prepago-configuracion.test.ts` |
| **Bloque de 25 respuestas por conversación** (la 26 factura otra) | `ingesta.ts`, en la misma transacción que cuenta (`mensajesVentana`, `bloquesAdicionales`) | **Hecho el 13/09** en `cobro/bloques-de-25`, con `pruebas/conteo-bloques.test.ts` |
| **Umbrales de operador y bloqueo** (50 / 100, por empresa) | `atencion.ts` decide; la ingesta anota `atencionEstado` y cuenta; `configuracionFlujo` devuelve `atencion.estado` si el flujo manda `telefono` | **Servidor en `main` desde el 13/09** (`pruebas/umbrales-atencion.test.ts`). **Flujos A y B obedecen en el JSON versionado** (`flujos/umbrales-atencion`, `pruebas/flujos-umbrales.test.ts`): `Traer configuración` manda `telefono` y `¿Atención normal?` bifurca antes del agente. **Falta publicarlos**, después de `v0.2.0`, y probarlos contra un teléfono real |
| **Ítems del catálogo** que van al prompt | `configuracionFlujo`, al armar la respuesta | Hoy hay `limit(200)`, sin corte por plan |
| **Productos del catálogo por plan** (20 / 100 / 500) | `firestore.rules` al crear o borrar un producto, en el mismo lote que el contador `contadores/catalogo`; la importación en lote por la callable `importarCatalogo` (`limiteCatalogo.ts`). El número es `limitesDeCuenta` de `planes.ts`: la copia `cuenta/estado.limites.productos` y, sin copia, el plan | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/reglas.test.ts` («Límite de productos por plan») y `pruebas/limite-catalogo.test.ts`. **Falta desplegarlo**, y el contador va ANTES que las reglas: `docs/seguridad/reglas-storage.md` §Despliegue |
| **Campañas simultáneas por plan** (0 / 3 / 10, BYOC 10; confirmado por Andres el 24/09) | `firestore.rules` en `config/campanas`: `lista.size() <= limiteCampanas()`, con la copia `cuenta/estado.limites.campanas` (0 a 10) o el plan; `configuracionFlujo` recorta al tope de hoy | **Hecho el 24/09** en `claude/bellido-eleccion-del-menu`, con `pruebas/campanas-reglas.test.ts` y `pruebas/campanas.test.ts` (`DISENO.md` §4sexdecies). **Falta desplegar** reglas y Functions |
| **Aviso de consumo al 80 %** de las conversaciones del plan | `ingesta.ts`, en la transacción que ya cuenta: marca `cuenta/estado.avisoConsumo` una vez por mes. La consola lo muestra (tablero, estado de cuenta, cartera) y no lo calcula | **Hecho el 15/09** en `consolidado/planes-catalogo-storage`, con `pruebas/aviso-consumo.test.ts` (la ingesta real) y `pruebas/planes.test.ts`. Falta desplegar Functions |

**La regla al agregar cualquier límite nuevo:**

1. **La regla del servidor es la que manda**, y es la que se prueba. Una prueba
   que solo verifica que el botón está deshabilitado no prueba nada.
2. **La pantalla acompaña**, para que el comercio no descubra el límite con un
   error rojo: avisa antes, explica por qué, y ofrece subir de plan.
3. **La prueba se escribe negando**: el negocio con el plan chico **no puede**
   crear la agenda número 2, ni construyendo la petición a mano. Es el patrón
   que `pruebas/reglas.test.ts` ya usa para el aislamiento entre comercios.
4. **Y el límite se lee del plan, no se escribe en el código.** Los números de
   esta sección cambian; la regla que los aplica, no.
