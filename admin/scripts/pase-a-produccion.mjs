#!/usr/bin/env node
/**
 * ¿ESTE COMERCIO ESTÁ LISTO PARA PASAR DE PRUEBA A PRODUCCIÓN? — SOLO LECTURA.
 *
 * POR QUÉ EXISTE (`docs/pase-a-produccion/RUNBOOK.md`). El pase de un comercio
 * a producción es una lista de precondiciones repartidas en cinco lugares
 * —la ficha, la cuenta, la ruta del número, la configuración y el repositorio—
 * más lo que solo ve una persona (Meta, n8n, un teléfono). Mirarlas a mano,
 * una por una, es cómo se olvida la que importa. Este script las lee todas y
 * dice cuáles se cumplen, cuáles no y cuáles hay que mirar a mano.
 *
 * NO ESCRIBE NADA, NUNCA. No tiene `--aplicar` y lo rechaza si se lo pasan:
 * la escritura del pase ya tiene sus puertas, cada una con su auditoría
 * (`asignar-plan.mjs`, `migrar-prepago.mjs`, `fijar-tipo-cambio.mjs`, y las
 * callables `actualizarEstadoCuenta`, `fijarTelefonosPago`,
 * `registrarPagoManual` y `fijarCortePrepago`). Una puerta más que escriba
 * sería una puerta más sin la auditoría de las otras.
 *
 * NO MUESTRA SECRETOS NI DATOS PERSONALES. De un número o una WABA, solo los
 * últimos 4; de los teléfonos de recepción y de pago, solo cuántos hay y sus
 * últimos 4; ningún correo, ningún valor de `.env`.
 *
 * LA LÓGICA ES LA DEL SERVIDOR, NO UNA COPIA: `planes.ts`, `atencion.ts` y
 * `prepago.ts` se importan de `functions/src/` sin compilar. `prepago.ts`
 * importa `./planes.js` (así lo pide `tsc`), y Node no reescribe esa
 * extensión al cargar TypeScript: un gancho de resolución (`registerHooks`,
 * Node 22.15+) prueba `.ts` cuando el `.js` no existe, solo para importaciones
 * relativas desde un `.ts`.
 *
 *   node scripts/pase-a-produccion.mjs --proyecto <id> --tenant platinum
 *   node scripts/pase-a-produccion.mjs --proyecto <id> --tenant platinum \
 *     --aceptacion ~/NovuChat/CLIENTES/PLATINUM/aceptacion.md
 *
 * `--repo <raíz>` apunta a otra copia del repositorio (por defecto, la de este
 * script). Salida: 0 si todo lo que el script puede comprobar se cumple; 1 si
 * falta algo; 2 si la llamada está mal; 3 si el comercio NO pasa a producción
 * nunca (un demo, `novuchat`, `ensayo`).
 */
import { registerHooks } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

if (args.includes('--aplicar')) {
  console.error('\n  ✗ Este script no escribe: no tiene --aplicar. Las escrituras del pase van por sus puertas');
  console.error('    (asignar-plan.mjs, migrar-prepago.mjs, fijar-tipo-cambio.mjs, actualizarEstadoCuenta,');
  console.error('    fijarTelefonosPago, registrarPagoManual, fijarCortePrepago). Ver docs/pase-a-produccion/RUNBOOK.md.\n');
  process.exit(2);
}

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const aqui = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(opcion('repo') ?? join(aqui, '..', '..'));
const ACEPTACION = opcion('aceptacion');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/pase-a-produccion.mjs --proyecto <id> --tenant <id> [--aceptacion <aceptacion.md>] [--repo <raíz>]\n');
  process.exit(2);
}

// --- los módulos del servidor, sin compilar ---------------------------------
if (typeof registerHooks !== 'function') {
  console.error('\n  ✗ Hace falta Node 22.15 o más nuevo (module.registerHooks).\n');
  process.exit(2);
}
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
const FUENTES = join(aqui, '..', 'functions', 'src');
const { PLANES, limitesDe, limitesDeCuenta } = await import(join(FUENTES, 'planes.ts'));
const { umbralesDeAtencion } = await import(join(FUENTES, 'atencion.ts'));
const { corteAplicable, modalidadDe, tipoCambioVigente } = await import(join(FUENTES, 'prepago.ts'));

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

