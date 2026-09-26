/**
 * MIGRAR LAS CUENTAS A LOS TRES EJES (F1, `Analisis/41` §4), EN SECO POR DEFECTO.
 *
 * POR QUÉ EXISTE. Hasta el 25/09/2026 «demostración» era un PLAN
 * (`plan: 'demostracion'` mandaba sobre la modalidad) y BYOC era un plan con
 * `pagaMeta: 'comercio'`. Desde F1 el plan solo dice límites; si se cobra lo
 * dice la MODALIDAD (`cuenta/estado.modalidad`); quién paga Meta lo dice la
 * TITULARIDAD de cada número (`rutasWhatsApp/{n}.titularidad`); y el modelo de
 * IA es un dato de la ficha (`tenants/{t}.modelo`). Los tenants que ya existen
 * quedaron con los datos viejos, y `modalidadDe` ya no mira el plan: un demo
 * sin este script seguiría atendiendo (sin modalidad = demostración), pero su
 * plan no sería del catálogo y caería en los límites de Impulso sin que nadie
 * lo decidiera. Este script lo decide, a la vista, y lo escribe con el OK de
 * Andres.
 *
 * QUÉ HACE, tenant por tenant y en UNA transacción cada uno:
 *   (a) LISTA Y CUENTA los tenants que hay de verdad en Firestore (los seis
 *       del plano son una estimación) y todas las rutas de WhatsApp.
 *   (b) Por cada tenant:
 *       - si tenía `plan: 'demostracion'` (en la cuenta o en la ficha):
 *         `modalidad: 'demostracion'` y el plan pasa a `--plan-demos`
 *         (Impulso salvo que Andres diga otro), con su copia de límites y el
 *         espejo en la ficha;
 *       - si su plan es `byoc`: `titularidad: 'comercio'` en sus números; a
 *         los demás números sin titularidad, `novuchat`;
 *       - `tenants/{t}.modelo` con el modelo por defecto si falta;
 *       - `limites.cambiosIncluidos` del plan si la copia no lo trae;
 *       - los campos DERIVADOS se recalculan si la cuenta queda con modalidad,
 *         igual que la callable (LOW 8: sin modalidad no se tocan).
 *   (c) NO TOCA un tenant cuyo catálogo ya tiene más ítems que los productos
 *       del plan al que iría: lo marca ✗ y sale con 1. El Demo B tiene más de
 *       150 ítems y con Impulso (20) no podría cargar uno más; eso lo decide
 *       Andres con `--plan-demos`, no este script en silencio.
 *   (d) NO TOCA un comercio sin plan del catálogo ni sin modalidad que no
 *       fuera demo por plan: eso es `asignar-plan.mjs` / `migrar-prepago.mjs`,
 *       uno por uno. Los lista.
 *
 * Con `--aplicar` escribe, deja auditoría `migrar_ejes` con el antes y el
 * después, y RELEE cada documento mostrando el resultado. Sin `--aplicar`
 * imprime TODO lo que cambiaría y no escribe nada. `--tenant <id>` acota a uno.
 *
 * LOS MÓDULOS DEL SERVIDOR SE IMPORTAN SIN COMPILAR con el hook de resolución
 * (`module.registerHooks`), como `asignar-plan.mjs` y `pase-a-produccion.mjs`.
 *
 *   node scripts/migrar-ejes.mjs --proyecto <id>
 *   node scripts/migrar-ejes.mjs --proyecto <id> --plan-demos pro
 *   node scripts/migrar-ejes.mjs --proyecto <id> --plan-demos pro --aplicar
 *
 * Nunca imprime identificadores de número completos: solo sus últimos cuatro dígitos.
 */
import { registerHooks } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');
const PROYECTO = opcion('proyecto');
const SOLO = (opcion('tenant') ?? '').toLowerCase();
const PLAN_DEMOS = (opcion('plan-demos') ?? 'impulso').trim();

registerHooks({
  resolve(especificador, contexto, siguiente) {
    try {
      return siguiente(especificador, contexto);
    } catch (e) {
      if (especificador.startsWith('.') && especificador.endsWith('.js') && contexto.parentURL?.endsWith('.ts')) {
        return siguiente(`${especificador.slice(0, -3)}.ts`, contexto);
      }
      throw e;
    }
  },
});
const { PLANES, CATALOGO_PLANES, esIdPlan, limitesDe, limitesDeCuenta, periodoDe } = await import('../functions/src/planes.ts');
const { camposDerivados, consumidasDe, esModalidad, estadoDeServicio } = await import('../functions/src/prepago.ts');
const { MODELO_POR_DEFECTO, esModelo, esTitularidad } = await import('../functions/src/central/ejes.ts');

