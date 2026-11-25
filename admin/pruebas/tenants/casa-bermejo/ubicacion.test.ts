/**
 * UBICACIÓN DE LA TIENDA en Casa Bermejo (reclamo de Andres, 24/11/2026: «no le mandó dirección; cuando le pide debe enviar el link de GMaps»).
 * «¿Dónde están ubicados?» lo contesta el CÓDIGO con el dato del comercio (`ubicacionTienda`, `mapaTienda`, `horarioTienda` de «Config base»), SIN modelo y en UN solo mensaje (0 agregados).
 * Sin dato cargado: pasa con recepción (aviso + botón), nunca una dirección inventada. Se prueba NEGANDO. Los datos de los ejemplos son ficticios (ninguna dirección ni enlace es real).
 */
import { describe, expect, it } from 'vitest';
import { ANA, REC, catalogoOk, crear, hablar, modelo, mTexto, textos } from './mundo';

const DIR = 'Calle Ejemplo 123, zona Centro, Ciudad de Prueba';
const MAPA = 'https://maps.app.goo.gl/EjemploDePrueba1';
const HORARIO = 'lunes a sábado de 9 a 19';
const corridos = (t: ReturnType<typeof hablar>): string[] => t.registro.map((r) => r.nodo);
const llamoAlModelo = (t: ReturnType<typeof hablar>): boolean => corridos(t).includes('Conversar con el modelo');
type Cta = { type?: string; action?: { parameters?: { url?: string; display_text?: string } }; body?: { text?: string } };
const interactivo = (t: ReturnType<typeof hablar>): Cta | undefined => t.mensajes[0]?.payload['interactive'] as Cta | undefined;
/** El plan y el resumen que dejó «Armar mensajes» (el que decide el código). */
const plan = (t: ReturnType<typeof hablar>): { plan?: string; resumen?: { mensajes?: number; llamadasModelo?: number } } => (t.porNodo['Armar mensajes']?.[0] ?? {}) as never;
const urlDelBoton = (t: ReturnType<typeof hablar>): string => interactivo(t)?.action?.parameters?.url ?? '';
/** Un modelo ADVERSO: si alguna vez se lo llama, inventa una dirección y un enlace. */
const ADVERSO = modelo('Estamos en Av. Inventada 999 y aquí está el mapa: https://maps.app.goo.gl/Inventado');
const FRASES_DEL_RECLAMO = ['Si quería saber dónde están ubicados', 'dónde queda', 'cual es la direccion', 'como llego', 'ubicacion?', 'mandame el mapa'];

describe('con el dato completo: UN mensaje, con la dirección y el botón de Maps, sin modelo', () => {
  for (const frase of FRASES_DEL_RECLAMO) {
    it(`«${frase}»: 1 mensaje con la dirección, botón «Ver ubicación» al mapa, 0 llamadas al modelo y sin aviso`, () => {
      const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA, horarioTienda: HORARIO }, modeloDice: ADVERSO }), ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      expect(interactivo(t)?.type).toBe('cta_url');
      expect(urlDelBoton(t)).toBe(MAPA);
      expect(interactivo(t)?.action?.parameters?.display_text).toBe('Ver ubicación');
      const cuerpo = interactivo(t)?.body?.text ?? '';
      expect(cuerpo).toContain(DIR);
      expect(cuerpo).toContain('Horario: ' + HORARIO);
      expect(cuerpo).not.toMatch(/Inventada/);
      expect(t.mensajes[0]?.respaldo).toBe(false);
      expect(llamoAlModelo(t)).toBe(false);
      expect(t.avisos).toHaveLength(0);
      expect(plan(t).plan).toBe('ubicacion_tienda');
      expect(plan(t).resumen?.mensajes).toBe(1);
      expect(plan(t).resumen?.llamadasModelo).toBe(0);
    });
  }
  it('el botón NO es de derivación: no lleva el wa.me de recepción', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA } }), ANA, mTexto('dónde queda'));
    expect(JSON.stringify(t.mensajes[0]?.payload)).not.toMatch(/wa\.me|api\.whatsapp\.com/);
  });
  it('no depende del catálogo: con NovuTienda caída igual responde la ubicación', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA }, catalogo: 'cae', modeloDice: ADVERSO }), ANA, mTexto('dónde están ubicados'));
    expect(urlDelBoton(t)).toBe(MAPA);
    expect(t.avisos).toHaveLength(0);
    expect(llamoAlModelo(t)).toBe(false);
  });
  it('con «usted» el texto sale en usted', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA, tratamiento: 'usted' } }), ANA, mTexto('dónde queda'));
    expect(interactivo(t)?.body?.text).toMatch(/puede abrir el mapa/);
  });
  it('un pedido a medias no se toca: el carrito sigue igual después de preguntar por la ubicación', () => {
    const m = crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA }, modeloDice: modelo('Anotado.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) });
    hablar(m, ANA, mTexto('quiero la billetera'));
    const antes = JSON.stringify((m.sd['casabermejo'] as Record<string, { carrito: unknown }>)[ANA]?.carrito);
    const t = hablar(m, ANA, mTexto('dónde queda'));
    expect(urlDelBoton(t)).toBe(MAPA);
    expect(JSON.stringify((m.sd['casabermejo'] as Record<string, { carrito: unknown }>)[ANA]?.carrito)).toBe(antes);
  });
});

