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
 *   - los dos topes: el fin del primer bloque (botón a un asesor) y el corte
 *     (despedida fija, aviso, silencio hasta que pasen 24 horas);
 *   - la idempotencia ante los reenvíos de Meta;
 *   - la extracción de datos del prospecto y el cierre, que exige los datos;
 *   - la prohibición 4 y el tuteo sin voseo;
 *   - que todo lo que sale al cliente pase por un único nodo, y en UN mensaje;
 *   - que la base de conocimiento sea la del sitio, con alarma si diverge.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
    return { first: () => ({ json: lista[0] }), all: () => lista.map((json) => ({ json })) };
  };
  // Se ejecuta el flujo VERSIONADO; copiar la lógica dejaría la prueba en verde
  // mientras el flujo se rompe. Misma justificación que `candado-agenda.test.ts`.
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', '$getWorkflowStaticData', codigo) as
    (...a: unknown[]) => { json: J }[];
  return fn(entrada, $, () => estatico).map((x) => x.json);
}

const PANEL = (onboarding: J = {}): J => ({
  statusCode: 200,
  body: {
    tenantId: 'novuchat', flujo: 'onboarding', estadoComercio: 'activo',
    phoneNumberId: '1000000003391',
    operacion: { numeroRecepcion: '+591 7000-0000', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: 'NovuChat' },
    voz: {},
    onboarding: {
      topeAviso: 10, topeDuro: 20, plantillaAviso: 'solicitud_contacto',
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
    expect(c['topeDuro']).toBe(20);
    expect(c['plantillaAviso']).toBe('solicitud_contacto');
    // Solo dígitos: es el destino de la plantilla y del botón a una persona.
    expect(c['numeroRecepcion']).toBe('59170000000');
  });

  it('un par de topes incoherente cae al respaldo, que sí lo es', () => {
    const c = config(PANEL({ topeAviso: 30, topeDuro: 20 }));
    expect([c['topeAviso'], c['topeDuro']]).toEqual([25, 50]);
  });

  it('un tope fuera de rango se descarta y el techo sigue existiendo', () => {
    const c = config(PANEL({ topeDuro: 5000 }));
    expect(c['topeDuro']).toBeLessThanOrEqual(200);
    expect(c['topeDuro']).toBeGreaterThan(c['topeAviso']);
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
    expect(typeof c['topeDuro']).toBe('number');
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

  it('los topes: fin del primer bloque, despedida como respuesta N y después silencio', () => {
    const sd: J = {};
    const cfg = config(PANEL({ topeAviso: 3, topeDuro: 5 }));
    const turno = () => estado(normalizar(texto('otra consulta'), cfg), sd)[0];
    const r1 = turno(); const r2 = turno(); const r3 = turno(); const r4 = turno(); const r5 = turno();
    expect([r1, r2, r3, r4].map((r) => r!['accion'])).toEqual(['agente', 'agente', 'agente', 'agente']);
    expect(r3!['finBloque']).toBe(true);
    expect(r3!['mensajeDelTurno']).toMatch(/ofrece hablar con un asesor/);
    expect([r1, r2, r4].some((r) => r!['finBloque'])).toBe(false);
    // Con corte 5, la QUINTA respuesta es la despedida: no hay una sexta.
    expect(r5!['accion']).toBe('tope_duro');
    expect(r5!['respuestasEnVentana']).toBe(5);
    expect(turno()).toBeUndefined();          // silencio
    expect(turno()).toBeUndefined();
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
    const cfg = config(PANEL({ topeAviso: 3, topeDuro: 10 }));
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

  it('el corte avisa a una persona', () => {
    const r = correr('Despedida por tope', [ent()])[0]!;
    expect(r['avisar']).toBe(true);
    expect(r['estadoAviso']).toBe('límite de respuestas alcanzado');
  });

  it('ningún texto fijo usa voseo', () => {
    for (const n of ['Bienvenida', 'Cliente actual', 'Despedida por tope']) {
      const r = correr(n, [ent()])[0]!;
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

  it('el respaldo siempre es texto', () => {
    const r = salir({ respuesta: 'hola', cuerpoMeta: { type: 'interactive', interactive: { type: 'button', body: { text: 'hola' } } } });
    expect(r['cuerpoRespaldo']['type']).toBe('text');
  });
});

// ===========================================================================
describe('Estructura del flujo', () => {
  const entradas = (destino: string) => Object.entries(flujo.connections)
    .flatMap(([origen, tipos]) => Object.values(tipos).flat().flat()
      .filter((c) => c.node === destino).map(() => origen));

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
    for (const rama of ['Bienvenida', 'Cliente actual', 'Despedida por tope', 'Procesar respuesta', 'Comercio no operativo']) {
      expect(flujo.connections[rama]?.['main']?.[0]?.map((c) => c.node)).toEqual(['Salida']);
    }
    const aGraph = flujo.nodes.filter((n) => String(n.parameters['url'] ?? '').includes('graph.facebook.com'));
    expect(aGraph.map((n) => n.name).sort()).toEqual(['Avisar a NovuChat', 'Enviar a WhatsApp', 'Enviar texto de respaldo']);
    expect(entradas('Enviar a WhatsApp')).toEqual(['Salida']);
    expect(entradas('Enviar texto de respaldo')).toEqual(['¿Falló el interactivo?']);
    expect(entradas('¿Falló el interactivo?')).toEqual(['Enviar a WhatsApp']);
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
