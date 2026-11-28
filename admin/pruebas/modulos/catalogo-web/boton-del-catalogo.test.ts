/**
 * Enlace y botón del catálogo web (`Flujos/src/modulos/catalogo-web/boton-del-catalogo.js`, prefijo `cw`): pieza común.
 * El enlace sale del dato del comercio, validado como https; nunca fijo. Pruebas NEGADAS.
 */
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';

type M = { payload: { type: string; interactive?: { type: string; action: { parameters: { url: string; display_text: string } } } }; texto: string; respaldo?: string; conBoton?: boolean; tipoReporte?: string };
type Cw = { cwUrlValida: (v: unknown) => string; cwEnlaceCatalogo: (p: unknown) => string; cwConBotonCatalogo: (m: unknown, e: unknown) => boolean; cwMensajesConCatalogo: (m: unknown, e: unknown) => unknown[]; cwMensajeBotonCatalogo: (e: unknown) => M | null };
const cw = cargarFuente<Cw>(['Flujos/src/core/sin-agente/mensajes.js', 'Flujos/src/modulos/catalogo-web/boton-del-catalogo.js'], ['cwUrlValida', 'cwEnlaceCatalogo', 'cwConBotonCatalogo', 'cwMensajesConCatalogo', 'cwMensajeBotonCatalogo']);
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
  it('NIEGA: sin enlace https, o sin payload o texto, no cambia nada y devuelve false', () => {
    const a = msg();
    expect(cw.cwConBotonCatalogo(a, '')).toBe(false);
    expect(cw.cwConBotonCatalogo(a, 'http://x.test/a')).toBe(false);
    expect(a.payload.type).toBe('text');
    expect(cw.cwConBotonCatalogo(msg('hola'), 'javascript:alert(1)')).toBe(false);
    expect(cw.cwConBotonCatalogo({ payload: { type: 'interactive' }, texto: 'x' }, URL_OK)).toBe(false);
    expect(cw.cwConBotonCatalogo(null, URL_OK)).toBe(false);
  });
  it('NIEGA: un tipo que no admite el enlace (imagen) no se toca', () => {
    const img = { payload: { type: 'image', image: { link: 'https://a.test/x.jpg', caption: 'c' } }, texto: 'c' };
    expect(cw.cwConBotonCatalogo(img, URL_OK)).toBe(false);
    expect(img.payload.type).toBe('image');
  });
  it('I5: con más de 1000 caracteres el botón SIGUE saliendo: el cuerpo se acorta por líneas y dice cuántos productos faltan', () => {
    const lineas = Array.from({ length: 40 }, (_, i) => `• Producto número ${i} de nombre mediano — Bs ${10 + i}`);
    const m = msg('Tenemos:\n' + lineas.join('\n'));
    expect(m.texto.length).toBeGreaterThan(1000);
    expect(cw.cwConBotonCatalogo(m, URL_OK)).toBe(true);
    expect(m.payload.interactive!.type).toBe('cta_url');
    expect(m.texto.length).toBeLessThanOrEqual(1000);
    const dicen = /Hay (\d+) productos más; míralos en el catálogo\./.exec(m.texto);
    expect(dicen, 'debe decir cuántos faltan').not.toBeNull();
    const mostradas = (m.texto.match(/^•/gm) || []).length;
    expect(mostradas + Number(dicen![1])).toBe(40);
    expect(m.texto.split('\n').every((l: string) => l === '' || /^(Tenemos:|• Producto número \d+ de nombre mediano — Bs \d+|Hay \d+ productos más.*)$/.test(l)), 'ninguna línea a medias').toBe(true);
    expect(m.respaldo).toContain('• Producto número 39');
    expect(m.respaldo).toContain(URL_OK);
  });
  it('I5: un mensaje de botones de respuesta lleva el enlace en el texto (0 mensajes más), con sus botones intactos y cuerpo ≤ 1024', () => {
    const botones = { type: 'interactive', interactive: { type: 'button', body: { text: '¿Confirmas?' }, action: { buttons: [{ type: 'reply', reply: { id: 'si', title: 'Sí' } }] } } };
    const m: Record<string, unknown> = { payload: botones, texto: '¿Confirmas?', respaldo: '¿Confirmas?' };
    expect(cw.cwConBotonCatalogo(m, URL_OK)).toBe(true);
    expect(botones.interactive.type).toBe('button');
    expect(botones.interactive.action.buttons).toHaveLength(1);
    expect(botones.interactive.body.text).toBe('¿Confirmas?\n\nVer catálogo: ' + URL_OK);
    expect(String(m['respaldo'])).toContain(URL_OK);
    const largo = { type: 'interactive', interactive: { type: 'button', body: { text: 'Tenemos:\n' + Array.from({ length: 90 }, (_, i) => `• Producto ${i} — Bs ${i}`).join('\n') }, action: { buttons: [{ type: 'reply', reply: { id: 'si', title: 'Sí' } }] } } };
    expect(cw.cwConBotonCatalogo({ payload: largo, texto: 'x' }, URL_OK)).toBe(true);
    expect(largo.interactive.body.text.length).toBeLessThanOrEqual(1024);
    expect(largo.interactive.body.text).toMatch(/Hay \d+ productos más; míralos en el catálogo\./);
    expect(largo.interactive.body.text).toContain(URL_OK);
  });
  it('I5 (Andres, 27/11): con una LISTA el botón va en un SEGUNDO mensaje (+1); la lista queda intacta y cwConBotonCatalogo no la toca', () => {
    const lista = { type: 'interactive', interactive: { type: 'list', body: { text: 'x'.repeat(1024) }, action: { button: 'Ver', sections: [{ rows: [{ id: 'a', title: 'A' }] }] } } };
    const m = { payload: lista, texto: 'x', respaldo: 'x' };
    expect(cw.cwConBotonCatalogo(m, URL_OK)).toBe(false);
    expect(lista.interactive.body.text).toBe('x'.repeat(1024));
    const salida = cw.cwMensajesConCatalogo(m, URL_OK) as M[];
    expect(salida).toHaveLength(2);
    expect(salida[0]).toBe(m);
    expect(lista.interactive.body.text).not.toContain(URL_OK);
    expect(salida[1]!.payload.interactive!.type).toBe('cta_url');
    expect(salida[1]!.payload.interactive!.action.parameters.url).toBe(URL_OK);
    expect(salida[1]!.payload.interactive!.action.parameters.display_text).toBe('Ver catálogo');
    expect(salida[1]!.conBoton).toBe(true);
    expect(salida[1]!.respaldo).toContain(URL_OK);
  });
  it('cwMensajesConCatalogo: texto y botones de respuesta NO agregan mensajes; sin enlace válido nada cambia y no sale botón aparte', () => {
    const t = msg();
    const st = cw.cwMensajesConCatalogo(t, URL_OK) as M[];
    expect(st).toHaveLength(1);
    expect(st[0]!.payload.interactive!.type).toBe('cta_url');
    const botones = { type: 'interactive', interactive: { type: 'button', body: { text: '¿Confirmas?' }, action: { buttons: [] } } };
    expect(cw.cwMensajesConCatalogo({ payload: botones, texto: 'x' }, URL_OK)).toHaveLength(1);
    const lista = { type: 'interactive', interactive: { type: 'list', body: { text: 'x' }, action: { sections: [] } } };
    for (const e of ['', 'http://a.test/x', 'javascript:alert(1)', null]) expect(cw.cwMensajesConCatalogo({ payload: lista, texto: 'x' }, e), String(e)).toHaveLength(1);
    expect(cw.cwMensajeBotonCatalogo('http://a.test/x')).toBeNull();
    expect(cw.cwMensajeBotonCatalogo(URL_OK)!.payload.interactive!.type).toBe('cta_url');
  });
  it('NIEGA: el enlace no se repite si el cuerpo ya lo trae', () => {
    const botones = { type: 'interactive', interactive: { type: 'button', body: { text: 'Mira ' + URL_OK }, action: { buttons: [] } } };
    cw.cwConBotonCatalogo({ payload: botones, texto: 'x' }, URL_OK);
    expect(botones.interactive.body.text.split(URL_OK)).toHaveLength(2);
  });
});
