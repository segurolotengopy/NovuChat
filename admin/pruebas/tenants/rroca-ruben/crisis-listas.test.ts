/**
 * LAS DOS LISTAS DE LA RED DE CRISIS de Rubén (criterio de cierre del PR-1, Principal, 04/11/2026). Son datos fáciles de ampliar: las variantes nuevas que aparezcan se agregan aquí (en el PR-2) y no se parchan frase por frase.
 *   - FRASES_DE_CRISIS: frases reales que DEBEN disparar la crisis (`rrEsCrisis`). Principio: la red es amplia; ante la duda, crisis.
 *   - CONTROL_DE_FALSOS_POSITIVOS: frases cotidianas de venta o de insomnio que NO deben dispararla (cortaría la venta 48 h y reportaría `no_contactar`).
 *   - DERIVAN_COMO_MEDICA / NO_DERIVAN_COMO_MEDICA: la derivación médica (`rrDerivacion`), que solo aplica a lo que NO es crisis.
 * La red tiene DOS capas: el código (`rrEsCrisis`, estas listas) y la marca RIESGO que devuelve el modelo (probada en venta.test.ts); sus límites están en DISENO.md.
 */
import { describe, expect, it } from 'vitest';
import { cargarLibrerias } from './librerias';

const L = cargarLibrerias('rrEsCrisis, rrDerivacion, rrNorm') as { rrEsCrisis: (n: string) => boolean; rrDerivacion: (n: string, c: object) => { clave: string } | null; rrNorm: (t: string) => string };
const crisis = (f: string): boolean => L.rrEsCrisis(L.rrNorm(f));
const clave = (f: string): string => L.rrDerivacion(L.rrNorm(f), {})?.clave ?? '';

export const FRASES_DE_CRISIS: string[] = [
  "me quiero colgar",
  "colgarme",
  "me voy a tirar del puente",
  "ya me cansé de vivir",
  "estoy harta de vivir",
  "estoy harto de vivir con el insomnio",
  "estoy cansada de vivir",
  "tomé una sobredosis",
  "me tomaría una sobredosis",
  "pienso en una sobredosis",
  "pensé en una sobredosis",
  "me voy a tomar una sobredosis",
  "sobredosis",
  "quiero desaparecer",
  "solo quiero desaparecer",
  "a veces quiero desaparecer",
  "me dan ganas de desaparecer",
  "quisiera desaparecer y no volver",
  "quiero desaparecer, ya no puedo más",
  "quiero desaparecer del mundo",
  "quiero desaparecer para siempre",
  "no vale la pena seguir",
  "ya no vale la pena seguir",
  "siento que no vale la pena seguir.",
  "no vale la pena seguir así",
  "no vale la pena seguir con esto",
  "no vale la pena seguir adelante",
  "no vale la pena seguir viviendo",
  "me quiero morir",
  "quiero acabar con todo",
  "no quiero seguir viviendo",
  "ya no quiero vivir",
  "quiero quitarme la vida",
  "me tomaría todas las pastillas",
  "quiero dormir y no despertar",
  "quisiera desaparecer esta noche",
  "quiero desaparecer este mes",
  "quiero desaparecer mi vida",
  "no vale la pena seguir con el sufrimiento",
  "hay riesgo de sobredosis, igual lo voy a hacer",
  "quiero dormir para siempre",
  "me tomaría el frasco entero",
  "ya no aguanto más",
  "ya no puedo más con esta vida",
  "mejor no despertarme",
  "ojalá no despertar",
  "no quiero despertar mañana",
  "no quiero estar aquí",
  "quisiera no existir",
  "quiero dejar de existir",
  "mejor me muero",
  "tengo ganas de morir",
  "ganas de morirme",
  "me haría daño",
  "me corto las venas",
  "me quiero cortar el brazo",
  "no le veo sentido a la vida",
  "todos estarían mejor sin mí",
  "ya fue, no quiero seguir",
  "me tomé todas las pastillas",
  "me tomo todas mis pastillas",
  "me tomé muchas pastillas",
  "voy a tomarme todo el frasco",
  "kiero morirme",
  "me kiero morir",
  "qiero morir",
  "quiero morirrr",
  "me quiero mmorir",
  "tomé una sobre dosis",
  "ya no aguanto más esta vida",
  "ya no aguanto la vida",
  "ya no aguanto más de vivir",
  "ya no aguanto tanto dolor",
  "mejor no despertar al día siguiente",
  "ojalá no despertar a la mañana siguiente",
  "me tomé el frasco",
  "me tomé todo el frasco de clonazepam",
];

