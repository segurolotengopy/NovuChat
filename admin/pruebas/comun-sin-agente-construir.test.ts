/**
 * EL ARMADOR GENÉRICO (`Flujos/experimental/comun-sin-agente/construir.mjs`).
 *
 * Tres cosas se prueban, cada regla con su caso negativo:
 *  1. EQUIVALENCIA: con el config que describe a «Agenda mínima», el armador genérico produce, byte por byte,
 *     los dos JSON que `agenda-minima/construir.mjs` versionó. Es lo que permite que el piloto de Q'Taco (y,
 *     más adelante, Agenda mínima) use este armador sin que cambie ni un nodo. Agenda mínima solo se LEE.
 *  2. LAS MARCAS: `@@todo`, `@@comun`, `@@solo` y los paquetes `+nombre`, en el orden en que se piden.
 *  3. LO QUE NUNCA HACE: leer fuera de la raíz, aceptar una ruta con `..`, dejar una marca sin reemplazar,
 *     repetir ids o nombres de nodo, quitar un nodo que no existe, o escribir en el modo `--verificar`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import {
  armarVariante, codigoDe, construir, leerProyecto, type ConfigDeConstruccion,
} from '../../Flujos/experimental/comun-sin-agente/construir.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
// Los proyectos de juguete viven en una carpeta temporal: el tope de lectura de las pruebas es esa carpeta.
const TOPE = tmpdir();
const COMUN = join(aqui, '../../Flujos/experimental/comun-sin-agente');
const AGENDA = join(aqui, '../../Flujos/experimental/agenda-minima');

// --- EL CONFIG DE «AGENDA MÍNIMA», escrito aquí: su carpeta no se toca -------------------------------
const CONFIG_AGENDA: ConfigDeConstruccion = {
  plantilla: 'flujo.plantilla.json',
  librerias: ['src/lib/agenda.js'],
  comun: ['src/nodos/_comun.js'],
  variantes: [
    { archivo: 'agenda-minima.v0.json', quitar: 'Entrada de prueba', nombre: 'NovuChat — Agenda mínima (v0)' },
    { archivo: 'agenda-minima.prueba.json', quitar: 'WhatsApp Trigger', nombre: 'NovuChat — Agenda mínima (v0, prueba)' },
  ],
};

describe('el armador genérico produce los JSON de Agenda mínima, byte por byte', () => {
  const p = leerProyecto(AGENDA, CONFIG_AGENDA);
  for (const v of CONFIG_AGENDA.variantes) {
    it(`${v.archivo}`, () => {
      expect(armarVariante(p, v)).toBe(readFileSync(join(AGENDA, v.archivo), 'utf8'));
    });
  }
  it('NIEGA: con otro nombre de flujo ya no es el mismo archivo (la prueba compara de verdad)', () => {
    const otro = armarVariante(p, { ...CONFIG_AGENDA.variantes[0]!, nombre: 'Otro nombre' });
    expect(otro).not.toBe(readFileSync(join(AGENDA, 'agenda-minima.v0.json'), 'utf8'));
  });
  it('construir(…, {verificar:true}) sobre Agenda mínima no escribe nada y dice que está al día', () => {
    const r = construir(AGENDA, { verificar: true, config: CONFIG_AGENDA });
    expect(r.every((x) => x.alDia && x.existia)).toBe(true);
  });
});

// --- UN PROYECTO DE JUGUETE, en una carpeta temporal ---------------------------------------------------
const temporales: string[] = [];
afterEach(() => { while (temporales.length) rmSync(temporales.pop()!, { recursive: true, force: true }); });

function proyecto(extra: Partial<ConfigDeConstruccion> = {}, plantilla?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'comun-sin-agente-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'src/nodos'), { recursive: true });
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  mkdirSync(join(dir, 'paquetes'), { recursive: true });
  writeFileSync(join(dir, 'src/lib/lib.js'), '// LIB\nconst LIB = 1;\n');
  writeFileSync(join(dir, 'src/nodos/_comun.js'), '// COMUN\nconst COMUN = 2;\n');
  writeFileSync(join(dir, 'paquetes/a.js'), '// PAQUETE A\n');
  writeFileSync(join(dir, 'paquetes/b.js'), '// PAQUETE B1\n');
  writeFileSync(join(dir, 'paquetes/b2.js'), '// PAQUETE B2\n');
  writeFileSync(join(dir, 'src/nodos/nodo-uno.js'), '// NODO UNO\nreturn [];\n');
  writeFileSync(join(dir, 'flujo.plantilla.json'), JSON.stringify(plantilla ?? {
    name: 'x',
    nodes: [
      { id: 'a', name: 'Disparador', type: 'n8n-nodes-base.whatsAppTrigger', parameters: {} },
      { id: 'b', name: 'Entrada de prueba', type: 'n8n-nodes-base.webhook', parameters: {} },
      { id: 'c', name: 'Uno', type: 'n8n-nodes-base.code', parameters: { jsCode: '@@nodos/nodo-uno.js' } },
      { id: 'd', name: 'Dos', type: 'n8n-nodes-base.code', parameters: { jsCode: '@@comun:nodos/nodo-uno.js' } },
      { id: 'e', name: 'Tres', type: 'n8n-nodes-base.code', parameters: { jsCode: '@@solo+a+b:nodos/nodo-uno.js' } },
    ],
    connections: {
      Disparador: { main: [[{ node: 'Uno', type: 'main', index: 0 }]] },
      'Entrada de prueba': { main: [[{ node: 'Uno', type: 'main', index: 0 }]] },
      Uno: { main: [[{ node: 'Dos', type: 'main', index: 0 }]] },
      Dos: { main: [[{ node: 'Tres', type: 'main', index: 0 }]] },
    },
  }));
  const config: ConfigDeConstruccion = {
    librerias: ['src/lib/lib.js'], comun: ['src/nodos/_comun.js'],
    paquetes: { a: 'paquetes/a.js', b: ['paquetes/b.js', 'paquetes/b2.js'] },
    variantes: [
      { archivo: 'prod.json', quitar: 'Entrada de prueba', nombre: 'Prod' },
      { archivo: 'prueba.json', quitar: 'Disparador', nombre: 'Prueba' },
    ],
    ...extra,
  };
  writeFileSync(join(dir, 'construir.config.json'), JSON.stringify(config));
  return dir;
}
const codigo = (dir: string, nombre: string, variante = 'prod.json'): string =>
  (JSON.parse(readFileSync(join(dir, variante), 'utf8')) as { nodes: { name: string; parameters: { jsCode?: string } }[] })
    .nodes.find((n) => n.name === nombre)!.parameters.jsCode!;

describe('las marcas y los paquetes', () => {
  it('@@nodos/x.js (todo) = librería + común + nodo; @@comun: = común + nodo; @@solo+paquetes: = paquetes + nodo, EN ESE ORDEN', () => {
    const dir = proyecto();
    construir(dir, { tope: TOPE });
    expect(codigo(dir, 'Uno')).toBe('// LIB\nconst LIB = 1;\n\n// COMUN\nconst COMUN = 2;\n\n// NODO UNO\nreturn [];\n');
    expect(codigo(dir, 'Dos')).toBe('// COMUN\nconst COMUN = 2;\n\n// NODO UNO\nreturn [];\n');
    expect(codigo(dir, 'Tres')).toBe('// PAQUETE A\n\n// PAQUETE B1\n\n// PAQUETE B2\n\n// NODO UNO\nreturn [];\n');
  });
  it('el orden de los paquetes es el que pide la marca (+b+a ≠ +a+b)', () => {
    const dir = proyecto();
    const p = leerProyecto(dir, null, { tope: TOPE });
    const ab = codigoDe(p, '@@solo+a+b:nodos/nodo-uno.js', 'N');
    const ba = codigoDe(p, '@@solo+b+a:nodos/nodo-uno.js', 'N');
    expect(ab).not.toBe(ba);
    expect(ba.indexOf('PAQUETE B1')).toBeLessThan(ba.indexOf('PAQUETE A'));
  });
  it('cada variante quita su nodo Y sus conexiones', () => {
    const dir = proyecto();
    construir(dir, { tope: TOPE });
    const prod = JSON.parse(readFileSync(join(dir, 'prod.json'), 'utf8')) as { nodes: { name: string }[]; connections: Record<string, unknown>; name: string };
    const prueba = JSON.parse(readFileSync(join(dir, 'prueba.json'), 'utf8')) as typeof prod;
    expect(prod.name).toBe('Prod');
    expect(prod.nodes.map((n) => n.name)).not.toContain('Entrada de prueba');
    expect(prod.connections).not.toHaveProperty('Entrada de prueba');
    expect(prueba.nodes.map((n) => n.name)).not.toContain('Disparador');
    expect(prueba.connections).not.toHaveProperty('Disparador');
    expect(prueba.nodes.map((n) => n.name)).toContain('Entrada de prueba');
  });
  it('`quitar` acepta una lista', () => {
    const dir = proyecto({ variantes: [{ archivo: 'sin-los-dos.json', quitar: ['Disparador', 'Entrada de prueba'], nombre: 'X' }] });
    construir(dir, { tope: TOPE });
    const f = JSON.parse(readFileSync(join(dir, 'sin-los-dos.json'), 'utf8')) as { nodes: unknown[]; connections: Record<string, unknown> };
    expect(f.nodes).toHaveLength(3);
    expect(Object.keys(f.connections).sort()).toEqual(['Dos', 'Uno']);
  });
});

describe('lo que el armador NUNCA hace', () => {
  it('NIEGA: un paquete que el config no declara', () => {
    const dir = proyecto();
    expect(() => codigoDe(leerProyecto(dir, null, { tope: TOPE }), '@@solo+inexistente:nodos/nodo-uno.js', 'N')).toThrow(/no declara el paquete/);
  });
  it('NIEGA: un paquete (o librería, o común) fuera de la raíz permitida', () => {
    for (const extra of [
      { paquetes: { fuera: '../fuera.js' } },
      { librerias: ['../fuera.js'] },
      { comun: ['../../etc/passwd'] },
      { paquetes: { abs: '/etc/hostname' } },
    ] as Partial<ConfigDeConstruccion>[]) {
      expect(() => leerProyecto(proyecto(extra), null, { tope: TOPE }), JSON.stringify(extra)).toThrow(/fuera de la raíz/);
    }
  });
  it('con `raiz` más amplia, un paquete hermano SÍ se lee (el caso de comun-sin-agente)', () => {
    const dir = proyecto({ raiz: '..', paquetes: { hermano: '../hermano-' + 'x.js' } });
    writeFileSync(join(dir, '..', 'hermano-x.js'), '// HERMANO\n');
    try { expect(() => leerProyecto(dir, null, { tope: TOPE })).not.toThrow(); } finally { rmSync(join(dir, '..', 'hermano-x.js'), { force: true }); }
  });
  it('NIEGA: una ruta de nodo con `..`, absoluta o con barra invertida', () => {
    const p = leerProyecto(proyecto(), null, { tope: TOPE });
    for (const marca of ['@@solo:nodos/../../x.js', '@@solo:/etc/passwd', '@@solo:nodos\\x.js', '@@solo:..', '@@algo:nodos/x.js']) {
      expect(() => codigoDe(p, marca, 'N'), marca).toThrow();
    }
  });
  it('NIEGA: un archivo de código que no existe', () => {
    expect(() => codigoDe(leerProyecto(proyecto(), null, { tope: TOPE }), '@@solo:nodos/no-existe.js', 'N')).toThrow(/no existe/);
  });
  it('NIEGA: quitar un nodo que no está (un typo no puede dejar el disparador puesto)', () => {
    const dir = proyecto({ variantes: [{ archivo: 'x.json', quitar: 'Dsparador', nombre: 'X' }] });
    expect(() => construir(dir, { tope: TOPE })).toThrow(/no hay un nodo «Dsparador»/);
  });
  it('NIEGA: ids o nombres de nodo repetidos', () => {
    const base = (id: string, nombre: string) => ({ name: 'x', connections: {}, nodes: [
      { id: 'a', name: 'A', type: 't', parameters: {} }, { id, name: nombre, type: 't', parameters: {} }] });
    const una = { variantes: [{ archivo: 'x.json', nombre: 'X' }] };
    expect(() => construir(proyecto(una, base('a', 'B')), { tope: TOPE })).toThrow(/ids de nodo repetidos/);
    expect(() => construir(proyecto(una, base('b', 'A')), { tope: TOPE })).toThrow(/nombres de nodo repetidos/);
  });
  it('NIEGA: una marca @@ que no es de jsCode no se reemplaza, y queda como error', () => {
    const plantilla = { name: 'x', connections: {}, nodes: [{ id: 'a', name: 'A', type: 't', parameters: { otro: '@@nodos/nodo-uno.js' } }] };
    expect(() => construir(proyecto({ variantes: [{ archivo: 'x.json', nombre: 'X' }] }, plantilla), { tope: TOPE })).toThrow(/marca @@ sin reemplazar/);
  });
  it('NIEGA: dos variantes que escriben el mismo archivo, o un archivo con ruta', () => {
    expect(() => leerProyecto(proyecto({ variantes: [
      { archivo: 'a.json', nombre: 'A' }, { archivo: 'a.json', nombre: 'B' }] }), null, { tope: TOPE })).toThrow(/mismo archivo/);
    expect(() => leerProyecto(proyecto({ variantes: [{ archivo: '../a.json', nombre: 'A' }] }), null, { tope: TOPE })).toThrow(/no válido/);
  });
  it('NIEGA: un config sin variantes, o sin archivo de configuración', () => {
    expect(() => leerProyecto(proyecto({ variantes: [] }), null, { tope: TOPE })).toThrow(/variantes/);
    const vacio = mkdtempSync(join(tmpdir(), 'comun-sin-agente-vacio-'));
    temporales.push(vacio);
    expect(() => leerProyecto(vacio, null, { tope: TOPE })).toThrow(/no existe/);
  });
  it('--verificar NO escribe: dice qué falta y qué difiere, y construir() lo repara', () => {
    const dir = proyecto();
    const antes = construir(dir, { verificar: true, tope: TOPE });
    expect(antes.every((r) => !r.existia && !r.alDia)).toBe(true);
    expect(existsSync(join(dir, 'prod.json'))).toBe(false);
    construir(dir, { tope: TOPE });
    expect(construir(dir, { verificar: true, tope: TOPE }).every((r) => r.alDia)).toBe(true);
    writeFileSync(join(dir, 'prod.json'), '{}\n');
    const r = construir(dir, { verificar: true, tope: TOPE });
    expect(r.find((x) => x.archivo === 'prod.json')!.alDia).toBe(false);
    expect(readFileSync(join(dir, 'prod.json'), 'utf8')).toBe('{}\n');
  });
});

describe('lo que la revisión de seguridad encontró (01/10): enlaces simbólicos, raíz sin tope y archivos reservados', () => {
  it('NIEGA: un enlace simbólico DENTRO de la raíz que apunta afuera no se sigue (nodo, paquete, librería)', () => {
    const dir = proyecto();
    const fuera = join(dir, '..', 'fuera-' + String(Date.now()) + '.js');
    writeFileSync(fuera, '// SECRETO\n');
    try {
      symlinkSync(fuera, join(dir, 'src/nodos/enlazado.js'));
      symlinkSync(fuera, join(dir, 'paquetes/enlazado.js'));
      const p = leerProyecto(dir, null, { tope: TOPE });
      expect(() => codigoDe(p, '@@solo:nodos/enlazado.js', 'N')).toThrow(/fuera de la raíz/);
      writeFileSync(join(dir, 'construir.config.json'), JSON.stringify({ paquetes: { e: 'paquetes/enlazado.js' }, variantes: [{ archivo: 'x.json', nombre: 'X' }] }));
      expect(() => leerProyecto(dir, null, { tope: TOPE })).toThrow(/fuera de la raíz/);
    } finally { rmSync(fuera, { force: true }); }
  });
  it('NIEGA: `raiz` absoluta o que se sale del tope (con `/`, cualquier archivo del equipo se podía leer)', () => {
    expect(() => leerProyecto(proyecto({ raiz: '/' }), null, { tope: TOPE })).toThrow(/ruta relativa/);
    expect(() => leerProyecto(proyecto({ raiz: '../../../../..' }), null, { tope: TOPE })).toThrow(/dentro de/);
  });
  it('NIEGA: con el tope por defecto (`Flujos/`), un proyecto fuera de Flujos/ no se arma', () => {
    expect(() => leerProyecto(proyecto())).toThrow(/dentro de/);
  });
  it('NIEGA: una variante no puede pisar el config ni la plantilla', () => {
    for (const archivo of ['construir.config.json', 'flujo.plantilla.json']) {
      expect(() => leerProyecto(proyecto({ variantes: [{ archivo, nombre: 'X' }] }), null, { tope: TOPE }), archivo).toThrow(/no se puede escribir/);
    }
  });
});

describe('la línea de comandos', () => {
  const correr = (...args: string[]): { codigo: number; salida: string } => {
    try {
      const salida = execFileSync(process.execPath, [join(COMUN, 'construir.mjs'), ...args, ...(args.includes('--proyecto') ? ['--tope', TOPE] : [])], { encoding: 'utf8', stdio: 'pipe', env: entornoDelEmulador(undefined) });
      return { codigo: 0, salida };
    } catch (e) {
      const x = e as { status: number; stdout: string; stderr: string };
      return { codigo: x.status, salida: x.stdout + x.stderr };
    }
  };
  it('arma y verifica con códigos de salida (0, 1 y 2)', () => {
    const dir = proyecto();
    expect(correr('--proyecto', dir, '--verificar').codigo).toBe(1);
    expect(correr('--proyecto', dir).codigo).toBe(0);
    expect(correr('--proyecto', dir, '--verificar').codigo).toBe(0);
    expect(correr().codigo).toBe(2);
    expect(correr('--proyecto', join(dir, 'no-existe')).codigo).toBe(1);
  });
});
