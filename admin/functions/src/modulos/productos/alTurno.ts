import { catalogoParaElPrompt } from './nombreSeguro.js';

type Docs = Parameters<typeof catalogoParaElPrompt>[0];

/**
 * EL CATÁLOGO COMO LO VE EL MODELO, EN EL TURNO (F3b-2e). Era la llamada directa
 * de `ingesta.ts` a `catalogoParaElPrompt`, movida SIN cambiar lógica: los nombres
 * que son frases de instrucción no llegan al modelo. Sin lecturas nuevas (recibe los
 * documentos que el turno YA trajo).
 */
export function catalogoDelTurno(docs: Docs): ReturnType<typeof catalogoParaElPrompt> {
  const filtrado = catalogoParaElPrompt(docs);
  if (filtrado.omitidos > 0) console.info(`catálogo: ${filtrado.omitidos} nombre(s) fuera del prompt`);
  return filtrado;
}
