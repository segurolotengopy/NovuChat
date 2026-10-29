/**
 * =============================================================================
 * ALMACÉN DE MEDIOS — lo genérico que comparten el guardado de medios entrantes
 * (Core) y las imágenes de comprobantes (Cobros)
 * =============================================================================
 *
 * Estas piezas vivían en `modulos/cobros/comprobantes.ts`. Se mudan aquí SIN
 * cambiar su lógica porque el guardado de medios es del Core (todo tenant, sin
 * exigir un cobro abierto) y el Core no puede importar de un módulo: la
 * dependencia va hacia abajo (`Analisis/41` §1.4). Cobros las importa de aquí.
 *
 * Qué hay:
 *  - `Almacen` (Storage inyectable: el emulador de Firestore no trae Storage).
 *  - El nombre del objeto (sha256 del id de Meta) y el día de La Paz.
 *  - El tipo por los PRIMEROS BYTES (imágenes, PDF y audio).
 *  - El recorrido de la purga por retención y por baja del comercio.
 */

import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export const MB = 1024 * 1024;
export const ID_TENANT = /^[a-zA-Z0-9_-]{1,60}$/;
const CARPETA_DE_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Bolivia no cambia de hora: UTC−4 todo el año. */
const OFFSET_LA_PAZ_HORAS = -4;

