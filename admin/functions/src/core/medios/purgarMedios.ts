/**
 * LA PURGA DIARIA DE MEDIOS: borra las carpetas de `medios` de más de 90 días (91 se borra;
 * 90 y 89 se conservan), las de `mediosEnviados` de más de 30 (31 se borra; 30 y 29 se conservan; B2 de
 * «Envío de medios por consola», decisión D2) y, con la baja del comercio, los dos prefijos enteros más sus
 * `mediosRecibidos`, `mediosEnviados`, `cuposDeMedios` y el contador `topesDeEnvio/a_{comercio}`. Los documentos de `mediosRecibidos` y de
 * `cuposDeMedios` también caducan solos por TTL sobre `vence`; la purga cubre
 * la baja y el retraso del TTL. Si un comercio falla, sigue con los demás. Lo
 * que se anota: cuentas, nunca teléfonos ni rutas.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from '../region.js';
import {
  CARPETA_DE_DIA, DIAS_DE_RETENCION, DIAS_DE_RETENCION_ENVIADOS, ID_TENANT, almacenDeMedios, diaDeLaPaz, diasEntre, type Almacen,
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
      const baseEnviados = `tenants/${ficha.id}/mediosEnviados/`;
      if (ficha.get('estado') === 'dado_de_baja') {
        const n = await a.borrarPrefijo(base) + await a.borrarPrefijo(baseEnviados);
        if (n > 0) r.tenantsDeBajaBorrados++;
        r.objetosBorrados += n;
        await db.recursiveDelete(db.collection(`tenants/${ficha.id}/mediosRecibidos`));
        await db.recursiveDelete(db.collection(`tenants/${ficha.id}/mediosEnviados`));
        await db.recursiveDelete(db.collection(`tenants/${ficha.id}/cuposDeMedios`));
        await db.doc(`topesDeEnvio/a_${ficha.id}`).delete();
        continue;
      }
      for (const [prefijo, retencion] of [[base, DIAS_DE_RETENCION], [baseEnviados, DIAS_DE_RETENCION_ENVIADOS]] as const) {
        for (const nombre of await a.subcarpetas(prefijo)) {
          if (!CARPETA_DE_DIA.test(nombre)) continue;
          if (diasEntre(hoy, nombre) > retencion) {
            r.objetosBorrados += await a.borrarPrefijo(`${prefijo}${nombre}/`);
            r.carpetasBorradas++;
          }
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
    // Texto FIJO y buscable para una alerta de registros (severidad ERROR): ver core.md, «Medios entrantes guardados».
    if (r.errores > 0) console.error(`PURGA_MEDIOS_CON_ERRORES comercios_con_error=${r.errores}`);
  },
);
