/**
 * =============================================================================
 * RETOMAR UNA CONVERSACIÓN CON LA VENTANA CERRADA — `retomarConversacion` (CORE)
 * =============================================================================
 *
 * Plan «Retomar» (23/11/2026, §1 y §2 «R1»; decisiones D-R1 y D-R3 de Andres). Pasadas las 24 h del último mensaje del
 * cliente, Meta solo deja escribirle con una PLANTILLA aprobada. Una persona del comercio (administrador u operador,
 * nunca el soporte) pulsa «Retomar»: el servidor valida, TOMA el turno a nombre de ella y deja un mensaje `pendiente` de
 * tipo `plantilla` (categoría UTILIDAD, registrada por número en `rutasWhatsApp/{n}.plantillas.retomar`). Lo envía el flujo
 * n8n «Salida de persona» de ese número (mismo camino que el texto: timbre -> reclamo -> envío -> confirmación).
 *
 * ESTA FUNCIÓN NO ENVÍA A META NI CREA PLANTILLAS. Crear y aprobar la plantilla es de la sesión de WAM (prohibición 5 de
 * `CLAUDE.md`); acá solo se la usa, por su nombre registrado. Tampoco hay token de Meta: vive solo en n8n.
 *
 * ENTRADA   `{tenantId, conversacionId, claveIdempotencia}`; cualquier otra clave se ignora. NUNCA recibe un teléfono ni
 *           una ruta: el destino sale del id de la conversación y el parámetro {{1}}, del nombre del comercio.
 *           `conversacionId` cumple `ID_CONVERSACION` (`wa_…`): Messenger e Instagram quedan fuera, donde Retomar no existe.
 * SALIDA    `{estado, mensajeId}`: `pendiente` al crear; en un reintento con la misma clave, el estado guardado, sin volver
 *           a tocar el timbre.
 *
 * LO QUE GARANTIZA, en este orden, cada línea con una prueba que la niega (`pruebas/core/retomar-conversacion.test.ts`;
 * todo rechazo deja 0 escrituras y 0 timbres):
 *
 *  1. Quién llama: administrador u operador de ESE comercio (no el soporte; operador de otro comercio, no), cuenta vigente,
 *     comercio habilitado en el servidor (`consolaConversaciones === 'nueva'`). Una lectura de Auth por uso.
 *  2. La ficha: `personaPuedeEscribir === true` (`sinSalida`) Y `personaPuedeRetomar === true` (`sinRetomar`; booleano
 *     exacto: ausente, `false`, `'true'`, `1` no). Se comprueba DENTRO de la transacción.
 *  3. Idempotencia: la misma clave con la misma huella (`sha256('huella-retomar', conversación, uid)`) devuelve lo
 *     guardado sin tocar el timbre ni los topes; con otra persona o con un mensaje ajeno, `claveUsada`. El mensaje se
 *     crea con `tx.create`: dos usos a la vez con la misma clave, gana uno.
 *  4. La conversación existe y la ventana está CERRADA (`ventanaAbierta`: con ella abierta se usa Tomar). Cerrada con el
 *     mismo margen de 60 s con el que `enviarComoPersona` la da por cerrada: en cada instante exactamente una de las dos
 *     vías (escribir o retomar) está disponible. Sin `ultimoEntranteEn` legible, `noExiste`: no se retoma lo que el
 *     cliente nunca inició; un `ultimoEntranteEn` del futuro lejano es un dato malo (`noDisponible`).
 *  5. Contacto bloqueado (`contactoBloqueado`) o `noContactar === true` (`noContactar`).
 *  6. Un turno vigente de OTRA persona (`ocupada`).
 *  7. Un solo Retomar hasta que el cliente responda (D-R3): si `ultimaRetomadaEn` es posterior a `ultimoEntranteEn` y
 *     cae dentro de `diasEntreRetomadas` (7), `retomadaPendiente`. Un `ultimaRetomadaEn` ilegible falla cerrado.
 *  8. El canal es el de la línea por la que escribió el cliente, nunca otra (`canal`). Su plantilla registrada debe
 *     cumplir C1 exacto: nombre `^[a-z0-9_]{1,100}$`, idioma `^[a-z]{2,3}(_[A-Z]{2})?$`, `categoria === 'UTILITY'`,
 *     `estado === 'APPROVED'`, `variables === 1`; si no, `sinPlantilla`. Una plantilla recategorizada a MARKETING no sale.
 *  9. El parámetro {{1}} es `tenants/{id}.nombre` saneado (espacios colapsados, hasta 60 caracteres, sin saltos de línea,
 *     tabulaciones ni cuatro espacios seguidos). Sin nombre válido, `noDisponible`. No hay texto de respaldo en el código.
 * 10. LOS TOPES, del plan (`limitesDeRetomar`, inyectada) y contados en la MISMA transacción que crea el mensaje, en
 *     `topesDeEnvio/r_{comercio}`: `porDia` (día de La Paz) y `porMes`. `resource-exhausted` con
 *     `details.tope: 'retomarDia' | 'retomarMes'`; un rechazo no consume cupo. Las cifras NO están en core.
 * 11. AUDITORÍA FALLA-CERRADA Y ATÓMICA (`conversacion_retomada`): en la misma transacción, con `telefono4` y nunca el
 *     teléfono. Si no se puede escribir, no hay mensaje.
 * 12. El timbre se toca DESPUÉS de la transacción y solo si el mensaje es nuevo. Su fallo no falla el uso: el mensaje queda
 *     `pendiente` y lo reclama el siguiente timbre o el barrido (si no llega en 2 min, caduca `rechazado/caducado`).
 *
 * LO QUE ESCRIBE: el mensaje `{direccion:'saliente', tipo:'plantilla', texto:'', autor:'persona', autorUid, estadoEnvio:
 * 'pendiente', to, phoneNumberId, tenantId, huella, plantilla:{nombre, idioma, parametros:[nombre del comercio]}}`; en la
 * conversación, `ultimaRetomadaEn`, `ultimoEn`, `ultimoMensaje` y el turno `{responde:'persona', tomadoPor, tomadoEn,
 * actividadPersonaEn, retomadoEn}` (D-R1 (a): con la regla de `turnoVigente`, si el cliente responde dentro de 30 min
 * contesta la persona; si no, el asistente). NO toca `mensajesVentana`, el bloque de 25, los umbrales, `ventanaVenceEn`,
 * `atencionEstado` ni `envioPersona`: cero mensajes por conversación del asistente. El turno anterior vencido se reemplaza
 * sin auditar su devolución.
 *
 * CORE NO IMPORTA CENTRAL. Los topes (`limitesDeRetomar`), la tarifa y la titularidad entran por inyección
 * (`crearRetomarConversacion(deps)`), igual que `limitesDePersona` en `enviarComoPersona.ts`.
 *
 * COSTO por uso efectivo (0 mensajes por conversación del asistente; +1 PLANTILLA de utilidad que cobra Meta, la cifra
 * vive en Central): lecturas, 1 de Auth + 3 previas (la conversación, las rutas del comercio y la cuenta) + 5 de la
 * transacción (ficha, conversación, mensaje, tope, ruta); escrituras, 4 (mensaje, conversación, tope, auditoría); más el
 * POST del timbre. Un reintento con la misma clave: sin escrituras ni timbre.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { exigirAutenticado } from '../seguridad/autorizacion.js';
import { cuentaVigenteDe } from '../seguridad/vigencia.js';
import { exigirComercioHabilitado, exigirRolDePersona } from './accesoPersona.js';
import { camposDeMensajeIndexado } from './derivados.js';
import { canalDe, errorDeEnvio, esObjeto, type Canal, type EntornoDeEnvio } from './enviarComoPersona.js';
import { estaBloqueada } from './pausa.js';
import {
  CLAVE_DE_ENVIO, IDIOMA_DE_PLANTILLA, NOMBRE_DE_PLANTILLA, PARAMETRO_MAXIMO, SECRETO_DE_SALIDA_PERSONA, huellaDeRetomar,
  tocarTimbre as tocarTimbreReal,
} from './salidaPersona.js';
import {
  ID_CONVERSACION, MARGEN_ENVIO_MS, MARGEN_RELOJ_MS, milisegundosDeMomento, personaPuedeEscribirDeFicha, personaPuedeRetomarDeFicha,
  turnoEfectivo, ventanaDeMetaAbierta,
} from './turno.js';
import {
  auditarEnTransaccion, codigoDe, errorDeTurno, opcionesDeTurno, registrar, turnoAFirestore, type ContextoDeTurno,
} from './turnoServidor.js';

// ---------------------------------------------------------------------------
// LO QUE LLEGA POR INYECCIÓN (lo arma Central; `index.ts` solo reexporta)
// ---------------------------------------------------------------------------

/** Los topes que el plan fija (ver `limitesDeRetomar` en `central/cuenta/planes.ts`, contrato C9). */
export interface LimitesDeRetomar {
  /** Plazo máximo, en días, de «un Retomar por conversación hasta que el cliente responda». */
  diasEntreRetomadas: number;
  porDia: number;
  porMes: number;
}

