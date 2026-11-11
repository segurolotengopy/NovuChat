/**
 * =============================================================================
 * ENVIAR UN ADJUNTO COMO PERSONA — `enviarAdjuntoComoPersona` (CORE, «Envío de medios por consola», B2)
 * =============================================================================
 *
 * Una persona del comercio que TIENE la conversación le envía UN archivo (imagen, documento, audio o nota de voz) al
 * cliente, dentro de la ventana de 24 h. Es el hermano del texto (`enviarComoPersona.ts`): el mismo camino (sesión,
 * rol, cuenta vigente, comercio, canal, turno, ventana, bloqueo, topes del plan) y la MISMA transacción. Lo que agrega:
 *
 *  - NO ENVÍA A META. Valida el archivo, lo guarda en Storage, deja el mensaje `pendiente` y toca el timbre del
 *    flujo «Salida de persona»; el flujo lo reclama (con la cabecera `X-NovuChat-Adjuntos: 1`), pide los bytes a
 *    `leerAdjuntoPersona`, los sube a Graph y lo confirma. Acá no hay token de Meta.
 *  - ENTRADA EXACTA: `{tenantId, conversacionId, clave, adjunto: {base64, mime, nombre}, leyenda?}`. UN solo adjunto
 *    (decisión D-A3: ni listas ni `adjuntos`); ningún teléfono, ruta ni destino; cualquier otra clave es
 *    `invalid-argument`.
 *  - DOS BANDERAS (D-A10): `personaPuedeEscribir` Y `personaPuedeEnviarMedios`, ambas `=== true`, de la ficha del
 *    comercio, que escribe solo Plataforma. Sin la segunda: `ErroresDeEnvio.sinMedios`.
 *  - NÚMEROS POR EL RELÉ (D-A13): se rechaza con `failed-precondition`; nunca se crea un mensaje que no puede salir.
 *  - EL ARCHIVO: `validarAdjunto` (`core/medios/salientes.ts`) decide por los BYTES, no por el mime ni la extensión
 *    declarados. Un rechazo es `invalid-argument` con `details.motivo` (el código de `validarAdjunto`). La leyenda
 *    (1 a 1.000 caracteres, sin controles) solo va en imagen y documento; en audio es `leyenda_en_audio` (D-A4: la
 *    consola hace dos envíos).
 *  - LÍMITES, leídos del plan (inyectados: Core no importa Central): cada adjunto cuenta como UN mensaje de persona en
 *    los topes del plan (por conversación, por minuto, por día). Aparte, dos topes de SEGURIDAD que no son del plan:
 *    `TOPE_DIARIO_DE_ADJUNTOS` y `TOPE_DIARIO_DE_BYTES_ENVIADOS` por comercio y día de La Paz, en
 *    `topesDeEnvio/a_{comercio}`, dentro de la transacción y DESPUÉS de los del plan. Un rechazo no consume cupo.
 *  - STORAGE: `tenants/{t}/mediosEnviados/{díaLaPaz}/{hash}.{ext}`. El hash sale de (conversación, mensaje): ni el
 *    teléfono, ni el nombre del archivo, ni la leyenda aparecen en Storage ni en los registros ni en la auditoría.
 *  - ORDEN: (1) pasos previos comunes; (2) bandera, relé y archivo; (3) ENSAYO de la transacción, que corre todas
 *    las comprobaciones sin escribir; (4) subir a Storage (solo si el mensaje es nuevo); (5) la transacción real, que
 *    vuelve a comprobar todo. Si (5) falla tras subir, el objeto queda huérfano y lo borra la purga a los 30 días.
 *  - CLAVE REPETIDA: con los mismos bytes, leyenda y nombre devuelve lo guardado SIN subir de nuevo; con otros, rechaza.
 *  - NO TOCA nada de cobros: ni las solicitudes, ni los cierres, ni los comprobantes (no hay lectura del archivo por OCR).
 *
 * Costo por envío efectivo: 0 mensajes del asistente por conversación; el mensaje es de la persona (cuenta en los
 * topes y en la base comercial como un texto). 1 lectura de Auth, 3 lecturas de comercio/cuenta/rutas, 2 transacciones
 * (la de ensayo solo lee), 1 subida a Storage y 4 escrituras (mensaje, metadato, conversación, 3 contadores, auditoría).
 */
import { createHash } from 'node:crypto';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { DIAS_DE_RETENCION_ENVIADOS, DIA_MS, almacenDeMedios, diaDeLaPaz, objetoDeEnviado, rutaDeEnviado, type Almacen } from '../medios/almacen.js';
import { TOPE_DE_ADJUNTO, validarAdjunto } from '../medios/salientes.js';
import { MB, contentTypeDeObjeto } from '../medios/tipos.js';
import {
  CONTROLES, argumentoInvalido, canalDeEnvio, crearMensajeDePersona, errorDeEnvio, esObjeto, prepararEnvio, registrarRechazoDeEnvio,
  tocarTimbreDeEnvio, type DatosDeAdjunto, type DependenciasDeEnvio, type EntornoDeEnvio, type QuienEnvia, type SalidaDeEnvio,
} from './enviarComoPersona.js';
import { SECRETO_DE_SALIDA_PERSONA, TEXTO_MAXIMO, huellaDeAdjunto, tocarTimbre as tocarTimbreReal } from './salidaPersona.js';
import { personaPuedeEnviarMediosDeFicha } from './turno.js';
import { codigoDe, errorDeTurno, opcionesDeTurno, registrar } from './turnoServidor.js';