const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (SOLO && !ID_TENANT.test(SOLO)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!esIdPlan(PLAN_DEMOS)) problemas.push(`--plan-demos desconocido: ${PLAN_DEMOS}. Del catálogo: ${Object.keys(PLANES).join(', ')}`);
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/migrar-ejes.mjs --proyecto <id> [--plan-demos <plan>] [--tenant <id>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');
const ahoraMs = Date.now();

// --- (a) inventario -----------------------------------------------------------
const [tenantsSnap, rutasSnap] = await Promise.all([db.collection('tenants').get(), db.collection('rutasWhatsApp').get()]);
const tenants = tenantsSnap.docs.filter((d) => !SOLO || d.id === SOLO).sort((a, b) => a.id.localeCompare(b.id));
const rutasPorTenant = new Map();
for (const r of rutasSnap.docs) {
  const t = String(r.get('tenantId') ?? '');
  if (!rutasPorTenant.has(t)) rutasPorTenant.set(t, []);
  rutasPorTenant.get(t).push(r);
}
const sinTenant = rutasSnap.docs.filter((r) => !tenantsSnap.docs.some((t) => t.id === r.get('tenantId')));

console.log(`\n  Migración a los tres ejes · proyecto ${PROYECTO} · ${APLICAR ? 'APLICAR' : 'seco'}`);
console.log(`  Tenants en Firestore: ${tenantsSnap.size}${SOLO ? ` (se mira solo «${SOLO}»)` : ''} · rutas de WhatsApp: ${rutasSnap.size}`);
console.log(`  Plan para los demos: ${PLAN_DEMOS} (${PLANES[PLAN_DEMOS].productos} productos, ${PLANES[PLAN_DEMOS].conversaciones} conversaciones)`);
if (sinTenant.length) console.log(`  ✗ Rutas cuyo tenant no existe (no se tocan): ${sinTenant.map((r) => cola(r.id)).join(', ')}`);
if (SOLO && tenants.length === 0) { console.error(`\n  ✗ No existe el comercio «${SOLO}».\n`); process.exit(1); }
console.log('');

// --- (b) el análisis de un tenant, PURO sobre lo leído -----------------------
function analizar(ficha, cuentaDoc, contadorDoc, metricasDoc, rutas) {
  const fichaD = ficha.data() ?? {};
  const cuenta = cuentaDoc.data() ?? {};
  const eraDemoPorPlan = cuenta.plan === 'demostracion' || fichaD.plan === 'demostracion';
  const avisos = [];
  const escrituraCuenta = {};
  const escrituraFicha = {};
  const escrituraRutas = new Map();
  // Un comercio dado de baja no recibe ejes: su identificador quedó quemado y
  // nadie lo va a leer. Se lista para que se sepa que existe, y nada más.
  if (fichaD.estado === 'dado_de_baja') {
    return {
      eraDemoPorPlan, escrituraCuenta, escrituraFicha, escrituraRutas, bloqueo: null, cambia: false,
      avisos: ['dado de baja: no se toca'], antes: { rutas: {} }, despues: { rutas: {} }, cuentaExiste: cuentaDoc.exists,
    };
  }

  // El plan que va a regir.
  let plan = cuenta.plan;
  if (eraDemoPorPlan) {
    plan = PLAN_DEMOS;
    if (cuenta.modalidad !== 'demostracion') escrituraCuenta.modalidad = 'demostracion';
    if (cuenta.plan !== PLAN_DEMOS) escrituraCuenta.plan = PLAN_DEMOS;
    const limites = limitesDe(PLAN_DEMOS);
    const copia = cuenta.limites && typeof cuenta.limites === 'object' ? cuenta.limites : null;
    if (!copia || Object.keys(limites).some((k) => copia[k] !== limites[k])) escrituraCuenta.limites = limites;
    if (cuenta.catalogoPlanes !== CATALOGO_PLANES) escrituraCuenta.catalogoPlanes = CATALOGO_PLANES;
    if (fichaD.plan !== PLAN_DEMOS) escrituraFicha.plan = PLAN_DEMOS;
  } else if (esIdPlan(plan)) {
    const copia = cuenta.limites && typeof cuenta.limites === 'object' ? cuenta.limites : null;
    if (copia) {
      const c = copia.cambiosIncluidos;
      if (!(Number.isInteger(c) && c >= 0)) escrituraCuenta.limites = { ...copia, cambiosIncluidos: PLANES[plan].cambiosIncluidos };
    } else {
      avisos.push(`sin copia de límites: rige el plan ${plan} (asignar-plan.mjs la escribe)`);
    }
    if (!esModalidad(cuenta.modalidad)) avisos.push('sin modalidad: no es demo por plan, no se toca (migrar-prepago.mjs)');
  } else {
    avisos.push(`plan «${plan ?? '(ninguno)'}» no es del catálogo: no se toca (asignar-plan.mjs)`);
  }

  // El modelo de IA, en la ficha.
  if (!esModelo(fichaD.modelo)) escrituraFicha.modelo = MODELO_POR_DEFECTO;

  // La titularidad de cada número: comercio si el plan es BYOC, NovuChat si no.
  const titularidad = plan === 'byoc' ? 'comercio' : 'novuchat';
  for (const r of rutas) {
    if (!esTitularidad(r.get('titularidad'))) escrituraRutas.set(r.id, titularidad);
  }

  // La cuenta como va a quedar, y sus derivados si tiene modalidad.
  const combinada = { ...cuenta, ...escrituraCuenta };
  let derivados = null;
  if (esModalidad(combinada.modalidad) && Object.keys(escrituraCuenta).length > 0) {
    const servicio = estadoDeServicio(combinada, consumidasDe(metricasDoc?.data()), ahoraMs);
    const d = camposDerivados(servicio, combinada);
    derivados = d;
    if (cuenta.estadoPago !== d.estadoPago) escrituraCuenta.estadoPago = d.estadoPago;
    if (cuenta.montoMensual !== d.montoMensual) escrituraCuenta.montoMensual = d.montoMensual;
    if (cuenta.moneda !== d.moneda) escrituraCuenta.moneda = d.moneda;
    escrituraCuenta.proximoVencimiento = d.proximoVencimientoMs === null
      ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs);
  }

  // (c) el cerrojo del catálogo: nunca dejar un tenant sin poder cargar.
  const items = Number(contadorDoc?.get('items') ?? 0);
  const productosDespues = limitesDeCuenta(combinada).productos;
  const bloqueo = items > productosDespues
    ? `el catálogo tiene ${items} ítems y el plan ${plan} admite ${productosDespues}: elija otro --plan-demos o asigne el plan a mano`
    : null;

  const cambia = Object.keys(escrituraCuenta).length > 0 || Object.keys(escrituraFicha).length > 0 || escrituraRutas.size > 0;
  const antes = {
    plan: cuenta.plan ?? null, espejo: fichaD.plan ?? null, modalidad: cuenta.modalidad ?? null,
    modelo: fichaD.modelo ?? null, cambiosIncluidos: cuenta.limites?.cambiosIncluidos ?? null,
    estadoPago: cuenta.estadoPago ?? null,
    rutas: Object.fromEntries(rutas.map((r) => [r.id, r.get('titularidad') ?? null])),
  };
  const despues = {
    plan: combinada.plan ?? null, espejo: escrituraFicha.plan ?? fichaD.plan ?? null,
    modalidad: combinada.modalidad ?? null, modelo: escrituraFicha.modelo ?? fichaD.modelo ?? null,
    cambiosIncluidos: combinada.limites?.cambiosIncluidos ?? null,
    estadoPago: derivados?.estadoPago ?? cuenta.estadoPago ?? null,
    rutas: Object.fromEntries(rutas.map((r) => [r.id, escrituraRutas.get(r.id) ?? r.get('titularidad') ?? null])),
  };
  return { eraDemoPorPlan, escrituraCuenta, escrituraFicha, escrituraRutas, avisos, bloqueo, cambia, antes, despues, cuentaExiste: cuentaDoc.exists };
}