/** El día calendario de La Paz (`aaaa-mm-dd`) de un instante. */
export function diaDeLaPaz(ms: number): string {
  return new Date(ms + OFFSET_LA_PAZ_HORAS * 3_600_000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// STORAGE, inyectable
// ---------------------------------------------------------------------------

export interface Almacen {
  /**
   * Guarda SOLO si no existe (`ifGenerationMatch: 0`): una evidencia nunca se
   * sobrescribe. Devuelve `existe` si ya estaba, y no la toca.
   */
  guardar(ruta: string, bytes: Buffer, contentType: string): Promise<'creado' | 'existe'>;
  /** ¿Ya hay un objeto en esa ruta? */
  existe(ruta: string): Promise<boolean>;
  /** Los nombres de las subcarpetas inmediatas de un prefijo que termina en «/». */
  subcarpetas(prefijo: string): Promise<string[]>;
  /** Borra todo lo que cuelga del prefijo. Devuelve cuántos objetos había. */
  borrarPrefijo(prefijo: string): Promise<number>;
  /**
   * El tamaño del objeto SIN descargarlo, o `null` si no existe (404). Lo usa el
   * visor para rechazar un archivo demasiado grande antes de traerlo.
   */
  metadatos(ruta: string): Promise<{ tamano: number } | null>;
  /** Los bytes del objeto, o `null` si no existe (404). Cualquier otro error se relanza. */
  leer(ruta: string): Promise<Buffer | null>;
}

/** Lo mínimo que se usa de un bucket de Storage (así se puede probar sin Storage). */
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

/** ¿Es un 404 del SDK de Storage? (el código llega como número o como cadena). */
const esNoEncontrado = (e: unknown): boolean => {
  const codigo = (e as { code?: unknown } | null)?.code;
  return codigo === 404 || codigo === '404';
};

export function crearAlmacenDeStorage(bucket: () => BucketMinimo): Almacen {
  return {
  async guardar(ruta, bytes, contentType) {
    try {
      await bucket().file(ruta).save(bytes, {
        contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      return 'creado';
    } catch (e) {
      // 412: la precondición falló, o sea que el objeto ya existía.
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
      // `size` llega como cadena en la API JSON de Storage.
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

/** El almacén real, sobre el bucket por defecto. */
export const almacenDeStorage: Almacen = crearAlmacenDeStorage(() => getStorage().bucket() as unknown as BucketMinimo);

// ---------------------------------------------------------------------------
// EL NOMBRE Y EL TIPO
// ---------------------------------------------------------------------------

/** El id de Meta tal como llega: recortado, sin espacios en los bordes. */
export const idMetaCrudo = (idMeta: unknown): string => String(idMeta ?? '').trim().slice(0, 120);

/**
 * El NOMBRE del objeto: sha256 del idMeta CRUDO en base64url (43 caracteres).
 * El saneo con pérdida de antes hacía chocar a `wamid.a+b` con `wamid.a/b`, y un
 * choque con `ifGenerationMatch: 0` es una evidencia que no se puede guardar.
 * El hash no es reversible a un teléfono ni a nada: es solo un nombre.
 */
export function nombreDeObjeto(idMeta: string): string {
  return createHash('sha256').update(idMetaCrudo(idMeta)).digest('base64url');
}

export type ExtensionDeImagenOPdf = 'jpg' | 'png' | 'webp' | 'pdf';
export type ExtensionDeAudio = 'ogg' | 'm4a' | 'mp3' | 'amr';
export type ExtensionDeMedio = ExtensionDeImagenOPdf | ExtensionDeAudio;
export type TipoDeMedio = 'imagen' | 'pdf' | 'audio';

const empieza = (bytes: Buffer, firma: readonly number[]): boolean =>
  bytes.length >= firma.length && firma.every((b, i) => bytes[i] === b);
const texto = (bytes: Buffer, desde: number, hasta: number): string => bytes.subarray(desde, hasta).toString('latin1');

/**
 * El tipo real por los PRIMEROS BYTES. Lo que declare quien sube no cuenta.
 * Imágenes y PDF (los de siempre) más audio: ogg («OggS»: las notas de voz de
 * WhatsApp), m4a/mp4 («ftyp» en el byte 4), mp3 (cabecera «ID3» o sincronía de
 * trama 0xFFEx) y amr («#!AMR»).
 */
export function tipoDeMedioPorFirma(bytes: Buffer): { ext: ExtensionDeMedio; mime: string; tipo: TipoDeMedio } | null {
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg', tipo: 'imagen' };
  if (empieza(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png', tipo: 'imagen' };
  if (bytes.length >= 12 && texto(bytes, 0, 4) === 'RIFF' && texto(bytes, 8, 12) === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp', tipo: 'imagen' };
  }
  if (bytes.length >= 5 && texto(bytes, 0, 5) === '%PDF-') return { ext: 'pdf', mime: 'application/pdf', tipo: 'pdf' };
  if (bytes.length >= 4 && texto(bytes, 0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg', tipo: 'audio' };
  if (bytes.length >= 12 && texto(bytes, 4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4', tipo: 'audio' };
  if (bytes.length >= 5 && texto(bytes, 0, 5) === '#!AMR') return { ext: 'amr', mime: 'audio/amr', tipo: 'audio' };
  if (bytes.length >= 3 && texto(bytes, 0, 3) === 'ID3') return { ext: 'mp3', mime: 'audio/mpeg', tipo: 'audio' };
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    return { ext: 'mp3', mime: 'audio/mpeg', tipo: 'audio' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// LA PURGA POR RETENCIÓN Y POR BAJA
// ---------------------------------------------------------------------------

export interface ResultadoDePurga {
  tenantsRevisados: number;
  carpetasBorradas: number;
  objetosBorrados: number;
  tenantsDeBajaBorrados: number;
  /** Comercios cuya purga falló: se sigue con los demás. */
  errores: number;
}

/** Días enteros entre dos días `aaaa-mm-dd`. */
function diasEntre(hoy: string, otro: string): number {
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${otro}T00:00:00Z`)) / 86_400_000);
}

/**
 * Borra las carpetas de día con MÁS de `dias` días (91 se borra; 90 y 89 se
 * conservan) bajo `tenants/{t}/{carpeta}/` y, con la baja del comercio, la
 * carpeta ENTERA y la colección de registros (`coleccionRecibidos`). Costo: una
 * lectura por comercio (`select('estado')`) más un listado por comercio activo.
 * Un comercio que falla no detiene a los demás: solo se cuenta.
 */
export async function purgarPorRetencion(opciones: {
  almacen: Almacen; ahoraMs: number; carpeta: string; coleccionRecibidos: string; dias: number; etiqueta: string;
}): Promise<ResultadoDePurga> {
  const { almacen: a, carpeta, coleccionRecibidos, dias, etiqueta } = opciones;
  const hoy = diaDeLaPaz(opciones.ahoraMs);
  const fichas = await getFirestore().collection('tenants').select('estado').get();
  const r: ResultadoDePurga = { tenantsRevisados: 0, carpetasBorradas: 0, objetosBorrados: 0, tenantsDeBajaBorrados: 0, errores: 0 };
  for (const ficha of fichas.docs) {
    if (!ID_TENANT.test(ficha.id)) continue;
    r.tenantsRevisados++;
    try {
      const base = `tenants/${ficha.id}/${carpeta}/`;
      if (ficha.get('estado') === 'dado_de_baja') {
        const n = await a.borrarPrefijo(base);
        if (n > 0) r.tenantsDeBajaBorrados++;
        r.objetosBorrados += n;
        // Los registros del comercio también se van con la baja: sin los
        // archivos, sus filas ya no sirven y guardan un id de conversación.
        await getFirestore().recursiveDelete(getFirestore().collection(`tenants/${ficha.id}/${coleccionRecibidos}`));
        continue;
      }
      for (const nombre of await a.subcarpetas(base)) {
        if (!CARPETA_DE_DIA.test(nombre)) continue;
        if (diasEntre(hoy, nombre) > dias) {
          r.objetosBorrados += await a.borrarPrefijo(`${base}${nombre}/`);
          r.carpetasBorradas++;
        }
      }
    } catch (error) {
      // Solo el código, nunca el mensaje (puede traer rutas) ni datos personales.
      r.errores++;
      const codigo = (error as { code?: unknown } | null)?.code;
      console.error(`purga de ${etiqueta}: falló un comercio (código ${typeof codigo === 'string' || typeof codigo === 'number' ? codigo : 'desconocido'})`);
    }
  }
  return r;
}
