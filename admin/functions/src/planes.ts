/**
 * =============================================================================
 * PLANES — el catálogo de lo que se vende, y los límites que se copian a cada
 * cuenta
 * =============================================================================
 *
 * ESTE MÓDULO ES PURO A PROPÓSITO, igual que `atencion.ts`: no importa Firebase
 * ni lee la red. Lo usan las Functions (`actualizarEstadoCuenta`, la ingesta),
 * el script `scripts/asignar-plan.mjs` y la consola (`web/src/lib/planes.ts`).
 * Un solo catálogo y cuatro lectores: si la consola tuviera su copia, podría
 * decir «hasta 100 productos» mientras el servidor corta en otra cifra, y sobre
 * esa diferencia se discute un reclamo.
 *
 * DÓNDE VIVE LA VERDAD DEL PLAN (`Analisis/29` §2.2-2.3, adoptado por Andres el
 * 15/09/2026):
 *
 *  - El CATÁLOGO (qué planes existen y cuánto incluye cada uno) vive ACÁ, en
 *    código versionado: un cambio de precio pasa por un PR que Andres y Silvana
 *    ven junto con `CLAUDE.md` y el sitio, no por un clic en producción.
 *  - El PLAN DE CADA COMERCIO vive en `tenants/{t}/cuenta/estado.plan`, y al
 *    asignarlo se escribe ahí una COPIA de sus límites (`limites`) y la versión
 *    del catálogo que se aplicó (`catalogoPlanes`). Quien hace cumplir un
 *    límite lee la COPIA, no este archivo: así el número no está escrito en
 *    quien lo aplica (`CLAUDE.md` §7.4), las reglas de Firestore lo pueden leer
 *    (no importan TypeScript), un cambio de precios no toca a quien ya
 *    contrató, y una factura se reconstruye con lo que dice la cuenta.
 *  - `tenants/{t}.plan` es un ESPEJO para pintar la lista de comercios. Lo
 *    escribe solo quien cambia el plan, en la misma transacción, y NINGÚN
 *    límite ni ninguna regla lo lee nunca.
 *
 * LOS NÚMEROS DE LOS PLANES PUBLICADOS son los que publica el sitio
 * (`Novuchat-site`, `src/contenido/precios.es.ts`, verificado el 15/09/2026) y
 * los de la «Base comercial» de `CLAUDE.md`. Un PR que cambie uno de ellos
 * cambia los tres lugares; `pruebas/planes.test.ts` compara este archivo con
 * `CLAUDE.md`. `byoc` NO se publica y por eso no está en esa comparación: se
 * ofrece caso por caso (`Analisis/39`).
 */

// -----------------------------------------------------------------------------
// EL CATÁLOGO
// -----------------------------------------------------------------------------

/**
 * Los planes que se pueden contratar y pagar. Los tres primeros son los que
 * publica el sitio, en el orden en que se muestran (`PLANES_PUBLICADOS`);
 * `byoc` se ofrece caso por caso y no aparece en ninguna lista de precios.
 */
export type IdPlanVendible = 'impulso' | 'crecimiento' | 'pro' | 'byoc';
/**
 * PUENTE DE TIPO, Y SOLO DE TIPO. DESDE F1 (`Analisis/41` §4, 25/09/2026)
 * «demostración» DEJÓ DE SER UN PLAN: `cuenta/estado.plan` solo puede decir
 * un `IdPlanVendible`. Que un comercio no pague, o que sea un demo de
 * NovuChat, lo dice la MODALIDAD (`cuenta/estado.modalidad`, `prepago.ts`); el
 * plan solo dice qué límites rigen. Un demo es un tenant con modalidad
 * `demostracion` y cualquier plan del catálogo.
 *
 * Este tipo conserva `'demostracion'` ÚNICAMENTE porque `web/src/lib/pagar.ts`
 * compara `actual !== 'demostracion'` después de acotar con `esIdPlan`, y
 * TypeScript rechaza esa comparación si el tipo no la contiene; la consola es
 * zona de otro agente. NINGÚN VALOR `'demostracion'` existe en el catálogo ni
 * lo acepta `esIdPlan`: es el mismo predicado que `esPlanVendible`. El
 * servidor usa `IdPlanVendible` y `esPlanVendible`; `pruebas/central/ejes.test.ts`
 * vigila que siga siendo así. Cuando la consola deje de comparar, `IdPlan`
 * pasa a ser `IdPlanVendible` a secas.
 *
 * @deprecated En el servidor, `IdPlanVendible`.
 */
export type IdPlan = IdPlanVendible | 'demostracion';

/**
 * Lo que se copia a la cuenta al asignar un plan, y lo que el servidor hace
 * cumplir. Los tres primeros valen de 1 en adelante y son los que leen las
 * reglas; `cambiosIncluidos` admite 0 (ver abajo) y lo hace cumplir
 * `registrarCambioOperado` (`central/cambiosOperados.ts`).
 */
