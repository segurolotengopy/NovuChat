/**
 * =============================================================================
 * GUARDAR UN MEDIO ENTRANTE (audio, foto, PDF) — 90 días, solo con la bandera
 * =============================================================================
 *
 * DECISIONES DE ANDRES (20, 22 y 23/10/2026):
 *  - Se guardan los medios ENTRANTES 90 días con TTL, también con la
 *    conversación tomada por una persona (D1).
 *  - Topes: imagen 5 MB, audio 16 MB, PDF 10 MB. docx, xlsx y otros: 415 (D6).
 *  - Cupo por comercio y día: 1.000 medios o 2 GB (D5).
 *  - La bandera `guardarMedios` de la ficha se enciende SOLO con el anexo
 *    aceptado y el «sí» de Andres (D3): APAGADA por defecto, y con ella
 *    apagada esta Function no guarda NADA (409).
 *  - Nadie lee el medio por Storage ni por URL: la lectura (PR-2) será una
 *    callable auditada que devuelve BYTES, con tope (D4: soporte no ve medios).
 *
 * POR QUÉ SOLO EL TOKEN. La firma HMAC de `firma.ts` cubre el cuerpo y se niega
 * a más de 64 KB: un audio no puede firmarse. n8n usa el token por número. Una
 * petición que trae `X-NovuChat-Signature` se rechaza antes de mirar nada más.
 *
 * POR QUÉ EXIGE UN MENSAJE. Con un token robado se podría llenar el depósito de
 * cualquier cosa. Por eso solo se guarda un medio que corresponde a un mensaje
 * ENTRANTE ya registrado por la ingesta (mismo `idMeta`, mismo tipo, de hace
 * 30 minutos o menos). El flujo llama a `ingesta` antes que a esta Function.
 *
 * NO ES UN COMPROBANTE. No importa nada de Cobros y no escribe `solicitud`,
 * `cierres`, `comprobantesRecibidos`, `metricas` ni `conteo`: un medio guardado
 * no cambia ningún contador ni mensaje (0 mensajes por conversación).
 *
 * SIN TELÉFONO NI ID DE META EN STORAGE. La ruta es
 * `tenants/{t}/medios/{aaaa-mm-dd La Paz}/{sha256(idMeta)}.{ext}` y los metadatos
 * del objeto no llevan nada. El teléfono viaja en una cabecera solo para ubicar
 * la conversación; en Firestore queda como `conversacionId` (`wa_<tel>`), que ya
 * existe en la propia conversación.
 *
 * COSTO por medio guardado (solo con bandera encendida): lecturas de ruta,
 * ficha, mensaje, registro previo y cupo, más las de la transacción final;
 * escrituras: cupo, registro y marca en el mensaje (3), más el objeto.
 */

import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../seguridad/firma.js';
import {
  DIAS_DE_RETENCION, DIA_MS, ID_TENANT, almacenDeMedios, diaDeLaPaz, idMetaCrudo, nombreDeObjeto, type Almacen,
} from './almacen.js';
import {
  MIMES_ACEPTADOS, TOPE_POR_TIPO, esTipoDeMedio, tipoPorFirma, type ExtensionDeMedio,
} from './tipos.js';

const TELEFONO = /^[0-9]{8,15}$/;
/** El mensaje al que pertenece el medio tiene que ser de hace 30 minutos o menos. */
export const VENTANA_DEL_MENSAJE_MS = 30 * 60_000;
/** Cupo diario por comercio (D5, 23/10/2026). */
export const CUPO_MEDIOS_POR_DIA = 1000;
export const CUPO_BYTES_POR_DIA = 2 * 1024 * 1024 * 1024;

export const rutaDeMedio = (tenantId: string, dia: string, idMeta: string, ext: ExtensionDeMedio): string =>
  `tenants/${tenantId}/medios/${dia}/${nombreDeObjeto(idMeta)}.${ext}`;

export type ResultadoDeGuardar =
  | { codigo: 200; cuerpo: { ruta: string; repetido: boolean } }
  | { codigo: 400 | 409 | 413 | 415 | 429 | 502; cuerpo: { error: string } };

