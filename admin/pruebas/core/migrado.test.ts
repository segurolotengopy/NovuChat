/**
 * «MIGRADO» (M1 a M7) Y EL TABLERO DE LA MIGRACIÓN (etapa 0, 12/11/2026). Definición: `docs/arquitectura/migrado.md`; tablero:
 * `docs/arquitectura/migracion.md`.
 *
 *  - El tablero tiene una fila por cada flujo de producción del disco y viceversa (un flujo nuevo, o una mudanza que olvida su fila, falla).
 *  - Las filas en estado `mudado` pasan M1 a M7. Hoy no hay ninguna: la primera mudanza (Walisuma, PR-0b) es la que las estrena.
 *  - Cada regla trae su contraprueba, NEGANDO, en un directorio temporal: un flujo mudado correcto pasa y cada mutación rompe justo su punto.
 *
 * HERMÉTICA: lee el repositorio y un directorio temporal; no usa red ni emulador y no publica nada.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flujosDeProduccion } from '../lib/flujos-de-cliente';
import { variantesDeNodo } from './migracion/comprobaciones';
import {
  PRUEBAS_COMUNES, contextoReal, leerTablero, problemasDeMigrado, problemasDelTablero, rutaDeFila, type Contexto, type Fila,
} from './migracion/migrado';

const TABLERO = join(contextoReal().repo, 'docs', 'arquitectura', 'migracion.md');
const filas = leerTablero(readFileSync(TABLERO, 'utf8'));

describe('tablero de la migración: una fila por flujo de producción', () => {
  it('la tabla de migracion.md se lee y coincide con los flujos de producción del disco, en cualquiera de las dos carpetas', () => {
    expect(filas.length).toBeGreaterThan(20);
    expect(problemasDelTablero(filas, flujosDeProduccion())).toEqual([]);
  });

  it('las filas pendientes no pasan por M1 a M7: solo las mudadas; cada fila mudada del tablero cumple los siete puntos', () => {
    const mudadas = filas.filter((f) => f.estado === 'mudado');
    // Hoy ninguna; la prueba queda armada para la primera mudanza.
    for (const f of mudadas) expect(problemasDeMigrado(f), rutaDeFila(f)).toEqual([]);
    expect(filas.every((f) => f.estado === 'pendiente' || f.estado === 'mudado')).toBe(true);
  });

  it('Walisuma figura pendiente con dueño Rearquitectura, y el resto con dueño por asignar (Principal)', () => {
    for (const f of filas) expect(f.dueno, f.json).toBe(f.json === 'walisuma.json' ? 'Rearquitectura' : 'por asignar (Principal)');
  });

  it('la clase «congelado» es la de las doctoras, bellido-agendamiento.json y novuchat-onboarding.json (decisión D3)', () => {
    expect(filas.filter((f) => f.clase === 'congelado').map((f) => f.json).sort()).toEqual(
      ['bellido-agendamiento.json', 'doctoras.rroca-emma.json', 'doctoras.rroca-evy.json', 'novuchat-onboarding.json'],
    );
  });
});

// ---------------------------------------------------------------------------
// Contrapruebas del tablero
// ---------------------------------------------------------------------------

const HUELLA_OK = '1ca574f2-d525b6ff-72b4f14e-ebabd17a-da00af9a-797d71cf-c427eb91-4ea70cc1';
const fila = (p: Partial<Fila> = {}): Fila => ({
  json: 'a.json', carpeta: 'experimental/a', clase: 'vivo', armador: 'construir.mjs', falta: 'M1', dueno: 'd', estado: 'pendiente', huella: HUELLA_OK, ...p,
});

describe('contrapruebas del tablero', () => {
  it('una fila completa y sin faltantes pasa', () => {
    expect(problemasDelTablero([fila()], ['experimental/a/a.json'])).toEqual([]);
  });

  it('un flujo del disco sin fila falla, y una fila sin flujo en el disco también', () => {
    expect(problemasDelTablero([], ['experimental/a/a.json'])).toEqual([expect.stringContaining('no tiene fila')]);
    expect(problemasDelTablero([fila()], [])).toEqual([expect.stringContaining('no es un flujo de producción del disco')]);
  });

  it('la mudanza no rompe la correspondencia: la fila de experimental/ sirve para el flujo en clientes/ y al revés', () => {
    expect(problemasDelTablero([fila()], ['clientes/a/a.json'])).toEqual([]);
    expect(problemasDelTablero([fila({ carpeta: 'clientes/a' })], ['experimental/a/a.json'])).toEqual([]);
  });

  it('una fila duplicada, una clase o un estado inventados, un dueño vacío y una huella mal formada fallan', () => {
    expect(problemasDelTablero([fila(), fila()], ['a/a.json'].map((x) => `experimental/${x}`))).toEqual([expect.stringContaining('2 filas')]);
    expect(problemasDelTablero([fila({ clase: 'otra' })], ['experimental/a/a.json'])).toEqual([expect.stringContaining('la clase')]);
    expect(problemasDelTablero([fila({ estado: 'hecho' })], ['experimental/a/a.json'])).toEqual([expect.stringContaining('el estado')]);
    expect(problemasDelTablero([fila({ dueno: ' ' })], ['experimental/a/a.json'])).toEqual([expect.stringContaining('sin dueño')]);
    // Sin guiones (hex corrido), con mayúsculas y de otro largo: ninguna es el formato en 8 grupos de 8.
    for (const h of [HUELLA_OK.replace(/-/g, ''), HUELLA_OK.toUpperCase(), HUELLA_OK.slice(0, -9)]) {
      expect(problemasDelTablero([fila({ huella: h })], ['experimental/a/a.json']), h).toEqual([expect.stringContaining('la huella')]);
    }
  });

  it('leerTablero rechaza una tabla con otra cabecera o con una fila de otro ancho', () => {
    expect(() => leerTablero('| JSON | carpeta |\n|---|---|\n| a | b |')).toThrow(/debe empezar por/);
    const buena = readFileSync(TABLERO, 'utf8').split('\n');
    const i = buena.findIndex((l) => l.startsWith('| walisuma.json'));
    buena[i] = '| walisuma.json | experimental/walisuma |';
    expect(() => leerTablero(buena.join('\n'))).toThrow(/no tiene 8 columnas/);
  });
});

// ---------------------------------------------------------------------------
// Contrapruebas de M1 a M7, en un directorio temporal
// ---------------------------------------------------------------------------

const agrupar = (hex: string): string => hex.match(/.{8}/g)!.join('-');
const sha = (texto: string): string => agrupar(createHash('sha256').update(texto).digest('hex'));

interface Montaje { raiz: string; ctx: Contexto; fila: Fila; ruta: string }

/** Un repositorio en miniatura con UN flujo mudado correcto: carpeta, PROPIO.md, JSON, fila de versiones y las siete pruebas. */
function montar(): Montaje {
  const raiz = mkdtempSync(join(tmpdir(), 'migrado-'));
  const carpeta = join(raiz, 'Flujos', 'clientes', 'x');
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(join(carpeta, 'PROPIO.md'), '# x\n');
  const [normalizar] = variantesDeNodo('Normalizar entrada');
  const [procesar] = variantesDeNodo('Procesar respuesta');
  const flujo = {
    name: 'x',
    nodes: [
      { name: 'Reportar mensaje (entrante)', type: 'n8n-nodes-base.httpRequest', parameters: {} },
      { name: 'Normalizar entrada', type: 'n8n-nodes-base.code', parameters: { jsCode: `const LIB = 1;\n${normalizar}` } },
      { name: 'Procesar respuesta', type: 'n8n-nodes-base.code', parameters: { jsCode: procesar } },
    ],
    connections: {},
  };
  const texto = `${JSON.stringify(flujo, null, 2)}\n`;
  writeFileSync(join(carpeta, 'x.json'), texto);
  writeFileSync(join(raiz, 'versiones.md'), '| Cliente | Flujo |\n|---|---|\n| X | `Flujos/clientes/x/x.json` |\n');
  const pruebas = PRUEBAS_COMUNES.map((r) => join(raiz, r.replace(/\//g, '__')));
  for (const p of pruebas) writeFileSync(p, "import { flujosDeProduccion } from './lib/flujos-de-cliente';\n");
  const ctx: Contexto = { flujos: join(raiz, 'Flujos'), repo: raiz, versiones: join(raiz, 'versiones.md'), pruebas, correr: () => 0 };
  return { raiz, ctx, ruta: join(carpeta, 'x.json'), fila: fila({ json: 'x.json', carpeta: 'clientes/x', estado: 'mudado', huella: sha(texto) }) };
}
function conMontaje(prueba: (m: Montaje) => void): void {
  const m = montar();
  try { prueba(m); } finally { rmSync(m.raiz, { recursive: true, force: true }); }
}

describe('M1 a M7, NEGANDO, en un directorio temporal', () => {
  it('un flujo mudado correcto cumple los siete puntos', () => {
    conMontaje((m) => expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([]));
  });

  it('M1: sin PROPIO.md, o en experimental/, falla', () => {
    conMontaje((m) => {
      rmSync(join(m.raiz, 'Flujos', 'clientes', 'x', 'PROPIO.md'));
      expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([expect.stringMatching(/^M1:/)]);
    });
    conMontaje((m) => expect(problemasDeMigrado({ ...m.fila, carpeta: 'experimental/x' }, m.ctx).join('\n')).toMatch(/M1:/));
  });

  it('M2: un constructor que sale distinto de 0 falla; sin constructor falla; el ensamblador que no dice idéntico falla', () => {
    conMontaje((m) => {
      expect(problemasDeMigrado(m.fila, { ...m.ctx, correr: () => 1 })).toEqual([expect.stringMatching(/^M2:.*no sale 0/)]);
      expect(problemasDeMigrado({ ...m.fila, armador: 'ninguno' }, m.ctx)).toEqual([expect.stringMatching(/^M2:.*sin constructor/)]);
      expect(problemasDeMigrado({ ...m.fila, armador: 'ensamblador' }, { ...m.ctx, correr: () => 2 })).toEqual([expect.stringMatching(/^M2:.*ensamblador/)]);
      expect(problemasDeMigrado({ ...m.fila, armador: 'ensamblador' }, m.ctx)).toEqual([]);
    });
  });

  it('M2: el constructor corre de verdad en la carpeta del flujo, con --verificar y los argumentos de la fila', () => {
    conMontaje((m) => {
      const carpeta = join(m.raiz, 'Flujos', 'clientes', 'x');
      writeFileSync(join(carpeta, 'construir.mjs'), "process.exit(process.argv.includes('--verificar') && process.argv.includes('--todos') ? 0 : 1);\n");
      const real = { ...m.ctx, correr: contextoReal().correr };
      expect(problemasDeMigrado({ ...m.fila, armador: 'construir.mjs --todos' }, real)).toEqual([]);
      expect(problemasDeMigrado({ ...m.fila, armador: 'construir.mjs' }, real)).toEqual([expect.stringMatching(/^M2:/)]);
    });
  });

  it('M3: un byte cambiado contra la huella falla', () => {
    conMontaje((m) => {
      writeFileSync(m.ruta, `${readFileSync(m.ruta, 'utf8')} `);
      expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([expect.stringMatching(/^M3:/)]);
    });
  });

  it('M4: un nodo común con código propio sin excepción falla; uno ausente no cuenta', () => {
    conMontaje((m) => {
      const j = JSON.parse(readFileSync(m.ruta, 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
      j.nodes.find((n) => n.name === 'Normalizar entrada')!.parameters.jsCode = 'return [];';
      const texto = `${JSON.stringify(j, null, 2)}\n`;
      writeFileSync(m.ruta, texto);
      expect(problemasDeMigrado({ ...m.fila, huella: sha(texto) }, m.ctx)).toEqual([expect.stringMatching(/^M4:.*Normalizar entrada/)]);
    });
  });

  it('M5: sin la red NIEGA_IA de core (o con otra) falla si el flujo atiende a un cliente; si no atiende, no se exige', () => {
    conMontaje((m) => {
      const j = JSON.parse(readFileSync(m.ruta, 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] };
      j.nodes.find((n) => n.name === 'Procesar respuesta')!.parameters.jsCode = 'const EV_NIEGA_IA = /\\bhumano\\b/i;';
      const texto = `${JSON.stringify(j, null, 2)}\n`;
      writeFileSync(m.ruta, texto);
      expect(problemasDeMigrado({ ...m.fila, huella: sha(texto) }, m.ctx).filter((x) => x.startsWith('M5'))).toEqual([expect.stringMatching(/^M5:.*NIEGA_IA/)]);
      j.nodes = j.nodes.filter((n) => n.name !== 'Reportar mensaje (entrante)' && n.name !== 'Procesar respuesta');
      const sinAtender = `${JSON.stringify(j, null, 2)}\n`;
      writeFileSync(m.ruta, sinAtender);
      expect(problemasDeMigrado({ ...m.fila, huella: sha(sinAtender) }, m.ctx).filter((x) => x.startsWith('M5'))).toEqual([]);
    });
  });

  it('M6: una prueba común que no descubre con la lista única, o que no existe, falla', () => {
    conMontaje((m) => {
      writeFileSync(m.ctx.pruebas[2]!, "const FLUJOS = ['a.json'];\n");
      expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([expect.stringMatching(/^M6:/)]);
      rmSync(m.ctx.pruebas[0]!);
      expect(problemasDeMigrado(m.fila, m.ctx)).toHaveLength(2);
    });
  });

  it('M7: sin fila en versiones-por-cliente.md falla', () => {
    conMontaje((m) => {
      writeFileSync(m.ctx.versiones, '| Cliente | Flujo |\n|---|---|\n| Otro | `otro.json` |\n');
      expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([expect.stringMatching(/^M7:/)]);
      writeFileSync(m.ctx.versiones, 'x.json sin tabla\n');
      expect(problemasDeMigrado(m.fila, m.ctx)).toEqual([expect.stringMatching(/^M7:/)]);
    });
  });

  it('las siete pruebas comunes existen en el repositorio y descubren con la lista única (el M6 real)', () => {
    expect(PRUEBAS_COMUNES).toHaveLength(7);
    const real = contextoReal();
    for (const p of real.pruebas) expect(readFileSync(p, 'utf8'), p).toContain('flujos-de-cliente');
  });
});
