/**
 * SEMBRAR EN STAGING UN COMERCIO DE PRUEBA PARA LA INTERVENCION HUMANA (H2) — seco por omision.
 *
 * PARA QUE. La pantalla nueva de Conversaciones deja a una persona TOMAR y DEVOLVER una conversacion
 * (`tomarConversacion`, `devolverConversacion`, `enviarComoPersona`). En staging no hay n8n: el envio
 * real no funciona, pero tomar, devolver, la cuenta regresiva y el bloqueo por ventana SI se pueden
 * probar. Este script deja los datos: UN comercio ficticio con tres conversaciones, una por caso de la
 * ventana de 24 h. Todo es ficticio; nada sale a un telefono real.
 *
 *   node scripts/plataforma/sembrar-staging-intervencion.mjs [--proyecto <staging>]            # seco
 *   node scripts/plataforma/sembrar-staging-intervencion.mjs [--proyecto <staging>] --aplicar  # siembra
 *   node scripts/plataforma/sembrar-staging-intervencion.mjs [--proyecto <staging>] --limpiar  # seco del borrado
 *   node scripts/plataforma/sembrar-staging-intervencion.mjs [--proyecto <staging>] --limpiar --aplicar
 *
 * Sin `--proyecto` se usa GCP_PROJECT_ID_STAGING. Credenciales que SOLO tengan acceso a staging
 * (nunca el ADC de produccion: la salvaguarda compara nombres, no permisos; el proyecto de la consola
 * puede no ser el de gcloud por defecto, igual que en los demas scripts de esta carpeta).
 *
 * SALVAGUARDA. Es la MISMA de `verificar-reglas-staging.mjs` (`comprobarProyecto`, importada, no
 * copiada): lista blanca GCP_PROJECT_ID_STAGING, nunca GCP_PROJECT_ID_PROD / FIREBASE_PROJECT_ID /
 * GCP_PROJECT_ID, el nombre tiene que decir «staging», y contra el emulador el proyecto es `demo-*`
 * con FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST. Cualquier otra cosa sale con 2, tambien en
 * seco y ANTES de abrir Firebase. El id de un proyecto real NUNCA se imprime (el repo es publico).
 *
 * QUE SIEMBRA (id fijo `prueba-intervencion`):
 *   · Alta con la forma de `alta-comercio.mjs` (ficha, cuenta, contador del catalogo, config/negocio, el
 *     documento del flujo, membresia, rol admin en el token), el plan como lo deja `asignar-plan.mjs`
 *     (ficha + cuenta/estado con la copia de limites del catalogo, y auditoria `cambiar_plan`) y la
 *     bandera `consolaConversaciones: 'nueva'` de `aplicar-consola-conversaciones.mjs`.
 *   · UN administrador con correo @ejemplo.com. SIN CONTRASENA: la cuenta nace con una clave aleatoria
 *     que no se imprime ni se guarda; la contrasena se fija por otro camino autorizado (un enlace de
 *     restablecimiento que genera y entrega una persona). El correo se marca verificado (es ficticio y
 *     las reglas lo exigen para cualquier rol de comercio).
 *   · Tres conversaciones de 4 a 6 mensajes, con la estructura que lee la consola (`ultimoEntranteEn`,
 *     `ventanaVenceEn`, `telefonoTrozos`, `nombrePalabras`, `noLeidos`, mensajes con `ts`): ventana
 *     ABIERTA (quedan ~23 h), POR VENCER (quedan ~45 min) y VENCIDA (hace 6 h). Las horas se calculan
 *     al sembrar: vuelva a correr `--aplicar` para refrescarlas (idempotente: mismos ids, sin duplicar).
 *     Telefonos ficticios (591 + ceros: no existen) y enmascarados a los 4 ultimos al imprimir.
 *
 * `--limpiar` borra SOLO lo sembrado: la ficha tiene que llevar la marca `sembradoPor` de este script
 * (si el id existe sin la marca, se NIEGA, salida 1) y se borra el arbol de ESE tenant y la cuenta de
 * Auth del correo fijo si es la membresia de ese tenant y no tiene rol en otro. Nunca lista ni recorre
 * otros comercios.
 *
 * COSTO (con --aplicar, SOLO en el proyecto de staging): unas 30 escrituras de Firestore y 1 usuario de
 * Auth la primera vez (la re-siembra reescribe lo mismo). 0 mensajes por conversacion. Seco: 1 lectura
 * de Firestore y 1 consulta de Auth.
 *
 * SALIDA: 0 hecho (o seco); 1 conflicto (el id existe y no es de la siembra); 2 salvaguarda o
 * argumentos (nada abierto ni escrito); 3 error inesperado (solo `e.code ?? e.name`).
 */
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { comprobarProyecto } from './verificar-reglas-staging.mjs';
import { documentoDeFlujo } from '../../functions/src/registro.ts';
import { CATALOGO_PLANES, TARIFA_DE_ALTA, limitesDe } from '../../functions/src/central/cuenta/planes.ts';
import { palabrasDe, trozosDeTelefono } from '../../functions/src/core/conversacion/normalizacion.ts';

