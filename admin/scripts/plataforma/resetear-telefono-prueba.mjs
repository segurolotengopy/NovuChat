/**
 * RESETEAR UN TELÉFONO DE PRUEBA DE UN TENANT — EL ÚNICO RESETEO, en una sola pasada (flujo venta-minima, Q'Taco). Seco por omisión.
 * (Antes `resetear-estado-turno.mjs`, que queda como envoltorio que avisa. Andres, 07/11/2026: «debería ser UN solo reseteo».)
 *
 * PARA QUÉ. Para volver a probar «como cliente nuevo» con un teléfono de prueba hay que limpiar TODO lo que el sistema recuerda de ESE teléfono.
 * Los reseteos parciales dejaban algo (el cobro pendiente, el estado del servidor) y rompían la prueba. Este limpia, con un solo comando, un solo
 * respaldo, una sola reversa y una sola confirmación, y al final RELEE todo y dice si el estado quedó limpio.
 *
 * QUÉ LIMPIA (solo ese teléfono y ese tenant):
 *   1. `tenants/{tenant}/sesionesDeTurno/{pnid}~{espacio}~wa_{tel}` con espacio `venta-minima` o `venta-minima-prueba`: el bloque por teléfono
 *      (estado, pedidos y `reservas` del día: el cupo de reservas por teléfono vive DENTRO de este documento, PR-4b).
 *   2. `tenants/{tenant}/cuposDeTurno/{pnid}~{clave}~wa_{tel}~{periodo}` con clave `transferencias` o `pedidos` (cupos por contacto y hora, PR-4b).
 *      En 1 y 2, el prefijo del id (`pnid`) tiene que ser igual al campo `phoneNumberId` del propio documento.
 *   3. De `tenants/{tenant}/conversaciones/wa_{tel}` —la conversación REAL del cliente en la Consola— SOLO estos campos, en UNA escritura con la
 *      precondición de la hora leída (nunca se borra el documento ni se toca mensajes, etiquetas ni otro campo):
 *      · `solicitud` (cobro pendiente: etapa `qr_enviado`, 24 h; sin quitarlo, toda imagen siguiente se lee como comprobante «sin pedido en el flujo»);
 *      · LA ATENCIÓN (`core/conteo/atencion.ts`): con la ventana de 24 h vigente (`atencionDesde`) y `mensajesVentana` >= 50 el asistente pasa a
 *        «operador» (responde un aviso fijo a todo) y con >= 100 a «bloqueado» (calla). Se deja `atencionEstado`='normal', `mensajesVentana`=0 y, con la
 *        ventana vigente, se quita `atencionDesde` (ventana sin ancla, como un teléfono nuevo). El seco informa «atención: normal / operador (N
 *        respuestas) / bloqueado». DECLARADO: esto NO toca contadores acumulados (`mensajesTotal`, `periodoContado`, `respuestasDelPeriodo`, métricas,
 *        cuenta, bolsa ni corte); pero, sin ancla, el PRÓXIMO entrante abre una atención nueva y la ingesta cuenta UNA conversación más en el período
 *        (facturable y en las métricas del comercio); y el contador de la ventana vuelve a 0, así que los bloques de 25 que ya se habían facturado en
 *        esa ventana no se vuelven a abrir. Para un teléfono de la lista cerrada es aceptable; no se usa con clientes reales;
 *      · la PAUSA POR PERSONA: `turno.responde === 'persona'` (Tomar) hace callar al asistente (`decidirPausa`, `pausa.ts`; vence sola a los 30 min sin
 *        actividad). Se devuelve al asistente como una devolución manual (`turno.responde`='asistente', `devueltoEn`, `motivoDevolucion`='manual'),
 *        sin la fila de auditoría de la callable. Un turno ilegible o ya devuelto no se toca.
 *   4. La ficha y la memoria del teléfono en el `staticData` del flujo de n8n (con `--workflow <id>` y N8N_BASE_URL/N8N_API_KEY en el ENTORNO):
 *      reutiliza `sinFicha`/`quedan` de `resetear-ficha-flujo.mjs` (no se duplica la lógica). Sin n8n configurado el paso se informa «omitido» y el
 *      resultado dice ⚠, no ✓. (`vaciar-memoria-flujo.mjs` es de otra familia —las fichas de Rubén— y no aplica a venta-minima.)
 *
 * QUÉ SOLO SE INFORMA, SIN BORRAR (lo dudoso o lo que no es estado de prueba reproducible):
 *   · `bloqueada` (contacto bloqueado en la Consola por un administrador): el asistente calla del todo. NO se toca; si está, el resultado dice
 *     «NO ES UN TELÉFONO LIMPIO» y sale con 3: se desbloquea en la Consola.
 *   · `vistosDeTurno`: el id lleva un hash sin el teléfono, no se puede atar a un teléfono; vencen a las 24 h y no impiden probar de nuevo.
 *   · Cupo `avisos` del comercio (de todos los contactos), sesiones de otros espacios (el chat) y las efímeras `vmc-…`/`vmcp-…` (1 minuto).
 *   · «Posibles restos»: otra forma de clave del mismo teléfono (`wa_+{tel}`, sin código de país…) en Firestore, o entradas de n8n que contienen los
 *     8 últimos dígitos sin ser la ficha exacta. Se cuentan sin imprimir y no se borran. Un teléfono vecino (otro número) no se toca nunca.
 *
 * LISTA CERRADA. El repositorio es público: los teléfonos de prueba NO están en el código. Se leen de `TELEFONOS_PRUEBA` (dígitos separados por
 * coma) y `--tel` tiene que estar en ella. El tenant es de una lista cerrada (`TENANTS_PERMITIDOS`); el proyecto, de la lista blanca
 * (`GCP_PROJECT_ID_STAGING`/`GCP_PROJECT_ID_PROD`).
 *
 *   TELEFONOS_PRUEBA=… GCP_PROJECT_ID_STAGING=… GCP_PROJECT_ID_PROD=… [N8N_BASE_URL=… N8N_API_KEY=…] node scripts/plataforma/resetear-telefono-prueba.mjs \
 *        --proyecto <id> --tenant qtaco --tel <dígitos> [--workflow <id del flujo>] [--aplicar --respaldo <ruta absoluta> --confirmo-produccion qtaco]
 *   … --revertir --respaldo <ruta> --proyecto <id> --tenant qtaco --tel <dígitos> [--workflow <id>] [--aplicar --confirmo-produccion qtaco]
 *
 * SECO: informa cuántas cosas se limpiarían y el estado actual («cobro pendiente», sesiones, cupos, entradas de n8n). Nunca imprime teléfonos, ids
 * ni contenido. `--aplicar`: exige `--respaldo` (ruta absoluta, carpeta 0700, archivo 0600, fuera de todo repositorio, nunca se pisa; UN solo archivo con
 * los documentos, el campo `solicitud` y el staticData de n8n COMPLETOS: datos de personas, se destruye al cerrar la prueba) y, contra producción,
 * `--confirmo-produccion <tenant>`. Relee justo antes de escribir (si algo cambió, no escribe), guarda el respaldo y limpia con precondiciones de
 * hora (Firestore) y de huella (n8n; un PUT sobre un flujo activo puede reiniciar sus webhooks: poco tráfico). Después RELEE TODO, espera
 * (ESPERA_FINAL_MS) y vuelve a leer n8n, y dice «ESTADO LIMPIO» solo si cobro pendiente=no, 0 sesiones, 0 cupos y 0 entradas de n8n; si algo queda,
 * sale con 3 y lo dice.
 * `--revertir --aplicar`: recrea los documentos (`create`, sin pisar), restituye `solicitud` solo si la conversación existe y no tiene una, y repone el
 * staticData de n8n SOLO si sigue exactamente como lo dejó este script (si cambió, no se repone y se avisa). Un estado vencido que se repone lo limpia el TTL.
 * AVISO: limpiar a mitad de una conversación real la reinicia; úselo solo con teléfonos de prueba y sin tráfico de ese teléfono.
 *
 * SALIDA. 0 limpio (o ⚠ con avisos) o nada que hacer; 1 el seco encontró algo; 2 uso o salvaguarda; 3 error o algo quedó sucio; 130 Ctrl-C.
 * COSTO. Seco: lecturas de dos colecciones del tenant (solo `phoneNumberId`), una de la conversación (solo tres campos) y un GET de n8n.
 * `--aplicar`: lo mismo dos veces más, N lecturas completas, N escrituras y un PUT. 0 mensajes por conversación. NO se corre contra producción sin el «sí» de Andres.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto, comprobarRespaldo } from './aplicar-consola-oculta.mjs';
import { guardarRespaldo } from './habilitar-productos.mjs';
import { leerRespaldoGenerico } from './aplicar-consola-conversaciones.mjs';
import { sinFicha, quedan, validarBaseUrl, canon, ESPERA_FINAL_MS } from './resetear-ficha-flujo.mjs';

export const TENANTS_PERMITIDOS = Object.freeze(['qtaco']);
export const ESPACIOS_SESION = Object.freeze(['venta-minima', 'venta-minima-prueba']);
export const CLAVES_CUPO = Object.freeze(['transferencias', 'pedidos']);
export const COLECCIONES = Object.freeze(['sesionesDeTurno', 'cuposDeTurno']);
export const MAX_ESCANEO = 20000;
export const MAX_DOCUMENTOS = 200;
export const hashTel = (tel) => createHash('sha256').update(`resetear-telefono-prueba|${tel}`).digest('hex');
/** Prohibiciones 5 y 7 de CLAUDE.md: nunca un WhatsApp Trigger ni una llamada a `/subscriptions` / `subscribed_apps` en el flujo que se reescribe. */
export function nodosProhibidos(nodes) {
  if (!Array.isArray(nodes)) return true;
  return nodes.some((n) => n?.type === 'n8n-nodes-base.whatsAppTrigger' || /\/subscriptions|subscribed_apps/i.test(JSON.stringify(n ?? {})));
}
const ATENCION_ESTADOS = ['normal', 'operador', 'bloqueado'];
const CAMPO = 'resetear-telefono-prueba';
const CON_VALOR = ['proyecto', 'tenant', 'tel', 'workflow', 'respaldo', 'confirmo-produccion'];
const BANDERAS = ['aplicar', 'revertir'];

