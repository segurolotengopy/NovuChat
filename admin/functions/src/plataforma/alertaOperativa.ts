/**
 * =============================================================================
 * ALERTA OPERATIVA: «ENVÍO INCIERTO» DEL errorWorkflow DE n8n -> CORREO (Plataforma)
 * =============================================================================
 *
 * PIEZA 1 del diseño `NOVUCHAT_diseno-alerta-envio-incierto` (07/11/2026), alineada con el contrato
 * `avisos-correo/v1` de WAM (ADR-011). El errorWorkflow de n8n solo deja huella en la ejecución: no avisa a
 * nadie. Esta Function es el EMISOR FUERA DE LA VM de OCI: recibe el evento, lo guarda y avisa por Resend.
 * No reemplaza al latido de n8n/OCI (la vigía de FinOps): si n8n está caído el errorWorkflow no corre.
 *
 * LO QUE HACE, EN ORDEN (cada paso cierra la puerta antes de gastar lo siguiente):
 *   1. AUTENTICA (`autenticar`) con FIRMA HMAC PROPIA (`ALERTAS_HMAC`): marca de tiempo + cuerpo
 *      crudo, ventana de 2 minutos, comparación en tiempo constante. NO reutiliza la firma de ingesta (por
 *      número de WhatsApp). SOLO DESPUÉS de autenticar se lee `plataforma/alertas`: una llamada sin firma
 *      no cuesta ni una lectura de la base.
 *   2. VALIDA (`alertaContenido.ts`): la entrada interna (aviso + tipo_error/flujo/nodo) y la convierte en el
 *      aviso v1 de 9 campos. Contenido prohibido -> se RECHAZA ENTERO y sale un aviso de texto fijo
 *      `<id_unico>:bloqueado` con solo campo y regla; si ni el proyecto ni el `id_unico` son válidos, no se envía
 *      nada y se responde 4xx.
 *   3. GUARDA el aviso en `plataforma/alertas/eventos/{id_unico}` (idempotente por `id_unico`).
 *   4. ENVÍA si el nivel es `urgente` o `aviso`: máximo 1 correo por hora por tipo de error y el tope diario
 *      (`plataforma/alertas.topeDiario`, por defecto 5, MÁXIMO DURO 8); UNO de los correos del tope queda para
 *      el resumen. `informativo` nunca sale solo: va al resumen. El resto queda `en_resumen`.
 *   5. `Idempotency-Key = novuchat:<id_unico>`; hasta 3 intentos (1 s y 4 s) ante red, 5xx o 429/409
 *      concurrente; nunca ante otro 4xx ni ante cuota diaria. Si el envío FALLA, el evento queda guardado
 *      (`envio_fallido`, entra al resumen) y el cupo se devuelve: un fallo no gasta tope.
 *   6. RESUMEN (`resumenAlertasOperativas`, 08:00 La Paz): sale SOLO si hay eventos sin resumir (`resumido_en == null`);
 *      el latido de «todo bien» es de la vigía de FinOps (D-5 del ADR). Cada evento incluido se marca después de enviar.
 *      Si Resend dice que la cuota se agotó, no se le llama hasta las 00:00 UTC (marca en `control/cuota`); el día
 *      del tope es UTC porque el pool de Resend lo es.
 *
 * SECRETOS: `ALERTAS_HMAC` y `ALERTAS_RESEND_API_KEY` (Secret Manager). Nunca se imprimen: los
 * registros llevan códigos fijos y nada del cuerpo, de la clave, de la respuesta de Resend ni de la lista de
 * denegados. Dominio de avisos, destinatario, hosts de enlace, lista `avisosDenegar` y `topeDiario` son
 * configuración en `plataforma/alertas` (el repo es público; y NO son `defineString`: el `.env` de producción
 * es de exactamente dos nombres, `parametros-del-despliegue.test.ts`). Sin esa configuración se guarda y no
 * se envía.
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
import {
  CONTRATO, ErrorAlerta, ErrorContrato, PROYECTO, armarCorreo, avisoBloqueado, validarEntrada,
  type AvisoV1, type Envio, type EventoValidado,
} from './alertaContenido.js';

// El contenido (contrato, detectores, enlace, plantilla) vive en `alertaContenido.ts`; se reexporta lo que usan las pruebas.
export { ErrorAlerta, ErrorContrato, armarCorreo, avisoBloqueado, validarEntrada, type AvisoV1, type Envio } from './alertaContenido.js';

// Prefijo común EXACTO `ALERTAS_`: la condición de IAM de `desplegadorSecretos` (preparar-staging.sh, nube-alertas.sh)
// cubre los secretos por prefijo; un nombre fuera de ellos rompe el despliegue con 403 (`secretos-iam-prefijos.test.ts`).
export const ALERTAS_HMAC = defineSecret('ALERTAS_HMAC');
export const ALERTAS_RESEND_API_KEY = defineSecret('ALERTAS_RESEND_API_KEY');

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------
export const VENTANA_ALERTA_MS = 2 * 60 * 1000;
export const MAX_CUERPO_ALERTA = 8 * 1024;
/** Tope diario de correos de NovuChat (de los 50 compartidos de Resend Free): valor por defecto. */
export const TOPE_DIARIO = 5;
/** Máximo duro: el código no permite superarlo aunque la configuración lo pida (FinOps propone 8). */
export const TOPE_MAXIMO = 8;
/**
 * El tope vigente sale de `plataforma/alertas.topeDiario`. Entero de 1 a 8; uno mayor se recorta a 8; ausente o
 * inválido (texto, decimal, 0, negativo) vale el 5 por defecto. Nunca devuelve más de 8.
 */
