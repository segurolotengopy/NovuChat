/**
 * =============================================================================
 * GUARDAR UN MEDIO ENTRANTE (audio, foto, PDF) — 90 días, solo con la bandera
 * =============================================================================
 *
 * DECISIONES DE ANDRES (20, 22 y 23/10/2026):
 *  - Se guardan los medios ENTRANTES 90 días con TTL, también con la
 *    conversación tomada por una persona (D1).
 *  - Topes: imagen 5 MB, audio 16 MB, PDF 10 MB. Con bytes, docx, xlsx y otros: 415 (D6).
 *  - docx y xlsx SOLO SE ANOTAN (29/10/2026): con `X-NovuChat-Anotar: 1`, cuerpo vacío y
 *    `X-NovuChat-Mime` de Word o Excel, se crea el metadato `estado: 'anotado'` sin ruta ni bytes.
 *  - TOPE de 3.000 medios por comercio y día (29/10/2026, reemplaza a D5: 1.000 o 2 GB), más un
 *    tope de bytes AMPLIO de 15 GiB por día que solo frena el costo de un token robado. Pasado el
 *    tope, se deja constancia en el contador a lo sumo 50 veces por día; después, ni eso.
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
 * depósito es el TOPE DIARIO (3.000 medios y 15 GiB por comercio), y la alerta
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
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../seguridad/firma.js';
import {
  CARPETA_DE_DIA, DIAS_DE_RETENCION, DIA_MS, ID_TENANT, almacenDeMedios, diaDeLaPaz, idMetaCrudo, nombreDeObjeto, type Almacen,
} from './almacen.js';
import {
  esTipoDeMedio, veredictoDe, veredictoDeAnotar, type ExtensionDeMedio,
} from './tipos.js';

const TELEFONO = /^[0-9]{8,15}$/;
/** El mensaje al que pertenece el medio tiene que ser de hace 30 minutos o menos. */
export const VENTANA_DEL_MENSAJE_MS = 30 * 60_000;
/**
 * Cuántos medios (guardados o anotados) acepta POR DÍA de La Paz un mismo comercio (Andres,
 * 29/10/2026). Es una barrera CONTRA ABUSO —un token filtrado no debe servir para llenar el
 * depósito—, no un límite comercial: un comercio muy ocupado recibe cientos de medios al día, y
 * rechazar a un cliente real por un tope apretado es peor que tolerar un abuso acotado.
 */
export const TOPE_DIARIO_DE_MEDIOS = 3000;
/**
 * Tope de BYTES por día, AMPLIO a propósito (15 GiB): 3.000 audios de 16 MB serían 48 GB en un
 * día y 4 TB en los 90 de retención. Un comercio real no se acerca; un token robado sí.
 */
export const TOPE_DIARIO_DE_BYTES = 15 * 1024 * 1024 * 1024;
/**
 * Cuántas veces por comercio y día se deja constancia de «tope superado» (en el propio contador,
 * campos `rechazados` y `ultimoRechazo`). Sin este freno, un abusador que ya pasó el tope seguiría
 * provocando una escritura por petición; pasadas 50, el 429 sale sin escribir nada.
 */