export interface Limites {
  /** Conversaciones incluidas por mes (bloques de 25 respuestas en 24 h, `atencion.ts`). */
  conversaciones: number;
  /** Productos del catálogo del comercio. */
  productos: number;
  /** Agendas (calendarios de Google) conectadas. */
  agendas: number;
  /**
   * CAMBIOS DE CONFIGURACIÓN OPERADOS POR NOVUCHAT AL MES (`Analisis/40` §5.2,
   * `Analisis/41` §4.4). Es el límite que ya se vendió («hasta 4 cambios al
   * mes») y que hasta F1 nadie contaba: un límite que solo existe en el
   * contrato no existe (`CLAUDE.md`, Base comercial §7). Cuenta lo que
   * NovuChat hace A MANO por el comercio; lo que el comercio hace solo en su
   * consola no cuenta, porque para eso está la consola. Un 0 es legítimo: el
   * plan de entrada es autoservicio.
   */
  cambiosIncluidos: number;
}

export interface Plan extends Limites {
  nombre: string;
  /** La lista se denomina en dólares; se cobra en bolivianos al TCO del BCB (`CLAUDE.md` §3). */
  precioUsd: number;
  /**
   * PUENTE, Y VACÍO A PROPÓSITO. Hasta F1 `pagaMeta` decía quién le paga a
   * Meta los mensajes de este plan; desde F1 eso NO lo decide el plan sino la
   * TITULARIDAD DEL CANAL, POR NÚMERO (`rutasWhatsApp/{n}.titularidad`,
   * `central/ejes.ts`): un comercio puede tener un número propio y otro
   * provisto, y la franquicia de Meta es por número. Ningún plan trae este
   * campo. La clave sigue existiendo, opcional, solo porque
   * `web/src/lib/pagar.ts` (`paganEllosAMeta`) todavía la lee y la consola es
   * zona de otro agente; cuando la consola lea la titularidad, esta línea se
   * borra. `pruebas/central/ejes.test.ts` vigila que ningún plan la traiga.
   *
   * @deprecated La titularidad es por número: `rutasWhatsApp/{n}.titularidad`.
   */
  pagaMeta?: 'novuchat' | 'comercio';
  /**
   * CAMPAÑAS SIMULTÁNEAS (Andres, 24/09/2026): cuántas campañas de Meta puede
   * tener cargadas y vigentes a la vez el comercio, de 0 a `MAXIMO_CAMPANAS`.
   * Va FUERA de `Limites` a propósito: ahí todo número vale de 1 en adelante y
   * la copia de la cuenta se juzga completa con los tres de siempre; un 0 es un
   * valor legítimo acá (el plan de entrada no trae campañas) y agregarlo a la
   * copia habría vuelto «incompletas» todas las cuentas que ya existen. Se lee
   * con `limiteDeCampanas`.
   */
  campanas: number;
}

/** El techo de campañas simultáneas de cualquier plan (decisión de Andres, 24/09/2026). */
export const MAXIMO_CAMPANAS = 10;

/**
 * VERSIÓN DEL CATÁLOGO: la fecha del último cambio de algún número de este
 * archivo. Viaja a la cuenta como `catalogoPlanes` junto con la copia de los
 * límites, para saber más tarde con qué catálogo se asignó cada plan. Se cambia
 * CADA VEZ que cambia un número de abajo.
 */
export const CATALOGO_PLANES = '2026-09-25';

/**
 * El techo de cambios operados incluidos que se puede copiar a una cuenta.
 * Como `MAXIMO_CAMPANAS`: un seguro contra un dato corrupto, no una opinión
 * comercial. Un contrato a medida (`Analisis/40` §4.2) cabe de sobra.
 */
export const MAXIMO_CAMBIOS_INCLUIDOS = 100;

/**
 * LO QUE SE PUEDE CONTRATAR Y PAGAR. No es lo mismo que lo que publica el
 * sitio: los TRES PRIMEROS son los publicados (`PLANES_PUBLICADOS`), y `byoc`
 * es una modalidad que se ofrece caso por caso (`Analisis/39`).
 *
 * Impulso 25/100, Crecimiento 50/220, Pro 90/500 (`Analisis/21`, adoptado el
 * 08/09). Productos 20/100/500 (decisión de Andres, 15/09, como promete el
 * sitio). Agendas 1/5/10 (`Analisis/24`: el techo lo pone la latencia del
 * candado, que consulta cada calendario; no prometer más sin el arreglo del §4).
 *
 * BYOC 50/2.000 con los límites de catálogo y agendas de Pro (`Analisis/39`,
 * decisión de Andres del 23/09: las dos modalidades conviven). El comercio trae
 * su portafolio verificado, su número y su tarjeta; Meta le factura a él. Está
 * acá y no suelto en la cuenta porque un pago de mensualidad solo acepta planes
 * de este catálogo (`prepago.ts`, `montoUsdDe`) y porque `montoMensual` se
 * deriva de `precioUsd`: un límite escrito a mano dejaría la cuenta diciendo un
 * precio que no es el contratado.
 *
 * EL TOPE DE 2.000 SE FIJÓ CONTRA GEMINI, que es lo que corre en los cinco
 * flujos. Con Claude Haiku 4.5 el equilibrio cae a 1.542 conversaciones y con
 * Sonnet 5 a 771: **cambiar el modelo de un comercio BYOC sin rehacer esta
 * cuenta lo pone a perder plata** (`Analisis/39` §2). Desde F1 el modelo es
 * un dato del tenant (`tenants/{t}.modelo`, `central/ejes.ts`), así que se
 * puede comprobar en vez de suponer.
 *
 * BYOC YA NO DICE QUIÉN PAGA META (F1, `Analisis/41` §4): eso es la
 * titularidad del número. Lo que BYOC sigue siendo es un plan del catálogo con
 * 2.000 conversaciones por USD 50, que se asigna a un comercio cuyo número es
 * de titularidad `comercio`. Las dos cosas se escriben por separado
 * (`asignarNumero` / `asignarEjes` el número; `actualizarEstadoCuenta` /
 * `asignar-plan.mjs` el plan) y la migración `migrar-ejes.mjs` deja las dos
 * coherentes para los que ya existen.
 *
 * CAMBIOS INCLUIDOS 0 / 1 / 2 / 2 (propuesta del 25/09/2026, a confirmar por
 * Andres). El criterio: Impulso es autoservicio (su consola es el cambio); en
 * Crecimiento y Pro, uno o dos cambios operados por NovuChat al mes son
 * soporte, no obra; y lo que se vendió por encima («hasta 4», `Analisis/40`
 * §5.2) va en la COPIA de esa cuenta (`limites.cambiosIncluidos`), como todo
 * contrato a medida, marcado POR CONTRATO (`limitesPorContrato`,
 * `copiaDeLimites` más abajo) para que un cambio de plan no lo pise. `Analisis/40` valuó el cambio suelto en USD 15: incluir
 * más de dos en un plan de USD 50 lo regala.
 */