// --- el informe --------------------------------------------------------------
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');
const filas = [];
/** `ok`: true = cumple, false = falta, null = lo mira una persona (fuera del alcance). */
const anotar = (seccion, ok, texto) => filas.push({ seccion, ok, texto });
const cumple = (s, t) => anotar(s, true, t);
const falta = (s, t) => anotar(s, false, t);
const aMano = (s, t) => anotar(s, null, t);

/** Todos los textos de un documento, recorridos a fondo. */
function textosDe(valor, fuera = []) {
  if (typeof valor === 'string') fuera.push(valor);
  else if (Array.isArray(valor)) valor.forEach((v) => textosDe(v, fuera));
  else if (valor && typeof valor === 'object' && typeof valor.toMillis !== 'function') {
    for (const [k, v] of Object.entries(valor)) { fuera.push(k); textosDe(v, fuera); }
  }
  return fuera;
}
const MARCADOR = /REEMPLAZAR_[A-Z0-9_]+/;
const SUPUESTO = /\bsupuest[oa]s?\b/i;

const NUNCA_PASAN = new Set(['novuchat', 'ensayo']);

// --- lecturas (todas get(), ninguna escritura) --------------------------------
const refTenant = db.doc(`tenants/${TENANT}`);
const [ficha, cuentaDoc, negocioDoc, plataformaDoc, tipoCambioDoc, rutasDelTenant, funcionarios, catalogo, pagos] =
  await Promise.all([
    refTenant.get(),
    db.doc(`tenants/${TENANT}/cuenta/estado`).get(),
    db.doc(`tenants/${TENANT}/config/negocio`).get(),
    db.doc('plataforma/prepago').get(),
    db.doc('plataforma/tipoCambio').get(),
    db.collection('rutasWhatsApp').where('tenantId', '==', TENANT).get(),
    db.collection(`tenants/${TENANT}/funcionarios`).get(),
    db.collection(`tenants/${TENANT}/catalogo`).count().get(),
    db.collection(`tenants/${TENANT}/pagos`).get(),
  ]);

console.log(`\n  Pase a producción · ${TENANT} · proyecto ${PROYECTO}`);
console.log('  Solo lectura: este script no escribe nada.\n');

if (!ficha.exists) {
  console.error(`  ✗ No existe el comercio «${TENANT}».\n`);
  process.exit(1);
}
const fichaD = ficha.data() ?? {};
const cuenta = cuentaDoc.data() ?? {};

// 0 · ¿Este comercio pasa alguna vez? -----------------------------------------
const esDemo = cuenta.plan === 'demostracion' || fichaD.plan === 'demostracion'
  || NUNCA_PASAN.has(TENANT) || TENANT.startsWith('demo-');
if (esDemo) {
  const porque = TENANT === 'novuchat'
    ? 'es el número de captación de la propia NovuChat: no es un comercio que paga y queda en demostración'
    : TENANT === 'ensayo'
      ? 'es el comercio del ensayo (docs/ensayo/LEEME.md): vive en un número de demostración'
      : 'es un demo (plan demostracion): los demos no pasan a producción';
  console.log(`  · «${TENANT}» NO pasa a producción: ${porque}.`);
  console.log(`    Modalidad hoy: ${modalidadDe(cuenta)}. Nada que hacer.\n`);
  process.exit(3);
}

// 1 · Comercio ---------------------------------------------------------------
const flujos = Array.isArray(fichaD.flujos) ? fichaD.flujos : [fichaD.vertical].filter(Boolean);
if (fichaD.estado === 'activo' || fichaD.estado === undefined) cumple('Comercio', 'activo');
else falta('Comercio', `estado «${fichaD.estado}»: un comercio suspendido o de baja no pasa`);
if (flujos.length) cumple('Comercio', `flujos: ${flujos.join(', ')}`);
else falta('Comercio', 'sin flujos en la ficha');

