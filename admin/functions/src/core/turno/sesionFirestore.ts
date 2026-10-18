/**
 * El estado de la conversación entre turnos (F3b, O2): la CAPA DE TRANSACCIONES.
 *
 * Qué es: `atenderSesion` aplica en Firestore las tres acciones de la petición
 * `sesion` (leer, comprometer, asentar) sobre `sesionesDeTurno`, `vistosDeTurno`
 * y `cuposDeTurno`. Toda la DECISIÓN vive en `sesion.ts` (puro, probado sin
 * emulador); acá solo se leen los documentos, se llama a esas funciones y se
 * escribe lo que dicen. No hay lógica de negocio nueva.
 *
 * Una transacción por operación, todo o nada: o se escribe la sesión y todos
 * los cupos, o nada. La versión es optimista: dos `comprometer` con la misma
 * `versionLeida` se serializan y el segundo ve `conflicto_version`.
 *
 * Por qué NO toca `conversaciones/*` ni `metricas/*`: el conteo facturado sale
 * de ahí. Este camino solo escribe sus tres colecciones; una prueba lo vigila.
 *
 * Seguridad: la clave de aislamiento es `tenantId` + `phoneNumberId` de la ruta
 * ya autenticada (la recibe el llamador, PR-2b); nada del cuerpo elige tenant.
 * Los documentos los escribe solo el Admin SDK; ningún rol de la consola los lee.
 *
 * Datos corruptos (escritos a mano, por ejemplo): se tratan hacia el lado
 * conservador. Un `vence` que no es fecha NO se lee como «vencido» ni como
 * «sin vencimiento»: en un cupo se niega (`datos_invalidos`) y en la sesión el
 * compromiso responde `datos_invalidos`. Zona Core: importa solo core/ y el SDK.
 */
import {
  FieldPath, Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction,
} from 'firebase-admin/firestore';
import {
  decidirAsentar, decidirCompromiso, decidirVisto, idCupo, idSesion, idVisto, leerConversacion,
  planDeCupos, validarSesion, venceDeVisto,
  type Conversacion, type ConsumoDeCupo, type DocCupo, type DocSesion, type PeticionSesion,
} from './sesion.js';

export interface RutaSesion {
  tenantId: string;
  phoneNumberId: string;
  flujo?: string;
}

export interface RespuestaSesion {
  status: number;
  json: Record<string, unknown>;
}

/** Cuántas veces reintenta el SDK una transacción que choca (20 lectores del mismo mensaje). */
const INTENTOS = 30;

const COL_SESIONES = 'sesionesDeTurno';
const COL_VISTOS = 'vistosDeTurno';
const COL_CUPOS = 'cuposDeTurno';

const ERROR_INTERNO = 'sesion: error interno';
const CONVERSACION_VACIA: Conversacion = { version: 0, estado: null, desde: null, vence: null, vencido: false };

// ------------------------------------------------------------------ lectura

const esEntero = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** `undefined`/`null` -> null; Timestamp -> ms; cualquier otra cosa -> `'corrupto'`. */
function aMs(v: unknown): number | null | 'corrupto' {
  if (v === undefined || v === null) return null;
  if (v instanceof Timestamp) return v.toMillis();
  return 'corrupto';
}

/** Mapa sin prototipo con las entradas propias y bien formadas de `por`. */
function porLimpio(crudo: unknown): Record<string, ConsumoDeCupo> {
  const salida = Object.create(null) as Record<string, ConsumoDeCupo>;
  if (typeof crudo !== 'object' || crudo === null) return salida;
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    const c = v as Partial<ConsumoDeCupo> | null;
    if (typeof c === 'object' && c !== null && esEntero(c.cantidad) && typeof c.en === 'number' && Number.isFinite(c.en)) {
      salida[k] = { cantidad: c.cantidad, en: c.en };
    }
  }
  return salida;
}

/** `null` si el documento está ausente; `'corrupto'` si algún campo no tiene la forma. */
function docSesionDe(datos: DocumentData | undefined): DocSesion | null | 'corrupto' {
  if (datos === undefined) return null;
  const vence = aMs(datos['vence']);
  const actualizadoEn = aMs(datos['actualizadoEn']);
  const estadoJson = datos['estadoJson'];
  const compromisos = datos['compromisos'];
  if (
    !esEntero(datos['version']) || vence === 'corrupto' || actualizadoEn === 'corrupto' ||
    (estadoJson !== undefined && estadoJson !== null && typeof estadoJson !== 'string') ||
    (compromisos !== undefined && (!Array.isArray(compromisos) || !compromisos.every((c) => typeof c === 'string')))
  ) {
    return 'corrupto';
  }
  return {
    version: datos['version'],
    estadoJson: (estadoJson as string | null | undefined) ?? null,
    vence,
    actualizadoEn,
    compromisos: (compromisos as string[] | undefined) ?? [],
  };
}

