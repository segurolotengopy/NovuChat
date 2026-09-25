/**
 * `scripts/estado-de-versiones.sh` — LA LISTA DE NODOS QUE DIFIEREN.
 *
 * El 24/09/2026 el Demo B salió como «difiere en: AI Agent NovuChat,Config del
 * negocio ¿Hay comprobante?,...»: `paste -sd', '` alterna coma y espacio, y
 * como los nombres de nodo de n8n llevan espacios no se sabía dónde terminaba
 * uno. Ahora va un nodo por línea, y eso es lo que se prueba.
 *
 * No toca n8n ni el emulador: el script se copia a una carpeta temporal con
 * dobles de `preparar-import.sh` y `publicar-flujo.sh`; el de publicar imprime
 * un diagnóstico en seco con el formato real (`    ~ <nodo> · <campo>`, con
 * códigos de color, que el script tiene que quitar).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', '..', 'scripts', 'estado-de-versiones.sh');

// Los nodos del caso real del Demo B, en el orden en que los da el diagnóstico
// (no ordenados) y con uno repetido por dos campos distintos.
const NODOS = [
  'Procesar respuesta', 'AI Agent NovuChat', '¿Hay comprobante?', 'Config del negocio',
  'Normalizar entrada', '¿Responder ahora?', 'Texto enviado', 'AI Agent NovuChat',
];
const AMARILLO = '\u001b[1;33m';
const FIN = '\u001b[0m';

const raiz = mkdtempSync(join(tmpdir(), 'estado-versiones-'));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

function preparar(excepcion: string, seco: string) {
  rmSync(raiz, { recursive: true, force: true });
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  mkdirSync(join(raiz, 'docs'), { recursive: true });
  mkdirSync(join(raiz, 'Flujos'), { recursive: true });
  copyFileSync(SCRIPT, join(raiz, 'scripts', 'estado-de-versiones.sh'));
  const doble = (nombre: string, cuerpo: string) => {
    const ruta = join(raiz, 'scripts', nombre);
    writeFileSync(ruta, `#!/usr/bin/env bash\n${cuerpo}\n`);
    chmodSync(ruta, 0o755);
  };
  doble('preparar-import.sh', 'exit 0');
  doble('publicar-flujo.sh', 'cat "$(dirname "$0")/../seco.txt"');
  writeFileSync(join(raiz, 'seco.txt'), seco);
  writeFileSync(join(raiz, '.env.demo-b'), 'N8N_URL=http://ejemplo.invalid\n');
  writeFileSync(join(raiz, 'Flujos', 'demo-b.json'), '{}\n');
  writeFileSync(join(raiz, 'docs', 'versiones-por-cliente.md'), [
    '| Cliente | `--env` | `Flujo` | Excepción |',
    '|---|---|---|---|',
    `| Demo B | \`.env.demo-b\` | \`Flujos/demo-b.json\` | ${excepcion} |`, '',
  ].join('\n'));
}

function correr() {
  const r = spawnSync('bash', [join(raiz, 'scripts', 'estado-de-versiones.sh')], { encoding: 'utf8' });
  // eslint-disable-next-line no-control-regex
  const salida = `${r.stdout}${r.stderr}`.replace(/\u001b\[[0-9;]*m/g, '');
  return { codigo: r.status, lineas: salida.split('\n') };
}

/** Las líneas de la lista: las que siguen a «difiere en N nodo(s):» y empiezan con «- ». */
function listaDeNodos(lineas: string[]) {
  const i = lineas.findIndex((l) => /difiere en \d+ nodo\(s\):/.test(l));
  expect(i, 'no aparece la cabecera «difiere en N nodo(s):»').toBeGreaterThanOrEqual(0);
  const lista: string[] = [];
  for (const l of lineas.slice(i + 1)) {
    const m = /^ {8}- (.*)$/.exec(l);
    if (!m) break;
    lista.push(m[1]!);
  }
  return { cabecera: lineas[i]!, lista };
}

const diagnostico = [
  '  Diagnóstico en seco de Demo B',
  ...NODOS.map((n, k) => `    ${AMARILLO}~${FIN} ${n} · parameters.campo${k}: vivo 10 car. -> origen 12 car.`),
  '',
].join('\n');

describe('estado-de-versiones.sh: los nodos que difieren', () => {
  it('sin excepción: falla y da un nodo por línea, sin repetir, sin comas ni espacios pegados', () => {
    preparar('—', diagnostico);
    const { codigo, lineas } = correr();
    expect(codigo).toBe(1);
    expect(lineas.join('\n')).toContain('ATRASADO Y SIN DECLARAR');

    const esperados = [...new Set(NODOS)].sort();
    const { cabecera, lista } = listaDeNodos(lineas);
    expect(cabecera).toContain(`difiere en ${esperados.length} nodo(s):`);
    // Cada nombre, entero y solo: ninguno queda partido ni pegado a otro.
    expect([...lista].sort()).toEqual(esperados);
    // La forma que se vio el 24/09 no vuelve.
    expect(lineas.join('\n')).not.toMatch(/AI Agent NovuChat,/);
  });

  it('con excepción: no falla, da la misma lista y después la excepción', () => {
    preparar('Paquete congelado hasta el 01/10', diagnostico);
    const { codigo, lineas } = correr();
    expect(codigo).toBe(0);
    expect(lineas.join('\n')).toContain('CON excepción declarada');

    const { lista } = listaDeNodos(lineas);
    expect([...lista].sort()).toEqual([...new Set(NODOS)].sort());
    const iExc = lineas.findIndex((l) => l.includes('excepción: Paquete congelado hasta el 01/10'));
    const iUltimo = lineas.findIndex((l) => l === `        - ${lista.at(-1)}`);
    expect(iExc).toBeGreaterThan(iUltimo);
  });

  it('atrasado sin nodos reconocibles: lo dice en una línea, sin lista vacía', () => {
    preparar('—', '  Diagnóstico en seco de Demo B\n    cambió la configuración del disparador\n');
    const { codigo, lineas } = correr();
    expect(codigo).toBe(1);
    expect(lineas).toContain('      difiere en: (diferencias de configuración)');
    expect(lineas.some((l) => /^ {8}- /.test(l))).toBe(false);
  });
});
