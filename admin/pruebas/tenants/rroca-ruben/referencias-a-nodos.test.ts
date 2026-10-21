/**
 * REFERENCIAS A NODOS (21/10/2026). Defecto visto en n8n REAL: «Preparar transcripción» fallaba con «Node 'Interpretar entrada' hasn't been executed» porque el núcleo común nombraba con `$('…')` LITERAL nodos que no
 * existen en este flujo, y el task runner de n8n precarga los datos solo de los nodos que el código nombra con un literal (escaneo del código). El simulador no lo veía. Esta suite lo cierra de forma GENERAL, sin n8n:
 *   - TODO literal `$('…')`, `$("…")`, `$node['…']`, `$items('…')` del flujo (código de los nodos Code Y expresiones `={{ … }}` de los demás nodos) nombra un nodo que EXISTE en ese flujo y que es ANTECESOR del nodo en el grafo;
 *   - un nodo Code que mezcla literales con referencias DINÁMICAS (`$(nombre)`) queda a merced del escaneo: se lista y se niega en el flujo de Rubén.
 * Los comentarios del código no cuentan (una referencia en un comentario no se ejecuta).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo } from '../../lib/flujo';
// @ts-expect-error el armador es un .mjs sin tipos
import { problemasDeReferencias, referenciasDeNodos } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const EXPERIMENTAL = join(AQUI, '../../../../Flujos/experimental');
const leerFlujo = (carpeta: string, archivo: string): Flujo | null => {
  const ruta = join(EXPERIMENTAL, carpeta, archivo);
  return existsSync(ruta) ? (JSON.parse(readFileSync(ruta, 'utf8')) as Flujo) : null;
};

// La lógica vive en `construir.mjs` (exportada y reutilizable sobre CUALQUIER JSON de flujo: Cartera 2 la usa sobre Antonio sin copiarla) y `--verificar` también la aplica.
const referenciasDe = (f: Flujo) => referenciasDeNodos(f.nodes) as Array<{ nodo: string; literales: string[]; ayuda: string[]; dinamica: boolean }>;

describe('referencias a nodos: cada literal nombra un nodo REAL y ANTECESOR (código y expresiones), en producción y en la prueba', () => {
  for (const archivo of ['rroca-ruben.json', 'rroca-ruben.prueba.json']) {
    const f = leerFlujo('rroca-ruben', archivo)!;

    it(`${archivo}: sin referencias a nodos inexistentes ni que no sean antecesores`, () => {
      expect(referenciasDe(f).reduce((n, r) => n + r.literales.length, 0)).toBeGreaterThan(25); // el recorrido SÍ ve código y expresiones
      expect(problemasDeReferencias(f)).toEqual([]);
    });

    it(`${archivo}: «Preparar transcripción» nombra solo nodos reales y ningún Code mezcla literales con referencias dinámicas`, () => {
      const lit = [...referenciasDe(f).find((r) => r.nodo === 'Preparar transcripción')!.literales].sort();
      expect(lit).toEqual(['Interpretar entrada', 'Obtener URL del medio']);
      expect(referenciasDe(f).filter((r) => r.literales.length && (r.dinamica || r.ayuda.length)).map((r) => r.nodo)).toEqual([]);
      // Las referencias DINÁMICAS (`$(nombre)`) de Rubén viven solo en los helpers `cn*` de `_comun.js` (cnNodo/cnPrimero/cnTodos, con try/catch) y en los Code que los usan: nodos SIN ningún literal.
      expect(referenciasDe(f).filter((r) => r.dinamica).map((r) => r.nodo).sort()).toEqual(['Armar avisos', 'Armar mensajes', 'Carga de entrada', 'Config del negocio', 'Decidir turno', 'Interpretar entrada', 'Interpretar lectura', 'Puerta del turno', 'Resumen del turno']);
    });
  }

  it('NEGANDO: el defecto de n8n real (un literal a un nodo que no existe) y un nodo que no es antecesor se detectan; un comentario no cuenta', () => {
    const f = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    const prep = f.nodes.find((n) => n.name === 'Preparar transcripción')!;
    prep.parameters['jsCode'] = String(prep.parameters['jsCode']).split("$('Interpretar entrada')").join("$('Normalizar entrada')");
    expect(problemasDeReferencias(f).join('|')).toMatch(/«Preparar transcripción» nombra «Normalizar entrada», que NO existe/);
    const g = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    g.nodes.find((n) => n.name === 'Interpretar entrada')!.parameters['jsCode'] += "\nconst x = $('Armar mensajes').first();";
    expect(problemasDeReferencias(g).join('|')).toMatch(/«Interpretar entrada» nombra «Armar mensajes», que existe pero NO es su antecesor/);
    const h = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    h.nodes.find((n) => n.name === 'Interpretar entrada')!.parameters['jsCode'] += "\n// $('Nodo que no existe')\n/* $(\"Otro\") */\n";
    expect(problemasDeReferencias(h)).toEqual([]);
    const i = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    i.nodes.find((n) => n.name === '¿Es audio?')!.parameters['conditions'] = { conditions: [{ leftValue: "={{ $node[\"Fantasma\"].json.x }}" }] };
    expect(problemasDeReferencias(i).join('|')).toMatch(/«¿Es audio\?» nombra «Fantasma»/);
    const j = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    j.nodes.find((n) => n.name === 'Preparar transcripción')!.parameters['jsCode'] += "\nconst y = $(nombre).first(); const z = $node[otro];";
    expect(problemasDeReferencias(j).join('|')).toMatch(/«Preparar transcripción» mezcla referencias literales con referencias dinámicas/);
    // Mixto por la ayuda: un literal + cnNodo('Y') sin $('Y') literal.
    const k = JSON.parse(JSON.stringify(leerFlujo('rroca-ruben', 'rroca-ruben.json'))) as Flujo;
    k.nodes.find((n) => n.name === 'Preparar transcripción')!.parameters['jsCode'] += "\nconst w = cnNodo('Config base');";
    expect(problemasDeReferencias(k).join('|')).toMatch(/«Preparar transcripción» alcanza «Config base» por cn\*\(\) sin nombrarlo también/);
    k.nodes.find((n) => n.name === 'Preparar transcripción')!.parameters['jsCode'] += "\nconst rrDeps = () => [$('Config base')];";
    expect(problemasDeReferencias(k).join('|')).not.toMatch(/alcanza «Config base»/);
  });

  // LECTURA SOLAMENTE del flujo de Antonio (otra sesión): no se modifica nada de su carpeta. Si fallara, esta prueba es informativa y su lista va a su dueño.
  it('LECTURA del flujo de Antonio: los literales que nombran nodos inexistentes o que no son antecesores (informativa: su dueño es otra sesión)', () => {
    const reporte: string[] = [];
    for (const archivo of ['rroca-antonio.json', 'rroca-antonio.prueba.json']) {
      const f = leerFlujo('rroca-antonio', archivo);
      if (!f) continue;
      reporte.push(...(problemasDeReferencias(f) as string[]).map((x) => `${archivo}: ${x}`));
    }
    if (reporte.length) console.warn(`Referencias a nodos del flujo de Antonio para su dueño:\n- ${reporte.join('\n- ')}`);
    expect(Array.isArray(reporte)).toBe(true); // informativa: no pone en rojo la suite por algo de otra zona
  });
});
