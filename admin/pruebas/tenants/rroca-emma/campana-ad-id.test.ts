/**
 * Emma: LA CAMPAÑA POR AD ID Y POR TEXTO (Andres, 17/11/2026). Sin red ni Firestore: el JSON versionado corre con el n8n de mentira.
 *
 * Contrato (`Analisis` del 17/11): `Config del negocio` conserva los `adIds` de la campaña vigente (`campanasActivas`); `Normalizar entrada` reconoce PRIMERO el Ad ID (`referral.source_id`, igualdad exacta,
 * cualquier tipo de mensaje) y DESPUÉS el texto exacto (solo `text`); deja las salidas planas `adId`, `campanaId`, `campanaPor` y el `ctwaClid`; `anuncio` sigue booleano en este canal (lo leen los tenants
 * con `=== true`). El reporte entrante manda las tres solo si no están vacías. Vincular NO cambia la respuesta: la campaña solo por Ad ID (texto vacío) no salta ningún menú ni cambia ningún mensaje.
 * 0 mensajes agregados, 0 nodos agregados. Ad ID de prueba con seis ceros seguidos (la comprobación de repo público los deja pasar).
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { AHORA, ANA, crear, hablar, mTexto, panelOk, textos } from './mundo';

// Ad ID de prueba armados con ceros repetidos: ningun literal de 10 o mas digitos en lo versionado.
const id = (n: string): string => '1' + '0'.repeat(13) + n;
const AD_A = id('1');
const AD_B = id('2');
const AD_C = id('9');
const TEXTO = 'Hola, quiero info de la campana de prueba';
const ahora = AHORA;   // el reloj del mundo de prueba, no el real
const dia = 86_400_000;
const vigente = { inicio: new Date(ahora - dia).toISOString(), fin: new Date(ahora + dia).toISOString() };
const vencida = { inicio: new Date(ahora - 3 * dia).toISOString(), fin: new Date(ahora - dia).toISOString() };
const CAMPANAS = [
  { id: 'camp-ad', texto: '', adIds: [AD_A], ...vigente },
  { id: 'camp-texto', texto: TEXTO, ...vigente },
  { id: 'camp-vieja', texto: 'Texto vencido', adIds: [AD_B], ...vencida },
];
const referral = (extra: J = {}): J => ({ source_id: AD_A, source_type: 'ad', headline: 'Titular de prueba', ctwa_clid: 'clid-1', ...extra });
const turno = (msg: J, campanas: unknown = CAMPANAS) => {
  const t = hablar(crear({ panel: panelOk(campanas === 'sin' ? {} : { campanas }) }), ANA, msg, { toleraFallo: true });
  const n = (t.porNodo['Normalizar entrada'] ?? [])[0] ?? {};
  const rep = t.llamadas.ingesta.find((c) => c['direccion'] === 'entrante') ?? {};
  return { t, n, rep };
};

describe('Emma: la campaña por Ad ID y por texto', () => {
  it('Config del negocio conserva los adIds de la campaña vigente y descarta la vencida', () => {
    const { t } = turno({ ...mTexto('hola'), referral: referral() });
    const cfg = (t.porNodo['Config del negocio'] ?? [])[0] ?? {};
    expect(JSON.parse(String(cfg['campanasActivas']))).toEqual([{ id: 'camp-ad', texto: '', adIds: [AD_A] }, { id: 'camp-texto', texto: TEXTO, adIds: [] }]);
  });
  it('NEGANDO: Ad ID mal formado o campaña sin texto ni Ad ID no llegan; sin `campanas` o con el panel caído, ninguna', () => {
    const { t } = turno(mTexto('hola'), [{ id: 'a', adIds: ['abc', '123'], ...vigente }, { id: 'b', ...vigente }]);
    expect(JSON.parse(String((t.porNodo['Config del negocio'] ?? [])[0]?.['campanasActivas']))).toEqual([]);
    const sin = turno({ ...mTexto('hola'), referral: referral() }, 'sin');
    expect(sin.n['campanaPor']).toBe('');
    const cae = hablar(crear({ panel: 'cae' }), ANA, { ...mTexto('hola'), referral: referral() }, { toleraFallo: true });
    expect(((cae.porNodo['Normalizar entrada'] ?? [])[0] ?? {})['campanaPor']).toBe('');
  });
  it('coincide el Ad ID: campana por adId, con adId y ctwaClid, aunque el mensaje no sea texto', () => {
    const { n } = turno({ ...mTexto('hola'), referral: referral() });
    expect(n).toMatchObject({ anuncio: true, origen: 'anuncio', adId: AD_A, ctwaClid: 'clid-1', campanaId: 'camp-ad', campanaPor: 'adId' });
    expect(n['campana']).toEqual({ id: 'camp-ad', texto: '', por: 'adId' });
    const imagen = turno({ type: 'image', image: { id: 'media-img', mime_type: 'image/jpeg' }, referral: referral() });
    expect(imagen.n).toMatchObject({ adId: AD_A, campanaId: 'camp-ad', campanaPor: 'adId' });
  });
  it('coincide el texto exacto (sin referral): campana por texto, sin adId', () => {
    const { n } = turno(mTexto(TEXTO.toUpperCase() + '!'));
    expect(n).toMatchObject({ anuncio: false, origen: 'directo', adId: '', campanaId: 'camp-texto', campanaPor: 'texto' });
  });
  it('ambos coinciden: gana el Ad ID', () => {
    const { n } = turno({ ...mTexto(TEXTO), referral: referral() });
    expect(n).toMatchObject({ campanaId: 'camp-ad', campanaPor: 'adId' });
  });
  it('no coincide ninguno: un Ad ID ajeno y un texto distinto no vinculan, pero el anuncio se conserva', () => {
    const { n } = turno({ ...mTexto('otra cosa'), referral: referral({ source_id: AD_C }) });
    expect(n).toMatchObject({ anuncio: true, adId: AD_C, campanaId: '', campanaPor: '' });
    expect(n['campana']).toBeNull();
  });
  it('sin referral y sin texto igual: campana nula y salidas vacías', () => {
    const { n } = turno(mTexto('hola'));
    expect(n).toMatchObject({ anuncio: false, origen: 'directo', adId: '', campanaId: '', campanaPor: '' });
    expect(n['campana']).toBeNull();
  });
  it('el Ad ID de una campaña NO vigente no coincide', () => {
    const { n } = turno({ ...mTexto('hola'), referral: referral({ source_id: AD_B }) });
    expect(n).toMatchObject({ adId: AD_B, campanaId: '', campanaPor: '' });
  });
  it('un referral que no es un objeto no cuenta como anuncio ni como Ad ID', () => {
    for (const malo of [AD_A, ['x'], 7]) {
      const { n } = turno({ ...mTexto('hola'), referral: malo });
      expect(n, JSON.stringify(malo)).toMatchObject({ anuncio: false, adId: '', campanaPor: '' });
    }
  });
  it('el reporte entrante manda adId, campanaId y campanaPor solo si no están vacíos', () => {
    const con = turno({ ...mTexto('hola'), referral: referral() }).rep;
    expect(con).toMatchObject({ origen: 'anuncio', adId: AD_A, campanaId: 'camp-ad', campanaPor: 'adId' });
    const directo = turno(mTexto('hola')).rep;
    for (const k of ['adId', 'campanaId', 'campanaPor']) expect(directo, k).not.toHaveProperty(k);
  });
  it('el Ad ID solo (texto vacío) no cambia ninguna respuesta: mismos mensajes y mismos avisos que sin campaña', () => {
    const con = turno({ ...mTexto('hola'), referral: referral() }).t;
    const sin = turno({ ...mTexto('hola'), referral: referral() }, []).t;
    expect(textos(con)).toEqual(textos(sin));
    expect(con.mensajes.length).toBe(sin.mensajes.length);
    expect(con.avisos.length).toBe(sin.avisos.length);
    expect(con.orden).toEqual(sin.orden);
  });
});
