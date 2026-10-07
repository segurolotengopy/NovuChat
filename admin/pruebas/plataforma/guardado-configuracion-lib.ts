/**
 * EL GUARDADO COMPLETO DE «CONFIGURACIÓN», COMO LO HACE LA CONSOLA.
 *
 * Dos piezas que usan `guardado-configuracion.test.ts` (qué acepta y qué rechaza
 * el servidor) y `reglas-presupuesto.test.ts` (cuánto presupuesto de expresiones
 * gasta):
 *
 *  · `documentoAlmacenado`: el documento `config/negocio` de un comercio de
 *    venta, con la forma de Q'Taco (ficha con `flujos: ['venta']`, sin
 *    `modulos`). Dos formas:
 *      - `sembrado`: el que deja la siembra del repositorio (`scripts/sembrar.mjs`,
 *        comercio de venta) —textos y mensajes fijos llenos, listas, `mensajes`,
 *        calendario— con un calendario VÁLIDO. (El de la siembra, `<id>@group.calendar.google.com`,
 *        no cumple `calendarioValido`: ese documento NO se puede guardar ni sin
 *        cambiar nada, con cualquier presupuesto. Está anotado en el PR.)
 *      - `tope`: TODO lo que el documento admite, cada texto en su tope, las listas
 *        llenas, `mensajes` con varias claves y lo que escribe el servidor
 *        (`instruccionesVigentes`, `instruccionesRevision`).
 *  · `payloadDeLaConsola`: lo que la pantalla manda al pulsar «Guardar» sobre ese
 *    documento, armado con las MISMAS funciones que la pantalla
 *    (`datosDeNegocio` y `payloadNegocio`, de `web/src/central/lib/payloadNegocio.ts`):
 *    no es una copia escrita a mano.
 *
 * Datos SINTÉTICOS. Los números largos se arman con `repeat`/concatenación para no
 * escribir secuencias de dígitos que el saneo del repositorio público rechaza.
 */
import { Timestamp } from 'firebase/firestore';
import { datosDeNegocio, payloadNegocio } from '../../web/src/central/lib/payloadNegocio.ts';

export type Forma = 'sembrado' | 'tope';
/** `invalido`: el de la siembra del repositorio (`<id>@group.calendar.google.com`), que `calendarioValido` rechaza. */
export type Calendario = 'vacio' | 'grupo' | 'correo' | 'invalido';

const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
/** Un rango por día, de lunes a `k`. */
export const horarioDe = (k: number): Record<string, string> => Object.fromEntries(DIAS.slice(0, k).map((d) => [d, '09:00-18:00']));

const GRUPO = `${'a'.repeat(64)}@group.calendar.google.com`;
const CORREO = 'reservas.local@ejemplo.com';
const calendarioDe = (c: Calendario): string => (c === 'vacio' ? '' : c === 'grupo' ? GRUPO : c === 'invalido' ? 'comercio-demo@group.calendar.google.com' : CORREO);
const NUMERO = '59170001';
const TS = Timestamp.fromMillis(1_700_000_000_000);

export type Opciones = {
  dias: number;
  /** Con el pin (`ubicacion`) y el enlace de mapa, como los carga el comercio. */
  ubicacion?: boolean;
  calendario?: Calendario;
  /** Lo que ya estaba guardado en `catalogoWebActivo`. */
  catalogoWebGuardado?: boolean;
};

