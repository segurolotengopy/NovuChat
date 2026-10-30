/**
 * VISOR DE MEDIOS (M3b): la lógica de `central/lib/medios.ts` con la callable `verMedio` simulada.
 * Puras: sin navegador, sin emulador y sin red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  AVISO_DESCARGA, AVISO_WA_ME, MIME_DE_DESCARGA, TEXTO_VENCIDO, nombreDeDescarga, accionDeMedio, enlaceWaMe, medioDeDatos, pedirMedio, textoAnotado, textoDeErrorMedio,
  type LlamarVerMedio, type MedioDeMensaje,
} from '../../web/src/central/lib/medios.ts';

const AHORA = 1_800_000_000_000;
const guardado = (o: Partial<MedioDeMensaje> = {}): MedioDeMensaje =>
  ({ estado: 'guardado', mime: 'image/jpeg', tamano: 10, vence: AHORA + 1000, ...o });
const base = { tenantId: 't1', conversacionId: 'wa_59171234567', idMeta: 'wamid.X', ahora: AHORA };
const B64 = Buffer.from('hola').toString('base64');
const ok = (r: object): LlamarVerMedio => vi.fn(async () => ({ data: r }));
const falla = (code: string, details?: unknown): LlamarVerMedio => vi.fn(async () => { throw Object.assign(new Error('RUTA tenants/x/medios/secreto'), { code, details }); });

describe('qué dibuja cada mensaje', () => {
  it('sin medio, nada; guardado vigente, botón; vencido y anotado, texto', () => {
    expect(accionDeMedio(null, AHORA)).toBe('ninguna');
    expect(accionDeMedio(medioDeDatos(undefined), AHORA)).toBe('ninguna');
    expect(accionDeMedio(guardado(), AHORA)).toBe('ver');
    expect(accionDeMedio(guardado({ vence: AHORA - 1 }), AHORA)).toBe('vencido');
    expect(accionDeMedio(guardado({ estado: 'anotado' }), AHORA)).toBe('anotado');
    expect(accionDeMedio(guardado({ estado: 'pendiente' }), AHORA)).toBe('ninguna');
  });
  it('lee vence de un Timestamp', () => {
    expect(medioDeDatos({ estado: 'guardado', mime: 'audio/ogg', vence: { toMillis: () => 5 } })?.vence).toBe(5);
  });
  it('texto del anotado', () => {
    expect(textoAnotado('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Archivo recibido (Word (docx)); no se guarda');
    expect(textoAnotado('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toContain('Excel');
  });
});

describe('pedirMedio con la callable simulada', () => {
  it('imagen, audio y PDF válidos', async () => {
    const i = await pedirMedio(ok({ tipo: 'image', mime: 'image/png', tamano: 4, base64: B64 }), { ...base, medio: guardado() });
    expect(i).toMatchObject({ ok: true, clase: 'imagen', src: `data:image/png;base64,${B64}` });
    const a = await pedirMedio(ok({ tipo: 'audio', mime: 'audio/ogg', tamano: 4, base64: B64 }), { ...base, medio: guardado({ mime: 'audio/ogg' }) });
    expect(a).toMatchObject({ ok: true, clase: 'audio', mime: 'audio/ogg' });
    const p = await pedirMedio(ok({ tipo: 'document', mime: 'application/pdf', tamano: 4, base64: B64 }), { ...base, medio: guardado({ mime: 'application/pdf' }) });
    expect(p).toMatchObject({ ok: true, clase: 'descarga' });
  });
  it('manda solo tenantId, conversacionId e idMeta', async () => {
    const f = ok({ tipo: 'image', mime: 'image/png', base64: B64 });
    await pedirMedio(f, { ...base, medio: guardado() });
    expect(f).toHaveBeenCalledWith({ tenantId: 't1', conversacionId: 'wa_59171234567', idMeta: 'wamid.X' });
  });
  it('anotado y pendiente no llaman a la callable', async () => {
    const f = ok({});
    const r = await pedirMedio(f, { ...base, medio: guardado({ estado: 'anotado' }) });
    expect(r.ok).toBe(false);
    expect((await pedirMedio(f, { ...base, medio: null })).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('vencido: texto fijo y sin llamada', async () => {
    const f = ok({});
    expect(await pedirMedio(f, { ...base, medio: guardado({ vence: AHORA - 5 }) })).toEqual({ ok: false, texto: TEXTO_VENCIDO });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    ['functions/unauthenticated', 'sesión'], ['functions/permission-denied', 'permiso'], ['functions/not-found', '90 días'],
    ['functions/resource-exhausted', 'máximo'], ['functions/unavailable', 'no está disponible'], ['functions/invalid-argument', 'no se puede mostrar'],
  ])('error %s tiene texto fijo y no filtra el mensaje', async (code, frag) => {
    const r = await pedirMedio(falla(code), { ...base, medio: guardado() });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.texto).toContain(frag); expect(r.texto).not.toMatch(/RUTA|tenants|secreto/); }
  });
  it('failed-precondition distingue anotado y pendiente', async () => {
    expect(textoDeErrorMedio('functions/failed-precondition', 'anotado')).toContain('solo se anotó');
    expect(textoDeErrorMedio('functions/failed-precondition', 'pendiente')).toContain('todavía se está guardando');
    const r = await pedirMedio(falla('functions/failed-precondition', 'pendiente'), { ...base, medio: guardado() });
    expect(r.ok === false && r.texto).toContain('guardando');
    expect(textoDeErrorMedio('x')).toContain('No se pudo abrir');
  });
  it('rechaza tipo/mime incoherentes, mime fuera de lista y base64 roto', async () => {
    for (const r of [
            { tipo: 'video', mime: 'video/mp4', base64: B64 }, { tipo: 'image', mime: 'image/png', base64: '<x>' },
      { tipo: 'audio', mime: 'audio/ogg', base64: 5 }, {},
    ]) expect((await pedirMedio(ok(r), { ...base, medio: guardado() })).ok).toBe(false);
  });
});

describe('documentos: solo descarga', () => {
  it('cualquier documento (incluido html) va a descarga, nunca a vista; imagen fuera de lista también', async () => {
    for (const [tipo, mime] of [['document', 'text/html'], ['document', 'application/pdf'], ['image', 'image/svg+xml']]) {
      const r = await pedirMedio(ok({ tipo, mime, base64: B64 }), { ...base, medio: guardado() });
      expect(r).toMatchObject({ ok: true, clase: 'descarga' });
    }
  });
  it('nombre generado: fecha y extensión segura o .bin', () => {
    expect(nombreDeDescarga('application/pdf', AHORA)).toMatch(/^archivo-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(nombreDeDescarga('text/html', AHORA)).toMatch(/\.bin$/);
    expect(nombreDeDescarga(undefined, AHORA)).toMatch(/\.bin$/);
    expect(AVISO_DESCARGA).toBe('Archivo enviado por un cliente: no lo abra si no confía; puede contener virus.');
    expect(MIME_DE_DESCARGA).toBe('application/octet-stream');
  });
});

describe('enlace wa.me', () => {
  it('solo con 8 a 15 dígitos', () => {
    expect(enlaceWaMe('59171234567')).toBe('https://wa.me/59171234567');
    expect(enlaceWaMe('+59171234567')).toBe('https://wa.me/59171234567');
    for (const t of ['1234567', '1234567890123456', '5917abc4567', '591 7123', '', null, undefined, 5917123456, '59171234567/../x', '59171234567?text=hola']) expect(enlaceWaMe(t)).toBeNull();
  });
  it('no sale para quien no ve conversaciones', () => expect(enlaceWaMe('59171234567', false)).toBeNull());
  it('el aviso dice que queda fuera del sistema y no reemplaza a Tomar', () => {
    expect(AVISO_WA_ME).toContain('FUERA del sistema');
    expect(AVISO_WA_ME).toContain('«Tomar»');
  });
});

describe('la pantalla (lectura del fuente)', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const src = (f: string) => readFileSync(join(aqui, '../../web/src/central', f), 'utf8');
  it('enlace con target e rel; sin HTML crudo ni almacenamiento; el visor no importa de módulos', () => {
    const d = src('componentes/DetalleConversacion.tsx');
    expect(d).toMatch(/target="_blank" rel="noopener noreferrer"/);
    for (const f of ['componentes/VisorMedio.tsx', 'lib/medios.ts', 'componentes/DetalleConversacion.tsx']) {
      const s = src(f);
      expect(s).not.toMatch(/dangerouslySetInnerHTML|localStorage|sessionStorage|\bfetch\(/);
      expect(s).not.toMatch(/from '\.\.\/\.\.\/modulos/);
    }
    const v = src('componentes/VisorMedio.tsx');
    expect(v).toMatch(/revokeObjectURL/);
    expect(v).toMatch(/role="dialog"/);
    expect(v).not.toMatch(/\.message/);
    // descarga: alerta obligatoria, octet-stream, sin abrir inline
    expect(v).toMatch(/AVISO_DESCARGA/);
    expect(v).toMatch(/Descargar de todos modos/);
    expect(v).toMatch(/MIME_DE_DESCARGA/);
    expect(v).not.toMatch(/window\.open|<iframe|<embed|<object/);
  });
  it('CSP: media-src blob: y NINGÚN blob: en frame-src', () => {
    const fb = JSON.parse(readFileSync(join(aqui, '../../firebase.json'), 'utf8'));
    const sitios = Array.isArray(fb.hosting) ? fb.hosting : [fb.hosting];
    const csps: string[] = [];
    for (const h of sitios.flatMap((x: { headers?: { headers: { key: string; value: string }[] }[] }) => x.headers ?? [])) for (const k of h.headers) if (k.key === 'Content-Security-Policy') csps.push(k.value);
    const csp = csps.find((c) => c.includes('script-src'))!;
    expect(csp).toMatch(/media-src blob:;/);
    expect(csp).not.toMatch(/frame-src[^;]*blob:/);
    expect(csp).not.toMatch(/(default|img|script|object)-src[^;]*blob:/);
  });
});
