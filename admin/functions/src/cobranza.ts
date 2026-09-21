import { onRequest } from 'firebase-functions/v2/https';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { SECRETOS_POR_ALIAS, rutaAutenticada } from './firma.js';
import { registrar } from './ingesta.js';
import { periodoDe } from './planes.js';
import {
  PLANTILLAS, consumidasDe, estadoDeServicio, horaBolivia, mesBolivia, modalidadDe, periodoSiguiente,
  recordatoriosDebidos, tipoCambioVigente, type CuentaCruda, type Recordatorio,
} from './prepago.js';

/**
 * =============================================================================
 * COBRANZA DEL PREPAGO — a qué comercio le toca un recordatorio, y marcar antes
 * =============================================================================
 *
 * Es el molde de `seguimientos.ts`, aplicado a la cuenta de cada comercio en
 * vez de a la solicitud de cada paciente. Quien llama es el FLUJO PROGRAMADO
 * DEL NÚMERO DE NOVUCHAT (ruta con `flujo: 'onboarding'`, tenant `novuchat`),
 * cada hora: pregunta a quién le toca qué plantilla, marca ANTES de enviar y
 * envía. El comercio recibe la plantilla desde el número de NovuChat, con su
 * franquicia de 1.000 mensajes (`DISENO.md` §4undecies.6: 0 mensajes para el
 * comercio).
 *
 * LAS REGLAS, Y DÓNDE SE HACEN CUMPLIR (`CLAUDE.md` §7: en el servidor):
 *
 *   1. SOLO EL NÚMERO DE NOVUCHAT puede preguntar y marcar: `rutaAutenticada`
 *      más `ruta.flujo === 'onboarding'`. Un número de comercio recibe 403.
 *   2. NUNCA A UNA DEMOSTRACIÓN, ni a una cuenta sin modalidad: `modalidadDe`.
 *      Es la misma salvaguarda que impide cortarlas.
 *   3. PRUEBA NO RECIBE COBRANZA: `recordatoriosDebidos` solo emite el aviso de
 *      conversión (decisión 5 del frente).
 *   4. UNA SOLA VEZ POR CLAVE. La clave es idempotente (`vencida_2026-10`,
 *      `corte_2026-10`…) y `recordatorioPrepagoEnviado` la marca DENTRO de una
 *      transacción que vuelve a mirarla: dos corridas simultáneas no mandan dos.
 *   5. SIN TELÉFONO NO HAY ENVÍO. Un comercio sin `telefonosPago` va en
 *      `sinTelefono`, para que NovuChat lo vea y lo cargue; nunca se infiere un
 *      teléfono de otro lado.
 *   6. SIN TCO VIGENTE NO SALE NINGÚN IMPORTE. Los recordatorios que llevan un
 *      importe en Bs no se devuelven si `plataforma/tipoCambio` falta o tiene
 *      más de 4 días; la respuesta lo dice (`tipoCambio: null`).
 *   7. ENTRE LAS 09:00 Y LAS 19:00 DE BOLIVIA. Fuera de ese horario la lista
 *      vuelve vacía con `fueraDeHorario: true`: un recordatorio de cobro a las
 *      tres de la mañana es el peor mensaje posible.
 *
 * LA MARCA VA ANTES DEL ENVÍO, como en `seguimientos.ts`: si el envío falla, la
 * clave queda marcada y nadie reintenta. Un recordatorio perdido es mejor que
 * dos, porque el segundo es el que hace que el comercio bloquee el número. (La
 * rama del 08/09 marcaba DESPUÉS, exigiendo el `idMensaje`; se descarta.)
 */

/** Recorta y normaliza un texto que vino de afuera. Igual que en `sena.ts`. */
function texto(valor: unknown, maxLargo: number): string {
  return typeof valor === 'string' ? valor.trim().slice(0, maxLargo) : '';
}

const TELEFONO = /^[0-9]{8,15}$/;
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
/**
 * LAS CLAVES QUE SE PUEDEN MARCAR, y nada más: las que genera
 * `recordatoriosDebidos` (prefijo conocido más un período `aaaa-mm` que no
 * sea posterior al mes SIGUIENTE al en curso de Bolivia: los avisos de
 * renovación D-5 y D-1 llevan el mes que vence, que es el que viene) y
 * `confirmacion_<pagoId>`. Una clave inventada no se marca: si se marcara,
 * `cuenta.recordatorios` sería un lugar donde el número de NovuChat puede
 * escribir lo que quiera.
 */
