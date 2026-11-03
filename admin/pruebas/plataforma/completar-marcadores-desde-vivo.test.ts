/**
 * `scripts/completar-marcadores-desde-vivo.mjs` — repone los REEMPLAZAR_* que la tabla local no tiene, con el valor del flujo VIVO.
 * Sin n8n ni red: el flujo vivo y `fetch` son de mentira. Los valores son sintéticos.
 *   B1. El emparejamiento: marcador solo, marcador dentro de un texto, lista por nombre (aunque cambie el orden).
 *   B2. NEGADO: lo que no se puede reponer no se repone (nodo ausente, marcador vivo, conflicto, otro texto).
 *   B3. Ejecución: seco no escribe; --aplicar escribe 0600; la salida nunca trae un valor; otro flujo se rechaza.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type J = Record<string, any>;
const mod = await import('../../../scripts/completar-marcadores-desde-vivo.mjs') as unknown as {
  emparejar: (local: string, vivo: unknown) => Record<string, string> | null;
  resolverDesdeVivo: (local: J, vivo: J) => { resueltos: Record<string, string>; sinResolver: string[]; conflictos: string[] };
  aplicarValores: (local: J, resueltos: Record<string, string>) => J;
  ejecutar: (a: { local: string; env: string; aplicar?: boolean }, d: { log: (t: string) => void; buscar: unknown }) => Promise<number>;
};

const dirs: string[] = [];
const dir = () => { const d = mkdtempSync(join('/tmp', 'comp-marc-')); chmodSync(d, 0o700); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const asig = (name: string, value: string) => ({ id: name, name, value, type: 'string' });
const flujo = (nombre: string, config: J[], extra: J[] = []): J => ({ name: nombre, nodes: [
  { name: 'Config base', parameters: { assignments: { assignments: config } } },
  { name: 'Entrega', parameters: { path: 'REEMPLAZAR_RUTA_X', otro: 'https://host.ejemplo/ok?x=REEMPLAZAR_VERIFICADOR' } }, ...extra] });

const LOCAL = flujo('Flujo X', [asig('phoneNumberId', 'REEMPLAZAR_PHONE_X'), asig('telefonosDePrueba', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA'), asig('fijo', 'texto-fijo')]);
const VIVO = flujo('Flujo X', [asig('fijo', 'texto-fijo'), asig('telefonosDePrueba', ''), asig('phoneNumberId', 'valor-vivo-1')],
  []);
VIVO.nodes[1].parameters = { path: 'ruta-viva-abc', otro: 'https://host.ejemplo/ok?x=verificador-vivo' };

describe('B1. emparejar', () => {
  it('el marcador solo toma el texto vivo; dentro de un texto toma lo que ocupa su lugar', () => {
    expect(mod.emparejar('REEMPLAZAR_A', 'valor')).toEqual({ REEMPLAZAR_A: 'valor' });
    expect(mod.emparejar('https://h/ok?x=REEMPLAZAR_V', 'https://h/ok?x=vivo')).toEqual({ REEMPLAZAR_V: 'vivo' });
    expect(mod.emparejar('a REEMPLAZAR_A b REEMPLAZAR_B', 'a 1 b 2')).toEqual({ REEMPLAZAR_A: '1', REEMPLAZAR_B: '2' });
  });
  it('NEGADO: si el resto del texto no coincide, o el vivo no es texto, no hay emparejamiento', () => {
    expect(mod.emparejar('https://h/ok?x=REEMPLAZAR_V', 'https://otro/ok?x=vivo')).toBeNull();
    expect(mod.emparejar('REEMPLAZAR_A', undefined)).toBeNull();
    expect(mod.emparejar('REEMPLAZAR_A', 7)).toBeNull();
    expect(mod.emparejar('REEMPLAZAR_A y REEMPLAZAR_A', '1 y 2')).toBeNull(); // el mismo marcador con dos valores
  });
  it('un valor vacío en el vivo se acepta (p. ej. teléfonos de prueba)', () => {
    expect(mod.emparejar('REEMPLAZAR_T', '')).toEqual({ REEMPLAZAR_T: '' });
  });
});

describe('B1b. NEGADO: lo ambiguo, lo enorme y lo que puede imprimir un valor', () => {
  it('el marcador es ESTRICTO: lo que sigue al nombre (una ruta ya repuesta) no forma parte del marcador y nunca se imprime', async () => {
    const SECRETO = 'ruta-secreta-ya-repuesta';
    const local = flujo('Flujo X', [asig('u', `https://REEMPLAZAR_HOST/webhook/${SECRETO}`)]);
    const vivo = flujo('Flujo X', [asig('u', 'https://host-vivo/webhook/' + SECRETO)]);
    local.nodes[1].parameters = { path: 'x' }; vivo.nodes[1].parameters = { path: 'x' };
    const r = mod.resolverDesdeVivo(local, vivo);
    expect(r.resueltos).toEqual({ REEMPLAZAR_HOST: 'host-vivo' });
    const m = mundo(local, vivo);
    await mod.ejecutar({ local: m.archivo, env: m.env }, m.deps);
    expect(m.texto()).toContain('REEMPLAZAR_HOST');
    expect(m.texto()).not.toContain(SECRETO);
  });
  it('partición ambigua con 2 marcadores en un texto (el vivo se puede repartir de dos maneras): no se repone ninguno', () => {
    expect(mod.emparejar('a REEMPLAZAR_A b REEMPLAZAR_B', 'a 1 b 2 b 3')).toBeNull();
    expect(mod.emparejar('a REEMPLAZAR_A b REEMPLAZAR_B', 'a 1 b 2')).toEqual({ REEMPLAZAR_A: '1', REEMPLAZAR_B: '2' });
  });
  it('más de 3 marcadores en un texto, o un texto vivo de más de 20 KB, no se emparejan (sin riesgo de colgarse)', () => {
    expect(mod.emparejar('REEMPLAZAR_A-REEMPLAZAR_B-REEMPLAZAR_C-REEMPLAZAR_D', '1-2-3-4')).toBeNull();
    expect(mod.emparejar('x REEMPLAZAR_A y', `x ${'a'.repeat(25_000)} y`)).toBeNull();
  });
  it('un marcador que encaja en un nodo y no encaja en otro nodo vivo es conflicto y no se repone', () => {
    const local = flujo('Flujo X', [asig('a', 'REEMPLAZAR_A')], [{ name: 'Otro', parameters: { t: 'prefijo-REEMPLAZAR_A' } }]);
    const vivo = flujo('Flujo X', [asig('a', 'valor')], [{ name: 'Otro', parameters: { t: 'algo-distinto' } }]);
    local.nodes[1].parameters = { path: 'x' }; vivo.nodes[1].parameters = { path: 'x' };
    const r = mod.resolverDesdeVivo(local, vivo);
    expect(r.conflictos).toEqual(['REEMPLAZAR_A']);
    expect('REEMPLAZAR_A' in r.resueltos).toBe(false);
  });
});

describe('B2. resolverDesdeVivo y aplicarValores', () => {
  it('repone todo lo que el vivo tiene, aunque la lista venga en otro orden (por nombre), y deja intacto lo demás', () => {
    const r = mod.resolverDesdeVivo(LOCAL, VIVO);
    expect(r.sinResolver).toEqual([]);
    expect(r.conflictos).toEqual([]);
    expect(r.resueltos).toEqual({ REEMPLAZAR_PHONE_X: 'valor-vivo-1', REEMPLAZAR_TELEFONOS_DE_PRUEBA: '', REEMPLAZAR_RUTA_X: 'ruta-viva-abc', REEMPLAZAR_VERIFICADOR: 'verificador-vivo' });
    const listo = mod.aplicarValores(LOCAL, r.resueltos);
    expect(JSON.stringify(listo)).not.toContain('REEMPLAZAR_');
    expect(listo.nodes[0].parameters.assignments.assignments[2]).toMatchObject({ name: 'fijo', value: 'texto-fijo' });
    expect(LOCAL.nodes[0].parameters.assignments.assignments[0].value).toBe('REEMPLAZAR_PHONE_X'); // el original no se toca
  });
  it('NEGADO: nodo que el vivo no tiene, marcador que en el vivo sigue siendo marcador, texto distinto: no se repone', () => {
    const local = flujo('Flujo X', [asig('a', 'REEMPLAZAR_A'), asig('b', 'REEMPLAZAR_B')], [{ name: 'Nodo nuevo', parameters: { x: 'REEMPLAZAR_C' } }]);
    const vivo = flujo('Flujo X', [asig('a', 'REEMPLAZAR_A_PENDIENTE'), asig('b', 'ok-b')]);
    vivo.nodes[1].parameters = {};
    const r = mod.resolverDesdeVivo(local, vivo);
    expect(r.resueltos).toEqual({ REEMPLAZAR_B: 'ok-b' });
    expect(r.sinResolver).toEqual(['REEMPLAZAR_A', 'REEMPLAZAR_C', 'REEMPLAZAR_RUTA_X', 'REEMPLAZAR_VERIFICADOR']);
  });
  it('NEGADO: un marcador con dos valores distintos en el vivo es conflicto y no se repone', () => {
    const local = flujo('Flujo X', [asig('a', 'REEMPLAZAR_A'), asig('b', 'REEMPLAZAR_A')]);
    const vivo = flujo('Flujo X', [asig('a', 'uno'), asig('b', 'dos')]);
    vivo.nodes[1].parameters = { path: 'r', otro: 'https://host.ejemplo/ok?x=v' };
    const r = mod.resolverDesdeVivo(local, vivo);
    expect(r.conflictos).toEqual(['REEMPLAZAR_A']);
    expect('REEMPLAZAR_A' in r.resueltos).toBe(false);
  });
});

function mundo(local: J, vivo: J) {
  const d = dir();
  const archivo = join(d, 'flujo.local.json');
  const env = join(d, '.env.x');
  writeFileSync(archivo, JSON.stringify(local), { mode: 0o644 });
  writeFileSync(env, 'N8N_BASE_URL=https://n8n.ejemplo.test\nN8N_API_KEY=clave-de-prueba-no-real\nN8N_WORKFLOW_ID=abc\n', { mode: 0o600 });
  const salida: string[] = [];
  const pedidos: string[] = [];
  const buscar = async (url: string, op: { method?: string }) => { pedidos.push(`${op.method ?? 'GET'} ${url}`); return { ok: true, status: 200, json: async () => vivo }; };
  return { archivo, env, salida, pedidos, deps: { log: (t: string) => salida.push(t), buscar }, texto: () => salida.join('\n') };
}

describe('B3. ejecución', () => {
  it('el seco no escribe nada y no imprime un solo valor; solo hace GET', async () => {
    const m = mundo(LOCAL, VIVO);
    const antes = readFileSync(m.archivo, 'utf8');
    expect(await mod.ejecutar({ local: m.archivo, env: m.env }, m.deps)).toBe(0);
    expect(readFileSync(m.archivo, 'utf8')).toBe(antes);
    expect(m.texto()).toContain('REEMPLAZAR_PHONE_X');
    expect(m.texto()).not.toMatch(/valor-vivo-1|ruta-viva-abc|verificador-vivo|clave-de-prueba/);
    expect(m.pedidos.every((p) => p.startsWith('GET '))).toBe(true);
  });
  it('--aplicar reescribe el archivo (0600) sin marcadores y sin imprimir valores', async () => {
    const m = mundo(LOCAL, VIVO);
    expect(await mod.ejecutar({ local: m.archivo, env: m.env, aplicar: true }, m.deps)).toBe(0);
    const t = readFileSync(m.archivo, 'utf8');
    expect(t).not.toContain('REEMPLAZAR_');
    expect(t).toContain('valor-vivo-1');
    expect(statSync(m.archivo).mode & 0o777).toBe(0o600);
    expect(m.texto()).not.toMatch(/valor-vivo-1|ruta-viva-abc|verificador-vivo|clave-de-prueba/);
  });
  it('NEGADO: si quedan marcadores sin valor sale 1; si el vivo es OTRO flujo (nombre distinto) sale 2 sin escribir', async () => {
    const parcial = mundo(flujo('Flujo X', [asig('a', 'REEMPLAZAR_SOLO_LOCAL')]), flujo('Flujo X', [asig('a', 'REEMPLAZAR_SOLO_LOCAL')]));
    expect(await mod.ejecutar({ local: parcial.archivo, env: parcial.env, aplicar: true }, parcial.deps)).toBe(1);
    // FALLA CERRADA: si a cualquiera de los dos le falta el nombre, tampoco se repone
    const sinNombre = mundo(LOCAL, { ...VIVO, name: undefined });
    const antesSN = readFileSync(sinNombre.archivo, 'utf8');
    expect(await mod.ejecutar({ local: sinNombre.archivo, env: sinNombre.env, aplicar: true }, sinNombre.deps)).toBe(2);
    expect(readFileSync(sinNombre.archivo, 'utf8')).toBe(antesSN);
    const otro = mundo(LOCAL, { ...VIVO, name: 'Otro flujo' });
    const antes = readFileSync(otro.archivo, 'utf8');
    expect(await mod.ejecutar({ local: otro.archivo, env: otro.env, aplicar: true }, otro.deps)).toBe(2);
    expect(readFileSync(otro.archivo, 'utf8')).toBe(antes);
  });
});
