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

import { colorValido, urlImagenValida } from '../functions/src/catalogoWeb.ts';
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

describe('El color de marca es un enumerado de seis hexadecimales', () => {
  it('acepta #rrggbb en cualquier caja', () => {
    expect(colorValido('#1b7f4f')).toBe(true);
    expect(colorValido('#EC3013')).toBe(true);
  });

  it('rechaza la inyección de CSS, que es la razón de esta validación', () => {
    // Sin esto, el valor entra en `style={{ '--marca': color }}` y una visita a
    // la página del catálogo se le anuncia a un tercero, sin JavaScript.
    expect(colorValido('#fff;background:url(https://ajeno.tld/pixel)')).toBe(false);
    expect(colorValido('red')).toBe(false);
    expect(colorValido('#fff')).toBe(false);
    expect(colorValido('rgb(0,0,0)')).toBe(false);
    expect(colorValido('')).toBe(false);
  });
});

// ===========================================================================
// 3) UMBRAL DEL CATÁLOGO AL PROMPT
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
    // Si alguien lo sube a 500 «para que el asistente sepa todo», vuelve el
    // problema que este umbral existe para evitar.
    expect(UMBRAL_CATALOGO_AL_PROMPT).toBeGreaterThan(10);
    expect(UMBRAL_CATALOGO_AL_PROMPT).toBeLessThanOrEqual(100);
  });
});

// ===========================================================================
// 4) IMPORTACIÓN DESDE CSV
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

  it('redondea la duración a cuartos de hora y lo avisa', () => {
    const r = validarCsv('nombre,duracionMin\nCorte,50', true);
    expect(r.filas[0]?.fila.duracionMin).toBe(45);
    expect(r.filas[0]?.advertencias.join(' ')).toMatch(/ajustada/);
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
      imagenUrl: 'https://e.com/p.jpg', activo: true,
    }]);
    const vuelta = validarCsv(csv, false);
    expect(vuelta.error).toBe(null);
    expect(vuelta.filas[0]?.fila.nombre).toBe('Pizza "grande"');
    expect(vuelta.filas[0]?.fila.descripcion).toBe('Con, coma');
    expect(vuelta.filas[0]?.fila.precio).toBe(45.5);
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
// 5) REGLAS DE FIRESTORE
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

describe('La marca del catálogo web, en las reglas', () => {
  const base = (uid: string) => ({
    nombreNegocio: 'Panadería Demo', tratamiento: 'usted', estiloEmojis: 'pocos',
    ...sello(uid),
  });

  it('el admin enciende el catálogo web y pone su logo y su color', async () => {
    await assertSucceeds(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), catalogoWebActivo: true,
      logoUrl: 'https://ejemplo.com/logo.png', colorMarca: '#1b7f4f',
    }));
  });

  it('un color que no es #rrggbb se rechaza en el servidor', async () => {
    // La inyección de CSS del punto 3, cerrada donde tiene que estar cerrada.
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), colorMarca: '#fff;background:url(https://ajeno.tld/p)',
    }));
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), colorMarca: 'red',
    }));
  });

  it('`catalogoWebActivo` tiene que ser booleano, no la cadena "false"', async () => {
    // Que importa: la cadena 'false' es VERDADERA en JavaScript. Sin esta
    // línea, un catálogo podría quedar publicado creyendo que está apagado.
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), catalogoWebActivo: 'false',
    }));
  });

  it('un logo http se rechaza igual que una foto http', async () => {
    await assertFails(updateDoc(doc(adminA(), `tenants/${A}/config/negocio`), {
      ...base('u-admin-a'), logoUrl: 'http://ejemplo.com/logo.png',
    }));
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
