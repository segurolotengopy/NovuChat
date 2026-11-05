/**
 * Core · texto · tipeo (`Flujos/src/core/texto/tipeo.js`). Banco: 22/10/2026 (9 de 17 frases con error de tipeo caían al modelo).
 * Las claves de prueba imitan las del chat; el core no trae las de ningún cliente.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from './fuente-vm';

const ARCHIVO = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos/src/core/texto/tipeo.js');
const SRC = readFileSync(ARCHIVO, 'utf8');
type Clave = string | { c: string; plural?: boolean };
const T = cargarFuente<{
  ctUnaEdicion: (a: string, b: string) => boolean; ctColapsar: (w: string) => string;
  ctCorregirPalabra: (w: string, c: Clave[]) => string; ctTipeo: (t: unknown, c: Clave[]) => string; CT_TIPEO_PROTEGIDAS: string[];
}>(['Flujos/src/core/texto/tipeo.js'], ['ctUnaEdicion', 'ctColapsar', 'ctCorregirPalabra', 'ctTipeo', 'CT_TIPEO_PROTEGIDAS']);

const CLAVES: Clave[] = [{ c: 'telefono', plural: true }, 'actual', 'numero', 'celular', 'whatsapp', 'coexisten', 'coexiste', 'coexistir', 'convivir', 'cobra', 'cobran', 'meta', 'mensajes', 'mensaje', 'conversaciones', 'conversacion', 'domingos', 'sabados', 'conecta', 'conectan', 'integra', 'descuentos', 'descuento', 'rebaja', 'rebajas'];

describe('core/texto/tipeo: ctUnaEdicion y ctColapsar', () => {
  it('una letra de más, de menos, cambiada o dos intercambiadas', () => {
    expect(T.ctUnaEdicion('cobar', 'cobra')).toBe(true);
    expect(T.ctUnaEdicion('mensajs', 'mensajes')).toBe(true);
    expect(T.ctUnaEdicion('descuentoss', 'descuentos')).toBe(true);
    expect(T.ctUnaEdicion('conversasion', 'conversacion')).toBe(true);
    expect(T.ctUnaEdicion('cobra', 'cobra')).toBe(true);
  });
  it('dos ediciones no; ni la s final se quita sola', () => {
    expect(T.ctUnaEdicion('conseta', 'conecta')).toBe(false);
    expect(T.ctUnaEdicion('abcd', 'badc')).toBe(false);
    expect(T.ctUnaEdicion('actuars', 'actual')).toBe(false);
    expect(T.ctUnaEdicion('celulas', 'celular')).toBe(true); // una letra cambiada: por eso «celulas» está protegida
  });
  it('ctColapsar junta repetidas', () => { expect(T.ctColapsar('metta')).toBe('meta'); expect(T.ctColapsar('aaabbb')).toBe('ab'); expect(T.ctColapsar('')).toBe(''); });
});

describe('core/texto/tipeo: las 9 frases del banco se corrigen a su clave', () => {
  const CASOS: Array<[string, string]> = [
    ['¿Meta cobar por los mensajes?', '¿Meta cobra por los mensajes?'],
    ['¿Metta cobra por los mensajes?', '¿meta cobra por los mensajes?'],
    ['¿Cuantos mensajs incluye el plan?', '¿Cuantos mensajes incluye el plan?'],
    ['¿Cuantas conversasiones incluye?', '¿Cuantas conversaciones incluye?'],
    ['¿Atiende los domigos?', '¿Atiende los domingos?'],
    ['Dame un descuneto', 'Dame un descuento'],
    ['¿Hay descuentoss?', '¿Hay descuentos?'],
    ['¿Me haces rebja?', '¿Me haces rebaja?'],
    ['Puedo usar mi numero acrual?', 'Puedo usar mi numero actual?'],
  ];
  for (const [e, s] of CASOS) it(`«${e}»`, () => expect(T.ctTipeo(e, CLAVES)).toBe(s));
  it('plural de una clave marcada: «los telefonos» pasa a la clave y «telefonoss» pasa a la clave', () => {
    expect(T.ctTipeo('coexisten los telefonos', CLAVES)).toBe('coexisten los telefono'); // la clave plural acepta la palabra sin su s final: queda la clave
    expect(T.ctTipeo('los telefonoss', CLAVES)).toBe('los telefono');
  });
  it('conserva la forma exacta de lo que no se corrige (mayúsculas, tildes, puntuación y «?»)', () => {
    const t = '¡Hola! ¿Cuántas conversaciones incluye?  Gracias...';
    expect(T.ctTipeo(t, CLAVES)).toBe(t);
  });
  it('puntuación y «?» intactos al corregir', () => {
    const r = T.ctTipeo('¿Se conecta, el  domigos; ok?', CLAVES);
    expect(r).toBe('¿Se conecta, el  domingos; ok?');
    expect(r.match(/[?¿]/g)).toHaveLength(2);
  });
});

describe('core/texto/tipeo: lo que NO cambia (negativos)', () => {
  const IGUAL = ['actuar', 'celulas', 'metas', 'metal', 'sobra', 'cobre', 'integral', 'contesta', 'comenta', 'panes', 'consulta', 'celula', 'metro', 'dar mi telefono', 'mi teléfono es 7 123 456', 'mi telefono es 71234567', '¿A que hora atienden?', 'actuar rapido', 'las celulas del libro'];
  for (const t of IGUAL) it(`«${t}»`, () => expect(T.ctTipeo(t, CLAVES)).toBe(t));
  it('«conseta» NO se corrige (dos ediciones de «conecta»; decisión D1 pendiente)', () => expect(T.ctTipeo('¿Se conseta con mi ERP?', CLAVES)).toBe('¿Se conseta con mi ERP?'));
  it('palabras de menos de 4 letras y claves exactas no se tocan', () => {
    expect(T.ctCorregirPalabra('mta', CLAVES)).toBe('mta');
    expect(T.ctCorregirPalabra('cobra', CLAVES)).toBe('cobra');
    expect(T.ctCorregirPalabra('cobran', CLAVES)).toBe('cobran');
    expect(T.ctCorregirPalabra('meta', CLAVES)).toBe('meta');
  });
  it('una clave corta (menos de 5) acepta SOLO letra repetida', () => {
    expect(T.ctCorregirPalabra('metta', CLAVES)).toBe('meta');
    expect(T.ctCorregirPalabra('mesa', CLAVES)).toBe('mesa');
    expect(T.ctCorregirPalabra('mela', CLAVES)).toBe('mela');
  });
  it('lista de protegidas y claves inválidas', () => {
    expect(T.CT_TIPEO_PROTEGIDAS).toEqual(expect.arrayContaining(['actuar', 'celulas', 'metal']));
    expect(T.ctTipeo('cobar', [])).toBe('cobar');
    expect(T.ctTipeo('cobar', undefined as unknown as Clave[])).toBe('cobar');
    expect(T.ctTipeo(undefined, CLAVES)).toBe('');
    expect(T.ctTipeo(null, CLAVES)).toBe('');
  });
  it('palabras que cambian el sentido quedan intactas (informe de seguridad)', () => {
    for (const w of ['obra', 'corra', 'nobra', 'cabra', 'cebra', 'copra', 'actúa', 'actúas', 'actúan', 'colecta', 'menaje', 'numera', 'nuero', 'convivio', 'cellar', 'cedular', 'nunca', 'jamás', 'tampoco', 'nada', 'ningún', 'ninguna', 'cobrar', 'cobro']) expect(T.ctTipeo(w, CLAVES)).toBe(w);
    expect(T.ctTipeo('no quiero descuento', CLAVES)).toBe('no quiero descuento');
  });
  it('clave exacta (cobro o cancelación): sin tolerancia; con tolerancia sí corrige', () => {
    expect(T.ctTipeo('canela', [{ c: 'cancela', exacta: true }])).toBe('canela');
    expect(T.ctTipeo('cancelaa', [{ c: 'cancela', exacta: true }])).toBe('cancelaa');
    expect(T.ctTipeo('cancelaa', ['cancela'])).toBe('cancela');
  });
  it('la primera letra de una clave de 5 o más debe coincidir', () => {
    expect(T.ctTipeo('nobra', CLAVES)).toBe('nobra');
    expect(T.ctTipeo('ebaja', CLAVES)).toBe('ebaja');
  });
  it('protegidas por parámetro de cada flujo', () => {
    expect(T.ctTipeo('cobar', CLAVES, ['cobar'])).toBe('cobar');
    expect(T.ctTipeo('cobar', CLAVES, [])).toBe('cobra');
  });
  it('nunca se corrige una palabra con dígitos', () => {
    for (const w of ['5cobra', 'telefono2', 'cobr4', 'numer0', '71234567', 'bs50', 'A1B2', 'PED-00123', 'mi teléfono es 7 1234 567']) expect(T.ctTipeo(w, CLAVES)).toBe(w);
  });
  it('NFKC solo en la palabra buscada: el resto queda byte a byte', () => {
    for (const t of ['½ taza', 'm² útiles', '\uFF1F qué', 'x\u00A0y']) expect(T.ctTipeo(t, CLAVES)).toBe(t);
    expect(T.ctTipeo('\uFF43\uFF4F\uFF42\uFF41\uFF52 ½', CLAVES)).toBe('cobra ½');
  });
  it('un toString hostil no lanza', () => {
    const hostil = { toString() { throw new Error('x'); } };
    expect(T.ctTipeo(hostil, CLAVES)).toBe('');
    expect(T.ctTipeo(12345, CLAVES)).toBe('');
  });
  it('homoglifos y zero-width no producen correcciones', () => {
    for (const t of ['cоbar', 'cobаr', 'mensаjes', 'co​bar', 'cob‍ar']) expect(T.ctTipeo(t, CLAVES)).toBe(t);
  });
});

describe('core/texto/tipeo: idempotencia, límites y pureza', () => {
  it('idempotente', () => {
    for (const t of ['¿Meta cobar por mensajs?', 'descuentoss y rebja', 'actuar celulas conseta', 'Metta cobra']) {
      const una = T.ctTipeo(t, CLAVES);
      expect(T.ctTipeo(una, CLAVES)).toBe(una);
    }
  });
  it('recorta a 4096 caracteres; entrada de 100.000 en menos de 250 ms (mediana)', () => {
    const largo = 'cobar '.repeat(20000);
    const tiempos: number[] = [];
    let r = '';
    for (let i = 0; i < 5; i++) { const t0 = performance.now(); r = T.ctTipeo(largo, CLAVES); tiempos.push(performance.now() - t0); }
    const ms = tiempos.sort((x, y) => x - y)[2]; // mediana de 5
    expect(r.length).toBeLessThanOrEqual(4096 + 1); // se recorta la ENTRADA; una corrección puede alargar la última palabra
    expect(r.startsWith('cobra cobra')).toBe(true);
    expect(ms).toBeLessThan(250);
    expect(T.ctTipeo('x'.repeat(5000), CLAVES).length).toBe(4096);
  });
  it('sin import, require, URL, Buffer, crypto, process, globalThis ni return de nivel superior', () => {
    expect(SRC).not.toMatch(/^\s*import\b/m);
    expect(SRC).not.toMatch(/\brequire\s*\(/);
    for (const g of ['URL', 'Buffer', 'crypto', 'process', 'globalThis']) expect(SRC).not.toMatch(new RegExp(`\\b${g}\\b`));
    expect(SRC).not.toMatch(/^return\b/m);
    expect(SRC).not.toMatch(/\d{10,}/);
    expect(() => vm.compileFunction(SRC, ['URL', 'Buffer', 'crypto', 'require'])).not.toThrow();
  });
  it('corre en un contexto vm vacío', () => {
    const ctx = vm.createContext(Object.create(null));
    expect(vm.runInContext(`${SRC}\nctTipeo('Metta cobar', ['meta', 'cobra'])`, ctx)).toBe('meta cobra');
  });
  it('no contiene claves ni texto de ningún cliente', () => {
    expect(SRC).not.toMatch(/bellido|qtaco|q'taco|novuchat|rub[eé]n/i);
  });
});