export const USO = '  node scripts/plataforma/resetear-telefono-prueba.mjs --proyecto <id> --tenant qtaco --tel <dígitos> [--workflow <id>] '
  + '[--aplicar --respaldo <ruta> --confirmo-produccion qtaco]\n'
  + '  node scripts/plataforma/resetear-telefono-prueba.mjs --revertir --respaldo <ruta> --proyecto <id> --tenant qtaco --tel <dígitos> '
  + '[--aplicar --confirmo-produccion qtaco]\n'
  + `  (con TELEFONOS_PRUEBA, GCP_PROJECT_ID_STAGING y GCP_PROJECT_ID_PROD en el entorno; tenants permitidos: ${TENANTS_PERMITIDOS.join(', ')})`;

export function analizarArgumentos(argv, env = process.env, opciones = {}) {
  const problemas = [];
  const valores = { __proto__: null };
  const banderas = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--')) { problemas.push('argumento suelto (sin su opción)'); continue; }
    const n = a.slice(2);
    if (BANDERAS.includes(n)) { if (banderas.includes(n)) problemas.push(`opción repetida: --${n}`); banderas.push(n); }
    else if (CON_VALOR.includes(n)) {
      if (n in valores) problemas.push(`opción repetida: --${n}`);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) { problemas.push(`--${n} sin valor`); continue; }
      valores[n] = v; i += 1;
    } else problemas.push(`opción desconocida: ${a.split('=')[0].slice(0, 40)}`);
  }
  const aplicar = banderas.includes('aplicar');
  const revertir = banderas.includes('revertir');
  const { proyecto, tenant, tel, respaldo, workflow } = valores;
  if (workflow !== undefined) {
    if (!/^[A-Za-z0-9]{6,40}$/.test(workflow)) problemas.push('--workflow: id alfanumérico del flujo de n8n');
    else {
      // Lista cerrada de flujos que este script puede reescribir (el repositorio es público: viene del entorno).
      const permitidos = typeof env.N8N_WORKFLOWS_PERMITIDOS === 'string' ? env.N8N_WORKFLOWS_PERMITIDOS.split(',').map((x) => x.trim()).filter(Boolean) : [];
      if (!permitidos.length) problemas.push('--workflow exige N8N_WORKFLOWS_PERMITIDOS en el entorno (ids de flujos permitidos, separados por coma)');
      else if (!permitidos.includes(workflow)) problemas.push('--workflow no está en la lista cerrada N8N_WORKFLOWS_PERMITIDOS');
    }
  }
  const confirmo = valores['confirmo-produccion'];

  if (proyecto === undefined) problemas.push('falta --proyecto');
  const proy = proyecto === undefined ? { ok: false } : comprobarProyecto(proyecto, env);
  if (proyecto !== undefined && !proy.ok) problemas.push(proy.motivo);

  if (tenant === undefined) problemas.push('falta --tenant');
  else if (!TENANTS_PERMITIDOS.includes(tenant)) problemas.push(`--tenant fuera de la lista cerrada (${TENANTS_PERMITIDOS.join(', ')})`);

  // Lista cerrada de teléfonos: del entorno (el repositorio es público). Sin ella no se corre; --tel tiene que estar adentro.
  const crudo = env.TELEFONOS_PRUEBA;
  let lista = [];
  if (typeof crudo !== 'string' || crudo.trim() === '') problemas.push('falta TELEFONOS_PRUEBA en el entorno (lista cerrada de teléfonos de prueba, dígitos separados por coma)');
  else {
    lista = crudo.split(',').map((s) => s.trim());
    if (lista.some((s) => !/^\d{8,15}$/.test(s))) { problemas.push('TELEFONOS_PRUEBA: solo dígitos (8 a 15) separados por coma'); lista = []; }
  }
  if (tel === undefined) problemas.push('falta --tel <dígitos>');
  else if (!/^\d{8,15}$/.test(tel)) problemas.push('--tel: solo dígitos (8 a 15)');
  else if (lista.length && !lista.includes(tel)) problemas.push('--tel no está en la lista cerrada de teléfonos de prueba');

  if (confirmo !== undefined) {
    if (proy.ok && proy.entorno !== 'produccion') problemas.push('--confirmo-produccion solo se usa contra producción');
    else if (proy.ok && confirmo !== tenant) problemas.push('--confirmo-produccion no coincide con --tenant');
  } else if (proy.ok && proy.entorno === 'produccion' && aplicar) {
    problemas.push('contra producción, --aplicar exige --confirmo-produccion <tenant> (igual a --tenant)');
  }
  if (revertir && respaldo === undefined) problemas.push('--revertir exige --respaldo <ruta>');
  if (!revertir && aplicar && respaldo === undefined) problemas.push('--aplicar exige --respaldo <ruta absoluta> (0600, fuera del repositorio)');
  let respaldoReal = null;
  if (respaldo !== undefined) {
    const r = comprobarRespaldo(respaldo, { ...opciones, lectura: revertir, permitirExistente: false });
    if (r.ok) respaldoReal = respaldo; else problemas.push(r.motivo);
  }
  if (problemas.length) return { ok: false, problemas };
  return { ok: true, cfg: { proyecto, entorno: proy.entorno, tenant, tel, workflow: workflow ?? null, aplicar, revertir, respaldo: respaldoReal } };
}

