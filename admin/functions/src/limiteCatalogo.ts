/**
 * =============================================================================
 * LÍMITE DE PRODUCTOS DEL CATÁLOGO POR PLAN — y la importación que lo respeta
 * =============================================================================
 *
 * Decisión de Andres del 15/09/2026: productos del catálogo por plan
 * **20 / 100 / 500**. CLAUDE.md, base comercial §7: un límite que solo existe en
 * la pantalla no existe. Este archivo es la mitad del SERVIDOR que no cabe en
 * `firestore.rules`:
 *
 *   - De a UNO, la consola escribe directo y las reglas cuentan: el alta va en
 *     un lote con el contador `tenants/{t}/contadores/catalogo` (+1, `ultimoItem`
 *     = el producto) y la regla niega si pasa del límite.
 *   - En LOTE —la importación desde Excel o CSV— las reglas no alcanzan: una
 *     regla solo deja crear un producto por lote (es lo que impide colar dos
 *     con un solo +1). Por eso la importación pasa por `importarCatalogo`, que
 *     cuenta en UNA transacción con el SDK Admin y crea hasta donde deja el
 *     plan.
 *
 * EL SDK ADMIN SE SALTA LAS REGLAS. Todo lo que `firestore.rules` exige para
 * crear un producto se vuelve a exigir acá, a mano: el permiso (rol, proveedor
 * de la sesión, correo verificado, comercio operativo) y la forma del ítem
 * (`formaDeItemValida`, copia de `itemValido()` de las reglas).
 * `pruebas/limite-catalogo.test.ts` pasa los mismos casos por las dos y exige
 * que digan lo mismo: si alguien toca una sola, se nota.
 *
 * EL LÍMITE SE LEE DEL PLAN, NO DEL CÓDIGO. Primero
 * `cuenta/estado.limites.productos`; si falta, la tabla de respaldo por
 * `cuenta/estado.plan`; y si el plan no se conoce, el MENOR (20).
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { PLANES, PLAN_POR_DEFECTO, limitesDeCuenta } from './planes.js';

const db = () => getFirestore();
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** Identificador de un ítem. Lo que produce `idDeItem` y los de las semillas (`item-1`). */
const ID_ITEM = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/**
 * RESPALDO del límite de productos por plan, DERIVADO de `planes.ts`, que es
 * la fuente: acá no hay ningún número escrito. Existe como tabla porque las
 * reglas de Firestore no importan TypeScript y llevan la suya en
 * `limiteProductos()`; `pruebas/limite-catalogo.test.ts` compara aquella línea
 * con esta tabla, o sea con `planes.ts`.
 *
 * Son los planes del catálogo y nada más: desde F1 (`Analisis/41` §4) no hay
 * plan de demostración. Un demo tiene un plan del catálogo con su copia de
 * límites, y es la copia la que rige; un `plan: 'demostracion'` que quedara
 * sin migrar cae en el más chico, como cualquier plan desconocido.
 */
export const PRODUCTOS_POR_PLAN_RESPALDO: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(Object.entries(PLANES).map(([id, p]) => [id, p.productos])),
);

/** Sin `limites` y con un plan desconocido: el plan más chico. Fallar hacia abajo. */
export const PRODUCTOS_SIN_PLAN = PLANES[PLAN_POR_DEFECTO].productos;

/**
 * Tope de ítems por llamada. Una transacción de Firestore se hace pesada muy
 * por debajo de sus límites duros, y la consola ya parte la importación en
 * trozos de 400 (`web/src/paginas/Catalogo.tsx`).
 */
export const MAX_ITEMS_POR_LLAMADA = 400;

/**
 * El límite de productos de un comercio, leído de su `cuenta/estado`. Es
 * `limitesDeCuenta` de `planes.ts`, la función de todos los límites: la copia
 * `limites.productos` si es un entero de 1 a `LIMITE_MAXIMO`; si no, la del
 * plan; si el plan no es del catálogo, la del más chico. La regla
 * `limiteProductos()` aplica el mismo rango, y la prueba lo compara.
 */
export function limiteDeProductos(cuenta: Record<string, unknown> | undefined): number {
  return limitesDeCuenta(cuenta).productos;
}

/**
 * Identificador derivado del nombre. MISMO criterio que `idDeNombre` de
 * `web/src/lib/csv.ts` (la prueba los compara): si difirieran, reimportar un
 * archivo duplicaría el catálogo en vez de actualizarlo.
 */
