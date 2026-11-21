import { compileFunction } from 'node:vm';
/**
 * LA CAMPAÑA POR AD ID Y POR TEXTO EN LOS FLUJOS CON `Interpretar entrada` PROPIO (Andres, 17/11/2026).
 *
 * Mismo contrato que `core/campana-ad-id.test.ts`, para el chat de NovuChat, la agenda mínima y la captación mínima:
 * `anuncio` { titular, fuente, idAnuncio, ctwaClid }, `campana` { id, texto, por } y las salidas planas `adId`, `campanaId`,
 * `campanaPor`. PRIMERO el Ad ID (igualdad exacta contra los `adIds` de la campaña vigente, cualquier tipo de mensaje) y LUEGO el
 * texto exacto (solo `text`). Una campaña solo por Ad ID (texto '') VINCULA y nada más: no salta menú ni cambia la respuesta.
 * Cero nodos y cero mensajes agregados. Ad ID de prueba con seis ceros seguidos (repo público).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type J, codigoDe, configBase, ejecutar, leerFlujo, nodo } from './lib/flujo.ts';

const AD_A = '100000000000001';
const AD_B = '100000000000002';
const TEXTO = 'Hola, quiero info del plan Pro';
const ahora = Date.now();
const dia = 86_400_000;
const vigente = { inicio: new Date(ahora - dia).toISOString(), fin: new Date(ahora + dia).toISOString() };
const vencida = { inicio: new Date(ahora - 3 * dia).toISOString(), fin: new Date(ahora - dia).toISOString() };
const CAMPANAS = [
  { id: 'camp-ad', texto: 'Texto de la campana del anuncio', adIds: [AD_A], ...vigente },
  { id: 'camp-texto', texto: TEXTO, ...vigente },
  { id: 'camp-solo-ad', texto: '', adIds: ['100000000000003'], ...vigente },
  { id: 'camp-vieja', texto: 'Texto vencido', adIds: [AD_B], ...vencida },
];
const referral = (extra: J = {}): J => ({ source_id: AD_A, source_type: 'ad', headline: 'Plan Pro', ctwa_clid: 'clid-1', ...extra });

const panel = (extra: J): J => ({ statusCode: 200, body: { tenantId: 'un-negocio', estadoComercio: 'activo', phoneNumberId: '1000000001',
  operacion: { moneda: 'BOB', prefijosPermitidos: ['591'] }, datosDelNegocio: { nombreNegocio: 'Un Negocio' }, catalogo: [], funcionarios: [], voz: {},
  atencion: { estado: 'normal', respuestasEnVentana: 1 }, onboarding: { topeAviso: 10 }, ...extra } });

interface Esqueleto { nombre: string; archivo: string }
const ESQUELETOS: Esqueleto[] = [
  { nombre: 'chat de NovuChat', archivo: 'clientes/novuchat/chat-novuchat.prueba.json' },
  { nombre: 'agenda mínima', archivo: 'clientes/agenda-minima/agenda-minima.prueba.json' },
  { nombre: 'captación mínima', archivo: 'experimental/captacion-minima/captacion-minima.prueba.json' },
];

/** La config que arma `Config del negocio` con el panel dado, y lo que `Interpretar entrada` hace con un mensaje. */
function mundo(archivo: string) {
  const f = leerFlujo(archivo);
  const refs = { 'Config base': configBase(f), 'Carga de entrada': { messages: [{ from: '59170000001' }] } };
  const config = (campanas?: unknown): J => ejecutar(codigoDe(f, 'Config del negocio'), [panel(campanas === undefined ? {} : { campanas })], refs)[0] ?? {};
  const caido = (): J => ejecutar(codigoDe(f, 'Config del negocio'), [{ statusCode: 500, body: {} }], refs)[0] ?? {};
  const interpretar = (cfg: J, msg: J): J => ejecutar(codigoDe(f, 'Interpretar entrada'), [{}], {
    'Carga de entrada': { messages: [{ from: '59170000001', id: 'wamid.PRUEBA', type: 'text', text: { body: 'hola' }, ...msg }], contacts: [{ profile: { name: 'Ana' } }], phoneNumberId: '1000000001' },
    'Config del negocio': cfg,
  })[0] ?? {};
  return { f, config, caido, interpretar };
}

