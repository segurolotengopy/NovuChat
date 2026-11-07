/**
 * Almacén de alertas EN MEMORIA, con la misma semántica que `almacenFirestore()`. No se desvía en silencio: la
 * MISMA batería (`alerta-almacen-contrato.ts`) corre contra esta copia (`alerta-operativa.test.ts`) y contra la real en el
 * emulador (`alerta-operativa-firestore.test.ts`).
 */
import { inmediatosDe, topeValido, HORA_MS, type AlmacenAlertas, type EventoGuardado } from '../../functions/src/plataforma/alertaOperativa.ts';

export type AlmacenMemoria = AlmacenAlertas & {
  eventos: Map<string, EventoGuardado>; dias: Map<string, number>; tipos: Map<string, number>; cuota: { hasta: number | null }; resumenes: Map<string, { ids: string[]; ahoraMs: number }>;
};

export function almacenEnMemoria(): AlmacenMemoria {
  const eventos = new Map<string, EventoGuardado>();
  const dias = new Map<string, number>();
  const tipos = new Map<string, number>();
  const cuota: { hasta: number | null } = { hasta: null };
  const resumenes = new Map<string, { ids: string[]; ahoraMs: number }>();
  return {
    eventos, dias, tipos, cuota, resumenes,
    async crear(e) { if (eventos.has(e.id_unico)) return false; eventos.set(e.id_unico, { ...e }); return true; },
    async poner(id, estado) { const e = eventos.get(id); if (e) e.estado = estado; },
    async reservar(tipo, dia, ahora, tope) {
      const usados = dias.get(dia) ?? 0;
      const ultimo = tipos.has(tipo) ? tipos.get(tipo)! : null;
      if (usados >= inmediatosDe(topeValido(tope)) || (ultimo !== null && ahora - ultimo < HORA_MS)) return { ok: false, previoUltimoMs: ultimo };
      dias.set(dia, usados + 1); tipos.set(tipo, ahora);
      return { ok: true, previoUltimoMs: ultimo };
    },
    async liberar(tipo, dia, previo) { dias.set(dia, Math.max(0, (dias.get(dia) ?? 0) - 1)); tipos.set(tipo, previo ?? 0); },
    async pendientesDeResumen() { return [...eventos.values()].filter((e) => e.resumido_en === null).sort((a, b) => b.recibido_ms - a.recibido_ms).slice(0, 500); },
    async marcarResumidos(ids, ms) { for (const id of ids) { const e = eventos.get(id); if (e) e.resumido_en = ms; } },
    async resumenDelDia(dia) { return resumenes.get(dia) ?? null; },
    async fijarResumenDelDia(dia, ids, ahoraMs) { resumenes.set(dia, { ids, ahoraMs }); },
    async eventosPorId(ids) { return ids.map((i) => eventos.get(i)).filter((e): e is EventoGuardado => e !== undefined); },
    async cuotaHasta() { return cuota.hasta; },
    async marcarCuota(hasta) { cuota.hasta = hasta; },
  };
}
