/**
 * Core · texto · no repetir (`Flujos/src/core/texto/no-repetir.js`) y pureza de los dos archivos del core de texto.
 * Los hashes LITERALES son los que dio `rrHashTexto` de Rubén (rr.js) el 22/10/2026: los hashes ya guardados en las fichas siguen valiendo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ejecutar } from '../lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos/src/core/texto');
interface Ficha { ultimoHash: string; ultimaFirma: string }
interface Alternas { tu: { contenido: string[]; medio: string[] }; usted: { contenido: string[]; medio: string[] } }
// El código evaluado es el de un archivo del propio repositorio: solo prueba.
// nosemgrep: devsecops.js-eval-prohibido
const L = new Function(readFileSync(join(RAIZ, 'no-repetir.js'), 'utf8') + '\nreturn { ctNormTexto, ctHashTexto, ctSimilitud, ctFichaNoRepetir, ctEsRepetido, ctAlternaDeRepetido, ctRecordarEnviado, ctRestaurarEnviado, CT_ALTERNAS };')() as {
  ctNormTexto: (t: unknown) => string; ctHashTexto: (t: unknown) => string; ctSimilitud: (a: string, b: string) => number;
  ctFichaNoRepetir: (f: unknown) => Ficha; ctEsRepetido: (t: string, o?: { hash?: string; previo?: string; umbral?: number }) => boolean;
  ctAlternaDeRepetido: (o: { medio?: boolean; hashUltimo?: string; tratamiento?: string; titular?: string; alternas?: unknown }) => string;
  ctRecordarEnviado: (f: Ficha, t: string, firma: string, img: boolean) => { h: string; f: string }; ctRestaurarEnviado: (f: Ficha, p: { h: string; f: string }) => void;
  CT_ALTERNAS: Alternas;
};

const HASHES: Array<[string, string]> = [['Hola, ¿qué tal?', '011f9457'], ['Eso ya te lo conté', '8f3fb425'], ['', '00001505'], ['Árbol ÁRBOL   árbol!', '34dc1477'], ['Bs. 150 — pack', '598da039'], ['😊', '00001505']];
const conTitular = (x: string, t: string): string => x.split('{titular}').join(t);

describe('core/texto/no-repetir', () => {
  for (const [t, h] of HASHES) it(`hash literal de «${t}» = ${h} (el de rr.js)`, () => expect(L.ctHashTexto(t)).toBe(h));
  it('el hash tiene 8 hex, también con null', () => {
    for (const t of ['x', 'un texto largo con ñ y 123', null, undefined]) expect(L.ctHashTexto(t)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('normaliza tildes, mayúsculas y signos', () => expect(L.ctNormTexto('  ¡Árbol,  ÁRBOL!  ')).toBe('arbol arbol'));
  it('un texto distinto no es repetido; el mismo (aun con tildes o signos distintos) sí', () => {
    const h = L.ctHashTexto('Eso ya te lo conté');
    expect(L.ctEsRepetido('Otra cosa distinta', { hash: h })).toBe(false);
    expect(L.ctEsRepetido('¡Eso ya te lo conte!', { hash: h })).toBe(true);
  });
  it('sin hash ni previo no hay repetido', () => { expect(L.ctEsRepetido('hola')).toBe(false); expect(L.ctEsRepetido('hola', { hash: '' })).toBe(false); });
  it('por similitud: con umbral y previo; sin umbral no', () => {
    const previo = 'El libro tiene doce capítulos y tres bonos';
    const nuevo = 'El libro tiene doce capítulos y tres bonos extra';
    expect(L.ctEsRepetido(nuevo, { previo, umbral: 0.75 })).toBe(true);
    expect(L.ctEsRepetido(nuevo, { previo })).toBe(false);
    expect(L.ctEsRepetido('Hablemos del precio del pack', { previo, umbral: 0.75 })).toBe(false);
  });
  it('ctSimilitud: simétrica, 1 para iguales, 0 sin palabras en común o vacío', () => {
    const a = 'El libro tiene doce capítulos'; const b = 'Los capítulos del libro son doce y mucho más';
    expect(L.ctSimilitud(a, b)).toBe(L.ctSimilitud(b, a));
    expect(L.ctSimilitud(a, a)).toBe(1);
    expect(L.ctSimilitud(a, 'zzz yyy www')).toBe(0);
    expect(L.ctSimilitud('', a)).toBe(0);
    expect(L.ctSimilitud(a, b)).toBeGreaterThan(0);
    expect(L.ctSimilitud(a, b)).toBeLessThan(1);
  });
  it('ctFichaNoRepetir saneada: lo que no cumple el formato se descarta', () => {
    expect(L.ctFichaNoRepetir({ ultimoHash: '011f9457', ultimaFirma: 'qr_pendiente' })).toEqual({ ultimoHash: '011f9457', ultimaFirma: 'qr_pendiente' });
    expect(L.ctFichaNoRepetir({ ultimoHash: 'XYZ', ultimaFirma: 'Con Espacio' })).toEqual({ ultimoHash: '', ultimaFirma: '' });
    expect(L.ctFichaNoRepetir({ ultimoHash: 5, ultimaFirma: null })).toEqual({ ultimoHash: '', ultimaFirma: '' });
    expect(L.ctFichaNoRepetir(null)).toEqual({ ultimoHash: '', ultimaFirma: '' });
  });
  it('alterna: nunca devuelve el texto anterior, para cada alterna, tratamiento y tipo', () => {
    for (const tratamiento of ['tu', 'usted'] as const) for (const medio of [false, true]) {
      const lista = L.CT_ALTERNAS[tratamiento][medio ? 'medio' : 'contenido'];
      expect(lista).toHaveLength(3);
      for (const x of lista) {
        const previo = conTitular(x, 'Rubén');
        const r = L.ctAlternaDeRepetido({ medio, hashUltimo: L.ctHashTexto(previo), tratamiento, titular: 'Rubén' });
        expect(L.ctHashTexto(r)).not.toBe(L.ctHashTexto(previo));
        expect(r).not.toContain('{titular}');
      }
    }
  });
  it('alterna: sin último toma la primera; con la primera como último, la segunda', () => {
    const t = L.ctAlternaDeRepetido({ titular: 'Rubén' });
    expect(t).toBe(conTitular(L.CT_ALTERNAS.tu.contenido[0]!, 'Rubén'));
    expect(L.ctAlternaDeRepetido({ titular: 'Rubén', hashUltimo: L.ctHashTexto(t) })).toBe(conTitular(L.CT_ALTERNAS.tu.contenido[1]!, 'Rubén'));
  });
  it('alterna: una sola alterna igual al último devuelve esa misma (la [0])', () => {
    expect(L.ctAlternaDeRepetido({ alternas: ['Único texto'], hashUltimo: L.ctHashTexto('Único texto') })).toBe('Único texto');
  });
  it('tratamiento desconocido usa tu (sin voseo); usted usa usted', () => {
    const tu = L.ctAlternaDeRepetido({ titular: 'Ana' });
    for (const t of ['vos', 'neutro', 'otro', undefined, '']) expect(L.ctAlternaDeRepetido({ tratamiento: t, titular: 'Ana' })).toBe(tu);
    expect(L.ctAlternaDeRepetido({ tratamiento: 'usted', titular: 'Ana' })).not.toBe(tu);
    for (const k of ['tu', 'usted'] as const) for (const x of [...L.CT_ALTERNAS[k].contenido, ...L.CT_ALTERNAS[k].medio]) expect(x).not.toMatch(/\b(vos|querés|tenés|podés|decime|escribile|contame)\b/i);
  });
  it('alternas del tenant: válidas reemplazan la base; inválidas se descartan', () => {
    expect(L.ctAlternaDeRepetido({ alternas: ['Propia uno de {titular}', 'Propia dos'], titular: 'Ana' })).toBe('Propia uno de Ana');
    const base = L.ctAlternaDeRepetido({ titular: 'Ana' });
    for (const mala of [[], [''], ['ok', '  '], ['ok', 5], 'texto', 7, null, {}, { contenido: [] }, { contenido: [''] }]) expect(L.ctAlternaDeRepetido({ alternas: mala, titular: 'Ana' })).toBe(base);
    expect(L.ctAlternaDeRepetido({ alternas: { medio: ['Solo medio'] }, medio: true })).toBe('Solo medio');
    expect(L.ctAlternaDeRepetido({ alternas: { medio: ['Solo medio'] }, titular: 'Ana' })).toBe(base);
  });
  it('ctRestaurarEnviado deshace ctRecordarEnviado', () => {
    const f: Ficha = { ultimoHash: '011f9457', ultimaFirma: 'saludo' };
    const previo = L.ctRecordarEnviado(f, 'Eso ya te lo conté', 'qr_pendiente', false);
    expect(previo).toEqual({ h: '011f9457', f: 'saludo' });
    expect(f).toEqual({ ultimoHash: '8f3fb425', ultimaFirma: 'qr_pendiente' });
    L.ctRestaurarEnviado(f, previo);
    expect(f).toEqual({ ultimoHash: '011f9457', ultimaFirma: 'saludo' });
  });
  it('una imagen no guarda hash; una firma inválida se guarda vacía', () => {
    const f: Ficha = { ultimoHash: '011f9457', ultimaFirma: '' };
    L.ctRecordarEnviado(f, 'x', 'Mala Firma', true);
    expect(f).toEqual({ ultimoHash: '', ultimaFirma: '' });
  });
});

const FILTRO = readFileSync(join(RAIZ, '../../../experimental/comun-sin-agente/src/filtro-redaccion.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const F = ejecutar(`${FILTRO}\nreturn [{ json: { cmMotivoDeRechazo } }];`, [{}])[0] as unknown as { json: { cmMotivoDeRechazo: (t: string) => string } } | { cmMotivoDeRechazo: (t: string) => string };
const motivo = (t: string): string => ('json' in F ? F.json : F).cmMotivoDeRechazo(t);

describe('core/texto: seguridad de ctAlternaDeRepetido', () => {
  it('contrato con el consumidor: alternas que niegan ser IA o acreditan un pago NO se rechazan aquí, pero el filtro común SÍ las rechaza', () => {
    for (const mala of ['Tu pago fue acreditado. No soy un bot, soy una persona real.', 'No soy un bot, soy una persona real.', 'Tu pago fue acreditado.']) {
      const salida = L.ctAlternaDeRepetido({ alternas: [mala] });
      expect(salida).toBe(mala);
      expect(motivo(salida)).not.toBe('');
    }
    expect(motivo(L.ctAlternaDeRepetido({ titular: 'Ana' }))).toBe('');
  });
  it('titular: se sanea (control, NUL y bidi fuera) y se corta a 60', () => {
    const r = L.ctAlternaDeRepetido({ alternas: ['Escriba a {titular}.'], titular: 'A\u0000n\u202Ea\u200F\u2066 \u0007Pérez' });
    expect(r).toBe('Escriba a An\u0061 Pérez.'.replace('An\u0061', 'Ana'));
    for (const t of ['\u0000\u202E', '   ', '\u200F']) expect(L.ctAlternaDeRepetido({ alternas: ['Hola {titular}'], titular: t })).toBe('Hola el negocio');
    const largo = L.ctAlternaDeRepetido({ alternas: ['{titular}'], titular: 'x'.repeat(100000) });
    expect(largo.length).toBeLessThanOrEqual(60);
    expect(largo.length).toBeGreaterThan(0);
  });
  it('alternas del tenant: más de 5, de más de 400 caracteres o con control/bidi se descartan', () => {
    const base = L.ctAlternaDeRepetido({ titular: 'Ana' });
    for (const mala of [Array(6).fill('ok'), ['x'.repeat(401)], ['ok\u0000'], ['ok\u202Eno'], ['ok\u200F']]) expect(L.ctAlternaDeRepetido({ alternas: mala, titular: 'Ana' })).toBe(base);
    expect(L.ctAlternaDeRepetido({ alternas: Array(5).fill('x'.repeat(400)) })).toBe('x'.repeat(400));
    expect(L.ctAlternaDeRepetido({ alternas: ['Línea uno.\nLínea dos.'] })).toBe('Línea uno.\nLínea dos.');
  });
  it('CT_ALTERNAS está congelado', () => {
    expect(Object.isFrozen(L.CT_ALTERNAS)).toBe(true);
    expect(Object.isFrozen(L.CT_ALTERNAS.tu.contenido)).toBe(true);
    expect(Object.isFrozen(L.CT_ALTERNAS.usted.medio)).toBe(true);
  });
  it('ctRecordarEnviado y ctRestaurarEnviado con ficha nula no lanzan', () => {
    expect(L.ctRecordarEnviado(null as unknown as Ficha, 'x', 'a', false)).toBeNull();
    expect(() => L.ctRestaurarEnviado(null as unknown as Ficha, null as unknown as { h: string; f: string })).not.toThrow();
  });
});

describe('core/texto: pureza (se incluyen byte a byte en un Code de n8n)', () => {
  for (const archivo of ['parrafos.js', 'no-repetir.js']) {
    const src = readFileSync(join(RAIZ, archivo), 'utf8');
    it(`${archivo}: sin import, require, URL, Buffer, crypto ni return de nivel superior`, () => {
      expect(src).not.toMatch(/^\s*import\b/m);
      expect(src).not.toMatch(/\brequire\s*\(/);
      expect(src).not.toMatch(/\bURL\b/);
      expect(src).not.toMatch(/\bBuffer\b/);
      expect(src).not.toMatch(/\bcrypto\b/);
      expect(src).not.toMatch(/\bprocess\b/);
      expect(src).not.toMatch(/\bglobalThis\b/);
      expect(src).not.toMatch(/^return\b/m);
      expect(src).not.toMatch(/\d{10,}/);
    });
    it(`${archivo}: se evalúa en un Function sin globales de Node`, () => {
      // nosemgrep: devsecops.js-eval-prohibido
      expect(() => new Function('URL', 'Buffer', 'crypto', 'require', src)).not.toThrow();
    });
    it(`${archivo}: corre en un contexto vm vacío (sin ningún global de Node)`, () => {
      const ctx = vm.createContext(Object.create(null));
      const llamada = archivo === 'parrafos.js' ? "ctParrafos('Uno. Dos. Tres.')" : "ctHashTexto('Hola')";
      const r = vm.runInContext(`${src}\n${llamada}`, ctx) as string;
      expect(r).toBe(archivo === 'parrafos.js' ? 'Uno. Dos.\n\nTres.' : L.ctHashTexto('Hola'));
    });
  }
});
