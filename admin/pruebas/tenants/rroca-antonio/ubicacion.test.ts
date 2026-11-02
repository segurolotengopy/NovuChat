/**
 * LA UBICACIÓN (02/11/2026): cuando el cliente pide la ubicación, el CÓDIGO responde con la dirección y el enlace de Maps de la Consola
 * (misma regla que `enlaceDeMapaValido` del servidor). Sin ese dato no se inventa nada: se pasa con Antonio (aviso + botón). El modelo no interviene
 * y el prompt sigue prohibiéndole los enlaces. Cero mensajes por conversación agregados o quitados: un mensaje por turno, igual que antes.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, crear, hablar, mTexto, panelConQr, panelOk } from './mundo';
import type { ResultadoTurno } from '../../lib/flujo';

const MAPS = 'https://maps.app.goo.gl/AbC123xyz';
const DIR = 'Calle de ejemplo 123, zona centro';
const panel = (dn: J) => { const p = panelOk(); p.body['datosDelNegocio'] = { nombreNegocio: 'El Puente', ...dn }; return p; };
const turno = (dn: J, q: string, opciones: { modelo?: string } = {}) => {
  const w = crear({ panel: panel(dn), ...(opciones.modelo ? { modeloDice: opciones.modelo } : {}) });
  hablar(w, ANA, mTexto('Hola'));
  return hablar(w, ANA, mTexto(q));
};
const todo = (t: ResultadoTurno) => t.mensajes.map((m) => m.cuerpo).join('\n');
const esBoton = (t: ResultadoTurno) => t.mensajes[0]?.payload['interactive']?.type === 'cta_url';
const avisos = (t: ResultadoTurno) => t.ejecutados.has('Enviar aviso');

describe('(a) pide la ubicación y hay dato válido: sale el enlace y la dirección', () => {
  for (const q of ['¿dónde quedan?', 'mándame el mapa', 'cómo llego', 'cuál es su dirección?', 'me das la ubicación exacta', '¿dónde está ubicado?', 'pásame el mapa de cómo llegar', '¿dónde atienden?']) {
    it(`«${q}»`, () => {
      const t = turno({ direccion: DIR, direccionMaps: MAPS }, q);
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).toContain('📍 Ubicación: ' + MAPS);
      expect(todo(t)).toContain(DIR);
      expect(t.ejecutados.has('Conversar con el modelo'), 'sin modelo').toBe(false);
      expect(esBoton(t)).toBe(false);
      expect(avisos(t)).toBe(false);
    });
  }
  it('solo el enlace, sin dirección en texto: sale el enlace y no se inventa dirección', () => {
    const t = turno({ direccionMaps: MAPS }, '¿dónde quedan?');
    expect(todo(t)).toContain(MAPS);
    expect(todo(t)).not.toContain('Nos ubicamos en');
  });
  it('solo la dirección, sin enlace: sale la dirección y ningún enlace', () => {
    const t = turno({ direccion: DIR }, '¿dónde quedan?');
    expect(todo(t)).toContain(DIR);
    expect(todo(t)).not.toMatch(/https?:|📍/);
  });
});

describe('(b) enlace inválido: no sale y se ofrece recepción', () => {
  const MALOS: Array<[string, string]> = [
    ['host ajeno', 'https://maps.ejemplo.com/AbC'],
    ['http', 'http://maps.app.goo.gl/AbC123'],
    ['javascript:', 'javascript:alert(1)'],
    ['con espacios', 'https://maps.app.goo.gl/AbC 123'],
    ['más de 200 caracteres', 'https://maps.app.goo.gl/' + 'a'.repeat(190)],
    ['dominio parecido', 'https://maps.app.goo.gl.otro.example/x'],
  ];
  for (const [nombre, valor] of MALOS) {
    it(`${nombre}: sin dirección, no sale el enlace y se pasa con Antonio (aviso + botón)`, () => {
      const t = turno({ direccionMaps: valor }, '¿dónde quedan?');
      expect(t.mensajes).toHaveLength(1);
      expect(todo(t)).not.toContain(valor);
      expect(todo(t)).not.toMatch(/https?:|📍/);
      expect(esBoton(t)).toBe(true);
      expect(avisos(t)).toBe(true);
    });
    it(`${nombre}: con dirección en texto, sale solo la dirección y nunca el enlace`, () => {
      const t = turno({ direccion: DIR, direccionMaps: valor }, '¿dónde quedan?');
      expect(todo(t)).toContain(DIR);
      expect(todo(t)).not.toContain(valor);
      expect(todo(t)).not.toContain('📍');
    });
  }
  it('una dirección en texto que trae un enlace se descarta entera', () => {
    const t = turno({ direccion: 'https://ejemplo.com/ir' }, '¿dónde quedan?');
    expect(todo(t)).not.toContain('ejemplo.com');
    expect(esBoton(t)).toBe(true);
  });
});

describe('(c) sin dato: no se inventa nada y se ofrece recepción', () => {
  it('Antonio hoy: sin dirección ni enlace', () => {
    const t = turno({}, '¿dónde quedan?');
    expect(t.mensajes).toHaveLength(1);
    expect(esBoton(t)).toBe(true);
    expect(avisos(t)).toBe(true);
    expect(todo(t)).toMatch(/no tengo la direcci/);
    expect(todo(t)).not.toMatch(/https?:|📍|Nos ubicamos|calle|avenida|zona/i);
    expect(t.ejecutados.has('Conversar con el modelo'), 'el modelo no improvisa una dirección').toBe(false);
  });
  it('el aviso a Antonio lleva el motivo «ubicacion» y ningún enlace', () => {
    const t = turno({}, 'mándame el mapa');
    const av = (t.porNodo['Armar avisos']?.[0] ?? {}) as Record<string, unknown>;
    expect(av['clave']).toBe('ubicacion');
    expect(av['planeado']).toBe(true);
    expect(JSON.stringify(av)).not.toMatch(/https?:/);
  });
});

describe('(d) no pide la ubicación: no se agrega nada', () => {
  for (const q of ['¿cuánto cuesta el libro?', 'cuéntame del método', 'gracias']) {
    it(`«${q}» no lleva ubicación aunque la Consola la tenga`, () => {
      const t = turno({ direccion: DIR, direccionMaps: MAPS }, q);
      expect(todo(t), q).not.toContain(MAPS);
      expect(todo(t), q).not.toContain('📍');
      expect(todo(t), q).not.toContain(DIR);
    });
  }
});

describe('(d2) frases que NO piden la ubicación del negocio (un comprador que ya pagó no recibe «no tengo la dirección»)', () => {
  const NO = ['¿dónde están mis libros?', 'ya pagué, ¿dónde están los archivos?', 'donde estan los bonos', '¿dónde queda el enlace de descarga?', 'a qué dirección de correo me lo mandan',
    'mi dirección de correo es ana' + '@' + 'dominio.example', '¿en qué dirección de email llega?', 'cómo llego a la página de pago', 'donde puedo ir a pagar', 'donde estamos con mi pedido', '¿el libro trae un mapa mental?',
    'mi dirección es calle 5', '¿dónde queda mi pedido?'];
  for (const q of NO) {
    it(`«${q}» no activa la ubicación ni su derivación`, () => {
      for (const dn of [{}, { direccion: DIR, direccionMaps: MAPS }]) {
        const t = turno(dn, q);
        const av = (t.porNodo['Armar avisos']?.[0] ?? {}) as Record<string, unknown>;
        expect(av['clave'], q).not.toBe('ubicacion');
        expect(todo(t), q).not.toMatch(/no tengo la direcci|📍|Nos ubicamos/);
      }
    });
  }
});

describe('prioridades: la ubicación no pisa la cancelación, el cobro ni la queja de no entrega', () => {
  it('«cancela mi pedido, ¿dónde quedan?» con un QR abierto cancela (no responde la ubicación)', () => {
    const w = crear({ panel: panelConQr(49, { datosDelNegocio: { nombreNegocio: 'El Puente', direccion: DIR, direccionMaps: MAPS } }) });
    hablar(w, ANA, mTexto('Hola'));
    const t = hablar(w, ANA, mTexto('cancela mi pedido, ¿dónde quedan?'));
    expect(todo(t)).not.toContain('📍');
    expect(todo(t)).toMatch(/pedido/i);
  });
  it('con un QR abierto, «ya pagué, ¿dónde quedan?» sigue el camino del pago, no la ubicación', () => {
    const w = crear({ panel: panelConQr(49, { datosDelNegocio: { nombreNegocio: 'El Puente', direccion: DIR, direccionMaps: MAPS } }) });
    hablar(w, ANA, mTexto('Hola'));
    const t = hablar(w, ANA, mTexto('ya pagué, ¿dónde quedan?'));
    expect(todo(t)).not.toContain('📍');
  });
  it('con un QR abierto, «¿dónde quedan?» sola recibe la ubicación y la invitación a pagar', () => {
    const w = crear({ panel: panelConQr(49, { datosDelNegocio: { nombreNegocio: 'El Puente', direccion: DIR, direccionMaps: MAPS } }) });
    hablar(w, ANA, mTexto('Hola'));
    const t = hablar(w, ANA, mTexto('¿dónde quedan?'));
    expect(t.mensajes).toHaveLength(1);
    expect(todo(t)).toContain(MAPS);
  });
});

describe('dirección con dominio sin esquema o con caracteres invisibles', () => {
  for (const d of ['bit.ly/abc', 'ejemplo.com/ir', 't.me/x', 'Calle 5 ejemplo.com', 'ht​tps://x', 'Calle⁠ 5 ﻿zona']) {
    it(`«${JSON.stringify(d)}» se descarta: sin dato válido se pasa con Antonio`, () => {
      const t = turno({ direccion: d }, '¿dónde quedan?');
      expect(todo(t)).not.toContain(d);
      expect(todo(t)).not.toMatch(/Nos ubicamos/);
      expect(esBoton(t)).toBe(true);
    });
  }
});

describe('(e) el modelo no puede poner el enlace por su cuenta', () => {
  it('si el modelo escribe un enlace de Maps en una charla, el filtro lo rechaza', () => {
    const t = turno({ direccion: DIR, direccionMaps: MAPS }, 'cuéntame de qué trata el método', { modelo: 'Claro, mira el mapa: ' + MAPS });
    expect(todo(t)).not.toContain(MAPS);
  });
  it('el prompt sigue prohibiéndole los enlaces y el filtro no permite ninguno', () => {
    const t = turno({ direccion: DIR, direccionMaps: MAPS }, 'cuéntame de qué trata el método', { modelo: 'Visita https://www.google.com/maps?q=1,2' });
    expect(todo(t)).not.toMatch(/https?:/);
  });
});

describe('(f) mensajes por conversación', () => {
  it('un mensaje por turno, como antes, con y sin dato', () => {
    for (const dn of [{}, { direccion: DIR, direccionMaps: MAPS }]) {
      const t = turno(dn, '¿dónde quedan?');
      expect(t.mensajes).toHaveLength(1);
    }
  });
});
