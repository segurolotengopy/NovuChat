/**
 * =============================================================================
 * GUARDAR UN MEDIO ENTRANTE (imagen, audio, video, documento) — 90 días, con bandera
 * =============================================================================
 *
 * DECISIONES DE ANDRES (20, 22 y 23/10/2026):
 *  - Se guardan los medios ENTRANTES 90 días con TTL, también con la
 *    conversación tomada por una persona (D1).
 *  - GUARDAR TODO (contrato de medios v2, 30/10/2026): imagen ≤5 MB, audio ≤16 MB, video ≤16 MB
 *    y documentos de CUALQUIER tipo ≤16 MB. Imagen, audio y video se verifican por firma (415 si
 *    los bytes contradicen la categoría); un documento se guarda siempre, con la extensión y el
 *    mime de `documentoPorFirma` (lista cerrada; lo desconocido es `bin`/octet-stream).
 *  - El modo ANOTAR (docx/xlsx sin bytes, 29/10/2026) se MANTIENE por compatibilidad con los
 *    flujos publicados; se quita en un PR aparte cuando se republiquen.
 *  - TOPES DIARIOS (aprobados por Andres el 30/10/2026; bloque «TOPES» de abajo): por comercio
 *    3.000 medios y 3 GiB; por teléfono 100 medios y 500 MiB. Pasado un tope, se deja constancia
 *    en el contador a lo sumo 50 veces por día; después, ni eso.
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
 * POR QUÉ EXIGE UN MENSAJE. Solo se guarda un medio que corresponde a un mensaje
 * ENTRANTE ya registrado por la ingesta (mismo `idMeta`, mismo tipo, de hace
 * 30 minutos o menos); el flujo llama a `ingesta` antes que a esta Function. Eso
 * ata cada medio a una conversación, pero NO FRENA UN TOKEN ROBADO: con el mismo
 * token, la ingesta acepta un `idMeta` cualquiera, así que quien lo tenga puede
 * registrar el mensaje y luego el medio. La barrera real contra llenar el
 * depósito son los TOPES DIARIOS (por comercio y por teléfono), y la alerta
 * sobre `cuposDeMedios.bytes` (docs/arquitectura/core.md).
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
 * ficha, mensaje, y marcador y cupo en la transacción de reserva; escrituras:
 * cupo y marcador (reserva), y marcador y mensaje (cierre), más el objeto.
 * Un medio ANOTADO: las mismas lecturas y UNA transacción con contador, metadato
 * y mensaje; sin Storage.
 */

