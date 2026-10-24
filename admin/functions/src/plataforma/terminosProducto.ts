/**
 * TÉRMINOS DE PRODUCTO REGISTRADOS: LA DECISIÓN DE NOVUCHAT (Plataforma, PR 3).
 *
 * El comercio registra el nombre literal de un producto con «prompt/prompts» («100 prompts») y
 * el sistema lo trata como dato, pero SOLO si NovuChat lo aprueba. El contrato del documento
 * `tenants/{t}/terminosProducto/{itemId}` y el lector están en
 * `central/asistente/terminos.ts` (no se tocan acá); `pendiente` y `rechazado` los escribe el
 * disparador de Productos (PR 2). ESTE archivo es lo único que escribe `aprobado`, y la
 * revocación (un aprobado que vuelve a `rechazado`), siempre por decisión humana.
 *
 * Lo comparten el callable (`aprobarTerminoProducto.ts`) y el script de respaldo
 * (`scripts/plataforma/aprobar-termino-producto.mjs`): una sola implementación, sin imports de
 * `firebase-functions` para que el script la cargue liviana.
 *
 * APROBAR exige, TODO dentro de una transacción (lo exigió seguridad en la revisión de #657):
 *   - el documento está `pendiente` y su `termino` es EXACTAMENTE lo que devuelve
 *     `terminoRegistrable(termino, otros)` con los demás comercios cargados (así un término
 *     que no pasa el filtro estricto, o que nombra a otro comercio, nunca se escribe aprobado);
 *   - el ítem `catalogo/{itemId}` se lee en la MISMA transacción, está `activo == true`, su
 *     nombre es apto (`nombreApto`, inyectado: Productos pasa `nombreDeProductoApto` y
 *     Plataforma no puede importar de módulos), contiene el término como palabras enteras y
 *     `hashCorto(normalizar(nombre))` es igual al `nombreHash` del documento: un nombre editado
 *     entre la lectura de la pantalla y el clic deja la aprobación sin efecto, y falla;
 *   - hay menos de `TOPE_APROBADOS` aprobados DISTINTOS de este ítem (el tope vive acá y no en
 *     la pantalla);
 *   - queda `revisadoPor` y `revisadoEn`, y una entrada en `tenants/{t}/auditoria`.
 * RECHAZAR solo desde `pendiente`; REVOCAR solo desde `aprobado`. Repetir una decisión ya
 * tomada no escribe nada (idempotente). Un término revocado o rechazado no vuelve a aprobarse
 * desde acá: el comercio tiene que registrarlo de nuevo (el disparador lo deja `pendiente`).
 *
 * UN TENANT NUNCA OPERA SOBRE OTRO: la ruta sale de `tenantId` (validado contra su forma y
 * contra la ficha, que tiene que existir y no estar dada de baja) y el ítem se busca solo
 * dentro de ese tenant. Los errores son genéricos: no dicen cuál regla ni cuál palabra falló.
 */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  SIN_OTROS, expresionDeTerminos, hashCorto, normalizar, terminoApto, terminoRegistrable, verificarPatrones,
} from '../central/asistente/comportamiento.js';
import type { OtrosComercios } from '../central/asistente/comportamiento.js';

/** Constante de seguridad de `central/asistente/terminos.ts`; una prueba exige que coincidan. */
export const TOPE_APROBADOS = 10;
export const COLECCION = 'terminosProducto';
export const DECISIONES = ['aprobar', 'rechazar', 'revocar'] as const;
export type Decision = (typeof DECISIONES)[number];

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_ITEM = /^[A-Za-z0-9_-]{1,128}$/;
export const esDecision = (v: unknown): v is Decision => typeof v === 'string' && (DECISIONES as readonly string[]).includes(v);

export type CodigoError =
  | 'invalido' | 'sin_comercio' | 'sin_termino' | 'estado' | 'no_aprobable' | 'nombre_cambio' | 'tope';

/** Mensajes fijos para la persona; ninguno nombra la regla ni una palabra. */
export const MENSAJE: Record<CodigoError, string> = {
  invalido: 'Datos inválidos.',
  sin_comercio: 'No existe ese comercio.',
  sin_termino: 'No existe ese término.',
  estado: 'El término no está en un estado que permita esa decisión.',
  no_aprobable: 'No se puede aprobar este término.',
  nombre_cambio: 'No se puede aprobar este término.',
  tope: `Ya hay ${TOPE_APROBADOS} términos aprobados en este comercio. Revoque uno antes.`,
};

export class ErrorTermino extends Error {
  readonly codigo: CodigoError;
  constructor(codigo: CodigoError) { super(MENSAJE[codigo]); this.codigo = codigo; }
}

