/**
 * =============================================================================
 * LA COLA PROPIA DE LA CAMPAÑA SALIENTE DEL CHAT — `salidaCampana` (CORE, PR-C, 27/11/2026)
 * =============================================================================
 *
 * La campaña NO escribe mensajes `pendiente` en la cola de las personas. El script de NovuChat solo escribe DESTINATARIOS en
 * `tenants/{t}/campanasSalientes/{campanaId}/destinatarios/{wa_tel}` y AUTORIZA una tanda (cupo + calidad informada por el
 * operador) en la campaña. En cada reclamo de `reclamarSalidaPersona`, DESPUÉS de los mensajes de las personas y solo con los
 * lugares que queden libres, `materializarCampana` crea como máximo `porReclamo` mensajes directamente en `enviando`, en UNA
 * transacción que verifica todos los topes. Un mensaje `autor: 'campana'` escrito a mano en `pendiente` ya no sale nunca
 * (`fueraDeCola`): así la campaña no puede hacer caducar un mensaje de una persona (la cola de las personas no la ve).
 *
 * LAS CIFRAS viven en `tenants/{t}/config/campanaSaliente` (documento de Core que solo escribe el servidor): dependen de la
 * calidad del número, no de lo que se vende, y Core no puede importar Central. Sin el documento, o con un valor ilegible, la
 * campaña queda CERRADA (falla cerrada).
 *
 * UNO POR CONTACTO, POR ESTRUCTURA: el id del destinatario es `wa_<dígitos>` (una sola vez por campaña), pasa UNA sola vez de
 * `pendiente` a `enviado`, y el mensaje tiene id determinista `camp_<campanaId>_<dígitos>` creado con `tx.create`.
 *
 * UNA CAMPAÑA EN CURSO POR NÚMERO: el puntero `rutasWhatsApp/{n}.campanaSalienteEnCurso` lo escribe `autorizar-tanda` y lo borra
 * `cerrar-tanda` o `pausar`. Sin puntero el reclamo no hace ninguna lectura de más.
 *
 * NUNCA MÁS DE `porReclamo` EN VUELO: la campaña cuenta `materializados`, `aceptados`, `rechazados` e `inciertos`; solo se
 * materializa si `materializados - aceptados - rechazados - inciertos` es 0. Con `porReclamo` ≤ 10 siempre quedan lugares
 * para las personas.
 *
 * Costo: 0 mensajes por conversación (la campaña es un envío aparte, cuenta en `plantillasCampana`).
 */
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { Ruta } from '../seguridad/firma.js';
import { CAMPANA_ID } from './bajas.js';
import {
  IDIOMA_DE_PLANTILLA, MAXIMO_POR_RECLAMO, NOMBRE_DE_PLANTILLA, canalDeSalidaDe, claveReleDe, type BotonDePlantilla,
} from './salidaPersona.js';
import { milisegundosDeMomento } from './turno.js';

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------

/** El id de una tanda: minúsculas, dígitos y guiones, de 1 a 20. */
export const TANDA_ID = /^[a-z0-9-]{1,20}$/;
/** El id de un destinatario: `wa_` y los dígitos de `messages[0].from` (con 591, sin `+` ni espacios). */
export const DESTINATARIO_ID = /^wa_[0-9]{8,15}$/;
/** Quien escribió hace menos de esto no recibe la campaña (motivo `reciente`): 24 h. */
export const RECIENTE_MS = 24 * 60 * 60 * 1000;
/** El máximo de mensajes en vuelo de la campaña por reclamo (el mismo de la cola de personas: nunca pasa de 10). */
export const MAXIMO_POR_RECLAMO_DE_CAMPANA = MAXIMO_POR_RECLAMO;
/** El camino del documento de cifras de un comercio. */
export const refConfigCampana = (db: Firestore, tenantId: string): DocumentReference => db.doc(`tenants/${tenantId}/config/campanaSaliente`);
/** El documento de una campaña. */
export const refCampana = (db: Firestore, tenantId: string, campanaId: string): DocumentReference => db.doc(`tenants/${tenantId}/campanasSalientes/${campanaId}`);
/** El contador diario de la campaña de un comercio: `topesDeEnvio/c_{t}` = `{ dia, nDia, actualizadoEn }`. */
export const refContadorCampana = (db: Firestore, tenantId: string): DocumentReference => db.doc(`topesDeEnvio/c_${tenantId}`);