describe('con dato parcial', () => {
  it('solo la dirección: texto sin botón (y sin hablar de un botón que no existe)', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR }, modeloDice: ADVERSO }), ANA, mTexto('dónde queda'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]?.payload['type']).toBe('text');
    expect(textos(t)[0]).toContain(DIR);
    expect(textos(t)[0]).not.toMatch(/bot[oó]n|https?:/i);
    expect(llamoAlModelo(t)).toBe(false);
    expect(t.avisos).toHaveLength(0);
  });
  it('solo el enlace: «Aquí está nuestra ubicación» y el botón', () => {
    const t = hablar(crear({ base: { mapaTienda: MAPA } }), ANA, mTexto('dónde queda'));
    expect(t.mensajes).toHaveLength(1);
    expect(urlDelBoton(t)).toBe(MAPA);
    expect(interactivo(t)?.body?.text).toMatch(/Aquí está nuestra ubicación/);
    expect(interactivo(t)?.body?.text).not.toMatch(/Nos ubicamos en/);
  });
  it('sin horarioTienda no se afirma ningún horario', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA } }), ANA, mTexto('dónde queda'));
    expect(interactivo(t)?.body?.text).not.toMatch(/horario|\d{1,2} a \d{1,2}/i);
  });
});

describe('sin NINGÚN dato: recepción (aviso + botón) y nada inventado', () => {
  for (const base of [{}, { ubicacionTienda: '', mapaTienda: '', horarioTienda: HORARIO }, { ubicacionTienda: 'REEMPLAZAR_UBICACION', mapaTienda: '' }]) {
    it(`datos ${JSON.stringify(base)}: 1 mensaje con el botón de recepción, 1 aviso al comercio, 0 modelo`, () => {
      const t = hablar(crear({ base, modeloDice: ADVERSO }), ANA, mTexto('dónde están ubicados'));
      expect(t.mensajes).toHaveLength(1);
      expect(interactivo(t)?.type).toBe('cta_url');
      expect(urlDelBoton(t)).toContain('wa.me/' + REC);
      expect(t.avisos).toHaveLength(1);
      expect(JSON.stringify(t.avisos[0]?.payload)).toMatch(/dónde queda la tienda|donde queda la tienda/);
      expect(JSON.stringify(t.mensajes)).not.toMatch(/Inventada|maps\.|goo\.gl|Calle Ejemplo/);
      expect(llamoAlModelo(t)).toBe(false);
      expect(plan(t).plan).toBe('derivar');
      expect(interactivo(t)?.body?.text).toMatch(/Ya avisé a recepción/);
    });
  }
});

