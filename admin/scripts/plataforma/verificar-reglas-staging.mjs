/**
 * VERIFICAR LAS REGLAS DE FIRESTORE Y STORAGE EN STAGING, CON EL SDK DE CLIENTE.
 *
 * PARA QUÉ. Las reglas se prueban en el emulador (`reglas.test.ts`,
 * `storage-reglas.test.ts`), pero lo que decide si un comercio real puede
 * trabajar es el ruleset PUBLICADO en un proyecto de verdad: el `firestore.get()`
 * de Storage, el rol del agente de Storage y las reglas con `tieneModulo` solo se
 * ven ahí. Este script crea UN tenant de prueba con la forma exacta de la ficha
 * de un comercio de venta ya dado de alta (sin `modulos`), otro de agendamiento
 * para las negativas entre comercios, entra como el administrador de cada uno
 * con el SDK de cliente (el mismo camino que la consola) y verifica la matriz.
 *
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging>            # seco
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging> --aplicar  # escribe y verifica
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging> --limpiar  # borra lo de prueba
 *
 *   --api-key <clave web>        la clave pública de la app web de staging; por omisión
 *                                VITE_FIREBASE_API_KEY. No se imprime.
 *   --bucket <nombre>            bucket de Storage; por omisión VITE_FIREBASE_STORAGE_BUCKET
 *                                o <proyecto>.firebasestorage.app
 *   --storage-ruta-propia <p>    ruta de Storage que el comercio de venta SÍ puede escribir y
 *                                leer, con {t} por el tenant (p. ej. la del logo o del
 *                                catálogo que defina H2b-6). Sin ella esas filas salen
 *                                «SIN VERIFICAR» (no cuentan como fallo, pero se dicen).
 *   --fecha <aaaammdd>           fecha del identificador (por omisión, hoy en La Paz)
 *
 * SALVAGUARDA DE PROYECTO. Solo corre contra STAGING: el proyecto tiene que ser
 * el de la lista blanca (variable GCP_PROJECT_ID_STAGING), no puede ser
 * GCP_PROJECT_ID (producción) y su nombre tiene que decir «staging». Contra el
 * emulador, el proyecto tiene que empezar con `demo-` y las variables
 * FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST tienen que estar puestas.
 * Cualquier otra cosa se rechaza, también en seco.
 *
 * LO QUE NUNCA HACE: imprimir un token, una contraseña, una clave o el valor de
 * un documento. Las contraseñas de los usuarios de prueba se generan en memoria
 * y se descartan al terminar. Solo se imprime operación, ruta con marcadores
 * ({propio}/{ajeno}), esperado y obtenido.
 *
 * COSTO. Con --aplicar, escrituras en la nube SOLO en el proyecto de staging:
 * unos 25 documentos (2 fichas y sus config/cuenta/catálogo/funcionarios) y
 * 2 usuarios, más las que hace la propia matriz (se deshacen sola o con
 * --limpiar). 0 mensajes por conversación. Sale con código 1 si algún resultado
 * difiere del esperado, 2 si la salvaguarda o los argumentos fallan.
 */
import { randomBytes } from 'node:crypto';

const PREFIJO = 'zz-verif-reglas-';
const CREADOR = 'verificar-reglas-staging';
// Dominio reservado (.invalid, RFC 2606): ningún correo de prueba puede existir de verdad.
const DOMINIO = ['verif-reglas', 'invalid'].join('.');

// ---------------------------------------------------------------------------
// Argumentos y salvaguarda de proyecto (puras: se importan en la prueba)
// ---------------------------------------------------------------------------

/**
 * ¿Este proyecto es un destino permitido? Devuelve { ok, motivo, emulador }.
 * Pura: recibe el entorno en vez de leer process.env, para probarla negando.
 */
