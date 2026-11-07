/**
 * =============================================================================
 * ALERTA OPERATIVA: «ENVÍO INCIERTO» DEL errorWorkflow DE n8n -> CORREO (Plataforma)
 * =============================================================================
 *
 * PIEZA 1 del diseño `NOVUCHAT_diseno-alerta-envio-incierto` (07/11/2026). El errorWorkflow de n8n
 * solo deja huella en la ejecución: no avisa a nadie. Esta Function es el EMISOR FUERA DE LA VM de
 * OCI (infraestructura que NovuChat ya opera): recibe el evento, lo guarda y avisa por Resend.
 * No reemplaza al latido de n8n/OCI (otra pieza): si n8n está caído el errorWorkflow no corre.
 *
 * LO QUE HACE, EN ORDEN (cada paso cierra la puerta antes de gastar lo siguiente):
 *   1. POST con FIRMA HMAC PROPIA (`ALERTA_OPERATIVA_HMAC`): marca de tiempo + cuerpo crudo, ventana
 *      de 2 minutos, comparación en tiempo constante. NO reutiliza la firma de ingesta, que es por
 *      número de WhatsApp: esta no tiene número ni comercio.
 *   2. Valida el CONTRATO común y rechaza todo campo que no sea del contrato (un `telefono` o una
 *      `ejecucion` sueltos son un error de configuración del llamador: no se guardan).
 *   3. SIN PII: los campos estructurales (flujo, nodo, tipo de error) que parezcan un dato personal
 *      se RECHAZAN; los textos libres se SANEAN (teléfonos, correos, ids largos o hexadecimales
 *      -> «[omitido]») y un texto demasiado largo se rechaza (un texto largo suele ser el de un cliente).
 *   4. Guarda el evento en `plataforma/alertas/eventos/{id_unico}` (idempotente: el mismo `id_unico`
 *      no se vuelve a guardar ni a enviar).
 *   5. Si es CRÍTICO: máximo 1 correo inmediato por hora por tipo de error y tope diario. El tope es de
 *      5 correos por día para NovuChat; UNO queda reservado al resumen, así que salen 4 inmediatos.
 *      El resto queda `en_resumen`.
 *   6. `Idempotency-Key = id_unico` en la llamada a Resend. Si el envío FALLA, el evento queda guardado
 *      (`envio_fallido`, entra al resumen) y la reserva del tope se devuelve: un fallo no gasta cupo.
 *   7. Resumen diario (`resumenAlertasOperativas`, 08:00 La Paz): sale AUNQUE haya 0 errores («0 errores
 *      en 24 h»): es el latido. Si no llega, es una alerta (política del 11/10/2026).
 *
 * LOS SECRETOS: `ALERTA_OPERATIVA_HMAC` y `RESEND_API_KEY_ALERTAS` (Secret Manager). Nunca se imprimen:
 * los registros llevan códigos fijos y nada del cuerpo, de la clave ni de la respuesta de Resend.
 * El remitente (dominio de avisos), el destinatario y los hosts de enlace permitidos son PARÁMETROS
 * (`ALERTA_DOMINIO_AVISOS`, `ALERTA_DESTINATARIO`, `ALERTA_ENLACE_HOSTS`): el repo es público y no
 * escribe el dominio ni el correo reales. Sin ellos, la Function guarda el evento y NO envía.
 *
 * 0 mensajes de WhatsApp por conversación: esto no toca el canal.
 */
import { createHmac } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret, defineString } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../core/region.js';
import { firmaValida } from '../core/seguridad/firma.js';

export const ALERTA_OPERATIVA_HMAC = defineSecret('ALERTA_OPERATIVA_HMAC');
export const RESEND_API_KEY_ALERTAS = defineSecret('RESEND_API_KEY_ALERTAS');
const DOMINIO_AVISOS = defineString('ALERTA_DOMINIO_AVISOS', { default: '' });
const DESTINATARIO = defineString('ALERTA_DESTINATARIO', { default: '' });
const HOSTS_ENLACE = defineString('ALERTA_ENLACE_HOSTS', { default: '' });