const mostrar = (o) => Object.entries(o)
  .filter(([k]) => k !== 'rutas')
  .map(([k, v]) => `${k} ${v ?? '(ninguno)'}`).join(' · ');

// --- (b) y (c) tenant por tenant ------------------------------------------------
let cambiados = 0;
let bloqueados = 0;
let fallos = 0;
for (const ficha of tenants) {
  const t = ficha.id;
  const rutas = rutasPorTenant.get(t) ?? [];
  const refCuenta = db.doc(`tenants/${t}/cuenta/estado`);
  const refContador = db.doc(`tenants/${t}/contadores/catalogo`);
  const refMetricas = db.doc(`tenants/${t}/metricas/${periodoDe(ahoraMs)}`);
  const [cuentaDoc, contadorDoc, metricasDoc] = await Promise.all([refCuenta.get(), refContador.get(), refMetricas.get()]);
  const a = analizar(ficha, cuentaDoc, contadorDoc, metricasDoc, rutas);

  console.log(`  ${t} (${ficha.get('nombre') ?? '?'}) · estado ${ficha.get('estado') ?? '?'} · ${rutas.length} número(s)${a.eraDemoPorPlan ? ' · ERA DEMO POR PLAN' : ''}`);
  console.log(`    antes   : ${mostrar(a.antes)}`);
  for (const [n, v] of Object.entries(a.antes.rutas)) console.log(`              número ${cola(n)} titularidad ${v ?? '(ninguna)'}`);
  for (const aviso of a.avisos) console.log(`    · ${aviso}`);
  if (a.bloqueo) {
    bloqueados += 1;
    console.log(`    ✗ NO SE TOCA: ${a.bloqueo}`);
    continue;
  }
  if (!a.cambia) { console.log('    = sin cambios'); continue; }
  console.log(`    después : ${mostrar(a.despues)}`);
  for (const [n, v] of Object.entries(a.despues.rutas)) {
    if (a.escrituraRutas.has(n)) console.log(`              número ${cola(n)} titularidad ${v}`);
  }
  console.log(`    cambia  : cuenta [${Object.keys(a.escrituraCuenta).join(', ') || '—'}] · ficha [${Object.keys(a.escrituraFicha).join(', ') || '—'}] · rutas ${a.escrituraRutas.size}`);
  cambiados += 1;
  if (!APLICAR) continue;

  // Se relee y se reanaliza DENTRO de la transacción: lo de arriba es la
  // vista previa, lo de acá es lo que se escribe. Lecturas antes que escrituras.
  try {
    await db.runTransaction(async (tx) => {
      const [f, c, k, m, ...rs] = await Promise.all([
        tx.get(ficha.ref), tx.get(refCuenta), tx.get(refContador), tx.get(refMetricas), ...rutas.map((r) => tx.get(r.ref)),
      ]);
      const b = analizar(f, c, k, m, rs);
      if (b.bloqueo) throw new Error(b.bloqueo);
      if (!b.cambia) return;
      const ahora = Timestamp.now();
      if (Object.keys(b.escrituraCuenta).length) {
        if (b.cuentaExiste) tx.update(refCuenta, { ...b.escrituraCuenta, actualizadoEn: ahora });
        else tx.set(refCuenta, { ...Object.fromEntries(Object.entries(b.escrituraCuenta).filter(([, v]) => !(v instanceof FieldValue))), actualizadoEn: ahora });
      }
      if (Object.keys(b.escrituraFicha).length) tx.update(ficha.ref, b.escrituraFicha);
      for (const [n, v] of b.escrituraRutas) {
        tx.update(db.doc(`rutasWhatsApp/${n}`), { titularidad: v, titularidadEn: ahora, titularidadPor: 'migrar-ejes' });
      }
      tx.create(db.collection(`tenants/${t}/auditoria`).doc(), {
        accion: 'migrar_ejes', uid: 'migrar-ejes', en: ahora, planDemos: PLAN_DEMOS,
        antes: b.antes, despues: b.despues,
      });
    });
  } catch (e) {
    fallos += 1;
    console.log(`    ✗ falló: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }

  // Relectura: lo que quedó, no lo que se quiso escribir.
  const [cuentaLeida, fichaLeida] = await Promise.all([refCuenta.get(), ficha.ref.get()]);
  const rutasLeidas = await Promise.all(rutas.map((r) => r.ref.get()));
  const leido = {
    plan: cuentaLeida.get('plan') ?? null, espejo: fichaLeida.get('plan') ?? null,
    modalidad: cuentaLeida.get('modalidad') ?? null, modelo: fichaLeida.get('modelo') ?? null,
    cambiosIncluidos: cuentaLeida.get('limites')?.cambiosIncluidos ?? null,
    estadoPago: cuentaLeida.get('estadoPago') ?? null,
  };
  const okRutas = rutasLeidas.every((r) => r.get('titularidad') === a.despues.rutas[r.id]);
  const ok = okRutas && Object.entries(leido).every(([k, v]) => v === a.despues[k]);
  if (!ok) fallos += 1;
  console.log(`    ${ok ? '✓' : '✗'} releído: ${mostrar(leido)}`);
  for (const r of rutasLeidas) console.log(`              número ${cola(r.id)} titularidad ${r.get('titularidad') ?? '(ninguna)'}`);
}

console.log(`\n  Tenants: ${tenants.length} · con cambios: ${cambiados} · bloqueados: ${bloqueados} · fallos: ${fallos}`);
if (!APLICAR) console.log('  Seco: no se escribió nada. Agregue --aplicar (con el OK de Andres).\n');
else console.log('');
process.exit(bloqueados > 0 || fallos > 0 ? 1 : 0);
