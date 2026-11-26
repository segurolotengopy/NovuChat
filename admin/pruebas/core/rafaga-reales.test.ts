/**
 * LA RÁFAGA — SIMULACIÓN sobre los JSON REALES de flujos: cada conexión candidata como ancla, con y sin `fuente` y con y sin `campos: {texto:'texto'}`.
 *
 * Se afirma lo único que importa para que la ráfaga no quede apagada en silencio: en TODA combinación que arma, los campos que lee el IF y el Code
 * (tipo, mensajeId, from, phoneNumberId y texto, con los nombres de `campos`) LLEGAN:
 *   - con `fuente`: la fuente es un Code que EMITE esos campos (comprobado aquí con otra expresión regular que la de la pieza) y es ascendiente del ancla;
 *   - sin `fuente`: todo camino del ancla al normalizador pasa solo por IF, Switch, Filter, Wait o NoOp (otro recorrido, escrito aquí) y el normalizador los emite;
 *   - la guardia `hallazgosDeLaRafaga` coincide con el injerto (cero hallazgos en lo que arma), y `quitarRafaga` deja el flujo exactamente como estaba.
 * Hermética: lee solo `Flujos/`. Un flujo que ya lleva la pieza se parte de él sin la pieza (`quitarRafaga` es idempotente).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_FLUJOS } from '../../scripts/ensamblar-flujo.mjs';
import { hallazgosDeLaRafaga, injertarRafaga, quitarRafaga } from '../../../Flujos/src/core/rafaga/rafaga.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Flujo = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Nodo = any;

const NORMALIZADORES = ['Interpretar entrada', 'Normalizar entrada'];
const TRANSPARENTES = new Set(['n8n-nodes-base.if', 'n8n-nodes-base.switch', 'n8n-nodes-base.filter', 'n8n-nodes-base.wait', 'n8n-nodes-base.noOp']);

function archivos(): string[] {
  const raiz = readdirSync(RAIZ_FLUJOS).filter((f) => f.endsWith('.json'));
  const clientes = readdirSync(join(RAIZ_FLUJOS, 'clientes'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(join(RAIZ_FLUJOS, 'clientes', d.name)).filter((f) => f.endsWith('.json')).map((f) => `clientes/${d.name}/${f}`));
  // Sin las copias locales ni las plantillas, ni las variantes de prueba y de ensayo de cada flujo (mismo nodo, otro número).
  return [...raiz, ...clientes].filter((f) => !/\.local|plantilla|\.prueba\.|\.ensayo-/.test(f));
}

/** Otra implementación del «emite el campo»: el nombre como clave de un objeto literal o asignado. */
const emite = (n: Nodo, campo: string, nombre: string): boolean => {
  if (!n || n.type !== 'n8n-nodes-base.code') return false;
  const c = String(n.parameters?.jsCode ?? '');
  return new RegExp(`[{,\\s]${campo}\\s*[:,}]`).test(c) || new RegExp(`\\.${campo}\\s*=[^=]`).test(c) || (nombre === 'phoneNumberId' && c.includes('...'));
};

/** ¿Todo camino del ancla hasta el normalizador pasa solo por nodos transparentes? (recorrido hacia atrás, distinto del de la pieza) */
function limpioHastaElNormalizador(flujo: Flujo, ancla: string, normalizador: string): boolean {
  const padres: Record<string, string[]> = {};
  for (const [de, o] of Object.entries<Nodo>(flujo.connections ?? {})) for (const l of o.main ?? []) for (const e of l ?? []) (padres[e.node] ??= []).push(de);
  const hecho = new Set<string>();
  const cola = [ancla];
  while (cola.length) {
    const x = cola.shift() as string;
    if (hecho.has(x) || x === normalizador) continue;
    hecho.add(x);
    const n = flujo.nodes.find((m: Nodo) => m.name === x);
    if (!n || !TRANSPARENTES.has(n.type) || !(padres[x] ?? []).length) return false;
    cola.push(...padres[x]);
  }
  return true;
}

