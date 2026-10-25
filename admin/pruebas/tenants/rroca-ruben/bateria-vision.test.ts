/**
 * `herramientas/bateria-vision.mjs` — la batería de la visión contra las artes reales, SIN red: el modelo y el tiempo son dobles. Se escribe negando: sin `--confirmo-gasto` no llama a nada ni lee clave;
 * no imprime el contenido de las imágenes del cliente ni sus nombres; respeta el límite de ~10 llamadas por minuto; mide lo que decide el reconocimiento.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error herramienta .mjs sin declaraciones
import * as bateria from '../../../../Flujos/experimental/rroca-ruben/herramientas/bateria-vision.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'bateria-vision-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const cuerpo = (n: number): Buffer => Buffer.from(`IMAGEN-SECRETA-DEL-CLIENTE-${n}`);
for (let i = 1; i <= 12; i += 1) writeFileSync(join(tmp, `WhatsApp Image arte-${i}.jpeg`), cuerpo(i));
writeFileSync(join(tmp, 'notas.txt'), 'no es una imagen');

const gem = (obj: unknown): unknown => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 100 } });
function deps(respuesta: (n: number, cuerpo: Record<string, unknown>) => unknown) {
  const salida: string[] = []; const espera: number[] = []; const llamadas: Array<{ url: string; cuerpo: Record<string, unknown> }> = [];
  return {
    salida, espera, llamadas,
    d: {
      salida: (t: string) => salida.push(t), dormir: async (ms: number) => { espera.push(ms); },
      leerArchivo: () => 'GEMINI_API_KEY=clave-de-prueba-que-no-debe-salir', gcloudToken: () => '',
      fetch: async (url: string, init: { body: string }) => { const c = JSON.parse(init.body) as Record<string, unknown>; llamadas.push({ url, cuerpo: c }); return { ok: true, status: 200, text: async () => JSON.stringify(respuesta(llamadas.length, c)) }; },
    },
  };
}

describe('bateria-vision.mjs', () => {
  it('lee el prompt, el modelo y el límite de tokens del nodo «Ver imagen» del flujo armado, y los anuncios del archivo de campañas', () => {
    const n = bateria.leerNodoVerImagen();
    expect(n.modelo).toBe('gemini-3.5-flash-lite');
    expect(n.maxOutputTokens).toBe(400);
    expect(n.prompt).toContain('titular_principal');
    expect(bateria.anunciosDelArchivo()).toHaveLength(5);
  });

  it('por omisión es SECO: no llama a nada, no lee clave, y cada titular del catálogo se reconoce con el módulo común', async () => {
    const x = deps(() => { throw new Error('no debe llamarse'); });
    const codigo = await bateria.main([], x.d);
    expect(codigo).toBe(0);
    expect(x.llamadas).toHaveLength(0);
    expect(x.salida.join('\n')).toMatch(/Modo: seco/);
    expect(x.salida.join('\n')).toMatch(/5\/5 reconocidas \(5 anuncios distintos\)/);
    // Con la carpeta, en seco, solo cuenta: no lee las imágenes.
    const y = deps(() => { throw new Error('no debe llamarse'); });
    await bateria.main(['--imagenes', tmp], y.d);
    expect(y.salida.join('\n')).toMatch(/artes: 12/);
    expect(y.llamadas).toHaveLength(0);
  });

  it('NEGADO: la corrida real exige --confirmo-gasto Y --imagenes; una opción desconocida o un valor malo se rechazan', () => {
    expect(bateria.leerOpciones(['--imagenes', tmp]).seco).toBe(true);
    expect(() => bateria.leerOpciones(['--confirmo-gasto'])).toThrow(/--imagenes/);
    expect(() => bateria.leerOpciones(['--forzar'])).toThrow(/desconocida/);
    expect(() => bateria.leerOpciones(['--n', '9'])).toThrow(/1 a 5/);
    expect(() => bateria.leerOpciones(['--vertex', 'X'])).toThrow(/proyecto/);
    expect(bateria.leerOpciones(['--confirmo-gasto', '--imagenes', tmp]).seco).toBe(false);
  });

  it('real (con dobles): una llamada por arte con el prompt del nodo y la imagen EN MEMORIA, mide categoría y reconocimiento, calcula el costo, y NO imprime el contenido ni los nombres de las imágenes ni la clave', async () => {
    const ads = bateria.anunciosDelArchivo() as Array<{ titulares: string[] }>;
    const x = deps((n) => gem(n % 3 === 0 ? { categoria: 'comprobante', titular_principal: '' } : { categoria: 'publicidad', titular_principal: ads[n % 5]!.titulares[0] }));
    const codigo = await bateria.main(['--confirmo-gasto', '--imagenes', tmp, '--env', 'x.env', '--pausa', '1'], x.d);
    const texto = x.salida.join('\n');
    expect(x.llamadas).toHaveLength(12);
    expect(x.llamadas[0]!.url).toContain('generativelanguage.googleapis.com');
    const partes = (x.llamadas[0]!.cuerpo['contents'] as Array<{ parts: Array<Record<string, unknown>> }>)[0]!.parts;
    expect(String(partes[0]!['text'])).toContain('titular_principal');
    expect((partes[1]!['inline_data'] as Record<string, string>)['mime_type']).toBe('image/jpeg');
    expect(texto).not.toMatch(/IMAGEN-SECRETA|WhatsApp Image|clave-de-prueba/);
    expect(texto).toMatch(/arte 1:/);
    expect(texto).toMatch(/tomadas por comprobante o pago: 4/);
    expect(texto).toMatch(/Tokens: 12000 de entrada y 1200 de salida/);
    expect(codigo).toBe(1);   // hay artes tomadas por comprobante: la batería falla, como debe
  });

  it('respeta el límite de ~10 llamadas por minuto: tras 10 llamadas espera la pausa pedida; con --n repite cada arte', async () => {
    const x = deps(() => gem({ categoria: 'publicidad', titular_principal: '' }));
    await bateria.main(['--confirmo-gasto', '--imagenes', tmp, '--pausa', '65'], x.d);
    expect(x.llamadas).toHaveLength(12);
    expect(x.espera).toEqual([65000]);
    const y = deps(() => gem({ categoria: 'publicidad', titular_principal: '' }));
    await bateria.main(['--confirmo-gasto', '--imagenes', tmp, '--n', '2', '--pausa', '65'], y.d);
    expect(y.llamadas).toHaveLength(24);
    expect(y.espera).toEqual([65000, 65000]);
  });

  it('un fallo del servicio (429) se informa sin el cuerpo de la imagen ni la clave, y no se toma por un acierto', async () => {
    const x = deps(() => ({ error: { message: 'cuota agotada clave-de-prueba-que-no-debe-salir' } }));
    x.d.fetch = async () => ({ ok: false, status: 429, text: async () => 'cuota agotada clave-de-prueba-que-no-debe-salir' });
    const codigo = await bateria.main(['--confirmo-gasto', '--imagenes', tmp, '--pausa', '0'], x.d);
    expect(codigo).toBe(1);
    expect(x.salida.join('\n')).toMatch(/ERROR/);
    expect(x.salida.join('\n')).not.toMatch(/clave-de-prueba|IMAGEN-SECRETA/);
  });

  it('medirRespuesta: solo una publicidad con el titular del catálogo se reconoce; un titular ajeno, otra categoría o la insignia de precio, no', () => {
    const rec = bateria.cargarReconocedor();
    const ads = bateria.anunciosDelArchivo() as Array<{ id: string; titulares: string[] }>;
    expect(bateria.medirRespuesta({ categoria: 'publicidad', titular_principal: ads[0]!.titulares[0] }, rec, ads).reconocido).toBe(ads[0]!.id);
    expect(bateria.medirRespuesta({ categoria: 'foto', titular_principal: ads[0]!.titulares[0] }, rec, ads).reconocido).toBe('');
    expect(bateria.medirRespuesta({ categoria: 'publicidad', titular_principal: 'Desde solo 32 Bs' }, rec, ads).reconocido).toBe('');
    expect(bateria.medirRespuesta({ categoria: 'pago_con_problema' }, rec, ads).conPago).toBe(true);
    expect(bateria.medirRespuesta({}, rec, ads)).toMatchObject({ categoria: '', reconocido: '', largoTitular: 0 });
    expect(bateria.objetoDeLaRespuesta('texto {"a":1} más')).toEqual({ a: 1 });
    expect(bateria.objetoDeLaRespuesta('sin json')).toEqual({});
  });
});
