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

const PANEL = (onboarding: J = {}, atencion?: J): J => ({
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
  },
});
const config = (respuesta: J = PANEL()) =>
  correr('Config del negocio', [respuesta], { 'Config base': base() })[0]!;

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

  it('con los datos, el cierre avisa UNA vez y sale con el botón a un asesor', () => {
    const sd: J = {};
    const ent = entrada(sd);
    const datos = '[LEAD]{"empresa":"Salón Rosa","contacto":"Ana","rubro":"belleza","flujos":["Citas"]}[/LEAD]';
    const r = procesar(`Listo, Ana: un asesor te escribirá. ${datos}[CIERRE]`, ent, sd);
    expect(r['avisar']).toBe(true);
    expect(r['estadoLead']).toBe('cerrado');
    expect(r['cuerpoMeta']['interactive']['type']).toBe('cta_url');
    const boton = r['cuerpoMeta']['interactive']['action']['parameters'];
    expect(boton['url']).toMatch(/^https:\/\/wa\.me\/59170000000\?text=/);
    expect(String(boton['display_text']).length).toBeLessThanOrEqual(20);
    expect(sd['conversaciones'][TEL]['etapa']).toBe('cerrado');
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

  it('al terminar el primer bloque la respuesta lleva el botón, sin cerrar', () => {
    const sd: J = {};
    const cfg = config(PANEL({ topeAviso: 3 }));
    entrada(sd, cfg); entrada(sd, cfg);
    const tercera = entrada(sd, cfg);
    expect(tercera['finBloque']).toBe(true);
    const r = procesar('Te respondo esto. ¿Quieres hablar con un asesor?', tercera, sd);
    expect(r['cuerpoMeta']['interactive']['type']).toBe('cta_url');
    expect(r['avisar']).toBe(false);
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
    expect(r['respuesta']).toMatch(/inteligencia artificial/);
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
    for (const n of ['Bienvenida', 'Cliente actual', 'Uso extendido']) {
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
    for (const rama of ['Bienvenida', 'Cliente actual', 'Uso extendido', 'Procesar respuesta', 'Comercio no operativo']) {
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