export interface PedidoDecision {
  tenantId: string;
  itemId: string;
  decision: Decision;
  /** Quien decide: uid del propietario, o `script:<operador>`. */
  quien: string;
  /** Capa de Productos para el nombre del ítem (`nombreDeProductoApto`). Es obligatoria. */
  nombreApto: (nombre: string) => boolean;
  /** Para pruebas; por defecto, los demás tenants. */
  otros?: OtrosComercios;
  /** `true` cuando lo opera un script (queda en la auditoría). */
  porScript?: boolean;
  /** Solo en seco: valida igual pero no escribe. */
  enSeco?: boolean;
}

export interface ResultadoDecision {
  ok: true;
  estado: 'aprobado' | 'rechazado';
  termino: string;
  /** `true` si ya estaba así y no se escribió nada (o si fue en seco). */
  sinCambio: boolean;
  /** Aprobados del comercio tras la decisión (para la pantalla). */
  aprobados: number;
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Los demás comercios (ids y nombres visibles), como `otrosComercios` de Central, sin importarlo. */
export async function otrosDe(db: Firestore, tenantId: string): Promise<OtrosComercios> {
  const todos = await db.collection('tenants').select('nombre').get();
  const ids: string[] = [];
  const nombres: string[] = [];
  for (const d of todos.docs) {
    if (d.id === tenantId) continue;
    ids.push(d.id);
    const nombre = d.get('nombre');
    if (typeof nombre === 'string') nombres.push(nombre);
  }
  return { ids, nombres };
}

const MOTIVO: Record<Decision, string> = {
  aprobar: 'aprobado por NovuChat',
  rechazar: 'rechazado por NovuChat',
  revocar: 'revocado por NovuChat',
};
const ESTADO_FINAL: Record<Decision, 'aprobado' | 'rechazado'> = { aprobar: 'aprobado', rechazar: 'rechazado', revocar: 'rechazado' };

/** Todo lo que hace falta para APROBAR, sobre lo leído en la transacción. `null` si vale. */
function porQueNoSeAprueba(
  termino: string, nombreHash: string, item: { activo: unknown; nombre: unknown } | null,
  otros: OtrosComercios, nombreApto: (n: string) => boolean,
): CodigoError | null {
  // (iii) el ítem existe, está activo y su nombre es apto como nombre de producto.
  if (!item || item.activo !== true) return 'no_aprobable';
  const nombre = texto(item.nombre);
  if (nombre === '' || !nombreApto(nombre)) return 'no_aprobable';
  // (ii) el nombre ACTUAL (leído en esta transacción) es el que se registró.
  const normal = normalizar(nombre);
  if (nombreHash === '' || hashCorto(normal) !== nombreHash) return 'nombre_cambio';
  // (i) el término guardado es EXACTAMENTE lo que devuelve el filtro estricto para el nombre ACTUAL,
  // con los otros comercios cargados: un documento hostil o un término vacío (rechazo del sistema) no pasa.
  const r = terminoRegistrable(nombre, otros);
  if (!r.ok || termino === '' || r.termino !== termino || !terminoApto(termino)) return 'no_aprobable';
  // Mismas condiciones que el lector (`terminosAprobados`): contenido como palabras enteras y
  // capa 1 sin rechazo del nombre con SU término.
  const re = expresionDeTerminos([termino]);
  if (re === null || !re.test(normal)) return 'no_aprobable';
  if (verificarPatrones(nombre, SIN_OTROS, [termino]).nivel === 'rechazado') return 'no_aprobable';
  return null;
}

export async function decidirTermino(db: Firestore, p: PedidoDecision): Promise<ResultadoDecision> {
  if (!ID_TENANT.test(p.tenantId) || !ID_ITEM.test(p.itemId) || !esDecision(p.decision) || p.quien === ''
    || typeof p.nombreApto !== 'function') {
    throw new ErrorTermino('invalido');
  }
  const ficha = db.doc(`tenants/${p.tenantId}`);
  const refTermino = db.doc(`tenants/${p.tenantId}/${COLECCION}/${p.itemId}`);
  const refItem = db.doc(`tenants/${p.tenantId}/catalogo/${p.itemId}`);
  const colTerminos = db.collection(`tenants/${p.tenantId}/${COLECCION}`);
  // Los demás comercios se leen ANTES (una colección entera no entra en la transacción); solo para aprobar.
  const otros = p.decision === 'aprobar' ? (p.otros ?? await otrosDe(db, p.tenantId)) : SIN_OTROS;

  return db.runTransaction(async (tx) => {
    const [fichaDoc, doc, itemDoc] = await Promise.all([tx.get(ficha), tx.get(refTermino), tx.get(refItem)]);
    if (!fichaDoc.exists || fichaDoc.get('estado') === 'baja') throw new ErrorTermino('sin_comercio');
    if (!doc.exists) throw new ErrorTermino('sin_termino');
    const estado = texto(doc.get('estado'));
    const termino = texto(doc.get('termino'));
    const nombreHash = texto(doc.get('nombreHash'));
    const otrosAprobados = (await tx.get(colTerminos.where('estado', '==', 'aprobado').limit(50)))
      .docs.filter((d) => d.id !== p.itemId).length;

    const final = ESTADO_FINAL[p.decision];
    // IDEMPOTENTE: repetir lo ya decidido no escribe.
    const yaEsta = p.decision === 'aprobar' ? estado === 'aprobado' : estado === 'rechazado';
    if (yaEsta) {
      return { ok: true as const, estado: final, termino, sinCambio: true, aprobados: otrosAprobados + (estado === 'aprobado' ? 1 : 0) };
    }
    if (p.decision === 'revocar' ? estado !== 'aprobado' : estado !== 'pendiente') throw new ErrorTermino('estado');

    if (p.decision === 'aprobar') {
      const motivo = porQueNoSeAprueba(termino, nombreHash,
        itemDoc.exists ? { activo: itemDoc.get('activo'), nombre: itemDoc.get('nombre') } : null, otros, p.nombreApto);
      if (motivo) throw new ErrorTermino(motivo);
      // (v) el tope, en la transacción: los aprobados de OTROS ítems.
      if (otrosAprobados >= TOPE_APROBADOS) throw new ErrorTermino('tope');
    }
    const aprobados = otrosAprobados + (final === 'aprobado' ? 1 : 0);
    if (p.enSeco) return { ok: true as const, estado: final, termino, sinCambio: true, aprobados };

    const ahora = Timestamp.now();
    // (iv) quién y cuándo; el motivo es fijo y nunca lleva el término.
    tx.update(refTermino, { estado: final, motivo: MOTIVO[p.decision], revisadoPor: p.quien, revisadoEn: ahora });
    tx.create(db.collection(`tenants/${p.tenantId}/auditoria`).doc(), {
      accion: `termino_producto_${p.decision}`, uid: p.quien, en: ahora,
      itemId: p.itemId, termino, nombreHash, estadoAntes: estado, estadoDespues: final,
      ...(p.porScript ? { porScript: true } : {}),
    });
    return { ok: true as const, estado: final, termino, sinCambio: false, aprobados };
  });
}

export interface FilaTermino {
  itemId: string;
  termino: string;
  estado: 'pendiente' | 'aprobado' | 'rechazado';
  motivo: string;
  /** Nombre ACTUAL del ítem (la pantalla lo trata como texto no confiable). `null` si no existe. */
  nombre: string | null;
  activo: boolean;
  /** `true` si el nombre actual sigue produciendo el mismo hash. */
  hashVigente: boolean;
  revisadoPor: string | null;
  revisadoEnMs: number | null;
}

/** Lo que muestra la pantalla del propietario: los términos del comercio (a lo sumo 50) y el conteo. */
export async function listarTerminos(db: Firestore, tenantId: string): Promise<{ filas: FilaTermino[]; aprobados: number; tope: number }> {
  if (!ID_TENANT.test(tenantId)) throw new ErrorTermino('invalido');
  const ficha = await db.doc(`tenants/${tenantId}`).get();
  if (!ficha.exists) throw new ErrorTermino('sin_comercio');
  const docs = (await db.collection(`tenants/${tenantId}/${COLECCION}`).limit(50).get()).docs
    .filter((d) => ID_ITEM.test(d.id));
  const items = docs.length === 0 ? [] : await db.getAll(...docs.map((d) => db.doc(`tenants/${tenantId}/catalogo/${d.id}`)));
  const filas: FilaTermino[] = docs.map((d, i) => {
    const it = items[i];
    const existe = it?.exists === true;
    const nombre = existe ? texto(it?.get('nombre')).slice(0, 200) : null;
    const estado = texto(d.get('estado'));
    const estadoFila: FilaTermino['estado'] = estado === 'aprobado' || estado === 'rechazado' ? estado : 'pendiente';
    const revisadoEn = d.get('revisadoEn') as { toMillis?: () => number } | undefined;
    return {
      itemId: d.id,
      termino: texto(d.get('termino')).slice(0, 120),
      estado: estadoFila,
      motivo: texto(d.get('motivo')).slice(0, 200),
      nombre,
      activo: existe && it?.get('activo') === true,
      hashVigente: existe && hashCorto(normalizar(texto(it?.get('nombre')))) === texto(d.get('nombreHash')),
      revisadoPor: typeof d.get('revisadoPor') === 'string' ? texto(d.get('revisadoPor')).slice(0, 80) : null,
      revisadoEnMs: typeof revisadoEn?.toMillis === 'function' ? revisadoEn.toMillis() : null,
    };
  }).sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
  return { filas, aprobados: filas.filter((f) => f.estado === 'aprobado').length, tope: TOPE_APROBADOS };
}
