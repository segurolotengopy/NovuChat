/**
 * INVARIANTE GLOBAL «la baja por texto se respeta y se confirma» (13/11/2026; decisión de Andres del 12/11/2026, brecha A del análisis de UX).
 *
 * La política de WhatsApp Business obliga a respetar a quien pide no recibir más mensajes. En NovuChat eso son DOS hechos por flujo,
 * y los dos se miran de forma ESTÁTICA en el JSON versionado (lo que el flujo lleva, no lo que promete un prompt):
 *
 *  - `reporte`: el nodo «Reportar mensaje (entrante)» marca `no_contactar` con la expresión de la pieza común
 *    (`Flujos/src/core/conversacion/baja.js`), LITERAL, y sobre el texto plegado igual que ella. Con otra expresión, el flujo marca
 *    a quien no pidió la baja (la amplia: «¿no me llamaron ayer?») o no marca a quien sí.
 *  - `confirma`: algún nodo Code del flujo INCLUYE la pieza común byte a byte y la LLAMA (`bjPideBaja(` para decidir, `bjTextoBaja(` para
 *    contestar la confirmación fija en vez del menú o del modelo). Que la use bien lo prueba la suite de cada flujo.
 *
 * Las piezas puras viven aquí y no en el `*.test.ts` porque importar un archivo de pruebas desde otro vuelve a ejecutar sus `describe`.
 * Los nombres de cliente no aparecen en el código: los flujos entran por su ruta, como dato.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Flujo } from '../../lib/flujo';
import { SRC_CORE } from '../migracion/comprobaciones';

/** Los dos hechos que se exigen a cada flujo que atiende a un cliente. */
export const HECHOS_DE_BAJA = ['reporte', 'confirma'] as const;
export type HechoDeBaja = (typeof HECHOS_DE_BAJA)[number];

export const RUTA_PIEZA_BAJA = join(SRC_CORE, 'conversacion', 'baja.js');
export const NODO_REPORTE = 'Reportar mensaje (entrante)';

/** El texto de la pieza común, sin el salto final (los constructores la pegan con o sin él). */
export const fuenteDeBaja = (ruta: string = RUTA_PIEZA_BAJA): string => readFileSync(ruta, 'utf8').replace(/\n+$/, '');

/** El literal `/…/i` de `BJ_BAJA`, tal como está escrito en la pieza. */
export function expresionDeBaja(fuente: string = fuenteDeBaja()): string {
  const m = /^const BJ_BAJA = (\/.+\/i);$/m.exec(fuente);
  if (!m) throw new Error('baja.js: no se encontró `const BJ_BAJA = /…/i;` en una sola línea');
  return m[1]!;
}

/** La cadena de plegado de `bjPlegar`, desde el primer `.normalize(` hasta antes del `;`: lo que se aplica al texto antes de probar. */
export function plegadoDeBaja(fuente: string = fuenteDeBaja()): string {
  const m = /^function bjPlegar\(texto\) \{\n {2}return String\(texto === undefined \|\| texto === null \? '' : texto\)(\..+);\n\}$/m.exec(fuente);
  if (!m) throw new Error('baja.js: no se encontró el cuerpo de `bjPlegar`');
  return m[1]!;
}

const textoDe = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));

/**
 * ¿De dónde sale el `no_contactar` del reporte entrante? `core`: el nodo lleva el literal de la pieza común Y su plegado, seguidos de
 * `.test(` (no basta con que el literal aparezca en un comentario). `otra`: marca `no_contactar` con otra expresión o desde un campo
 * calculado en otro nodo. `ninguna`: no lo marca.
 */