import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { FieldPath, FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../seguridad/firma.js';
import {
  CARPETA_DE_DIA, DIAS_DE_RETENCION, DIA_MS, ID_TENANT, almacenDeMedios, diaDeLaPaz, idMetaCrudo, nombreDeObjeto, type Almacen,
} from './almacen.js';
import {
  MB, TIPOS_DE_MENSAJE, contentTypeDeObjeto, esTipoDeMedio, mimeDeclarado, veredictoDe, veredictoDeAnotar, type ExtensionDeMedio,
} from './tipos.js';

const TELEFONO = /^[0-9]{8,15}$/;
/** El mensaje al que pertenece el medio tiene que ser de hace 30 minutos o menos. */
export const VENTANA_DEL_MENSAJE_MS = 30 * 60_000;
// ---------------------------------------------------------------------------
// TOPES DIARIOS — EL ÚNICO LUGAR donde viven (aprobados por Andres el 30/10/2026, contrato de
// medios v2 §7.4 y §8). Son constantes de SEGURIDAD y de costo de almacenamiento, NO límites
// comerciales de plan: no se venden ni cambian por plan, existen para que un token filtrado o un
// cliente que manda archivos sin parar no llenen el depósito (docs/arquitectura/limites.md).
// Se cuentan por día de La Paz, en el contador `cuposDeMedios/{día}`, en la MISMA transacción.
// ---------------------------------------------------------------------------
const GiB = 1024 * MB;
/**
 * Medios (guardados o anotados) por comercio y día. Barrera CONTRA ABUSO, no límite comercial: un
 * comercio muy ocupado recibe cientos de medios al día, y rechazar a un cliente real por un tope
 * apretado es peor que tolerar un abuso acotado.
 */
export const TOPE_DIARIO_DE_MEDIOS = 3000;
/**
 * Bytes por comercio y día: 3 GiB (bajó de 15 GiB el 30/10/2026, adenda §7.4). Con documentos y
 * videos de 16 MB, 3 GiB son ~190 archivos máximos al día; 270 GiB en los 90 días de retención como
 * peor caso por comercio.
 */
export const TOPE_DIARIO_DE_BYTES = 3 * GiB;
/** Medios por TELÉFONO y día: 100. Frena a un solo cliente (o a un token) que manda sin parar. */
export const TOPE_DIARIO_POR_TELEFONO = 100;
/** Bytes por TELÉFONO y día: 500 MiB. */
export const TOPE_DIARIO_DE_BYTES_POR_TELEFONO = 500 * MB;
/**
 * Cuántas veces por comercio y día se deja constancia de «tope superado» (en el propio contador,
 * campos `rechazados` y `ultimoRechazo`). Sin este freno, un abusador que ya pasó el tope seguiría
 * provocando una escritura por petición; pasadas 50, el 429 sale sin escribir nada.
 */
export const MAX_ANOTACIONES_DE_TOPE = 50;
/** El contador del día se borra solo (TTL) a los 2 días: alcanza para cubrir el cambio de día. */
export const DIAS_DEL_CONTADOR = 2;

/**
 * La clave del teléfono en el contador del día (`cuposDeMedios/{día}.telefonos.{clave}`): un hash, no el
 * número, para que el contador no sea una lista de teléfonos a simple vista. Empieza con `t` (nunca con
 * un dígito). Es un SEUDÓNIMO, no un secreto: un número de teléfono tiene pocas cifras y el sha256
 * truncado se revierte por fuerza bruta. Alcanza porque `cuposDeMedios` está cerrado a todo cliente
 * (`allow read, write: if false`); si alguna vez se abre su lectura, la clave pasa a ser un HMAC con
 * un secreto del servidor.
 */
export const claveDeTelefono = (telefono: string): string =>
  `t${createHash('sha256').update(`telefono:${telefono}`).digest('base64url').slice(0, 22)}`;

export const rutaDeMedio = (tenantId: string, dia: string, idMeta: string, ext: ExtensionDeMedio): string =>
  `tenants/${tenantId}/medios/${dia}/${nombreDeObjeto(idMeta)}.${ext}`;

export type ResultadoDeGuardar =
  | { codigo: 200; cuerpo: { ruta: string; repetido: boolean } }
  | { codigo: 200; cuerpo: { anotado: true; repetido: boolean } }
  | { codigo: 400 | 409 | 413 | 415 | 429 | 502; cuerpo: { error: string } };

const milis = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

/** Máximo que un marcador `pendiente` se considera «en vuelo»; pasado, se retoma. */
const PENDIENTE_MAXIMO_MS = 5 * 60_000;

/** El día (`aaaa-mm-dd`) de una ruta `tenants/{t}/medios/{día}/...` de ESTE comercio, o `null`. */
export function diaDeRuta(ruta: unknown, tenantId: string): string | null {
  const prefijo = `tenants/${tenantId}/medios/`;
  if (typeof ruta !== 'string' || !ruta.startsWith(prefijo)) return null;
  const dia = ruta.slice(prefijo.length).split('/')[0] ?? '';
  return CARPETA_DE_DIA.test(dia) ? dia : null;
}

/** Solo el código del error de Firestore o Storage: nunca el mensaje, que puede traer la ruta con el teléfono. */
const codigoDe = (error: unknown): string => {
  const c = (error as { code?: unknown } | null)?.code;
  return typeof c === 'string' || typeof c === 'number' ? String(c) : 'desconocido';
};
/** ABORTED (10): la transacción perdió contra otra, aun tras los reintentos del SDK. */
const esContencion = (error: unknown): boolean => {
  const c = codigoDe(error).toLowerCase();
  return c === '10' || c === 'aborted';
};
function avisarFallo(etapa: string, error: unknown): void {
  console.error(`guardarMedio: falló ${etapa} (código ${codigoDe(error)})`);
}

/**
 * Si Storage falló: borra el marcador pendiente y devuelve el cupo, en UNA transacción y solo si el
 * marcador sigue pendiente (así el cupo vuelve exactamente una vez). El cupo vuelve al contador del DÍA
 * EN QUE SE RESERVÓ (la carpeta de la ruta del marcador), no al de hoy: un pendiente retomado pasada la
 * medianoche de La Paz no debe descontar del día nuevo. Y vuelve lo que se reservó (el `tamano` del
 * marcador). Mejor esfuerzo, nunca lanza.
 */
async function deshacerReserva(
  db: FirebaseFirestore.Firestore, tenantId: string, refMedio: FirebaseFirestore.DocumentReference,
): Promise<void> {
  try {
    await db.runTransaction(async (tx) => {
      const m = await tx.get(refMedio);
      if (!m.exists || m.get('estado') !== 'pendiente') return;
      const dia = diaDeRuta(m.get('ruta'), tenantId);
      const refCupo = dia ? db.doc(`tenants/${tenantId}/cuposDeMedios/${dia}`) : null;
      const c = refCupo ? await tx.get(refCupo) : null;
      const reservado = Math.max(0, Number(m.get('tamano') ?? 0) || 0);
      tx.delete(refMedio);
      if (refCupo && c?.exists) {
        const cambios: Record<string, number> = {
          n: Math.max(0, Number(c.get('n') ?? 0) - 1), bytes: Math.max(0, Number(c.get('bytes') ?? 0) - reservado),
        };
        // El cupo del teléfono vuelve solo si el contador lo tiene (un marcador anterior a los topes por
        // teléfono no lo reservó): nunca se crea una entrada negativa.
        const conversacion = String(m.get('conversacionId') ?? '');
        const clave = conversacion.startsWith('wa_') ? claveDeTelefono(conversacion.slice(3)) : null;
        const delTel = clave ? c.get(new FieldPath('telefonos', clave)) as { n?: unknown; bytes?: unknown } | undefined : undefined;
        if (clave && delTel && typeof delTel === 'object') {
          tx.update(refCupo, 'n', cambios['n'], 'bytes', cambios['bytes'], new FieldPath('telefonos', clave), {
            n: Math.max(0, Number(delTel.n ?? 0) - 1), bytes: Math.max(0, Number(delTel.bytes ?? 0) - reservado),
          });
        } else {
          tx.update(refCupo, cambios);
        }
      }
    });
  } catch (error) { avisarFallo('al devolver el cupo', error); /* el marcador caduca por TTL en un día */ }
}

export interface EntradaDeGuardar {
  tenantId: string;
  telefono: string;
  idMeta: string;
  /** Lo que declara la cabecera `X-NovuChat-Tipo`. */
  tipo: unknown;
  bytes: Buffer;
  contentType: string;
  /** `X-NovuChat-Anotar: 1`: docx/xlsx, sin bytes. */
  anotar?: boolean;
  /** `X-NovuChat-Mime`: el mime que declara Meta (en modo anotar, obligatorio; al guardar, manda sobre el Content-Type). */
  mime?: string;
}

/** Valida y guarda. Todo lo posterior a la autenticación y a la bandera. Nunca escribe el teléfono en Storage. */
export async function guardarMedioDe(
  e: EntradaDeGuardar, deps: { almacen?: Almacen; ahoraMs?: number; db?: FirebaseFirestore.Firestore } = {},
): Promise<ResultadoDeGuardar> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  const almacen = deps.almacen ?? almacenDeMedios();
  const idMeta = idMetaCrudo(e.idMeta);
  if (!TELEFONO.test(e.telefono)) return { codigo: 400, cuerpo: { error: 'telefono_invalido' } };
  if (idMeta === '') return { codigo: 400, cuerpo: { error: 'falta_idmeta' } };
  if (!esTipoDeMedio(e.tipo)) return { codigo: 400, cuerpo: { error: 'tipo_invalido' } };
  const tipo = e.tipo;

  // Qué se hace con esto, sin tocar nada todavía: guardar (los bytes deciden el tipo, y tiene que
  // coincidir con la cabecera y con el Content-Type) o anotar (docx/xlsx, sin bytes).
  // `mime` es el VERIFICADO (el de la firma, o el de `documentoPorFirma` para un documento); el objeto de
  // Storage de un documento se escribe igual con `application/octet-stream` (`contentTypeDeObjeto`).
  let medio: { estado: 'guardado'; ext: ExtensionDeMedio; mime: string } | { estado: 'anotado'; ext: 'docx' | 'xlsx'; mime: string };
  if (e.anotar) {
    const v = veredictoDeAnotar(e.bytes, tipo, e.mime);
    if (!v.ok) return { codigo: v.codigo, cuerpo: v.cuerpo };
    medio = { estado: 'anotado', ext: v.ext, mime: v.mime };
  } else {
    // El mime DECLARADO es `X-NovuChat-Mime` (el que declara Meta) si viene con forma de mime; si no, el
    // Content-Type. Así n8n puede mandar `application/octet-stream` como Content-Type de TRANSPORTE
    // (el framework parsea JSON, texto y formularios ANTES de este código; ver `opcionesDeGuardarMedio`)
    // sin perder el mime para `documentoPorFirma`.
    const declarado = mimeDeclarado(e.mime) !== '' ? e.mime : e.contentType;
    const v = veredictoDe(e.bytes, tipo, declarado);
    if (!v.ok) return { codigo: v.codigo, cuerpo: v.cuerpo };
    medio = { estado: 'guardado', ext: v.firma.ext, mime: v.firma.mime };
  }

  const db = deps.db ?? getFirestore();

  // Solo se guarda lo que corresponde a un mensaje ENTRANTE reciente del mismo tipo (un sticker
  // registrado como `sticker` corresponde a `image`: `TIPOS_DE_MENSAJE`).
  let candidatos: FirebaseFirestore.QuerySnapshot;
  try {
    candidatos = await db.collection(`tenants/${e.tenantId}/conversaciones/wa_${e.telefono}/mensajes`)
      .where('idMeta', '==', idMeta).limit(10).get();
  } catch (error) {
    avisarFallo('la consulta del mensaje', error);
    return { codigo: 502, cuerpo: { error: 'no_se_registro' } };
  }
  const mensaje = candidatos.docs.find((d) => {
    const ts = milis(d.get('ts'));
    return d.get('direccion') === 'entrante' && TIPOS_DE_MENSAJE[tipo].includes(String(d.get('tipo')))
      && ts !== null && ahoraMs - ts <= VENTANA_DEL_MENSAJE_MS && ts <= ahoraMs + 5 * 60_000;
  });
  if (!mensaje) return { codigo: 409, cuerpo: { error: 'sin_mensaje' } };

  const refMedio = db.doc(`tenants/${e.tenantId}/mediosRecibidos/${nombreDeObjeto(idMeta)}`);
  const dia = diaDeLaPaz(ahoraMs);
  const refCupo = db.doc(`tenants/${e.tenantId}/cuposDeMedios/${dia}`);
  const vence = Timestamp.fromMillis(ahoraMs + DIAS_DE_RETENCION * DIA_MS);
  const venceContador = Timestamp.fromMillis(ahoraMs + DIAS_DEL_CONTADOR * DIA_MS);
  const tamano = e.bytes.length;
  const clave = claveDeTelefono(e.telefono);

  // LA DEDUPLICACIÓN Y EL CUPO SON UNA SOLA TRANSACCIÓN (revisión de seguridad del #617). El marcador
  // `mediosRecibidos/{hash}` nace `pendiente` en la MISMA transacción que reserva el cupo: de varias
  // peticiones simultáneas con el mismo idMeta solo UNA lo crea y gasta cupo; las demás ven el marcador.
  // El cupo se devuelve a lo sumo UNA vez, y solo por la petición que lo reservó.
  type Decision =
    | { t: 'repetido'; ruta: string } | { t: 'repetido_anotado' } | { t: 'en_curso' } | { t: 'lleno' } | { t: 'lleno_telefono' }
    | { t: 'reservado' } | { t: 'tomar'; ruta: string } | { t: 'anotado' };
  let decision: Decision;
  try {
  decision = await db.runTransaction(async (tx): Promise<Decision> => {
    const [previo, cupo] = await Promise.all([tx.get(refMedio), tx.get(refCupo)]);
    if (previo.exists) {
      const estadoPrevio = previo.get('estado');
      if (estadoPrevio === 'anotado') return { t: 'repetido_anotado' };
      if (estadoPrevio !== 'pendiente') return { t: 'repetido', ruta: String(previo.get('ruta') ?? '') };
      // Un pendiente reciente es otra petición en vuelo; uno viejo es de una instancia que murió: se retoma
      // (su cupo ya está reservado, no se cobra otra vez).
      const desde = milis(previo.get('en'));
      if (desde !== null && ahoraMs - desde < PENDIENTE_MAXIMO_MS) return { t: 'en_curso' };
      if (medio.estado === 'anotado') return { t: 'en_curso' };
      // Si el reintento trae MÁS bytes que los reservados, la diferencia se cobra aquí, en el contador
      // del día de la reserva (comercio y teléfono) y con los mismos topes (revisión de seguridad de
      // #709): si no, un pendiente viejo sería una puerta para guardar 16 MB habiendo reservado 1 byte.
      // Si trae menos, no se devuelve nada (el contador sigue sobrestimando, que es el lado seguro).
      const reservado = Math.max(0, Number(previo.get('tamano') ?? 0) || 0);
      const diferencia = tamano - reservado;
      if (diferencia > 0) {
        const diaR = diaDeRuta(previo.get('ruta'), e.tenantId) ?? dia;
        const refR = db.doc(`tenants/${e.tenantId}/cuposDeMedios/${diaR}`);
        const cR = diaR === dia ? cupo : await tx.get(refR);
        const telR = (cR.get(new FieldPath('telefonos', clave)) ?? {}) as { bytes?: unknown };
        if (Number(cR.get('bytes') ?? 0) + diferencia > TOPE_DIARIO_DE_BYTES) return { t: 'lleno' };
        if ((Number(telR.bytes ?? 0) || 0) + diferencia > TOPE_DIARIO_DE_BYTES_POR_TELEFONO) return { t: 'lleno_telefono' };
        tx.set(refR, {
          bytes: FieldValue.increment(diferencia), telefonos: { [clave]: { bytes: FieldValue.increment(diferencia) } },
          ...(cR.exists ? {} : { vence: venceContador }),
        }, { merge: true });
        tx.update(refMedio, { en: Timestamp.fromMillis(ahoraMs), tamano });
      } else {
        tx.update(refMedio, { en: Timestamp.fromMillis(ahoraMs) });
      }
      return { t: 'tomar', ruta: String(previo.get('ruta') ?? '') };
    }
    const n = Number(cupo.get('n') ?? 0);
    const bytes = Number(cupo.get('bytes') ?? 0);
    const delTel = (cupo.get(new FieldPath('telefonos', clave)) ?? {}) as { n?: unknown; bytes?: unknown };
    const nTel = Number(delTel.n ?? 0) || 0;
    const bytesTel = Number(delTel.bytes ?? 0) || 0;
    const llenoComercio = n + 1 > TOPE_DIARIO_DE_MEDIOS || bytes + tamano > TOPE_DIARIO_DE_BYTES;
    const llenoTelefono = nTel + 1 > TOPE_DIARIO_POR_TELEFONO || bytesTel + tamano > TOPE_DIARIO_DE_BYTES_POR_TELEFONO;
    if (llenoComercio || llenoTelefono) {
      // La constancia de «tope superado» va en el propio contador y está acotada: pasadas
      // MAX_ANOTACIONES_DE_TOPE, el 429 sale sin escribir nada. Un rechazo no gasta cupo.
      const rechazados = Number(cupo.get('rechazados') ?? 0);
      if (rechazados < MAX_ANOTACIONES_DE_TOPE) {
        tx.set(refCupo, {
          n, bytes, rechazados: rechazados + 1, ultimoRechazo: Timestamp.fromMillis(ahoraMs), vence: venceContador,
        }, { merge: true });
      }
      return llenoComercio ? { t: 'lleno' } : { t: 'lleno_telefono' };
    }
    tx.set(refCupo, {
      n: n + 1, bytes: bytes + tamano, vence: venceContador,
      telefonos: { [clave]: { n: nTel + 1, bytes: bytesTel + tamano } },
    }, { merge: true });
    if (medio.estado === 'anotado') {
      // Anotado: sin Storage, el metadato nace TERMINADO en la misma transacción que gasta el cupo y
      // marca el mensaje. Sin ruta, sin tamaño (no hay bytes) y sin sha256.
      tx.create(refMedio, {
        idMeta, conversacionId: `wa_${e.telefono}`, tipo, categoria: tipo, mime: medio.mime, ext: medio.ext, estado: 'anotado',
        tamano: null, ruta: null, sha256: null, en: Timestamp.fromMillis(ahoraMs), vence,
      });
      tx.update(mensaje.ref, { medio: { estado: 'anotado', mime: medio.mime, tamano: null, vence } });
      return { t: 'anotado' };
    }
    tx.create(refMedio, {
      idMeta, conversacionId: `wa_${e.telefono}`, tipo, categoria: tipo, mime: medio.mime, ext: medio.ext, estado: 'pendiente',
      tamano, ruta: rutaDeMedio(e.tenantId, dia, idMeta, medio.ext), en: Timestamp.fromMillis(ahoraMs),
      // Un pendiente huérfano caduca solo por el TTL en un día.
      vence: Timestamp.fromMillis(ahoraMs + DIA_MS),
    });
    return { t: 'reservado' };
  });
  } catch (error) {
    // Nada quedó escrito: la transacción es atómica (tampoco el cupo). Si fue contención, el reintento
    // del flujo lo resuelve; si fue otra cosa (incluido el mensaje borrado a medio camino en un
    // anotado: NOT_FOUND al marcarlo), 502.
    avisarFallo(medio.estado === 'anotado' ? 'la transacción del anotado' : 'la reserva', error);
    return esContencion(error) ? { codigo: 409, cuerpo: { error: 'en_curso' } } : { codigo: 502, cuerpo: { error: 'no_se_registro' } };
  }
  if (decision.t === 'repetido') return { codigo: 200, cuerpo: { ruta: decision.ruta, repetido: true } };
  if (decision.t === 'repetido_anotado') return { codigo: 200, cuerpo: { anotado: true, repetido: true } };
  if (decision.t === 'anotado') return { codigo: 200, cuerpo: { anotado: true, repetido: false } };
  if (decision.t === 'en_curso') return { codigo: 409, cuerpo: { error: 'en_curso' } };
  if (decision.t === 'lleno') return { codigo: 429, cuerpo: { error: 'cupo_diario_lleno' } };
  if (decision.t === 'lleno_telefono') return { codigo: 429, cuerpo: { error: 'cupo_telefono_lleno' } };
  if (medio.estado !== 'guardado') return { codigo: 502, cuerpo: { error: 'no_se_registro' } }; // inalcanzable
  // Un pendiente retomado se guarda en la carpeta del DÍA EN QUE SE RESERVÓ (donde está su cupo). Si
  // el reintento trae otro formato (otra extensión: el intento anterior pudo descargar otro archivo),
  // NO se rechaza —el medio quedaría sin guardar hasta que caduque el marcador—: se guarda con la
  // extensión de los bytes que llegaron, y el cierre reescribe `ruta`, `ext`, `mime` y `tamano` para
  // que el metadato describa el objeto real. El cupo no se ajusta por la diferencia de tamaño.
  const diaReservado = decision.t === 'tomar' ? diaDeRuta(decision.ruta, e.tenantId) : null;
  const ruta = rutaDeMedio(e.tenantId, diaReservado ?? dia, idMeta, medio.ext);
  const firma = medio;

  try {
    // `ifGenerationMatch: 0`: un medio nunca se sobrescribe. Si el objeto ya estaba (un intento anterior
    // que no alcanzó a terminar), se sigue a finalizar el registro; el cupo ya estaba reservado.
    await almacen.guardar(ruta, e.bytes, contentTypeDeObjeto({ tipo, mime: firma.mime }));
  } catch {
    await deshacerReserva(db, e.tenantId, refMedio);
    return { codigo: 502, cuerpo: { error: 'no_se_guardo' } };
  }

  try {
    await db.runTransaction(async (tx) => {
      tx.update(refMedio, {
        estado: 'guardado', sha256: createHash('sha256').update(e.bytes).digest('hex'), vence,
        ruta, ext: firma.ext, mime: firma.mime, tamano, categoria: tipo,
      });
      tx.update(mensaje.ref, { medio: { estado: 'guardado', mime: firma.mime, tamano, vence } });
    });
    return { codigo: 200, cuerpo: { ruta, repetido: false } };
  } catch (error) {
    // El marcador queda `pendiente`: un reintento pasados 5 minutos lo retoma sin gastar otro cupo. Si
    // no hay reintento, el cupo queda gastado y el objeto huérfano hasta la purga (decisión de diseño:
    // el flujo avisa con el aviso de falla).
    avisarFallo('el cierre del registro', error);
    return { codigo: 502, cuerpo: { error: 'no_se_registro' } };
  }
}