// ---------------------------------------------------------------------------
// SEGURIDAD, NO PLAN: dos frenos por comercio y día que no son límites comerciales
// ---------------------------------------------------------------------------

/** Archivos que un comercio puede enviar por día (La Paz). Freno contra una cuenta robada; no es del plan. */
export const TOPE_DIARIO_DE_ADJUNTOS = 50;
/** Bytes guardados que un comercio puede enviar por día (La Paz). Freno de seguridad; no es del plan. */
export const TOPE_DIARIO_DE_BYTES_ENVIADOS = 500 * MB;

/** El tamaño de base64 del archivo más grande (16 MiB): 22.369.624 caracteres. */
export const LARGO_MAXIMO_DE_BASE64 = Math.ceil(TOPE_DE_ADJUNTO.audio / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CLAVES_DE_ENTRADA: ReadonlySet<string> = new Set(['tenantId', 'conversacionId', 'clave', 'adjunto', 'leyenda']);
const CLAVES_DEL_ADJUNTO: ReadonlySet<string> = new Set(['base64', 'mime', 'nombre']);
const LARGO_MAXIMO_DE_MIME = 100;
const LARGO_MAXIMO_DE_NOMBRE_ENTRANTE = 1000;

/** Lo que cambia en las pruebas, además del entorno del texto: el almacén. */
export interface EntornoDeAdjunto extends Partial<EntornoDeEnvio> { almacen?: Almacen }

interface FormaDeAdjunto { base64: string; mime: string; nombre: string; leyenda: string | undefined }

/** La forma de la entrada, sin decodificar nada todavía. */
function formaDe(d: Record<string, unknown>, invalida: (motivo: string) => HttpsError): FormaDeAdjunto {
  if (Object.keys(d).some((k) => !CLAVES_DE_ENTRADA.has(k))) throw invalida('claves');
  const a = d['adjunto'];
  if (!esObjeto(a) || Object.keys(a).some((k) => !CLAVES_DEL_ADJUNTO.has(k))) throw invalida('adjunto');
  const { base64, mime, nombre } = a;
  if (typeof base64 !== 'string' || base64.length === 0 || base64.length > LARGO_MAXIMO_DE_BASE64
      || base64.length % 4 !== 0 || !BASE64.test(base64)) throw invalida('base64');
  if (mime !== undefined && (typeof mime !== 'string' || mime.length > LARGO_MAXIMO_DE_MIME)) throw invalida('mime');
  if (nombre !== undefined && (typeof nombre !== 'string' || nombre.length > LARGO_MAXIMO_DE_NOMBRE_ENTRANTE)) throw invalida('nombre');
  const leyenda = d['leyenda'];
  if (leyenda !== undefined && (typeof leyenda !== 'string' || leyenda.trim().length === 0 || leyenda.length > TEXTO_MAXIMO || CONTROLES.test(leyenda))) {
    throw invalida('leyenda');
  }
  return { base64, mime: (mime as string | undefined) ?? '', nombre: (nombre as string | undefined) ?? '', leyenda: leyenda as string | undefined };
}

export async function atenderAdjunto(
  p: CallableRequest,
  deps: DependenciasDeEnvio,
  entorno: EntornoDeAdjunto = {},
): Promise<SalidaDeEnvio> {
  const tocar = entorno.tocarTimbre ?? tocarTimbreReal;
  const funcion = 'enviarAdjuntoComoPersona' as const;
  const datos = esObjeto(p.data) ? p.data : {};
  const quien: QuienEnvia = {};
  try {
    // 1. Los pasos previos comunes. Ningún registro de este camino lleva el teléfono: no se pasa `conversacionId`.
    const e0 = await prepararEnvio(p, funcion, deps, entorno, quien, formaDe, 'clave');
    const { db, ahoraMs, tenantId, uid, rol } = e0;
    const registrarRechazo = (codigo: string, motivo: string): void => registrar(funcion, codigo, { tenantId, uid, rol, motivo });

    // 2. La segunda bandera (D-A10). Antes de decodificar nada.
    const ficha = await db.doc(`tenants/${tenantId}`).get();
    if (!personaPuedeEnviarMediosDeFicha(ficha.data())) {
      registrarRechazo('permission-denied', 'sin_medios');
      throw errorDeEnvio('sinMedios');
    }
    // 3. El relé todavía no lleva archivos (D-A13).
    if (canalDeEnvio(e0.encontrado.ruta) === 'rele') {
      registrarRechazo('failed-precondition', 'rele');
      throw errorDeEnvio('adjuntoPorRele');
    }

    // 4. El archivo, por sus bytes.
    const forma = e0.forma;
    const bytesEntrantes = Buffer.from(forma.base64, 'base64');
    const v = validarAdjunto(bytesEntrantes, { mime: forma.mime, nombre: forma.nombre });
    if (!v.ok) {
      registrarRechazo('invalid-argument', `adjunto_${v.error}`);
      throw argumentoInvalido({ motivo: v.error });
    }
    if (forma.leyenda !== undefined && v.tipo === 'audio') {
      registrarRechazo('invalid-argument', 'leyenda_en_audio');
      throw argumentoInvalido({ motivo: 'leyenda_en_audio' });
    }

    // 5. Lo que se guarda.
    const leyenda = forma.leyenda ?? '';
    const nombre = v.tipo === 'document' ? v.nombre : '';
    const sha256 = createHash('sha256').update(v.bytes).digest('hex');
    const objeto = objetoDeEnviado(e0.conversacionId, e0.clave);
    const adjunto: DatosDeAdjunto = {
      tipo: v.tipo, ext: v.ext, mime: v.mime, tamano: v.bytes.length, sha256, voz: v.voz, nombre, leyenda, objeto,
      ruta: rutaDeEnviado(tenantId, diaDeLaPaz(ahoraMs), objeto, v.ext),
      venceMs: ahoraMs + DIAS_DE_RETENCION_ENVIADOS * DIA_MS,
    };
    const datosDeEnvio = {
      clase: 'adjunto' as const, clave: e0.clave, adjunto,
      huella: huellaDeAdjunto(e0.conversacionId, uid, sha256, v.tipo, leyenda, nombre),
    };
    const seguridad = { adjuntosDia: TOPE_DIARIO_DE_ADJUNTOS, bytesDia: TOPE_DIARIO_DE_BYTES_ENVIADOS };

    // 6. El ENSAYO: todas las comprobaciones, sin escribir. Dice si el mensaje ya existe (no se vuelve a subir).
    let ensayo;
    try {
      ensayo = await crearMensajeDePersona(e0.ctx, datosDeEnvio, e0.encontrado.canal, e0.limites, { ...seguridad, soloComprobar: true });
    } catch (e) {
      registrarRechazoDeEnvio(funcion, e, e0, false);
      throw e;
    }

    // 7. Storage, solo si el mensaje es nuevo.
    if (!ensayo.repetido) {
      try {
        await (entorno.almacen ?? almacenDeMedios()).guardar(adjunto.ruta, v.bytes, contentTypeDeObjeto({ tipo: v.tipo, mime: v.mime }));
      } catch (e) {
        registrar(funcion, 'unavailable', { tenantId, uid, rol, motivo: `almacen_${codigoDe(e)}` });
        throw errorDeTurno('noDisponible');
      }
    }

    // 8. La transacción real (vuelve a comprobar todo).
    let creado;
    try {
      creado = await crearMensajeDePersona(e0.ctx, datosDeEnvio, e0.encontrado.canal, e0.limites, seguridad);
    } catch (e) {
      registrarRechazoDeEnvio(funcion, e, e0, false);
      throw e;
    }

    // 9. El TIMBRE, solo si el mensaje es nuevo. Su fallo no falla el envío.
    const timbre = await tocarTimbreDeEnvio(e0, creado, tocar);
    registrar(funcion, 'ok', { tenantId, uid, rol, motivo: timbre });
    return {
      estado: creado.estado, mensajeId: creado.mensajeId,
      ...(creado.codigoEnvio !== undefined ? { codigoEnvio: creado.codigoEnvio } : {}),
      ...(creado.reintentable !== undefined ? { reintentable: creado.reintentable } : {}),
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    registrar(funcion, 'unavailable', { tenantId: datos['tenantId'], uid: quien.uid, rol: quien.rol, motivo: `error_${codigoDe(e)}` });
    throw errorDeTurno('noDisponible');
  }
}

/**
 * Memoria y tiempo de la callable: por petición conviven el base64 (hasta ~21 MiB), los bytes (16 MiB), la copia limpia
 * y la subida; con concurrencia 4 y 1 GiB cabe (mismos valores que `verMedio`). 2 minutos por un archivo de 16 MiB.
 * Sin `concurrency` en staging (`opcionesDeTurno` ya la omite con menos de 1 vCPU).
 */
export function crearEnviarAdjuntoComoPersona(deps: DependenciasDeEnvio) {
  const base = opcionesDeTurno(process.env);
  return onCall(
    {
      ...base, memory: '1GiB', timeoutSeconds: 120, maxInstances: 3,
      ...(base.concurrency !== undefined ? { concurrency: 4 } : {}),
      secrets: [SECRETO_DE_SALIDA_PERSONA],
    },
    (p: CallableRequest) => atenderAdjunto(p, deps),
  );
}
