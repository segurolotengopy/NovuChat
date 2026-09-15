/**
 * =============================================================================
 * EL FLUJO DE CAPTACIÓN (`onboarding`), DEL LADO DEL SERVIDOR
 * =============================================================================
 *
 * Nació como el flujo propio de NovuChat y desde el 15/09 es un TERCER FLUJO
 * GENÉRICO, igual que agendamiento y venta: cualquier comercio con `onboarding`
 * en `tenants/{id}.flujos` lo usa, y lo configura su administrador desde la
 * consola (`/tenants/{t}/config/onboarding`).
 *
 * POR QUÉ HAY UN SANEO ACÁ Y NO ALCANZA CON LAS REGLAS. Las reglas de Firestore
 * no saben recorrer los elementos de una lista: comprueban que `rubros` sea una
 * lista de 8 como mucho, pero no qué hay adentro de cada rubro. Lo de adentro
 * lo escribió el comercio y termina en boca del asistente —«el plan Pro cuesta
 * USD 50 al mes»—, así que ESTE es el punto donde se valida elemento por
 * elemento, antes de que `configuracionFlujo` lo mande al flujo. Es la misma
 * división que `datosQueNoTenemos` (SEGURIDAD.md, T-27).
 *
 * EL CRITERIO: DESCARTAR, NUNCA CORREGIR INVENTANDO. Un plan con el precio
 * fuera de rango no se «arregla» a cero: se descarta, porque un precio
 * inventado dicho por el asistente es peor que un plan que no menciona. Lo
 * único que se corrige es la FORMA del texto —se recorta a su largo y se le
 * quitan saltos de línea y controles—, que no cambia lo que dice.
 *
 * Este módulo no toca Firestore en la parte del saneo: son funciones puras, con
 * sus pruebas en `pruebas/captacion.test.ts`, sin emulador ni red.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { textoPlano, textoConSaltos } from './saneo.js';
import { pedirConFrenos, tipoDeContenido, type MotivoFalla } from './imagenCatalogo.js';

// ---------------------------------------------------------------------------
// 1. LA FORMA DE CADA ELEMENTO
// ---------------------------------------------------------------------------

export const FLUJOS_SUGERIDOS = ['agendamiento', 'venta', 'recordatorios', 'a_medida'] as const;
export const PERIODOS = ['mes', 'anio', 'unico'] as const;
export const TIPOS_ARCHIVO = ['pdf', 'imagen'] as const;

/**
 * Topes de cada lista. Los mismos que las reglas (`configOnboardingValida`):
 * acá se vuelven a aplicar porque el documento también se puede escribir con
 * el SDK Admin, que no pasa por las reglas.
 */
export const TOPES_CAPTACION = {
  rubros: 8,
  planes: 20,
  cargosUnicos: 5,
  aclaraciones: 15,
  /**
   * Con MÁS planes que esto, la respuesta en texto sería demasiado larga para
   * un chat —y un mensaje largo son varios cortos en la factura de Meta—: se
   * manda el archivo. Las reglas exigen `archivoPlanes` en ese caso.
   */
  planesEnTexto: 5,
} as const;