describe('un enlace inválido es «sin dato»', () => {
  const MALOS = ['http://maps.app.goo.gl/x', 'https://ejemplo.com/maps', 'javascript:alert(1)', 'https://maps.app.goo.gl/a b', 'https://maps.app.goo.gl@evil.com/x', 'https://maps.app.goo.gl:8080/x', 'https://user:pw@maps.app.goo.gl/x', 'https://goo.gl/mapsevil', 'REEMPLAZAR_MAPA', 'https://maps.app.goo.gl/' + 'a'.repeat(200), 'https://maps.app.goo.gl/x\ny'];
  for (const malo of MALOS) {
    it(`mapaTienda «${malo.slice(0, 40).replace('\n', '\\n')}» y sin dirección: no sale como botón; pasa con recepción`, () => {
      const t = hablar(crear({ base: { mapaTienda: malo } }), ANA, mTexto('dónde queda'));
      expect(JSON.stringify(t.mensajes)).not.toMatch(/javascript|evil|goo\.gl\/a b/);
      expect(urlDelBoton(t)).toContain('wa.me/');
      expect(t.avisos).toHaveLength(1);
    });
  }
  it('con dirección válida y enlace inválido: sale solo la dirección, sin enlace', () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: 'http://maps.app.goo.gl/x' } }), ANA, mTexto('dónde queda'));
    expect(t.mensajes[0]?.payload['type']).toBe('text');
    expect(textos(t)[0]).toContain(DIR);
    expect(textos(t)[0]).not.toMatch(/http/);
  });
  for (const bueno of ['https://maps.app.goo.gl/AbC123', 'https://goo.gl/maps/AbC123', 'https://www.google.com/maps/place/Ejemplo', 'https://google.com/maps?q=1,2', 'https://maps.google.com/?q=ejemplo']) {
    it(`mapaTienda «${bueno}» es válido`, () => {
      const t = hablar(crear({ base: { mapaTienda: bueno } }), ANA, mTexto('dónde queda'));
      expect(urlDelBoton(t)).toBe(bueno);
    });
  }
});