export function comprobarProyecto(proyecto, env = process.env) {
  if (!proyecto || typeof proyecto !== 'string') return { ok: false, motivo: 'falta --proyecto' };
  const emuladorFs = !!env.FIRESTORE_EMULATOR_HOST;
  const emuladorAuth = !!env.FIREBASE_AUTH_EMULATOR_HOST;
  if (proyecto.startsWith('demo-')) {
    if (emuladorFs && emuladorAuth) return { ok: true, emulador: true };
    return {
      ok: false,
      motivo: 'un proyecto demo-* solo se usa contra el emulador (faltan FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST)',
    };
  }
  // Un proyecto real con un emulador a medio configurar es una trampa: el SDK
  // Admin iría al emulador y el de cliente a la nube (o al revés).
  if (emuladorFs || emuladorAuth) {
    return { ok: false, motivo: 'hay variables de emulador puestas y el proyecto no es demo-*: se rechaza por ambiguo' };
  }
  const produccion = env.GCP_PROJECT_ID;
  if (produccion && proyecto === produccion) {
    return { ok: false, motivo: 'es el proyecto de PRODUCCIÓN (GCP_PROJECT_ID)' };
  }
  const blanca = env.GCP_PROJECT_ID_STAGING;
  if (!blanca) {
    return { ok: false, motivo: 'falta GCP_PROJECT_ID_STAGING: la lista blanca de proyectos de staging está vacía' };
  }
  if (proyecto !== blanca) {
    return { ok: false, motivo: 'no es el proyecto de la lista blanca (GCP_PROJECT_ID_STAGING)' };
  }
  if (!/(^|-)staging(-|$)/.test(proyecto)) {
    return { ok: false, motivo: 'el nombre del proyecto no dice «staging»' };
  }
  return { ok: true, emulador: false };
}

/** Identificadores y correos de prueba para una fecha aaaammdd. */
export function nombresDePrueba(fecha) {
  const venta = `${PREFIJO}${fecha}`;
  const agenda = `${PREFIJO}${fecha}-ag`;
  return {
    venta,
    agenda,
    correoVenta: `${venta}-admin@${DOMINIO}`,
    correoAgenda: `${agenda}-admin@${DOMINIO}`,
  };
}

/** La ficha de un comercio de venta ya dado de alta, SIN `modulos`, con valores sintéticos. */
export function fichaDeVenta(creadoEn) {
  return {
    creadoEn,
    creadoPor: CREADOR,
    estado: 'activo',
    flujos: ['venta'],
    nombre: 'Verificación de reglas (venta)',
    plan: 'crecimiento',
    vertical: 'venta',
    waPhoneNumberId: 'zz-sintetico-venta',
    waWabaId: 'zz-sintetico-waba',
  };
}

export function fichaDeAgenda(creadoEn) {
  return {
    creadoEn,
    creadoPor: CREADOR,
    estado: 'activo',
    flujos: ['agendamiento'],
    nombre: 'Verificación de reglas (agenda)',
    plan: 'crecimiento',
    vertical: 'agendamiento',
    waPhoneNumberId: 'zz-sintetico-agenda',
    waWabaId: 'zz-sintetico-waba',
  };
}

// Importado desde una prueba: solo las funciones puras de arriba; nada más se ejecuta.
if (process.argv[1]?.endsWith('verificar-reglas-staging.mjs')) await principal();

