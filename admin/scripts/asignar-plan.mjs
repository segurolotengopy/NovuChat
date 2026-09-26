/**
 * ASIGNAR LOS EJES DE LA CUENTA DE UN COMERCIO: plan (con la copia de sus
 * límites), modalidad, modelo, titularidad de un número y umbrales; y, desde
 * F1b, lo que va POR CONTRATO: conversaciones, cambios incluidos, precio y la
 * prueba (su último mes y su bolsa).
 *
 * POR QUÉ EXISTE. El plan de un comercio vive en `tenants/{t}/cuenta/estado`
 * (`plan`, más la copia `limites` y la versión `catalogoPlanes`), y quien hace
 * cumplir un límite lee la copia (`functions/src/planes.ts`, `Analisis/29`
 * §2.2-2.3). La callable `actualizarEstadoCuenta` lo hace; este script es el
 * mismo camino desde la terminal, para los demos, para NovuChat misma y para
 * un alta que todavía no pasó por la consola.
 *
 * DESDE F1 (`Analisis/41` §4, 25/09/2026) EL PLAN ES UNO DE TRES EJES, y este
 * script escribe los tres más el modelo, cada uno solo si se pide:
 *   --plan <id>                 plan del catálogo → `plan`, `limites` (la copia
 *                               del plan, reemplazando la anterior SALVO lo que
 *                               va por contrato, que se CONSERVA y el seco lo
 *                               dice), `catalogoPlanes`, y el espejo
 *                               `tenants/{t}.plan`.
 *                               «demostracion» YA NO ES UN PLAN: un demo es
 *                               modalidad `demostracion` con cualquier plan.
 *                               Se rechaza, en seco y al aplicar, si hay una
 *                               mensualidad pendiente de OTRO plan (QR vivo o
 *                               en revisión), como la callable.
 *   --modalidad <m>             demostracion | prueba | prepago → `modalidad`.
 *                               Con `prueba` y sin período previo, el mes en
 *                               curso de Bolivia con su bolsa de 20, como la
 *                               callable. `periodoPagado` NO se escribe acá:
 *                               eso es un pago o `migrar-prepago.mjs`.
 *   --modelo <id>               de la lista cerrada de `central/ejes.ts` →
 *                               `tenants/{t}.modelo`.
 *   --titularidad <t> --numero <phone_number_id>
 *                               novuchat | comercio → `rutasWhatsApp/{n}
 *                               .titularidad`, solo si el número es de ESTE
 *                               comercio.
 *   --umbral-operador N --umbral-bloqueo M
 *                               la pareja de `atencion.ts`, validada igual.
 *
 * LO QUE VA POR CONTRATO (F1b, decisión de Andres del 26/09/2026):
 *   --cambios N | plan          `N` fija POR CONTRATO los cambios operados
 *                               incluidos al mes (`limites.cambiosIncluidos`,
 *                               entero de 0 a MAXIMO_CAMBIOS_INCLUIDOS) y lo
 *                               anota en `limitesPorContrato`; `plan` lo QUITA
 *                               y vuelve a regir el del plan.
 *   --conversaciones N | plan   lo mismo con las conversaciones incluidas al
 *                               mes (`limites.conversaciones`, entero de 1 a
 *                               LIMITE_MAXIMO, la validación con que se leen).
 *   --precio <USD> | plan       la mensualidad pactada, en dólares con hasta
 *                               dos decimales (`120`, `37.50`), de más de 0 a
 *                               MAXIMO_PRECIO_POR_CONTRATO_USD →
 *                               `precioPorContrato`. Manda sobre el precio del
 *                               plan en TODO lo que cobra (QR, pago manual,
 *                               cobranza, `montoMensual`). `plan` lo quita. Se
 *                               rechaza si hay una mensualidad pendiente que
 *                               quedaría fuera de contrato.
 *   --periodo-prueba aaaa-mm    el ÚLTIMO mes de la prueba: la fija o la
 *                               extiende, sin huecos desde su primer mes (o
 *                               desde el mes en curso). Solo con modalidad
 *                               prueba (la que tiene o `--modalidad prueba`);
 *                               nunca un mes pasado.
 *   --bolsa-prueba N            las conversaciones de prueba que quedan, 1 a
 *                               BOLSA_PRUEBA_MAXIMA → `bolsaPrueba`. Solo con
 *                               modalidad prueba. Extender la prueba NO la
 *                               reinicia: si hace falta, se pide.
 *   --operador <correo>         OBLIGATORIO: quien queda en la auditoría
 *                               (`uid`, `titularidadPor`, `origen: 'script'`),
 *                               no el nombre del script (LOW-3 de #207).
 *
 * LOS VALORES POR CONTRATO (`copiaDeLimites` de `planes.ts`, la misma función
 * que usan `actualizarEstadoCuenta` y el pago de otro plan). Un cambio de plan
 * conserva lo que el marcador `cuenta/estado.limitesPorContrato` dice que va
 * por contrato, y quitarlo es `--cambios plan` / `--conversaciones plan`,
 * explícito. El precio es un campo propio que ningún escritor del plan toca:
 * un cambio de plan lo conserva por construcción. La prueba la decide
 * `pruebaNueva` de `prepago.ts`, la misma función que la callable.
 *
 * Todo en UNA transacción, con auditoría y el antes y el después
 * (`cambiar_plan` para el plan; `limites_por_contrato` por clave;
 * `precio_por_contrato` para el precio; `estado_cuenta` para el resto, con los
 * campos, sus valores y los de antes). Los campos DERIVADOS (`estadoPago`,
 * `montoMensual`, `moneda`, `proximoVencimiento`) se recalculan con
 * `camposDerivados` si la cuenta tiene modalidad, igual que la callable; sin
 * modalidad no se tocan (LOW 8). Si nada cambia, no escribe nada.
 *
 * EL CATÁLOGO SE IMPORTA DE `functions/src/planes.ts`, no se copia. Los
 * módulos que importan `./x.js` entre sí se cargan con un hook de resolución
 * (`module.registerHooks`, Node 22.15+), como `pase-a-produccion.mjs`, así que
 * no hace falta compilar.
 *
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant demo-venta --plan pro --modalidad demostracion
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant salon-rosa --plan crecimiento --aplicar
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant <tenant> --titularidad comercio --numero <phone id> --aplicar
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant <tenant> --conversaciones 500 --precio 120 --aplicar
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant <tenant> --periodo-prueba 2026-10 --bolsa-prueba 40 --aplicar
 *   node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant <tenant> --cambios plan --precio plan --aplicar
 *
 * Sin `--aplicar` no escribe nada: dice qué haría.
 */
