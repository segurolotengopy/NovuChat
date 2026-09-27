/**
 * =============================================================================
 * DESTINOS DE F2 — el inventario de `Analisis/41` §5, fila por fila, como dato
 * =============================================================================
 *
 * Qué es: la tabla origen → { zona, destino } que la mudanza de F2 sigue. La
 * lee `scripts/medir-zonas.mjs` para contar cuánto del árbol cabe hoy en las
 * zonas y qué queda afuera, y la leerán los agentes de módulo para saber qué
 * mueven. NO es el registro: el registro (`functions/src/registro.ts`) no
 * lleva rutas de archivos que F2 mueve. Esta tabla se borra cuando F2 termine,
 * porque entonces la carpeta ES la zona.
 *
 * CERO `import`, como el registro: la carga un `.mjs` con Node quitando tipos.
 *
 * Criterio: se transcribe el §5 tal como está. Donde el §5 agrupa y hubo que
 * elegir (las `lib/` de la consola «Central y Core», los módulos de
 * `Flujos/src/reservas/`), la entrada lleva `nota` con el porqué. Lo que el §5
 * no nombra NO se agrega acá: sale como «sin zona» en la medición, que es
 * exactamente lo que la medición tiene que mostrar.
 *
 * `seParte` lista las OTRAS zonas (o `modulo:<id>`) que tienen piezas en el
 * archivo: el §5 dice «se parte» o describe un cambio que lo parte.
 */

export type ZonaF2 = 'core' | 'coordinador' | 'central' | 'plataforma' | 'modulo' | 'tenants' | 'registro';

export interface DestinoF2 {
  readonly zona: ZonaF2;
  /** Id del módulo cuando `zona` es `modulo` (un id de `IDS_MODULOS`). */
  readonly modulo?: string;
  /** Carpeta o archivo destino, relativo a la raíz del repositorio. */
  readonly destino: string;
  readonly seParte?: readonly string[];
  readonly nota?: string;
}

const F = 'admin/functions/src/';
const W = 'admin/web/src/';
const S = 'admin/scripts/';

const core = (destino: string, nota?: string): DestinoF2 => (nota ? { zona: 'core', destino, nota } : { zona: 'core', destino });
const central = (destino: string, nota?: string): DestinoF2 => (nota ? { zona: 'central', destino, nota } : { zona: 'central', destino });
const plataforma = (destino: string): DestinoF2 => ({ zona: 'plataforma', destino });
const tenants = (destino: string): DestinoF2 => ({ zona: 'tenants', destino });
const modulo = (m: string, destino: string, nota?: string): DestinoF2 =>
  (nota ? { zona: 'modulo', modulo: m, destino, nota } : { zona: 'modulo', modulo: m, destino });

