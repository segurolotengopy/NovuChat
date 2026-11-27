/**
 * SIN BOTÓN «VER CATÁLOGO» en Casa Bermejo (Andres, 24/11/2026, D7): el botón abría el sitio completo de NovuTienda y se retira mientras NovuChat no tenga un enlace propio. El asistente muestra las piezas por el chat.
 * «Solo se ofrece lo que se cumple»: ningún texto ni botón promete un enlace que no sale, ni siquiera con el dato `enlaceCatalogo` cargado (la regla es del código, no del dato). Se prueba NEGANDO.
 */
import { describe, expect, it } from 'vitest';
import { ANA, crear, hablar, modelo, mTexto, textos } from './mundo';

const ENLACE = 'https://catalogo.example.com';
const hayEnlace = (t: ReturnType<typeof hablar>): boolean => /cta_url|Ver catálogo|catalogo\.example/.test(JSON.stringify(t.mensajes.map((m) => m.payload)) + textos(t).join(' '));
const llamoAlModelo = (t: ReturnType<typeof hablar>): boolean => t.registro.map((r) => r.nodo).includes('Conversar con el modelo');

describe('NEGADO: pedir el catálogo, la página o las fotos NO da un botón con enlace', () => {
  for (const frase of ['¿puedo ver su catálogo?', 'Puedo ver tu catalogo?', 'catálogo', 'quiero ver las fotos', '¿tienen página web o catálogo con fotos?', 'mándeme su catálogo por favor', 'hola']) {
    it(`«${frase}»: sin enlace (aunque el dato esté cargado); lo atiende el modelo y muestra piezas por el chat`, () => {
      const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo('Con gusto, le muestro las piezas.') });
      const t = hablar(m, ANA, mTexto(frase));
      expect(hayEnlace(t)).toBe(false);
      expect(llamoAlModelo(t)).toBe(true);
    });
  }
});

describe('NEGADO: el modelo no puede prometer una página, un enlace ni un botón que el código no pone', () => {
  for (const promesa of ['Puede ver todo en nuestro sitio web.', 'Le dejo el enlace al catálogo.', 'Toque el botón Ver catálogo para ver las fotos.', 'Visite nuestra página con las fotos.']) {
    it(`«${promesa}» no sale tal cual`, () => {
      const m = crear({ enlaceCatalogo: ENLACE, modeloDice: modelo(promesa) });
      const t = hablar(m, ANA, mTexto('hola, ¿qué tienen?'));
      expect(textos(t).join(' ')).not.toMatch(/sitio web|enlace|bot[oó]n|p[aá]gina|Ver cat[aá]logo/i);
      expect(hayEnlace(t)).toBe(false);
    });
  }
});
