/**
 * VISOR DE MEDIOS (M3b): la lógica de `central/lib/medios.ts` con la callable `verMedio` simulada.
 * Puras: sin navegador, sin emulador y sin red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  AVISO_DESCARGA, AVISO_WA_ME, TEXTO_PENDIENTE, descargadorUnico, MS_REVOCAR, MIME_DE_DESCARGA, TEXTO_VENCIDO, nombreDeDescarga, avisoExtraDe, modoDeMedio, extensionSegura, AVISO_MACROS, accionDeMedio, enlaceWaMe, medioDeDatos, pedirMedio, textoAnotado, textoDeErrorMedio,
  type LlamarVerMedio, type MedioDeMensaje,
} from '../../web/src/central/lib/medios.ts';

/** Los números se arman en tiempo de ejecución: ningún literal de 10 o más dígitos en el repo. */
const num = (...p: string[]) => p.join('');
const TEL = num('591', '7', '12', '34567');
const AHORA = 18 * 10 ** 11;
const guardado = (o: Partial<MedioDeMensaje> = {}): MedioDeMensaje =>
  ({ estado: 'guardado', mime: 'image/jpeg', tamano: 10, vence: AHORA + 1000, ...o });
const base = { tenantId: 't1', conversacionId: `wa_${TEL}`, idMeta: 'wamid.X', accion: 'ver' as const, ahora: AHORA };
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
    expect(accionDeMedio(guardado({ estado: 'pendiente' }), AHORA)).toBe('pendiente');
    expect(accionDeMedio(guardado({ estado: 'otro' }), AHORA)).toBe('ninguna');
    expect(TEXTO_PENDIENTE).toBe('Todavía se está guardando el archivo.');
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
    const p = await pedirMedio(ok({ tipo: 'document', mime: 'application/pdf', tamano: 4, base64: B64 }), { ...base, accion: 'descargar', medio: guardado({ mime: 'application/pdf' }) });
    expect(p).toMatchObject({ ok: true, clase: 'descarga' });
  });
  it('manda solo tenantId, conversacionId e idMeta', async () => {
    const f = ok({ tipo: 'image', mime: 'image/png', base64: B64 });
    await pedirMedio(f, { ...base, medio: guardado() });
    expect(f).toHaveBeenCalledWith({ tenantId: 't1', conversacionId: `wa_${TEL}`, idMeta: 'wamid.X', accion: 'ver' });
  });
  it('anotado, pendiente y sin medio no llaman a la callable', async () => {
    const f = ok({});
    const r = await pedirMedio(f, { ...base, medio: guardado({ estado: 'anotado' }) });
    expect(r.ok).toBe(false);
    expect((await pedirMedio(f, { ...base, medio: null })).ok).toBe(false);
    expect((await pedirMedio(f, { ...base, medio: guardado({ estado: 'pendiente' }) })).ok).toBe(false);
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
  const desc = { ...base, accion: 'descargar' as const, medio: guardado({ mime: 'application/pdf' }) };
  it('documento y video van a descarga con la extensión de la respuesta; envía accion descargar', async () => {
    for (const [tipo, mime] of [['document', 'text/html'], ['document', 'application/pdf'], ['video', 'video/mp4']]) {
      const f = ok({ tipo, mime, extension: 'pdf', base64: B64 });
      const r = await pedirMedio(f, { ...desc });
      expect(r).toMatchObject({ ok: true, clase: 'descarga', extension: 'pdf' });
      expect(f).toHaveBeenCalledWith(expect.objectContaining({ accion: 'descargar' }));
    }
  });
  it('lo pedido para ver no devuelve descarga y al revés (imagen con accion descargar no se dibuja)', async () => {
    expect((await pedirMedio(ok({ tipo: 'image', mime: 'image/png', base64: B64 }), { ...desc })).ok).toBe(false);
    expect((await pedirMedio(ok({ tipo: 'audio', mime: 'audio/ogg', base64: B64 }), { ...desc })).ok).toBe(false);
  });
  it('extensión validada contra la lista cerrada; desconocida → bin', () => {
    for (const e of ['pdf', 'docx', 'xlsx', 'pptx', 'zip', 'doc', 'xls', 'ppt', 'txt', 'csv', 'mp4', '3gp', 'bin']) expect(extensionSegura(e)).toBe(e);
    for (const e of ['exe', 'html', '../x', 'PDF', undefined, 5, 'pdf.exe']) expect(extensionSegura(e)).toBe('bin');
    expect(nombreDeDescarga('docx', AHORA)).toMatch(/^archivo-\d{4}-\d{2}-\d{2}\.docx$/);
    expect(nombreDeDescarga('exe', AHORA)).toMatch(/\.bin$/);
    expect(AVISO_DESCARGA).toBe('Archivo enviado por un cliente: no lo abra si no confía; puede contener virus.');
    expect(MIME_DE_DESCARGA).toBe('application/octet-stream');
  });
  it('alerta extra para doc/xls/ppt/csv/zip y no para pdf/txt/bin', () => {
    for (const e of ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'zip']) expect(avisoExtraDe(e)).toBe(AVISO_MACROS);
    for (const e of ['pdf', 'txt', 'bin', 'exe']) expect(avisoExtraDe(e)).toBeNull();
    expect(AVISO_MACROS).toBe('Puede contener macros o fórmulas; no habilite contenido.');
  });
  it('modo: imagen/audio ver; lo demás descargar, igual para todos los roles', () => {
    expect(modoDeMedio('image/png')).toBe('ver');
    expect(modoDeMedio('audio/ogg')).toBe('ver');
    expect(modoDeMedio('application/pdf')).toBe('descargar');
    expect(modoDeMedio('video/mp4')).toBe('descargar');
    expect(modoDeMedio('')).toBe('descargar');
  });
});

