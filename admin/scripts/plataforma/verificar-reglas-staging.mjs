/**
 * VERIFICAR LAS REGLAS DE FIRESTORE Y STORAGE EN STAGING, CON EL SDK DE CLIENTE.
 *
 * PARA QUÉ. Las reglas se prueban en el emulador (`reglas.test.ts`,
 * `storage-reglas.test.ts`), pero lo que decide si un comercio real puede
 * trabajar es el ruleset PUBLICADO en un proyecto de verdad: el `firestore.get()`
 * de Storage, el rol del agente de Storage y la lógica de capacidades por `flujos` solo se
 * ven ahí (no se ejercita `tieneModulo` con módulos presentes: ver LIMITACIONES). Este script crea UN tenant de prueba con la forma exacta de la ficha
 * de un comercio de venta ya dado de alta (sin `modulos`), otro de agendamiento
 * para las negativas entre comercios, entra como el administrador de cada uno
 * con el SDK de cliente (el mismo camino que la consola) y verifica la matriz.
 *
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging>            # seco
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging> --aplicar  # escribe y verifica
 *   node scripts/plataforma/verificar-reglas-staging.mjs --proyecto <staging> --limpiar  # borra lo de prueba
 *
 * La clave web de la app de staging va por la variable VITE_FIREBASE_API_KEY (es pública
 * por diseño, pero no se imprime). `--api-key` existe y se desaconseja: queda en `ps` y en
 * el historial del intérprete.
 *
 *   --bucket <nombre>            bucket de Storage; por omisión VITE_FIREBASE_STORAGE_BUCKET
 *                                o <proyecto>.firebasestorage.app. Contra la nube TIENE que ser
 *                                <proyecto>.firebasestorage.app o <proyecto>.appspot.com: nunca
 *                                el de otro proyecto (producción).
 *   --conservar                  no limpia al terminar (por omisión, SIEMPRE se limpia, también
 *                                si algo falla a la mitad); sirve para mirar lo sembrado
 *   --storage-ruta-propia <p>    EXTRA, opcional: otra ruta de Storage (empieza por tenants/{t}/) que
 *                                el comercio de venta puede escribir y leer. Hoy `storage.rules` solo
 *                                tiene el camino de captación y #422 no le da ninguno al comercio de
 *                                venta: esta opción NO es lo que cierra el control positivo de
 *                                Storage, que corre siempre con el comercio de agenda (que sí tiene
 *                                captación). Añade 6 filas.
 *   --fecha <aaaammdd>           fecha del identificador (por omisión, hoy en La Paz)
 *
 * CONDICIONES DE EJECUCIÓN (contra staging):
 *   · Credenciales que SOLO tengan acceso a staging. Nunca el ADC de producción: la
 *     salvaguarda compara nombres, no permisos.
 *   · Variables (las de GitHub): GCP_PROJECT_ID_STAGING (lista blanca) y
 *     GCP_PROJECT_ID_PROD (producción; obligatoria: si falta o está vacía, se rechaza).
 *     GCP_PROJECT_ID es el proyecto de DEMOS y FIREBASE_PROJECT_ID también se comparan.
 *   · Seco, luego --aplicar y luego (si usó --conservar) --limpiar, en la misma sesión.
 *
 * SALVAGUARDA DE PROYECTO. Solo corre contra STAGING: el proyecto tiene que ser
 * el de la lista blanca (GCP_PROJECT_ID_STAGING), no puede ser ninguno de
 * GCP_PROJECT_ID_PROD, FIREBASE_PROJECT_ID ni GCP_PROJECT_ID, y su nombre tiene que
 * contener «staging». Contra la nube, el bucket tiene que ser del mismo proyecto y,
 * al iniciar sesión, el `aud` del token tiene que ser el proyecto. Contra el
 * emulador, el proyecto tiene que empezar con `demo-`, las variables
 * FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST y FIREBASE_STORAGE_EMULATOR_HOST tienen
 * que estar puestas, y el bucket es siempre <proyecto>.appspot.com (se ignora --bucket).
 * Cualquier otra cosa se rechaza (salida 2), también en seco. El id del proyecto real
 * nunca se imprime (el repositorio es público).
 *
 * LO QUE NUNCA HACE: imprimir un token, una contraseña, una clave o el valor de
 * un documento. Las contraseñas de los usuarios de prueba se generan en memoria
 * y se descartan al terminar. Solo se imprime operación, ruta con marcadores
 * ({propio}/{ajeno}), esperado y obtenido.
 *
 * COSTO. Con --aplicar, escrituras en la nube SOLO en el proyecto de staging:
 * unos 25 documentos (2 fichas y sus config/cuenta/catálogo/funcionarios) y
 * 2 usuarios, más las que hace la propia matriz (se deshacen sola o con
 * --limpiar). 0 mensajes por conversación.
 *
 * LIMITACIONES CONOCIDAS (dichas, no escondidas):
 *   · Las fichas NO llevan `modulos`: solo se ejercita el respaldo por `flujos` que tienen
 *     las reglas de #422. La única fila que distingue las reglas de main de las de #422 es
 *     el privado de funcionarios del comercio de venta.
 *   · La siembra dispara en staging `registrarCambioConfig` (escribe `bitacora/*` dentro del
 *     tenant de prueba, a veces DESPUÉS de borrarlo: la limpieza barre esos huérfanos con
 *     id de prueba y espera unos segundos antes de la limpieza final). Los demás
 *     disparadores (`verificarComportamiento`, `verificarCampanas`, `comprobarImagenDelCatalogo`)
 *     salen sin trabajar con estos datos.
 *   · Si la matriz falla (1) y además la limpieza falla, el código sigue siendo 1 y se
 *     imprime el aviso «corra --limpiar».
 *   · El tope de 20 s (`error:timeout`, cuenta como fallo) cubre SOLO las operaciones de la
 *     matriz: no la siembra, el inicio de sesión ni la limpieza (esas se cortan con Ctrl-C).
 *   · Si falla el borrado en Storage de un tenant de prueba, NO se borra su árbol de Firestore:
 *     el id queda como ancla y la siguiente corrida (o --limpiar) lo reintenta.
 *
 * SALIDA: 0 todo como se esperaba; 1 la matriz difiere de lo esperado; 2 salvaguarda o
 * argumentos; 3 error inesperado: la siembra o la matriz no terminaron, o la matriz pasó y
 * FALLÓ la limpieza final (igual se limpia siempre que se puede); 130 interrumpido con Ctrl-C
 * (la limpieza la hace el cierre normal; un segundo Ctrl-C sale ya).
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
export function comprobarProyecto(proyectoCrudo, env = process.env) {
  if (!proyectoCrudo || typeof proyectoCrudo !== 'string') return { ok: false, motivo: 'falta --proyecto' };
  const proyecto = proyectoCrudo.trim();
  // Un espacio o un salto de línea de más en una variable no puede esquivar la comparación.
  const v = (k) => (typeof env[k] === 'string' ? env[k].trim() : '');
  const emuladorFs = !!v('FIRESTORE_EMULATOR_HOST');
  const emuladorAuth = !!v('FIREBASE_AUTH_EMULATOR_HOST');
  const emuladorSt = !!v('FIREBASE_STORAGE_EMULATOR_HOST');
  // Para el rechazo por ambigüedad basta que la variable EXISTA, aunque esté en blanco.
  const hayEmulador = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST', 'STORAGE_EMULATOR_HOST'].some((k) => env[k] !== undefined);
  if (proyecto.startsWith('demo-')) {
    if (emuladorFs && emuladorAuth && emuladorSt) return { ok: true, emulador: true };
    return {
      ok: false,
      motivo: 'un proyecto demo-* solo se usa contra el emulador (faltan FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST o FIREBASE_STORAGE_EMULATOR_HOST)',
    };
  }
  // Un proyecto real con un emulador a medio configurar es una trampa: el SDK
  // Admin iría al emulador y el de cliente a la nube (o al revés).
  if (hayEmulador) {
    return { ok: false, motivo: 'hay variables de emulador puestas y el proyecto no es demo-*: se rechaza por ambiguo' };
  }
  // GCP_PROJECT_ID es el proyecto de DEMOS; el de producción es GCP_PROJECT_ID_PROD, y sin
  // él no hay contra qué comparar: se rechaza en vez de confiar solo en el nombre.
  if (!v('GCP_PROJECT_ID_PROD')) {
    return { ok: false, motivo: 'falta GCP_PROJECT_ID_PROD: sin el proyecto de producción no se puede descartar' };
  }
  for (const k of ['GCP_PROJECT_ID_PROD', 'FIREBASE_PROJECT_ID', 'GCP_PROJECT_ID']) {
    if (v(k) && proyecto === v(k)) {
      return { ok: false, motivo: `coincide con ${k} (producción o demos)` };
    }
  }
  const blanca = v('GCP_PROJECT_ID_STAGING');
  if (!blanca) {
    return { ok: false, motivo: 'falta GCP_PROJECT_ID_STAGING: la lista blanca de proyectos de staging está vacía' };
  }
  if (proyecto !== blanca) {
    return { ok: false, motivo: 'no es el proyecto de la lista blanca (GCP_PROJECT_ID_STAGING)' };
  }
  if (!/staging/i.test(proyecto)) {
    return { ok: false, motivo: 'el nombre del proyecto no dice «staging»' };
  }
  return { ok: true, emulador: false };
}

/**
 * El bucket de Storage tiene que ser de ESTE proyecto (el CI controla las variables de
 * Hosting; esto controla las del operador). Contra el emulador vale cualquiera.
 */