export function reporteDeBaja(f: Flujo, fuente: string = fuenteDeBaja()): 'core' | 'otra' | 'ninguna' {
  const n = f.nodes.find((x) => x.name === NODO_REPORTE);
  const cuerpo = textoDe((n?.parameters as Record<string, unknown> | undefined)?.['jsonBody']);
  if (!cuerpo.includes('no_contactar')) return 'ninguna';
  const i = cuerpo.indexOf(`${expresionDeBaja(fuente)}.test(`);
  return i >= 0 && cuerpo.indexOf(plegadoDeBaja(fuente), i) > i ? 'core' : 'otra';
}

/**
 * ¿Algún nodo Code del flujo incluye la pieza común byte a byte Y la usa? «La usa» = llama a `bjPideBaja(` y a `bjTextoBaja(` en código
 * que no es el de la pieza (llevarla pegada sin llamarla no confirma nada). Las dos llamadas pueden estar en nodos distintos.
 */
export function incluyeLaPiezaDeBaja(f: Flujo, fuente: string = fuenteDeBaja()): boolean {
  const propios = f.nodes
    .map((n) => textoDe((n.parameters as Record<string, unknown> | undefined)?.['jsCode']))
    .filter((c) => c.includes(fuente))
    .map((c) => c.split(fuente).join(''));
  return propios.some((c) => c.includes('bjPideBaja(')) && propios.some((c) => c.includes('bjTextoBaja('));
}

