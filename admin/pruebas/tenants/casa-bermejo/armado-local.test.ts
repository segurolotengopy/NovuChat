/**
 * LOS DATOS LOCALES de Casa Bermejo (`construir.mjs --local --datos <archivo>.local.json`): arma JSON importables con valores de un ensayo SIN que un valor real
 * entre jamás a un archivo versionado. Se prueba NEGANDO: cada regla se prueba con un dato dañado a propósito.
 * Las pruebas escriben SOLO en directorios temporales (`salida`): nunca tocan ni borran los JSON locales reales de la carpeta del cliente.
 */
import { spawnSync } from 'node:child_process';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
import { chmodSync, closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error — el armador es un módulo .mjs sin tipos
import * as C from '../../../../Flujos/clientes/casa-bermejo/construir.mjs';
import type { J } from '../../lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const CARPETA = join(RAIZ, 'Flujos/clientes/casa-bermejo');
const VERSIONADOS = [join(CARPETA, 'casa-bermejo.json'), join(CARPETA, 'casa-bermejo.prueba.json'), join(RAIZ, 'admin/scripts/datos/casa-bermejo/casa-bermejo.json')];
// Las pruebas NO usan el directorio temporal del sistema: sus carpetas de trabajo se crean (0o700, con mkdtemp) bajo una carpeta propia ignorada por git y se borran al terminar.
const RAIZ_TEMPORAL = join(AQUI, '.tmp-local');
const carpetaTemporal = (prefijo: string): string => { mkdirSync(RAIZ_TEMPORAL, { recursive: true, mode: 0o700 }); return mkdtempSync(join(RAIZ_TEMPORAL, prefijo)); };
/** Abre UNA vez y lee modo y contenido del mismo descriptor (sin comprobar la ruta y volver a abrirla). */
function leerConModo(ruta: string): { modo: number; texto: string } {
  const fd = openSync(ruta, 'r');
  try { return { modo: fstatSync(fd).mode & 0o777, texto: readFileSync(fd, 'utf8') }; } finally { closeSync(fd); }
}
const corrida = (...args: string[]) => spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador({}) });

// Valores de ensayo FICTICIOS (no son ids de Meta ni rutas reales).
const WABA = '98765' + '43210' + '123';
const PHONE = '12345' + '67890' + '123456';
const RUTA = 'ruta_de_ensayo_0000';
const base = (): J => ({
  credenciales: { gemini: 'Gemini — pruebas (no producción)', geminiPrueba: 'Gemini — pruebas (no producción)' },
  receptor: { wabaIdEsperado: WABA },
  catalogoUrl: 'https://novutienda-sitio-stg.web.app',
  configBase: { phoneNumberIdEsperado: PHONE, nombreNegocio: 'Casa Bermejo', avisoPedidoEstado: 'APPROVED', hostsFoto: 'storage.googleapis.com', tratamiento: 'usted', modosDeEntrega: 'Recojo en tienda' },
});
/** Todo sustituido salvo la URL del verificador interno, que queda como marcador (solo se acepta el marcador o la constante exacta `URL_VERIFICADOR_INTERNO`). */
const completo = (): J => {
  const d = base();
  Object.assign(d['configBase'] as J, { numeroRecepcion: '591' + '7123' + '4567', contactoAviso: '591' + '7234' + '5678', telefonosDePrueba: '591' + '7345' + '6789', costoDeEntrega: 'A convenir' });
  d['credenciales'] = Object.fromEntries(['ingesta', 'graph', 'graphPrueba', 'entradaPrueba', 'gemini', 'geminiPrueba', 'catalogo', 'catalogoPrueba'].map((c) => [c, `Credencial de ensayo ${c}`]));
  d['receptor'] = { ruta: RUTA, wabaIdEsperado: WABA };
  d['pruebaRuta'] = 'prueba_ruta_0001';
  return d;
};

