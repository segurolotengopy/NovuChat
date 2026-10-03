/**
 * EL FILTRO DE LA REDACCIÓN DEL MODELO (`Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js`).
 *
 * El modelo conversa, pero NADA de lo que escribe sale sin pasar por aquí. Cada regla tiene su caso positivo
 * (el texto se rechaza, con su MOTIVO) y su caso negativo (el texto honesto pasa): un filtro que rechaza todo
 * también pasaría las pruebas «rechaza X». Las reglas que son política de NovuChat no se pueden apagar con
 * `opciones`: la prueba lo comprueba.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RUTA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/comun-sin-agente/src/filtro-redaccion.js');
const FUENTE = readFileSync(RUTA, 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const F = ejecutar(`${FUENTE}\nreturn [{ json: { cmNorm, cmMotivoDeRechazo, cmRedaccionValida, cmPulirRedaccion, cmRevisarRedaccion, cmEnlacesDe } }];`, [{}])[0] as
  Record<'cmNorm' | 'cmMotivoDeRechazo' | 'cmRedaccionValida' | 'cmPulirRedaccion' | 'cmRevisarRedaccion' | 'cmEnlacesDe', Fn>;
const motivo = (t: string, o?: object): string => F.cmMotivoDeRechazo(t, o);

describe('el módulo es autosuficiente', () => {
  it('no usa funciones cn*, nodos ni los globales que n8n no tiene', () => {
    const sin = FUENTE.replace(/\/\/.*$/gm, '');
    expect(sin).not.toMatch(/\bcn[A-Z]\w*\(|\$\(|\$input|\$json|\brequire\(|\bURL\b|\bBuffer\b|\bcrypto\b|\bprocess\b/);
  });
  it('todos sus nombres llevan el prefijo cm o CM_', () => {
    const d = [...FUENTE.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]!);
    expect(d.filter((n) => !/^(cm[A-Z]|CM_)/.test(n))).toEqual([]);
  });
});

describe('un texto honesto sale', () => {
  for (const t of [
    'Tenemos lugar el viernes a las 11:30. ¿Te sirve?',
    'Gracias por escribirnos. ¿En qué te ayudo?',
    'Puedo ayudarte con tu pedido o con una reserva.',
    'Si quieres, te paso con una persona del equipo.',
  ]) {
    it(`«${t.slice(0, 40)}…»`, () => { expect(motivo(t)).toBe(''); expect(F.cmRedaccionValida(t)).toBe(true); });
  }
});

describe('cada regla rechaza con su motivo', () => {
  it('vacío, la marca SIN_RESPUESTA y el largo', () => {
    expect(motivo('')).toBe('vacio');
    expect(motivo('   ')).toBe('vacio');
    expect(motivo(undefined as unknown as string)).toBe('vacio');
    expect(motivo('SIN_RESPUESTA')).toBe('sin_respuesta');
    expect(motivo('a'.repeat(901))).toBe('largo');
    expect(motivo('a'.repeat(900))).toBe('');
    expect(motivo('a'.repeat(50), { maximo: 40 })).toBe('largo');
  });
  it('un MONTO nunca sale de la redacción (la cifra la dice el código)', () => {
    for (const t of ['Cuesta 250 Bs.', 'El total es Bs. 80', 'Son 12 bolivianos', 'Te cobramos $ 15', 'Vale 30 USD']) expect(motivo(t), t).toBe('monto');
    expect(motivo('Cuesta 250 Bs.', { permitirMontos: true })).toBe('');
    expect(motivo('Tenemos 3 horarios')).toBe('');
  });
  it('promesas sin mecanismo detrás: «te aviso», «lo consulto», «te llamamos»…', () => {
    for (const t of ['Lo consulto y te cuento', 'Te aviso mañana', 'Te llamamos pronto', 'Te escribirán en breve', 'Nos comunicaremos contigo', 'Te confirmo luego']) expect(motivo(t), t).toBe('promesa');
  });
  it('«<sujeto> te…» es promesa solo si el flujo lo declara en `quienPromete`', () => {
    expect(motivo('Recepción te escribe luego')).toBe('');
    expect(motivo('Recepción te escribe luego', { quienPromete: ['recepcion', 'el doctor'] })).toBe('promesa');
    expect(motivo('El doctor te llama', { quienPromete: ['recepcion', 'el doctor'] })).toBe('promesa');
    expect(motivo('Te paso con recepción', { quienPromete: ['recepcion'] })).toBe('');
  });
  it('afirmar un HECHO que solo el código puede afirmar: reserva, pedido, pago', () => {
    for (const t of [
      'Tu cita quedó agendada', 'Ya está confirmada tu reserva', 'Listo, tu pedido está registrado', 'Quedó reservado', 'Te agendé para el viernes',
      'Confirmo tu pedido', 'Tu reserva ya quedó', 'Tu pedido queda', 'Pago acreditado', 'Recibimos tu pago', 'Tu pago está verificado',
    ]) expect(motivo(t), t).toBe('afirma_un_hecho');
  });
  it('NIEGA: preguntar o prometer algo futuro NO es afirmar un hecho', () => {
    expect(motivo('¿Quieres que te ayude a agendar?')).toBe('');
    expect(motivo('Si me das tu nombre, puedo reservar el horario.')).toBe('');
  });
  it('nunca negar ser una IA (prohibición 4) ni decir que es una persona', () => {
    for (const t of ['No soy un bot', 'No soy una IA, soy una persona', 'Soy humano', 'No soy asistente virtual']) expect(motivo(t), t).toBe('afirma_un_hecho');
    expect(motivo('Soy el asistente virtual del consultorio')).toBe('');
  });
  it('un hueco de plantilla nunca sale', () => {
    for (const t of ['Tenemos a las ).', 'Hola {{nombre}}', 'Cita: undefined', 'Total: null', 'Hay lugar «»', 'Tu cita es ()', 'Vienes a las']) expect(motivo(t), t).toBe('hueco');
  });
  it('a una pregunta de IDENTIDAD no se contesta empezando con «Sí»', () => {
    expect(motivo('Sí, soy yo', { textoDelCliente: '¿eres el doctor?' })).toBe('identidad');
    expect(motivo('Sí.', { textoDelCliente: 'quien eres' })).toBe('identidad');
    expect(motivo('Soy el asistente virtual', { textoDelCliente: '¿eres el doctor?' })).toBe('');
    expect(motivo('Sí, tenemos lugar', { textoDelCliente: '¿hay lugar el viernes?' })).toBe('');
    expect(motivo('Sí, soy yo')).toBe('');
  });
  it('`prohibidos`: regex propias del negocio, contra el texto NORMALIZADO', () => {
    expect(motivo('Te recomiendo Paracetamol', { prohibidos: [/paracetamol|ibuprofeno/] })).toBe('prohibido');
    expect(motivo('Te recomiendo agua', { prohibidos: [/paracetamol/] })).toBe('');
  });
  it('enlaces: POR DEFECTO ninguno sale; solo los que el negocio declaró, completos', () => {
    const permitidos = ['https://maps.app.goo.gl/abc', 'https://www.instagram.com/negocio'];
    expect(motivo('Mira https://maps.app.goo.gl/abc.', { enlacesPermitidos: permitidos })).toBe('');
    expect(motivo('Mira https://www.instagram.com/negocio/', { enlacesPermitidos: permitidos })).toBe('');
    expect(motivo('Mira https://maliciosa.example/x', { enlacesPermitidos: permitidos })).toBe('enlace_ajeno');
    expect(motivo('Mira https://maliciosa.example/x', { enlacesPermitidos: [] })).toBe('enlace_ajeno');
    expect(motivo('Mira https://maliciosa.example/x')).toBe('enlace_ajeno');
    expect(motivo('Mira https://maps.app.goo.gl/abc')).toBe('enlace_ajeno');
    expect(motivo('Mira https://maliciosa.example/x', { enlacesPermitidos: null })).toBe('');
  });
  it('enlaces: se detectan también sin esquema (www., wa.me, dominios sueltos) y con caracteres invisibles', () => {
    for (const t of ['Entra a www.pago-falso.com', 'Escríbeme a wa.me/71234567', 'Mira pago-falso.com/x', 'Ve a bit.ly/abc', 'Mira https://pago-falso.com', 'Mira ｗｗｗ.pago-falso.com', 'Mira pago-falso​.com']) {
      expect(motivo(t, { enlacesPermitidos: ['https://www.instagram.com/negocio'] }), t).toBe('enlace_ajeno');
    }
  });
  it('NIEGA: un enlace que solo EMPIEZA como uno permitido no pasa (antes la comparación era por subcadena)', () => {
    const permitidos = ['https://wa.me/12345678'];
    expect(motivo('Escribe a https://wa.me/1', { enlacesPermitidos: permitidos })).toBe('enlace_ajeno');
    expect(motivo('Escribe a https://wa.me/123456789', { enlacesPermitidos: permitidos })).toBe('enlace_ajeno');
    expect(motivo('Escribe a https://wa.me/12345678?text=Hola', { enlacesPermitidos: permitidos })).toBe('');
  });
  it('NIEGA: lo que parece dominio pero no lo es no se rechaza (Dr.Pérez, 3.5, «e.g.»)', () => {
    expect(motivo('Con el Dr.Pérez tenemos lugar. Son 3.5 horas.', { enlacesPermitidos: [] })).toBe('');
  });
  it('`extra`: reglas propias del flujo (horas, etc.); su motivo sale tal cual', () => {
    const horaAjena = (t: string): string => (/\b3:00\b/.test(t) ? 'hora_ajena' : '');
    expect(motivo('Nos vemos a las 3:00', { extra: [horaAjena] })).toBe('hora_ajena');
    expect(motivo('Nos vemos a las 4:00', { extra: [horaAjena] })).toBe('');
  });
});

describe('lo que la revisión de seguridad hizo pasar (01/10): todo se rechaza ahora', () => {
  const rechaza = (lista: string[], esperado: string): void => {
    for (const t of lista) expect(motivo(t), t).toBe(esperado);
  };
  it('hechos que solo el código afirma: pago, cita, reprogramación, pedido, marcas ✅', () => {
    rechaza([
      'Pago recibido', 'Recibí tu pago', 'Ya recibimos el pago', 'Tu pago fue acreditado', 'Pago aprobado', 'Tu cita ha sido agendada', 'Tu cita fue agendada',
      'He reprogramado tu cita', 'Te he reservado', 'Registré tu pedido', 'Confirmé tu pedido', 'Anoté tu cita', 'Reserva confirmada', 'Pedido registrado', 'Cita agendada ✅',
      'Comprobante recibido', 'Tu abono fue acreditado', 'Pedido anotado',
    ], 'afirma_un_hecho');
  });
  it('la marca de visto bueno ✅ ✔ ☑ la pone el código, nunca el modelo (aunque no diga nada más)', () => {
    rechaza(['Todo en orden ✅', 'Hecho ✔', 'Perfecto ☑️'], 'afirma_un_hecho');
  });
  it('NIEGA: lo que SOLO ofrece o pregunta sigue saliendo', () => {
    for (const t of ['¿Quieres que te ayude a agendar una cita?', 'Si me das tu nombre, puedo reservar el horario.', 'Para cancelar toca el botón.', 'Te muestro los horarios disponibles.']) expect(motivo(t), t).toBe('');
  });
  it('negar ser una IA, en todas sus formas', () => {
    rechaza(['No soy una máquina', 'No soy un asistente, soy Ana', 'Hablas con una persona', 'Te atiende una persona real', 'Soy de carne y hueso', 'Soy una persona de verdad', 'No soy un programa'], 'afirma_un_hecho');
  });
  it('NIEGA: pasar con una persona del equipo NO es negar ser una IA', () => {
    expect(motivo('Te paso con una persona del equipo.')).toBe('');
    expect(motivo('Una persona del equipo continuará esta conversación.')).toBe('');
  });
  it('promesas con «le», futuro perifrástico y primera persona', () => {
    rechaza(['Le aviso', 'Le llamaremos', 'Te vamos a llamar', 'Te van a contactar', 'Consultaré y te cuento', 'Te confirmaré', 'Le confirmo mañana'], 'promesa');
  });
  it('montos en letra y en otras monedas', () => {
    rechaza(['Son cien bolivianos', 'Cuesta 100 BOB', 'Paga 50 USDT', 'Vale 50 dolares', 'Son cincuenta bolivianos', '25 $us'], 'monto');
  });
  it('NIEGA: «bolivianos» sin cifra o como gentilicio no es un monto', () => {
    expect(motivo('Atendemos a clientes bolivianos y de otros países.')).toBe('');
  });
  it('caracteres de ancho completo e invisibles no esconden una palabra', () => {
    rechaza(['Tu cita ｑｕｅｄó agendada', 'Te agen\u200Bdé', 'Te agen\u00ADdé', 'Tu pe\u2060dido queda registrado'], 'afirma_un_hecho');
  });
  it('cmRevisarRedaccion valida lo PULIDO: «Hola. Sí, soy yo» ya no cuela con un «Sí» al principio', () => {
    const r = F.cmRevisarRedaccion('Hola. Sí, soy yo.', { textoDelCliente: '¿eres el doctor?' });
    expect(r.texto.startsWith('Sí')).toBe(true);
    expect(r.motivo).toBe('identidad');
    expect(F.cmRevisarRedaccion('Hola. Tenemos lugar el viernes.', {}).motivo).toBe('');
  });
  it('el pulido tiene tope de largo: un texto enorme no cuelga el flujo', () => {
    const t0 = Date.now();
    F.cmPulirRedaccion('Dr. '.repeat(250000), { nombreNegocio: 'x' });
    F.cmPulirRedaccion('a. '.repeat(250000), { nombreNegocio: 'x' });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('segunda revisión de seguridad (02/10): lo que seguía pasando', () => {
  const ARROBA = '@'; // escrita aparte: una dirección de correo literal en el archivo la marcaría el saneo
  const rechaza = (lista: string[], esperado: string, o?: object): void => { for (const t of lista) expect(motivo(t, o), t).toBe(esperado); };
  it('pago: transferencia, «se acreditó», validado, exitoso, «llegó tu pago»', () => {
    rechaza(['Recibimos tu transferencia', 'Hemos recibido tu transferencia', 'Tu pago se acreditó', 'Ya se acreditó tu pago', 'Pago validado', 'Pago exitoso', 'Llegó tu pago', 'Tu comprobante fue validado', 'Payment received'], 'afirma_un_hecho');
  });
  it('reserva: primera persona del plural, «se», presente, sinónimos, ✓, palabra partida y en inglés', () => {
    rechaza(['Agendamos tu cita', 'Se agendó tu cita', 'Te agendo para el lunes', 'Programé tu cita', 'Cambié tu cita al martes', 'Te separé la hora', 'Ya te agendamos', 'Hecho ✓', 'agen-dada', 'a.gen.dé tu cita', 'Booked'], 'afirma_un_hecho');
  });
  it('negar ser una IA con otros sujetos y formas', () => {
    rechaza(['Estás hablando con una persona', 'Esto no es un bot', 'No hablas con un bot', 'Te responde una persona', 'Te escribe una persona', 'Para nada soy una IA', 'Soy Ana de recepción, no un bot', 'Soy real', 'No es un bot, es una persona'], 'afirma_un_hecho');
  });
  it('enlaces: cualquier terminación, IP, Markdown, punto ideográfico y salto de línea', () => {
    rechaza(['Visita evil.mx', 'evil.pe/x', 'evil.ar', 'evil.cloud', 'evil.zip', 'evil.es/pago', 'evil.ai', 'evil.tk', '1.2.3.4:8080', '192.168.0.1', '[clic](evil.mx)', 'evil。com', 'evil\n.com'], 'enlace_ajeno');
  });
  it('enlace permitido: mismo esquema, sin salirse de la ruta ni llevar otro enlace dentro', () => {
    const o = { enlacesPermitidos: ['https://www.facebook.com/negocio', 'https://wa.me/12345678'] };
    rechaza(['Mira https://facebook.com/negocio/../atacante', 'Mira https://wa.me/12345678?next=https://evil.com', 'Escribe a http://wa.me/12345678', `Mira https://wa.me/12345678/%2f${ARROBA}evil.com`, `Mira https://wa.me/12345678/${ARROBA}evil.com`], 'enlace_ajeno', o);
    expect(motivo('Mira https://www.facebook.com/negocio/photos y https://wa.me/12345678?text=Hola', o)).toBe('');
  });
  it('NIEGA: los textos honestos de siempre siguen saliendo', () => {
    for (const t of ['Tenemos lugar el viernes a las 11:30. ¿Te sirve?', 'Te muestro los horarios disponibles.', 'Para cancelar toca el botón.', 'Una persona del equipo continuará esta conversación.', '¿En qué te ayudo con tu pedido?']) expect(motivo(t, { enlacesPermitidos: [] }), t).toBe('');
  });
});

describe('las reglas de NovuChat no se apagan con opciones', () => {
  it('ninguna opción vuelve válido «quedó agendada», una promesa o un hueco', () => {
    const apagar = { permitirMontos: true, enlacesPermitidos: null, prohibidos: [], extra: [], quienPromete: [], maximo: 100000, textoDelCliente: '' }; // enlacesPermitidos:null solo apaga la revisión de enlaces
    expect(motivo('Tu cita quedó agendada', apagar)).toBe('afirma_un_hecho');
    expect(motivo('Te aviso luego', apagar)).toBe('promesa');
    expect(motivo('Hola {{x}}', apagar)).toBe('hueco');
  });
  it('un patrón de usuario tramposo no cuelga el filtro (sin retroceso exponencial)', () => {
    const t0 = Date.now();
    motivo('a '.repeat(440) + 'a las', { textoDelCliente: 'es '.repeat(300) });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('pulir la redacción', () => {
  const pulir = (t: string, nombre = ''): string => F.cmPulirRedaccion(t, { nombreNegocio: nombre });
  it('quita el saludo y la presentación del principio: el menú ya saludó', () => {
    expect(pulir('¡Hola! Soy la asistente virtual del consultorio. Tenemos lugar el viernes.')).toBe('Tenemos lugar el viernes.');
    expect(pulir('Buenas tardes. Estoy aquí para ayudarte. Tenemos lugar.')).toBe('Tenemos lugar.');
  });
  it('NIEGA: si TODO el texto es un saludo, no lo deja vacío', () => {
    expect(pulir('¡Hola! Soy la asistente virtual del consultorio.').length).toBeGreaterThan(0);
  });
  it('trabaja por oraciones completas: «Dr.» no corta la oración', () => {
    expect(pulir('Hola. Con el Dr. Pérez tenemos lugar el viernes.')).toBe('Con el Dr. Pérez tenemos lugar el viernes.');
    expect(pulir('Hola. Av. Principal esquina Edif. Sol, piso 2.')).toBe('Av. Principal esquina Edif. Sol, piso 2.');
  });
  it('quita las muletillas de apertura y pone la primera letra en mayúscula', () => {
    expect(pulir('Claro que sí, tenemos lugar.')).toBe('Tenemos lugar.');
    expect(pulir('Por supuesto: el viernes hay lugar.')).toBe('El viernes hay lugar.');
    expect(pulir('listo, aquí tienes los horarios.')).toBe('Aquí tienes los horarios.');
  });
  it('el nombre del negocio vuelve a la forma de la configuración (acentos y mayúsculas)', () => {
    expect(pulir('Bienvenido a Café Pérez. Pedido listo.', 'Cafe Perez')).toBe('Bienvenido a Cafe Perez. Pedido listo.');
    expect(pulir('Hay lugar en CAFE PEREZ.', 'Cafe Perez')).toBe('Hay lugar en Cafe Perez.');
  });
  it('NIEGA: no toca palabras cortas ni otras palabras', () => {
    expect(pulir('Una cafetería con sol.', 'Cafe Sol')).toBe('Una cafetería con sol.');
  });
  it('un texto vacío o ausente queda vacío', () => {
    expect(pulir('')).toBe('');
    expect(F.cmPulirRedaccion(undefined)).toBe('');
  });
});