const CLAVE_PERIODO = /^(vence_pronto|vence_manana|vencida|corte|corte2|agotadas|conversion)_(\d{4}-\d{2})$/;
const CLAVE_CONFIRMACION = /^confirmacion_([A-Za-z0-9_-]{4,64})$/;

export type ClaveValida =
  | { tipo: 'periodo'; clave: string }
  | { tipo: 'confirmacion'; clave: string; pagoId: string };

/** Pura: qué clave es, o `null` si no es ninguna de las que se generan. */
export function claveValida(clave: string, ahoraMs: number): ClaveValida | null {
  const c = CLAVE_CONFIRMACION.exec(clave);
  if (c) return { tipo: 'confirmacion', clave, pagoId: c[1]! };
  const p = CLAVE_PERIODO.exec(clave);
  if (!p) return null;
  const periodo = p[2]!;
  const mes = Number(periodo.slice(5));
  if (mes < 1 || mes > 12 || periodo > periodoSiguiente(mesBolivia(ahoraMs))) return null;
  return { tipo: 'periodo', clave };
}

/** Horario de envío en Bolivia: desde las 09:00 y antes de las 19:00. */
export const HORARIO_ENVIO = { desde: 9, hasta: 19 } as const;
/** Cuántos comercios se miran por corrida. Muy por encima de la cartera. */
export const TOPE_TENANTS = 500;
/** Teléfonos de cobranza por comercio, como máximo (`DISENO.md` §4undecies.2). */
export const TELEFONOS_PAGO_MAXIMO = 5;

export function enHorarioDeEnvio(ahoraMs: number): boolean {
  const h = horaBolivia(ahoraMs);
  return h >= HORARIO_ENVIO.desde && h < HORARIO_ENVIO.hasta;
}

/** Los teléfonos válidos de `cuenta.telefonosPago`, hasta cinco. Pura. */
export function telefonosPagoDe(cuenta: CuentaCruda | null | undefined): string[] {
  const lista = cuenta?.telefonosPago;
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  for (const t of lista) {
    const v = texto(t, 25);
    if (TELEFONO.test(v)) vistos.add(v);
    if (vistos.size >= TELEFONOS_PAGO_MAXIMO) break;
  }
  return [...vistos];
}

export interface RecordatorioParaElFlujo extends Recordatorio {
  tenantId: string;
  /** El primero de `telefonos`, por comodidad del flujo. */
  telefono: string;
  telefonos: string[];
}

export interface ConfirmacionParaElFlujo {
  tenantId: string;
  telefono: string;
  telefonos: string[];
  pagoId: string;
  clave: string;
  plantilla: string;
  parametros: string[];
}

/**
 * Las confirmaciones de pago que A-2 deja en `cuenta.confirmacionesPendientes`
 * (`{ [pagoId]: { parametros: string[] } }`), listas para la plantilla
 * `pago_confirmado`. Se marcan con la clave `confirmacion_<pagoId>`, que
 * `recordatorioPrepagoEnviado` reconoce para borrar la pendiente.
 */
