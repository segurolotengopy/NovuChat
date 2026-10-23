/**
 * LAS CAMPAÑAS EN LA CONSOLA (Andres, 24/09/2026): lo que la pantalla necesita
 * para AVISAR antes de guardar y para decir en qué quedó cada campaña.
 *
 * La que decide es el servidor (`functions/src/modulos/campanas/campanas.ts` y la regla de
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

export const MAX_TITULARES = 5;
export const MIN_LARGO_TITULAR = 6;
export const MAX_LARGO_TITULAR = 100;
export const TOPE_ANGULO = 300;
/** Lo más que una campaña escribe en Firestore: la regla admite de 4 a 7 claves. */
export const MAX_CLAVES_POR_CAMPANA = 7;
/** Un monto en un titular: misma expresión que el servidor (el precio vive en el producto). */
const MONTO = /(\bbs\.?|\busd|\$)\s*\d|\d\s*(bs|usd|\$)/;
const INVISIBLES = /[\p{Cf}\p{Cc}]/u;

export interface Campana {
  id: string; texto: string; inicio: string; fin: string;
  titulares?: string[]; productoId?: string; angulo?: string;
}

/** Un producto ACTIVO del catálogo del negocio, solo para mostrarlo: no se escribe. */
export interface ProductoElegible { id: string; nombre: string; precio: number | null; moneda: string }

