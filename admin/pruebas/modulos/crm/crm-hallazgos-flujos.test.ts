/**
 * El CI exige las barreras del miniCRM a CADA flujo versionado que lo use: `hallazgosCrm` (rangos que no llegan a la
 * columna de Diagnóstico ni pasan de la última del bot; retención de ejecuciones en `none`, sin progreso y sin guardar
 * las manuales) tiene que dar vacío. Al sumar un flujo con miniCRM (F1 a F4), se agrega acá.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hallazgosCrm } from '../../../../Flujos/experimental/comun-sin-agente/construir-crm.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const leerJson = (r: string) => JSON.parse(readFileSync(join(RAIZ, r), 'utf8'));

const FLUJOS: { flujo: string; json: string; datos: string }[] = [
  { flujo: 'chat-novuchat', json: 'Flujos/experimental/chat-novuchat/chat-novuchat.novuchat.json', datos: 'admin/scripts/datos/chat-novuchat/novuchat.json' },
  { flujo: 'chat-novuchat (prueba)', json: 'Flujos/experimental/chat-novuchat/chat-novuchat.prueba.json', datos: 'admin/scripts/datos/chat-novuchat/novuchat.json' },
  { flujo: 'captacion-minima', json: 'Flujos/experimental/captacion-minima/captacion-minima.novuchat.json', datos: 'admin/scripts/datos/captacion-minima/novuchat.json' },
  { flujo: 'captacion-minima (prueba)', json: 'Flujos/experimental/captacion-minima/captacion-minima.prueba.json', datos: 'admin/scripts/datos/captacion-minima/novuchat.json' },
  { flujo: 'rroca-evy', json: 'Flujos/experimental/rroca-evy/rroca-evy.json', datos: 'admin/scripts/datos/rroca-evy/rroca-evy.json' },
  { flujo: 'rroca-evy (prueba)', json: 'Flujos/experimental/rroca-evy/rroca-evy.prueba.json', datos: 'admin/scripts/datos/rroca-evy/rroca-evy.json' },
  { flujo: 'rroca-emma', json: 'Flujos/experimental/rroca-emma/rroca-emma.json', datos: 'admin/scripts/datos/rroca-emma/rroca-emma.json' },
  { flujo: 'rroca-emma (prueba)', json: 'Flujos/experimental/rroca-emma/rroca-emma.prueba.json', datos: 'admin/scripts/datos/rroca-emma/rroca-emma.json' },
  { flujo: 'rroca-ruben', json: 'Flujos/experimental/rroca-ruben/rroca-ruben.json', datos: 'admin/scripts/datos/rroca-ruben/rroca-ruben.json' },
  { flujo: 'rroca-ruben (prueba)', json: 'Flujos/experimental/rroca-ruben/rroca-ruben.prueba.json', datos: 'admin/scripts/datos/rroca-ruben/rroca-ruben.json' },
  { flujo: 'rroca-antonio', json: 'Flujos/experimental/rroca-antonio/rroca-antonio.json', datos: 'admin/scripts/datos/rroca-antonio/rroca-antonio.json' },
  { flujo: 'rroca-antonio (prueba)', json: 'Flujos/experimental/rroca-antonio/rroca-antonio.prueba.json', datos: 'admin/scripts/datos/rroca-antonio/rroca-antonio.json' },
  { flujo: 'walisuma', json: 'Flujos/clientes/walisuma/walisuma.json', datos: 'admin/scripts/datos/walisuma/walisuma.json' },
  { flujo: 'walisuma (prueba)', json: 'Flujos/clientes/walisuma/walisuma.prueba.json', datos: 'admin/scripts/datos/walisuma/walisuma.json' },
  { flujo: 'agenda-minima (Bellido)', json: 'Flujos/experimental/agenda-minima/agenda-minima.v0.json', datos: 'admin/scripts/datos/bellido/crm.json' },
  { flujo: 'agenda-minima (Bellido, prueba)', json: 'Flujos/experimental/agenda-minima/agenda-minima.prueba.json', datos: 'admin/scripts/datos/bellido/crm.json' },
];

describe('barreras del miniCRM en cada flujo versionado', () => {
  it.each(FLUJOS)('$flujo no tiene hallazgos', ({ json, datos }) => {
    const mapa = leerJson(datos).crm;
    expect(mapa, 'el archivo de datos trae el mapa crm').toBeTruthy();
    expect(hallazgosCrm(leerJson(json), mapa)).toEqual([]);
  });
  it('se NIEGA: un flujo con retención de ejecuciones sí es hallazgo', () => {
    const f = leerJson(FLUJOS[0].json);
    f.settings = { ...f.settings, saveManualExecutions: true };
    expect(hallazgosCrm(f, leerJson(FLUJOS[0].datos).crm).join(' ')).toMatch(/retencion/);
  });
});
