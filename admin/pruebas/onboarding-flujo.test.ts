/**
 * EL FLUJO DE CAPTACIÓN DE NOVUCHAT (`Flujos/novuchat-onboarding.json`).
 *
 * Es el primer flujo de un cliente real en producción: el número de NovuChat.
 * Especificación de Silvana del 13/09/2026 y decisiones de Andres del 14/09
 * (`CLIENTES/NOVUCHAT/01-…`).
 *
 * COMO EN `estado-comercio.test.ts`, la lógica **se extrae del JSON versionado
 * y se ejecuta**: si alguien edita un nodo en n8n y exporta, la prueba corre el
 * código nuevo. Se cubre lo que no puede depender de la buena voluntad del
 * modelo:
 *
 *   - la compuerta inicial y la rama del cliente actual, sin modelo;
 *   - el fin del primer bloque (botón a un asesor) y la obediencia a los
 *     umbrales del servidor (operador y bloqueo), antes del modelo;
 *   - la idempotencia ante los reenvíos de Meta;
 *   - la extracción de datos del prospecto y el cierre, que exige los datos;
 *   - la prohibición 4 y el tuteo sin voseo;
 *   - que todo lo que sale al cliente pase por un único nodo, y en UN mensaje;
 *   - que la base de conocimiento sea la del sitio, con alarma si diverge.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const TEXTO_FLUJO = readFileSync(join(aqui, '../../Flujos/novuchat-onboarding.json'), 'utf8');

type J = Record<string, any>;
interface Nodo {
  name: string; type: string; parameters: J;
  credentials?: Record<string, { id: string; name: string }>;
}
interface Flujo {
  name: string; nodes: Nodo[];
  connections: Record<string, Record<string, { node: string; type: string; index: number }[][]>>;
}
const flujo = JSON.parse(TEXTO_FLUJO) as Flujo;

const nodo = (nombre: string) => {
  const n = flujo.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
};
const base = (): J => Object.fromEntries(
  (nodo('Config base').parameters.assignments.assignments as { name: string; value: unknown }[])
    .map((a) => [a.name, a.value]),
);

/** Ejecuta un nodo Code con `$input`, `$('Nombre')` y los datos estáticos. */
function correr(nombre: string, items: J[], contexto: Record<string, J | J[]> = {}, estatico: J = {}): J[] {
  const codigo = nodo(nombre).parameters.jsCode as string;
  const entrada = { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) };
  const $ = (n: string) => {
    const v = contexto[n];
    const lista = Array.isArray(v) ? v : [v ?? {}];
    // `isExecuted`, como en n8n: un nodo que no está en el contexto no corrió.
    return { first: () => ({ json: lista[0] }), all: () => lista.map((json) => ({ json })),
      isExecuted: n in contexto };
  };
  // Se ejecuta el flujo VERSIONADO; copiar la lógica dejaría la prueba en verde
  // mientras el flujo se rompe. Misma justificación que `candado-agenda.test.ts`.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', '$getWorkflowStaticData', codigo) as
    (...a: unknown[]) => { json: J }[];
  return fn(entrada, $, () => estatico).map((x) => x.json);
}

const PANEL = (onboarding: J = {}, atencion?: J, cuerpo: J = {}): J => ({
  statusCode: 200,
  body: {
    ...(atencion ? { atencion } : {}),
    tenantId: 'novuchat', flujo: 'onboarding', estadoComercio: 'activo',
    phoneNumberId: '1000000003391',
    operacion: { numeroRecepcion: '+591 7000-0000', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: 'NovuChat' },
    voz: {},
    onboarding: {
      topeAviso: 10, plantillaAviso: 'solicitud_contacto',
      mensajeClienteActual: 'Entra a la consola con tu correo.',
      enlaceConsola: 'https://consola.novuchat.site',
      ...onboarding,
    },
    ...cuerpo,
  },
});
const config = (respuesta: J = PANEL(), respaldo: J = base()) =>
  correr('Config del negocio', [respuesta], { 'Config base': respaldo })[0]!;

let secuencia = 0;
const TEL = '59100000001';
const payload = (msg: J, extra: J = {}): J => ({
  messages: [{ from: TEL, id: `wamid.prueba.${++secuencia}`, ...msg }],
  contacts: [{ profile: { name: 'Ana' } }],
  ...extra,
});
const normalizar = (msg: J, cfg: J = config(), extra: J = {}) =>
  correr('Normalizar entrada', [{ ...cfg, ...payload(msg, extra) }])[0]!;
const texto = (body: string) => ({ type: 'text', text: { body } });
const estado = (entrada: J, sd: J) => correr('Estado de la conversación', [entrada], {}, sd);

const VOSEO = /\b(quer[eé]s|ten[eé]s|pod[eé]s|dec[ií]me|cont[aá]me|escrib[ií]me|mir[aá]|fijate|pasame|avisame|che)\b/i;

// ===========================================================================
describe('Config del negocio', () => {
  it('con el panel activo, los topes y la plantilla salen de /config/onboarding', () => {
    const c = config();
    expect(c['estadoComercio']).toBe('operativo');
    expect(c['topeAviso']).toBe(10);
    expect(c['topeDuro']).toBeUndefined();
    expect(c['plantillaAviso']).toBe('solicitud_contacto');
    // Solo dígitos: es el destino de la plantilla y del botón a una persona.
    expect(c['numeroRecepcion']).toBe('59170000000');
  });

  it('un fin de bloque fuera de rango cae al respaldo', () => {
    expect(config(PANEL({ topeAviso: 500 }))['topeAviso']).toBe(25);
    expect(config(PANEL({ topeAviso: 2 }))['topeAviso']).toBe(25);
  });

  it('lee el estado de atención del servidor, y lo desconocido vale normal', () => {
    const c = config(PANEL({}, { estado: 'operador', avisarRecepcion: 'operador', respuestasEnVentana: 50,
      ventanaVenceEn: '2026-09-15T12:00:00.000Z' }));
    expect(c['atencionEstado']).toBe('operador');
    expect(c['atencionAvisarRecepcion']).toBe('operador');
    expect(c['atencionRespuestas']).toBe(50);
    const raro = config(PANEL({}, { estado: 'lo-que-sea', avisarRecepcion: 'x', respuestasEnVentana: 'diez' }));
    expect([raro['atencionEstado'], raro['atencionAvisarRecepcion'], raro['atencionRespuestas']])
      .toEqual(['normal', '', null]);
  });

  it('un enlace sin https o una plantilla con mal nombre no se usan', () => {
    const c = config(PANEL({ enlaceConsola: 'http://otra.cosa', plantillaAviso: 'Mala Plantilla' }));
    expect(c['enlaceConsola']).toBe(base()['enlaceConsola']);
    expect(c['plantillaAviso']).toBe(base()['plantillaAviso']);
  });

  it('sin respuesta del panel, atiende con el respaldo y con topes numéricos', () => {
    const c = config({ statusCode: 500, body: {} });
    expect(c['estadoComercio']).toBe('operativo');
    expect(c['configDeLaConsola']).toBe(false);
    expect(c['atencionEstado']).toBe('normal');
    expect(typeof c['topeAviso']).toBe('number');
  });
});

// ===========================================================================
describe('Normalizar entrada', () => {
  it('el botón «Soy cliente nuevo» se reconoce por su id', () => {
    const e = normalizar({ type: 'interactive', interactive: { type: 'button_reply',
      button_reply: { id: 'cliente_nuevo', title: 'Soy cliente nuevo' } } });
    expect(e['eleccion']).toBe('cliente_nuevo');
  });

  it('«ya soy cliente» ESCRITO vale como el botón', () => {
    expect(normalizar(texto('Hola, ya soy cliente y no puedo entrar'))['eleccion']).toBe('cliente_actual');
    expect(normalizar(texto('Hola, cuánto cuesta?'))['eleccion']).toBe('');
  });

  it('un saludo suelto se marca como saludo; una consulta, no', () => {
    expect(normalizar(texto('Buenas tardes!'))['esSaludo']).toBe(true);
    expect(normalizar(texto('hola, quiero precios'))['esSaludo']).toBe(false);
  });

  it('una imagen NO se toma como comprobante: este flujo no cobra', () => {
    const e = normalizar({ type: 'image', image: { id: 'x' } });
    expect(String(e['userInput'])).not.toMatch(/comprobante|pago|QR/i);
    expect(String(e['userInput'])).toMatch(/no puedes ver/);
  });

  it('un mensaje que llega de un anuncio trae el titular', () => {
    const e = normalizar({ ...texto('Hola'), referral: { headline: 'Tu negocio en WhatsApp', source_type: 'ad' } });
    expect(e['anuncio']).toMatchObject({ titular: 'Tu negocio en WhatsApp', fuente: 'ad' });
  });

  it('el corpus no viaja en cada item', () => {
    const e = normalizar(texto('Hola'), { ...config(), conocimiento: 'x'.repeat(1000) });
    expect(e['conocimiento']).toBeUndefined();
  });

  it('un acuse de estado no produce nada', () => {
    const r = correr('Normalizar entrada', [{ ...config(), statuses: [{ status: 'read' }] }]);
    expect(r).toEqual([]);
  });
});

// ===========================================================================
describe('Estado de la conversación', () => {
  it('un «hola» suelto recibe los botones, UNA sola vez', () => {
    const sd: J = {};
    expect(estado(normalizar(texto('hola')), sd)[0]!['accion']).toBe('bienvenida');
    // La bienvenida queda dada cuando Meta acepta el envío (ver «Confirmar envío»).
    correr('Confirmar envío', [{ from: TEL, accion: 'bienvenida', responder: true, esInteractivo: true }],
      { 'Enviar a WhatsApp': { statusCode: 200 } }, sd);
    // Vuelve a saludar sin elegir: no se le repiten los botones.
    expect(estado(normalizar(texto('hola')), sd)[0]!['accion']).toBe('agente');
  });

  it('quien ya dijo lo que quiere no tiene que tocar ningún botón', () => {
    const r = estado(normalizar(texto('Hola, ¿cuánto cuesta el plan Pro?')), {})[0]!;
    expect(r['accion']).toBe('agente');
    expect(r['etapa']).toBe('cliente_nuevo');
    expect(r['mensajeDelTurno']).toContain('¿cuánto cuesta el plan Pro?');
    expect(r['mensajeDelTurno']).toContain('La Paz');
  });

  it('el cliente actual recibe su mensaje una vez; después sigue el asistente en su modo', () => {
    const sd: J = {};
    const boton = { type: 'interactive', interactive: { button_reply: { id: 'cliente_actual', title: 'Soy cliente actual' } } };
    expect(estado(normalizar(boton), sd)[0]!['accion']).toBe('cliente_actual');
    const siguiente = estado(normalizar(texto('no me llega el correo')), sd)[0]!;
    expect(siguiente['accion']).toBe('agente');
    expect(siguiente['mensajeDelTurno']).toContain('CLIENTE ACTUAL');
  });

  it('un reenvío de Meta con el mismo id no se responde dos veces', () => {
    const sd: J = {};
    const e = normalizar(texto('Hola, quiero información'));
    expect(estado(e, sd)).toHaveLength(1);
    expect(estado(e, sd)).toHaveLength(0);
    expect(sd['conversaciones'][TEL]['respuestas']).toBe(1);
  });

  it('en operador el agente no se alcanza: uso extendido, aunque sea un saludo', () => {
    const cfg = config(PANEL({}, { estado: 'operador', avisarRecepcion: 'operador', respuestasEnVentana: 50 }));
    for (const m of ['hola', 'otra pregunta']) {
      expect(estado(normalizar(texto(m), cfg), {})[0]!['accion']).toBe('uso_extendido');
    }
  });

  it('bloqueado: con aviso pendiente se avisa sin responder; sin aviso, no se hace nada', () => {
    const conAviso = config(PANEL({}, { estado: 'bloqueado', avisarRecepcion: 'bloqueado', respuestasEnVentana: 100 }));
    expect(estado(normalizar(texto('hola?'), conAviso), {})[0]!['accion']).toBe('uso_extendido');
    const yaAvisado = config(PANEL({}, { estado: 'bloqueado', respuestasEnVentana: 101 }));
    expect(estado(normalizar(texto('hola??'), yaAvisado), {})).toHaveLength(0);
  });

  it('el fin del primer bloque usa el conteo del SERVIDOR', () => {
    const en = (n: number) => estado(normalizar(texto('una consulta'),
      config(PANEL({ topeAviso: 25 }, { estado: 'normal', respuestasEnVentana: n }))), {})[0]!;
    expect(en(24)['finBloque']).toBe(true);          // la que se envía ahora es la 25
    expect(en(24)['mensajeDelTurno']).toMatch(/ofrece hablar con un asesor/);
    expect(en(23)['finBloque']).toBe(false);
    expect(en(25)['finBloque']).toBe(false);
  });

  it('sin conteo del servidor, el propio sirve de respaldo', () => {
    const sd: J = {};
    const cfg = config(PANEL({ topeAviso: 3 }));
    const r = [1, 2, 3, 4].map(() => estado(normalizar(texto('otra consulta'), cfg), sd)[0]!);
    expect(r.map((x) => x['finBloque'])).toEqual([false, false, true, false]);
    expect(r.every((x) => x['accion'] === 'agente')).toBe(true);
  });

  it('a las 24 horas de empezada, la ventana se renueva y el silencio termina', () => {
    const hace25h = Date.now() - 25 * 3_600_000;
    const sd: J = { conversaciones: { [TEL]: {
      desde: hace25h, ultimo: Date.now() - 60_000, respuestas: 50, etapa: 'cerrado',
      bienvenida: true, despedida: true, avisado: true, lead: { empresa: 'Salón Rosa' },
    } } };
    const r = estado(normalizar(texto('hola de nuevo')), sd)[0]!;
    expect(r['accion']).toBe('agente');
    expect(r['respuestasEnVentana']).toBe(1);
    // Lo que se sabe del prospecto se conserva entre ventanas.
    expect(r['leadConocido']).toEqual({ empresa: 'Salón Rosa' });
  });

  it('las conversaciones viejas se olvidan: los datos estáticos no crecen para siempre', () => {
    const sd: J = { conversaciones: { '59100000099': { desde: 0, ultimo: 0, respuestas: 3, lead: {} } },
      vistos: { 'wamid.viejo': 0 } };
    estado(normalizar(texto('hola')), sd);
    expect(sd['conversaciones']['59100000099']).toBeUndefined();
    expect(sd['vistos']['wamid.viejo']).toBeUndefined();
  });
});