// ---------------------------------------------------------------------------
async function principal() {
  const args = process.argv.slice(2);
  const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
  const APLICAR = args.includes('--aplicar');
  const LIMPIAR = args.includes('--limpiar');
  const PROYECTO = opcion('proyecto');

  const salir = (codigo, ...lineas) => {
    for (const l of lineas) console.error(l);
    process.exit(codigo);
  };

  if (APLICAR && LIMPIAR) salir(2, '\n  ✗ --aplicar y --limpiar no se combinan: una cosa por corrida.\n');

  const guarda = comprobarProyecto(PROYECTO);
  if (!guarda.ok) {
    salir(2, `\n  ✗ Proyecto rechazado: ${guarda.motivo}.`,
      '    Este script solo corre contra STAGING (o contra el emulador con un proyecto demo-*).\n');
  }

  const hoyLaPaz = new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const FECHA = opcion('fecha') ?? hoyLaPaz;
  if (!/^[0-9]{8}$/.test(FECHA)) salir(2, '\n  ✗ --fecha tiene que ser aaaammdd.\n');
  const N = nombresDePrueba(FECHA);
  const RUTA_PROPIA = opcion('storage-ruta-propia');
  if (RUTA_PROPIA && (!RUTA_PROPIA.includes('{t}') || RUTA_PROPIA.includes('..'))) {
    salir(2, '\n  ✗ --storage-ruta-propia necesita {t} y no puede llevar «..».\n');
  }

  console.log(`\n  Proyecto   : ${PROYECTO}  (${guarda.emulador ? 'EMULADOR' : 'staging'})`);
  console.log(`  Comercio de venta   : ${N.venta}`);
  console.log(`  Comercio de agenda  : ${N.agenda}`);
  console.log(`  Modo       : ${APLICAR ? 'APLICAR' : LIMPIAR ? 'LIMPIAR' : 'SECO'}\n`);

  if (!APLICAR && !LIMPIAR) {
    console.log('  Plan (con --aplicar):');
    console.log('    1. Sembrar con el SDK Admin: 2 fichas (la de venta con la forma de Q\'Taco, sin `modulos`),');
    console.log('       su config, cuenta/estado, contador de catálogo, un funcionario y su privado.');
    console.log('    2. Crear 2 usuarios de prueba (administrador de cada tenant) con claims nc.t y contraseña');
    console.log('       aleatoria en memoria; correo verificado.');
    console.log('    3. Entrar con el SDK de cliente y verificar la matriz de Firestore y de Storage.');
    console.log('    4. Imprimir solo la tabla de aciertos y fallos; salir con código distinto de 0 si algo difiere.');
    console.log('    Después: --limpiar borra los tenants y usuarios con el prefijo ' + PREFIJO + '.');
    console.log(RUTA_PROPIA
      ? `    Storage: ruta propia indicada (${RUTA_PROPIA}).`
      : '    Storage: sin --storage-ruta-propia, las filas de subir/leer lo propio salen «SIN VERIFICAR».');
    console.log('\n  Seco: no se escribió nada ni se abrió ninguna conexión.\n');
    process.exit(0);
  }

  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const adminApp = initializeApp({ projectId: PROYECTO }, 'verif-admin');
  const db = getFirestore(adminApp);
  const auth = getAuth(adminApp);

  // ---- limpiar ------------------------------------------------------------
  async function limpiar() {
    let tenants = 0; let usuarios = 0;
    const refs = await db.collection('tenants').listDocuments();
    for (const r of refs) {
      if (!r.id.startsWith(PREFIJO)) continue; // JAMÁS algo sin el prefijo
      await db.recursiveDelete(r);
      tenants += 1;
    }
    let token;
    do {
      const pagina = await auth.listUsers(1000, token);
      for (const u of pagina.users) {
        if ((u.email ?? '').startsWith(PREFIJO)) { await auth.deleteUser(u.uid); usuarios += 1; }
      }
      token = pagina.pageToken;
    } while (token);
    return { tenants, usuarios };
  }

  if (LIMPIAR) {
    const r = await limpiar();
    console.log(`  ✓ borrados ${r.tenants} tenants y ${r.usuarios} usuarios de prueba (prefijo ${PREFIJO}).\n`);
    await deleteApp(adminApp);
    process.exit(0);
  }

  // ---- sembrar --------------------------------------------------------------
  await limpiar(); // parte de cero: la matriz es determinista
  const ahora = Timestamp.now();
  const sello = (uid) => ({ actualizadoPor: uid ?? CREADOR, actualizadoEn: ahora });
  const base = (t) => db.doc(`tenants/${t}`);

  await base(N.venta).set(fichaDeVenta(ahora));
  await base(N.agenda).set(fichaDeAgenda(ahora));
  for (const t of [N.venta, N.agenda]) {
    await base(t).collection('cuenta').doc('estado').set({ plan: 'crecimiento', estado: 'activo' });
    await base(t).collection('config').doc('negocio').set({ nombre: 'Verificación', ...sello() });
    await base(t).collection('config').doc('onboarding').set({ rubros: [], ...sello() });
    await base(t).collection('contadores').doc('catalogo').set({ items: 0, ultimoItem: '', actualizadoEn: ahora });
    await base(t).collection('catalogo').doc('base1').set({ nombre: 'Base', activo: true, ...sello() });
    await base(t).collection('fotosCatalogo').doc('base1').set({
      datos: 'data:image/png;base64,iVBORw0KGgo=', ancho: 1, alto: 1, bytes: 12, tipo: 'image/png', ...sello(),
    });
    await base(t).collection('funcionarios').doc('f1').set({ nombre: 'Funcionario', activo: true, ...sello() });
    await base(t).collection('funcionarios').doc('f1').collection('privado').doc('datos')
      .set({ telefono: '70000000', ...sello() });
  }
  await base(N.venta).collection('config').doc('venta').set({ costoDelivery: 0, ...sello() });
  await base(N.venta).collection('config').doc('campanas').set({ lista: [], ...sello() });
  await base(N.agenda).collection('config').doc('agendamiento').set({ duracionDefectoMin: 30, ...sello() });

  // ---- usuarios -------------------------------------------------------------
  async function usuario(correo, tenant) {
    const clave = randomBytes(24).toString('base64url'); // en memoria; nunca se imprime
    const u = await auth.createUser({ email: correo, password: clave, emailVerified: true });
    // Misma forma que functions/src/core/seguridad/claims.ts
    await auth.setCustomUserClaims(u.uid, { nc: { t: { [tenant]: 'admin' }, v: 1 } });
    return { correo, clave, uid: u.uid };
  }
  const uVenta = await usuario(N.correoVenta, N.venta);
  const uAgenda = await usuario(N.correoAgenda, N.agenda);

  // ---- el SDK de cliente ------------------------------------------------------
  const apiKey = opcion('api-key') ?? process.env.VITE_FIREBASE_API_KEY ?? (guarda.emulador ? 'clave-de-emulador' : '');
  if (!apiKey) {
    await limpiar();
    salir(2, '\n  ✗ Falta la clave web de la app de staging (--api-key o VITE_FIREBASE_API_KEY). Se limpió lo sembrado.\n');
  }
  const bucket = opcion('bucket') ?? process.env.VITE_FIREBASE_STORAGE_BUCKET?.replace(/^gs:\/\//, '')
    ?? (guarda.emulador ? `${PROYECTO}.appspot.com` : `${PROYECTO}.firebasestorage.app`);

  const { initializeApp: appCliente, deleteApp: borrarApp } = await import('firebase/app');
  const { getAuth: authCliente, signInWithEmailAndPassword, connectAuthEmulator } = await import('firebase/auth');
  const fsdk = await import('firebase/firestore');
  const ssdk = await import('firebase/storage');
  fsdk.setLogLevel('silent'); // el SDK vuelca el texto de las reglas en cada denegación: ruido, y no se imprime

  async function sesion(nombre, u) {
    const app = appCliente({
      apiKey, projectId: PROYECTO, authDomain: `${PROYECTO}.firebaseapp.com`, storageBucket: bucket,
    }, nombre);
    const a = authCliente(app);
    const dbc = fsdk.getFirestore(app);
    const st = ssdk.getStorage(app);
    if (guarda.emulador) {
      const [hostA, puertoA] = process.env.FIREBASE_AUTH_EMULATOR_HOST.split(':');
      connectAuthEmulator(a, `http://${hostA}:${puertoA}`, { disableWarnings: true });
      const [hostF, puertoF] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
      fsdk.connectFirestoreEmulator(dbc, hostF, Number(puertoF));
      if (process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
        const [hostS, puertoS] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');
        ssdk.connectStorageEmulator(st, hostS, Number(puertoS));
      }
    }
    const cred = await signInWithEmailAndPassword(a, u.correo, u.clave);
    return { app, db: dbc, st, uid: cred.user.uid };
  }
  const sV = await sesion('verif-venta', uVenta);
  const sA = await sesion('verif-agenda', uAgenda);

  // ---- la matriz ----------------------------------------------------------
  const filas = [];
  /** Corre `fn`; 'permitir' si no lanza, 'negar' si lanza permission-denied / unauthorized. */
  async function correr(operacion, ruta, esperado, fn) {
    let obtenido;
    try { await fn(); obtenido = 'permitir'; } catch (e) {
      const c = String(e?.code ?? '');
      obtenido = /permission-denied|unauthorized|unauthenticated/.test(c) ? 'negar' : `error:${c || 'desconocido'}`;
    }
    filas.push({ operacion, ruta, esperado, obtenido, ok: obtenido === esperado });
  }
  const { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } = fsdk;
  const R = (s, t, ...partes) => doc(s.db, 'tenants', t, ...partes);
  const C = (s, t, ...partes) => collection(s.db, 'tenants', t, ...partes);
  const sello2 = (s) => ({ actualizadoPor: s.uid, actualizadoEn: serverTimestamp() });
  const PNG = 'data:image/png;base64,iVBORw0KGgo=';

  // Operaciones de un usuario sobre un tenant: devuelve lista { op, ruta, tipo, fn }
  const lecturas = (s, t) => [
    ['leer', 'config/negocio', () => getDoc(R(s, t, 'config', 'negocio'))],
    ['leer', 'config/venta', () => getDoc(R(s, t, 'config', 'venta'))],
    ['leer', 'config/marca', () => getDoc(R(s, t, 'config', 'marca'))],
    ['leer', 'config/campanas', () => getDoc(R(s, t, 'config', 'campanas'))],
    ['leer', 'config/agendamiento', () => getDoc(R(s, t, 'config', 'agendamiento'))],
    ['leer', 'config/onboarding', () => getDoc(R(s, t, 'config', 'onboarding'))],
    ['listar', 'catalogo', () => getDocs(C(s, t, 'catalogo'))],
    ['listar', 'fotosCatalogo', () => getDocs(C(s, t, 'fotosCatalogo'))],
    ['leer', 'contadores/catalogo', () => getDoc(R(s, t, 'contadores', 'catalogo'))],
    ['leer', 'funcionarios/{f}', () => getDoc(R(s, t, 'funcionarios', 'f1'))],
    ['leer', 'funcionarios/{f}/privado/datos', () => getDoc(R(s, t, 'funcionarios', 'f1', 'privado', 'datos'))],
    ['leer', 'cuenta/estado', () => getDoc(R(s, t, 'cuenta', 'estado'))],
  ];
  const escrituras = (s, t, id) => [
    ['escribir', 'config/venta', () => updateDoc(R(s, t, 'config', 'venta'), { costoDelivery: 5, ...sello2(s) })],
    ['escribir', 'config/marca', () => setDoc(R(s, t, 'config', 'marca'), { logo: PNG, ...sello2(s) })],
    ['escribir', 'config/campanas', () => setDoc(R(s, t, 'config', 'campanas'), {
      lista: [{ id: 'c1', texto: 'x', desde: '2030-01-01', hasta: '2030-01-02' }], ...sello2(s),
    })],
    ['escribir', 'catalogo + contadores/catalogo (lote, alta)', () => {
      const b = writeBatch(s.db);
      b.set(R(s, t, 'catalogo', id), { nombre: 'Prueba', activo: true, precio: 1, ...sello2(s) });
      b.update(R(s, t, 'contadores', 'catalogo'), { items: 1, ultimoItem: id, actualizadoEn: serverTimestamp() });
      return b.commit();
    }],
    ['escribir', 'fotosCatalogo', () => setDoc(R(s, t, 'fotosCatalogo', id), {
      datos: PNG, ancho: 1, alto: 1, bytes: 12, tipo: 'image/png', ...sello2(s),
    })],
    ['escribir', 'config/onboarding', () => updateDoc(R(s, t, 'config', 'onboarding'), { rubros: [], ...sello2(s) })],
    ['escribir', 'funcionarios/{f}', () => setDoc(R(s, t, 'funcionarios', 'f1'), { nombre: 'X', activo: true, ...sello2(s) })],
    ['escribir', 'funcionarios/{f}/privado/datos', () => setDoc(R(s, t, 'funcionarios', 'f1', 'privado', 'datos'), {
      telefono: '70000001', ...sello2(s),
    })],
  ];
  const limpiezaVenta = async (s, t, id) => {
    // Deshace la alta de la matriz (con las mismas reglas): baja contada y foto.
    const b = writeBatch(s.db);
    b.delete(R(s, t, 'catalogo', id));
    b.update(R(s, t, 'contadores', 'catalogo'), { items: 0, ultimoItem: id, actualizadoEn: serverTimestamp() });
    await b.commit();
    await deleteDoc(R(s, t, 'fotosCatalogo', id));
  };

  // 1. El admin de venta en SU tenant: lo de venta se permite; onboarding y privado de funcionarios, no.
  const PROPIO_VENTA_NEGADO = new Set(['config/onboarding', 'funcionarios/{f}', 'funcionarios/{f}/privado/datos']);
  for (const [op, ruta, fn] of lecturas(sV, N.venta)) {
    await correr(`venta→propio ${op}`, `{propio}/${ruta}`, 'permitir', fn);
  }
  for (const [op, ruta, fn] of escrituras(sV, N.venta, 'verif1')) {
    const esperado = PROPIO_VENTA_NEGADO.has(ruta) ? 'negar' : 'permitir';
    await correr(`venta→propio ${op}`, `{propio}/${ruta}`, esperado, fn);
  }
  try { await limpiezaVenta(sV, N.venta, 'verif1'); } catch { /* si el alta falló no hay nada que deshacer */ }

  // 2. El admin de venta en el tenant de agenda: NADA.
  for (const [op, ruta, fn] of lecturas(sV, N.agenda)) {
    await correr(`venta→ajeno ${op}`, `{ajeno}/${ruta}`, 'negar', fn);
  }
  for (const [op, ruta, fn] of escrituras(sV, N.agenda, 'verif2')) {
    await correr(`venta→ajeno ${op}`, `{ajeno}/${ruta}`, 'negar', fn);
  }

  // 3. El admin de agenda en el tenant de venta: NADA. Y control positivo en el suyo.
  for (const [op, ruta, fn] of lecturas(sA, N.venta)) {
    await correr(`agenda→ajeno ${op}`, `{ajeno}/${ruta}`, 'negar', fn);
  }
  for (const [op, ruta, fn] of escrituras(sA, N.venta, 'verif3')) {
    await correr(`agenda→ajeno ${op}`, `{ajeno}/${ruta}`, 'negar', fn);
  }
  await correr('agenda→propio leer', '{propio}/config/agendamiento', 'permitir',
    () => getDoc(R(sA, N.agenda, 'config', 'agendamiento')));
  await correr('agenda→propio escribir', '{propio}/funcionarios/{f}/privado/datos', 'permitir',
    () => setDoc(R(sA, N.agenda, 'funcionarios', 'f1', 'privado', 'datos'), { telefono: '70000002', ...sello2(sA) }));

  // 4. Storage.
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const rutaDe = (plantilla, t) => plantilla.replace('{t}', t);
  const captacion = (t) => `tenants/${t}/captacion/planes.pdf`;
  const subir = (s, ruta, tipo) => ssdk.uploadBytes(ssdk.ref(s.st, ruta), bytes, { contentType: tipo });
  const leer = (s, ruta) => ssdk.getMetadata(ssdk.ref(s.st, ruta));
  if (RUTA_PROPIA) {
    const tipo = RUTA_PROPIA.endsWith('.pdf') ? 'application/pdf' : RUTA_PROPIA.endsWith('.png') ? 'image/png' : 'image/jpeg';
    await correr('storage venta→propio subir', RUTA_PROPIA.replace('{t}', '{propio}'), 'permitir',
      () => subir(sV, rutaDe(RUTA_PROPIA, N.venta), tipo));
    await correr('storage venta→propio leer', RUTA_PROPIA.replace('{t}', '{propio}'), 'permitir',
      () => leer(sV, rutaDe(RUTA_PROPIA, N.venta)));
    await correr('storage venta→ajeno subir', RUTA_PROPIA.replace('{t}', '{ajeno}'), 'negar',
      () => subir(sV, rutaDe(RUTA_PROPIA, N.agenda), tipo));
    await correr('storage venta→ajeno leer', RUTA_PROPIA.replace('{t}', '{ajeno}'), 'negar',
      () => leer(sV, rutaDe(RUTA_PROPIA, N.agenda)));
    await correr('storage agenda→ajeno subir', RUTA_PROPIA.replace('{t}', '{ajeno}'), 'negar',
      () => subir(sA, rutaDe(RUTA_PROPIA, N.venta), tipo));
    await correr('storage agenda→ajeno leer', RUTA_PROPIA.replace('{t}', '{ajeno}'), 'negar',
      () => leer(sA, rutaDe(RUTA_PROPIA, N.venta)));
  } else {
    filas.push({ operacion: 'storage venta→propio subir/leer', ruta: '(sin --storage-ruta-propia)',
      esperado: 'permitir', obtenido: 'SIN VERIFICAR', ok: true, sinVerificar: true });
  }
  // Lo que ya se sabe, con la ruta de la captación (el único camino de storage.rules hoy):
  // ningún comercio sin el flujo de captación escribe ahí, y nadie cruza de comercio.
  await correr('storage venta→propio subir (sin flujo captación)', '{propio}/captacion/planes.pdf', 'negar',
    () => subir(sV, captacion(N.venta), 'application/pdf'));
  await correr('storage venta→ajeno subir', '{ajeno}/captacion/planes.pdf', 'negar',
    () => subir(sV, captacion(N.agenda), 'application/pdf'));
  await correr('storage venta→ajeno leer', '{ajeno}/captacion/planes.pdf', 'negar',
    () => leer(sV, captacion(N.agenda)));
  await correr('storage agenda→ajeno subir', '{ajeno}/captacion/planes.pdf', 'negar',
    () => subir(sA, captacion(N.venta), 'application/pdf'));
  await correr('storage agenda→ajeno leer', '{ajeno}/captacion/planes.pdf', 'negar',
    () => leer(sA, captacion(N.venta)));

  // ---- el informe: solo operación, ruta con marcadores, esperado y obtenido ---------
  const ancho = (k) => Math.max(...filas.map((f) => String(f[k]).length), k.length);
  const w = { operacion: ancho('operacion'), ruta: ancho('ruta'), esperado: 9, obtenido: ancho('obtenido') };
  const linea = (f, marca) => `  ${marca} ${String(f.operacion).padEnd(w.operacion)}  ${String(f.ruta).padEnd(w.ruta)}  ${String(f.esperado).padEnd(w.esperado)}  ${f.obtenido}`;
  console.log(`  ${' '} ${'operación'.padEnd(w.operacion)}  ${'ruta'.padEnd(w.ruta)}  ${'esperado'.padEnd(w.esperado)}  obtenido`);
  for (const f of filas) console.log(linea(f, f.sinVerificar ? '?' : f.ok ? '✓' : '✗'));
  const fallos = filas.filter((f) => !f.ok);
  const sinVerificar = filas.filter((f) => f.sinVerificar);
  const aciertos = filas.length - fallos.length - sinVerificar.length;
  console.log(`\n  Resumen: ${aciertos} aciertos, ${fallos.length} fallos, ${sinVerificar.length} sin verificar, de ${filas.length} filas.`);
  if (sinVerificar.length) console.log('  Hay filas SIN VERIFICAR: indique --storage-ruta-propia para cerrarlas.');
  console.log('  Lo sembrado queda en el proyecto: --limpiar lo borra (prefijo ' + PREFIJO + ').\n');

  await borrarApp(sV.app); await borrarApp(sA.app); await deleteApp(adminApp);
  process.exit(fallos.length ? 1 : 0);
}
