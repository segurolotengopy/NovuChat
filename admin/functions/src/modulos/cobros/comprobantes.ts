/**
 * =============================================================================
 * LA IMAGEN DEL COMPROBANTE — guardarla 90 días y borrarla
 * =============================================================================
 *
 * DECISIÓN DE ANDRES (03/10/2026), que REEMPLAZA a «los comprobantes no se
 * guardan» (`cobros.md` §4duodecies.1.6): se guarda la IMAGEN del comprobante
 * de una venta como evidencia, porque el OCR puede fallar y la foto puede salir
 * borrosa. Lo que no cambia es el cuidado, porque es un documento financiero de
 * un tercero:
 *
 *  - **Solo la lee el servidor.** `storage.rules` niega todo acceso a
 *    `tenants/{t}/comprobantes/**`, también al administrador y al propietario.
 *    No hay visor en la consola. Si hace falta mirar una imagen, es un
 *    procedimiento con el SDK Admin y el «sí» de Andres.
 *  - **Retención de 90 días**, y se borra entera con la baja del comercio. Un
 *    comprobante vive en `tenants/{t}/comprobantes/{aaaa-mm-dd}/…`: la fecha
 *    en la ruta es lo que permite borrar por carpeta sin leer cada objeto.
 *  - **El flujo manda los bytes.** El servidor no puede bajarlos de Meta: en
 *    Q'Taco el token es del receptor de AAB1 (prohibición 5).
 *  - **Sin teléfono en el nombre.** El nombre es el id del mensaje de Meta,
 *    saneado. El teléfono viaja en una cabecera solo para comprobar que hay un
 *    cobro abierto y nunca se escribe en Storage.
 *  - **El tipo se comprueba por los bytes**, no por lo que declara quien sube.
 *
 * Antecedente que se sigue: `central/pagar/cobroPrepago.ts` (`Almacen`
 * inyectable, porque el emulador de Firestore no trae Storage).
 */

import { createHash } from 'node:crypto';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { REGION } from '../../core/region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from '../../core/seguridad/firma.js';
import { diaDeLaPaz } from './cotejo.js';
import { MAX_COMPROBANTES, esReglaDos, limiteDe } from './cobroVenta.js';

export const MB = 1024 * 1024;
/** Tope de una imagen (el de WhatsApp Cloud API) y de un PDF. */
export const MAXIMO_IMAGEN = 5 * MB;
export const MAXIMO_PDF = 10 * MB;
/** Cuántos días se conserva una carpeta de comprobantes. */
export const DIAS_DE_RETENCION = 90;

const TELEFONO = /^[0-9]{8,15}$/;
const ID_TENANT = /^[a-zA-Z0-9_-]{1,60}$/;
const CARPETA_DE_DIA = /^\d{4}-\d{2}-\d{2}$/;

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
}

/** Lo mínimo que se usa de un bucket de Storage (así se puede probar sin Storage). */
export interface BucketMinimo {
  file(ruta: string): {
    save(bytes: Buffer, opciones: Record<string, unknown>): Promise<unknown>;
    exists(): Promise<[boolean]>;
  };
  getFiles(opciones: Record<string, unknown>): Promise<unknown[]>;
  deleteFiles(opciones: Record<string, unknown>): Promise<unknown>;
}

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
/** Solo con `COMPROBANTES_DOBLE` en el entorno: en producción no hay cómo sustituirlo. */
export function fijarAlmacenDeComprobantesDePrueba(a: Almacen | null): void {
  if (!process.env['COMPROBANTES_DOBLE']) {
    throw new Error('fijarAlmacenDeComprobantesDePrueba exige COMPROBANTES_DOBLE en el entorno');
  }
  almacenDePrueba = a;
}
const almacen = (): Almacen => almacenDePrueba ?? almacenDeStorage;

// ---------------------------------------------------------------------------
// LA RUTA Y EL TIPO
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

export type ExtensionDeComprobante = 'jpg' | 'png' | 'webp' | 'pdf';

export function rutaDeComprobante(tenantId: string, dia: string, idMeta: string, ext: ExtensionDeComprobante): string {
  return `tenants/${tenantId}/comprobantes/${dia}/${nombreDeObjeto(idMeta)}.${ext}`;
}