export interface DependenciasDeRetomar {
  limitesDeRetomar(plan: unknown, tarifa: 'estandar' | 'meta_incluido', titularidad: 'novuchat' | 'comercio'): LimitesDeRetomar;
  titularidadDe(ruta: Record<string, unknown> | null | undefined): 'novuchat' | 'comercio';
  tarifaDe(cuenta: Record<string, unknown> | null | undefined): 'estandar' | 'meta_incluido';
}

/** Lo que devuelve la callable. */
export interface SalidaDeRetomar { estado: string; mensajeId: string }

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;
/** Lo que muestra la lista de conversaciones tras retomar. */
export const ULTIMO_MENSAJE_AL_RETOMAR = 'Plantilla para retomar enviada';
/** El día de La Paz (UTC-4 fijo), como los otros contadores de `topesDeEnvio`. */
const diaDe = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const ID_RESERVADO = /^__.*__$/;

/**
 * El parámetro {{1}}: el nombre del comercio, saneado. Colapsa todo espacio (incluidos saltos de línea y tabulaciones) a
 * uno solo, quita controles, recorta y limita a 60 caracteres. `null` si no queda nada. No hay respaldo: sin nombre no se envía.
 */
export function nombreComoParametro(nombre: unknown): string | null {
  if (typeof nombre !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const limpio = nombre.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PARAMETRO_MAXIMO).trim();
  return limpio.length > 0 ? limpio : null;
}

