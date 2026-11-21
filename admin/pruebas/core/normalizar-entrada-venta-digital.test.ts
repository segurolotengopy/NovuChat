/**
 * «NORMALIZAR ENTRADA» DE VENTA DIGITAL (`core/sin-agente/venta-digital/normalizar-entrada.js` y su copia de `experimental/venta-digital/src/nodos/`):
 *  - un mensaje `location` válido es conversación con `ubicacion: {lat, lng}`; si no es válido, `ubicacion: null` y sigue como «otro» (como siempre);
 *  - el `referral` publica `anuncioId`, `anuncioTitular` y `anuncioCuerpo`, recortados y saneados;
 *  - los campos nuevos existen SIEMPRE (vacíos o null): ningún consumidor que no los use cambia.
 * El nodo corre aislado (vm) con dobles de la librería del tenant: lo que se prueba es el código del nodo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos');
const RUTAS = [join(RAIZ, 'src/core/sin-agente/venta-digital/normalizar-entrada.js'), join(RAIZ, 'experimental/venta-digital/src/nodos/normalizar-entrada.js')];
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TENANT = {
  fichaVigente: (f: J | null) => f ?? { fueraDePaisMs: 0, ultimosIds: [] },
  yaVisto: () => false,
  lineaCliente: (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max),
  esRiesgo: () => false,
  norm: (s: string) => s,
  ventanaFueraDePaisMs: 86400000,
};

function correr(ruta: string, msg: J, tenant: J = TENANT): J[] {
  const codigo = readFileSync(ruta, 'utf8');
  const f = vm.compileFunction(codigo, ['cnPrimero', 'cnCfg', 'cnClaveValida', 'cnFichaDe', 'cnMapaDeFichas', 'CN_TENANT']) as (...a: unknown[]) => { json: J }[];
  const carga = { messages: [{ from: '59100000011', id: 'wamid.X1', timestamp: '1', ...msg }], contacts: [{ profile: { name: 'Ana' } }], ahoraMs: 2000, phoneNumberId: 'p1' };
  return f(
    (n: string) => (n === 'Carga de entrada' ? carga : null),
    () => ({ prefijosPermitidos: '591' }),
    (v: string) => /^\d{6,20}$/.test(String(v)),
    () => null,
    () => ({ mapa: {} }),
    tenant,
  ).map((x) => x.json);
}
const ACEPTA = { ...TENANT, aceptaUbicacion: true };
const una = (ruta: string, msg: J, tenant: J = ACEPTA): J => correr(ruta, msg, tenant)[0] as J;
const ubic = (latitude: unknown, longitude: unknown): J => ({ type: 'location', location: { latitude, longitude, name: 'Casa', address: 'Calle 1' } });

for (const ruta of RUTAS) {
  describe(`normalizar-entrada (${ruta.includes('/core/') ? 'core' : 'copia de venta-digital'}): ubicación`, () => {
    it('un `location` con coordenadas válidas es conversación con `ubicacion {lat, lng}`', () => {
      const r = una(ruta, ubic(-16.5, -68.15));
      expect(r['categoria']).toBe('conversacion');
      expect(r['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
      expect(r['tipo']).toBe('location');
      expect(r['texto']).not.toMatch(/Casa|Calle/); // el nombre y la dirección que manda el cliente nunca pasan como texto
    });
    it('OPT-IN: sin `aceptaUbicacion: true` en CN_TENANT el pin válido sigue siendo «otro» (como antes), aunque `ubicacion` se publica', () => {
      for (const t of [TENANT, { ...TENANT, aceptaUbicacion: false }, { ...TENANT, aceptaUbicacion: 'true' }, { ...TENANT, aceptaUbicacion: 1 }]) {
        const r = una(ruta, ubic(-16.5, -68.15), t);
        expect(r['categoria']).toBe('otro');
        expect(r['texto']).toBe('');
        expect(r['ubicacion']).toEqual({ lat: -16.5, lng: -68.15 });
      }
    });
    it('los extremos del rango valen; un lado en 0 solo (el ecuador o Greenwich) también', () => {
      expect(una(ruta, ubic(90, 180))['ubicacion']).toEqual({ lat: 90, lng: 180 });
      expect(una(ruta, ubic(-90, -180))['ubicacion']).toEqual({ lat: -90, lng: -180 });
      expect(una(ruta, ubic(0, -68.1))['ubicacion']).toEqual({ lat: 0, lng: -68.1 });
    });
    it('NEGADO: sin coordenadas, con coordenadas como texto, (0,0), fuera de rango o no finitas: `ubicacion` es null y sigue como «otro»', () => {
      const malas: J[] = [
        { type: 'location' },
        { type: 'location', location: {} },
        { type: 'location', location: null },
        ubic(undefined, -68),
        ubic(-16.5, undefined),
        ubic('-16.5', '-68.15'),
        ubic('-16.5', -68.15),
        ubic(0, 0),
        ubic(90.0001, 0.5),
        ubic(-90.1, 10),
        ubic(10, 180.5),
        ubic(10, -181),
        ubic(Number.NaN, 5),
        ubic(Infinity, 5),
        ubic(null, null),
        ubic(true, 1),
        ubic([1], [2]),
        { type: 'location', location: { lat: -16.5, lng: -68.1 } },
      ];
      for (const m of malas) {
        const r = una(ruta, m);
        expect(r['ubicacion'], JSON.stringify(m)).toBeNull();
        expect(r['categoria'], JSON.stringify(m)).toBe('otro');
      }
    });
    it('un mensaje que no es `location` nunca trae ubicación, aunque cuele un campo `location`', () => {
      expect(una(ruta, { type: 'text', text: { body: 'hola' }, location: { latitude: -16.5, longitude: -68.1 } })['ubicacion']).toBeNull();
      expect(una(ruta, { type: 'sticker', sticker: { id: 's' } })['ubicacion']).toBeNull();
    });
    it('un número de otro país con ubicación válida no se atiende: sigue como «otro»', () => {
      const f = vm.compileFunction(readFileSync(ruta, 'utf8'), ['cnPrimero', 'cnCfg', 'cnClaveValida', 'cnFichaDe', 'cnMapaDeFichas', 'CN_TENANT']) as (...a: unknown[]) => { json: J }[];
      const carga = { messages: [{ from: '5491100000033', id: 'w', timestamp: '1', ...ubic(-16.5, -68.1) }], ahoraMs: 2000 };
      const r = f((n: string) => (n === 'Carga de entrada' ? carga : null), () => ({ prefijosPermitidos: '591' }), () => true, () => null, () => ({ mapa: {} }), TENANT)[0]?.json as J;
      expect(r['categoria']).toBe('otro');
    });
  });

  describe(`normalizar-entrada (${ruta.includes('/core/') ? 'core' : 'copia de venta-digital'}): anuncio`, () => {
    const ref = (o: J): J => ({ type: 'text', text: { body: 'hola' }, referral: { source_url: 'https://fb.me/x', source_type: 'ad', ...o } });
    it('el `referral` publica id, titular y cuerpo', () => {
      const r = una(ruta, ref({ source_id: 'ad-1202-1000-0123', headline: 'Bufandas de alpaca', body: 'Envíos a todo el país' }));
      expect(r['anuncio']).toBe(true);
      expect(r['anuncioId']).toBe('ad-1202-1000-0123');
      expect(r['anuncioTitular']).toBe('Bufandas de alpaca');
      expect(r['anuncioCuerpo']).toBe('Envíos a todo el país');
    });
    it('titular y cuerpo a 200 caracteres; un id de 64 pasa y uno de 65 o más se DESCARTA (no se trunca)', () => {
      expect(una(ruta, ref({ source_id: '1'.repeat(64) }))['anuncioId']).toHaveLength(64);
      expect(una(ruta, ref({ source_id: '1'.repeat(65) }))['anuncioId']).toBe('');
      const r = una(ruta, ref({ source_id: '1'.repeat(100), headline: 'T'.repeat(500), body: 'C'.repeat(500) }));
      expect(r['anuncioId']).toBe('');
      expect(r['anuncioTitular']).toHaveLength(200);
      expect(r['anuncioCuerpo']).toHaveLength(200);
    });
    it('NEGADO: HTML, saltos, controles y bidi nunca llegan; un id con forma rara se descarta', () => {
      const r = una(ruta, ref({ source_id: '12<script>', headline: '<b>Oferta</b>\n\u0000&amp;\u202eoculto\u2066\u200b\ufeff\u2060', body: 'Línea 1\r\nLínea 2\u2028<img src=x onerror=alert(1)>' }));
      for (const c of [r['anuncioTitular'], r['anuncioCuerpo']] as string[]) {
        expect(c).not.toMatch(/[<>&\u0000-\u001f\u007f\u2028\u2029\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/);
      }
      expect(r['anuncioId']).toBe('');
      expect(r['anuncioTitular']).toContain('Oferta');
      expect(r['anuncioCuerpo']).toContain('Línea 2');
    });
    it('NEGADO: campos que no son texto (objeto, lista, número) no rompen ni se vuelven «[object Object]»', () => {
      const r = una(ruta, ref({ source_id: { a: 1 }, headline: ['x'], body: { b: 2 } }));
      expect(r['anuncioId']).toBe('');
      expect(r['anuncioTitular']).not.toMatch(/object/i);
      expect(r['anuncioCuerpo']).not.toMatch(/object/i);
    });
    it('sin `referral` los tres campos existen y están vacíos; `anuncio`/`origen` no cambian', () => {
      const r = una(ruta, { type: 'text', text: { body: 'hola' } });
      expect(r).toMatchObject({ anuncio: false, origen: 'directo', anuncioId: '', anuncioTitular: '', anuncioCuerpo: '', ubicacion: null });
    });
    it('un `referral` sin datos sigue marcando anuncio, con campos vacíos', () => {
      const r = una(ruta, { type: 'text', text: { body: 'hola' }, referral: {} });
      expect(r).toMatchObject({ anuncio: true, origen: 'anuncio', anuncioId: '', anuncioTitular: '', anuncioCuerpo: '' });
    });
  });
}

describe('el opt-in `aceptaUbicacion` no está declarado en los flujos que no lo piden', () => {
  const FLUJOS = [join(RAIZ, 'clientes/casa-bermejo/casa-bermejo.json'), join(RAIZ, 'clientes/rroca-antonio/rroca-antonio.json'), join(RAIZ, 'clientes/rroca-ruben/rroca-ruben.json')];
  for (const f of FLUJOS) {
    it(`${f.split('/').pop()}: ningún nodo declara \`aceptaUbicacion: true\` (el pin sigue siendo «otro»)`, () => {
      const flujo = JSON.parse(readFileSync(f, 'utf8')) as { nodes: { parameters?: { jsCode?: string } }[] };
      const codigo = flujo.nodes.map((n) => n.parameters?.jsCode ?? '').join('\n');
      expect(codigo.length).toBeGreaterThan(1000);
      expect(/^\s*aceptaUbicacion\s*:\s*true/m.test(codigo)).toBe(false);
    });
  }
});
