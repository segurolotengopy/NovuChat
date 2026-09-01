#!/usr/bin/env node
/**
 * =============================================================================
 * CARGA DE LOS DOS COMERCIOS DE DEMOSTRACIÓN EN LA CONSOLA
 * =============================================================================
 *
 * Deja en Firestore los dos negocios que YA ESTÁN CORRIENDO en n8n contra
 * WhatsApp real, con su configuración verdadera: el de agendamiento (Demo A) y
 * el de venta y cobro (Demo B). Hasta ahora la consola estaba vacía mientras los
 * flujos funcionaban, y esa distancia es justamente la que hay que cerrar: la
 * consola tiene que ser el lugar donde vive la configuración, no un espejo tarde.
 *
 * NO ES `sembrar.mjs`. Aquél inventa datos de fantasía para los emuladores y se
 * NIEGA a tocar un proyecto real. Éste escribe en un proyecto real, y por eso no
 * inventa nada.
 *
 * =============================================================================
 * QUÉ ES REAL Y QUÉ NO — leer antes de mirar cualquier pantalla
 * =============================================================================
 *
 * SE CARGA porque existe y está verificado: nombre del negocio, horarios,
 * servicios con sus precios, mensajes fijos, voz del asistente, moneda, zona
 * horaria, costos de envío, tiempos de cocina y despacho, el identificador del
 * número de WhatsApp y los calendarios.
 *
 * NO SE CARGA, a propósito:
 *
 *   - MÉTRICAS de uso. Hubo conversaciones reales, pero pasaron por n8n y nunca
 *     por la ingesta de la consola, así que no hay una cifra que sea cierta.
 *     Inventar «142 personas atendidas» para que la pantalla se vea llena sería
 *     mentirle a quien la mire, incluido nosotros dentro de un mes. La pantalla
 *     de Uso va a estar vacía hasta que la ingesta reciba de verdad.
 *   - CONVERSACIONES, por lo mismo y porque son mensajes de personas reales.
 *   - ESTADO DE PAGO. Estos dos comercios son demostraciones de NovuChat, no
 *     clientes: no hay factura ni monto. Se marca como tal.
 *
 * Uso:
 *   node scripts/sembrar-demos.mjs                          # seco, no conecta
 *   node scripts/sembrar-demos.mjs --proyecto <id> --aplicar
 */
import { readFileSync } from 'node:fs';

const RAIZ = new URL('../../', import.meta.url);

/** Lee un `.env` sin exportarlo al proceso. */
function leerEnv(nombre) {
  try {
    const texto = readFileSync(new URL(nombre, RAIZ), 'utf8');
    return Object.fromEntries(
      texto.split('\n')
        .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    );
  } catch {
    return null;
  }
}

/**
 * Tabla de marcadores de `CONFIGURACION.local.md`.
 *
 * Los calendarios por área y el media ID del QR no están en ningún `.env`:
 * viven acá, que es de donde los toma `preparar-import.sh` para armar el JSON
 * del flujo. Se lee la MISMA tabla a propósito — si la consola leyera su propia
 * copia, las dos se separarían en la primera corrección y nadie se enteraría
 * hasta que un cliente viera un calendario equivocado.
 */
function leerMarcadores() {
  try {
    const texto = readFileSync(new URL('CONFIGURACION.local.md', RAIZ), 'utf8');
    const tabla = {};
    for (const m of texto.matchAll(/^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|/gm)) {
      const valor = m[2].trim().replace(/^`|`$/g, '').trim();
      if (valor && !/pendiente/i.test(valor)) tabla[m[1]] = valor;
    }
    return tabla;
  } catch {
    return null;
  }
}

/**
 * Los identificadores salen de los `.env`, NUNCA del código.
 *
 * El repositorio es público y la convención de saneo obliga: números de
 * WhatsApp, teléfonos y calendarios se sanean. Si este archivo los llevara
 * escritos, el commit los publicaría. Además así la consola queda cargada con
 * exactamente lo que usan los flujos, no con una copia que se desincroniza.
 */
const envA = leerEnv('.env');
const envB = leerEnv('.env.demo-b');
const marcas = leerMarcadores();

