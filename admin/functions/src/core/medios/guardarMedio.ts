/**
 * =============================================================================
 * GUARDAR EL MEDIO ENTRANTE — antes de interpretarlo, para todo tenant
 * =============================================================================
 *
 * EL PROBLEMA QUE CIERRA (Evy, 31 fotos perdidas): el flujo descargaba el
 * medio de Meta, se lo pasaba al modelo y lo descartaba; n8n no guarda
 * ejecuciones y, si el modelo fallaba o el cliente reclamaba, la foto ya no
 * existía en ningún lado. Regla del Core, igual para todos los comercios y
 * todos los canales: **todo medio entrante (imagen, PDF, audio) se guarda en
 * el Storage del comercio ANTES de interpretarlo**, sin exigir un cobro abierto.
 *
 * POR QUÉ UNA FUNCTION NUEVA Y NO RELAJAR `guardarComprobante`. Aquella tiene
 * una barrera de abuso —el 409 «sin cobro pendiente»— que es de Cobros, un
 * módulo: el Core no puede depender de él, y quitarla dejaría el depósito de
 * comprobantes abierto a cualquier cosa. Esta es de otro objeto (cualquier
 * medio) con su propia barrera: el tope diario por comercio.
 *
 * LO QUE SE HEREDA, SIN CAMBIOS, de `guardarComprobante`:
 *  - Solo vale el TOKEN por número. Una firma HMAC no puede cubrir un medio
 *    (`firma.ts` se niega a más de 64 KB), así que si trae `X-NovuChat-Signature`
 *    se rechaza antes de mirar nada más: un solo camino que probar.
 *  - El tipo se decide por los PRIMEROS BYTES, nunca por la cabecera.
 *  - El nombre del objeto es el sha256 del id de Meta; **el teléfono nunca está
 *    en la ruta de Storage ni en un log**: viaja en una cabecera solo para
 *    nombrar la conversación (`wa_<tel>`) en el metadato, igual que
 *    `comprobantesRecibidos`.
 *  - Nunca se sobrescribe (`ifGenerationMatch: 0`).
 *  - Retención de 90 días (purga diaria + TTL del metadato) y borrado entero
 *    con la baja del comercio.
 *
 * LO QUE ES NUEVO:
 *  - Ruta `tenants/{t}/medios/{aaaa-mm-dd La Paz}/{sha256(idMeta)}.{ext}`.
 *  - Audio (ogg, m4a, mp3, amr) además de imagen y PDF; topes por tipo.
 *  - Lo que no se guarda (docx, xlsx, cualquier otro) igual queda ANOTADO con
 *    estado `anotado` y su motivo: el comercio puede saber que el cliente mandó
 *    algo aunque no se conserve.
 *  - `X-NovuChat-Fallo`: si el flujo no pudo ni bajar el medio de Meta, avisa
 *    sin cuerpo y el servidor deja la constancia (`fallo`), que es justo lo que
 *    faltó el día de las 31 fotos.
 *  - Tope diario por comercio contra abuso (`TOPE_DIARIO_DE_MEDIOS`).
 *
 * NO EXIGE que la ingesta ya tenga el mensaje: el flujo guarda el medio apenas
 * llega, antes (y sin depender) de que se registre el turno.
 *
 * Esta pieza no manda ningún mensaje al cliente: costo 0 por conversación.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../seguridad/firma.js';
import {
  ID_TENANT, MB, almacenDeStorage, diaDeLaPaz, idMetaCrudo, nombreDeObjeto, purgarPorRetencion, tipoDeMedioPorFirma,
  type Almacen, type ResultadoDePurga, type TipoDeMedio,
} from './almacen.js';

/** Topes por tipo, medidos sobre los bytes reales (no sobre lo que diga quien sube). */
export const MAXIMO_IMAGEN_MEDIO = 5 * MB;
export const MAXIMO_PDF_MEDIO = 10 * MB;
/** El tope de un audio de WhatsApp (16 MB en la Cloud API). */
export const MAXIMO_AUDIO_MEDIO = 16 * MB;
/** Cuántos días se conserva un medio. */
export const DIAS_DE_RETENCION_DE_MEDIOS = 90;

/**
 * Cuántos medios acepta POR DÍA (La Paz) un mismo comercio. Es una barrera
 * CONTRA ABUSO —un token filtrado no debe servir para llenar el depósito—, no
 * un límite comercial. El margen es amplio a propósito: un comercio muy ocupado
 * recibe cientos de medios al día, y rechazar a un cliente real por un tope
 * apretado es peor que tolerar un abuso acotado. Se cuenta en una transacción
 * sobre `topesDeMedios/{comercio}_{día}`.
 */