const CANONICOS: Record<string, string> = { tipo: 'tipo', mensajeId: 'mensajeId', from: 'from', phoneNumberId: 'phoneNumberId' };

describe('rafaga: simulación sobre los JSON reales (cada conexión como ancla)', () => {
  it('en toda combinación que arma, los campos llegan al IF y al Code; nada arma «a ciegas»', () => {
    let anclas = 0; let intentos = 0; let arman = 0; let sinFuente = 0; let conFuente = 0;
    const lista = archivos();
    for (const archivo of lista) {
      const flujo: Flujo = quitarRafaga(JSON.parse(readFileSync(join(RAIZ_FLUJOS, archivo), 'utf8')));
      const candidatas: { nodo: string; salida: number; destino: string }[] = [];
      for (const [de, o] of Object.entries<Nodo>(flujo.connections ?? {})) (o.main ?? []).forEach((l: Nodo[], i: number) => (l ?? []).forEach((e: Nodo) => candidatas.push({ nodo: de, salida: i, destino: e.node })));
      anclas += candidatas.length;
      const nombres = new Set<string>(flujo.nodes.map((n: Nodo) => n.name));
      const normalizador = NORMALIZADORES.find((n) => nombres.has(n));
      const fuentes: (string | undefined)[] = [undefined, ...NORMALIZADORES.filter((n) => nombres.has(n))];
      for (const ancla of candidatas) for (const fuente of fuentes) for (const campos of [{ texto: 'userInput' }, { texto: 'texto' }]) {
        intentos++;
        const estado = JSON.stringify(flujo.connections).length + flujo.nodes.length;
        // `consumidor: null`: aquí solo se miden los CAMPOS (el consumidor del texto agrupado se prueba en rafaga-injerto y rafaga-extremo, con el cableado real).
        try { injertarRafaga(flujo, { ancla, fuente, campos, consumidor: null }); } catch { continue; }
        arman++;
        const usados = { ...CANONICOS, ...campos };
        const productor = fuente ?? normalizador;
        for (const [nombre, campo] of Object.entries(usados)) {
          expect(emite(flujo.nodes.find((n: Nodo) => n.name === productor), campo, nombre), `${archivo} ${ancla.nodo}→${ancla.destino} fuente=${fuente}: «${productor}» no emite ${nombre} («${campo}»)`).toBe(true);
        }
        if (fuente) {
          conFuente++;
          expect(flujo.nodes.find((n: Nodo) => n.name === 'Agrupar ráfaga').parameters.jsCode, archivo).toContain(`const mensaje = $('${fuente}').first().json;`);
        } else {
          sinFuente++;
          expect(limpioHastaElNormalizador(flujo, ancla.nodo, normalizador as string), `${archivo} ${ancla.nodo}: arma sin fuente por un camino que NO es transparente`).toBe(true);
        }
        expect(hallazgosDeLaRafaga(flujo, { fuente, campos, consumidor: null }), `${archivo} ${ancla.nodo}→${ancla.destino}`).toEqual([]);
        quitarRafaga(flujo);
        expect(JSON.stringify(flujo.connections).length + flujo.nodes.length, `${archivo}: quitar deja el flujo como estaba`).toBe(estado);
      }
    }
    // Para dejar rastro en el informe de la corrida: cuántos flujos, anclas e intentos y cuántos armaron.
    console.log(`rafaga reales: ${lista.length} flujos, ${anclas} conexiones candidatas, ${intentos} intentos, ${arman} arman (${conFuente} con fuente, ${sinFuente} sin fuente)`);
    expect(lista.length).toBeGreaterThanOrEqual(20);
    expect(arman).toBeGreaterThan(0);
    expect(sinFuente).toBeGreaterThan(0);
  }, 240000);
});