const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ¿Es esta `ruta` la que `guardarComprobante` habría dado a ESTE comercio y a
 * ESTE mensaje? El cotejo la acepta solo si sí: si no, `null`. Así el cuerpo de
 * una petición no puede hacer que un cierre apunte a un archivo ajeno.
 */
export function rutaValidaDe(ruta: unknown, tenantId: string, idMeta: string): string | null {
  if (typeof ruta !== 'string' || ruta.length > 300) return null;
  if (idMetaCrudo(idMeta) === '' || !ID_TENANT.test(tenantId)) return null;
  const patron = new RegExp(`^tenants/${escapar(tenantId)}/comprobantes/\\d{4}-\\d{2}-\\d{2}/${nombreDeObjeto(idMeta)}\\.(jpg|png|webp|pdf)$`);
  return patron.test(ruta) ? ruta : null;
}

/** El tipo real por los PRIMEROS BYTES. Lo que declare quien sube no cuenta. */
export function tipoPorFirma(bytes: Buffer): { ext: ExtensionDeComprobante; mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF'
    && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf' };
  }
  return null;
}

export type ResultadoDeGuardar =
  | { codigo: 200; cuerpo: { ruta: string } }
  | { codigo: 400 | 409 | 413 | 415 | 502; cuerpo: { error: string } };

/**
 * Antes de escribir en Storage: ¿hay cupo y ya estaba? Devuelve la ruta que se
 * usará, `guardada: true` si ya existe un objeto (no se reescribe, aunque sea de
 * otra extensión: una sola extensión por idMeta), o `'lleno'`.
 */
export type Reservar = (ruta: string) => Promise<{ ruta: string; guardada: boolean } | 'lleno'>;

/**
 * Valida y guarda. Pura salvo el almacén. Nunca escribe el teléfono.
 * 413 si pasa de 5 MB (imagen) o 10 MB (PDF); 415 si los bytes no son de un
 * tipo admitido o no coinciden con el `Content-Type` declarado.
 */
export async function guardarBytesDeComprobante(
  tenantId: string, idMeta: string, bytes: Buffer, tipoDeclarado: string,
  deps: { almacen?: Almacen; ahoraMs?: number; reservar?: Reservar } = {},
): Promise<ResultadoDeGuardar> {
  if (idMetaCrudo(idMeta) === '') return { codigo: 400, cuerpo: { error: 'falta_idmeta' } };
  if (bytes.length === 0) return { codigo: 400, cuerpo: { error: 'vacio' } };
  if (bytes.length > MAXIMO_PDF) return { codigo: 413, cuerpo: { error: 'demasiado_grande' } };
  const tipo = tipoPorFirma(bytes);
  const declarado = String(tipoDeclarado ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!tipo || declarado !== tipo.mime) return { codigo: 415, cuerpo: { error: 'tipo_no_admitido' } };
  if (tipo.ext !== 'pdf' && bytes.length > MAXIMO_IMAGEN) {
    return { codigo: 413, cuerpo: { error: 'demasiado_grande' } };
  }
  let ruta = rutaDeComprobante(tenantId, diaDeLaPaz(deps.ahoraMs ?? Date.now()), idMeta, tipo.ext);
  if (deps.reservar) {
    const r = await deps.reservar(ruta);
    if (r === 'lleno') return { codigo: 409, cuerpo: { error: 'demasiados_comprobantes' } };
    if (r.guardada) return { codigo: 200, cuerpo: { ruta: r.ruta } };
    ruta = r.ruta;
  }
  try {
    // Con `ifGenerationMatch: 0` una evidencia nunca se sobrescribe.
    await (deps.almacen ?? almacen()).guardar(ruta, bytes, tipo.mime);
  } catch {
    // El cotejo no depende de esto: el flujo sigue con `ruta: null`.
    return { codigo: 502, cuerpo: { error: 'no_se_guardo' } };
  }
  return { codigo: 200, cuerpo: { ruta } };
}

// ---------------------------------------------------------------------------
// POST guardarComprobante
// ---------------------------------------------------------------------------