export const topeValido = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return TOPE_DIARIO;
  return Math.min(v, TOPE_MAXIMO);
};
/** Uno de los correos del tope queda reservado al resumen diario. */
export const inmediatosDe = (tope: number): number => Math.max(0, tope - 1);
export const HORA_MS = 3_600_000;
export const MAX_EVENTOS_RESUMEN = 500;
export type EstadoEvento = 'enviado' | 'en_resumen' | 'envio_fallido';

/** Día calendario UTC: el pool de 100 correos/día de Resend se reinicia a las 00:00 UTC, no a medianoche de La Paz. */
export const diaUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const siguienteMedianocheUtc = (ms: number): number => (Math.floor(ms / 86_400_000) + 1) * 86_400_000;
const aIsoSegundos = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}Z`;

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
// ALMACÉN Y ENVÍO (inyectables: las pruebas usan memoria o el emulador, con el MISMO contrato)
// ---------------------------------------------------------------------------
export interface EventoGuardado extends AvisoV1 {
  tipo_error: string;
  flujo: string;
  nodo: string;
  ocurrido_ms: number;
  recibido_ms: number;
  dia: string;
  estado: EstadoEvento;
  saneado: boolean;
  /** Hora (servidor) en que un resumen lo incluyó; `null` mientras espera. Evita depender de una ventana de tiempo. */
  resumido_en: number | null;
}
export interface Reserva { ok: boolean; previoUltimoMs: number | null }

export interface AlmacenAlertas {
  /** `false` (sin lanzar) si el `id_unico` ya estaba guardado. */
  crear(e: EventoGuardado): Promise<boolean>;
  poner(id: string, estado: EstadoEvento): Promise<void>;
  /** Reserva atómica: cupo del día (`tope - 1` inmediatos) y 1 por hora por tipo. */
  reservar(tipo: string, dia: string, ahoraMs: number, tope: number): Promise<Reserva>;
  /** Devuelve una reserva: baja el contador del día y restaura la hora del tipo. */
  liberar(tipo: string, dia: string, previoUltimoMs: number | null): Promise<void>;
  /** Eventos que ningún resumen incluyó todavía (`resumido_en == null`), los más nuevos primero, hasta 500. */
  pendientesDeResumen(): Promise<EventoGuardado[]>;
  /** Marca esos eventos como incluidos en un resumen ya ENVIADO. */
  marcarResumidos(ids: string[], ms: number): Promise<void>;
  /** La lista de ids (y la hora) que se fijó para el resumen del día ANTES de enviarlo, o `null`. */
  resumenDelDia(dia: string): Promise<{ ids: string[]; ahoraMs: number } | null>;
  fijarResumenDelDia(dia: string, ids: string[], ahoraMs: number): Promise<void>;
  eventosPorId(ids: string[]): Promise<EventoGuardado[]>;
  /** Hasta cuándo (ms) no se llama a Resend por cuota agotada, o `null`. */
  cuotaHasta(): Promise<number | null>;
  marcarCuota(hastaMs: number): Promise<void>;
}
export type Enviar = (e: Envio) => Promise<void>;

export interface Resultado { estado: EstadoEvento | 'duplicado' }
export interface DepsProceso { almacen: AlmacenAlertas; enviar: Enviar | null; ahoraMs: number; tope?: number }

export async function procesarEvento(ev: EventoValidado, deps: DepsProceso): Promise<Resultado> {
  const a = ev.aviso;
  const g: EventoGuardado = {
    ...a, tipo_error: ev.tipo_error, flujo: ev.flujo, nodo: ev.nodo, ocurrido_ms: Date.parse(a.ocurrido_en),
    recibido_ms: deps.ahoraMs, dia: diaUtc(deps.ahoraMs), estado: 'en_resumen', saneado: ev.saneado, resumido_en: null,
  };
  // 1. Primero se guarda: lo que pase después no puede perder el evento.
  if (!await deps.almacen.crear(g)) return { estado: 'duplicado' };
  // `informativo` nunca sale solo; sin configuración de envío, tampoco.
  if (a.nivel === 'informativo' || !deps.enviar) return { estado: 'en_resumen' };
  // 2. Cupo. El tope se valida AQUÍ también (no solo al leer la configuración): nunca pasa de TOPE_MAXIMO.
  const tope = topeValido(deps.tope);
  try {
    // Resend avisó que la cuota se agotó: no se le llama hasta las 00:00 UTC; el evento va al resumen.
    const hasta = await deps.almacen.cuotaHasta();
    if (hasta !== null && hasta > deps.ahoraMs) return { estado: 'en_resumen' };
  } catch { console.error('ALERTA_OPERATIVA_CUOTA_LECTURA_FALLO'); }
  let r: Reserva;
  try {
    r = await deps.almacen.reservar(ev.tipo_error, g.dia, deps.ahoraMs, tope);
  } catch {
    // Contención o caída de la base: el evento ya está guardado; va al resumen en vez de perderse con un 500.
    console.error('ALERTA_OPERATIVA_RESERVA_FALLO');
    return { estado: 'en_resumen' };
  }
  if (!r.ok) return { estado: 'en_resumen' };
  // 3. Envío; si falla, se devuelve el cupo y el evento pasa al resumen como `envio_fallido`.
  try {
    await deps.enviar(armarCorreo(a));
  } catch (error) {
    if ((error as Error).message === 'resend_cuota') {
      try { await deps.almacen.marcarCuota(siguienteMedianocheUtc(deps.ahoraMs)); } catch { console.error('ALERTA_OPERATIVA_CUOTA_MARCA_FALLO'); }
    }
    try { await deps.almacen.liberar(ev.tipo_error, g.dia, r.previoUltimoMs); } catch {
      console.error('ALERTA_OPERATIVA_LIBERAR_FALLO');
    }
    try { await deps.almacen.poner(a.id_unico, 'envio_fallido'); } catch { console.error('ALERTA_OPERATIVA_ESTADO_FALLO'); }
    return { estado: 'envio_fallido' };
  }
  // El correo YA salió: si no se puede anotar, no se responde 500 (n8n reintentaría y el `id_unico` ya existe).
  try { await deps.almacen.poner(a.id_unico, 'enviado'); } catch { console.error('ALERTA_OPERATIVA_ESTADO_FALLO'); }
  return { estado: 'enviado' };
}

// ---------------------------------------------------------------------------
// PUERTA HTTP: autenticar() y LUEGO procesar()
// ---------------------------------------------------------------------------
export interface RespuestaAlerta { status: number; cuerpo: string }
export interface Peticion { metodo: string; cabecera(n: string): string | undefined; crudo: Buffer | undefined }

export function autenticar(p: Peticion, secreto: string, ahoraMs: number): { ok: true; crudo: Buffer } | { ok: false; respuesta: RespuestaAlerta } {
  if (p.metodo !== 'POST') return { ok: false, respuesta: { status: 405, cuerpo: 'metodo' } };
  const crudo = p.crudo ?? Buffer.from('');
  if (crudo.length > MAX_CUERPO_ALERTA) return { ok: false, respuesta: { status: 413, cuerpo: 'demasiado_grande' } };
  const ok = verificarFirmaAlerta(
    secreto, String(p.cabecera('X-NovuChat-Alerta-Timestamp') ?? ''),
    String(p.cabecera('X-NovuChat-Alerta-Signature') ?? ''), crudo, ahoraMs);
  // A quien no pasa no se le explica qué le faltó.
  return ok ? { ok: true, crudo } : { ok: false, respuesta: { status: 401, cuerpo: 'no autorizado' } };
}

export interface ConfigProceso extends DepsProceso { hosts: readonly string[]; denegar: readonly string[]; repos?: readonly string[] }

export async function procesar(crudo: Buffer, cfg: ConfigProceso): Promise<RespuestaAlerta> {
  try {
    const ev = validarEntrada(JSON.parse(crudo.toString('utf8')), { hosts: cfg.hosts, denegar: cfg.denegar, ahoraMs: cfg.ahoraMs, repos: cfg.repos ?? [] });
    const r = await procesarEvento(ev, cfg);
    return { status: 200, cuerpo: r.estado };
  } catch (error) {
    if (error instanceof ErrorContrato) {
      // Rechazado entero. Si proyecto e id_unico son válidos, sale el aviso de texto fijo (solo campo y regla).
      if (error.idParaBloqueo !== null || error.bloqueoSinId) {
        const b = avisoBloqueado(error, cfg.ahoraMs);
        try {
          await procesarEvento({ aviso: b, tipo_error: 'contenido_bloqueado', flujo: '', nodo: '', saneado: false }, cfg);
        } catch {
          // La base falló: el aviso del bloqueo NO se pierde; se intenta el correo directo (misma Idempotency-Key).
          console.error('ALERTA_OPERATIVA_BLOQUEADO_FALLO');
          if (cfg.enviar) { try { await cfg.enviar(armarCorreo(b)); } catch { console.error('ALERTA_OPERATIVA_BLOQUEADO_ENVIO_FALLO'); } }
        }
      }
      return { status: error.estado, cuerpo: error.cuerpo };
    }
    if (error instanceof ErrorAlerta) return { status: error.estado, cuerpo: error.codigo };
    if (error instanceof SyntaxError) return { status: 400, cuerpo: 'cuerpo_invalido' };
    console.error('ALERTA_OPERATIVA_ERROR_INTERNO');
    return { status: 500, cuerpo: 'error' };
  }
}

/** `cargar` (la configuración, que lee Firestore) se llama SOLO después de verificar la firma. */
export async function atenderAlerta(
  p: Peticion, deps: { secreto: string; ahoraMs: number; cargar: () => Promise<Omit<ConfigProceso, 'ahoraMs'>> },
): Promise<RespuestaAlerta> {
  const a = autenticar(p, deps.secreto, deps.ahoraMs);
  if (!a.ok) return a.respuesta;
  let cfg: Omit<ConfigProceso, 'ahoraMs'>;
  try { cfg = await deps.cargar(); } catch { console.error('ALERTA_OPERATIVA_CONFIG_FALLO'); return { status: 500, cuerpo: 'error' }; }
  return procesar(a.crudo, { ...cfg, ahoraMs: deps.ahoraMs });
}

// ---------------------------------------------------------------------------
// RESUMEN
// ---------------------------------------------------------------------------
export function armarResumen(eventos: EventoGuardado[], ahoraMs: number): Envio {
  const n = eventos.length;
  const por = (est: EstadoEvento): number => eventos.filter((x) => x.estado === est).length;
  const tipos = new Map<string, number>();
  for (const x of eventos) tipos.set(x.tipo_error, (tipos.get(x.tipo_error) ?? 0) + 1);
  const cuenta = n >= MAX_EVENTOS_RESUMEN ? `${MAX_EVENTOS_RESUMEN} o más` : String(n);
  const lineas = [
    `${cuenta} ${n === 1 ? 'aviso' : 'avisos'} desde el último resumen.`,
    `Avisados al momento: ${por('enviado')} | En este resumen: ${por('en_resumen')} | Con envío fallido: ${por('envio_fallido')}`,
    ...[...tipos].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t, c]) => `- ${t}: ${c}`),
    ...eventos.slice(0, 12).map((x) => `${aIsoSegundos(x.recibido_ms).slice(5, 16)}Z | ${x.flujo || '-'} | ${x.tipo_error} | ${x.estado}`),
  ].slice(0, 30);
  const aviso: AvisoV1 = {
    contrato: CONTRATO, nivel: 'informativo', proyecto: PROYECTO, asunto: 'Resumen de avisos operativos',
    que_paso: [...lineas.join('\n')].slice(0, 1500).join(''),
    que_se_espera_de_andres: 'Revisar los tipos de abajo; los «enviado» ya se avisaron por correo.',
    enlace: null, ocurrido_en: aIsoSegundos(ahoraMs), id_unico: `resumen-${diaUtc(ahoraMs)}`,
  };
  return armarCorreo(aviso);
}

/**
 * Sale SOLO si hay eventos que ningún resumen incluyó (`resumido_en == null`). Sin eventos no hay correo (el latido es
 * de la vigía de FinOps).
 *
 * LA CARRERA Y EL 409, resueltos con UNA lista fija por día: la lista de ids (y la hora) del resumen se guarda en
 * `control/resumen_<día>` ANTES de enviar, y todo reintento del mismo día reusa ESA lista y esa hora: el cuerpo es
 * idéntico (la Idempotency-Key `novuchat:resumen-<día>` no choca) y solo se marcan esos ids. Un evento que llega después
 * (C) no está en la lista: queda pendiente para el resumen del día siguiente, aunque Resend conteste 409 al reintento.
 * Si el envío falla, nada se marca. Si marcar falla a medias, el reintento reenvía la misma lista y vuelve a marcar.
 * Una vez que todos los de la lista están marcados, ese día no sale otro resumen.
 */
export async function enviarResumenDiario(deps: { almacen: AlmacenAlertas; enviar: Enviar | null; ahoraMs: number }): Promise<{ eventos: number; enviado: boolean }> {
  const dia = diaUtc(deps.ahoraMs);
  const previo = await deps.almacen.resumenDelDia(dia);
  let eventos: EventoGuardado[];
  let momento = deps.ahoraMs;
  if (previo) {
    eventos = await deps.almacen.eventosPorId(previo.ids);
    momento = previo.ahoraMs;
    if (eventos.every((e) => e.resumido_en !== null)) return { eventos: 0, enviado: false }; // el resumen de hoy ya salió
  } else {
    eventos = await deps.almacen.pendientesDeResumen();
    if (eventos.length === 0) return { eventos: 0, enviado: false };
  }
  eventos = [...eventos].sort((a, b) => b.recibido_ms - a.recibido_ms || (a.id_unico < b.id_unico ? -1 : 1));
  if (!deps.enviar) return { eventos: eventos.length, enviado: false };
  const hasta = await deps.almacen.cuotaHasta();
  if (hasta !== null && hasta > deps.ahoraMs) return { eventos: eventos.length, enviado: false };
  const ids = eventos.map((e) => e.id_unico);
  if (!previo) await deps.almacen.fijarResumenDelDia(dia, ids, momento);   // ANTES de enviar
  try {
    await deps.enviar(armarResumen(eventos, momento));
  } catch (error) {
    if ((error as Error).message === 'resend_cuota') await deps.almacen.marcarCuota(siguienteMedianocheUtc(deps.ahoraMs));
    throw error;
  }
  await deps.almacen.marcarResumidos(ids, deps.ahoraMs);
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
        if (usados >= inmediatosDe(topeValido(tope)) || (ultimo !== null && ahoraMs - ultimo < HORA_MS)) return { ok: false, previoUltimoMs: ultimo };
        t.set(ctl(idDia(dia)), { enviados: usados + 1, dia }, { merge: true });
        t.set(ctl(idTipo(tipo)), { ultimoMs: ahoraMs, tipo }, { merge: true });
        return { ok: true, previoUltimoMs: ultimo };
      }, { maxAttempts: 10 });
    },
    async liberar(tipo, dia, previo) {
      await db.runTransaction(async (t) => {
        const d = await t.get(ctl(idDia(dia)));
        t.set(ctl(idDia(dia)), { enviados: Math.max(0, Number(d.get('enviados') ?? 0) - 1), dia }, { merge: true });
        t.set(ctl(idTipo(tipo)), { ultimoMs: previo ?? 0, tipo }, { merge: true });
      }, { maxAttempts: 10 });
    },
    async pendientesDeResumen() {
      // Con orden por `recibido_ms` (índice compuesto en `firestore.indexes.json`): si hay más de 500, entran los MÁS NUEVOS.
      const q = await eventos().where('resumido_en', '==', null).orderBy('recibido_ms', 'desc').limit(MAX_EVENTOS_RESUMEN).get();
      return q.docs.map((x) => x.data() as EventoGuardado);
    },
    async marcarResumidos(ids, ms) {
      for (let i = 0; i < ids.length; i += 400) {
        const lote = db.batch();
        for (const id of ids.slice(i, i + 400)) lote.update(eventos().doc(id), { resumido_en: ms });
        await lote.commit();
      }
    },
    async resumenDelDia(dia) {
      const d = await ctl(`resumen_${dia}`).get();
      return d.exists && Array.isArray(d.get('ids')) ? { ids: d.get('ids') as string[], ahoraMs: Number(d.get('ahoraMs')) } : null;
    },
    async fijarResumenDelDia(dia, ids, ahoraMs) { await ctl(`resumen_${dia}`).set({ ids, ahoraMs }); },
    async eventosPorId(ids) {
      const salida: EventoGuardado[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const docs = await db.getAll(...ids.slice(i, i + 100).map((id) => eventos().doc(id)));
        for (const d of docs) if (d.exists) salida.push(d.data() as EventoGuardado);
      }
      return salida;
    },
    async cuotaHasta() {
      const d = await ctl('cuota').get();
      return d.exists && typeof d.get('hastaMs') === 'number' ? (d.get('hastaMs') as number) : null;
    },
    async marcarCuota(hastaMs) { await ctl('cuota').set({ hastaMs }, { merge: true }); },
  };
}

const ESPERAS_MS = [1000, 4000] as const;
const dormir = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const CUOTAS = new Set(['daily_quota_exceeded', 'monthly_quota_exceeded']);

async function nombreDelError(r: Response): Promise<string> {
  try { const j = await r.json() as { name?: unknown }; return typeof j.name === 'string' ? j.name : ''; } catch { return ''; }
}

/**
 * Cliente de Resend. Nunca imprime la clave ni la respuesta: solo lanza con un código fijo. Hasta 3 intentos con
 * la MISMA Idempotency-Key (1 s y 4 s) ante red, 5xx, 429 y 409 concurrente; nunca ante otro 4xx ni ante cuota.
 * Un 409 `invalid_idempotent_request` (la clave ya se usó con otro contenido: el resumen reintentado) se toma
 * como «ya enviado».
 */
export function enviarPorResend(
  clave: string, direccionRemitente: string, destinatario: string, esperar: (ms: number) => Promise<void> = dormir,
): Enviar {
  return async (e) => {
    for (let intento = 0; ; intento++) {
      let estado = 0; let nombre = '';
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json', 'Idempotency-Key': e.idempotencia },
          body: JSON.stringify({ from: `${e.nombreVisible} <${direccionRemitente}>`, to: [destinatario], subject: e.asunto, text: e.texto, html: e.html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) return;
        estado = r.status; nombre = await nombreDelError(r);
      } catch { estado = 0; }
      if (estado === 409 && nombre === 'invalid_idempotent_request') return;
      if (CUOTAS.has(nombre)) throw new Error('resend_cuota');
      const reintentable = estado === 0 || estado >= 500 || estado === 429 || (estado === 409 && nombre === 'concurrent_idempotent_requests');
      if (!reintentable) throw new Error(`resend_${estado}`);
      const espera = ESPERAS_MS[intento];
      if (espera === undefined) throw new Error(`resend_agotado_${estado}`);
      await esperar(espera);
    }
  };
}

interface ConfigAlertas { dominio: string; destinatario: string; hosts: string[]; repos: string[]; denegar: string[]; tope: number }

async function configuracion(): Promise<ConfigAlertas> {
  const d = await getFirestore().doc('plataforma/alertas').get();
  const t = (k: string): string => (typeof d.get(k) === 'string' ? String(d.get(k)).trim() : '');
  const lista = (k: string): string[] => t(k).split(',').map((h) => h.trim()).filter(Boolean);
  return { dominio: t('dominioAvisos'), destinatario: t('destinatario'), hosts: lista('enlaceHosts'), repos: lista('enlaceRepos'), denegar: lista('avisosDenegar'), tope: topeValido(d.get('topeDiario')) };
}

function enviadorConfigurado(c: ConfigAlertas): Enviar | null {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.dominio) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.destinatario)) return null;
  return enviarPorResend(ALERTAS_RESEND_API_KEY.value(), `alertas-${PROYECTO}@${c.dominio}`, c.destinatario);
}

export const alertaOperativa = onRequest(
  { region: REGION, secrets: [ALERTAS_HMAC, ALERTAS_RESEND_API_KEY], cors: false, maxInstances: 3 },
  async (peticion, respuesta) => {
    const r = await atenderAlerta(
      { metodo: peticion.method, cabecera: (n) => peticion.get(n), crudo: peticion.rawBody },
      {
        secreto: ALERTAS_HMAC.value(), ahoraMs: Date.now(),
        cargar: async () => {
          const c = await configuracion();
          const enviar = enviadorConfigurado(c);
          if (!enviar) console.error('ALERTA_OPERATIVA_SIN_CONFIGURACION (plataforma/alertas sin dominioAvisos o destinatario: se guarda, no se envía)');
          return { almacen: almacenFirestore(), enviar, hosts: c.hosts, repos: c.repos, denegar: c.denegar, tope: c.tope };
        },
      });
    respuesta.status(r.status).send(r.cuerpo);
  },
);

/** Todos los días a las 08:00 de La Paz. Sale solo si hay eventos acumulados. */
export const resumenAlertasOperativas = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/La_Paz', region: REGION, secrets: [ALERTAS_RESEND_API_KEY], retryCount: 2, maxInstances: 1 },
  async () => {
    const enviar = enviadorConfigurado(await configuracion());
    if (!enviar) { console.error('ALERTA_OPERATIVA_SIN_CONFIGURACION (el resumen no salió)'); return; }
    try {
      const r = await enviarResumenDiario({ almacen: almacenFirestore(), enviar, ahoraMs: Date.now() });
      console.info(`resumen de alertas: eventos=${r.eventos} enviado=${r.enviado}`);
    } catch (error) {
      const m = (error as Error).message;
      console.error(`RESUMEN_ALERTAS_FALLO ${/^resend_[a-z0-9_]+$/.test(m) ? m : 'error'}`);
      throw new Error('resumen_fallo');
    }
  },
);
