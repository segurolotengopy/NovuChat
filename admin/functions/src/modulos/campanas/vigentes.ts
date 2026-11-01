import { logger } from 'firebase-functions';
import type { Firestore } from 'firebase-admin/firestore';
import { leerCampanas, plegarParaPatrones, type Campana } from './campanas.js';
import { nombreDeProductoApto } from '../productos/nombreSeguro.js';
import { SIN_OTROS, normalizar as normalizarTexto, verificarPatrones } from '../../central/asistente/comportamiento.js';
import { terminosAprobados } from '../../central/asistente/terminos.js';

// F3b-2e: movido de `ingesta.ts` sin cambiar lógica. Las campañas vigentes son de Campañas
// (que declara `dependeDe: ['productos']`, de ahí `nombreDeProductoApto`); el coordinador solo
// llama a `vigentesParaElPrompt` y entrega lo que devuelve a los ganchos.
/**
 * =========================================================================
 * TÉRMINOS DE PRODUCTO REGISTRADOS EN EL PROMPT (Andres, 24/10/2026; PR 5)
 * =========================================================================
 *
 * Un nombre de producto con «prompt/prompts» («100 prompts») es un DATO LITERAL
 * si el comercio lo registró y Plataforma lo aprobó. Este turno hace dos cosas
 * con eso, y ninguna toca el texto del cliente:
 *
 *  1. CITA: el SISTEMA entrecomilla « » el término donde aparece en lo que viaja
 *     al prompt (nombres del catálogo, instrucciones vigentes, campañas vigentes).
 *     El marcador interno nunca sale de `verificarPatrones`.
 *  2. REVALIDA lo ya aprobado. `instruccionesVigentes` y `vigentes` se aprobaron
 *     con los términos de ENTONCES; si el término se revocó (o su ítem se
 *     renombró o desactivó), lo aprobado gracias a él no puede seguir llegando al
 *     modelo. Se vuelve a pasar por la capa 1 con los términos de AHORA y lo que
 *     ya no pasa NO entra al prompt (la base no se toca: es solo no mostrarlo).
 *
 * COSTO: una sola lectura de términos por turno, y NINGUNA si ningún texto
 * candidato contiene «prompt» (`terminosAprobados` lo decide). Fallar cerrado:
 * si la lectura falla, términos vacíos; lo que necesita un término queda fuera.
 */
const contienePrompt = (t: string): boolean => normalizarTexto(t).includes('prompt');

/** Los campos de una campaña que viajan al modelo: texto, titulares y ángulo. */
const camposDeCampana = (c: Campana): string[] => [c.texto, ...(c.titulares ?? []), c.angulo ?? ''];

/** ¿Este texto aprobado sigue pasando la capa 1 con los términos de hoy? Sin «prompt» no se revisa nada. */
export function sigueVigente(valor: string, terminos: readonly string[]): boolean {
  const vistas = [valor, valor.normalize('NFKC'), plegarParaPatrones(valor)];
  if (!vistas.some(contienePrompt)) return true;
  return vistas.every((v) => verificarPatrones(v, SIN_OTROS, terminos).nivel !== 'rechazado');
}

export interface VigentesDelTurno {
  terminos: string[];
  instrucciones: string;
  /** Las campañas `vigentes` tal como las leyó el turno, o la lista filtrada si alguna dejó de pasar. */
  campanas: unknown;
  /** Cuántas cosas ya aprobadas se dejaron fuera de este prompt. */
  descartadas: number;
}

/** Lee los términos (a lo sumo una vez), revalida lo vigente y devuelve lo que puede entrar al prompt. */
export async function vigentesParaElPrompt(
  db: Firestore, tenantId: string, entrada: {
    nombresDeCatalogo: readonly string[]; instrucciones: string; campanas: unknown;
  },
): Promise<VigentesDelTurno> {
  const lista = leerCampanas(entrada.campanas);
  const candidatos = [...entrada.nombresDeCatalogo, entrada.instrucciones, ...lista.flatMap(camposDeCampana)];
  let terminos: string[] = [];
  try {
    terminos = await terminosAprobados(db, tenantId, candidatos.join('\n'), nombreDeProductoApto);
  } catch {
    // Sin datos del comercio en el registro: ni el término ni el texto.
    logger.warn('configuracionFlujo: no se pudieron leer los términos de producto');
  }
  let descartadas = 0;
  const instrucciones = entrada.instrucciones !== '' && !sigueVigente(entrada.instrucciones, terminos)
    ? (descartadas++, '') : entrada.instrucciones;
  const buenas = lista.filter((c) => camposDeCampana(c).every((v) => v === '' || sigueVigente(v, terminos)));
  descartadas += lista.length - buenas.length;
  if (descartadas > 0) logger.info('configuracionFlujo: vigentes fuera del prompt por término', { descartadas });
  return {
    terminos, instrucciones, descartadas,
    campanas: buenas.length === lista.length ? entrada.campanas : buenas,
  };
}

