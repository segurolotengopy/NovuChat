/**
 * =============================================================================
 * EL TIPO DE CAMBIO OFICIAL, LEÍDO DEL BCB CADA DÍA
 * =============================================================================
 *
 * POR QUÉ EXISTE (Andres, 25/09/2026). `plataforma/tipoCambio` lo cargaba una
 * persona con `scripts/fijar-tipo-cambio.mjs`, y vence a los
 * `TCO_DIAS_VIGENCIA` días: un olvido de un fin de semana largo y «Pagar» deja
 * de emitir cobros. La fuente es la que el sitio del BCB muestra en
 * «Tipos de cambio» (www.bcb.gob.bo/?q=cotizaciones_tc), que por dentro carga
 * la tabla de `URL_TABLA_BCB`.
 *
 * LO QUE HACE, tres veces al día (el BCB publica la tabla del día siguiente
 * por la noche, y no publica fines de semana ni feriados):
 *   1. baja la tabla, con tiempo y tamaño acotados;
 *   2. saca la FECHA y el TCO en Bs/USD, y exige que las dos fechas que trae la
 *      página --el rótulo y el título de la tabla-- coincidan;
 *   3. decide (`decidirTipoCambio`, pura): escribe solo si es un TCO válido,
 *      vigente, con fecha posterior o igual a la guardada, y sin un salto de
 *      más de `SALTO_MAXIMO` contra el vigente;
 *   4. escribe el documento y una entrada del historial, en un lote.
 *
 * LO QUE NO HACE, y es a propósito:
 *   - NO inventa un TCO. Si la página no se puede leer, no cuadra o salta
 *     demasiado, NO escribe y deja un error en el registro: el documento sigue
 *     con el último valor bueno, que vale hasta 4 días. Cobrar con un TCO
 *     supuesto es peor que no poder cobrar (`tipoCambio.ts`).
 *   - NO pisa una carga manual más nueva: la fecha manda.
 *   - NO sigue direcciones que vengan de afuera: la URL es una constante.
 *
 * `scripts/fijar-tipo-cambio.mjs` sigue existiendo para corregir a mano, con
 * `--aplicar` y el OK de Andres; la próxima corrida no lo pisa si su fecha es
 * la misma o posterior.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { REGION } from './region.js';
import { esTipoCambio, tipoCambioVigente, type TipoCambio } from './prepago.js';
import { RUTA_TIPO_CAMBIO } from './tipoCambio.js';

/** La tabla que carga la página «Tipos de cambio» del BCB. */
export const URL_TABLA_BCB = 'https://www.bcb.gob.bo/librerias/indicadores/otras/ultimo.php';
/** Un cambio mayor que este contra el TCO vigente no se escribe solo: lo mira una persona. */
export const SALTO_MAXIMO = 0.05;
/** La página pesa ~10 KB; cualquier cosa muy por encima no es la tabla. */
const BYTES_MAXIMOS = 256 * 1024;
const ESPERA_MS = 20_000;
/** Quién firma en el historial una carga automática. */
export const POR_AUTOMATICO = 'bcb-automatico';

const MESES: Readonly<Record<string, string>> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07',
  agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
};

/** Texto plano de un trozo de HTML: sin etiquetas, sin entidades, sin tildes, espacios simples. */
function plano(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&([a-z])(acute|tilde|uml|grave);/gi, '$1')
    .replace(/&amp;/gi, '&')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «25 de Septiembre 2026» o «25 DE SEPTIEMBRE DE 2026» → «2026-09-25»; si no, null. */