export const MAX_ANOTACIONES_DE_TOPE = 50;
/** El contador del día se borra solo (TTL) a los 2 días: alcanza para cubrir el cambio de día. */
export const DIAS_DEL_CONTADOR = 2;

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
        tx.update(refCupo, { n: Math.max(0, Number(c.get('n') ?? 0) - 1), bytes: Math.max(0, Number(c.get('bytes') ?? 0) - reservado) });
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
  /** `X-NovuChat-Mime`: el mime que declara Meta (solo en modo anotar). */
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
  let medio: { estado: 'guardado'; ext: ExtensionDeMedio; mime: string } | { estado: 'anotado'; ext: 'docx' | 'xlsx'; mime: string };
  if (e.anotar) {
    const v = veredictoDeAnotar(e.bytes, tipo, e.mime);
    if (!v.ok) return { codigo: v.codigo, cuerpo: v.cuerpo };
    medio = { estado: 'anotado', ext: v.ext, mime: v.mime };
  } else {
    const v = veredictoDe(e.bytes, tipo, e.contentType);
    if (!v.ok) return { codigo: v.codigo, cuerpo: v.cuerpo };
    medio = { estado: 'guardado', ext: v.firma.ext, mime: v.firma.mime };
  }

  const db = deps.db ?? getFirestore();

  // Solo se guarda lo que corresponde a un mensaje ENTRANTE reciente del mismo tipo.
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
    return d.get('direccion') === 'entrante' && d.get('tipo') === tipo
      && ts !== null && ahoraMs - ts <= VENTANA_DEL_MENSAJE_MS && ts <= ahoraMs + 5 * 60_000;
  });
  if (!mensaje) return { codigo: 409, cuerpo: { error: 'sin_mensaje' } };

  const refMedio = db.doc(`tenants/${e.tenantId}/mediosRecibidos/${nombreDeObjeto(idMeta)}`);
  const dia = diaDeLaPaz(ahoraMs);
  const refCupo = db.doc(`tenants/${e.tenantId}/cuposDeMedios/${dia}`);
  const vence = Timestamp.fromMillis(ahoraMs + DIAS_DE_RETENCION * DIA_MS);
  const venceContador = Timestamp.fromMillis(ahoraMs + DIAS_DEL_CONTADOR * DIA_MS);
  const tamano = e.bytes.length;

  // LA DEDUPLICACIÓN Y EL CUPO SON UNA SOLA TRANSACCIÓN (revisión de seguridad del #617). El marcador
  // `mediosRecibidos/{hash}` nace `pendiente` en la MISMA transacción que reserva el cupo: de varias
  // peticiones simultáneas con el mismo idMeta solo UNA lo crea y gasta cupo; las demás ven el marcador.
  // El cupo se devuelve a lo sumo UNA vez, y solo por la petición que lo reservó.
  type Decision =
    | { t: 'repetido'; ruta: string } | { t: 'repetido_anotado' } | { t: 'en_curso' } | { t: 'lleno' }
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
      tx.update(refMedio, { en: Timestamp.fromMillis(ahoraMs) });
      return { t: 'tomar', ruta: String(previo.get('ruta') ?? '') };
    }
    const n = Number(cupo.get('n') ?? 0);
    const bytes = Number(cupo.get('bytes') ?? 0);
    if (n + 1 > TOPE_DIARIO_DE_MEDIOS || bytes + tamano > TOPE_DIARIO_DE_BYTES) {
      // La constancia de «tope superado» va en el propio contador y está acotada: pasadas
      // MAX_ANOTACIONES_DE_TOPE, el 429 sale sin escribir nada.
      const rechazados = Number(cupo.get('rechazados') ?? 0);
      if (rechazados < MAX_ANOTACIONES_DE_TOPE) {
        tx.set(refCupo, {
          n, bytes, rechazados: rechazados + 1, ultimoRechazo: Timestamp.fromMillis(ahoraMs), vence: venceContador,
        }, { merge: true });
      }
      return { t: 'lleno' };
    }
    tx.set(refCupo, { n: n + 1, bytes: bytes + tamano, vence: venceContador }, { merge: true });
    if (medio.estado === 'anotado') {
      // Anotado: sin Storage, el metadato nace TERMINADO en la misma transacción que gasta el cupo y
      // marca el mensaje. Sin ruta, sin tamaño (no hay bytes) y sin sha256.
      tx.create(refMedio, {
        idMeta, conversacionId: `wa_${e.telefono}`, tipo, mime: medio.mime, ext: medio.ext, estado: 'anotado',
        tamano: null, ruta: null, sha256: null, en: Timestamp.fromMillis(ahoraMs), vence,
      });
      tx.update(mensaje.ref, { medio: { estado: 'anotado', mime: medio.mime, tamano: null, vence } });
      return { t: 'anotado' };
    }
    tx.create(refMedio, {
      idMeta, conversacionId: `wa_${e.telefono}`, tipo, mime: medio.mime, ext: medio.ext, estado: 'pendiente',
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
    await almacen.guardar(ruta, e.bytes, firma.mime);
  } catch {
    await deshacerReserva(db, e.tenantId, refMedio);
    return { codigo: 502, cuerpo: { error: 'no_se_guardo' } };
  }

  try {
    await db.runTransaction(async (tx) => {
      tx.update(refMedio, {
        estado: 'guardado', sha256: createHash('sha256').update(e.bytes).digest('hex'), vence,
        ruta, ext: firma.ext, mime: firma.mime, tamano,
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
 * `X-NovuChat-Tipo` (image|audio|document) y `Content-Type`. Solo el token.
 * Modo anotar (docx/xlsx): cuerpo vacío, `X-NovuChat-Anotar: 1` y `X-NovuChat-Mime`.
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