/**
 * Puro: ¿qué hacer con un documento? `coleccion` ∈ COLECCIONES; `id`; `phoneNumberId` (campo del documento).
 * Devuelve 'borrar' (forma exacta, de este teléfono y de venta-minima), 'otro' (de este teléfono pero de otro espacio o clave: no se toca),
 * 'resto' (posible resto: otra forma de clave del mismo teléfono, o su `phoneNumberId` no coincide: no se toca) o 'ajeno'.
 */
export function clasificar(coleccion, id, phoneNumberId, tel) {
  const partes = String(id).split('~');
  const exacto = `wa_${tel}`;
    const esperadas = coleccion === 'sesionesDeTurno' ? 3 : 4;
  if (partes.length === esperadas && partes[2] === exacto) {
    if (typeof phoneNumberId !== 'string' || phoneNumberId !== partes[0]) return 'resto';
    if (coleccion === 'sesionesDeTurno') return ESPACIOS_SESION.includes(partes[1]) ? 'borrar' : 'otro';
    return CLAVES_CUPO.includes(partes[1]) ? 'borrar' : 'otro';
  }
  // Posibles restos = OTRA FORMA DE CLAVE del mismo teléfono: la forma exacta en un id mal formado, con «+» o con otro agregado, o el teléfono
  // sin el código de país (los 8 o más últimos dígitos, más corto que el completo). Un teléfono distinto —aunque comparta prefijo o sufijo— es ajeno.
  for (const seg of partes.slice(1)) {
    if (seg === exacto) return 'resto';
    const d = seg.replace(/\D/g, '');
    if (d !== '' && (d === tel || (d.length >= 8 && d.length < tel.length && tel.endsWith(d)))) return 'resto';
  }
  return 'ajeno';
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const rutaColeccion = (tenant, c) => `tenants/${tenant}/${c}`;
const sello = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : String(t ?? ''));

/** Una lectura barata de cada colección (solo `phoneNumberId`) y su clasificación. No devuelve contenido. */
export async function escanear(db, tenant, tel) {
  const r = { borrar: [], otro: 0, resto: 0, porColeccion: {} };
  for (const c of COLECCIONES) {
    const s = await db.collection(rutaColeccion(tenant, c)).select('phoneNumberId').limit(MAX_ESCANEO + 1).get();
    if (s.docs.length > MAX_ESCANEO) throw Object.assign(new Error('escaneo'), { code: 'escaneo-demasiado-grande' });
    r.porColeccion[c] = 0;
    for (const d of s.docs) {
      const k = clasificar(c, d.id, d.get ? d.get('phoneNumberId') : d.data?.()?.phoneNumberId, tel);
      if (k === 'borrar') { r.borrar.push({ coleccion: c, id: d.id, ref: d.ref, sello: sello(d.updateTime), updateTime: d.updateTime }); r.porColeccion[c] += 1; }
      else if (k === 'otro') r.otro += 1;
      else if (k === 'resto') r.resto += 1;
    }
  }
  return r;
}

export const MS_VENTANA_ATENCION = 24 * 60 * 60 * 1000; // igual que `core/conteo/atencion.ts` (ventana de facturación de 24 h)
const msDe = (v) => {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && typeof v.toDate === 'function') return v.toDate().getTime();
  if (v && typeof v.seconds === 'number') return v.seconds * 1000;
  return null;
};