export const TOPE_DIARIO_DE_MEDIOS = 3000;
/**
 * Cuántas constancias de «tope superado» se anotan por comercio y día: sin este
 * freno, el abusador que ya pasó el tope seguiría escribiendo un metadato por
 * petición.
 */
export const MAX_ANOTACIONES_DE_TOPE = 50;

const TELEFONO = /^[0-9]{8,15}$/;
const DIA_MS = 86_400_000;

// ---------------------------------------------------------------------------
// EL ALMACÉN (inyectable en las pruebas)
// ---------------------------------------------------------------------------

let almacenDePrueba: Almacen | null = null;
/** Solo con `MEDIOS_DOBLE` en el entorno: en producción no hay cómo sustituirlo. */
export function fijarAlmacenDeMediosDePrueba(a: Almacen | null): void {
  if (!process.env['MEDIOS_DOBLE']) throw new Error('fijarAlmacenDeMediosDePrueba exige MEDIOS_DOBLE en el entorno');
  almacenDePrueba = a;
}
export const almacenDeMedios = (): Almacen => almacenDePrueba ?? almacenDeStorage;

export const rutaDeMedio = (tenantId: string, dia: string, idMeta: string, ext: string): string =>
  `tenants/${tenantId}/medios/${dia}/${nombreDeObjeto(idMeta)}.${ext}`;

// ---------------------------------------------------------------------------
// EL VEREDICTO (puro)
// ---------------------------------------------------------------------------

/** Los tipos declarados que se aceptan para cada firma real. */
const DECLARADOS: Record<string, readonly string[]> = {
  jpg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  ogg: ['audio/ogg', 'application/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac'],
  mp3: ['audio/mpeg', 'audio/mp3'],
  amr: ['audio/amr', 'audio/3gpp'],
};