describe.each(ESQUELETOS)('campaña por Ad ID y texto: $nombre', ({ archivo }) => {
  const { config, caido, interpretar } = mundo(archivo);
  const cfg = config(CAMPANAS);

  it('coincide el Ad ID: la campaña es la del anuncio, por adId, y el anuncio trae id y clic', () => {
    const r = interpretar(cfg, { referral: referral() });
    expect(r['campana']).toEqual({ id: 'camp-ad', texto: 'Texto de la campana del anuncio', por: 'adId' });
    expect(r['anuncio']).toEqual({ titular: 'Plan Pro', fuente: 'ad', idAnuncio: AD_A, ctwaClid: 'clid-1' });
    expect([r['adId'], r['campanaId'], r['campanaPor']]).toEqual([AD_A, 'camp-ad', 'adId']);
    expect(r['origen']).toBe('anuncio');
  });

  it('el Ad ID sirve para cualquier tipo de mensaje (un audio, una imagen)', () => {
    const a = interpretar(cfg, { type: 'audio', text: undefined, audio: { id: 'm1' }, referral: referral() });
    expect(a['campanaPor']).toBe('adId');
    const i = interpretar(cfg, { type: 'image', text: undefined, image: { id: 'm2' }, referral: referral() });
    expect(i['campanaId']).toBe('camp-ad');
  });

  it('coincide el texto (sin referral): campaña por texto, sin Ad ID', () => {
    const r = interpretar(cfg, { text: { body: '¡hola, QUIERO info del plan pro!' } });
    expect(r['campana']).toMatchObject({ id: 'camp-texto', por: 'texto' });
    expect([r['adId'], r['campanaPor']]).toEqual(['', 'texto']);
    expect(r['anuncio']).toBeNull();
  });

  it('coincide Ad ID y texto a la vez: gana el Ad ID', () => {
    const r = interpretar(cfg, { text: { body: TEXTO }, referral: referral() });
    expect(r['campanaId']).toBe('camp-ad');
    expect(r['campanaPor']).toBe('adId');
  });

  it('no coincide ninguno: el anuncio se conserva y no hay campaña', () => {
    const r = interpretar(cfg, { text: { body: 'otra cosa' }, referral: referral({ source_id: '100000000000009' }) });
    expect(r['campana']).toBeNull();
    expect([r['campanaId'], r['campanaPor']]).toEqual(['', '']);
    expect(r['adId']).toBe('100000000000009');
    expect(r['origen']).toBe('anuncio');
  });

  it('sin referral y sin texto igual: ni anuncio ni campaña; origen directo', () => {
    const r = interpretar(cfg, { text: { body: 'hola' } });
    expect([r['anuncio'], r['campana'], r['adId'], r['campanaId'], r['campanaPor'], r['origen']]).toEqual([null, null, '', '', '', 'directo']);
  });

  it('un referral que no es un objeto no cuenta como anuncio', () => {
    expect(interpretar(cfg, { referral: 'texto' })['anuncio']).toBeNull();
    expect(interpretar(cfg, { referral: [AD_A] })['anuncio']).toBeNull();
  });

  it('el Ad ID de una campaña NO vigente no coincide (la vigencia se mira de nuevo contra el reloj)', () => {
    expect(String(cfg['campanasActivas'] ?? JSON.stringify(cfg['campanas']))).not.toContain(AD_B);
    const r = interpretar(cfg, { text: { body: 'hola' }, referral: referral({ source_id: AD_B }) });
    expect(r['campana']).toBeNull();
    expect(r['adId']).toBe(AD_B);
  });

  it('el titular y el clic van sin controles ni saltos y recortados', () => {
    const r = interpretar(cfg, { referral: referral({ headline: 'a\nb\u0000c' + 'x'.repeat(200), ctwa_clid: 'y'.repeat(500) }) });
    const a = r['anuncio'] as J;
    expect(a['titular']).toMatch(/^a b c/);
    expect(a['titular'].length).toBe(120);
    expect(a['ctwaClid'].length).toBe(200);
  });

  it('sin campañas (o panel caído) no hay coincidencia y el flujo sigue como siempre', () => {
    for (const c of [config(), config([]), caido()]) {
      const r = interpretar(c, { text: { body: TEXTO }, referral: referral() });
      expect(r['campana']).toBeNull();
      expect(r['adId']).toBe(AD_A);
    }
  });

  it('la configuración deja los adIds de forma válida y descarta una campaña sin texto y sin Ad ID', () => {
    const c = config([{ id: 'c1', texto: '', adIds: ['abc', '123'], ...vigente }, { id: 'c2', texto: '', adIds: [], ...vigente },
      { id: 'c3', texto: 'Hola uno', adIds: [AD_A, '1', '1'.repeat(40)], ...vigente }]);
    const lista = (typeof c['campanasActivas'] === 'string' ? JSON.parse(c['campanasActivas']) : c['campanas']) as J[];
    expect(lista.map((k) => k['id'])).toEqual(['c3']);
    expect(lista[0]!['adIds']).toEqual([AD_A]);
  });
});

