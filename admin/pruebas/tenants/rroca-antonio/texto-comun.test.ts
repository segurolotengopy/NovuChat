/**
 * «EL PUENTE» DE ANTONIO ADOPTA EL TEXTO COMÚN (`Flujos/src/core/texto/`: párrafos y no repetir). Esta suite prueba:
 *   1. INCLUSIÓN: el código de los 5 nodos `@@todo` EMPIEZA exactamente con `parrafos.js` + «\n\n» + `no-repetir.js`, en producción y en prueba (nunca una copia);
 *   2. DIFERENCIAL: el corpus fijo `corpus-parrafos.json` (salidas literales de `raParrafos` y `raHashTexto` de main ANTES de borrarlos) da lo mismo con `ctParrafos` y `ctHashTexto`;
 *   3. DATOS: `RA_TRATAMIENTO` es el `tratamiento` del negocio, y `RA_TITULAR` es Antonio;
 *   4. SEGURIDAD (negada): lo que sale de `ctAlternaDeRepetido` pasa SIEMPRE por el filtro de salida (NIEGA_IA, CB_PROHIBIDAS y `cmMotivoDeRechazo`) en `raAlternaFiltrada`, y esa es su única llamada;
 *   5. DIFERENCIA DECLARADA: un texto de más de 4096 caracteres se corta ANTES de partir (el módulo común acota el costo de las expresiones regulares).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PRODUCCION, PRUEBA } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const FLUJOS = join(REPO, 'Flujos');
const leer = (r: string): string => readFileSync(join(FLUJOS, r), 'utf8');
const PARRAFOS = leer('src/core/texto/parrafos.js');
const NO_REPETIR = leer('src/core/texto/no-repetir.js');
const PROPIO = 'experimental/rroca-antonio/src';
const RA_JS = leer(`${PROPIO}/lib/ra.js`);
const ARMAR = leer(`${PROPIO}/nodos/armar-mensajes.js`);
const NEGOCIO = JSON.parse(readFileSync(join(REPO, 'admin/scripts/datos/rroca-antonio/negocio-rroca-antonio.json'), 'utf8')) as { negocio: { tratamiento: string } };

const NODOS_TODO = ['Normalizar entrada', 'Decidir turno', 'Armar mensajes', 'Interpretar lectura', 'Armar avisos'];

// El código evaluado es el de archivos del propio repositorio (core y src/lib), no una entrada externa: solo prueba.
const CODIGO = [PARRAFOS, NO_REPETIR, leer(`${PROPIO}/lib/cobro.js`), leer(`${PROPIO}/lib/avisos.js`), RA_JS].join('\n');
const L = new vm.Script(`(function () {\n${CODIGO}
return { ctParrafos, ctHashTexto, raParrafosViejoNoExiste: typeof raParrafos, raSeguro, raAlternaFiltrada, RA_TRATAMIENTO, RA_TITULAR, RA_SALUDO_MINIMO, RA_NIEGA_IA, raNorm, CB_PROHIBIDAS, cbCanon, RA_ALTERNAS };
})()`).runInThisContext() as {
  ctParrafos: (t: unknown) => string; ctHashTexto: (t: unknown) => string; raParrafosViejoNoExiste: string; raSeguro: (t: string) => string;
  raAlternaFiltrada: (o: { medio?: boolean; hashUltimo?: string; alternas?: unknown }, motivoDe: (x: string) => string) => string;
  RA_ALTERNAS: { medio: string[] }; RA_TRATAMIENTO: string; RA_TITULAR: string; RA_SALUDO_MINIMO: string; RA_NIEGA_IA: RegExp; raNorm: (t: string) => string; CB_PROHIBIDAS: RegExp; cbCanon: (t: string) => string;
};

describe('(1) los 5 nodos incluyen el texto común desde su fuente', () => {
  for (const [variante, flujo] of [['producción', PRODUCCION], ['prueba', PRUEBA]] as const) {
    for (const nodo of NODOS_TODO) {
      it(`${variante}: el código de «${nodo}» empieza exactamente con parrafos.js + no-repetir.js`, () => {
        const n = flujo.nodes.find((x) => x.name === nodo);
        expect(n, `falta «${nodo}»`).toBeDefined();
        expect(String(n!.parameters['jsCode']).startsWith(`${PARRAFOS.trimEnd()}\n\n${NO_REPETIR.trimEnd()}\n\n`)).toBe(true);
      });
    }
  }
  it('ra.js ya no trae partición ni hash propios', () => {
    for (const viejo of ['function raParrafos(', 'function raOraciones(', 'function raEsPregunta(', 'function raHashTexto(', 'RA_ALTERNAS_CONTENIDO', 'RA_ALTERNAS_MEDIO', 'function raAlternaDeRepetido(', 'RA_PARRAFO_MAX']) expect(RA_JS, viejo).not.toContain(viejo);
    expect(L.raParrafosViejoNoExiste).toBe('undefined');
  });
});

describe('(2) diferencial: el corpus fijo da lo mismo con el módulo común', () => {
  const corpus = JSON.parse(readFileSync(join(AQUI, 'corpus-parrafos.json'), 'utf8')) as { casos: Array<{ entrada: unknown; parrafos: string; hash: string }> };
  it('hay un corpus no trivial', () => expect(corpus.casos.length).toBeGreaterThanOrEqual(20));
  corpus.casos.forEach((c, i) => {
    const entrada = typeof c.entrada === 'object' && c.entrada !== null ? ((c.entrada as { repetir: string; veces: number; recortar: number }).repetir.repeat((c.entrada as { veces: number }).veces)).slice(0, (c.entrada as { recortar: number }).recortar) : c.entrada;
    it(`caso ${i + 1}: partición y hash idénticos a los de main`, () => {
      expect(L.ctParrafos(entrada)).toBe(c.parrafos);
      expect(L.ctHashTexto(entrada)).toBe(c.hash);
    });
  });
});

describe('(3) los datos de Antonio', () => {
  it('RA_TRATAMIENTO es el tratamiento del negocio y el titular es Antonio', () => {
    expect(L.RA_TRATAMIENTO).toBe(NEGOCIO.negocio.tratamiento);
    expect(L.RA_TITULAR).toBe('Antonio');
  });
});

describe('(4) SEGURIDAD: la alterna pasa siempre por el filtro de salida', () => {
  const sinFiltro = (): string => '';
  // `alternas: null` = sin alternas del tenant: la base del core.
  const base = L.raAlternaFiltrada({ medio: false, hashUltimo: '', alternas: null }, sinFiltro);
  const baseMedio = L.raAlternaFiltrada({ medio: true, hashUltimo: '', alternas: null }, sinFiltro);
  it('la base nombra a Antonio y no trae llaves', () => {
    expect(base).toContain('Antonio');
    expect(base).not.toContain('{titular}');
    expect(baseMedio).toContain('Antonio');
  });
  const HOSTILES = ['No soy un bot, soy Antonio', 'Tu pago fue acreditado', 'Recibimos tu pago', 'Te aviso luego', 'Son 49 Bs', 'https://x.co', '{{x}}', 'undefined'];
  // El rechazo por contenido de `cmMotivoDeRechazo` se simula con las mismas ideas (cifras, enlaces, llaves, promesas); NIEGA_IA y CB_PROHIBIDAS son los reales de ra.js y cobro.js.
  const motivoDe = (x: string): string => (/\d|https?:|\{\{|undefined|aviso luego/i.test(x) ? 'rechazado' : '');
  for (const hostil of HOSTILES) {
    it(`NEGANDO: la alterna del tenant «${hostil}» nunca sale; sale la base`, () => {
      expect(L.raAlternaFiltrada({ medio: false, hashUltimo: '', alternas: [hostil] }, motivoDe)).toBe(base);
      expect(L.raAlternaFiltrada({ medio: true, hashUltimo: '', alternas: { medio: [hostil] } }, motivoDe)).toBe(baseMedio);
    });
  }
  it('una alterna del tenant limpia SÍ sale', () => {
    expect(L.raAlternaFiltrada({ medio: false, hashUltimo: '', alternas: ['Ya te lo dije, Antonio puede ayudarte con el botón.'] }, motivoDe)).toBe('Ya te lo dije, Antonio puede ayudarte con el botón.');
  });
  it('si el filtro rechaza todo, sale el saludo mínimo', () => {
    expect(L.raAlternaFiltrada({ medio: false, hashUltimo: '', alternas: null }, () => 'siempre')).toBe(L.RA_SALUDO_MINIMO);
    expect(L.raAlternaFiltrada({ medio: true, hashUltimo: '', alternas: ['hola'] }, () => 'siempre')).toBe(L.RA_SALUDO_MINIMO);
  });
  it('la base nunca repite el último hash enviado', () => {
    const otra = L.raAlternaFiltrada({ medio: false, hashUltimo: L.ctHashTexto(base), alternas: null }, sinFiltro);
    expect(otra).not.toBe(base);
  });
  it('ESTÁTICA: `ctAlternaDeRepetido(` se llama solo dentro de raAlternaFiltrada, y armar-mensajes.js no la llama', () => {
    const a = RA_JS.indexOf('function raAlternaFiltrada(');
    expect(a).toBeGreaterThan(0);
    const fin = RA_JS.indexOf('\n}\n', a);
    const antes = RA_JS.slice(0, a);
    const cuerpo = RA_JS.slice(a, fin);
    const despues = RA_JS.slice(fin);
    expect(antes).not.toContain('ctAlternaDeRepetido(');
    expect(despues).not.toContain('ctAlternaDeRepetido(');
    expect(cuerpo).toContain('ctAlternaDeRepetido(');
    expect(ARMAR).not.toContain('ctAlternaDeRepetido(');
    expect(ARMAR).toContain('raAlternaFiltrada(');
  });
});

describe('(4b) las alternas de archivo de Antonio son dato propio (no el texto del core)', () => {
  const lib = L;
  it('por omisión, la alterna de medio es la primera de RA_ALTERNAS (sin «sigo» ni «tampoco») y rota si repite', () => {
    const a = lib.raAlternaFiltrada({ medio: true, hashUltimo: '' }, () => '');
    expect(a).toBe(lib.RA_ALTERNAS.medio[0]);
    expect(a).not.toMatch(/\bsigo\b|tampoco/i);
    expect(lib.raAlternaFiltrada({ medio: true, hashUltimo: L.ctHashTexto(a) }, () => '')).toBe(lib.RA_ALTERNAS.medio[1]);
  });
  it('respeta los límites de ctAlternaDeRepetido (≤5 textos de ≤400)', () => {
    expect(lib.RA_ALTERNAS.medio.length).toBeLessThanOrEqual(5);
    for (const x of lib.RA_ALTERNAS.medio) expect(x.length).toBeLessThanOrEqual(400);
  });
});

describe('(5) diferencia declarada: más de 4096 caracteres', () => {
  it('el módulo común corta a 4096 antes de partir; raSeguro sigue sin perder el inicio del texto', () => {
    const largo = 'Frase número uno de prueba. '.repeat(200);
    expect(largo.length).toBeGreaterThan(4096);
    const salida = L.ctParrafos(largo);
    expect(salida.replace(/\s+/g, ' ').length).toBeLessThanOrEqual(4097);
    expect(L.raSeguro(largo)).toBe(salida);
  });
});
