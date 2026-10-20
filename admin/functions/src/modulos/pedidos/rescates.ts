import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from '../../core/region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../../core/seguridad/firma.js';
import { milisegundosDe } from '../../core/turno/tiempo.js';
import { registrar } from '../../core/turno/bitacora.js';
import { leerTurno } from '../../core/conversacion/turno.js';
import { decidirPausa } from '../../core/conversacion/pausa.js';
import { periodoDe } from '../../central/cuenta/planes.js';
import {
  consumidasDe, corteAplicable, estadoDeServicio, type CuentaCruda,
} from '../../central/cuenta/prepago.js';

/**
 * =============================================================================
 * RESCATE DE 22 H — a quién se le escribe UNA vez, y a quién nunca
 * =============================================================================
 *
 * EL PROBLEMA. Quien conversó con el asistente de venta y calló sin comprar
 * tiene la ventana de 24 h de Meta abierta unas horas más. Entre las 22 h y las
 * 23 h 30 min de silencio se le puede mandar UN texto libre que retome lo que
 * contó. Dos, o uno a quien compró, pasó a una persona o pidió que no le
 * escriban, cuestan el número de WhatsApp del comercio.
 *
 * QUIÉN HACE QUÉ. Esta Function DECIDE y MARCA; no envía. El envío y la
 * redacción son de un flujo de n8n por comercio (otro PR) que llama acá con la
 * credencial de ingesta de SU número. La decisión de retención (qué se guarda de
 * las ejecuciones) también es de ese flujo.
 *
 * LAS BARRERAS, en el servidor (`CLAUDE.md`: el prompt no es una barrera):
 *
 *   1. La decisión pura `motivoParaNoRescatar` (probada caso por caso, negando).
 *   2. La lista de prueba (`soloTelefonos`) se aplica ANTES de marcar: probar no
 *      gasta el único rescate de un cliente real. Una lista vacía no devuelve
 *      nada.
 *   3. LA MARCA VA ANTES DEL ENVÍO, dentro de una transacción que vuelve a leer
 *      y vuelve a decidir. Dos corridas a la vez no pueden marcar la misma
 *      conversación. Si el envío falla, ese rescate se pierde: es preferible a
 *      mandar dos (mismo criterio que `seguimientos.ts`).
 *   4. LA MARCA NO SE BORRA NUNCA: un rescate por contacto y por comercio, para
 *      siempre. Se escribe con `merge`; una escritura sin `merge` sobre la
 *      conversación la borraría.
 *   5. Topes de protección (no comerciales): por corrida y por comercio en 24 h.
 *
 * MULTI-TENANT. El comercio sale de la ruta autenticada, nunca del cuerpo. Solo
 * se lee y se marca `tenants/{ruta.tenantId}/...`, y solo conversaciones cuya
 * última línea entrante es la de ESTE número.
 *
 * PRIVACIDAD. Nunca se registra en el log un teléfono ni un texto. La respuesta
 * no lleva `nombreContacto`. La bitácora guarda el teléfono como en
 * `seguimientos.ts`, nunca el texto.
 *
 * COSTO. La Function no envía mensajes. El flujo que la consume agrega +1
 * mensaje por conversación rescatada (`docs/base-comercial.md` §1).
 */

const TELEFONO = /^[0-9]{8,15}$/;

export const HORA = 60 * 60 * 1000;
/** El silencio mínimo para rescatar (inclusive) y el máximo (exclusivo). */
export const MS_DESDE = 22 * HORA;
export const MS_HASTA = 23.5 * HORA;
/** Lo máximo que sale en una corrida. */
export const TOPE_POR_CORRIDA = 20;
/** Lo máximo que se marca por comercio en 24 h (gasto máximo acotado). */
export const TOPE_DIARIO_POR_COMERCIO = 150;
/** Documentos de conversación que se leen por página de la consulta de candidatas. */
export const TOPE_DE_LECTURA = 100;
/**
 * Páginas que se recorren por corrida (500 lecturas como máximo). Sin esto, las
 * conversaciones que NO se pueden rescatar (ya rescatadas, compradas, tomadas…)
 * ocuparían para siempre los primeros lugares de la franja y las nuevas nunca se
 * leerían.
 */
export const MAX_PAGINAS = 5;
/**
 * Cuántos mensajes se leen de cada candidata, de los últimos 24 h previos a su
 * último entrante y del más nuevo al más viejo. LÍMITE CONOCIDO: si en esa
 * ventana hay más de 60 mensajes (entrantes y salientes), los más antiguos no
 * se leen y una imagen o un rechazo anterior a ellos no se vería.
 */