export function comprobarBucket(proyecto, bucket, emulador) {
  if (emulador) return { ok: true };
  const validos = [`${proyecto}.firebasestorage.app`, `${proyecto}.appspot.com`];
  return validos.includes(bucket)
    ? { ok: true }
    : { ok: false, motivo: 'el bucket no es del proyecto (tiene que ser <proyecto>.firebasestorage.app o <proyecto>.appspot.com)' };
}

/** ¿Es un usuario de prueba? Prefijo Y dominio reservado: nada que no creó este script. */
export function esUsuarioDePrueba(correo) {
  return typeof correo === 'string' && correo.startsWith(PREFIJO) && correo.endsWith(`@${DOMINIO}`);
}

/** La forma EXACTA de los ids de esta prueba: prefijo + fecha de 8 dígitos + «-ag» opcional. */
const ID_PRUEBA = /^zz-verif-reglas-[0-9]{8}(-ag)?$/;

/** ¿Es un tenant de prueba? La forma exacta del id Y la marca de quien lo sembró en la ficha. */
export function esTenantDePrueba(id, ficha) {
  return typeof id === 'string' && ID_PRUEBA.test(id) && ficha?.creadoPor === CREADOR;
}

/** ¿Es un objeto de Storage de un tenant de prueba? Mismo regex, sobre el segundo segmento. */
export function esObjetoDePrueba(nombre) {
  if (typeof nombre !== 'string') return false;
  const [raiz, tenant, ...resto] = nombre.split('/');
  return raiz === 'tenants' && ID_PRUEBA.test(tenant ?? '') && resto.join('/') !== '';
}

