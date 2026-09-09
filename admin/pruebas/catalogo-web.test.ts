/**
 * =============================================================================
 * CATÁLOGO WEB PROPIO — pruebas
 * =============================================================================
 *
 * LO QUE ESTA SUITE TIENE QUE DEFENDER, en orden de importancia:
 *
 *  1. QUE EL CARRITO NO SE PUEDA FALSIFICAR. Es la única razón por la que este
 *     camino se eligió sobre GloriaFood o TakeApp
 *     (`Analisis/11-catalogo-web-propio.md` §2). La garantía es que el precio
 *     lo lee el servidor del catálogo y nunca del cuerpo de la petición; acá se
 *     verifica la mitad que se puede verificar sin desplegar: que un `precio`
 *     mandado por el navegador no aparezca por ninguna parte del código del
 *     checkout, y que las validaciones de borde hagan lo que dicen.
 *  2. QUE UNA URL DE IMAGEN NO SEA UNA VÍA DE EJECUCIÓN. Es el único dato del
 *     comercio que va a un atributo `src` del navegador de un desconocido.
 *  3. QUE UN COLOR DE MARCA NO SEA UNA INYECCIÓN DE CSS.
 *  4. QUE IMPORTAR UN CSV NO ARRUINE UN CATÁLOGO. El caso «1.234» —mil
 *     doscientos treinta y cuatro, no uno con veintitrés— es el que puede hacer
 *     que un comercio venda a la milésima parte del precio sin que nadie mire.
 *  5. QUE LAS REGLAS SIGAN CERRADAS. Los pedidos no los escribe ningún
 *     navegador, y las fichas no las lee nadie.
 */
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { logoValido, paletaValida, sePuedeComprar, urlImagenValida } from '../functions/src/catalogoWeb.ts';
import { PALETAS, PALETA_POR_DEFECTO, variablesDe, type PaletaId } from '../web/src/lib/paletas.ts';
import { resumirCatalogo, UMBRAL_CATALOGO_AL_PROMPT } from '../functions/src/prompt.ts';
import {
  aCsv, idDeNombre, leerPrecio, partirCsv, validarCsv,
} from '../web/src/lib/csv.ts';

// ===========================================================================
// 1) URL DE IMAGEN
// ===========================================================================

describe('Una URL de imagen es https, o no es', () => {
  it('acepta lo que un comercio va a pegar de verdad', () => {
    for (const buena of [
      'https://ejemplo.com/foto.jpg',
      'https://lh3.googleusercontent.com/d/1a2b3c',
      'https://cdn.ejemplo.com.bo/productos/pizza%20muzzarella.png?v=3',
    ]) expect(urlImagenValida(buena)).toBe(true);
  });

  it('rechaza las tres vías de ejecución en un atributo src', () => {
    expect(urlImagenValida('javascript:alert(1)')).toBe(false);
    expect(urlImagenValida('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==')).toBe(false);
    expect(urlImagenValida('vbscript:msgbox')).toBe(false);
  });

  it('rechaza http, que el navegador bloquea SIN AVISAR', () => {
    // Es el caso más traicionero de todos: no hay error, no hay pista, y el
    // comercio ve «no se ven mis fotos» sin ninguna manera de averiguar por qué.
    expect(urlImagenValida('http://ejemplo.com/foto.jpg')).toBe(false);
  });

  it('rechaza credenciales embebidas, que disfrazan el destino real', () => {
    expect(urlImagenValida('https://ejemplo.com@malo.tld/foto.jpg')).toBe(false);
    expect(urlImagenValida('https://usuario:clave@ejemplo.com/f.jpg')).toBe(false);
  });

  it('rechaza destinos de la red interna', () => {
    for (const mala of [
      'https://localhost/f.jpg', 'https://127.0.0.1/f.jpg',
      'https://169.254.169.254/latest/meta-data/', 'https://10.0.0.5/f.jpg',
      'https://192.168.1.10/f.jpg', 'https://172.16.0.1/f.jpg',
      'https://consola.internal/f.jpg',
    ]) expect(urlImagenValida(mala)).toBe(false);
  });

  it('rechaza el vacío, lo que no es texto y lo desmedido', () => {
    expect(urlImagenValida('')).toBe(false);
    expect(urlImagenValida(null)).toBe(false);
    expect(urlImagenValida(42)).toBe(false);
    expect(urlImagenValida(`https://e.com/${'a'.repeat(600)}`)).toBe(false);
  });
});

// ===========================================================================
// 2) COLOR DE MARCA
// ===========================================================================

/**
 * Contraste WCAG. Se calcula acá, en la prueba, y no se copia de ninguna tabla:
 * el punto es que si alguien agrega o retoca una paleta, esto vuelva a medir.
 */