// 2 · Plan -------------------------------------------------------------------
const plan = cuenta.plan;
if (Object.prototype.hasOwnProperty.call(PLANES, plan ?? '')) {
  cumple('Plan', `${PLANES[plan].nombre} (USD ${PLANES[plan].precioUsd} · ${PLANES[plan].conversaciones} conversaciones)`);
  const esperado = limitesDe(plan);
  const vigentes = limitesDeCuenta(cuenta);
  const iguales = vigentes.origen === 'cuenta'
    && ['conversaciones', 'productos', 'agendas'].every((k) => cuenta.limites?.[k] === esperado[k]);
  if (iguales) cumple('Plan', 'copia de límites igual a la del plan');
  else falta('Plan', `copia de límites ausente o distinta del plan (origen ${vigentes.origen}): asignar-plan.mjs en seco`);
  const agendas = funcionarios.docs.filter((d) => d.get('activo') !== false).length;
  if (agendas <= vigentes.agendas) cumple('Plan', `agendas activas ${agendas} de ${vigentes.agendas}`);
  else falta('Plan', `agendas activas ${agendas}, el plan admite ${vigentes.agendas}: subir de plan o dar de baja una agenda`);
  const productos = catalogo.data().count;
  if (productos <= vigentes.productos) cumple('Plan', `productos ${productos} de ${vigentes.productos}`);
  else falta('Plan', `productos ${productos}, el plan admite ${vigentes.productos}`);
} else {
  falta('Plan', `plan «${plan ?? '(ninguno)'}» no es del catálogo: asignar-plan.mjs --plan <impulso|crecimiento|pro>`);
}
const cargados = ['umbralOperador', 'umbralBloqueo'].some((k) => cuenta[k] !== undefined && cuenta[k] !== null);
const umbrales = umbralesDeAtencion(cuenta);
if (cargados && umbrales.origen !== 'cuenta') {
  falta('Plan', 'umbrales de atención cargados pero incoherentes: rige el respaldo (fijar-umbrales.mjs)');
} else {
  cumple('Plan', `umbrales ${umbrales.operador} / ${umbrales.bloqueo} (${umbrales.origen === 'cuenta' ? 'de la empresa' : 'de respaldo'})`);
}

// 3 · Número y WABA ------------------------------------------------------------
const rutas = rutasDelTenant.docs;
const activas = rutas.filter((r) => (r.get('estado') ?? 'activo') === 'activo');
if (activas.length === 0) {
  falta('Número', 'ninguna ruta de WhatsApp activa apunta a este comercio: asignar-numero.mjs');
} else {
  for (const r of activas) {
    const alias = String(r.get('aliasSecreto') ?? '');
    const flujo = String(r.get('flujo') ?? '');
    const base = `número ${cola(r.id)} · WABA ${cola(r.get('wabaId'))} · flujo ${flujo || '?'} · alias ${alias || '(sin alias)'}`;
    if (!/^cliente\d{2}$/.test(alias)) falta('Número', `${base}: el alias no es de cliente (clienteNN)`);
    else if (!flujos.includes(flujo)) falta('Número', `${base}: el flujo no está en la ficha`);
    else cumple('Número', base);
    if (r.get('ensayoDe')) falta('Número', `${base}: la ruta está desviada a un ensayo`);
  }
  const wabas = [...new Set(activas.map((r) => r.get('wabaId')).filter(Boolean))];
  if (wabas.length === 0) falta('Número', 'la ruta no tiene WABA anotada: volver a asignar-numero.mjs con --waba');
  for (const w of wabas) {
    const compartida = await db.collection('rutasWhatsApp').where('wabaId', '==', w).get();
    const otros = [...new Set(compartida.docs.map((d) => d.get('tenantId')).filter((t) => t !== TENANT))];
    if (otros.length) falta('Número', `la WABA ${cola(w)} la usa también otro comercio: el pase exige una WABA del comercio`);
    else cumple('Número', `WABA ${cola(w)} exclusiva de este comercio`);
  }
}
aMano('Número', 'es el número REAL del comercio (no el de prueba de Meta) y está CONNECTED: registrar-numero.sh --estado');
aMano('Número', 'el portafolio de Meta es del comercio o está decidido que no (docs/pase-a-produccion/RUNBOOK.md §2)');
aMano('Número', 'plantillas de utilidad que el flujo usa, APPROVED en ESA WABA: listar-plantillas.sh --detalle');
aMano('Número', 'método de pago y alerta de gasto cargados en la WABA');

