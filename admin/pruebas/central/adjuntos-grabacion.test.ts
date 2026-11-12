/**
 * MEDIOS B4 — LA GRABACIÓN (clase `Grabadora`) con micrófono, contexto y grabador simulados: lo que se abre se suelta en
 * todo camino, un doble arranque pide el micrófono UNA vez y nunca se graba con un contexto detenido.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Grabadora, TOPE_GRABACION_MS, type ContextoMinimo, type EntornoDeGrabacion, type FormatoGrabacion, type GrabadorMinimo,
} from '../../web/src/central/lib/adjuntos';

const FORMATO: FormatoGrabacion = { mimeGrabacion: 'audio/webm;codecs=opus', mimeDeclarado: 'audio/webm' };

function montar(o: { estadoCtx?: string; falla?: 'grabador' | 'start' | 'microfono'; retraso?: boolean } = {}) {
  const pista = { stop: vi.fn() };
  const cerrar = vi.fn(async () => undefined);
  const recs: GrabadorMinimo[] = [];
  let soltar: () => void = () => undefined;
  const ctx: ContextoMinimo = {
    state: o.estadoCtx ?? 'running', resume: async () => undefined, close: cerrar,
    createMediaStreamSource: () => ({ connect: () => undefined }),
    createMediaStreamDestination: () => ({ stream: { getTracks: () => [] }, channelCount: 2, channelCountMode: 'max', channelInterpretation: 'speakers' }),
  };
  const pedirMicrofono = vi.fn(() => (o.retraso
    ? new Promise<{ getTracks(): { stop(): void }[] }>((ok) => { soltar = () => ok({ getTracks: () => [pista] }); })
    : o.falla === 'microfono' ? Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
      : Promise.resolve({ getTracks: () => [pista] })));
  const entorno: EntornoDeGrabacion = {
    crearContexto: () => ctx,
    pedirMicrofono,
    crearGrabador: () => {
      if (o.falla === 'grabador') throw new Error('MediaRecorder no disponible');
      const rec: GrabadorMinimo = {
        state: 'inactive', ondataavailable: null, onstop: null,
        start() { if (o.falla === 'start') throw new Error('no arranca'); rec.state = 'recording'; },
        stop() { rec.state = 'inactive'; rec.ondataavailable?.({ data: new Blob(['abc']) }); rec.onstop?.(); },
      };
      recs.push(rec);
      return rec;
    },
  };
  return { entorno, pista, cerrar, recs, pedirMicrofono, ctx, liberarMicrofono: () => soltar() };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('Grabadora', () => {
  it('graba mono, entrega lo grabado al detener y suelta pistas y contexto', async () => {
    const m = montar();
    const g = new Grabadora(m.entorno, FORMATO);
    const fin = vi.fn();
    expect(await g.iniciar(fin, () => undefined)).toBe(true);
    expect(g.ocupada).toBe(true);
    g.detener();
    expect(fin).toHaveBeenCalledTimes(1);
    expect(fin.mock.calls[0]![0].trozos).toHaveLength(1);
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
    expect(g.ocupada).toBe(false);
  });
  it('NEGANDO: si el grabador lanza al crearse, se detienen las pistas y se cierra el contexto', async () => {
    const m = montar({ falla: 'grabador' });
    const g = new Grabadora(m.entorno, FORMATO);
    await expect(g.iniciar(() => undefined, () => undefined)).rejects.toThrow();
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
    expect(g.ocupada).toBe(false);
  });
  it('NEGANDO: si start() lanza, también se suelta todo', async () => {
    const m = montar({ falla: 'start' });
    await expect(new Grabadora(m.entorno, FORMATO).iniciar(() => undefined, () => undefined)).rejects.toThrow();
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
  });
  it('NEGANDO: sin permiso del micrófono el error llega con su nombre y el contexto se cierra', async () => {
    const m = montar({ falla: 'microfono' });
    await expect(new Grabadora(m.entorno, FORMATO).iniciar(() => undefined, () => undefined)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(m.cerrar).toHaveBeenCalled();
  });
  it('NEGANDO: un contexto suspendido es un error y se suelta todo (nunca se graba en silencio)', async () => {
    const m = montar({ estadoCtx: 'suspended' });
    const g = new Grabadora(m.entorno, FORMATO);
    await expect(g.iniciar(() => undefined, () => undefined)).rejects.toMatchObject({ name: 'ErrorDeGrabacion' });
    expect(m.recs).toHaveLength(0);
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
  });
  it('NEGANDO: un doble arranque pide el micrófono UNA sola vez', async () => {
    const m = montar({ retraso: true });
    const g = new Grabadora(m.entorno, FORMATO);
    const a = g.iniciar(() => undefined, () => undefined);
    const b = g.iniciar(() => undefined, () => undefined);
    expect(await b).toBe(false);
    m.liberarMicrofono();
    expect(await a).toBe(true);
    expect(m.pedirMicrofono).toHaveBeenCalledTimes(1);
    expect(await g.iniciar(() => undefined, () => undefined)).toBe(false);   // ya graba
    expect(m.pedirMicrofono).toHaveBeenCalledTimes(1);
  });
  it('descartar no entrega nada y suelta el micrófono al instante', async () => {
    const m = montar();
    const g = new Grabadora(m.entorno, FORMATO);
    const fin = vi.fn();
    await g.iniciar(fin, () => undefined);
    g.descartar();
    expect(fin).not.toHaveBeenCalled();
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
    expect(g.ocupada).toBe(false);
  });
  it('el tope de 4 minutos detiene SU grabador y entrega', async () => {
    const m = montar();
    const g = new Grabadora(m.entorno, FORMATO);
    const fin = vi.fn();
    await g.iniciar(fin, () => undefined);
    vi.advanceTimersByTime(TOPE_GRABACION_MS - 1);
    expect(fin).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fin).toHaveBeenCalledTimes(1);
    expect(m.pista.stop).toHaveBeenCalled();
  });
  it('el tope de una grabación vieja no corta la nueva', async () => {
    const m = montar();
    const g = new Grabadora(m.entorno, FORMATO);
    await g.iniciar(() => undefined, () => undefined);
    g.descartar();
    vi.advanceTimersByTime(60_000);
    const fin2 = vi.fn();
    await g.iniciar(fin2, () => undefined);
    vi.advanceTimersByTime(TOPE_GRABACION_MS - 60_000 + 1000);   // pasó el tope de la primera, no el de la segunda
    expect(fin2).not.toHaveBeenCalled();
    expect(m.recs[1]!.state).toBe('recording');
  });
  it('destruir (desmontaje) suelta todo y no deja empezar de nuevo', async () => {
    const m = montar();
    const g = new Grabadora(m.entorno, FORMATO);
    const fin = vi.fn();
    await g.iniciar(fin, () => undefined);
    g.destruir();
    expect(fin).not.toHaveBeenCalled();
    expect(m.pista.stop).toHaveBeenCalled();
    expect(await g.iniciar(() => undefined, () => undefined)).toBe(false);
  });
  it('NEGANDO: si se desmonta mientras se pide el micrófono, las pistas del flujo nuevo se detienen', async () => {
    const m = montar({ retraso: true });
    const g = new Grabadora(m.entorno, FORMATO);
    const a = g.iniciar(() => undefined, () => undefined);
    g.destruir();
    m.liberarMicrofono();
    expect(await a).toBe(false);
    expect(m.pista.stop).toHaveBeenCalled();
    expect(m.cerrar).toHaveBeenCalled();
    expect(m.recs).toHaveLength(0);
  });
});
