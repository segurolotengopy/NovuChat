/**
 * MEDIOS B4 — PARIDAD CONSOLA/SERVIDOR. La consola no puede importar `core/medios/salientes` (usa `Buffer`), así que su
 * lista es una copia; esta prueba la amarra a la del servidor y a la callable.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIOS, DOCUMENTOS, MAX_LADO_IMAGEN, MAX_LEYENDA, TEXTOS_DE_RECHAZO, TIEMPO_DE_ESPERA_ADJUNTO_MS, TOPE_AUDIO, TOPE_DOCUMENTO, TOPE_IMAGEN,
  clasificarArchivo, cuerpoDeAdjunto,
} from '../../web/src/central/lib/adjuntos';
import { MAX_LADO_DE_IMAGEN, TOPE_DE_ADJUNTO, validarAdjunto } from '../../functions/src/core/medios/salientes';
import { MIMES_ACEPTADOS, MIME_DE_DOCUMENTO } from '../../functions/src/core/medios/tipos';
import { TEXTO_MAXIMO } from '../../functions/src/core/conversacion/salidaPersona';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const ADJUNTO = leer('functions/src/core/conversacion/enviarAdjuntoComoPersona.ts');

describe('los topes y la lista de la consola son los del servidor', () => {
  it('topes por tipo y lado máximo', () => {
    expect(TOPE_DE_ADJUNTO).toEqual({ image: TOPE_IMAGEN, document: TOPE_DOCUMENTO, audio: TOPE_AUDIO });
    expect(MAX_LADO_DE_IMAGEN).toBe(MAX_LADO_IMAGEN);
  });
  it('la leyenda máxima es la del texto de una persona', () => expect(MAX_LEYENDA).toBe(TEXTO_MAXIMO));
  it('cada mime de documento y de audio es el del servidor', () => {
    for (const [ext, mime] of Object.entries(DOCUMENTOS)) expect(mime, ext).toBe((MIME_DE_DOCUMENTO as Record<string, string>)[ext]);
    for (const [ext, mime] of Object.entries(AUDIOS)) expect(MIMES_ACEPTADOS[ext as keyof typeof MIMES_ACEPTADOS], ext).toContain(mime);
  });
});

describe('los códigos de rechazo coinciden exactamente', () => {
  it('CodigoDeRechazo del servidor = claves de TEXTOS_DE_RECHAZO (sin leyenda_en_audio)', () => {
    const fuente = leer('functions/src/core/medios/salientes.ts');
    const bloque = /export type CodigoDeRechazo =([^;]+);/.exec(fuente)?.[1] ?? '';
    const codigos = [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(codigos).toHaveLength(13);
    expect(Object.keys(TEXTOS_DE_RECHAZO).filter((k) => k !== 'leyenda_en_audio').sort()).toEqual([...codigos].sort());
    expect(ADJUNTO).toContain("'leyenda_en_audio'");
  });
});

describe('comportamiento: lo que la consola admite, el servidor lo acepta, y al revés', () => {
  it('un txt y un PDF mínimo son aceptados', () => {
    expect(validarAdjunto(Buffer.from('hola'), { mime: 'text/plain', nombre: 'a.txt' }).ok).toBe(true);
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
    expect(validarAdjunto(pdf, { mime: 'application/pdf', nombre: 'a.pdf' }).ok).toBe(true);
  });
  it('NEGANDO: text/csv lo rechaza el servidor y la consola', () => {
    const v = validarAdjunto(Buffer.from('a,b\n1,2\n'), { mime: 'text/csv', nombre: 'a.csv' });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error).toBe('tipo_no_admitido');
    expect(clasificarArchivo('a.csv', 'text/csv', 8).ok).toBe(false);
  });
});

describe('la callable', () => {
  it('la consola espera más que el servidor', () => {
    const seg = Number(/timeoutSeconds:\s*(\d+)/.exec(ADJUNTO)?.[1]);
    expect(seg).toBeGreaterThan(0);
    expect(seg * 1000).toBeLessThan(TIEMPO_DE_ESPERA_ADJUNTO_MS);
  });
  it('las claves posibles del cuerpo son las que el servidor acepta (y no más)', () => {
    const lista = (nombre: string) => [...(new RegExp(`${nombre}[^=]*=\\s*new Set\\(\\[([^\\]]+)\\]`).exec(ADJUNTO)?.[1] ?? '').matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]!).sort();
    const c = cuerpoDeAdjunto({ tenantId: 't', conversacionId: 'c', clave: 'k', adjunto: { base64: 'AAAA', mime: 'm', nombre: 'n' }, leyenda: 'l' });
    expect(Object.keys(c).sort()).toEqual(lista('CLAVES_DE_ENTRADA'));
    expect(Object.keys(c['adjunto'] as object).sort()).toEqual(lista('CLAVES_DEL_ADJUNTO'));
  });
  it('index.ts la exporta', () => {
    expect(leer('functions/src/index.ts')).toContain('enviarAdjuntoComoPersona');
  });
});
