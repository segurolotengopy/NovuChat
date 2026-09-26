/**
 * =============================================================================
 * EL REGISTRO DE MÓDULOS — un archivo, nueve manifiestos (`Analisis/41` §3)
 * =============================================================================
 *
 * Es la pieza con nombre propio de la arquitectura por capas: la lista de los
 * módulos que un tenant puede tener encendidos, cada uno con su manifiesto
 * (configuración, colecciones, límites, pestañas, herramientas, Functions,
 * ganchos y los mensajes que agrega por conversación). De acá se derivan, en
 * F2 y F3, las siete copias de hoy (`Analisis/41` §3.3): la tabla de flujos de
 * la consola (`web/src/lib/flujos.ts`), `VERTICALES` de `index.ts`,
 * `VERTICALES_CONOCIDOS` y `documentoDeVertical` de `prompt.ts`, las
 * capacidades de `firestore.rules`, y las elecciones a mano de `cobro.ts`,
 * `catalogoWeb.ts` y `captacion.ts`.
 *
 * F2, PR 1: ESTE ARCHIVO TODAVÍA NO LO IMPORTA NADIE. Existe, se verifica
 * contra el código de hoy (`pruebas/core/registro.test.ts`) y mide cuánto del
 * árbol cabe en las zonas (`scripts/medir-zonas.mjs`). Los PR siguientes lo
 * enchufan donde hoy están las copias.
 *
 * CERO `import`, Y ES A PROPÓSITO. Lo importan cuatro mundos que no comparten
 * resolución de módulos: las Functions (compilan con `rootDir: src` e importan
 * `./registro.js`), la consola (Vite, `../../../functions/src/registro`, como
 * ya hace con `planes.ts`, `prepago.ts`, `atencion.ts` y `central/ejes.ts`),
 * las pruebas (Vitest, con la extensión `.ts`) y los scripts `.mjs`, que Node
 * carga quitando los tipos. Node quita tipos pero NO traduce `./x.js` a
 * `./x.ts`: un solo `import` relativo y el archivo deja de cargarse desde un
 * script. Por eso también la sintaxis es solo la que Node sabe borrar: nada de
 * `enum`, `namespace` ni propiedades de parámetro; `as const` y `satisfies` sí.
 * La prueba del registro falla si aparece un `import`.
 *
 * EL REGISTRO NO LLEVA RUTAS DE ARCHIVOS QUE F2 MUEVE. Las carpetas de un
 * módulo se derivan de su id (`carpetasDe`); el inventario origen → destino de
 * la mudanza vive aparte, en `pruebas/core/destinos-f2.ts`, y se borra cuando
 * F2 termine.
 *
 * LO ESCRIBE LA COORDINADORA (`Analisis/41` §8.1): cada agente de módulo
 * escribe su carpeta y propone su línea acá.
 *
 * Cada campo dudoso del diseño («(i)») se resolvió leyendo el código del
 * 26/09/2026 (main 4b8a5fb); lo que no se pudo resolver sin cambiar código
 * queda con un comentario DUDA que dice qué pasa hoy y qué decide la revisora.
 */

/**
 * Los nueve módulos, EN ORDEN TOPOLÓGICO: cada uno aparece después de todo lo
 * que declara en `dependeDe`. El coordinador de turno (F3) recorre los módulos
 * encendidos en este orden, y la prueba verifica que se sostiene.
 */
export const IDS_MODULOS = [
  'productos', 'cobros', 'agenda', 'inventario', 'pedidos', 'catalogo-web',
  'campanas', 'captacion', 'menu-interactivo',
] as const;
export type IdModulo = (typeof IDS_MODULOS)[number];

/** Roles del comercio que pueden ver una pestaña (`claims.ts`). */
export type Rol = 'admin' | 'oper';

/** Los cinco ganchos del coordinador de turno (`Analisis/41` §2.3). */
export type Gancho = 'antesDelTurno' | 'despuesDelTurno' | 'alCierre' | 'alCambiarConfig' | 'programado';