export const TENANT_ID = 'prueba-intervencion';
export const NOMBRE_COMERCIO = 'Comercio de PRUEBA - intervencion (ficticio)';
export const MARCA = 'sembrar-staging-intervencion';
export const CAMPO_MARCA = 'sembradoPor';
export const CORREO_ADMIN = 'admin-prueba-intervencion@ejemplo.com';
export const PLAN = 'pro';
export const FLUJO = 'agendamiento';

const MIN = 60_000;
const HORA = 3_600_000;

/** Un telefono ficticio: se imprime solo con los 4 ultimos digitos. */
export const enmascarar = (tel) => `***${String(tel).replace(/\D/g, '').slice(-4)}`;

export const USO = '  node scripts/plataforma/sembrar-staging-intervencion.mjs [--proyecto <staging>] [--limpiar] [--aplicar]';

/**
 * Los argumentos y la salvaguarda de proyecto, puros (reciben el entorno). Devuelve
 * `{ ok: true, cfg }` o `{ ok: false, motivo }` (salida 2). Nunca devuelve el id del proyecto en `motivo`.
 */
export function analizarArgumentos(argv, env = process.env) {
  const conocidos = new Set(['--proyecto', '--aplicar', '--limpiar']);
  const opciones = new Set();
  let proyecto = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!conocidos.has(a)) return { ok: false, motivo: 'argumento desconocido (los valores de otras opciones no se admiten)' };
    if (a === '--proyecto') {
      proyecto = argv[i + 1] ?? null;
      if (!proyecto || proyecto.startsWith('--')) return { ok: false, motivo: 'falta el valor de --proyecto' };
      i++;
    } else opciones.add(a);
  }
  const crudo = proyecto ?? (typeof env.GCP_PROJECT_ID_STAGING === 'string' ? env.GCP_PROJECT_ID_STAGING : '');
  if (!crudo.trim()) return { ok: false, motivo: 'falta --proyecto y GCP_PROJECT_ID_STAGING no esta puesta' };
  const p = crudo.trim();
  // `comprobarProyecto` pide ademas el host del emulador de Storage; este script no usa Storage, asi que
  // para un demo-* se completa solo ese, sin relajar nada mas (los de Firestore y Auth siguen exigidos).
  const entorno = p.startsWith('demo-') && env.FIREBASE_STORAGE_EMULATOR_HOST === undefined
    ? { ...env, FIREBASE_STORAGE_EMULATOR_HOST: 'no-usado' } : env;
  const v = comprobarProyecto(p, entorno);
  if (!v.ok) return { ok: false, motivo: v.motivo };
  return { ok: true, cfg: { proyecto: p, emulador: Boolean(v.emulador), aplicar: opciones.has('--aplicar'), limpiar: opciones.has('--limpiar') } };
}

/**
 * Las tres conversaciones, con sus mensajes. `minutosAtras` del ULTIMO mensaje del cliente decide la ventana:
 * abierta (20 min), por vencer (23 h 15 min: quedan 45 min) y vencida (30 h). Puro: recibe el reloj.
 */
