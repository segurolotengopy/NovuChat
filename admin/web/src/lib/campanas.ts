/**
 * LAS CAMPAÑAS EN LA CONSOLA (Andres, 24/09/2026): lo que la pantalla necesita
 * para AVISAR antes de guardar y para decir en qué quedó cada campaña.
 *
 * La que decide es el servidor (`functions/src/campanas.ts` y la regla de
 * `config/campanas`). Esto acompaña: las mismas cifras, para que el comercio no
 * descubra el límite con un rechazo. No se importa aquel módulo porque trae
 * `node:crypto` y no corre en el navegador; `pruebas/campanas-consola.test.ts`
 * compara estas cifras con las del servidor, así no se separan en silencio.
 */

export const TOPE_TEXTO_CAMPANA = 300;
export const MINIMO_TEXTO_CAMPANA = 3;
export const MAX_DIAS_HASTA_EL_INICIO = 183;
export const MAX_DIAS_DE_DURACION = 366;
const DIA_MS = 86_400_000;

export interface Campana { id: string; texto: string; inicio: string; fin: string }

export interface RevisionDeCampana {
  estado: 'aprobada' | 'rechazada' | 'pendiente' | 'fuera_del_plan';
  motivo: string;
  campo: 'texto' | 'inicio' | 'fin' | '';
}

/** El día de Bolivia (UTC-4 fijo) de un instante, `AAAA-MM-DD`. */
export function diaBolivia(ms: number = Date.now()): string {
  return new Date(ms - 4 * 3_600_000).toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, n: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

const diasEntre = (desde: string, hasta: string): number =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);

/** Las palabras del texto, como las compara el flujo: sin mayúsculas, tildes, signos ni emojis. */
export function palabrasDeCampana(t: unknown): string {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** «24/09/2026», para leer; la fecha se guarda como `AAAA-MM-DD`. */
export function fechaLegible(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

/** Las campañas bien formadas de lo que vino de Firestore; lo demás se descarta. */
export function leerCampanas(valor: unknown): Campana[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((c): c is Campana => typeof c === 'object' && c !== null
    && typeof (c as Campana).id === 'string' && typeof (c as Campana).texto === 'string'
    && typeof (c as Campana).inicio === 'string' && typeof (c as Campana).fin === 'string');
}

/**
 * LO QUE LA PANTALLA AVISA ANTES DE GUARDAR: las mismas causas por las que el
 * servidor rechazaría la campaña sin llamar al modelo. `null` = puede guardarse.
 * `original` es la campaña tal como estaba, si se está editando: una que ya
 * corría puede conservar su inicio pasado.
 */
export function problemaEnPantalla(
  c: Campana, otras: readonly Campana[], original: Campana | null, hoy: string = diaBolivia(),
): { campo: 'texto' | 'inicio' | 'fin'; texto: string } | null {
  const t = c.texto.trim();
  if (t.length > TOPE_TEXTO_CAMPANA) return { campo: 'texto', texto: `El texto supera los ${TOPE_TEXTO_CAMPANA} caracteres.` };
  if (t.length < MINIMO_TEXTO_CAMPANA || palabrasDeCampana(t).replace(/\s/g, '').length < MINIMO_TEXTO_CAMPANA) {
    return { campo: 'texto', texto: 'Escribe el mensaje que deja el anuncio, con palabras.' };
  }
  if (otras.some((o) => o.id !== c.id && palabrasDeCampana(o.texto) === palabrasDeCampana(t))) {
    return { campo: 'texto', texto: 'Otra campaña ya tiene este mismo texto.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.inicio)) return { campo: 'inicio', texto: 'Elige la fecha de inicio.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fin)) return { campo: 'fin', texto: 'Elige la fecha de fin.' };
  if (c.fin < c.inicio) return { campo: 'fin', texto: 'La fecha de fin es anterior a la de inicio.' };
  if (c.fin < hoy) return { campo: 'fin', texto: 'La fecha de fin ya pasó.' };
  if (c.inicio < hoy && !(original && original.inicio === c.inicio)) {
    return { campo: 'inicio', texto: 'Una campaña nueva empieza hoy o después.' };
  }
  if (diasEntre(hoy, c.inicio) > MAX_DIAS_HASTA_EL_INICIO) return { campo: 'inicio', texto: 'La campaña empieza en más de seis meses.' };
  if (diasEntre(c.inicio, c.fin) + 1 > MAX_DIAS_DE_DURACION) return { campo: 'fin', texto: 'La campaña dura más de un año.' };
  return null;
}

/**
 * CÓMO SE MUESTRA CADA CAMPAÑA. Si la revisión guardada no es de la lista que
 * está escrita (`fresca === false`), todavía se está revisando: nada de lo que
 * diga la revisión vieja vale para lo nuevo.
 */
export function estadoVisible(
  c: Campana, revision: RevisionDeCampana | undefined, fresca: boolean, hoy: string = diaBolivia(),
): { etiqueta: string; clase: 'ok' | 'espera' | 'mal' | 'apagada'; motivo: string } {
  if (!fresca || !revision) return { etiqueta: 'Revisando…', clase: 'espera', motivo: '' };
  if (revision.estado === 'rechazada') return { etiqueta: 'Rechazada', clase: 'mal', motivo: revision.motivo };
  if (revision.estado === 'fuera_del_plan') return { etiqueta: 'No se aplica', clase: 'apagada', motivo: revision.motivo };
  if (revision.estado === 'pendiente') {
    return { etiqueta: 'Sin verificar', clase: 'espera', motivo: 'No se pudo verificar ahora: vuelve a guardarla en un rato.' };
  }
  if (c.fin < hoy) return { etiqueta: 'Terminó', clase: 'apagada', motivo: '' };
  if (c.inicio > hoy) return { etiqueta: `Aprobada, empieza el ${fechaLegible(c.inicio)}`, clase: 'ok', motivo: '' };
  return { etiqueta: 'En uso', clase: 'ok', motivo: '' };
}

/** El SHA-256 corto de la lista, igual que `hashLista` del servidor; `null` si el navegador no puede. */
export async function hashListaEnNavegador(lista: readonly Campana[]): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const texto = JSON.stringify(lista.map((c) => [c.id, c.texto, c.inicio, c.fin]));
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Un id nuevo con la forma que exige el servidor (`^[a-z0-9-]{1,40}$`). */
export function idNuevo(ahora: number = Date.now()): string {
  return `c${ahora.toString(36)}`;
}