function luminancia(hex: string): number {
  const canal = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as
    [number, number, number];
  return 0.2126 * canal[0] + 0.7152 * canal[1] + 0.0722 * canal[2];
}
const contraste = (a: string, b: string) => {
  const [alto, bajo] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (alto + 0.05) / (bajo + 0.05);
};

describe('Las cinco paletas', () => {
  const ids = Object.keys(PALETAS) as PaletaId[];
  const TEXTO = '#201e1d';   // --color-text del sistema de diseño

  it('son exactamente cinco, y la de por defecto es una de ellas', () => {
    expect(ids).toHaveLength(5);
    expect(ids).toContain(PALETA_POR_DEFECTO);
  });

  // ESTA es la prueba que justifica que las paletas sean cerradas. Si alguien
  // agrega una «porque queda linda», acá se entera de si el texto se lee.
  it.each(Object.entries(PALETAS))('«%s» cumple WCAG AA en las tres relaciones', (_id, p) => {
    // Texto blanco sobre el color base: es el botón «Agregar» y el de confirmar.
    expect(contraste('#ffffff', p.base)).toBeGreaterThanOrEqual(4.5);
    // Texto oscuro sobre el tono suave: son los chips de área.
    expect(contraste(TEXTO, p.suave)).toBeGreaterThanOrEqual(4.5);
    // Borde contra su propio fondo: 3:1, que es el mínimo para lo que no es texto.
    expect(contraste(p.base, p.suave)).toBeGreaterThanOrEqual(3);
  });

  it('el tono oscuro es más oscuro que el base, que es para lo que existe', () => {
    // Se usa en `:hover` y en el estado presionado. Si fuera más claro, el botón
    // se «encendería» al tocarlo en vez de hundirse, y se leería como otro botón.
    for (const p of Object.values(PALETAS)) {
      expect(luminancia(p.oscuro)).toBeLessThan(luminancia(p.base));
      expect(luminancia(p.suave)).toBeGreaterThan(luminancia(p.base));
    }
  });

  it('todas declaran los tres tonos en #rrggbb', () => {
    for (const p of Object.values(PALETAS)) {
      for (const c of [p.base, p.oscuro, p.suave]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('cada una se ofrece con un nombre y para quién sirve', () => {
    // Un comercio no elige «#0F766E»: elige «Océano, para consultorios».
    for (const p of Object.values(PALETAS)) {
      expect(p.nombre.length).toBeGreaterThan(2);
      expect(p.sugerencia.length).toBeGreaterThan(8);
    }
  });
});

describe('Las variables de CSS salen de la tabla, nunca de la respuesta', () => {
  it('traduce el nombre de la paleta a sus tres colores', () => {
    expect(variablesDe('bosque')).toEqual({
      '--marca': PALETAS.bosque.base,
      '--marca-oscura': PALETAS.bosque.oscuro,
      '--marca-suave': PALETAS.bosque.suave,
    });
  });

  it('una paleta desconocida cae en la de por defecto y no rompe la página', () => {
    // Es lo que hace que un despliegue con las dos mitades desincronizadas deje
    // la página sobria en vez de sin color.
    for (const basura of ['no-existe', '', null, 42, { base: '#000' }]) {
      expect(variablesDe(basura)).toEqual(variablesDe(PALETA_POR_DEFECTO));
    }
  });

  it('NO deja pasar un color venido de afuera: no hay nada que inyectar', () => {
    // El servidor manda un NOMBRE, no un color. Aunque mandara esto, lo que
    // termina en la propiedad de CSS sale de la tabla local.
    const v = variablesDe('#fff;background:url(https://ajeno.tld/pixel)');
    expect(Object.values(v).join(' ')).not.toMatch(/ajeno/);
    expect(v).toEqual(variablesDe(PALETA_POR_DEFECTO));
  });
});

describe('La paleta, del lado del servidor', () => {
  it('acepta las cinco', () => {
    for (const id of Object.keys(PALETAS)) expect(paletaValida(id)).toBe(id);
  });

  it('cualquier otra cosa cae en la de por defecto, no en un error', () => {
    // Una paleta desconocida —de un dato viejo, de un despliegue a medias— tiene
    // que dejar la página sobria, no devolver un 500 al cliente final.
    for (const basura of ['#ec3013', 'rojo', '', null, 7]) {
      expect(paletaValida(basura)).toBe(PALETA_POR_DEFECTO);
    }
  });
});

describe('El logo incrustado', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('acepta png, jpeg y webp', () => {
    expect(logoValido(png)).toBe(true);
    expect(logoValido('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(logoValido('data:image/webp;base64,UklGRvAPAABXRUJQ')).toBe(true);
  });

  it('RECHAZA data:image/svg+xml, que parece una imagen y no lo es', () => {
    // Un SVG puede llevar <script> adentro. Es la razón por la que la lista de
    // tipos es cerrada en vez de aceptar cualquier `data:image/`.
    expect(logoValido('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pjwvc2NyaXB0Pjwvc3ZnPg==')).toBe(false);
  });

  it('rechaza data:text/html, que en un src es ejecución', () => {
    expect(logoValido('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
  });

  it('rechaza lo que no es base64 limpio', () => {
    expect(logoValido('data:image/png;base64,<script>')).toBe(false);
    expect(logoValido('https://ejemplo.com/logo.png')).toBe(false);
    expect(logoValido('')).toBe(false);
  });

  it('rechaza lo desmedido: el campo no es un depósito de archivos', () => {
    expect(logoValido(`data:image/png;base64,${'A'.repeat(200_001)}`)).toBe(false);
  });
});

// ===========================================================================
// 3) SIN PRECIO NO SE PUBLICA
// ===========================================================================

describe('Un ítem «a consultar» no llega al catálogo web', () => {
  it('acepta lo que tiene precio, incluido el gratis', () => {
    expect(sePuedeComprar({ precio: 45 })).toBe(true);
    // Cero es GRATIS y es una promesa que el comercio puede querer hacer: una
    // muestra, un envase, un servicio de cortesía. Se puede comprar.
    expect(sePuedeComprar({ precio: 0 })).toBe(true);
  });

  it('rechaza el precio ausente, que significa «a consultar»', () => {
    // La razón es comercial antes que técnica (Analisis/19 §5): publicar algo
    // que no se puede comprar es la forma más cara de generar una conversación
    // —el cliente pregunta, el asistente no puede cerrar, y desde el 1 de
    // octubre cada mensaje se paga.
    expect(sePuedeComprar({ nombre: 'Torta a pedido' })).toBe(false);
    expect(sePuedeComprar({ precio: null })).toBe(false);
    expect(sePuedeComprar(undefined)).toBe(false);
  });

  it('rechaza un precio que no es un número usable, venga como venga', () => {
    // Un precio guardado como cadena por un script viejo o una importación mal
    // hecha publicaría un ítem cuyo total el checkout no puede calcular.
    expect(sePuedeComprar({ precio: '45' })).toBe(false);
    // NaN ES un número para `typeof`, y esa era la primera versión del filtro:
    // pasaba, se publicaba, y el checkout calculaba `NaN * cantidad` — un
    // pedido con total NaN guardado en la base y mandado al flujo.
    expect(sePuedeComprar({ precio: NaN })).toBe(false);
    expect(sePuedeComprar({ precio: Infinity })).toBe(false);
  });
});

// ===========================================================================
// 4) UMBRAL DEL CATÁLOGO AL PROMPT
// ===========================================================================

describe('El resumen de un catálogo grande', () => {
  const catalogo = [
    { nombre: 'Pizza', precio: 45, moneda: 'BOB', area: 'gastronomia' },
    { nombre: 'Empanada', precio: 8, moneda: 'BOB', area: 'gastronomia' },
    { nombre: 'Torta a pedido', area: 'reposteria' },
    { nombre: 'Café', precio: 15, moneda: 'BOB', area: 'gastronomia' },
  ];

  it('dice cuántos hay, entre qué precios y en qué áreas', () => {
    const r = resumirCatalogo(catalogo);
    expect(r.total).toBe(4);
    expect(r.precioMin).toBe(8);
    expect(r.precioMax).toBe(45);
    expect(r.areas).toEqual(['gastronomia', 'reposteria']);
    expect(r.moneda).toBe('BOB');
  });

  it('avisa que hay ítems sin precio, que es una promesa distinta de gratis', () => {
    expect(resumirCatalogo(catalogo).hayACotizar).toBe(true);
    expect(resumirCatalogo(catalogo.filter((i) => 'precio' in i)).hayACotizar).toBe(false);
  });

  it('NO lleva nombres de productos', () => {
    // Si llevara veinte nombres, el modelo los trataría como «el catálogo
    // entero» y le diría al cliente que el resto no existe.
    expect(JSON.stringify(resumirCatalogo(catalogo))).not.toMatch(/Pizza|Empanada/);
  });

  it('el umbral sigue siendo un número chico y explícito', () => {
    // NO ES POR COSTO, y conviene que quede escrito acá también: Analisis/19 §2
    // midió que 500 ítems en el prompt cuestan 0,0585 Bs, o sea 0,43 mensajes
    // del asistente. El umbral existe por LEGIBILIDAD del chat y por
    // CONFIABILIDAD del modelo. Si alguien lo sube a 500 «porque total es
    // barato», el problema que vuelve no es la factura: es el asistente citando
    // mal un precio, que además cuesta el mensaje de la corrección.
    expect(UMBRAL_CATALOGO_AL_PROMPT).toBeGreaterThan(10);
    expect(UMBRAL_CATALOGO_AL_PROMPT).toBeLessThanOrEqual(100);
  });
});

// ===========================================================================
// 5) IMPORTACIÓN DESDE CSV
// ===========================================================================

describe('Leer un precio escrito por una persona', () => {
  it('entiende el punto de miles boliviano', () => {
    // ESTA es la prueba que más importa del archivo. `1.234` leído como decimal
    // inglés da 1,23: el comercio vendería a la milésima parte del precio y
    // nadie revisa doscientas filas.
    expect(leerPrecio('1.234')).toBe(1234);
    expect(leerPrecio('12.500')).toBe(12500);
  });

  it('entiende la coma decimal', () => {
    expect(leerPrecio('1.234,50')).toBe(1234.5);
    expect(leerPrecio('45,90')).toBe(45.9);
  });

  it('entiende el punto decimal cuando no puede ser de miles', () => {
    expect(leerPrecio('45.90')).toBe(45.9);
    expect(leerPrecio('1234.5')).toBe(1234.5);
  });

  it('ignora símbolos de moneda y espacios', () => {
    expect(leerPrecio('Bs 45')).toBe(45);
    expect(leerPrecio(' 45 Bs ')).toBe(45);
  });

  it('devuelve nulo si no hay número, que significa «a consultar»', () => {
    expect(leerPrecio('')).toBe(null);
    expect(leerPrecio('a convenir')).toBe(null);
  });
});

describe('Partir un CSV como lo exporta una planilla de verdad', () => {
  it('respeta las comillas y las comas de adentro', () => {
    const f = partirCsv('nombre,descripcion\n"Pizza","Muzzarella, aceituna y orégano"');
    expect(f[1]).toEqual(['Pizza', 'Muzzarella, aceituna y orégano']);
  });

  it('entiende las comillas dobles duplicadas', () => {
    const f = partirCsv('nombre\n"Pizza ""grande"""');
    expect(f[1]).toEqual(['Pizza "grande"']);
  });

  it('detecta el punto y coma que exporta Excel en español', () => {
    // Sin esto, todo el catálogo entra en una sola columna. Es la causa número
    // uno de importaciones fallidas.
    const f = partirCsv('nombre;precio\nPizza;45');
    expect(f[1]).toEqual(['Pizza', '45']);
  });

  it('sobrevive a la marca de orden de bytes de Excel', () => {
    const { error, filas } = validarCsv('﻿nombre,precio\nPizza,45', false);
    expect(error).toBe(null);
    expect(filas[0]?.fila.nombre).toBe('Pizza');
  });

  it('acepta fin de línea de Windows', () => {
    expect(partirCsv('nombre\r\nPizza\r\n').length).toBe(2);
  });
});

describe('Validar antes de escribir', () => {
  it('exige la columna nombre y lo dice con todas las letras', () => {
    const r = validarCsv('precio,area\n45,gastronomia', false);
    expect(r.error).toMatch(/nombre/);
    expect(r.filas).toEqual([]);
  });

  it('IGNORA una columna de moneda: la moneda es del negocio, no del ítem', () => {
    // Una panadería no vende el pan en bolivianos y la torta en dólares. La
    // moneda vive en /config/negocio; pedirla por fila es pedir un dato que ya
    // se tiene, y una columna más para llenar mal.
    const r = validarCsv('nombre,precio,moneda\nPizza,45,USD', false, 'BOB');
    expect(r.filas[0]?.fila.moneda).toBe('BOB');
    // Se informa que venía, para que la consola pueda avisarlo.
    expect(r.columnas).toContain('moneda');
  });

  it('usa la moneda del negocio cuando es USD', () => {
    expect(validarCsv('nombre,precio\nPizza,45', false, 'USD')
      .filas[0]?.fila.moneda).toBe('USD');
  });

  it('entiende los encabezados que la gente usa de verdad', () => {
    const r = validarCsv('Producto;Precio;Categoría;Foto\nPizza;45;Gastronomía;https://e.com/p.jpg', false);
    expect(r.error).toBe(null);
    expect(r.filas[0]?.fila.nombre).toBe('Pizza');
    expect(r.filas[0]?.fila.precio).toBe(45);
    expect(r.filas[0]?.fila.area).toBe('gastronomía');
    expect(r.filas[0]?.fila.imagenUrl).toBe('https://e.com/p.jpg');
  });

  it('rechaza dos filas con el mismo nombre, que se pisarían en silencio', () => {
    const r = validarCsv('nombre,precio\nPizza,45\nPizza,50', false);
    expect(r.filas[0]?.problemas).toEqual([]);
    expect(r.filas[1]?.problemas.join(' ')).toMatch(/repetido/);
  });

  it('rechaza una imagen http y explica por qué', () => {
    const r = validarCsv('nombre,imagenUrl\nPizza,http://e.com/p.jpg', false);
    expect(r.filas[0]?.problemas.join(' ')).toMatch(/https/);
  });

  it('avisa —sin rechazar— que un precio cero significa GRATIS', () => {
    const r = validarCsv('nombre,precio\nPizza,0', false);
    expect(r.filas[0]?.problemas).toEqual([]);
    expect(r.filas[0]?.advertencias.join(' ')).toMatch(/GRATIS/);
  });

  it('deja el precio en nulo si la celda viene vacía', () => {
    const r = validarCsv('nombre,precio\nConsultoría,', false);
    expect(r.filas[0]?.fila.precio).toBe(null);
  });

  it('lee «45.0» como 45 minutos y no como 450', () => {
    // EL DEFECTO QUE ENCONTRÓ EL SEGUNDO ARCHIVO DE EXCEL REAL. Excel guarda los
    // enteros como «45.0», y la primera versión quitaba todo lo que no fuera
    // dígito: 450 minutos. Siete horas y media, múltiplo de 15 —así que ni
    // siquiera saltaba la advertencia de redondeo— y el servicio entraba con esa
    // duración sin un solo error.
    const r = validarCsv('nombre,duracionMin\nManicure,45.0', true);
    expect(r.filas[0]?.fila.duracionMin).toBe(45);
    expect(r.filas[0]?.advertencias).toEqual([]);
  });

  it('acepta la duración con coma decimal, como la escribe una persona', () => {
    expect(validarCsv('nombre,duracionMin\nCorte,30,0', true)
      .filas[0]?.fila.duracionMin).toBe(30);
  });

  it('redondea la duración a cuartos de hora y lo avisa', () => {
    const r = validarCsv('nombre,duracionMin\nCorte,50', true);
    expect(r.filas[0]?.fila.duracionMin).toBe(45);
    expect(r.filas[0]?.advertencias.join(' ')).toMatch(/ajustada/);
  });

  it('la cantidad vacía significa «no lleva stock», no cero', () => {
    // Es la distinción entera de la columna. Vacío = el ítem se puede vender
    // siempre; cero = agotado y el asistente deja de ofrecerlo. Confundirlos
    // deja el catálogo entero agotado, o vendiendo lo que no hay.
    const r = validarCsv('nombre,cantidad\nManicure,\nHamburguesa,24\nTorta,0', false);
    expect(r.filas[0]?.fila.cantidad).toBe(null);
    expect(r.filas[1]?.fila.cantidad).toBe(24);
    expect(r.filas[2]?.fila.cantidad).toBe(0);
  });

  it('avisa —sin rechazar— que un cero deja el ítem AGOTADO', () => {
    const r = validarCsv('nombre,cantidad\nTorta,0', false);
    expect(r.filas[0]?.problemas).toEqual([]);
    expect(r.filas[0]?.advertencias.join(' ')).toMatch(/AGOTADO/);
  });

  it('rechaza una cantidad negativa o que no es número', () => {
    expect(validarCsv('nombre,cantidad\nTorta,-3', false)
      .filas[0]?.problemas.join(' ')).toMatch(/negativa/);
    expect(validarCsv('nombre,cantidad\nTorta,varias', false)
      .filas[0]?.problemas.join(' ')).toMatch(/no es un número/);
  });

  it('entiende «stock», «existencias» y «unidades» como cantidad', () => {
    for (const encabezado of ['stock', 'existencias', 'unidades', 'inventario']) {
      const r = validarCsv(`nombre,${encabezado}\nTorta,12`, false);
      expect(r.columnas).toContain('cantidad');
      expect(r.filas[0]?.fila.cantidad).toBe(12);
    }
  });

  it('lee «24.0», que es como Excel guarda un entero', () => {
    // Mismo defecto que tenía la duración: quitar lo que no fuera dígito
    // convertía «24.0» en 240.
    expect(validarCsv('nombre,cantidad\nTorta,24.0', false)
      .filas[0]?.fila.cantidad).toBe(24);
  });

  it('informa qué columnas traía el archivo', () => {
    // De esto depende que un CSV sin columna de precios NO borre los precios.
    const r = validarCsv('nombre,imagenUrl\nPizza,https://e.com/p.jpg', false);
    expect(r.columnas).toContain('nombre');
    expect(r.columnas).toContain('imagenurl');
    expect(r.columnas).not.toContain('precio');
  });
});

describe('Exportar', () => {
  it('da un archivo que se puede volver a importar', () => {
    const csv = aCsv([{
      nombre: 'Pizza "grande"', descripcion: 'Con, coma', area: 'gastronomia',
      precio: 45.5, moneda: 'BOB', duracionMin: 30,
      imagenUrl: 'https://e.com/p.jpg', activo: true, cantidad: 7,
    }]);
    const vuelta = validarCsv(csv, false);
    expect(vuelta.error).toBe(null);
    expect(vuelta.filas[0]?.fila.nombre).toBe('Pizza "grande"');
    expect(vuelta.filas[0]?.fila.descripcion).toBe('Con, coma');
    expect(vuelta.filas[0]?.fila.precio).toBe(45.5);
    expect(vuelta.filas[0]?.fila.cantidad).toBe(7);
  });

  it('lleva la marca de bytes para que Excel no rompa las tildes', () => {
    expect(aCsv([]).startsWith('﻿')).toBe(true);
  });
});

describe('El identificador sale del nombre y es estable', () => {
  it('quita tildes, espacios y símbolos', () => {
    expect(idDeNombre('Depilación láser — piernas')).toBe('depilacion-laser-piernas');
  });

  it('es el mismo que calcula la pantalla de alta', () => {
    // Si dejaran de coincidir, importar un CSV crearía ítems DUPLICADOS de los
    // ya cargados a mano en vez de actualizarlos.
    expect(idDeNombre('Corte de pelo')).toBe('corte-de-pelo');
  });
});

// ===========================================================================
// 6) REGLAS DE FIRESTORE
// ===========================================================================

const aqui = dirname(fileURLToPath(import.meta.url));
const A = 'tenant-a-salon';
let entorno: RulesTestEnvironment;

const claims = (tenants: Record<string, string>, propietario = false,
                proveedor = 'password') => ({
  nc: { t: tenants, ...(propietario ? { p: true } : {}), v: 1 },
  firebase: { sign_in_provider: proveedor, identities: {} },
  email_verified: true,
});

const adminA = () => entorno.authenticatedContext('u-admin-a', claims({ [A]: 'admin' })).firestore();
const operA = () => entorno.authenticatedContext('u-oper-a', claims({ [A]: 'oper' })).firestore();
const propietario = () =>
  entorno.authenticatedContext('u-novuchat', claims({}, true, 'google.com')).firestore();
const anonimo = () => entorno.unauthenticatedContext().firestore();

const sello = (uid: string) => ({ actualizadoPor: uid, actualizadoEn: serverTimestamp() });

beforeAll(async () => {
  entorno = await initializeTestEnvironment({
    projectId: 'demo-novuchat-pruebas',
    firestore: {
      rules: readFileSync(join(aqui, '..', 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_PORT ?? 8231),
    },
  });
});

afterAll(async () => { await entorno?.cleanup(); });

beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'tenants', A), {
      nombre: A, estado: 'activo', plan: 'basico', vertical: 'venta', flujos: ['venta'],
    });
    await setDoc(doc(db, `tenants/${A}/config/negocio`), {
      nombreNegocio: 'Panadería Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
      actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
    });
    await setDoc(doc(db, `tenants/${A}/catalogo/pan`), {
      nombre: 'Pan', precio: 5, moneda: 'BOB', activo: true,
      actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
    });
    // Un pedido y una ficha ya existentes, escritos como los escribe el
    // servidor: hacen falta para probar la LECTURA.
    await setDoc(doc(db, `tenants/${A}/pedidos/cat_1`), {
      origen: 'catalogo-web', creadoEn: Timestamp.now(),
      conversacionId: 'wa_59170000001', telefonoEnmascarado: '5917****001',
      items: [{ id: 'pan', nombre: 'Pan', cantidad: 3, precio: 5, subtotal: 15 }],
      total: 15, moneda: 'BOB', estado: 'recibido',
    });
    await setDoc(doc(db, 'fichasCatalogo/a1b2c3d4e5f60718293a4b5c6d7e8f90'), {
      tenantId: A, telefono: '59170000001', phoneNumberId: '123456789',
      caducaEn: Timestamp.fromMillis(Date.now() + 3_600_000), checkouts: 0,
    });
  });
});

describe('La foto del ítem, en las reglas', () => {
  it('el admin puede guardar una https', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), `tenants/${A}/catalogo/pan`), {
      imagenUrl: 'https://ejemplo.com/pan.jpg', ...sello('u-admin-a'),
    }));
  });

  it('el servidor rechaza una http, aunque la pantalla la dejara pasar', async () => {
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/catalogo/pan`), {
      imagenUrl: 'http://ejemplo.com/pan.jpg', ...sello('u-admin-a'),
    }));
  });

  it('el servidor rechaza javascript: en el campo de la foto', async () => {
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/catalogo/pan`), {
      imagenUrl: 'javascript:alert(1)', ...sello('u-admin-a'),
    }));
  });

  it('vacío vale: significa «este ítem no tiene foto»', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), `tenants/${A}/catalogo/pan`), {
      imagenUrl: '', ...sello('u-admin-a'),
    }));
  });

  it('un operador no puede tocar el catálogo, con foto o sin ella', async () => {
    await assertFails(updateDoc(doc(operA(), `tenants/${A}/catalogo/pan`), {
      imagenUrl: 'https://ejemplo.com/pan.jpg', ...sello('u-oper-a'),
    }));
  });
});

