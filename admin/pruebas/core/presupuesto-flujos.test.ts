/**
 * PRESUPUESTO DE TAMAÑO POR FLUJO (Andres, 23/10/2026): los ajustes no deben saturar los flujos de n8n.
 * Cada JSON de flujo versionado que corre o puede correr conversaciones tiene un presupuesto de nodos, jsCode y prompt
 * en `presupuesto-flujos.json`; la prueba falla si un flujo lo supera, si aparece un flujo sin entrada, si un prompt pasa
 * el tope duro de 6 KB sin exención vigente o si una entrada apunta a un archivo que ya no existe.
 * Cómo se mide y cómo se sube un presupuesto: docs/arquitectura/presupuesto-flujos.md.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXENCION_DIAS_MAX,
  RAIZ,
  TOPE_PROMPT_KB,
  aKB,
  aporteDeModulos,
  codigoMuertoDe,
  descubrirFlujos,
  fuentesDeModulos,
  leerFlujo,
  mayoresNodos,
  medir,
  problemasDeUnFlujo,
  type Entrada,
  type Medida,
  type Presupuesto,
} from './presupuesto-flujos.lib';

const presupuesto = JSON.parse(readFileSync(join(RAIZ, 'admin/pruebas/core/presupuesto-flujos.json'), 'utf8')) as Presupuesto;
const HOY = new Date().toISOString().slice(0, 10);
const descubiertos = descubrirFlujos();
const fuentes = fuentesDeModulos();

/** Desglose que se imprime al fallar: los 5 nodos de jsCode más grandes y el aporte (informativo) de cada módulo común. */
function desglose(ruta: string): string {
  const f = leerFlujo(ruta);
  const nodos = mayoresNodos(f).map((n) => `    ${n.kb} KB  ${n.nodo}`).join('\n');
  const mods = aporteDeModulos(f, fuentes)
    .slice(0, 12)
    .map((m) => `    ${m.kb} KB  ${m.modulo}`)
    .join('\n');
  return `  ${ruta}\n  5 nodos de jsCode más grandes:\n${nodos}\n  aporte por módulo común (coincidencia literal, informativo):\n${mods || '    (ninguno detectado)'}`;
}

describe('presupuesto de tamaño por flujo: el repositorio de hoy', () => {
  it('cada JSON de flujo del disco tiene entrada de presupuesto o exención declarada con porqué', () => {
    const sin = descubiertos.filter((r) => !presupuesto.flujos[r] && !presupuesto.exentos[r]);
    expect(sin, `flujos sin entrada en presupuesto-flujos.json: ${sin.join(', ')}`).toEqual([]);
    const ambos = descubiertos.filter((r) => presupuesto.flujos[r] && presupuesto.exentos[r]);
    expect(ambos).toEqual([]);
    for (const [r, x] of Object.entries(presupuesto.exentos)) expect(x.porque.trim().length, `exento sin porqué: ${r}`).toBeGreaterThanOrEqual(10);
  });

  it('ninguna entrada apunta a un archivo que ya no existe', () => {
    const huerfanas = [...Object.keys(presupuesto.flujos), ...Object.keys(presupuesto.exentos)].filter((r) => !existsSync(join(RAIZ, r)));
    expect(huerfanas, `entradas sin archivo: ${huerfanas.join(', ')}`).toEqual([]);
  });

  it('ningún flujo supera su presupuesto de nodos, jsCode (+2 %) o prompt, ni el tope duro de prompt', () => {
    const problemas: string[] = [];
    const rutas: string[] = [];
    for (const r of Object.keys(presupuesto.flujos)) {
      if (!existsSync(join(RAIZ, r))) continue;
      const p = problemasDeUnFlujo(r, medir(leerFlujo(r)), presupuesto.flujos[r], HOY);
      if (p.length) {
        problemas.push(...p);
        rutas.push(r);
      }
    }
    const msg = problemas.length
      ? `${problemas.join('\n')}\n\nDESGLOSE\n${rutas.map(desglose).join('\n')}\n\nPara subir un presupuesto: declare «+N KB de jsCode, +M nodos por flujo» en el PR, cambie esta entrada y su «porque», y pase por seguridad.`
      : '';
    expect(problemas, msg).toEqual([]);
  });

  it('las exenciones del tope de prompt tienen porqué, vencen en 90 días o menos y no han vencido', () => {
    for (const [r, e] of Object.entries(presupuesto.flujos)) {
      if (!e.exencionPrompt) continue;
      const m = medir(leerFlujo(r));
      const p = problemasDeUnFlujo(r, { ...m, promptKB: Math.max(m.promptKB, TOPE_PROMPT_KB + 0.1) }, { ...e, promptKB: Math.max(e.promptKB, TOPE_PROMPT_KB + 0.1) }, HOY);
      expect(p, `exención de ${r}`).toEqual([]);
    }
  });

  it('INFORMATIVO: tabla de medidas de hoy y código muerto incluido (no falla)', () => {
    const filas: string[] = [];
    const muertos: { flujo: string; nodo: string; nombre: string; chars: number }[] = [];
    for (const r of Object.keys(presupuesto.flujos)) {
      const f = leerFlujo(r);
      const m = medir(f);
      const e = presupuesto.flujos[r] as Entrada;
      filas.push(`${r}  nodos ${m.nodos}/${e.nodos}  jsCode ${m.jsCodeKB}/${e.jsCodeKB} KB  prompt ${m.promptKB}/${e.promptKB} KB`);
      const md = codigoMuertoDe(f);
      for (const x of md) muertos.push({ flujo: r, nodo: x.nodo, nombre: x.nombre, chars: x.chars });
    }
    const porFlujo = new Map<string, { n: number; chars: number }>();
    for (const x of muertos) {
      const a = porFlujo.get(x.flujo) ?? { n: 0, chars: 0 };
      porFlujo.set(x.flujo, { n: a.n + 1, chars: a.chars + x.chars });
    }
    console.log(`MEDIDAS (medido/presupuesto)\n${filas.join('\n')}`);
    console.log(`CÓDIGO MUERTO INCLUIDO por flujo (definiciones con prefijo ct/cb/dn/cm/av/anuncio sin ninguna referencia en su nodo)\n${[...porFlujo].map(([r, a]) => `${r}: ${a.n} definiciones, ~${aKB(a.chars)} KB`).join('\n') || '(ninguno)'}`);
    const agrupados = new Map<string, { flujo: string; nombre: string; nodos: number; chars: number }>();
    for (const x of muertos) {
      const k = `${x.flujo}|${x.nombre}`;
      const a = agrupados.get(k) ?? { flujo: x.flujo, nombre: x.nombre, nodos: 0, chars: 0 };
      agrupados.set(k, { ...a, nodos: a.nodos + 1, chars: a.chars + x.chars });
    }
    console.log(`LAS 10 MAYORES (por flujo y nombre, sumando los nodos que la incluyen)\n${[...agrupados.values()].sort((a, b) => b.chars - a.chars).slice(0, 10).map((x) => `~${aKB(x.chars)} KB  ${x.nombre}  en ${x.nodos} nodos · ${x.flujo}`).join('\n')}`);
    expect(filas.length).toBeGreaterThan(0);
  });
});