export function confirmacionesDe(cuenta: CuentaCruda | null | undefined): { pagoId: string; parametros: string[] }[] {
  const mapa = cuenta?.confirmacionesPendientes;
  if (typeof mapa !== 'object' || mapa === null) return [];
  const salida: { pagoId: string; parametros: string[] }[] = [];
  for (const [pagoId, v] of Object.entries(mapa as Record<string, unknown>)) {
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(pagoId)) continue;
    const p = (v as { parametros?: unknown } | null)?.parametros;
    if (!Array.isArray(p) || p.length !== PLANTILLAS.confirmacion.variables.length) continue;
    if (!p.every((x) => typeof x === 'string' && x.trim() !== '')) continue;
    salida.push({ pagoId, parametros: p.map((x) => String(x).slice(0, 120)) });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// A QUIÉN LE TOCA
// ---------------------------------------------------------------------------

export const recordatoriosPrepago = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    // Servidor a servidor, como la ingesta: sin CORS.
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    // SOLO EL NÚMERO DE NOVUCHAT. Un número de comercio autentica, pero no
    // tiene por qué ver la situación de pago de ningún otro comercio.
    if (ruta.flujo !== 'onboarding') { respuesta.status(403).json({ error: 'solo el numero de NovuChat' }); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const db = getFirestore();
    const ahoraMs = Date.now();
    const vacio = { recordatorios: [], confirmaciones: [], sinTelefono: [], tipoCambio: null };
    if (!enHorarioDeEnvio(ahoraMs)) {
      respuesta.status(200).json({ ...vacio, fueraDeHorario: true });
      return;
    }

    const tipoCambio = tipoCambioVigente((await db.doc('plataforma/tipoCambio').get()).data(), ahoraMs);
    const tco = tipoCambio?.tco ?? null;
    const periodo = periodoDe(ahoraMs);

    // Los comercios activos, y de cada uno su cuenta, su agregado del mes y su
    // ficha de negocio (por el teléfono de recepción). Tres lecturas por
    // comercio y por corrida: a 100 comercios y 10 corridas al día, 3.000
    // lecturas diarias, que a la tarifa de Firestore no es nada. No se consulta
    // `cuenta` como grupo de colecciones: exigiría un índice de grupo por
    // `modalidad` que se paga en cada escritura de cada cuenta.
    const tenants = await db.collection('tenants').where('estado', '==', 'activo').limit(TOPE_TENANTS).get();
    const recordatorios: RecordatorioParaElFlujo[] = [];
    const confirmaciones: ConfirmacionParaElFlujo[] = [];
    const sinTelefono: { tenantId: string; claves: string[] }[] = [];

    const ids = tenants.docs.map((d) => d.id).filter((id) => ID_TENANT.test(id));
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const refs = lote.flatMap((id) => [
        db.doc(`tenants/${id}/cuenta/estado`),
        db.doc(`tenants/${id}/metricas/${periodo}`),
        db.doc(`tenants/${id}/config/negocio`),
      ]);
      const docs = await db.getAll(...refs);
      lote.forEach((tenantId, j) => {
        const cuenta = (docs[j * 3]?.data() ?? {}) as CuentaCruda;
        if (modalidadDe(cuenta) === 'demostracion') return;
        const metricas = docs[j * 3 + 1]?.data();
        const negocio = docs[j * 3 + 2]?.data() ?? {};
        const estado = estadoDeServicio(cuenta, consumidasDe(metricas), ahoraMs);
        const debidos = recordatoriosDebidos(cuenta, estado, ahoraMs, {
          tco, numeroRecepcion: texto(negocio['numeroRecepcion'], 25),
        });
        const pendientes = confirmacionesDe(cuenta)
          .filter((c) => !(typeof cuenta.recordatorios === 'object' && cuenta.recordatorios !== null
            && `confirmacion_${c.pagoId}` in (cuenta.recordatorios as Record<string, unknown>)));
        if (debidos.length === 0 && pendientes.length === 0) return;
        const telefonos = telefonosPagoDe(cuenta);
        if (telefonos.length === 0) {
          sinTelefono.push({ tenantId, claves: [
            ...debidos.map((r) => r.clave), ...pendientes.map((c) => `confirmacion_${c.pagoId}`),
          ] });
          return;
        }
        const telefono = telefonos[0]!;
        for (const r of debidos) recordatorios.push({ ...r, tenantId, telefono, telefonos });
        for (const c of pendientes) {
          confirmaciones.push({
            tenantId, telefono, telefonos, pagoId: c.pagoId, clave: `confirmacion_${c.pagoId}`,
            plantilla: PLANTILLAS.confirmacion.nombre, parametros: c.parametros,
          });
        }
      });
    }

    // Sin bitácora: listar no le hace nada a nadie. Lo que sí se registra es
    // cada envío, al marcarlo.
    respuesta.status(200).json({
      recordatorios, confirmaciones, sinTelefono,
      tipoCambio: tipoCambio ? { tco: tipoCambio.tco, fecha: tipoCambio.fecha } : null,
      fueraDeHorario: false,
    });
  },
);