export const MENSAJES_A_LEER = 60;
export const TEXTOS_MAX = 6;
export const LARGO_TEXTO = 300;

/** Sobre el texto normalizado (minúsculas, sin tildes). «Lo voy a pensar» NO entra. */
export const RECHAZO =
  /\b(no me interesa|no estoy interesad[oa]|no,? gracias|no quiero|no lo quiero|no lo necesito|no me escrib\w*|no me molest\w*|dejame en paz|stop|dame de baja|de baja)\b/;

export type MotivoDescarte =
  | 'telefono_invalido' | 'excluido' | 'fuera_de_lista' | 'otra_linea' | 'ya_rescatado'
  | 'no_contactar' | 'atencion' | 'sin_ventana' | 'tomada' | 'compro' | 'temprano'
  | 'tarde' | 'medio' | 'rechazo' | 'seguimiento';

export interface ContextoRescate {
  phoneNumberId: string;
  excluidos: ReadonlySet<string>;
  soloTelefonos: ReadonlySet<string> | null;
}

const ETAPAS_DE_COMPRA = new Set(['agendada', 'en_revision', 'a_favor']);

/**
 * ¿Por qué NO se rescata a esta conversación? `''` = se puede. PURA. El orden
 * es el de la decisión de diseño; ante la duda, no se escribe.
 */
export function motivoParaNoRescatar(
  conv: Record<string, unknown> | null | undefined,
  ctx: ContextoRescate,
  ahoraMs: number,
): MotivoDescarte | '' {
  const c = (typeof conv === 'object' && conv !== null ? conv : {}) as Record<string, unknown>;
  const telefono = c['telefono'];
  if (typeof telefono !== 'string' || !TELEFONO.test(telefono)) return 'telefono_invalido';
  if (ctx.excluidos.has(telefono)) return 'excluido';
  if (ctx.soloTelefonos !== null && !ctx.soloTelefonos.has(telefono)) return 'fuera_de_lista';
  if (c['phoneNumberId'] !== ctx.phoneNumberId) return 'otra_linea';
  if (c['rescate'] !== undefined) return 'ya_rescatado';
  const nc = c['noContactar'];
  if (nc !== undefined && nc !== null && nc !== false) return 'no_contactar';
  const estado = c['atencionEstado'];
  if (estado !== undefined && estado !== 'normal') return 'atencion';
  const ultimoMs = milisegundosDe(c['ultimoEntranteEn']);
  if (ultimoMs === null) return 'sin_ventana';

  // REGLA DEL TURNO. Una persona «estuvo en la conversación» si tomó el turno dentro
  // de las 24 h previas al último mensaje del cliente (`tomadoEn >= ultimoMs - 24 h`,
  // borde inclusive), aunque ya lo haya devuelto; o si la pausa sigue vigente (abajo).
  // Un turno tomado ANTES de esa ventana (p. ej. 30 h antes del último mensaje) y ya
  // devuelto NO bloquea: es de otra conversación. Un turno ilegible bloquea (ante la
  // duda, no se escribe).
  const lectura = leerTurno(c['turno']);
  if (lectura.estado === 'ilegible') return 'tomada';
  if (lectura.estado === 'ok' && lectura.turno.tomadoEn >= ultimoMs - 24 * HORA) return 'tomada';
  if (decidirPausa(c['turno'], c['ultimoEntranteEn'], ahoraMs).pausada) return 'tomada';

  const s = c['solicitud'];
  if (typeof s === 'object' && s !== null) {
    const sol = s as Record<string, unknown>;
    if (typeof sol['etapa'] === 'string' && ETAPAS_DE_COMPRA.has(sol['etapa'])) return 'compro';
    if (typeof sol['cotejos'] === 'number' && sol['cotejos'] > 0) return 'compro';
    // Ya salió un seguimiento de la solicitud (`seguimientosPendientes` de Agenda):
    // no se le escribe una segunda vez por otro camino.
    if ((typeof sol['seguimientos'] === 'number' && sol['seguimientos'] > 0)
      || sol['seguimientoEn'] !== undefined) return 'seguimiento';
  }

  const silencio = ahoraMs - ultimoMs;
  if (silencio < MS_DESDE) return 'temprano';
  if (silencio >= MS_HASTA) return 'tarde';
  return '';
}

const normalizar = (t: string): string =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * De los mensajes recibidos (los últimos `MENSAJES_A_LEER` de las 24 h previas al
 * último entrante, ya filtrados por la consulta): ¿hay un posible comprobante
 * (imagen o documento entrante) o un rechazo explícito (en un texto o en la
 * respuesta de un botón/lista, `interactive`)?, y los textos del cliente para
 * redactar (solo `text`). También filtra por fecha, por si la consulta trae más. PURA.
 */
