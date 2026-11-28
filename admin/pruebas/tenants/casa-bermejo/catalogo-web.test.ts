/**
 * EL BOTÓN «VER CATÁLOGO» de Casa Bermejo (B2, 27/11/2026): la «D7» del 24/11/2026 quedó DEROGADA por Andres. El botón sale del dato `enlaceCatalogo` de «Config base» (https validado, nunca una dirección fija),
 * siempre que el cliente pida el catálogo, también con un pedido o un QR en curso, y va en el MISMO mensaje (0 agregados). Lo que NO se cumple no se promete: sin enlace, ningún texto lo ofrece.
 * La suite completa de la batería de ataque está en `catalogo-listas.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, modelo, mTexto, panelConQr, textos } from './mundo';

const ENLACE = 'https://catalogo.example.com';
const hayEnlace = (t: ReturnType<typeof hablar>): boolean => /cta_url|Ver catálogo|catalogo\.example/.test(JSON.stringify(t.mensajes.map((m) => m.payload)) + textos(t).join(' '));
const llamoAlModelo = (t: ReturnType<typeof hablar>): boolean => t.registro.map((r) => r.nodo).includes('Conversar con el modelo');

describe('pedir el catálogo, la página o el enlace da el botón con el enlace del dato, por código y en un solo mensaje', () => {
  for (const frase of ['¿puedo ver su catálogo?', 'Puedo ver tu catalogo?', 'catálogo', '¿tienen página web o catálogo con fotos?', 'mándeme su catálogo por favor', 'me pasas el link del catálogo?']) {
    it(`«${frase}»: botón «Ver catálogo» con el enlace del dato, sin modelo`, () => {
      const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo('Con gusto, le muestro las piezas.') });
      const t = hablar(m, ANA, mTexto(frase));
      expect(t.mensajes).toHaveLength(1);
      expect(JSON.stringify(t.mensajes[0]!.payload)).toMatch(/cta_url/);
      expect(JSON.stringify(t.mensajes[0]!.payload)).toContain(ENLACE);
      expect(llamoAlModelo(t)).toBe(false);
    });
  }
  it('con un QR en curso el botón sale igual (siempre que lo pida)', () => {
    const m = crear({ enlaceCatalogo: ENLACE, panel: panelConQr(450) });
    const t = hablar(m, ANA, mTexto('catálogo'));
    expect(JSON.stringify(t.mensajes.map((x) => x.payload))).toContain(ENLACE);
  });
});

describe('NEGADO: sin enlace del dato (o con uno que no es https), nada promete un enlace, un botón o una página', () => {
  for (const enlace of ['', 'http://catalogo.example.com', 'https://wegic.ai/x']) {
    for (const frase of ['catálogo', 'hola']) {
      it(`enlace «${enlace}» y «${frase}»: sin botón ni enlace`, () => {
        const m = crear({ enlaceCatalogo: enlace, modeloDice: modelo('Con gusto, le muestro las piezas.') });
        const t = hablar(m, ANA, mTexto(frase));
        expect(hayEnlace(t)).toBe(false);
        expect(textos(t).join(' ')).not.toMatch(/sitio web|enlace|bot[oó]n|p[aá]gina|wegic/i);
      });
    }
  }
});

describe('el modelo no puede prometer una página, un enlace ni un botón que el código no pone', () => {
  for (const promesa of ['Puede ver todo en nuestro sitio web.', 'Le dejo el enlace al catálogo.', 'Toque el botón Ver catálogo para ver las fotos.', 'Visite nuestra página con las fotos.']) {
    it(`sin enlace del dato: «${promesa}» no sale tal cual`, () => {
      const m = crear({ enlaceCatalogo: '', modeloDice: modelo(promesa) });
      const t = hablar(m, ANA, mTexto('hola, necesito información de las piezas'));
      expect(textos(t).join(' ')).not.toMatch(/sitio web|enlace|bot[oó]n|p[aá]gina|Ver cat[aá]logo/i);
      expect(hayEnlace(t)).toBe(false);
    });
    it(`con enlace del dato: «${promesa}» se CUMPLE (el código pone el botón o la dirección en el mismo mensaje)`, () => {
      const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo(promesa) });
      const t = hablar(m, ANA, mTexto('hola, necesito información de las piezas'));
      expect(t.mensajes).toHaveLength(1);
      expect(JSON.stringify(t.mensajes[0]!.payload)).toContain(ENLACE);
    });
  }
});