// -----------------------------------------------------------------------------
// LOS DOS COMERCIOS
// -----------------------------------------------------------------------------
// Los textos son los que hoy están en el nodo `Config del negocio` de cada
// flujo, con una excepción deliberada, marcada más abajo: el voseo se corrige.
const COMERCIOS = [
  {
    id: 'demo-agendamiento',
    nombre: 'Salón & Clínica Demo NovuChat',
    vertical: 'agendamiento',
    pnid: envA?.['WA_PHONE_ID'],
    wabaId: envA?.['WABA_ID'],
    recepcion: envA?.['WA_TO'],
    calendario: envA?.['CALENDAR_ID'],
    descripcion: 'Peluquería, estética y odontología. Agenda citas por WhatsApp.',
    horarios: {
      lun: '09:00-19:00', mar: '09:00-19:00', mie: '09:00-19:00',
      jue: '09:00-19:00', vie: '09:00-19:00', sab: '09:00-19:00', dom: 'cerrado',
    },
    // Los ocho servicios del mapa `calendariosPorServicio` del flujo, repartidos
    // en las dos áreas que tienen calendario propio.
    catalogo: [
      { nombre: 'Manicure', area: 'belleza', duracionMin: 45, activo: true },
      { nombre: 'Pedicure', area: 'belleza', duracionMin: 45, activo: true },
      { nombre: 'Corte', area: 'belleza', duracionMin: 45, activo: true },
      { nombre: 'Limpieza facial', area: 'belleza', duracionMin: 60, activo: true },
      { nombre: 'Odontología general', area: 'odontologia', duracionMin: 45, activo: true },
      { nombre: 'Ortodoncia', area: 'odontologia', duracionMin: 45, activo: true },
      { nombre: 'Cirugía maxilofacial', area: 'odontologia', duracionMin: 60, activo: true },
      { nombre: 'Diagnóstico', area: 'odontologia', duracionMin: 30, activo: true },
    ],
    mensajes: {
      bienvenida: '¡Hola! 👋 Soy el asistente virtual del salón. ¿En qué puedo ayudarte?',
      fuera_de_horario: 'Ahora estamos cerrados. Te respondemos apenas abramos.',
    },
    cierre: 'Gracias por escribirnos. Si necesitas algo más, escríbeme por acá.',
    errorTemporal: 'Disculpa, tuve un problema técnico momentáneo. ¿Me repites lo último?',
    reservaNoConfirmada:
      'Disculpa, no pude confirmar el registro de tu cita en la agenda. Te paso con una '
      + 'persona de recepción para que lo resuelva ahora mismo.',
    // VOSEO CORREGIDO. En el flujo dice «escribinos ... y lo resolvemos». Es de
    // lo poco que el asistente repite palabra por palabra al cliente, y va
    // contra la regla de español boliviano sin voceo. Se carga en tuteo, y el
    // flujo queda desalineado a propósito hasta que se publique: eso se ve en
    // `publicar-flujo.sh` como deriva, que es donde tiene que verse.
    politicaCancelacion:
      'Para cancelar o reprogramar, escríbenos por este mismo chat con al menos 2 horas '
      + 'de anticipación y lo resolvemos sin costo.',
    datosQueNoTenemos: [
      'nombres de los profesionales', 'currículums', 'formas de pago', 'promociones',
      'estacionamiento', 'atención a domicilio', 'cobertura de seguros',
    ],
    vertConfig: {
      duracionPorDefectoMin: 45,
      anticipacionMinimaMin: 120,   // «al menos 2 horas», igual que la política
      anticipacionMaximaDias: 45,
      permitirCancelacion: true,
      horasRecordatorio: 24,        // el flujo de recordatorios avisa el día antes
    },
    // Dos áreas con calendario propio. NO son personas: hoy el demo reparte por
    // área, no por profesional. Se cargan con su nombre real para no sugerir un
    // equipo que no existe.
    funcionarios: [
      { id: 'area-belleza', nombre: 'Área de Belleza', especialidad: 'Peluquería y estética',
        marcador: 'REEMPLAZAR_CALENDARIO_BELLEZA', servicios: ['manicure', 'pedicure', 'corte', 'limpieza-facial'] },
      { id: 'area-odontologia', nombre: 'Área de Odontología', especialidad: 'Odontología',
        marcador: 'REEMPLAZAR_CALENDARIO_ODONTOLOGIA', servicios: ['odontologia-general', 'ortodoncia', 'cirugia-maxilofacial', 'diagnostico'] },
    ],
  },
  {
    id: 'demo-venta',
    nombre: 'Resto & Tienda Demo NovuChat',
    vertical: 'venta',
    pnid: envB?.['WA_PHONE_ID'],
    wabaId: envB?.['WABA_ID'],
    recepcion: envB?.['WA_TO'],
    calendario: '',
    descripcion: 'Gastronomía y retail. Toma pedidos y cobra por WhatsApp.',
    horarios: {
      lun: '11:00-22:00', mar: '11:00-22:00', mie: '11:00-22:00',
      jue: '11:00-22:00', vie: '11:00-22:00', sab: '11:00-22:00', dom: 'cerrado',
    },
    catalogo: [
      { nombre: 'Hamburguesa doble', area: 'gastronomia', precio: 35, activo: true },
      { nombre: 'Hamburguesa clásica', area: 'gastronomia', precio: 28, activo: true },
      { nombre: 'Salchipapa', area: 'gastronomia', precio: 20, activo: true },
      { nombre: 'Gaseosa (normal o zero)', area: 'gastronomia', precio: 8, activo: true },
      { nombre: 'Chaqueta negra (S, M, L)', area: 'retail', precio: 180, activo: true },
      { nombre: 'Audífonos inalámbricos', area: 'retail', precio: 95, activo: true },
    ],
    mensajes: {
      bienvenida: '¡Hola! 👋 Soy el asistente virtual (IA). ¿Qué te gustaría pedir?',
      fuera_de_horario: 'Ahora estamos cerrados. Te respondemos apenas abramos.',
    },
    cierre: 'Gracias por tu pedido. ¡Que lo disfrutes!',
    errorTemporal: 'Disculpa, tuve un problema técnico momentáneo. ¿Me repites lo último?',
    reservaNoConfirmada: '',
    politicaCancelacion: '',
    datosQueNoTenemos: ['dirección del local', 'formas de pago reales', 'promociones'],
    vertConfig: {
      costoDelivery: 7,
      recargoFlota: 10,
      radioEntregaKm: 5,
      tiempoCocinaMin: 25,
      tiempoDespachoMin: 35,
      pedidoMinimo: 0,
      aceptaDelivery: true,
      aceptaRetiroEnLocal: true,
      // El media ID del QR ROTULADO. Los rótulos en sí NO van acá: viven en
      // /plataforma/cobroSimulado y no los edita ningún comercio.
      mediaIdQr: marcas?.['REEMPLAZAR_MEDIA_ID_QR_DEMO'] ?? '',
    },
    funcionarios: [],
  },
];