// ---------------------------------------------------------------------------
// CONSTANTES DEL CONTRATO
// ---------------------------------------------------------------------------
export const VENTANA_ALERTA_MS = 2 * 60 * 1000;
export const MAX_CUERPO_ALERTA = 8 * 1024;
/** Presupuesto de NovuChat dentro de los 50 compartidos de Resend (Free). */
export const TOPE_DIARIO = 5;
/** Uno de los cinco queda para el resumen diario. */
export const TOPE_INMEDIATOS = TOPE_DIARIO - 1;
export const HORA_MS = 3_600_000;
export const NIVELES = ['critico', 'aviso', 'info'] as const;
export type Nivel = (typeof NIVELES)[number];
export type EstadoEvento = 'enviado' | 'en_resumen' | 'envio_fallido';

export const LIMITES = { asunto: 70, que_paso: 150, que_se_espera_de_andres: 130, flujo: 60, nodo: 60 } as const;
const CAMPOS = [
  'nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'enlace', 'ocurrido_en', 'id_unico',
  // Extensión declarada al contrato común: lo mínimo para agrupar «por tipo de error».
  'tipo_error', 'flujo', 'nodo',
] as const;
const OBLIGATORIOS = ['nivel', 'proyecto', 'asunto', 'que_paso', 'que_se_espera_de_andres', 'enlace', 'ocurrido_en', 'id_unico', 'tipo_error'] as const;

export interface EventoAlerta {
  nivel: Nivel;
  proyecto: 'novuchat';
  asunto: string;
  que_paso: string;
  que_se_espera_de_andres: string;
  enlace: string;
  ocurrido_en: string;
  id_unico: string;
  tipo_error: string;
  flujo: string;
  nodo: string;
}

export class ErrorAlerta extends Error {
  constructor(readonly codigo: string, readonly estado: number) { super(codigo); }
}

// ---------------------------------------------------------------------------
// FIRMA
// ---------------------------------------------------------------------------
export function verificarFirmaAlerta(
  secreto: string, marca: string, firma: string, crudo: Buffer, ahoraMs: number,
): boolean {
  if (!secreto || !firma || !/^\d{10,15}$/.test(marca)) return false;
  if (Math.abs(ahoraMs - Number(marca)) > VENTANA_ALERTA_MS) return false;
  const limpia = firma.replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/i.test(limpia)) return false;
  const esperada = createHmac('sha256', secreto).update(`${marca}.`).update(crudo).digest('hex');
  return firmaValida(esperada, limpia.toLowerCase());
}

// ---------------------------------------------------------------------------
// SIN PII
// ---------------------------------------------------------------------------
const OMITIDO = '[omitido]';

/** Quita de un texto libre lo que parece un dato personal o un identificador de ejecución. */
export function sanearTexto(t: string): { texto: string; saneado: boolean } {
  const limpio = t
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, OMITIDO)                                         // correos
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, OMITIDO) // uuid
    .replace(/\b[0-9a-f]{16,}\b/gi, OMITIDO)                                                 // hash o id largo
    .replace(/\+?\d[\d ()\-.]{4,}\d/g, OMITIDO)                                              // teléfonos y ids de 6+ cifras
    .replace(/\d{6,}/g, OMITIDO);
  return { texto: limpio, saneado: limpio !== t };
}

/** Un campo estructural (flujo, nodo, tipo) no se sanea: si parece un dato personal, se rechaza. */
const pareceDatoPersonal = (t: string): boolean => sanearTexto(t).saneado;

const MARCAS_DE_EJECUCION = /^(\d{6,}|[0-9a-f]{16,})$/i;
const TIPO = /^[a-z0-9_.-]{1,60}$/;
const ID_UNICO = /^[A-Za-z0-9_-]{8,64}$/;