/**
 * Lee SOLO unos campos de la conversación del teléfono (ruta derivada del teléfono y del tenant; nunca de un dato leído):
 *   · `solicitud` (cobro pendiente);
 *   · la ATENCIÓN (`core/conteo/atencion.ts`, `ingesta.ts`): `atencionDesde` (ancla de la ventana de 24 h), `mensajesVentana` (respuestas del
 *     asistente en la ventana vigente) y `atencionEstado` (`normal`/`operador`/`bloqueado`, anotado por la ingesta). Con la ventana vigente y 50 o
 *     más respuestas el asistente pasa al aviso fijo de «operador»; con 100, calla. Se calcula como el servidor: sin ancla o con la ventana vencida
 *     las respuestas valen 0;
 *   · la PAUSA POR PERSONA (`turno.responde === 'persona'`, Tomar): hace callar al asistente (`decidirPausa`, `pausa.ts`);
 *   · `bloqueada` (contacto bloqueado en la Consola): solo informativa, nunca se toca.
 */
export async function leerSolicitud(db, tenant, tel, ahoraMs = Date.now()) {
  const ref = db.doc(`${rutaColeccion(tenant, 'conversaciones')}/wa_${tel}`);
  const [snap] = await db.getAll(ref, { fieldMask: ['solicitud', 'turno', 'bloqueada', 'atencionDesde', 'mensajesVentana', 'atencionEstado'] });
  const g = (c) => (snap.exists ? snap.get(c) : undefined);
  const valor = g('solicitud');
  const hay = esObjeto(valor);
  const ancla = msDe(g('atencionDesde'));
  const vigente = ancla !== null && ahoraMs - ancla < MS_VENTANA_ATENCION;
  const crudoN = g('mensajesVentana');
  const respuestas = vigente && typeof crudoN === 'number' && Number.isFinite(crudoN) ? Math.max(0, Math.trunc(crudoN)) : 0;
  const crudoE = g('atencionEstado');
  const estado = crudoE === 'operador' || crudoE === 'bloqueado' ? crudoE : 'normal';
  const at = { estado, respuestas, vigente, sucia: respuestas > 0 || estado !== 'normal', previo: {
    ...(g('atencionDesde') !== undefined ? { atencionDesde: g('atencionDesde') } : {}),
    ...(crudoN !== undefined ? { mensajesVentana: crudoN } : {}),
    ...(crudoE !== undefined ? { atencionEstado: crudoE } : {}),
  } };
  const turno = g('turno');
  const turnoPersona = esObjeto(turno) && turno.responde === 'persona';
  const bloqueada = g('bloqueada') != null && g('bloqueada') !== false;
  const sucia = hay || at.sucia || turnoPersona;
  return {
    ref, hay, valor: hay ? valor : null, at, turnoPersona, turno: turnoPersona ? turno : null, turnoCrudo: turno, bloqueada, sucia,
    anclaMs: ancla,
    sello: sello(snap.updateTime), updateTime: snap.updateTime, existe: snap.exists,
  };
}

const clave = (b) => b.map((x) => `${x.coleccion}/${x.id}@${x.sello}`).sort().join('|');

/** Los documentos de `borrar` se codifican para el respaldo: las fechas de Firestore pasan a `{ __ts: ISO }` y vuelven al revertir. */
export const codificar = (v) => {
  if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (Array.isArray(v)) return v.map(codificar);
  if (esObjeto(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, codificar(x)]));
  return v;
};
export const decodificar = (v) => {
  if (Array.isArray(v)) return v.map(decodificar);
  if (esObjeto(v)) {
    const k = Object.keys(v);
    if (k.length === 1 && k[0] === '__ts' && typeof v.__ts === 'string' && !Number.isNaN(Date.parse(v.__ts))) return new Date(v.__ts);
    return Object.fromEntries(Object.entries(v).map(([n, x]) => [n, decodificar(x)]));
  }
  return v;
};

export function leerRespaldo(ruta, { entorno, tenant, tel }) {
  const l = leerRespaldoGenerico(ruta, { limite: 64 * 1024 * 1024 });
  if (!l.ok) return l;
  const r = l.respaldo;
  if (r?.version !== 1 || r.campo !== CAMPO || !Array.isArray(r.docs)) return { ok: false, motivo: 'el respaldo no tiene la forma esperada' };
  if (r.tenant !== tenant) return { ok: false, motivo: 'el respaldo es de otro comercio' };
  if (typeof r.telHash !== 'string' || r.telHash !== hashTel(tel)) return { ok: false, motivo: 'el respaldo es de otro teléfono (o no dice de cuál)' };
  if (r.entorno !== entorno) return { ok: false, motivo: 'el respaldo es de otro entorno (staging, produccion o emulador)' };
  if (r.docs.length > MAX_DOCUMENTOS) return { ok: false, motivo: 'el respaldo trae demasiados documentos' };
  const vistos = new Set();
  for (const d of r.docs) {
    const ok = esObjeto(d) && COLECCIONES.includes(d.coleccion) && typeof d.id === 'string' && esObjeto(d.data)
      && clasificar(d.coleccion, d.id, d.data.phoneNumberId, tel) === 'borrar' && !vistos.has(`${d.coleccion}/${d.id}`);
    if (!ok) return { ok: false, motivo: 'el respaldo trae un documento que no es de ese teléfono y de venta-minima (o está repetido)' };
    vistos.add(`${d.coleccion}/${d.id}`);
  }
  if (r.solicitud !== undefined && !esObjeto(r.solicitud)) return { ok: false, motivo: 'el respaldo trae una solicitud que no es un objeto' };
  const n = r.n8n;
  if (n !== undefined && !(esObjeto(n) && typeof n.workflow === 'string' && /^[A-Za-z0-9]{6,40}$/.test(n.workflow) && 'staticData' in n && typeof n.huellaDespues === 'string')) {
    return { ok: false, motivo: 'el respaldo trae un bloque de n8n que no tiene la forma esperada' };
  }
  // La atención y el turno se FILTRAN a lo que este script escribió y se validan los tipos: la reversa nunca escribe campos que vengan del archivo.
  let atencion = null;
  if (r.atencion !== undefined) {
    if (!esObjeto(r.atencion)) return { ok: false, motivo: 'el respaldo trae una atención que no es un objeto' };
    const a = {};
    const { atencionDesde: d, mensajesVentana: n, atencionEstado: e } = r.atencion;
    if (d !== undefined) { if (!(esObjeto(d) && Object.keys(d).length === 1 && decodificar(d) instanceof Date)) return { ok: false, motivo: 'el respaldo trae una atención con una fecha inválida' }; a.atencionDesde = d; }
    if (n !== undefined) { if (!(Number.isInteger(n) && n >= 0)) return { ok: false, motivo: 'el respaldo trae una atención con un conteo inválido' }; a.mensajesVentana = n; }
    if (e !== undefined) { if (!ATENCION_ESTADOS.includes(e)) return { ok: false, motivo: 'el respaldo trae una atención con un estado inválido' }; a.atencionEstado = e; }
    atencion = Object.keys(a).length ? a : null;
  }
  let turno = null;
  if (r.turno !== undefined) {
    if (!(esObjeto(r.turno) && r.turno.responde === 'persona' && typeof r.turno.tomadoPor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(r.turno.tomadoPor))) return { ok: false, motivo: 'el respaldo trae un turno que no es una toma de persona válida' };
    turno = { responde: 'persona', tomadoPor: r.turno.tomadoPor };
  }
  return { ok: true, docs: r.docs, solicitud: r.solicitud ?? null, atencion, turno, n8n: n ?? null };
}