export function conversacionesDeSiembra(ahoraMs) {
  const m = (direccion, texto, minutosAtras) => ({ direccion, texto, minutosAtras });
  return [
    {
      id: 'ventana-abierta', telefono: '59100000021', nombre: 'Cliente Prueba Uno',
      mensajes: [
        m('entrante', 'Hola, quisiera informacion sobre sus servicios', 45),
        m('saliente', 'Hola, soy el asistente virtual. Con gusto le ayudo, que le interesa?', 44),
        m('entrante', 'Cuanto cuesta una consulta y que dias atienden?', 30),
        m('saliente', 'La consulta cuesta 100 Bs y atendemos de lunes a viernes.', 29),
        m('entrante', 'Puede ser el jueves en la tarde?', 20),
      ],
    },
    {
      id: 'por-vencer', telefono: '59100000022', nombre: 'Cliente Prueba Dos',
      mensajes: [
        m('entrante', 'Buenas, tengo una consulta', 23 * 60 + 40),
        m('saliente', 'Buenas, soy el asistente virtual. Digame, en que le ayudo?', 23 * 60 + 39),
        m('entrante', 'Quiero cambiar mi cita del viernes', 23 * 60 + 25),
        m('saliente', 'Entendido. Para cambiarla necesito que una persona del equipo la revise.', 23 * 60 + 24),
        m('entrante', 'Esta bien, espero', 23 * 60 + 15),
      ],
    },
    {
      id: 'ventana-vencida', telefono: '59100000023', nombre: 'Cliente Prueba Tres',
      mensajes: [
        m('entrante', 'Hola, ayer pregunte por precios', 32 * 60),
        m('saliente', 'Hola, soy el asistente virtual. Le comparto la lista de precios.', 32 * 60 - 1),
        m('entrante', 'Gracias, lo reviso y le aviso', 31 * 60),
        m('saliente', 'Perfecto, quedo atento.', 31 * 60 - 1),
        m('entrante', 'Una consulta mas: hacen factura?', 30 * 60),
        m('saliente', 'Si, emitimos factura. Necesito su NIT cuando guste.', 30 * 60 - 1),
      ],
    },
  ].map((c) => {
    const entrantes = c.mensajes.filter((x) => x.direccion === 'entrante');
    const ultimoEntrante = entrantes.reduce((a, x) => (x.minutosAtras < a.minutosAtras ? x : a));
    const ultimo = c.mensajes.reduce((a, x) => (x.minutosAtras < a.minutosAtras ? x : a));
    const entranteEn = ahoraMs - ultimoEntrante.minutosAtras * MIN;
    // Cuantos mensajes del cliente hay DESPUES del ultimo del asistente (como los cuenta la ingesta).
    const ultimaSalida = c.mensajes.filter((x) => x.direccion === 'saliente').reduce((a, x) => Math.min(a, x.minutosAtras), Infinity);
    const noLeidos = entrantes.filter((x) => x.minutosAtras < ultimaSalida).length;
    return {
      ...c, entranteEn, ventanaVenceEn: entranteEn + 24 * HORA, ultimoEn: ahoraMs - ultimo.minutosAtras * MIN,
      ultimoTexto: ultimo.texto, noLeidos,
    };
  });
}

const sin = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** La rama de un documento sembrado: siempre lleva la marca. */
const marcado = (o) => ({ ...o, [CAMPO_MARCA]: MARCA });

/**
 * El flujo entero, con todo inyectado (en las pruebas, un Firestore del emulador y un Auth en memoria).
 * `deps`: { db, auth, Timestamp, ahoraMs, imprimir(linea) }. Devuelve el codigo de salida.
 */
export async function ejecutar(cfg, deps) {
  const { db, auth, Timestamp, ahoraMs } = deps;
  const di = deps.imprimir ?? ((l) => console.log(l));
  const refTenant = db.doc(`tenants/${TENANT_ID}`);
  const destino = cfg.emulador ? 'emulador' : 'staging';
  di(`\n  Destino   : ${destino}`);
  di(`  Comercio  : ${TENANT_ID}`);
  di(`  Modo      : ${cfg.limpiar ? 'LIMPIAR' : 'SEMBRAR'}${cfg.aplicar ? ' (--aplicar)' : ' (seco: no escribe nada)'}\n`);

  const ficha = await refTenant.get();
  if (ficha.exists && ficha.get(CAMPO_MARCA) !== MARCA) {
    di(`  x El id ${TENANT_ID} ya existe y NO lo sembro este script: no se toca.\n`);
    return 1;
  }
  const usuario = await auth.getUserByEmail(CORREO_ADMIN).catch(() => null);

  if (cfg.limpiar) return limpiar(cfg, { ...deps, di, refTenant, ficha, usuario });
  return sembrar(cfg, { ...deps, di, refTenant, ficha, usuario, ahoraMs });
}