export const CONTROL_DE_FALSOS_POSITIVOS: string[] = [
  "quiero desaparecer mis ojeras",
  "quiero desaparecer el insomnio",
  "quiero desaparecer las ojeras",
  "quiero desaparecer el cansancio",
  "quiero desaparecer las pesadillas",
  "no vale la pena seguir intentando con pastillas",
  "no vale la pena seguir con el libro",
  "no vale la pena seguir probando",
  "hay riesgo de sobredosis con melatonina",
  "¿puede causar sobredosis?",
  "¿hay riesgo de sobredosis con el clonazepam?",
  "¿cuál es la dosis máxima de melatonina?",
  "¿qué dosis de melatonina debo usar junto con el libro?",
  "quiero suspender la melatonina, ¿puedo?",
  "mi receta de zolpidem, ¿cómo la combino?",
  "ya no aguanto más sin dormir",
  "mejor no despertar a mi esposo",
  "no quiero despertar mañana temprano",
  "no quiero estar aquí en esta lista",
  "me corto el pelo",
  "me tomo las pastillas de la tienda",
  "¿cuánto clonazepam puedo tomar?",
  "¿puedo tomar melatonina junto con clonazepam?",
  "¿cuántas pastillas de melatonina son demasiado?",
  "¿puedo tomar 10 mg de melatonina?",
  "¿cuánto cuesta el libro? tomo melatonina",
  "no quiero tomar pastillas, ¿me sirve?",
  "tomo melatonina, ¿puedo usar el libro?",
  "tomo melatonina junto con una infusión, ¿sirve el audiolibro?",
  "ya no aguanto más a mi jefe",
  "ya no aguanto más el ruido",
  "mejor no despertar a mi esposa",
  "quiero desaparecer el miedo a la noche",
  "tomo muchas pastillas y no duermo, ¿el libro sirve?",
  "me tomé muchas pastillas para dormir y no funcionan",
  "cuántas páginas tiene el libro, tomo melatonina",
  "cuántas personas lo compraron, yo tomo melatonina",
  "cuánto cuesta el pack, tomo 3 mg de melatonina",
  "tomo melatonina y clonazepam, ¿sirve el libro?",
  "hola, quiero el pack completo",
  "¿cuánto cuesta el audiolibro?",
  "me cuesta mucho dormir por las noches",
  "quiero comprar el libro con bono",
  "mi pareja ronca y no me deja dormir",
  "¿cuántos capítulos tiene el audiolibro?",
];

export const CONTROL_PRECISO: string[] = ['voy a colgar la ropa', 'mi hermano se va a tirar al agua en la piscina'];

export const DERIVAN_COMO_MEDICA: string[] = [
  "hay riesgo de sobredosis con melatonina",
  "¿puede causar sobredosis?",
  "¿hay riesgo de sobredosis con el clonazepam?",
  "¿cuál es la dosis máxima de melatonina?",
  "¿qué dosis de melatonina debo usar junto con el libro?",
  "quiero suspender la melatonina, ¿puedo?",
  "mi receta de zolpidem, ¿cómo la combino?",
  "¿cuánto clonazepam puedo tomar?",
  "¿puedo tomar melatonina junto con clonazepam?",
  "¿cuántas pastillas de melatonina son demasiado?",
  "¿puedo tomar 10 mg de melatonina?",
];