const carpetas: string[] = [];
function archivoLocal(datos: unknown, nombre = 'ensayo.local.json'): string {
  const d = carpetaTemporal('cb-local-');
  carpetas.push(d);
  const ruta = join(d, nombre);
  writeFileSync(ruta, typeof datos === 'string' ? datos : JSON.stringify(datos));
  return ruta;
}
/** Un directorio temporal de SALIDA, y los dos JSON locales que quedarían ahí. */
function salidaTemporal(): { dir: string; prod: string; prueba: string } {
  const dir = carpetaTemporal('cb-salida-');
  carpetas.push(dir);
  return { dir, prod: join(dir, 'casa-bermejo.local.json'), prueba: join(dir, 'casa-bermejo.prueba.local.json') };
}
afterEach(() => { for (const d of carpetas.splice(0)) rmSync(d, { recursive: true, force: true }); rmSync(RAIZ_TEMPORAL, { recursive: true, force: true }); });
const mensaje = (f: () => unknown): string => { try { f(); } catch (e) { return String((e as Error).message); } return ''; };
const hash = (rutas: string[]) => rutas.map((r) => readFileSync(r, 'utf8'));
const armar = (datos: unknown, salida: string) => C.construirLocal({ datosLocal: archivoLocal(datos), salida }) as { archivo: string; nodos: number; pendientes: string[] }[];

describe('armar con datos locales', () => {
  it('sustituye lo local en los JSON locales y NO toca ni un byte de los versionados (ni de sus datos)', () => {
    const antes = hash(VERSIONADOS);
    const s = salidaTemporal();
    const r = armar(base(), s.dir);
    expect(r.map((x) => x.archivo)).toEqual(['casa-bermejo.local.json', 'casa-bermejo.prueba.local.json']);
    expect(r.map((x) => x.nodos)).toEqual([63, 58]); // el MISMO tamaño que los versionados: ningún nodo ni mensaje agregado
    expect(hash(VERSIONADOS)).toEqual(antes);
    const prod = readFileSync(s.prod, 'utf8');
    expect(prod).toContain(WABA);
    expect(prod).toContain(PHONE);
    expect(prod).toContain('Gemini — pruebas (no producción)');
    for (const v of VERSIONADOS) { const t = readFileSync(v, 'utf8'); expect(t).not.toContain(WABA); expect(t).not.toContain(PHONE); }
  });
  it('los JSON locales nacen con permisos 600 (llevan la ruta del receptor, una URL de capacidad)', () => {
    const s = salidaTemporal();
    armar(base(), s.dir);
    for (const f of [s.prod, s.prueba]) expect(leerConModo(f).modo).toBe(0o600);
  });
  it('un JSON local que YA existía con permisos 644 queda en 600 al volver a armarlo (fchmod, no solo el modo de creación)', () => {
    const s = salidaTemporal();
    for (const f of [s.prod, s.prueba]) { writeFileSync(f, '{}'); chmodSync(f, 0o644); expect(leerConModo(f).modo).toBe(0o644); }
    armar(base(), s.dir);
    for (const f of [s.prod, s.prueba]) { const l = leerConModo(f); expect(l.modo).toBe(0o600); expect(l.texto).toContain(PHONE); }
  });
  it('`--verificar` sigue exigiendo los versionados al día y no se contamina con los locales', () => {
    const s = salidaTemporal();
    expect(corrida('--local', '--datos', archivoLocal(base()), '--salida', s.dir).status).toBe(0);
    const v = corrida('--verificar');
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/al día \(63 nodos\)/);
  });
  it('lo local queda ignorado por git, el archivo de datos local también (se comprueba por ruta, sin escribir en la carpeta del cliente)', () => {
    for (const f of ['casa-bermejo.local.json', 'casa-bermejo.prueba.local.json', 'datos.local.json']) {
      const g = spawnSync('git', ['check-ignore', '-q', join(CARPETA, f)], { cwd: RAIZ });
      expect(g.status, f).toBe(0);
    }
  });
  it('la línea de comandos no imprime ningún valor, solo los nodos y los marcadores pendientes de LO ARMADO (por su nombre fijo)', () => {
    const s = salidaTemporal();
    const r = corrida('--local', '--datos', archivoLocal(base()), '--salida', s.dir);
    expect(r.status).toBe(0);
    const salida = r.stdout + r.stderr;
    for (const valor of [WABA, PHONE, 'storage.googleapis.com', 'novutienda-sitio-stg']) expect(salida).not.toContain(valor);
    expect(salida).toMatch(/marcadores sin sustituir en lo armado \(REEMPLAZAR_CONTACTO_DESIGNADO_AVISO,/);
    expect(salida).toMatch(/63 nodos/);
  });
  it('los marcadores pendientes se calculan sobre lo armado: un marcador sustituido ya no figura', () => {
    const s = salidaTemporal();
    const pend = armar(base(), s.dir)[0]!.pendientes;
    expect(pend).toContain('REEMPLAZAR_CREDENCIAL_INGESTA');
    expect(pend).toContain('REEMPLAZAR_URL_VERIFICADOR_RECEPTOR');
    expect(pend).not.toContain('REEMPLAZAR_WABA_ID_CASA_BERMEJO'); // sustituido por el dato local
    expect(pend).not.toContain('REEMPLAZAR_CREDENCIAL_GEMINI');
    expect(pend).not.toContain('REEMPLAZAR_URL_CATALOGO');
  });
  it('un marcador que queda sin sustituir deja el flujo local NO publicable (`--publicable` nombra el marcador, nunca un valor)', () => {
    const s = salidaTemporal();
    armar(base(), s.dir);
    const p = corrida('--publicable', '--flujo', s.prueba);
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(p.stderr + p.stdout).not.toContain(WABA);
  });
  it('con TODO sustituido y el costo de entrega declarado, la variante de prueba pasa la guardia (la de producción, sin la URL del verificador, sigue con su marcador y bloqueada; y APPROVED se sigue exigiendo)', () => {
    const s = salidaTemporal();
    const d = completo();
    const r = corrida('--local', '--datos', archivoLocal(d), '--salida', s.dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Quedan 1 marcadores sin sustituir en lo armado \(REEMPLAZAR_URL_VERIFICADOR_RECEPTOR\)/);
    expect(corrida('--publicable', '--flujo', s.prueba).status).toBe(0);
    const pp = corrida('--publicable', '--flujo', s.prod);
    expect(pp.status).toBe(1);
    expect(pp.stderr).toMatch(/REEMPLAZAR_URL_VERIFICADOR_RECEPTOR/);
    (d['configBase'] as J)['avisoPedidoEstado'] = 'PENDING';
    (d['configBase'] as J)['avisoRespaldoEstado'] = 'PENDING';
    corrida('--local', '--datos', archivoLocal(d, 'otro.local.json'), '--salida', s.dir);
    const p = corrida('--publicable', '--flujo', s.prueba);
    expect(p.status).toBe(1);
    expect(p.stderr).toMatch(/APPROVED/);
  });
});