const esPrecondicion = (e) => e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION';

export function mensajeDeInterrupcion(estado) {
  if (estado === 'antes') return '\n  ! Interrumpido por el operador antes de escribir. No se escribió nada.\n';
  if (estado === 'escrito') return '\n  ! Interrumpido entre escrituras: algunas SÍ se hicieron. Corra el seco; para deshacer, --revertir con el mismo respaldo.\n';
  return '\n  ! Interrumpido DURANTE una escritura: puede haberse hecho o no. Corra el seco para ver el estado.\n';
}


const huellaN8n = (f) => JSON.stringify([f.staticData, f.nodes, f.connections, f.settings, f.active]);

/** UNA lectura de todo lo del teléfono: Firestore (turno, cupos, solicitud) y, si está configurado, el staticData de n8n. */
async function leerTodo(cfg, db, n8n) {
  const e = await escanear(db, cfg.tenant, cfg.tel);
  const s = await leerSolicitud(db, cfg.tenant, cfg.tel);
  let n = null;
  if (n8n) { const vivo = await n8n.leer(); n = { vivo, r: sinFicha(vivo.staticData, cfg.tel), huella: huellaN8n(vivo), prohibido: nodosProhibidos(vivo.nodes) }; }
  return { e, s, n };
}
const sucio = (t) => t.e.borrar.length + (t.s.hay ? 1 : 0) + (t.s.at.sucia ? 1 : 0) + (t.s.turnoPersona ? 1 : 0) + (t.n ? t.n.r.total : 0);
const textoAtencion = (a) => (a.respuestas > 0 || a.estado !== 'normal' ? `${a.estado} (${a.respuestas} respuestas en la ventana)` : 'normal (0 respuestas)');
const restosDe = (t) => t.e.resto + (t.n ? t.n.r.restos : 0);

function mostrar(log, t, rotulo) {
  log(`\n  ${rotulo}`);
  for (const c of COLECCIONES) log(`    ${c}: ${t.e.porColeccion[c]} documento(s) del teléfono`);
  log(`    solicitud de cobro pendiente: ${t.s.hay ? 'sí' : 'no'}`);
  log(`    atención: ${textoAtencion(t.s.at)}`);
  log(`    pausa por persona (Tomar) que hace callar al asistente: ${t.s.turnoPersona ? 'sí' : 'no'}`);
  log(`    n8n (staticData del flujo): ${t.n ? `${t.n.r.total} entrada(s) del teléfono` : 'OMITIDO (sin --workflow o sin N8N_BASE_URL/N8N_API_KEY)'}`);
  log(`  de otros espacios o claves del mismo teléfono (no se tocan): ${t.e.otro}`);
  log(`  posibles restos (otra forma de clave, no se borran): ${restosDe(t)}`);
  log(`  marca de la conversación que NO se toca nunca: contacto bloqueado en la Consola=${t.s.bloqueada ? 'SÍ (el asistente calla del todo)' : 'no'}`);
  log('  vistosDeTurno: no se puede atar a un teléfono (id con hash); vencen a las 24 h y no impiden probar de nuevo');
}

/** La verificación de «estado limpio»: una línea con los números y un veredicto. Devuelve 0 limpio (con ⚠ si hay avisos) o 3 si algo quedó sucio. */
function veredicto(log, t, previo) {
  const ses = t.e.porColeccion.sesionesDeTurno; const cup = t.e.porColeccion.cuposDeTurno;
  log(`\n  ESTADO: cobro pendiente=${t.s.hay ? 'SÍ' : 'no'} · sesiones=${ses} · cupos=${cup} · entradas en n8n=${t.n ? t.n.r.total : 'omitido'} · solicitud=${t.s.hay ? 'SÍ' : 'no'} · atención=${textoAtencion(t.s.at)} · pausa por persona=${t.s.turnoPersona ? 'SÍ' : 'no'}`);
  if (t.s.bloqueada) { log('\n  ✗ NO ES UN TELÉFONO LIMPIO: el contacto está BLOQUEADO en la Consola (el asistente calla del todo). Este script no lo toca: desbloquéelo allí.\n'); return 3; }
  if (sucio(t) > 0) { log('\n  ✗ NO QUEDÓ LIMPIO: lo de arriba con valor distinto de «no»/0 sigue ahí. Revise; el respaldo permite reponer.\n'); return 3; }
  const avisos = [];
  if (!t.n) avisos.push('el paso de n8n se OMITIÓ: no se puede afirmar que el flujo no recuerde al teléfono');
  if (restosDe(t) > 0) avisos.push(`hay ${restosDe(t)} posibles restos (otra forma de clave): revíselos`);
  log(avisos.length ? `\n  ⚠ ${previo}Sin entradas del teléfono en lo que este script limpia, pero: ${avisos.join('; ')}.\n` : `\n  ✓ ${previo}ESTADO LIMPIO (releído).\n`);
  return 0;
}