const PRECIO_MAXIMO_USD = 100_000;
const ID_RUBRO = /^[a-z0-9-]{1,30}$/;
const PLANTILLA = /^[a-z0-9_]{1,64}$/;
/** El mismo patrón que `configOnboardingValida` aplica a `enlaceConsola`. */
const ENLACE_CONSOLA = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?#=&%-]*)?$/;
/** Sin espacios ni comillas: el filtro de las URL mal pegadas (ver `urlImagenValida`). */
const URL_ARCHIVO = /^https:\/\/[^\s'"<>]+$/;

export type FlujoSugerido = typeof FLUJOS_SUGERIDOS[number];
export type Periodo = typeof PERIODOS[number];
export type TipoArchivo = typeof TIPOS_ARCHIVO[number];

export interface Rubro { id: string; nombre: string; solucion: string; flujoSugerido: FlujoSugerido }
export interface Plan { nombre: string; precioUsd: number; periodo: Periodo; incluye: string }
export interface CargoUnico { nombre: string; precioUsd: number; desde: boolean; detalle: string }
export interface Aclaracion { tema: string; texto: string }
export interface ArchivoPlanes { url: string; tipo: TipoArchivo; nombreArchivo: string }

/** Lo que recibe el flujo en la clave `onboarding` de `configuracionFlujo`. */
export interface CaptacionSaneada {
  mensajeClienteActual: string;
  enlaceConsola: string;
  topeAviso: number;
  plantillaAviso: string;
  rubros: Rubro[];
  planes: Plan[];
  cargosUnicos: CargoUnico[];
  aclaraciones: Aclaracion[];
  archivoPlanes: ArchivoPlanes | null;
  /** `planes.length > 5`: el flujo manda el archivo en vez de recitar la lista. */
  planesEnArchivo: boolean;
}

type Crudo = Record<string, unknown>;
const esObjeto = (v: unknown): v is Crudo =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const de = <T extends string>(lista: readonly T[], v: unknown): T | null =>
  (lista as readonly unknown[]).includes(v) ? v as T : null;
/** Un precio: número finito entre 0 y el tope. Cualquier otra cosa es `null`. */
const precio = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= PRECIO_MAXIMO_USD ? v : null;
/**
 * Lista cruda, cortada a su tope ANTES de mirar los elementos. Así un documento
 * escrito por fuera de las reglas con diez mil elementos no le cuesta al
 * servidor diez mil validaciones.
 */
const lista = (v: unknown, tope: number): unknown[] => Array.isArray(v) ? v.slice(0, tope) : [];

export function sanearRubro(v: unknown): Rubro | null {
  if (!esObjeto(v)) return null;
  const id = typeof v['id'] === 'string' && ID_RUBRO.test(v['id']) ? v['id'] : null;
  const nombre = textoPlano(v['nombre'], 40);
  const flujoSugerido = de(FLUJOS_SUGERIDOS, v['flujoSugerido']);
  if (id === null || nombre === '' || flujoSugerido === null) return null;
  return { id, nombre, solucion: textoPlano(v['solucion'], 300), flujoSugerido };
}

export function sanearPlan(v: unknown): Plan | null {
  if (!esObjeto(v)) return null;
  const nombre = textoPlano(v['nombre'], 40);
  const precioUsd = precio(v['precioUsd']);
  const periodo = de(PERIODOS, v['periodo']);
  if (nombre === '' || precioUsd === null || periodo === null) return null;
  return { nombre, precioUsd, periodo, incluye: textoPlano(v['incluye'], 200) };
}

/**
 * `desde` es OBLIGATORIO y booleano. No se supone `false` si falta: un «a medida
 * desde USD 125» dicho como «USD 125» es un precio que el comercio no ofreció.
 */
export function sanearCargoUnico(v: unknown): CargoUnico | null {
  if (!esObjeto(v)) return null;
  const nombre = textoPlano(v['nombre'], 60);
  const precioUsd = precio(v['precioUsd']);
  if (nombre === '' || precioUsd === null || typeof v['desde'] !== 'boolean') return null;
  return { nombre, precioUsd, desde: v['desde'], detalle: textoPlano(v['detalle'], 200) };
}

export function sanearAclaracion(v: unknown): Aclaracion | null {
  if (!esObjeto(v)) return null;
  const tema = textoPlano(v['tema'], 60);
  const texto = textoPlano(v['texto'], 600);
  if (tema === '' || texto === '') return null;
  return { tema, texto };
}

/**
 * La URL NO se recorta: una dirección cortada apunta a otro lado. Si no cumple
 * su forma o su largo, el archivo entero se descarta (`null`).
 */
export function sanearArchivoPlanes(v: unknown): ArchivoPlanes | null {
  if (!esObjeto(v)) return null;
  const url = v['url'];
  const tipo = de(TIPOS_ARCHIVO, v['tipo']);
  if (typeof url !== 'string' || url.length > 500 || !URL_ARCHIVO.test(url) || tipo === null) {
    return null;
  }
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url, tipo, nombreArchivo: textoPlano(v['nombreArchivo'], 80) };
}