/**
 * Un documento que NO existe pero cuyo id tiene la forma exacta de los de esta prueba
 * (prefijo + fecha de 8 dígitos + «-ag» opcional): es un padre huérfano, con subcolecciones
 * que un disparador (`registrarCambioConfig`) escribió después de borrar el tenant.
 */
export function esHuerfanoDePrueba(id, existe) {
  return existe === false && typeof id === 'string' && ID_PRUEBA.test(id);
}

/**
 * Fase 1 de la limpieza: decide qué tenants son de prueba y borra SOLO su ficha (el documento
 * `tenants/{id}`), que es lo que corta de verdad el acceso de una sesión viva (un ID token vive
 * hasta una hora; las reglas leen la ficha en cada operación). Devuelve los ids a seguir
 * limpiando. `d`: { ids, leer(id) -> {existe, data}, borrarFicha(id) }.
 */
export async function marcarFichas(d) {
  const candidatos = [];
  for (const id of d.ids) {
    if (!id.startsWith(PREFIJO)) continue; // ni se lee lo que no lleva el prefijo
    const { existe, data } = await d.leer(id);
    if (!esTenantDePrueba(id, data) && !esHuerfanoDePrueba(id, existe)) continue; // JAMÁS lo demás
    if (existe) await d.borrarFicha(id);
    candidatos.push(id);
  }
  return candidatos;
}

