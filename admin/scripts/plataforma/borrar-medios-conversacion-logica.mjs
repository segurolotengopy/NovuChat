/**
 * LÓGICA DE `borrar-medios-conversacion.mjs`: borrar los medios guardados de UNA conversación de UN comercio
 * (pedido del titular de los datos). Sin importar Firebase: `db` y `almacen` se inyectan, para probarla con dobles.
 *
 * El almacén inyectado: `verificar()` (lanza si el bucket no es alcanzable), `estado(ruta)` -> 'existe' | 'ausente'
 * (lanza si NO pudo comprobarlo: eso no es «ausente»), `borrar(ruta)` (lanza si falla).
 *
 * Garantías: un comercio y una conversación; solo `mediosRecibidos` con ese `conversacionId`; solo objetos cuyo nombre
 * es `sha256(idMeta)` + extensión de la lista cerrada, bajo `tenants/{t}/medios/{día}/`; una ruta fuera de formato
 * ABORTA antes de escribir (el documento se conserva); si Storage no se tocó de verdad (bucket ciego, objetos que
 * deberían estar y no se hallan) no se borra ningún metadato; respaldo del metadato (600, en carpeta 700) y auditoría
 * ANTES de borrar (fail-closed) con cierre `completada`/`fallida`; idempotente; no imprime teléfonos completos,
 * rutas ni contenido.
 *
 * CICLO DE VIDA DEL RESPALDO: contiene el teléfono completo y el idMeta. Se guarda cifrado o fuera de toda carpeta
 * sincronizada y se DESTRUYE a los 30 días de la ejecución.
 *
 * Orden (reanudable): respaldo -> auditoría -> objetos -> marca en mensajes -> documentos `mediosRecibidos` (el
 * cursor: mientras existan, una nueva corrida sigue donde quedó).
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
export const CONVERSACION = /^wa_[0-9]{8,15}$/;
const MAX_MEDIOS = 5000;
/** Lista cerrada del contrato de medios v2 (imágenes, audio, video y documentos). */
export const EXTENSIONES = ['jpg', 'png', 'webp', 'ogg', 'm4a', 'mp3', 'aac', 'amr', 'mp4', '3gp', 'pdf', 'docx', 'xlsx', 'pptx', 'zip', 'doc', 'xls', 'ppt', 'txt', 'csv', 'bin'];

export const sha256 = (t) => createHash('sha256').update(String(t)).digest('hex');
/** Últimos 4 dígitos: lo único que se imprime de un teléfono. */
export const ultimos4 = (conv) => `…${String(conv ?? '').replace(/\D/g, '').slice(-4)}`;
/** Quita de un mensaje de error todo lo que parezca teléfono, conversación o ruta. */
export const limpiarError = (e) => String(e instanceof Error ? e.message : e ?? 'error')
  .replace(/wa_\d+/g, 'wa_…').replace(/\d{8,}/g, '…').replace(/tenants\/\S+/g, 'tenants/…').slice(0, 200);

/** Ruta válida: `tenants/{t}/medios/{aaaa-mm-dd}/{sha256(idMeta)}.{ext}` de ESE comercio. */
export function rutaValida(ruta, tenant, idMeta = null) {
  if (typeof ruta !== 'string' || ruta.includes('..') || ruta.includes('\\') || ruta.includes('//')) return false;
  const pre = `tenants/${tenant}/medios/`;
  if (!ruta.startsWith(pre)) return false;
  const m = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\/([0-9a-f]{64})\.([a-z0-9]{1,4})$/.exec(ruta.slice(pre.length));
  if (!m || !EXTENSIONES.includes(m[2])) return false;
  return idMeta === null || m[1] === sha256(idMeta);
}

export function validarEntrada({ tenant, conversacion }) {
  const problemas = [];
  if (!ID_TENANT.test(String(tenant ?? ''))) problemas.push('--tenant inválido');
  if (!CONVERSACION.test(String(conversacion ?? ''))) problemas.push('--conversacion inválida (wa_ y 8 a 15 dígitos)');
  return problemas;
}

/** Ruta absoluta con los enlaces resueltos aunque el final aún no exista (para compararla con el repositorio). */
export function rutaReal(p) {
  let q = resolve(p); const resto = [];
  while (!existsSync(q)) { resto.unshift(basename(q)); q = dirname(q); }
  return resto.reduce((a, n) => a + '/' + n, realpathSync(q));
}

const aTexto = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v ?? null);

export async function leerMedios(db, tenant, conversacion) {
  const snap = await db.collection(`tenants/${tenant}/mediosRecibidos`).where('conversacionId', '==', conversacion).limit(MAX_MEDIOS + 1).get();
  if (snap.docs.length > MAX_MEDIOS) throw new Error(`más de ${MAX_MEDIOS} medios en una conversación: no se sigue`);
  return snap.docs;
}