async function sembrar(cfg, { db, auth, Timestamp, di, refTenant, ficha, usuario, ahoraMs }) {
  const convs = conversacionesDeSiembra(ahoraMs);
  const ts = (ms) => Timestamp.fromMillis(ms);
  const ahora = ts(ahoraMs);
  const nMensajes = convs.reduce((n, c) => n + c.mensajes.length, 0);
  const escrituras = 8 + convs.length + nMensajes;

  di(ficha.exists ? '  El comercio ya esta sembrado: se REESCRIBE con horas nuevas (sin duplicar).' : '  El comercio no existe: se crea.');
  di(`  Plan      : ${PLAN} · bandera consolaConversaciones: nueva · flujo ${FLUJO}`);
  di(`  Admin     : ${CORREO_ADMIN} (${usuario ? 'la cuenta ya existe: no se toca su clave' : 'se crea'})`);
  for (const c of convs) {
    const resta = c.ventanaVenceEn - ahoraMs;
    const estado = resta <= 0 ? 'VENCIDA' : resta < HORA ? `por vencer (${Math.round(resta / MIN)} min)` : `abierta (${Math.round(resta / HORA)} h)`;
    di(`  Conversacion ${enmascarar(c.telefono)} · ${c.mensajes.length} mensajes · ventana ${estado}`);
  }
  di(`  Escrituras de Firestore: ${escrituras} · usuarios de Auth: ${usuario ? 0 : 1}\n`);
  if (!cfg.aplicar) {
    di('  Seco: no se escribio nada. Agregue --aplicar.\n');
    return 0;
  }

  // 1. La cuenta de Auth. Clave aleatoria que NO se imprime ni se guarda; nadie la conoce.
  let u = usuario;
  if (!u) {
    u = await auth.createUser({
      email: CORREO_ADMIN, displayName: 'Admin de prueba (ficticio)',
      password: randomBytes(32).toString('base64url'), emailVerified: true,
    });
    di('  ok cuenta creada');
  }

  // 2. Una re-siembra parte de cero en las conversaciones, para que las horas queden coherentes.
  if (ficha.exists) await db.recursiveDelete(refTenant.collection('conversaciones'));

  // 3. Todo en un lote: ficha, cuenta, contador, negocio, flujo, membresia, auditoria y conversaciones.
  const cuenta = { plan: PLAN, limites: limitesDe(PLAN, TARIFA_DE_ALTA), catalogoPlanes: CATALOGO_PLANES, tarifa: TARIFA_DE_ALTA };
  const lote = db.batch();
  lote.set(refTenant, marcado({
    nombre: NOMBRE_COMERCIO, estado: 'activo', plan: PLAN, vertical: FLUJO, flujos: [FLUJO],
    consolaConversaciones: 'nueva', waPhoneNumberId: null, waWabaId: null,
    creadoEn: ahora, creadoPor: MARCA,
  }));
  lote.set(db.doc(`tenants/${TENANT_ID}/cuenta/estado`), marcado({ ...cuenta, actualizadoEn: ahora }));
  lote.set(db.doc(`tenants/${TENANT_ID}/contadores/catalogo`), marcado({ items: 0, ultimoItem: '', actualizadoEn: ahora }));
  lote.set(db.doc(`tenants/${TENANT_ID}/config/negocio`), marcado({
    nombreNegocio: NOMBRE_COMERCIO, zonaHoraria: 'America/La_Paz', moneda: 'BOB', actualizadoPor: MARCA, actualizadoEn: ahora,
  }));
  const documento = documentoDeFlujo(FLUJO);
  if (documento) lote.set(db.doc(`tenants/${TENANT_ID}/config/${documento}`), marcado({ actualizadoPor: MARCA, actualizadoEn: ahora }));
  lote.set(db.doc(`tenants/${TENANT_ID}/miembros/${u.uid}`), marcado({ correo: CORREO_ADMIN, rol: 'admin', estado: 'activo', desde: ahora }));
  // Ids fijos: la re-siembra pisa, no acumula.
  const aud = (id, datos) => lote.set(db.doc(`tenants/${TENANT_ID}/auditoria/${id}`), marcado({
    uid: MARCA, origen: 'script', script: MARCA, en: ahora, ...datos,
  }));
  aud('siembra-alta', { accion: 'alta_comercio_prueba' });
  aud('siembra-plan', {
    accion: 'cambiar_plan', planAntes: null, planDespues: PLAN, limitesDespues: cuenta.limites, catalogoPlanes: CATALOGO_PLANES,
  });
  for (const c of convs) {
    const ref = db.doc(`tenants/${TENANT_ID}/conversaciones/wa_${c.telefono}`);
    lote.set(ref, marcado({
      telefono: c.telefono, nombreContacto: c.nombre, ultimoMensaje: c.ultimoTexto, ultimoEn: ts(c.ultimoEn),
      telefonoTrozos: trozosDeTelefono(c.telefono), nombrePalabras: palabrasDe(c.nombre, 6),
      ultimoEntranteEn: ts(c.entranteEn), ventanaVenceEn: ts(c.ventanaVenceEn),
      noLeidos: c.noLeidos, sinLeer: c.noLeidos > 0, atencionEstado: 'normal',
    }));
    c.mensajes.forEach((x, i) => {
      lote.set(ref.collection('mensajes').doc(`m${i}`), marcado(sin({
        direccion: x.direccion, texto: x.texto, ts: ts(ahoraMs - x.minutosAtras * MIN),
        tenantId: TENANT_ID, palabras: palabrasDe(x.texto),
      })));
    });
  }
  await lote.commit();
  di('  ok ficha, cuenta, plan, bandera, membresia y conversaciones');

  // 4. El rol en el token (la misma forma que `alta-comercio.mjs`: claves de una letra).
  const previos = u.customClaims ?? {};
  const nc = previos.nc ?? {};
  await auth.setCustomUserClaims(u.uid, { ...previos, nc: { ...nc, t: { ...(nc.t ?? {}), [TENANT_ID]: 'admin' }, v: (nc.v ?? 0) + 1 } });
  di('  ok rol de administrador');

  di('\n  CONTRASENA: este script no fija ninguna ni la muestra. La cuenta nacio con una clave aleatoria');
  di('  descartada; la contrasena se fija por otro camino autorizado (enlace de restablecimiento que');
  di('  genera y entrega una persona). Hasta entonces nadie puede entrar con ella.\n');
  di('  Para borrar todo lo sembrado: --limpiar --aplicar.\n');
  return 0;
}