// -----------------------------------------------------------------------------
// Ejecución
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;

const problemas = [];
if (!envA) problemas.push('Falta .env (Demo A)');
if (!envB) problemas.push('Falta .env.demo-b (Demo B)');
if (!marcas) problemas.push('Falta CONFIGURACION.local.md');
for (const clave of ['REEMPLAZAR_CALENDARIO_BELLEZA', 'REEMPLAZAR_CALENDARIO_ODONTOLOGIA',
                     'REEMPLAZAR_MEDIA_ID_QR_DEMO']) {
  if (!marcas?.[clave]) problemas.push(`Falta el marcador ${clave} en CONFIGURACION.local.md`);
}
for (const c of COMERCIOS) {
  if (!c.pnid) problemas.push(`${c.id}: sin identificador de número de WhatsApp`);
  if (!c.recepcion) problemas.push(`${c.id}: sin teléfono de recepción`);
  if (c.vertical === 'agendamiento' && !c.calendario) problemas.push(`${c.id}: sin calendario`);
}

console.log('\nComercios a cargar\n');
for (const c of COMERCIOS) {
  console.log(`  ${c.id}  ·  ${c.nombre}`);
  console.log(`      vertical ${c.vertical} · ${c.catalogo.length} items del catálogo`
    + ` · ${c.funcionarios.length} área(s) con agenda`);
  // Nunca se imprime un identificador: solo si está o no.
  console.log(`      número de WhatsApp: ${c.pnid ? 'cargado' : 'FALTA'}`
    + ` · recepción: ${c.recepcion ? 'cargada' : 'FALTA'}`
    + (c.vertical === 'agendamiento' ? ` · calendario: ${c.calendario ? 'cargado' : 'FALTA'}` : ''));
}

if (problemas.length) {
  console.error('\nNo se puede continuar:');
  for (const p of problemas) console.error(`  ✗ ${p}`);
  console.error();
  process.exit(1);
}
console.log('\n  ✓ todos los identificadores están disponibles');
console.log('\n  No se cargan métricas, conversaciones ni estado de pago:');
console.log('  no hay cifras verdaderas todavía y una cifra inventada es peor que una vacía.');

