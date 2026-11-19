/**
 * LOS DATOS LOCALES de Casa Bermejo (`construir.mjs --local --datos <archivo>.local.json`): arma JSON importables con valores de un ensayo SIN que un valor real
 * entre jamás a un archivo versionado. Se prueba NEGANDO: cada regla se prueba con un dato dañado a propósito.
 */
import { spawnSync } from 'node:child_process';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — el armador es un módulo .mjs sin tipos
import * as C from '../../../../Flujos/clientes/casa-bermejo/construir.mjs';
import type { J } from '../../lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const CARPETA = join(RAIZ, 'Flujos/clientes/casa-bermejo');
const LOCAL_PROD = join(CARPETA, 'casa-bermejo.local.json');
const LOCAL_PRUEBA = join(CARPETA, 'casa-bermejo.prueba.local.json');
const VERSIONADOS = [join(CARPETA, 'casa-bermejo.json'), join(CARPETA, 'casa-bermejo.prueba.json'), join(RAIZ, 'admin/scripts/datos/casa-bermejo/casa-bermejo.json')];
const corrida = (...args: string[]) => spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador({}) });

// Valores de ensayo FICTICIOS (no son ids de Meta ni rutas reales).
const WABA = '9876543210123';
const PHONE = '1234567890123456';
const RUTA = 'ruta_de_ensayo_0000';
const base = (): J => ({
  credenciales: { gemini: 'Gemini — pruebas (no producción)', geminiPrueba: 'Gemini — pruebas (no producción)' },
  receptor: { wabaIdEsperado: WABA },
  catalogoUrl: 'https://novutienda-sitio-stg.web.app',
  configBase: { phoneNumberIdEsperado: PHONE, nombreNegocio: 'Casa Bermejo', avisoPedidoEstado: 'APPROVED', hostsFoto: 'storage.googleapis.com', tratamiento: 'usted', modosDeEntrega: 'Recojo en tienda' },
});

const carpetas: string[] = [];
function archivoLocal(datos: unknown, nombre = 'ensayo.local.json'): string {
  const d = mkdtempSync(join(tmpdir(), 'cb-local-'));
  carpetas.push(d);
  const ruta = join(d, nombre);
  writeFileSync(ruta, typeof datos === 'string' ? datos : JSON.stringify(datos));
  return ruta;
}
const limpiar = () => { for (const f of [LOCAL_PROD, LOCAL_PRUEBA]) rmSync(f, { force: true }); for (const d of carpetas.splice(0)) rmSync(d, { recursive: true, force: true }); };
afterEach(limpiar);
const mensaje = (f: () => unknown): string => { try { f(); } catch (e) { return String((e as Error).message); } return ''; };
const hash = (rutas: string[]) => rutas.map((r) => readFileSync(r, 'utf8'));