function enlaceValido(enlace: string, hosts: string[]): boolean {
  // Un runbook del repositorio: ruta relativa a `docs/`, sin esquema ni `..`.
  if (/^docs\/[A-Za-z0-9_./#-]{1,150}$/.test(enlace) && !enlace.includes('..')) return true;
  let u: URL;
  try { u = new URL(enlace); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  // Nunca una URL interna: IP, localhost o dominios de red interna.
  if (/^[\d.]+$/.test(host) || host.includes(':') || host === 'localhost' || /\.(internal|local|lan)$/.test(host)) return false;
  return hosts.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

export function validarEvento(cuerpo: unknown, hostsEnlace: string[]): { evento: EventoAlerta; saneado: boolean } {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) throw new ErrorAlerta('cuerpo_invalido', 400);
  const d = cuerpo as Record<string, unknown>;
  for (const k of Object.keys(d)) if (!(CAMPOS as readonly string[]).includes(k)) throw new ErrorAlerta('campo_no_permitido', 400);
  for (const k of OBLIGATORIOS) if (typeof d[k] !== 'string' || !(d[k] as string).trim()) throw new ErrorAlerta('campo_faltante', 400);
  for (const k of ['flujo', 'nodo'] as const) if (d[k] !== undefined && typeof d[k] !== 'string') throw new ErrorAlerta('campo_invalido', 400);
  const s = (k: string): string => String(d[k] ?? '').trim();

  if (!(NIVELES as readonly string[]).includes(s('nivel'))) throw new ErrorAlerta('nivel_invalido', 400);
  if (s('proyecto') !== 'novuchat') throw new ErrorAlerta('proyecto_invalido', 400);
  if (!TIPO.test(s('tipo_error'))) throw new ErrorAlerta('tipo_error_invalido', 400);
  if (!ID_UNICO.test(s('id_unico')) || MARCAS_DE_EJECUCION.test(s('id_unico'))) throw new ErrorAlerta('id_unico_invalido', 400);
  const ms = Date.parse(s('ocurrido_en'));
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(s('ocurrido_en')) || Number.isNaN(ms)) throw new ErrorAlerta('ocurrido_en_invalido', 400);
  if (!enlaceValido(s('enlace'), hostsEnlace)) throw new ErrorAlerta('enlace_invalido', 400);

  for (const k of ['flujo', 'nodo'] as const) {
    if (s(k).length > LIMITES[k] || pareceDatoPersonal(s(k))) throw new ErrorAlerta('dato_personal', 422);
  }
  if (pareceDatoPersonal(s('tipo_error'))) throw new ErrorAlerta('dato_personal', 422);

  let saneado = false;
  const libre = (k: 'asunto' | 'que_paso' | 'que_se_espera_de_andres'): string => {
    if (s(k).length > LIMITES[k]) throw new ErrorAlerta('texto_largo', 422);
    const r = sanearTexto(s(k));
    saneado ||= r.saneado;
    return r.texto;
  };
  const evento: EventoAlerta = {
    nivel: s('nivel') as Nivel, proyecto: 'novuchat',
    asunto: libre('asunto'), que_paso: libre('que_paso'), que_se_espera_de_andres: libre('que_se_espera_de_andres'),
    enlace: s('enlace'), ocurrido_en: new Date(ms).toISOString(), id_unico: s('id_unico'),
    tipo_error: s('tipo_error'), flujo: s('flujo'), nodo: s('nodo'),
  };
  return { evento, saneado };
}

// ---------------------------------------------------------------------------
// ALMACÉN Y ENVÍO (inyectables: las pruebas usan memoria y un envío falso)
// ---------------------------------------------------------------------------
export interface EventoGuardado extends EventoAlerta {
  ocurrido_ms: number;
  recibido_ms: number;
  dia: string;
  estado: EstadoEvento;
  saneado: boolean;
}
export interface Reserva { ok: boolean; previoUltimoMs: number | null }

export interface AlmacenAlertas {
  /** `false` si el `id_unico` ya estaba guardado. */
  crear(e: EventoGuardado): Promise<boolean>;
  poner(id: string, estado: EstadoEvento): Promise<void>;
  /** Reserva atómica: cupo del día y 1 por hora por tipo. */
  reservar(tipo: string, dia: string, ahoraMs: number): Promise<Reserva>;
  liberar(tipo: string, dia: string, previoUltimoMs: number | null): Promise<void>;
  desde(ms: number): Promise<EventoGuardado[]>;
}
export interface Envio { asunto: string; texto: string; idempotencia: string }
export type Enviar = (e: Envio) => Promise<void>;

/** Día calendario de La Paz (UTC-4 fijo). */
export const diaLaPaz = (ms: number): string => new Date(ms - 4 * HORA_MS).toISOString().slice(0, 10);

export function armarCorreo(e: EventoAlerta): Envio {
  const marca = e.nivel === 'critico' ? 'CRÍTICO' : e.nivel === 'aviso' ? 'AVISO' : 'INFO';
  // Lo esencial en los primeros 400 caracteres: qué se espera de Andres, qué pasó, dónde mirar.
  const texto = [
    `[${marca}] NovuChat: ${e.asunto}`,
    `Se espera de Andres: ${e.que_se_espera_de_andres}`,
    `Qué pasó: ${e.que_paso}`,
    `Enlace: ${e.enlace}`,
    '',
    `Flujo: ${e.flujo || '(no informado)'} | Nodo: ${e.nodo || '(no informado)'} | Tipo: ${e.tipo_error}`,
    `Hora (UTC): ${e.ocurrido_en}`,
  ].join('\n');
  return { asunto: `[NovuChat ${marca}] ${e.asunto}`, texto, idempotencia: e.id_unico };
}

export interface Resultado { estado: EstadoEvento | 'duplicado' }

export async function procesarEvento(
  e: EventoAlerta, saneado: boolean,
  deps: { almacen: AlmacenAlertas; enviar: Enviar | null; ahoraMs: number },
): Promise<Resultado> {
  const ms = Date.parse(e.ocurrido_en);
  const g: EventoGuardado = { ...e, ocurrido_ms: ms, recibido_ms: deps.ahoraMs, dia: diaLaPaz(deps.ahoraMs), estado: 'en_resumen', saneado };
  // 1. Primero se guarda: lo que pase después no puede perder el evento.
  if (!await deps.almacen.crear(g)) return { estado: 'duplicado' };
  if (e.nivel !== 'critico' || !deps.enviar) return { estado: 'en_resumen' };
  // 2. Cupo.
  const r = await deps.almacen.reservar(e.tipo_error, g.dia, deps.ahoraMs);
  if (!r.ok) return { estado: 'en_resumen' };
  // 3. Envío; si falla, se devuelve el cupo y el evento pasa al resumen.
  try {
    await deps.enviar(armarCorreo(e));
  } catch {
    await deps.almacen.liberar(e.tipo_error, g.dia, r.previoUltimoMs);
    await deps.almacen.poner(e.id_unico, 'envio_fallido');
    return { estado: 'envio_fallido' };
  }
  await deps.almacen.poner(e.id_unico, 'enviado');
  return { estado: 'enviado' };
}

export interface RespuestaAlerta { status: number; cuerpo: string }

/** Toda la puerta HTTP, sin depender de Express: se prueba con cabeceras y bytes. */
export async function atenderAlerta(
  p: { metodo: string; cabecera(n: string): string | undefined; crudo: Buffer | undefined },
  deps: { almacen: AlmacenAlertas; enviar: Enviar | null; secreto: string; hostsEnlace: string[]; ahoraMs: number },
): Promise<RespuestaAlerta> {
  if (p.metodo !== 'POST') return { status: 405, cuerpo: 'metodo' };
  const crudo = p.crudo ?? Buffer.from('');
  if (crudo.length > MAX_CUERPO_ALERTA) return { status: 401, cuerpo: 'no autorizado' };
  const ok = verificarFirmaAlerta(
    deps.secreto, String(p.cabecera('X-NovuChat-Alerta-Timestamp') ?? ''),
    String(p.cabecera('X-NovuChat-Alerta-Signature') ?? ''), crudo, deps.ahoraMs);
  // A quien no pasa no se le explica qué le faltó.
  if (!ok) return { status: 401, cuerpo: 'no autorizado' };
  try {
    const { evento, saneado } = validarEvento(JSON.parse(crudo.toString('utf8')), deps.hostsEnlace);
    const r = await procesarEvento(evento, saneado, deps);
    return { status: 200, cuerpo: r.estado };
  } catch (error) {
    if (error instanceof ErrorAlerta) return { status: error.estado, cuerpo: error.codigo };
    if (error instanceof SyntaxError) return { status: 400, cuerpo: 'cuerpo_invalido' };
    console.error('ALERTA_OPERATIVA_ERROR_INTERNO');
    return { status: 500, cuerpo: 'error' };
  }
}

// ---------------------------------------------------------------------------
// RESUMEN DIARIO
// ---------------------------------------------------------------------------
export function armarResumen(eventos: EventoGuardado[], ahoraMs: number): Envio {
  const dia = diaLaPaz(ahoraMs);
  const n = eventos.length;
  const por = (est: EstadoEvento): number => eventos.filter((x) => x.estado === est).length;
  const tipos = new Map<string, number>();
  for (const x of eventos) tipos.set(x.tipo_error, (tipos.get(x.tipo_error) ?? 0) + 1);
  const titulo = n === 0 ? '0 errores en 24 h' : `${n} ${n === 1 ? 'error' : 'errores'} en 24 h`;
  const lineas = [
    `Resumen diario de NovuChat: ${titulo}.`,
    n === 0 ? 'No se espera nada de Andres. Este correo es el latido: si un día no llega, avise a la sesión de Plataforma.'
      : `Se espera de Andres: revisar los tipos de error de abajo; ${por('enviado')} ya se avisaron por correo.`,
    '',
    `Avisados al momento: ${por('enviado')} | En este resumen: ${por('en_resumen')} | Con envío fallido: ${por('envio_fallido')}`,
    ...[...tipos].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t, c]) => `- ${t}: ${c}`),
    '',
    ...eventos.slice(0, 30).map((x) => `${x.ocurrido_en} | ${x.flujo || '-'} | ${x.nodo || '-'} | ${x.tipo_error} | ${x.estado}`),
  ];
  return { asunto: `[NovuChat] Resumen diario: ${titulo}`, texto: lineas.join('\n'), idempotencia: `resumen-${dia}` };
}