describe('presupuesto de tamaño por flujo: la regla, probada negada', () => {
  const M: Medida = { nodos: 40, jsCodeKB: 100, promptKB: 3, jsCodeChars: 100 * 1024, promptChars: 3 * 1024 };
  const E: Entrada = { nodos: 40, jsCodeKB: 100, promptKB: 3, porque: 'Línea base de prueba.', ultimoAumento: '2026-10-01' };
  const ver = (m: Partial<Medida>, e: Partial<Entrada> = {}, hoy = '2026-10-23') => problemasDeUnFlujo('f.json', { ...M, ...m }, { ...E, ...e }, hoy);

  it('en el presupuesto exacto no hay problemas', () => {
    expect(ver({})).toEqual([]);
  });
  it('un nodo de más falla (margen 0)', () => {
    expect(ver({ nodos: 41 }).join()).toMatch(/41 nodos > presupuesto 40/);
  });
  it('un décimo de KB de prompt de más falla (margen 0)', () => {
    expect(ver({ promptKB: 3.1, promptChars: 3.1 * 1024 }).join()).toMatch(/prompt 3.1 KB > presupuesto 3 KB/);
  });
  it('el jsCode admite +2 % y falla por encima', () => {
    expect(ver({ jsCodeChars: 101.9 * 1024, jsCodeKB: 101.9 })).toEqual([]);
    expect(ver({ jsCodeChars: 102.1 * 1024, jsCodeKB: 102.1 }).join()).toMatch(/jsCode 102.1 KB > presupuesto 100 KB/);
  });
  it('un flujo sin entrada falla', () => {
    expect(problemasDeUnFlujo('f.json', M, undefined, '2026-10-23').join()).toMatch(/sin entrada/);
  });
  it('ultimoAumento ausente, mal formado o posterior a hoy falla', () => {
    expect(ver({}, { ultimoAumento: '' }).join()).toMatch(/ultimoAumento/);
    expect(ver({}, { ultimoAumento: '23/10/2026' }).join()).toMatch(/ultimoAumento/);
    expect(ver({}, { ultimoAumento: '2026-10-24' }).join()).toMatch(/posterior a hoy/);
  });
  it('un prompt sobre 6 KB falla sin exención, aunque el presupuesto lo permita', () => {
    const grande = { promptKB: 6.1, promptChars: 6.1 * 1024 };
    expect(ver(grande, { promptKB: 6.1 }).join()).toMatch(/tope duro de 6 KB/);
  });
  it('la exención del tope: vigente pasa; vencida, de más de 90 días o incompleta falla', () => {
    const grande = { promptKB: 9, promptChars: 9 * 1024 };
    const ok = { porque: 'Prompt heredado que se recorta en la Entrega 3.', desde: '2026-10-23', vence: '2027-01-21' };
    expect(ver(grande, { promptKB: 9, exencionPrompt: ok })).toEqual([]);
    expect(ver(grande, { promptKB: 9, exencionPrompt: { ...ok, vence: '2027-01-22' } }).join()).toMatch(new RegExp(`máximo ${EXENCION_DIAS_MAX}`));
    expect(ver(grande, { promptKB: 9, exencionPrompt: { ...ok, desde: '2026-07-01', vence: '2026-09-01' } }, '2026-10-23').join()).toMatch(/venció/);
    expect(ver(grande, { promptKB: 9, exencionPrompt: { ...ok, porque: '' } }).join()).toMatch(/incompleta/);
  });
  it('el código muerto se detecta en una definición sin uso y no en una usada', () => {
    const f = { nodes: [{ name: 'N', type: 'n8n-nodes-base.code', parameters: { jsCode: 'function ctMuerta(a) { return a + 1; }\nfunction ctViva(a) { return a * 2; }\nreturn [{ json: { x: ctViva(2) } }];' } }] };
    expect(codigoMuertoDe(f).map((x) => x.nombre)).toEqual(['ctMuerta']);
  });
});
