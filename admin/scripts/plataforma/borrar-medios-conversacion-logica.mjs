/**
 * LÓGICA DE `borrar-medios-conversacion.mjs`: borrar los medios guardados de UNA conversación de UN comercio
 * (pedido del titular de los datos). Sin importar Firebase: `db` y `almacen` se inyectan, para probarla con dobles.
 *
 * Garantías: un comercio y una conversación por ejecución; solo toca `mediosRecibidos` con ese `conversacionId` y
 * objetos cuya ruta pasa la validación estricta; respaldo del METADATO (sin bytes) antes de borrar; auditoría
 * fail-closed (si no se anota, no se borra); idempotente; no imprime teléfonos completos, rutas ni contenido.
 *
 * Orden (reanudable): respaldo -> auditoría -> objetos de Storage -> marca `medio.estado='borrado'` en los mensajes ->
 * documentos `mediosRecibidos` (el último: son el cursor, mientras existan una nueva corrida sigue donde quedó).
 */
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const CONVERSACION = /^wa_[0-9]{8,15}$/;
const MAX_MEDIOS = 5000;

/** Últimos 4 dígitos: lo único que se imprime de un teléfono. */
export const ultimos4 = (conv) => `…${String(conv ?? '').replace(/\D/g, '').slice(-4)}`;

/** Ruta de objeto válida de ESE comercio: `tenants/{t}/medios/{aaaa-mm-dd}/{64 hex}.{ext}`, sin `..` ni otra carpeta. */
export function rutaValida(ruta, tenant) {
  if (typeof ruta !== 'string' || ruta.includes('..') || ruta.includes('\\') || ruta.includes('//')) return false;
  if (!ruta.startsWith(`tenants/${tenant}/medios/`)) return false;
  const resto = ruta.slice(`tenants/${tenant}/medios/`.length);
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(resto);
}

export function validarEntrada({ tenant, conversacion }) {
  const problemas = [];
  if (!ID_TENANT.test(String(tenant ?? ''))) problemas.push('--tenant inválido');
  if (!CONVERSACION.test(String(conversacion ?? ''))) problemas.push('--conversacion inválida (wa_ y 8 a 15 dígitos)');
  return problemas;
}

const aTexto = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null);

export async function leerMedios(db, tenant, conversacion) {
  const snap = await db.collection(`tenants/${tenant}/mediosRecibidos`).where('conversacionId', '==', conversacion).limit(MAX_MEDIOS + 1).get();
  if (snap.docs.length > MAX_MEDIOS) throw new Error(`más de ${MAX_MEDIOS} medios en una conversación: no se sigue`);
  return snap.docs;
}

export async function resumir({ db, almacen, tenant, conversacion }) {
  const docs = await leerMedios(db, tenant, conversacion);
  const porTipo = {}; const porEstado = {};
  let objetos = 0; let rutasInvalidas = 0;
  for (const d of docs) {
    const t = String(d.get('tipo') ?? '?'); const e = String(d.get('estado') ?? '?');
    porTipo[t] = (porTipo[t] ?? 0) + 1; porEstado[e] = (porEstado[e] ?? 0) + 1;
    const ruta = d.get('ruta');
    if (ruta == null) continue;
    if (!rutaValida(ruta, tenant)) { rutasInvalidas += 1; continue; }
    if (await almacen.existe(ruta)) objetos += 1;
  }
  return { medios: docs.length, porTipo, porEstado, objetos, rutasInvalidas };
}

/** Respaldo del metadato (sin bytes) en un archivo 600 dentro de `carpeta`. Devuelve su nombre (sin ruta). */
export function respaldar({ carpeta, tenant, conversacion, docs, ahora }) {
  mkdirSync(carpeta, { recursive: true });
  const nombre = `respaldo-medios-${tenant}-${conversacion.slice(-4)}-${ahora.toISOString().replace(/[:.]/g, '-')}.json`;
  const ruta = join(carpeta, nombre);
  const contenido = JSON.stringify({
    tenant, conversacion, respaldadoEn: ahora.toISOString(), nota: 'solo metadato; sin bytes',
    medios: docs.map((d) => {
      const o = {};
      for (const [k, v] of Object.entries(d.data())) o[k] = aTexto(v);
      return { id: d.id, ...o };
    }),
  }, null, 2);
  writeFileSync(ruta, contenido, { mode: 0o600, flag: 'wx' });
  chmodSync(ruta, 0o600);
  return nombre;
}