/** Sale siempre, con 0 o con N eventos. Si el envío falla, lanza (el scheduler reintenta). */
export async function enviarResumenDiario(
  deps: { almacen: AlmacenAlertas; enviar: Enviar | null; ahoraMs: number },
): Promise<{ eventos: number; enviado: boolean }> {
  const eventos = await deps.almacen.desde(deps.ahoraMs - 24 * HORA_MS);
  if (!deps.enviar) return { eventos: eventos.length, enviado: false };
  await deps.enviar(armarResumen(eventos, deps.ahoraMs));
  return { eventos: eventos.length, enviado: true };
}

// ---------------------------------------------------------------------------
// FIRESTORE Y RESEND REALES
// ---------------------------------------------------------------------------
export function almacenFirestore(): AlmacenAlertas {
  const db = getFirestore();
  const eventos = () => db.collection('plataforma/alertas/eventos');
  const ctl = (id: string) => db.doc(`plataforma/alertas/control/${id}`);
  const idDia = (dia: string) => `dia_${dia}`;
  const idTipo = (tipo: string) => `tipo_${tipo}`;
  return {
    async crear(e) {
      try { await eventos().doc(e.id_unico).create({ ...e }); return true; } catch (error) {
        if ((error as { code?: unknown }).code === 6) return false; // ALREADY_EXISTS
        throw error;
      }
    },
    async poner(id, estado) { await eventos().doc(id).update({ estado }); },
    async reservar(tipo, dia, ahoraMs) {
      return db.runTransaction(async (t) => {
        const [d, h] = await Promise.all([t.get(ctl(idDia(dia))), t.get(ctl(idTipo(tipo)))]);
        const usados = Number(d.get('enviados') ?? 0);
        const ultimo = h.exists ? Number(h.get('ultimoMs') ?? 0) : null;
        if (usados >= TOPE_INMEDIATOS || (ultimo !== null && ahoraMs - ultimo < HORA_MS)) return { ok: false, previoUltimoMs: ultimo };
        t.set(ctl(idDia(dia)), { enviados: usados + 1, dia }, { merge: true });
        t.set(ctl(idTipo(tipo)), { ultimoMs: ahoraMs, tipo }, { merge: true });
        return { ok: true, previoUltimoMs: ultimo };
      });
    },
    async liberar(tipo, dia, previo) {
      await db.runTransaction(async (t) => {
        const d = await t.get(ctl(idDia(dia)));
        t.set(ctl(idDia(dia)), { enviados: Math.max(0, Number(d.get('enviados') ?? 0) - 1), dia }, { merge: true });
        t.set(ctl(idTipo(tipo)), { ultimoMs: previo ?? 0, tipo }, { merge: true });
      });
    },
    async desde(ms) {
      const q = await eventos().where('ocurrido_ms', '>=', ms).orderBy('ocurrido_ms', 'desc').limit(500).get();
      return q.docs.map((x) => x.data() as EventoGuardado);
    },
  };
}

