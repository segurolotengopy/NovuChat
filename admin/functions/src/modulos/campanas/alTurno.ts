import type { GanchoDelTurno } from '../../core/turno/ganchosDelTurno.js';
import { limiteDeCampanas } from '../../central/cuenta/planes.js';
import { anunciosParaElFlujo, campanasParaElFlujo } from './campanas.js';

/**
 * EL GANCHO DE CAMPAÑAS EN EL TURNO (F3b-2b, `Analisis/41` §2.3 y §7 F3b).
 *
 * Es el trozo de `configuracionFlujo` que antes vivia en `ingesta.ts`, movido
 * SIN cambiar logica. Aporta dos claves de primer nivel a la respuesta:
 *
 *  - `campanas`: SOLO las aprobadas por `verificarCampanas`, en curso hoy y
 *    dentro del tope del plan de HOY, con el texto citado por el sistema
 *    (`campanasParaElFlujo`). Lo propuesto nunca viaja.
 *  - `anuncios`: las mismas campañas vigentes que traen titulares, con el
 *    producto y su precio leidos del catalogo que el turno YA trajo. Sale solo
 *    si hay alguno: un comercio sin anuncios recibe la respuesta de siempre.
 *
 * Entradas (todas ya leidas por el turno, cero lecturas nuevas):
 *  - `vigentesDeCampanas`: las `vigentes` ya revalidadas contra los terminos.
 *  - `cuenta`: de ahi sale el tope de campañas del plan.
 *  - `catalogo`: items con `nombre`, `precio` y, si llevan control de
 *    existencias, `agotado` (lo calcula el coordinador con Inventario; Campañas
 *    no depende de Inventario, `dependeDe: ['productos']`).
 *  - `citar`: cita el termino de producto registrado en el texto.
 */
export const alTurnoCampanas: GanchoDelTurno = (contexto) => {
  const limite = limiteDeCampanas(contexto.cuenta as Record<string, unknown> | null);
  const campanas = campanasParaElFlujo(contexto.vigentesDeCampanas, limite, contexto.ahoraMs)
    .map((c) => ({ ...c, texto: contexto.citar(c.texto) }));
  const anuncios = anunciosParaElFlujo(
    contexto.vigentesDeCampanas,
    limite,
    contexto.ahoraMs,
    contexto.catalogo.map((i) => ({
      id: i.id, nombre: i.datos['nombre'], precio: i.datos['precio'],
      ...(typeof i.datos['agotado'] === 'boolean' ? { agotado: i.datos['agotado'] } : {}),
    })),
  ).map((a) => ({ ...a, titulares: a.titulares.map(contexto.citar), angulo: contexto.citar(a.angulo) }));
  return { campanas, ...(anuncios.length > 0 ? { anuncios } : {}) };
};