describe('NEGADO: las dos variantes pasan las guardias antes de escribir ninguna', () => {
  it('una `geminiPrueba` con el nombre de la credencial de producción hace fallar la variante de prueba y NO se escribe NADA (ni la de producción, que sí pasaba)', () => {
    const s = salidaTemporal();
    const d = base();
    (d['credenciales'] as J)['geminiPrueba'] = 'Gemini producción';
    expect(mensaje(() => armar(d, s.dir))).toMatch(/casa-bermejo\.prueba\.json:/);
    expect(existsSync(s.prod)).toBe(false);
    expect(existsSync(s.prueba)).toBe(false);
    const r = corrida('--local', '--datos', archivoLocal(d), '--salida', s.dir);
    expect(r.status).toBe(1);
    expect(existsSync(s.prod)).toBe(false);
  });
  it('un dato inválido NO deja un JSON local a medias (nada se escribe)', () => {
    const s = salidaTemporal();
    const r = corrida('--local', '--datos', archivoLocal({ ...base(), catalogoUrl: 'https://malo.example.com' }), '--salida', s.dir);
    expect(r.status).toBe(1);
    expect(existsSync(s.prod)).toBe(false);
    expect(existsSync(s.prueba)).toBe(false);
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
    expect(mensaje(() => C.cargarDatosLocal(join(salidaTemporal().dir, 'no-existe.local.json')))).toMatch(/no existe/);
    expect(mensaje(() => C.cargarDatosLocal(archivoLocal('{"a":')))).toMatch(/no es un JSON válido/);
    expect(mensaje(() => C.cargarDatosLocal(archivoLocal('[1]')))).toMatch(/tiene que ser un objeto/);
  });
  it('una clave que no existe en los datos versionados (en cualquier nivel) y cualquier clave con nombre de secreto', () => {
    rechaza((d) => { d['extra'] = 'x'; }, /no existe en los datos versionados/);
    rechaza((d) => { (d['configBase'] as J)['campoNuevo'] = 'x'; }, /configBase\.«clave no reconocida»: no existe en los datos versionados/);
    rechaza((d) => { (d['credenciales'] as J)['otraCredencial'] = 'Una credencial'; }, /credenciales\.«clave no reconocida»: no existe/);
    rechaza((d) => { (d['receptor'] as J)['otroCampo'] = 'x'; }, /receptor\.«clave no reconocida»: no existe/);
    rechaza((d) => { (d['configBase'] as J)['tokenDeMeta'] = 'abc'; }, /nombre de clave de un secreto/);
    rechaza((d) => { (d['receptor'] as J)['secreto'] = 'abc'; }, /nombre de clave de un secreto/);
  });
  it('un dato versionado que no es de la lista blanca no se cambia desde un archivo local (`mensajeComercioSuspendido` es lo que el asistente le promete al cliente)', () => {
    const m = rechaza((d) => { (d['configBase'] as J)['mensajeComercioSuspendido'] = 'Te llamamos apenas abramos'; }, /configBase\.mensajeComercioSuspendido: ese dato no se cambia desde un archivo local/);
    expect(m).not.toContain('Te llamamos');
  });
  it('los textos libres de la lista blanca tienen un largo máximo', () => {
    rechaza((d) => { (d['configBase'] as J)['modosDeEntrega'] = 'x'.repeat(201); }, /modosDeEntrega: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['costoDeEntrega'] = 'x '.repeat(101); }, /costoDeEntrega: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['nombreNegocio'] = 'x'.repeat(81); }, /nombreNegocio: forma no válida/);
    rechaza((d) => { d['nombreFlujo'] = 'x'.repeat(101); }, /nombreFlujo: forma no válida/);
    rechaza((d) => { (d['configBase'] as J)['hostsFoto'] = 'a.com,'.repeat(40); }, /hostsFoto: forma no válida/);
  });
  it('el mensaje de error NO repite el nombre de una clave que no está en los datos versionados (puede ser un secreto escrito como clave)', () => {
    const secreto = 'sk_ESTE_NOMBRE_NO_DEBE_SALIR_9f3k2';
    for (const colocar of [(d: J) => { d[secreto] = 'x'; }, (d: J) => { (d['configBase'] as J)[secreto] = 'x'; }, (d: J) => { (d['credenciales'] as J)[secreto] = 'x'; }, (d: J) => { (d['receptor'] as J)[secreto] = 'x'; }]) {
      const d = base(); colocar(d);
      const m = mensaje(() => C.cargarDatosLocal(archivoLocal(d)));
      expect(m).not.toBe('');
      expect(m).not.toContain(secreto);
      const r = corrida('--local', '--datos', archivoLocal(d), '--salida', salidaTemporal().dir);
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(secreto);
    }
  });
  it('un valor con forma de token o de clave (Bearer, EAA…, AIza…, JWT, una cadena larga sin espacios) en cualquier campo', () => {
    rechaza((d) => { (d['credenciales'] as J)['graph'] = 'EAAB' + 'x'.repeat(40); }, /credenciales\.graph: el valor parece un token/);
    rechaza((d) => { (d['configBase'] as J)['nombreNegocio'] = 'Bearer abcdefghijklmnop'; }, /nombreNegocio: el valor parece un token/);
    rechaza((d) => { (d['credenciales'] as J)['catalogo'] = 'a'.repeat(40); }, /credenciales\.catalogo: el valor parece un token/);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.firma_de_ensayo';
    const m = rechaza((d) => { (d['credenciales'] as J)['ingesta'] = jwt; }, /credenciales\.ingesta: el valor parece un token/);
    expect(m).not.toContain(jwt);
    rechaza((d) => { (d['configBase'] as J)['nombreNegocio'] = 'eyJhbGci.eyJzdWIi'; }, /nombreNegocio: el valor parece un token/);
  });
  it('el nombre de una credencial con comillas, llaves, barra invertida o salto de línea', () => {
    for (const malo of ['Cre"dencial', 'Cred{{x}}', 'Cred\\x', 'Cred\nx']) rechaza((d) => { (d['credenciales'] as J)['gemini'] = malo; }, /credenciales\.gemini: forma de nombre no válida/);
  });
  it('un host de catálogo fuera de ANFITRIONES_TIENDA, con ruta, con puerto, con credenciales o sin https', () => {
    for (const url of ['https://otro-host.example.com', 'https://novutienda-sitio-stg.web.app/api/novuchat/v1/catalogo', 'https://novutienda-sitio-stg.web.app:8443', 'https://usuario@novutienda-sitio-stg.web.app', 'http://novutienda-sitio-stg.web.app', 'https://novutienda-sitio-stg.web.app.malo.com']) {
      rechaza((d) => { d['catalogoUrl'] = url; }, /catalogoUrl: forma no válida/);
    }
  });
  it('la URL del verificador interno: SOLO la constante exacta (otro host, https, otro puerto, otra ruta, con consulta, con barra final, en mayúsculas o pública, se rechazan)', () => {
    const U = C.URL_VERIFICADOR_INTERNO as string;
    expect(U).toBe('http://receptor-clientes:8081/v1/interno/verificar');
    const malas = [
      'https://receptor-clientes:8081/v1/interno/verificar', 'http://receptor-clientes:8082/v1/interno/verificar', 'http://receptor-clientes/v1/interno/verificar',
      'http://receptor-clientes:8081/v1/interno/otra', U + '/', U + '?x=1', U + '#a', 'http://Receptor-Clientes:8081/v1/interno/verificar', U.toUpperCase(), ' ' + U,
      'http://otro-host:8081/v1/interno/verificar', 'http://usuario@receptor-clientes:8081/v1/interno/verificar', 'https://verificador.example.com/x', 'http://10.0.0.5/v', 'no es una url',
    ];
    for (const url of malas) rechaza((d) => { (d['receptor'] as J)['urlVerificador'] = url; }, /receptor\.urlVerificador: forma no válida/);
  });
  it('con la constante exacta la variante de PRODUCCIÓN queda sin marcadores y pasa la guardia de publicación; la de prueba no la lleva', () => {
    const s = salidaTemporal();
    const d = completo();
    (d['receptor'] as J)['urlVerificador'] = C.URL_VERIFICADOR_INTERNO;
    const r = corrida('--local', '--datos', archivoLocal(d), '--salida', s.dir);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/marcadores sin sustituir/);
    expect(corrida('--publicable', '--flujo', s.prod).status).toBe(0);
    expect(corrida('--publicable', '--flujo', s.prueba).status).toBe(0);
    expect(readFileSync(s.prueba, 'utf8')).not.toContain('receptor-clientes');
    expect(C.hallazgosDelReceptor(JSON.parse(readFileSync(s.prod, 'utf8')), C.cargarDatosLocal(archivoLocal(d)))).toEqual([]);
    expect(C.guardias('produccion', JSON.parse(readFileSync(s.prod, 'utf8')))).toEqual([]);
    expect(r.stdout + r.stderr).not.toContain('receptor-clientes'); // la consola no repite la URL
    for (const v of VERSIONADOS) expect(readFileSync(v, 'utf8')).not.toContain('receptor-clientes'); // los versionados conservan el marcador
  });
  it('`--publicable --flujo <json>` corre también las guardias de lo armado: un JSON local editado a mano (otra URL del verificador, `onError`, `wabaIdEsperado` como expresión) sale 1', () => {
    const s = salidaTemporal();
    const d = completo();
    (d['receptor'] as J)['urlVerificador'] = C.URL_VERIFICADOR_INTERNO;
    const datos = archivoLocal(d);
    expect(corrida('--local', '--datos', datos, '--salida', s.dir).status).toBe(0);
    const bien = corrida('--publicable', '--flujo', s.prod, '--datos', datos);
    expect(bien.status, bien.stderr).toBe(0);
    const original = JSON.parse(readFileSync(s.prod, 'utf8')) as J;
    const editar = (cambio: (v: J) => void, nombre: string): string => {
      const f = JSON.parse(JSON.stringify(original)) as J;
      cambio((f['nodes'] as J[]).find((n) => n['name'] === 'Verificar firma con el receptor')!);
      const ruta = join(carpetaTemporal('cb-editado-'), nombre);
      carpetas.push(dirname(ruta));
      writeFileSync(ruta, JSON.stringify(f));
      return ruta;
    };
    const casos: [string, (v: J) => void, RegExp][] = [
      ['otra URL del verificador', (v) => { (v['parameters'] as J)['url'] = 'http://receptor-clientes:8081/v1/interno/otra'; }, /anfitrión no permitido/],
      ['onError', (v) => { v['onError'] = 'continueRegularOutput'; }, /Continue on Fail/],
      ['wabaIdEsperado como expresión', (v) => { const q = v['parameters'] as J; q['jsonBody'] = String(q['jsonBody']).replace(/wabaIdEsperado: "\d+"/, 'wabaIdEsperado: $json.x'); }, /wabaIdEsperado.*FIJO/],
    ];
    for (const [que, cambio, patron] of casos) {
      const f = editar(cambio, 'editado.local.json');
      for (const extra of [[], ['--datos', datos]]) {
        const r = corrida('--publicable', '--flujo', f, ...extra);
        expect(r.status, `${que} ${extra.length ? 'con datos' : 'sin datos'}`).toBe(1);
        expect(r.stderr, que).toMatch(patron);
      }
    }
    // Con los datos locales, la entrada del receptor además se compara con su origen: un nodo cambiado de más también sale 1.
    const distinto = editar((v) => { v['notes'] = 'cambiado a mano'; }, 'distinto.local.json');
    const r = corrida('--publicable', '--flujo', distinto, '--datos', datos);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/difiere de su origen/);
  });
  it('la guardia de lo armado: otra URL en el nodo del verificador, o la constante en «Config base» o en cualquier otro nodo, se rechazan', () => {
    const s = salidaTemporal();
    const d = completo();
    (d['receptor'] as J)['urlVerificador'] = C.URL_VERIFICADOR_INTERNO;
    expect(corrida('--local', '--datos', archivoLocal(d), '--salida', s.dir).status).toBe(0);
    const flujo = (): J => JSON.parse(readFileSync(s.prod, 'utf8')) as J;
    const nodo = (f: J, nombre: string): J => (f['nodes'] as J[]).find((n) => n['name'] === nombre)!;
    for (const mala of ['https://receptor-clientes:8081/v1/interno/verificar', 'http://receptor-clientes:8082/v1/interno/verificar', 'http://receptor-clientes:8081/v1/interno/verificar?x=1', 'http://Receptor-Clientes:8081/v1/interno/verificar', 'http://otro:8081/v1/interno/verificar']) {
      const f = flujo(); ((nodo(f, 'Verificar firma con el receptor')['parameters']) as J)['url'] = mala;
      expect(C.guardias('produccion', f).join(' | '), mala).toMatch(/Verificar firma con el receptor.*(anfitrión no permitido)/);
    }
    for (const otro of ['Config base', 'Traer catálogo', 'Enviar a WhatsApp']) {
      const f = flujo(); const n = nodo(f, otro);
      n['notes'] = 'verificador: ' + C.URL_VERIFICADOR_INTERNO;
      expect(C.guardias('produccion', f).join(' | '), otro).toMatch(new RegExp(`«${otro}» menciona el verificador interno`));
      const g = flujo(); (nodo(g, otro)['parameters'] as J)['dato_ajeno'] = C.URL_VERIFICADOR_INTERNO;
      expect(C.guardias('produccion', g).join(' | '), otro).toMatch(new RegExp(`«${otro}» menciona el verificador interno`));
    }
    const sinFijo = flujo(); const cuerpo = (nodo(sinFijo, 'Verificar firma con el receptor')['parameters'] as J); cuerpo['jsonBody'] = String(cuerpo['jsonBody']).replace(/wabaIdEsperado: "\d+"/, 'wabaIdEsperado: $json.x');
    expect(C.guardias('produccion', sinFijo).join(' | ')).toMatch(/wabaIdEsperado.*FIJO/);
    const cof = flujo(); nodo(cof, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput';
    expect(C.guardias('produccion', cof).join(' | ')).toMatch(/Continue on Fail/);
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
});

describe('línea de comandos', () => {
  it('`--local` sin `--datos`, con argumentos de más o con una opción sin valor sale 2; un dato inválido sale 1 y sin imprimir valores', () => {
    expect(corrida('--local').status).toBe(2);
    expect(corrida('--local', '--datos').status).toBe(2);
    expect(corrida('--local', '--datos', archivoLocal(base()), '--otro').status).toBe(2);
    expect(corrida('--local', '--datos', '--verificar').status).toBe(2);
    expect(corrida('--local', '--datos', archivoLocal(base()), '--salida').status).toBe(2);
    const d = base(); (d['receptor'] as J)['wabaIdEsperado'] = 'valor-malo-12345';
    const r = corrida('--local', '--datos', archivoLocal(d), '--salida', salidaTemporal().dir);
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).not.toContain('valor-malo-12345');
  });
});
