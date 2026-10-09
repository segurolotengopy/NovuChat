/**
 * CONVERSACIONES (H1-1): LA NORMALIZACIÓN DE CORE.
 *
 * Una sola regla para quien escribe `telefonoTrozos[]` y `palabras[]` (la
 * ingesta, el relleno) y para quien busca (la callable, la consola). Lo que se
 * defiende acá, negando:
 *
 *  1. Un teléfono se halla por los últimos 4, sin prefijo o completo; con 3
 *     dígitos no se indexa nada, y escrito con `+`, espacios o guiones es el
 *     mismo número.
 *  2. Una palabra se halla con o sin tildes, en singular o plural; lo que no es
 *     texto no rompe nada, y el tope de 30 palabras se cumple.
 *  3. Sin palabras buscadas no coincide «todo»: no coincide nada.
 *  4. `prefijosValidos` descarta lo que no es una lista de 1 a 10 prefijos de
 *     1 a 4 dígitos.
 *  5. El archivo NO importa nada y Node lo carga sin empaquetador: los scripts
 *     `.mjs` de relleno dependen de eso.
 *
 * Son puras: sin emulador y sin red.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_PALABRAS_CONSULTA, MAX_PALABRAS_POR_MENSAJE, MAX_RESULTADOS_BUSQUEDA, MINIMO_DIGITOS, POR_VENCER_HORAS,
  PREFIJOS_PAIS_DEFECTO, VENTANA_HORAS, fragmento, mensajeContiene, normalizarTexto, palabraParaIndice, palabrasDe,
  prefijosValidos, raizDe, soloDigitos, trozosDeTelefono,
} from '../../functions/src/core/conversacion/normalizacion';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(AQUI, '..', '..', 'functions', 'src', 'core', 'conversacion', 'normalizacion.ts');

describe('constantes de producto', () => {
  it('valen lo que el plan fija', () => {
    expect(VENTANA_HORAS).toBe(24);
    expect(POR_VENCER_HORAS).toBe(6);
    expect(MINIMO_DIGITOS).toBe(4);
    expect(MAX_PALABRAS_POR_MENSAJE).toBe(30);
    expect(MAX_PALABRAS_CONSULTA).toBe(6);
    expect(MAX_RESULTADOS_BUSQUEDA).toBe(20);
    expect(PREFIJOS_PAIS_DEFECTO).toEqual(['591']);
  });
});

describe('normalización: una sola regla para la pantalla, la ingesta y la búsqueda', () => {
  it('quita tildes y eñes y pasa a minúsculas', () => {
    expect(normalizarTexto('Salteñas CÓMO')).toBe('saltenas como');
    expect(normalizarTexto('ÁÉÍÓÚ Ñandú')).toBe('aeiou nandu');
  });

  it('NEGATIVA: lo que no es texto no rompe nada y da vacío', () => {
    for (const x of [undefined, null, 42, true, {}, [], ['a'], () => 'a']) {
      expect(normalizarTexto(x)).toBe('');
      expect(soloDigitos(x)).toBe('');
      expect(palabrasDe(x)).toEqual([]);
      expect(trozosDeTelefono(x)).toEqual([]);
    }
  });

  it('soloDigitos deja solo cifras', () => {
    expect(soloDigitos('+591 (000) 000-47')).toBe('59100000047');
    expect(soloDigitos('abc')).toBe('');
  });

  it('la raíz quita el plural: «alfajor» y «alfajores» son la misma palabra', () => {
    expect(raizDe('alfajores')).toBe(raizDe('alfajor'));
    expect(raizDe('tortas')).toBe('torta');
    expect(raizDe('mas')).toBe('mas');           // no se come las palabras cortas
    expect(raizDe('tres')).toBe('tre');          // límite conocido: no es un lematizador
  });

  it('plural -es: solo con más de 5 letras; con menos, se quita solo la «s»', () => {
    expect(raizDe('papeles')).toBe('papel');     // 7 letras: quita «es»
    expect(raizDe('lunes')).toBe('lune');        // 5 letras: NO quita «es», quita «s»
    expect(raizDe('mes')).toBe('mes');           // 3 letras: queda igual
    expect(raizDe('cafes')).toBe('cafe');
    expect(raizDe('doses')).toBe('dose');        // 5 letras
    expect(raizDe('mujeres')).toBe('mujer');     // 7 letras
    expect(raizDe('sabes')).toBe('sabe');
  });

  it('palabrasDe: normaliza, descarta lo de menos de 3 letras, no repite y respeta el tope de 30', () => {
    expect(palabrasDe('¡Hola! Quiero DOS salteñas y una torta de chocolate')).toEqual(
      ['hola', 'quiero', 'dos', 'saltena', 'una', 'torta', 'chocolate']);
    expect(palabrasDe('torta Torta TORTAS')).toEqual(['torta']);
    expect(palabrasDe('a el de un')).toEqual([]);
    const largo = Array.from({ length: 80 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    expect(palabrasDe(largo).length).toBe(30);
    expect(palabrasDe(largo, 5).length).toBe(5);
    expect(palabrasDe(undefined)).toEqual([]);
  });

  it('tope de 30: con 31 palabras distintas queda la trigésima y no la 31', () => {
    const treinta = Array.from({ length: 31 }, (_, i) => `voz${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`);
    const r = palabrasDe(treinta.join(' '));
    expect(r.length).toBe(MAX_PALABRAS_POR_MENSAJE);
    expect(r[29]).toBe(treinta[29]);
    expect(r).not.toContain(treinta[30]);
  });

  it('trozosDeTelefono: todos los finales de 4 dígitos o más (para array-contains)', () => {
    const t = trozosDeTelefono('59100000047');
    expect(t).toContain('59100000047');
    expect(t).toContain('00000047');   // sin el prefijo del país
    expect(t).toContain('0047');       // últimos 4
    expect(t).not.toContain('047');    // menos de 4: no se indexa
    expect(t.length).toBe(8);
    expect(trozosDeTelefono('+591 000-00047')).toEqual(t);
    expect(trozosDeTelefono('123')).toEqual([]);
  });

  it('un teléfono de 3 dígitos no produce trozos; de exactamente 4, uno solo', () => {
    expect(trozosDeTelefono('591')).toEqual([]);
    expect(trozosDeTelefono('5 9 1')).toEqual([]);
    expect(trozosDeTelefono('0047')).toEqual(['0047']);
  });

  it('`+591 000-00047` es igual que `59100000047`', () => {
    expect(trozosDeTelefono('+591 000-00047')).toEqual(trozosDeTelefono('59100000047'));
    expect(soloDigitos('+591 000-00047')).toBe(soloDigitos('59100000047'));
  });
});

describe('hallar una palabra y llegar al mensaje', () => {
  it('«alfajor» halla «alfajores» (plural) y «saltenas» halla «Salteñas» (tildes)', () => {
    expect(mensajeContiene(palabrasDe('Tienen alfajores de maicena'), '', palabrasDe('alfajor'))).toBe(true);
    expect(mensajeContiene(undefined, 'Dos docenas de Salteñas', palabrasDe('saltenas'))).toBe(true);
  });

  it('con varias palabras, el mensaje tiene que tenerlas TODAS; el índice pregunta por la más larga', () => {
    const buscadas = palabrasDe('alfajores maicena');
    expect(mensajeContiene(palabrasDe('alfajores de maicena'), '', buscadas)).toBe(true);
    expect(mensajeContiene(palabrasDe('alfajores de dulce'), '', buscadas)).toBe(false);
    expect(palabraParaIndice(['uno', 'cumpleano', 'dulce'])).toBe('cumpleano');
    expect(palabraParaIndice(buscadas)).toBe('alfajor');   // a igual largo, la primera
    expect(palabraParaIndice([])).toBeNull();
  });

  it('NEGATIVA: sin palabras buscadas no coincide nada (no «todo»)', () => {
    expect(mensajeContiene(['hola'], 'hola', [])).toBe(false);
  });

  it('un mensaje con palabras ya indexadas usa ese índice; vacío o ausente, recalcula del texto', () => {
    expect(mensajeContiene(['hola'], 'tortas', ['torta'])).toBe(false);   // manda el índice, no el texto
    expect(mensajeContiene([], 'tortas', ['torta'])).toBe(true);
    expect(mensajeContiene(undefined, 42, ['torta'])).toBe(false);        // texto que no es texto
  });

  it('el fragmento del resultado muestra el entorno de la palabra, recortado', () => {
    const texto = 'Buenas tardes, quería preguntar si para el cumpleaños de mi hija tienen alfajores de maicena disponibles este sábado';
    const f = fragmento(texto, ['alfajor'], 60);
    expect(f.toLowerCase()).toContain('alfajores');
    expect(f.length).toBeLessThanOrEqual(62);
    expect(fragmento('corto', ['x'])).toBe('corto');
    expect(fragmento(texto, ['inexistente'], 20)).toBe(texto.slice(0, 20) + '…');
    expect(fragmento('  mucho    espacio  ', [])).toBe('mucho espacio');
  });
});

describe('prefijosValidos', () => {
  it('acepta una lista de 1 a 10 prefijos de 1 a 4 dígitos, y devuelve una copia', () => {
    const v = ['591', '54', '1'];
    const r = prefijosValidos(v);
    expect(r).toEqual(['591', '54', '1']);
    expect(r).not.toBe(v);
    expect(prefijosValidos(['5911'])).toEqual(['5911']);
    expect(prefijosValidos(Array.from({ length: 10 }, (_, i) => String(i + 1)))).toHaveLength(10);
  });

  it('NEGATIVA: lista vacía, 11 elementos, «59a» y objeto dan el prefijo por defecto', () => {
    expect(prefijosValidos([])).toEqual(['591']);
    expect(prefijosValidos(Array.from({ length: 11 }, (_, i) => String(i + 1)))).toEqual(['591']);
    expect(prefijosValidos(['59a'])).toEqual(['591']);
    expect(prefijosValidos({ 0: '591', length: 1 })).toEqual(['591']);
    expect(prefijosValidos({})).toEqual(['591']);
  });

  it('NEGATIVA: un solo elemento malo descarta toda la lista; no se arregla a medias', () => {
    expect(prefijosValidos(['54', '59a'])).toEqual(['591']);
    expect(prefijosValidos(['54', ''])).toEqual(['591']);
    expect(prefijosValidos(['12345'])).toEqual(['591']);
    expect(prefijosValidos(['+591'])).toEqual(['591']);
    expect(prefijosValidos([591])).toEqual(['591']);
    expect(prefijosValidos(['54', null])).toEqual(['591']);
  });

  it('NEGATIVA: lo que no es lista da el prefijo por defecto', () => {
    for (const x of [undefined, null, '591', 591, true]) expect(prefijosValidos(x)).toEqual(['591']);
  });

  it('el valor por defecto devuelto no es el arreglo compartido: modificarlo no lo daña', () => {
    const r = prefijosValidos(undefined);
    r.push('999');
    expect(prefijosValidos(undefined)).toEqual(['591']);
    expect(PREFIJOS_PAIS_DEFECTO).toEqual(['591']);
  });
});

describe('el archivo es de Core y de nadie más', () => {
  const fuente = readFileSync(ARCHIVO, 'utf8');
  // Sin comentarios: el texto de los comentarios habla de «import» y no debe contar.
  const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('NEGATIVA: CERO import (estático, dinámico, require) ni re-exportaciones desde otro módulo', () => {
    expect(codigo).not.toMatch(/^\s*import\b/m);
    expect(codigo).not.toMatch(/\bimport\s*\(/);
    expect(codigo).not.toMatch(/\brequire\s*\(/);
    expect(codigo).not.toMatch(/\bexport\s+(\*|\{[^}]*\})\s*(as\s+\w+\s*)?from\b/);
    expect(codigo).not.toMatch(/\bfrom\s+['"]/);
  });

  it('NEGATIVA: sin enum ni namespace, que Node no puede quitar con strip-types', () => {
    expect(codigo).not.toMatch(/\benum\s+\w/);
    expect(codigo).not.toMatch(/\bnamespace\s+\w/);
    expect(codigo).not.toMatch(/\bconst\s+enum\b/);
  });

  it('Node lo carga desde un .mjs con --experimental-strip-types y da lo mismo que las pruebas', () => {
    const url = pathToFileURL(ARCHIVO).href;
    const programa = [
      `import * as n from ${JSON.stringify(url)};`,
      'const salida = {',
      '  trozos: n.trozosDeTelefono("+591 000-00047"),',
      '  palabras: n.palabrasDe("Quiero DOS salteñas y alfajores"),',
      '  prefijos: n.prefijosValidos(["59a"]),',
      '  ventana: n.VENTANA_HORAS,',
      '};',
      'console.log(JSON.stringify(salida));',
    ].join('\n');
    const carpeta = mkdtempSync(join(tmpdir(), 'normalizacion-'));
    const mjs = join(carpeta, 'carga.mjs');
    writeFileSync(mjs, programa);
    let r;
    try {
      r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', mjs], {
        encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 30_000,
      });
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      trozos: trozosDeTelefono('+591 000-00047'),
      palabras: palabrasDe('Quiero DOS salteñas y alfajores'),
      prefijos: ['591'],
      ventana: 24,
    });
  });
});