import { registerHooks } from 'node:module';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const PLAN = opcion('plan');
const MODALIDAD = opcion('modalidad');
const MODELO = opcion('modelo');
const TITULARIDAD = opcion('titularidad');
const NUMERO = opcion('numero');
const UMBRAL_OPERADOR = opcion('umbral-operador');
const UMBRAL_BLOQUEO = opcion('umbral-bloqueo');
const CAMBIOS = opcion('cambios');
const CONVERSACIONES = opcion('conversaciones');
const PRECIO = opcion('precio');
const PERIODO_PRUEBA = opcion('periodo-prueba');
const BOLSA_PRUEBA = opcion('bolsa-prueba');
const OPERADOR = (opcion('operador') ?? '').trim().toLowerCase();

// --- los módulos del servidor, sin compilar ---------------------------------
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
const {
  PLANES, CATALOGO_PLANES, CLAVES_POR_CONTRATO, MAXIMO_PRECIO_POR_CONTRATO_USD, RANGO_POR_CONTRATO, copiaDeLimites,
  esIdPlan, limitesDe, mismoMarcador, porContratoDe, precioMensualDe, precioPorContratoDe, precioPorContratoValido,
  valorPorContratoValido,
} = await import('../functions/src/planes.ts');
const {
  BOLSA_PRUEBA_MAXIMA, MODALIDADES, PruebaInvalida, bolsaPruebaValida, camposDerivados, consumidasDe, esModalidad,
  esPeriodo, estadoDeServicio, montoFueraDeContrato, pruebaActual, pruebaNueva,
} = await import('../functions/src/prepago.ts');
const { periodoDe } = await import('../functions/src/planes.ts');
const { MODELOS, MODELO_POR_DEFECTO, TITULARIDADES, esModelo, esTitularidad } = await import('../functions/src/central/ejes.ts');
const { umbralValido, umbralesDeAtencion } = await import('../functions/src/atencion.ts');

// Mismos formatos que `ID_TENANT` e `ID_NUMERO` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_NUMERO = /^[0-9]{6,25}$/;
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');
const mayuscula = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

