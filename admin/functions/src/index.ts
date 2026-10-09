// PRIMERO, antes que cualquier otro módulo propio: fija las opciones globales.
import './core/opcionesGlobales.js';
import { initializeApp } from 'firebase-admin/app';

initializeApp();

// Las opciones globales (región, instancias, cuenta sa-functions) se fijan en
// opcionesGlobales.ts, que es el PRIMER import de este archivo: ver ahí por qué.
// Este archivo es solo el punto de entrada: cada `export` es una Function
// desplegada, y su lista es el inventario de despliegue.

export { altaTenant, bajaTenant, suspenderTenant, reactivarTenant, asignarNumero, liberarNumero, actualizarEstadoCuenta, fijarCortePrepago, otorgarAccesoSoporte, revocarAccesoSoporte } from './plataforma/tenants.js';
export { invitarUsuario, quitarUsuario } from './central/usuarios.js';
export { moverReclamo } from './central/reclamos/moverReclamo.js';
export { registrarCambioConfig } from './central/registrarCambioConfig.js';
export { configuracionParaFlujo } from './central/negocio/configuracionParaFlujo.js';

export { ingesta, configuracionFlujo } from './ingesta.js';
// F3b-1b: el endpoint lo arma `ganchos.ts` con los ganchos de Cobros y de Agenda sobre el contrato de Core.
export { registrarCierre } from './ganchos.js';
export { registrarQrDeCobro, imagenDeCobro } from './modulos/cobros/cobro.js';
// COMPROBANTE DE PAGO DE VENTA, REGLA 2 (C1b, `cobros.md` §4duodecies.6): el
// cotejo por plazo e intentos, la imagen guardada en Storage y la purga diaria.
// Desplegar esto no cambia ningún flujo vivo: la regla 2 la elige el flujo.
export { cotejarComprobanteVenta } from './modulos/cobros/cotejoVenta.js';
export { guardarComprobante, purgarComprobantes } from './modulos/cobros/comprobantes.js';
// SEÑA POR QR EN LAS RESERVAS (bloque 2). El cotejo del comprobante lo hace el
// servidor —el flujo manda lo que leyó el modelo y recibe `cuadra`,
// `no_cuadra` o `ilegible`— y la retención vencida se anota sin mandarle nada
// al paciente. El porqué de cada decisión está en `sena.ts`.
export { cotejarComprobante, senaVencida } from './modulos/agenda/sena.js';
// Las coordenadas del pin salen del enlace de Maps que pega el comercio: nadie
// carga latitud y longitud a mano (19/09/2026).
export { ubicacionDeEnlace } from './central/negocio/mapa.js';
// Recordatorio de solicitud pendiente (bloque 4, `Analisis/31` §4): el
// barrido de la hora pregunta a quién le toca y marca ANTES de enviar.
export { seguimientosPendientes, seguimientoEnviado } from './modulos/agenda/seguimientos.js';
// CATÁLOGO WEB PROPIO. Tres endpoints públicos y una función de configuración;
// el porqué de cada uno está en `catalogoWeb.ts`. Se exportan desde acá, como
// todo lo demás, para que exista un solo inventario de lo que se despliega.
export {
  enlaceCatalogo, catalogoPublico, checkoutCatalogo, fijarWebhookCarrito,
  vistaPreviaCatalogo, fotoDeCatalogo,
} from './modulos/catalogo-web/catalogoWeb.js';
export { registrarCambioOperado } from './central/cambiosOperados.js';
export { asignarEjes, ejesDeCuenta } from './central/ejesDeCuenta.js';
// COBRANZA DEL PREPAGO: el barrido de la hora del número de NovuChat pregunta a
// qué comercios les toca un recordatorio y marca ANTES de enviar (molde de
// `seguimientos.ts`). El porqué en `cobranza.ts`.
export { recordatoriosPrepago, recordatorioPrepagoEnviado } from './central/pagar/cobranza.js';
// PAGOS DEL PREPAGO (bloque A-1, `DISENO.md` §4undecies.1): la carga manual del
// propietario con evidencia y auditoría, la anulación del pendiente, la
// consulta al abrir la pantalla y los teléfonos que pueden pagar. Lo que suma
// meses vive en `pagos.ts` y es una sola puerta; el porqué está ahí.
// Pagos del prepago (A-1) con el cobrador (A-2) enchufado: ver pagosConCobrador.ts.
export { registrarPagoManual, anularPagoPendiente, consultarPagoPendiente } from './central/pagar/pagosConCobrador.js';
export { fijarTelefonosPago } from './central/pagar/pagos.js';
export { notificarReclamo } from './central/reclamos/reclamos.js';
// COMPROBACIÓN DE LAS FOTOS DEL CATÁLOGO. Un disparador que se ocupa de las
// altas de a una y de las importaciones de doscientas por igual, y una función
// para reintentar cuando la primera vez falló por algo pasajero. El porqué de
// que avise en vez de bloquear está en `imagenCatalogo.ts`.
export { comprobarImagenDelCatalogo, recomprobarImagen } from './modulos/productos/imagenCatalogo.js';
// MINI INVENTARIO. El descuento por venta lo hace el checkout; acá van los dos
// movimientos que pide la consola. El comercio NO escribe `stock` a mano: si
// pudiera, el saldo y su historial discreparían y el reporte dejaría de servir.
export { ajustarStock, dejarDeControlarStock } from './modulos/inventario/inventario.js';
// FLUJO DE CAPTACIÓN. Comprueba, a pedido de la consola, que el archivo de
// planes que el asistente manda por WhatsApp se pueda mandar: responde, es del
// tipo declarado y cabe en los límites de Meta. El porqué en `captacion.ts`.
export { comprobarArchivoPlanes } from './modulos/captacion/captacion.js';
// COMPORTAMIENTO GENERAL DEL ASISTENTE, VERIFICADO ANTES DE APLICARSE (reglas de
// Andres del 17/09/2026). Lo propuesto (`instruccionesExtra`) pasa por dos capas
// del servidor y recién entonces se copia a `instruccionesVigentes`, que es lo
// único que lee el flujo. El contrato y el porqué en `comportamiento.ts`.
export { verificarComportamiento } from './central/asistente/verificarComportamiento.js';
// CAMPAÑAS DE META (Andres, 24/09/2026). El comercio las carga en la consola
// (`config/campanas.lista`); este disparador las verifica —fechas, duplicados,
// palabras de emergencia, inyección y, con el modelo, que sean de ESTE negocio—
// y copia las aprobadas a `vigentes`, lo único que viaja al flujo.
export { verificarCampanas } from './modulos/campanas/verificarCampanas.js';
// PREPAGO: EL CLIENTE DEL COBRADOR (bloque A-2, 20/09/2026). NovuChat le cobra
// al comercio por QR a través del proyecto de cobros; el aviso del cobrador
// solo dispara la consulta autenticada, que es la única que confirma. Dos
// secretos nuevos (`COBRADOR_TOKEN`, `COBRADOR_AVISO_SECRETO`) y el Scheduler
// del barrido esperan la compuerta del demo (.github/DESPLIEGUE-FIREBASE.md).
// El sondeo de cada 5 minutos acredita rápido mientras C no mande aviso.
export { crearCobroPrepago, avisoCobrador, sondeoCobros, barridoCobros, imagenDePago } from './central/pagar/cobroPrepago.js';
export { tipoCambioBcb } from './central/servicios/tipoCambioBcb.js';
export { importarCatalogo } from './modulos/productos/limiteCatalogo.js'; // límite de productos por plan: ver limiteCatalogo.ts