/** Solo los productos activos con nombre, ordenados; lo demás no se ofrece. */
export function productosElegibles(docs: ReadonlyArray<{ id: string; data: Record<string, unknown> }>): ProductoElegible[] {
  return docs
    .filter((d) => d.data['activo'] === true && typeof d.data['nombre'] === 'string' && d.data['nombre'].trim() !== '')
    .map((d) => ({
      id: d.id,
      nombre: String(d.data['nombre']).trim(),
      precio: typeof d.data['precio'] === 'number' && Number.isFinite(d.data['precio']) ? d.data['precio'] : null,
      moneda: d.data['moneda'] === 'USD' ? 'USD' : 'Bs',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

const limpiarTitular = (x: string): string => x.trim().replace(/\s+/g, ' ');

/** Los titulares sin espacios de más, sin vacíos y sin repetidos exactos, como los colapsa el servidor. */
export function titularesLimpios(t: readonly string[] | undefined): string[] {
  return [...new Set((t ?? []).map(limpiarTitular).filter((x) => x !== ''))];
}

/** Por qué un titular no sirve, o `null`. */
export function problemaDeTitular(t: string): string | null {
  const x = limpiarTitular(t);
  if (x.length < MIN_LARGO_TITULAR) return `Cada titular tiene al menos ${MIN_LARGO_TITULAR} caracteres.`;
  if (x.length > MAX_LARGO_TITULAR) return `Cada titular tiene como máximo ${MAX_LARGO_TITULAR} caracteres.`;
  if (INVISIBLES.test(x.normalize('NFKC'))) return 'El titular tiene caracteres ocultos o de control: escríbelo de nuevo.';
  if (MONTO.test(x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())) {
    return 'Un titular no lleva precios (por ejemplo «Desde solo 32 Bs»): el precio se toma del producto.';
  }
  return null;
}

/**
 * La campaña tal como se escribe en `lista`: solo las claves que tienen valor,
 * sin pasar de 7, sin `vigentes` ni `revision` (son del servidor).
 */
export function campanaParaGuardar(c: Campana): Record<string, unknown> {
  const titulares = titularesLimpios(c.titulares);
  const texto = c.texto.trim();
  const angulo = (c.angulo ?? '').trim();
  const out: Record<string, unknown> = { id: c.id };
  if (texto !== '' || titulares.length === 0) out['texto'] = texto;
  out['inicio'] = c.inicio;
  out['fin'] = c.fin;
  if (titulares.length > 0) out['titulares'] = titulares;
  if (c.productoId) out['productoId'] = c.productoId;
  if (angulo !== '') out['angulo'] = angulo;
  return out;
}

export interface RevisionDeCampana {
  estado: 'aprobada' | 'rechazada' | 'pendiente' | 'fuera_del_plan';
  motivo: string;
  campo: 'texto' | 'inicio' | 'fin' | 'titulares' | 'productoId' | 'angulo' | '';
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

/** Las campañas bien formadas de lo que vino de Firestore; lo demás se descarta. El texto puede faltar si hay titulares. */
export function leerCampanas(valor: unknown): Campana[] {
  if (!Array.isArray(valor)) return [];
  const out: Campana[] = [];
  for (const c of valor) {
    if (typeof c !== 'object' || c === null) continue;
    const r = c as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || typeof r['inicio'] !== 'string' || typeof r['fin'] !== 'string') continue;
    if (r['texto'] !== undefined && typeof r['texto'] !== 'string') continue;
    const titulares = Array.isArray(r['titulares']) && r['titulares'].every((x) => typeof x === 'string')
      ? r['titulares'] as string[] : undefined;
    if (r['texto'] === undefined && titulares === undefined) continue;
    out.push({
      id: r['id'], texto: (r['texto'] as string | undefined) ?? '', inicio: r['inicio'], fin: r['fin'],
      ...(titulares ? { titulares } : {}),
      ...(typeof r['productoId'] === 'string' ? { productoId: r['productoId'] } : {}),
      ...(typeof r['angulo'] === 'string' ? { angulo: r['angulo'] } : {}),
    });
  }
  return out;
}

/**
 * LO QUE LA PANTALLA AVISA ANTES DE GUARDAR: las mismas causas por las que el
 * servidor rechazaría la campaña sin llamar al modelo. `null` = puede guardarse.
 * `original` es la campaña tal como estaba, si se está editando: una que ya
 * corría puede conservar su inicio pasado.
 */
export function problemaEnPantalla(
  c: Campana, otras: readonly Campana[], original: Campana | null, hoy: string = diaBolivia(),
  productosActivos?: ReadonlySet<string>,
): { campo: 'texto' | 'inicio' | 'fin' | 'titulares' | 'productoId' | 'angulo'; texto: string } | null {
  const t = c.texto.trim();
  const titulares = titularesLimpios(c.titulares);
  const sinTexto = t === '' && titulares.length > 0;
  if (t === '' && titulares.length === 0) {
    return { campo: 'titulares', texto: 'Escribe al menos un titular del anuncio o el texto que deja el anuncio.' };
  }
  if (!sinTexto) {
    if (t.length > TOPE_TEXTO_CAMPANA) return { campo: 'texto', texto: `El texto supera los ${TOPE_TEXTO_CAMPANA} caracteres.` };
    if (t.length < MINIMO_TEXTO_CAMPANA || palabrasDeCampana(t).replace(/\s/g, '').length < MINIMO_TEXTO_CAMPANA) {
      return { campo: 'texto', texto: 'Escribe el mensaje que deja el anuncio, con palabras.' };
    }
    if (otras.some((o) => o.id !== c.id && palabrasDeCampana(o.texto) === palabrasDeCampana(t))) {
      return { campo: 'texto', texto: 'Otra campaña ya tiene este mismo texto.' };
    }
  }
  if (c.titulares !== undefined && c.titulares.some((x) => x.trim() !== '')) {
    if (titulares.length > MAX_TITULARES) return { campo: 'titulares', texto: `Un anuncio lleva hasta ${MAX_TITULARES} titulares.` };
    for (const x of titulares) {
      const p = problemaDeTitular(x);
      if (p) return { campo: 'titulares', texto: p };
    }
    const mios = new Set(titulares.map(palabrasDeCampana));
    if (otras.some((o) => o.id !== c.id && titularesLimpios(o.titulares).some((x) => mios.has(palabrasDeCampana(x))))) {
      return { campo: 'titulares', texto: 'Otro anuncio ya usa uno de estos titulares: las variantes del mismo titular van en el mismo anuncio.' };
    }
  }
  if ((c.angulo ?? '').trim().length > TOPE_ANGULO) {
    return { campo: 'angulo', texto: `El ángulo supera los ${TOPE_ANGULO} caracteres.` };
  }
  if ((c.angulo ?? '') !== '' && INVISIBLES.test((c.angulo ?? '').normalize('NFKC'))) {
    return { campo: 'angulo', texto: 'El ángulo tiene caracteres ocultos o de control: escríbelo de nuevo.' };
  }
  if (c.productoId && productosActivos && !productosActivos.has(c.productoId)) {
    return { campo: 'productoId', texto: 'El producto ya no existe o no está activo en tu catálogo: elige otro o quítalo.' };
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
  // Igual que `hashLista` del servidor: sin claves nuevas, la cuenta de siempre.
  const texto = JSON.stringify(lista.map((c) => (c.titulares === undefined && c.productoId === undefined && c.angulo === undefined
    ? [c.id, c.texto, c.inicio, c.fin]
    : [c.id, c.texto, c.inicio, c.fin, c.titulares ?? null, c.productoId ?? null, c.angulo ?? null])));
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Un id nuevo con la forma que exige el servidor (`^[a-z0-9-]{1,40}$`). */
export function idNuevo(ahora: number = Date.now()): string {
  return `c${ahora.toString(36)}`;
}