// 4 · Configuración ------------------------------------------------------------
if (!negocioDoc.exists) {
  falta('Configuración', 'no existe config/negocio: cargar-negocio.mjs');
} else {
  const negocio = negocioDoc.data() ?? {};
  if (typeof negocio.nombreNegocio === 'string' && negocio.nombreNegocio.trim()) cumple('Configuración', 'nombre del negocio cargado');
  else falta('Configuración', 'sin nombre del negocio');
  if (/^[0-9]{8,15}$/.test(String(negocio.numeroRecepcion ?? ''))) cumple('Configuración', `recepción cargada (${cola(negocio.numeroRecepcion)})`);
  else falta('Configuración', 'sin número de recepción válido: los avisos no llegan a nadie');
  const configs = [negocio];
  for (const f of flujos) {
    const d = await db.doc(`tenants/${TENANT}/config/${f}`).get();
    if (d.exists) configs.push(d.data());
  }
  const textos = configs.flatMap((c) => textosDe(c));
  const marcadores = textos.filter((t) => MARCADOR.test(t)).length;
  const supuestos = textos.filter((t) => SUPUESTO.test(t)).length;
  if (marcadores) falta('Configuración', `${marcadores} texto(s) con un marcador REEMPLAZAR_ sin resolver`);
  else cumple('Configuración', 'sin marcadores REEMPLAZAR_');
  if (supuestos) falta('Configuración', `${supuestos} texto(s) que dicen «supuesto»: confirmarlos con el comercio antes del pase`);
  else cumple('Configuración', 'sin datos marcados como supuestos');
  const extra = typeof negocio.instruccionesExtra === 'string' && negocio.instruccionesExtra.trim() !== '';
  if (extra && negocio.instruccionesVigentes !== negocio.instruccionesExtra) {
    falta('Configuración', 'el comportamiento propuesto no está vigente: pasa por verificarComportamiento o migrar-instrucciones.mjs');
  } else {
    cumple('Configuración', extra ? 'comportamiento vigente igual al propuesto' : 'sin comportamiento propio');
  }
}
aMano('Configuración', 'el administrador revisó en la consola recepción, horario, catálogo y trato');

// 5 · Repositorio ------------------------------------------------------------
const dirFlujos = join(REPO, 'Flujos');
const archivosFlujo = existsSync(dirFlujos)
  ? readdirSync(dirFlujos).filter((a) => a.startsWith(`${TENANT}-`) && a.endsWith('.json') && !a.includes('.local.'))
  : [];
if (archivosFlujo.length === 0) {
  falta('Repositorio', `no hay Flujos/${TENANT}-*.json versionado: el flujo de un cliente sale de su JSON`);
} else {
  for (const a of archivosFlujo) {
    let json;
    try { json = JSON.parse(readFileSync(join(dirFlujos, a), 'utf8')); } catch { falta('Repositorio', `Flujos/${a} no es JSON válido`); continue; }
    const traer = (json.nodes ?? []).find((n) => n.name === 'Traer configuración');
    if (!traer) { aMano('Repositorio', `Flujos/${a}: sin «Traer configuración» (flujo programado)`); continue; }
    if (String(traer.parameters?.jsonBody ?? '').includes('telefono')) cumple('Repositorio', `Flujos/${a} manda telefono a Traer configuración`);
    else falta('Repositorio', `Flujos/${a} NO manda telefono a Traer configuración: el corte no puede encenderse`);
  }
}
const datos = join(REPO, 'admin', 'scripts', 'datos', `negocio-${TENANT}.json`);
if (!existsSync(datos)) {
  aMano('Repositorio', `sin admin/scripts/datos/negocio-${TENANT}.json (la configuración no se puede recargar desde main)`);
} else {
  let json = null;
  try { json = JSON.parse(readFileSync(datos, 'utf8')); } catch { falta('Repositorio', `negocio-${TENANT}.json no es JSON válido`); }
  if (json) {
    const supuestos = textosDe(json).filter((t) => SUPUESTO.test(t)).length;
    if (supuestos || json._supuestos) falta('Repositorio', `negocio-${TENANT}.json tiene ${supuestos} nota(s) de supuestos sin confirmar`);
    else cumple('Repositorio', `negocio-${TENANT}.json sin supuestos`);
  }
}
aMano('Repositorio', 'el flujo publicado en n8n es el de main: publicar-flujo.sh en seco, leído entero, sin diferencias');

