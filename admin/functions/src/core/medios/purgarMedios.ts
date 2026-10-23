/**
 * LA PURGA DIARIA DE MEDIOS: borra las carpetas de más de 90 días (91 se borra;
 * 90 y 89 se conservan) y, con la baja del comercio, el prefijo entero más sus
 * `mediosRecibidos` y `cuposDeMedios`. Los documentos de `mediosRecibidos` y de
 * `cuposDeMedios` también caducan solos por TTL sobre `vence`; la purga cubre
 * la baja y el retraso del TTL. Si un comercio falla, sigue con los demás. Lo
 * que se anota: cuentas, nunca teléfonos ni rutas.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import {
  CARPETA_DE_DIA, DIAS_DE_RETENCION, ID_TENANT, almacenDeMedios, diaDeLaPaz, diasEntre, type Almacen,
} from './almacen.js';

export interface ResultadoDePurga {
  tenantsRevisados: number;
  carpetasBorradas: number;
  objetosBorrados: number;
  tenantsDeBajaBorrados: number;
  /** Comercios cuya purga falló: se sigue con los demás. */
  errores: number;
}

export async function purgarMediosDe(
  deps: { almacen?: Almacen; ahoraMs?: number } = {},
): Promise<ResultadoDePurga> {
  const a = deps.almacen ?? almacenDeMedios();
  const hoy = diaDeLaPaz(deps.ahoraMs ?? Date.now());
  const db = getFirestore();
  const fichas = await db.collection('tenants').select('estado').get();
  const r: ResultadoDePurga = { tenantsRevisados: 0, carpetasBorradas: 0, objetosBorrados: 0, tenantsDeBajaBorrados: 0, errores: 0 };
  for (const ficha of fichas.docs) {
    if (!ID_TENANT.test(ficha.id)) continue;
    r.tenantsRevisados++;
    try {
      const base = `tenants/${ficha.id}/medios/`;
      if (ficha.get('estado') === 'dado_de_baja') {
        const n = await a.borrarPrefijo(base);
        if (n > 0) r.tenantsDeBajaBorrados++;
        r.objetosBorrados += n;
        await db.recursiveDelete(db.collection(`tenants/${ficha.id}/mediosRecibidos`));
        await db.recursiveDelete(db.collection(`tenants/${ficha.id}/cuposDeMedios`));
        continue;
      }
      for (const nombre of await a.subcarpetas(base)) {
        if (!CARPETA_DE_DIA.test(nombre)) continue;
        if (diasEntre(hoy, nombre) > DIAS_DE_RETENCION) {
          r.objetosBorrados += await a.borrarPrefijo(`${base}${nombre}/`);
          r.carpetasBorradas++;
        }
      }
    } catch (error) {
      // Solo el código, nunca el mensaje (puede traer rutas) ni datos personales.
      r.errores++;
      const codigo = (error as { code?: unknown } | null)?.code;
      console.error(`purga de medios: falló un comercio (código ${typeof codigo === 'string' || typeof codigo === 'number' ? codigo : 'desconocido'})`);
    }
  }
  return r;
}

/** Todos los días a las 03:45 de La Paz (después de la purga de comprobantes, 03:30). */
export const purgarMedios = onSchedule(
  { schedule: '45 3 * * *', timeZone: 'America/La_Paz', region: REGION, timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const r = await purgarMediosDe();
    console.info(`purga de medios: ${JSON.stringify(r)}`);
  },
);