export const PLANES: Readonly<Record<IdPlanVendible, Readonly<Plan>>> = {
  impulso: {
    nombre: 'Impulso', precioUsd: 25, conversaciones: 100, productos: 20, agendas: 1,
    campanas: 0, cambiosIncluidos: 0,
  },
  crecimiento: {
    nombre: 'Crecimiento', precioUsd: 50, conversaciones: 220, productos: 100, agendas: 5,
    campanas: 3, cambiosIncluidos: 1,
  },
  pro: {
    nombre: 'Pro', precioUsd: 90, conversaciones: 500, productos: 500, agendas: 10,
    campanas: MAXIMO_CAMPANAS, cambiosIncluidos: 2,
  },
  byoc: {
    nombre: 'BYOC', precioUsd: 50, conversaciones: 2000, productos: 500, agendas: 10,
    campanas: MAXIMO_CAMPANAS, cambiosIncluidos: 2,
  },
};

/**
 * LOS QUE PUBLICA EL SITIO, en el orden en que se muestran. `Novuchat-site`
 * (`src/contenido/precios.es.ts`) y la «Base comercial» de `CLAUDE.md` §3 dicen
 * estos tres y solo estos tres; `pruebas/planes.test.ts` lo verifica.
 *
 * BYOC no está acá a propósito: se ofrece caso por caso, contra un portafolio
 * verificado del comercio, y su precio no se puede comparar de frente con los
 * publicados porque no incluye el consumo de Meta (`Analisis/39` §4).
 */
export const PLANES_PUBLICADOS = ['impulso', 'crecimiento', 'pro'] as const;

/**
 * YA NO EXISTE UN PLAN DE DEMOSTRACIÓN (F1, `Analisis/41` §4 y §6.1.7). Hasta
 * el 25/09 acá vivía un plan interno con los límites de Pro y precio cero, y
 * `plan: 'demostracion'` mandaba sobre la modalidad. Eso mezclaba dos ejes:
 * qué límites rigen (el plan) y si se cobra (la modalidad). Un demo es ahora
 * un tenant con `modalidad: 'demostracion'` y un plan del catálogo; el precio
 * cero, el «nunca se corta» y el «sin cobranza» los decide la modalidad en
 * `prepago.ts`, como siempre lo hizo para las cuentas sin plan de demo.
 *
 * ESTA CONSTANTE ES UN PUENTE NULO: `web/src/lib/planes.ts` la reexporta y la
 * consola es zona de otro agente. Cuando esa reexportación se quite, esta
 * línea se borra. Ningún módulo del servidor, script ni prueba la usa
 * (`pruebas/central/ejes.test.ts` lo verifica).
 *
 * @deprecated Sin reemplazo: un demo es modalidad `demostracion` + un plan.
 */
export const PLAN_DEMOSTRACION = null;

/**
 * Todo lo que se puede asignar a una cuenta. Desde F1 es EL CATÁLOGO: ya no
 * hay un plan interno además de los vendibles. Es EL MISMO OBJETO que
 * `PLANES`; se conserva el nombre porque la consola (`web/src/lib/planes.ts`,
 * `web/src/lib/prepago.ts`) y varias pruebas lo importan. El tipo declara la
 * clave `'demostracion'` por el puente de `IdPlan` (arriba): en tiempo de
 * ejecución NO existe, y como `esIdPlan` nunca la da por válida, nadie llega a
 * indexarla. Es la única conversión de tipo del archivo, y se va con el puente.
 *
 * @deprecated En el servidor, `PLANES`.
 */
export const PLANES_ASIGNABLES = PLANES as unknown as Readonly<Record<IdPlan, Readonly<Plan>>>;

/**
 * EL RESPALDO ES EL PLAN MÁS CHICO. Un comercio sin copia de límites y con un
 * plan que no está en el catálogo (el `'basico'` que escribían las altas viejas)
 * se trata como Impulso: ante la duda, se falla hacia el límite menor, nunca
 * hacia el mayor.
 */
export const PLAN_POR_DEFECTO: IdPlanVendible = 'impulso';