/**
 * Binario en el cuerpo; cabeceras `X-NovuChat-Telefono`, `X-NovuChat-IdMeta` y
 * `Content-Type`. SOLO con el token por número: la firma HMAC de `firma.ts` cubre
 * el cuerpo y esa verificación se niega a más de 64 KB, así que una imagen no
 * puede firmarse. n8n usa el token, que es lo que corresponde.
 *
 * 409 si el teléfono no tiene un cobro de regla 2 abierto o en revisión o
 * recién vencido: sin eso, el token de un comercio serviría para llenar el
 * depósito de cualquier cosa.
 */
export const guardarComprobante = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
    // Hasta 10 MB de PDF más el sobre HTTP.
    memory: '512MiB',
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    // SOLO VALE EL TOKEN. Una firma no puede cubrir una imagen (`firma.ts` se
    // niega a más de 64 KB), así que una petición que trae `X-NovuChat-Signature`
    // se rechaza antes de mirar nada más: no hay un segundo camino a probar.
    if (peticion.get('X-NovuChat-Signature')) { respuesta.status(401).send('no autorizado'); return; }
    const ruta = await rutaAutenticada({ get: (n: string) => peticion.get(n) });
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const telefono = String(peticion.get('X-NovuChat-Telefono') ?? '').trim();
    const idMeta = idMetaCrudo(peticion.get('X-NovuChat-IdMeta'));
    if (!TELEFONO.test(telefono)) { respuesta.status(400).json({ error: 'telefono invalido' }); return; }
    if (idMeta === '') { respuesta.status(400).json({ error: 'falta_idmeta' }); return; }
    const bytes = Buffer.isBuffer(peticion.rawBody) ? peticion.rawBody : Buffer.alloc(0);

    // ¿Hay un cobro de regla 2 al que este comprobante pueda pertenecer?
    const refConversacion = getFirestore().doc(`tenants/${ruta.tenantId}/conversaciones/wa_${telefono}`);
    const conversacion = await refConversacion.get();
    const solicitud = conversacion.get('solicitud') as Record<string, unknown> | undefined;
    if (!conversacion.exists || !puedeSubir(solicitud, Date.now())) {
      respuesta.status(409).json({ error: 'sin_cobro_pendiente' }); return;
    }

    // EL TOPE CUENTA SUBIDAS (no solo cotejos): cada imagen nueva anota su
    // idMeta en la solicitud, en una transacción (una escritura por imagen).
    const a = almacen();
    const reservar: Reservar = async (rutaNueva) => {
      const previa = entradaDe(solicitud, idMeta);
      if (previa && await a.existe(previa.ruta)) return { ruta: previa.ruta, guardada: true };
      return reservarSubida(refConversacion, idMeta, rutaNueva, Date.now());
    };
    const r = await guardarBytesDeComprobante(
      ruta.tenantId, idMeta, bytes, String(peticion.get('Content-Type') ?? ''), { almacen: a, reservar });
    respuesta.status(r.codigo).json(r.cuerpo);
  },
);

/**
 * La reserva de cupo, en una transacción (una escritura por imagen nueva). Se
 * vuelve a comprobar `puedeSubir` ADENTRO: entre la lectura de la petición y la
 * transacción el cobro pudo cambiar. Si el `idMeta` ya tenía entrada, se
 * CONSERVA su ruta (una sola extensión por idMeta).
 */
export async function reservarSubida(
  refConversacion: FirebaseFirestore.DocumentReference, idMeta: string, rutaNueva: string, ahoraMs: number,
): Promise<{ ruta: string; guardada: boolean } | 'lleno'> {
  return getFirestore().runTransaction(async (tx) => {
    const actual = (await tx.get(refConversacion)).get('solicitud') as Record<string, unknown> | undefined;
    if (!puedeSubir(actual, ahoraMs)) return 'lleno' as const;
    const lista = subidasDe(actual);
    const previa = lista.find((x) => x.idMeta === idMeta);
    if (previa) return { ruta: previa.ruta, guardada: false };
    if (lista.length >= MAX_COMPROBANTES) return 'lleno' as const;
    tx.set(refConversacion, { solicitud: { subidas: [...lista, { idMeta, ruta: rutaNueva }] } }, { merge: true });
    return { ruta: rutaNueva, guardada: false };
  });
}