const problemas = [];
if (!PROYECTO) problemas.push('falta --proyecto');
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
if (!CORREO.test(OPERADOR)) problemas.push('--operador <correo> es obligatorio: es quien queda en la auditoría');
if (!ID_TENANT.test(TENANT)) problemas.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (PLAN !== null && !esIdPlan(PLAN)) {
  problemas.push(`--plan desconocido: ${PLAN || '(vacío)'}. Del catálogo: ${Object.keys(PLANES).join(', ')}`);
}
if (MODALIDAD !== null && !esModalidad(MODALIDAD)) {
  problemas.push(`--modalidad desconocida: ${MODALIDAD || '(vacía)'}. Una de: ${MODALIDADES.join(', ')}`);
}
if (MODELO !== null && !esModelo(MODELO)) {
  problemas.push(`--modelo desconocido: ${MODELO || '(vacío)'}. Uno de: ${MODELOS.join(', ')}`);
}
if (TITULARIDAD !== null && !esTitularidad(TITULARIDAD)) {
  problemas.push(`--titularidad desconocida: ${TITULARIDAD || '(vacía)'}. Una de: ${TITULARIDADES.join(', ')}`);
}
if ((TITULARIDAD !== null) !== (NUMERO !== null)) problemas.push('--titularidad y --numero van juntos');
if (NUMERO !== null && !ID_NUMERO.test(NUMERO)) problemas.push('--numero no es un phone_number_id (solo dígitos, 6 a 25)');
const umbrales = {};
for (const [clave, crudo] of [['umbralOperador', UMBRAL_OPERADOR], ['umbralBloqueo', UMBRAL_BLOQUEO]]) {
  if (crudo === null) continue;
  const n = Number(crudo);
  if (!umbralValido(n)) problemas.push(`--${clave === 'umbralOperador' ? 'umbral-operador' : 'umbral-bloqueo'} inválido: ${crudo}`);
  else umbrales[clave] = n;
}
// --cambios y --conversaciones: un entero en texto que valide IGUAL que el
// servidor (`valorPorContratoValido`), o la palabra `plan` para quitar el
// contrato. Ausente = no se pidió; `null` = volver al del plan (la forma de la
// callable).
const valoresPedidos = {};
for (const [clave, crudo, bandera] of [['cambiosIncluidos', CAMBIOS, 'cambios'], ['conversaciones', CONVERSACIONES, 'conversaciones']]) {
  if (crudo === null) continue;
  if (crudo === 'plan') valoresPedidos[clave] = null;
  else if (/^[0-9]{1,6}$/.test(crudo) && valorPorContratoValido(clave, Number(crudo))) valoresPedidos[clave] = Number(crudo);
  else problemas.push(`--${bandera} inválido: ${crudo || '(vacío)'}. ${mayuscula(RANGO_POR_CONTRATO[clave])}, o «plan» para volver al del plan.`);
}
const pideCopiaPorContrato = Object.keys(valoresPedidos).length > 0;
// --precio: dólares con punto decimal y hasta dos decimales, validados como
// el servidor (`precioPorContratoValido`); o `plan` para quitarlo.
let precioPedido;
if (PRECIO !== null) {
  if (PRECIO === 'plan') precioPedido = null;
  else if (/^[0-9]{1,4}(\.[0-9]{1,2})?$/.test(PRECIO) && precioPorContratoValido(Number(PRECIO))) precioPedido = Number(PRECIO);
  else {
    problemas.push(`--precio inválido: ${PRECIO || '(vacío)'}. Un monto en dólares mayor que 0 y de hasta ${MAXIMO_PRECIO_POR_CONTRATO_USD}, `
      + 'con punto y hasta dos decimales (120 o 37.50), o «plan» para volver al precio del plan.');
  }
}
// --periodo-prueba y --bolsa-prueba: acá la FORMA; la modalidad que queda, el
// mes en curso y el primer mes los decide `pruebaNueva` contra la cuenta.
if (PERIODO_PRUEBA !== null && !esPeriodo(PERIODO_PRUEBA)) {
  problemas.push(`--periodo-prueba inválido: ${PERIODO_PRUEBA || '(vacío)'}. Un mes aaaa-mm (2026-10).`);
}
let bolsaPruebaPedida;
if (BOLSA_PRUEBA !== null) {
  if (/^[0-9]{1,5}$/.test(BOLSA_PRUEBA) && bolsaPruebaValida(Number(BOLSA_PRUEBA))) bolsaPruebaPedida = Number(BOLSA_PRUEBA);
  else problemas.push(`--bolsa-prueba inválida: ${BOLSA_PRUEBA || '(vacía)'}. Un entero de 1 a ${BOLSA_PRUEBA_MAXIMA}.`);
}
const pideAlgoDePrueba = MODALIDAD !== null || PERIODO_PRUEBA !== null || BOLSA_PRUEBA !== null;
const pideAlgo = PLAN !== null || MODALIDAD !== null || MODELO !== null || TITULARIDAD !== null || CAMBIOS !== null
  || CONVERSACIONES !== null || PRECIO !== null || PERIODO_PRUEBA !== null || BOLSA_PRUEBA !== null
  || Object.keys(umbrales).length > 0;
