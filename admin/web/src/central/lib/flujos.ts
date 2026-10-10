import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../core/lib/firebase';
import {
  IDS_FLUJOS, PUENTE_DE_FLUJOS, documentoDeCobro, esFlujo as esFlujoDelRegistro, etiquetaDeCatalogo,
  flujosDeFicha, modulosDeFicha, modulosDeFlujos, pestanasDe,
} from '../../../../functions/src/registro';
import type { FichaConCapacidades, IdFlujo, IdModulo, Pestana as PestanaDelRegistro } from '../../../../functions/src/registro';

/**
 * =============================================================================
 * FACHADA DEL REGISTRO — la consola ya no tiene su propia lista de flujos
 * =============================================================================
 *
 * Hasta H2b-5 este archivo era LA tabla de flujos y pestañas del navegador (la
 * política de capas, `DISENO.md` §4sexies, hoy `docs/arquitectura/registro.md`):
 * una de las siete copias de la lista de flujos que `Analisis/41` §3.3 quería
 * reducir a una. Ahora es una capa delgada que LEE `functions/src/registro.ts`,
 * el archivo puro y sin `import` que importan también las Functions, las
 * pruebas y los scripts (como la consola ya hace con `planes.ts`, `prepago.ts`
 * y `central/ejes.ts`: la frontera de zonas deja que cualquiera importe el
 * registro, que es la capa más baja). Agregar un flujo o una pestaña es
 * tocar el registro; acá no cambia nada.
 *
 * LA UNIDAD ES EL MÓDULO. Las pantallas preguntan por módulos
 * (`modulos.includes('agenda')`), no por el nombre del flujo: es lo que el
 * registro llevará a `tenants.modulos` (Analisis/41 §5.2) y lo que ya hacen
 * las reglas y el servidor. Mientras la ficha no traiga `modulos`, el registro
 * los saca de sus `flujos` y, sin `flujos`, de `vertical`; para los seis
 * comercios de hoy el resultado es el mismo de siempre (la prueba
 * `pruebas/central/consola-registro.test.ts` lo demuestra sobre los ocho
 * subconjuntos de flujos).
 *
 * UN CAMBIO DELIBERADO. Una ficha con `flujos` que NO es una lista (una cadena,
 * `null`, un objeto) CIERRA: sin pestañas de flujo. Antes la consola caía a
 * `vertical` y abría pestañas que las reglas y el registro cerraban (el
 * seguimiento del #392). Con la clave `flujos` ausente, todo sigue como hoy.
 *
 * LO QUE DECIDE ESTA CAPA ES COSMÉTICO. Quien autoriza es `firestore.rules`: un
 * negocio de venta no puede escribir funcionarios ni construyendo la petición a
 * mano. Lo que esta capa evita es ofrecer una puerta que el servidor va a cerrar.
 */
export type FlujoId = IdFlujo;
export type { IdModulo };

/** Una pestaña, con la forma que la consola usó siempre. */
export interface Pestana {
  ruta: string;
  etiqueta: string;
  /**
   * Quién la ve. Ausente significa SOLO ADMINISTRADOR. «Pedidos» es la
   * excepción: la mira el cocinero o el repartidor, gente con rol `oper`, y es
   * la única pantalla que se usa con las manos ocupadas.
   */
  roles?: ('admin' | 'oper')[];
  /** La ve TAMBIÉN el propietario de NovuChat (sesión de Google): «Captación». */
  tambienPropietario?: boolean;
}

export interface DefinicionFlujo {
  /** Nombre comercial del flujo, como lo ve el negocio. */
  nombre: string;
  /** Pestañas que el flujo agrega a la consola de ese negocio. */
  pestanas: Pestana[];
  /** Cómo llama este flujo a los ítems del catálogo. */
  catalogo: string;
  /** Documento propio bajo `/config`, si el flujo tiene parámetros propios. */
  documento: string;
}

/** La pestaña del registro en la forma de siempre: `roles` solo si no es la de administrador. */
function aPestanaDeConsola(p: PestanaDelRegistro): Pestana {
  const soloAdmin = p.roles.length === 1 && p.roles[0] === 'admin';
  return {
    ruta: p.ruta,
    etiqueta: p.titulo,
    ...(soloAdmin ? {} : { roles: [...p.roles] }),
    ...(p.tambienPropietario === true ? { tambienPropietario: true } : {}),
  };
}

/**
 * Los flujos de hoy, DERIVADOS del puente del registro: el nombre, el
 * catálogo y el documento salen de `PUENTE_DE_FLUJOS`; las pestañas, de los
 * módulos del flujo. Sirve a la cartera (`Tablero`: el nombre de cada flujo) y
 * a la suite del registro, que compara este objeto con la consola del 03/10.
 */
export const FLUJOS = Object.fromEntries(IDS_FLUJOS.map((f) => [f, {
  nombre: PUENTE_DE_FLUJOS[f].nombre,
  pestanas: pestanasDe(modulosDeFlujos([f])).map(aPestanaDeConsola),
  catalogo: PUENTE_DE_FLUJOS[f].catalogo,
  documento: PUENTE_DE_FLUJOS[f].documento,
}])) as Record<FlujoId, DefinicionFlujo>;

export const esFlujo = (v: unknown): v is FlujoId => esFlujoDelRegistro(v);

/** Los flujos de una ficha. Falla cerrado con un `flujos` que no es lista (ver la cabecera). */
export function flujosDe(ficha: FichaConCapacidades | null | undefined): FlujoId[] {
  return flujosDeFicha(ficha);
}

/** Los módulos de una ficha: manda `modulos`; si no, los de sus flujos (el registro lo decide). */
export function modulosDe(ficha: FichaConCapacidades | null | undefined): IdModulo[] {
  return modulosDeFicha(ficha);
}