const mimeDeclarado = (t: unknown): string => String(t ?? '').split(';')[0]?.trim().toLowerCase().slice(0, 100) ?? '';
/** ¿Declara algo que SÍ se guardaría (imagen, PDF o audio)? Entonces los bytes tienen que cumplirlo. */
const declaraGuardable = (mime: string): boolean => mime.startsWith('image/') || mime.startsWith('audio/') || mime === 'application/pdf';
const tipoDeclarado = (mime: string): string => (mime.startsWith('image/') ? 'imagen' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' ? 'pdf' : 'otro');

const maximoDe = (t: TipoDeMedio): number => (t === 'imagen' ? MAXIMO_IMAGEN_MEDIO : t === 'pdf' ? MAXIMO_PDF_MEDIO : MAXIMO_AUDIO_MEDIO);

export type Veredicto =
  | { estado: 'guardado'; codigo: 200; tipo: TipoDeMedio; mime: string; ext: string }
  | { estado: 'fallo' | 'anotado'; codigo: 200 | 400 | 413 | 415; motivo: string; tipo: string; mime: string };

/** Decide, sin tocar nada, qué se hace con estos bytes. */
export function veredictoDe(bytes: Buffer, declarado: unknown, hayCabeceraDeFallo: boolean, motivoDelFlujo: string): Veredicto {
  const mime = mimeDeclarado(declarado);
  if (bytes.length === 0) {
    if (hayCabeceraDeFallo) return { estado: 'fallo', codigo: 200, motivo: motivoDelFlujo, tipo: tipoDeclarado(mime), mime };
    return { estado: 'fallo', codigo: 400, motivo: 'vacio', tipo: tipoDeclarado(mime), mime };
  }
  if (bytes.length > MAXIMO_AUDIO_MEDIO) {
    return { estado: 'fallo', codigo: 413, motivo: 'demasiado_grande', tipo: tipoDeclarado(mime), mime };
  }
  const real = tipoDeMedioPorFirma(bytes);
  if (!real) {
    // Bytes que no son de un tipo que se guarde. Si DECLARABAN serlo (una imagen
    // que no lo es) es un engaño o un archivo roto: fallo. Si declaran otra cosa
    // (docx, xlsx...) simplemente no se guarda: se anota.
    if (declaraGuardable(mime)) return { estado: 'fallo', codigo: 415, motivo: 'tipo_no_coincide', tipo: tipoDeclarado(mime), mime };
    return { estado: 'anotado', codigo: 200, motivo: 'tipo_no_admitido', tipo: 'otro', mime };
  }
  if (!(DECLARADOS[real.ext] ?? []).includes(mime)) {
    return { estado: 'fallo', codigo: 415, motivo: 'tipo_no_coincide', tipo: real.tipo, mime };
  }
  if (bytes.length > maximoDe(real.tipo)) {
    return { estado: 'fallo', codigo: 413, motivo: 'demasiado_grande', tipo: real.tipo, mime: real.mime };
  }
  return { estado: 'guardado', codigo: 200, tipo: real.tipo, mime: real.mime, ext: real.ext };
}

// ---------------------------------------------------------------------------
// EL TRABAJO
// ---------------------------------------------------------------------------

export interface EntradaDeMedio {
  tenantId: string;
  /** Solo para nombrar la conversación (`wa_<tel>`) en el metadato: nunca a Storage ni a un log. */
  telefono: string;
  idMeta: string;
  bytes: Buffer;
  contentType: unknown;
  hayCabeceraDeFallo: boolean;
  motivoDelFlujo: string;
}

export type ResultadoDeMedio =
  | { codigo: 200; cuerpo: { estado: 'guardado' | 'anotado' | 'fallo'; ruta?: string; repetido?: true } }
  | { codigo: 400 | 413 | 415 | 429 | 502; cuerpo: { error: string } };

const refDelMedio = (tenantId: string, idMeta: string) =>
  getFirestore().doc(`tenants/${tenantId}/mediosRecibidos/${nombreDeObjeto(idMeta)}`);

/** El metadato. Mismo modelo que `comprobantesRecibidos`: nunca el teléfono ni el contenido. */
function documentoDe(e: EntradaDeMedio, ahoraMs: number, datos: {
  estado: 'guardado' | 'fallo' | 'anotado'; tipo: string; mime: string; ruta: string | null; motivo: string | null;
}): Record<string, unknown> {
  return {
    conversacionId: `wa_${e.telefono}`, idMeta: idMetaCrudo(e.idMeta), tipo: datos.tipo, mime: datos.mime,
    tamano: e.bytes.length, ruta: datos.ruta, estado: datos.estado, motivo: datos.motivo,
    en: Timestamp.fromMillis(ahoraMs), vence: Timestamp.fromMillis(ahoraMs + DIAS_DE_RETENCION_DE_MEDIOS * DIA_MS),
  };
}

/**
 * Reserva un lugar del tope diario. `'tope'` si ya se alcanzó (y, hasta
 * `MAX_ANOTACIONES_DE_TOPE` veces por día, deja la constancia en el mismo acto).
 */
async function reservarCupo(e: EntradaDeMedio, dia: string, ahoraMs: number, veredicto: Veredicto): Promise<'ok' | 'tope'> {
  const db = getFirestore();
  const contador = db.doc(`topesDeMedios/${e.tenantId}_${dia}`);
  return db.runTransaction(async (tx) => {
    const actual = await tx.get(contador);
    const n = Number(actual.get('n') ?? 0);
    const rechazados = Number(actual.get('rechazados') ?? 0);
    // El contador se borra solo (TTL): dos días alcanzan para cubrir el cambio de día.
    const vence = Timestamp.fromMillis(ahoraMs + 2 * DIA_MS);
    if (n >= TOPE_DIARIO_DE_MEDIOS) {
      if (rechazados < MAX_ANOTACIONES_DE_TOPE) {
        tx.set(contador, { n, rechazados: rechazados + 1, vence }, { merge: true });
        tx.set(refDelMedio(e.tenantId, e.idMeta), documentoDe(e, ahoraMs, {
          estado: 'fallo', tipo: veredicto.tipo, mime: veredicto.mime, ruta: null, motivo: 'tope_diario',
        }));
      }
      return 'tope' as const;
    }
    tx.set(contador, { n: n + 1, rechazados, vence }, { merge: true });
    return 'ok' as const;
  });
}

/**
 * Valida, reserva cupo y guarda. Pura salvo Firestore y el almacén. El tenant
 * ya viene autenticado por la ruta. Idempotente por `idMeta`: un medio ya
 * guardado responde lo mismo sin tocar Storage ni gastar cupo.
 */
export async function registrarMedio(
  e: EntradaDeMedio, deps: { almacen?: Almacen; ahoraMs?: number } = {},
): Promise<ResultadoDeMedio> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const almacen = deps.almacen ?? almacenDeMedios();
  const ref = refDelMedio(e.tenantId, e.idMeta);

  // El repetido (Meta reintenta; n8n también): ya guardado, no se vuelve a hacer nada.
  const previo = await ref.get();
  if (previo.get('estado') === 'guardado') {
    return { codigo: 200, cuerpo: { estado: 'guardado', ruta: previo.get('ruta') as string, repetido: true } };
  }

  const dia = diaDeLaPaz(ahoraMs);
  const v = veredictoDe(e.bytes, e.contentType, e.hayCabeceraDeFallo, e.motivoDelFlujo);
  if (await reservarCupo(e, dia, ahoraMs, v) === 'tope') return { codigo: 429, cuerpo: { error: 'tope_diario' } };

  if (v.estado !== 'guardado') {
    // Se anota lo que no se guarda: el comercio sabe que el cliente mandó algo.
    await ref.set(documentoDe(e, ahoraMs, { estado: v.estado, tipo: v.tipo, mime: v.mime, ruta: null, motivo: v.motivo }));
    if (v.codigo === 200) return { codigo: 200, cuerpo: { estado: v.estado } };
    return { codigo: v.codigo, cuerpo: { error: v.motivo } };
  }

  const ruta = rutaDeMedio(e.tenantId, dia, e.idMeta, v.ext);
  try {
    await almacen.guardar(ruta, e.bytes, v.mime);
  } catch (error) {
    // Solo el código: el mensaje puede traer la ruta.
    const codigo = (error as { code?: unknown } | null)?.code;
    console.error(`registrarMedio: Storage falló (código ${typeof codigo === 'string' || typeof codigo === 'number' ? codigo : 'desconocido'})`);
    await ref.set(documentoDe(e, ahoraMs, { estado: 'fallo', tipo: v.tipo, mime: v.mime, ruta: null, motivo: 'storage' })).catch(() => undefined);
    return { codigo: 502, cuerpo: { error: 'no_se_guardo' } };
  }
  await ref.set(documentoDe(e, ahoraMs, { estado: 'guardado', tipo: v.tipo, mime: v.mime, ruta, motivo: null }));
  return { codigo: 200, cuerpo: { estado: 'guardado', ruta } };
}