/** Los motivos por los que el servidor omite a un destinatario (no consume cupo). */
export const MOTIVOS_DE_OMISION = ['idInvalido', 'sinConversacion', 'otraLinea', 'baja', 'marcas', 'reciente', 'repetido'] as const;
export type MotivoDeOmision = (typeof MOTIVOS_DE_OMISION)[number];

// ---------------------------------------------------------------------------
// LA CONFIGURACIÓN
// ---------------------------------------------------------------------------

export interface ConfigCampana {
  porTanda: number;
  porDia: number;
  porReclamo: number;
  ventanaDias: number;
  pausaErroresPct: number;
  pausaMinimoEnviados: number;
  pausaNoPct: number;
}

const CAMPOS_ENTEROS = ['porTanda', 'porDia', 'porReclamo', 'ventanaDias', 'pausaErroresPct', 'pausaMinimoEnviados', 'pausaNoPct'] as const;
const CAMPOS_PORCENTAJE: readonly string[] = ['pausaErroresPct', 'pausaNoPct'];

const enteroPositivo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const contador = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * La configuración validada, o `null` si falta algo o algo no es exactamente lo esperado: todos son ENTEROS ≥ 1 (un texto
 * `"45"`, un 0, un negativo o un decimal la invalidan), `porReclamo` ≤ `MAXIMO_POR_RECLAMO` y los dos porcentajes ≤ 100.
 * Con `null` la campaña queda cerrada.
 */
export function leerConfigCampana(d: unknown): ConfigCampana | null {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const r: Record<string, number> = {};
  for (const c of CAMPOS_ENTEROS) {
    const v = Object.hasOwn(o, c) ? o[c] : undefined;
    if (!enteroPositivo(v)) return null;
    if (CAMPOS_PORCENTAJE.includes(c) && v > 100) return null;
    r[c] = v;
  }
  if ((r['porReclamo'] as number) > MAXIMO_POR_RECLAMO_DE_CAMPANA) return null;
  return r as unknown as ConfigCampana;
}

// ---------------------------------------------------------------------------
// LÓGICA PURA
// ---------------------------------------------------------------------------

/** El id del mensaje de un destinatario: `camp_<campanaId>_<dígitos>` (determinista: crear dos veces es imposible). */
export const claveDeMensajeCampana = (campanaId: string, destinatario: string): string => `camp_${campanaId}_${destinatario.slice(3)}`;

/** El día en hora de La Paz (UTC-4 fijo), `AAAA-MM-DD`, como en `retomarConversacion`. */
export const diaDeLaPaz = (ms: number): string => new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);

export interface EntradaDeCupo {
  libres: number;
  config: ConfigCampana;
  tanda: { cupo: number; usados: number };
  nDia: number;
  enVuelo: number;
}

/**
 * Cuántos mensajes de campaña se pueden materializar en esta vuelta. 0 si hay algo en vuelo o si el cupo de la tanda supera
 * `porTanda` (cupo manipulado); en otro caso `max(0, min(libres, porReclamo, cupo - usados, porDia - nDia))`.
 */
export function cupoDeLaVuelta(e: EntradaDeCupo): number {
  const { libres, config, tanda, nDia, enVuelo } = e;
  const numeros = [libres, tanda.cupo, tanda.usados, nDia, enVuelo];
  if (!numeros.every((n) => typeof n === 'number' && Number.isFinite(n))) return 0;
  if (enVuelo > 0 || tanda.cupo > config.porTanda) return 0;
  return Math.max(0, Math.min(libres, config.porReclamo, tanda.cupo - tanda.usados, config.porDia - nDia));
}

export type EstadoDeEnvioCampana = 'enviando' | 'aceptado' | 'rechazado' | 'incierto';
export interface Conteos { aceptados: number; rechazados: number; inciertos: number }

/**
 * El cambio de los contadores de la campaña por una transición válida de un mensaje suyo, o `null` si no es una (el mismo
 * resultado repetido no cuenta dos veces: llamarla con `de === a` da `null`).
 *   enviando -> aceptado | rechazado | incierto;  incierto -> aceptado | rechazado (resta uno de `inciertos`).
 */