/**
 * El cupo tal como lo ve el núcleo. Un `vence` que no es fecha se entrega con
 * `usados: NaN`, que el núcleo NIEGA como `datos_invalidos`: pasarle un `vence`
 * ilegible lo dejaría «vencido» y se concedería de más.
 */
function docCupoDe(datos: DocumentData | undefined): DocCupo | undefined {
  if (datos === undefined) return undefined;
  const vence = aMs(datos['vence']);
  if (vence === 'corrupto') return { usados: Number.NaN, vence: null };
  return { usados: datos['usados'] as number, vence, por: datos['por'] as Record<string, ConsumoDeCupo> | undefined };
}

// ----------------------------------------------------------------- despacho

/**
 * Atiende una petición `sesion` ya autenticada. `cuerpo` es el cuerpo de la
 * petición HTTP (`telefono` y `sesion`); `ahoraMs` entra por parámetro para que
 * las pruebas no dependan del reloj. Nunca lanza: un fallo interno es un 500 con
 * mensaje fijo (el cuerpo no repite lo que mandó el flujo).
 */
export async function atenderSesion(
  db: Firestore, ruta: RutaSesion, cuerpo: unknown, ahoraMs: number,
): Promise<RespuestaSesion> {
  const c = (typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}) as Record<string, unknown>;
  const telefono = typeof c['telefono'] === 'string' ? c['telefono'] : null;
  const v = validarSesion(c['sesion'], telefono);
  if (!v.ok) return { status: v.status, json: { error: v.error } };
  try {
    const tel = telefono as string; // validarSesion ya exigió un teléfono válido
    switch (v.peticion.accion) {
      case 'leer': return await leer(db, ruta, v.peticion, tel, ahoraMs);
      case 'comprometer': return await comprometer(db, ruta, v.peticion, tel, ahoraMs);
      default: return await asentar(db, ruta, v.peticion, tel, ahoraMs);
    }
  } catch {
    return { status: 500, json: { error: ERROR_INTERNO } };
  }
}

const coleccion = (db: Firestore, t: string, nombre: string) => db.collection('tenants').doc(t).collection(nombre);

// -------------------------------------------------------------------- leer

async function leer(
  db: Firestore, ruta: RutaSesion, p: PeticionSesion, tel: string, ahoraMs: number,
): Promise<RespuestaSesion> {
  const refSesion = coleccion(db, ruta.tenantId, COL_SESIONES).doc(idSesion(ruta.phoneNumberId, p.espacio, tel));
  const refVisto = p.idMensaje === undefined
    ? null
    : coleccion(db, ruta.tenantId, COL_VISTOS).doc(idVisto(ruta.phoneNumberId, p.idMensaje));

  const { conversacion, visto } = await db.runTransaction(async (tx) => {
    const snapSesion = await tx.get(refSesion);
    const snapVisto = refVisto === null ? null : await tx.get(refVisto);
    const doc = docSesionDe(snapSesion.data());
    const conv = doc === 'corrupto' ? CONVERSACION_VACIA : leerConversacion(doc, ahoraMs);
    let v: 'nuevo' | 'repetido' | null = null;
    if (refVisto !== null && snapVisto !== null) {
      const dv = aMs(snapVisto.data()?.['vence']);
      // Un `vence` ilegible en un visto cuenta como repetido: no se reprocesa un mensaje por un dato roto.
      v = snapVisto.exists && dv === 'corrupto' ? 'repetido' : decidirVisto(snapVisto.exists ? { vence: dv as number | null } : null, ahoraMs);
      if (v === 'nuevo') {
        tx.set(refVisto, {
          ejecucion: p.ejecucion, vence: Timestamp.fromMillis(venceDeVisto(ahoraMs)), phoneNumberId: ruta.phoneNumberId,
        });
      }
    }
    return { conversacion: conv, visto: v };
  }, { maxAttempts: INTENTOS });

  return { status: 200, json: { conversacion, visto } };
}

// -------------------------------------------------------------- comprometer