/**
 * El documento `/config/onboarding` tal como lo recibe el flujo. Nunca lanza:
 * un documento ausente o roto da un objeto con valores por defecto y listas
 * vacías, que el flujo sabe atender.
 */
export function sanearCaptacion(doc: unknown): CaptacionSaneada {
  const d: Crudo = esObjeto(doc) ? doc : {};

  // Rubros: además, sin identificadores repetidos. El flujo los usa como clave
  // del botón que toca el prospecto; dos con el mismo id harían que un toque
  // respondiera por el rubro equivocado. Se queda el primero.
  const vistos = new Set<string>();
  const rubros: Rubro[] = [];
  for (const crudo of lista(d['rubros'], TOPES_CAPTACION.rubros)) {
    const r = sanearRubro(crudo);
    if (r && !vistos.has(r.id)) { vistos.add(r.id); rubros.push(r); }
  }

  const planes = lista(d['planes'], TOPES_CAPTACION.planes)
    .map(sanearPlan).filter((p): p is Plan => p !== null);
  const cargosUnicos = lista(d['cargosUnicos'], TOPES_CAPTACION.cargosUnicos)
    .map(sanearCargoUnico).filter((c): c is CargoUnico => c !== null);
  const aclaraciones = lista(d['aclaraciones'], TOPES_CAPTACION.aclaraciones)
    .map(sanearAclaracion).filter((a): a is Aclaracion => a !== null);

  const enlace = d['enlaceConsola'];
  const tope = d['topeAviso'];
  const plantilla = d['plantillaAviso'];

  return {
    // Un mensaje fijo que sale por WhatsApp tal cual: el salto de línea es
    // formato y se conserva. El resto de los controles, no.
    mensajeClienteActual: textoConSaltos(d['mensajeClienteActual'], 600),
    enlaceConsola: typeof enlace === 'string' && enlace.length <= 200 && ENLACE_CONSOLA.test(enlace)
      ? enlace : '',
    // Los valores por defecto son los de la regla (`d.get('topeAviso', 25)`).
    topeAviso: typeof tope === 'number' && Number.isInteger(tope) && tope >= 3 && tope <= 100
      ? tope : 25,
    plantillaAviso: typeof plantilla === 'string' && PLANTILLA.test(plantilla)
      ? plantilla : 'solicitud_contacto',
    rubros,
    planes,
    cargosUnicos,
    aclaraciones,
    archivoPlanes: sanearArchivoPlanes(d['archivoPlanes']),
    planesEnArchivo: planes.length > TOPES_CAPTACION.planesEnTexto,
  };
}

// ---------------------------------------------------------------------------
// 2. LA COMPROBACIÓN DEL ARCHIVO DE PLANES
// ---------------------------------------------------------------------------
//
// Cuando hay más de cinco planes, el asistente manda el archivo por WhatsApp
// en vez de recitarlos. Si la dirección no sirve, el prospecto recibe un error
// de Meta o nada, y el comercio no se entera. Esto lo comprueba ANTES, a pedido
// de la consola, con los límites de WhatsApp: documento hasta 100 MB, imagen
// JPEG o PNG hasta 5 MB.
//
// SE REUSA EL PEDIDO DE `imagenCatalogo.ts` (`pedirConFrenos`), con su defensa
// contra direcciones internas: la URL la escribe el comercio y la visita NUESTRO
// servidor, desde adentro de la red de Google. Lo que el pedido NO cierra
// —el cambio de DNS entre la resolución y la conexión— está dicho allá; acá el
// riesgo residual es igual de ciego: a quien pregunta solo se le devuelve
// `{ ok, motivo }`, nunca el contenido.