/** Cuenta; `ciegos` = objetos cuyo estado no se pudo comprobar; `invalidas` = rutas fuera de formato. */
export async function resumir({ db, almacen, tenant, conversacion, docs = null }) {
  docs ??= await leerMedios(db, tenant, conversacion);
  const porTipo = {}; const porEstado = {};
  let objetos = 0; let invalidas = 0; let ciegos = 0; let conRuta = 0;
  for (const d of docs) {
    const t = String(d.get('tipo') ?? '?'); const e = String(d.get('estado') ?? '?');
    porTipo[t] = (porTipo[t] ?? 0) + 1; porEstado[e] = (porEstado[e] ?? 0) + 1;
    const ruta = d.get('ruta');
    if (ruta == null) continue;
    conRuta += 1;
    // Sin idMeta (string) no se puede comparar el hash del nombre: podría ser el objeto de OTRA conversación.
    const idMeta = d.get('idMeta');
    if (typeof idMeta !== 'string' || idMeta === '' || !rutaValida(ruta, tenant, idMeta)) { invalidas += 1; continue; }
    try { if ((await almacen.estado(ruta)) === 'existe') objetos += 1; } catch { ciegos += 1; }
  }
  return { medios: docs.length, porTipo, porEstado, objetos, invalidas, ciegos, conRuta };
}

