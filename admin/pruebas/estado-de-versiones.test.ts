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
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

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

function preparar(excepcion: string, seco: string, opciones: { sinEnv?: boolean; publicarFalla?: boolean } = {}) {
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
  doble('publicar-flujo.sh', opciones.publicarFalla ? 'echo "✗ No se pudo leer el flujo vivo (HTTP 401)"; exit 1' : 'cat "$(dirname "$0")/../seco.txt"');
  writeFileSync(join(raiz, 'seco.txt'), seco);
  if (!opciones.sinEnv) writeFileSync(join(raiz, '.env.demo-b'), 'N8N_URL=http://ejemplo.invalid\n');
  writeFileSync(join(raiz, 'Flujos', 'demo-b.json'), '{}\n');
  writeFileSync(join(raiz, 'docs', 'versiones-por-cliente.md'), [
    '| Cliente | `--env` | `Flujo` | Excepción |',
    '|---|---|---|---|',
    `| Demo B | \`.env.demo-b\` | \`Flujos/demo-b.json\` | ${excepcion} |`, '',
  ].join('\n'));
}

function correr() {
  const r = spawnSync('bash', [join(raiz, 'scripts', 'estado-de-versiones.sh')], { env: entornoDelEmulador(undefined), encoding: 'utf8' });
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

// EL VERDE FALSO DE LOS NODOS NUEVOS (03/10/2026): un nodo nuevo, uno que falta o una
// conexión distinta no contaban, y la fila salía «✓ al día» con el flujo vivo atrasado.
// publicar-flujo.sh ahora los lista como `~ <nodo> · <motivo>`; aquí se prueba que el
// estado los trata igual que «difiere en N nodo(s)».
describe('estado-de-versiones.sh: nodos nuevos, faltantes y conexiones', () => {
  const estructural = [
    '  Diagnóstico en seco de Platinum',
    '  ! nodo nuevo, sin par en el flujo vivo: ¿Salió?',
    `    ${AMARILLO}~${FIN} ¿Salió? · nodo nuevo en el origen, no esta en el flujo vivo`,
    `    ${AMARILLO}~${FIN} Enviar · conexiones de salida distintas`,
    '',
  ].join('\n');

  it('sin excepción: ATRASADO Y SIN DECLARAR, salida 1, con los nombres', () => {
    preparar('—', estructural);
    const { codigo, lineas } = correr();
    expect(codigo).toBe(1);
    expect(lineas.join('\n')).toContain('ATRASADO Y SIN DECLARAR');
    expect(listaDeNodos(lineas).lista.sort()).toEqual(['Enviar', '¿Salió?']);
  });

  it('con excepción declarada: se informa y no falla', () => {
    preparar('Congelado hasta el 10/10', estructural);
    const { codigo, lineas } = correr();
    expect(codigo).toBe(0);
    expect(lineas.join('\n')).toContain('CON excepción declarada');
  });
});

// EL VERDE FALSO (27/09/2026, cerrado el 01/10): una fila que no se pudo comprobar
// dejaba el veredicto en «✓ Ningún atraso sin declarar» con salida 0. Lo que no se
// comprobó no está bien: se dice, y la salida es 3 (o 1 si además hay un atraso sin declarar).
describe('estado-de-versiones.sh: lo que no se pudo comprobar no es verde', () => {
  const alDia = '  Diagnóstico en seco de Demo B\n  El archivo coincide con el origen\n';

  it('sin el .env del cliente: «sin poder comprobar», salida 3 y ningún «✓ Ningún atraso»', () => {
    preparar('—', alDia, { sinEnv: true });
    const { codigo, lineas } = correr();
    const salida = lineas.join('\n');
    expect(codigo).toBe(3);
    expect(salida).toContain('no se puede comprobar');
    expect(salida).toContain('1 de 1 revisado(s) SIN PODER COMPROBAR');
    expect(salida).not.toContain('Ningún atraso sin declarar');
  });

  it('el flujo vivo no se pudo consultar (publicar-flujo.sh falla): salida 3, no verde', () => {
    preparar('—', alDia, { publicarFalla: true });
    const { codigo, lineas } = correr();
    expect(codigo).toBe(3);
    expect(lineas.join('\n')).toContain('no se pudo consultar');
    expect(lineas.join('\n')).not.toContain('Ningún atraso sin declarar');
  });

  it('un flujo al día y comprobado sí es verde (salida 0), y dice que se comprobó', () => {
    preparar('—', alDia);
    const { codigo, lineas } = correr();
    expect(codigo).toBe(0);
    expect(lineas.join('\n')).toContain('Ningún atraso sin declarar (1 revisado(s) y comprobados)');
  });

  it('un atraso sin declarar sigue mandando (salida 1), aunque haya filas sin comprobar', () => {
    preparar('—', diagnostico);
    const { codigo } = correr();
    expect(codigo).toBe(1);
  });
});