/**
 * LA BOLSA: 30 conversaciones por USD 10, que no vencen (`Analisis/23`). El
 * precio mínimo depende del bloque de 25 (`atencion.ts`): si el bloque sube,
 * hay que recalcularla. El sitio la llama «excedente»; acá, y en la consola, es
 * «bolsa» (decisión de Andres, 15/09).
 */
export const BOLSA = { conversaciones: 30, precioUsd: 10 } as const;

/** Instalación estándar, llave en mano, en dólares. */
export const INSTALACION_USD = 65;

/**
 * AVISO DE CONSUMO: fracción de las conversaciones incluidas a la que se le
 * avisa al comercio, una vez por mes. Es lo que promete el sitio («te avisamos
 * al llegar al 80 % de tu plan»). No manda ningún WhatsApp: se anota en la
 * cuenta y lo muestra la consola.
 */
export const AVISO_CONSUMO = 0.8;

/**
 * Cota de cordura de un límite copiado en una cuenta. No es una opinión
 * comercial: es un seguro contra un dato corrupto o un cero de más, que dejaría
 * a un comercio sin techo. Un límite fuera de rango se descarta y rige el del
 * plan.
 */
export const LIMITE_MAXIMO = 100_000;

// -----------------------------------------------------------------------------
// LECTURAS
// -----------------------------------------------------------------------------

/**
 * ¿Es un identificador de plan del catálogo? Se mira con `hasOwnProperty`, no
 * con `in`: `'toString' in PLANES` es verdadero y no es un plan. Desde F1
 * `'demostracion'` NO es un plan: una cuenta que todavía lo diga (sin migrar)
 * cae en el respaldo, el más chico, como cualquier plan desconocido.
 */
export function esPlanVendible(v: unknown): v is IdPlanVendible {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLANES, v);
}

/**
 * EL MISMO PREDICADO, con el tipo puente `IdPlan` (ver arriba): existe para la
 * consola, que no puede cambiar en este PR. Nunca da por válido
 * `'demostracion'`: el catálogo no lo tiene.
 *
 * @deprecated En el servidor, `esPlanVendible`.
 */
export function esIdPlan(v: unknown): v is IdPlan {
  return esPlanVendible(v);
}

/**
 * ¿Puede un comercio PAGARSE este plan por su cuenta? SOLO EL QUE YA TIENE
 * (decisión de Andres, 26/09/2026, en la revisión del PR #212). El cambio de
 * plan —subir o bajar— lo hace NovuChat, por Negocios (`actualizarEstadoCuenta`),
 * por un pago manual del propietario o por `asignar-plan.mjs`; el comercio
 * renueva. Hasta el 26/09 podía pagarse cualquiera de los publicados, y pagar
 * una mensualidad FIJA el plan (`aplicarPago`): una baja de Pro a Impulso era
 * apretar «Pagar», sin que nadie de NovuChat lo viera ni conversara el
 * contrato (que un cambio de plan conserva, `copiaDeLimites`).
 *
 * Un plan que no es del catálogo (una cuenta sin plan, o con el `'basico'` de
 * las altas viejas) no se renueva: primero NovuChat le asigna uno. Es la regla
 * de `planesQuePuedePagar` (`web/src/lib/pagar.ts`) hecha cumplir en el
 * servidor (CLAUDE.md, «Base comercial» §7): la pantalla solo la acompaña. El
 * propietario no pasa por acá.
 */
export function planQuePuedePedir(planActual: unknown, pedido: unknown): boolean {
  return esPlanVendible(pedido) && planActual === pedido;
}

/**
 * Los límites de un plan del catálogo, o sea LA COPIA que se escribe en la
 * cuenta al asignarlo. Uno desconocido da los del más chico. Desde F1 la copia
 * lleva también `cambiosIncluidos`; `campanas` sigue afuera (ver `Plan`).
 */
export function limitesDe(plan: unknown): Limites {
  const p = esPlanVendible(plan) ? PLANES[plan] : PLANES[PLAN_POR_DEFECTO];
  return {
    conversaciones: p.conversaciones, productos: p.productos, agendas: p.agendas,
    cambiosIncluidos: p.cambiosIncluidos,
  };
}

/**
 * LO QUE NACE EN `cuenta/estado` AL DAR DE ALTA UN COMERCIO: el plan más chico
 * con su copia de límites y la versión del catálogo. Lo usan `altaTenant`
 * (index.ts), `scripts/alta-comercio.mjs` y el sembrador local, para que las
 * tres altas escriban lo mismo. Antes escribían `plan: 'basico'`, que no es un
 * plan del catálogo y no traía copia: el comercio caía en el respaldo sin que
 * nadie lo supiera. Subir de plan después es `asignar-plan.mjs` o
 * `actualizarEstadoCuenta`.
 */
export function cuentaInicial(): { plan: IdPlanVendible; limites: Limites; catalogoPlanes: string } {
  return { plan: PLAN_POR_DEFECTO, limites: limitesDe(PLAN_POR_DEFECTO), catalogoPlanes: CATALOGO_PLANES };
}

const limiteValido = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LIMITE_MAXIMO;

