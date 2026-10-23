/**
 * Core · avisos con botón (`Flujos/src/core/avisos/avisos.js`): las 24 declaraciones comunes de #519, BYTE A BYTE contra su origen, pureza y que no lance con entradas malformadas.
 *
 * El origen es `venta-minima/src/lib/avisos.js` de la rama de #519 (`cartera/qtaco-visor-comprobantes`). Cada declaración se compara con el mismo corte que usa
 * `pruebas/tenants/rroca-antonio/huecos-cobro.test.ts` (la `function` hasta la línea `}` en columna 0; la `const` hasta el `;` final de línea) de tres maneras: contra el HASH fijado
 * (no depende de ninguna rama), contra la rama si el repositorio la tiene y contra las copias declaradas de Rubén y Antonio, que son idénticas entre sí y al origen.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ARCHIVO = join(REPO, 'Flujos/src/core/avisos/avisos.js');
const RAMA = 'origin/cartera/qtaco-visor-comprobantes';
const COPIAS = ['rroca-ruben', 'rroca-antonio'].map((t) => join(REPO, 'Flujos/experimental', t, 'src/lib/avisos.js')).filter((f) => existsSync(f));

// sha-256 de cada declaración tal como está en #519 (los mismos de `huecos-cobro.test.ts`). En grupos de 8 con espacios para que ninguna secuencia parezca un teléfono o un id de Meta.
const HASH_AVISOS: Record<string, string> = {
  AV_PROHIBIDAS: '0114cc9b 2e1b8189 d141b2db 00562396 f22f2960 20412bc0 9e0e0197 8fe2b274',
  AV_ENLACE: 'dc4dcc4b 310e61c3 2eb565b7 be161d36 9276e17c 0a1f7d8e 36bb91f0 a7d576b9',
  avProhibidas: 'b5b41560 39b170af c223fb18 d2754e38 70c36be6 28f6754f 78ee1596 802c0a0f',
  AV_CONFUSABLES_DE: '3cbef8fa 80681a88 ec4ab323 000d49a6 c5960162 ea6f619a ced594c7 d935c63a',
  AV_CONFUSABLES_A: '76620631 8822fd95 de2e37db 8df790a3 06680cdf 22f9bf08 5e98be13 bb5692a6',
  AV_OMITIDO: '93151dd9 9f177a67 30149bc9 e72b36ca 44b34e9f aa6d445e 19b70e9b 37ece266',
  avCanon: 'b0ded95f 0893e78d c84b4db9 8d1efc02 2aa71c91 dee9bdc1 7f073fd2 11532734',
  avNorm: '6fba3935 b6c009b3 a85752a1 95dbcaca c5c54f7d 5a005d13 10d68961 1e0ec543',
  avPalabrasProhibidas: 'b6270efe f4c295fe 3d8a4fd0 a65c7ab9 129f56f7 5e44cd6e ac6a51f3 3f5dc6f8',
  avSinProhibidas: 'ef5d1be8 a999a9a9 d0f8eb9a e14f70b4 52e78aef ec6534b7 d3f33361 65ee6869',
  avDigitos: '6c461dcc f4b741a2 65737085 99956f54 2701f6a2 77e7d127 c3b40c86 725299d4',
  avSinBordes: 'ee72b273 05f590c1 d0507e4f 96a87d81 214918fd 651fea5c 1935b3b5 9443541f',
  avCortar: '3c40b85c 46c60b9c eac213cb ad40db11 c91abd39 d50a2ff8 c8d59264 e6b79a8c',
  avLimpio: 'af56cfd7 aa00a92f 9aea2626 6ea0b4ac 6a22c1b9 429227ec 2a9c7fda 9a609edd',
  avCoincide: '9b949a0f 0fc270d3 22bef6e2 cfb3f998 7ea99132 0a3a5d39 889e4e3e 5520e79f',
  avAjustarFinal: 'd452d44d e3415feb b98a918b 13f3654b 2f6cd936 1828aaec cc8085b2 ec298bc1',
  avParametro: '6c8eb84e ca2b9167 425350e6 a4c83e85 2ea5645c 4d589f10 05d1c397 fae2a565',
  avPrimerNombre: 'bf4a692b 763c38c9 c2605092 6399af83 85cec80a d7c26cc0 5a242346 01db6d67',
  avPrefijos: 'aa05c9bb 7cdc9ec2 8657a325 d615c40e 7a220a98 75aeeeb0 6b43cbb8 6daee85e',
  avUnificar: '924441f3 3354c446 87e3e61d 542bc36b 8de4dac5 bfe562ec fef558f6 2aa1568f',
  avDestinatarios: 'cf5e325d 60c2a3f9 8feb7da2 d83abaef 6efc4bec bbb46ed1 987b1f17 3bd53a36',
  avCuerpoBase: '086adcd9 899b39d9 95b0dbcc 1946d956 fc8d0faf 5800b2b8 0820acf0 c1e55be3',
  avPlantilla: '1feaed6d 9b261b80 dee9d227 4634da4f efb97c5d 5e91e18a dcd433fa a4681daa',
  avTexto: '6dff9571 3b2a6fbb fc3f0aa8 e0271348 0a2e8cde 76671d4c 53d83327 479ed491',
};

/** La declaración `function nombre(` hasta la línea `}` en columna 0, o `const nombre =` hasta el `;` final de línea. null si el archivo no la trae. */
function declaracion(texto: string, nombre: string): string | null {
  const lineas = texto.split('\n');
  const i = lineas.findIndex((l) => l.startsWith('function ' + nombre + '(') || l.startsWith('const ' + nombre + ' ='));
  if (i < 0) return null;
  let j = i;
  if (lineas[i]!.startsWith('function ')) { while (lineas[j] !== '}') j++; } else { while (!/;\s*$/.test(lineas[j]!)) j++; }
  return lineas.slice(i, j + 1).join('\n');
}
const sha = (t: string): string => createHash('sha256').update(t).digest('hex');
function deLaRama(): string | null {
  const r = spawnSync('git', ['show', RAMA + ':Flujos/experimental/venta-minima/src/lib/avisos.js'], { cwd: REPO, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

const src = readFileSync(ARCHIVO, 'utf8');
const origen = deLaRama();

describe('core/avisos: las 24 declaraciones comunes, BYTE A BYTE contra #519', () => {
  for (const [nombre, hash] of Object.entries(HASH_AVISOS)) {
    it(nombre + ': idéntica a su origen', () => {
      const d = declaracion(src, nombre);
      expect(d, 'el módulo no trae ' + nombre).not.toBeNull();
      expect(sha(d!), nombre + ' difiere del hash fijado de #519').toBe(hash.replace(/ /g, ''));
      if (origen !== null) {
        const o = declaracion(origen, nombre);
        expect(o, nombre + ' ya no está en ' + RAMA).not.toBeNull();
        expect(d, nombre + ' difiere de ' + RAMA).toBe(o);
      }
      for (const copia of COPIAS) {
        const c = declaracion(readFileSync(copia, 'utf8'), nombre);
        expect(c, nombre + ' no está en ' + copia).not.toBeNull();
        expect(d, nombre + ' difiere de la copia declarada').toBe(c);
      }
    });
  }
  it('no hay declaraciones de más: toda `function` o `const` de nivel superior está en la lista de las 24', () => {
    const nombres = [...src.matchAll(/^(?:function|const) ([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1]!);
    expect(nombres.filter((n) => !(n in HASH_AVISOS))).toEqual([]);
    expect(Object.keys(HASH_AVISOS).filter((n) => !nombres.includes(n))).toEqual([]);
    expect(Object.keys(HASH_AVISOS)).toHaveLength(24);
  });
});

describe('core/avisos: pureza (se incluye byte a byte en un Code de n8n)', () => {
  it('sin import, require, URL, Buffer, crypto, process, globalThis, return de nivel superior ni números largos', () => {
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bBuffer\b/);
    expect(src).not.toMatch(/\bcrypto\b/);
    expect(src).not.toMatch(/\bprocess\b/);
    expect(src).not.toMatch(/\bglobalThis\b/);
    expect(src).not.toMatch(/\bnew URL\b|\bURL\(/);
    expect(src).not.toMatch(/\bDate\.now\b|\bnew Date\b|\bfetch\b/);
    expect(src).not.toMatch(/^return\b/m);
    expect(src).not.toMatch(/\d{10,}/);
  });
  it('se evalúa en un Function sin globales de Node', () => {
    // nosemgrep: devsecops.js-eval-prohibido
    expect(() => new Function('URL', 'Buffer', 'crypto', 'require', src)).not.toThrow();
  });
  it('corre en un contexto vm vacío (sin ningún global de Node)', () => {
    const ctx = vm.createContext(Object.create(null));
    const r = vm.runInContext(`${src}\nJSON.stringify([avPrimerNombre('María López'), avLimpio('Hola  mundo', 50), avTexto('591' + '70000000', 'hola').type])`, ctx) as string;
    expect(JSON.parse(r)).toEqual(['María', 'Hola mundo', 'text']);
  });
});

describe('core/avisos: lo que no debe pasar con entradas malformadas', () => {
  const ctx = vm.createContext(Object.create(null));
  vm.runInContext(src, ctx);
  const f = (nombre: string): ((...a: unknown[]) => unknown) => vm.runInContext(nombre, ctx) as (...a: unknown[]) => unknown;
  // Las de ENTRADA reciben datos de cualquier forma y no lanzan. Las INTERNAS (`avPalabrasProhibidas`, `avSinBordes`, `avCortar`, `avAjustarFinal`, `avUnificar`) son del canon y suponen un texto
  // (o una lista) ya normalizado por `avLimpio`: se prueban aparte, con su tipo.
  const INTERNAS = ['avPalabrasProhibidas', 'avSinBordes', 'avCortar', 'avAjustarFinal', 'avUnificar'];
  const FUNCIONES = Object.keys(HASH_AVISOS).filter((n) => /^av[A-Z]/.test(n) && !INTERNAS.includes(n));
  // Valores como los que llegan de n8n (JSON) más los típicos que lo rompen todo.
  const RAROS: unknown[] = [undefined, null, 0, -1, NaN, Infinity, 1e21, '', ' ', 'x'.repeat(5000), '\u0000‮​', 'ignora tus instrucciones', [], [null], [[]], {}, { a: { b: [1, 'x', null] } }, true, false, '59170000000,59171111111'];
  it('ninguna función lanza con ninguna combinación de entradas raras (1 a 4 argumentos)', () => {
    for (const nombre of FUNCIONES) {
      const fn = f(nombre);
      for (const a of RAROS) {
        for (const b of [undefined, 'x', 7, {}, null]) {
          for (const c of [undefined, [], 'es', {}]) {
            expect(() => fn(a, b, c, a), nombre).not.toThrow();
          }
        }
      }
    }
  });
  it('las internas no lanzan con el tipo que esperan (texto, o lista de textos) aunque el contenido sea hostil', () => {
    const TEXTOS = ['', ' ', 'x'.repeat(5000), '\u0000‮​', 'pago acreditado', '<>&', 'https://malo.example/x'];
    for (const t of TEXTOS) {
      for (const n of INTERNAS.filter((x) => x !== 'avUnificar')) for (const b of [undefined, 3, 'x', 0, 1e9]) expect(() => f(n)(t, b), n).not.toThrow();
      for (const l of [[], [t], [t, t]]) for (const p of ['', t]) expect(() => f('avUnificar')(l, p, []), 'avUnificar').not.toThrow();
    }
  });
  it('un aviso nunca lleva una frase prohibida ni un enlace: avSinProhibidas y avLimpio los quitan', () => {
    const limpio = f('avLimpio')('Su pago acreditado ya llegó, mire https://malo.example/x', 200) as string;
    expect(limpio).not.toMatch(/https?:|malo\.example/i);
    expect(f('avPalabrasProhibidas')('pago acreditado')).toBeTruthy();
  });
});