/**
 * Las claves de límite que declara un módulo. Son claves de `PLANES`
 * (`planes.ts`); `conversaciones` es del core y `cambiosIncluidos` de Central,
 * así que no están acá (`Analisis/41` §4, consecuencia 4).
 */
export type ClaveLimiteDeModulo = 'productos' | 'agendas' | 'campanas';

export interface Pestana {
  /** Segmento de `/negocio/:tenantId/<ruta>` en `App.tsx`. Único en el registro. */
  readonly ruta: string;
  readonly titulo: string;
  /** Quién la ve. Hoy `flujos.ts` lo llama `roles` y su ausencia es `['admin']`. */
  readonly roles: readonly Rol[];
  /** La ve además el propietario de NovuChat (la instala y le da soporte). */
  readonly tambienPropietario?: true;
}

export interface DocumentoDeConfig {
  readonly documento: `config/${string}`;
  /** Lista blanca de lo que el comercio escribe (la regla la hace cumplir). */
  readonly campos: readonly string[];
  /** Lo que escribe SOLO el servidor; nunca en la lista blanca de la regla. */
  readonly camposDelServidor?: readonly string[];
  /** Otros módulos que declaran el mismo documento hoy (mientras no se parta). */
  readonly compartidoCon?: readonly IdModulo[];
}

export interface Limite {
  readonly clave: ClaveLimiteDeModulo;
  /**
   * Dónde se hace cumplir HOY. `pendiente` es un límite vendido que nadie
   * cuenta todavía (agendas: lo cierra F2, `Analisis/41` §7).
   */
  readonly hacerCumplir: 'reglas' | 'servidor' | 'reglas-y-servidor' | 'pendiente';
  readonly contador?: `contadores/${string}`;
}

export interface Manifiesto {
  readonly modulo: IdModulo;
  readonly nombre: string;
  /** Versión del módulo; `docs/versiones-por-cliente.md` la declara por tenant. */
  readonly version: number;
  readonly dependeDe: readonly IdModulo[];
  readonly configuracion: readonly DocumentoDeConfig[];
  /** Campos del módulo que HOY viven en `config/negocio` (lo común). */
  readonly camposEnNegocio: readonly string[];
  /** Colecciones bajo `tenants/{t}/`. Una subcolección se escribe `padre/hija`. */
  readonly colecciones: readonly string[];
  /** Colecciones en la raíz de la base, fuera del tenant. */
  readonly coleccionesRaiz: readonly string[];
  /** Prefijos de Storage bajo `tenants/{t}/`. */
  readonly almacenamiento: readonly string[];
  readonly limites: readonly Limite[];
  readonly pestanas: readonly Pestana[];
  /** Ranuras que aporta al Tablero central (el dato que hoy cuenta `Tablero.tsx`). */
  readonly tablero: readonly string[];
  /** Nodos-herramienta del agente en los flujos de n8n. */
  readonly herramientas: readonly string[];
  /** Functions exportadas por `index.ts` que son de este módulo. */
  readonly functions: readonly string[];
  /** Flujos programados de n8n (`Flujos/<nombre>.json`) que son de este módulo. */
  readonly flujosProgramados: readonly string[];
  readonly ganchos: readonly Gancho[];
  /**
   * Mensajes por conversación que agrega el módulo RESPECTO DE HOY. Cero en
   * toda la rearquitectura (CLAUDE.md, regla de zonas); se declara siempre.
   */
  readonly mensajes: 0;
}

/** Las carpetas de un módulo en cada runtime, derivadas del id. */
export const carpetasDe = (m: IdModulo) => ({
  functions: `admin/functions/src/modulos/${m}/`,
  web: `admin/web/src/modulos/${m}/`,
  flujos: `Flujos/src/modulos/${m}/`,
  pruebas: `admin/pruebas/modulos/${m}/`,
  prompt: `Flujos/prompts/modulos/${m}.md`,
  documento: `docs/arquitectura/modulos/${m}.md`,
}) as const;