// ===========================================================================
describe('Procesar respuesta', () => {
  const procesar = (salidaAgente: string, ent: J, sd: J) =>
    correr('Procesar respuesta', [{ output: salidaAgente }], { 'Estado de la conversación': ent }, sd)[0]!;
  const entrada = (sd: J, cfg: J = config()) => estado(normalizar(texto('Hola, quiero info'), cfg), sd)[0]!;

  it('quita las marcas y guarda los datos del prospecto', () => {
    const sd: J = {};
    const r = procesar('¡Gracias, Ana! ¿A qué se dedica tu negocio?\n[LEAD]{"empresa":"Salón Rosa","contacto":"Ana"}[/LEAD]',
      entrada(sd), sd);
    expect(r['respuesta']).toBe('¡Gracias, Ana! ¿A qué se dedica tu negocio?');
    expect(r['respuesta']).not.toMatch(/\[|\]/);
    expect(sd['conversaciones'][TEL]['lead']).toEqual({ empresa: 'Salón Rosa', contacto: 'Ana' });
    expect(r['guardarLead']).toBe(true);
    expect(r['avisar']).toBe(false);
  });

  // Revisión de seguridad del 15/09 (MEDIUM-2): la corrección reemplazaba solo
  // la PRIMERA negación, y la segunda salía por WhatsApp.
  it('corrige TODAS las negaciones de ser una IA, no solo la primera', () => {
    const sd: J = {};
    const r = procesar('No soy un bot. Soy una persona de carne y hueso.', entrada(sd), sd);
    expect(r['respuesta']).not.toMatch(/no soy un bot|soy una persona/i);
    expect(String(r['respuesta']).match(/asistente virtual con inteligencia artificial/g)).toHaveLength(2);
    expect(r['avisos']).toContain('correccion_ia');
  });

  it('un dato de relleno («Pendiente») no se guarda', () => {
    const sd: J = {};
    const r = procesar('Anotado. ¿A qué se dedica?\n[LEAD]{"empresa":"AAB1","rubro":"Pendiente","flujos":"No especificado","nit":"-"}[/LEAD]',
      entrada(sd), sd);
    expect(sd['conversaciones'][TEL]['lead']).toEqual({ empresa: 'AAB1' });
    expect(r['avisar']).toBe(false);
  });

  it('con «Pendiente» en el rubro, un [CIERRE] no cierra', () => {
    const sd: J = {};
    const ent = entrada(sd);
    procesar('Gracias.\n[LEAD]{"empresa":"AAB1","contacto":"Ana","flujos":"citas"}[/LEAD]', ent, sd);
    const r = procesar('Te escribirá un asesor.\n[LEAD]{"rubro":"Pendiente"}[/LEAD] [CIERRE]', ent, sd);
    expect(r['avisar']).toBe(false);
    expect(r['avisos']).toContain('cierre_sin_datos');
    expect(sd['conversaciones'][TEL]['lead']['rubro']).toBeUndefined();
  });

  it('un [CIERRE] sin los datos obligatorios NO avisa ni cierra', () => {
    const sd: J = {};
    const r = procesar('Te escribirá un asesor. [CIERRE]', entrada(sd), sd);
    expect(r['avisar']).toBe(false);
    expect(r['avisos']).toContain('cierre_sin_datos');
    expect(r['respuesta']).not.toContain('[CIERRE]');
  });

  it('con empresa, contacto y rubro, el cierre avisa UNA vez, sin botón ni enlace', () => {
    const sd: J = {};
    const ent = entrada(sd);
    // Sin `flujos`: ya no es obligatorio, se deduce del rubro.
    const datos = '[LEAD]{"empresa":"Salón Rosa","contacto":"Ana","rubro":"belleza"}[/LEAD]';
    const r = procesar(`Listo, Ana: un especialista te escribirá. ${datos}[CIERRE]`, ent, sd);
    expect(r['avisar']).toBe(true);
    expect(r['estadoLead']).toBe('cerrado');
    // La persona ya fue avisada: un botón solo invitaría a un mensaje pagado
    // que repite el traspaso. Y el enlace a wa.me ya no existe.
    expect(r['cuerpoMeta']).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('wa.me');
    expect(sd['conversaciones'][TEL]['etapa']).toBe('cerrado');
    // El aviso queda dado cuando Meta acepta la plantilla (ver «El aviso a una persona»).
    correr('Confirmar envío', [correr('Salida', [r])[0]!],
      { 'Enviar a WhatsApp': { statusCode: 200 }, 'Avisar a NovuChat': { statusCode: 200 } }, sd);
    // Un segundo [CIERRE] no vuelve a avisar: la plantilla se cobra.
    const r2 = procesar('Gracias de nuevo. [CIERRE]', entrada(sd), sd);
    expect(r2['avisar']).toBe(false);
  });

  it('un [LEAD] con JSON roto no rompe nada y queda anotado', () => {
    const sd: J = {};
    const r = procesar('Perfecto. [LEAD]{empresa: Salón[/LEAD]', entrada(sd), sd);
    expect(r['respuesta']).toBe('Perfecto.');
    expect(r['avisos']).toContain('lead_invalido');
  });

  it('prohibición 4: si el modelo niega ser una IA, se corrige', () => {
    const sd: J = {};
    const r = procesar('No soy un bot, soy una persona del equipo.', entrada(sd), sd);
    expect(r['respuesta']).toMatch(/inteligencia artificial/);
    expect(r['avisos']).toContain('correccion_ia');
  });

  it('al terminar el primer bloque la respuesta lleva el botón de respuesta «asesor», sin cerrar', () => {
    const sd: J = {};
    const cfg = config(PANEL({ topeAviso: 3 }));
    entrada(sd, cfg); entrada(sd, cfg);
    const tercera = entrada(sd, cfg);
    expect(tercera['finBloque']).toBe(true);
    const r = procesar('Te respondo esto. ¿Quieres hablar con un asesor?', tercera, sd);
    expect(r['cuerpoMeta']['interactive']['type']).toBe('button');
    expect(r['cuerpoMeta']['interactive']['action']['buttons']).toEqual([
      { type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } }]);
    expect(r['avisar']).toBe(false);
    // Si Meta rechaza el interactivo, el texto dice cómo pedirlo sin botón.
    expect(r['textoRespaldo']).toContain('«asesor»');
  });
});

// ===========================================================================
describe('Ramas sin modelo', () => {
  const ent = () => ({ ...config(), from: TEL, nombrePerfil: 'Ana' });

  it('bienvenida: dos botones, títulos de hasta 20 caracteres', () => {
    const r = correr('Bienvenida', [ent()])[0]!;
    const botones = r['cuerpoMeta']['interactive']['action']['buttons'] as J[];
    expect(botones.map((b) => b['reply']['id'])).toEqual(['cliente_actual', 'cliente_nuevo']);
    for (const b of botones) expect(String(b['reply']['title']).length).toBeLessThanOrEqual(20);
    expect(r['respuesta']).toMatch(/inteligencia artificial/i);
  });

  it('cliente actual: enlace a la consola, botón a una persona y NINGÚN código', () => {
    const r = correr('Cliente actual', [ent()])[0]!;
    expect(r['respuesta']).toContain('consola.novuchat.site');
    expect(r['respuesta']).not.toMatch(/c[oó]digo|XXXXX|contrase[nñ]a:\s*\S/i);
    const boton = r['cuerpoMeta']['interactive']['action']['parameters'];
    expect(boton['url']).toMatch(/^https:\/\/wa\.me\/59170000000/);
    expect(String(boton['display_text']).length).toBeLessThanOrEqual(20);
  });

  it('cliente actual sin número de recepción: solo texto, sin botón roto', () => {
    const r = correr('Cliente actual', [{ ...ent(), numeroRecepcion: '' }])[0]!;
    expect(r['cuerpoMeta']).toBeUndefined();
  });

  it('uso extendido en operador: mensaje fijo y aviso la primera vez', () => {
    const r = correr('Uso extendido', [{ ...ent(), atencionEstado: 'operador', atencionAvisarRecepcion: 'operador' }])[0]!;
    expect(r['responder']).toBe(true);
    expect(r['respuesta']).toMatch(/una persona del equipo/);
    expect(r['avisar']).toBe(true);
    const sin = correr('Uso extendido', [{ ...ent(), atencionEstado: 'operador', atencionAvisarRecepcion: '' }])[0]!;
    expect(sin['avisar']).toBe(false);
  });

  it('uso extendido bloqueado: al cliente no le sale nada', () => {
    const r = correr('Uso extendido', [{ ...ent(), atencionEstado: 'bloqueado', atencionAvisarRecepcion: 'bloqueado' }])[0]!;
    expect(r['responder']).toBe(false);
    expect(r['respuesta']).toBe('');
    expect(r['avisar']).toBe(true);
  });

  it('ningún texto fijo usa voseo', () => {
    for (const n of ['Bienvenida', 'Cliente actual', 'Uso extendido', 'Traspaso a un asesor']) {
      const r = correr(n, [{ ...ent(), atencionEstado: 'operador' }])[0]!;
      expect(`${r['respuesta']} ${r['textoRespaldo'] ?? ''}`).not.toMatch(VOSEO);
    }
  });
});