describe('el reporte entrante manda adId, campanaId y campanaPor solo si no están vacíos', () => {
  for (const { nombre, archivo } of ESQUELETOS) {
    it(nombre, () => {
      const cuerpo = String(nodo(leerFlujo(archivo), 'Reportar mensaje (entrante)').parameters['jsonBody']);
      expect(cuerpo).toContain('adId: t.adId || undefined');
      expect(cuerpo).toContain('campanaId: t.campanaId || undefined');
      expect(cuerpo).toContain('campanaPor: t.campanaPor || undefined');
    });
  }
});

describe('una campaña solo por Ad ID no salta ningún menú ni cambia la respuesta', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const lib = readFileSync(join(aqui, '../../Flujos/experimental/captacion-minima/src/lib/captacion.js'), 'utf8');
  const ccCampana = compileFunction(`${lib}\nreturn ccCampana;`, [])() as (t: string, c: unknown) => J | null;
  const lista = [{ id: 'solo-ad', texto: '', adIds: [AD_A], destino: 'planes' }, { id: 'con-texto', texto: TEXTO, adIds: [AD_A], destino: 'planes' }];

  it('captación: ccCampana exige el texto; la campaña de solo Ad ID nunca toma destino', () => {
    expect(ccCampana('', lista)).toBeNull();
    expect(ccCampana('quiero hablar con una persona', [lista[0]])).toBeNull();
    expect(ccCampana(TEXTO, lista)).toMatchObject({ id: 'con-texto', destino: 'planes' });
  });

  it('captación: el turno con Ad ID y sin texto de campaña deja la misma entrada para decidir (solo se agrega el vínculo)', () => {
    const { config, interpretar } = mundo('experimental/captacion-minima/captacion-minima.prueba.json');
    const r = interpretar(config([{ id: 'solo-ad', texto: '', adIds: [AD_A], destino: 'planes', ...vigente }]), { text: { body: 'hola' }, referral: referral() });
    expect(r['campanaPor']).toBe('adId');
    expect(r['via']).toBe('texto');
    expect(r['texto']).toBe('hola');
    const sin = interpretar(config([]), { text: { body: 'hola' }, referral: referral() });
    const { campana: _c, campanaId: _i, campanaPor: _p, ahoraMs: _a, ...resto } = r;
    const { campana: _c2, campanaId: _i2, campanaPor: _p2, ahoraMs: _a2, ...restoSin } = sin;
    expect(resto).toEqual(restoSin);
  });
});

describe('miniCRM: el prospecto de la agenda y de la captación lleva el Ad ID y la campaña', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const agenda = readFileSync(join(aqui, '../../Flujos/clientes/agenda-minima/src/lib/agenda.js'), 'utf8');
  it('agenda: agmProspectoCrm copia adId y campanaId válidos y omite los inválidos', () => {
    const f = compileFunction(`${agenda}\nreturn agmProspectoCrm;`, ['msDe', 'diaDeLaSemana', 'fechaLocal', 'horaLocal', '_agmNombreCompleto']);
    const p = f(() => NaN, () => '', () => '', () => '', () => '') as (d: J) => J | null;
    const base = { from: '59170000001', plan: 'menu', ahoraMs: 1 };
    expect(p({ ...base, adId: AD_A, campanaId: 'camp-ad' })).toMatchObject({ adId: AD_A, campanaId: 'camp-ad' });
    const sin = p({ ...base, adId: 'x<y', campanaId: 'a b' }) as J;
    expect(sin).not.toHaveProperty('adId');
    expect(sin).not.toHaveProperty('campanaId');
    expect(p({ ...base, plan: 'emergencia', adId: AD_A })).toMatchObject({ adId: AD_A });
  });
  it('captación y agenda: «Armar mensajes» pasa el Ad ID al prospecto', () => {
    const cap = codigoDe(leerFlujo('experimental/captacion-minima/captacion-minima.prueba.json'), 'Armar mensajes');
    expect(cap).toContain('const adDelMensaje');
    expect(cap).toContain('adDelMensaje(despues)');
    expect(codigoDe(leerFlujo('clientes/agenda-minima/agenda-minima.prueba.json'), 'Armar mensajes')).toContain('adId: t.adId, campanaId: t.campanaId');
  });
});