// 6 · Aceptación ---------------------------------------------------------------
if (!ACEPTACION) {
  aMano('Aceptación', 'con dos teléfonos reales, resultado real anotado (pasar --aceptacion <aceptacion.md>)');
} else if (!existsSync(ACEPTACION)) {
  falta('Aceptación', 'el archivo de aceptación no existe');
} else {
  const lineas = readFileSync(ACEPTACION, 'utf8').split('\n');
  let columna = -1; let total = 0; let vacias = 0;
  const celdas = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  for (const l of lineas) {
    if (!l.trim().startsWith('|')) { columna = -1; continue; }
    const c = celdas(l);
    const i = c.findIndex((x) => /^resultado real$/i.test(x));
    if (i >= 0) { columna = i; continue; }
    if (columna < 0 || c.every((x) => /^:?-+:?$/.test(x) || x === '')) continue;
    total += 1;
    if (!c[columna]) vacias += 1;
  }
  if (total === 0) falta('Aceptación', 'no se encontró ninguna tabla con la columna «Resultado real»');
  else if (vacias) falta('Aceptación', `${vacias} de ${total} pruebas sin resultado real anotado`);
  else cumple('Aceptación', `${total} pruebas con resultado real anotado (revisar que ninguna diga «falla»)`);
}

// 7 · Prepago ------------------------------------------------------------------
const modalidad = modalidadDe(cuenta);
const plataforma = plataformaDoc.data() ?? {};
const ahoraMs = Date.now();
const encabezado = modalidad === 'prepago' ? 'PRODUCCIÓN' : 'PRUEBA';
anotar('Prepago', modalidad === 'demostracion' ? false : true,
  `modalidad ${modalidad}${cuenta.modalidad ? '' : ' (sin modalidad: rige demostración)'} · la consola dice «${encabezado}»`
  + (modalidad === 'prueba' ? ` · prueba ${cuenta.periodoPrueba ?? '?'}, bolsa ${cuenta.bolsaPrueba ?? '?'}` : '')
  + (modalidad === 'prepago' ? ` · pagado hasta ${cuenta.periodoPagado ?? '?'}` : ''));
const telefonos = Array.isArray(cuenta.telefonosPago) ? cuenta.telefonosPago : [];
if (telefonos.length) cumple('Prepago', `teléfonos de pago: ${telefonos.length} (${telefonos.map(cola).join(', ')})`);
else falta('Prepago', 'sin teléfonos de pago: los fija el administrador del comercio (fijarTelefonosPago)');
aMano('Prepago', 'cada teléfono de pago verificado con su titular (una llamada o un mensaje desde ese número)');
const tco = tipoCambioVigente(tipoCambioDoc.data(), ahoraMs);
if (tco) cumple('Prepago', `TCO vigente ${tco.tco} del ${tco.fecha} (${tco.fuente})`);
else falta('Prepago', 'sin TCO vigente en plataforma/tipoCambio: fijar-tipo-cambio.mjs (sin TCO no se emite ningún cobro)');

