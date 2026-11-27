/**
 * Enlace y botón del catálogo web (`Flujos/src/modulos/catalogo-web/boton-del-catalogo.js`, prefijo `cw`): pieza común.
 * El enlace sale del dato del comercio, validado como https; nunca fijo. Pruebas NEGADAS.
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';

type M = { payload: { type: string; interactive?: { type: string; action: { parameters: { url: string; display_text: string } } } }; texto: string; respaldo?: string; conBoton?: boolean; tipoReporte?: string };
type Cw = { cwUrlValida: (v: unknown) => string; cwEnlaceCatalogo: (p: unknown) => string; cwConBotonCatalogo: (m: unknown, e: unknown) => boolean };
const cw = cargarFuente<Cw>(['Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/modulos/catalogo-web/boton-del-catalogo.js'], ['cwUrlValida', 'cwEnlaceCatalogo', 'cwConBotonCatalogo']);
const URL_OK = 'https://catalogo.ejemplo.test/c/abc123';
const panel = (w: unknown) => ({ ok: true, cuerpo: { catalogoWeb: w } });
const msg = (texto = 'Mira el catálogo'): M => ({ payload: { type: 'text' }, texto });

describe('cwEnlaceCatalogo', () => {
  it('toma el enlace del dato activo', () => expect(cw.cwEnlaceCatalogo(panel({ activo: true, enlace: ` ${URL_OK} ` }))).toBe(URL_OK));
  it('NIEGA: inactivo, sin panel, panel con error o enlace no https, con espacios o javascript: → vacío', () => {
    expect(cw.cwEnlaceCatalogo(panel({ activo: false, enlace: URL_OK }))).toBe('');
    expect(cw.cwEnlaceCatalogo(panel({ activo: 'true', enlace: URL_OK }))).toBe('');
    expect(cw.cwEnlaceCatalogo(null)).toBe('');
    expect(cw.cwEnlaceCatalogo({ ok: false, cuerpo: { catalogoWeb: { activo: true, enlace: URL_OK } } })).toBe('');
    expect(cw.cwEnlaceCatalogo(panel([]))).toBe('');
    for (const e of ['http://a.test/x', 'javascript:alert(1)', 'https://a.test/x y', 'https://', 'https:///x', 'https://' + 'a'.repeat(600), 42, null]) expect(cw.cwEnlaceCatalogo(panel({ activo: true, enlace: e })), String(e)).toBe('');
  });
});

describe('cwConBotonCatalogo', () => {
  it('convierte un texto simple en botón «Ver catálogo» en el mismo mensaje', () => {
    const m = msg();
    expect(cw.cwConBotonCatalogo(m, URL_OK)).toBe(true);
    expect(m.payload.interactive!.type).toBe('cta_url');
    expect(m.payload.interactive!.action.parameters.url).toBe(URL_OK);
    expect(m.respaldo).toBe('Mira el catálogo\n\n' + URL_OK);
    expect(m.conBoton).toBe(true);
    expect(m.tipoReporte).toBe('interactive');
  });
  it('1.2 el botón sale SIEMPRE que lo pidan, también con un pedido o un QR en curso (el helper no excluye ese caso)', () => {
    const m = { ...msg(), qrAbierto: true, pedido: { lineas: [{ id: 'p1', cantidad: 2 }] }, plan: 'qr_pendiente' };
    expect(cw.cwConBotonCatalogo(m, URL_OK)).toBe(true);
    expect(m.payload.interactive!.type).toBe('cta_url');
    expect(m.conBoton).toBe(true);
  });
  it('NIEGA: sin enlace https, con texto largo, o si el mensaje no es un texto simple, no cambia nada', () => {
    const a = msg();
    expect(cw.cwConBotonCatalogo(a, '')).toBe(false);
    expect(cw.cwConBotonCatalogo(a, 'http://x.test/a')).toBe(false);
    expect(a.payload.type).toBe('text');
    expect(cw.cwConBotonCatalogo(msg('x'.repeat(1001)), URL_OK)).toBe(false);
    expect(cw.cwConBotonCatalogo({ payload: { type: 'interactive' }, texto: 'x' }, URL_OK)).toBe(false);
    expect(cw.cwConBotonCatalogo(null, URL_OK)).toBe(false);
  });
});
