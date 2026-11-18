/**
 * miniCRM, una fila por conversación (08/11/2026): lo que se exige a los JSON regenerados de los flujos. Sin `git show`: la línea base está escrita aquí
 * (medida contra los 15 JSON de origin/main el 08/11/2026) y no depende de la historia del repositorio (se rompería en un clon superficial).
 * Mensajes por conversación: 0.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
type Nodo = { name: string; type: string; parameters?: { jsCode?: string } };
const cargar = (a: string): { nodes: Nodo[] } => JSON.parse(readFileSync(join(RAIZ, 'Flujos', 'experimental', a), 'utf8')) as { nodes: Nodo[] };

/** [archivo, nodos, nodos que hablan con Meta]: la línea base de origin/main. El cambio NO agrega ni quita ninguno. */
const LINEA_BASE: Array<[string, number, number]> = [
  ['agenda-minima/agenda-minima.prueba.json', 71, 5], ['agenda-minima/agenda-minima.v0.json', 71, 5],
  ['captacion-minima/captacion-minima.novuchat.json', 52, 5], ['captacion-minima/captacion-minima.prueba.json', 52, 5],
  ['../clientes/novuchat/chat-novuchat.novuchat.json', 76, 5], ['../clientes/novuchat/chat-novuchat.prueba.json', 76, 5],
  ['../clientes/rroca-antonio/rroca-antonio.json', 68, 6], ['../clientes/rroca-antonio/rroca-antonio.prueba.json', 63, 6],
  ['../clientes/rroca-emma/rroca-emma.json', 53, 6], ['../clientes/rroca-emma/rroca-emma.prueba.json', 48, 6],
  ['rroca-evy/rroca-evy.json', 53, 6], ['rroca-evy/rroca-evy.prueba.json', 48, 6],
  ['rroca-ruben/rroca-ruben.json', 68, 6], ['rroca-ruben/rroca-ruben.prueba.json', 63, 6],
  ['venta-minima/venta-minima.qtaco-3727.json', 84, 7],
];
const HOST_META = new RegExp(['graph', 'facebook', 'com'].join('\\.'));
// La rama del guardado de la imagen SALIENTE (16/11/2026) hace GET de una imagen ya enviada y la sube a `guardarMedio`: ningún nodo suyo manda un mensaje (+3 o +4 nodos en estos flujos, +0 emisores).
const RAMA_SALIENTE = ['Preparar guardado (saliente)', '¿Por enlace? (guardado saliente)', 'Descargar enlace (guardado saliente)', 'Pedir imagen a Meta (guardado saliente)', 'Descargar imagen de Meta (guardado saliente)', 'Guardar imagen enviada'];
const hablaConMeta = (n: Nodo): boolean => (!RAMA_SALIENTE.includes(n.name) && HOST_META.test(JSON.stringify(n.parameters ?? {}))) || n.type.endsWith('whatsApp');

describe('una fila por conversación: sin mensajes de Meta nuevos en los 15 JSON regenerados', () => {
  it('hay 15 JSON en la línea base', () => expect(LINEA_BASE).toHaveLength(15));
  it.each(LINEA_BASE)('%s: mismo conteo de nodos y de nodos que envían a Meta', (archivo, nodos, meta) => {
    const f = cargar(archivo);
    expect(f.nodes.length).toBe(nodos);
    expect(f.nodes.filter(hablaConMeta).length).toBe(meta);
  });
});

describe('una fila por conversación: la declaración de la fila mínima y el contrato en cada flujo con miniCRM', () => {
  const CON_MINICRM = ['agenda-minima/agenda-minima.v0.json', 'captacion-minima/captacion-minima.novuchat.json', '../clientes/novuchat/chat-novuchat.novuchat.json', '../clientes/rroca-antonio/rroca-antonio.json',
    '../clientes/rroca-emma/rroca-emma.json', 'rroca-evy/rroca-evy.json', 'rroca-ruben/rroca-ruben.json', 'venta-minima/venta-minima.qtaco-3727.json'];
  it.each(CON_MINICRM)('%s: el nodo «Prospecto para la planilla» lee el contrato nuevo y declara la fila mínima', (archivo) => {
    const codigo = cargar(archivo).nodes.find((n) => n.name === 'Prospecto para la planilla')?.parameters?.jsCode ?? '';
    expect(codigo).toContain('minima: true');
    expect(codigo).toContain('conversacionDesde');
    expect(codigo).toContain('conversacionNueva');
    expect(codigo).not.toContain('ventanaVenceEn');
  });
});