/** Etiqueta de la pestaña de catálogo según los flujos: «Servicios», «Productos» o «Catálogo». */
export function etiquetaCatalogo(flujos: readonly FlujoId[]): string {
  return etiquetaDeCatalogo(modulosDeFlujos(flujos));
}

/** Lo mismo, desde los módulos de la ficha (el menú y el título de la página). */
export function etiquetaDeCatalogoDe(modulos: readonly IdModulo[]): string {
  return capacidadesDeConsola(modulos).etiquetaCatalogo;
}

export interface Visitante {
  /** Rol de la persona en ESTE negocio (`rolEn`), o `null` si no tiene ninguno. */
  rol: string | null;
  /** Sesión de propietario de NovuChat. */
  propietario: boolean;
}

/**
 * Las pestañas de módulo que ve `visitante` en el menú, en el orden del
 * registro (`orden`) y UNA por ruta. Las comunes (Catálogo, Campañas) no están
 * acá: son enlaces fijos de `App.tsx`.
 *
 * LA COMPUERTA DE ROLES NO DA POR SENTADO QUE PESTAÑA DE MÓDULO = ADMINISTRADOR.
 * Lo era hasta el 09/09 y «Pedidos» rompe la regla (la mira el cocinero). Cada
 * pestaña declara sus roles en el registro; la de «Captación» la ve además el
 * propietario, que la instala y le da soporte. Es cosmético, como todo el menú:
 * lo autoriza `firestore.rules`.
 */
export function pestanasVisibles(modulos: readonly IdModulo[], visitante: Visitante): { ruta: string; titulo: string }[] {
  return pestanasDe(modulos)
    .filter((p) => (p.tambienPropietario === true && visitante.propietario)
      || (visitante.rol !== null && (p.roles as readonly string[]).includes(visitante.rol)))
    // Una pestaña por ruta aunque dos módulos la declaren; el registro garantiza que no pasa.
    .filter((p, i, todas) => todas.findIndex((q) => q.ruta === p.ruta) === i)
    .map((p) => ({ ruta: p.ruta, titulo: p.titulo }));
}

/**
 * LO QUE CADA PANTALLA DECIDE CON LOS MÓDULOS DEL NEGOCIO, en UNA función pura.
 *
 * Las pantallas (`Cobro`, `Catalogo`, `Captacion`, `Tablero`) llaman a esta
 * función y la suite de equivalencia (`pruebas/central/consola-registro.test.ts`)
 * llama a ESTA MISMA función: lo que se prueba es lo que la pantalla ejecuta, no
 * una copia. Una guarda de fuente exige además que cada pantalla la llame y use
 * el campo que le corresponde.
 *
 *  - `conAgenda`: duración de cita en el catálogo y bloque de la seña en Cobro.
 *  - `conPedidos`: bloque de costos de entrega en Cobro (`config/venta`).
 *  - `conVistaPrevia`: vista previa del sitio público del catálogo (Catálogo web).
 *  - `conCaptacion`: la pantalla de Captación solo se abre con este módulo.
 *  - `conInventario`: la ruta de Inventario solo se abre con este módulo.
 *  - `documentoCobro`: el documento de `/config` donde vive el QR: `venta`
 *    gana, después `agendamiento`; sin ninguno de los dos (o sin Cobros), `null`.
 *  - `etiquetaCatalogo`: «Servicios», «Productos» o «Catálogo».
 */
export interface CapacidadesDeConsola {
  conAgenda: boolean;
  conPedidos: boolean;
  conVistaPrevia: boolean;
  conCaptacion: boolean;
  conInventario: boolean;
  documentoCobro: ReturnType<typeof documentoDeCobro>;
  etiquetaCatalogo: string;
}

export function capacidadesDeConsola(modulos: readonly IdModulo[]): CapacidadesDeConsola {
  return {
    conAgenda: modulos.includes('agenda'),
    conPedidos: modulos.includes('pedidos'),
    conVistaPrevia: modulos.includes('catalogo-web'),
    conCaptacion: modulos.includes('captacion'),
    conInventario: modulos.includes('inventario'),
    documentoCobro: documentoDeCobro(modulos),
    etiquetaCatalogo: etiquetaDeCatalogo(modulos),
  };
}

/**
 * La ficha del negocio, en vivo. `null` mientras carga: la cabecera no pinta
 * pestañas de flujo hasta saber cuáles son, para no mostrar una que después
 * desaparece. Si la lectura falla, una ficha SIN módulos ni flujos (nada abre).
 */
function useFicha(tenantId: string | undefined): FichaConCapacidades | null {
  // La ficha lleva el negocio al que pertenece: al cambiar de `tenantId` con la pantalla montada, el
  // render intermedio no devuelve la del negocio anterior (decidir con sus módulos, p. ej. redirigir).
  const [guardada, setGuardada] = useState<{ de: string; ficha: FichaConCapacidades } | null>(null);
  useEffect(() => {
    setGuardada(null);
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setGuardada({ de: tenantId, ficha: d.data() ?? {} }),
      () => setGuardada({ de: tenantId, ficha: { modulos: [], flujos: [] } }));
  }, [tenantId]);
  return guardada !== null && guardada.de === tenantId ? guardada.ficha : null;
}

/** Los módulos del negocio, en vivo. `null` mientras carga. */
export function useModulos(tenantId: string | undefined): IdModulo[] | null {
  const ficha = useFicha(tenantId);
  return ficha === null ? null : modulosDeFicha(ficha);
}

/** Los flujos del negocio, en vivo. `null` mientras carga. */
export function useFlujos(tenantId: string | undefined): FlujoId[] | null {
  const ficha = useFicha(tenantId);
  return ficha === null ? null : flujosDeFicha(ficha);
}