export const TOPE_BYTES_ARCHIVO: Record<TipoArchivo, number> = {
  pdf: 100 * 1024 * 1024,
  imagen: 5 * 1024 * 1024,
};
export const CONTENIDOS_ARCHIVO: Record<TipoArchivo, readonly string[]> = {
  pdf: ['application/pdf'],
  imagen: ['image/jpeg', 'image/png'],
};

export type MotivoArchivo =
  | 'ok'
  | 'sin_archivo'          // no hay `archivoPlanes`, o no cumple su forma
  | 'tipo_incorrecto'      // el servidor dice otro `content-type`
  | 'contenido_no_coincide'// dice PDF (o imagen) pero los primeros bytes no lo son
  | 'demasiado_grande'     // pasa el límite de WhatsApp para ese tipo
  | Exclude<MotivoFalla, 'no_es_imagen' | 'demasiado_grande'>;

/** ¿El `content-type` corresponde al tipo declarado? */
export function contenidoAceptado(tipo: TipoArchivo, contentType: string): boolean {
  return CONTENIDOS_ARCHIVO[tipo].includes(contentType.split(';')[0]?.trim().toLowerCase() ?? '');
}

/**
 * La firma de los primeros bytes. El `content-type` lo declara el servidor que
 * aloja el archivo y puede equivocarse —un HTML de «archivo no encontrado» con
 * `application/pdf` es clásico de algunos alojamientos—; los primeros bytes no.
 */