/** Un archivo por clave, con la ruta desde la raíz del repositorio. */
export const DESTINOS_F2: Readonly<Record<string, DestinoF2>> = {
  // ---------------------------------------------------------------- §5.1 Functions
  [`${F}firma.ts`]: core(`${F}core/seguridad/`),
  [`${F}claims.ts`]: core(`${F}core/seguridad/`),
  [`${F}autorizacion.ts`]: core(`${F}core/seguridad/`),
  [`${F}atencion.ts`]: core(`${F}core/conteo/`),
  [`${F}cierres.ts`]: core(`${F}core/turno/`),
  [`${F}ingesta.ts`]: {
    zona: 'coordinador', destino: `${F}core/turno/`,
    seParte: ['modulo:agenda', 'modulo:inventario', 'modulo:captacion', 'modulo:campanas', 'modulo:cobros'],
    nota: 'Coordinador más los ganchos de seña, inventario, captación, campañas y cobro de venta',
  },
  [`${F}prompt.ts`]: {
    zona: 'core', destino: `${F}core/prompt/`, seParte: ['modulo:productos'],
    nota: 'El resumen del catálogo va a Productos; documentoDeVertical desaparece',
  },
  [`${F}saneo.ts`]: central(`${F}central/servicios/`),
  [`${F}region.ts`]: core(`${F}core/`),
  [`${F}opcionesGlobales.ts`]: core(`${F}core/`),
  [`${F}planes.ts`]: central(`${F}central/cuenta/`),
  [`${F}prepago.ts`]: central(`${F}central/cuenta/`),
  [`${F}pagos.ts`]: central(`${F}central/pagar/`),
  [`${F}pagosConCobrador.ts`]: central(`${F}central/pagar/`),
  [`${F}cobroPrepago.ts`]: central(`${F}central/pagar/`),
  [`${F}cobrador.ts`]: central(`${F}central/pagar/`),
  [`${F}cobranza.ts`]: central(`${F}central/pagar/`),
  [`${F}tipoCambio.ts`]: central(`${F}central/servicios/`),
  [`${F}tipoCambioBcb.ts`]: central(`${F}central/servicios/`),
  [`${F}comportamiento.ts`]: central(`${F}central/asistente/`),
  [`${F}verificarComportamiento.ts`]: central(`${F}central/asistente/`),
  [`${F}mapa.ts`]: central(`${F}central/negocio/`),
  [`${F}reclamos.ts`]: central(`${F}central/reclamos/`),
  [`${F}index.ts`]: {
    zona: 'plataforma', destino: `${F}plataforma/tenants.ts`, seParte: ['central'],
    nota: 'Invitar y quitar usuario van a central/usuarios.ts; sus reexportaciones son el inventario de despliegue',
  },
  [`${F}limiteCatalogo.ts`]: modulo('productos', `${F}modulos/productos/`),
  [`${F}imagenCatalogo.ts`]: modulo('productos', `${F}modulos/productos/`),
  [`${F}catalogoWeb.ts`]: {
    zona: 'modulo', modulo: 'catalogo-web', destino: `${F}modulos/catalogo-web/`, seParte: ['modulo:pedidos'],
    nota: 'El checkout que escribe pedidos va a modulos/pedidos/',
  },
  [`${F}inventario.ts`]: modulo('inventario', `${F}modulos/inventario/`),
  [`${F}cobro.ts`]: modulo('cobros', `${F}modulos/cobros/`),
  [`${F}qrSimple.ts`]: modulo('cobros', `${F}modulos/cobros/`),
  [`${F}dibujoQr.ts`]: modulo('cobros', `${F}modulos/cobros/`),
  [`${F}cotejo.ts`]: modulo('cobros', `${F}modulos/cobros/`),
  [`${F}cobroVenta.ts`]: modulo('cobros', `${F}modulos/cobros/`),
  [`${F}sena.ts`]: modulo('agenda', `${F}modulos/agenda/`),
  [`${F}retencion.ts`]: modulo('agenda', `${F}modulos/agenda/`),
  [`${F}seguimientos.ts`]: modulo('agenda', `${F}modulos/agenda/`),
  [`${F}campanas.ts`]: modulo('campanas', `${F}modulos/campanas/`),
  [`${F}verificarCampanas.ts`]: modulo('campanas', `${F}modulos/campanas/`),
  [`${F}captacion.ts`]: modulo('captacion', `${F}modulos/captacion/`),
  [`${F}registro.ts`]: { zona: 'registro', destino: `${F}registro.ts` },

  // ---------------------------------------------------------------- §5.3 Consola
  [`${W}paginas/Ingresar.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/MiCuenta.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Usuarios.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Contactos.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Conversaciones.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Consumo.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/EstadoCuenta.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Pagar.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Reclamos.tsx`]: central(`${W}central/paginas/`),
  [`${W}paginas/Bitacora.tsx`]: {
    zona: 'central', destino: `${W}central/paginas/`, seParte: ['plataforma'],
    nota: 'El §5 pone la bitácora del negocio en Central y la de plataforma en Plataforma: hoy son el MISMO archivo con dos rutas',
  },
  [`${W}paginas/Tablero.tsx`]: {
    zona: 'central', destino: `${W}central/paginas/`, seParte: ['modulo:productos', 'modulo:agenda'],
    nota: 'El §5 no dice «se parte», pero el cambio que describe lo parte: hoy cuenta catálogo y agendas; cada módulo aporta su ranura',
  },
  [`${W}paginas/Configuracion.tsx`]: {
    zona: 'central', destino: `${W}central/paginas/`, seParte: ['modulo:agenda', 'modulo:catalogo-web'],
    nota: 'El §5 no dice «se parte», pero el cambio que describe lo parte: sale el calendario a Agenda y el catálogo web y el logo a Catálogo web',
  },
  [`${W}paginas/Tenants.tsx`]: plataforma(`${W}plataforma/paginas/`),
  [`${W}paginas/Catalogo.tsx`]: {
    zona: 'modulo', modulo: 'productos', destino: `${W}modulos/productos/`,
    seParte: ['modulo:agenda', 'modulo:catalogo-web', 'modulo:inventario'],
    nota: 'La duración de cita es ranura de Agenda; la vista previa, de Catálogo web; el stock, de Inventario',
  },
  [`${W}paginas/Funcionarios.tsx`]: modulo('agenda', `${W}modulos/agenda/`),
  [`${W}paginas/Pedidos.tsx`]: modulo('pedidos', `${W}modulos/pedidos/`),
  [`${W}paginas/Cobros.tsx`]: modulo('cobros', `${W}modulos/cobros/`),
  [`${W}paginas/Cobro.tsx`]: modulo('cobros', `${W}modulos/cobros/`),
  [`${W}paginas/Inventario.tsx`]: modulo('inventario', `${W}modulos/inventario/`),
  [`${W}paginas/Campanas.tsx`]: modulo('campanas', `${W}modulos/campanas/`),
  [`${W}paginas/Captacion.tsx`]: modulo('captacion', `${W}modulos/captacion/`),
  [`${W}paginas/ConfiguracionVertical.tsx`]: central(`${W}central/componentes/ConfiguracionModulo.tsx`,
    'El §5 la llama «Conector»; su destino está en Central'),
  [`${W}lib/flujos.ts`]: { zona: 'registro', destino: 'desaparece: lo reemplaza functions/src/registro.ts' },
  // «Central y Core» en el §5, sin decir cuál es cuál. Se reparte con el mismo
  // criterio que las Functions: lo de sesión y conteo es Core; lo de cuenta,
  // pago y bitácora, Central.
  [`${W}lib/planes.ts`]: central(`${W}central/lib/`),
  [`${W}lib/prepago.ts`]: central(`${W}central/lib/`),
  [`${W}lib/pagar.ts`]: central(`${W}central/lib/`),
  [`${W}lib/cuenta.ts`]: central(`${W}central/lib/`),
  [`${W}lib/bitacora.ts`]: central(`${W}central/lib/`),
  [`${W}lib/atencion.ts`]: core(`${W}core/lib/`, 'Espejo de functions/src/atencion.ts (core/conteo)'),
  [`${W}lib/sesion.ts`]: core(`${W}core/lib/`, 'Sesión y claims: espejo de core/seguridad'),
  [`${W}lib/contexto.tsx`]: core(`${W}core/lib/`, 'Contexto de sesión (useSesion)'),
  [`${W}lib/campanas.ts`]: modulo('campanas', `${W}modulos/campanas/`),
  [`${W}lib/archivoPlanes.ts`]: modulo('captacion', `${W}modulos/captacion/`),
  [`${W}lib/xlsx.ts`]: modulo('productos', `${W}modulos/productos/`),
  [`${W}lib/csv.ts`]: modulo('productos', `${W}modulos/productos/`,
    'También la usa Captacion.tsx: servicio compartido, candidato a Central'),
  [`${W}lib/foto.ts`]: modulo('productos', `${W}modulos/productos/`),

  // ---------------------------------------------------------------- §5.4 Flujos
  // `reservas/` es «Agenda y Cobros»: el §5.4 manda cuatro a Cobros y el resto
  // a Agenda. Los dos de medios entrantes son Core por la regla del 25/09
  // («capacidades generales, no por vertical»; §3.2 y la fila de medios del
  // §5.4), aunque hoy estén en `reservas/`.
  'Flujos/src/reservas/preparar-sena.js': modulo('cobros', 'Flujos/src/modulos/cobros/'),
  'Flujos/src/reservas/respuesta-de-la-sena.js': modulo('cobros', 'Flujos/src/modulos/cobros/'),
  'Flujos/src/reservas/mensaje-de-la-sena.js': modulo('cobros', 'Flujos/src/modulos/cobros/'),
  'Flujos/src/reservas/interpretar-lectura.js': modulo('cobros', 'Flujos/src/modulos/cobros/'),
  'Flujos/src/reservas/preparar-imagen.js': core('Flujos/src/core/medios/', 'Medio entrante: core por la regla del 25/09'),
  'Flujos/src/reservas/preparar-transcripcion.js': core('Flujos/src/core/medios/', 'Medio entrante: core por la regla del 25/09'),
  'Flujos/src/reservas/calendarios-a-revisar.js': modulo('agenda', 'Flujos/src/modulos/agenda/'),
  'Flujos/src/reservas/comprobar-reserva.js': modulo('agenda', 'Flujos/src/modulos/agenda/'),
  'Flujos/src/reservas/mensaje-a-enviar.js': modulo('agenda', 'Flujos/src/modulos/agenda/'),
  'Flujos/src/reservas/procesar-reintento.js': modulo('agenda', 'Flujos/src/modulos/agenda/'),
  'Flujos/src/reservas/retomar-respuesta.js': modulo('agenda', 'Flujos/src/modulos/agenda/'),
  'Flujos/src/reservas/preparar-reenvio-del-qr.js': modulo('agenda', 'Flujos/src/modulos/agenda/',
    'Reenvía el QR de la seña: el §5.4 no lo manda a Cobros; revisar al mover'),
  'Flujos/src/reservas/qr-no-enviado.js': modulo('agenda', 'Flujos/src/modulos/agenda/',
    'Error de envío del QR de la seña: el §5.4 no lo manda a Cobros; revisar al mover'),

  // ---------------------------------------------------------------- §5.5 Scripts
  [`${S}alta-comercio.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}asignar-numero.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}asignar-plan.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}asignar-rol.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}fijar-umbrales.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}superadmin.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}cargar-plataforma.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}fijar-tipo-cambio.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}migrar-ejes.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}migrar-instrucciones.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}migrar-prepago.mjs`]: plataforma(`${S}plataforma/`),
  [`${S}cargar-negocio.mjs`]: tenants(`${S}datos/`),
  [`${S}cargar-captacion.mjs`]: tenants(`${S}datos/`),
  [`${S}cargar-fotos-catalogo.mjs`]: tenants(`${S}datos/`),
  [`${S}citas-a-calendario.mjs`]: tenants(`${S}datos/`),
  [`${S}catalogo-demo.mjs`]: tenants(`${S}datos/`),
  // «Construcción de flujos» en el §5.5. El ensamblador es de `core-flujos`
  // (`docs/arquitectura/agentes.md`); el sincronizador y el portador de
  // prompts van con él hasta que se retiren.
  [`${S}ensamblar-flujo.mjs`]: core(S, 'Construcción de flujos (agente core-flujos)'),
  [`${S}ensamblar-flujo.d.mts`]: core(S, 'Construcción de flujos (agente core-flujos)'),
  [`${S}sincronizar-flujo-cliente.mjs`]: core(S, 'Construcción de flujos: maneja solo topología'),
  [`${S}portar-prompt-cliente.py`]: core(S, 'Construcción de flujos: se retira con los prompts por capas'),
  // La medición de este PR: lee el registro y esta tabla, y se va con ella.
  [`${S}medir-zonas.mjs`]: core(S, 'Herramienta de F2: se borra junto con esta tabla'),
};

