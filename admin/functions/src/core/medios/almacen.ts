/**
 * =============================================================================
 * EL ALMACÉN DE MEDIOS ENTRANTES (Core) — Storage inyectable y rutas
 * =============================================================================
 *
 * COPIA DECLARADA de `Almacen`, `crearAlmacenDeStorage`, `idMetaCrudo` y
 * `nombreDeObjeto` de `modulos/cobros/comprobantes.ts`. Se copia y no se
 * importa porque Core no puede depender de un módulo (`fronteras.test.ts`).
 * Que Cobros pase a importar de aquí es un PR aparte del agente `modulo`; hasta
 * entonces, si cambia una de las dos, cambia la otra.
 *
 * La copia difiere en una cosa a propósito: aquí `guardar` graba
 * `contentDisposition: 'attachment'` (contrato de medios v2, adenda §7.3).
 *
 * Los medios entrantes (imagen, audio, video y documentos de cualquier tipo) se guardan 90 días en
 * `tenants/{t}/medios/{aaaa-mm-dd}/{nombreDeObjeto(idMeta)}.{ext}`: la fecha en
 * la ruta permite borrar por carpeta sin leer cada objeto, y el nombre es un
 * hash del id de Meta, de modo que NI el teléfono NI el id de Meta aparecen en
 * Storage.
 */

import { createHash } from 'node:crypto';
import { getStorage } from 'firebase-admin/storage';

export interface Almacen {
  /** Guarda SOLO si no existe (`ifGenerationMatch: 0`): un medio nunca se sobrescribe. */
  guardar(ruta: string, bytes: Buffer, contentType: string): Promise<'creado' | 'existe'>;
  existe(ruta: string): Promise<boolean>;
  /** Los nombres de las subcarpetas inmediatas de un prefijo que termina en «/». */
  subcarpetas(prefijo: string): Promise<string[]>;
  /** Borra todo lo que cuelga del prefijo. Devuelve cuántos objetos había. */
  borrarPrefijo(prefijo: string): Promise<number>;
  /** El tamaño del objeto SIN descargarlo, o `null` si no existe (404). */
  metadatos(ruta: string): Promise<{ tamano: number } | null>;
  /** Los bytes del objeto, o `null` si no existe (404). Cualquier otro error se relanza. */
  leer(ruta: string): Promise<Buffer | null>;
}

/** Lo mínimo que se usa de un bucket de Storage (así se prueba sin Storage). */
export interface BucketMinimo {
  file(ruta: string): {
    save(bytes: Buffer, opciones: Record<string, unknown>): Promise<unknown>;
    exists(): Promise<[boolean]>;
    download(): Promise<[Buffer]>;
    getMetadata(): Promise<[Record<string, unknown>, ...unknown[]]>;
  };
  getFiles(opciones: Record<string, unknown>): Promise<unknown[]>;
  deleteFiles(opciones: Record<string, unknown>): Promise<unknown>;
}

const esNoEncontrado = (e: unknown): boolean => {
  const codigo = (e as { code?: unknown } | null)?.code;
  return codigo === 404 || codigo === '404';
};

export function crearAlmacenDeStorage(bucket: () => BucketMinimo): Almacen {
  return {
    async guardar(ruta, bytes, contentType) {
      try {
        // `contentDisposition: 'attachment'` en TODOS los objetos (adenda §7.3 del contrato de medios v2):
        // si alguna vez un objeto llegara a servirse por URL, el navegador lo descarga, no lo abre ni lo
        // ejecuta en línea. El `contentType` lo decide quien llama (`contentTypeDeObjeto`).
        await bucket().file(ruta).save(bytes, {
          contentType, resumable: false,
          metadata: { cacheControl: 'private, max-age=0', contentDisposition: 'attachment' },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        return 'creado';
      } catch (e) {
        const codigo = (e as { code?: unknown }).code;
        if (codigo === 412 || codigo === '412') return 'existe';
        throw e;
      }
    },
    async existe(ruta) {
      const [hay] = await bucket().file(ruta).exists();
      return hay;
    },
    async metadatos(ruta) {
      try {
        const [meta] = await bucket().file(ruta).getMetadata();
        const tamano = Number(meta['size']);
        return { tamano: Number.isFinite(tamano) && tamano >= 0 ? tamano : Number.POSITIVE_INFINITY };
      } catch (e) {
        if (esNoEncontrado(e)) return null;
        throw e;
      }
    },
    async leer(ruta) {
      try {
        const [bytes] = await bucket().file(ruta).download();
        return bytes;
      } catch (e) {
        if (esNoEncontrado(e)) return null;
        throw e;
      }
    },
    async subcarpetas(prefijo) {
      const [, , api] = await bucket()
        .getFiles({ prefix: prefijo, delimiter: '/', autoPaginate: false }) as [unknown, unknown, unknown];
      const prefijos = ((api as { prefixes?: string[] } | undefined)?.prefixes ?? []);
      return prefijos.map((p) => p.slice(prefijo.length).replace(/\/$/, '')).filter((n) => n !== '');
    },
    async borrarPrefijo(prefijo) {
      const b = bucket();
      const [archivos] = await b.getFiles({ prefix: prefijo }) as [unknown[]];
      await b.deleteFiles({ prefix: prefijo, force: true });
      return archivos.length;
    },
  };
}

const almacenDeStorage: Almacen = crearAlmacenDeStorage(() => getStorage().bucket() as unknown as BucketMinimo);

let almacenDePrueba: Almacen | null = null;
/** Solo con `MEDIOS_DOBLE` en el entorno: en producción no hay cómo sustituirlo. */
export function fijarAlmacenDeMediosDePrueba(a: Almacen | null): void {
  if (!process.env['MEDIOS_DOBLE']) {
    throw new Error('fijarAlmacenDeMediosDePrueba exige MEDIOS_DOBLE en el entorno');
  }
  almacenDePrueba = a;
}
export const almacenDeMedios = (): Almacen => almacenDePrueba ?? almacenDeStorage;

// ---------------------------------------------------------------------------
// NOMBRES Y FECHAS
// ---------------------------------------------------------------------------

/** El id de Meta tal como llega: recortado, sin espacios en los bordes. */
export const idMetaCrudo = (idMeta: unknown): string => String(idMeta ?? '').trim().slice(0, 120);

/** sha256 del idMeta CRUDO en base64url (43 caracteres): solo un nombre, no reversible. */
export function nombreDeObjeto(idMeta: string): string {
  return createHash('sha256').update(idMetaCrudo(idMeta)).digest('base64url');
}

/** La fecha de La Paz (UTC-4 fijo, sin horario de verano) como `aaaa-mm-dd`. */
export function diaDeLaPaz(ms: number): string {
  return new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
}

export const ID_TENANT = /^[a-zA-Z0-9_-]{1,60}$/;
export const CARPETA_DE_DIA = /^\d{4}-\d{2}-\d{2}$/;
export const DIA_MS = 86_400_000;
/** Cuántos días se conserva una carpeta de medios. */
export const DIAS_DE_RETENCION = 90;

/** Días enteros entre dos días `aaaa-mm-dd`. */
export function diasEntre(hoy: string, otro: string): number {
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${otro}T00:00:00Z`)) / DIA_MS);
}
