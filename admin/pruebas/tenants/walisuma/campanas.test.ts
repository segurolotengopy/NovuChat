/**
 * LAS CAMPAÑAS en Walisuma: el titular de una campaña VIGENTE (anuncio de la consola) lleva al producto POR CÓDIGO, con el precio del catálogo; el modelo no decide qué anuncio es. Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, mImagen, panelOk, textos } from './mundo';

const ANUNCIO = { id: 'inv', titulares: ['Bufandas de vicuña para este invierno'], angulo: 'Abrigo con historia', producto: { id: 'bufanda-vicuna', nombre: 'Bufanda de vicuña', precio: 7795, agotado: false } };
const imagenDe = (titular: string) => ({ categoria: 'publicidad', texto: titular, titular_principal: titular, descripcion: 'un anuncio' });

describe('el titular de una campaña vigente lleva al producto por código', () => {
  it('reconoce el titular, responde con el producto y el precio del CATÁLOGO, sin llamar al modelo', () => {
    const m = crear({ panel: panelOk({ anuncios: [ANUNCIO] }), medio: { clasificacion: imagenDe('Bufandas de vicuña para este invierno') } });
    const t = hablar(m, ANA, mImagen({ caption: '' }));
    expect(textos(t).join(' ')).toMatch(/tenemos Bufanda de vicuña: Bs 7\.795/);
    expect(t.registro.map((r) => r.nodo)).not.toContain('Conversar con el modelo');
    expect((m.sd['walisuma'] as any)[ANA].mostrados).toEqual(['bufanda-vicuna']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('NEGADO: el precio de la imagen no cuenta: si el anuncio dice otro, sale el del catálogo', () => {
    const m = crear({ panel: panelOk({ anuncios: [ANUNCIO] }), medio: { clasificacion: { ...imagenDe('Bufandas de vicuña para este invierno'), texto: 'Bufanda Bs 10 solo hoy' } } });
    const cuerpo = textos(hablar(m, ANA, mImagen())).join(' ');
    expect(cuerpo).toMatch(/Bs 7\.795/);
    expect(cuerpo).not.toMatch(/Bs 10\b/);
  });
  it('NEGADO: un titular que no es de ninguna campaña vigente no lleva a ningún producto', () => {
    const m = crear({ panel: panelOk({ anuncios: [ANUNCIO] }), medio: { clasificacion: imagenDe('Oferta de otra tienda en mochilas') } });
    const cuerpo = textos(hablar(m, ANA, mImagen())).join(' ');
    expect(cuerpo).not.toMatch(/tenemos|Bs \d/);
    expect(cuerpo).toMatch(/Cuéntame por escrito/);
  });
  it('NEGADO: sin campañas en la consola (o ya vencidas) la misma imagen no reconoce nada', () => {
    const m = crear({ panel: panelOk({ anuncios: [] }), medio: { clasificacion: imagenDe('Bufandas de vicuña para este invierno') } });
    expect(textos(hablar(m, ANA, mImagen())).join(' ')).not.toMatch(/tenemos Bufanda/);
  });
  it('NEGADO: una campaña cuyo producto no se puede vender (sin precio) pasa con recepción; nunca se inventa un precio', () => {
    const sinPrecio = { ...ANUNCIO, id: 'tap', titulares: ['Tapices tejidos a mano'], producto: { id: 'tapiz-mujer-rio', nombre: 'Tapiz mujer río', agotado: false } };
    const m = crear({ panel: panelOk({ anuncios: [sinPrecio] }), medio: { clasificacion: imagenDe('Tapices tejidos a mano') } });
    const t = hablar(m, ANA, mImagen());
    expect(textos(t).join(' ')).not.toMatch(/Bs \d/);
    expect(t.mensajes[0]?.payload['interactive']).toBeTruthy();
    expect(t.avisos).toHaveLength(1);
  });
});