describe('descarga: una sola vez, ancla fuera del DOM, revoca a los 4 s', () => {
  it('ejecuta el flujo con temporizador simulado', () => {
    vi.useFakeTimers();
    try {
      const reg: string[] = [];
      const ancla = { href: '', download: '', click: () => reg.push(`click:${ancla.href}:${ancla.download}`) };
      const bajar = descargadorUnico({
        crearUrl: () => 'blob:u1', revocar: (u) => reg.push(`revoca:${u}`), ancla: () => ancla,
        esperar: (f, ms) => setTimeout(f, ms),
      });
      const blob = new Blob(['x'], { type: MIME_DE_DESCARGA });
      expect(bajar(blob, 'mp4', AHORA)).toBe(true);
      expect(bajar(blob, 'mp4', AHORA)).toBe(false); // doble clic
      expect(reg).toEqual([expect.stringMatching(/^click:blob:u1:archivo-\d{4}-\d{2}-\d{2}\.mp4$/)]);
      vi.advanceTimersByTime(MS_REVOCAR - 1);
      expect(reg).toHaveLength(1); // no se revoca al instante
      vi.advanceTimersByTime(1);
      expect(reg).toHaveLength(2);
      expect(reg[1]).toBe('revoca:blob:u1');
      expect(MS_REVOCAR).toBe(4000);
    } finally { vi.useRealTimers(); }
  });
});

describe('enlace wa.me', () => {
  it('solo con 8 a 15 dígitos', () => {
    expect(enlaceWaMe(TEL)).toBe(`https://wa.me/${TEL}`);
    expect(enlaceWaMe(`+${TEL}`)).toBe(`https://wa.me/${TEL}`);
    for (const t of ['1234567', num('1234', '5678', '9012', '3456'), '5917abc4567', '591 7123', '', null, undefined, Number(TEL.slice(0, 9)), `${TEL}/../x`, `${TEL}?text=hola`]) expect(enlaceWaMe(t)).toBeNull();
  });
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
    // el ancla nunca entra al DOM y el blob se revoca justo tras el click
    expect(v).not.toMatch(/appendChild|append\(|insertAdjacent|\.body\./);
    expect(v).toMatch(/avisoExtraDe/);
    expect(v).not.toMatch(/esSoporte|esPropietario/);
    expect(v).toMatch(/descargadorUnico/);
    expect(v).not.toMatch(/bytes: /); // el estado no retiene los bytes
  });
  it('CSP: media-src blob: y NINGÚN blob: en frame-src', () => {
    const fb = JSON.parse(readFileSync(join(aqui, '../../firebase.json'), 'utf8'));
    const sitios = Array.isArray(fb.hosting) ? fb.hosting : [fb.hosting];
    const csps: string[] = [];
    for (const h of sitios.filter((x: { target?: string }) => x.target === 'consola').flatMap((x: { headers?: { headers: { key: string; value: string }[] }[] }) => x.headers ?? [])) for (const k of h.headers) if (k.key === 'Content-Security-Policy') csps.push(k.value);
    const csp = csps[0]!;
    expect(csp).toMatch(/media-src blob:;/);
    expect(csp).not.toMatch(/frame-src[^;]*blob:/);
    expect(csp).not.toMatch(/(default|img|script|object)-src[^;]*blob:/);
  });
});