describe('NEGADO: lo que NO es preguntar dónde queda la tienda no dispara la ubicación', () => {
  const DATOS = { ubicacionTienda: DIR, mapaTienda: MAPA, horarioTienda: HORARIO };
  const NO = ['dirección de envío: calle Falsa', 'Ana Pérez 4412345 Cochabamba', 'quiero una billetera', 'a qué hora abren', 'dónde está mi pedido', 'dónde están las billeteras', 'la dirección es av busch', 'mi ubicación es el centro', 'dirección calle bolivar', 'envíenlo a mi dirección', 'cuanto cuesta el envío a la dirección'];
  for (const frase of NO) {
    it(`«${frase}» NO responde la ubicación de la tienda`, () => {
      const t = hablar(crear({ base: DATOS, modeloDice: modelo('Con gusto.') }), ANA, mTexto(frase));
      expect(plan(t).plan).not.toBe('ubicacion_tienda');
      expect(JSON.stringify(t.mensajes)).not.toContain(MAPA);
      expect(JSON.stringify(t.mensajes)).not.toContain(DIR);
    });
  }
  it('«a qué hora abren» sigue su camino de siempre (al modelo, cuyo prompt lleva el horario declarado): la ubicación no lo captura', () => {
    const t = hablar(crear({ base: DATOS, modeloDice: modelo('Atendemos ' + HORARIO + '.') }), ANA, mTexto('a qué hora abren'));
    expect(llamoAlModelo(t)).toBe(true);
    expect(interactivo(t)?.type).toBeUndefined();
  });
  it('un mensaje de datos de entrega (nombre, ciudad, CI) con un pedido a medias no lo captura la ubicación', () => {
    const m = crear({ base: DATOS, modeloDice: modelo('Anotado.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }] }) });
    hablar(m, ANA, mTexto('quiero la billetera'));
    const t = hablar(m, ANA, mTexto('Ana Pérez 4412345 Cochabamba, dirección: calle X'));
    expect(plan(t).plan).not.toBe('ubicacion_tienda');
  });
});

// FUENTE PRINCIPAL: el campo `tienda` del catálogo de NovuTienda; el dato del tenant es solo el RESPALDO, subcampo por subcampo.
describe('la fuente: «tienda» del catálogo primero, el tenant de respaldo', () => {
  const TIENDA = { nombre: 'Tienda de prueba', direccion: 'Av. Catálogo s/n, zona Norte', enlaceMapa: 'https://maps.app.goo.gl/DelCatalogo1', coordenadas: null, horario: 'martes a domingo de 10 a 18' };
  const hablaCon = (extra: object, base: Record<string, unknown> = {}, cat: unknown = undefined) =>
    hablar(crear({ catalogo: (cat ?? catalogoOk(extra)) as never, base, modeloDice: ADVERSO }), ANA, mTexto('dónde queda'));
  it('con `tienda` en el catálogo y el tenant vacío: dirección, botón al mapa y horario del catálogo, sin modelo ni aviso', () => {
    const t = hablaCon({ tienda: TIENDA });
    expect(t.mensajes).toHaveLength(1);
    expect(urlDelBoton(t)).toBe(TIENDA.enlaceMapa);
    expect(interactivo(t)?.body?.text).toContain(TIENDA.direccion);
    expect(interactivo(t)?.body?.text).toContain('Horario: ' + TIENDA.horario);
    expect(llamoAlModelo(t)).toBe(false);
    expect(t.avisos).toHaveLength(0);
  });
  it('el catálogo manda: si ambos traen dato, gana el del catálogo', () => {
    const t = hablaCon({ tienda: TIENDA }, { ubicacionTienda: DIR, mapaTienda: MAPA, horarioTienda: HORARIO });
    expect(urlDelBoton(t)).toBe(TIENDA.enlaceMapa);
    expect(interactivo(t)?.body?.text).toContain(TIENDA.direccion);
    expect(interactivo(t)?.body?.text).not.toContain(DIR);
    expect(interactivo(t)?.body?.text).not.toContain(HORARIO);
  });
  it('respaldo POR SUBCAMPO: el catálogo sin enlace (null) usa el mapa del tenant y conserva su dirección', () => {
    const t = hablaCon({ tienda: { ...TIENDA, enlaceMapa: null, horario: null } }, { mapaTienda: MAPA, horarioTienda: HORARIO });
    expect(urlDelBoton(t)).toBe(MAPA);
    expect(interactivo(t)?.body?.text).toContain(TIENDA.direccion);
    expect(interactivo(t)?.body?.text).toContain('Horario: ' + HORARIO);
  });
  it('sin enlace pero con coordenadas en rango: el enlace limpio de Google Maps; fuera de rango o no numéricas, no', () => {
    const t = hablaCon({ tienda: { ...TIENDA, enlaceMapa: null, coordenadas: { lat: -16.5, lng: -68.15 } } });
    expect(urlDelBoton(t)).toBe('https://www.google.com/maps/search/?api=1&query=-16.500000%2C-68.150000');
    for (const c of [{ lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: '1', lng: '2' }, { lat: null, lng: null }]) {
      const n = hablaCon({ tienda: { ...TIENDA, enlaceMapa: null, coordenadas: c } });
      expect(interactivo(n)?.type).toBeUndefined();
      expect(textos(n)[0]).toContain(TIENDA.direccion);
    }
  });
  it('un enlace del catálogo que no es de Google Maps no sale; con coordenadas válidas se arma el limpio', () => {
    for (const malo of ['https://evil.example.com/maps', 'http://maps.app.goo.gl/x', 'https://www.google.com/url?q=https://evil.example.com', 'https://maps.app.goo.gl/../x']) {
      const t = hablaCon({ tienda: { ...TIENDA, enlaceMapa: malo, coordenadas: { lat: 1, lng: 2 } } });
      expect(urlDelBoton(t)).toBe('https://www.google.com/maps/search/?api=1&query=1.000000%2C2.000000');
      const u = hablaCon({ tienda: { ...TIENDA, enlaceMapa: malo } });
      expect(JSON.stringify(u.mensajes)).not.toMatch(/evil/);
    }
  });
  it('catálogo CAÍDO: usa el respaldo del tenant (y lo mismo con `tienda` ausente o con todos los subcampos null)', () => {
    for (const cat of ['cae', catalogoOk(), catalogoOk({ tienda: { nombre: null, direccion: null, enlaceMapa: null, coordenadas: null, horario: null } }), catalogoOk({ tienda: 'raro' }), catalogoOk({ tienda: null })] as never[]) {
      const t = hablar(crear({ catalogo: cat, base: { ubicacionTienda: DIR, mapaTienda: MAPA }, modeloDice: ADVERSO }), ANA, mTexto('dónde queda'));
      expect(urlDelBoton(t)).toBe(MAPA);
      expect(interactivo(t)?.body?.text).toContain(DIR);
      expect(llamoAlModelo(t)).toBe(false);
    }
  });
  it('catálogo caído y sin respaldo: recepción (aviso + botón), nada inventado', () => {
    const t = hablar(crear({ catalogo: 'cae', modeloDice: ADVERSO }), ANA, mTexto('dónde queda'));
    expect(urlDelBoton(t)).toContain('wa.me/' + REC);
    expect(t.avisos).toHaveLength(1);
    expect(JSON.stringify(t.mensajes)).not.toMatch(/Inventada|goo\.gl/);
  });
  it('un texto con enlaces o dominios (dirección u horario, del catálogo o del respaldo) es «sin dato»', () => {
    for (const sucio of ['Visítenos en https://evil.example.com', 'www.evil.example', 'escriba a promo.com/oferta', 'ver evil.com']) {
      const t = hablaCon({ tienda: { ...TIENDA, direccion: sucio, horario: sucio } }, { ubicacionTienda: sucio, horarioTienda: sucio });
      expect(JSON.stringify(t.mensajes)).not.toMatch(/evil|promo/);
      expect(interactivo(t)?.body?.text).not.toMatch(/Horario/);
    }
  });
  it('quita las marcas de WhatsApp de la dirección y el horario', () => {
    const t = hablaCon({ tienda: { ...TIENDA, direccion: '*Av.* _Catálogo_ ~s/n~ `zona`', horario: '*de 9 a 19*' } });
    expect(interactivo(t)?.body?.text).toContain('Av. Catálogo s/n zona');
    expect(interactivo(t)?.body?.text).toContain('Horario: de 9 a 19');
    expect(interactivo(t)?.body?.text).not.toMatch(/[*_~`]/);
  });
});

describe('frases nuevas de la intención, de punta a punta', () => {
  const SI = ['¿me puedes enviar la ubicación?', 'me pueden mandar la dirección?', 'me podría pasar la ubicación?', 'pásenme la ubicación', 'mándenme la dirección', 'y la dirección?', '¿Dónde están ubicados en Cochabamba?', 'dónde están en La Paz'];
  const NO = ['necesito cambiar la dirección', 'quiero cambiar la dirección', 'quiero darles la dirección', 'favor anoten la dirección', 'quisiera saber la dirección para que me lo traigan', 'ya tienen la dirección?'];
  for (const f of SI) it(`«${f}» responde la ubicación`, () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA }, modeloDice: ADVERSO }), ANA, mTexto(f));
    expect(plan(t).plan).toBe('ubicacion_tienda');
    expect(llamoAlModelo(t)).toBe(false);
  });
  for (const f of NO) it(`NEGADO «${f}» no responde la ubicación`, () => {
    const t = hablar(crear({ base: { ubicacionTienda: DIR, mapaTienda: MAPA }, modeloDice: modelo('Con gusto.') }), ANA, mTexto(f));
    expect(plan(t).plan).not.toBe('ubicacion_tienda');
    expect(JSON.stringify(t.mensajes)).not.toContain(MAPA);
  });
});
