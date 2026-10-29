/**
 * LAS OBSERVACIONES DE RUBÉN SOBRE EVY (decisiones de Andres, 28/10/2026). «El prompt no es una barrera»: cada punto lo hace el CÓDIGO y se prueba POSITIVO y NEGADO con el mundo simulado (el modelo es un doble).
 * Espejo exacto en la carpeta de la otra doctora (solo cambia `CLIENTE`; lo propio de cada una va en `ES_EVY`).
 *   (1) el «sí» a agendar: antes del cierre, el día y el horario (UNA pregunta, con el nombre si falta); la respuesta cierra con la frase fija de Andres, el aviso con la preferencia y el botón;
 *   (P) «recepción te llama…» solo con el aviso de «pidió que la llamen» salido de verdad;
 *   (2) la ubicación: enlace, teléfono (formato nacional) y horario de la Consola, solo los que hay;
 *   (3) «no gracias» / «lo voy a pensar»: la oferta fija de llamada; «sí» deriva, «no» cierra amable; nunca «excelente día»;
 *   (4) sin «bonificado»; los 250 Bs solo en la bienvenida (primer turno de la ficha);
 *   (5) un saludo con la ficha vigente no repite la bienvenida;
 *   (6) la pregunta de cierre no se repite dos veces seguidas.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, BETO, REC, avisosARecepcion, crear, dice, esPreguntaDePreferencia, hablar, mTexto, panelOk, textos } from './mundo';

const CLIENTE: string = 'rroca-evy';
const ES_EVY = CLIENTE === 'rroca-' + 'evy';
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental');
const LIB = readFileSync(join(RAIZ, `${CLIENTE}/src/lib/ev.js`), 'utf8');
type Lib = { evPulirSalida: (t: string, c: J) => { texto: string; motivo: string }; evDeclina: (t: string, h: J[]) => boolean; evSoloSaludo: (t: string, n: string) => boolean; evTelefonoNacional: (n: string) => string };
const lib = runInNewContext(`const EV_PROMPT='';\n${readFileSync(join(RAIZ, 'comun-sin-agente/src/filtro-redaccion.js'), 'utf8')}\n${LIB}\n({ evPulirSalida, evDeclina, evSoloSaludo, evTelefonoNacional })`, {}) as Lib;

const CIERRE_AVISADO = 'Ya pasé tus datos a recepción; te contactarán para confirmar tu hora.';
// La oferta sale en dos párrafos (regla de párrafos de Andres, 20/10/2026: la pregunta final va sola).
const OFERTA_LLAMADA = 'Si quieres, recepción te llama para ofrecerte los horarios disponibles y tú decides.\n\n¿Te parece?';
const esBoton = (t: ReturnType<typeof hablar>): boolean => t.mensajes.some((e) => e.tipo === 'interactive');
const llamoAlModelo = (t: ReturnType<typeof hablar>): boolean => t.registro.some((r) => r.nodo === 'Conversar con el modelo');
const todo = (t: ReturnType<typeof hablar>): string => textos(t).join('\n');

describe('(1) el día y el horario ANTES del cierre', () => {
  it('POSITIVA: «quiero agendar» sin nombre ni día → UNA pregunta con las dos cosas (sin botón ni aviso); la respuesta cierra con la frase fija, el botón y el aviso con la preferencia', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, REC, mTexto('hola, soy recepción'));                     // abre la ventana de la recepción: el aviso sale en texto
    hablar(m, ANA, mTexto('hola'));
    const t1 = hablar(m, ANA, mTexto('quiero agendar'));
    expect(t1.mensajes.length).toBe(1);                                 // costo: 0 mensajes agregados (antes el modelo pedía el nombre)
    expect(todo(t1)).toMatch(/¿Cómo te llamas y qué día y horario te quedan mejor para tu valoración\?/);
    expect(esBoton(t1)).toBe(false);
    expect(avisosARecepcion(t1).length).toBe(0);
    const t2 = hablar(m, ANA, mTexto('Rosa, el martes en la tarde'));
    expect(llamoAlModelo(t2)).toBe(false);
    expect(esBoton(t2)).toBe(true);
    const c = textos(t2)[0]!;
    expect(c).toMatch(/^¡Excelente decisión, Rosa!/);
    expect(c.endsWith(CIERRE_AVISADO)).toBe(true);
    const av = avisosARecepcion(t2);
    expect(av.length).toBe(1);
    expect(av[0]!.cuerpo).toMatch(/Nombre: Rosa/);
    expect(av[0]!.cuerpo).toMatch(/Horario preferido: el martes en la tarde\./);   // el texto original, sin el nombre
    expect(av[0]!.cuerpo).toContain(`+${ANA}`);
    expect(JSON.stringify(m.sd)).toMatch(/"preferencia":"el martes en la tarde"/);   // la preferencia queda en la ficha
  });
  it('POSITIVA: con el nombre ya dado, la pregunta es solo el día y el horario (+1 mensaje aceptado por Andres)', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, ANA, mTexto('Hola, me llamo Paola'));
    const t = hablar(m, ANA, mTexto('quiero agendar'));
    expect(todo(t)).toMatch(/¿Qué día y horario te quedan mejor para tu valoración\?/);
    expect(todo(t)).not.toMatch(/llamas/);
    const c = hablar(m, ANA, mTexto('cualquier día después de las 5'));
    expect(textos(c)[0]).toMatch(/^¡Excelente decisión, Paola!/);
  });
  it('POSITIVA: el pedido con el día y el horario en el mismo mensaje cierra directo («quiero agendar el martes en la tarde, soy Ana»)', () => {
    const t = hablar(crear({ modeloDice: dice('Perfecto.') }), ANA, mTexto('quiero agendar el martes en la tarde, soy Ana'));
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]!.endsWith(CIERRE_AVISADO)).toBe(true);
  });
  it('POSITIVA: si contesta solo el nombre, la pregunta NO se repite: cierra con ese nombre y «sin horario indicado»', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, REC, mTexto('hola, soy recepción'));
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('quiero agendar'));
    const t = hablar(m, ANA, mTexto('Lucía'));
    expect(esPreguntaDePreferencia(t)).toBe(false);
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).toMatch(/^¡Excelente decisión, Lucía!/);
    expect(avisosARecepcion(t)[0]!.cuerpo).toContain('Horario preferido: sin horario indicado.');
  });
  it('POSITIVA: un pedido de hablar con una persona («quiero chatear con la secretaria») no es un pedido de agendar: deriva directo', () => {
    const m = crear({ modeloDice: dice('¡Por supuesto!') });
    hablar(m, ANA, mTexto('hola'));
    expect(esBoton(hablar(m, ANA, mTexto('Me gustaría chatear con la secretaria')))).toBe(true);
  });
  it('NEGADA: sin el día ni el horario el cierre NO sale (ni botón ni aviso), ni con la etiqueta del modelo', () => {
    for (const modelo of ['Perfecto.', '[DERIVAR_RECEPCION: Ana]']) {
      const m = crear({ modeloDice: dice(modelo) });
      hablar(m, ANA, mTexto('hola'));
      const t = hablar(m, ANA, mTexto('quiero agendar'));
      expect(todo(t), modelo).not.toMatch(/Excelente decisión|Ya pasé tus datos/);
      expect(esBoton(t), modelo).toBe(false);
      expect(avisosARecepcion(t).length, modelo).toBe(0);
    }
  });
  it('NEGADA (bucle): la pregunta se hace UNA sola vez: cualquier respuesta que no sea día u hora cierra en el turno siguiente con «sin horario indicado», también si insiste 3 veces', () => {
    for (const r of ['¿qué horarios tienen?', 'ustedes díganme', 'no sé', 'sí', 'quiero agendar', 'soy diabética']) {
      for (const modelo of ['Con gusto te cuento.', '¡Claro! [DERIVAR_RECEPCION]']) {
        const m = crear({ modeloDice: dice(modelo) });
        hablar(m, REC, mTexto('hola, soy recepción'));
        hablar(m, ANA, mTexto('hola'));
        expect(esPreguntaDePreferencia(hablar(m, ANA, mTexto('quiero agendar'))), r).toBe(true);
        const t2 = hablar(m, ANA, mTexto(r));
        expect(esPreguntaDePreferencia(t2), r).toBe(false);
        expect(esBoton(t2), r).toBe(true);
        expect(avisosARecepcion(t2).length, r).toBe(1);
        expect(avisosARecepcion(t2)[0]!.cuerpo, r).toContain('Horario preferido: sin horario indicado.');
        const t3 = hablar(m, ANA, mTexto(r));
        expect(esPreguntaDePreferencia(t3), r).toBe(false);
        expect(esPreguntaDePreferencia(hablar(m, ANA, mTexto('quiero agendar'))), r).toBe(false);
      }
    }
  });
  it('NEGADA: un aplazamiento («luego te digo», «después te aviso», «cuando pueda te escribo», «tengo que ver mi trabajo») no es preferencia: va a la oferta de llamada, sin cierre', () => {
    for (const r of ['luego te digo', 'después te aviso', 'cuando pueda te escribo', 'tengo que ver mi trabajo']) {
      const m = crear({ modeloDice: dice('Con gusto te cuento.') });
      hablar(m, ANA, mTexto('hola'));
      hablar(m, ANA, mTexto('quiero agendar'));
      const t = hablar(m, ANA, mTexto(r));
      expect(todo(t), r).not.toMatch(/Excelente decisión|Ya pasé tus datos/);
      expect(avisosARecepcion(t).length, r).toBe(0);
      expect(todo(t), r).toContain('recepción te llama para ofrecerte');
    }
  });
  it('POSITIVA: «no, el jueves mejor» y «no puedo esta semana, la próxima» son preferencias (un «no» inicial no las anula)', () => {
    for (const [r, esperado] of [['no, el jueves mejor', 'el jueves mejor'], ['no puedo esta semana, la próxima', 'no puedo esta semana, la próxima']] as const) {
      const m = crear({ modeloDice: dice('Con gusto te cuento.') });
      hablar(m, REC, mTexto('hola, soy recepción'));
      hablar(m, ANA, mTexto('hola'));
      hablar(m, ANA, mTexto('quiero agendar'));
      const t = hablar(m, ANA, mTexto(r));
      expect(esBoton(t), r).toBe(true);
      expect(avisosARecepcion(t)[0]!.cuerpo, r).toContain(`Horario preferido: ${esperado}`);
    }
  });
  it('NEGADA: el aviso lleva el texto original con tildes («mañana»), nunca el normalizado («manana»)', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, REC, mTexto('hola, soy recepción'));
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('quiero agendar'));
    const c = avisosARecepcion(hablar(m, ANA, mTexto('mañana en la mañana')))[0]!.cuerpo;
    expect(c).toContain('Horario preferido: mañana en la mañana');
    expect(c).not.toMatch(/manana/);
  });
  it('POSITIVA: un «hola» con la pregunta pendiente saluda y la repite; la respuesta siguiente cierra', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('quiero agendar'));
    const t = hablar(m, ANA, mTexto('hola'));
    expect(textos(t)[0]).toMatch(/^¡Hola de nuevo! 😊/);
    expect(esPreguntaDePreferencia(t)).toBe(true);
    expect(esBoton(t)).toBe(false);
    expect(esBoton(hablar(m, ANA, mTexto('el viernes a las 10')))).toBe(true);
  });
  it('NEGADA (nombre falso): «pásame con alguien» → «quiero hablar con recepción» nunca deja «pásame» como nombre en el cierre ni en el aviso', () => {
    for (const modelo of ['¡Claro! [DERIVAR_RECEPCION]', 'Con gusto.']) {
      const m = crear({ modeloDice: dice(modelo) });
      hablar(m, REC, mTexto('hola, soy recepción'));
      hablar(m, ANA, mTexto('hola'));
      hablar(m, ANA, mTexto('quiero agendar'));
      const t1 = hablar(m, ANA, mTexto('pásame con alguien'));
      const t2 = hablar(m, ANA, mTexto('quiero hablar con recepción'));
      for (const t of [t1, t2]) {
        expect(todo(t), modelo).not.toMatch(/pásame|pasame/i);
        for (const a of avisosARecepcion(t)) expect(a.cuerpo, modelo).not.toMatch(/Nombre: p[áa]same/i);
      }
    }
  });
  it('NEGADA: el día de la respuesta no se toma por un nombre («martes en la tarde» cierra con el nombre del perfil, nunca «Martes»)', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('quiero agendar'));
    const c = textos(hablar(m, ANA, mTexto('martes en la tarde'), { nombre: 'Ana Pérez' }))[0]!;
    expect(c).toMatch(/^¡Excelente decisión, Ana!/);
    expect(c).not.toMatch(/martes!/i);
  });
  it('NEGADA (P): si el aviso NO sale (plantilla sin aprobar), el cierre no dice «Ya pasé tus datos»: invita a usar el botón', () => {
    const t = hablar(crear({ modeloDice: dice('Perfecto.'), base: { avisoSolicitudEstado: 'PENDING' } }), ANA, mTexto('quiero agendar el martes en la tarde, soy Ana'));
    expect(avisosARecepcion(t).length).toBe(0);
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).not.toContain('Ya pasé tus datos');
    expect(textos(t)[0]).toContain('escríbele directo a la recepción con el botón');
  });
});

describe('(P) «recepción te llama…» solo con el aviso de llamada salido', () => {
  const FRASE = 'Recepción te llama para ofrecerte los horarios disponibles.';
  it('función: sin aviso la oración se quita; con aviso sale el texto fijo del código', () => {
    const sin = lib.evPulirSalida(`Con gusto. ${FRASE} ¿Algo más?`, { textoCliente: 'gracias', llamadaAvisada: false });
    expect(sin.motivo).toBe('');
    expect(sin.texto).not.toMatch(/te llama|te contactar/i);
    const con = lib.evPulirSalida(`Con gusto. ${FRASE} ¿Algo más?`, { textoCliente: 'gracias', llamadaAvisada: true });
    expect(con.motivo).toBe('');
    expect(con.texto).toContain('Recepción te contactará para ofrecerte los horarios disponibles.');
    // con aviso, otra promesa distinta («te van a llamar mañana») sigue quitándose
    expect(lib.evPulirSalida('Te van a llamar mañana. ¿Algo más?', { textoCliente: 'ok', llamadaAvisada: true }).texto).not.toMatch(/llamar/);
  });
  it('NEGADA (flujo): sin aviso de llamada, la frase del modelo no llega a la persona', () => {
    const m = crear({ modeloDice: dice(`Gracias por escribir. ${FRASE} ¿Te ayudo en algo más?`) });
    hablar(m, ANA, mTexto('hola'));
    const t = hablar(m, ANA, mTexto('gracias'));
    expect(todo(t)).not.toMatch(/te llama|te contactar/i);
  });
  it('POSITIVA (flujo): tras aceptar la llamada y salir el aviso, la frase sí sale (con el texto fijo)', () => {
    const m = crear({ modeloDice: dice(`Gracias a ti. ${FRASE} ¿Te ayudo en algo más?`) });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('no gracias'));
    expect(avisosARecepcion(hablar(m, ANA, mTexto('sí'))).length).toBe(1);
    expect(todo(hablar(m, ANA, mTexto('gracias')))).toContain('Recepción te contactará para ofrecerte los horarios disponibles.');
  });
  it('NEGADA (flujo): si el aviso de la llamada falla, la frase sigue quitándose después', () => {
    const m = crear({ modeloDice: dice(`Gracias a ti. ${FRASE} ¿Te ayudo en algo más?`), previos: 'error' });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('no gracias'));
    const t = hablar(m, ANA, mTexto('sí'));
    expect(textos(t)[0]).not.toContain('Ya pasé tus datos');
    expect(todo(hablar(m, ANA, mTexto('gracias')))).not.toMatch(/te llama|te contactar/i);
  });
});

describe('(2) la ubicación: enlace, teléfono y horario de la Consola', () => {
  const MAPS = 'https://maps.app.goo.gl/PruebaSintetica1';
  const MODELO = 'Atendemos en nuestra clínica, en la dirección de la Consola.';
  const panel = (dn: J, op: J) => { const p = panelOk(); Object.assign(p.body['datosDelNegocio'] as J, dn); Object.assign(p.body['operacion'] as J, op); return p; };
  const pregunta = (p: ReturnType<typeof panelOk>, q = '¿Dónde están ubicados?', base?: Record<string, unknown>, modelo = MODELO) => {
    const m = crear({ modeloDice: dice(modelo), panel: p, base });
    hablar(m, ANA, mTexto('hola'));
    return textos(hablar(m, ANA, mTexto(q)))[0]!;
  };
  it('POSITIVA: con los tres datos, el texto del modelo y al final el mapa, «Teléfono: <nacional>» y «Horario: <Consola>»', () => {
    const horario = 'lunes a viernes de 09:00 a 18:00';
    const t = pregunta(panel({ direccionMaps: MAPS }, { horarioAtencion: horario }));
    expect(t.startsWith(MODELO)).toBe(true);
    expect(t.endsWith(`\n\n📍 Ubicación: ${MAPS}\nTeléfono: ${REC.slice(3)}\nHorario: ${horario}`)).toBe(true);
  });
  it('función: el teléfono en formato nacional (sin el 591); otro país, con «+»; vacío, nada', () => {
    expect(lib.evTelefonoNacional(REC)).toBe(REC.slice(3));
    expect(lib.evTelefonoNacional(['54', '9', '11', '55500001'].join(''))).toBe('+' + ['54', '9', '11', '55500001'].join(''));
    expect(lib.evTelefonoNacional('')).toBe('');
  });
  it('NEGADA: sin enlace, sin teléfono y sin horario en la Consola (ni en «Config base»): ninguna línea, ni vacía', () => {
    const t = pregunta(panel({ direccionMaps: '' }, { horarioAtencion: '', numeroRecepcion: '' }), '¿Dónde están ubicados?', { numeroRecepcion: '' });
    expect(t).toBe(MODELO);
    expect(t).not.toMatch(/Teléfono|Horario|📍|\n\s*\n\s*$/);
  });
  it('NEGADA: solo el que falta no sale (sin horario: mapa y teléfono)', () => {
    const t = pregunta(panel({ direccionMaps: MAPS }, { horarioAtencion: '' }));
    expect(t).toContain('📍 Ubicación');
    expect(t).toContain('Teléfono: ');
    expect(t).not.toContain('Horario:');
  });
  it('NEGADA: si la respuesta del modelo ya trae el horario, no se repite', () => {
    const horario = 'lunes a viernes de 09:00 a 18:00';
    const t = pregunta(panel({}, { horarioAtencion: horario }), '¿Dónde están ubicados?', undefined, `Atendemos ${horario} en nuestra clínica.`);
    expect(t.split(horario).length - 1).toBe(1);
    expect(t).not.toContain('Horario:');
  });
  it('NEGADA: una pregunta que no es de ubicación no lleva las líneas', () => {
    const t = pregunta(panel({ direccionMaps: MAPS }, { horarioAtencion: 'lunes a viernes de 09:00 a 18:00' }), '¿Cuánto dura la sesión?');
    expect(t).not.toMatch(/📍|Teléfono:|Horario:/);
  });
});

describe('(3) «no gracias» / «lo voy a pensar»: la oferta fija de llamada', () => {
  for (const q of ['No gracias', 'no, gracias', 'no, gracias doctora', 'no, por ahora', 'Lo voy a pensar', 'lo pienso', 'más adelante', 'por ahora no, gracias', 'Ok, lo voy a pensar. Gracias', 'todavía no', 'no me interesa']) {
    it(`POSITIVA: «${q}» → la oferta fija, sin botón, sin aviso y sin llamar al modelo`, () => {
      const m = crear({ modeloDice: dice('¡Claro! ¡Que tengas un excelente día!') });
      hablar(m, ANA, mTexto('hola'));
      const t = hablar(m, ANA, mTexto(q));
      expect(textos(t), q).toEqual([OFERTA_LLAMADA]);
      expect(esBoton(t), q).toBe(false);
      expect(avisosARecepcion(t).length, q).toBe(0);
      expect(llamoAlModelo(t), q).toBe(false);
    });
  }
  it('POSITIVA: acepta («sí», «me parece», «dale») → aviso con su teléfono y «pidió que la llamen», botón y la frase fija', () => {
    for (const si of ['sí', 'me parece', 'dale', 'sí, me parece bien']) {
      const m = crear({ modeloDice: dice('Con gusto.') });
      hablar(m, REC, mTexto('hola, soy recepción'));
      hablar(m, ANA, mTexto('hola'));
      hablar(m, ANA, mTexto('lo voy a pensar'));
      const t = hablar(m, ANA, mTexto(si));
      expect(esBoton(t), si).toBe(true);
      expect(textos(t)[0]!.endsWith(CIERRE_AVISADO), si).toBe(true);
      const av = avisosARecepcion(t);
      expect(av.length, si).toBe(1);
      expect(av[0]!.cuerpo, si).toContain(`+${ANA}`);
      expect(av[0]!.cuerpo, si).toContain('pidió que la llamen');
    }
  });
  it('POSITIVA: dice que no → cierre amable, sin repetir la oferta ni «excelente día»; otro «no gracias» después tampoco la repite', () => {
    const m = crear({ modeloDice: dice('Con gusto.') });
    hablar(m, ANA, mTexto('hola'));
    hablar(m, ANA, mTexto('no gracias'));
    const t = hablar(m, ANA, mTexto('no'));
    expect(todo(t)).not.toContain(OFERTA_LLAMADA);
    expect(todo(t)).not.toMatch(/excelente d[ií]a/i);
    expect(esBoton(t)).toBe(false);
    expect(avisosARecepcion(t).length).toBe(0);
    expect(todo(hablar(m, ANA, mTexto('no gracias')))).not.toContain(OFERTA_LLAMADA);
  });
  it('NEGADA: «no gracias» nunca produce «excelente día», ni del modelo: la oración se quita de cualquier respuesta', () => {
    const m = crear({ modeloDice: dice('¡Claro, cuando quieras! ¡Que tengas un excelente día!') });
    hablar(m, ANA, mTexto('hola'));
    expect(todo(hablar(m, ANA, mTexto('no gracias')))).not.toMatch(/excelente d[ií]a/i);
    expect(todo(hablar(m, ANA, mTexto('ok, gracias')))).not.toMatch(/excelente d[ií]a/i);
  });
  it('NEGADA: el detector es cerrado: con una pregunta o con otra cosa contesta el modelo', () => {
    for (const q of ['no gracias, ¿cuánto cuesta?', 'gracias', 'ok', 'no sé', 'no tengo tiempo esta semana pero quiero saber más', 'lo voy a pensar, ¿duele?', 'no', 'no quiero']) {
      const m = crear({ modeloDice: dice('Respuesta del modelo.') });
      hablar(m, ANA, mTexto('hola'));
      const t = hablar(m, ANA, mTexto(q));
      expect(todo(t), q).not.toContain(OFERTA_LLAMADA);
      expect(llamoAlModelo(t), q).toBe(true);
    }
  });
  it('NEGADA: un «no» a una pregunta con alternativa («¿…o tienes alguna otra duda?») no dispara la oferta de llamada', () => {
    const m = crear({ modeloDice: dice('Te cuento. ¿Te gustaría agendar tu valoración gratuita o tienes alguna otra duda?') });
    hablar(m, ANA, mTexto('cuéntame'));
    expect(todo(hablar(m, ANA, mTexto('no')))).not.toContain('recepción te llama para ofrecerte');
  });
  it('aviso repetido y tope de avisos al aceptar la llamada: no sale un segundo aviso; con aviso repetido el cierre dice «Ya pasé…», con el tope no', () => {
    // El aviso de solicitud sale pero Meta rechaza el cierre (no cuenta como hecho): la ficha no tiene cierre y el aviso queda reciente.
    const envio: Record<string, string> = { 'Enviar a WhatsApp': 'acepta', 'Enviar respaldo': 'acepta' };
    // @ts-expect-error el objeto es mutable a propósito: el doble lo lee en cada envío
    const m = crear({ modeloDice: dice('Con gusto.'), envio });
    hablar(m, ANA, mTexto('hola'));
    envio['Enviar a WhatsApp'] = 'error'; envio['Enviar respaldo'] = 'error';
    expect(avisosARecepcion(hablar(m, ANA, mTexto('quiero agendar el martes en la tarde'), { toleraFallo: true })).length).toBe(1);
    envio['Enviar a WhatsApp'] = 'acepta'; envio['Enviar respaldo'] = 'acepta';
    expect(todo(hablar(m, ANA, mTexto('lo voy a pensar')))).toContain('recepción te llama para ofrecerte');
    const rep = hablar(m, ANA, mTexto('sí'));
    expect(avisosARecepcion(rep).length).toBe(0);                   // aviso de solicitud ya salió hace menos de 30 minutos: repetido
    expect(esBoton(rep)).toBe(true);
    expect(textos(rep)[0]).toContain('Ya pasé tus datos');           // el aviso repetido cuenta como salido
    const tope = crear({ modeloDice: dice('Con gusto.'), base: { topeAvisosHora: 0 } });
    hablar(tope, ANA, mTexto('hola'));
    hablar(tope, ANA, mTexto('no gracias'));
    const t = hablar(tope, ANA, mTexto('sí'));
    expect(avisosARecepcion(t).length).toBe(0);
    expect(esBoton(t)).toBe(true);
    expect(textos(t)[0]).not.toContain('Ya pasé tus datos');
  });
  it('POSITIVA: un «no» a secas cuenta solo si contesta una oferta de agendar', () => {
    const m = crear({ modeloDice: dice('Te cuento. ¿Te gustaría agendar tu valoración gratuita?') });
    hablar(m, ANA, mTexto('cuéntame'));
    expect(textos(hablar(m, ANA, mTexto('no')))).toEqual([OFERTA_LLAMADA]);
    expect(lib.evDeclina('no', [])).toBe(false);
  });
});

describe('(4) sin «bonificado»; los 250 Bs solo en la bienvenida', () => {
  const BIENVENIDA = 'Hoy tu valoración es 100% gratuita y sin compromiso (su costo habitual es de 250 Bs, hoy bonificado). ¿Cómo te llamas?';
  const BONIFICADA = ES_EVY ? BIENVENIDA : 'Hoy tu valoración es 100% gratuita y sin compromiso, hoy bonificado. ¿Cómo te llamas?';
  it('NEGADA: «hoy bonificado» / «100% bonificada» nunca salen (se reescriben a «gratuita» o se quitan)', () => {
    for (const x of [BONIFICADA, 'Tu valoración está 100% bonificada. ¿Cómo te llamas?', 'Hoy está bonificada y es gratuita. ¿Cómo te llamas?', 'Justamente por eso bonificamos el 100% de la valoración. ¿Te gustaría agendar?', 'Es bonificable. ¿Cómo te llamas?']) {
      const t = textos(hablar(crear({ modeloDice: dice(x) }), ANA, mTexto('hola')))[0]!;
      expect(t, x).not.toMatch(/bonific/i);
      expect(t, x).not.toMatch(/inconveniente para responderte/);
    }
  });
  it('NEGADA: ningún texto fijo dice «bonific» (cierre, gratuidad, oferta, preferencia, saludo) y el prompt tampoco', () => {
    expect(LIB).not.toMatch(/'[^'\n]*bonific[^'\n]*'/i);
    const prompt = readFileSync(join(RAIZ, CLIENTE, `prompts/${ES_EVY ? 'evy' : 'emma'}.md`), 'utf8');
    expect(prompt).not.toMatch(/bonific/i);
    expect(prompt).toContain('sin pagar nada para agendar');
  });
  if (ES_EVY) {
    it('POSITIVA: en la bienvenida (primer turno de la ficha) los 250 Bs salen, junto con la gratuidad', () => {
      const t = textos(hablar(crear({ modeloDice: dice(BIENVENIDA) }), ANA, mTexto('hola')))[0]!;
      expect(t).toContain('250 Bs');
    });
    it('NEGADA: en cualquier otro turno la cifra no sale (la oración se quita), tampoco en el texto fijo de gratuidad', () => {
      const m = crear({ modeloDice: dice('La valoración es gratuita, te ahorras los 250 Bs. ¿Te gustaría agendar?') });
      hablar(m, ANA, mTexto('hola'));
      expect(todo(hablar(m, ANA, mTexto('¿cuánto cuesta la valoración?')))).not.toMatch(/250/);
      const f = crear({ modeloDice: 'cae' });
      hablar(f, ANA, mTexto('hola'));
      const g = todo(hablar(f, ANA, mTexto('¿de verdad es gratis?')));
      expect(g).toContain('100% gratuita');
      expect(g).not.toMatch(/250|bonific/);
    });
    it('POSITIVA: el texto fijo de gratuidad en el primer turno conserva el valor habitual, sin «bonificado»', () => {
      const g = todo(hablar(crear({ modeloDice: 'cae' }), ANA, mTexto('¿de verdad es gratis?')));
      expect(g).toContain('(Su valor habitual es de 250 Bs).');
      expect(g).not.toMatch(/bonific/);
    });
  } else {
    it('PROPIO.md: esta doctora no tiene ancla de monto: ni siquiera en la bienvenida sale una cifra', () => {
      expect(textos(hablar(crear({ modeloDice: dice(BIENVENIDA) }), ANA, mTexto('hola')))[0]).not.toMatch(/250/);
    });
  }
});

describe('(5) un saludo con la ficha vigente no repite la bienvenida', () => {
  it('POSITIVA: «hola» de nuevo → texto corto fijo que pide el nombre si falta, sin llamar al modelo; otro saludo seguido cambia las palabras', () => {
    const m = crear({ modeloDice: dice('¡Hola! 👋 Soy el asistente virtual. Bienvenida completa. ¿Cómo te llamas y qué te gustaría mejorar?') });
    hablar(m, ANA, mTexto('hola'));
    const t = hablar(m, ANA, mTexto('hola'));
    expect(llamoAlModelo(t)).toBe(false);
    expect(textos(t)[0]).toMatch(/^¡Hola de nuevo! 😊/);
    expect(todo(t)).toMatch(/¿Cómo te llamas y en qué te puedo ayudar\?/);
    expect(todo(t)).not.toContain('Bienvenida completa');
    const t2 = hablar(m, ANA, mTexto('Buenas tardes, doctora'));
    expect(textos(t2)[0]).not.toBe(textos(t)[0]);
    expect(todo(t2)).not.toContain('Bienvenida completa');
  });
  it('POSITIVA: con el nombre ya dado, solo «¿En qué te puedo ayudar?»', () => {
    const m = crear({ modeloDice: dice('Con gusto te cuento.') });
    hablar(m, ANA, mTexto('Hola, soy Paola'));
    expect(textos(hablar(m, ANA, mTexto('buenas')))).toEqual(['¡Hola de nuevo! 😊 ¿En qué te puedo ayudar?']);
  });
  it('NEGADA: el primer contacto recibe la bienvenida del modelo, y un saludo con contenido va al modelo', () => {
    const m = crear({ modeloDice: dice('¡Hola! Bienvenida completa. ¿Cómo te llamas?') });
    expect(todo(hablar(m, ANA, mTexto('hola')))).toContain('Bienvenida completa');
    const t = hablar(m, ANA, mTexto('hola, quiero información de los tratamientos'));
    expect(llamoAlModelo(t)).toBe(true);
    expect(lib.evSoloSaludo('hola quiero info', '')).toBe(false);
    expect(lib.evSoloSaludo('Buenos días 😊', '')).toBe(true);
  });
  it('NEGADA: a las 48 h la ficha vence y el saludo vuelve a ser primer contacto', () => {
    const m = crear({ modeloDice: dice('¡Hola! Bienvenida completa. ¿Cómo te llamas?') });
    hablar(m, BETO, mTexto('hola'));
    m.avanzar(49 * 60);
    expect(todo(hablar(m, BETO, mTexto('hola')))).toContain('Bienvenida completa');
  });
});

describe('(6) la pregunta de cierre no se repite dos veces seguidas', () => {
  const REPETIDA = '¿Te gustaría que te pasemos con nuestra recepción para agendar tu valoración?';
  it('POSITIVA: la misma pregunta de cierre en dos respuestas seguidas: la segunda sale con una variante fija; la tercera, con otra', () => {
    const m = crear({ modeloDice: dice(`La valoración es gratuita. ${REPETIDA}`) });
    const t1 = todo(hablar(m, ANA, mTexto('cuéntame de la valoración')));
    expect(t1).toContain(REPETIDA);
    const t2 = todo(hablar(m, ANA, mTexto('¿y cuánto dura?')));
    expect(t2).not.toContain(REPETIDA);
    expect(t2).toMatch(/\?$/);
    const t3 = todo(hablar(m, ANA, mTexto('¿y duele?')));
    expect(t3).toMatch(/\?$/);
    expect(t3.split('\n\n').pop()).not.toBe(t2.split('\n\n').pop());
    expect(t3.split('\n\n').pop()).not.toBe(t1.split('\n\n').pop());   // la tercera seguida tampoco repite la primera
  });
  it('POSITIVA: la variante sigue siendo una oferta: el «sí» siguiente pasa a la pregunta del día', () => {
    const m = crear({ modeloDice: dice(`La valoración es gratuita. ${REPETIDA}`) });
    hablar(m, ANA, mTexto('cuéntame de la valoración'));
    hablar(m, ANA, mTexto('¿y cuánto dura?'));
    expect(esPreguntaDePreferencia(hablar(m, ANA, mTexto('sí')))).toBe(true);
  });
  it('NEGADA: una pregunta que no es de cierre («¿Cómo te llamas?») se puede repetir, y una pregunta distinta no se toca', () => {
    const m = crear({ modeloDice: dice('Te cuento. ¿Cómo te llamas?') });
    hablar(m, ANA, mTexto('cuéntame'));
    expect(todo(hablar(m, ANA, mTexto('¿y duele?')))).toContain('¿Cómo te llamas?');
    let i = 0;
    const qs = ['¿Te gustaría agendar tu valoración gratuita?', '¿Coordinamos tu valoración gratuita?'];
    const m2 = crear({ modeloDice: () => `Te cuento. ${qs[i++ % 2]}` });
    expect(todo(hablar(m2, ANA, mTexto('cuéntame')))).toContain(qs[0]);
    expect(todo(hablar(m2, ANA, mTexto('¿y duele?')))).toContain(qs[1]);
  });
});

describe('la copia es la misma en las dos doctoras', () => {
  it('el bloque de las observaciones es idéntico byte a byte en los dos flujos', () => {
    const bloque = (c: string) => { const t = readFileSync(join(RAIZ, `${c}/src/lib/ev.js`), 'utf8'); return t.slice(t.indexOf('// OBSERVACIONES DE RUBÉN (decisiones de Andres, 28/10/2026)')); };
    const [a, b] = ['rroca-' + 'evy', 'rroca-emma'].map(bloque);
    expect(a!.length).toBeGreaterThan(1000);
    expect(a).toBe(b);
  });
});