export function cuentaDeTransicion(de: unknown, a: unknown): Conteos | null {
  const cero: Conteos = { aceptados: 0, rechazados: 0, inciertos: 0 };
  if (de === 'enviando' && a === 'aceptado') return { ...cero, aceptados: 1 };
  if (de === 'enviando' && a === 'rechazado') return { ...cero, rechazados: 1 };
  if (de === 'enviando' && a === 'incierto') return { ...cero, inciertos: 1 };
  if (de === 'incierto' && a === 'aceptado') return { ...cero, aceptados: 1, inciertos: -1 };
  if (de === 'incierto' && a === 'rechazado') return { ...cero, rechazados: 1, inciertos: -1 };
  return null;
}

/**
 * ¿Hay que pausar por errores? Con al menos `pausaMinimoEnviados` desenlaces (aceptados + rechazados + inciertos) y los que NO se
 * confirmaron (rechazados + inciertos) por ENCIMA de `pausaErroresPct` %: `(rechazados+inciertos)*100 > pausaErroresPct*total`.
 * Un incierto cuenta como falla: no se sabe si salió. Exactamente el porcentaje no pausa. `inciertos` ausente vale 0.
 */
export function debePausar(c: { aceptados: number; rechazados: number; inciertos?: number }, cfg: ConfigCampana): boolean {
  const inciertos = c.inciertos ?? 0;
  if (!contador(c.aceptados) || !contador(c.rechazados) || !contador(inciertos)) return false;
  const total = c.aceptados + c.rechazados + inciertos;
  return total >= cfg.pausaMinimoEnviados && (c.rechazados + inciertos) * 100 > cfg.pausaErroresPct * total;
}

/** Lo que el servidor exige de la plantilla de campaña registrada en la ruta (copia de `plantillaCampanaValida` del script; hay una prueba de paridad). */
export function plantillaDeCampanaValida(p: unknown): p is { nombre: string; idioma: string; categoria: 'UTILITY' | 'MARKETING' } {
  if (typeof p !== 'object' || p === null) return false;
  const o = p as Record<string, unknown>;
  return typeof o['nombre'] === 'string' && NOMBRE_DE_PLANTILLA.test(o['nombre'])
    && typeof o['idioma'] === 'string' && IDIOMA_DE_PLANTILLA.test(o['idioma'])
    && (o['categoria'] === 'UTILITY' || o['categoria'] === 'MARKETING') && o['estado'] === 'APPROVED'
    && o['variables'] === 0 && o['cabecera'] === 'ninguna' && o['botones'] === 2;
}

/** Lo que la campaña sabe de sí misma, ya validado. `null` si algo no cuadra (la campaña no sale). */
export interface CampanaLeida {
  id: string;
  tanda: { id: string; cupo: number; usados: number };
  enVuelo: number;
  materializados: number;
}

/** La campaña validada para materializar, o `null`: debe estar `enCurso`, ser de esta línea, con tanda y contadores legibles. */
export function leerCampanaEnCurso(id: string, d: Record<string, unknown> | undefined, phoneNumberId: string): CampanaLeida | null {
  if (!d || d['estado'] !== 'enCurso' || d['phoneNumberId'] !== phoneNumberId) return null;
  const t = d['tanda'];
  if (typeof t !== 'object' || t === null || Array.isArray(t)) return null;
  const { id: tandaId, cupo, usados } = t as Record<string, unknown>;
  if (typeof tandaId !== 'string' || !TANDA_ID.test(tandaId) || !enteroPositivo(cupo) || !contador(usados)) return null;
  const { materializados, aceptados, rechazados, inciertos } = d;
  if (!contador(materializados) || !contador(aceptados) || !contador(rechazados) || !contador(inciertos)) return null;
  const enVuelo = materializados - aceptados - rechazados - inciertos;
  if (enVuelo < 0) return null;
  return { id, tanda: { id: tandaId, cupo, usados }, enVuelo, materializados };
}

// ---------------------------------------------------------------------------
// LA MATERIALIZACIÓN
// ---------------------------------------------------------------------------

export interface MensajeDeCampanaMaterializado {
  mensajeId: string;
  conversacionId: string;
  claveRele: string;
  to: string;
  canal: 'rele' | 'graph';
  texto: '';
  tipo: 'plantilla';
  plantilla: { nombre: string; idioma: string; parametros: string[]; botones: BotonDePlantilla[] };
}

