/**
 * `--valores-del-vivo` de preparar-import.sh y scripts/lib/valores-del-vivo.py (22/11/2026): los marcadores REEMPLAZAR_* que la
 * tabla local no resuelve se toman del flujo VIVO (mismo nodo por nombre, misma ruta de parametro). Con flujos de mentira.
 * Escrito negando: dos coincidencias, forma invalida, nodo ausente => falla cerrado nombrando el marcador; la tabla gana;
 * la salida jamas contiene el valor. Ademas: una correccion de credencial de publicar-flujo.sh nunca cruza comercios.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER = join(RAIZ, 'scripts/lib/valores-del-vivo.py');
const PREPARAR = join(RAIZ, 'scripts/preparar-import.sh');
const PUBLICAR = join(RAIZ, 'scripts/publicar-flujo.sh');
const carpeta = mkdtempSync(join(tmpdir(), 'valores-vivo-'));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

const PHONE = '100000000000001';
const WABA = '200000000000002';
const PLANILLA = 'AbCdEfGhIjKlMnOpQrStUvWx_Yz-ab';
const RUTA = 'ruta-de-mentira-abcdef';

type Cred = { id: string; name: string };
type Nodo = { name: string; type: string; parameters: Record<string, unknown>; credentials?: Record<string, Cred> };
const nodo = (name: string, parameters: Record<string, unknown>, credentials?: Record<string, Cred>): Nodo => ({ name, type: 'n8n-nodes-base.code', parameters, ...(credentials ? { credentials } : {}) });
const flujo = (nodes: Nodo[], name = 'Flujo de mentira') => ({ name, nodes, connections: {}, settings: { executionOrder: 'v1' } });

let n = 0;
function helper(versionado: unknown, vivo: unknown, marcadores: string[]) {
  const dir = join(carpeta, `h${n++}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'v.json'), JSON.stringify(versionado));
  writeFileSync(join(dir, 'vivo.json'), JSON.stringify(vivo));
  const r = spawnSync('python3', ['-I', HELPER, '--flujo', join(dir, 'v.json'), '--vivo', join(dir, 'vivo.json'), '--marcadores', marcadores.join(','), '--salida', join(dir, 'o.json')], { encoding: 'utf8' });
  const valores = existsSync(join(dir, 'o.json')) ? (JSON.parse(readFileSync(join(dir, 'o.json'), 'utf8')) as Record<string, string>) : {};
  return { r, valores, out: `${r.stdout}${r.stderr}` };
}

describe('valores-del-vivo.py: extraccion', () => {
  it('un parametro entero: toma el valor del vivo en la misma ruta', () => {
    const v = flujo([nodo('Config', { assignments: [{ name: 'a', value: 'x' }, { name: 'phone', value: 'REEMPLAZAR_PHONE_NUMBER_ID_X' }] })]);
    const vivo = flujo([nodo('Config', { assignments: [{ name: 'a', value: 'x' }, { name: 'phone', value: PHONE }] })]);
    const { r, valores, out } = helper(v, vivo, ['REEMPLAZAR_PHONE_NUMBER_ID_X']);
    expect(r.status).toBe(0);
    expect(valores).toEqual({ REEMPLAZAR_PHONE_NUMBER_ID_X: PHONE });
    expect(out).toContain('resuelto del vivo');
    expect(out).not.toContain(PHONE);
  });
  it('incrustado en jsCode: alinea el texto alrededor y extrae solo el valor (aunque el resto del codigo difiera)', () => {
    const v = flujo([nodo('Codigo', { jsCode: "const x = 1;\nconst WABA = 'REEMPLAZAR_WABA_ID_X';\nreturn x;" })]);
    const vivo = flujo([nodo('Codigo', { jsCode: `// cabecera distinta\nconst x = 1;\nconst WABA = '${WABA}';\nreturn x;\n// y mas` })]);
    const { r, valores } = helper(v, vivo, ['REEMPLAZAR_WABA_ID_X']);
    expect(r.status).toBe(0);
    expect(valores['REEMPLAZAR_WABA_ID_X']).toBe(WABA);
  });
  it('marcador pegado a una ruta (URL_CATALOGO/api/...): toma solo la base', () => {
    const v = flujo([nodo('Traer', { url: '=REEMPLAZAR_URL_CATALOGO/api/v1/catalogo?m={{ 1 }}' })]);
    const vivo = flujo([nodo('Traer', { url: '=https://tienda.ejemplo.bo/api/v1/catalogo?m={{ 1 }}' })]);
    const { r, valores } = helper(v, vivo, ['REEMPLAZAR_URL_CATALOGO']);
    expect(r.status).toBe(0);
    expect(valores['REEMPLAZAR_URL_CATALOGO']).toBe('https://tienda.ejemplo.bo');
  });
  it('planilla y ruta del receptor validan su forma', () => {
    const v = flujo([nodo('A', { id: 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_X' }), nodo('B', { path: 'REEMPLAZAR_RUTA_RECEPTOR_X' })]);
    const vivo = flujo([nodo('A', { id: PLANILLA }), nodo('B', { path: RUTA })]);
    const { r, valores } = helper(v, vivo, ['REEMPLAZAR_PLANILLA_PROSPECTOS_ID_X', 'REEMPLAZAR_RUTA_RECEPTOR_X']);
    expect(r.status).toBe(0);
    expect(valores).toEqual({ REEMPLAZAR_PLANILLA_PROSPECTOS_ID_X: PLANILLA, REEMPLAZAR_RUTA_RECEPTOR_X: RUTA });
  });
  it('doble coincidencia: dos valores distintos del mismo marcador => falla, nombrando el marcador, sin valores', () => {
    const v = flujo([nodo('A', { a: 'REEMPLAZAR_WABA_ID_X' }), nodo('B', { b: 'REEMPLAZAR_WABA_ID_X' })]);
    const vivo = flujo([nodo('A', { a: WABA }), nodo('B', { b: '700000000007' })]);
    const { r, valores, out } = helper(v, vivo, ['REEMPLAZAR_WABA_ID_X']);
    expect(r.status).toBe(1);
    expect(valores).toEqual({});
    expect(out).toContain('REEMPLAZAR_WABA_ID_X');
    expect(out).not.toContain(WABA);
  });
  it('doble coincidencia: el nodo repetido en el vivo (o ausente) => falla', () => {
    const v = flujo([nodo('A', { a: 'REEMPLAZAR_WABA_ID_X' })]);
    expect(helper(v, flujo([nodo('A', { a: WABA }), nodo('A', { a: WABA })]), ['REEMPLAZAR_WABA_ID_X']).r.status).toBe(1);
    expect(helper(v, flujo([nodo('Otro', { a: WABA })]), ['REEMPLAZAR_WABA_ID_X']).r.status).toBe(1);
  });
  it('doble coincidencia dentro de un texto: dos valores distintos donde el versionado tiene una sola marca => falla', () => {
    const v = flujo([nodo('C', { jsCode: "const w = 'REEMPLAZAR_WABA_ID_X';" })]);
    const vivo = flujo([nodo('C', { jsCode: `const w = '${WABA}';\nconst w = '700000000007';` })]);
    expect(helper(v, vivo, ['REEMPLAZAR_WABA_ID_X']).r.status).toBe(1);
  });
  it('forma invalida: letras en un PHONE_NUMBER_ID, planilla corta, ruta con barra => falla', () => {
    const v = flujo([nodo('A', { p: 'REEMPLAZAR_PHONE_NUMBER_ID_X', s: 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_X', r: 'REEMPLAZAR_RUTA_RECEPTOR_X' })]);
    const vivo = flujo([nodo('A', { p: '12ab34', s: 'corta', r: 'a/b' })]);
    const { r, valores, out } = helper(v, vivo, ['REEMPLAZAR_PHONE_NUMBER_ID_X', 'REEMPLAZAR_PLANILLA_PROSPECTOS_ID_X', 'REEMPLAZAR_RUTA_RECEPTOR_X']);
    expect(r.status).toBe(1);
    expect(valores).toEqual({});
    for (const m of ['PHONE_NUMBER_ID_X', 'PLANILLA_PROSPECTOS_ID_X', 'RUTA_RECEPTOR_X']) expect(out).toContain(`REEMPLAZAR_${m}`);
  });
  it('un sufijo sin forma declarada nunca se adivina', () => {
    const v = flujo([nodo('A', { a: 'REEMPLAZAR_ETAPA_PRUEBA' })]);
    expect(helper(v, flujo([nodo('A', { a: 'no' })]), ['REEMPLAZAR_ETAPA_PRUEBA']).r.status).toBe(1);
  });
});

describe('preparar-import.sh --valores-del-vivo', () => {
  /** n8n de mentira: un curl que sirve el flujo vivo por GET /workflows/<id>. */
  function correr(versionado: unknown, vivo: unknown, filasTabla: string[], extra: string[] = ['--valores-del-vivo']) {
    const dir = join(carpeta, `p${n++}`);
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(dir, 'vivo.json'), JSON.stringify(vivo));
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\ncat >/dev/null\nout=''\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\ncp '${join(dir, 'vivo.json')}' "$out"\nprintf 200\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    writeFileSync(join(dir, 'tabla.md'), ['| Marcador | Valor |', '|---|---|', ...filasTabla].join('\n') + '\n');
    writeFileSync(join(dir, 'env'), 'N8N_BASE_URL=http://n8n.invalid\nN8N_API_KEY=clave-de-mentira\nN8N_WORKFLOW_ID=abc\n');
    writeFileSync(join(dir, 'f.json'), JSON.stringify(versionado));
    const r = spawnSync('bash', [PREPARAR, join(dir, 'f.json'), join(dir, 'env'), ...extra], {
      cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, { CONFIG_LOCAL_MD: join(dir, 'tabla.md'), PATH: `${bin}:${process.env['PATH']}` }),
    });
    const salida = join(dir, 'f.local.json');
    return { r, out: `${r.stdout}${r.stderr}`, texto: () => readFileSync(salida, 'utf8') };
  }
  const versionado = flujo([nodo('Config', { phone: 'REEMPLAZAR_PHONE_NUMBER_ID_X', waba: 'REEMPLAZAR_WABA_ID_X' }), nodo('Codigo', { jsCode: 'const p = "REEMPLAZAR_PHONE_NUMBER_ID_X";' })]);
  const vivo = flujo([nodo('Config', { phone: PHONE, waba: WABA }), nodo('Codigo', { jsCode: `const p = "${PHONE}";` })]);

  it('arma el .local.json sin marcadores y la salida no contiene ningun valor', () => {
    const { r, out, texto } = correr(versionado, vivo, []);
    expect(r.status).toBe(0);
    expect(texto()).not.toContain('REEMPLAZAR_');
    expect(texto()).toContain(PHONE);
    expect(out).toContain('REEMPLAZAR_PHONE_NUMBER_ID_X');
    expect(out).toContain('resuelto del vivo');
    for (const valor of [PHONE, WABA, 'clave-de-mentira']) expect(out).not.toContain(valor);
  });
  it('la tabla gana sobre el vivo', () => {
    const { r, texto } = correr(versionado, vivo, ['| `REEMPLAZAR_PHONE_NUMBER_ID_X` | 500000000001 |']);
    expect(r.status).toBe(0);
    expect(texto()).toContain('500000000001');
    expect(texto()).not.toContain(PHONE);
    expect(texto()).toContain(WABA);
  });
  it('sin la bandera el vivo no se consulta: el marcador queda y el script falla', () => {
    const { r, out } = correr(versionado, vivo, [], []);
    expect(r.status).toBe(1);
    expect(out).toContain('sin valor en la tabla');
  });
  it('si un marcador no se resuelve, falla cerrado nombrandolo (y con el motivo, sin valores)', () => {
    const vivoMalo = flujo([nodo('Config', { phone: 'no-es-un-numero', waba: WABA }), nodo('Codigo', { jsCode: 'const p = "no-es-un-numero";' })]);
    const { r, out } = correr(versionado, vivoMalo, []);
    expect(r.status).toBe(1);
    expect(out).toContain('REEMPLAZAR_PHONE_NUMBER_ID_X');
    expect(out).toContain('NO resuelto');
    expect(out).not.toContain('no-es-un-numero');
  });
  it('--valores-del-vivo exige el .env como segundo argumento', () => {
    const r = spawnSync('bash', [PREPARAR, 'Flujos/demo-a-agendamiento.json', '--valores-del-vivo'], { cwd: RAIZ, encoding: 'utf8', env: entornoDelEmulador(undefined, {}) });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain('.env');
  });
});

