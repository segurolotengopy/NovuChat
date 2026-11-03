/**
 * AGENDAS CONTADAS (módulo Agenda, H2b-9; decisión Q6=A de Andres).
 *
 * Cuentan los `calendarioId` DISTINTOS entre los funcionarios ACTIVOS. Un
 * funcionario activo con `calendarioId` vacío usa el calendario del comercio y
 * no cuenta. Es el criterio ÚNICO: lo comparten la consola (`Funcionarios.tsx`)
 * y `scripts/modulos/agenda/contar-agendas.mjs`; las reglas de Firestore
 * (`claveAgenda()` en `firestore.rules`) lo repiten porque no pueden importar
 * TypeScript, y `pruebas/modulos/agenda/limite-agendas.test.ts` las compara.
 *
 * El contador `contadores/agendas` es `{ calendarios, refs, ultimoFuncionario,
 * actualizadoEn }`: `refs` dice cuántos funcionarios activos usan cada
 * calendario (clave en minúsculas) y `calendarios` cuántas claves tienen
 * más de cero.
 *
 * Puro: sin Firestore, sin dependencias.
 */

/** El calendario que aporta un funcionario, en minúsculas; '' si no aporta ninguno. */
export function claveAgenda(f: { activo?: unknown; calendarioId?: unknown } | null | undefined): string {
  if (!f || f.activo !== true) return '';
  return typeof f.calendarioId === 'string' && f.calendarioId !== '' ? f.calendarioId.toLowerCase() : '';
}

export interface ContadorAgendas {
  calendarios: number;
  refs: Record<string, number>;
}

/** Cuenta desde cero (conteo inicial y reconciliación). */
export function contarAgendas(
  funcionarios: Array<{ activo?: unknown; calendarioId?: unknown }>,
): ContadorAgendas {
  const refs: Record<string, number> = {};
  for (const f of funcionarios) {
    const c = claveAgenda(f);
    if (c !== '') refs[c] = (refs[c] ?? 0) + 1;
  }
  return { calendarios: Object.values(refs).filter((n) => n > 0).length, refs };
}

/** Pasar el aporte de `antes` a `despues`: el contador resultante. */
export function moverAgenda(c: ContadorAgendas, antes: string, despues: string): ContadorAgendas {
  if (antes === despues) return { calendarios: c.calendarios, refs: { ...c.refs } };
  const refs = { ...c.refs };
  let calendarios = c.calendarios;
  if (antes !== '') {
    refs[antes] = Math.max(0, (refs[antes] ?? 0) - 1);
    if (refs[antes] === 0) calendarios -= 1;
  }
  if (despues !== '') {
    if ((refs[despues] ?? 0) === 0) calendarios += 1;
    refs[despues] = (refs[despues] ?? 0) + 1;
  }
  return { calendarios, refs };
}

/**
 * ¿Pasar de `antes` a `despues` supera el tope? Solo si el cambio SUBE el
 * número de agendas por encima del límite: quitar o mover dentro de lo ya
 * contado siempre se puede (un comercio que bajó de plan edita y baja gente).
 */
export function superaElTope(c: ContadorAgendas, antes: string, despues: string, limite: number): boolean {
  const nuevo = moverAgenda(c, antes, despues).calendarios;
  return nuevo > limite && nuevo > c.calendarios;
}