/**
 * Lo que ya está en su carpeta de zona (F1 y F6), o carpetas enteras que el
 * §5 ubica de una vez. Gana el prefijo más largo; una entrada de
 * `DESTINOS_F2` gana sobre cualquier prefijo.
 */
export const PREFIJOS_F2: readonly { readonly prefijo: string; readonly destino: DestinoF2 }[] = [
  { prefijo: `${F}central/`, destino: central(`${F}central/`, 'Ya ubicado (F1)') },
  { prefijo: `${W}central/`, destino: central(`${W}central/`, 'Ya ubicado (F1)') },
  { prefijo: `${W}plataforma/`, destino: plataforma(`${W}plataforma/`) },
  { prefijo: `${W}publico/`, destino: modulo('catalogo-web', `${W}modulos/catalogo-web/publico/`, 'Sigue sin cargar Firebase') },
  { prefijo: 'Flujos/src/comun/', destino: core('Flujos/src/core/', 'Una sola variante en F3') },
  { prefijo: `${S}datos/`, destino: tenants(`${S}datos/`) },
  { prefijo: 'admin/pruebas/central/', destino: central('admin/pruebas/central/', 'Ya ubicado (F1)') },
  { prefijo: 'admin/pruebas/core/', destino: core('admin/pruebas/core/', 'Ya ubicado (F2)') },
];