describe('El catálogo web es solo del flujo de VENTA', () => {
  // Decidido por Andres el 08/09. Un catálogo con carrito y checkout es una
  // tienda; el flujo de agendamiento no vende. Misma decisión que el catálogo
  // nativo de Meta (DISENO.md §4sexies.3bis) y por las mismas razones.
  const AGENDA = 'tenant-solo-agenda';

  beforeEach(async () => {
    await entorno.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'tenants', AGENDA), {
        nombre: AGENDA, estado: 'activo', plan: 'basico',
        vertical: 'agendamiento', flujos: ['agendamiento'],
      });
      await setDoc(doc(db, `tenants/${AGENDA}/config/negocio`), {
        nombreNegocio: 'Salón Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
        actualizadoPor: 'seed', actualizadoEn: Timestamp.now(),
      });
    });
  });

  const adminAgenda = () =>
    entorno.authenticatedContext('u-admin-agenda',
      claims({ [AGENDA]: 'admin' })).firestore();

  const base = (uid: string) => ({
    nombreNegocio: 'Salón Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
    ...sello(uid),
  });

  it('un salón NO puede encenderlo, ni construyendo la petición a mano', async () => {
    await assertFails(updateDoc(doc(adminAgenda(), `tenants/${AGENDA}/config/negocio`), {
      ...base('u-admin-agenda'), catalogoWebActivo: true,
    }));
  });

  it('pero sí puede guardar el resto de su configuración', async () => {
    // La regla es una implicación, no una prohibición del campo: si rechazara
    // la escritura entera, un salón no podría guardar su pantalla de
    // configuración por un campo que no le corresponde.
    await assertSucceeds(updateDoc(doc(adminAgenda(), `tenants/${AGENDA}/config/negocio`), {
      ...base('u-admin-agenda'), catalogoWebActivo: false,
    }));
    await assertSucceeds(updateDoc(doc(adminAgenda(), `tenants/${AGENDA}/config/negocio`), {
      ...base('u-admin-agenda'), direccion: 'Av. Siempre Viva 100',
    }));
  });

  it('un comercio de venta sí puede encenderlo', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      nombreNegocio: 'Panadería Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
      ...sello('u-admin-a'), catalogoWebActivo: true,
    }));
  });
});