const milis = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

/**
 * El cupo del día, en UNA transacción y ANTES de tocar Storage. `false` si con
 * este medio se pasaría de 1.000 medios o de 2 GB.
 */
async function reservarCupo(tenantId: string, dia: string, tamano: number, ahoraMs: number): Promise<boolean> {
  const db = getFirestore();
  const ref = db.doc(`tenants/${tenantId}/cuposDeMedios/${dia}`);
  return db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    const n = Number(actual.get('n') ?? 0);
    const bytes = Number(actual.get('bytes') ?? 0);
    if (n + 1 > CUPO_MEDIOS_POR_DIA || bytes + tamano > CUPO_BYTES_POR_DIA) return false;
    tx.set(ref, { n: n + 1, bytes: bytes + tamano, vence: Timestamp.fromMillis(ahoraMs + 3 * DIA_MS) }, { merge: true });
    return true;
  });
}

/** Devuelve el cupo si el medio no llegó a guardarse (mejor esfuerzo, nunca lanza). */
async function liberarCupo(tenantId: string, dia: string, tamano: number): Promise<void> {
  const db = getFirestore();
  const ref = db.doc(`tenants/${tenantId}/cuposDeMedios/${dia}`);
  try {
    await db.runTransaction(async (tx) => {
      const actual = await tx.get(ref);
      if (!actual.exists) return;
      tx.update(ref, { n: Math.max(0, Number(actual.get('n') ?? 0) - 1), bytes: Math.max(0, Number(actual.get('bytes') ?? 0) - tamano) });
    });
  } catch { /* el cupo se corrige solo al día siguiente */ }
}

export interface EntradaDeGuardar {
  tenantId: string;
  telefono: string;
  idMeta: string;
  /** Lo que declara la cabecera `X-NovuChat-Tipo`. */
  tipo: unknown;
  bytes: Buffer;
  contentType: string;
}