/** C1: la plantilla de retomar de una ruta, o `null` si no cumple EXACTAMENTE el contrato. */
export function plantillaDeRetomarDe(ruta: Record<string, unknown> | null | undefined): { nombre: string; idioma: string } | null {
  const plantillas = ruta?.['plantillas'];
  if (!esObjeto(plantillas)) return null;
  const p = plantillas['retomar'];
  if (!esObjeto(p)) return null;
  const { nombre, idioma, categoria, estado, variables } = p;
  if (typeof nombre !== 'string' || !NOMBRE_DE_PLANTILLA.test(nombre)) return null;
  if (typeof idioma !== 'string' || !IDIOMA_DE_PLANTILLA.test(idioma)) return null;
  if (categoria !== 'UTILITY' || estado !== 'APPROVED' || variables !== 1) return null;
  return { nombre, idioma };
}

// ---------------------------------------------------------------------------
// LA TRANSACCIÓN
// ---------------------------------------------------------------------------

interface Preparado {
  ctx: ContextoDeTurno;
  clave: string;
  canal: Canal;
  limites: LimitesDeRetomar;
}

export interface CreadoRetomar extends SalidaDeRetomar { repetido: boolean }

/** La transacción (exportada para las pruebas). */
export async function crearRetomada(p: Preparado): Promise<CreadoRetomar> {
  const { ctx: c, clave, canal, limites } = p;
  const { db, tenantId, uid, ahoraMs, ref, conversacionId } = c;
  const refMensaje = ref.collection('mensajes').doc(clave);
  const refTopes = db.doc(`topesDeEnvio/r_${tenantId}`);
  const refFicha = db.doc(`tenants/${tenantId}`);
  const refRuta = db.doc(`rutasWhatsApp/${canal.phoneNumberId}`);

  return db.runTransaction<CreadoRetomar>(async (tx) => {
    const [ficha, conv, previo, topes, ruta] = await tx.getAll(refFicha, ref, refMensaje, refTopes, refRuta);

    // 2. Las dos banderas, DENTRO de la transacción (si se apagaron tras la lectura previa, no se escribe nada).
    if (!personaPuedeEscribirDeFicha(ficha?.data())) throw errorDeTurno('sinSalida');
    if (!personaPuedeRetomarDeFicha(ficha?.data())) throw errorDeTurno('sinRetomar');

    // 3. La clave ya usada: con la misma huella es un reintento (lo guardado, sin tocar nada); con otra, nunca.
    const huella = huellaDeRetomar(conversacionId, uid);
    if (previo && previo.exists) {
      if (previo.get('huella') !== huella || previo.get('autor') !== 'persona' || previo.get('autorUid') !== uid) {
        throw errorDeEnvio('claveUsada');
      }
      return { estado: String(previo.get('estadoEnvio') ?? 'pendiente'), mensajeId: clave, repetido: true };
    }

    // 4. La conversación existe y su ventana está cerrada.
    if (!conv || !conv.exists) throw errorDeTurno('noExiste');
    const lineaActual: unknown = conv.get('phoneNumberId');
    if (lineaActual !== undefined && lineaActual !== canal.phoneNumberId) throw errorDeEnvio('canal');
    const ultimoEntranteEn: unknown = conv.get('ultimoEntranteEn');
    const ultimoEntrante = milisegundosDeMomento(ultimoEntranteEn);
    if (ultimoEntrante === null) throw errorDeTurno('noExiste'); // el cliente nunca inició: no hay qué retomar
    if (ultimoEntrante > ahoraMs + MARGEN_RELOJ_MS) throw errorDeTurno('noDisponible'); // dato malo: cerrado
    // El mismo margen con el que `enviarComoPersona` da la ventana por cerrada: o escribe, o retoma.
    if (ventanaDeMetaAbierta(ultimoEntranteEn, ahoraMs, MARGEN_ENVIO_MS)) throw errorDeTurno('ventanaAbierta');

    // 5. Bloqueo y «no contactar».
    if (estaBloqueada(conv.get('bloqueada'))) throw errorDeTurno('contactoBloqueado');
    if (conv.get('noContactar') === true) throw errorDeTurno('noContactar');

    // 6. Un turno vigente de OTRA persona.
    const { veredicto, turno } = turnoEfectivo(conv.get('turno'), { ultimoEntranteEn }, ahoraMs);
    if (veredicto.motivo === 'tomado' && turno !== null && turno.tomadoPor !== uid) throw errorDeTurno('ocupada');

    // 7. Un solo Retomar hasta que el cliente responda (con plazo máximo).
    const ultimaRetomada: unknown = conv.get('ultimaRetomadaEn');
    if (ultimaRetomada !== undefined) {
      const retomadaMs = milisegundosDeMomento(ultimaRetomada);
      if (retomadaMs === null) throw errorDeTurno('noDisponible'); // dato ilegible: cerrado
      if (retomadaMs > ultimoEntrante && ahoraMs < retomadaMs + limites.diasEntreRetomadas * DIA_MS) {
        throw errorDeTurno('retomadaPendiente');
      }
    }

    // 8. La ruta (la de la línea del cliente) con su plantilla registrada, exacta.
    if (!ruta || !ruta.exists || ruta.get('tenantId') !== tenantId || ruta.get('estado') !== 'activo'
        || typeof ruta.get('aliasSecreto') !== 'string' || String(ruta.get('aliasSecreto')).length === 0) {
      throw errorDeEnvio('canal');
    }
    const plantilla = plantillaDeRetomarDe(ruta.data());
    if (plantilla === null) throw errorDeTurno('sinPlantilla');

    // 9. El parámetro {{1}}: el nombre del comercio, sin respaldo.
    const nombre = nombreComoParametro(ficha?.get('nombre'));
    if (nombre === null) throw errorDeTurno('noDisponible');

    // 10. Los topes del plan, contados acá. Un rechazo no consume cupo.
    const dia = diaDe(ahoraMs);
    const mes = dia.slice(0, 7);
    const t = topes && topes.exists ? (topes.data() ?? {}) : {};
    const nDia = t['dia'] === dia ? t['nDia'] : 0;
    const nMes = t['mes'] === mes ? t['nMes'] : 0;
    if (!numeroValido(nDia) || !numeroValido(nMes)) throw errorDeTurno('noDisponible');
    if (nDia >= limites.porDia) throw errorDeTurno('topeRetomarDia', { tope: 'retomarDia' });
    if (nMes >= limites.porMes) throw errorDeTurno('topeRetomarMes', { tope: 'retomarMes' });

    // 11. Las escrituras, todas o ninguna.
    const ts = Timestamp.fromMillis(ahoraMs);
    tx.create(refMensaje, {
      direccion: 'saliente', tipo: 'plantilla', texto: '', ts,
      autor: 'persona', autorUid: uid, estadoEnvio: 'pendiente',
      // El destino sale del id de la conversación (la ruta la armó el servidor), nunca del navegador.
      to: conversacionId.slice(3),
      phoneNumberId: canal.phoneNumberId,
      huella,
      plantilla: { nombre: plantilla.nombre, idioma: plantilla.idioma, parametros: [nombre] },
      ...camposDeMensajeIndexado('', tenantId),
    });
    tx.update(ref, {
      ultimaRetomadaEn: ts, ultimoEn: ts, ultimoMensaje: ULTIMO_MENSAJE_AL_RETOMAR,
      // El turno se REEMPLAZA entero (sin `devueltoEn` ni motivo de una devolución anterior).
      turno: turnoAFirestore({ responde: 'persona', tomadoPor: uid, tomadoEn: ahoraMs, actividadPersonaEn: ahoraMs, retomadoEn: ahoraMs }),
    });
    tx.set(refTopes, { dia, nDia: nDia + 1, mes, nMes: nMes + 1, actualizadoEn: ts });
    auditarEnTransaccion(tx, c, 'conversacion_retomada', { mensajeId: clave });
    return { estado: 'pendiente', mensajeId: clave, repetido: false };
  });
}