/** Los hechos que el flujo NO cumple (vacío = cumple los dos). */
export function faltasDeBaja(f: Flujo, fuente: string = fuenteDeBaja()): HechoDeBaja[] {
  const faltas: HechoDeBaja[] = [];
  if (reporteDeBaja(f, fuente) !== 'core') faltas.push('reporte');
  if (!incluyeLaPiezaDeBaja(f, fuente)) faltas.push('confirma');
  return faltas;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// EXCEPCIONES: lista CERRADA, propia de esta regla, que SOLO BAJA. No vive en `migracion/excepciones.ts` a propósito: aquella mide la
// deuda de la mudanza y su tope no sube; esta mide qué flujos todavía no adoptan la baja común, con las decisiones de Andres del
// 12 y 13/11/2026 (botones, vía la sesión Principal). Cambiar `TOPE_BAJA`, `ALTA_BAJA` o un `vence` exige pasar por el agente `seguridad`.
// ---------------------------------------------------------------------------------------------------------------------------------
export interface ExcepcionDeBaja { hechos: readonly HechoDeBaja[]; motivo: string; dueno: string; vence: string }

export const ALTA_BAJA = '2026-11-13';
/** Ninguna excepción vence más de 90 días después del alta. */
export const LIMITE_BAJA = '2027-02-11';
const VENCE = '2027-01-31';

const CONGELADO_CONSULTORIO = 'Flujo vivo congelado por orden de Andres: recibe la baja común con su mudanza, en una sola republicación (botón del 13/11/2026).';
const CONGELADO_CAPTACION = 'Congelado: Andres decidió el 13/11/2026 retirarlo al final; no recibe cambios.';
const VENTA_MINIMA = 'En manos de otra sesión hasta que se publique al restaurante: recibe la baja común en el último PR de esta serie.';
const CON_AGENTE = 'Flujo con el agente de n8n: excepción declarada por Andres el 13/11/2026; no se toca hasta su retiro o su mudanza.';
const COPIA_DECLARADA = 'Ya confirma la baja con una copia propia de la expresión (otro prefijo): pasa a la pieza común en la etapa 1 de la migración.';

/** Clave: la ruta del JSON relativa a `Flujos/` SIN la carpeta de nivel superior (`idDeFlujo`), para que sobreviva a una mudanza. */
export const EXCEPCIONES_DE_BAJA: Record<string, ExcepcionDeBaja> = {
  'agenda-minima/agenda-minima.v0.json': { hechos: ['reporte', 'confirma'], motivo: CONGELADO_CONSULTORIO, dueno: 'Rearquitectura (mudanza)', vence: VENCE },
  'captacion-minima/captacion-minima.novuchat.json': { hechos: ['reporte', 'confirma'], motivo: CONGELADO_CAPTACION, dueno: 'Principal', vence: VENCE },
  'venta-minima/venta-minima.qtaco.json': { hechos: ['reporte', 'confirma'], motivo: VENTA_MINIMA, dueno: 'UX de conversación', vence: VENCE },
  'venta-minima/venta-minima.qtaco-3727.json': { hechos: ['reporte', 'confirma'], motivo: VENTA_MINIMA, dueno: 'UX de conversación', vence: VENCE },
  'bellido-agendamiento.json': { hechos: ['reporte', 'confirma'], motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'demo-a-agendamiento.json': { hechos: ['reporte', 'confirma'], motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'demo-b-venta-cobro.json': { hechos: ['reporte', 'confirma'], motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'novuchat-onboarding.json': { hechos: ['reporte', 'confirma'], motivo: CON_AGENTE, dueno: 'Principal', vence: VENCE },
  'rroca-antonio/rroca-antonio.json': { hechos: ['confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-ruben/rroca-ruben.json': { hechos: ['confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-emma/rroca-emma.json': { hechos: ['reporte', 'confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'rroca-evy/rroca-evy.json': { hechos: ['reporte', 'confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'doctoras/doctoras.rroca-emma.json': { hechos: ['reporte', 'confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
  'doctoras/doctoras.rroca-evy.json': { hechos: ['reporte', 'confirma'], motivo: COPIA_DECLARADA, dueno: 'Rearquitectura (etapa 1)', vence: VENCE },
};
/** Cuántos flujos tienen excepción hoy. SOLO BAJA: un flujo nuevo nace con la baja común. */
export const TOPE_BAJA = 14;

const AAAA_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Cruza lo medido hoy (`faltas`: id del flujo → hechos que no cumple; solo los flujos con alguna falta) con las excepciones:
 * toda falta tiene su excepción, toda excepción sigue siendo una falta (una que ya se cumple SOBRA: hay que borrarla), y la forma
 * de cada excepción es válida (motivo, dueño, vencimiento dentro del límite y sin vencer).
 */
export function problemasDeBaja(
  faltas: Map<string, HechoDeBaja[]>, excepciones: Record<string, ExcepcionDeBaja> = EXCEPCIONES_DE_BAJA,
  tope: number = TOPE_BAJA, hoy: string = new Date().toISOString().slice(0, 10), limite: string = LIMITE_BAJA,
): string[] {
  const p: string[] = [];
  const claves = Object.keys(excepciones);
  if (claves.length > tope) p.push(`hay ${claves.length} excepciones y el tope es ${tope}: el tope solo baja`);
  for (const [id, e] of Object.entries(excepciones)) {
    if (!e.motivo.trim()) p.push(`${id}: excepción sin motivo`);
    if (!e.dueno.trim()) p.push(`${id}: excepción sin dueño`);
    if (!AAAA_MM_DD.test(e.vence)) p.push(`${id}: «vence» no es una fecha AAAA-MM-DD`);
    else if (e.vence > limite) p.push(`${id}: vence después del límite (${limite})`);
    else if (e.vence < hoy) p.push(`${id}: excepción VENCIDA el ${e.vence}: o el flujo adopta la baja común, o se renueva con una decisión de Andres`);
    if (e.hechos.length === 0) p.push(`${id}: excepción sin hechos`);
    const medidas = faltas.get(id);
    if (!medidas) { p.push(`${id}: SOBRA, el flujo no existe o ya cumple la baja común; hay que borrarla`); continue; }
    for (const h of e.hechos) if (!medidas.includes(h)) p.push(`${id}#${h}: SOBRA, el flujo ya lo cumple; hay que quitarlo de la excepción`);
  }
  for (const [id, medidas] of faltas) {
    for (const h of medidas) if (!excepciones[id]?.hechos.includes(h)) p.push(`${id}#${h}: no cumple la baja común y no tiene excepción declarada`);
  }
  return p;
}