/** deps = { db, FieldValue, n8n?: { leer(), escribir(vivo, staticData), esperar?(ms) }, log?, marcarEscritura? }. Devuelve el código de salida. */
export async function ejecutar(cfg, deps) {
  const { db, FieldValue } = deps;
  const n8n = deps.n8n ?? null;
  const log = deps.log ?? ((t) => console.log(t));
  const marcar = deps.marcarEscritura ?? (() => {});
  return cfg.revertir ? revertir(cfg, db, FieldValue, n8n, log, marcar) : limpiar(cfg, db, FieldValue, n8n, log, marcar);
}

async function limpiar(cfg, db, FieldValue, n8n, log, marcar) {
  const t1 = await leerTodo(cfg, db, n8n);
  mostrar(log, t1, `${cfg.aplicar ? 'APLICAR' : 'SECO (solo lecturas)'} · ${cfg.entorno} · tenant ${cfg.tenant}`);
  if (t1.n?.prohibido) { log('\n  ✗ El flujo de n8n tiene un WhatsApp Trigger o una llamada a /subscriptions o subscribed_apps (prohibiciones 5 y 7): este script no lo reescribe. No se escribió nada.\n'); return 3; }
  if (sucio(t1) === 0) return veredicto(log, t1, 'Nada que borrar. ');
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar --respaldo <ruta> (y --confirmo-produccion <tenant> contra producción).\n'); return 1; }
  if (t1.e.borrar.length > MAX_DOCUMENTOS) { log(`\n  ✗ Hay más de ${MAX_DOCUMENTOS} documentos del teléfono: no es un reseteo de prueba. No se escribió nada.\n`); return 3; }

  // Relectura justo antes de escribir: mismos documentos, misma hora y misma huella de n8n, o no se escribe nada.
  const t2 = await leerTodo(cfg, db, n8n);
  if (clave(t1.e.borrar) !== clave(t2.e.borrar) || t1.s.sucia !== t2.s.sucia || (t2.s.sucia && t1.s.sello !== t2.s.sello) || (t2.n && t1.n.huella !== t2.n.huella)) {
    log('\n  ✗ El estado cambió entre la lectura y la escritura (hay tráfico de ese teléfono): no se escribió nada. Vuelva a correrlo.\n'); return 3;
  }
  const completos = t2.e.borrar.length ? await db.getAll(...t2.e.borrar.map((b) => b.ref)) : [];
  const docs = [];
  for (let i = 0; i < completos.length; i++) {
    const s = completos[i]; const b = t2.e.borrar[i];
    if (!s.exists || sello(s.updateTime) !== b.sello) { log('\n  ✗ Un documento cambió o desapareció al leerlo completo: no se escribió nada. Vuelva a correrlo.\n'); return 3; }
    docs.push({ coleccion: b.coleccion, id: b.id, data: codificar(s.data()) });
  }
  const tocaN8n = t2.n !== null && t2.n.r.total > 0;
  try {
    guardarRespaldo(cfg.respaldo, {
      version: 1, campo: CAMPO, entorno: cfg.entorno, tenant: cfg.tenant, telHash: hashTel(cfg.tel), creadoEn: new Date().toISOString(), docs,
      ...(t2.s.hay ? { solicitud: codificar(t2.s.valor) } : {}),
      // Valores anteriores de la atención (solo los campos que existían) y del turno de persona, para la reversa.
      ...(t2.s.at.sucia ? { atencion: codificar(t2.s.at.previo) } : {}),
      ...(t2.s.turnoPersona ? { turno: codificar(t2.s.turno) } : {}),
      ...(tocaN8n ? { n8n: { workflow: cfg.workflow, staticData: t2.n.vivo.staticData ?? {}, huellaDespues: canon(t2.n.r.nuevo) } } : {}),
    });
  } catch (err) {
    if (err?.code === 'EEXIST') { log('\n  ✗ Ya existe un archivo en esa ruta de respaldo: un respaldo nunca se pisa. No se escribe nada.\n'); return 2; }
    throw err;
  }
  if (cfg.entorno === 'produccion') log('\n  AVISO DE FACTURACIÓN: sin ancla de ventana, el PRÓXIMO entrante de ese teléfono abre una atención nueva y cuenta UNA conversación más en el período (facturable y en las métricas del comercio); el contador de la ventana vuelve a 0. No se tocan los contadores acumulados.');
  log(`\n  Respaldo ÚNICO de documentos, campo solicitud y staticData de n8n COMPLETOS (datos de personas, se destruye al cerrar la prueba): ${cfg.respaldo}`);

  let hechas = 0;
  const total = t2.e.borrar.length + (t2.s.sucia ? 1 : 0) + (tocaN8n ? 1 : 0);
  const falla = (err, que) => {
    marcar(hechas === 0 ? 'antes' : 'escrito');
    const causa = esPrecondicion(err) ? `${que} cambió entre la lectura y la escritura` : `error de escritura (${err?.code ?? err?.name ?? 'desconocido'})`;
    log(hechas === 0 ? `\n  ✗ ${causa}: no se escribió nada.\n` : `\n  ✗ ${causa}: SÍ se hicieron ${hechas} de ${total}. Corra el seco; para deshacer, --revertir con el mismo respaldo.\n`);
    return 3;
  };
  // 1) n8n primero (lo más lento y lo único sin precondición atómica): si cambió o falla, Firestore queda intacto.
  if (tocaN8n) {
    marcar('escribiendo');
    try {
      const justo = await n8n.leer();
      if (huellaN8n(justo) !== t2.n.huella) { marcar('antes'); log('\n  ✗ El flujo de n8n cambió justo antes de escribir: no se escribió nada. Vuelva a correrlo con poco tráfico.\n'); return 3; }
      const http = await n8n.escribir(t2.n.vivo, t2.n.r.nuevo);
      const despues = await n8n.leer();
      const iguales = JSON.stringify(despues.nodes) === JSON.stringify(t2.n.vivo.nodes) && JSON.stringify(despues.connections) === JSON.stringify(t2.n.vivo.connections)
        && JSON.stringify(despues.settings) === JSON.stringify(t2.n.vivo.settings);
      hechas += 1; marcar('escrito');
      log(`  n8n: PUT HTTP ${http} · nodos, conexiones y ajustes iguales=${iguales} · activo=${despues.active}`);
      if (despues.active !== t2.n.vivo.active || !iguales || canon(despues.staticData ?? {}) !== canon(t2.n.r.nuevo)) {
        log('\n  ✗ La verificación de n8n no coincide (o el flujo cambió de estado de activación): revíselo; el respaldo permite reponer. Firestore NO se tocó.\n'); return 3;
      }
    } catch (err) { return falla(err, 'el flujo de n8n'); }
  }
  // 2) la conversación, UNA sola escritura con la precondición de la hora leída (si llegó un mensaje, no se escribe nada). Solo estos campos:
  //    `solicitud` (cobro pendiente); la atención (`atencionEstado`=normal, `mensajesVentana`=0 y, si la ventana está vigente, sin `atencionDesde`);
  //    y, si una persona tomó la conversación, `turno` devuelto al asistente (los tres subcampos de una devolución manual). Nada más.
  if (t2.s.sucia) {
    marcar('escribiendo');
    try {
      const campos = {};
      if (t2.s.hay) campos.solicitud = FieldValue.delete();
      if (t2.s.at.sucia) {
        campos.atencionEstado = 'normal'; campos.mensajesVentana = 0;
        if (t2.s.at.vigente) campos.atencionDesde = FieldValue.delete();
      }
      if (t2.s.turnoPersona) { campos['turno.responde'] = 'asistente'; campos['turno.devueltoEn'] = new Date(); campos['turno.motivoDevolucion'] = 'manual'; }
      await t2.s.ref.update(campos, { lastUpdateTime: t2.s.updateTime });
      hechas += 1; marcar('escrito');
    } catch (err) { return falla(err, 'la conversación'); }
  }
  // 3) las sesiones y los cupos.
  for (const b of t2.e.borrar) {
    marcar('escribiendo');
    try {
      await b.ref.delete({ lastUpdateTime: b.updateTime });
      hechas += 1; marcar('escrito');
    } catch (err) { return falla(err, 'un documento'); }
  }
  // Relectura de TODO. n8n se vuelve a leer tras la espera: una ejecución que empezó antes del PUT puede reponer la ficha al terminar.
  let t3 = await leerTodo(cfg, db, n8n);
  const intactos = t3.e.otro === t2.e.otro && t3.e.resto === t2.e.resto && t3.s.existe === t2.s.existe;
  log(`  Hecho: ${hechas} de ${total} · el resto de la conversación y de los documentos igual=${intactos}`);
  if (n8n?.esperar && tocaN8n) { await n8n.esperar(ESPERA_FINAL_MS); t3 = await leerTodo(cfg, db, n8n); }
  if (!intactos) { log('\n  ✗ La verificación no coincide (¿una conversación de ese teléfono escribió justo en medio?): revise; el respaldo permite reponer.'); veredicto(log, t3, ''); return 3; }
  return veredicto(log, t3, '');
}