const lista = pagos.docs.map((d) => d.data());
const confirmados = lista.filter((p) => p.estado === 'confirmado');
const porBanco = confirmados.filter((p) => p.confirmadoPor?.origen === 'banco');
const pendientes = lista.filter((p) => p.estado === 'pendiente');
if (confirmados.length) {
  cumple('Prepago', `pagos confirmados: ${confirmados.length} (${porBanco.length} por el banco, ${confirmados.length - porBanco.length} manuales)`);
} else {
  falta('Prepago', 'ningún pago confirmado: el primer pago es el que pasa la cuenta a prepago');
}
if (pendientes.length) aMano('Prepago', `${pendientes.length} pago(s) pendiente(s): esperar al banco o anularlo antes de cargar otro`);

const marcas = cuenta.recordatorios && typeof cuenta.recordatorios === 'object' ? Object.keys(cuenta.recordatorios) : [];
const periodosPronto = new Set(marcas.filter((k) => k.startsWith('vence_pronto_')).map((k) => k.slice('vence_pronto_'.length)));
const ciclo = marcas.some((k) => k.startsWith('vence_manana_') && periodosPronto.has(k.slice('vence_manana_'.length)));
if (ciclo) cumple('Prepago', 'un ciclo de recordatorios (D-5 y D-1 del mismo mes) ya salió');
else falta('Prepago', 'ningún ciclo de recordatorios observado todavía (D-5 y D-1 de un mismo mes)');

const corteTenant = cuenta.corteActivo === true;
const corteGlobal = plataforma.corteActivo === true;
const aplica = corteAplicable(cuenta, plataforma);
const listoParaCorte = modalidad === 'prepago' && porBanco.length > 0 && ciclo && telefonos.length > 0
  && !filas.some((f) => f.seccion === 'Repositorio' && f.ok === false && f.texto.includes('telefono'));
const estadoCorte = `corte ${aplica ? 'APLICADO' : 'en observación'} (tenant ${corteTenant ? 'encendido' : 'apagado'}, global ${corteGlobal ? 'encendido' : 'apagado'})`;
if (aplica && !listoParaCorte) {
  falta('Prepago', `${estadoCorte}, SIN sus precondiciones: apagar con fijarCortePrepago o completarlas`);
} else if (aplica) {
  cumple('Prepago', estadoCorte);
} else {
  anotar('Prepago', null, `${estadoCorte} · ${listoParaCorte
    ? 'precondiciones del corte cumplidas: encenderlo en este tenant es decisión de Andres (fijarCortePrepago con tenantId y motivo)'
    : 'el corte NO se enciende todavía: falta prepago, un pago confirmado por el banco, un ciclo observado o los teléfonos de pago'}`);
}

// --- imprimir -------------------------------------------------------------------
const signo = (ok) => (ok === true ? '✓' : ok === false ? '✗' : '·');
let seccion = '';
for (const f of filas) {
  if (f.seccion !== seccion) { seccion = f.seccion; console.log(`  ${seccion}`); }
  console.log(`    ${signo(f.ok)} ${f.texto}`);
}
const faltan = filas.filter((f) => f.ok === false).length;
const manos = filas.filter((f) => f.ok === null).length;
const faltanAntes = filas.filter((f) => f.ok === false && f.seccion !== 'Prepago').length;
const etapa = faltanAntes ? '1 · precondiciones (runbook §1)'
  : modalidad !== 'prepago' ? '2 · activación del prepago: el primer pago (runbook §3)'
    : !aplica ? '3 · prepago en observación (runbook §4)'
      : '4 · producción con el corte encendido en este comercio (runbook §5)';
console.log(`\n  Etapa del pase: ${etapa}`);
console.log(`  Resumen: ${filas.filter((f) => f.ok === true).length} se cumplen · ${faltan} faltan · ${manos} a mirar a mano.`);
console.log(faltan
  ? '  NO está listo: completar lo que falta, cada escritura por su puerta y en seco primero.\n'
  : '  Lo que el script ve se cumple. Lo marcado con «·» lo confirma una persona antes de seguir.\n');
process.exit(faltan ? 1 : 0);