describe('La marca del catálogo web, en las reglas', () => {
  const base = (uid: string) => ({
    nombreNegocio: 'Panadería Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
    ...sello(uid),
  });

  it('el admin enciende el catálogo web y elige una de las cinco paletas', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), catalogoWebActivo: true, paleta: 'bosque',
    }));
  });

  it('una paleta que no está en la lista se rechaza en el servidor', async () => {
    // La lista cerrada es lo que cierra la inyección de CSS: sin ella, esto
    // terminaría dentro de una propiedad de estilo de la página pública.
    for (const mala of ['#1b7f4f', 'fucsia', '#fff;background:url(https://ajeno.tld/p)', '']) {
      await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
        ...base('u-admin-a'), paleta: mala,
      }));
    }
  });

  it('`catalogoWebActivo` tiene que ser booleano, no la cadena "false"', async () => {
    // Que importa: la cadena 'false' es VERDADERA en JavaScript. Sin esta
    // línea, un catálogo podría quedar publicado creyendo que está apagado.
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), catalogoWebActivo: 'false',
    }));
  });

  it('el logo YA NO va en /config/negocio', async () => {
    // Vive en /config/marca porque son decenas de kilobytes y este documento lo
    // lee `configuracionFlujo` en CADA consulta del flujo. La lista blanca lo
    // rechaza, así que nadie lo puede volver a meter acá por comodidad.
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), logo: 'data:image/png;base64,iVBORw0KGgo=',
    }));
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), logoUrl: 'https://ejemplo.com/logo.png',
    }));
  });
});

