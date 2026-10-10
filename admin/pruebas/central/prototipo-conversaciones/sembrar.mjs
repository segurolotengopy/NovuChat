#!/usr/bin/env node
/**
 * =============================================================================
 * SIEMBRA DEL DEMO DE CONVERSACIONES — DATOS 100 % FICTICIOS
 * =============================================================================
 *
 * Deja en los emuladores (Auth y Firestore) un comercio de mentira con 31
 * conversaciones para probar la pantalla nueva de Conversaciones (H1), con la
 * bandera `consolaConversaciones: 'nueva'` ya puesta:
 *
 *   · un hilo de más de 400 mensajes (para ver que se muestran los ÚLTIMOS y no
 *     los más viejos, y que una búsqueda salta a un mensaje profundo);
 *   · DOS teléfonos de dígitos parecidos (…0047 y …0074);
 *   · conversaciones que «necesitan humano» (estado de atención `operador` o
 *     `bloqueado` en las últimas 24 h), con mensajes sin leer, con la ventana de
 *     24 h por vencer y con la ventana cerrada;
 *   · DOS conversaciones «de antes de H1», sin ninguno de los campos nuevos
 *     (…0066 y …0096), para ver que la lectura tolerante las muestra como leídas
 *     y sin pastilla de ventana;
 *   · un mensaje con HTML adentro, que tiene que verse como texto.
 *
 * Los campos son los del contrato de H1 (plan §4.1 y §4.2): en la conversación
 * `telefonoTrozos`, `nombrePalabras`, `ultimoEntranteEn`, `ventanaVenceEn`,
 * `noLeidos`, `sinLeer` y `atencionEstado`; en cada mensaje `tenantId` y `palabras`.
 * NO se siembra `turno`, `necesitaHumano` ni `autor`: eso es de H2.
 *
 * TELÉFONOS: todos son `591000000NN` (seis ceros seguidos), la única forma que
 * deja pasar `scripts/verificar-saneo.sh`. Los nombres, los precios y los textos
 * son inventados. Ningún dato real.
 *
 * LAS PALABRAS Y LOS TROZOS DE TELÉFONO SE ESCRIBEN CON LA FUNCIÓN DE CORE
 * (`functions/src/core/conversacion/normalizacion.ts`): la misma que usan la
 * pantalla, la ingesta y la búsqueda del servidor. Una sola regla.
 *
 * LA BÚSQUEDA POR PALABRA llama a la Function `buscarConversaciones`, que este demo
 * no levanta (solo Firestore y Auth): en el demo esa búsqueda muestra el aviso de
 * que todavía no está disponible. El teléfono y el nombre sí funcionan.
 *
 * SOLO CONTRA EMULADORES: se niega si el proyecto no empieza con `demo-` o si los
 * emuladores no están en esta máquina. El SDK Admin se salta las reglas.
 *
 * ES REPETIBLE: borra las conversaciones del comercio de prueba y las vuelve a
 * escribir con la hora de ahora (así «ventana por vencer» vuelve a estar por
 * vencer).
 *
 * Uso:  node sembrar.mjs
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { cuentaInicial } from '../../../functions/src/central/cuenta/planes.ts';
import { palabrasDe, trozosDeTelefono } from '../../../functions/src/core/conversacion/normalizacion.ts';

// ── Salvaguardas ─────────────────────────────────────────────────────────────
const PROYECTO = process.env.PROYECTO_EMULADOR ?? 'demo-novuchat-prototipo';
const HOST_FS = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8701';
const HOST_AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9701';
const local = (h) => /^(127\.0\.0\.1|localhost):\d+$/.test(h);
if (!PROYECTO.startsWith('demo-') || !local(HOST_FS) || !local(HOST_AUTH)) {
  console.error(`\nNEGADO: proyecto «${PROYECTO}», Firestore «${HOST_FS}», Auth «${HOST_AUTH}».`);
  console.error('Esta siembra solo corre contra emuladores locales con un proyecto «demo-…».\n');
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = HOST_FS;
process.env.FIREBASE_AUTH_EMULATOR_HOST = HOST_AUTH;
initializeApp({ projectId: PROYECTO });
const auth = getAuth();
const db = getFirestore();

const TENANT = 'comercio-prototipo';
const CLAVE = 'Prototipo-2026-ficticia';
const USUARIOS = {
  admin: { uid: 'u-proto-admin', correo: 'admin.prototipo@ejemplo.com', nombre: 'Rosa (prueba)', rol: 'admin' },
  oper: { uid: 'u-proto-oper', correo: 'operador.prototipo@ejemplo.com', nombre: 'Luis (prueba)', rol: 'oper' },
};

const AHORA = Date.now();
const MIN = 60_000;
const HORA = 60 * MIN;
const ts = (ms) => Timestamp.fromMillis(ms);

// Generador pseudoaleatorio con semilla fija: el mismo hilo largo en cada corrida.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const azar = mulberry32(20261009);
const elegir = (lista) => lista[Math.floor(azar() * lista.length)];

// ── Guiones (c = cliente, a = asistente, p = persona del negocio) ────────────
// Texto inventado. El asistente nunca dice «pago acreditado»: dice que el
// comprobante llegó y que los datos coinciden (CLAUDE.md, prohibición 3).
const HOLA_A = 'Hola, soy el asistente virtual de Panadería Luna. Con gusto le ayudo.';
const GUIONES = {
  pedido: () => [
    ['c', 'Buenas tardes, quisiera hacer un pedido para mañana'],
    ['a', `${HOLA_A} ¿Qué le gustaría pedir?`],
    ['c', 'Dos docenas de salteñas y una torta de chocolate'],
    ['a', 'Anotado: 24 salteñas (Bs 8 c/u) y una torta de chocolate mediana (Bs 120). ¿Para qué hora las necesita?'],
    ['c', 'A las 10 de la mañana'],
    ['a', 'Perfecto, quedan para las 10:00. El total es Bs 312. ¿Desea pagar por QR o al recoger?'],
    ['c', 'Por QR, por favor'],
    ['a', 'Le envío el código QR del negocio. Cuando pague, mande la foto del comprobante.'],
    ['c', 'Comprobante de pago', 'image'],
    ['a', 'Recibí su comprobante y los datos coinciden con el pedido. El negocio confirmará que el dinero haya llegado. Gracias.'],
  ],
  reclamo: () => [
    ['c', 'Hola, la torta que compré ayer llegó aplastada'],
    ['a', 'Lamento mucho lo ocurrido. Voy a pasar su caso con una persona del negocio para que lo revise.'],
    ['a', 'Ya avisé a recepción. Puede escribirles directo con el botón de abajo.'],
  ],
  factura: () => [
    ['c', 'Necesito factura por mi pedido de la semana pasada'],
    ['a', `${HOLA_A} Para facturas lo paso con una persona del negocio, que tiene sus datos.`],
    ['a', 'Ya avisé a recepción. Puede escribirles directo con el botón de abajo.'],
  ],
  tortaGrande: () => [
    ['c', 'Quiero una torta para 80 personas para el sábado'],
    ['a', 'Para pedidos grandes el negocio revisa la disponibilidad. Lo paso con una persona; ya recibió el aviso.'],
    ['c', 'Está bien, espero'],
  ],
  horarios: () => [
    ['c', '¿A qué hora abren los domingos?'],
    ['a', `${HOLA_A} Los domingos atendemos de 8:00 a 13:00. De lunes a sábado, de 7:00 a 20:00.`],
    ['c', '¿Y hoy hay pan de maíz?'],
    ['a', 'El pan de maíz sale a las 16:00 todos los días.'],
    ['c', 'Gracias'],
    ['a', 'Con gusto. Que tenga buen día.'],
  ],
  precios: () => [
    ['c', '¿Cuánto cuesta la empanada de queso?'],
    ['a', `${HOLA_A} La empanada de queso cuesta Bs 7 y la de pollo Bs 9.`],
    ['c', '¿Y por mayor?'],
    ['a', 'Desde 30 unidades hay precio por mayor: Bs 6 la de queso. ¿Cuántas necesita?'],
    ['c', 'Déjeme consultar y le aviso'],
    ['a', 'Perfecto, aquí estoy cuando me necesite.'],
  ],
  delivery: () => [
    ['c', '¿Hacen envíos a domicilio?'],
    ['a', `${HOLA_A} Sí, en la zona centro y sur. El envío cuesta Bs 10 y llega en unos 40 minutos.`],
    ['c', '¿Pueden llevar a la zona norte?'],
    ['a', 'A la zona norte el envío cuesta Bs 15.'],
    ['c', 'Bien, ¿puedo pagar al recibir?'],
    ['a', 'Sí, el pago es contra entrega, en efectivo o por QR.'],
  ],
  cumple: () => [
    ['c', 'Buenas, ¿tienen alfajores de maicena para un cumpleaños?'],
    ['a', `${HOLA_A} Sí, los alfajores de maicena cuestan Bs 3 la unidad, en cajas de 12 por Bs 34.`],
    ['c', 'Necesito 5 cajas para el sábado'],
    ['a', 'Anotado: 5 cajas de alfajores (60 unidades), Bs 170. ¿A qué hora las recoge?'],
    ['c', 'A las 5 de la tarde'],
    ['a', 'Quedan anotadas para las 17:00. Gracias.'],
  ],
  escapado: () => [
    ['c', '<img src=x onerror="alert(1)"> <b>hola</b> &amp; <script>alert(2)</script>'],
    ['a', 'Recibí su mensaje. ¿En qué le puedo ayudar?'],
  ],
};
// Lo que escribe un cliente impaciente: se agrega al final de las que quedan sin leer.
const COLA = [
  '¿Me puede confirmar?', 'Hola, ¿sigue ahí?', 'Es urgente, por favor', 'Quedo atento', '¿A qué hora sería?',
  '¿Y si cambio la hora?', 'Gracias de antemano', 'Avíseme apenas pueda',
];
// ── Las 31 conversaciones ────────────────────────────────────────────────────
// [sufijo, nombre, guion, minutos desde el último mensaje, sin leer, estado de atención, 'vieja' = sin los campos de H1]
const FILAS = [
  ['12', 'Marcela R.', 'LARGO', 6, 2, 'normal', null],
  ['47', 'Ximena P.', 'pedido', 12, 3, 'normal', null],      // …0047 y …0074: dígitos parecidos
  ['74', 'Mauricio T.', 'pedido', 25, 0, 'normal', null],
  ['05', 'Rolando C.', 'reclamo', 9, 2, 'operador', null],
  ['08', 'Daniela V.', 'factura', 40, 1, 'bloqueado', null],
  ['15', 'Álvaro M.', 'tortaGrande', 75, 0, 'operador', null],
  ['21', 'Lucía F.', 'horarios', 130, 0, 'normal', null],
  ['23', 'Gonzalo S.', 'cumple', 55, 4, 'normal', null],
  ['31', 'Patricia L.', 'delivery', 20, 0, 'normal', null],
  ['33', 'Fernando H.', 'reclamo', 95, 0, 'normal', null],
  ['36', 'Carla B.', 'pedido', 180, 0, 'normal', null],
  ['41', 'Jhonny A.', 'precios', 1180, 0, 'normal', null],  // ventana por vencer
  ['42', 'Verónica D.', 'pedido', 1210, 1, 'normal', null],
  ['44', 'Sergio N.', 'horarios', 1145, 0, 'normal', null],
  ['52', 'Rosario G.', 'cumple', 1250, 2, 'normal', null],
  ['55', 'Iván K.', 'delivery', 1170, 1, 'operador', null],
  ['58', 'Beatriz J.', 'precios', 2900, 0, 'normal', null],  // ventana cerrada
  ['61', 'Hugo Z.', 'pedido', 1700, 0, 'normal', null],
  ['63', 'Natalia O.', 'reclamo', 4300, 0, 'operador', null], // pidió una persona hace días: ya no figura en «Necesita humano»
  ['66', 'Pablo Q.', 'horarios', 6000, 0, 'normal', 'vieja'], // de antes de H1: sin campos nuevos
  ['70', 'Elena W.', 'pedido', 300, 0, 'normal', null],
  ['71', 'Marco E.', 'precios', 410, 5, 'normal', null],
  ['77', 'Silvia Y.', 'delivery', 520, 0, 'normal', null],
  ['79', 'Tito U.', 'horarios', 610, 1, 'normal', null],
  ['81', 'Gabriela I.', 'pedido', 700, 0, 'normal', null],
  ['84', 'Óscar R.', 'tortaGrande', 800, 0, 'normal', null],
  ['88', 'Mónica A.', 'precios', 900, 2, 'normal', null],
  ['90', 'Raúl D.', 'delivery', 980, 0, 'normal', null],
  ['93', 'Karen S.', 'cumple', 1020, 0, 'normal', null],
  ['96', 'Walter B.', 'horarios', 1000, 0, 'normal', 'vieja'], // de antes de H1
  ['99', 'Prueba de escapado', 'escapado', 1500, 0, 'normal', null],
];

// ── El hilo largo: más de 400 mensajes ───────────────────────────────────────
const PRODUCTOS = ['salteñas', 'empanadas de queso', 'pan de maíz', 'torta de chocolate', 'tres leches', 'pan integral', 'cuñapés', 'masitas', 'api con pastel'];
const PREGUNTAS = [
  (p) => `¿Tienen ${p} para hoy?`,
  (p) => `Quiero ${1 + Math.floor(azar() * 6)} de ${p}, por favor`,
  (p) => `¿Cuánto cuestan las ${p}?`,
  (p) => `Necesito ${p} para las ${8 + Math.floor(azar() * 10)}:00`,
  (p) => `¿Me guarda ${p} hasta la tarde?`,
];
const RESPUESTAS = [
  (p) => `Sí, hay ${p} disponibles. ¿Cuántas desea?`,
  (p) => `Anotado: ${p}. Le confirmo el total enseguida.`,
  (p) => `El precio de ${p} es Bs ${5 + Math.floor(azar() * 40)}.`,
  (p) => `Quedan guardadas las ${p}. Puede recogerlas hasta las 19:00.`,
];
function guionLargo() {
  const m = [];
  const total = 430;
  while (m.length < total - 2) {
    const p = elegir(PRODUCTOS);
    const i = m.length;
    // Mensajes con palabras que se buscan en las tareas de prueba. «alfajores» está
    // cerca del comienzo del hilo y «mazamorra» más adentro: ninguno en los
    // últimos 50, para que haya que SALTAR hasta ellos.
    if (i === 36) { m.push(['c', 'Hola, ¿tienen alfajores de maicena? Es para un cumpleaños']); m.push(['a', 'Sí, los alfajores de maicena cuestan Bs 3 la unidad. ¿Cuántos necesita?']); continue; }
    if (i === 118) { m.push(['c', '¿Hay mazamorra de fin de semana?']); m.push(['a', 'Esa la preparamos solo los sábados, hasta agotar.']); continue; }
    if (i === 200 || i === 300) { m.push(['c', 'Comprobante de pago', 'image']); m.push(['a', 'Recibí su comprobante y los datos coinciden con su pedido. El negocio confirmará que el dinero haya llegado.']); continue; }
    m.push(['c', elegir(PREGUNTAS)(p)]);
    m.push(['a', elegir(RESPUESTAS)(p)]);
  }
  return m;
}

// ── Construcción de una conversación ─────────────────────────────────────────
function armar([suf, nombre, guion, minUltimo, sinLeer, atencionEstado, vieja]) {
  const telefono = `591000000${suf}`;
  const base = guion === 'LARGO' ? guionLargo() : GUIONES[guion]();
  const lista = [...base];
  for (let k = 0; k < sinLeer; k++) lista.push(['c', COLA[(Number(suf) + k) % COLA.length]]);

  // Hacia atrás desde el último: entre mensajes 1 a 9 minutos; el hilo largo se
  // reparte en ~3 semanas (cada ~70 min de promedio).
  const fin = AHORA - minUltimo * MIN;
  const horas = new Array(lista.length);
  let t = fin;
  for (let i = lista.length - 1; i >= 0; i--) {
    horas[i] = t;
    const salto = guion === 'LARGO' ? (azar() < 0.8 ? 1 + azar() * 8 : 30 + azar() * 140) : 1 + azar() * 8;
    t -= Math.round(salto * MIN);
  }
  const mensajes = lista.map(([de, texto, tipo], i) => ({
    id: `m${String(i + 1).padStart(4, '0')}`,
    direccion: de === 'c' ? 'entrante' : 'saliente',
    tipo: tipo ?? 'text',
    texto,
    ts: horas[i],
  }));
  const ultimoEntrante = [...mensajes].reverse().find((x) => x.direccion === 'entrante');
  const ultimo = mensajes[mensajes.length - 1];
  // Una conversación «de antes de H1» no trae ninguno de los campos nuevos (los escribe la ingesta desde H1).
  const conversacion = {
    telefono,
    nombreContacto: nombre,
    canal: 'whatsapp',
    ultimoMensaje: ultimo.texto.slice(0, 300),
    ultimoEn: ts(ultimo.ts),
    mensajesTotal: mensajes.length,
    ...(vieja ? {} : {
      telefonoTrozos: trozosDeTelefono(telefono),
      nombrePalabras: palabrasDe(nombre, 6),
      ultimoEntranteEn: ts(ultimoEntrante.ts),
      ventanaVenceEn: ts(ultimoEntrante.ts + 24 * HORA),
      noLeidos: sinLeer,
      sinLeer: sinLeer > 0,
      atencionEstado,
    }),
  };
  return { id: `wa_${telefono}`, suf, nombre, vieja: Boolean(vieja), conversacion, mensajes };
}

// ── Escritura ────────────────────────────────────────────────────────────────
async function usuario({ uid, correo, nombre, rol }) {
  const datos = { email: correo, emailVerified: true, password: CLAVE, displayName: nombre, disabled: false };
  try { await auth.updateUser(uid, datos); } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    await auth.createUser({ uid, ...datos });
  }
  await auth.setCustomUserClaims(uid, { nc: { t: { [TENANT]: rol }, v: 1 } });
  await db.doc(`usuarios/${uid}`).set({ nombre, preferencias: {} });
  await db.doc(`tenants/${TENANT}/miembros/${uid}`).set({ correo, rol, estado: 'activo', desde: ts(AHORA - 30 * 24 * HORA) });
}

async function principal() {
  console.log(`\nSiembra del demo contra los emuladores (proyecto ${PROYECTO})`);
  console.log(`  Firestore ${HOST_FS}\n  Auth      ${HOST_AUTH}\n`);

  await db.recursiveDelete(db.collection(`tenants/${TENANT}/conversaciones`));

  await db.doc(`tenants/${TENANT}`).set({
    nombre: 'Panadería Luna (DEMO)',
    estado: 'activo',
    plan: cuentaInicial().plan,
    vertical: 'venta',
    flujos: ['venta'],
    creadoEn: ts(AHORA - 90 * 24 * HORA),
    // La bandera que enciende la pantalla nueva de Conversaciones (la escribe NovuChat, nunca el comercio).
    consolaConversaciones: 'nueva',
  });
  // Los prefijos de país con los que la búsqueda por teléfono completa lo escrito (`prefijosValidos` en Core).
  await db.doc(`tenants/${TENANT}/config/negocio`).set({ prefijosPermitidos: ['591'] }, { merge: true });
  await db.doc(`tenants/${TENANT}/cuenta/estado`).set({
    ...cuentaInicial(), estadoPago: 'al_dia', montoMensual: 350, moneda: 'BOB',
    proximoVencimiento: ts(AHORA + 18 * 24 * HORA), motivoVisible: '', actualizadoEn: Timestamp.now(),
  });
  for (const u of Object.values(USUARIOS)) await usuario(u);

  const conversaciones = FILAS.map(armar);
  const escritor = db.bulkWriter();
  let docs = 0;
  for (const c of conversaciones) {
    const ref = db.doc(`tenants/${TENANT}/conversaciones/${c.id}`);
    void escritor.set(ref, c.conversacion);
    for (const m of c.mensajes) {
      void escritor.set(ref.collection('mensajes').doc(m.id), {
        direccion: m.direccion, tipo: m.tipo, texto: m.texto, ts: ts(m.ts),
        idMeta: `wamid.ficticio.${c.suf}.${m.id}`,
        ...(c.vieja ? {} : { tenantId: TENANT, ...(palabrasDe(m.texto).length ? { palabras: palabrasDe(m.texto) } : {}) }),
      });
      docs++;
    }
  }
  await escritor.close();

  const nuevas = conversaciones.filter((c) => !c.vieja);
  const sinLeer = nuevas.filter((c) => c.conversacion.noLeidos > 0);
  const horas = (c) => (AHORA - c.conversacion.ultimoEntranteEn.toMillis()) / HORA;
  const porVencer = nuevas.filter((c) => horas(c) < 24 && 24 - horas(c) < 6);
  const cerradas = nuevas.filter((c) => horas(c) >= 24);
  const humano = nuevas.filter((c) => c.conversacion.atencionEstado !== 'normal' && AHORA - c.conversacion.ultimoEn.toMillis() < 24 * HORA);
  const largo = conversaciones.find((c) => c.suf === '12');
  const linea = '='.repeat(74);
  console.log(`${linea}\nLISTO. ${conversaciones.length} conversaciones, ${docs} mensajes (todo ficticio).\n${linea}`);
  console.log(`  Sin leer:           ${sinLeer.length} conversaciones (${sinLeer.map((c) => '…' + c.suf).join(' ')})`);
  console.log(`  Necesita humano:    ${humano.length} (${humano.map((c) => '…' + c.suf).join(' ')})`);
  console.log(`  Ventana por vencer: ${porVencer.length} (${porVencer.map((c) => '…' + c.suf).join(' ')})`);
  console.log(`  Ventana cerrada:    ${cerradas.length}`);
  console.log(`  De antes de H1:     ${conversaciones.filter((c) => c.vieja).map((c) => '…' + c.suf).join(' ')} (sin los campos nuevos)`);
  console.log(`  Hilo largo:         591000000${largo.suf}, ${largo.mensajes.length} mensajes`);
  console.log('  Parecidos:          …47 y …74 (591000000' + '47 / 591000000' + '74)');
  console.log(`\n  Entre con:  ${USUARIOS.admin.correo}   (administrador)`);
  console.log(`              ${USUARIOS.oper.correo}   (operador)`);
  console.log(`  Contraseña: ${CLAVE}\n`);
}

principal().then(
  () => process.exit(0),
  (e) => { console.error('\nFalló la siembra:\n', e); process.exit(1); },
);
