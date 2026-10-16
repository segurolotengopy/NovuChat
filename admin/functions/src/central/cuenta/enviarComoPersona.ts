/**
 * ENVIAR COMO PERSONA, CABLEADO CON EL PLAN (CENTRAL, H2-3)
 *
 * `core/conversacion/enviarComoPersona.ts` no puede importar nada de Central (Core no depende de nada de
 * arriba) y `index.ts` solo reexporta (`fronteras.test.ts`). Este archivo es la costura: Central sí puede
 * importar de Core, y acá se arma la callable con lo que solo Central sabe, las cifras del plan
 * (`limitesDePersona`, de `planes.ts`), la tarifa de la cuenta (`tarifaDe`) y la titularidad del número
 * (`titularidadDe`, de `ejes.ts`). Las cifras viven en `planes.ts`; ni este archivo ni el envío las escriben.
 */
import { crearEnviarComoPersona } from '../../core/conversacion/enviarComoPersona.js';
import { titularidadDe } from '../ejes.js';
import { limitesDePersona, tarifaDe } from './planes.js';

export const enviarComoPersona = crearEnviarComoPersona({ limitesDePersona, titularidadDe, tarifaDe });