/** Valida y guarda. Todo lo posterior a la autenticación y a la bandera. Nunca escribe el teléfono en Storage. */
export async function guardarMedioDe(
  e: EntradaDeGuardar, deps: { almacen?: Almacen; ahoraMs?: number } = {},
): Promise<ResultadoDeGuardar> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const almacen = deps.almacen ?? almacenDeMedios();
  const idMeta = idMetaCrudo(e.idMeta);
  if (!TELEFONO.test(e.telefono)) return { codigo: 400, cuerpo: { error: 'telefono_invalido' } };
  if (idMeta === '') return { codigo: 400, cuerpo: { error: 'falta_idmeta' } };
  if (!esTipoDeMedio(e.tipo)) return { codigo: 400, cuerpo: { error: 'tipo_invalido' } };
  const tipo = e.tipo;
  if (e.bytes.length === 0) return { codigo: 400, cuerpo: { error: 'vacio' } };
  if (e.bytes.length > TOPE_POR_TIPO[tipo]) return { codigo: 413, cuerpo: { error: 'demasiado_grande' } };

  // El tipo real sale de los bytes, y tiene que coincidir con la cabecera y con el Content-Type.
  const firma = tipoPorFirma(e.bytes);
  const declarado = String(e.contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!firma || firma.tipo !== tipo || !MIMES_ACEPTADOS[firma.ext].includes(declarado)) {
    return { codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  }

  const db = getFirestore();
  const refConversacion = db.doc(`tenants/${e.tenantId}/conversaciones/wa_${e.telefono}`);

  // Solo se guarda lo que corresponde a un mensaje ENTRANTE reciente del mismo tipo.
  const candidatos = await refConversacion.collection('mensajes').where('idMeta', '==', idMeta).limit(10).get();
  const mensaje = candidatos.docs.find((d) => {
    const ts = milis(d.get('ts'));
    return d.get('direccion') === 'entrante' && d.get('tipo') === tipo
      && ts !== null && ahoraMs - ts <= VENTANA_DEL_MENSAJE_MS && ts <= ahoraMs + 5 * 60_000;
  });
  if (!mensaje) return { codigo: 409, cuerpo: { error: 'sin_mensaje' } };

  // Un repetido responde lo mismo y no reescribe nada (ni gasta cupo).
  const refMedio = db.doc(`tenants/${e.tenantId}/mediosRecibidos/${nombreDeObjeto(idMeta)}`);
  const previo = await refMedio.get();
  if (previo.exists) return { codigo: 200, cuerpo: { ruta: String(previo.get('ruta') ?? ''), repetido: true } };

  const dia = diaDeLaPaz(ahoraMs);
  if (!await reservarCupo(e.tenantId, dia, e.bytes.length, ahoraMs)) {
    return { codigo: 429, cuerpo: { error: 'cupo_diario_lleno' } };
  }

  const ruta = rutaDeMedio(e.tenantId, dia, idMeta, firma.ext);
  try {
    // `ifGenerationMatch: 0`: un medio nunca se sobrescribe. Si ya estaba (un intento anterior que
    // guardó el objeto pero no alcanzó a registrarlo), se sigue al registro sin gastar otro cupo.
    if (await almacen.guardar(ruta, e.bytes, firma.mime) === 'existe') await liberarCupo(e.tenantId, dia, e.bytes.length);
  } catch {
    await liberarCupo(e.tenantId, dia, e.bytes.length);
    return { codigo: 502, cuerpo: { error: 'no_se_guardo' } };
  }

  const vence = Timestamp.fromMillis(ahoraMs + DIAS_DE_RETENCION * DIA_MS);
  try {
    const repetido = await db.runTransaction(async (tx) => {
      if ((await tx.get(refMedio)).exists) return true;
      tx.create(refMedio, {
        idMeta, conversacionId: `wa_${e.telefono}`, tipo, mime: firma.mime, ext: firma.ext,
        tamano: e.bytes.length, sha256: createHash('sha256').update(e.bytes).digest('hex'),
        ruta, en: Timestamp.fromMillis(ahoraMs), vence,
      });
      tx.update(mensaje.ref, { medio: { estado: 'guardado', mime: firma.mime, tamano: e.bytes.length, vence } });
      return false;
    });
    if (repetido) await liberarCupo(e.tenantId, dia, e.bytes.length);
    return { codigo: 200, cuerpo: { ruta, repetido } };
  } catch {
    return { codigo: 502, cuerpo: { error: 'no_se_registro' } };
  }
}

/**
 * Binario en el cuerpo; cabeceras `X-NovuChat-Telefono`, `X-NovuChat-IdMeta`,
 * `X-NovuChat-Tipo` (image|audio|document) y `Content-Type`. Solo el token.
 */
export const guardarMedio = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
    // Hasta 16 MB de audio más el sobre HTTP.
    memory: '512MiB',
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }
    if (peticion.get('X-NovuChat-Signature')) { respuesta.status(401).send('no autorizado'); return; }
    const ruta = await rutaAutenticada({ get: (n: string) => peticion.get(n) });
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    // LA BANDERA. Apagada (o ausente) por defecto: nada se guarda. Se lee de la ficha, que ningún
    // navegador escribe (`allow create, update, delete: if false`): solo el script de plataforma.
    const ficha = ID_TENANT.test(ruta.tenantId) ? await getFirestore().doc(`tenants/${ruta.tenantId}`).get() : null;
    if (!ficha || !ficha.exists || ficha.get('guardarMedios') !== true) {
      respuesta.status(409).json({ error: 'guardado_apagado' }); return;
    }

    const bytes = Buffer.isBuffer(peticion.rawBody) ? peticion.rawBody : Buffer.alloc(0);
    const r = await guardarMedioDe({
      tenantId: ruta.tenantId,
      telefono: String(peticion.get('X-NovuChat-Telefono') ?? '').trim(),
      idMeta: String(peticion.get('X-NovuChat-IdMeta') ?? ''),
      tipo: String(peticion.get('X-NovuChat-Tipo') ?? '').trim().toLowerCase(),
      bytes,
      contentType: String(peticion.get('Content-Type') ?? ''),
    });
    respuesta.status(r.codigo).json(r.cuerpo);
  },
);