if (!pideAlgo) {
  problemas.push('nada que asignar: --plan, --modalidad, --modelo, --titularidad/--numero, --cambios, --conversaciones, '
    + '--precio, --periodo-prueba, --bolsa-prueba o --umbral-*');
}
if (problemas.length) {
  console.error('\n  ✗ ' + problemas.join('\n  ✗ '));
  console.error('\n  node scripts/asignar-plan.mjs --proyecto <id> --operador <correo> --tenant <id> [--plan <plan>] [--modalidad <m>]');
  console.error('      [--modelo <id>] [--titularidad <t> --numero <phone_number_id>] [--umbral-operador N --umbral-bloqueo M]');
  console.error('      [--cambios <N|plan>] [--conversaciones <N|plan>] [--precio <USD|plan>]');
  console.error('      [--periodo-prueba <aaaa-mm>] [--bolsa-prueba <N>] [--aplicar]\n');
  process.exit(2);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

const ahoraMs = Date.now();
const refFicha = db.doc(`tenants/${TENANT}`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const refMetricas = db.doc(`tenants/${TENANT}/metricas/${periodoDe(ahoraMs)}`);
const refRuta = NUMERO ? db.doc(`rutasWhatsApp/${NUMERO}`) : null;
// Los límites DEL PLAN pedido, para el encabezado. Lo que queda en la copia
// (con lo conservado por contrato) se decide en la transacción, contra la
// cuenta leída: `copiaDeLimites`.
const limites = PLAN ? limitesDe(PLAN) : null;
const texto = (l) => (l && typeof l === 'object'
  ? `${l.conversaciones ?? '?'} conversaciones · ${l.productos ?? '?'} productos · ${l.agendas ?? '?'} agendas`
    + ` · ${l.cambiosIncluidos ?? '?'} cambios/mes`
  : '(sin copia de límites)');
const textoPrueba = (p) => (p.periodoPrueba
  ? `${p.pruebaDesde ? `de ${p.pruebaDesde} a ` : ''}${p.periodoPrueba} · bolsa ${p.bolsaPrueba ?? '(ninguna)'}`
  : '(sin prueba)');
/** Un valor para la auditoría: un borrado es `null`, un Timestamp son sus milisegundos. */
const paraAuditoria = (v) => (v instanceof FieldValue ? null : v instanceof Timestamp ? v.toMillis() : v ?? null);

console.log(`\n  Negocio   : ${TENANT}`);
if (PLAN) console.log(`  Plan      : ${PLAN} (${PLANES[PLAN].nombre}, USD ${PLANES[PLAN].precioUsd}) · ${texto(limites)} · catálogo ${CATALOGO_PLANES}`);
if (MODALIDAD) console.log(`  Modalidad : ${MODALIDAD}`);
if (MODELO) console.log(`  Modelo    : ${MODELO}`);
if (TITULARIDAD) console.log(`  Número    : ${cola(NUMERO)} → titularidad ${TITULARIDAD}`);
if (CAMBIOS !== null) {
  const v = valoresPedidos.cambiosIncluidos;
  console.log(`  Cambios   : ${v === null ? 'volver al del plan (quitar el contrato)' : `${v} al mes por contrato`}`);
}
if (CONVERSACIONES !== null) {
  const v = valoresPedidos.conversaciones;
  console.log(`  Conversac.: ${v === null ? 'volver a las del plan (quitar el contrato)' : `${v} al mes por contrato`}`);
}
if (PRECIO !== null) console.log(`  Precio    : ${precioPedido === null ? 'volver al del plan (quitar el contrato)' : `USD ${precioPedido} al mes por contrato`}`);
if (PERIODO_PRUEBA !== null) console.log(`  Prueba    : hasta ${PERIODO_PRUEBA}`);
if (BOLSA_PRUEBA !== null) console.log(`  Bolsa pr. : ${bolsaPruebaPedida} conversaciones de prueba`);
if (Object.keys(umbrales).length) console.log(`  Umbrales  : ${JSON.stringify(umbrales)}`);
console.log(`  Operador  : ${OPERADOR}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

// UN RECHAZO NO SE LANZA DENTRO DE LA TRANSACCIÓN: se devuelve. Si el callback
// lanza, el SDK manda el rollback SIN esperarlo («best effort», transaction.js),
// y un script que termina enseguida puede irse antes de que llegue: los
// documentos leídos quedan bloqueados hasta que el bloqueo vence, y cualquier
// escritura sobre ellos espera. Se vio el 15/09 en el emulador, con otro script
// que sí lanza. Devolviendo el rechazo, la transacción cierra sin escrituras y
// libera todo.
let resumen;
try {
  await db.runTransaction(async (tx) => {
    // Lecturas antes que escrituras, como exige la transacción.
    const [ficha, cuenta, metricas, ruta] = await Promise.all([
      tx.get(refFicha), tx.get(refCuenta), tx.get(refMetricas), refRuta ? tx.get(refRuta) : Promise.resolve(null),
    ]);
    if (!ficha.exists) {
      resumen = { error: `No existe el comercio «${TENANT}». Primero alta-comercio.mjs.` };
      return;
    }
    if (ficha.get('estado') === 'dado_de_baja') {
      resumen = { error: `«${TENANT}» está dado de baja: no se le asignan ejes.` };
      return;
    }
    if (ruta && !ruta.exists) {
      resumen = { error: `El número ${cola(NUMERO)} no tiene ruta: primero asignar-numero.mjs.` };
      return;
    }
    if (ruta && ruta.get('tenantId') !== TENANT) {
      resumen = { error: `El número ${cola(NUMERO)} es de OTRO comercio (${ruta.get('tenantId')}). No se toca.` };
      return;
    }
    const actual = cuenta.data() ?? {};
    // UN QR VIVO DE OTRO PLAN FRENA EL CAMBIO DE PLAN, en seco y al aplicar
    // (revisión de seguridad de #212, tercera vuelta, LOW 1). La misma guarda
    // que `actualizarEstadoCuenta` en `functions/src/index.ts`: si la cuenta
    // tiene pendiente una mensualidad de otro plan --un QR vivo, o uno que el
    // banco ya confirmó y espera en revisión-- y se cambia el plan acá, al
    // resolverse ese pago la cuenta quedaría con dos verdades. Primero se
    // anula el QR (Pagar) o se confirma el pago en revisión (Negocios);
    // después, el plan. Es una lectura más, dentro de la misma transacción.
    // Y, desde F1b, lo mismo con el PRECIO: la mensualidad pendiente no puede
    // quedar fuera de contrato (se decide abajo, con la cuenta como queda).
    const pendienteId = actual.pagoPendienteId;
    let pendienteVivo = null;
    if ((PLAN || precioPedido !== undefined) && typeof pendienteId === 'string' && /^[A-Za-z0-9_-]{22}$/.test(pendienteId)) {
      const pendiente = (await tx.get(db.doc(`tenants/${TENANT}/pagos/${pendienteId}`))).data();
      const enRevision = pendiente?.cobro && typeof pendiente.cobro === 'object' && pendiente.cobro.estado === 'CONFIRMADO';
      if (pendiente && pendiente.estado === 'pendiente' && pendiente.tipo === 'mensualidad') {
        if (PLAN && pendiente.plan !== PLAN) {
          resumen = {
            error: `Hay un cobro pendiente de una mensualidad de otro plan (${pendiente.plan}, pago ${cola(pendienteId)}`
              + `${enRevision ? ', el banco ya lo confirmó y espera en revisión' : ''}): `
              + `${enRevision ? 'confírmelo en Negocios' : 'anule el cobro pendiente'} primero y después cambie el plan.`,
          };
          return;
        }
        pendienteVivo = { ...pendiente, enRevision };
      }
    }
    // Un valor o un precio por contrato sin cuenta ni plan dejaría una cuenta
    // parcial, con una copia de una sola clave y sin plan (LOW-4 de #207).
    if ((pideCopiaPorContrato || precioPedido !== undefined) && !PLAN && !cuenta.exists) {
      resumen = { error: `«${TENANT}» no tiene cuenta: primero --plan.` };
      return;
    }

    // --- qué cambia en la cuenta -------------------------------------------
    // LA COPIA: la del plan pedido, conservando lo que va por contrato, más
    // los valores por contrato pedidos (o su retiro). La misma función que la
    // callable y el pago de otro plan.
    const escritura = {};
    const copia = PLAN || pideCopiaPorContrato
      ? copiaDeLimites(actual, { ...(PLAN ? { plan: PLAN } : {}), ...valoresPedidos })
      : null;
    const marcadorCambia = Boolean(copia) && !mismoMarcador(actual, copia.porContrato);
    const copiaCambia = Boolean(copia) && (marcadorCambia || !(actual.limites && typeof actual.limites === 'object'
      && ['conversaciones', 'productos', 'agendas', 'cambiosIncluidos'].every((k) => actual.limites[k] === copia.limites[k])));
    if (PLAN) {
      if (!(actual.plan === PLAN && ficha.get('plan') === PLAN && actual.catalogoPlanes === CATALOGO_PLANES && !copiaCambia)) {
        Object.assign(escritura, { plan: PLAN, limites: copia.limites, catalogoPlanes: CATALOGO_PLANES });
      }
    } else if (copiaCambia) {
      escritura.limites = copia.limites;
    }
    if (marcadorCambia) {
      escritura.limitesPorContrato = copia.porContrato.length ? copia.porContrato : FieldValue.delete();
    }
    // Qué claves por contrato cambian de verdad (valor u origen): solo esas
    // dejan `limites_por_contrato`, como la callable.
    const porContratoAntes = porContratoDe(actual);
    const contratosQueCambian = copia ? CLAVES_POR_CONTRATO.filter((k) => valoresPedidos[k] !== undefined
      && (porContratoAntes.includes(k) !== (valoresPedidos[k] !== null) || actual.limites?.[k] !== copia.limites[k])) : [];

    // EL PRECIO POR CONTRATO: un campo propio, que un cambio de plan no toca.
    const precioAntes = precioPorContratoDe(actual);
    const precioCambia = precioPedido !== undefined && precioPedido !== precioAntes;
    if (precioCambia) escritura.precioPorContrato = precioPedido === null ? FieldValue.delete() : precioPedido;
    else if (precioPedido === null && actual.precioPorContrato !== undefined) escritura.precioPorContrato = FieldValue.delete();

    if (MODALIDAD && actual.modalidad !== MODALIDAD) escritura.modalidad = MODALIDAD;
    // LA PRUEBA: la decide `pruebaNueva` (`prepago.ts`), la misma función que
    // la callable, con la modalidad que queda.
    let prueba = {};
    if (pideAlgoDePrueba) {
      try {
        prueba = pruebaNueva(actual, {
          ...(MODALIDAD ? { modalidad: MODALIDAD } : {}),
          ...(PERIODO_PRUEBA !== null ? { periodoPrueba: PERIODO_PRUEBA } : {}),
          ...(bolsaPruebaPedida !== undefined ? { bolsaPrueba: bolsaPruebaPedida } : {}),
        }, ahoraMs);
      } catch (e) {
        if (e instanceof PruebaInvalida) { resumen = { error: e.message }; return; }
        throw e;
      }
      for (const [k, v] of Object.entries(prueba)) escritura[k] = v === null ? FieldValue.delete() : v;
    }
    for (const [k, v] of Object.entries(umbrales)) if (actual[k] !== v) escritura[k] = v;
    if (Object.keys(umbrales).length) {
      const combinados = { ...actual, ...umbrales };
      if (umbralesDeAtencion(combinados).origen !== 'cuenta') {
        resumen = { error: 'El umbral de bloqueo tiene que ser mayor que el de operador.' };
        return;
      }
    }
    const fichaCambios = {};
    if (PLAN && ficha.get('plan') !== PLAN) fichaCambios.plan = PLAN;
    if (MODELO && ficha.get('modelo') !== MODELO) fichaCambios.modelo = MODELO;
    const rutaCambia = Boolean(ruta && ruta.get('titularidad') !== TITULARIDAD);

    // --- la cuenta como va a quedar (sin los campos que se borran) ----------
    const combinada = { ...actual };
    for (const [k, v] of Object.entries(escritura)) {
      if (v instanceof FieldValue) delete combinada[k]; else combinada[k] = v;
    }
    // UN PRECIO FUERA DE CONTRATO SE RECHAZA (F1b): la mensualidad pendiente
    // quedaría a un importe que la cuenta ya no cobra.
    if (pendienteVivo && montoFueraDeContrato(pendienteVivo, combinada)) {
      resumen = {
        error: `Hay un cobro pendiente de una mensualidad por USD ${pendienteVivo.montoUsd} (pago ${cola(pendienteId)}`
          + `${pendienteVivo.enRevision ? ', el banco ya lo confirmó y espera en revisión' : ''}), que con este cambio quedaría fuera de `
          + `contrato (la cuenta cobraría USD ${precioMensualDe(combinada, pendienteVivo.plan)} al mes): `
          + `${pendienteVivo.enRevision ? 'confírmelo en Negocios' : 'anule el cobro pendiente'} primero.`,
      };
      return;
    }

    // --- los derivados, con la cuenta como va a quedar (solo con modalidad) --
    let derivados = null;
    if (esModalidad(combinada.modalidad) && Object.keys(escritura).length > 0) {
      const servicio = estadoDeServicio(combinada, consumidasDe(metricas.data()), ahoraMs);
      const d = camposDerivados(servicio, combinada);
      derivados = { estadoPago: d.estadoPago, montoMensual: d.montoMensual, moneda: d.moneda };
      escritura.estadoPago = d.estadoPago;
      escritura.montoMensual = d.montoMensual;
      escritura.moneda = d.moneda;
      escritura.proximoVencimiento = d.proximoVencimientoMs === null
        ? FieldValue.delete() : Timestamp.fromMillis(d.proximoVencimientoMs);
    }

    const antes = {
      plan: actual.plan ?? null, limites: actual.limites ?? null, catalogo: actual.catalogoPlanes ?? null,
      porContrato: porContratoAntes, precioPorContrato: precioAntes, mensualUsd: precioMensualDe(actual),
      prueba: pruebaActual(actual),
      espejo: ficha.get('plan') ?? null, modalidad: actual.modalidad ?? null, modelo: ficha.get('modelo') ?? null,
      titularidad: ruta ? (ruta.get('titularidad') ?? null) : undefined,
      umbrales: { operador: actual.umbralOperador ?? null, bloqueo: actual.umbralBloqueo ?? null },
    };
    const sinCambios = Object.keys(escritura).length === 0 && Object.keys(fichaCambios).length === 0 && !rutaCambia;
    resumen = {
      antes, sinCambios, cuentaNueva: !cuenta.exists, derivados, campos: Object.keys(escritura).sort(),
      queda: copia ? { limites: copia.limites, porContrato: copia.porContrato, conservados: copia.conservados, delPlan: copia.delPlan } : null,
      precio: { antes: precioAntes, despues: precioPorContratoDe(combinada), mensualUsd: precioMensualDe(combinada) },
      prueba: Object.keys(prueba).length ? pruebaActual(combinada) : null,
    };
    if (!APLICAR || sinCambios) return;

    const ahora = Timestamp.now();
    escritura.actualizadoEn = ahora;
    // `update` reemplaza `limites` entero (la copia ya trae lo conservado);
    // `set` solo si la cuenta no existía.
    if (cuenta.exists) tx.update(refCuenta, escritura);
    else tx.set(refCuenta, Object.fromEntries(Object.entries(escritura).filter(([, v]) => !(v instanceof FieldValue))));
    if (Object.keys(fichaCambios).length) tx.update(refFicha, fichaCambios);
    const auditar = (datos) => tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      uid: OPERADOR, origen: 'script', script: 'asignar-plan', en: ahora, ...datos,
    });
    // El modelo y la titularidad dejan la MISMA auditoría que la callable
    // `asignarEjes`: un solo vocabulario para leerla después.
    if (rutaCambia || fichaCambios.modelo) {
      if (rutaCambia) tx.update(refRuta, { titularidad: TITULARIDAD, titularidadEn: ahora, titularidadPor: OPERADOR });
      auditar({
        accion: 'asignar_ejes',
        ...(fichaCambios.modelo ? { modeloAntes: antes.modelo ?? MODELO_POR_DEFECTO, modeloDespues: MODELO } : {}),
        ...(rutaCambia ? {
          phoneNumberId: NUMERO, titularidadAntes: antes.titularidad ?? 'novuchat', titularidadDespues: TITULARIDAD,
        } : {}),
      });
    }
    if (escritura.plan) {
      auditar({
        accion: 'cambiar_plan', planAntes: antes.plan, planDespues: PLAN,
        limitesAntes: antes.limites, limitesDespues: copia.limites,
        catalogoPlanes: CATALOGO_PLANES,
        ...(Object.keys(copia.conservados).length ? { conservadosPorContrato: copia.conservados } : {}),
      });
    }
    // Cada valor por contrato deja la MISMA auditoría que la callable
    // `actualizarEstadoCuenta`: un solo vocabulario para leerla después.
    for (const clave of contratosQueCambian) {
      auditar({
        accion: 'limites_por_contrato', clave,
        antes: { valor: antes.limites?.[clave] ?? null, porContrato: porContratoAntes.includes(clave) },
        despues: { valor: copia.limites[clave], porContrato: valoresPedidos[clave] !== null },
        plan: PLAN ?? actual.plan ?? null, delPlan: copia.delPlan[clave],
      });
    }
    if (precioCambia) {
      auditar({
        accion: 'precio_por_contrato',
        antes: { valor: precioAntes, porContrato: precioAntes !== null, mensualUsd: antes.mensualUsd },
        despues: { valor: precioPedido, porContrato: precioPedido !== null, mensualUsd: precioMensualDe(combinada) },
        plan: combinada.plan ?? null, delPlanUsd: precioMensualDe({ plan: combinada.plan }),
      });
    }
    const otros = Object.keys(escritura)
      .filter((k) => ![
        'plan', 'limites', 'limitesPorContrato', 'catalogoPlanes', 'precioPorContrato', 'actualizadoEn',
        'estadoPago', 'montoMensual', 'moneda', 'proximoVencimiento',
      ].includes(k))
      .sort();
    if (otros.length) {
      auditar({
        accion: 'estado_cuenta', campos: otros,
        valores: Object.fromEntries(otros.map((k) => [k, paraAuditoria(escritura[k])])),
        antes: Object.fromEntries(otros.map((k) => [k, paraAuditoria(actual[k])])),
        ...(Object.keys(prueba).length ? { prueba: { antes: antes.prueba, despues: pruebaActual(combinada) } } : {}),
      });
    }
  });
} catch (e) {
  console.error(`  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
if (resumen.error) {
  console.error(`  ✗ ${resumen.error}\n`);
  process.exit(1);
}

const a = resumen.antes;
console.log(`  Antes     : plan ${a.plan ?? '(ninguno)'} · espejo ${a.espejo ?? '(ninguno)'} · catálogo ${a.catalogo ?? '(ninguno)'}`);
console.log(`              ${texto(a.limites)}${a.porContrato.length ? ` · por contrato: ${a.porContrato.join(', ')}` : ''}`);
console.log(`              USD ${a.mensualUsd} al mes${a.precioPorContrato !== null ? ' por contrato' : ' del plan'}`
  + ` · prueba ${textoPrueba(a.prueba)}`);
console.log(`              modalidad ${a.modalidad ?? '(ninguna: rige demostración)'} · modelo ${a.modelo ?? '(ninguno: rige el de defecto)'}`
  + (a.titularidad !== undefined ? ` · titularidad ${a.titularidad ?? '(ninguna: rige novuchat)'}` : '')
  + ` · umbrales ${a.umbrales.operador ?? '-'}/${a.umbrales.bloqueo ?? '-'}`);
console.log(`  Cuenta    : ${resumen.cuentaNueva ? 'no existía, se crea' : `existe, cambian: ${resumen.campos.join(', ') || 'nada de la cuenta'}`}`);
if (resumen.derivados) console.log(`  Derivados : ${JSON.stringify(resumen.derivados)}`);
// LO QUE PASA CON EL CONTRATO, dicho en el seco y en el aplicado: un cambio de
// plan que conserva un valor por contrato lo anuncia, y uno que lo fija o lo
// quita dice el antes y el después.
const q = resumen.queda;
if (q) {
  for (const [k, v] of Object.entries(q.conservados)) {
    console.log(`  Contrato  : se conserva ${k} ${v} por contrato (el plan ${PLAN} trae ${q.delPlan[k]})`);
  }
  for (const k of CLAVES_POR_CONTRATO) {
    if (valoresPedidos[k] === undefined) continue;
    const antesValor = a.limites?.[k] ?? '(sin copia)';
    const antesOrigen = a.porContrato.includes(k) ? 'por contrato' : 'del plan';
    const despuesOrigen = q.porContrato.includes(k) ? 'por contrato' : `del plan ${PLAN ?? a.plan ?? '—'}`;
    console.log(`  Contrato  : ${k} ${antesValor} ${antesOrigen} → ${q.limites[k]} ${despuesOrigen}`);
  }
  console.log(`  Queda     : ${texto(q.limites)}${q.porContrato.length ? ` · por contrato: ${q.porContrato.join(', ')}` : ''}`);
}
// EL PRECIO QUE QUEDA, SIEMPRE QUE CAMBIE ALGO QUE LO DECIDE: fijarlo,
// quitarlo, o cambiar el plan (si hay contrato, el plan nuevo NO cambia el
// precio, y el seco lo dice para que nadie lo suponga).
const p = resumen.precio;
if (PRECIO !== null || PLAN) {
  const origen = p.despues !== null ? 'por contrato' : `del plan ${PLAN ?? a.plan ?? '—'}`;
  const nota = PLAN && PRECIO === null && p.despues !== null ? ' (se conserva: el cambio de plan no toca el precio por contrato)' : '';
  console.log(`  Precio    : USD ${a.mensualUsd} ${a.precioPorContrato !== null ? 'por contrato' : 'del plan'} → USD ${p.mensualUsd} ${origen}${nota}`);
}
if (resumen.prueba) console.log(`  Prueba    : ${textoPrueba(a.prueba)} → ${textoPrueba(resumen.prueba)}`);

if (resumen.sinCambios) {
  console.log('\n  Sin cambios: ya tiene esos ejes.\n');
  process.exit(0);
}
if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  process.exit(0);
}

// --- verificación por relectura ---------------------------------------------
const [cuenta, ficha, ruta] = await Promise.all([refCuenta.get(), refFicha.get(), refRuta ? refRuta.get() : null]);
const leida = cuenta.data() ?? {};
const copia = leida.limites ?? {};
// LA COPIA RELEÍDA TIENE QUE SER LA DECIDIDA: la del plan con lo conservado
// por contrato, o con los valores por contrato fijados o quitados; y el
// marcador, el decidido. Si otro escritor la pisó entre medio, se dice. Lo
// mismo el precio y la prueba.
const esperada = resumen.queda;
const okCopia = !esperada || (['conversaciones', 'productos', 'agendas', 'cambiosIncluidos'].every((k) => copia[k] === esperada.limites[k])
  && mismoMarcador(leida, esperada.porContrato));
const okPlan = !PLAN || (leida.plan === PLAN && ficha.get('plan') === PLAN && leida.catalogoPlanes === CATALOGO_PLANES);
const okModalidad = !MODALIDAD || leida.modalidad === MODALIDAD;
const okModelo = !MODELO || ficha.get('modelo') === MODELO;
const okTitularidad = !TITULARIDAD || ruta?.get('titularidad') === TITULARIDAD;
const okUmbrales = Object.entries(umbrales).every(([k, v]) => leida[k] === v);
const okPrecio = precioPedido === undefined || precioPorContratoDe(leida) === precioPedido;
const okPrueba = !resumen.prueba || JSON.stringify(pruebaActual(leida)) === JSON.stringify(resumen.prueba);
const ok = okPlan && okCopia && okModalidad && okModelo && okTitularidad && okUmbrales && okPrecio && okPrueba;
const marcadorLeido = porContratoDe(leida);
const precioLeido = precioPorContratoDe(leida);
console.log(`\n  ${ok ? '✓' : '✗'} Verificación: plan ${leida.plan} · espejo ${ficha.get('plan')} · ${texto(copia)}`
  + (marcadorLeido.length ? ` · por contrato: ${marcadorLeido.join(', ')}` : ''));
console.log(`    USD ${precioMensualDe(leida)} al mes${precioLeido !== null ? ' por contrato' : ' del plan'}`
  + ` · montoMensual ${leida.montoMensual ?? '-'} · prueba ${textoPrueba(pruebaActual(leida))}`);
console.log(`    modalidad ${leida.modalidad ?? '(ninguna)'} · modelo ${ficha.get('modelo') ?? '(ninguno)'}`
  + (ruta ? ` · titularidad ${ruta.get('titularidad') ?? '(ninguna)'}` : '')
  + ` · umbrales ${leida.umbralOperador ?? '-'}/${leida.umbralBloqueo ?? '-'}\n`);
if (!ok) process.exit(1);