/** Cliente de Resend. Nunca imprime la clave ni la respuesta: solo lanza con el estado HTTP. */
export function enviarPorResend(clave: string, remitente: string, destinatario: string): Enviar {
  return async (e) => {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', 'Idempotency-Key': e.idempotencia },
      body: JSON.stringify({ from: remitente, to: [destinatario], subject: e.asunto, text: e.texto }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`resend_${r.status}`);
  };
}

function enviadorConfigurado(): Enviar | null {
  const dominio = DOMINIO_AVISOS.value().trim();
  const para = DESTINATARIO.value().trim();
  if (!dominio || !para) return null;
  return enviarPorResend(RESEND_API_KEY_ALERTAS.value(), `NovuChat Alertas <alertas-novuchat@${dominio}>`, para);
}

export const alertaOperativa = onRequest(
  { region: REGION, secrets: [ALERTA_OPERATIVA_HMAC, RESEND_API_KEY_ALERTAS], cors: false, maxInstances: 3 },
  async (peticion, respuesta) => {
    const enviar = enviadorConfigurado();
    if (!enviar) console.error('ALERTA_OPERATIVA_SIN_PARAMETROS (dominio o destinatario sin configurar: se guarda, no se envía)');
    const r = await atenderAlerta(
      { metodo: peticion.method, cabecera: (n) => peticion.get(n), crudo: peticion.rawBody },
      {
        almacen: almacenFirestore(), enviar, secreto: ALERTA_OPERATIVA_HMAC.value(),
        hostsEnlace: HOSTS_ENLACE.value().split(','), ahoraMs: Date.now(),
      });
    respuesta.status(r.status).send(r.cuerpo);
  },
);

/** Todos los días a las 08:00 de La Paz. El correo sale aunque no haya ningún error. */
export const resumenAlertasOperativas = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/La_Paz', region: REGION, secrets: [RESEND_API_KEY_ALERTAS], retryCount: 2, maxInstances: 1 },
  async () => {
    const enviar = enviadorConfigurado();
    if (!enviar) { console.error('ALERTA_OPERATIVA_SIN_PARAMETROS (el resumen diario no salió)'); return; }
    try {
      const r = await enviarResumenDiario({ almacen: almacenFirestore(), enviar, ahoraMs: Date.now() });
      console.info(`resumen de alertas: eventos=${r.eventos} enviado=${r.enviado}`);
    } catch (error) {
      const m = (error as Error).message;
      console.error(`RESUMEN_ALERTAS_FALLO ${/^resend_\d+$/.test(m) ? m : 'error'}`);
      throw new Error('resumen_fallo');
    }
  },
);