// ---------------------------------------------------------------------------
// EL CAMINO COMÚN
// ---------------------------------------------------------------------------

const FUNCION = 'retomarConversacion' as const;

export async function atenderRetomar(
  p: CallableRequest,
  deps: DependenciasDeRetomar,
  entorno: Partial<EntornoDeEnvio> = {},
): Promise<SalidaDeRetomar> {
  const db = entorno.db ?? getFirestore();
  const ahoraMs = entorno.ahoraMs ?? Date.now();
  const vigente = entorno.cuentaVigente ?? cuentaVigenteDe;
  const tocar = entorno.tocarTimbre ?? tocarTimbreReal;
  const datos = esObjeto(p.data) ? p.data : {};
  const { tenantId, conversacionId } = datos;
  const claveIdempotencia = datos['claveIdempotencia'];
  let uid: string | undefined;
  let rol: ContextoDeTurno['rol'] | undefined;
  try {
    // 1. Sesión, rol DE ESTE comercio (el soporte no está en la lista), forma de la entrada, cuenta y comercio.
    try { uid = exigirAutenticado(p); } catch (e) { registrar(FUNCION, 'unauthenticated'); throw e; }
    try { rol = exigirRolDePersona(p, tenantId); } catch (e) {
      registrar(FUNCION, e instanceof HttpsError ? e.code : 'unavailable', { tenantId, uid });
      throw e;
    }
    const t = tenantId as string;
    const invalida = (motivo: string): HttpsError => {
      registrar(FUNCION, 'invalid-argument', { tenantId: t, uid, rol, motivo });
      return errorDeTurno('solicitudInvalida');
    };
    if (typeof conversacionId !== 'string' || !ID_CONVERSACION.test(conversacionId)) throw invalida('conversacion');
    if (typeof claveIdempotencia !== 'string' || !CLAVE_DE_ENVIO.test(claveIdempotencia) || ID_RESERVADO.test(claveIdempotencia)) {
      throw invalida('clave');
    }
    const authTime = p.auth?.token?.['auth_time'];
    let ok: boolean;
    try {
      ok = await vigente(uid, typeof authTime === 'number' ? authTime : Number.NaN, rol, t);
    } catch (e) {
      registrar(FUNCION, 'unavailable', { tenantId: t, uid, rol, motivo: `auth_${codigoDe(e)}` });
      throw errorDeTurno('noDisponible');
    }
    if (!ok) {
      registrar(FUNCION, 'permission-denied', { tenantId: t, uid, rol, motivo: 'cuenta_no_vigente' });
      throw errorDeTurno('sinPermiso');
    }
    try { await exigirComercioHabilitado(t, db); } catch (e) {
      registrar(FUNCION, e instanceof HttpsError ? e.code : 'unavailable', { tenantId: t, uid, rol });
      throw e;
    }

    // 2. El canal: la línea por la que escribió el cliente, nunca otra (mismo criterio que `enviarComoPersona`).
    const ref = db.doc(`tenants/${t}/conversaciones/${conversacionId}`);
    const lineaDe: unknown = (await ref.get()).get('phoneNumberId');
    const lineaMala = lineaDe !== undefined && (typeof lineaDe !== 'string' || !/^[0-9]{6,25}$/.test(lineaDe));
    const encontrado = lineaMala ? null : await canalDe(db, t, typeof lineaDe === 'string' ? lineaDe : undefined);
    if (!encontrado) {
      registrar(FUNCION, 'failed-precondition', { tenantId: t, uid, rol, motivo: 'canal' });
      throw errorDeEnvio('canal');
    }
    const cuenta = ((await db.doc(`tenants/${t}/cuenta/estado`).get()).data() ?? {}) as Record<string, unknown>;
    const limites = deps.limitesDeRetomar(cuenta['plan'], deps.tarifaDe(cuenta), deps.titularidadDe(encontrado.ruta));
    // Cifras ilegibles del plan: cerrado (ni un cupo inventado ni «sin tope»).
    if (!numeroValido(limites.diasEntreRetomadas) || !numeroValido(limites.porDia) || !numeroValido(limites.porMes)) {
      registrar(FUNCION, 'unavailable', { tenantId: t, uid, rol, motivo: 'limites' });
      throw errorDeTurno('noDisponible');
    }

    // 3. La transacción. Sus rechazos se registran acá, con su tope si lo tienen.
    const ctx: ContextoDeTurno = { db, tenantId: t, conversacionId, uid, rol, ahoraMs, ref };
    let creado: CreadoRetomar;
    try {
      creado = await crearRetomada({ ctx, clave: claveIdempotencia, canal: encontrado.canal, limites });
    } catch (e) {
      if (e instanceof HttpsError) {
        const tope = esObjeto(e.details) && typeof e.details['tope'] === 'string' ? `tope_${e.details['tope']}` : undefined;
        registrar(FUNCION, e.code, { tenantId: t, uid, rol, conversacionId, ...(tope ? { motivo: tope } : {}) });
      }
      throw e;
    }

    // 4. El TIMBRE, solo si el mensaje es nuevo. Su fallo no falla el uso: queda `pendiente`.
    let timbre = 'repetido';
    if (!creado.repetido) timbre = (await tocar(encontrado.canal.alias, encontrado.canal.phoneNumberId, ahoraMs)) ? 'timbre_ok' : 'timbre_fallo';
    registrar(FUNCION, 'ok', { tenantId: t, uid, rol, conversacionId, motivo: timbre });
    return { estado: creado.estado, mensajeId: creado.mensajeId };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    registrar(FUNCION, 'unavailable', { tenantId: datos['tenantId'], uid, rol, conversacionId: datos['conversacionId'], motivo: `error_${codigoDe(e)}` });
    throw errorDeTurno('noDisponible');
  }
}

/**
 * La callable. Se arma con los topes, la tarifa y la titularidad que le pasa Central
 * (`central/cuenta/enviarComoPersona.ts`): Core no importa Central. Región y App Check como `enviarComoPersona`, más el secreto
 * del timbre. Agrega una Function: la etiqueta que la lleve exige el invocador público (`scripts/nube-visor.sh`, tras el despliegue).
 */
export function crearRetomarConversacion(deps: DependenciasDeRetomar) {
  return onCall(
    { ...opcionesDeTurno(process.env), secrets: [SECRETO_DE_SALIDA_PERSONA] },
    (p: CallableRequest) => atenderRetomar(p, deps),
  );
}
