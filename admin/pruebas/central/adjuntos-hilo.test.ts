/**
 * MEDIOS B4 — EL HILO: un archivo enviado por una persona se lee y se pide por el id del MENSAJE (no por `idMeta`).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  TEXTO_VENCIDO, TEXTO_VENCIDO_ENVIADO, medioDeDatos, pedirMedio, textoDeErrorMedio, type LlamarVerMedio, type MedioDeMensaje,
} from '../../web/src/central/lib/medios';

const medio = (o: Partial<MedioDeMensaje> = {}): MedioDeMensaje =>
  ({ estado: 'guardado', mime: 'image/jpeg', tamano: 10, vence: null, origen: 'recibido', voz: false, nombre: '', ...o });
const base = { tenantId: 't', conversacionId: 'wa_1', accion: 'ver' as const, ahora: 1000 };
const OK = { data: { tipo: 'image', mime: 'image/jpeg', base64: 'AAAA' } };

describe('pedirMedio: mensajeId o idMeta, nunca los dos', () => {
  it('con mensajeId manda mensajeId y NO idMeta', async () => {
    const llamar = vi.fn(async () => OK) as unknown as LlamarVerMedio;
    await pedirMedio(llamar, { ...base, idMeta: '', mensajeId: 'env_abc', medio: medio({ origen: 'enviado' }) });
    expect(llamar).toHaveBeenCalledWith({ tenantId: 't', conversacionId: 'wa_1', mensajeId: 'env_abc', accion: 'ver' });
    const arg = (llamar as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]![0]!;
    expect('idMeta' in arg).toBe(false);
  });
  it('sin mensajeId manda idMeta y NO mensajeId', async () => {
    const llamar = vi.fn(async () => OK) as unknown as LlamarVerMedio;
    await pedirMedio(llamar, { ...base, idMeta: 'wamid.X', medio: medio() });
    const arg = (llamar as unknown as { mock: { calls: Record<string, unknown>[][] } }).mock.calls[0]![0]!;
    expect(arg).toEqual({ tenantId: 't', conversacionId: 'wa_1', idMeta: 'wamid.X', accion: 'ver' });
    expect('mensajeId' in arg).toBe(false);
  });
  it('mensajeId vacío cae a idMeta', async () => {
    const llamar = vi.fn(async () => OK) as unknown as LlamarVerMedio;
    await pedirMedio(llamar, { ...base, idMeta: 'wamid.X', mensajeId: '', medio: medio() });
    expect(llamar).toHaveBeenCalledWith(expect.objectContaining({ idMeta: 'wamid.X' }));
  });
});

describe('medioDeDatos: origen, voz y nombre', () => {
  it('lee un enviado', () => {
    expect(medioDeDatos({ estado: 'guardado', mime: 'audio/ogg', origen: 'enviado', voz: true, nombre: 'a.pdf' }))
      .toMatchObject({ origen: 'enviado', voz: true, nombre: 'a.pdf' });
  });
  it('NEGANDO: un origen raro es «recibido»; voz solo con true; el nombre se corta a 240', () => {
    expect(medioDeDatos({ estado: 'guardado', origen: 'Enviado' })?.origen).toBe('recibido');
    expect(medioDeDatos({ estado: 'guardado', origen: 1 })?.origen).toBe('recibido');
    expect(medioDeDatos({ estado: 'guardado' })?.origen).toBe('recibido');
    expect(medioDeDatos({ estado: 'guardado', voz: 'true' })?.voz).toBe(false);
    expect(medioDeDatos({ estado: 'guardado', voz: 1 })?.voz).toBe(false);
    expect(medioDeDatos({ estado: 'guardado', nombre: 'n'.repeat(500) })?.nombre).toHaveLength(240);
    expect(medioDeDatos({ estado: 'guardado', nombre: 7 })?.nombre).toBe('');
  });
});

describe('textos de un enviado (30 días) y de un recibido (90)', () => {
  it('vencido', async () => {
    const llamar = vi.fn() as unknown as LlamarVerMedio;
    const e = await pedirMedio(llamar, { ...base, idMeta: '', mensajeId: 'm', medio: medio({ origen: 'enviado', vence: 500 }) });
    expect(e).toEqual({ ok: false, texto: TEXTO_VENCIDO_ENVIADO });
    expect(TEXTO_VENCIDO_ENVIADO).toContain('30 días');
    const r = await pedirMedio(llamar, { ...base, idMeta: 'x', medio: medio({ vence: 500 }) });
    expect(r).toEqual({ ok: false, texto: TEXTO_VENCIDO });
    expect(llamar).not.toHaveBeenCalled();
  });
  it('not-found', async () => {
    expect(textoDeErrorMedio('functions/not-found', undefined, 'enviado')).toContain('30 días');
    expect(textoDeErrorMedio('functions/not-found', undefined, 'enviado')).not.toContain('90');
    expect(textoDeErrorMedio('functions/not-found')).toContain('90 días');
    const llamar = (async () => { throw { code: 'functions/not-found' }; }) as unknown as LlamarVerMedio;
    const r = await pedirMedio(llamar, { ...base, idMeta: '', mensajeId: 'm', medio: medio({ origen: 'enviado' }) });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.texto).toContain('30 días');
  });
});
