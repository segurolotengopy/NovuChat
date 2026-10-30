/**
 * LOS NODOS COMUNES NEUTROS de `Flujos/experimental/venta-digital/src/nodos/` (subidos desde la versión de «El Puente»). Cada diferencia respecto de esa versión está declarada aquí y se prueba:
 *   - `carga-de-entrada`, `config-del-negocio`, `puerta-del-turno`: IDÉNTICOS (huella fijada de los dos lados: si cualquiera cambia, la prueba obliga a decidir);
 *   - `_comun`: la clave de la ficha sale del parámetro del tenant (`CN_TENANT.claveFicha`) y no es un valor del archivo;
 *   - `normalizar-entrada`: las seis llamadas a la librería del tenant (ficha, ids vistos, línea del cliente, normalización, riesgo y ventana de otro país) pasan por `CN_TENANT`;
 *   - `resumen-del-turno`: los tres bloques de reversión de la ficha de ese negocio se reemplazan por la reversión genérica (`revertirFicha` / `revertirSiFalloElPrincipal`).
 * Ningún archivo de la carpeta común nombra a un cliente.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '../../../../Flujos/experimental');
const NEUTROS = join(FLUJOS, 'venta-digital/src/nodos');
const ANTONIO = join(FLUJOS, 'rroca-antonio/src/nodos');
const leer = (r: string): string => readFileSync(r, 'utf8');
const huella = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 16);

// [archivo, huella del origen, huella del neutro]
const HUELLAS: [string, string, string][] = [
  ['_comun.js', '304e6d15ac80e270', 'b861766c1285d559'],
  ['carga-de-entrada.js', '2562bb2b56c2ea23', '2562bb2b56c2ea23'],
  ['config-del-negocio.js', '4f36336734d741cb', '4f36336734d741cb'],
  ['normalizar-entrada.js', 'ad54b5d57c48e022', '03a6bdc856c0e0ff'],
  ['puerta-del-turno.js', '3f8a837a3912eb78', '3f8a837a3912eb78'],
  ['resumen-del-turno.js', '56e4bdf011a18b83', '08eea9fd84116169'],
];

describe('huellas: lo que se subió y de dónde', () => {
  for (const [archivo, origen, neutro] of HUELLAS) {
    it(`${archivo}: el origen y el neutro son los declarados`, () => {
      expect(huella(leer(join(ANTONIO, archivo)))).toBe(origen);
      expect(huella(leer(join(NEUTROS, archivo)))).toBe(neutro);
    });
  }
  it('los tres idénticos lo son byte a byte', () => {
    for (const a of ['carga-de-entrada.js', 'config-del-negocio.js', 'puerta-del-turno.js']) expect(leer(join(NEUTROS, a))).toBe(leer(join(ANTONIO, a)));
  });
});

describe('zona: nada de un cliente en la carpeta común', () => {
  const archivos = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(d, e.name)) : [join(d, e.name)]));
  const NOMBRES = /antonio|walisuma|rroca|dhermacore|bellido|q'?taco|platinum|m[eé]todo puente/i;
  it('ningún archivo de venta-digital/src/ nombra a un cliente', () => {
    for (const f of archivos(join(FLUJOS, 'venta-digital/src'))) expect(NOMBRES.test(leer(f)), f).toBe(false);
  });
  it('los nodos neutros no usan funciones ni constantes `ra*` / `RA_*` (son de un tenant)', () => {
    for (const f of archivos(NEUTROS)) expect(/\bra[A-Z]\w*|\bRA_\w+/.test(leer(f)), f).toBe(false);
  });
});

describe('_comun: la clave de la ficha es un parámetro del tenant', () => {
  const FUENTE = leer(join(NEUTROS, '_comun.js'));
  type Sd = Record<string, unknown>;
  const cargar = (tenant: unknown, sd: Sd | null) => {
    // El código evaluado es el de un archivo del propio repositorio, no una entrada externa: solo prueba.
    // nosemgrep: devsecops.js-eval-prohibido
    return new Function('CN_TENANT', '$getWorkflowStaticData', '$', `${FUENTE}\nreturn { cnMapaDeFichas, cnClaveDeFichas, cnFichaDe };`)(tenant, () => { if (sd === null) throw new Error('sin datos'); return sd; }, () => { throw new Error('sin nodos'); }) as {
      cnMapaDeFichas: (e?: boolean) => { sd: Sd | null; mapa: Record<string, unknown> };
      cnClaveDeFichas: () => string;
      cnFichaDe: (m: Record<string, unknown>, f: string) => unknown;
    };
  };
  it('escribe en la clave que dice el tenant y en ninguna otra', () => {
    const sd: Sd = {};
    const c = cargar({ claveFicha: 'tiendaUno' }, sd);
    c.cnMapaDeFichas(true).mapa['59100000011'] = { v: 1 };
    expect(Object.keys(sd)).toEqual(['tiendaUno']);
    const sd2: Sd = {};
    cargar({ claveFicha: 'tiendaDos' }, sd2).cnMapaDeFichas(true);
    expect(Object.keys(sd2)).toEqual(['tiendaDos']);
  });
  it('NEGADO: sin clave, con una clave que toca el prototipo o con otra forma, el nodo no lee ni escribe fichas', () => {
    for (const malo of [undefined, '', '__proto__', 'constructor', 'prototype', 'a', 'con espacio', '1abc', 7, null, { x: 1 }]) {
      const sd: Sd = {};
      const c = cargar({ claveFicha: malo }, sd);
      expect(c.cnClaveDeFichas(), String(malo)).toBe('');
      const r = c.cnMapaDeFichas(true);
      expect(r.sd).toBeNull();
      expect(Object.keys(sd)).toEqual([]);
    }
    const c = cargar(undefined, {});
    expect(c.cnMapaDeFichas(true).sd).toBeNull();
  });
  it('un nodo que SOLO LEE no crea el mapa; sin datos estáticos tampoco falla', () => {
    const sd: Sd = {};
    expect(cargar({ claveFicha: 'tiendaUno' }, sd).cnMapaDeFichas(false).mapa).toEqual({});
    expect(Object.keys(sd)).toEqual([]);
    expect(cargar({ claveFicha: 'tiendaUno' }, null).cnMapaDeFichas(true).sd).toBeNull();
  });
  it('la ficha solo se lee por una clave de teléfono válida y propia del mapa (nunca del prototipo)', () => {
    const c = cargar({ claveFicha: 'tiendaUno' }, {});
    const mapa = { '59100000011': { v: 1 } };
    expect(c.cnFichaDe(mapa, '59100000011')).toEqual({ v: 1 });
    for (const malo of ['__proto__', 'constructor', 'toString', '59100000012', '']) expect(c.cnFichaDe(mapa, malo)).toBeNull();
  });
});

describe('normalizar-entrada y resumen-del-turno: lo que cambió respecto del origen', () => {
  it('normalizar: las llamadas a la librería del tenant pasan por CN_TENANT', () => {
    const n = leer(join(NEUTROS, 'normalizar-entrada.js'));
    for (const g of ['CN_TENANT.fichaVigente(', 'CN_TENANT.yaVisto(', 'CN_TENANT.lineaCliente(', 'CN_TENANT.esRiesgo(CN_TENANT.norm(', 'CN_TENANT.ventanaFueraDePaisMs']) expect(n.includes(g), g).toBe(true);
  });
  it('resumen: solo copia campos de nombre simple y solo si no salió nada (o el principal, según el campo)', () => {
    const r = leer(join(NEUTROS, 'resumen-del-turno.js'));
    expect(r).toMatch(/revertirSiFalloElPrincipal/);
    // Con varios mensajes (un resumen y un QR), un principal bueno no tapa al que falló.
    expect(r).toMatch(/it\.revertirSiFalloElPrincipal && !entregado\(principales\[k\]\)/);
    expect(r).toMatch(/revertirFicha/);
    expect(r).toMatch(/\^\[A-Za-z\]\[A-Za-z0-9\]\{0,40\}\$/);
    expect(r).not.toMatch(/qrPrevio|qrLiberado|hashPrevio|ctRestaurar/);
  });
});