export const REGISTRO = [
  {
    modulo: 'productos',
    nombre: 'Productos',
    version: 1,
    dependeDe: [],
    configuracion: [],
    camposEnNegocio: [],
    colecciones: ['catalogo', 'fotosCatalogo', 'comprobacionesImagen', 'contadores/catalogo'],
    coleccionesRaiz: [],
    almacenamiento: [],
    // `limiteProductos()` en las reglas (alta contada contra el contador) y
    // `importarCatalogo` en el servidor (`limiteCatalogo.ts`).
    limites: [{ clave: 'productos', hacerCumplir: 'reglas-y-servidor', contador: 'contadores/catalogo' }],
    // El título que ve el comercio sale de PUENTE_DE_FLUJOS[f].catalogo
    // («Servicios», «Productos» o «Catálogo»), como hoy `etiquetaCatalogo`.
    pestanas: [{ ruta: 'catalogo', titulo: 'Catálogo', roles: ['admin'] }],
    // (i) resuelto: el diseño decía `productosActivos`, pero `Tablero.tsx`
    // cuenta TODOS los documentos de `catalogo` (getCountFromServer), activos
    // o no. La ranura se llama como el dato que existe hoy.
    tablero: ['items'],
    herramientas: [],
    functions: ['importarCatalogo', 'comprobarImagenDelCatalogo', 'recomprobarImagen'],
    flujosProgramados: [],
    // El catálogo entero o resumido al prompt (`configuracionFlujo`).
    ganchos: ['antesDelTurno'],
    mensajes: 0,
  },
  {
    modulo: 'cobros',
    nombre: 'Cobros',
    version: 1,
    // DUDA (i): `Analisis/41` §3.2 dice «Pedidos o Agenda (quien cierra)».
    // Declararlo cerraría un ciclo con Agenda, que depende de Cobros por la
    // seña. En el código de hoy `cobro.ts`, `qrSimple.ts`, `dibujoQr.ts` y
    // `cotejo.ts` no importan nada de otro módulo; `cobroVenta.ts` importa UN
    // TIPO de `sena.ts` (`ResultadoCotejo`, de Agenda). Es un caso conocido
    // que `medir-zonas.mjs` lista: se resuelve en F2 llevando el tipo a Cobros
    // (`cotejo.ts`), sin cambiar lógica.
    dependeDe: [],
    // Cobros no tiene documento propio todavía (`config/cobros` es de F2): hoy
    // su estado vive en el documento del flujo que cobra, y `registrarQrDeCobro`
    // elige cuál («venta gana», DISENO §4duodecies.2). El comercio no escribe
    // ninguno de sus campos: los dos son del servidor.
    configuracion: [
      { documento: 'config/venta', campos: [], camposDelServidor: ['mediaIdQr', 'cobroReal'], compartidoCon: ['pedidos'] },
      { documento: 'config/agendamiento', campos: [], camposDelServidor: ['cobroReal'], compartidoCon: ['agenda'] },
    ],
    camposEnNegocio: [],
    colecciones: [],
    coleccionesRaiz: [],
    almacenamiento: [],
    limites: [],
    pestanas: [
      { ruta: 'cobros', titulo: 'Cobros', roles: ['admin'] },
      { ruta: 'cobro', titulo: 'Configuración de QR', roles: ['admin'] },
    ],
    tablero: [],
    herramientas: [],
    functions: ['registrarQrDeCobro', 'imagenDeCobro'],
    flujosProgramados: [],
    // Corregido respecto del diseño (que decía solo `despuesDelTurno`):
    // `configuracionFlujo` arma el cobro con `cobroParaElFlujo` (antes del
    // turno) e `ingesta` valida el monto con `totalUtilizable` (después).
    ganchos: ['antesDelTurno', 'despuesDelTurno'],
    mensajes: 0,
  },
  {
    modulo: 'agenda',
    nombre: 'Agenda',
    version: 1,
    // Solo para la seña: `sena.ts` importa `cotejo.ts` y `cobroVenta.ts`.
    dependeDe: ['cobros'],
    configuracion: [
      {
        documento: 'config/agendamiento',
        // La seña (`senaImporte`, `senaMinutosRetencion`) es de Agenda aunque
        // hoy se edite al pie de «Configuración de QR» (Cobros), porque sin QR
        // no hay seña que cobrar (`ConfiguracionVertical.tsx`).
        campos: [
          'duracionPorDefectoMin', 'anticipacionMinimaMin', 'anticipacionMaximaDias',
          'permitirCancelacion', 'horasRecordatorio', 'mensajeRecordatorio',
          'senaImporte', 'senaMinutosRetencion',
        ],
        compartidoCon: ['cobros'],
      },
    ],
    // Sale a `config/agenda` en F2 (migración por script, `Analisis/41` §5.2).
    camposEnNegocio: ['calendarioId'],
    colecciones: ['funcionarios', 'funcionarios/privado', 'agenda'],
    coleccionesRaiz: [],
    almacenamiento: [],
    // Vendido (1 / 5 / 10) y hoy SIN hacer cumplir: ni regla ni contador.
    limites: [{ clave: 'agendas', hacerCumplir: 'pendiente' }],
    pestanas: [{ ruta: 'agenda', titulo: 'Agenda', roles: ['admin'] }],
    tablero: ['agendas'],
    herramientas: ['consultar_disponibilidad', 'agendar_cita', 'buscar_mi_cita', 'cancelar_cita'],
    functions: ['cotejarComprobante', 'senaVencida', 'seguimientosPendientes', 'seguimientoEnviado'],
    flujosProgramados: [
      'agendamiento-seguimientos.json', 'agendamiento-senas-vencidas.json', 'demo-a-recordatorios.json',
    ],
    // Agregado `antesDelTurno` respecto del diseño: `configuracionFlujo` lee
    // `funcionarios` para el contexto. Después: la retención de la seña
    // (`senaVencidaPorTiempo`). Al cierre: la cita. Programado: recordatorios,
    // seguimientos y señas vencidas.
    ganchos: ['antesDelTurno', 'despuesDelTurno', 'alCierre', 'programado'],
    mensajes: 0,
  },
  {
    modulo: 'inventario',
    nombre: 'Inventario',
    version: 1,
    dependeDe: ['productos'],
    configuracion: [],
    camposEnNegocio: [],
    // El saldo (`stock`) es un campo de `catalogo`, de Productos; acá está el
    // historial. Ninguna de las dos la escribe el navegador.
    colecciones: ['movimientosStock'],
    coleccionesRaiz: [],
    almacenamiento: [],
    limites: [],
    pestanas: [{ ruta: 'inventario', titulo: 'Inventario', roles: ['admin'] }],
    tablero: [],
    herramientas: [],
    functions: ['ajustarStock', 'dejarDeControlarStock'],
    flujosProgramados: [],
    // Corregido respecto del diseño (que decía también `despuesDelTurno`): en
    // `ingesta.ts` Inventario solo aparece en `configuracionFlujo`
    // (`existencias`). El descuento por venta lo hace el checkout del carrito
    // (`catalogoWeb.ts` → `descontarPedido`), que no es un turno.
    ganchos: ['antesDelTurno'],
    mensajes: 0,
  },
  {
    modulo: 'pedidos',
    nombre: 'Pedidos',
    version: 1,
    // DUDA (i): el checkout (`checkoutCatalogo`, hoy dentro de `catalogoWeb.ts`)
    // descuenta stock con `descontarPedido` de `inventario.ts`. No se declara
    // `inventario` porque haría obligatorio Inventario para vender; la
    // revisora decide entre declararlo o volver el descuento un gancho de
    // Inventario. `medir-zonas.mjs` lo lista como importación entre módulos.
    dependeDe: ['productos'],
    configuracion: [
      {
        documento: 'config/venta',
        campos: [
          'costoDelivery', 'recargoFlota', 'radioEntregaKm', 'tiempoCocinaMin',
          'tiempoDespachoMin', 'pedidoMinimo', 'aceptaDelivery', 'aceptaRetiroEnLocal',
        ],
        compartidoCon: ['cobros'],
      },
    ],
    camposEnNegocio: [],
    colecciones: ['pedidos'],
    coleccionesRaiz: [],
    almacenamiento: [],
    limites: [],
    pestanas: [{ ruta: 'pedidos', titulo: 'Pedidos', roles: ['admin', 'oper'] }],
    tablero: [],
    herramientas: [],
    // (i) resuelto: `checkoutCatalogo` es la única Function que escribe
    // `pedidos` desde el carrito; hoy vive en `catalogoWeb.ts`, que F2 parte.
    functions: ['checkoutCatalogo'],
    flujosProgramados: [],
    ganchos: ['alCierre'],
    mensajes: 0,
  },
  {
    modulo: 'catalogo-web',
    nombre: 'Catálogo web',
    version: 1,
    // DUDA (i): `catalogoWeb.ts` importa `hayParaVender` de `inventario.ts`
    // para no ofrecer lo agotado. Igual que en Pedidos, no se declara: lo
    // decide la revisora junto con el caso de Pedidos.
    dependeDe: ['productos', 'pedidos'],
    // El logo vive aparte porque `config/negocio` viaja en cada turno
    // (firestore.rules, `logoValido`).
    configuracion: [{ documento: 'config/marca', campos: ['logo'] }],
    camposEnNegocio: ['catalogoWebActivo', 'paleta'],
    colecciones: [],
    coleccionesRaiz: ['fichasCatalogo'],
    almacenamiento: [],
    limites: [],
    pestanas: [],
    tablero: [],
    herramientas: [],
    functions: ['enlaceCatalogo', 'catalogoPublico', 'fijarWebhookCarrito', 'vistaPreviaCatalogo', 'fotoDeCatalogo'],
    flujosProgramados: [],
    // Agregado respecto del diseño: con `catalogoWebActivo`, `configuracionFlujo`
    // manda el catálogo RESUMIDO y el enlace al sitio en vez del catálogo entero.
    ganchos: ['antesDelTurno'],
    mensajes: 0,
  },
  {
    modulo: 'campanas',
    nombre: 'Campañas',
    version: 1,
    dependeDe: [],
    // `revision` y `vigentes` los escribe solo `verificarCampanas`.
    configuracion: [{ documento: 'config/campanas', campos: ['lista'], camposDelServidor: ['revision', 'vigentes'] }],
    camposEnNegocio: [],
    colecciones: [],
    coleccionesRaiz: [],
    almacenamiento: [],
    // `limiteCampanas()` en las reglas (marcador RESPALDO-CAMPANAS-POR-PLAN) y
    // `limiteDeCampanas` en el servidor, que recorta lo que viaja al flujo.
    limites: [{ clave: 'campanas', hacerCumplir: 'reglas-y-servidor' }],
    // Hoy es común: `App.tsx` la pinta para todo administrador.
    pestanas: [{ ruta: 'campanas', titulo: 'Campañas', roles: ['admin'] }],
    tablero: [],
    herramientas: [],
    functions: ['verificarCampanas'],
    flujosProgramados: [],
    ganchos: ['antesDelTurno', 'alCambiarConfig'],
    mensajes: 0,
  },
  {
    modulo: 'captacion',
    nombre: 'Captación',
    version: 1,
    // DUDA: `captacion.ts` importa `pedirConFrenos` y `tipoDeContenido` de
    // `imagenCatalogo.ts` (Productos). Son utilidades de red genéricas, no
    // del catálogo: el caso se resuelve sacándolas a un servicio, no
    // declarando Productos. `medir-zonas.mjs` lo lista.
    dependeDe: [],
    configuracion: [
      {
        documento: 'config/onboarding',
        campos: [
          'mensajeClienteActual', 'enlaceConsola', 'topeAviso', 'plantillaAviso',
          'rubros', 'planes', 'cargosUnicos', 'aclaraciones', 'archivoPlanes',
        ],
      },
    ],
    camposEnNegocio: [],
    colecciones: [],
    coleccionesRaiz: [],
    almacenamiento: ['captacion/'],
    limites: [],
    pestanas: [{ ruta: 'captacion', titulo: 'Captación', roles: ['admin'], tambienPropietario: true }],
    tablero: [],
    herramientas: [],
    functions: ['comprobarArchivoPlanes'],
    flujosProgramados: [],
    // Corregido respecto del diseño (que decía también `despuesDelTurno`): en
    // el servidor Captación solo aparece en `configuracionFlujo`
    // (`sanearCaptacion`). La ficha del prospecto la captura hoy el flujo.
    ganchos: ['antesDelTurno'],
    mensajes: 0,
  },
  {
    // Hoy es código de UN tenant: nodos propios dentro del JSON de su flujo.
    // F5 lo trae como módulo; hasta entonces el manifiesto está vacío.
    modulo: 'menu-interactivo',
    nombre: 'Menú interactivo',
    version: 1,
    dependeDe: [],
    configuracion: [],
    camposEnNegocio: [],
    colecciones: [],
    coleccionesRaiz: [],
    almacenamiento: [],
    limites: [],
    pestanas: [],
    tablero: [],
    herramientas: [],
    functions: [],
    flujosProgramados: [],
    ganchos: [],
    mensajes: 0,
  },
] as const satisfies readonly Manifiesto[];