// ---------------------------------------------------------------------------
// POST guardarMedio
// ---------------------------------------------------------------------------

/**
 * Binario en el cuerpo; cabeceras `X-NovuChat-Telefono`, `X-NovuChat-IdMeta` y
 * `Content-Type`, más `X-NovuChat-Numero` y el token (`Authorization`). Sin
 * cuerpo y con `X-NovuChat-Fallo: <motivo>`: solo anota que el flujo no pudo
 * bajar el medio.
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
    // SOLO VALE EL TOKEN (ver arriba): una firma se rechaza antes de mirar nada más.
    if (peticion.get('X-NovuChat-Signature')) { respuesta.status(401).send('no autorizado'); return; }
    // Sin `rawBody`: el límite de 64 KB de `rutaAutenticada` es del camino de la firma.
    const ruta = await rutaAutenticada({ get: (n: string) => peticion.get(n) });
    if (!ruta || !ID_TENANT.test(ruta.tenantId)) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const telefono = String(peticion.get('X-NovuChat-Telefono') ?? '').trim();
    const idMeta = idMetaCrudo(peticion.get('X-NovuChat-IdMeta'));
    if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }
    if (idMeta === '') { respuesta.status(400).json({ error: 'falta_idmeta' }); return; }
    const cabeceraDeFallo = peticion.get('X-NovuChat-Fallo');
    const bytes = Buffer.isBuffer(peticion.rawBody) ? peticion.rawBody : Buffer.alloc(0);
    // El motivo del flujo se limpia: es texto de afuera que se guarda.
    const motivo = String(cabeceraDeFallo ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'sin_descripcion';

    const r = await registrarMedio({
      tenantId: ruta.tenantId, telefono, idMeta, bytes, contentType: peticion.get('Content-Type'),
      hayCabeceraDeFallo: cabeceraDeFallo !== undefined && cabeceraDeFallo !== null, motivoDelFlujo: motivo,
    });
    respuesta.status(r.codigo).json(r.cuerpo);
  },
);

// ---------------------------------------------------------------------------
// LA PURGA DIARIA
// ---------------------------------------------------------------------------

/** Borra a los 91 días (90 se conserva) y todo con la baja del comercio. */
export async function purgarMediosDe(deps: { almacen?: Almacen; ahoraMs?: number } = {}): Promise<ResultadoDePurga> {
  return purgarPorRetencion({
    almacen: deps.almacen ?? almacenDeMedios(), ahoraMs: deps.ahoraMs ?? Date.now(),
    carpeta: 'medios', coleccionRecibidos: 'mediosRecibidos', dias: DIAS_DE_RETENCION_DE_MEDIOS, etiqueta: 'medios',
  });
}

/** Todos los días a las 03:45 de La Paz, después de la purga de comprobantes (03:30). */
export const purgarMedios = onSchedule(
  { schedule: '45 3 * * *', timeZone: 'America/La_Paz', region: REGION, timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const r = await purgarMediosDe();
    console.info(`purga de medios: ${JSON.stringify(r)}`);
  },
);
