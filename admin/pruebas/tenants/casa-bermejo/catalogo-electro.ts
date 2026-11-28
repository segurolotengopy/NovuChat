/**
 * EL CATÁLOGO DE ELECTRODOMÉSTICOS DE PRUEBA (no es el real) y los modelos simulados de la batería de ataque del catálogo (27/11/2026, `BERMEJO_bateria-ataque-catalogo`).
 * No es una suite: vitest solo corre `*.test.ts`. Lo usa `catalogo-listas.test.ts`.
 * Contrato v1 de NovuTienda (ids, `precioCentavos`, `disponible`); el flujo descarta lo que no tiene precio o no está disponible, y recorta el nombre a 80 caracteres.
 */
import type { J } from '../../lib/flujo';
import type { LlamadaDoble } from '../../lib/n8n-de-mentira';
import { modelo } from './mundo';

export const ENLACE_CATALOGO = 'https://catalogo.ejemplo.test/casa-bermejo';
export interface Grupo { area: string; cantidad: number; base: string; precio: number }
const MARCAS = ['SAMSUNG', 'LG', 'TCL', 'PHILIPS', 'HISENSE', 'SONY', 'XIAOMI', 'PANASONIC'];
const RESOLUCIONES = ['FULL HD', '4K UHD', 'QLED 4K', 'OLED 4K'];
const unidad = (g: Grupo, i: number): J => {
  const marca = MARCAS[i % MARCAS.length]!;
  const nombre = `${g.base} ${marca} ${30 + 5 * i} PULGADAS ${RESOLUCIONES[i % RESOLUCIONES.length]} MODELO ${100 + i}X`.slice(0, 80);
  const id = `${g.area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${i + 1}`;
  return { id, nombre, descripcion: `${g.base} ${marca}`, area: g.area, moneda: 'BOB', activo: true, precio: g.precio + 150 * i, precioCentavos: (g.precio + 150 * i) * 100, stock: 10, disponible: true };
};
export const GRUPOS: Grupo[] = [
  { area: 'Televisores', cantidad: 23, base: 'TELEVISOR', precio: 1800 },
  { area: 'Aires acondicionados', cantidad: 12, base: 'AIRE ACONDICIONADO', precio: 2600 },
  { area: 'Heladeras', cantidad: 6, base: 'HELADERA', precio: 3200 },
  { area: 'Freezers', cantidad: 4, base: 'FREEZER', precio: 2900 },
  { area: 'Lavadoras', cantidad: 8, base: 'LAVADORA', precio: 2400 },
  { area: 'Microondas', cantidad: 5, base: 'MICROONDAS', precio: 700 },
  { area: 'Parlantes', cantidad: 9, base: 'PARLANTE BLUETOOTH', precio: 300 },
];
/** Los 67 productos de la batería, más uno SIN precio y uno `disponible: false` (no deben salir nunca). `grupos` cambia las cantidades o las áreas. */
export function electro(grupos: Grupo[] = GRUPOS): J[] {
  const items = grupos.flatMap((g) => Array.from({ length: g.cantidad }, (_, i) => unidad(g, i)));
  return [...items, { id: 'heladera-sin-precio', nombre: 'HELADERA SIN PRECIO', descripcion: 'x', area: 'Heladeras', moneda: 'BOB', activo: true, stock: 10, disponible: true }, { id: 'heladera-agotada', nombre: 'HELADERA AGOTADA', descripcion: 'x', area: 'Heladeras', moneda: 'BOB', activo: true, precio: 1234, precioCentavos: 123400, stock: 0, disponible: false }];
}
/** Con una categoría de más de 4096 caracteres en texto plano (60 televisores de nombre largo). */
export const GRUPOS_GRANDES: Grupo[] = GRUPOS.map((g) => (g.area === 'Televisores' ? { ...g, cantidad: 60 } : g));
/** Una categoría con exactamente 10 y otra con 14 aires de nombre mediano. */
export const GRUPOS_BORDE: Grupo[] = [{ area: 'Televisores', cantidad: 10, base: 'TELEVISOR', precio: 1800 }, { area: 'Aires acondicionados', cantidad: 14, base: 'AIRE ACONDICIONADO', precio: 2600 }, { area: 'Heladeras', cantidad: 6, base: 'HELADERA', precio: 3200 }];
/** El área «TV y video» (otro nombre para los televisores). */
export const GRUPOS_TV_Y_VIDEO: Grupo[] = GRUPOS.map((g) => (g.area === 'Televisores' ? { ...g, area: 'TV y video' } : g));

// ----------------------------------------------------------------------------- los modelos simulados (la conversación libre del modelo, incluso lo que NO debe decir)
type Modelo = (ll: LlamadaDoble) => J;
export const modeloResumidor: Modelo = () => modelo('Tenemos varios televisores de distintas marcas, ¿cuál le interesa?');
export const modeloCortaA3: Modelo = () => modelo('Le muestro algunos:\n• TELEVISOR SAMSUNG 30 PULGADAS FULL HD a Bs 1.800\n• TELEVISOR LG 35 PULGADAS 4K UHD a Bs 1.950\n• TELEVISOR TCL 40 PULGADAS QLED 4K a Bs 2.100');
export const modeloNiega: Modelo = () => modelo('No tenemos catálogo, pero cuénteme qué busca.');
export const modeloNiegaEncuentro: Modelo = () => modelo('No encuentro eso en nuestro catálogo.');
export const modeloSinEnlace: Modelo = () => modelo('Estos son todos nuestros televisores, cada uno con su precio.');
export const modeloPrecioFalso: Modelo = () => modelo('El TELEVISOR SAMSUNG 30 PULGADAS FULL HD MODELO 100X cuesta Bs 999.');
export const modeloDeriva: Modelo = () => modelo('Una persona del equipo lo verá.', { quiereHablar: true });
export const modeloSano: Modelo = () => modelo('Con gusto. ¿Qué pieza te interesa?');