/** Cualquier valor de una marca distinto de ausente o `false` frena (la campaña cierra ante la duda). */
const marcado = (v: unknown): boolean => v !== undefined && v !== false;

/**
 * Materializa hasta `min(libres, porReclamo, …)` mensajes de la campaña en curso del número, directamente en `enviando`.
 * Una sola transacción: lee campaña, cifras y contador; después los destinatarios `pendiente` (con `limit`) y, de cada uno, su
 * conversación, su baja y su mensaje `camp_…`; recién entonces escribe. Devuelve `[]` si algo no cuadra (sin escribir nada).
 * `rutaDoc` son los DATOS de `rutasWhatsApp/{n}` (nunca se fía de ellos más que para el puntero y la plantilla, y los valida).
 */
export async function materializarCampana(
  ruta: Ruta, rutaDoc: Record<string, unknown> | undefined, db: Firestore, ahoraMs: number, libres: number,
): Promise<MensajeDeCampanaMaterializado[]> {
  const puntero = rutaDoc?.['campanaSalienteEnCurso'];
  if (typeof puntero !== 'string' || !CAMPANA_ID.test(puntero) || libres < 1) return [];
  const plantillas = rutaDoc?.['plantillas'];
  const plantilla = typeof plantillas === 'object' && plantillas !== null ? (plantillas as Record<string, unknown>)['campana'] : undefined;
  if (!plantillaDeCampanaValida(plantilla)) return [];
  const { tenantId, phoneNumberId } = ruta;
  const canal = canalDeSalidaDe(rutaDoc);
  const dia = diaDeLaPaz(ahoraMs);
  const ts = Timestamp.fromMillis(ahoraMs);

  return db.runTransaction(async (tx): Promise<MensajeDeCampanaMaterializado[]> => {
    const refC = refCampana(db, tenantId, puntero);
    const [campanaSnap, configSnap, contadorSnap] = await tx.getAll(refC, refConfigCampana(db, tenantId), refContadorCampana(db, tenantId));
    const config = leerConfigCampana(configSnap?.data());
    const campana = leerCampanaEnCurso(puntero, campanaSnap?.data(), phoneNumberId);
    if (!config || !campana) return [];
    const nDiaLeido: unknown = contadorSnap?.get('dia') === dia ? contadorSnap.get('nDia') : 0;
    if (!contador(nDiaLeido)) return [];
    const cupo = cupoDeLaVuelta({ libres, config, tanda: campana.tanda, nDia: nDiaLeido, enVuelo: campana.enVuelo });
    if (cupo < 1) return [];

    const pendientes = await tx.get(refC.collection('destinatarios').where('estado', '==', 'pendiente').limit(cupo * 2));
    if (pendientes.empty) return [];
    // Las lecturas de cada destinatario (conversación, baja, mensaje) van TODAS antes de la primera escritura.
    const validos = pendientes.docs.filter((p) => DESTINATARIO_ID.test(p.id));
    const lecturas = new Map<string, [DocumentSnapshot, DocumentSnapshot, DocumentSnapshot]>();
    if (validos.length > 0) {
      const refs = validos.flatMap((p) => [
        db.doc(`tenants/${tenantId}/conversaciones/${p.id}`), db.doc(`tenants/${tenantId}/bajas/${p.id}`),
        db.doc(`tenants/${tenantId}/conversaciones/${p.id}/mensajes/${claveDeMensajeCampana(puntero, p.id)}`),
      ]);
      const snaps = await tx.getAll(...refs);
      validos.forEach((p, i) => lecturas.set(p.id, [snaps[i * 3]!, snaps[i * 3 + 1]!, snaps[i * 3 + 2]!]));
    }

    const salida: MensajeDeCampanaMaterializado[] = [];
    const escrituras: Array<() => void> = [];
    for (const p of pendientes.docs) {
      if (salida.length >= cupo) break; // el resto queda `pendiente` para la vuelta siguiente (se leyó de más para que las omisiones no gasten la vuelta)
      const omitir = (motivo: MotivoDeOmision) => escrituras.push(() => tx.update(p.ref, { estado: 'omitido', motivo, en: ts }));
      const l = lecturas.get(p.id);
      if (!l) { omitir('idInvalido'); continue; }
      const [conv, baja, existente] = l;
      const entrante = conv.exists ? milisegundosDeMomento(conv.get('ultimoEntranteEn')) : null;
      const linea: unknown = conv.exists ? conv.get('phoneNumberId') : undefined;
      if (entrante === null) { omitir('sinConversacion'); continue; }
      if (linea !== undefined && linea !== phoneNumberId) { omitir('otraLinea'); continue; }
      if (baja.exists) { omitir('baja'); continue; }
      if (marcado(conv.get('noContactar')) || marcado(conv.get('bloqueada')) || marcado(conv.get('riesgoEn'))) { omitir('marcas'); continue; }
      if (ahoraMs - entrante < RECIENTE_MS) { omitir('reciente'); continue; }
      if (existente.exists) { omitir('repetido'); continue; }
      const clave = claveDeMensajeCampana(puntero, p.id);
      const botones: BotonDePlantilla[] = [{ indice: 0, payload: `cs:si:${puntero}` }, { indice: 1, payload: `cs:no:${puntero}` }];
      const cuerpo = { nombre: plantilla.nombre, idioma: plantilla.idioma, parametros: [] as string[], botones };
      escrituras.push(() => {
        tx.create(existente.ref, {
          direccion: 'saliente', tipo: 'plantilla', texto: '', ts, reclamadoEn: ts, autor: 'campana', estadoEnvio: 'enviando',
          tenantId, phoneNumberId, campanaId: puntero, tandaId: campana.tanda.id, contado: false, plantilla: cuerpo,
        });
        tx.update(p.ref, { estado: 'enviado', tandaId: campana.tanda.id, mensajeId: clave, en: ts });
      });
      salida.push({ mensajeId: clave, conversacionId: p.id, claveRele: claveReleDe(tenantId, p.id, clave), to: p.id.slice(3), canal, texto: '', tipo: 'plantilla', plantilla: cuerpo });
    }
    for (const e of escrituras) e();
    if (salida.length > 0) {
      const n = salida.length;
      tx.update(refC, { 'tanda.usados': campana.tanda.usados + n, materializados: campana.materializados + n });
      tx.set(refContadorCampana(db, tenantId), { dia, nDia: nDiaLeido + n, actualizadoEn: ts });
    }
    return salida;
  });
}