/** Respaldo del metadato (sin bytes): carpeta 0700, archivo 0600. Devuelve el nombre (sin ruta). */
export function respaldar({ carpeta, tenant, conversacion, docs, ahora }) {
  // Solo si la carpeta la creó el script se le fija 0700 (no se cambian los permisos de una carpeta ajena).
  if (mkdirSync(carpeta, { recursive: true, mode: 0o700 })) chmodSync(carpeta, 0o700);
  const nombre = `respaldo-medios-${tenant}-${conversacion.slice(-4)}-${ahora.toISOString().replace(/[:.]/g, '-')}.json`;
  const ruta = join(carpeta, nombre);
  const destruirAntes = new Date(ahora.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const contenido = JSON.stringify({
    tenant, conversacion, respaldadoEn: ahora.toISOString(), destruirAntesDe: destruirAntes,
    nota: 'solo metadato; sin bytes; contiene el teléfono: cifrar o guardar fuera de toda sincronización y destruir en 30 días',
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

export async function ejecutar({
  db, almacen, tenant, conversacion, motivo = '', aplicar = false, respaldoEn = null, ejecutor = 'script',
  proyecto = '', proyectosPermitidos = [], confirmarComercio = null, objetosYaBorrados = false,
  ahora = new Date(), log = () => {},
}) {
  const problemas = validarEntrada({ tenant, conversacion });
  if (problemas.length) return { ok: false, error: problemas.join('; ') };
  const ficha = await db.doc(`tenants/${tenant}`).get();
  if (!ficha.exists) return { ok: false, error: 'el comercio no existe' };
  const nombreComercio = String(ficha.data?.()?.nombre ?? '');

  log(`Proyecto ${proyecto || '(?)'} · comercio ${tenant} · nombre «${nombreComercio}» · conversación ${ultimos4(conversacion)}`);
  let bucketOk = true;
  try { await almacen.verificar(); } catch { bucketOk = false; }
  if (!bucketOk) log('Atención: el bucket NO es alcanzable; no se aplicará nada.');

  // UN solo conjunto de documentos: lo que se valida y cuenta es lo que luego se respalda y se borra.
  const docs = await leerMedios(db, tenant, conversacion);
  const antes = await resumir({ db, almacen, tenant, conversacion, docs });
  log(`Medios: ${antes.medios} · por tipo ${JSON.stringify(antes.porTipo)} · por estado ${JSON.stringify(antes.porEstado)} · objetos en Storage: ${antes.objetos}`);
  if (antes.invalidas) log(`Atención: ${antes.invalidas} ruta(s) fuera del formato esperado: bloquean --aplicar`);
  if (antes.ciegos) log(`Atención: ${antes.ciegos} objeto(s) cuyo estado no se pudo comprobar: bloquean --aplicar`);
  if (!aplicar) {
    log(antes.medios === 0 ? 'Seco: no hay nada que borrar.' : 'Seco: no se escribió nada. Con --aplicar (y --confirmar-comercio, --motivo, --respaldo-en) se haría respaldo, auditoría, borrado de objetos, marca en mensajes y borrado de metadatos.');
    return { ok: true, seco: true, antes, bucketOk };
  }

  // Cerrojos de --aplicar: nada se escribe si falla alguno.
  if (!proyectosPermitidos.length || !proyectosPermitidos.includes(proyecto)) return { ok: false, error: 'el proyecto no está en la lista permitida (NOVUCHAT_PROYECTOS_PERMITIDOS)' };
  if (!nombreComercio || confirmarComercio !== nombreComercio) return { ok: false, error: '--confirmar-comercio no coincide con el nombre del comercio' };
  if (!bucketOk) return { ok: false, error: 'el bucket no es alcanzable: indique --bucket correcto; no se borró nada' };
  if (antes.medios === 0) {
    log('No quedan medios de esa conversación: nada que hacer (idempotente).');
    return { ok: true, antes, despues: { medios: 0, objetos: 0 }, sinCambios: true };
  }
  if (!respaldoEn) return { ok: false, error: 'con --aplicar falta --respaldo-en <carpeta fuera del repositorio>' };
  if (!String(motivo).trim()) return { ok: false, error: 'con --aplicar falta --motivo' };
  if (antes.invalidas) return { ok: false, error: 'hay rutas fuera de formato: no se borró nada; revíselas a mano' };
  if (antes.ciegos) return { ok: false, error: 'no se pudo comprobar el estado de algunos objetos: no se borró nada' };
  const esperados = antes.conRuta - antes.invalidas;
  if (esperados > 0 && antes.objetos === 0 && !objetosYaBorrados) {
    return { ok: false, error: 'hay medios con ruta pero ningún objeto en el bucket (¿bucket equivocado?): no se borró nada; si ya se borraron, use --objetos-ya-borrados' };
  }

  const archivo = respaldar({ carpeta: respaldoEn, tenant, conversacion, docs, ahora });
  log(`Respaldo del metadato creado (600, carpeta 700): ${archivo}. Contiene el teléfono: cifrar o guardar fuera de toda sincronización y destruir en 30 días.`);

  let refAud;
  try {
    refAud = db.collection(`tenants/${tenant}/auditoria`).doc();
    await refAud.set({
      accion: 'borrar_medios_conversacion', origen: 'script', script: 'borrar-medios-conversacion', uid: ejecutor,
      conversacionHash: sha256(conversacion), motivo: String(motivo).trim().slice(0, 200), medios: antes.medios, objetos: antes.objetos,
      estado: 'iniciada', en: ahora,
    });
  } catch {
    return { ok: false, error: 'no se pudo anotar la auditoría: no se borró nada' };
  }

  let objetosBorrados = 0; let mensajesMarcados = 0; let fallo = null; let despues = null;
  try {
    for (const d of docs) {
      const ruta = d.get('ruta');
      if (ruta == null) continue;
      if ((await almacen.estado(ruta)) === 'existe') { await almacen.borrar(ruta); objetosBorrados += 1; }
    }
    for (const d of docs) {
      const idMeta = d.get('idMeta');
      if (!idMeta) continue;
      const ms = await db.collection(`tenants/${tenant}/conversaciones/${conversacion}/mensajes`).where('idMeta', '==', idMeta).limit(10).get();
      for (const m of ms.docs) { await m.ref.update({ 'medio.estado': 'borrado', 'medio.borradoEn': ahora }); mensajesMarcados += 1; }
    }
    // Los metadatos solo se borran con los objetos ya comprobados como ausentes.
    for (const d of docs) {
      const ruta = d.get('ruta');
      if (ruta != null && (await almacen.estado(ruta)) === 'existe') throw new Error('un objeto sigue en el bucket tras borrarlo');
    }
    for (const d of docs) await d.ref.delete();
    despues = await resumir({ db, almacen, tenant, conversacion });
    if (despues.medios !== 0 || despues.objetos !== 0 || despues.ciegos !== 0) throw new Error('la relectura final encontró restos o no pudo comprobar: vuelva a ejecutar');
    log(`Borrados: ${docs.length} metadato(s), ${objetosBorrados} objeto(s), ${mensajesMarcados} mensaje(s) marcado(s).`);
    log(`Relectura: quedan ${despues.medios} medio(s) y ${despues.objetos} objeto(s).`);
  } catch (e) {
    fallo = limpiarError(e);
  } finally {
    try {
      await refAud.update({ estado: fallo ? 'fallida' : 'completada', objetosBorrados, mensajesMarcados, terminadaEn: ahora, ...(fallo ? { error: fallo } : {}) });
    } catch { log('Aviso: no se pudo cerrar la anotación de auditoría.'); }
  }
  if (fallo) return { ok: false, error: fallo, antes, objetosBorrados, mensajesMarcados, archivo };
  return { ok: true, antes, despues, objetosBorrados, mensajesMarcados, archivo };
}