describe('El logo, en /config/marca', () => {
  const ruta = `tenants/${A}/config/marca`;
  const logo = (uid: string, valor: string) => ({ logo: valor, ...sello(uid) });
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

  it('el admin lo CREA con su primer logo', async () => {
    // El alta no puede crear este documento: nace cuando el comercio sube su
    // primer logo, que puede ser meses después. Por eso acá `create` está
    // permitido, a diferencia del resto de /config.
    await assertSucceeds(setDoc(doc(adminA(), ruta), logo('u-admin-a', PNG)));
  });

  it('y lo puede quitar con la cadena vacía', async () => {
    // El borrado del documento está cerrado, así que sin esto no habría forma
    // de sacar un logo una vez subido.
    await assertSucceeds(setDoc(doc(adminA(), ruta), logo('u-admin-a', '')));
  });

  it('rechaza un SVG, que parece una imagen y puede traer script adentro', async () => {
    await assertFails(setDoc(doc(adminA(), ruta),
      logo('u-admin-a', 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==')));
  });

  it('rechaza data:text/html, que en un src es ejecución', async () => {
    await assertFails(setDoc(doc(adminA(), ruta),
      logo('u-admin-a', 'data:text/html;base64,PHNjcmlwdD4=')));
  });

  it('rechaza una dirección: acá va la imagen, no un enlace', async () => {
    await assertFails(setDoc(doc(adminA(), ruta),
      logo('u-admin-a', 'https://ejemplo.com/logo.png')));
  });

  it('rechaza campos de más, aunque el logo sea válido', async () => {
    await assertFails(setDoc(doc(adminA(), ruta),
      { ...logo('u-admin-a', PNG), tamano: 4088 }));
  });

  it('no lo escribe un operador, ni un comercio que no vende', async () => {
    await assertFails(setDoc(doc(operA(), ruta), logo('u-oper-a', PNG)));
  });
});

describe('Los pedidos que llegan del catálogo web', () => {
  it('los lee la gente del negocio', async () => {
    await assertSucceeds(getDoc(doc(adminA(), `tenants/${A}/pedidos/cat_1`)));
    await assertSucceeds(getDocs(collection(operA(), `tenants/${A}/pedidos`)));
  });

  it('NO los escribe nadie desde el navegador, ni el admin', async () => {
    // Es lo que hace que un pedido guardado sea evidencia de lo que el catálogo
    // decía, y no una cifra que alguien pudo corregir después.
    await assertFails(setDoc(doc(adminA(), `tenants/${A}/pedidos/cat_2`), {
      total: 1, ...sello('u-admin-a'),
    }));
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/pedidos/cat_1`), { total: 1 }));
    await assertFails(deleteDoc(doc(adminA(), `tenants/${A}/pedidos/cat_1`)));
  });

  it('no los lee un anónimo ni el propietario de NovuChat', async () => {
    // El propietario administra comercios; no lee lo que compran los clientes
    // de sus clientes. Es el punto 4 de los principios de las reglas.
    await assertFails(getDoc(doc(anonimo(), `tenants/${A}/pedidos/cat_1`)));
    await assertFails(getDoc(doc(propietario(), `tenants/${A}/pedidos/cat_1`)));
  });
});

describe('Las fichas del catálogo están cerradas para todos', () => {
  const ruta = 'fichasCatalogo/a1b2c3d4e5f60718293a4b5c6d7e8f90';

  it('no las lee el admin del comercio', async () => {
    await assertFails(getDoc(doc(adminA(), ruta)));
  });

  it('no las lee el propietario de NovuChat', async () => {
    await assertFails(getDoc(doc(propietario(), ruta)));
  });

  it('no las lee ni las escribe un anónimo con la ficha en la mano', async () => {
    // Una ficha adivinada o reenviada no abre la base: abre —como mucho— la
    // función pública, que además comprueba la caducidad.
    await assertFails(getDoc(doc(anonimo(), ruta)));
    await assertFails(setDoc(doc(anonimo(), ruta), { tenantId: A }));
  });

  it('no se puede enumerar la colección', async () => {
    await assertFails(getDocs(collection(adminA(), 'fichasCatalogo')));
    await assertFails(getDocs(collection(propietario(), 'fichasCatalogo')));
  });
});

/**
 * VA ÚLTIMA, Y NO ES CAPRICHO.
 *
 * Esta prueba manda 200 KB a las reglas. La escritura se rechaza —que es lo que
 * se quiere comprobar— pero el emulador tarda lo suficiente como para que la
 * prueba SIGUIENTE pierda su sello de tiempo: `selloValido` exige
 * `actualizadoEn == request.time`, y con el emulador cargado el
 * `serverTimestamp()` resuelto deja de coincidir. El efecto es una suite que
 * falla una de cada tres corridas, en un test distinto cada vez y siempre en una
 * escritura que debería pasar.
 *
 * Se midió: con esta prueba en el medio, 1 de 3 corridas fallaba; sacándola, 4
 * de 4 limpias. Al final del archivo el retraso no le cae a nadie.
 *
 * NO se resolvió bajando el tope de la regla ni quitando la prueba: 200 KB es el
 * tope correcto para un logo de 320 px, y el tope de verdad lo pone la regla, no
 * la función. Si alguien agrega pruebas después de esta, que las ponga antes.
 */
describe('El tope de tamaño del logo, en las reglas', () => {
  it('rechaza lo desmedido: el campo no es un depósito de archivos', async () => {
    await assertFails(setDoc(doc(adminA(), `tenants/${A}/config/marca`), {
      logo: `data:image/png;base64,${'A'.repeat(200_001)}`,
      ...sello('u-admin-a'),
    }));
  });
});