/** Las imágenes ya subidas para este cobro: `{idMeta, ruta}`, hasta seis. */
function subidasDe(s: Record<string, unknown> | undefined): { idMeta: string; ruta: string }[] {
  return Array.isArray(s?.['subidas']) ? (s?.['subidas'] as { idMeta: string; ruta: string }[]) : [];
}
const entradaDe = (s: Record<string, unknown> | undefined, idMeta: string) =>
  subidasDe(s).find((x) => x.idMeta === idMeta);

const VEINTICUATRO_HORAS = 24 * 60 * 60_000;
const milis = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return typeof t?.toMillis === 'function' ? t.toMillis() : null;
};

/**
 * ¿Todavía se aceptan imágenes para este cobro? Regla 2 y la misma ventana que
 * la máquina de estados para el tardío: hasta 24 h después del límite efectivo
 * (`qr_enviado`, aunque venza por reloj sin que nadie lo haya anotado, y
 * `vencida`) o, en `en_revision`, 24 h desde que entró en revisión (`desde`).
 */
export function puedeSubir(s: Record<string, unknown> | undefined, ahoraMs: number): boolean {
  if (!s || !esReglaDos(s)) return false;
  const etapa = String(s['etapa'] ?? '');
  if (etapa === 'qr_enviado' || etapa === 'vencida') {
    const limite = limiteDe(s);
    return limite !== null && ahoraMs - limite <= VEINTICUATRO_HORAS;
  }
  if (etapa === 'en_revision') {
    const desde = milis(s['desde']) ?? limiteDe(s);
    return desde !== null && ahoraMs - desde <= VEINTICUATRO_HORAS;
  }
  return false;
}

// ---------------------------------------------------------------------------
// LA PURGA DIARIA
// ---------------------------------------------------------------------------

export interface ResultadoDePurga {
  tenantsRevisados: number;
  carpetasBorradas: number;
  objetosBorrados: number;
  tenantsDeBajaBorrados: number;
}

/** Días enteros entre dos días `aaaa-mm-dd`. */
function diasEntre(hoy: string, otro: string): number {
  return Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${otro}T00:00:00Z`)) / 86_400_000);
}

/**
 * Borra las carpetas de comprobantes con MÁS de 90 días (91 se borra; 90 y 89 se
 * conservan) y la carpeta ENTERA de los comercios dados de baja. Por eso el
 * borrado por baja ocurre dentro de las 24 h siguientes (decisión P4).
 * Costo: una lectura por comercio (`select('estado')`) más un listado por
 * comercio activo.
 */
export async function purgarComprobantesDe(
  deps: { almacen?: Almacen; ahoraMs?: number } = {},
): Promise<ResultadoDePurga> {
  const a = deps.almacen ?? almacen();
  const hoy = diaDeLaPaz(deps.ahoraMs ?? Date.now());
  const fichas = await getFirestore().collection('tenants').select('estado').get();
  const r: ResultadoDePurga = { tenantsRevisados: 0, carpetasBorradas: 0, objetosBorrados: 0, tenantsDeBajaBorrados: 0 };
  for (const ficha of fichas.docs) {
    if (!ID_TENANT.test(ficha.id)) continue;
    r.tenantsRevisados++;
    const base = `tenants/${ficha.id}/comprobantes/`;
    if (ficha.get('estado') === 'dado_de_baja') {
      const n = await a.borrarPrefijo(base);
      if (n > 0) r.tenantsDeBajaBorrados++;
      r.objetosBorrados += n;
      continue;
    }
    for (const nombre of await a.subcarpetas(base)) {
      if (!CARPETA_DE_DIA.test(nombre)) continue;
      if (diasEntre(hoy, nombre) > DIAS_DE_RETENCION) {
        r.objetosBorrados += await a.borrarPrefijo(`${base}${nombre}/`);
        r.carpetasBorradas++;
      }
    }
  }
  return r;
}

/** Todos los días a las 03:30 de La Paz, después de la ventana de mantenimiento (de 2 a 3). */
export const purgarComprobantes = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'America/La_Paz', region: REGION, timeoutSeconds: 540, maxInstances: 1 },
  async () => {
    const r = await purgarComprobantesDe();
    console.info(`purga de comprobantes: ${JSON.stringify(r)}`);
  },
);