function fechaDe(texto: string): string | null {
  const m = /(\d{1,2}) de ([a-z]+)(?: de)? (\d{4})/i.exec(texto);
  if (!m) return null;
  const mes = MESES[m[2]!.toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${mes}-${m[1]!.padStart(2, '0')}`;
}

export type LecturaBcb =
  | { ok: true; tco: number; fecha: string }
  | { ok: false; motivo: string };

/**
 * Lee la tabla del BCB. PURA: el HTML entra, el dato sale. Exige las tres
 * cosas que la hacen confiable: la fecha del rótulo, la del título de la
 * tabla --iguales--, y una sola fila USD en la tabla del TCO.
 */
export function leerTablaBcb(html: string): LecturaBcb {
  const texto = plano(html);
  const rotulo = /FECHA DE LA COTIZACION: ([^|]{0,60}?\d{4})/i.exec(texto);
  const titulo = /TABLA DE COTIZACIONES DEL ([^|]{0,60}?\d{4})/i.exec(texto);
  const fecha = rotulo ? fechaDe(rotulo[1]!) : null;
  const fechaTitulo = titulo ? fechaDe(titulo[1]!) : null;
  if (!fecha) return { ok: false, motivo: 'sin fecha de la cotización' };
  if (fechaTitulo !== fecha) return { ok: false, motivo: 'las dos fechas de la página no coinciden' };

  // La tabla del TCO: desde su encabezado hasta el cierre de esa tabla.
  const inicio = html.search(/Tipo de Cambio Oficial \(TCO\)/i);
  if (inicio < 0) return { ok: false, motivo: 'sin la tabla del TCO' };
  const fin = html.indexOf('</table>', inicio);
  const tabla = html.slice(inicio, fin < 0 ? undefined : fin);
  const filas = [...tabla.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((f) => [...f[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => plano(c[1]!)))
    .filter((celdas) => celdas.includes('USD'));
  if (filas.length !== 1) return { ok: false, motivo: `se esperaba una fila USD y hay ${filas.length}` };
  const valor = filas[0]![filas[0]!.length - 1] ?? '';
  if (!/^\d{1,2}[.,]\d{1,4}$/.test(valor)) return { ok: false, motivo: 'el TCO no es un número' };
  return { ok: true, tco: Number(valor.replace(',', '.')), fecha };
}

export type Decision =
  | { accion: 'escribir'; nuevo: TipoCambio }
  | { accion: 'igual' | 'anterior' | 'rechazar'; motivo: string };

/**
 * ¿Se escribe lo leído? PURA. Nunca hacia atrás, nunca un TCO que el servidor
 * no aceptaría para cobrar, nunca un salto grande sin una persona.
 */
export function decidirTipoCambio(actual: unknown, leido: { tco: number; fecha: string }, ahoraMs: number): Decision {
  const nuevo: TipoCambio = { tco: leido.tco, fecha: leido.fecha, fuente: 'BCB' };
  if (!esTipoCambio(nuevo)) return { accion: 'rechazar', motivo: 'el TCO leído no pasa la validación del servidor' };
  if (!tipoCambioVigente(nuevo, ahoraMs)) return { accion: 'rechazar', motivo: 'la fecha leída es futura o ya no está vigente' };
  const a = (typeof actual === 'object' && actual !== null ? actual : {}) as Record<string, unknown>;
  const tcoActual = typeof a['tco'] === 'number' ? a['tco'] : null;
  const fechaActual = typeof a['fecha'] === 'string' ? a['fecha'] : null;
  if (fechaActual !== null && leido.fecha < fechaActual) return { accion: 'anterior', motivo: 'lo guardado es más nuevo' };
  if (fechaActual === leido.fecha && tcoActual === leido.tco) return { accion: 'igual', motivo: 'sin cambios' };
  if (tcoActual !== null && tcoActual > 0 && Math.abs(leido.tco - tcoActual) / tcoActual > SALTO_MAXIMO) {
    return { accion: 'rechazar', motivo: `salto de ${tcoActual} a ${leido.tco}: más del ${SALTO_MAXIMO * 100} %, lo carga una persona` };
  }
  return { accion: 'escribir', nuevo };
}

/** Inyectables para las pruebas; `ruta` las aísla del documento que usan otras suites. */
export interface DepsBcb { bajar?: () => Promise<string>; ahoraMs?: number; ruta?: string }

async function bajarTabla(): Promise<string> {
  const r = await fetch(URL_TABLA_BCB, {
    headers: { 'user-agent': 'NovuChat-TCO/1.0' }, redirect: 'error', signal: AbortSignal.timeout(ESPERA_MS),
  });
  if (!r.ok) throw new Error(`el BCB respondió ${r.status}`);
  const texto = await r.text();
  if (texto.length > BYTES_MAXIMOS) throw new Error('la respuesta es demasiado grande para ser la tabla');
  return texto;
}

/** Una corrida: bajar, leer, decidir y, si corresponde, escribir. Devuelve qué pasó. */
export async function actualizarTipoCambio(deps: DepsBcb = {}): Promise<{ resultado: string; detalle: string }> {
  const ahoraMs = deps.ahoraMs ?? Date.now();
  let html: string;
  try { html = await (deps.bajar ?? bajarTabla)(); } catch (e) {
    return { resultado: 'sin_lectura', detalle: e instanceof Error ? e.message : 'error al bajar la tabla' };
  }
  const lectura = leerTablaBcb(html);
  if (!lectura.ok) return { resultado: 'ilegible', detalle: lectura.motivo };

  const db = getFirestore();
  const ref = db.doc(deps.ruta ?? RUTA_TIPO_CAMBIO);
  return db.runTransaction(async (tx) => {
    const actual = (await tx.get(ref)).data() ?? null;
    const d = decidirTipoCambio(actual, lectura, ahoraMs);
    if (d.accion !== 'escribir') return { resultado: d.accion, detalle: d.motivo };
    const ahora = Timestamp.fromMillis(ahoraMs);
    tx.set(ref, { ...d.nuevo, actualizadoEn: ahora });
    tx.create(ref.collection('historial').doc(), {
      ...d.nuevo, en: ahora, por: POR_AUTOMATICO,
      antes: actual ? { tco: actual['tco'] ?? null, fecha: actual['fecha'] ?? null } : null,
    });
    return { resultado: 'escrito', detalle: `${d.nuevo.tco} Bs/USD del ${d.nuevo.fecha}` };
  });
}

/**
 * 07:00, 13:00 y 19:00 de La Paz. Tres corridas porque una falla de red o una
 * publicación tardía no tienen que esperar un día; las que no encuentran nada
 * nuevo no escriben. Sin secretos: la tabla es pública.
 */
export const tipoCambioBcb = onSchedule(
  { schedule: '0 7,13,19 * * *', timeZone: 'America/La_Paz', region: REGION, timeoutSeconds: 60, maxInstances: 1 },
  async () => {
    const r = await actualizarTipoCambio();
    const linea = `tipo de cambio BCB: ${r.resultado} (${r.detalle})`;
    if (r.resultado === 'escrito' || r.resultado === 'igual' || r.resultado === 'anterior') console.info(linea);
    else console.error(linea);
  },
);