/**
 * Binario en el cuerpo; cabeceras `X-NovuChat-Telefono`, `X-NovuChat-IdMeta`,
 * `X-NovuChat-Tipo` (image|audio|video|document) y `Content-Type`. Solo el token.
 * Modo anotar (docx/xlsx): cuerpo vacío, `X-NovuChat-Anotar: 1` y `X-NovuChat-Mime`.
 *
 * EL CUERPO LO PARSEA EL FRAMEWORK ANTES DE ESTE CÓDIGO (functions-framework: `body-parser` json, text,
 * urlencoded y raw, con límite de 1024 MB). Con `Content-Type: application/json` y bytes que no son JSON,
 * responde 400 sin llegar aquí; con `application/x-www-form-urlencoded` de más de 1000 parámetros, 413;
 * con un `charset` desconocido en `text/*`, 415. `multipart/*` y `application/octet-stream` llegan
 * intactos en `rawBody`. Por eso el flujo manda los medios con `Content-Type: application/octet-stream`
 * y el mime real en `X-NovuChat-Mime`. Lo prueba `veredicto-medios.test.ts` («el parser del framework»).
 */
/** Peticiones a la vez por instancia FUERA de staging (revisión de seguridad del #617). */
export const CONCURRENCIA_DE_GUARDAR_MEDIO = 4;