// ===========================================================================
describe('Salida: una sola compuerta y un solo mensaje', () => {
  const salir = (e: J) => correr('Salida', [{ ...config(), from: TEL, ...e }])[0]!;

  it('una respuesta de texto sale como texto', () => {
    const r = salir({ respuesta: 'Hola, ¿en qué te ayudo?' });
    expect(r['cuerpoMeta']).toMatchObject({ type: 'text', to: TEL, text: { body: 'Hola, ¿en qué te ayudo?' } });
    expect(r['esInteractivo']).toBe(false);
  });

  it('un interactivo demasiado largo se baja a texto con el enlace adentro', () => {
    const largo = 'x'.repeat(1100);
    const r = salir({
      respuesta: largo, textoRespaldo: `${largo}\n\nhttps://wa.me/59170000000`,
      cuerpoMeta: { type: 'interactive', interactive: { type: 'cta_url', body: { text: largo },
        action: { name: 'cta_url', parameters: { display_text: 'Hablar con un asesor', url: 'https://wa.me/59170000000' } } } },
    });
    expect(r['esInteractivo']).toBe(false);
    expect(r['cuerpoMeta']['type']).toBe('text');
    expect(r['cuerpoMeta']['text']['body']).toContain('https://wa.me/59170000000');
  });

  it('el aviso usa la plantilla con seis variables limpias, nunca vacías', () => {
    const r = salir({ respuesta: 'ok', avisar: true, estadoAviso: 'datos completos',
      lead: { empresa: 'Salón\nRosa', contacto: 'Ana', rubro: '', flujos: 'Citas' } });
    const t = r['cuerpoAviso']['template'];
    expect(t['name']).toBe('solicitud_contacto');
    expect(t['language']['code']).toBe('es');
    const valores = (t['components'][0]['parameters'] as J[]).map((p) => p['text'] as string);
    expect(valores).toHaveLength(6);
    expect(valores[1]).toBe('Salón · Rosa');
    expect(valores[3]).toBe('no indicado');
    expect(valores[5]).toBe(TEL);
    for (const v of valores) { expect(v).not.toMatch(/\n|\t/); expect(v.length).toBeGreaterThan(0); }
    expect(r['cuerpoAviso']['to']).toBe('59170000000');
  });

  it('sin CRM configurado no se intenta guardar; con CRM https, sí', () => {
    expect(salir({ respuesta: 'ok', guardarLead: true })['guardar']).toBe(false);
    const r = salir({ respuesta: 'ok', guardarLead: true, crmUrl: 'https://crm.ejemplo/leads', lead: { empresa: 'X' } });
    expect(r['guardar']).toBe(true);
    expect(r['cuerpoCrm']).toMatchObject({ origen: 'whatsapp', telefono: TEL, empresa: 'X' });
    expect(salir({ respuesta: 'ok', guardarLead: true, crmUrl: 'http://crm.ejemplo' })['guardar']).toBe(false);
  });

  it('a nadie se le avisa de su propio mensaje (misma regla que el Demo B, #68)', () => {
    // Quien prueba desde el número de recepción recibiría el aviso de su propio
    // mensaje: un mensaje pagado que no dice nada nuevo.
    const propio = salir({ from: '59170000000', respuesta: 'ok', avisar: true, estadoAviso: 'datos completos' });
    expect(propio['avisar']).toBe(false);
    expect(propio['cuerpoAviso']).toBeNull();
    const ajeno = salir({ respuesta: 'ok', avisar: true, estadoAviso: 'datos completos' });
    expect(ajeno['avisar']).toBe(true);
  });

  it('con el teléfono bloqueado no sale nada al cliente', () => {
    const r = salir({ respuesta: '', responder: false, avisar: true, estadoAviso: 'x' });
    expect(r['responder']).toBe(false);
    expect(r['respuesta']).toBe('');
    expect(r['avisar']).toBe(true);
  });

  it('el respaldo siempre es texto', () => {
    const r = salir({ respuesta: 'hola', cuerpoMeta: { type: 'interactive', interactive: { type: 'button', body: { text: 'hola' } } } });
    expect(r['cuerpoRespaldo']['type']).toBe('text');
  });
});

// ===========================================================================
// Aceptación real del 15/09/2026: Meta respondió 190 (credencial mal asignada).
// La bienvenida ya estaba marcada y ese teléfono no volvió a recibir los
// botones; y un texto rechazado terminaba la ejecución en «success».
describe('Confirmar envío: solo se da por hecho lo que Meta aceptó', () => {
  const RECHAZO_190 = { statusCode: 401, body: { error: {
    message: 'Error validating access token: The session is invalid.', type: 'OAuthException',
    code: 190, fbtrace_id: 'AbCdEf' } } };
  const ACEPTADO = { statusCode: 200, body: { messages: [{ id: 'wamid.aceptado' }] } };

  const confirmar = (salida: J[], envio?: J | J[], respaldo?: J | J[], sd: J = {}) => {
    const ctx: Record<string, J | J[]> = {};
    if (envio !== undefined) ctx['Enviar a WhatsApp'] = envio;
    if (respaldo !== undefined) ctx['Enviar texto de respaldo'] = respaldo;
    return correr('Confirmar envío', salida, ctx, sd);
  };
  const error = (f: () => unknown): string => {
    try { f(); } catch (err) { return (err as Error).message; }
    return '';
  };
  /** Un turno por los nodos versionados: Normalizar → Estado → rama → Salida. */
  const turno = (msg: J, sd: J) => {
    const e = estado(normalizar(msg), sd)[0]!;
    const rama = e['accion'] === 'bienvenida'
      ? correr('Bienvenida', [e])[0]!
      : { ...e, respuesta: 'Tu cita es el martes, Ana.' };
    return correr('Salida', [rama])[0]!;
  };

  it('(a) si Meta rechaza la bienvenida, el siguiente «hola» vuelve a recibir los botones', () => {
    const sd: J = {};
    const s = turno(texto('hola'), sd);
    expect(s['accion']).toBe('bienvenida');
    expect(s['esInteractivo']).toBe(true);
    expect(error(() => confirmar([s], RECHAZO_190, RECHAZO_190, sd))).toMatch(/código 190/);
    expect(sd['conversaciones'][TEL]['bienvenida']).toBe(false);
    expect(turno(texto('hola'), sd)['accion']).toBe('bienvenida');
  });

  it('(a) con la bienvenida aceptada, un segundo «hola» ya no repite los botones', () => {
    const sd: J = {};
    const s = turno(texto('hola'), sd);
    expect(confirmar([s], ACEPTADO, undefined, sd)).toHaveLength(1);
    expect(sd['conversaciones'][TEL]['bienvenida']).toBe(true);
    expect(turno(texto('hola'), sd)['accion']).toBe('agente');
  });

  it('(a) si el interactivo falla pero el respaldo en texto sale, la bienvenida cuenta como dada', () => {
    const sd: J = {};
    const s = turno(texto('hola'), sd);
    const r = confirmar([s], { statusCode: 400, body: { error: { code: 131009, message: 'Parameter value is not valid' } } },
      ACEPTADO, sd);
    // Se reporta lo que de verdad salió: el texto de respaldo, como texto.
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ from: TEL, esInteractivo: false, porRespaldo: true });
    expect(r[0]!['respuesta']).toBe(s['cuerpoRespaldo']['text']['body']);
    expect(r[0]!['respuesta']).toContain('Escríbeme «soy cliente»');
    expect(turno(texto('hola'), sd)['accion']).toBe('agente');
  });

  it('(b) un TEXTO rechazado termina la ejecución en error, con el código de Meta y sin datos del cliente', () => {
    const s = turno(texto('Hola, quiero agendar'), {});
    expect(s['esInteractivo']).toBe(false);
    const m = error(() => confirmar([s], { statusCode: 400, body: { error: {
      code: 131030, type: 'OAuthException', fbtrace_id: 'Xyz',
      message: `(#131030) Recipient phone number ${TEL} not in allowed list` } } }));
    expect(m).toMatch(/^Meta rechazó el mensaje al cliente: HTTP 400, código 131030, OAuthException/);
    expect(m).toMatch(/\(texto, turno agente\)/);
    // Ni el teléfono ni lo que se le iba a decir: el error queda en n8n.
    expect(m).not.toContain(TEL);
    expect(m).not.toContain('martes');
    expect(m).not.toContain('\n');
  });

  it('(b) si también se rechaza el texto de respaldo, termina en error con los dos códigos', () => {
    const s = turno(texto('hola'), {});
    const m = error(() => confirmar([s], { statusCode: 400, body: { error: { code: 131009, message: 'bad param' } } },
      RECHAZO_190));
    expect(m).toMatch(/HTTP 401, código 190/);
    expect(m).toMatch(/respaldo en texto, turno bienvenida; antes el interactivo: HTTP 400, código 131009/);
  });

  it('(b) un envío que ni llegó a Meta (tiempo agotado) también es un error', () => {
    const s = turno(texto('Hola, quiero agendar'), {});
    const m = error(() => confirmar([s], { error: { message: 'timeout of 15000ms exceeded' } }));
    expect(m).toMatch(/sin respuesta HTTP: timeout of 15000ms exceeded/);
  });

  it('(b) lo que no salió no llega al reporte; lo que salió se reporta como saliente, con su texto', () => {
    const s = turno(texto('Hola, quiero agendar'), {});
    // Rechazado: el nodo corta, y «Reportar mensaje (saliente)» no recibe nada.
    expect(error(() => confirmar([s], RECHAZO_190))).not.toBe('');
    const [ok] = confirmar([s], ACEPTADO);
    const cuerpo = nodo('Reportar mensaje (saliente)').parameters['jsonBody'] as string;
    // Se evalúa la expresión VERSIONADA del reporte con lo que sale de «Confirmar envío».
    // nosemgrep: devsecops.js-eval-prohibido
    const armar = new Function('$json', `return (${/^=\{\{([\s\S]*)\}\}$/.exec(cuerpo)![1]});`) as (j: J) => string;
    expect(JSON.parse(armar(ok!))).toEqual({
      telefono: TEL, direccion: 'saliente', tipo: 'text', texto: 'Tu cita es el martes, Ana.' });
  });

  it('con el teléfono bloqueado no se envió nada: no hay nada que confirmar ni que reportar', () => {
    expect(confirmar([{ from: TEL, responder: false, avisar: true }])).toEqual([]);
  });
});

