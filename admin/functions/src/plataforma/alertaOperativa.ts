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
 *      5 correos por día por defecto (`plataforma/alertas.topeDiario`); UNO queda reservado al resumen, así que salen 4 inmediatos.
 *      El resto queda `en_resumen`.
 *   6. `Idempotency-Key = id_unico` en la llamada a Resend. Si el envío FALLA, el evento queda guardado
 *      (`envio_fallido`, entra al resumen) y la reserva del tope se devuelve: un fallo no gasta cupo.
 *   7. Resumen diario (`resumenAlertasOperativas`, 08:00 La Paz): sale AUNQUE haya 0 errores («0 errores
 *      en 24 h»): es el latido. Si no llega, es una alerta (política del 11/10/2026).
 *
 * LOS SECRETOS: `ALERTA_OPERATIVA_HMAC` y `RESEND_API_KEY_ALERTAS` (Secret Manager). Nunca se imprimen:
 * los registros llevan códigos fijos y nada del cuerpo, de la clave ni de la respuesta de Resend.
 * El remitente (dominio de avisos), el destinatario y los hosts de enlace permitidos son CONFIGURACIÓN
 * en `plataforma/alertas` (`dominioAvisos`, `destinatario`, `enlaceHosts`), que escribe el servidor
 * con un script de operador: el repo es público y no escribe el dominio ni el correo reales. NO son
 * parámetros de Functions (`defineString`): el `.env` de producción es de exactamente dos nombres
 * (`pruebas/parametros-del-despliegue.test.ts`). Sin esa configuración, la Function guarda el evento
 * y NO envía.
 *
 * 0 mensajes de WhatsApp por conversación: esto no toca el canal.
 */
import { createHmac } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../core/region.js';
import { firmaValida } from '../core/seguridad/firma.js';
import { ErrorAlerta, validarEvento, type EventoAlerta } from './alertaContenido.js';

// El contenido (contrato, sin PII, enlace) vive en `alertaContenido.ts`; se reexporta para quien lo importaba de aquí.
export { ErrorAlerta, LIMITES, NIVELES, sanearTexto, validarEvento, type EventoAlerta, type Nivel } from './alertaContenido.js';

export const ALERTA_OPERATIVA_HMAC = defineSecret('ALERTA_OPERATIVA_HMAC');
export const RESEND_API_KEY_ALERTAS = defineSecret('RESEND_API_KEY_ALERTAS');

// ---------------------------------------------------------------------------
// CONSTANTES DEL CONTRATO
// ---------------------------------------------------------------------------
export const VENTANA_ALERTA_MS = 2 * 60 * 1000;
export const MAX_CUERPO_ALERTA = 8 * 1024;
/**
 * Tope diario de correos de NovuChat dentro de los 50 compartidos de Resend (Free): VALOR POR DEFECTO.
 * El vigente sale de `plataforma/alertas.topeDiario` (entero de 1 a 50), que se cambia sin desplegar.
 * (No es `defineInt`: un parámetro de Functions exige su nombre en el `.env` de despliegue y el de
 * producción es de exactamente dos nombres; ver `parametros-del-despliegue.test.ts`.)
 */
export const TOPE_DIARIO = 5;
/** Uno de los correos del tope queda reservado al resumen diario. */
export const inmediatosDe = (tope: number): number => Math.max(0, tope - 1);
export const topeValido = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 50 ? v : TOPE_DIARIO;
export const HORA_MS = 3_600_000;
export type EstadoEvento = 'enviado' | 'en_resumen' | 'envio_fallido';
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
  reservar(tipo: string, dia: string, ahoraMs: number, tope: number): Promise<Reserva>;
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
  deps: { almacen: AlmacenAlertas; enviar: Enviar | null; ahoraMs: number; tope?: number },
): Promise<Resultado> {
  const ms = Date.parse(e.ocurrido_en);
  const g: EventoGuardado = { ...e, ocurrido_ms: ms, recibido_ms: deps.ahoraMs, dia: diaLaPaz(deps.ahoraMs), estado: 'en_resumen', saneado };
  // 1. Primero se guarda: lo que pase después no puede perder el evento.
  if (!await deps.almacen.crear(g)) return { estado: 'duplicado' };
  if (e.nivel !== 'critico' || !deps.enviar) return { estado: 'en_resumen' };
  // 2. Cupo.
  const r = await deps.almacen.reservar(e.tipo_error, g.dia, deps.ahoraMs, deps.tope ?? TOPE_DIARIO);
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
  deps: { almacen: AlmacenAlertas; enviar: Enviar | null; secreto: string; hostsEnlace: string[]; ahoraMs: number; tope?: number },
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
    async reservar(tipo, dia, ahoraMs, tope) {
      return db.runTransaction(async (t) => {
        const [d, h] = await Promise.all([t.get(ctl(idDia(dia))), t.get(ctl(idTipo(tipo)))]);
        const usados = Number(d.get('enviados') ?? 0);
        const ultimo = h.exists ? Number(h.get('ultimoMs') ?? 0) : null;
        if (usados >= inmediatosDe(tope) || (ultimo !== null && ahoraMs - ultimo < HORA_MS)) return { ok: false, previoUltimoMs: ultimo };
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

interface ConfigAlertas { dominio: string; destinatario: string; hosts: string[]; tope: number }

async function configuracion(): Promise<ConfigAlertas> {
  const d = await getFirestore().doc('plataforma/alertas').get();
  const t = (k: string): string => (typeof d.get(k) === 'string' ? String(d.get(k)).trim() : '');
  return { dominio: t('dominioAvisos'), destinatario: t('destinatario'), hosts: t('enlaceHosts').split(',').map((h) => h.trim()).filter(Boolean), tope: topeValido(d.get('topeDiario')) };
}

function enviadorConfigurado(c: ConfigAlertas): Enviar | null {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.dominio) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.destinatario)) return null;
  return enviarPorResend(RESEND_API_KEY_ALERTAS.value(), `NovuChat Alertas <alertas-novuchat@${c.dominio}>`, c.destinatario);
}

export const alertaOperativa = onRequest(
  { region: REGION, secrets: [ALERTA_OPERATIVA_HMAC, RESEND_API_KEY_ALERTAS], cors: false, maxInstances: 3 },
  async (peticion, respuesta) => {
    // La firma se verifica DENTRO de `atenderAlerta`, antes de cualquier lectura; la configuración se lee
    // una vez por llamada (las alertas son raras: no hay costo que justifique una caché).
    const c = await configuracion();
    const enviar = enviadorConfigurado(c);
    if (!enviar) console.error('ALERTA_OPERATIVA_SIN_CONFIGURACION (plataforma/alertas sin dominioAvisos o destinatario: se guarda, no se envía)');
    const r = await atenderAlerta(
      { metodo: peticion.method, cabecera: (n) => peticion.get(n), crudo: peticion.rawBody },
      { almacen: almacenFirestore(), enviar, secreto: ALERTA_OPERATIVA_HMAC.value(), hostsEnlace: c.hosts, ahoraMs: Date.now(), tope: c.tope });
    respuesta.status(r.status).send(r.cuerpo);
  },
);

/** Todos los días a las 08:00 de La Paz. El correo sale aunque no haya ningún error. */
export const resumenAlertasOperativas = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/La_Paz', region: REGION, secrets: [RESEND_API_KEY_ALERTAS], retryCount: 2, maxInstances: 1 },
  async () => {
    const enviar = enviadorConfigurado(await configuracion());
    if (!enviar) { console.error('ALERTA_OPERATIVA_SIN_CONFIGURACION (el resumen diario no salió)'); return; }
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