/**
 * LAS CONVERSACIONES QUE SE PUEDEN COPIAR A UNA CUENTA: la MISMA validación con
 * que `limitesDeCuenta` las lee (entero de 1 a `LIMITE_MAXIMO`). Se exporta
 * para `actualizarEstadoCuenta` y `asignar-plan.mjs --conversaciones`: un
 * valor que el lector descartaría (y cambiaría en silencio por el del plan)
 * no se deja escribir.
 */
export const conversacionesValidas = limiteValido;

/**
 * `cambiosIncluidos` admite 0, y su techo es otro: es la excepción de `Limites`.
 * Se exporta porque es LA validación: la usan `limitesDeCuenta` al leer, y
 * `actualizarEstadoCuenta` y `asignar-plan.mjs --cambios` al escribir un valor
 * por contrato. Un valor que el lector descartaría no se deja escribir.
 */
export const cambiosIncluidosValidos = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAXIMO_CAMBIOS_INCLUIDOS;

export interface LimitesDeCuenta extends Limites {
  /**
   * De dónde salieron: `cuenta` si la copia estaba completa y sana; `plan` si
   * faltaba (en todo o en parte) y el plan de la cuenta es del catálogo;
   * `respaldo` si hubo que caer en el plan más chico.
   */
  origen: 'cuenta' | 'plan' | 'respaldo';
}

/**
 * LOS LÍMITES QUE RIGEN PARA UNA CUENTA. Es la función que usa quien hace
 * cumplir un límite.
 *
 * Manda la COPIA (`cuenta.limites`), que es lo que se contrató. Sin copia —los
 * comercios dados de alta antes del 15/09— rigen los del plan, si el plan es
 * del catálogo, y si no, los de Impulso. Cada límite se decide por separado: un
 * `productos` corrupto en la copia no invalida las conversaciones.
 *
 * `origen` se juzga con los TRES límites de siempre, no con `cambiosIncluidos`:
 * ese llegó en F1 y las copias anteriores no lo traen; hasta que
 * `migrar-ejes.mjs` lo agregue, rige el del plan sin que la copia deje de ser
 * «de la cuenta» para los otros tres (que es lo que miran las reglas).
 */
export function limitesDeCuenta(cuenta: Record<string, unknown> | null | undefined): LimitesDeCuenta {
  const delPlan = limitesDe(cuenta?.['plan']);
  const crudo = cuenta?.['limites'];
  const copia = typeof crudo === 'object' && crudo !== null ? crudo as Record<string, unknown> : {};
  const elegir = (k: 'conversaciones' | 'productos' | 'agendas'): number => {
    const v = copia[k];
    return limiteValido(v) ? v : delPlan[k];
  };
  const completa = (['conversaciones', 'productos', 'agendas'] as const)
    .every((k) => limiteValido(copia[k]));
  const cambios = copia['cambiosIncluidos'];
  return {
    conversaciones: elegir('conversaciones'),
    productos: elegir('productos'),
    agendas: elegir('agendas'),
    cambiosIncluidos: cambiosIncluidosValidos(cambios) ? cambios : delPlan.cambiosIncluidos,
    origen: completa ? 'cuenta' : esPlanVendible(cuenta?.['plan']) ? 'plan' : 'respaldo',
  };
}

/**
 * LAS CAMPAÑAS QUE PUEDE TENER UNA CUENTA A LA VEZ. Como `limitesDeCuenta`:
 * manda la copia `cuenta.limites.campanas` si es un entero de 0 a
 * `MAXIMO_CAMPANAS` (lo contratado, o lo que NovuChat le fijó a mano); si no,
 * el número del plan; y si el plan no es del catálogo, el del más chico.
 * Nunca más de `MAXIMO_CAMPANAS`, lo diga quien lo diga.
 */
export function limiteDeCampanas(cuenta: Record<string, unknown> | null | undefined): number {
  const crudo = cuenta?.['limites'];
  const copia = typeof crudo === 'object' && crudo !== null ? (crudo as Record<string, unknown>)['campanas'] : undefined;
  if (typeof copia === 'number' && Number.isInteger(copia) && copia >= 0 && copia <= MAXIMO_CAMPANAS) return copia;
  const plan = cuenta?.['plan'];
  return esPlanVendible(plan) ? PLANES[plan].campanas : PLANES[PLAN_POR_DEFECTO].campanas;
}

// -----------------------------------------------------------------------------
// VALORES POR CONTRATO: lo que la copia dice distinto del plan, a propósito
// -----------------------------------------------------------------------------

/**
 * LAS CLAVES DE LA COPIA QUE PUEDEN IR POR CONTRATO: `cambiosIncluidos` y
 * `conversaciones`.
 *
 *  - `cambiosIncluidos` (#212) es la que ya se vendió por encima del plan
 *    («hasta 4 cambios al mes» con un plan que trae 2, `Analisis/40` §5.2).
 *  - `conversaciones` (F1b, DECISIÓN DE ANDRES DEL 26/09/2026). Hasta F1b este
 *    comentario decía que fijarlas por contrato «es un plan a medida, no un
 *    ajuste de la copia». Andres decidió lo contrario: el plan a medida ES la
 *    copia por contrato (`Analisis/40` §8, opción D, «vitrina en código,
 *    mostrador por contrato»), y un contrato de 500 conversaciones por USD 120
 *    se escribe con `--conversaciones 500 --precio 120`, sin una entrada de
 *    catálogo por cliente. Como cambian lo que cuesta atender al comercio, van
 *    SIEMPRE junto a un precio decidido a propósito (`precioPorContrato`, más
 *    abajo): el operador lo ve en el seco y en Negocios.
 *
 * `productos` y `agendas` siguen FUERA: los hacen cumplir las reglas de
 * Firestore contra la copia, y la de agendas tiene un techo técnico (la
 * latencia del candado, `Analisis/24`), no comercial. Abrirlas es otra
 * decisión, con su prueba.
 */