export function leerMensajesParaRescate(
  mensajes: readonly Record<string, unknown>[],
  ultimoEntranteMs: number,
): { motivo: 'medio' | 'rechazo' | ''; textos: string[] } {
  const desde = ultimoEntranteMs - 24 * HORA;
  const entrantes = mensajes
    .map((m) => ({ m, ts: milisegundosDe(m['ts']) }))
    .filter((x): x is { m: Record<string, unknown>; ts: number } =>
      x.ts !== null && x.ts >= desde && x.m['direccion'] === 'entrante')
    .sort((a, b) => a.ts - b.ts);

  if (entrantes.some((x) => x.m['tipo'] === 'image' || x.m['tipo'] === 'document')) {
    return { motivo: 'medio', textos: [] };
  }
  const delTexto = entrantes
    .filter((x) => x.m['tipo'] === 'text' && typeof x.m['texto'] === 'string')
    .map((x) => x.m['texto'] as string);
  const deBotones = entrantes
    .filter((x) => x.m['tipo'] === 'interactive' && typeof x.m['texto'] === 'string')
    .map((x) => x.m['texto'] as string);
  if ([...delTexto, ...deBotones].some((t) => RECHAZO.test(normalizar(t)))) {
    return { motivo: 'rechazo', textos: [] };
  }
  return { motivo: '', textos: delTexto.slice(-TEXTOS_MAX).map((t) => t.slice(0, LARGO_TEXTO)) };
}

export type CuerpoValido =
  | { ok: true; soloTelefonos: Set<string> | null; excluir: Set<string>; tope: number }
  | { ok: false; error: string };

const CLAVES_ADMITIDAS = new Set(['v', 'soloTelefonos', 'excluir', 'tope']);

function listaDeTelefonos(v: unknown, maximo: number): Set<string> | null {
  if (!Array.isArray(v) || v.length > maximo) return null;
  const s = new Set<string>();
  for (const x of v) {
    if (typeof x !== 'string' || !TELEFONO.test(x)) return null;
    s.add(x);
  }
  return s;
}

/** Valida el cuerpo de la petición. Cualquier cosa fuera del contrato es error. PURA. */
export function validarCuerpo(c: unknown): CuerpoValido {
  const malo = { ok: false, error: 'cuerpo invalido' } as const;
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return malo;
  const o = c as Record<string, unknown>;
  if (Object.keys(o).some((k) => !CLAVES_ADMITIDAS.has(k))) return malo;
  if (o['v'] !== 1) return malo;
  let soloTelefonos: Set<string> | null = null;
  if (o['soloTelefonos'] !== undefined) {
    soloTelefonos = listaDeTelefonos(o['soloTelefonos'], 20);
    if (soloTelefonos === null) return malo;
  }
  let excluir = new Set<string>();
  if (o['excluir'] !== undefined) {
    const e = listaDeTelefonos(o['excluir'], 50);
    if (e === null) return malo;
    excluir = e;
  }
  let tope = TOPE_POR_CORRIDA;
  if (o['tope'] !== undefined) {
    const t = o['tope'];
    if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > TOPE_POR_CORRIDA) return malo;
    tope = t;
  }
  return { ok: true, soloTelefonos, excluir, tope };
}