// ===========================================================================
// Primera prueba con teléfonos reales, 15/09/2026. El cierre marcó `avisado`
// por su cuenta, pero la plantilla `solicitud_contacto` estaba todavía en
// revisión y Meta rechazó el envío (132001, ejecución 2349): los cuatro
// prospectos quedaron «avisados», sin botón y sin que nadie los llamara.
describe('El aviso a una persona: solo se da por hecho si Meta lo aceptó', () => {
  const RECHAZO_132001 = { statusCode: 400, body: { error: {
    message: 'Template name (solicitud_contacto) does not exist in es', type: 'OAuthException',
    code: 132001, error_subcode: 2494010, fbtrace_id: 'Zz9' } } };
  const ACEPTADO = { statusCode: 200, body: { messages: [{ id: 'wamid.aviso' }] } };
  const BOTON = [{ type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } }];
  const DATOS = '[LEAD]{"empresa":"Salón Rosa","contacto":"Ana","rubro":"belleza"}[/LEAD]';

  const procesar = (salidaAgente: string, ent: J, sd: J) =>
    correr('Procesar respuesta', [{ output: salidaAgente }], { 'Estado de la conversación': ent }, sd)[0]!;
  /** Un turno de cierre completo: Estado → Procesar respuesta → Salida. */
  const cerrar = (sd: J) => {
    const e = estado(normalizar(texto('quiero que me llamen')), sd)[0]!;
    return correr('Salida', [procesar(`Listo, Ana: un asesor te escribirá. ${DATOS}[CIERRE]`, e, sd)])[0]!;
  };
  const confirmar = (s: J, aviso: J, sd: J) => correr('Confirmar envío', [s],
    { 'Enviar a WhatsApp': { statusCode: 200, body: { messages: [{ id: 'wamid.ok' }] } },
      'Avisar a NovuChat': aviso }, sd);

  it('la plantilla rechazada NO marca «avisado» y queda anotada, sin el teléfono del cliente', () => {
    const sd: J = {};
    const s = cerrar(sd);
    expect(s['avisar']).toBe(true);
    const [reportado] = confirmar(s, RECHAZO_132001, sd);
    expect(sd['conversaciones'][TEL]['avisado']).toBe(false);
    // Se ve en los datos de la ejecución y en el estado de la conversación.
    expect(String(reportado!['avisos'])).toMatch(/^aviso_rechazado: HTTP 400, código 132001/);
    expect(String(sd['conversaciones'][TEL]['avisoFalla'])).toContain('subcódigo 2494010');
    expect(String(reportado!['avisos'])).not.toContain(TEL);
    // Y la respuesta al cliente, que sí salió, se reporta igual: el servidor la cuenta.
    expect(reportado!['respuesta']).toBeTruthy();
  });

  it('la plantilla aceptada sí lo marca, y no se vuelve a avisar', () => {
    const sd: J = {};
    confirmar(cerrar(sd), ACEPTADO, sd);
    expect(sd['conversaciones'][TEL]['avisado']).toBe(true);
    expect(sd['conversaciones'][TEL]['avisoFalla']).toBeUndefined();
    expect(cerrar(sd)['avisar']).toBe(false);
  });

  it('cerrado y sin aviso, el botón «Hablar con un asesor» sigue saliendo (en el mismo mensaje)', () => {
    const sd: J = {};
    confirmar(cerrar(sd), RECHAZO_132001, sd);
    expect(sd['conversaciones'][TEL]['etapa']).toBe('cerrado');
    const e = estado(normalizar(texto('¿y cuánto sale?')), sd)[0]!;
    expect(e['mensajeDelTurno']).toMatch(/el aviso al asesor NO salió/);
    const r = procesar('El plan de entrada arranca en 25 dólares al mes.', e, sd);
    expect(r['cuerpoMeta']['interactive']['action']['buttons']).toEqual(BOTON);
    const s = correr('Salida', [r])[0]!;
    expect(s['esInteractivo']).toBe(true);
    // No agrega un mensaje: el botón va dentro de la misma respuesta.
    expect(s['avisar']).toBe(false);
    expect(s['cuerpoAviso']).toBeNull();
  });

  it('cerrado y con el aviso aceptado, no vuelve a ofrecer el botón', () => {
    const sd: J = {};
    confirmar(cerrar(sd), ACEPTADO, sd);
    const e = estado(normalizar(texto('¿y cuánto sale?')), sd)[0]!;
    expect(e['mensajeDelTurno']).toMatch(/Ya se avisó a un asesor/);
    expect(procesar('El plan de entrada arranca en 25 dólares al mes.', e, sd)['cuerpoMeta']).toBeUndefined();
  });

  it('el traspaso sin modelo reintenta el aviso que Meta rechazó, y deja de hacerlo cuando sale', () => {
    const sd: J = {};
    const tocar = { type: 'interactive', interactive: { button_reply: { id: 'asesor', title: 'Hablar con un asesor' } } };
    const traspaso = () => correr('Salida',
      [correr('Traspaso a un asesor', [estado(normalizar(tocar), sd)[0]!], {}, sd)[0]!])[0]!;
    const primero = traspaso();
    expect(primero['avisar']).toBe(true);
    confirmar(primero, RECHAZO_132001, sd);
    expect(sd['conversaciones'][TEL]['avisado']).toBe(false);
    // Un mensaje que Meta rechaza no se cobra: reintentarlo no suma costo.
    const segundo = traspaso();
    expect(segundo['avisar']).toBe(true);
    confirmar(segundo, ACEPTADO, sd);
    expect(sd['conversaciones'][TEL]['avisado']).toBe(true);
    expect(traspaso()['avisar']).toBe(false);
  });

  it('con el teléfono bloqueado no sale nada al cliente, pero el aviso igual se verifica', () => {
    const sd: J = {};
    const cfg = config(PANEL({}, { estado: 'bloqueado', avisarRecepcion: 'bloqueado', respuestasEnVentana: 100 }));
    const e = estado(normalizar(texto('otra más'), cfg), sd)[0]!;
    const s = correr('Salida', [correr('Uso extendido', [e])[0]!])[0]!;
    expect([s['responder'], s['avisar']]).toEqual([false, true]);
    expect(correr('Confirmar envío', [s], { 'Avisar a NovuChat': ACEPTADO }, sd)).toEqual([]);
    expect(sd['conversaciones'][TEL]['avisado']).toBe(true);
  });

  it('un CRM que rechaza el prospecto queda anotado y no marca nada', () => {
    const sd: J = {};
    const e = estado(normalizar(texto('Hola, quiero info')), sd)[0]!;
    const r = procesar('Gracias, Ana. [LEAD]{"empresa":"Salón Rosa"}[/LEAD]', e, sd);
    const s = correr('Salida', [{ ...r, crmUrl: 'https://crm.ejemplo/leads' }])[0]!;
    expect(s['guardar']).toBe(true);
    const [reportado] = correr('Confirmar envío', [s],
      { 'Enviar a WhatsApp': { statusCode: 200 }, 'Guardar prospecto': { statusCode: 503, body: {} } }, sd);
    expect(String(reportado!['avisos'])).toMatch(/^crm_rechazado: HTTP 503/);
  });

  it('los dos nodos internos responden completo, para que haya veredicto que leer', () => {
    for (const n of ['Avisar a NovuChat', 'Guardar prospecto']) {
      expect(nodo(n).parameters['options']['response']['response'])
        .toMatchObject({ fullResponse: true, neverError: true });
      expect((nodo(n) as unknown as J)['onError']).toBe('continueRegularOutput');
    }
  });
});

// ===========================================================================
// A las 24 h el servidor abre otra ventana y factura otra conversación. Lo que
// el flujo recuerda del turno tiene que vencer con ella: el 15/09 un prospecto
// que volvía seguía «cerrado y avisado», sin bienvenida y sin botón.
describe('Una ventana nueva es una conversación nueva', () => {
  const LEAD = { empresa: 'Salón Rosa', contacto: 'Ana', rubro: 'belleza' };
  const vencida = (): J => ({ conversaciones: { [TEL]: {
    desde: Date.now() - 25 * 3_600_000, ultimo: Date.now() - 25 * 3_600_000, respuestas: 12,
    etapa: 'cerrado', bienvenida: true, avisado: true, esperaRubro: true,
    avisoFalla: 'aviso_rechazado: HTTP 400, código 132001', lead: { ...LEAD } } } });

  it('al vencer se reinician etapa, bienvenida y aviso; los datos del prospecto se conservan', () => {
    const sd = vencida();
    const r = estado(normalizar(texto('hola')), sd)[0]!;
    // Vuelve a ser recibido como la primera vez: +1 mensaje por ventana nueva.
    expect(r['accion']).toBe('bienvenida');
    const c = sd['conversaciones'][TEL];
    expect([c['etapa'], c['bienvenida'], c['avisado'], c['esperaRubro'], c['respuestas']])
      .toEqual(['', false, false, false, 1]);
    expect(c['avisoFalla']).toBeUndefined();
    expect(c['lead']).toEqual(LEAD);
    // Y el prompt sigue sabiendo lo que ya dijo: no se lo vuelve a preguntar.
    expect(r['mensajeDelTurno']).toContain('"empresa":"Salón Rosa"');
    expect(r['mensajeDelTurno']).toContain('Faltan: ninguno');
    expect(r['mensajeDelTurno']).not.toMatch(/Ya se avisó|NO salió/);
  });

  it('la bienvenida de la ventana nueva es UNA sola: dentro de la ventana no se repite', () => {
    const sd = vencida();
    const primero = correr('Salida', [correr('Bienvenida', [estado(normalizar(texto('hola')), sd)[0]!])[0]!])[0]!;
    correr('Confirmar envío', [primero], { 'Enviar a WhatsApp': { statusCode: 200 } }, sd);
    expect(estado(normalizar(texto('hola')), sd)[0]!['accion']).toBe('agente');
  });

  it('dentro de la ventana no se reinicia nada', () => {
    const sd: J = { conversaciones: { [TEL]: { desde: Date.now() - 3_600_000, ultimo: Date.now() - 60_000,
      respuestas: 3, etapa: 'cerrado', bienvenida: true, avisado: true, lead: { ...LEAD } } } };
    expect(estado(normalizar(texto('hola')), sd)[0]!['accion']).toBe('agente');
    const c = sd['conversaciones'][TEL];
    expect([c['etapa'], c['bienvenida'], c['avisado']]).toEqual(['cerrado', true, true]);
  });

  it('el prospecto que vuelve y pide otra vez una persona genera un aviso nuevo', () => {
    const sd = vencida();
    estado(normalizar(texto('hola')), sd);
    const e = estado(normalizar(texto('quiero que me llamen')), sd)[0]!;
    const r = correr('Procesar respuesta', [{ output: 'Claro, un asesor te escribirá. [CIERRE]' }],
      { 'Estado de la conversación': e }, sd)[0]!;
    // Cierra con los datos que ya tenía, y avisa: es otra conversación facturada.
    expect(r['avisar']).toBe(true);
    expect(correr('Salida', [r])[0]!['cuerpoAviso']['template']['name']).toBe('solicitud_contacto');
  });
});

// ===========================================================================
describe('Estructura del flujo', () => {
  const entradas = (destino: string) => Object.entries(flujo.connections)
    .flatMap(([origen, tipos]) => Object.values(tipos).flat().flat()
      .filter((c) => c.node === destino).map(() => origen));

  // La API de n8n rechaza un flujo con dos nodos del mismo `id` (HTTP 400,
  // duplicate_node_id); la importación por la interfaz, en cambio, los reasigna
  // sin avisar. Pasó el 15/09: el flujo se importó bien a mano y
  // `publicar-flujo.sh --aplicar` no lo pudo actualizar.
  it('ningún flujo versionado repite el `id` de un nodo', () => {
    const dir = join(aqui, '../../Flujos');
    for (const archivo of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.local.json'))) {
      const ids = (JSON.parse(readFileSync(join(dir, archivo), 'utf8')) as Flujo).nodes.map((n) => (n as { id?: string }).id);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i), archivo).toEqual([]);
    }
  });

  it('el disparador solo escucha mensajes, y antes de todo filtra los acuses', () => {
    expect(nodo('WhatsApp Trigger').parameters['updates']).toEqual(['messages']);
    expect(entradas('Config base')).toEqual(['¿Es un mensaje?']);
  });

  it('`.text.body` solo se lee en «Normalizar entrada»', () => {
    const conTextBody = flujo.nodes.filter((n) => JSON.stringify(n.parameters).includes('.text?.body')
      || JSON.stringify(n.parameters).includes('.text.body'));
    expect(conTextBody.map((n) => n.name)).toEqual(['Normalizar entrada']);
  });

  it('la memoria usa el teléfono como clave de sesión', () => {
    const m = nodo('Memoria por teléfono').parameters;
    expect(m['sessionIdType']).toBe('customKey');
    expect(m['sessionKey']).toMatch(/\.from\s*\}\}$/);
  });

  it('el modelo es un sub-nodo intercambiable y el agente no tiene herramientas', () => {
    expect(flujo.connections['Google Gemini Chat Model']?.['ai_languageModel']?.[0]?.[0]?.node).toBe('AI Agent NovuChat');
    expect(flujo.connections['Memoria por teléfono']?.['ai_memory']?.[0]?.[0]?.node).toBe('AI Agent NovuChat');
    const herramientas = Object.values(flujo.connections).filter((t) => t['ai_tool']);
    expect(herramientas).toHaveLength(0);
  });

  it('las instrucciones del agente no cambian entre turnos: se pueden cachear', () => {
    const s = nodo('AI Agent NovuChat').parameters['options']['systemMessage'] as string;
    for (const variable of ['$now', 'Date', 'respuestasEnVentana', '.from', 'mensajeDelTurno', 'leadConocido']) {
      expect(s).not.toContain(variable);
    }
    expect(nodo('AI Agent NovuChat').parameters['text']).toBe('={{ $json.mensajeDelTurno }}');
  });

  it('las instrucciones sostienen la prohibición 4 y el tuteo', () => {
    const s = nodo('AI Agent NovuChat').parameters['options']['systemMessage'] as string;
    expect(s).toMatch(/inteligencia artificial/);
    expect(s).toMatch(/Nunca digas que eres una persona/);
    expect(s).not.toMatch(VOSEO);
    expect(s).toMatch(/nunca «atención»/);
  });

  it('todo lo que sale al cliente pasa por «Salida»', () => {
    for (const rama of ['Bienvenida', 'Cliente actual', 'Uso extendido', 'Traspaso a un asesor',
      'Procesar respuesta', 'Comercio no operativo']) {
      expect(flujo.connections[rama]?.['main']?.[0]?.map((c) => c.node)).toEqual(['Salida']);
    }
    // El comienzo EXACTO de la URL, no «contiene»: una comparación por
    // subcadena también aceptaría un host arbitrario que la mencione (CodeQL).
    const META = /^=?https:\/\/graph\.facebook\.com\//;
    const aGraph = flujo.nodes.filter((n) => META.test(String(n.parameters['url'] ?? '')));
    expect(aGraph.map((n) => n.name).sort()).toEqual(['Avisar a NovuChat', 'Enviar a WhatsApp', 'Enviar texto de respaldo']);
    expect(entradas('¿Responder?')).toEqual(['Salida']);
    expect(entradas('Enviar a WhatsApp')).toEqual(['¿Responder?']);
    expect(entradas('Enviar texto de respaldo')).toEqual(['¿Falló el interactivo?']);
    expect(entradas('¿Falló el interactivo?')).toEqual(['Enviar a WhatsApp']);
  });

  it('en operador o bloqueado el agente NO es alcanzable', () => {
    // La rama verdadera de «¿Uso extendido?» no llega al agente por ningún camino.
    const alcanzables = new Set<string>();
    const pendientes = (flujo.connections['¿Uso extendido?']?.['main']?.[0] ?? []).map((c) => c.node);
    while (pendientes.length) {
      const n = pendientes.pop() as string;
      if (alcanzables.has(n)) continue;
      alcanzables.add(n);
      for (const salida of flujo.connections[n]?.['main'] ?? []) pendientes.push(...salida.map((c) => c.node));
    }
    expect(alcanzables.has('AI Agent NovuChat')).toBe(false);
    expect(nodo('¿Uso extendido?').parameters['conditions']['conditions'][0]['rightValue']).toBe('uso_extendido');
  });

  it('pide la configuración CON el teléfono, para recibir el estado de atención', () => {
    expect(nodo('Traer configuración').parameters['jsonBody']).toMatch(/telefono/);
  });

  it('el mensaje del cliente se reporta ANTES que la respuesta (orden v1, defecto del #66)', () => {
    // Con `executionOrder: v1` n8n corre las ramas de arriba hacia abajo en el
    // lienzo. Si la respuesta se reportara primero, la marca que evita el doble
    // aviso ya estaría puesta y el aviso de los umbrales no saldría nunca.
    expect((flujo as unknown as J)['settings']['executionOrder']).toBe('v1');
    const y = (n: string) => ((nodo(n) as unknown as J)['position'] as number[])[1]!;
    expect(entradas('Reportar mensaje (entrante)')).toEqual(['Normalizar entrada']);
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
  });

  it('la rama falsa de «¿Comercio operativo?» va al aviso neutro, nunca al agente', () => {
    const salidas = flujo.connections['¿Comercio operativo?']?.['main'] ?? [];
    expect((salidas[1] ?? []).map((c) => c.node)).toEqual(['Comercio no operativo']);
  });

  it('el aviso y el CRM nunca cortan la respuesta al cliente', () => {
    for (const n of ['Avisar a NovuChat', 'Guardar prospecto', 'Reportar mensaje (entrante)', 'Reportar mensaje (saliente)']) {
      expect((nodo(n) as unknown as J)['onError']).toBe('continueRegularOutput');
    }
  });

  it('la respuesta se reporta SOLO si Meta la aceptó: el saliente cuelga de «Confirmar envío»', () => {
    // El servidor cuenta cada saliente como respuesta del bloque (`ingesta.ts`):
    // colgado de «¿Responder?», un mensaje rechazado se facturaba igual.
    expect(entradas('Reportar mensaje (saliente)')).toEqual(['Confirmar envío']);
    expect(entradas('Confirmar envío')).toEqual(['Salida']);
    // Ni el envío ni su respaldo cortan el flujo; el veredicto es de «Confirmar
    // envío», que SÍ corta: sin `onError`, su error es el de la ejecución.
    for (const n of ['Enviar a WhatsApp', 'Enviar texto de respaldo']) {
      expect((nodo(n) as unknown as J)['onError']).toBe('continueRegularOutput');
      expect(nodo(n).parameters['options']['response']['response']).toMatchObject({ fullResponse: true, neverError: true });
    }
    expect((nodo('Confirmar envío') as unknown as J)['onError']).toBeUndefined();
  });

  it('«Confirmar envío» corre ÚLTIMO: es el hijo más bajo de «Salida» (orden v1)', () => {
    // Si corriera antes que la rama del envío, leería un envío que no ocurrió;
    // y su error cortaría el aviso interno y el CRM.
    const y = (n: string) => ((nodo(n) as unknown as J)['position'] as number[])[1]!;
    const hijos = (flujo.connections['Salida']?.['main']?.[0] ?? []).map((c) => c.node);
    expect(hijos).toContain('Confirmar envío');
    for (const h of hijos.filter((x) => x !== 'Confirmar envío')) expect(y(h)).toBeLessThan(y('Confirmar envío'));
  });

  it('está saneado: marcadores, ninguna credencial con id y ningún token', () => {
    expect(TEXTO_FLUJO).toContain('REEMPLAZAR_');
    for (const n of flujo.nodes) {
      for (const ref of Object.values(n.credentials ?? {})) expect(ref.id).toBe('');
    }
    expect(TEXTO_FLUJO).not.toMatch(/EAA[A-Za-z0-9]{20,}/);
  });

  it('no arrastra nada del cobro de los demos', () => {
    expect(TEXTO_FLUJO).not.toMatch(/ENVIAR_QR|PEDIDO_CONFIRMADO|rotuloDemo|qrMediaId/);
  });
});