describe('armar con datos locales', () => {
  it('sustituye lo local en los JSON locales y NO toca ni un byte de los versionados (ni de sus datos)', () => {
    const antes = hash(VERSIONADOS);
    const r = C.construirLocal({ datosLocal: archivoLocal(base()) }) as { archivo: string; nodos: number }[];
    expect(r.map((x) => x.archivo)).toEqual(['casa-bermejo.local.json', 'casa-bermejo.prueba.local.json']);
    expect(r.map((x) => x.nodos)).toEqual([61, 56]); // el MISMO tamaño que los versionados: ningún nodo ni mensaje agregado
    expect(hash(VERSIONADOS)).toEqual(antes);
    const prod = readFileSync(LOCAL_PROD, 'utf8');
    expect(prod).toContain(WABA);
    expect(prod).toContain(PHONE);
    expect(prod).toContain('Gemini — pruebas (no producción)');
    for (const v of VERSIONADOS) { const t = readFileSync(v, 'utf8'); expect(t).not.toContain(WABA); expect(t).not.toContain(PHONE); }
  });
  it('los JSON locales nacen con permisos 600 (llevan la ruta del receptor, una URL de capacidad)', () => {
    C.construirLocal({ datosLocal: archivoLocal(base()) });
    for (const f of [LOCAL_PROD, LOCAL_PRUEBA]) expect(statSync(f).mode & 0o777).toBe(0o600);
  });
  it('`--verificar` sigue exigiendo los versionados al día y no se contamina con los locales', () => {
    expect(corrida('--local', '--datos', archivoLocal(base())).status).toBe(0);
    const v = corrida('--verificar');
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/al día \(61 nodos\)/);
  });
  it('lo local queda ignorado por git, el archivo de datos local también', () => {
    corrida('--local', '--datos', archivoLocal(base()));
    for (const f of [LOCAL_PROD, LOCAL_PRUEBA, join(CARPETA, 'datos.local.json')]) {
      const g = spawnSync('git', ['check-ignore', '-q', f], { cwd: RAIZ });
      expect(g.status, f).toBe(0);
    }
  });
  it('la línea de comandos no imprime ningún valor, solo los nodos y los marcadores pendientes POR CLAVE', () => {
    const r = corrida('--local', '--datos', archivoLocal(base()));
    expect(r.status).toBe(0);
    const salida = r.stdout + r.stderr;
    for (const valor of [WABA, PHONE, 'storage.googleapis.com', 'novutienda-sitio-stg']) expect(salida).not.toContain(valor);
    expect(salida).toMatch(/marcadores sin sustituir \(credenciales\.ingesta/);
    expect(salida).toMatch(/61 nodos/);
  });
  it('un marcador que queda sin sustituir deja el flujo local NO publicable (`--publicable` nombra el marcador, nunca un valor)', () => {
    corrida('--local', '--datos', archivoLocal(base()));
    const p = corrida('--publicable', '--flujo', LOCAL_PRUEBA);
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(p.stderr + p.stdout).not.toContain(WABA);
  });
  it('con TODO sustituido y el costo de entrega declarado, el flujo local pasa la guardia (y la guardia sigue exigiendo APPROVED)', () => {
    const d = base();
    const cb = d['configBase'] as J;
    Object.assign(cb, { numeroRecepcion: '59171234567', contactoAviso: '59172345678', telefonosDePrueba: '59173456789', costoDeEntrega: 'A convenir' });
    d['credenciales'] = Object.fromEntries(['ingesta', 'graph', 'graphPrueba', 'entradaPrueba', 'gemini', 'geminiPrueba', 'catalogo', 'catalogoPrueba'].map((c) => [c, `Credencial de ensayo ${c}`]));
    d['receptor'] = { ruta: RUTA, wabaIdEsperado: WABA };
    d['pruebaRuta'] = 'prueba_ruta_0001';
    const r = corrida('--local', '--datos', archivoLocal(d));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Quedan 1 marcadores sin sustituir \(receptor\.urlVerificador\)/);
    // La variante de PRUEBA no lleva la entrada del receptor: pasa la guardia con todo sustituido.
    expect(corrida('--publicable', '--flujo', LOCAL_PRUEBA).status).toBe(0);
    // La de PRODUCCIÓN sigue bloqueada por el verificador, que solo puede ser un marcador.
    const pp = corrida('--publicable', '--flujo', LOCAL_PROD);
    expect(pp.status).toBe(1);
    expect(pp.stderr).toMatch(/REEMPLAZAR_URL_VERIFICADOR_RECEPTOR/);
    (cb as J)['avisoPedidoEstado'] = 'PENDING';
    corrida('--local', '--datos', archivoLocal(d, 'otro.local.json'));
    const p = corrida('--publicable', '--flujo', LOCAL_PRUEBA);
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/APPROVED/);
  });
});