async function revertir(cfg, db, FieldValue, n8n, log, marcar) {
  const l = leerRespaldo(cfg.respaldo, { entorno: cfg.entorno, tenant: cfg.tenant, tel: cfg.tel });
  if (!l.ok) { log(`\n  ✗ ${l.motivo}\n`); return 2; }
  if (l.n8n && cfg.workflow !== l.n8n.workflow) { log('\n  ✗ El respaldo trae el staticData de un flujo de n8n: indique el mismo --workflow con el que se hizo.\n'); return 2; }
  const refs = l.docs.map((d) => db.doc(`${rutaColeccion(cfg.tenant, d.coleccion)}/${d.id}`));
  const hoy = refs.length ? await db.getAll(...refs) : [];
  const faltan = l.docs.filter((_d, i) => !hoy[i].exists);
  const hayConv = l.solicitud !== null || l.atencion !== null || l.turno !== null;
  const sol = hayConv ? await leerSolicitud(db, cfg.tenant, cfg.tel) : null;
  // Qué de la conversación se repone, SIN pisar nada que haya cambiado desde el reseteo.
  const campos = {}; const notas = [];
  if (sol !== null && l.solicitud !== null) {
    if (!sol.existe) notas.push('la conversación no existe (no se crea)'); else if (sol.hay) notas.push('solicitud ya existe (no se pisa)'); else campos.solicitud = decodificar(l.solicitud);
  }
  if (sol !== null && l.atencion !== null && sol.existe) {
    const previo = decodificar(l.atencion);
    const anclaPrevia = msDe(previo.atencionDesde);
    const intacta = sol.anclaMs === null || sol.anclaMs === anclaPrevia;
    const sinUso = sol.at.respuestas === 0 && (typeof sol.at.previo.mensajesVentana !== 'number' || sol.at.previo.mensajesVentana === 0) && sol.at.estado === 'normal';
    if (intacta && sinUso) Object.assign(campos, previo); else notas.push('la atención cambió desde el reseteo (no se pisa)');
  }
  if (sol !== null && l.turno !== null && sol.existe) {
    const actual = sol.turnoCrudo;
    if (esObjeto(actual) && actual.responde === 'asistente' && actual.motivoDevolucion === 'manual' && actual.tomadoPor === l.turno.tomadoPor) {
      campos['turno.responde'] = 'persona'; campos['turno.devueltoEn'] = FieldValue.delete(); campos['turno.motivoDevolucion'] = FieldValue.delete();
    } else notas.push('el turno cambió desde el reseteo (no se pisa)');
  }
  const convRepone = Object.keys(campos).length > 0;
  let n8nRepone = false; let n8nNota = null; let vivoN8n = null;
  if (l.n8n) {
    if (!n8n) n8nNota = 'OMITIDO (sin configuración de n8n): no se repone';
    else {
      vivoN8n = await n8n.leer();
      // El respaldo solo puede diferir de lo que dejó el reseteo en lo del teléfono: si no, el archivo no es de este reseteo y no se repone.
      const coherente = canon(sinFicha(decodificar(l.n8n.staticData), cfg.tel).nuevo) === l.n8n.huellaDespues;
      n8nRepone = coherente && canon(vivoN8n.staticData ?? {}) === l.n8n.huellaDespues && !nodosProhibidos(vivoN8n.nodes);
      if (!coherente) n8nNota = 'el respaldo de n8n NO es coherente con lo que dejó el reseteo (difiere en algo ajeno al teléfono): NO se repone';
      else if (nodosProhibidos(vivoN8n.nodes)) n8nNota = 'el flujo tiene un WhatsApp Trigger o llamadas a /subscriptions (prohibiciones 5 y 7): NO se repone';
      else if (!n8nRepone) n8nNota = 'el flujo cambió desde el reseteo: NO se repone (se pisarían cambios posteriores)';
    }
  }
  log(`\n  ${cfg.aplicar ? 'REVERTIR' : 'SECO de la reversa (solo lecturas)'} · ${cfg.entorno} · tenant ${cfg.tenant}`);
  log(`  documentos del respaldo: ${l.docs.length} · por reponer: ${faltan.length} · ya existen (no se pisan): ${l.docs.length - faltan.length}`);
  if (sol !== null) log(`  conversación (solicitud, atención, turno): ${convRepone ? `se repone ${Object.keys(campos).length} campo(s)` : 'nada que reponer'}${notas.length ? ` · ${notas.join(' · ')}` : ''}`);
  if (l.n8n) log(`  staticData de n8n del respaldo: ${n8nRepone ? 'se repone' : n8nNota}`);
  const pendientes = faltan.length + (convRepone ? 1 : 0) + (n8nRepone ? 1 : 0);
  const aviso = l.n8n && !n8nRepone ? ' ⚠ n8n no se repuso.' : '';
  if (pendientes === 0) { log(`\n  ${aviso ? '⚠' : '✓'} Nada que reponer.${aviso}\n`); return 0; }
  if (!cfg.aplicar) { log('\n  Seco: no se escribió nada. Agregue --aplicar (y --confirmo-produccion <tenant> contra producción).\n'); return 1; }
  let hechas = 0;
  const falla = (err) => {
    marcar(hechas === 0 ? 'antes' : 'escrito');
    log(`\n  ✗ error al reponer (${err?.code ?? err?.name ?? 'desconocido'}): SÍ se repusieron ${hechas} de ${pendientes}. Repita la reversa con el mismo respaldo.\n`);
    return 3;
  };
  if (n8nRepone) {
    marcar('escribiendo');
    try {
      const justo = await n8n.leer();
      if (huellaN8n(justo) !== huellaN8n(vivoN8n)) { marcar('antes'); log('\n  ✗ El flujo de n8n cambió justo antes de reponer: no se escribió nada. Repita la reversa.\n'); return 3; }
      await n8n.escribir(vivoN8n, decodificar(l.n8n.staticData));
      hechas += 1; marcar('escrito');
    } catch (err) { return falla(err); }
  }
  if (convRepone) {
    marcar('escribiendo');
    try { await sol.ref.update(campos, { lastUpdateTime: sol.updateTime }); hechas += 1; marcar('escrito'); } catch (err) { return falla(err); }
  }
  for (const d of faltan) {
    marcar('escribiendo');
    try {
      await db.doc(`${rutaColeccion(cfg.tenant, d.coleccion)}/${d.id}`).create(decodificar(d.data));
      hechas += 1; marcar('escrito');
    } catch (err) { return falla(err); }
  }
  const despues = refs.length ? await db.getAll(...refs) : [];
  const faltantes = despues.filter((s) => !s.exists).length;
  const despuesConv = convRepone ? await leerSolicitud(db, cfg.tenant, cfg.tel) : null;
  const solOk = !convRepone || ((!('solicitud' in campos) || despuesConv.hay) && (!('turno.responde' in campos) || despuesConv.turnoPersona)
    && (!('atencionEstado' in campos) || despuesConv.at.previo.atencionEstado === campos.atencionEstado));
  const n8nOk = !n8nRepone || canon((await n8n.leer()).staticData ?? {}) === canon(decodificar(l.n8n.staticData));
  log(`  Repuestos: ${hechas} · faltan tras releer: ${faltantes + (solOk ? 0 : 1) + (n8nOk ? 0 : 1)}`);
  if (faltantes !== 0 || !solOk || !n8nOk) { log('\n  ✗ La verificación no coincide: repita la reversa.\n'); return 3; }
  log(`\n  ${aviso ? '⚠' : '✓'} Estado repuesto y releído.${aviso}\n`);
  return 0;
}