export const CLAVES_POR_CONTRATO = ['cambiosIncluidos', 'conversaciones'] as const;
export type ClavePorContrato = (typeof CLAVES_POR_CONTRATO)[number];
export const esClavePorContrato = (v: unknown): v is ClavePorContrato =>
  typeof v === 'string' && (CLAVES_POR_CONTRATO as readonly string[]).includes(v);

/**
 * LA VALIDACIÓN DE CADA CLAVE POR CONTRATO, la misma con que se LEE
 * (`limitesDeCuenta`): `cambiosIncluidos` de 0 a `MAXIMO_CAMBIOS_INCLUIDOS`;
 * `conversaciones` de 1 a `LIMITE_MAXIMO`. Un valor que el lector
 * descartaría no cuenta como contrato ni se deja escribir.
 */
export const valorPorContratoValido = (clave: ClavePorContrato, v: unknown): v is number =>
  clave === 'cambiosIncluidos' ? cambiosIncluidosValidos(v) : conversacionesValidas(v);

/** El rango de cada clave, dicho en palabras, para los mensajes de rechazo. */
export const RANGO_POR_CONTRATO: Readonly<Record<ClavePorContrato, string>> = {
  cambiosIncluidos: `un entero de 0 a ${MAXIMO_CAMBIOS_INCLUIDOS}`,
  conversaciones: `un entero de 1 a ${LIMITE_MAXIMO}`,
};

/**
 * EL MARCADOR: `cuenta/estado.limitesPorContrato`, la lista de claves de la
 * copia que se fijaron por contrato. POR QUÉ UN MARCADOR Y NO UNA COMPARACIÓN.
 * «La copia dice 4 y el plan dice 2» no distingue un contrato de una copia
 * escrita con un catálogo anterior (el plan cambió de número después) ni de
 * un dato corrupto; y «la copia dice 2 y el plan dice 2» no distingue un
 * contrato que casualmente coincide con el plan de uno que no existe. Solo
 * quien fija el valor sabe que es por contrato, así que lo escribe.
 *
 * POR QUÉ FUERA DE `limites` y no adentro. `limites` es la copia que leen las
 * reglas y los que hacen cumplir un límite, y hay escritores que la reemplazan
 * entera; un marcador adentro se iría con ella sin dejar rastro. Afuera, un
 * escritor que no lo conoce solo puede pisar el VALOR, y la cuenta queda
 * diciendo «por contrato» con el número del plan: una incoherencia visible,
 * no un contrato borrado en silencio.
 *
 * Una clave cuenta como por contrato solo si está en el marcador Y la copia
 * trae un valor sano: sin valor sano rige el del plan (`limitesDeCuenta`), y
 * decir «por contrato» sobre un número que no rige sería mentir.
 */
export function porContratoDe(cuenta: Record<string, unknown> | null | undefined): ClavePorContrato[] {
  const marcador = cuenta?.['limitesPorContrato'];
  if (!Array.isArray(marcador)) return [];
  const crudo = cuenta?.['limites'];
  const copia = typeof crudo === 'object' && crudo !== null ? crudo as Record<string, unknown> : {};
  return CLAVES_POR_CONTRATO.filter((k) => marcador.includes(k) && valorPorContratoValido(k, copia[k]));
}

/** ¿El marcador guardado es exactamente esta lista? Para no reescribirlo si no cambia. */
export function mismoMarcador(cuenta: Record<string, unknown> | null | undefined, claves: readonly ClavePorContrato[]): boolean {
  const marcador = cuenta?.['limitesPorContrato'];
  const guardado = Array.isArray(marcador) ? marcador : [];
  return guardado.length === claves.length && claves.every((k) => guardado.includes(k));
}

/** Lo que se pide sobre la copia: un plan nuevo, un valor por contrato, o las dos cosas. */
export interface PedidoDeCopia {
  /** Cambio de plan: la copia pasa a ser la del plan, SALVO lo que va por contrato. */
  plan?: IdPlanVendible;
  /**
   * Un entero válido (`cambiosIncluidosValidos`) lo fija POR CONTRATO; `null`
   * lo QUITA y vuelve a regir el del plan. Ausente, no se toca (y si estaba
   * por contrato, un cambio de plan lo conserva).
   */
  cambiosIncluidos?: number | null;
  /**
   * Lo mismo para las conversaciones incluidas al mes (F1b): un entero válido
   * (`conversacionesValidas`) las fija POR CONTRATO; `null` las quita.
   */
  conversaciones?: number | null;
}

export interface CopiaNueva {
  /** La copia entera que se escribe en `cuenta/estado.limites`. */
  limites: Record<string, unknown>;
  /** El marcador que queda (`cuenta/estado.limitesPorContrato`). */
  porContrato: ClavePorContrato[];
  /** Lo que un cambio de plan CONSERVÓ por contrato, con su valor. Vacío si nada. */
  conservados: Partial<Record<ClavePorContrato, number>>;
  /** Los límites del plan que queda rigiendo, para decir «el plan trae…». */
  delPlan: Limites;
}