export function idDeItem(nombre: string): string {
  return nombre.trim().toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// FORMA DEL ÍTEM — copia de `itemValido()` de firestore.rules, sin el sello
// (acá lo pone el servidor, no el cliente).
// ---------------------------------------------------------------------------
const CLAVES_ITEM = new Set([
  'nombre', 'descripcion', 'area', 'precio', 'moneda', 'duracionMin',
  'activo', 'actualizadoPor', 'actualizadoEn', 'imagenUrl', 'stock',
]);

/** Largo como lo mide `size()` de las reglas: en caracteres, no en unidades UTF-16. */
const largo = (s: string) => [...s].length;
const cadena = (v: unknown, max: number) => typeof v === 'string' && largo(v) <= max;
const opcional = (d: Record<string, unknown>, campo: string, max: number) =>
  !(campo in d) || cadena(d[campo], max);

/**
 * ¿El documento RESULTANTE es un ítem válido? Mismo criterio que la regla, que
 * también evalúa el documento resultante.
 */
export function formaDeItemValida(d: Record<string, unknown>): boolean {
  if (Object.keys(d).some((k) => !CLAVES_ITEM.has(k))) return false;
  const nombre = d['nombre'];
  if (!cadena(nombre, 80) || (nombre as string).length === 0) return false;
  if (!opcional(d, 'descripcion', 300) || !opcional(d, 'area', 40)) return false;

  // Precio: ausente o nulo es «a consultar»; si está, número de 0 a 1.000.000.
  const precio = d['precio'];
  if (precio !== undefined && precio !== null
      && !(typeof precio === 'number' && Number.isFinite(precio) && precio >= 0 && precio <= 1_000_000)) {
    return false;
  }
  if ('moneda' in d && !['BOB', 'USD'].includes(d['moneda'] as string)) return false;

  if ('duracionMin' in d) {
    const m = d['duracionMin'];
    if (!(typeof m === 'number' && Number.isInteger(m) && m > 0 && m <= 1440 && m % 15 === 0)) return false;
  }
  if (typeof d['activo'] !== 'boolean') return false;

  if ('imagenUrl' in d) {
    const u = d['imagenUrl'];
    if (!cadena(u, 500)) return false;
    if (u !== '' && !/^https:\/\/[^ '"<>]+$/.test(u as string)) return false;
  }
  return true;
}

/**
 * ¿Se puede CREAR así? Lo de arriba, y sin `stock`: igual que la regla de
 * `create`, un ítem nace sin existencias y la cantidad se fija después con
 * `ajustarStock`, que deja el movimiento.
 */
export function formaDeAltaValida(d: Record<string, unknown>): boolean {
  return formaDeItemValida(d) && !('stock' in d);
}

// ---------------------------------------------------------------------------
// PERMISO — el mismo que la regla de CREATE de `/catalogo`
// ---------------------------------------------------------------------------
/**
 * Administrador del comercio, con sesión de usuario y contraseña y el correo
 * verificado. Es `esAdmin(tenantId)` de las reglas: el vínculo rol ↔ proveedor
 * (SEGURIDAD.md, T-19) vale también acá, o un claim mal puesto dejaría de ser
 * inerte por esta puerta. El «comercio operativo» se mira dentro de la
 * transacción, que es donde se lee la ficha.
 */
export function esAdminDelCatalogo(auth: CallableRequest['auth'], tenantId: string): boolean {
  const token = (auth?.token ?? {}) as Record<string, unknown>;
  const nc = (token['nc'] ?? {}) as { t?: Record<string, unknown> };
  const firebase = (token['firebase'] ?? {}) as { sign_in_provider?: unknown };
  return Boolean(auth?.uid)
    && (nc.t ?? {})[tenantId] === 'admin'
    && firebase.sign_in_provider === 'password'
    && token['email_verified'] === true;
}

// ---------------------------------------------------------------------------
// ENTRADA — un ítem de la importación
// ---------------------------------------------------------------------------
/** Campos que la importación puede mandar. `null` en un opcional = borrarlo. */
const CAMPOS_ENTRADA = new Set([
  'id', 'nombre', 'descripcion', 'area', 'precio', 'moneda', 'duracionMin', 'imagenUrl', 'activo',
]);
const BORRABLES = new Set(['descripcion', 'area', 'precio', 'imagenUrl']);

export type MotivoRechazo = 'forma' | 'id_invalido' | 'duplicado' | 'limite_plan';

export interface Rechazo {
  /** Posición en `items` de la llamada: con eso la consola vuelve a su fila. */
  indice: number;
  id: string;
  motivo: MotivoRechazo;
}

export interface ResultadoImportacion {
  /** Ids de los productos NUEVOS. Son los únicos que consumen cupo. */
  creados: string[];
  /** Ids de los que ya existían y se actualizaron (no consumen cupo). */
  actualizados: string[];
  rechazados: Rechazo[];
  /** Presente si al menos un ítem quedó afuera por el plan. */
  motivo?: 'limite_plan';
  /** Límite vigente y cuántos productos quedaron contados. */
  limite: number;
  items: number;
}

interface Preparado {
  indice: number;
  id: string;
  /** Lo que se escribe: `null` significa borrar el campo. */
  cambios: Record<string, unknown>;
}

/**
 * Normaliza un ítem de la entrada. Devuelve el id y los cambios, o el motivo
 * del rechazo. NO decide si es alta o actualización: eso depende de lo que hay
 * en Firestore, y se mira dentro de la transacción.
 */
export function prepararItem(crudo: unknown, indice: number): Preparado | Rechazo {
  if (typeof crudo !== 'object' || crudo === null || Array.isArray(crudo)) {
    return { indice, id: '', motivo: 'forma' };
  }
  const e = crudo as Record<string, unknown>;
  const nombre = typeof e['nombre'] === 'string' ? e['nombre'].trim() : '';
  const id = typeof e['id'] === 'string' && e['id'] !== '' ? e['id'] : idDeItem(nombre);
  if (!ID_ITEM.test(id)) return { indice, id, motivo: 'id_invalido' };
  // Lo que la regla no deja escribir, tampoco entra por acá: `stock` va por
  // `ajustarStock`, y un campo que no está en la lista blanca no existe.
  if (Object.keys(e).some((k) => !CAMPOS_ENTRADA.has(k))) return { indice, id, motivo: 'forma' };

  const cambios: Record<string, unknown> = { nombre };
  for (const campo of ['descripcion', 'area', 'precio', 'moneda', 'duracionMin', 'imagenUrl', 'activo']) {
    if (!(campo in e)) continue;
    const v = e[campo];
    if (v === null && !BORRABLES.has(campo)) return { indice, id, motivo: 'forma' };
    cambios[campo] = v;
  }
  // Quitar el precio quita la moneda: sin precio no hay nada que denominar
  // (el mismo criterio que la consola).
  if (cambios['precio'] === null) cambios['moneda'] = null;
  return { indice, id, cambios };
}

/** Aplica los cambios sobre el documento actual, como lo haría un `set` con `merge`. */
export function resultante(actual: Record<string, unknown>, cambios: Record<string, unknown>) {
  const r: Record<string, unknown> = { ...actual };
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null) delete r[k]; else r[k] = v;
  }
  return r;
}

const esRechazo = (p: Preparado | Rechazo): p is Rechazo => 'motivo' in p;

// ---------------------------------------------------------------------------
// LA CALLABLE
// ---------------------------------------------------------------------------
/**
 * `importarCatalogo({ tenantId, items })` → `ResultadoImportacion`.
 *
 * Crea o actualiza (por id, como el `set` con `merge` que hacía la consola):
 * lo que ya existe se actualiza y NO consume cupo; lo nuevo se crea mientras
 * quede cupo, en el orden en que llegó. El contador queda en lo que se contó.
 *
 * SI EL CONTADOR NO EXISTE, lo crea contando la colección dentro de la misma
 * transacción. Es el camino de un comercio nuevo: `importarCatalogo` con
 * `items: []` deja el contador listo para que la consola pueda dar altas de a
 * una por las reglas.
 */
export const importarCatalogo = onCall({ region: REGION }, async (peticion: CallableRequest) => {
  const uid = peticion.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
  const d = (peticion.data ?? {}) as Record<string, unknown>;
  const tenantId = typeof d['tenantId'] === 'string' ? d['tenantId'] : '';
  if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
  if (!esAdminDelCatalogo(peticion.auth, tenantId)) {
    throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
  }
  const entrada = d['items'];
  if (!Array.isArray(entrada)) throw new HttpsError('invalid-argument', 'Faltan los ítems.');
  if (entrada.length > MAX_ITEMS_POR_LLAMADA) {
    throw new HttpsError('invalid-argument', `Hasta ${MAX_ITEMS_POR_LLAMADA} ítems por llamada.`);
  }

  // Forma y duplicados, antes de abrir la transacción: no dependen de Firestore.
  const rechazadosPrevios: Rechazo[] = [];
  const preparados: Preparado[] = [];
  const vistos = new Set<string>();
  entrada.forEach((crudo, indice) => {
    const p = prepararItem(crudo, indice);
    if (esRechazo(p)) { rechazadosPrevios.push(p); return; }
    // Dos filas con el mismo id: gana la primera. La segunda pisaría a la
    // primera en la misma escritura y no se sabría cuál quedó.
    if (vistos.has(p.id)) { rechazadosPrevios.push({ indice, id: p.id, motivo: 'duplicado' }); return; }
    vistos.add(p.id);
    preparados.push(p);
  });

  const base = `tenants/${tenantId}`;
  const refTenant = db().doc(base);
  const refCuenta = db().doc(`${base}/cuenta/estado`);
  const refContador = db().doc(`${base}/contadores/catalogo`);
  const coleccion = db().collection(`${base}/catalogo`);

  return db().runTransaction(async (tx): Promise<ResultadoImportacion> => {
    // Todo lo que se arma acá se rearma si la transacción se reintenta.
    const creados: string[] = [];
    const actualizados: string[] = [];
    const rechazados: Rechazo[] = [...rechazadosPrevios];

    const refs = preparados.map((p) => coleccion.doc(p.id));
    const [tenant, cuenta, contador, ...actuales] =
      await tx.getAll(refTenant, refCuenta, refContador, ...refs);
    if (!tenant?.exists || tenant.get('estado') !== 'activo') {
      // Suspendido o dado de baja: igual que en las reglas, no se escribe nada.
      throw new HttpsError('failed-precondition', 'El comercio no está operativo.');
    }
    const limite = limiteDeProductos(cuenta?.data());

    let items: number;
    const guardado = contador?.get('items');
    const contadorNuevo = !contador?.exists || !Number.isInteger(guardado);
    if (contadorNuevo) {
      items = (await tx.get(coleccion.select())).size;
    } else {
      items = guardado as number;
    }

    const sello = { actualizadoPor: uid, actualizadoEn: FieldValue.serverTimestamp() };
    let ultimo = typeof contador?.get('ultimoItem') === 'string' ? String(contador.get('ultimoItem')) : '';

    preparados.forEach((p, i) => {
      const actual = actuales[i];
      if (actual?.exists) {
        if (!formaDeItemValida(resultante(actual.data() ?? {}, p.cambios))) {
          rechazados.push({ indice: p.indice, id: p.id, motivo: 'forma' });
          return;
        }
        const escritura: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p.cambios)) escritura[k] = v === null ? FieldValue.delete() : v;
        tx.set(refs[i]!, { ...escritura, ...sello }, { merge: true });
        actualizados.push(p.id);
        return;
      }
      // UN ÍTEM NUEVO SIN `activo` NACE ACTIVO. Es lo que hace la consola al
      // leer un archivo sin esa columna (`web/src/lib/csv.ts`) y lo que
      // espera quien importa: una planilla de productos es una lista de lo que
      // se ofrece. El valor se pone ANTES de validar, así que la forma que se
      // exige sigue siendo la de la regla de `create` (que pide `activo`
      // booleano) y la prueba de equivalencia no cambia. Un `activo` que viene
      // mal tipado se rechaza igual: solo se suple la AUSENCIA. En una
      // actualización no se suple nada: el ítem ya tiene el suyo.
      const nuevo = resultante('activo' in p.cambios ? {} : { activo: true }, p.cambios);
      if (!formaDeAltaValida(nuevo)) {
        rechazados.push({ indice: p.indice, id: p.id, motivo: 'forma' });
        return;
      }
      if (items >= limite) {
        rechazados.push({ indice: p.indice, id: p.id, motivo: 'limite_plan' });
        return;
      }
      tx.create(refs[i]!, { ...nuevo, ...sello });
      items += 1;
      ultimo = p.id;
      creados.push(p.id);
    });

    if (creados.length > 0 || contadorNuevo) {
      // `set` y no `update`: el contador tiene exactamente estos tres campos,
      // que es lo único que la regla del contador acepta después.
      tx.set(refContador, { items, ultimoItem: ultimo, actualizadoEn: FieldValue.serverTimestamp() });
    }

    rechazados.sort((a, b) => a.indice - b.indice);
    const cortoPorPlan = rechazados.some((r) => r.motivo === 'limite_plan');
    return {
      creados, actualizados, rechazados,
      ...(cortoPorPlan ? { motivo: 'limite_plan' as const } : {}),
      limite, items,
    };
  });
});