export function firmaCoincide(contentType: string, cabeza: Uint8Array): boolean {
  const t = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const empieza = (firma: number[]) =>
    cabeza.length >= firma.length && firma.every((b, i) => cabeza[i] === b);
  if (t === 'application/pdf') return empieza([0x25, 0x50, 0x44, 0x46, 0x2d]);          // %PDF-
  if (t === 'image/jpeg') return empieza([0xff, 0xd8, 0xff]);
  if (t === 'image/png') return empieza([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return false;
}

/**
 * Lee lo mínimo: los primeros bytes para la firma y, si el servidor no declaró
 * el tamaño, cuenta hasta el tope y corta. Con el tamaño declarado no baja un
 * PDF de 100 MB para nada: corta apenas tiene la firma.
 */
async function leerCabeza(r: Response, tope: number, declarado: number | null): Promise<
  { ok: true; cabeza: Uint8Array } | { ok: false; motivo: MotivoArchivo }> {
  const lector = r.body?.getReader();
  if (!lector) return { ok: false, motivo: 'no_responde' };
  const cabeza: number[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      for (let i = 0; i < value.length && cabeza.length < 8; i++) cabeza.push(value[i] as number);
      if (total > tope) {
        await lector.cancel().catch(() => {});
        return { ok: false, motivo: 'demasiado_grande' };
      }
      if (declarado !== null && cabeza.length >= 8) {
        await lector.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    return { ok: false, motivo: 'no_responde' };
  }
  return { ok: true, cabeza: new Uint8Array(cabeza) };
}

/** Comprueba un archivo de punta a punta. Nunca lanza: devuelve por qué no sirve. */
export async function comprobarArchivo(archivo: ArchivoPlanes): Promise<{ ok: boolean; motivo: MotivoArchivo }> {
  const pedido = await pedirConFrenos(archivo.url, CONTENIDOS_ARCHIVO[archivo.tipo].join(', '));
  if (!pedido.ok) {
    return { ok: false, motivo: pedido.falla === 'no_es_imagen' ? 'tipo_incorrecto' : pedido.falla };
  }
  const r = pedido.r;
  const tipo = tipoDeContenido(r);
  if (!contenidoAceptado(archivo.tipo, tipo)) {
    await r.body?.cancel().catch(() => {});
    return { ok: false, motivo: 'tipo_incorrecto' };
  }
  const tope = TOPE_BYTES_ARCHIVO[archivo.tipo];
  const largo = r.headers.get('content-length');
  const declarado = largo !== null && /^[0-9]+$/.test(largo) ? Number(largo) : null;
  if (declarado !== null && declarado > tope) {
    await r.body?.cancel().catch(() => {});
    return { ok: false, motivo: 'demasiado_grande' };
  }
  const leido = await leerCabeza(r, tope, declarado);
  if (!leido.ok) return { ok: false, motivo: leido.motivo };
  if (!firmaCoincide(tipo, leido.cabeza)) return { ok: false, motivo: 'contenido_no_coincide' };
  return { ok: true, motivo: 'ok' };
}

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;

/**
 * ¿Quién puede pedir la comprobación? El administrador del comercio o el
 * propietario de NovuChat, CON EL MISMO VÍNCULO ROL↔PROVEEDOR QUE LAS REGLAS
 * (`esAdmin`, `esPropietario`): el administrador con contraseña y el correo
 * verificado, el propietario con Google. Las Functions no pasan por las
 * reglas, así que el vínculo se vuelve a exigir acá.
 */
export function puedeComprobar(token: unknown, tenantId: string): boolean {
  if (!esObjeto(token)) return false;
  const nc = esObjeto(token['nc']) ? token['nc'] : {};
  const firebase = esObjeto(token['firebase']) ? token['firebase'] : {};
  const proveedor = firebase['sign_in_provider'];
  if (nc['p'] === true && proveedor === 'google.com') return true;
  const roles = esObjeto(nc['t']) ? nc['t'] : {};
  return roles[tenantId] === 'admin' && proveedor === 'password' && token['email_verified'] === true;
}

/**
 * `comprobarArchivoPlanes({ tenantId })` → `{ ok, motivo }`.
 *
 * Lee `archivoPlanes` del documento guardado, no una URL que mande el
 * navegador: así no sirve para que alguien use nuestro servidor de sonda
 * contra direcciones arbitrarias, y lo que se comprueba es lo que el flujo va a
 * mandar. No guarda nada.
 */
export const comprobarArchivoPlanes = onCall(
  { region: REGION, maxInstances: 5, timeoutSeconds: 30 },
  async (peticion: CallableRequest) => {
    if (!peticion.auth?.uid) throw new HttpsError('unauthenticated', 'Hay que iniciar sesión.');
    const datos = (peticion.data ?? {}) as Record<string, unknown>;
    const tenantId = typeof datos['tenantId'] === 'string' ? datos['tenantId'].trim() : '';
    if (!ID_TENANT.test(tenantId)) throw new HttpsError('invalid-argument', 'Identificador inválido.');
    if (!puedeComprobar(peticion.auth.token, tenantId)) {
      throw new HttpsError('permission-denied', 'Solo el administrador del negocio.');
    }

    const db = getFirestore();
    const [tenant, config] = await Promise.all([
      db.doc(`tenants/${tenantId}`).get(),
      db.doc(`tenants/${tenantId}/config/onboarding`).get(),
    ]);
    if (!tenant.exists) throw new HttpsError('not-found', 'No existe ese comercio.');
    // La misma lectura de capacidades que las reglas (`flujosTenant`): sin
    // `flujos`, vale `[vertical]`.
    const flujos = tenant.get('flujos') ?? [tenant.get('vertical')];
    if (!Array.isArray(flujos) || !flujos.includes('onboarding')) {
      throw new HttpsError('failed-precondition', 'Ese comercio no tiene el flujo de captación.');
    }

    const archivo = sanearArchivoPlanes(config.get('archivoPlanes'));
    if (!archivo) return { ok: false, motivo: 'sin_archivo' as MotivoArchivo };
    return comprobarArchivo(archivo);
  },
);