/**
 * Los cambios de la campaña por una transición ya validada de uno de sus mensajes: los contadores nuevos (absolutos, leídos en la
 * misma transacción) y, si `config` es legible y la campaña está `enCurso`, la pausa por errores (`estado: 'pausada'`,
 * `motivoPausa: 'errores'`). `null` si los contadores de la campaña no son legibles (no se toca nada: falla cerrada hacia no contar).
 */
export function cambiosDeCampana(d: Record<string, unknown> | undefined, c: Conteos, config: ConfigCampana | null): Record<string, unknown> | null {
  if (!d) return null;
  const { aceptados, rechazados, inciertos } = d;
  if (!contador(aceptados) || !contador(rechazados) || !contador(inciertos)) return null;
  const nuevo = { aceptados: aceptados + c.aceptados, rechazados: rechazados + c.rechazados, inciertos: inciertos + c.inciertos };
  if (!contador(nuevo.inciertos)) return null;
  const cambios: Record<string, unknown> = { ...nuevo };
  if (config && d['estado'] === 'enCurso' && debePausar(nuevo, config)) { cambios['estado'] = 'pausada'; cambios['motivoPausa'] = 'errores'; }
  return cambios;
}

/** Suma los conteos de una transición a la campaña, dentro de la transacción que la confirma. */
export function sumarConteosDeCampana(tx: Transaction, ref: DocumentReference, c: Conteos): void {
  const cambios: Record<string, unknown> = {};
  if (c.aceptados !== 0) cambios['aceptados'] = FieldValue.increment(c.aceptados);
  if (c.rechazados !== 0) cambios['rechazados'] = FieldValue.increment(c.rechazados);
  if (c.inciertos !== 0) cambios['inciertos'] = FieldValue.increment(c.inciertos);
  if (Object.keys(cambios).length > 0) tx.update(ref, cambios);
}