// ===========================================================================
// El guion de Silvana del 15/09 con las correcciones de Andres: nombre del
// asistente y emojis desde la consola, rubro deducido o por número, planes
// armados por código, botón «Hablar con un asesor» y traspaso sin modelo, sin
// NIT, horario opcional y aclaraciones rotuladas.
describe('Captación con la oferta de la consola (guion del 15/09)', () => {
  const RUBROS = [
    { id: 'a_medida', nombre: 'Otro rubro (a medida)', solucion: 'Un asesor arma tu asistente a medida.', flujoSugerido: '' },
    { id: 'belleza', nombre: 'Salud y belleza', solucion: 'Agenda sola y recuerda las citas.', flujoSugerido: 'citas' },
    { id: 'gastronomia', nombre: 'Gastronomía', solucion: 'Toma el pedido y calcula el envío.', flujoSugerido: 'ventas' },
  ];
  const PLANES = [
    { nombre: 'Impulso', precioUsd: 25, periodo: 'mes', incluye: 'Hasta 100 conversaciones' },
    { nombre: 'Crecimiento', precioUsd: 50, periodo: 'mes', incluye: 'Hasta 220 conversaciones.' },
    { nombre: 'Pro', precioUsd: 90, periodo: 'mes', incluye: 'Hasta 500 conversaciones' },
  ];
  const CARGOS = [
    { nombre: 'Instalación', precioUsd: 65, desde: false, detalle: '' },
    { nombre: 'Desarrollo a medida', precioUsd: 125, desde: true, detalle: 'Integración con tu sistema' },
  ];
  const ARCHIVO = { url: 'https://novuchat.site/planes.pdf', tipo: 'pdf', nombreArchivo: 'Planes NovuChat.pdf' };
  const OFERTA = { rubros: RUBROS, planes: PLANES, cargosUnicos: CARGOS, aclaraciones: [
    { tema: 'Qué es una conversación', texto: 'Hasta 25 respuestas a un mismo teléfono en 24 horas.' }] };
  const cfgCon = (onboarding: J = OFERTA, cuerpo: J = {}) => config(PANEL(onboarding, undefined, cuerpo));
  const turnoCon = (msg: J, sd: J, cfg: J) => estado(normalizar(msg, cfg), sd)[0]!;
  const procesar = (salidaAgente: string, ent: J, sd: J) =>
    correr('Procesar respuesta', [{ output: salidaAgente }], { 'Estado de la conversación': ent }, sd)[0]!;
  const EMOJI = /\p{Extended_Pictographic}/gu;
  const botonAsesor = (r: J) => (r['cuerpoMeta']?.['interactive']?.['action']?.['buttons'] ?? []) as J[];
  const BOTON = { type: 'reply', reply: { id: 'asesor', title: 'Hablar con un asesor' } };

  /** Las instrucciones del agente, con las expresiones evaluadas como en n8n. */
  const instrucciones = (cfg: J): string => {
    const s = (nodo('AI Agent NovuChat').parameters['options']['systemMessage'] as string).replace(/^=/, '');
    const $ = (n: string) => ({ first: () => ({ json: n === 'Config del negocio' ? cfg : { conocimiento: 'CORPUS' } }) });
    // nosemgrep: devsecops.js-eval-prohibido
    return s.replace(/\{\{([\s\S]*?)\}\}/g, (_m, expr: string) => String(new Function('$', `return (${expr});`)($)));
  };

  describe('nombre del asistente y emojis, desde la consola', () => {
    const bienvenida = (voz: J) => correr('Bienvenida', [{ ...cfgCon(OFERTA, { voz }), from: TEL }])[0]!;

    it('con nombre se presenta con él; sin nombre, como el asistente virtual del negocio', () => {
      expect(bienvenida({ nombreAsistente: 'Kenji' })['respuesta'])
        .toMatch(/^¡Hola!.*Soy Kenji, el asistente virtual de NovuChat, impulsado por Inteligencia Artificial\./u);
      const sin = bienvenida({ nombreAsistente: '' })['respuesta'] as string;
      expect(sin).toContain('Soy el asistente virtual de NovuChat, impulsado por Inteligencia Artificial.');
      expect(sin).toContain('¿ya eres parte de la familia NovuChat o eres un cliente nuevo');
      // Los dos botones de siempre.
      expect((bienvenida({})['cuerpoMeta']['interactive']['action']['buttons'] as J[]).map((b) => b['reply']['id']))
        .toEqual(['cliente_actual', 'cliente_nuevo']);
    });

    it('el nombre del asistente también llega a las instrucciones del agente', () => {
      expect(instrucciones(cfgCon(OFERTA, { voz: { nombreAsistente: 'Kenji' } })))
        .toMatch(/^Eres Kenji, el asistente virtual de NovuChat, impulsado por inteligencia artificial/);
      expect(instrucciones(cfgCon())).toMatch(/^Eres el asistente virtual de NovuChat,/);
    });

    it('ninguno: sin emojis; pocos: uno como mucho; muchos: los del guion', () => {
      const cuenta = (nivel: string) => (String(bienvenida({ nivelEmojis: nivel })['respuesta']).match(EMOJI) ?? []).length;
      expect(cuenta('ninguno')).toBe(0);
      expect(cuenta('pocos')).toBe(1);
      expect(cuenta('muchos')).toBe(2);
      // Sin emojis no quedan espacios dobles donde estaban.
      expect(bienvenida({ nivelEmojis: 'ninguno' })['respuesta']).toMatch(/^¡Hola! Soy /);
      // Un nivel desconocido cae al respaldo, que es «pocos».
      expect(cfgCon(OFERTA, { voz: { nivelEmojis: 'todos' } })['nivelEmojis']).toBe('pocos');
    });

    it('el traspaso también obedece el nivel de emojis', () => {
      const traspaso = (nivel: string) => correr('Traspaso a un asesor',
        [{ ...cfgCon(OFERTA, { voz: { nivelEmojis: nivel } }), from: TEL }], {}, {})[0]!['respuesta'] as string;
      expect(traspaso('ninguno').match(EMOJI)).toBeNull();
      expect(traspaso('pocos').match(EMOJI)).toHaveLength(1);
      expect(traspaso('muchos').match(EMOJI)).toHaveLength(2);
    });
  });

  describe('planes armados por código', () => {
    const conPlanes = (onboarding: J, salidaAgente = 'Para tu salón, esto te sirve: agenda sola.\n[PLANES]') => {
      const sd: J = {};
      const ent = turnoCon(texto('Hola, quiero info'), sd, cfgCon(onboarding));
      return procesar(salidaAgente, ent, sd);
    };

    it('3 planes y 2 cargos: precios exactos, «desde» donde corresponde, y el botón', () => {
      const r = conPlanes(OFERTA);
      const t = r['respuesta'] as string;
      expect(t).toContain([
        '*Planes*',
        'Impulso (USD 25/mes): Hasta 100 conversaciones.',
        'Crecimiento (USD 50/mes): Hasta 220 conversaciones.',
        'Pro (USD 90/mes): Hasta 500 conversaciones.',
        '',
        '*Cargos únicos*',
        'Instalación (pago único): USD 65.',
        'Desarrollo a medida (pago único): desde USD 125. Integración con tu sistema.',
        '',
        'Precios en dólares; se cobran en bolivianos al tipo de cambio oficial del BCB.',
      ].join('\n'));
      expect(t).toMatch(/^Para tu salón, esto te sirve: agenda sola\./);
      expect(t).not.toContain('[PLANES]');
      // Termina con la pregunta por el especialista, aunque el modelo no la haya puesto.
      expect(t).toMatch(/especialista\?$/);
      expect(r['cuerpoMeta']['interactive']['type']).toBe('button');
      expect(r['cuerpoMeta']['interactive']['header']).toBeUndefined();
      expect(botonAsesor(r)).toEqual([BOTON]);
      expect(String(BOTON.reply.title).length).toBeLessThanOrEqual(20);
      // Cabe en el cuerpo de un interactivo (1024): sale con el botón.
      expect(correr('Salida', [{ ...r, from: TEL }])[0]!['esInteractivo']).toBe(true);
    });

    it('los precios del modelo no pasan: ni un emoji dentro de un precio, y un precio con centavos sale exacto', () => {
      const r = conPlanes({ ...OFERTA, planes: [{ nombre: 'Básico', precioUsd: 12.5, periodo: 'anio', incluye: '' }],
        cargosUnicos: [] });
      expect(r['respuesta']).toContain('Básico (USD 12,50/año).');
      for (const l of String(r['respuesta']).split('\n').filter((x) => /USD/.test(x))) expect(l).not.toMatch(EMOJI);
    });

    it('si el modelo escribe un precio que la consola no tiene, queda anotado', () => {
      const r = conPlanes(OFERTA, 'El plan cuesta USD 30 al mes.\n[PLANES]');
      expect(r['avisos']).toContain('precio_fuera_de_la_consola');
      expect(conPlanes(OFERTA, 'El Impulso cuesta USD 25.\n[PLANES]')['avisos']).not.toContain('precio_fuera_de_la_consola');
    });

    it('con 6 planes en archivo: interactivo con encabezado de documento, sin la lista', () => {
      const seis = [...PLANES, ...PLANES.map((p) => ({ ...p, nombre: `${p.nombre} anual`, periodo: 'anio' }))];
      const r = conPlanes({ ...OFERTA, planes: seis, planesEnArchivo: true, archivoPlanes: ARCHIVO });
      const i = r['cuerpoMeta']['interactive'];
      expect(i['type']).toBe('button');
      expect(i['header']).toEqual({ type: 'document',
        document: { link: 'https://novuchat.site/planes.pdf', filename: 'Planes NovuChat.pdf' } });
      expect(i['body']['text']).not.toMatch(/USD/);
      expect(botonAsesor(r)).toEqual([BOTON]);
      // Si Meta rechaza el interactivo, el texto lleva el enlace al archivo.
      expect(r['textoRespaldo']).toContain('https://novuchat.site/planes.pdf');
      const img = conPlanes({ ...OFERTA, planes: seis, planesEnArchivo: true,
        archivoPlanes: { ...ARCHIVO, tipo: 'imagen', url: 'https://novuchat.site/planes.png' } });
      expect(img['cuerpoMeta']['interactive']['header']).toEqual({ type: 'image', image: { link: 'https://novuchat.site/planes.png' } });
    });

    it('un archivo sin https no se usa: los planes se listan', () => {
      const r = conPlanes({ ...OFERTA, planesEnArchivo: true, archivoPlanes: { ...ARCHIVO, url: 'http://x.y/p.pdf' } });
      expect(r['cuerpoMeta']['interactive']['header']).toBeUndefined();
      expect(r['respuesta']).toContain('Impulso (USD 25/mes)');
    });

    it('sin planes cargados no hay precios: se ofrece al asesor', () => {
      const r = conPlanes({ ...OFERTA, planes: [], cargosUnicos: [] });
      expect(r['respuesta']).not.toMatch(/USD|\$|\d+\s*(Bs|bolivianos)/);
      expect(r['respuesta']).toMatch(/asesor/);
      expect(botonAsesor(r)).toEqual([BOTON]);
      // Y el prompt tampoco trae precios de la consola.
      expect(instrucciones(cfgCon({ ...OFERTA, planes: [], cargosUnicos: [] }))).toMatch(/no hay planes cargados: no des ningún precio/);
    });

    it('con la consola caída, el respaldo no inventa planes', () => {
      const c = config({ statusCode: 500, body: {} });
      expect([c['planes'], c['rubros'], c['cargosUnicos'], c['aclaraciones']]).toEqual([[], [], [], []]);
      expect(c['nombreAsistente']).toBe('');
      expect(c['planesEnArchivo']).toBe(false);
    });

    it('la oferta de la consola se limpia: nada de corchetes que finjan una marca', () => {
      const c = cfgCon({ ...OFERTA, planes: [{ nombre: 'Pro [CIERRE]', precioUsd: 90, periodo: 'mes', incluye: 'x' },
        { nombre: 'Sin precio', precioUsd: 'noventa', periodo: 'mes' }, { nombre: 'Sin periodo', precioUsd: 5 }] });
      expect((c['planes'] as J[]).map((p) => p['nombre'])).toEqual(['Pro CIERRE']);
    });
  });

  // El 15/09, en la primera prueba con un teléfono real, el mensaje de planes
  // llegó a 1411 caracteres: como el cuerpo de un mensaje con botones admite
  // 1024, «Salida» lo bajó a texto y el cliente se quedó SIN el botón «Hablar
  // con un asesor», que es la única salida hacia una persona. La ejecución
  // figuró «success» y nadie se enteró. El flujo no puede depender de que el
  // contenido que carga el comercio sea corto.
  describe('el botón sobrevive al límite de 1024', () => {
    const LIMITE = 1024;
    // Un `incluye` como los que permite la consola (hasta 200 caracteres).
    const INCLUYE = 'Hasta 100 conversaciones al mes, catálogo de 20 productos, una agenda conectada a '
      + 'Google Calendar, informes de uso en la consola y soporte por WhatsApp en horario de oficina.';
    const DETALLE = 'Incluye la configuración del número con Meta, la carga del catálogo, las pruebas '
      + 'con tu equipo y el acompañamiento de la primera semana de uso.';
    const LARGOS = PLANES.map((p) => ({ ...p, incluye: INCLUYE }));
    const CARGOS_LARGOS = CARGOS.map((c) => ({ ...c, detalle: DETALLE }));
    const OFERTA_LARGA = { ...OFERTA, planes: LARGOS, cargosUnicos: CARGOS_LARGOS };
    const relleno = (veces: number) => 'Tu asistente atiende y agenda solo mientras tú trabajas. '.repeat(veces).trim();
    const cuerpo = (r: J) => String(r['cuerpoMeta']?.['interactive']?.['body']?.['text'] ?? '');
    const turnoPlanes = (onboarding: J, salidaAgente: string) => {
      const sd: J = {};
      const ent = turnoCon(texto('Hola, ¿cuánto vale?'), sd, cfgCon(onboarding));
      return procesar(salidaAgente, ent, sd);
    };
    /** Lo que de verdad sale a Meta, con la degradación de «Salida» aplicada. */
    const salida = (r: J) => correr('Salida', [{ ...r, from: TEL }])[0]!;
    const PRECIOS = ['(USD 25/mes)', '(USD 50/mes)', '(USD 90/mes)', 'USD 65', 'desde USD 125'];
    /** La oferta REAL de NovuChat: un `incluye` de una línea por plan (bloque de 645). */
    const MEDIO = [
      'Hasta 100 conversaciones al mes, catálogo de 20 productos, una agenda conectada a Google Calendar y soporte por WhatsApp.',
      'Hasta 220 conversaciones al mes, catálogo de 100 productos, hasta 5 agendas conectadas e informes de uso en la consola.',
      'Hasta 500 conversaciones al mes, catálogo de 500 productos, hasta 10 agendas conectadas e informes de uso en la consola.',
    ];
    const OFERTA_MEDIA = { ...OFERTA, planes: PLANES.map((p, i) => ({ ...p, incluye: MEDIO[i] })) };
    /** El texto del turno sin el límite: lo que el modelo y el bloque miden juntos. */
    const sinLimite = (onboarding: J, salidaAgente: string) => {
      const sd: J = {};
      const cfg = { ...cfgCon(onboarding), limiteInteractivo: 4096 };
      return procesar(salidaAgente, turnoCon(texto('Hola, ¿cuánto vale?'), sd, cfg), sd);
    };

    it('el límite de Meta se declara en la configuración; quien lo usa lo lee, no lo repite', () => {
      // El valor vive en `Config base` y se valida en `Config del negocio`
      // (mismo patrón que `topeAviso`). Los nodos que lo aplican lo reciben:
      // dos números distintos serían un mensaje compactado que igual no entra.
      for (const n of ['Procesar respuesta', 'Salida']) {
        const js = nodo(n).parameters.jsCode as string;
        expect(js).toContain('limiteInteractivo');
        expect(js.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toContain('1024');
      }
      expect(config()['limiteInteractivo']).toBe(LIMITE);
      // Un valor fuera de rango o roto no deja al flujo sin límite.
      const roto = base(); roto['limiteInteractivo'] = 'mil';
      expect(config(PANEL(), roto)['limiteInteractivo']).toBe(LIMITE);
    });

    it('un mensaje que entra no cambia en nada: ni se compacta ni se recorta', () => {
      const r = turnoPlanes(OFERTA, 'Para tu salón, esto te sirve.\n[PLANES]');
      expect(r['respuesta']).toContain('Impulso (USD 25/mes): Hasta 100 conversaciones.');
      expect(r['avisos']).toEqual([]);
      expect(salida(r)['esInteractivo']).toBe(true);
    });

    // EL CASO REAL (producción, ejecución 2536 del 15/09/2026): el modelo
    // escribió unos 380 caracteres y el bloque de planes, unos 650; el mensaje
    // quedó en 1030, SEIS caracteres por encima del límite. Compactando primero
    // el bloque, el cliente recibió «Impulso (USD 25/mes). Crecimiento (USD
    // 50/mes). Pro (USD 90/mes).» —sin las conversaciones incluidas, que es
    // justo lo que se compara al elegir— y le sobró media pantalla. Seis
    // caracteres se resuelven quitando dos palabras del envoltorio.
    it('(a bis) seis caracteres de más se resuelven recortando el texto, NO los planes', () => {
      const PRE = '¡Qué bueno que preguntes! En NovuChat armamos el asistente de tu negocio para que '
        + 'atienda por WhatsApp, agende las citas y responda precios sin que tengas que soltar lo que '
        + 'estás haciendo. Lo instalamos nosotros y en 48 horas queda funcionando con tu número y tu '
        + 'catálogo. Los tres traen las mismas funciones; cambia el volumen:';
      const POST = '¿Te muestro cómo funciona con un ejemplo de tu rubro?';
      // 381 caracteres del modelo y 645 del bloque: 1030 en total.
      expect(PRE.length + POST.length).toBe(381);
      const salidaAgente = `${PRE}\n[PLANES]\n${POST}`;
      const libre = sinLimite(OFERTA_MEDIA, salidaAgente);
      expect(String(libre['respuesta']).length).toBe(LIMITE + 6);
      expect(libre['avisos']).toEqual([]);

      const r = turnoPlanes(OFERTA_MEDIA, salidaAgente);
      const t = cuerpo(r);
      expect(t.length).toBeLessThanOrEqual(LIMITE);
      // Se recortó el envoltorio, y NADA más: el bloque llega entero.
      expect(r['avisos']).toEqual(['texto_recortado']);
      for (const p of PRECIOS) expect(t).toContain(p);
      for (const i of MEDIO) expect(t).toContain(i);
      expect(t).toContain('Integración con tu sistema.');
      expect(t).toContain('Precios en dólares; se cobran en bolivianos al tipo de cambio oficial del BCB.');
      // Del texto del modelo se pierden las últimas palabras del enganche, no
      // el mensaje: la pregunta del final queda, y el recorte se ve.
      expect(t.startsWith(PRE.slice(0, 300))).toBe(true);
      expect(t).toContain('…');
      expect(t.trim().endsWith(POST)).toBe(true);
      expect(botonAsesor(r)).toEqual([BOTON]);
      const s = salida(r);
      expect(s['esInteractivo']).toBe(true);
      expect(s['avisos']).not.toContain('boton_perdido_por_largo');
    });

    it('(a) con los planes largos, se compacta la oferta y el botón se conserva', () => {
      const r = turnoPlanes(OFERTA_LARGA, 'Para tu salón, esto te sirve: la agenda se maneja sola.\n[PLANES]');
      const t = cuerpo(r);
      // Sin compactar, el mensaje se pasaba del límite y perdía el botón.
      expect(t.length).toBeLessThanOrEqual(LIMITE);
      expect(r['avisos']).toContain('planes_compactados');
      expect(r['avisos']).not.toContain('texto_recortado');
      // Los precios, completos; lo que incluye cada plan es lo que se resigna.
      for (const p of PRECIOS) expect(t).toContain(p);
      expect(t).not.toContain('catálogo de 20 productos');
      expect(t).toContain('Para tu salón, esto te sirve: la agenda se maneja sola.');
      expect(botonAsesor(r)).toEqual([BOTON]);
      const s = salida(r);
      expect(s['esInteractivo']).toBe(true);
      expect(s['avisos']).not.toContain('boton_perdido_por_largo');
    });

    it('(a ter) con un texto corto y una oferta enorme, lo que cede es el bloque', () => {
      // 20 planes largos cargados en la consola (la configuración conserva 12).
      const veinte = Array.from({ length: 20 }, (_, i) => ({
        nombre: `Plan ${i + 1}`, precioUsd: 20 + i, periodo: 'mes', incluye: INCLUYE }));
      const r = turnoPlanes({ ...OFERTA, planes: veinte, cargosUnicos: [] },
        'Estos son nuestros planes.\n[PLANES]');
      const t = cuerpo(r);
      expect(t.length).toBeLessThanOrEqual(LIMITE);
      // El texto del modelo no llega ni al piso: no hay nada que recortarle, y
      // el único que puede ceder es el bloque. Lo hace una sola vez.
      expect(r['avisos']).toEqual(['planes_compactados']);
      expect(t).toContain('Estos son nuestros planes.');
      expect(t).not.toContain('…');
      expect(t).not.toContain('catálogo de 20 productos');
      expect(t).toContain('Plan 1 (USD 20/mes).');
      expect(t).toContain('Plan 12 (USD 31/mes).');
      expect(t).not.toContain('Plan 13');
      expect(botonAsesor(r)).toEqual([BOTON]);
      expect(salida(r)['esInteractivo']).toBe(true);
    });

    // EL PISO DEL RECORTE. Recortar el texto del modelo hasta que no diga nada
    // no salva ningún botón que no salve resumir el bloque, y deja un mensaje
    // sin sentido. Por debajo de 150 caracteres se deja de recortar y cede el
    // bloque, que aun resumido conserva todos los precios.
    it('el piso: el texto del modelo no se recorta hasta dejarlo mudo; antes cede el bloque', () => {
      const CINCO = [...MEDIO.map((incluye, i) => ({ ...PLANES[i], incluye })),
        { nombre: 'Emprende', precioUsd: 15, periodo: 'mes',
          incluye: 'Hasta 50 conversaciones al mes, catálogo de 10 productos y una agenda conectada a Google Calendar.' },
        { nombre: 'Corporativo', precioUsd: 150, periodo: 'mes',
          incluye: 'Conversaciones a medida, catálogo sin tope, agendas para todo el equipo y atención prioritaria.' }];
      const TEXTO = 'Con gusto. Estos son los planes y lo que incluye cada uno; todos traen el mismo '
        + 'asistente y la misma unidad de cobro. Si te queda la duda de cuál te conviene, la vemos juntos.';
      const salidaAgente = `${TEXTO}\n[PLANES]`;
      const oferta = { ...OFERTA, planes: CINCO };
      const entero = String(sinLimite(oferta, salidaAgente)['respuesta']).length;
      expect(TEXTO.length).toBeGreaterThan(150);
      // El bloque entero deja menos de los 150 caracteres del piso: recortar el
      // texto, aunque llegara al piso, no alcanzaría…
      expect(entero - TEXTO.length).toBeGreaterThan(LIMITE - 150);
      // …pero con un texto más corto sí habría entrado, y es exactamente lo que
      // el piso prohíbe: un mensaje mudo con la oferta intacta.
      expect(entero - TEXTO.length).toBeLessThan(LIMITE);

      const r = turnoPlanes(oferta, salidaAgente);
      const t = cuerpo(r);
      expect(t.length).toBeLessThanOrEqual(LIMITE);
      expect(r['avisos']).toEqual(['planes_compactados']);
      // El texto del modelo llega COMPLETO, sin «…».
      expect(t).toContain(TEXTO);
      expect(t).not.toContain('…');
      expect(t).toContain('Emprende (USD 15/mes).');
      expect(botonAsesor(r)).toEqual([BOTON]);
      expect(salida(r)['esInteractivo']).toBe(true);
    });

    it('(b) si ni recortando entra, se resume además el bloque, y los precios quedan enteros', () => {
      const r = turnoPlanes(OFERTA_LARGA, `${relleno(16)}\n[PLANES]\n¿Te muestro cómo funciona?`);
      const t = cuerpo(r);
      expect(t.length).toBeLessThanOrEqual(LIMITE);
      // Los avisos, EN EL ORDEN EN QUE SE APLICARON: primero el envoltorio.
      expect(r['avisos']).toEqual(['texto_recortado', 'planes_compactados']);
      // El recorte es por palabras y se nota; los precios NO se recortan.
      expect(t).toContain('…');
      expect(t).not.toMatch(/\wtrabaj…/);
      for (const p of PRECIOS) expect(t).toContain(p);
      expect(t).toContain('Precios en dólares; se cobran en bolivianos al tipo de cambio oficial del BCB.');
      // Se recorta el enganche, que es lo largo: la pregunta del final se queda.
      expect(t.trim().endsWith('¿Te muestro cómo funciona?')).toBe(true);
      // Y el recorte se rehace contra el bloque ya resumido: lo que el resumen
      // libera se le devuelve al modelo, muy por encima del piso de 150.
      expect(t.slice(0, t.indexOf('*Planes*')).trim().length).toBeGreaterThan(600);
      expect(salida(r)['esInteractivo']).toBe(true);
    });

    it('(c) con una oferta que ni compacta entra, el mensaje sale entero y la pérdida del botón queda anotada', () => {
      const doce = Array.from({ length: 12 }, (_, i) => ({
        nombre: `Plan ${'Empresarial'.slice(0, 9)} ${i + 1} para comercios`, precioUsd: 25 + i, periodo: 'mes', incluye: INCLUYE }));
      const seis = Array.from({ length: 6 }, (_, i) => ({
        nombre: `Servicio de instalación ${i + 1}`, precioUsd: 60 + i, desde: true, detalle: DETALLE }));
      const r = turnoPlanes({ ...OFERTA, planes: doce, cargosUnicos: seis }, 'Estos son los planes.\n[PLANES]');
      // Ni compactado entra: recortar no salvaría el botón, así que el cliente
      // recibe el mensaje COMPLETO, con lo que incluye cada plan.
      expect(String(r['respuesta']).length).toBeGreaterThan(LIMITE);
      expect(r['avisos']).toEqual([]);
      expect(r['respuesta']).toContain('catálogo de 20 productos');
      const s = salida(r);
      expect(s['esInteractivo']).toBe(false);
      expect(s['cuerpoMeta']['type']).toBe('text');
      expect(s['avisos']).toContain('boton_perdido_por_largo');
      // Sin botón, el texto sigue diciendo cómo pedir una persona.
      expect(s['cuerpoMeta']['text']['body']).toContain('«asesor»');
    });

    it('el fin del primer bloque y un [CIERRE] sin datos también conservan el botón', () => {
      const sd: J = {};
      const cfg = cfgCon({ ...OFERTA, topeAviso: 3 });
      turnoCon(texto('hola'), sd, cfg); turnoCon(texto('cuéntame'), sd, cfg);
      const tercera = turnoCon(texto('sigo'), sd, cfg);
      expect(tercera['finBloque']).toBe(true);
      const fin = procesar(relleno(22), tercera, sd);
      expect(cuerpo(fin).length).toBeLessThanOrEqual(LIMITE);
      // Mismo orden que con los planes: se recorta el texto, y como acá no hay
      // bloque que resumir, no aparece `planes_compactados`.
      expect(fin['avisos']).toEqual(['texto_recortado']);
      expect(botonAsesor(fin)).toEqual([BOTON]);
      expect(salida(fin)['esInteractivo']).toBe(true);

      const sd2: J = {};
      const cierre = procesar(`${relleno(22)} [CIERRE]`, turnoCon(texto('llámenme'), sd2, cfgCon()), sd2);
      expect(cierre['avisar']).toBe(false);
      expect(cierre['avisos']).toEqual(['cierre_sin_datos', 'texto_recortado']);
      expect(cuerpo(cierre).length).toBeLessThanOrEqual(LIMITE);
      expect(salida(cierre)['esInteractivo']).toBe(true);
    });

    it('con los planes en archivo no hay nada que compactar: se recorta el texto, no la frase del archivo', () => {
      const r = turnoPlanes({ ...OFERTA, planes: [LARGOS[0]], planesEnArchivo: true, archivoPlanes: ARCHIVO },
        `${relleno(20)}\n[PLANES]`);
      expect(cuerpo(r)).toContain('Te comparto los planes y sus precios en el archivo de arriba.');
      expect(cuerpo(r)).not.toMatch(/USD/);
      expect(r['avisos']).toEqual(['texto_recortado']);
      expect(r['cuerpoMeta']['interactive']['header']['type']).toBe('document');
      expect(salida(r)['esInteractivo']).toBe(true);
    });

    it('compactar no agrega ni quita mensajes: sigue siendo UNO por turno', () => {
      for (const oferta of [OFERTA, OFERTA_LARGA]) {
        const s = salida(turnoPlanes(oferta, `${relleno(16)}\n[PLANES]`));
        expect(s['responder']).toBe(true);
        expect(s['avisar']).toBe(false);
        expect(s['cuerpoAviso']).toBeNull();
      }
    });
  });

  describe('rubro: deducido o por número', () => {
    it('las instrucciones piden deducir solo con una palabra del oficio, sin «90 % seguro», y dejan corregir', () => {
      const s = instrucciones(cfgCon());
      expect(s).toMatch(/palabra del oficio \(pastelería, odontología, colegio, boutique/);
      expect(s).toMatch(/si me equivoqué, dime/);
      expect(s).not.toMatch(/90\s*%/);
      expect(s).toMatch(/UNA SOLA PREGUNTA, su nombre y el de su empresa/);
    });

    it('[RUBROS] muestra la lista de la consola numerada, con el rubro a medida al final', () => {
      const sd: J = {};
      const cfg = cfgCon();
      const ent = turnoCon(texto('Soy Ana, de Inversiones AAB'), sd, cfg);
      const r = procesar('Gracias, Ana. ¿A qué rubro pertenece Inversiones AAB?\n[RUBROS]\nRespóndeme con el número.'
        + '\n[LEAD]{"empresa":"Inversiones AAB","contacto":"Ana"}[/LEAD]', ent, sd);
      expect(r['respuesta']).toContain('1. Salud y belleza\n2. Gastronomía\n3. Otro rubro (a medida)');
      expect(r['respuesta']).not.toContain('[RUBROS]');
      // El siguiente «2» es un rubro, resuelto por código antes del modelo.
      const dos = turnoCon(texto('2'), sd, cfg);
      expect(dos['leadConocido']).toMatchObject({ rubro: 'Gastronomía', flujos: 'ventas' });
      expect(dos['mensajeDelTurno']).toMatch(/eligió de la lista el rubro 2: «Gastronomía»/);
      expect(dos['mensajeDelTurno']).toMatch(/Faltan: ninguno/);
      // Un número fuera de la lista no registra nada.
      const sd2: J = {};
      procesar('Elige:\n[RUBROS]', turnoCon(texto('hola, info'), sd2, cfg), sd2);
      const nueve = turnoCon(texto('9'), sd2, cfg);
      expect(nueve['leadConocido']['rubro']).toBeUndefined();
      expect(nueve['mensajeDelTurno']).toMatch(/no está en la lista de rubros: pídele que elija un número de 1 a 3/);
    });

    it('un «2» sin lista mostrada es un mensaje más, no un rubro', () => {
      expect(turnoCon(texto('2'), {}, cfgCon())['leadConocido']['rubro']).toBeUndefined();
    });

    it('el rubro deducido por el modelo trae sus flujos de la lista', () => {
      const sd: J = {};
      procesar('Veo que es un salón; si me equivoqué, dime.\n[PLANES]\n[LEAD]{"rubro":"salud y belleza"}[/LEAD]',
        turnoCon(texto('Soy Ana, de Salón Rosa'), sd, cfgCon()), sd);
      expect(sd['conversaciones'][TEL]['lead']).toMatchObject({ rubro: 'salud y belleza', flujos: 'citas' });
    });
  });

  describe('el botón «Hablar con un asesor» y el traspaso sin modelo', () => {
    const tocar = () => ({ type: 'interactive', interactive: { type: 'button_reply',
      button_reply: { id: 'asesor', title: 'Hablar con un asesor' } } });

    it('tocarlo (o escribirlo) decide el traspaso antes del modelo', () => {
      expect(normalizar(tocar())['eleccion']).toBe('asesor');
      expect(normalizar(texto('Quiero hablar con un asesor'))['eleccion']).toBe('asesor');
      expect(normalizar(texto('asesor'))['eleccion']).toBe('asesor');
      expect(normalizar(texto('¿el asesor me llama hoy?'))['eleccion']).toBe('');
      expect(turnoCon(tocar(), {}, cfgCon())['accion']).toBe('asesor');
      // El servidor manda: en operador, gana el uso extendido.
      const op = config(PANEL(OFERTA, { estado: 'operador', avisarRecepcion: 'operador', respuestasEnVentana: 50 }));
      expect(turnoCon(tocar(), {}, op)['accion']).toBe('uso_extendido');
    });

    it('en el lienzo, «¿Asesor?» lleva al traspaso, y desde ahí el agente no es alcanzable', () => {
      const salidas = flujo.connections['¿Asesor?']?.['main'] ?? [];
      expect((salidas[0] ?? []).map((c) => c.node)).toEqual(['Traspaso a un asesor']);
      expect((salidas[1] ?? []).map((c) => c.node)).toEqual(['AI Agent NovuChat']);
      expect((flujo.connections['¿Uso extendido?']?.['main']?.[1] ?? []).map((c) => c.node)).toEqual(['¿Asesor?']);
      const alcanzables = new Set<string>();
      const pendientes = ['Traspaso a un asesor'];
      while (pendientes.length) {
        const n = pendientes.pop() as string;
        if (alcanzables.has(n)) continue;
        alcanzables.add(n);
        for (const s of flujo.connections[n]?.['main'] ?? []) pendientes.push(...s.map((c) => c.node));
      }
      expect(alcanzables.has('AI Agent NovuChat')).toBe(false);
      expect(nodo('¿Asesor?').parameters['conditions']['conditions'][0]['rightValue']).toBe('asesor');
    });

    it('el traspaso avisa UNA vez, con los datos que haya, guarda y cierra', () => {
      const sd: J = {};
      const cfg = cfgCon();
      const e = turnoCon(tocar(), sd, cfg);
      sd['conversaciones'][TEL]['lead'] = { empresa: 'Salón Rosa' };      // falta todo lo demás
      const r = correr('Traspaso a un asesor', [e], {}, sd)[0]!;
      expect(r['respuesta']).toBe('¡Anotado! 📋 Ya le pasé tus datos a nuestro equipo. Un especialista de NovuChat '
        + 'te escribirá a este mismo número en horario de atención (lunes a viernes, de 09:00 a 18:00).'
        + ' ¡Que tengas un excelente día!');
      expect(r['avisar']).toBe(true);
      expect(r['guardarLead']).toBe(true);
      expect(r['estadoLead']).toBe('cerrado');
      expect(sd['conversaciones'][TEL]['etapa']).toBe('cerrado');
      const s = correr('Salida', [{ ...r, crmUrl: 'https://crm.ejemplo/leads' }])[0]!;
      const vars = (s['cuerpoAviso']['template']['components'][0]['parameters'] as J[]).map((p) => p['text']);
      expect(vars.slice(0, 3)).toEqual(['pidió hablar con un asesor', 'Salón Rosa', 'Ana']);
      expect(s['cuerpoCrm']).toMatchObject({ estado: 'cerrado', empresa: 'Salón Rosa' });
      expect(s['esInteractivo']).toBe(false);
      // Meta acepta la plantilla: recién ahí el aviso queda dado.
      correr('Confirmar envío', [s], { 'Enviar a WhatsApp': { statusCode: 200 },
        'Avisar a NovuChat': { statusCode: 200 } }, sd);
      // Un segundo toque responde, pero no vuelve a avisar: la plantilla se cobra.
      const otra = correr('Traspaso a un asesor', [turnoCon(tocar(), sd, cfg)], {}, sd)[0]!;
      expect(otra['avisar']).toBe(false);
    });

    it('a nadie se le avisa de su propio toque: desde el número de recepción no hay plantilla', () => {
      const r = correr('Traspaso a un asesor', [{ ...turnoCon(tocar(), {}, cfgCon()), from: '59170000000' }], {}, {})[0]!;
      const s = correr('Salida', [r])[0]!;
      expect(s['avisar']).toBe(false);
      expect(s['cuerpoAviso']).toBeNull();
      expect(s['respuesta']).toMatch(/^¡Anotado!/);
    });

    it('un [CIERRE] sin los datos no avisa, pero deja el botón para pasar con lo que haya', () => {
      const sd: J = {};
      const r = procesar('Claro, te paso con alguien. [CIERRE]', turnoCon(texto('quiero que me llamen'), sd, cfgCon()), sd);
      expect(r['avisar']).toBe(false);
      expect(botonAsesor(r)).toEqual([BOTON]);
    });
  });

  describe('datos del prospecto', () => {
    it('el NIT ya no se guarda, ni el que quedó de antes', () => {
      const sd: J = { conversaciones: { [TEL]: { desde: Date.now(), ultimo: Date.now(), respuestas: 1,
        etapa: 'cliente_nuevo', bienvenida: true, avisado: false, lead: { empresa: 'Salón Rosa', nit: '1234567' } } } };
      const ent = turnoCon(texto('mi NIT es 7654321'), sd, cfgCon());
      expect(ent['leadConocido']['nit']).toBeUndefined();
      const r = procesar('Gracias.\n[LEAD]{"nit":"7654321","consulta":"agenda para su salón","personalizacion":"recordatorio por SMS"}[/LEAD]',
        ent, sd);
      expect(sd['conversaciones'][TEL]['lead']).toEqual({ empresa: 'Salón Rosa', consulta: 'agenda para su salón',
        personalizacion: 'recordatorio por SMS' });
      const s = correr('Salida', [{ ...r, crmUrl: 'https://crm.ejemplo/leads', lead: { ...r['lead'], nit: '1' } }])[0]!;
      expect(s['cuerpoCrm']['nit']).toBeUndefined();
      // Las instrucciones ya no piden NIT.
      expect(instrucciones(cfgCon())).not.toMatch(/\bNIT\b|\bnit\b/);
    });
  });

  describe('horario opcional', () => {
    const respaldoConHorario = { ...base(), horarioAtencion: 'lunes a sábado, de 08:00 a 20:00' };

    it('si la consola contesta con el horario vacío, manda: no cae al respaldo', () => {
      const c = config(PANEL(OFERTA, undefined, { operacion: { numeroRecepcion: '+591 7000-0000', horarioAtencion: '' } }),
        respaldoConHorario);
      expect(c['horarioAtencion']).toBe('');
      expect(c['fraseContacto']).toBe('lo antes posible');
      // Con el panel caído, sí vale el respaldo.
      expect(config({ statusCode: 500, body: {} }, respaldoConHorario)['horarioAtencion']).toBe('lunes a sábado, de 08:00 a 20:00');
      // Un marcador sin llenar no es un horario.
      expect(config({ statusCode: 500, body: {} })['horarioAtencion']).toBe('');
    });

    it('con horario vacío, ni el traspaso ni las instrucciones mencionan horarios', () => {
      const c = config(PANEL(OFERTA, undefined, { operacion: { numeroRecepcion: '+591 7000-0000', horarioAtencion: '' } }),
        respaldoConHorario);
      const r = correr('Traspaso a un asesor', [{ ...c, from: TEL }], {}, {})[0]!;
      expect(r['respuesta']).toContain('te escribirá a este mismo número lo antes posible.');
      expect(r['respuesta']).not.toMatch(/horario/i);
      const s = instrucciones(c);
      // Lo que el negocio escribe; el corpus del sitio va aparte, al final.
      expect(s.slice(0, s.indexOf('DATOS DE NOVUCHAT.'))).not.toMatch(/horario/i);
      expect(s).toContain('le escribirá a este mismo número lo antes posible');
    });
  });

  describe('instrucciones del agente', () => {
    it('las aclaraciones van rotuladas, para usarlas solo si preguntan', () => {
      const s = instrucciones(cfgCon());
      expect(s).toContain('ACLARACIONES DE LA OFERTA: úsalas solo si el cliente pregunta por ese tema. '
        + 'No las recites por tu cuenta.\n'
        + '- Qué es una conversación: Hasta 25 respuestas a un mismo teléfono en 24 horas.');
    });

    it('para planes, precios y rubros manda la consola; el corpus para lo demás', () => {
      const s = instrucciones(cfgCon());
      expect(s).toMatch(/Si DATOS DE NOVUCHAT dice otra cosa sobre planes, precios o sobre un tema de las ACLARACIONES DE LA OFERTA .*gana la consola/);
      expect(s).toContain('Impulso (USD 25/mes): Hasta 100 conversaciones');
      expect(s).toContain('1. Salud y belleza - solución: Agenda sola y recuerda las citas.');
      expect(s).toMatch(/cobran en bolivianos al tipo de cambio oficial del BCB/);
      // La oferta va antes del corpus, y el corpus sigue al final.
      expect(s.indexOf('OFERTA DE LA CONSOLA')).toBeLessThan(s.indexOf('DATOS DE NOVUCHAT.'));
      expect(s).toMatch(/<<<\nCORPUS\n>>>$/);
    });
  });

  describe('mensajes por conversación', () => {
    /** Un turno completo por los nodos versionados; el modelo, simulado. */
    const turno = (msg: J, sd: J, cfg: J, salidaAgente = ''): J => {
      const e = turnoCon(msg, sd, cfg);
      const rama = e['accion'] === 'bienvenida' ? correr('Bienvenida', [e])[0]!
        : e['accion'] === 'asesor' ? correr('Traspaso a un asesor', [e], {}, sd)[0]!
        : procesar(salidaAgente, e, sd);
      const s = correr('Salida', [rama])[0]!;
      if (e['accion'] === 'bienvenida') {
        correr('Confirmar envío', [s], { 'Enviar a WhatsApp': { statusCode: 200 } }, sd);
      }
      return s;
    };
    const nuevo = { type: 'interactive', interactive: { button_reply: { id: 'cliente_nuevo', title: 'Soy cliente nuevo' } } };
    const asesor = { type: 'interactive', interactive: { button_reply: { id: 'asesor', title: 'Hablar con un asesor' } } };

    it('rubro obvio: 4 mensajes al cliente y 1 plantilla', () => {
      const sd: J = {};
      const cfg = cfgCon();
      const salen = [
        turno(texto('hola'), sd, cfg),
        turno(nuevo, sd, cfg, 'NovuChat pone un asistente con IA en tu WhatsApp. ¿Cómo te llamas y cómo se llama tu empresa?'),
        turno(texto('Ana, de Salón Rosa'), sd, cfg, 'Gracias, Ana. Veo que Salón Rosa es de belleza; si me equivoqué, dime. '
          + 'Tu asistente agenda solo.\n[PLANES]\n[LEAD]{"empresa":"Salón Rosa","contacto":"Ana","rubro":"Salud y belleza"}[/LEAD]'),
        turno(asesor, sd, cfg),
      ];
      expect(salen.every((s) => s['responder'] === true)).toBe(true);
      expect(salen.filter((s) => s['avisar']).length).toBe(1);
      expect(salen[3]!['cuerpoAviso']['template']['components'][0]['parameters'][3]['text']).toBe('Salud y belleza');
    });

    it('rubro ambiguo: 5 mensajes al cliente y 1 plantilla', () => {
      const sd: J = {};
      const cfg = cfgCon();
      const salen = [
        turno(texto('hola'), sd, cfg),
        turno(nuevo, sd, cfg, '¿Cómo te llamas y cómo se llama tu empresa?'),
        turno(texto('Ana, de Inversiones AAB'), sd, cfg, 'Gracias, Ana. ¿En qué rubro está?\n[RUBROS]\n'
          + '[LEAD]{"empresa":"Inversiones AAB","contacto":"Ana"}[/LEAD]'),
        turno(texto('2'), sd, cfg, 'Para gastronomía, tu asistente toma el pedido.\n[PLANES]'),
        turno(asesor, sd, cfg),
      ];
      expect(salen).toHaveLength(5);
      expect(salen.filter((s) => s['avisar']).length).toBe(1);
      expect(sd['conversaciones'][TEL]['lead']).toMatchObject({ rubro: 'Gastronomía', flujos: 'ventas' });
    });
  });
});

// ===========================================================================
describe('Base de conocimiento', () => {
  const codigo = nodo('Conocimiento del sitio').parameters['jsCode'] as string;
  const huella = /const HUELLA = "([0-9a-f]{64})"/.exec(codigo)?.[1];
  const indice = join(process.env['NOVUCHAT_SITE_DIR'] ?? join(homedir(), 'Novuchat-site'),
    'functions/src/rag/indice.json');

  it('trae el corpus del sitio, con su huella', () => {
    const [salida] = correr('Conocimiento del sitio', [{ a: 1 }]);
    expect(huella).toBeDefined();
    expect(String(salida!['conocimiento']).length).toBeGreaterThan(10_000);
    expect(salida!['conocimiento']).toContain('novuchat.site/precios');
    expect(salida!['a']).toBe(1);
  });

  it.skipIf(!existsSync(indice))('la huella coincide con el índice del sitio (alarma de divergencia)', () => {
    const delSitio = JSON.parse(readFileSync(indice, 'utf8')) as { huella: string };
    expect(huella, 'El sitio regeneró su índice: hay que volver a copiar el corpus al flujo '
      + '(Flujos/LEEME-flujos.md, flujo de captación).').toBe(delSitio.huella);
  });
});