/**
 * Fase 3: sus objetos de Storage y después el árbol de Firestore. Si el borrado en Storage
 * falla (salvo 404), NO se borra el árbol: sin el id como ancla, la siguiente corrida ya no
 * encontraría el objeto. `d`: { borrarObjetos(id), borrarArbol(id) }.
 */
export async function borrarTenants(d, candidatos) {
  let borrados = 0; let falloStorage = null;
  for (const id of candidatos) {
    try {
      await d.borrarObjetos(id);
    } catch (e) {
      if (e?.code !== 404) { falloStorage = e; continue; } // conserva el ancla; se reintenta
    }
    await d.borrarArbol(id);
    borrados += 1;
  }
  return { borrados, falloStorage };
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
    // Con captación a propósito: es el comercio que SÍ tiene la capacidad de `config/onboarding`
    // y del camino de Storage, y así las negativas del comercio de venta (sin esa capacidad)
    // se contrastan con un positivo real y no pueden pasar por una denegación general.
    flujos: ['agendamiento', 'onboarding'],
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
  const CONSERVAR = args.includes('--conservar');
  const PROYECTO = (opcion('proyecto') ?? '').trim();

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
  if (RUTA_PROPIA && (!RUTA_PROPIA.startsWith('tenants/{t}/') || RUTA_PROPIA.includes('..'))) {
    // Bajo tenants/<id>/ para que la limpieza la alcance; sin «..» para que no salga de ahí.
    salir(2, '\n  ✗ --storage-ruta-propia tiene que empezar por tenants/{t}/ y no puede llevar «..».\n');
  }

  // Bucket y clave, ANTES de cualquier import o escritura.
  // Contra el emulador el bucket es SIEMPRE el del proyecto demo: ni --bucket ni VITE_* lo cambian.
  const bucket = guarda.emulador
    ? `${PROYECTO}.appspot.com`
    : (opcion('bucket') ?? process.env.VITE_FIREBASE_STORAGE_BUCKET ?? `${PROYECTO}.firebasestorage.app`)
      .trim().replace(/^gs:\/\//, '');
  const cb = comprobarBucket(PROYECTO, bucket, guarda.emulador);
  if (!cb.ok) salir(2, `\n  ✗ Bucket rechazado: ${cb.motivo}.\n`);
  if (args.includes('--api-key')) {
    console.error('  ! --api-key queda en el historial y en `ps`: use la variable VITE_FIREBASE_API_KEY.');
  }
  const apiKey = (opcion('api-key') ?? process.env.VITE_FIREBASE_API_KEY ?? (guarda.emulador ? 'clave-de-emulador' : '')).trim();
  if ((APLICAR) && !apiKey) {
    salir(2, '\n  ✗ Falta la clave web de la app de staging (variable VITE_FIREBASE_API_KEY).\n');
  }

  // El id del proyecto real NO se imprime: el repositorio es público y el CI lo enmascara.
  console.log(`\n  Proyecto   : ${guarda.emulador ? `EMULADOR (${PROYECTO})` : 'staging (lista blanca)'}`);
  console.log(`  Comercio de venta   : ${N.venta}`);
  console.log(`  Comercio de agenda  : ${N.agenda}`);
  console.log(`  Modo       : ${APLICAR ? 'APLICAR' : LIMPIAR ? 'LIMPIAR' : 'SECO'}\n`);

  if (!APLICAR && !LIMPIAR) {
    console.log('  Plan (con --aplicar):');
    console.log('    1. Sembrar con el SDK Admin: 2 fichas (la de venta con la forma de Q\'Taco, sin `modulos`; la de');
    console.log('       agenda CON captación), su config, cuenta/estado, contador de catálogo, un funcionario y su privado.');
    console.log('    2. Crear 2 usuarios de prueba (administrador de cada tenant) con claims nc.t y contraseña');
    console.log('       aleatoria en memoria; correo verificado.');
    console.log('    3. Entrar con el SDK de cliente y verificar la matriz de Firestore y de Storage.');
    console.log('    4. Imprimir solo la tabla de aciertos y fallos; salir con código distinto de 0 si algo difiere.');
    console.log('    5. Limpiar siempre al terminar (también si algo falla), salvo --conservar; entonces --limpiar.');
    console.log('       Solo se borra lo que lleva el prefijo ' + PREFIJO + ', el dominio reservado y la marca de este script.');
    console.log('    Storage: control positivo con el comercio de agenda (captación): subir y leer lo propio, y negado en lo ajeno.');
    if (RUTA_PROPIA) console.log('    Storage extra: ruta propia del comercio de venta indicada.');
    console.log('\n  Seco: no se escribió nada ni se abrió ninguna conexión.\n');
    process.exit(0);
  }

  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const { getAuth } = await import('firebase-admin/auth');
  const { getStorage } = await import('firebase-admin/storage');
  const adminApp = initializeApp({ projectId: PROYECTO, storageBucket: bucket }, 'verif-admin');
  const db = getFirestore(adminApp);
  const auth = getAuth(adminApp);
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Tope de tiempo: una operación colgada no cuelga el script. */
  const conTope = (promesa, ms) => {
    let t;
    return Promise.race([
      promesa,
      new Promise((_, rechazar) => { t = setTimeout(() => rechazar(Object.assign(new Error('timeout'), { code: 'timeout' })), ms); }),
    ]).finally(() => clearTimeout(t));
  };

  // ---- limpiar ------------------------------------------------------------
  async function limpiar() {
    let usuarios = 0;
    const bucketAdmin = () => getStorage(adminApp).bucket(bucket);
    // 1. LAS FICHAS primero: es lo que corta de verdad a una sesión viva (un ID token vive hasta
    //    una hora, pero las reglas leen la ficha en cada operación). Solo el documento.
    const refs = await db.collection('tenants').listDocuments();
    const porId = new Map(refs.map((r) => [r.id, r]));
    const candidatos = await marcarFichas({
      ids: [...porId.keys()],
      leer: async (id) => { const snap = await porId.get(id).get(); return { existe: snap.exists, data: snap.data() }; },
      borrarFicha: (id) => porId.get(id).delete(),
    });
    // 2. Los usuarios.
    let token;
    do {
      const pagina = await auth.listUsers(1000, token);
      for (const u of pagina.users) {
        if (esUsuarioDePrueba(u.email)) { await auth.deleteUser(u.uid); usuarios += 1; }
      }
      token = pagina.pageToken;
    } while (token);
    // 3. Sus objetos de Storage y el árbol de Firestore (padres huérfanos incluidos); si Storage
    //    falla para un tenant, se conserva su ancla.
    const { borrados, falloStorage: f1 } = await borrarTenants({
      borrarObjetos: (id) => bucketAdmin().deleteFiles({ prefix: `tenants/${id}/`, force: true }),
      borrarArbol: (id) => db.recursiveDelete(porId.get(id)),
    }, candidatos);
    // 4. Barrido de objetos con id de prueba aunque su tenant ya no exista (mismo regex).
    let f2 = null;
    try {
      const [archivos] = await bucketAdmin().getFiles({ prefix: `tenants/${PREFIJO}` });
      for (const f of archivos) if (esObjetoDePrueba(f.name)) await f.delete();
    } catch (e) {
      if (e?.code !== 404) f2 = e;
    }
    const falloStorage = f1 ?? f2;
    if (falloStorage) {
      // El aviso dice qué hacer: el ancla quedó, así que basta repetir.
      throw Object.assign(new Error('storage'), { code: `storage:${falloStorage.code ?? falloStorage.name ?? 'desconocido'} (los objetos de Storage no se borraron; el tenant sigue como ancla: repita --limpiar)` });
    }
    return { tenants: borrados, usuarios };
  }

  if (LIMPIAR) {
    let codigoL = 0;
    try {
      const r = await limpiar();
      console.log(`  ✓ borrados ${r.tenants} tenants y ${r.usuarios} usuarios de prueba.\n`);
    } catch (e) {
      codigoL = 3; // solo el código: el mensaje del SDK puede traer rutas o valores
      console.error(`  ✗ La limpieza falló (${e?.code ?? e?.name ?? 'desconocido'}): corra --limpiar otra vez.\n`);
    }
    try { await deleteApp(adminApp); } catch (e) {
      codigoL = codigoL || 3;
      console.error(`  ✗ El cierre falló (${e?.code ?? e?.name ?? 'desconocido'}).\n`);
    }
    process.exit(codigoL);
  }

  let codigo = 0;
  let sV; let sA; let fsdk; let borrarApp; // fuera del try: el cierre tiene que alcanzarlos
  // Ctrl-C: SOLO marca la bandera. La siembra y `correr` la consultan antes de cada operación y el
  // cierre normal (el `finally`) hace la limpieza. Un segundo Ctrl-C, o 60 s, sale ya.
  let interrumpido = false;
  const alto = () => {
    if (interrumpido) throw Object.assign(new Error('interrumpido'), { codigoSalida: 130, mensaje: 'Interrumpido por el operador.' });
  };
  process.on('SIGINT', () => {
    if (interrumpido) { console.error('\n  ! Segundo Ctrl-C: se sale ya. Corra --limpiar.'); process.exit(130); }
    interrumpido = true;
    console.error('\n  ! Interrumpido: se termina la operación en curso y se limpia. Un segundo Ctrl-C sale ya.');
    setTimeout(() => { console.error('  ! La limpieza no terminó en 60 s: corra --limpiar.'); process.exit(130); }, 60000);
  });
  try {
    // ---- sembrar --------------------------------------------------------------
    alto();
    const previa = await limpiar(); // parte de cero: la matriz es determinista
    console.log(`  Limpieza previa: ${previa.tenants} tenants y ${previa.usuarios} usuarios de prueba borrados.\n`);
    const ahora = Timestamp.now();
    const sello = (uid) => ({ actualizadoPor: uid ?? CREADOR, actualizadoEn: ahora });
    const base = (t) => db.doc(`tenants/${t}`);

    alto();
    await base(N.venta).set(fichaDeVenta(ahora));
    await base(N.agenda).set(fichaDeAgenda(ahora));
    for (const t of [N.venta, N.agenda]) {
      alto();
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
    alto();
    const uVenta = await usuario(N.correoVenta, N.venta);
    const uAgenda = await usuario(N.correoAgenda, N.agenda);

    // ---- el SDK de cliente ------------------------------------------------------
    const { initializeApp: appCliente, deleteApp: borrarAppCliente } = await import('firebase/app');
    borrarApp = borrarAppCliente;
    const { getAuth: authCliente, signInWithEmailAndPassword, connectAuthEmulator } = await import('firebase/auth');
    fsdk = await import('firebase/firestore');
    const ssdk = await import('firebase/storage');
    fsdk.setLogLevel('silent'); // el SDK vuelca el texto de las reglas en cada denegación: ruido, y no se imprime

    async function sesion(nombre, u) {
      const app = appCliente({
        apiKey, projectId: PROYECTO, authDomain: `${PROYECTO}.firebaseapp.com`, storageBucket: bucket,
      }, nombre);
      const a = authCliente(app);
      const dbc = fsdk.getFirestore(app);
      const st = ssdk.getStorage(app);
      st.maxUploadRetryTime = 10000; // sin reintentos eternos: el tope por operación es de 20 s
      st.maxOperationRetryTime = 10000;
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
      // El token tiene que ser de ESTE proyecto: si la clave web fuera de otro, se corta aquí.
      if ((await cred.user.getIdTokenResult()).claims.aud !== PROYECTO) {
        throw Object.assign(new Error('aud'), { codigoSalida: 2, mensaje: 'el token no es del proyecto indicado (¿clave web de otro proyecto?)' });
      }
      return { app, db: dbc, st, uid: cred.user.uid };
    }
    alto();
    sV = await sesion('verif-venta', uVenta);
    sA = await sesion('verif-agenda', uAgenda);

    // ---- la matriz ----------------------------------------------------------
    const filas = [];
    /** Corre `fn` (tope 20 s: `error:timeout`); 'permitir' si no lanza, 'negar' si lanza permission-denied / unauthorized. */
    async function correr(operacion, ruta, esperado, fn) {
      alto(); // fuera del try de abajo: una interrupción corta la matriz, no cuenta como fila
      let obtenido;
      try { await conTope((async () => fn())(), 20000); obtenido = 'permitir'; } catch (e) {
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
    // Controles positivos de lo que el comercio de venta NO puede: el comercio de agenda (con la
    // capacidad) sí. Sin ellos, «venta→propio negar» no distingue «sin capacidad» de «todo negado».
    await correr('agenda→propio escribir', '{propio}/config/onboarding', 'permitir',
      () => updateDoc(R(sA, N.agenda, 'config', 'onboarding'), { rubros: [], ...sello2(sA) }));
    await correr('agenda→propio escribir', '{propio}/funcionarios/{f}', 'permitir',
      () => setDoc(R(sA, N.agenda, 'funcionarios', 'f1'), { nombre: 'Y', activo: true, ...sello2(sA) }));

    // 4. Storage. El comercio de agenda tiene captación: su subida y su lectura son el control
    //    positivo que ejercita `firestore.get()` desde Storage y el rol del agente de Storage. Si
    //    Storage negara todo, esta fila falla y la corrida sale 1.
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const captacion = (t) => `tenants/${t}/captacion/planes.pdf`;
    const subir = (s, ruta, tipo) => ssdk.uploadBytes(ssdk.ref(s.st, ruta), bytes, { contentType: tipo });
    const leer = (s, ruta) => ssdk.getMetadata(ssdk.ref(s.st, ruta));
    await correr('storage agenda→propio subir', 'tenants/{propio}/captacion/planes.pdf', 'permitir',
      () => subir(sA, captacion(N.agenda), 'application/pdf'));
    await correr('storage agenda→propio leer', 'tenants/{propio}/captacion/planes.pdf', 'permitir',
      () => leer(sA, captacion(N.agenda)));
    // Las negativas ENTRE COMERCIOS las sostienen las filas venta→ajeno: el ajeno (agenda) SÍ tiene
    // la capacidad y el objeto EXISTE, así que solo puede negar por ser de otro comercio. Las filas
    // agenda→ajeno niegan por dos causas a la vez (otro comercio Y el de venta no tiene captación):
    // no prueban lo primero por sí solas, y su etiqueta lo dice.
    await correr('storage venta→propio subir (sin flujo captación)', 'tenants/{propio}/captacion/planes.pdf', 'negar',
      () => subir(sV, captacion(N.venta), 'application/pdf'));
    await correr('storage venta→ajeno subir', 'tenants/{ajeno}/captacion/planes.pdf', 'negar',
      () => subir(sV, captacion(N.agenda), 'application/pdf'));
    await correr('storage venta→ajeno leer', 'tenants/{ajeno}/captacion/planes.pdf', 'negar',
      () => leer(sV, captacion(N.agenda)));
    await correr('storage agenda→ajeno subir (ajeno sin captación)', 'tenants/{ajeno}/captacion/planes.pdf', 'negar',
      () => subir(sA, captacion(N.venta), 'application/pdf'));
    await correr('storage agenda→ajeno leer (ajeno sin captación)', 'tenants/{ajeno}/captacion/planes.pdf', 'negar',
      () => leer(sA, captacion(N.venta)));
    if (RUTA_PROPIA) {
      // EXTRA: una ruta propia del comercio de venta, si alguna regla futura se la da.
      const tipo = RUTA_PROPIA.endsWith('.pdf') ? 'application/pdf' : RUTA_PROPIA.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const rutaDe = (t) => RUTA_PROPIA.replace('{t}', t);
      const mostrar = (m) => RUTA_PROPIA.replace('{t}', m);
      await correr('storage venta→propio subir (ruta extra)', mostrar('{propio}'), 'permitir', () => subir(sV, rutaDe(N.venta), tipo));
      await correr('storage venta→propio leer (ruta extra)', mostrar('{propio}'), 'permitir', () => leer(sV, rutaDe(N.venta)));
      await correr('storage venta→ajeno subir (ruta extra)', mostrar('{ajeno}'), 'negar', () => subir(sV, rutaDe(N.agenda), tipo));
      await correr('storage venta→ajeno leer (ruta extra)', mostrar('{ajeno}'), 'negar', () => leer(sV, rutaDe(N.agenda)));
      await correr('storage agenda→ajeno subir (ruta extra)', mostrar('{ajeno}'), 'negar', () => subir(sA, rutaDe(N.venta), tipo));
      await correr('storage agenda→ajeno leer (ruta extra)', mostrar('{ajeno}'), 'negar', () => leer(sA, rutaDe(N.venta)));
    }

    // ---- el informe: solo operación, ruta con marcadores, esperado y obtenido ---------
    const ancho = (k) => Math.max(...filas.map((f) => String(f[k]).length), k.length);
    const w = { operacion: ancho('operacion'), ruta: ancho('ruta'), esperado: 9, obtenido: ancho('obtenido') };
    const linea = (f, marca) => `  ${marca} ${String(f.operacion).padEnd(w.operacion)}  ${String(f.ruta).padEnd(w.ruta)}  ${String(f.esperado).padEnd(w.esperado)}  ${f.obtenido}`;
    console.log(`  ${' '} ${'operación'.padEnd(w.operacion)}  ${'ruta'.padEnd(w.ruta)}  ${'esperado'.padEnd(w.esperado)}  obtenido`);
    for (const f of filas) console.log(linea(f, f.ok ? '✓' : '✗'));
    const fallos = filas.filter((f) => !f.ok);
    console.log(`\n  Resumen: ${filas.length - fallos.length} aciertos, ${fallos.length} fallos, de ${filas.length} filas.`);

    codigo = fallos.length ? 1 : 0;
  } catch (e) {
    codigo = e?.codigoSalida ?? 3;
    // Solo el código del error, nunca su mensaje: el SDK puede incluir rutas o valores.
    console.error(`\n  ✗ ${e?.mensaje ?? `Error inesperado (${e?.code ?? e?.name ?? 'desconocido'}): la verificación no terminó.`}\n`);
  } finally {
    // Las escrituras cortadas por el tope de 20 s siguen vivas en el cliente: se cierran las sesiones
    // ANTES de limpiar, para que no vuelvan a escribir en un tenant ya borrado.
    await Promise.allSettled([sV, sA].filter(Boolean).map((x) => conTope((async () => {
      await fsdk.terminate(x.db);
      await borrarApp(x.app);
    })(), 10000)));
    if (CONSERVAR) {
      console.log('  --conservar: lo sembrado queda en el proyecto; --limpiar lo borra.\n');
    } else {
      try {
        // Un disparador (registrarCambioConfig) puede escribir bitacora/* unos segundos DESPUÉS de la
        // siembra, incluso con el tenant ya borrado: se espera antes de barrer (en el emulador no hay).
        if (!guarda.emulador) await esperar(5000);
        const f = await limpiar();
        console.log(`  Limpieza final: ${f.tenants} tenants y ${f.usuarios} usuarios de prueba borrados.\n`);
      } catch (e) {
        codigo = codigo || 3;
        console.error(`  ✗ La limpieza final falló (${e?.code ?? e?.name ?? 'desconocido'}): corra --limpiar.\n`);
      }
    }
  }
  try { await deleteApp(adminApp); } catch (e) {
    codigo = codigo || 3; // si la matriz falló (1), ese código manda; el cierre solo avisa
    console.error(`  ✗ El cierre falló (${e?.code ?? e?.name ?? 'desconocido'}).\n`);
  }
  process.exit(codigo);
}