/** El documento tal como está guardado antes de que el comercio abra la pantalla. */
export function documentoAlmacenado(forma: Forma, o: Opciones): Record<string, unknown> {
  const ubic = o.ubicacion ?? true;
  const calendario = calendarioDe(o.calendario ?? (forma === 'tope' ? 'grupo' : 'correo'));
  const comun = {
    horarios: horarioDe(o.dias),
    ...(o.catalogoWebGuardado ? { catalogoWebActivo: true } : {}),
    ...(ubic ? { direccionMaps: 'https://maps.app.goo.gl/AbCdEfGh12', ubicacion: { lat: -17.8, lng: -63.2 } } : {}),
    actualizadoPor: 'siembra', actualizadoEn: TS,
  };
  if (forma === 'sembrado') {
    return {
      nombreNegocio: 'Parrilla sintetica',
      descripcion: 'Parrilla y comida al paso. Pedidos para llevar.',
      zonaHoraria: 'America/La_Paz',
      numeroRecepcion: NUMERO,
      direccion: 'Calle Comercio 100, zona Central',
      tratamiento: 'usted',
      estiloEmojis: 'pocos',
      politicaCancelacion: 'Cancelar con 24 horas de anticipacion, sin cargo.',
      prefijosPermitidos: ['591'],
      datosQueNoTenemos: [],
      mensajeCierre: 'Gracias por escribirnos. Que tenga buen dia.',
      mensajeErrorTemporal: 'Tuvimos un inconveniente. Intente en un momento, por favor.',
      mensajeReservaNoConfirmada: 'No pude confirmar la reserva. Le escribe recepcion enseguida.',
      mensajeComercioSuspendido: 'Por el momento no atendemos por este medio.',
      calendarioId: calendario,
      moneda: 'BOB',
      mensajes: {
        bienvenida: 'Hola, soy el asistente virtual. En que puedo ayudarle?',
        fuera_de_horario: 'Ahora estamos cerrados. Le respondemos apenas abramos.',
      },
      instruccionesExtra: 'Ofrecer siempre la promocion de los martes.',
      ...comun,
    };
  }
  const instrucciones = 'i'.repeat(1500);
  return {
    nombreNegocio: 'N'.repeat(80),
    descripcion: 'd'.repeat(400),
    zonaHoraria: 'America/La_Paz',
    numeroRecepcion: '1'.repeat(15),
    direccion: 'x'.repeat(200),
    tratamiento: 'vos',
    estiloEmojis: 'muchos',
    politicaCancelacion: 'p'.repeat(600),
    prefijosPermitidos: Array.from({ length: 10 }, (_, i) => `59${i}`),
    datosQueNoTenemos: Array.from({ length: 20 }, (_, i) => `dato ${i}`),
    mensajeCierre: 'c'.repeat(300),
    mensajeErrorTemporal: 'e'.repeat(300),
    mensajeReservaNoConfirmada: 'r'.repeat(300),
    mensajeComercioSuspendido: 's'.repeat(300),
    calendarioId: calendario,
    moneda: 'USD',
    mensajes: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`clave_${i}`, `Mensaje fijo número ${i}`])),
    nombreAsistente: 'k'.repeat(40),
    paleta: 'vino',
    instruccionesExtra: instrucciones,
    instruccionesVigentes: instrucciones,
    instruccionesRevision: { estado: 'aprobado', motivo: '', hash: 'abcdef01a2b3c4d5', revisadoEn: TS },
    ...comun,
  };
}

/**
 * Lo que la pantalla manda al pulsar «Guardar» sin tocar nada, salvo lo que se pida: `catalogoWeb` es la casilla
 * (por defecto, lo que ya estaba guardado). Se arma como la pantalla: lee el documento (`datosDeNegocio`, el pin,
 * el nombre, el horario ya escrito) y construye con `payloadNegocio`.
 */
export function payloadDeLaConsola(almacenado: Record<string, unknown>, uid: string, catalogoWeb?: boolean): Record<string, unknown> {
  const datos = datosDeNegocio(almacenado);
  const ubicacion = almacenado['ubicacion'] as { lat: number; lng: number } | undefined;
  return payloadNegocio({
    datos,
    direccionMaps: (datos['direccionMaps'] ?? '').trim(),
    ubicacion: ubicacion ?? null,
    teniaUbicacion: { direccionMaps: 'direccionMaps' in almacenado, ubicacion: 'ubicacion' in almacenado },
    nombre: (typeof almacenado['nombreAsistente'] === 'string' ? almacenado['nombreAsistente'] : '').replace(/[\r\n]+/g, ' ').trim(),
    teniaNombreAsistente: 'nombreAsistente' in almacenado,
    horarios: (almacenado['horarios'] ?? {}) as Record<string, string>,
    catalogoWeb: catalogoWeb ?? almacenado['catalogoWebActivo'] === true,
    uid,
  });
}