/**
 * Las opciones de `guardarMedio`, puras para probarlas.
 *
 * CONCURRENCIA EXPLÍCITA. En producción (gen2, 1 vCPU) el valor por defecto es 80 peticiones a la vez
 * por instancia, y el cuerpo se lee ENTERO antes de autenticar: 80 cuerpos de 16 MB copiados varias
 * veces agotan 1 GiB con peticiones anónimas. Con 4, el peor caso cabe. En staging
 * (`CPU_FRACCIONARIA === 'si'`, menos de 1 vCPU) firebase-tools rechaza una concurrencia mayor que 1
 * y la baja sola a 1 si no se declara, así que ahí no se escribe (mismo patrón que
 * `buscarConversaciones.ts` y `turnoServidor.ts`). La idea de «no hay concurrencia» solo vale ahí.
 */
export function opcionesDeGuardarMedio(env: Record<string, string | undefined> = process.env) {
  const staging = env['CPU_FRACCIONARIA'] === 'si';
  return {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
    // Hasta 16 MB de audio más el sobre HTTP; el cuerpo se copia varias veces (revisión de seguridad).
    memory: '1GiB' as const,
    ...(staging ? {} : { concurrency: CONCURRENCIA_DE_GUARDAR_MEDIO }),
  };
}

export const guardarMedio = onRequest(
  opcionesDeGuardarMedio(),
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
      anotar: String(peticion.get('X-NovuChat-Anotar') ?? '').trim() === '1',
      mime: String(peticion.get('X-NovuChat-Mime') ?? ''),
    });
    respuesta.status(r.codigo).json(r.cuerpo);
  },
);
