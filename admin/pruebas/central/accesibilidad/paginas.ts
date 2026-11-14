/**
 * LAS PÁGINAS DE LA PRUEBA CON MOTOR y sus datos mínimos (13/11/2026). Cada escenario es una FÁBRICA (datos recién construidos en cada
 * corrida: llevan marcas de tiempo, que son instancias). Una fila por colección; cambiar estos datos cambia las cuentas de la línea de
 * base del motor (docs/arquitectura/accesibilidad-consola.md). El centinela es un dato del escenario que la página dibuja: si no
 * aparece, la página no se pintó con datos y la suite se pone en rojo.
 */
import type { Escenario } from './sustitutos';

export const TENANT = 'comercio-a11y';
export const AHORA = Date.UTC(2026, 9, 15, 16, 0, 0);

export interface Sesion {
  cargando: false;
  usuario: { uid: string } | null;
  permisos: { propietario: boolean; tenants: Record<string, string>; version: number };
  refrescar: () => Promise<void>;
  salir: () => Promise<void>;
}
const nada = async () => {};
const sesion = (usuario: Sesion['usuario'], propietario: boolean, tenants: Record<string, string>): Sesion =>
  ({ cargando: false, usuario, permisos: { propietario, tenants, version: 1 }, refrescar: nada, salir: nada });

export const ADMIN = sesion({ uid: 'u-admin' }, false, { [TENANT]: 'admin' });
export const PROPIETARIO = sesion({ uid: 'u-prop' }, true, {});
export const ANONIMA = sesion(null, false, {});

/** Marca de tiempo mínima con la forma que las pantallas leen (`toDate`, `toMillis`). */
class Marca {
  constructor(private readonly ms: number) {}
  toDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
}
const hace = (horas: number) => new Marca(AHORA - horas * 3_600_000);

export interface PaginaDePrueba {
  id: string;
  ruta: string;
  sesion: Sesion;
  /** Dato del escenario que la página tiene que dibujar. */
  centinela: string;
  /** Dónde se busca: `texto` (lo visible) o `html` (si va en un `value`, que no es texto). */
  enHtml?: boolean;
  escenario: () => Escenario;
}

const ficha = () => ({
  nombre: 'Comercio Centinela', estado: 'activo', plan: 'impulso', modulos: ['pedidos'], flujos: ['venta'],
});

const comun = (): NonNullable<Escenario['docs']> => ({
  [`tenants/${TENANT}`]: ficha(),
  [`tenants/${TENANT}/config/negocio`]: {
    nombreNegocio: 'Negocio Centinela', descripcion: 'Descripción de prueba', direccion: 'Avenida Centinela 742',
    horarios: { lunes: [{ desde: '09:00', hasta: '18:00' }] },
  },
  [`tenants/${TENANT}/cuenta/estado`]: { estadoPago: 'al_dia', modalidad: 'prepago', plan: 'impulso' },
});

const PENDIENTE = {
  pagoId: 'p1', descripcion: 'Cobro Centinela', monto: 174, montoUsd: 25, moneda: 'BOB', tcoAplicado: 6.96, tcoFuente: 'BCB',
  tcoFecha: '2026-10-15', venceEn: AHORA + 3_600_000, creadoEn: AHORA - 60_000, cobroEstado: 'pendiente', fichaQr: 'ficha-centinela',
};
const EJES = {
  tenantId: TENANT, plan: 'impulso',
  limites: { conversaciones: 200, productos: 20, agendas: 1, cambiosIncluidos: 0, origen: 'plan' },
  modalidad: 'prepago', modalidadExplicita: true, modelo: 'gemini-3.5-flash-lite',
  numeros: [{ phoneNumberId: 'numero-centinela', flujo: 'venta', estado: 'activo', titularidad: 'novuchat', titularidadExplicita: true }],
  cambios: { mes: '2026-10', usados: 0, incluidos: 0, restantes: 0, ilimitado: false },
};

export const PAGINAS: PaginaDePrueba[] = [
  { id: 'ingresar', ruta: '/ingresar', sesion: ANONIMA, centinela: 'Ingresar', escenario: () => ({}) },
  { id: 'tablero', ruta: `/negocio/${TENANT}/inicio`, sesion: ADMIN, centinela: 'Negocio Centinela',
    escenario: () => ({ docs: comun() }) },
  { id: 'conversaciones', ruta: `/negocio/${TENANT}/conversaciones`, sesion: ADMIN, centinela: 'Cliente Centinela',
    escenario: () => ({
      docs: comun(),
      colecciones: { [`tenants/${TENANT}/conversaciones`]: [{ id: 'wa_59100000012', datos: {
        telefono: '59100000012', nombreContacto: 'Cliente Centinela', ultimoMensaje: 'Hola', ultimoEn: hace(1), ultimoEntranteEn: hace(1),
        ventanaVenceEn: new Marca(AHORA + 23 * 3_600_000), noLeidos: 1, sinLeer: true,
      } }] },
    }) },
  { id: 'cobros', ruta: `/negocio/${TENANT}/cobros`, sesion: ADMIN, centinela: '5910****012',
    escenario: () => ({
      docs: comun(),
      colecciones: { [`tenants/${TENANT}/cierres`]: [{ id: 'c1', datos: {
        ocurridoEn: hace(2), tipo: 'venta', telefonoEnmascarado: '5910****012', referencia: 'REF-CENTINELA', monto: 50, moneda: 'BOB',
      } }] },
    }) },
  { id: 'consumo', ruta: `/negocio/${TENANT}/consumo`, sesion: ADMIN, centinela: '2026-10',
    escenario: () => ({
      docs: comun(),
      colecciones: { [`tenants/${TENANT}/metricas`]: [{ id: '2026-10', datos: { conversaciones: 7, atenciones: 5, cierres: 3 } }] },
    }) },
  { id: 'pagar', ruta: `/negocio/${TENANT}/pagar`, sesion: ADMIN, centinela: 'Cobro Centinela',
    escenario: () => ({
      docs: { ...comun(), 'plataforma/tipoCambio': { tco: 6.96, fecha: '2026-10-15', fuente: 'BCB' } },
      respuestas: { consultarPagoPendiente: { consultado: true, pendiente: PENDIENTE }, ejesDeCuenta: EJES },
    }) },
  { id: 'configuracion', ruta: `/negocio/${TENANT}/configuracion`, sesion: ADMIN, centinela: 'Avenida Centinela 742', enHtml: true,
    escenario: () => ({ docs: comun() }) },
  { id: 'negocios', ruta: '/negocios', sesion: PROPIETARIO, centinela: 'Comercio Centinela',
    escenario: () => ({ colecciones: { tenants: [{ id: TENANT, datos: ficha() }] } }) },
];