describe('publicar-flujo.sh: una correccion de credencial nunca cruza comercios', () => {
  const GRAPH_VIVO = { id: 'c10', name: 'WhatsApp Graph (Casa Bermejo)' };
  const GRAPH_OTRO = { id: 'c09', name: 'Graph WhatsApp Walisuma 9448 (Bearer)' };
  const INGESTA_VIVO = { id: 'i10', name: 'NovuChat ingesta (cliente10)' };
  const INGESTA_OTRO = { id: 'i09', name: 'NovuChat ingesta (cliente09)' };
  const PROPIA = { id: 'g11', name: 'Graph WhatsApp Bellido (Bearer)' };
  const PROPIA_VIEJA = { id: 'g10', name: 'WhatsApp Graph Bellido' };

  function correr(vivoCred: Cred, origenCred: Cred, aplicar: boolean) {
    const dir = join(carpeta, `x${n++}`);
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const cuerpo = (cred: Cred) => ({ id: 'abc', name: 'Flujo ajeno', active: true, nodes: [nodo('Enviar a WhatsApp', { a: 1 }, { httpHeaderAuth: cred })], connections: {}, settings: { executionOrder: 'v1' } });
    writeFileSync(join(dir, 'vivo.json'), JSON.stringify(cuerpo(vivoCred)));
    writeFileSync(join(dir, 'creds.json'), JSON.stringify({ data: [vivoCred, origenCred].map((c) => ({ ...c, type: 'httpHeaderAuth' })) }));
    writeFileSync(join(dir, 'f.json'), JSON.stringify(cuerpo(origenCred)));
    writeFileSync(join(dir, 'env'), 'N8N_API_KEY=clave-de-mentira\nN8N_BASE_URL=http://n8n.invalid\nN8N_WORKFLOW_ID=abc\n');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\nurl=''; out=''\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2";; http*) url="$1";; esac; shift; done\ncat >/dev/null\ncase "$url" in\n  *credentials*) cp '${join(dir, 'creds.json')}' "$out";;\n  *) cp '${join(dir, 'vivo.json')}' "$out";;\nesac\nprintf 200\n`);
    chmodSync(join(bin, 'curl'), 0o755);
    const r = spawnSync('bash', [PUBLICAR, '--env', relative(RAIZ, join(dir, 'env')), '--flujo', join(dir, 'f.json'), ...(aplicar ? ['--aplicar'] : [])], {
      cwd: RAIZ, encoding: 'utf8', input: '', env: entornoDelEmulador(undefined, { PATH: `${bin}:${process.env['PATH']}` }),
    });
    return { r, out: `${r.stdout}${r.stderr}` };
  }

  it('Graph del comercio -> Graph de Walisuma: se senala y, con --aplicar, aborta antes de escribir', () => {
    const seco = correr(GRAPH_VIVO, GRAPH_OTRO, false);
    expect(seco.out).toContain('CRUZA comercios');
    const aplicado = correr(GRAPH_VIVO, GRAPH_OTRO, true);
    expect(aplicado.r.status).not.toBe(0);
    expect(aplicado.out).toContain('ABORTADO antes de escribir');
    expect(aplicado.out).toContain('OTRO comercio');
  });
  it('ingesta cliente10 -> cliente09: cruza', () => {
    expect(correr(INGESTA_VIVO, INGESTA_OTRO, false).out).toContain('CRUZA comercios');
  });
  it('una correccion dentro del mismo comercio no se bloquea', () => {
    const { out } = correr(PROPIA_VIEJA, PROPIA, false);
    expect(out).toContain('credencial corregida');
    expect(out).not.toContain('CRUZA comercios');
  });
});
