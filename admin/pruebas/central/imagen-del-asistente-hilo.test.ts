/**
 * VER LAS IMÁGENES QUE ENVIÓ EL ASISTENTE (control de calidad, 16/11/2026): la consola las muestra con el mismo visor de los medios
 * guardados y con un rótulo que dice quién las mandó y que verlas NO es prueba de pago (prohibición de cobros de CLAUDE.md).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { accionDeMedio, medioDeDatos, TEXTO_IMAGEN_DEL_ASISTENTE } from '../../web/src/central/lib/medios';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fuente = readFileSync(join(ADMIN, 'web/src/central/componentes/DetalleConversacion.tsx'), 'utf8');
const base = { estado: 'guardado', mime: 'image/jpeg', tamano: 1000, vence: Date.now() + 86_400_000 };

describe('medioDeDatos: origen del medio', () => {
  it('«asistente» se conserva; «enviado» y lo demás no cambian', () => {
    expect(medioDeDatos({ ...base, origen: 'asistente' })?.origen).toBe('asistente');
    expect(medioDeDatos({ ...base, origen: 'enviado' })?.origen).toBe('enviado');
    expect(medioDeDatos({ ...base })?.origen).toBe('recibido');
    expect(medioDeDatos({ ...base, origen: 'cualquier-cosa' })?.origen).toBe('recibido');
  });
  it('una imagen del asistente vigente se ve; vencida, no', () => {
    expect(accionDeMedio(medioDeDatos({ ...base, origen: 'asistente' }), Date.now())).toBe('ver');
    expect(accionDeMedio(medioDeDatos({ ...base, origen: 'asistente', vence: Date.now() - 1 }), Date.now())).toBe('vencido');
  });
});

describe('el hilo', () => {
  it('rotula la imagen del asistente y dice que no es prueba de pago', () => {
    expect(TEXTO_IMAGEN_DEL_ASISTENTE).toMatch(/enviada por el asistente/i);
    expect(TEXTO_IMAGEN_DEL_ASISTENTE).toMatch(/no es prueba de ningún pago/i);
    expect(fuente).toContain("x.medio?.origen === 'asistente' && <span className=\"cv-medio-texto\">{TEXTO_IMAGEN_DEL_ASISTENTE}</span>");
  });
  it('NEGANDO: el visor de lo recibido/del asistente sigue por idMeta y el de lo enviado por una persona, por mensaje', () => {
    expect(fuente).toContain("accionDeMedio(x.medio, p.ahora) === 'ver' && x.medio?.origen !== 'enviado' && x.idMeta && x.medio");
    expect(fuente).toContain("accionDeMedio(x.medio, p.ahora) === 'ver' && x.medio?.origen === 'enviado'");
  });
  it('NEGANDO: la burbuja del asistente no se rotula como persona ni como pago', () => {
    expect(TEXTO_IMAGEN_DEL_ASISTENTE).not.toMatch(/pago (acreditado|verificado|recibido)/i);
    expect(TEXTO_IMAGEN_DEL_ASISTENTE).not.toMatch(/persona/i);
  });
});