if (!APLICAR) {
  console.log('\nSeco: no se abrió ninguna conexión.');
  console.log('  node scripts/sembrar-demos.mjs --proyecto <id> --aplicar\n');
  process.exit(0);
}
if (!PROYECTO) {
  console.error('\nNEGADO: --aplicar exige --proyecto <id>.\n');
  process.exit(1);
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('\nNEGADO: hay FIRESTORE_EMULATOR_HOST en el entorno.\n');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const sello = { actualizadoPor: 'sembrar-demos', actualizadoEn: FieldValue.serverTimestamp() };
const idDe = (nombre) => nombre.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

console.log(`\nDestino: ${PROYECTO}\n`);

for (const c of COMERCIOS) {
  await db.doc(`tenants/${c.id}`).set({
    nombre: c.nombre,
    estado: 'activo',
    plan: 'demostracion',
    vertical: c.vertical,
    waPhoneNumberId: c.pnid,
    waWabaId: c.wabaId ?? '',
    creadoEn: Timestamp.now(),
    creadoPor: 'sembrar-demos',
  }, { merge: true });

  await db.doc(`tenants/${c.id}/config/negocio`).set({
    nombreNegocio: c.nombre,
    descripcion: c.descripcion,
    zonaHoraria: 'America/La_Paz',
    numeroRecepcion: c.recepcion,
    direccion: '',
    tratamiento: 'tu',
    estiloEmojis: 'pocos',
    politicaCancelacion: c.politicaCancelacion,
    prefijosPermitidos: ['591'],
    datosQueNoTenemos: c.datosQueNoTenemos,
    mensajeCierre: c.cierre,
    mensajeErrorTemporal: c.errorTemporal,
    mensajeReservaNoConfirmada: c.reservaNoConfirmada,
    mensajeComercioSuspendido:
      'En este momento no podemos atenderte por este medio. Por favor comunícate '
      + 'directamente con el negocio. Gracias por escribirnos.',
    calendarioId: c.calendario,
    moneda: 'BOB',
    horarios: c.horarios,
    mensajes: c.mensajes,
    instruccionesExtra: '',
    ...sello,
  }, { merge: true });

  await db.doc(`tenants/${c.id}/config/${c.vertical}`).set({ ...c.vertConfig, ...sello }, { merge: true });

  for (const item of c.catalogo) {
    await db.doc(`tenants/${c.id}/catalogo/${idDe(item.nombre)}`).set({ ...item, ...sello }, { merge: true });
  }

  for (const f of c.funcionarios) {
    await db.doc(`tenants/${c.id}/funcionarios/${f.id}`).set({
      nombre: f.nombre,
      especialidad: f.especialidad,
      calendarioId: marcas?.[f.marcador] ?? '',
      horarioTrabajo: c.horarios,
      servicios: f.servicios,
      activo: true,
      ...sello,
    }, { merge: true });
  }

  await db.doc(`tenants/${c.id}/cuenta/estado`).set({
    plan: 'demostracion',
    estadoPago: 'sin_cargo',
    montoMensual: 0,
    moneda: 'BOB',
    motivoVisible: 'Comercio de demostración de NovuChat. No genera cargos.',
    actualizadoEn: FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.doc(`rutasWhatsApp/${c.pnid}`).set({
    tenantId: c.id,
    flujo: c.vertical,
    wabaId: c.wabaId ?? '',
    estado: 'activo',
    asignadoEn: Timestamp.now(),
    asignadoPor: 'sembrar-demos',
  }, { merge: true });

  console.log(`  ✓ ${c.id}`);
}

// Relectura: no basta con que las escrituras no fallen.
console.log('\nVerificación por relectura:');
for (const c of COMERCIOS) {
  const t = await db.doc(`tenants/${c.id}`).get();
  const n = await db.doc(`tenants/${c.id}/config/negocio`).get();
  const v = await db.doc(`tenants/${c.id}/config/${c.vertical}`).get();
  const cat = await db.collection(`tenants/${c.id}/catalogo`).get();
  const fun = await db.collection(`tenants/${c.id}/funcionarios`).get();
  const ruta = await db.doc(`rutasWhatsApp/${c.pnid}`).get();
  const ok = t.exists && n.exists && v.exists
    && cat.size === c.catalogo.length && fun.size === c.funcionarios.length
    && ruta.exists && ruta.get('tenantId') === c.id;
  console.log(`  ${ok ? '✓' : '✗'} ${c.id}: negocio ${n.exists ? 'sí' : 'NO'}`
    + ` · ${c.vertical} ${v.exists ? 'sí' : 'NO'}`
    + ` · catálogo ${cat.size}/${c.catalogo.length}`
    + ` · agendas ${fun.size}/${c.funcionarios.length}`
    + ` · ruta ${ruta.exists ? 'sí' : 'NO'}`);
}
console.log();