export async function ejecutar({ db, almacen, tenant, conversacion, motivo = '', aplicar = false, respaldoEn = null, ejecutor = 'script', ahora = new Date(), log = () => {} }) {
  const problemas = validarEntrada({ tenant, conversacion });
  if (problemas.length) return { ok: false, error: problemas.join('; ') };
  const ficha = await db.doc(`tenants/${tenant}`).get();
  if (!ficha.exists) return { ok: false, error: 'el comercio no existe' };

  const antes = await resumir({ db, almacen, tenant, conversacion });
  log(`Comercio ${tenant} · conversación ${ultimos4(conversacion)}`);
  log(`Medios: ${antes.medios} · por tipo ${JSON.stringify(antes.porTipo)} · por estado ${JSON.stringify(antes.porEstado)} · objetos en Storage: ${antes.objetos}`);
  if (antes.rutasInvalidas) log(`Atención: ${antes.rutasInvalidas} ruta(s) fuera del formato esperado; no se enviarán al almacén`);
  if (!aplicar) {
    log(antes.medios === 0 ? 'Seco: no hay nada que borrar.' : 'Seco: no se escribió nada. Con --aplicar se haría respaldo, auditoría, borrado de objetos, marca en mensajes y borrado de metadatos.');
    return { ok: true, seco: true, antes };
  }
  if (antes.medios === 0) {
    log('No quedan medios de esa conversación: nada que hacer (idempotente).');
    return { ok: true, antes, despues: { medios: 0, objetos: 0 }, sinCambios: true };
  }
  if (!respaldoEn) return { ok: false, error: 'con --aplicar falta --respaldo-en <carpeta fuera del repositorio>' };
  if (!String(motivo).trim()) return { ok: false, error: 'con --aplicar falta --motivo' };

  const docs = await leerMedios(db, tenant, conversacion);
  // 1. Respaldo del metadato ANTES de borrar.
  const archivo = respaldar({ carpeta: respaldoEn, tenant, conversacion, docs, ahora });
  log(`Respaldo del metadato creado (600): ${archivo}`);

  // 2. Auditoría fail-closed: sin esta anotación no se borra nada.
  let refAud;
  try {
    refAud = db.collection(`tenants/${tenant}/auditoria`).doc();
    await refAud.set({
      accion: 'borrar_medios_conversacion', origen: 'script', script: 'borrar-medios-conversacion', uid: ejecutor,
      motivo: String(motivo).trim().slice(0, 200), medios: antes.medios, objetos: antes.objetos, estado: 'iniciada', en: ahora,
    });
  } catch {
    return { ok: false, error: 'no se pudo anotar la auditoría: no se borró nada' };
  }

  // 3. Objetos de Storage (solo rutas validadas de ESE comercio).
  let objetosBorrados = 0; let omitidos = 0;
  for (const d of docs) {
    const ruta = d.get('ruta');
    if (ruta == null) continue;
    if (!rutaValida(ruta, tenant)) { omitidos += 1; continue; }
    if (await almacen.borrar(ruta)) objetosBorrados += 1;
  }

  // 4. Mensajes: se marca el medio como borrado; el texto y el mensaje quedan.
  let mensajesMarcados = 0;
  for (const d of docs) {
    const idMeta = d.get('idMeta');
    if (!idMeta) continue;
    const ms = await db.collection(`tenants/${tenant}/conversaciones/${conversacion}/mensajes`).where('idMeta', '==', idMeta).limit(10).get();
    for (const m of ms.docs) {
      await m.ref.update({ medio: { estado: 'borrado', borradoEn: ahora } });
      mensajesMarcados += 1;
    }
  }

  // 5. Metadatos (el cursor de reanudación va al final).
  for (const d of docs) await d.ref.delete();

  try {
    await refAud.update({ estado: 'terminada', objetosBorrados, mensajesMarcados, rutasOmitidas: omitidos, terminadaEn: ahora });
  } catch { log('Aviso: no se pudo cerrar la anotación de auditoría (la de inicio existe).'); }

  const despues = await resumir({ db, almacen, tenant, conversacion });
  log(`Borrados: ${docs.length} metadato(s), ${objetosBorrados} objeto(s), ${mensajesMarcados} mensaje(s) marcado(s).`);
  log(`Relectura: quedan ${despues.medios} medio(s) y ${despues.objetos} objeto(s).`);
  const limpio = despues.medios === 0 && despues.objetos === 0;
  return { ok: limpio, error: limpio ? undefined : 'la relectura final encontró restos: vuelva a ejecutar', antes, despues, objetosBorrados, mensajesMarcados, omitidos, archivo };
}

