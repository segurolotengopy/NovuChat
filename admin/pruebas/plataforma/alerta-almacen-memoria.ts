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
  const delTipo = new Map<string, number>();
  return {
    eventos, dias, tipos, cuota, resumenes,
    async crear(e) { if (eventos.has(e.id_unico)) return false; eventos.set(e.id_unico, { ...e }); return true; },
    async poner(id, estado) { const e = eventos.get(id); if (e) e.estado = estado; },
    async reservar(tipo, dia, ahora, tope, maxDelTipoPorDia) {
      const usados = dias.get(dia) ?? 0;
      const ultimo = tipos.has(tipo) ? tipos.get(tipo)! : null;
      const claveTipo = `${dia}_${tipo}`;
      if (maxDelTipoPorDia !== undefined && (delTipo.get(claveTipo) ?? 0) >= maxDelTipoPorDia) return { ok: false, previoUltimoMs: ultimo };
      if (usados >= inmediatosDe(topeValido(tope)) || (ultimo !== null && ahora - ultimo < HORA_MS)) return { ok: false, previoUltimoMs: ultimo };
      dias.set(dia, usados + 1); tipos.set(tipo, ahora);
      if (maxDelTipoPorDia !== undefined) delTipo.set(claveTipo, (delTipo.get(claveTipo) ?? 0) + 1);
      return { ok: true, previoUltimoMs: ultimo };
    },
    async liberar(tipo, dia, previo) {
      dias.set(dia, Math.max(0, (dias.get(dia) ?? 0) - 1)); tipos.set(tipo, previo ?? 0);
      const k = `${dia}_${tipo}`;
      if (delTipo.has(k)) delTipo.set(k, Math.max(0, delTipo.get(k)! - 1));
    },
    async sumarRepetido(id) { const e = eventos.get(id); if (e) e.repetidos = (e.repetidos ?? 0) + 1; },
    async pendientesDeResumen() { return [...eventos.values()].filter((e) => e.resumido_en === null).sort((a, b) => b.recibido_ms - a.recibido_ms).slice(0, 500); },
    async marcarResumidos(ids, ms) { for (const id of ids) { const e = eventos.get(id); if (e) e.resumido_en = ms; } },
    async resumenDelDia(dia) { return resumenes.get(dia) ?? null; },
    async fijarResumenDelDia(dia, ids, ahoraMs) {
      for (const k of [...resumenes.keys()]) if (k < dia) resumenes.delete(k);
      const corte = new Date(Date.parse(`${dia}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      for (const k of [...dias.keys()]) if (k < corte) dias.delete(k);
      for (const k of [...delTipo.keys()]) if (k.slice(0, 10) < corte) delTipo.delete(k);
      resumenes.set(dia, { ids, ahoraMs });
    },
    async eventosPorId(ids) { return ids.map((i) => eventos.get(i)).filter((e): e is EventoGuardado => e !== undefined); },
    async cuotaHasta() { return cuota.hasta; },
    async marcarCuota(hasta) { cuota.hasta = hasta; },
  };
}
