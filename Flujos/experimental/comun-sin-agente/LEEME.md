# comun-sin-agente — piezas comunes para flujos «sin agente»

Flujos en los que **el código calcula y el modelo conversa**: estado por teléfono, botones, mensajes armados por
código, y el modelo solo redacta lo que el código verifica. Sacado de `Flujos/experimental/agenda-minima/`, que
**no se toca** y sigue con sus propias copias. Es experimental: vive fuera de las zonas y de `fronteras.test.ts`.

| Pieza | Qué es |
|---|---|
| `construir.mjs` | Armador genérico: plantilla + código de los nodos → un JSON por variante (producción y prueba), con `--verificar`. Se configura con un `construir.config.json` en la carpeta del flujo. Reproduce, byte por byte, los JSON de Agenda mínima. |
| `src/mensajes.js` | Constructores de lo que sale por WhatsApp: texto, botones, lista, enlace, URL de wa.me y «pasar con una persona» (botón, o solo texto sin mención del botón si no hay a quién). Prefijo `cm`. |
| `src/filtro-redaccion.js` | Lo que el modelo redacta se **verifica** antes de salir: monto, promesas, afirmar un hecho que solo el código puede afirmar, huecos de plantilla, enlaces ajenos, identidad. Y se **pule**. Las reglas de NovuChat no se apagan con opciones. |
| `src/envio.mjs` | La cadena de envío: nodos y conexiones (¿Enviar de verdad?, envío con lote de 1 y 1,5 s, respaldo en texto, reporte saliente), sin credenciales por id. `injertar()` la cuelga de una plantilla. |

## Cómo se usa

1. En la carpeta del flujo, un `construir.config.json`:

   ```json
   {
     "plantilla": "flujo.plantilla.json",
     "raiz": "../..",
     "comun": ["src/nodos/comun.js"],
     "paquetes": {
       "mensajes": ["../comun-sin-agente/src/mensajes.js"],
       "filtro": ["../comun-sin-agente/src/filtro-redaccion.js"]
     },
     "variantes": [
       { "archivo": "mi-flujo.v0.json", "quitar": "Entrada de prueba", "nombre": "Mi flujo (v0)" },
       { "archivo": "mi-flujo.prueba.json", "quitar": "WhatsApp Trigger", "nombre": "Mi flujo (v0, prueba)" }
     ]
   }
   ```

2. En la plantilla, cada nodo Code lleva una marca: `"jsCode": "@@comun+mensajes+filtro:nodos/armar.js"`.
   Modos: `todo` (librerías + comunes + paquetes + nodo; `@@nodos/x.js` es lo mismo), `comun` y `solo`.
3. `node Flujos/experimental/comun-sin-agente/construir.mjs --proyecto <carpeta>` escribe los JSON;
   con `--verificar` falla si lo versionado difiere de lo que se arma.
4. La cadena de envío: `injertar(plantilla, { credenciales: { graph, ingesta }, ingestaUrl, siguiente })`
   desde un `.mjs` propio del flujo, antes de armar.

## Lo que NO hace

- **Ninguna lectura fuera de `raiz`**, ninguna ruta con `..`, ningún `.env`, ninguna llamada a la red.
- **Ningún identificador**: las credenciales van por nombre y la URL de la ingesta es obligatoria.
- **Nada de agenda ni de un negocio**: ni horarios, ni calendario, ni «lo clínico», ni nombres de personas.
  Eso entra por `opciones` (`prohibidos`, `extra`, `quienPromete`).
- No reemplaza a `Flujos/src/core/` (`uso-extendido`, `comercio-no-operativo`, `config-del-negocio`,
  `normalizar-entrada`): esos son de los flujos con agente y los usa Core. **Quedan fuera** a propósito;
  fusionar las copias con Core es una decisión posterior.

## Pruebas

`admin/pruebas/comun-sin-agente-*.test.ts` (cuatro suites, registradas en `SUITES_PURAS`). Las de Agenda mínima
siguen verdes sin cambios: este módulo las usa solo para comparar, leyendo sus archivos.

## Costo

Cero mensajes por conversación agregados o quitados: no hay ningún flujo desplegado. Una cadena de envío con lote
de 1 y 1,5 s por mensaje añade 1,5 s de espera por mensaje adicional del mismo turno, igual que Agenda mínima.
