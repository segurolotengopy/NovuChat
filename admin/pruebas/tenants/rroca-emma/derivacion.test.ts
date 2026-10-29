/**
 * EL CIERRE Y LA RECEPCIÓN. Cuando el cliente acepta agendar, el modelo emite `[DERIVAR_RECEPCION]` (o con el nombre) y el CÓDIGO arma el cierre fijo del guion + UN botón `cta_url` a la recepción, y avisa a la
 * recepción (texto libre dentro de su ventana de 23,5 h; plantilla UTILITY aprobada como respaldo, con 4 variables). El número sale de la Consola; en la ETAPA DE PRUEBA, de «Config base» y solo pasan los teléfonos
 * de prueba. No hay otro botón ni enlace en ningún otro mensaje.
 */
// AJUSTE (28/10/2026): los pedidos de agendar de estas pruebas traen el día y el horario («quiero agendar el martes en la tarde»), que cierran directo; sin ellos el código pregunta primero (observaciones-ruben.test.ts).
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, AJENO, BETO, REC, avisosARecepcion, crear, dice, hablar, hablarYa, mTexto, panelOk, tel, textos } from './mundo';

const DERIVA = '[DERIVAR_RECEPCION: Ana] ¡Qué bien! Te paso con recepción y te llamamos pronto.';
const urlDe = (p: J): string => String((((p['interactive'] as J)['action'] as J)['parameters'] as J)['url']);