/**
 * LA COPIA QUE QUEDA DESPUÉS DE UN PEDIDO. PURA: la usan `actualizarEstadoCuenta`
 * (la consola de Plataforma), `aplicacionDe` en `pagos.ts` (pagar otro plan es
 * cambiar de plan) y `asignar-plan.mjs`, para que los tres escritores de la
 * copia decidan igual.
 *
 * LA REGLA (Andres, recomendación de la revisión de F1): UN CAMBIO DE PLAN
 * CONSERVA LOS VALORES POR CONTRATO. Hasta este bloque, cambiar el plan
 * reescribía la copia entera con `limitesDe(plan)` y un contrato de 4 cambios
 * volvía a 2 sin que nadie lo decidiera. Quitar un valor por contrato es una
 * acción explícita (`cambiosIncluidos: null`, `--cambios plan`; lo mismo
 * `conversaciones: null`, `--conversaciones plan`).
 *
 * Sin cambio de plan se toca SOLO la clave pedida: el resto de la copia queda
 * como estaba (incluidas claves que este módulo no gobierna, como `campanas`).
 * Con cambio de plan la copia es la del plan, como siempre, más lo conservado.
 * Las dos claves siguen la MISMA regla: el bucle es uno solo, para que abrir
 * una tercera no sea copiar un bloque y olvidarse de una rama.
 */
export function copiaDeLimites(cuenta: Record<string, unknown> | null | undefined, pedido: PedidoDeCopia): CopiaNueva {
  const planVigente = pedido.plan ?? (esPlanVendible(cuenta?.['plan']) ? cuenta?.['plan'] as IdPlanVendible : PLAN_POR_DEFECTO);
  const delPlan = limitesDe(planVigente);
  const crudo = cuenta?.['limites'];
  const actual = typeof crudo === 'object' && crudo !== null ? crudo as Record<string, unknown> : {};
  const previos = porContratoDe(cuenta);

  const limites: Record<string, unknown> = pedido.plan ? { ...delPlan } : { ...actual };
  const porContrato = new Set<ClavePorContrato>(previos);
  const conservados: Partial<Record<ClavePorContrato, number>> = {};

  if (pedido.plan) {
    for (const k of previos) {
      if (pedido[k] !== undefined) continue;
      limites[k] = actual[k];
      conservados[k] = actual[k] as number;
    }
  }
  for (const k of CLAVES_POR_CONTRATO) {
    const pedidoK = pedido[k];
    if (pedidoK === undefined) continue;
    if (pedidoK === null) {
      porContrato.delete(k);
      limites[k] = delPlan[k];
      continue;
    }
    if (!valorPorContratoValido(k, pedidoK)) {
      throw new RangeError(`${k} tiene que ser ${RANGO_POR_CONTRATO[k]}`);
    }
    porContrato.add(k);
    limites[k] = pedidoK;
  }
  return {
    limites,
    porContrato: CLAVES_POR_CONTRATO.filter((k) => porContrato.has(k)),
    conservados,
    delPlan,
  };
}

// -----------------------------------------------------------------------------
// EL PRECIO POR CONTRATO: la mensualidad pactada, distinta de la del plan
// -----------------------------------------------------------------------------

/**
 * EL TECHO DE UNA MENSUALIDAD POR CONTRATO, EN DÓLARES. Como
 * `MAXIMO_CAMBIOS_INCLUIDOS`: un seguro contra un dato corrupto o un cero de
 * más, no una opinión comercial. El plan más caro de lista es de USD 90 y el
 * contrato a medida más grande conversado, de USD 120 (`Analisis/41` §4, punto 5):
 * USD 1.000 cabe de sobra y todavía frena un «12000» tipeado por «120».
 */
export const MAXIMO_PRECIO_POR_CONTRATO_USD = 1000;

/**
 * ¿Es un precio mensual por contrato aceptable? Positivo (sin cobro es la
 * MODALIDAD `demostracion`, no un precio cero), hasta
 * `MAXIMO_PRECIO_POR_CONTRATO_USD`, y con dos decimales como mucho: la lista
 * se denomina en dólares con centavos, y un tercer decimal es un precio que
 * ninguna factura reproduce. Es LA validación: la usan quien escribe
 * (`actualizarEstadoCuenta`, `asignar-plan.mjs --precio`) y quien lee
 * (`precioPorContratoDe`).
 */
export const precioPorContratoValido = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAXIMO_PRECIO_POR_CONTRATO_USD
  && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;

/**
 * EL PRECIO POR CONTRATO DE UNA CUENTA (`cuenta/estado.precioPorContrato`, en
 * USD), o `null` si no tiene uno sano.
 *
 * POR QUÉ UN CAMPO PROPIO Y NO UNA CLAVE DE `limites` CON MARCADOR. Las claves
 * de la copia necesitan el marcador porque hay escritores que reescriben
 * `limites` entera (un cambio de plan, un pago de otro plan): sin marcador, un
 * 4 por contrato no se distingue de un 4 del catálogo. El precio NO tiene ese
 * problema: nadie más lo escribe, y su sola presencia dice «por contrato».
 * Por eso tampoco hace falta conservarlo a mano en un cambio de plan: ningún
 * escritor del plan lo toca, y se quita solo con `--precio plan` o
 * `precioPorContrato: null`.
 *
 * Un valor presente y malo se IGNORA y rige el del plan, como una clave rota
 * de la copia: decir «por contrato» sobre un número que no rige sería mentir.
 */