async function limpiar(cfg, { db, auth, di, refTenant, ficha, usuario }) {
  // Solo se borra la cuenta de Auth que es la membresia de ESTE tenant y no tiene rol en otro.
  const soloDeEste = (u) => {
    const t = u?.customClaims?.nc?.t ?? {};
    return Object.keys(t).every((k) => k === TENANT_ID);
  };
  let miembro = false;
  if (usuario && ficha.exists) miembro = (await db.doc(`tenants/${TENANT_ID}/miembros/${usuario.uid}`).get()).get(CAMPO_MARCA) === MARCA;
  // Una cuenta sin ficha (siembra a medias) tambien se recoge, si su unico rol es el de este tenant.
  const borrarUsuario = Boolean(usuario) && soloDeEste(usuario) && (miembro || !ficha.exists);

  di(`  Comercio  : ${ficha.exists ? 'se borra su arbol completo (solo este tenant)' : 'no existe: nada que borrar'}`);
  di(`  Admin     : ${!usuario ? 'no existe' : borrarUsuario ? 'se borra la cuenta' : 'existe, pero no es de la siembra o tiene rol en otro comercio: NO se toca'}\n`);
  if (!cfg.aplicar) {
    di('  Seco: no se borro nada. Agregue --aplicar.\n');
    return 0;
  }
  if (ficha.exists) {
    // La ficha primero: corta el acceso de una sesion viva; despues el resto del arbol.
    await refTenant.delete();
    await db.recursiveDelete(refTenant);
    di('  ok comercio borrado');
  }
  if (borrarUsuario) {
    await auth.deleteUser(usuario.uid);
    di('  ok cuenta de Auth borrada');
  }
  di('  Hecho.\n');
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Programa principal (solo cuando se corre como script, no al importarlo en una prueba)
// ---------------------------------------------------------------------------------------------------------------
async function principal() {
  const r = analizarArgumentos(process.argv.slice(2));
  if (!r.ok) {
    console.error(`\n  x Destino rechazado: ${r.motivo}\n  Este script solo siembra en staging (o en un emulador demo-*).\n${USO}\n`);
    return 2;
  }
  try {
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
    const { getAuth } = await import('firebase-admin/auth');
    initializeApp({ projectId: r.cfg.proyecto });
    return await ejecutar(r.cfg, { db: getFirestore(), auth: getAuth(), Timestamp, ahoraMs: Date.now() });
  } catch (e) {
    console.error(`\n  x Error inesperado: ${e?.code ?? e?.name ?? 'desconocido'}\n`);
    return 3;
  }
}

const esScript = (() => {
  try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (esScript) process.exitCode = await principal();