export const NO_DERIVAN_COMO_MEDICA: string[] = [
  "quiero desaparecer mis ojeras",
  "quiero desaparecer el insomnio",
  "quiero desaparecer las ojeras",
  "quiero desaparecer el cansancio",
  "quiero desaparecer las pesadillas",
  "no vale la pena seguir intentando con pastillas",
  "no vale la pena seguir con el libro",
  "no vale la pena seguir probando",
  "ya no aguanto más sin dormir",
  "mejor no despertar a mi esposo",
  "no quiero despertar mañana temprano",
  "no quiero estar aquí en esta lista",
  "me corto el pelo",
  "me tomo las pastillas de la tienda",
  "¿cuánto cuesta el libro? tomo melatonina",
  "no quiero tomar pastillas, ¿me sirve?",
  "tomo melatonina, ¿puedo usar el libro?",
  "tomo melatonina junto con una infusión, ¿sirve el audiolibro?",
  "ya no aguanto más a mi jefe",
  "ya no aguanto más el ruido",
  "mejor no despertar a mi esposa",
  "quiero desaparecer el miedo a la noche",
  "tomo muchas pastillas y no duermo, ¿el libro sirve?",
  "me tomé muchas pastillas para dormir y no funcionan",
  "cuántas páginas tiene el libro, tomo melatonina",
  "cuántas personas lo compraron, yo tomo melatonina",
  "cuánto cuesta el pack, tomo 3 mg de melatonina",
  "tomo melatonina y clonazepam, ¿sirve el libro?",
  "hola, quiero el pack completo",
  "¿cuánto cuesta el audiolibro?",
  "me cuesta mucho dormir por las noches",
  "quiero comprar el libro con bono",
  "mi pareja ronca y no me deja dormir",
  "¿cuántos capítulos tiene el audiolibro?",
];

describe('red de crisis: las frases reales disparan', () => {
  it('hay al menos 30 frases', () => { expect(FRASES_DE_CRISIS.length).toBeGreaterThanOrEqual(30); });
  it.each(FRASES_DE_CRISIS)('crisis: %s', (f) => { expect(crisis(f)).toBe(true); });
});

describe('red de crisis: el control de falsos positivos NO dispara', () => {
  it('hay al menos 20 frases', () => { expect(CONTROL_DE_FALSOS_POSITIVOS.length).toBeGreaterThanOrEqual(20); });
  it.each(CONTROL_DE_FALSOS_POSITIVOS)('no crisis: %s', (f) => { expect(crisis(f)).toBe(false); });
});

describe('derivación médica (solo lo que no es crisis)', () => {
  it.each(DERIVAN_COMO_MEDICA.filter((f) => !crisis(f)))('medica: %s', (f) => { expect(clave(f)).toBe('medica'); });
  it.each(NO_DERIVAN_COMO_MEDICA)('no medica: %s', (f) => { expect(clave(f)).not.toBe('medica'); });
});

describe('control preciso de las raíces nuevas', () => {
  it.each(CONTROL_PRECISO)('no crisis: %s', (f) => { expect(crisis(f)).toBe(false); });
});

// PENDIENTES DEL PR-2 (NO implementados aquí; ante la duda son crisis salvo los falsos positivos conocidos). Se mueven a las listas de arriba cuando el PR-2 los cubra.
export const PENDIENTES_PR2_CRISIS: string[] = [
  'ya no tiene sentido vivir', 'pa que sigo viviendo', 'me quiero ir para siempre', 'ojalá me muera dormido', 'ganas de no despertar nunca más',
  'me tomé un montón de pastillas', 'me lastimo los brazos', 'esta es mi despedida', 'me tomé muchas pastillas para dormir todas juntas', 'me tomé muchas pastillas para no despertar',
];
export const PENDIENTES_PR2_FALSOS_POSITIVOS: string[] = [
  'ya no aguanto más mi insomnio', 'ya no aguanto tanto insomnio', 'ya no aguanto más de no dormir', 'ya no aguanto más mis noches sin dormir', 'ya no aguanto más despertarme a las 3',
  'ya no aguanto más esta situación con mi vecino', 'no quiero estar aquí mucho tiempo, mándame el precio',
];
describe('pendientes del PR-2 (registrados, sin implementar)', () => {
  it.todo.each([...PENDIENTES_PR2_CRISIS.map((f) => `debe ser crisis: ${f}`), ...PENDIENTES_PR2_FALSOS_POSITIVOS.map((f) => `no debe ser crisis: ${f}`)])('%s', () => undefined);
});