describe('NEGADO: lo que un dato local no puede traer', () => {
  const rechaza = (mut: (d: J) => void, patron: RegExp, nombre = 'ensayo.local.json') => {
    const d = base(); mut(d);
    const m = mensaje(() => C.cargarDatosLocal(archivoLocal(d, nombre)));
    expect(m).toMatch(patron);
    return m;
  };
  it('un archivo que no termina en .local.json (git no lo ignoraría)', () => {
    expect(mensaje(() => C.cargarDatosLocal(archivoLocal(base(), 'datos.json')))).toMatch(/\.local\.json/);
  });
  it('un archivo que no existe, un JSON roto y uno que no es un objeto', () => {
    expect(mensaje(() => C.cargarDatosLocal(join(tmpdir(), 'no-existe-cb.local.json')))).toMatch(/no existe/);
    expect(mensaje(() => C.cargarDatosLocal(archivoLocal('{"a":')))).toMatch(/no es un JSON válido/);
    expect(mensaje(() => C.cargarDatosLocal(archivoLocal('[1]')))).toMatch(/tiene que ser un objeto/);
  });
  it('una clave de nivel superior desconocida y cualquier clave con nombre de secreto', () => {
    rechaza((d) => { d['extra'] = 'x'; }, /extra: clave desconocida/);
    rechaza((d) => { (d['configBase'] as J)['tokenDeMeta'] = 'abc'; }, /nombre de clave de un secreto/);
    rechaza((d) => { (d['receptor'] as J)['secreto'] = 'abc'; }, /nombre de clave de un secreto/);
  });
  it('un valor con forma de token o de clave (Bearer, EAA…, AIza…, una cadena larga sin espacios) en cualquier campo', () => {
    rechaza((d) => { (d['credenciales'] as J)['graph'] = 'EAAB' + 'x'.repeat(40); }, /credenciales\.graph: el valor parece un token/);
    rechaza((d) => { (d['configBase'] as J)['nombreNegocio'] = 'Bearer abcdefghijklmnop'; }, /nombreNegocio: el valor parece un token/);
    rechaza((d) => { (d['credenciales'] as J)['catalogo'] = 'a'.repeat(40); }, /credenciales\.catalogo: el valor parece un token/);
  });
  it('el nombre de una credencial con comillas, llaves, barra invertida o salto de línea', () => {
    for (const malo of ['Cre"dencial', 'Cred{{x}}', 'Cred\\x', 'Cred\nx']) rechaza((d) => { (d['credenciales'] as J)['gemini'] = malo; }, /credenciales\.gemini: forma de nombre no válida/);
  });
  it('un host de catálogo fuera de ANFITRIONES_TIENDA, con ruta, con puerto, con credenciales o sin https', () => {
    for (const url of ['https://otro-host.example.com', 'https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo', 'https://novutienda-sitio-stg.web.app:8443', 'https://usuario@novutienda-sitio-stg.web.app', 'http://novutienda-sitio-stg.web.app', 'https://novutienda-sitio-stg.web.app.malo.com']) {
      rechaza((d) => { d['catalogoUrl'] = url; }, /catalogoUrl: forma no válida/);
    }
  });
  it('la URL del verificador interno del receptor NO se sustituye (ni una interna ni una pública): solo puede quedar el marcador', () => {
    for (const url of ['https://verificador.example.com/x', 'http://verificador-interno:3000/v', 'http://10.0.0.5/v', 'no es una url']) {
      rechaza((d) => { (d['receptor'] as J)['urlVerificador'] = url; }, /receptor\.urlVerificador: forma no válida/);
    }
  });
  it('un id de WABA que no son dígitos, una ruta con una URL o con caracteres raros, un tratamiento ajeno y hosts de fotos con ruta', () => {
    rechaza((d) => { (d['receptor'] as J)['wabaIdEsperado'] = 'abc'; }, /receptor\.wabaIdEsperado: forma no válida/);
    rechaza((d) => { (d['receptor'] as J)['ruta'] = 'https://n8n.example.com/webhook/x'; }, /receptor\.ruta: forma no válida/);
    rechaza((d) => { d['pruebaRuta'] = 'corta'; }, /pruebaRuta: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['tratamiento'] = 'vos'; }, /configBase\.tratamiento: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['hostsFoto'] = 'https://storage.googleapis.com/x'; }, /configBase\.hostsFoto: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['modelo'] = 'gpt-4'; }, /configBase\.modelo: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['avisoPedidoEstado'] = 'LISTO'; }, /configBase\.avisoPedidoEstado: forma no válida/);
  });
  it('una lista donde va un valor, y un valor que no es texto, número ni booleano', () => {
    rechaza((d) => { (d['configBase'] as J)['hostsFoto'] = ['a']; }, /no se admiten listas/);
    rechaza((d) => { (d['configBase'] as J)['nombreNegocio'] = { a: 1 }; }, /solo texto, número o booleano/);
  });
  it('un dato inválido NO deja un JSON local a medias (nada se escribe)', () => {
    corrida('--local', '--datos', archivoLocal({ ...base(), catalogoUrl: 'https://malo.example.com' }));
    expect(existsSync(LOCAL_PROD)).toBe(false);
    expect(existsSync(LOCAL_PRUEBA)).toBe(false);
  });
});

describe('línea de comandos', () => {
  it('`--local` sin `--datos`, con argumentos de más o con `--datos` sin valor sale 2; un dato inválido sale 1 y sin imprimir valores', () => {
    expect(corrida('--local').status).toBe(2);
    expect(corrida('--local', '--datos').status).toBe(2);
    expect(corrida('--local', '--datos', archivoLocal(base()), '--otro').status).toBe(2);
    expect(corrida('--local', '--datos', '--verificar').status).toBe(2);
    const d = base(); (d['receptor'] as J)['wabaIdEsperado'] = 'valor-malo-12345';
    const r = corrida('--local', '--datos', archivoLocal(d));
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).not.toContain('valor-malo-12345');
  });
  it('los marcadores pendientes se nombran por clave y nunca por valor', () => {
    const d = C.cargarDatosLocal(archivoLocal(base())) as J;
    const pend = C.marcadoresPendientes(d) as string[];
    expect(pend).toContain('credenciales.ingesta');
    expect(pend).toContain('receptor.ruta');
    expect(pend.join(' ')).not.toMatch(/REEMPLAZAR_/);
  });
});
