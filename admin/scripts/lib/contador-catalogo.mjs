/**
 * =============================================================================
 * EL CONTADOR DEL CATÁLOGO — EL CRITERIO, EN UN SOLO LUGAR
 * =============================================================================
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `tenants/{t}/contadores/catalogo` es lo que hace
 * cumplir el límite de productos por plan (CLAUDE.md, base comercial §7): las
 * reglas de Firestore no pueden contar una colección, así que exigen que el
 * contador se mueva EN EL MISMO LOTE que cada alta o baja, y NIEGAN crear o
 * borrar un producto desde el navegador si el contador falta o no cuadra.
 *
 * Lo escriben TRES caminos: `importarCatalogo` (functions/src/limiteCatalogo.ts),
 * `scripts/contar-catalogo.mjs` y `scripts/cargar-negocio.mjs`. Un criterio
 * distinto en cualquiera de ellos deja al comercio trabado, y no se nota hasta
 * que el comercio intenta cargar un producto y recibe un error rojo. Por eso el
 * criterio vive acá y los scripts lo importan en vez de copiarlo.
 *
 * QUÉ SE CUENTA: TODOS LOS DOCUMENTOS DE `catalogo`, no solo los que tienen
 * `activo: true`. La regla `altaContada()` de `firestore.rules` suma uno por
 * cada documento que nace, sin mirar `activo`: un producto dado de baja sigue
 * ocupando cupo del plan, y por eso bajarlo no libera lugar. Contar solo los
 * activos dejaría el contador por debajo de lo que las reglas creen que hay, y
 * desde ahí el comercio podría crear productos de más.
 *
 * EL LÍMITE SE LEE DEL PLAN, NO DEL CÓDIGO. Es `limitesDeCuenta` de
 * `functions/src/planes.ts`, la misma función que usa `importarCatalogo`.
 */
import { FieldValue } from 'firebase-admin/firestore';

const { LIMITE_MAXIMO, esIdPlan, limitesDeCuenta } = await import('../../functions/src/planes.ts');

/**
 * Las ÚNICAS tres claves del documento del contador. Con una clave de más, la
 * regla del contador rechaza todo cambio y el comercio queda trabado: por eso
 * se escribe con `set` sin `merge` y por eso se comprueba al releer.
 */
export const CLAVES_CONTADOR = ['items', 'ultimoItem', 'actualizadoEn'];

/**
 * El límite de productos del comercio y de dónde sale, para el informe. El
 * número es siempre el de `limitesDeCuenta`; el origen solo lo explica.
 */
export function limiteDe(cuenta) {
  const limite = limitesDeCuenta(cuenta).productos;
  const propio = cuenta?.limites?.productos;
  const plan = cuenta?.plan;
  const origen = Number.isInteger(propio) && propio >= 1 && propio <= LIMITE_MAXIMO
    ? 'limites.productos'
    : esIdPlan(plan) ? `plan ${plan}` : `sin plan conocido${plan ? ` (${plan})` : ''}`;
  return { limite, origen };
}

/**
 * Cuántos productos hay, DENTRO de la transacción. `select()` trae solo los
 * identificadores: no baja ni un campo de cada documento.
 *
 * Va antes de cualquier escritura de la transacción, como exige Firestore, y
 * devuelve el estado ANTERIOR a lo que esa misma transacción vaya a crear:
 * quien la llama suma los productos que está por dar de alta.
 */
export async function contarProductos(tx, coleccion) {
  return (await tx.get(coleccion.select())).size;
}

/**
 * ¿El contador ya está al día? Coincidir es las dos cosas: el número correcto
 * y SOLO las tres claves.
 */
export function contadorAlDia(contador, productos) {
  return contador.exists
    && contador.get('items') === productos
    && Object.keys(contador.data() ?? {}).every((k) => CLAVES_CONTADOR.includes(k));
}

/**
 * Deja el contador en `items`. `set` sin `merge` a propósito: el documento
 * tiene exactamente `CLAVES_CONTADOR` y nada más.
 *
 * `ultimoItem` es lo que las reglas exigen a una escritura del NAVEGADOR (que
 * nombre al producto que nace o muere en ese mismo lote); en una escritura del
 * SDK Admin no se valida, y lo que quede acá no condiciona el alta siguiente
 * —la regla mira el valor RESULTANTE de ese otro lote—. Se guarda igual porque
 * es la evidencia de qué movió el contador por última vez.
 */
export function escribirContador(tx, ref, { items, ultimoItem = '' }) {
  tx.set(ref, {
    items,
    ultimoItem: typeof ultimoItem === 'string' ? ultimoItem : '',
    actualizadoEn: FieldValue.serverTimestamp(),
  });
}