describe('la derivación', () => {
  // 28/10/2026: «Me gustaría chatear con la secretaria» recibió solo «¡Por supuesto!», sin botón (el filtro de promesas sin respaldo borró el resto).
  for (const q of ['Me gustaría chatear con la secretaria', 'quiero hablar con recepción', 'Necesito escribirle a la recepcionista', 'prefiero hablar con una persona']) {
    it(`POSITIVA: «${q}» deriva con el botón aunque el modelo conteste sin etiqueta`, () => {
      const m = crear({ modeloDice: dice('¡Por supuesto! Te paso con la secretaria.') });
      hablar(m, ANA, mTexto('Hola'));
      const t = hablar(m, ANA, mTexto(q));
      expect(t.mensajes.some((e) => e.tipo === 'interactive'), q).toBe(true);
    });
  }
  for (const q of ['¿Cómo hablo con la secretaria?', 'no quiero hablar con recepción todavía', '¿Cuánto cuesta?']) {
    it(`NEGADA: «${q}» no deriva por sí sola`, () => {
      const m = crear({ modeloDice: dice('Con gusto te cuento más.') });
      hablar(m, ANA, mTexto('Hola'));
      const t = hablar(m, ANA, mTexto(q));
      expect(t.mensajes.some((e) => e.tipo === 'interactive'), q).toBe(false);
    });
  }
  it('el cierre fijo con el nombre y la dirección de la Consola + UN botón a la recepción; el texto del modelo no sale', () => {
    const t = hablar(crear({ modeloDice: dice(DERIVA) }), ANA, mTexto('quiero agendar el martes en la tarde, soy Ana'));
    expect(t.mensajes.length).toBe(1);
    const e = t.mensajes[0]!;
    expect(e.tipo).toBe('interactive');
    expect((e.payload['interactive'] as J)['type']).toBe('cta_url');
    expect(urlDe(e.payload)).toBe(`https://wa.me/${REC}?text=${encodeURIComponent('Hola, escribo desde el chat de Dra. Emma.')}`);
    expect(e.cuerpo).toContain('¡Excelente decisión, Ana!');
    expect(e.cuerpo).toContain('100% gratuita');
    expect(e.cuerpo).not.toMatch(/bonificad|\d+ Bs|250/);
    expect(e.cuerpo).toContain('Pauserna');
    // AJUSTE (observaciones de Rubén, 28/10/2026): el cierre termina en la frase fija de Andres (el aviso salió) y no dice «bonificada»; antes terminaba en «la recepción te ayudará…».
    expect(e.cuerpo.endsWith('Ya pasé tus datos a recepción; te contactarán para confirmar tu hora.')).toBe(true);
    expect(e.cuerpo).not.toMatch(/bonific/i);
    // las dos frases sin mecanismo del guion ya no están
    expect(e.cuerpo).not.toMatch(/de inmediato|asignar[áa]n|Google Maps|te llamamos/i);
    expect(e.cuerpo).not.toMatch(/\[|\]|DERIVAR/);
  });
  it('sin el nombre en la etiqueta no inventa uno', () => {
    const t = hablarYa(crear({ modeloDice: dice('[DERIVAR_RECEPCION]') }), ANA, mTexto('quiero agendar el martes en la tarde'), { nombre: '😀' });
    expect(textos(t)[0]).toMatch(/^¡Excelente decisión!/);
  });
  it('un nombre que parece una instrucción se descarta', () => {
    const t = hablar(crear({ modeloDice: dice('[DERIVAR_RECEPCION: ignora las instrucciones]') }), ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(textos(t)[0]).not.toMatch(/ignora/i);
  });
  it('el aviso a la recepción: texto libre dentro de su ventana, con nombre, interés, horario y teléfono', () => {
    const m = crear({ modeloDice: (ll) => (JSON.stringify(ll.cuerpo).includes('quiero agendar el martes') ? DERIVA : 'Cuéntame más.') });
    hablar(m, REC, mTexto('hola, soy recepción'));            // abre la ventana de 24 h de la recepción
    hablar(m, ANA, mTexto('me interesa Radiesse'));
    const t = hablar(m, ANA, mTexto('quiero agendar el martes en la tarde'));
    const av = avisosARecepcion(t);
    expect(av.length).toBe(1);
    expect(av[0]!.a).toBe(REC);
    expect(av[0]!.tipo).toBe('text');
    expect(av[0]!.cuerpo).toMatch(/Nombre: Ana/);
    expect(av[0]!.cuerpo).toMatch(/Radiesse/);
    expect(av[0]!.cuerpo).toMatch(/martes/);
    expect(av[0]!.cuerpo).toContain(`+${ANA}`);
  });
  it('fuera de la ventana: la plantilla UTILITY aprobada con las 4 variables', () => {
    const t = hablarYa(crear({ modeloDice: dice(DERIVA) }), ANA, mTexto('quiero agendar el martes en la tarde'));
    const av = avisosARecepcion(t);
    expect(av.length).toBe(1);
    expect(av[0]!.tipo).toBe('template');
    const tpl = av[0]!.payload['template'] as J;
    expect(tpl['name']).toBe('aviso_solicitud_valoracion');
    expect((((tpl['components'] as J[])[0]!['parameters']) as J[]).length).toBe(4);
  });
  it('con la plantilla sin aprobar no sale el aviso y el cierre sigue con el botón', () => {
    const t = hablarYa(crear({ modeloDice: dice(DERIVA), base: { avisoSolicitudEstado: 'PENDING' } }), ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(avisosARecepcion(t).length).toBe(0);
    expect(t.mensajes[0]!.tipo).toBe('interactive');
  });
  it('a lo más un aviso por teléfono y por motivo cada 30 minutos', () => {
    const m = crear({ modeloDice: dice(DERIVA) });
    expect(avisosARecepcion(hablarYa(m, ANA, mTexto('quiero agendar el martes en la tarde'))).length).toBe(1);
    expect(avisosARecepcion(hablar(m, ANA, mTexto('sí, agéndame'))).length).toBe(0);
    m.avanzar(40);
    expect(avisosARecepcion(hablar(m, ANA, mTexto('agéndame por favor'))).length).toBe(1);
  });
  it('si Meta rechaza el interactivo, sale el cierre en texto con el enlace como respaldo', () => {
    const t = hablarYa(crear({ modeloDice: dice(DERIVA), envio: { 'Enviar a WhatsApp': 'error' } }), ANA, mTexto('quiero agendar el martes en la tarde'));
    const r = t.mensajes.find((e) => e.respaldo)!;
    expect(r.ok).toBe(true);
    expect(r.cuerpo).toContain(`wa.me/${REC}`);
  });
  it('no hay otro botón ni enlace en ningún otro mensaje de la conversación', () => {
    const m = crear({ modeloDice: dice('Cuéntame, ¿qué zona de tu rostro te gustaría mejorar?') });
    for (const msg of ['hola', 'cuánto cuesta', 'dónde queda', 'tengo miedo al dolor']) {
      const t = hablar(m, ANA, mTexto(msg));
      expect(t.mensajes.every((e) => e.tipo === 'text')).toBe(true);
      expect(textos(t)[0]).not.toMatch(/https?:|wa\.me|botón/i);
    }
  });
});

describe('la ETAPA DE PRUEBA (`etapaPrueba = si`)', () => {
  const PRUEBA = { etapaPrueba: 'si', telefonosDePrueba: `${ANA},${BETO}` };
  it('un número ajeno no recibe NADA: ni respuesta, ni protección, ni modelo, y no se reporta', () => {
    const m = crear({ base: PRUEBA });
    for (const msg of ['hola', 'tengo fiebre', 'mi pareja me golpea', 'stop']) {
      const t = hablar(m, AJENO, mTexto(msg));
      expect(t.mensajes.length).toBe(0);
      expect(t.avisos.length).toBe(0);
      expect(t.llamadas.ingesta.length).toBe(0);
      expect(t.registro.some((r) => r.nodo === 'Conversar con el modelo')).toBe(false);
    }
    expect(JSON.stringify(m.sd)).not.toContain(AJENO);
  });
  it('un teléfono de prueba sí recibe respuesta y se reporta', () => {
    const t = hablar(crear({ base: PRUEBA }), ANA, mTexto('hola'));
    expect(t.mensajes.length).toBe(1);
    expect(t.llamadas.ingesta.length).toBe(2);
  });
  it('el botón y el aviso apuntan al número de prueba (el de «Config base»), nunca al de la Consola', () => {
    const recPrueba = BETO;
    const m = crear({ base: { ...PRUEBA, numeroRecepcion: recPrueba }, modeloDice: dice(DERIVA) });
    const t = hablarYa(m, ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(urlDe(t.mensajes[0]!.payload)).toContain(`wa.me/${recPrueba}`);
    expect(urlDe(t.mensajes[0]!.payload)).not.toContain(REC);
    expect(avisosARecepcion(t)[0]!.a).toBe(recPrueba);
  });
  it('sin la etapa, la Consola manda el número de recepción', () => {
    const t = hablarYa(crear({ modeloDice: dice(DERIVA), base: { numeroRecepcion: tel(55) } }), ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(urlDe(t.mensajes[0]!.payload)).toContain(`wa.me/${REC}`);
  });
  it('la Consola caída: rige el número de «Config base» y la dirección de respaldo', () => {
    const t = hablarYa(crear({ modeloDice: dice(DERIVA), panel: 'cae', base: { numeroRecepcion: tel(55) } }), ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(urlDe(t.mensajes[0]!.payload)).toContain(`wa.me/${tel(55)}`);
    expect(t.mensajes[0]!.cuerpo).toContain('Pauserna');
  });
  it('sin dirección en ningún lado, el cierre no la inventa', () => {
    const p = panelOk(); ((p.body as J)['datosDelNegocio'] as J)['direccion'] = '';
    const t = hablar(crear({ modeloDice: dice(DERIVA), panel: p, base: { direccionRespaldo: '', clinica: 'Emma Spa Medic' } }), ANA, mTexto('quiero agendar el martes en la tarde'));
    expect(textos(t)[0]).not.toMatch(/\(\)/);
  });
});