async function comprometer(
  db: Firestore, ruta: RutaSesion, p: PeticionSesion, tel: string, ahoraMs: number,
): Promise<RespuestaSesion> {
  const refSesion = coleccion(db, ruta.tenantId, COL_SESIONES).doc(idSesion(ruta.phoneNumberId, p.espacio, tel));
  const plan = planDeCupos(ruta.phoneNumberId, tel, p.cupos, ahoraMs);
  const refsCupo = new Map<string, DocumentReference>(
    plan.map((c) => [c.id, coleccion(db, ruta.tenantId, COL_CUPOS).doc(c.id)]),
  );

  const json = await db.runTransaction(async (tx): Promise<Record<string, unknown>> => {
    // Todas las lecturas antes que cualquier escritura.
    const snapSesion = await tx.get(refSesion);
    const cuposActuales: Record<string, DocCupo | undefined> = Object.create(null) as Record<string, DocCupo | undefined>;
    for (const [id, ref] of refsCupo) cuposActuales[id] = docCupoDe((await tx.get(ref)).data());

    const doc = docSesionDe(snapSesion.data());
    if (doc === 'corrupto') return { resultado: 'datos_invalidos', conversacion: CONVERSACION_VACIA };

    const d = decidirCompromiso({
      doc, ahoraMs, versionLeida: p.versionLeida as number, idCompromiso: p.idCompromiso as string,
      estado: p.estado as Record<string, unknown> | null, venceEnMin: p.venceEnMin as number,
      cupos: plan, cuposActuales,
    });
    if (d.resultado === 'cupo_negado') {
      return { resultado: d.resultado, motivo: d.motivo, clave: d.clave, conversacion: d.conversacion };
    }
    if (d.resultado !== 'comprometido') return { resultado: d.resultado, conversacion: d.conversacion };

    tx.set(refSesion, {
      version: d.version,
      estadoJson: d.estadoJson,
      vence: Timestamp.fromMillis(d.vence),
      actualizadoEn: Timestamp.fromMillis(d.actualizadoEn),
      flujo: ruta.flujo ?? null,
      phoneNumberId: ruta.phoneNumberId,
      espacio: p.espacio,
      compromisos: d.compromisos,
    });
    for (const k of d.cupos) {
      tx.set(refsCupo.get(k.id) as DocumentReference, {
        usados: k.usados, tope: k.tope, por: { ...k.por }, vence: Timestamp.fromMillis(k.vence),
        phoneNumberId: ruta.phoneNumberId,
      });
    }
    return { resultado: 'comprometido', conversacion: d.conversacion };
  }, { maxAttempts: INTENTOS });

  return { status: 200, json };
}

// ------------------------------------------------------------------ asentar

/** `{pnid}~{clave}~{quien}~{periodo}`: ¿es de este número y de este contacto (o del comercio)? */
function esDeEsteContacto(id: string, pnid: string, tel: string): boolean {
  const partes = id.split('~');
  return partes.length === 4 && partes[0] === pnid && (partes[2] === '_' || partes[2] === `wa_${tel}`);
}

async function asentar(
  db: Firestore, ruta: RutaSesion, p: PeticionSesion, tel: string, ahoraMs: number,
): Promise<RespuestaSesion> {
  const idc = p.idCompromiso as string;
  const refSesion = coleccion(db, ruta.tenantId, COL_SESIONES).doc(idSesion(ruta.phoneNumberId, p.espacio, tel));
  // El compromiso no dice qué cupos tocó: se buscan los que lo guardan en `por`.
  // `FieldPath` porque el id puede traer puntos, que una ruta en cadena partiría.
  const consulta = coleccion(db, ruta.tenantId, COL_CUPOS).where(new FieldPath('por', idc, 'cantidad'), '>=', 0);

  const json = await db.runTransaction(async (tx: Transaction): Promise<Record<string, unknown>> => {
    const snapSesion = await tx.get(refSesion);
    const hallados = await tx.get(consulta);
    const doc = docSesionDe(snapSesion.data());
    const conversacion = doc === 'corrupto' ? CONVERSACION_VACIA : leerConversacion(doc, ahoraMs);

    // Solo cupos del mismo número y del mismo contacto (o del comercio), releídos acá.
    const propios = Object.create(null) as Record<string, DocCupo | undefined>;
    const refs = new Map<string, DocumentReference>();
    for (const s of hallados.docs) {
      if (!esDeEsteContacto(s.id, ruta.phoneNumberId, tel)) continue;
      const datos = s.data();
      propios[s.id] = { usados: datos['usados'] as number, vence: null, por: porLimpio(datos['por']) };
      refs.set(s.id, s.ref);
    }
    const d = decidirAsentar(idc, propios);
    if (d.resultado === 'nada_que_asentar') return { resultado: d.resultado, conversacion };
    for (const k of d.cupos) {
      tx.update(refs.get(k.id) as DocumentReference, { usados: k.usados, por: { ...k.por } });
    }
    return { resultado: 'asentado', conversacion };
  }, { maxAttempts: INTENTOS });

  return { status: 200, json };
}

// `idCupo` se reexporta para que las pruebas armen las rutas con el mismo código que la capa.
export { idCupo, idSesion, idVisto };