export const reclamarRescates = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Servidor a servidor, como la ingesta: sin CORS.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // El comercio y la línea salen de la credencial, NUNCA del cuerpo.
    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }
    if (ruta.flujo !== 'venta') { respuesta.status(409).json({ estado: 'flujo_no_admitido' }); return; }

    const cuerpo = validarCuerpo(peticion.body);
    if (!cuerpo.ok) { respuesta.status(400).json({ error: cuerpo.error }); return; }

    const { tenantId, phoneNumberId } = ruta;
    if (cuerpo.soloTelefonos !== null && cuerpo.soloTelefonos.size === 0) {
      respuesta.status(200).json({ phoneNumberId, rescates: [], motivo: 'lista_vacia' });
      return;
    }

    const db = getFirestore();
    const ahoraMs = Date.now();

    const [cuenta, metricas, plataforma, negocio] = await Promise.all([
      db.doc(`tenants/${tenantId}/cuenta/estado`).get(),
      db.doc(`tenants/${tenantId}/metricas/${periodoDe(ahoraMs)}`).get(),
      db.doc('plataforma/prepago').get(),
      db.doc(`tenants/${tenantId}/config/negocio`).get(),
    ]);
    const cuentaCruda = (cuenta.data() ?? {}) as CuentaCruda;
    const servicio = estadoDeServicio(cuentaCruda, consumidasDe(metricas.data()), ahoraMs);
    if (corteAplicable(cuentaCruda, plataforma.data()) && !servicio.operativo) {
      respuesta.status(200).json({ phoneNumberId, rescates: [], motivo: 'servicio_no_operativo' });
      return;
    }

    const excluidos = new Set(cuerpo.excluir);
    const recepcion = negocio.get('numeroRecepcion');
    if (typeof recepcion === 'string') {
      const d = recepcion.replace(/\D/g, '');
      if (TELEFONO.test(d)) {
        excluidos.add(d);
        // En formato local (8 dígitos) también se excluye con el código de país.
        if (d.length === 8) excluidos.add(`591${d}`);
      }
    }
    const ctx: ContextoRescate = { phoneNumberId, excluidos, soloTelefonos: cuerpo.soloTelefonos };

    const colConversaciones = db.collection(`tenants/${tenantId}/conversaciones`);
    const hoy = await colConversaciones
      .where('rescate.enviadoEn', '>=', Timestamp.fromMillis(ahoraMs - 24 * HORA))
      .count().get();
    const enviadosHoy = hoy.data().count;
    const cupo = Math.min(cuerpo.tope, TOPE_POR_CORRIDA, TOPE_DIARIO_POR_COMERCIO - enviadosHoy);
    if (cupo <= 0) {
      respuesta.status(200).json({ phoneNumberId, rescates: [], motivo: 'tope_diario' });
      return;
    }

    // Un solo campo con dos extremos y su orden: índice de campo simple. Se recorre por
    // páginas (cursor) hasta llenar el cupo, agotar la franja o llegar a MAX_PAGINAS.
    const consulta = colConversaciones
      .where('ultimoEntranteEn', '>=', Timestamp.fromMillis(ahoraMs - MS_HASTA))
      .where('ultimoEntranteEn', '<=', Timestamp.fromMillis(ahoraMs - MS_DESDE))
      .orderBy('ultimoEntranteEn', 'asc');

    const rescates: { telefono: string; ultimoEntranteMs: number; textos: string[] }[] = [];
    let fallidas = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
    for (let pagina = 0; pagina < MAX_PAGINAS && rescates.length < cupo; pagina += 1) {
      const candidatas: FirebaseFirestore.QuerySnapshot = await (cursor
        ? consulta.startAfter(cursor) : consulta).limit(TOPE_DE_LECTURA).get();
      if (candidatas.empty) break;
      cursor = candidatas.docs[candidatas.docs.length - 1]!;
      for (const doc of candidatas.docs) {
        if (rescates.length >= cupo) break;
        try {
          const datos = doc.data();
          if (motivoParaNoRescatar(datos, ctx, ahoraMs) !== '') continue;
          const ultimoMs = milisegundosDe(datos['ultimoEntranteEn']);
          if (ultimoMs === null) continue;
          const telefono = datos['telefono'] as string;

          const recientes = await doc.ref.collection('mensajes')
            .where('ts', '>=', Timestamp.fromMillis(ultimoMs - 24 * HORA))
            .orderBy('ts', 'desc').limit(MENSAJES_A_LEER).get();
          const lectura = leerMensajesParaRescate(recientes.docs.map((m) => m.data()), ultimoMs);
          if (lectura.motivo !== '') continue;

          // LA MARCA, ANTES DE ENVIAR: se relee y se vuelve a decidir dentro de la
          // transacción; dos corridas simultáneas no pueden marcar la misma.
          const marcada = await db.runTransaction(async (tx) => {
            const fresco = await tx.get(doc.ref);
            if (!fresco.exists || motivoParaNoRescatar(fresco.data(), ctx, ahoraMs) !== '') return false;
            tx.set(doc.ref, {
              rescate: {
                enviadoEn: Timestamp.fromMillis(ahoraMs),
                phoneNumberId,
                anclaMs: ultimoMs,
              },
            }, { merge: true });
            return true;
          });
          if (!marcada) continue;

          await registrar(tenantId, {
            tipo: 'seguimiento_enviado', resultado: 'ok', telefono,
            conversacionId: `wa_${telefono}`, codigo: 'rescate',
          });
          rescates.push({ telefono, ultimoEntranteMs: ultimoMs, textos: lectura.textos });
        } catch {
          // Ante la duda, no se rescata. Sin teléfono ni texto en el log.
          fallidas += 1;
        }
      }
      if (candidatas.size < TOPE_DE_LECTURA) break;
    }
    if (fallidas > 0) logger.warn('reclamarRescates: candidatas con error', { tenantId, fallidas });

    respuesta.status(200).json({ phoneNumberId, rescates });
  },
);