export function precioPorContratoDe(cuenta: Record<string, unknown> | null | undefined): number | null {
  const v = cuenta?.['precioPorContrato'];
  return precioPorContratoValido(v) ? v : null;
}

/**
 * LA MENSUALIDAD QUE RIGE PARA UNA CUENTA, EN DÓLARES: la del contrato si
 * tiene una; si no, la del plan. `plan` es el plan de la mensualidad que se
 * está cobrando (un QR de otro plan firmado por el propietario); ausente, el
 * de la cuenta; uno desconocido, el más chico.
 *
 * EL CONTRATO MANDA SOBRE CUALQUIER PLAN. Un contrato fija el precio del
 * comercio, no el de un plan: con `precioPorContrato: 120` la mensualidad es
 * USD 120 con el plan que tenga, igual que un cambio de plan conserva las
 * conversaciones por contrato. Volver al precio de lista es una acción
 * explícita (`--precio plan`), nunca un efecto de cambiar de plan.
 *
 * La usan `estadoDeServicio` (la mensualidad derivada y `montoMensual`),
 * `montoUsdDe` (el importe del QR y del pago manual), la cobranza y la
 * consola: el mismo número en los cuatro lados.
 */
export function precioMensualDe(cuenta: Record<string, unknown> | null | undefined, plan?: unknown): number {
  const contrato = precioPorContratoDe(cuenta);
  if (contrato !== null) return contrato;
  const p = plan ?? cuenta?.['plan'];
  return esPlanVendible(p) ? PLANES[p].precioUsd : PLANES[PLAN_POR_DEFECTO].precioUsd;
}

/**
 * Redondea un importe en dólares a centavos. Con un precio por contrato de
 * USD 33,33, tres meses son 99,99 y no 99,99000000000001: el importe que
 * viaja a un pago y a una auditoría tiene que ser el que se lee.
 */
export const aCentavos = (usd: number): number => Math.round(usd * 100) / 100;

// -----------------------------------------------------------------------------
// EL AVISO DE CONSUMO
// -----------------------------------------------------------------------------

/**
 * EL PERÍODO del conteo mensual, `AAAA-MM`: el id del agregado
 * `metricas/{periodo}` y el `mes` del aviso de consumo. Es el mes en UTC, como
 * lo calculó siempre la ingesta. Está acá para que la consola compare el aviso
 * con EL MISMO período con que lo marcó el servidor: con otro cálculo (UTC−4)
 * el aviso se escondía, o se mostraba vencido, cuatro horas por mes.
 */
export function periodoDe(ahoraMs: number = Date.now()): string {
  return new Date(ahoraMs).toISOString().slice(0, 7);
}

/** Lo que se anota en `cuenta/estado.avisoConsumo` (más `en`, que pone el servidor). */
export interface AvisoConsumo {
  /** Mes del aviso, `AAAA-MM`, el mismo período que el agregado de métricas. */
  mes: string;
  /** Fracción que disparó el aviso (`AVISO_CONSUMO` al momento de avisar). */
  umbral: number;
  /** Conversaciones del mes al avisar, contando la que lo disparó. */
  conversaciones: number;
  /** Conversaciones incluidas contra las que se midió. */
  limite: number;
}

/**
 * A partir de cuántas conversaciones se avisa. Se redondea hacia arriba, y con
 * un margen contra el error de coma flotante: el 80 % de 220 es 176, no
 * 176,00000000000003 (que redondeado hacia arriba daría 177).
 */
export function umbralDeAviso(limite: number): number {
  return Math.ceil(limite * AVISO_CONSUMO - 1e-9);
}

/** ¿Falta avisar este mes? Falso si la cuenta ya tiene el aviso del mes. */
export function avisoConsumoPendiente(
  cuenta: Record<string, unknown> | null | undefined, mes: string,
): boolean {
  const previo = cuenta?.['avisoConsumo'];
  return !(typeof previo === 'object' && previo !== null
    && (previo as Record<string, unknown>)['mes'] === mes);
}

/**
 * ¿Hay que avisar AHORA? Devuelve el aviso a anotar, o `null`.
 *
 * UNA VEZ POR MES: si la cuenta ya tiene el aviso de este mes, no se repite
 * aunque el consumo siga subiendo. Se compara con `>=` y no con `===`: si los
 * límites bajaron a mitad de mes (un cambio de plan) y el comercio ya estaba
 * por encima, el aviso sale igual con la siguiente conversación.
 */
export function avisoDeConsumo(
  cuenta: Record<string, unknown> | null | undefined,
  conversacionesDelMes: number,
  mes: string,
): AvisoConsumo | null {
  if (!avisoConsumoPendiente(cuenta, mes)) return null;
  if (typeof conversacionesDelMes !== 'number' || !Number.isFinite(conversacionesDelMes)) return null;
  const limite = limitesDeCuenta(cuenta).conversaciones;
  if (conversacionesDelMes < umbralDeAviso(limite)) return null;
  return { mes, umbral: AVISO_CONSUMO, conversaciones: Math.trunc(conversacionesDelMes), limite };
}
