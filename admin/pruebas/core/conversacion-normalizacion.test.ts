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
import { entornoDelEmulador } from './entorno-del-hijo.ts';
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

  it('PREFIJOS_PAIS_DEFECTO está congelado: nadie lo cambia desde fuera', () => {
    expect(Object.isFrozen(PREFIJOS_PAIS_DEFECTO)).toBe(true);
    expect(() => (PREFIJOS_PAIS_DEFECTO as string[]).push('999')).toThrow();
    expect(Object.isFrozen(prefijosValidos(undefined))).toBe(false);   // la copia sí se puede modificar
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

  it('singular y plural se unen, también los que terminan en «e»', () => {
    const pares: [string, string][] = [
      ['alfajor', 'alfajores'], ['torta', 'tortas'], ['flor', 'flores'], ['papel', 'papeles'], ['cafe', 'cafes'],
      ['saltena', 'saltenas'], ['chocolate', 'chocolates'], ['postre', 'postres'], ['tomate', 'tomates'],
      ['cliente', 'clientes'], ['envase', 'envases'], ['pan', 'panes'], ['mujer', 'mujeres'],
    ];
    for (const [sing, plu] of pares) expect(raizDe(plu), `${sing}/${plu}`).toBe(raizDe(sing));
    // Por las funciones públicas, con tildes y mayúsculas.
    expect(palabrasDe('Café')).toEqual(palabrasDe('CAFÉS'));
    expect(palabrasDe('Salteña')).toEqual(palabrasDe('salteñas'));
  });

  it('NEGATIVA: las palabras cortas quedan intactas (cada paso exige más de 3 letras)', () => {
    for (const w of ['mes', 'pan', 'dos', 'mas', 'los', 'ese', 'que', 'sol']) expect(raizDe(w), w).toBe(w);
    expect(raizDe('lunes')).toBe('lun');         // 5 letras: quita «s» y luego «e»
    expect(raizDe('tres')).toBe('tre');          // «tre» ya tiene 3: la «e» no se quita
    expect(raizDe('este')).toBe('est');
  });

  it('NEGATIVA: palabras distintas no se unen por la raíz', () => {
    expect(raizDe('flor')).not.toBe(raizDe('flora'));
    expect(raizDe('torta')).not.toBe(raizDe('tortilla'));
    expect(raizDe('panes')).not.toBe(raizDe('pano'));
  });

  it('NFKD: la ligadura «ﬁ» y el ancho completo se indexan como texto normal', () => {
    expect(normalizarTexto('ﬁesta')).toBe('fiesta');
    expect(normalizarTexto('ＨＯＬＡ')).toBe('hola');
    expect(palabrasDe('ﬁesta')).toEqual(['fiesta']);
    expect(palabrasDe('ＨＯＬＡ ｔｏｒｔａｓ')).toEqual(['hola', 'torta']);
    // Las tildes y la eñe siguen saliendo como antes.
    expect(normalizarTexto('Ñandú ÁÉÍÓÚ')).toBe('nandu aeiou');
  });

  it('palabrasDe: normaliza, descarta lo de menos de 3 letras, no repite y respeta el tope de 30', () => {
    expect(palabrasDe('¡Hola! Quiero DOS salteñas y una torta de chocolate')).toEqual(
      ['hola', 'quiero', 'dos', 'saltena', 'una', 'torta', 'chocolat']);
    expect(palabrasDe('torta Torta TORTAS')).toEqual(['torta']);
    expect(palabrasDe('a el de un')).toEqual([]);
    const largo = Array.from({ length: 80 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    expect(palabrasDe(largo).length).toBe(30);
    expect(palabrasDe(largo, 5).length).toBe(5);
    expect(palabrasDe(undefined)).toEqual([]);
  });

  it('NEGATIVA: un tope que no es válido (0, negativo, NaN, null, menos de 1) no indexa nada', () => {
    for (const max of [0, -1, Number.NaN, null, 0.5]) {
      expect(palabrasDe('hola quiero tortas', max as unknown as number), String(max)).toEqual([]);
    }
    expect(palabrasDe('hola quiero tortas', 1)).toEqual(['hola']);
    expect(palabrasDe('hola quiero tortas', 2.9)).toEqual(['hola', 'quiero']);
  });

  it('CORPUS FIJO: la regla completa congelada desde H1-6 (cambiarla exige relleno de mensajes)', () => {
    const texto = 'Pedido 1234: ¡Quiero DOS Salteñas, tres flores y CAFÉS! 🎉 Los chocolates, un postre, tomates; '
      + 'clientes: envases y panes. Mamá, ñandú 😀 abc FLORES';
    expect(palabrasDe(texto)).toEqual([
      'pedido', '1234', 'quiero', 'dos', 'saltena', 'tre', 'flor', 'caf', 'los', 'chocolat', 'postr', 'tomat',
      'client', 'envas', 'pan', 'mama', 'nandu', 'abc',
    ]);
  });

  it('tope de 30: con 31 palabras distintas queda la trigésima y no la 31', () => {
    const treinta = Array.from({ length: 31 }, (_, i) => `voz${String(i).padStart(2, '0')}`);
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
    expect(f.length).toBeLessThanOrEqual(60);
    expect(fragmento('corto', ['x'])).toBe('corto');
    expect(fragmento(texto, ['inexistente'], 20)).toBe(texto.slice(0, 19) + '…');
    expect(fragmento('  mucho    espacio  ', [])).toBe('mucho espacio');
  });

  it('NEGATIVA: el fragmento nunca pasa de `ancho` caracteres, con «…» en un extremo, en los dos o en ninguno', () => {
    const texto = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis';
    for (const ancho of [3, 4, 10, 20, 33, 60, texto.length - 1, texto.length]) {
      for (const buscada of ['uno', 'siete', 'quince', 'dieciseis', 'inexistente']) {
        const f = fragmento(texto, [buscada], ancho);
        expect(f.length, `${buscada}/${ancho}`).toBeLessThanOrEqual(ancho);
      }
    }
    const medio = fragmento(texto, ['siete'], 20);
    expect(medio.startsWith('…') && medio.endsWith('…') && medio.includes('siete')).toBe(true);
    expect(fragmento(texto, ['uno'], 20).startsWith('…')).toBe(false);
  });

  it('NEGATIVA: un `texto` que no es cadena da vacío, y un `ancho` inválido también', () => {
    for (const x of [undefined, null, 42, {}, ['a']]) expect(fragmento(x as unknown as string, ['a'])).toBe('');
    expect(fragmento('hola mundo', ['hola'], 0)).toBe('');
    expect(fragmento('hola mundo', ['hola'], Number.NaN)).toBe('');
    expect(fragmento('hola mundo largo', ['hola'], 2).length).toBeLessThanOrEqual(2);
  });

  it('O1: con la palabra al final del texto no deja un «…» final falso ni corta la palabra', () => {
    const texto = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince alfajores';
    for (const ancho of [12, 20, 33, 60]) {
      const f = fragmento(texto, ['alfajor'], ancho);
      expect(f.endsWith('alfajores'), `ancho ${ancho}: ${f}`).toBe(true);
      expect(f.endsWith('…')).toBe(false);
      expect(f.startsWith('…')).toBe(true);
      expect(f.length).toBeLessThanOrEqual(ancho);
    }
    // El texto llega exacto hasta el último carácter: la ventana usa todo el ancho.
    expect(fragmento(texto, ['alfajor'], 20)).toBe('…' + texto.slice(-19));
  });

  it('O2: NFKD desplaza la posición (… -> ..., ligaduras, ancho completo) y la ventana igual cae sobre la palabra', () => {
    const cola = ' y además tengo varias cosas más para contar sobre el pedido del sábado en la tarde, gracias';
    // 40 «…» (cada uno ocupa 3 caracteres en el texto plano) antes de la palabra.
    const conPuntos = '…'.repeat(40) + ' quiero alfajores' + cola;
    expect(fragmento(conPuntos, ['alfajor'], 30)).toContain('alfajor');
    // Ligaduras: «ﬁ» se vuelve «fi» y las palabras se hallan igual.
    const conLigadura = 'ﬁesta '.repeat(30) + 'alfajores' + cola;
    expect(fragmento(conLigadura, ['alfajor'], 30)).toContain('alfajor');
    // El ❤️ (U+2764 U+FE0F) pierde su selector en el texto plano; tampoco desplaza.
    const conCorazones = '❤️'.repeat(40) + ' alfajores' + cola;
    expect(fragmento(conCorazones, ['alfajor'], 30)).toContain('alfajor');
    // Tildes y ancho completo.
    const conAncho = 'ＡＢＣ '.repeat(20) + 'Alfajores' + cola;
    expect(fragmento(conAncho, ['alfajor'], 30)).toContain('Alfajor');
  });

  it('un emoji (par sustituto) no se parte en el borde de la ventana', () => {
    const texto = '😀'.repeat(30) + ' alfajores ' + '😀'.repeat(30);
    for (let ancho = 6; ancho <= 40; ancho++) {
      const f = fragmento(texto, ['alfajor'], ancho);
      expect(f.length, `ancho ${ancho}`).toBeLessThanOrEqual(ancho);
      // Ningún sustituto suelto: el texto sobrevive a una ida y vuelta por UTF-8.
      expect(new TextDecoder().decode(new TextEncoder().encode(f)), `ancho ${ancho}`).toBe(f);
    }
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

  it('NEGATIVA: una lista con huecos no pasa (new Array(3), [ , «54»])', () => {
    expect(prefijosValidos(new Array(3))).toEqual(['591']);
    // eslint-disable-next-line no-sparse-arrays
    expect(prefijosValidos([, '54'])).toEqual(['591']);
    expect(prefijosValidos(['54', , '1'])).toEqual(['591']);
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
        encoding: 'utf8', env: entornoDelEmulador(process.env['FIRESTORE_EMULATOR_HOST']), timeout: 30_000,
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