export async function principal(argv = process.argv.slice(2)) {
  const a = analizarArgumentos(argv);
  if (!a.ok) { console.error(`\n  ✗ ${a.problemas.join('\n  ✗ ')}\n\n${USO}\n`); process.exit(2); }
  const { cfg } = a;
  const { initializeApp } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: cfg.proyecto });
  const db = getFirestore();
  // n8n: la dirección y la clave vienen del ENTORNO del proceso (nunca de un archivo). Sin ellas o sin --workflow, el paso se omite (⚠).
  let n8n = null;
  if (cfg.workflow && process.env.N8N_BASE_URL && process.env.N8N_API_KEY) {
    const v = validarBaseUrl(process.env.N8N_BASE_URL);
    if (!v.ok) throw Object.assign(new Error('url'), { code: v.codigo });
    const cab = { [['X', 'N8N', 'API', 'KEY'].join('-')]: process.env.N8N_API_KEY, 'Content-Type': 'application/json' };
    const llamar = async (metodo, cuerpo) => {
      const r = await fetch(`${v.origen}/api/v1/workflows/${cfg.workflow}`, { method: metodo, headers: cab, redirect: 'error', body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw Object.assign(new Error('n8n'), { code: `n8n-${metodo}-${r.status}` });
      return { status: r.status, json: await r.json() };
    };
    n8n = {
      leer: async () => (await llamar('GET')).json,
      esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
      escribir: async (vivo, staticData) => (await llamar('PUT', { name: vivo.name, nodes: vivo.nodes, connections: vivo.connections, settings: vivo.settings ?? {}, staticData })).status,
    };
  }
  let estado = 'antes';
  process.on('SIGINT', () => { console.error(mensajeDeInterrupcion(estado)); process.exit(130); });
  const codigo = await ejecutar(cfg, { db, FieldValue, n8n, marcarEscritura: (v) => { estado = v; } });
  await db.terminate().catch(() => {});
  process.exit(codigo);
}

function seEjecutaDirecto() {
  try { return Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]); } catch { return false; }
}
if (seEjecutaDirecto()) {
  try { await principal(); } catch (e) { console.error(`\n  ✗ error de ejecución: ${e?.code ?? e?.name ?? 'desconocido'}\n`); process.exit(3); }
}
