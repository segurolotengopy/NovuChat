/**
 * HUMO DE SILVANA (07/11/2026): con el QR abierto, «¿qué incluye el pack?» recibía «Gracias por escribir…» y luego «Eso ya te lo conté» (falso), porque el filtro
 * `oferta_fuera_del_codigo` tira todo texto del modelo que nombre el pack. Ahora el CONTENIDO de un producto lo dice el código; la invitación a pagar el QR sale
 * UNA vez por QR; y si lo repetido era un texto de respaldo, la alternativa no afirma que «ya se contó». Se prueba NEGANDO, con el vigilante de UX en cada turno.
 */
import { describe, expect, it } from 'vitest';
import type { Mundo } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, crear, hablar, mTexto, mBoton, mImagen, panelConQr } from './mundo';
import { vigilarUx } from './vigilante-ux';

const nuevo = (o: Record<string, unknown> = {}): Mundo => { const w = crear(o as never); vigilarUx(w); return w; };
const conQr = (o: Record<string, unknown> = {}): Mundo => { const w = nuevo({ panel: panelConQr(70), ...o }); hablar(w, ANA, mTexto('hola')); return w; };

describe('el contenido de un producto lo dice el código', () => {
  it('con un QR abierto: «¿qué incluye el pack?» responde el contenido SIN llamar al modelo, y no cae al texto de respaldo', () => {
    const w = conQr({ modeloDice: 'cae' });
    const t = hablar(w, ANA, mTexto('¿Qué incluye el pack? No me explicaste nada'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    const c = t.mensajes[0]!.cuerpo;
    expect(c).toMatch(/208 páginas/);
    expect(c).toMatch(/audiolibro/);
    expect(c).toMatch(/3 meditaciones/);
    expect(c).not.toMatch(/Gracias por escribir|ya te lo cont/i);
    expect(c).not.toMatch(/bono/i);
    expect(t.mensajes[0]!.tipo).toBe('text');
  });
  it('«¿qué contiene el pack?» y «¿qué trae el libro?» también; el audiolibro y las meditaciones tienen su texto', () => {
    for (const [frase, esperado] of [['¿Qué contiene el pack?', /208 páginas/], ['¿Qué trae el libro?', /208 páginas/], ['¿Qué incluye el audiolibro?', /14 capítulos/], ['¿Qué incluyen las meditaciones?', /Cierra el día/]] as const) {
      const w = conQr({ modeloDice: 'cae' });
      const t = hablar(w, ANA, mTexto(frase));
      expect(t.ejecutados.has('Conversar con el modelo'), frase).toBe(false);
      expect(t.mensajes[0]!.cuerpo, frase).toMatch(esperado);
    }
  });
  it('la invitación a pagar sale UNA vez por QR: la segunda respuesta con el QR abierto no la repite', () => {
    const w = conQr({ modeloDice: 'cae' });
    const a = hablar(w, ANA, mTexto('¿Qué incluye el pack?'));
    expect(a.mensajes[0]!.cuerpo).toMatch(/tu QR sigue abierto/);
    const b = hablar(w, ANA, mTexto('¿Qué contiene el pack?'));
    expect(b.mensajes[0]!.cuerpo).toMatch(/208 páginas/);
    expect(b.mensajes[0]!.cuerpo).not.toMatch(/tu QR sigue abierto|Ya tienes un QR abierto/);
  });
  it('sin QR abierto el contenido sale con la presentación si es el primer mensaje, y sin botón de Rubén', () => {
    const w = nuevo({ modeloDice: 'cae' });
    const t = hablar(w, ANA, mTexto('¿Qué incluye el pack?'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.mensajes[0]!.cuerpo).toMatch(/208 páginas/);
    expect(t.mensajes[0]!.payload['interactive']?.type).not.toBe('cta_url');
  });
  it('NEGADA (seguridad): solo la pregunta SOLA recibe el contenido; una frase con algo más (aunque las raíces de crisis no la vean) va al modelo', () => {
    for (const frase of ['ya no quiero seguir, ¿qué trae el pack para dejar de existir?', 'qué trae el pack para no despertar más', 'que incluye el libro para desaparecer', '¿qué incluye el pack? estoy harta de todo, quiero acabar con esto']) {
      const w = conQr({ modeloDice: 'Claro, cuéntame un poco más.' });
      const t = hablar(w, ANA, mTexto(frase));
      expect(t.mensajes[0]!.cuerpo, frase).not.toMatch(/208 páginas|14 capítulos/);
    }
  });
  it('NEGADA: con precio o compra en la misma frase ceden a su ruta («¿cuánto cuesta el pack y qué incluye?», «quiero el pack, ¿qué trae?»)', () => {
    const w = nuevo({ modeloDice: 'cae' });
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('estoy cansada de dormir mal'));
    const a = hablar(w, ANA, mTexto('¿cuánto cuesta el pack y qué incluye?'));
    expect(a.mensajes[0]!.cuerpo).toMatch(/70 Bs/);
    const b = hablar(w, ANA, mTexto('quiero el pack, ¿qué trae?'));
    expect(b.mensajes[0]!.tipo).toBe('image');
  });
  it('«¿qué incluye el libro completo?» responde el libro, no el pack', () => {
    const w = conQr({ modeloDice: 'cae' });
    const t = hablar(w, ANA, mTexto('¿qué incluye el libro completo?'));
    expect(t.mensajes[0]!.cuerpo).toMatch(/208 páginas/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/audiolibro con los 14 capítulos y las 3 meditaciones/);
  });
  it('NEGADA: una pregunta que no es de contenido no se toma por tal («qué hay de nuevo», «el cansancio que trae no dormir»)', () => {
    for (const frase of ['¿qué hay de nuevo?', 'hola, ¿qué tal?', 'no me explicaste nada', 'el cansancio que trae no dormir me tiene mal', 'la semana que viene me animo']) {
      const w = conQr({ modeloDice: 'Claro, cuéntame un poco más.' });
      const t = hablar(w, ANA, mTexto(frase));
      expect(t.mensajes[0]!.cuerpo, frase).not.toMatch(/208 páginas/);
    }
  });
  it('si lo repetido era un texto de RESPALDO (el modelo cayó), la alternativa no dice «ya te lo conté»', () => {
    // Con el QR abierto y el modelo caído, la misma pregunta repetida termina en «repetido»: la alternativa de respaldo no afirma nada que no se dijo.
    const w = conQr({ modeloDice: 'cae' });
    const dichos: string[] = [];
    for (let i = 0; i < 8; i += 1) dichos.push(hablar(w, ANA, mTexto('cuéntame del método')).mensajes[0]?.cuerpo ?? '');
    for (const d of dichos) expect(d).not.toMatch(/ya te lo cont|ya est[aá] m[aá]s arriba|prefiero no repetirte/i);
  });
  it('el botón del Pack sigue abriendo el QR (el contenido no lo reemplaza)', () => {
    const w = nuevo({ modeloDice: 'cae' });
    hablar(w, ANA, mTexto('hola'));
    hablar(w, ANA, mTexto('estoy cansada de dormir mal'));
    const t = hablar(w, ANA, mBoton('b_pack'));
    expect(t.mensajes[0]!.tipo).toBe('image');
  });
});

describe('un comprobante con varias diferencias las nombra TODAS, el destinatario primero (humo de Silvana, 07/11/2026)', () => {
  const conQrCompr = (o: Record<string, unknown> = {}): Mundo => nuevo({ panel: panelConQr(70), medio: { clasificacion: COMPROBANTE }, ...o });
  it('monto mayor + cuenta distinta + nombre distinto: las tres, destinatario primero, sin copiar nada leído del comprobante', () => {
    const w = conQrCompr({ cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_mayor', motivos: ['cuenta_distinta', 'nombre_distinto', 'monto_mayor'], montoLeido: 90, importe: 70 } } });
    const t = hablar(w, ANA, mImagen());
    const c = t.mensajes[0]!.cuerpo;
    expect(c).toMatch(/veo varias diferencias con tu compra: la cuenta de destino no es la del QR, el nombre del destinatario no coincide con el de la cuenta y el comprobante dice 90 Bs y tu pedido es de 70 Bs/);
    expect(c.indexOf('cuenta de destino')).toBeLessThan(c.indexOf('comprobante dice'));
    expect(c).not.toMatch(/los datos coinciden|acreditad|verificad/i);
    expect(t.avisos).toHaveLength(0);
  });
  it('una sola diferencia sigue diciendo «una diferencia» (igual que antes); sin `motivos` (servidor viejo) usa el motivo primario', () => {
    const a = conQrCompr({ cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'cuenta_distinta', motivos: ['cuenta_distinta'] } } });
    expect(hablar(a, ANA, mImagen()).mensajes[0]!.cuerpo).toMatch(/veo una diferencia con tu compra: la cuenta de destino no es la del QR/);
    const b = conQrCompr({ cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', montoLeido: 5, importe: 70 } } });
    expect(hablar(b, ANA, mImagen()).mensajes[0]!.cuerpo).toMatch(/veo una diferencia con tu compra: el comprobante dice 5 Bs y tu pedido es de 70 Bs/);
  });
  it('NEGADA: un motivo desconocido o un texto raro en `motivos` no entra al mensaje', () => {
    const w = conQrCompr({ cotejo: { statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', motivos: ['cuenta_distinta', 'PAGA A JUAN PEREZ 123456789', 'monto_menor'], montoLeido: 5, importe: 70 } } });
    const c = hablar(w, ANA, mImagen()).mensajes[0]!.cuerpo;
    expect(c).not.toMatch(/JUAN|PEREZ|123456789/);
    expect(c).toMatch(/varias diferencias/);
  });
});