// ---------------------------------------------------------------------------
// SE MANDÓ (Y SE MARCA ANTES DE MANDAR)
// ---------------------------------------------------------------------------

export const recordatorioPrepagoEnviado = onRequest(
  {
    region: REGION,
    secrets: Object.values(SECRETOS_POR_ALIAS),
    cors: false,
    maxInstances: 10,
  },
  async (peticion, respuesta) => {
    if (peticion.method !== 'POST') { respuesta.status(405).send('metodo'); return; }

    const ruta = await rutaAutenticada(peticion);
    if (!ruta) { respuesta.status(401).send('no autorizado'); return; }
    if (ruta.flujo !== 'onboarding') { respuesta.status(403).json({ error: 'solo el numero de NovuChat' }); return; }
    if (ruta.estado !== 'activo') { respuesta.status(409).json({ estado: ruta.estado }); return; }

    const cuerpo = (typeof peticion.body === 'object' && peticion.body !== null
      ? peticion.body : {}) as Record<string, unknown>;
    const tenantId = texto(cuerpo['tenantId'], 60);
    if (!ID_TENANT.test(tenantId)) { respuesta.status(400).json({ error: 'tenantId invalido' }); return; }
    const clave = texto(cuerpo['clave'], 80);
    const valida = claveValida(clave, Date.now());
    // Una clave rechazada queda en la bitácora del tenant: es el número de
    // NovuChat intentando marcar algo que el servidor no generó.
    const rechazar = async (codigo: string) => {
      await registrar(tenantId, {
        tipo: 'entrada_descartada', resultado: 'rechazado', canal: 'sistema', codigo, detalle: clave.slice(0, 120),
      });
      respuesta.status(400).json({ error: 'clave invalida', codigo });
    };
    if (valida === null) { await rechazar('clave_invalida'); return; }

    const db = getFirestore();
    const refCuenta = db.doc(`tenants/${tenantId}/cuenta/estado`);

    // IDEMPOTENTE POR CONSTRUCCIÓN: solo la PRIMERA marca mueve algo; la
    // segunda ve la clave y contesta `repetido`, sin dejar mandar otra vez.
    const salida = await db.runTransaction(async (tx) => {
      const cuenta = await tx.get(refCuenta);
      if (!cuenta.exists) return { marcado: false, repetido: false, motivo: 'sin_cuenta' as const };
      // Una demostración no recibe cobranza: tampoco se le marca nada.
      if (modalidadDe(cuenta.data() as CuentaCruda) === 'demostracion') {
        return { marcado: false, repetido: false, motivo: 'demostracion' as const };
      }
      const previos = cuenta.get('recordatorios');
      if (typeof previos === 'object' && previos !== null && clave in (previos as Record<string, unknown>)) {
        return { marcado: false, repetido: true };
      }
      // Una confirmación se marca SOLO si está pendiente: la deja A-2 al
      // aplicar el pago, y nadie más.
      const pagoId = valida.tipo === 'confirmacion' ? valida.pagoId : '';
      if (pagoId) {
        const pendientes = cuenta.get('confirmacionesPendientes');
        if (typeof pendientes !== 'object' || pendientes === null
            || !(pagoId in (pendientes as Record<string, unknown>))) {
          return { marcado: false, repetido: false, motivo: 'sin_confirmacion' as const };
        }
      }
      tx.set(refCuenta, {
        recordatorios: { [clave]: Timestamp.now() },
        // La confirmación pendiente se cierra al marcarla: ya salió (o se perdió).
        ...(pagoId ? { confirmacionesPendientes: { [pagoId]: FieldValue.delete() } } : {}),
      }, { merge: true });
      return { marcado: true, repetido: false };
    });

    if ('motivo' in salida && salida.motivo === 'sin_confirmacion') { await rechazar('sin_confirmacion'); return; }
    if (salida.marcado) {
      // Queda en la bitácora del comercio: le llegó una plantilla de NovuChat
      // sobre su cuenta. Sin teléfono: el destino es el comercio, no un cliente.
      await registrar(tenantId, {
        tipo: 'plantilla_enviada', resultado: 'ok', canal: 'sistema', detalle: clave,
      });
    }
    respuesta.status(200).json(salida);
  },
);