export const esModulo = (v: unknown): v is IdModulo =>
  typeof v === 'string' && (IDS_MODULOS as readonly string[]).includes(v);

export function manifiestoDe(m: IdModulo): Manifiesto {
  const encontrado = (REGISTRO as readonly Manifiesto[]).find((x) => x.modulo === m);
  if (!encontrado) throw new Error(`Módulo sin manifiesto: ${m}`);
  return encontrado;
}

/**
 * TRANSITORIO: se borra con la migración `tenants.flujos` → `tenants.modulos`.
 *
 * Los tres flujos de hoy, expresados como módulos. Es el puente que deja
 * verificar el registro contra las copias actuales (`flujos.ts`, reglas,
 * `prompt.ts`, `index.ts`) sin mover nada: la prueba comprueba que las
 * pestañas de cada flujo son la unión de las de sus módulos, que cada
 * documento propio lo exige la capacidad del flujo, etc.
 *
 * `catalogo` es la etiqueta de la pestaña de catálogo; `capacidadEnReglas`, la
 * función de `firestore.rules` que hoy abre ese flujo.
 */
export const PUENTE_DE_FLUJOS = {
  agendamiento: {
    modulos: ['productos', 'cobros', 'agenda'],
    documento: 'agendamiento',
    catalogo: 'Servicios',
    capacidadEnReglas: 'tieneAgenda',
  },
  venta: {
    modulos: ['productos', 'cobros', 'inventario', 'pedidos', 'catalogo-web'],
    documento: 'venta',
    catalogo: 'Productos',
    capacidadEnReglas: 'tieneCobro',
  },
  onboarding: {
    modulos: ['productos', 'captacion'],
    documento: 'onboarding',
    catalogo: 'Catálogo',
    capacidadEnReglas: 'tieneOnboarding',
  },
} as const satisfies Record<string, {
  readonly modulos: readonly IdModulo[];
  readonly documento: string;
  readonly catalogo: string;
  readonly capacidadEnReglas: string;
}>;

/**
 * Módulos que hoy tiene TODO comercio, sin importar sus flujos: la consola los
 * pinta fuera de `flujos.ts` y las reglas no les exigen capacidad. Con
 * `tenants.modulos`, Productos queda en todo plan y Campañas se apaga con
 * límite 0 (`Analisis/41` §3.2).
 */
export const MODULOS_COMUNES_HOY = ['productos', 'campanas'] as const satisfies readonly IdModulo[];
