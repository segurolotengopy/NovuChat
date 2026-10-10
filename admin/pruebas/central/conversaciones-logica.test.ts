/**
 * CONVERSACIONES (H1, 09/10/2026): LA LÓGICA DE LA PANTALLA.
 *
 * Lo que estas pruebas defienden:
 *
 *  1. UN TELÉFONO SE HALLA SIN PREFIJO Y POR LOS ÚLTIMOS 4 DÍGITOS, dos números
 *     parecidos no se confunden y un «00» de marcación internacional se quita sin
 *     comerse los «0047» ni los «00000047».
 *  2. UNA PALABRA SE HALLA CON O SIN TILDES, EN SINGULAR O EN PLURAL. La regla NO
 *     está acá: es la de Core (`normalizacion.ts`), y esta suite comprueba que la
 *     pantalla usa LA MISMA función, no una copia.
 *  3. LA LECTURA ES TOLERANTE: un documento de antes de H1 (sin ninguno de los
 *     campos nuevos) se lee sin romperse, es «leído», no tiene ventana y se halla
 *     igual por los últimos 4 dígitos.
 *  4. «NECESITA HUMANO» sale del estado de atención (operador, bloqueado) de las
 *     últimas 24 h; la ventana sin dato no se pinta como «cerrada».
 *  5. «SIGUIENTE» NO SALTEA CONVERSACIONES al recorrer las no leídas, aunque
 *     abrirlas las deje de ser no leídas.
 *  6. MARCAR LEÍDA: solo admin u oper, con la pestaña visible y algo que marcar;
 *     el propietario de NovuChat nunca.
 *  7. NEGATIVA: la pantalla solo escribe `noContactar` y `{noLeidos:0, sinLeer:false}`,
 *     solo llama a `buscarConversaciones`, no usa `fetch` ni el almacenamiento del
 *     navegador ni HTML sin escapar, y la pantalla de siempre es, byte a byte,
 *     la de antes de H1.
 *
 * Son puras: sin navegador, sin emulador y sin red.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as Core from '../../functions/src/core/conversacion/normalizacion';
import {
  CONVERSACION_EN_LA_RUTA, ESTADOS_HUMANO, FILTROS, FORMAS_CONSULTA, MAX_DIGITOS_TELEFONO, MAX_IDS_CONSULTA, PAGINACION_INICIAL, MAX_RESULTADOS_BUSQUEDA,
  PAGINA_LISTA, POR_VENCER_HORAS, REBOTE_MARCA_LEIDA_MS, VENTANA_HORAS, alAceptarPagina, alSnapshot, alSuscribir,
  aplicarFiltro, cursorInvalidado, marcaBloqueada, partirResaltado, textoListaVacia, consultaDeIds, esIdConversacion, esIdMensaje, iniciales, puedeGestionarConversaciones, respuestaVigente, buscarPorNombre, buscarPorTelefono, clasificarConsulta, coincidenciaTelefono,
  consultaDeFiltro, consultaDeNombre, consultasDeTelefono, cumpleFiltro, debeMarcarLeida, etiquetaDia, etiquetaFicha,
  fichaDeDocumento, filtroConReloj, formaDe, fragmento, horaCorta, mensajeContiene, mezclarLista, necesitaHumanoDe,
  normalizarTexto, ordenarPara, ordenarPorReciente, palabraParaIndice, palabrasDe, raizDe, rutaConversaciones, soloDigitos,
  textoErrorBusqueda, textoRestante, trozosDeTelefono, unirFichas, vecina, ventanaDe, ventanaDeFicha, type Ficha,
} from '../../web/src/central/lib/conversaciones';

/** El código de un archivo de admin/, sin comentarios (lo que de verdad se ejecuta). */
const leerCodigo = (ruta: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', ruta), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const HORA = 3_600_000;
const MIN = 60_000;
/** 9 de octubre de 2026, 12:00 de Bolivia (16:00 UTC). */
const AHORA = Date.UTC(2026, 9, 9, 16, 0, 0);

function ficha(id: string, extra: Partial<Ficha> = {}): Ficha {
  const telefono = extra.telefono ?? id.replace(/^wa_/, '');
  return {
    id, telefono, nombre: id, ultimoMensaje: '', ultimoEn: AHORA - 10 * MIN, ultimoEntranteEn: AHORA - 10 * MIN,
    ventanaVenceEn: AHORA - 10 * MIN + 24 * HORA, noLeidos: 0, sinLeer: false, necesitaHumano: false, atencionEstado: 'normal',
    noContactar: false, telefonoTrozos: trozosDeTelefono(telefono), nombrePalabras: palabrasDe(extra.nombre ?? id, 6), ...extra,
  };
}

/** Un Timestamp de Firestore, lo único que la lectura necesita de él. */
const marca = (ms: number) => ({ toMillis: () => ms });

describe('normalización: UNA sola regla, la de Core', () => {
  it('la pantalla reexporta las funciones de Core: son LA MISMA función, no una copia', () => {
    expect(palabrasDe).toBe(Core.palabrasDe);
    expect(raizDe).toBe(Core.raizDe);
    expect(normalizarTexto).toBe(Core.normalizarTexto);
    expect(trozosDeTelefono).toBe(Core.trozosDeTelefono);
    expect(mensajeContiene).toBe(Core.mensajeContiene);
    expect(palabraParaIndice).toBe(Core.palabraParaIndice);
    expect(fragmento).toBe(Core.fragmento);
    expect(soloDigitos).toBe(Core.soloDigitos);
    expect(VENTANA_HORAS).toBe(24);
    expect(POR_VENCER_HORAS).toBe(6);
  });

  it('con la regla de Core: tildes y eñes, plural, «e» final, trozos de teléfono', () => {
    expect(normalizarTexto('Salteñas CÓMO')).toBe('saltenas como');
    expect(raizDe('alfajores')).toBe(raizDe('alfajor'));
    expect(raizDe('chocolate')).toBe(raizDe('chocolates'));
    expect(raizDe('mas')).toBe('mas');
    expect(palabrasDe('¡Hola! Quiero DOS salteñas y una torta de chocolate'))
      .toEqual(['hola', 'quiero', 'dos', 'saltena', 'una', 'torta', 'chocolat']);
    const t = trozosDeTelefono('59100000047');
    expect(t).toContain('0047');
    expect(t).not.toContain('047');
    expect(t.length).toBe(8);
  });
});

describe('qué se escribió en el buscador', () => {
  it('cifras (con +, espacios, guiones o paréntesis) son un teléfono; con menos de 4, «corta»', () => {
    expect(clasificarConsulta('')).toEqual({ tipo: 'vacia' });
    expect(clasificarConsulta('   ')).toEqual({ tipo: 'vacia' });
    expect(clasificarConsulta('+')).toEqual({ tipo: 'vacia' });
    expect(clasificarConsulta('0047')).toEqual({ tipo: 'telefono', digitos: '0047' });
    expect(clasificarConsulta('+591 000-00047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
    expect(clasificarConsulta('(591) 000 00047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
    expect(clasificarConsulta('47')).toEqual({ tipo: 'corta', digitos: '47' });
  });

  it('un número pegado con «00» de marcación internacional pierde el «00»', () => {
    expect(clasificarConsulta('00 591 000 00047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
    expect(clasificarConsulta('0059100000047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
    expect(clasificarConsulta('(00) 591-000-00047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
  });

  it('NEGATIVA: los «0047» y los «00000047» también empiezan en «00» y NO son marcación internacional', () => {
    expect(clasificarConsulta('0047')).toEqual({ tipo: 'telefono', digitos: '0047' });
    expect(clasificarConsulta('00000047')).toEqual({ tipo: 'telefono', digitos: '00000047' });
    expect(clasificarConsulta('0000047')).toEqual({ tipo: 'telefono', digitos: '0000047' });
    expect(clasificarConsulta('00')).toEqual({ tipo: 'corta', digitos: '00' });
    // Sin «00» delante no se recorta nada, por largo que sea.
    expect(clasificarConsulta('59100000047')).toEqual({ tipo: 'telefono', digitos: '59100000047' });
  });

  it('lo demás es texto, con sus palabras ya normalizadas', () => {
    expect(clasificarConsulta('Alfajores de Maicena')).toEqual({
      tipo: 'texto', texto: 'alfajores de maicena', palabras: ['alfajor', 'maicena'] });
    // Mezcla de letras y cifras: texto (una palabra), no teléfono.
    expect(clasificarConsulta('pedido 1234').tipo).toBe('texto');
    // Más de 6 palabras: solo las 6 primeras buscan.
    const c = clasificarConsulta('uno dos tres cuatro cinco seis siete ocho');
    expect(c.tipo === 'texto' && c.palabras.length).toBe(6);
  });
});

describe('TAREA 1: hallar un teléfono sin prefijo y por los últimos 4 dígitos', () => {
  const ximena = ficha('wa_59100000047', { nombre: 'Ximena P.' });
  const mauricio = ficha('wa_59100000074', { nombre: 'Mauricio T.' });   // dígitos parecidos
  const otra = ficha('wa_59100000012', { nombre: 'Marcela R.' });
  const todas = [ximena, mauricio, otra];

  it('por los últimos 4: «0047» halla a una y NO a la de dígitos parecidos', () => {
    expect(buscarPorTelefono(todas, '0047').map((r) => r.ficha.id)).toEqual(['wa_59100000047']);
    expect(buscarPorTelefono(todas, '0074').map((r) => r.ficha.id)).toEqual(['wa_59100000074']);
    expect(buscarPorTelefono(todas, '0047')[0]?.tipo).toBe('final');
  });

  it('sin prefijo: el número local entero («00000047») lo halla', () => {
    expect(buscarPorTelefono(todas, '00000047').map((r) => r.ficha.id)).toEqual(['wa_59100000047']);
  });

  it('con prefijo, pegado como viene de WhatsApp («+591 000 00047»)', () => {
    const r = buscarPorTelefono(todas, soloDigitos('+591 000 00047'));
    expect(r.map((x) => x.ficha.id)).toEqual(['wa_59100000047']);
    expect(r[0]?.tipo).toBe('completo');
  });

  it('el número local lo halla también cuando se completa con el prefijo del comercio, aunque no haya trozos guardados', () => {
    expect(coincidenciaTelefono('59100000047', [], '0047')).toBe('final');
    expect(coincidenciaTelefono('59100000047', [], '00000047')).toBe('completo');   // el número entero, sin el 591
    expect(coincidenciaTelefono('59100000047', [], '00000')).toBe('sin-prefijo');
    expect(coincidenciaTelefono('59100000047', [], '5910000')).toBe('inicio');
    expect(coincidenciaTelefono('59100000047', [], '47', ['591'])).toBeNull();
  });

  it('NEGATIVAS: menos de 4 dígitos, otro número o un prefijo de país distinto no coinciden', () => {
    expect(buscarPorTelefono(todas, '047')).toEqual([]);
    expect(buscarPorTelefono(todas, '9999')).toEqual([]);
    expect(coincidenciaTelefono('59100000047', [], '0047', ['593'])).toBe('final');   // el final no depende del prefijo
    expect(coincidenciaTelefono('59100000047', [], '00000', ['593'])).toBeNull();     // pero el completado sí
    expect(coincidenciaTelefono('', [], '0047')).toBeNull();
  });

  it('ordena de lo más específico a lo menos y, a igualdad, lo más reciente primero', () => {
    const lista = [ficha('wa_59100000047'), ficha('wa_59147000047'), ficha('wa_47100000099')];
    expect(buscarPorTelefono(lista, '59100000047')[0]?.ficha.id).toBe('wa_59100000047');
    const vieja = ficha('wa_59300000047', { ultimoEn: AHORA - 5 * HORA });
    const reciente = ficha('wa_59400000047', { ultimoEn: AHORA - 1 * HORA });
    expect(buscarPorTelefono([vieja, reciente], '0047').map((x) => x.ficha.id)).toEqual(['wa_59400000047', 'wa_59300000047']);
  });

  it('por nombre, sin tildes ni mayúsculas, con todas las palabras', () => {
    const lista = [ficha('a', { nombre: 'Álvaro M.' }), ficha('b', { nombre: 'Marcela Ríos' }), ficha('c', { nombre: 'Marco E.' })];
    expect(buscarPorNombre(lista, 'alvaro').map((f) => f.id)).toEqual(['a']);
    expect(buscarPorNombre(lista, 'marc').map((f) => f.id)).toEqual(['b', 'c']);
    expect(buscarPorNombre(lista, 'marcela rios').map((f) => f.id)).toEqual(['b']);
    expect(buscarPorNombre(lista, '   ')).toEqual([]);
  });
});

describe('TAREA 2: hallar una palabra y llegar al mensaje', () => {
  it('«alfajor» halla «alfajores» (plural) y «saltenas» halla «Salteñas» (tildes)', () => {
    const c = clasificarConsulta('alfajor');
    expect(c.tipo === 'texto' && c.palabras).toEqual(['alfajor']);
    expect(mensajeContiene(palabrasDe('Tienen alfajores de maicena'), '', ['alfajor'])).toBe(true);
    const s = clasificarConsulta('saltenas');
    expect(mensajeContiene(undefined, 'Dos docenas de Salteñas', s.tipo === 'texto' ? s.palabras : [])).toBe(true);
  });

  it('con varias palabras, el mensaje tiene que tenerlas TODAS; el índice pregunta por la más larga', () => {
    const buscadas = palabrasDe('alfajores maicena');
    expect(mensajeContiene(palabrasDe('alfajores de maicena'), '', buscadas)).toBe(true);
    expect(mensajeContiene(palabrasDe('alfajores de dulce'), '', buscadas)).toBe(false);
    expect(palabraParaIndice(['uno', 'cumpleano', 'dulce'])).toBe('cumpleano');
    expect(palabraParaIndice([])).toBeNull();
  });

  it('NEGATIVA: sin palabras buscadas no coincide nada (no «todo»)', () => {
    expect(mensajeContiene(['hola'], 'hola', [])).toBe(false);
  });

  it('el fragmento del resultado muestra el entorno de la palabra y nunca pasa del ancho pedido', () => {
    const texto = 'Buenas tardes, quería preguntar si para el cumpleaños de mi hija tienen alfajores de maicena disponibles este sábado';
    const f = fragmento(texto, ['alfajor'], 60);
    expect(f.toLowerCase()).toContain('alfajores');
    expect(f.length).toBeLessThanOrEqual(60);
    expect(fragmento('corto', ['x'])).toBe('corto');
    const sinHallazgo = fragmento(texto, ['inexistente'], 20);
    expect(sinHallazgo.length).toBeLessThanOrEqual(20);
    expect(sinHallazgo.endsWith('…')).toBe(true);
  });

  it('la dirección de un resultado lleva la conversación EN LA RUTA y el mensaje en `?m=`; todo escapado', () => {
    expect(CONVERSACION_EN_LA_RUTA).toBe(true);
    expect(rutaConversaciones('comercio-1')).toBe('/negocio/comercio-1/conversaciones');
    expect(rutaConversaciones('comercio-1', 'wa_59100000012', 'm0119'))
      .toBe('/negocio/comercio-1/conversaciones/wa_59100000012?m=m0119');
    expect(rutaConversaciones('comercio-1', 'wa_59100000012')).toBe('/negocio/comercio-1/conversaciones/wa_59100000012');
    expect(rutaConversaciones('c', 'a b&c=d')).toBe('/negocio/c/conversaciones/a%20b%26c%3Dd');
    expect(rutaConversaciones('c', 'x', 'm 1&y=2')).toBe('/negocio/c/conversaciones/x?m=m%201%26y%3D2');
  });
});

describe('3. lectura tolerante de documentos', () => {
  it('un documento de antes de H1 (sin NINGUNO de los campos nuevos) se lee sin romperse y es «leído»', () => {
    const f = fichaDeDocumento('wa_59100000047', {
      telefono: '59100000047', nombreContacto: 'Ximena P.', ultimoMensaje: 'hola', ultimoEn: marca(AHORA - HORA), canal: 'whatsapp',
    });
    expect(f).toMatchObject({
      id: 'wa_59100000047', telefono: '59100000047', nombre: 'Ximena P.', ultimoMensaje: 'hola', ultimoEn: AHORA - HORA,
      ultimoEntranteEn: null, ventanaVenceEn: null, noLeidos: 0, sinLeer: false, necesitaHumano: false, atencionEstado: '',
      noContactar: false, telefonoTrozos: [], nombrePalabras: [],
    });
    expect(cumpleFiltro(f, 'noLeidas', AHORA)).toBe(false);
    expect(cumpleFiltro(f, 'vencer', AHORA)).toBe(false);
    expect(cumpleFiltro(f, 'humano', AHORA)).toBe(false);
    expect(ventanaDeFicha(f, AHORA).estado).toBe('sin-dato');
  });

  it('un documento vacío, nulo o con tipos cambiados tampoco rompe (cada campo malo es «sin dato»)', () => {
    expect(() => fichaDeDocumento('wa_1', null)).not.toThrow();
    expect(() => fichaDeDocumento('wa_1', undefined)).not.toThrow();
    const raro = fichaDeDocumento('wa_59100000012', {
      telefono: 5, nombreContacto: { a: 1 }, ultimoMensaje: null, ultimoEn: 'ayer', ultimoEntranteEn: { toMillis: () => NaN },
      ventanaVenceEn: 7, noLeidos: '3', sinLeer: 'true', necesitaHumano: 'si', atencionEstado: 3, noContactar: 1,
      telefonoTrozos: 'x', nombrePalabras: [1, 'ok', null],
    });
    expect(raro).toMatchObject({
      telefono: '59100000012',   // sin teléfono válido en el documento, sale del id
      nombre: '', ultimoMensaje: '', ultimoEn: null, ultimoEntranteEn: null, ventanaVenceEn: null,
      noLeidos: 0, sinLeer: false, necesitaHumano: false, atencionEstado: '', noContactar: false,
      telefonoTrozos: [], nombrePalabras: ['ok'],
    });
  });

  it('`noLeidos` negativo, fraccionario o infinito se acota; `sinLeer` solo es verdadero con `true`', () => {
    expect(fichaDeDocumento('wa_1', { noLeidos: -4 }).noLeidos).toBe(0);
    expect(fichaDeDocumento('wa_1', { noLeidos: 2.9 }).noLeidos).toBe(2);
    expect(fichaDeDocumento('wa_1', { noLeidos: Infinity }).noLeidos).toBe(0);
    expect(fichaDeDocumento('wa_1', { noLeidos: 3 }).noLeidos).toBe(3);
    expect(fichaDeDocumento('wa_1', { sinLeer: true }).sinLeer).toBe(true);
    expect(fichaDeDocumento('wa_1', { sinLeer: 1 }).sinLeer).toBe(false);
  });

  it('un documento viejo SIN trozos se halla igual por los últimos 4 dígitos (se calculan acá)', () => {
    const vieja = fichaDeDocumento('wa_59100000047', { telefono: '59100000047', nombreContacto: 'Ximena P.' });
    expect(vieja.telefonoTrozos).toEqual([]);
    expect(buscarPorTelefono([vieja], '0047').map((r) => r.tipo)).toEqual(['final']);
    // y por nombre, sin `nombrePalabras`: las palabras se sacan del nombre
    expect(mensajeContiene(vieja.nombrePalabras, vieja.nombre, palabrasDe('ximena', 6))).toBe(true);
  });

  it('lee las fechas de Firestore y la ventana sale de `ultimoEntranteEn` o, si solo viene `ventanaVenceEn`, de ahí', () => {
    const f = fichaDeDocumento('wa_1', { ultimoEntranteEn: marca(AHORA - 2 * HORA), ventanaVenceEn: marca(AHORA + 22 * HORA) });
    expect(f.ultimoEntranteEn).toBe(AHORA - 2 * HORA);
    expect(ventanaDeFicha(f, AHORA).estado).toBe('abierta');
    const soloVence = fichaDeDocumento('wa_1', { ventanaVenceEn: marca(AHORA + 3 * HORA) });
    expect(ventanaDeFicha(soloVence, AHORA).estado).toBe('por-vencer');
  });
});

describe('ventana de 24 h', () => {
  it('corre desde el último mensaje DEL CLIENTE; por vencer cuando quedan menos de 6 h; cerrada a las 24', () => {
    expect(ventanaDe(AHORA - 1 * HORA, AHORA).estado).toBe('abierta');
    expect(ventanaDe(AHORA - (24 - POR_VENCER_HORAS) * HORA + 1, AHORA).estado).toBe('abierta');   // le quedan 6 h y 1 ms
    expect(ventanaDe(AHORA - (24 - POR_VENCER_HORAS) * HORA, AHORA).estado).toBe('por-vencer');    // justo 6 h: SÍ (≤ 6 h)
    expect(ventanaDe(AHORA - (24 - POR_VENCER_HORAS) * HORA - MIN, AHORA).estado).toBe('por-vencer');
    expect(ventanaDe(AHORA - 23.9 * HORA, AHORA).estado).toBe('por-vencer');
    expect(ventanaDe(AHORA - 24 * HORA, AHORA).estado).toBe('cerrada');
    expect(ventanaDe(AHORA - 30 * HORA, AHORA)).toEqual({ estado: 'cerrada', restanteMs: 0 });
  });

  it('NEGATIVA: sin `ultimoEntranteEn` la ventana es «sin-dato», NO «cerrada» (la pantalla no pinta pastilla)', () => {
    expect(ventanaDe(null, AHORA)).toEqual({ estado: 'sin-dato', restanteMs: 0 });
    expect(ventanaDeFicha({ ultimoEntranteEn: null, ventanaVenceEn: null }, AHORA).estado).toBe('sin-dato');
  });

  it('el texto del tiempo restante', () => {
    expect(textoRestante(3 * HORA + 20 * MIN)).toBe('3 h 20 min');
    expect(textoRestante(45 * MIN)).toBe('45 min');
    expect(textoRestante(10_000)).toBe('menos de 1 min');
    expect(textoRestante(0)).toBe('cerrada');
  });
});

describe('filtros', () => {
  const lista = [
    ficha('nueva', { noLeidos: 2, sinLeer: true }),
    ficha('humano', { atencionEstado: 'operador' }),
    ficha('bloqueada', { atencionEstado: 'bloqueado' }),
    ficha('humano-viejo', { atencionEstado: 'operador', ultimoEn: AHORA - 30 * HORA }),
    ficha('flag-h2', { necesitaHumano: true }),
    ficha('vence', { ultimoEntranteEn: AHORA - 20 * HORA, ventanaVenceEn: AHORA + 4 * HORA }),
    ficha('cerrada', { ultimoEntranteEn: AHORA - 40 * HORA, ventanaVenceEn: AHORA - 16 * HORA }),
    ficha('vieja', { ultimoEntranteEn: null, ventanaVenceEn: null, noLeidos: 0, sinLeer: false, atencionEstado: '' }),
  ];
  const ids = (f: Parameters<typeof aplicarFiltro>[1]) => aplicarFiltro(lista, f, AHORA).map((x) => x.id);

  it('los filtros son estos cuatro: NO hay «El asistente atiende» (en H1 nadie toma conversaciones)', () => {
    expect(FILTROS.map((f) => f.id)).toEqual(['todas', 'humano', 'noLeidas', 'vencer']);
    expect(FILTROS.map((f) => f.rotulo).join('|')).not.toMatch(/asistente atiende/i);
  });

  it('cada filtro deja lo que dice', () => {
    expect(ids('todas')).toHaveLength(lista.length);
    expect(ids('noLeidas')).toEqual(['nueva']);
    expect(ids('vencer')).toEqual(['vence']);
  });

  it('«necesita humano» = flag O estado operador/bloqueado, y este último solo con actividad de las últimas 24 h', () => {
    expect([...ESTADOS_HUMANO]).toEqual(['operador', 'bloqueado']);
    expect(ids('humano')).toEqual(['humano', 'bloqueada', 'flag-h2']);
    expect(necesitaHumanoDe(lista[3] as Ficha, AHORA)).toBe(false);   // operador, pero hace 30 h
    expect(necesitaHumanoDe(ficha('x', { atencionEstado: 'normal' }), AHORA)).toBe(false);
    expect(necesitaHumanoDe(ficha('x', { atencionEstado: '' }), AHORA)).toBe(false);
    expect(necesitaHumanoDe(ficha('x', { atencionEstado: 'operador', ultimoEn: null }), AHORA)).toBe(false);
  });

  it('«por vencer» es la ventana que vence dentro de 0 a 6 h (sobre `ventanaVenceEn`)', () => {
    const f = (vence: number | null) => ficha('v', { ventanaVenceEn: vence });
    expect(cumpleFiltro(f(AHORA + 6 * HORA), 'vencer', AHORA)).toBe(true);
    expect(cumpleFiltro(f(AHORA + 6 * HORA + 1), 'vencer', AHORA)).toBe(false);
    expect(cumpleFiltro(f(AHORA), 'vencer', AHORA)).toBe(false);       // ya venció
    expect(cumpleFiltro(f(AHORA + 1), 'vencer', AHORA)).toBe(true);
    expect(cumpleFiltro(f(null), 'vencer', AHORA)).toBe(false);
  });

  it('una «fijada» (abierta con el filtro puesto) se queda aunque deje de cumplirlo', () => {
    expect(aplicarFiltro(lista, 'noLeidas', AHORA, new Set(['cerrada'])).map((x) => x.id)).toEqual(['nueva', 'cerrada']);
  });

  it('ordena de lo más reciente a lo más viejo; «por vencer» por la que vence antes; no toca la lista original', () => {
    const a = ficha('a', { ultimoEn: 1 }); const b = ficha('b', { ultimoEn: 3 }); const c = ficha('c', { ultimoEn: 2 });
    const entrada = [a, b, c];
    expect(ordenarPorReciente(entrada).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(entrada.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    const v1 = ficha('v1', { ventanaVenceEn: AHORA + 5 * HORA }); const v2 = ficha('v2', { ventanaVenceEn: AHORA + 1 * HORA });
    expect(ordenarPara('vencer', [v1, v2]).map((x) => x.id)).toEqual(['v2', 'v1']);
  });

  it('los filtros con reloj son «necesita humano» y «por vencer» (se vuelven a pedir cada 5 minutos)', () => {
    expect(FILTROS.filter((f) => filtroConReloj(f.id)).map((f) => f.id)).toEqual(['humano', 'vencer']);
  });
});

describe('la lista: primera página en vivo, páginas anteriores y fijadas', () => {
  it('el mismo id en dos listas: gana la versión EN VIVO sobre la foto de la página anterior', () => {
    const vieja = ficha('c1', { ultimoMensaje: 'foto vieja', ultimoEn: 100 });
    const viva = ficha('c1', { ultimoMensaje: 'en vivo', ultimoEn: 900 });
    const r = mezclarLista('todas', [viva], [vieja, ficha('c2', { ultimoEn: 50 })]);
    expect(r.map((x) => x.id)).toEqual(['c1', 'c2']);
    expect(r[0]?.ultimoMensaje).toBe('en vivo');
  });

  it('las anteriores se ordenan junto con las vivas y las fijadas se suman sin duplicar', () => {
    const viva = [ficha('a', { ultimoEn: 900 }), ficha('b', { ultimoEn: 800 })];
    const anteriores = [ficha('c', { ultimoEn: 700 }), ficha('d', { ultimoEn: 600 })];
    const fijada = ficha('z', { ultimoEn: 750 });
    expect(mezclarLista('todas', viva, anteriores, new Map([['z', fijada]])).map((x) => x.id)).toEqual(['a', 'b', 'z', 'c', 'd']);
    // una fijada que además está en vivo no se duplica y gana la viva
    const vivaB = ficha('b', { ultimoEn: 800, ultimoMensaje: 'vivo' });
    const r = mezclarLista('todas', viva, [], new Map([['b', ficha('b', { ultimoEn: 800, ultimoMensaje: 'fijada' })]]));
    expect(r.filter((x) => x.id === 'b')).toHaveLength(1);
    expect(r.find((x) => x.id === 'b')?.ultimoMensaje).not.toBe('fijada');
    expect(mezclarLista('todas', [vivaB], []).find((x) => x.id === 'b')?.ultimoMensaje).toBe('vivo');
  });

  it('unirFichas: gana la última lista que se pase; ninguna se repite', () => {
    const r = unirFichas([ficha('a', { nombre: 'uno' })], [ficha('a', { nombre: 'dos' }), ficha('b')]);
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r[0]?.nombre).toBe('dos');
    expect(PAGINA_LISTA).toBe(50);
  });
});

describe('las consultas a Firestore, descritas como datos', () => {
  it('«todas»: por último mensaje, 50; «no leídas»: sinLeer == true', () => {
    expect(consultaDeFiltro('todas', AHORA, PAGINA_LISTA)).toEqual({
      restricciones: [], orden: [{ campo: 'ultimoEn', dir: 'desc' }], limite: 50 });
    expect(consultaDeFiltro('noLeidas', AHORA).restricciones).toEqual([{ campo: 'sinLeer', op: '==', valor: true }]);
    expect(consultaDeFiltro('noLeidas', AHORA).limite).toBeUndefined();   // para contar no hay límite
  });

  it('«necesita humano»: estados operador/bloqueado Y las últimas 24 h', () => {
    expect(consultaDeFiltro('humano', AHORA).restricciones).toEqual([
      { campo: 'atencionEstado', op: 'in', valor: ['operador', 'bloqueado'] },
      { campo: 'ultimoEn', op: '>=', valor: AHORA - 24 * HORA },
    ]);
  });

  it('«por vencer»: de ahora hasta dentro de 6 h, ordenado por la que vence antes', () => {
    const c = consultaDeFiltro('vencer', AHORA);
    expect(c.restricciones).toEqual([
      { campo: 'ventanaVenceEn', op: '>', valor: AHORA },
      { campo: 'ventanaVenceEn', op: '<=', valor: AHORA + 6 * HORA },
    ]);
    expect(c.orden).toEqual([{ campo: 'ventanaVenceEn', dir: 'asc' }]);
  });

  it('teléfono: los trozos y un rango por la cifra escrita y por cada prefijo del comercio, sin repetir; menos de 4 dígitos, nada', () => {
    const c = consultasDeTelefono('0047', ['591']);
    expect(c).toHaveLength(3);
    expect(c[0]?.restricciones).toEqual([{ campo: 'telefonoTrozos', op: 'array-contains', valor: '0047' }]);
    expect(c[1]?.restricciones[0]).toEqual({ campo: 'telefono', op: '>=', valor: '0047' });
    expect(c[2]?.restricciones[0]).toEqual({ campo: 'telefono', op: '>=', valor: '5910047' });
    expect(c.every((x) => x.limite === 20)).toBe(true);
    expect(consultasDeTelefono('5910047', ['591']).filter((x) => x.restricciones[0]?.campo === 'telefono')).toHaveLength(2);
    expect(consultasDeTelefono('047', ['591'])).toEqual([]);
    expect(consultasDeTelefono('0047', ['591', '591', '593']).length).toBe(4);
  });

  it('nombre: array-contains sobre `nombrePalabras`, 20', () => {
    expect(consultaDeNombre('marcela')).toEqual({
      restricciones: [{ campo: 'nombrePalabras', op: 'array-contains', valor: 'marcela' }], orden: [], limite: 20 });
  });

  it('TODA consulta que arma la pantalla tiene su forma en FORMAS_CONSULTA (la lista que se prueba contra los índices)', () => {
    const formas = FORMAS_CONSULTA.map(({ filtros, orden }) => JSON.stringify({ filtros, orden }));
    const armadas = [
      ...FILTROS.map((f) => consultaDeFiltro(f.id, AHORA, PAGINA_LISTA)),
      ...consultasDeTelefono('0047', ['591', '593']), consultaDeNombre('marcela'),
      consultaDeIds(['wa_59100000047', 'wa_59100000074']) as NonNullable<ReturnType<typeof consultaDeIds>>,
    ];
    for (const c of armadas) {
      const { filtros, orden } = formaDe(c);
      expect(formas, JSON.stringify(c)).toContain(JSON.stringify({ filtros, orden }));
    }
  });
});

describe('TAREA 3: «siguiente» no saltea conversaciones', () => {
  const ids = ['a', 'b', 'c'];

  it('avanza y retrocede de a una; en el borde se queda donde está; sin abierta va a la primera/última', () => {
    expect(vecina(ids, 'a', 1)).toBe('b');
    expect(vecina(ids, 'c', -1)).toBe('b');
    expect(vecina(ids, 'c', 1)).toBeNull();
    expect(vecina(ids, 'a', -1)).toBeNull();
    expect(vecina(ids, null, 1)).toBe('a');
    expect(vecina(ids, null, -1)).toBe('c');
    expect(vecina(ids, 'x', 1)).toBe('a');
    expect(vecina([], 'a', 1)).toBeNull();
  });

  it('recorrer las no leídas con «siguiente» no saltea ninguna, aunque abrirlas las marque leídas', () => {
    let fichas = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) =>
      ficha(id, { noLeidos: i + 1, sinLeer: true, ultimoEn: AHORA - i * MIN }));
    const fijadas = new Set<string>();
    let abierta: string | null = null;
    const visitadas: string[] = [];
    for (let paso = 0; paso < 8; paso++) {
      const visibles = aplicarFiltro(ordenarPorReciente(fichas), 'noLeidas', AHORA, new Set([...fijadas, ...(abierta ? [abierta] : [])]));
      const siguiente = vecina(visibles.map((f) => f.id), abierta, 1);
      if (siguiente === null) break;
      abierta = siguiente;
      fijadas.add(abierta);
      const id = abierta;
      fichas = fichas.map((f) => (f.id === id ? { ...f, noLeidos: 0, sinLeer: false } : f));   // abrirla la marca leída
      visitadas.push(abierta);
    }
    expect(visitadas).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(fichas.filter((f) => cumpleFiltro(f, 'noLeidas', AHORA))).toEqual([]);
  });
});

describe('6. marcar leída: quién, cuándo y con qué rebote', () => {
  const base = { rol: 'oper', propietario: false, comercioActivo: true, visible: true, noLeidos: 2, sinLeer: true };

  it('admin y oper, comercio activo, pestaña visible y algo por marcar: se marca', () => {
    expect(debeMarcarLeida({ ...base, rol: 'oper' })).toBe(true);
    expect(debeMarcarLeida({ ...base, rol: 'admin' })).toBe(true);
    expect(debeMarcarLeida({ ...base, noLeidos: 0, sinLeer: true })).toBe(true);
    expect(debeMarcarLeida({ ...base, noLeidos: 3, sinLeer: false })).toBe(true);
  });

  it('NEGATIVA: el propietario de NovuChat NUNCA marca, aunque tenga rol de negocio', () => {
    expect(debeMarcarLeida({ ...base, propietario: true })).toBe(false);
    expect(debeMarcarLeida({ ...base, propietario: true, rol: 'admin' })).toBe(false);
    expect(debeMarcarLeida({ ...base, propietario: true, rol: null })).toBe(false);
    expect(puedeGestionarConversaciones('admin', true)).toBe(false);
  });

  it('NEGATIVA: sin rol de negocio, o con el rol de la ingesta, no se marca', () => {
    expect(debeMarcarLeida({ ...base, rol: null })).toBe(false);
    expect(debeMarcarLeida({ ...base, rol: 'ingesta' })).toBe(false);
    expect(debeMarcarLeida({ ...base, rol: 'propietario' })).toBe(false);
    expect(puedeGestionarConversaciones('oper', false)).toBe(true);
    expect(puedeGestionarConversaciones('ingesta', false)).toBe(false);
  });

  it('NEGATIVA: con el comercio suspendido (o sin saber su estado) NO se marca: las reglas niegan la escritura y sería un bucle', () => {
    expect(debeMarcarLeida({ ...base, comercioActivo: false })).toBe(false);
    expect(debeMarcarLeida({ ...base, comercioActivo: false, noLeidos: 9, sinLeer: true, rol: 'admin' })).toBe(false);
  });

  it('NEGATIVA: una marca que FALLÓ no se reintenta mientras `noLeidos` valga lo mismo (rol revocado: sin bucle de escrituras negadas)', () => {
    // La marca falló cuando tenía 2 sin leer.
    expect(debeMarcarLeida({ ...base, noLeidos: 2, fallo: 2 })).toBe(false);
    // Llegó un mensaje más: hay algo nuevo que marcar, se reintenta una vez.
    expect(debeMarcarLeida({ ...base, noLeidos: 3, fallo: 2 })).toBe(true);
    // Fallar con solo `sinLeer` (noLeidos 0) tampoco se reintenta.
    expect(debeMarcarLeida({ ...base, noLeidos: 0, sinLeer: true, fallo: 0 })).toBe(false);
    // Sin fallo previo, se marca.
    expect(debeMarcarLeida({ ...base, noLeidos: 2, fallo: undefined })).toBe(true);
  });

  it('una marca fallida NO queda «pegada» si noLeidos baja y vuelve a subir (fallo=5, luego 0, luego 2 → se reintenta)', () => {
    expect(debeMarcarLeida({ ...base, noLeidos: 5, fallo: 5 })).toBe(false);       // sigue igual: sin bucle
    expect(debeMarcarLeida({ ...base, noLeidos: 0, sinLeer: false, fallo: 5 })).toBe(false);   // la marcó otra persona: nada que marcar
    expect(debeMarcarLeida({ ...base, noLeidos: 2, fallo: 5 })).toBe(true);        // volvió a subir, con otro valor: se reintenta
    expect(marcaBloqueada(5, 5)).toBe(true);
    expect(marcaBloqueada(5, 2)).toBe(false);
    expect(marcaBloqueada(5, 7)).toBe(false);
    expect(marcaBloqueada(undefined, 5)).toBe(false);
    expect(marcaBloqueada(0, 0)).toBe(true);                                        // falló solo con `sinLeer`: tampoco se repite
  });

  it('NEGATIVA: con la pestaña oculta no se marca (no se lee lo que nadie está mirando)', () => {
    expect(debeMarcarLeida({ ...base, visible: false })).toBe(false);
  });

  it('NEGATIVA: un documento sin nada por marcar (incluidos los de antes de H1) no se toca', () => {
    expect(debeMarcarLeida({ ...base, noLeidos: 0, sinLeer: false })).toBe(false);
    const vieja = fichaDeDocumento('wa_1', { telefono: '59100000012' });
    expect(debeMarcarLeida({ ...base, noLeidos: vieja.noLeidos, sinLeer: vieja.sinLeer })).toBe(false);
  });

  it('el rebote es de 1 segundo', () => {
    expect(REBOTE_MARCA_LEIDA_MS).toBe(1000);
  });
});

describe('la paginación de la lista: una respuesta de «Cargar más» solo vale en su época', () => {
  it('sin nada que la cambie, la respuesta vale y deja constancia de que hay anteriores', () => {
    let p = alSuscribir(PAGINACION_INICIAL);
    const epoca = p.epoca;
    expect(respuestaVigente(p, epoca)).toBe(true);
    p = alAceptarPagina(p);
    expect(p.hayAnteriores).toBe(true);
    expect(p.epoca).toBe(epoca);
  });

  it('CARRERA 1: entra una conversación a la primera página mientras `getDocs` vuela → la respuesta se descarta (abriría un hueco)', () => {
    let p = alSuscribir(PAGINACION_INICIAL);
    const epoca = p.epoca;          // "Cargar más" captura la época aquí
    p = alSnapshot(p, true);        // llega el snapshot con una conversación nueva
    expect(respuestaVigente(p, epoca)).toBe(false);
    expect(p.hayAnteriores).toBe(false);
  });

  it('CARRERA 1b: un snapshot sin conversaciones nuevas (solo cambios dentro de la ventana) NO descarta nada', () => {
    let p = alAceptarPagina(alSuscribir(PAGINACION_INICIAL));
    const epoca = p.epoca;
    p = alSnapshot(p, false);
    expect(respuestaVigente(p, epoca)).toBe(true);
    expect(p.hayAnteriores).toBe(true);
  });

  it('CARRERA 2: el oyente se vuelve a suscribir (filtro con reloj, cada 5 min) mientras vuela → se descarta', () => {
    let p = alSuscribir(PAGINACION_INICIAL);
    const epoca = p.epoca;
    p = alSuscribir(p);
    expect(respuestaVigente(p, epoca)).toBe(false);
  });

  it('CARRERA 3: cambia el filtro (o el negocio) mientras vuela → se descarta, y lo cargado ya no cuenta como anteriores', () => {
    let p = alAceptarPagina(alSuscribir(PAGINACION_INICIAL));
    const epoca = p.epoca;
    p = alSuscribir(p);             // el efecto del nuevo filtro
    expect(respuestaVigente(p, epoca)).toBe(false);
    expect(p.hayAnteriores).toBe(false);
  });

  it('las épocas solo crecen: una respuesta vieja nunca vuelve a valer', () => {
    let p = PAGINACION_INICIAL;
    const vistas: number[] = [];
    for (let k = 0; k < 5; k++) { p = k % 2 ? alSnapshot(p, true) : alSuscribir(p); vistas.push(p.epoca); }
    expect(vistas).toEqual([1, 2, 3, 4, 5]);
    expect(respuestaVigente(p, 1)).toBe(false);
  });
});

describe('ids que vienen de afuera, teléfonos largos, consulta por ids e iniciales', () => {
  it('esIdConversacion: solo `wa_` y 8 a 15 dígitos; una ruta con «/» o «..» no es una conversación', () => {
    expect(esIdConversacion('wa_59100000047')).toBe(true);
    expect(esIdConversacion('wa_12345678')).toBe(true);
    expect(esIdConversacion('wa_100000000000047')).toBe(true);
    for (const malo of ['wa_1234567', 'wa_1000000000000476', 'wa_59100000047/mensajes', 'wa_59100000047%2Fx', 'wa_../x', '../wa_59100000047', 'wa_', '', ' wa_59100000047', 'WA_59100000047', null, undefined, 5, {}]) {
      expect(esIdConversacion(malo), String(malo)).toBe(false);
    }
  });

  it('esIdMensaje: sin «/», sin «.» ni «..», sin los reservados `__x__`, hasta 200', () => {
    for (const bien of ['m0001', 'wamid.HBgM', 'a-b_c', 'x'.repeat(200)]) expect(esIdMensaje(bien), bien).toBe(true);
    for (const malo of ['', '.', '..', 'a/b', '/', '__nombre__', 'x'.repeat(201), null, undefined, 3]) expect(esIdMensaje(malo), String(malo)).toBe(false);
    expect(esIdMensaje('__con\nsalto__')).toBe(false);          // los reservados `__x__` incluso con un salto de línea adentro
  });

  it('consultaDeIds: una sola consulta `documentId() in`, solo ids válidos, sin repetir y hasta 30; sin ninguno válido, nada', () => {
    const c = consultaDeIds(['wa_59100000047', 'wa_59100000047', 'wa_59100000074', '../x', 'basura']);
    expect(c).toEqual({ restricciones: [{ campo: '__name__', op: 'in', valor: ['wa_59100000047', 'wa_59100000074'] }], orden: [] });
    expect(consultaDeIds(['../x', 'x/y'])).toBeNull();
    expect(consultaDeIds([])).toBeNull();
    const muchos = Array.from({ length: 45 }, (_, i) => `wa_5910000${String(1000 + i)}`);
    const grande = consultaDeIds(muchos);
    expect(MAX_IDS_CONSULTA).toBe(30);
    expect((grande?.restricciones[0]?.valor as string[]).length).toBe(30);
  });

  it('los resultados de una página de búsqueda caben en UNA consulta por ids', () => {
    expect(MAX_RESULTADOS_BUSQUEDA).toBeLessThanOrEqual(MAX_IDS_CONSULTA);
  });

  it('un cursor que el servidor rechaza (invalid-argument con cursor) se invalida; sin cursor u otro código, no', () => {
    expect(cursorInvalidado('functions/invalid-argument', true)).toBe(true);
    expect(cursorInvalidado('invalid-argument', true)).toBe(true);
    expect(cursorInvalidado('functions/invalid-argument', false)).toBe(false);
    for (const otro of ['functions/unavailable', 'functions/not-found', undefined, null, 4, {}]) expect(cursorInvalidado(otro, true), String(otro)).toBe(false);
  });

  it('un teléfono tiene como máximo 15 dígitos: el borde 15 busca, 16 es «larga» y no se consulta', () => {
    expect(MAX_DIGITOS_TELEFONO).toBe(15);
    expect(clasificarConsulta('100000000000047')).toEqual({ tipo: 'telefono', digitos: '100000000000047' });      // 15
    expect(clasificarConsulta('1000000000000047').tipo).toBe('larga');                                              // 16
    expect(clasificarConsulta('+100 000 000 000 047').tipo).toBe('telefono');                                      // 15 con formato
    expect(clasificarConsulta('+100 000 000 000 0047').tipo).toBe('larga');                                        // 16 con formato
    expect(clasificarConsulta('9'.repeat(500)).tipo).toBe('larga');
  });

  it('el «00» internacional, en sus bordes exactos: 10 dígitos se conserva y 11 se quita', () => {
    expect(clasificarConsulta('0000000047')).toEqual({ tipo: 'telefono', digitos: '0000000047' });        // 10: se conserva
    expect(clasificarConsulta('00000000047')).toEqual({ tipo: 'telefono', digitos: '000000047' });        // 11: se quita el «00»
    expect(clasificarConsulta('000000000047')).toEqual({ tipo: 'telefono', digitos: '0000000047' });      // 12: se quita
    // con 00 + 15 dígitos (17), al quitar el «00» quedan 15: es un teléfono, no «larga»
    expect(clasificarConsulta('00100000000000047')).toEqual({ tipo: 'telefono', digitos: '100000000000047' });
  });

  it('iniciales: dos letras del nombre, o «#» para un teléfono', () => {
    expect(iniciales('Ximena P.')).toBe('XP');
    expect(iniciales('marcela')).toBe('M');
    expect(iniciales('+59100000047')).toBe('#');
    expect(iniciales('')).toBe('#');
    expect(iniciales('   ')).toBe('#');
  });

  it('«por vencer»: el filtro y la pastilla coinciden en TODOS los bordes (≤ 6 h por vencer; > 6 h abierta; 0 h cerrada)', () => {
    for (const restante of [-HORA, 0, 1, 6 * HORA - 1, 6 * HORA, 6 * HORA + 1, 12 * HORA, 24 * HORA]) {
      const f = ficha('v', { ultimoEntranteEn: AHORA + restante - 24 * HORA, ventanaVenceEn: AHORA + restante });
      expect(cumpleFiltro(f, 'vencer', AHORA), `restante ${restante}`).toBe(ventanaDeFicha(f, AHORA).estado === 'por-vencer');
    }
  });
});

describe('la lista vacía y el resaltado de lo buscado', () => {
  it('en una búsqueda por palabra, sin resultados PERO con cursor → «Sin resultados recientes; buscar más atrás» (no «Nada coincide»)', () => {
    expect(textoListaVacia({ enBusqueda: true, hayMasPalabra: true, filtro: 'todas' })).toBe('Sin resultados recientes; buscar más atrás');
  });

  it('NEGATIVA: sin resultados y sin cursor → «Nada coincide con lo que escribió.»; fuera de una búsqueda, los textos de siempre', () => {
    expect(textoListaVacia({ enBusqueda: true, hayMasPalabra: false, filtro: 'todas' })).toBe('Nada coincide con lo que escribió.');
    expect(textoListaVacia({ enBusqueda: false, hayMasPalabra: false, filtro: 'todas' })).toBe('Todavía no hay conversaciones.');
    expect(textoListaVacia({ enBusqueda: false, hayMasPalabra: false, filtro: 'noLeidas' })).toBe('Ninguna conversación cumple este filtro.');
    // un cursor que sobra fuera de una búsqueda no cambia el texto
    expect(textoListaVacia({ enBusqueda: false, hayMasPalabra: true, filtro: 'humano' })).toBe('Ninguna conversación cumple este filtro.');
  });

  it('la lista, con cursor y sin renglones, pinta el texto Y el botón «Buscar más atrás»; sin cursor, solo «Nada coincide»', () => {
    const l = leerCodigo('web/src/central/componentes/ListaConversaciones.tsx');
    expect(l).toContain('textoListaVacia({ enBusqueda: p.enBusqueda, hayMasPalabra: p.hayMasPalabra, filtro: p.filtro })');
    expect(l).toContain("{p.renglones.length === 0 ? 'Buscar más atrás' : 'Más resultados'}");
    expect(l).not.toContain("'Nada coincide con lo que escribió.'");   // el texto vive en la función pura, no suelto en la pantalla
  });

  it('partirResaltado: parte la cadena en tramos que, juntos, son EXACTAMENTE el texto; marca por raíz, sin tildes ni mayúsculas', () => {
    const texto = 'Quiero Alfajores de maicena para el sábado';
    const t = partirResaltado(texto, ['alfajor', 'maicena']);
    expect(t.map((x) => x.texto).join('')).toBe(texto);
    expect(t.filter((x) => x.resaltado).map((x) => x.texto)).toEqual(['Alfajores', 'maicena']);   // «alfajor» marca «Alfajores» entero
    expect(partirResaltado('Dos Salteñas', ['saltena']).filter((x) => x.resaltado).map((x) => x.texto)).toEqual(['Salteñas']);
  });

  it('NEGATIVA: sin palabras, sin coincidencia o con texto vacío no resalta nada; el HTML del mensaje queda como texto', () => {
    expect(partirResaltado('hola mundo', [])).toEqual([{ texto: 'hola mundo', resaltado: false }]);
    expect(partirResaltado('hola mundo', ['zzz'])).toEqual([{ texto: 'hola mundo', resaltado: false }]);
    expect(partirResaltado('', ['hola'])).toEqual([]);
    const html = '<b>alfajor</b> <img src=x onerror=alert(1)>';
    const t = partirResaltado(html, ['alfajor']);
    expect(t.map((x) => x.texto).join('')).toBe(html);          // ni un carácter agregado ni quitado: sigue siendo texto
    expect(t.filter((x) => x.resaltado).map((x) => x.texto)).toEqual(['alfajor']);
  });

  it('el resaltado se pinta con <TextoSeguro> en cada tramo (nunca HTML) y el fragmento se recorta a 120', () => {
    const l = leerCodigo('web/src/central/componentes/ListaConversaciones.tsx');
    expect(l).toContain('partirResaltado(texto.slice(0, 120), palabras)');
    expect(l).toContain('<mark key={i} className="cv-resalte-palabra"><TextoSeguro valor={t.texto} maxLargo={120} /></mark>');
    expect(l).toContain('<TextoSeguro key={i} valor={t.texto} maxLargo={120} />');
  });
});

describe('errores de la búsqueda por palabra: el texto sale del CÓDIGO, nunca del mensaje', () => {
  it('cada código tiene su texto, con o sin el prefijo `functions/`', () => {
    expect(textoErrorBusqueda('functions/unauthenticated')).toBe('Su sesión venció. Vuelva a ingresar para buscar.');
    expect(textoErrorBusqueda('permission-denied')).toBe('No tiene permiso para buscar en estas conversaciones.');
    expect(textoErrorBusqueda('functions/invalid-argument')).toBe('Escriba al menos una palabra de 3 letras.');
    expect(textoErrorBusqueda('functions/invalid-argument', true)).toBe('La búsqueda cambió; vuelva a buscar.');
    expect(textoErrorBusqueda('functions/resource-exhausted')).toMatch(/demasiadas búsquedas/);
    expect(textoErrorBusqueda('functions/unavailable')).toBe('La búsqueda por palabra no está disponible en este momento. Intente de nuevo.');
  });

  it('mientras la callable no está desplegada (`not-found`) el mensaje es claro y deja buscar por teléfono y nombre', () => {
    const t = textoErrorBusqueda('functions/not-found');
    expect(t).toMatch(/todavía no está disponible/);
    expect(t).toMatch(/teléfono o por nombre/);
    // Según el camino, una Function sin desplegar llega como `internal`: el mismo aviso.
    expect(textoErrorBusqueda('functions/internal')).toBe(t);
  });

  it('NEGATIVA: un código desconocido, ausente o de otro tipo da el texto genérico; nada de lo que traiga el error se muestra', () => {
    const generico = textoErrorBusqueda('functions/unavailable');
    for (const raro of [undefined, null, 42, {}, 'functions/inventado', '', 'permission-denied: detalle interno']) {
      expect(textoErrorBusqueda(raro)).toBe(generico);
    }
  });
});

describe('etiquetas de hora (siempre hora de Bolivia, UTC-4)', () => {
  it('hoy: la hora; ayer: «Ayer»; esta semana: el día; antes: la fecha', () => {
    expect(horaCorta(Date.UTC(2026, 9, 9, 17, 5))).toBe('13:05');
    expect(etiquetaFicha(AHORA - 3 * HORA, AHORA)).toBe('09:00');
    expect(etiquetaFicha(AHORA - 24 * HORA, AHORA)).toBe('Ayer');
    expect(etiquetaFicha(Date.UTC(2026, 9, 5, 16, 0), AHORA)).toBe('lunes');
    expect(etiquetaFicha(Date.UTC(2026, 8, 1, 16, 0), AHORA)).toBe('01/09/26');
    expect(etiquetaFicha(null, AHORA)).toBe('');
  });

  it('la medianoche de Bolivia (04:00 UTC) cambia de día, no la de Greenwich', () => {
    const casiMedianoche = Date.UTC(2026, 9, 10, 3, 59);
    const pasadaLaMedianoche = Date.UTC(2026, 9, 10, 5, 0);
    expect(etiquetaDia(casiMedianoche, AHORA)).toBe('Hoy');
    expect(etiquetaDia(casiMedianoche, pasadaLaMedianoche)).toBe('Ayer');
    expect(etiquetaDia(Date.UTC(2026, 9, 10, 4, 1), pasadaLaMedianoche)).toBe('Hoy');
    expect(etiquetaDia(Date.UTC(2026, 8, 1, 20, 0), AHORA)).toBe('01/09/2026');
  });
});

describe('NEGATIVA: lo que la pantalla escribe, llama y usa (guardas de fuente)', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const RAIZ_ADMIN = join(aqui, '..', '..');
  const leer = (ruta: string) => readFileSync(join(RAIZ_ADMIN, ruta), 'utf8');
  /** El código sin comentarios: lo que de verdad se ejecuta. */
  const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const ARCHIVOS = [
    'web/src/central/paginas/Conversaciones.tsx',
    'web/src/central/paginas/ConversacionesNueva.tsx',
    'web/src/central/componentes/DetalleConversacion.tsx',
    'web/src/central/componentes/ListaConversaciones.tsx',
    'web/src/central/componentes/ConsolaConversaciones.tsx',
    'web/src/central/lib/conversaciones.ts',
  ];
  const codigo = (ruta: string) => sinComentarios(leer(ruta));

  it('ninguna escritura que no sea `updateDoc`, ni transacción, ni lote, ni `fetch`, ni almacenamiento del navegador', () => {
    for (const ruta of ARCHIVOS) {
      const c = codigo(ruta);
      for (const prohibido of ['setDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction', 'fetch(', 'XMLHttpRequest', 'sendBeacon',
        'localStorage', 'sessionStorage', 'indexedDB', 'collectionGroup', 'WebSocket']) {
        expect(c, `${ruta} usa ${prohibido}`).not.toContain(prohibido);
      }
    }
  });

  it('SOLO DOS `updateDoc`: «No contactar» y la marca de leída `{ noLeidos: 0, sinLeer: false }` (nada de `turno`, `atendidaPor`, `noLeidos` hacia arriba)', () => {
    const escrituras = ARCHIVOS.flatMap((r) => [...codigo(r).matchAll(/updateDoc\([^;]*;/g)].map((m) => m[0].replace(/\s+/g, ' ')));
    expect(escrituras).toHaveLength(2);
    expect(escrituras.filter((e) => e.includes('{ noContactar: valor }'))).toHaveLength(1);
    const lectura = escrituras.filter((e) => e.includes('{ noLeidos: 0, sinLeer: false }'));
    expect(lectura).toHaveLength(1);
    expect(lectura[0]).toContain(".catch(() => { fallidas.current.set(idAMarcar, noLeidosAbierta);");   // el error se ignora y se recuerda
    for (const e of escrituras) {
      for (const campo of ['turno', 'atendidaPor', 'necesitaHumano', 'autor', 'etiquetas', 'notaInterna', 'telefono', 'ultimoMensaje']) {
        expect(e, `updateDoc escribe ${campo}`).not.toContain(campo);
      }
    }
  });

  it('la marca de leída respeta rol, propietario y pestaña visible ANTES de escribir, con el rebote de 1 s', () => {
    const f = codigo('web/src/central/paginas/ConversacionesNueva.tsx');
    expect(f).toMatch(/const marcar = fichaAbierta !== null && debeMarcarLeida\(\{\s*rol, propietario: permisos\.propietario, comercioActivo: estadoComercio === 'activo', visible,/);
    expect(f).toContain('fallo: fallidas.current.get(fichaAbierta.id)');
    expect(f).toMatch(/if \(!marcar \|\| !idAMarcar\) return;/);
    expect(f).toContain('}, REBOTE_MARCA_LEIDA_MS);');
    expect(f).toContain('return () => clearTimeout(t);');
  });

  it('la única Function que llama es `buscarConversaciones`, con `{ tenantId, texto, cursor? }`', () => {
    const llamadas = ARCHIVOS.flatMap((r) => [...codigo(r).matchAll(/httpsCallable\s*(?:<[^>]*>)?\(([^)]*)\)/g)].map((m) => m[1]?.replace(/\s+/g, ' ')));
    expect(llamadas).toEqual(["funciones, 'buscarConversaciones'"]);
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain("await buscar({ tenantId, texto, ...(cursor ? { cursor } : {}) })");
  });

  it('el error de la búsqueda sale de `e.code`, nunca de `e.message`', () => {
    for (const ruta of ARCHIVOS) expect(codigo(ruta), ruta).not.toMatch(/\.message\b/);
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('textoErrorBusqueda(codigoDe(e), cursor !== null)');
  });

  it('todas las consultas de conversaciones pasan por `consultaFirestore` (la forma que se prueba contra los índices)', () => {
    const f = codigo('web/src/central/paginas/ConversacionesNueva.tsx');
    expect(f.match(/\bwhere\(/g)).toHaveLength(1);
    expect(f.match(/\borderBy\(/g)).toHaveLength(1);
    expect(f.match(/collection\(db, 'tenants', tenantId, 'conversaciones'\)/g)).toHaveLength(1);
    // la pantalla nunca lee mensajes de otras conversaciones: el detalle lee los de UNA, y la palabra va por la callable
    expect(f).not.toMatch(/'conversaciones',[^)]*'mensajes'/);
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('getCountFromServer(');
  });

  it('ronda de revisión: lo que viene de la dirección y del servidor se valida ANTES de armar una ruta o una consulta', () => {
    const f = codigo('web/src/central/paginas/ConversacionesNueva.tsx');
    // El id de la dirección, antes de `doc()`; el `?m=` también.
    expect(f).toMatch(/if \(!esIdConversacion\(conversacionId\)\) \{ setAbierta\(\{ estado: 'no-existe' \}\); return; \}\s*setAbierta\(\{ estado: 'cargando' \}\);/);
    expect(f).toContain('const mensajeId = esIdMensaje(mensajeCrudo) ? mensajeCrudo : null;');
    // Las fichas de los resultados, en UNA consulta por ids (sin un `getDoc` por resultado).
    expect(f.match(/documentId\(\)/g)).toHaveLength(1);
    expect(f).toContain('const consultaIds = consultaDeIds(faltan);');
    expect(f).not.toMatch(/faltan\.map\(/);
    // La lista y la foto de la abierta: lo vivo gana.
    expect(f).toContain('mezclarLista(filtro, lista.enVivo, lista.anteriores, fijadas)');
    expect(f).toContain('unirFichas(resTelefono, lista.fichas)');
    expect(f).toContain('unirFichas(resTelefono, resNombre, lista.fichas)');
    // «Más resultados»: vigente de verdad, y antes de pedir las fichas.
    expect(f).toContain('busquedaId.current === id && textoDeLaBusqueda.current === t, true)');
    expect(f.match(/if \(!vigente\(\)\) return;/g)!.length).toBeGreaterThanOrEqual(2);
    // «Cargar más»: la época se captura y se compara.
    expect(f).toContain('const epoca = paginacion.current.epoca;');
    expect(f.match(/respuestaVigente\(paginacion\.current, epoca\)/g)).toHaveLength(2);
    // Los conteos no dependen del filtro.
    expect(f).toContain('useEffect(() => { void contar(); }, [contar]);');
    // Escape: con el foco en otro campo no cierra la conversación.
    expect(f).toContain('if (escribiendo && destino !== buscadorRef.current) return;');
  });

  it('mini-ronda: guardas de la paginación (época, `added`, oyente activo), de la marca fallida y del reacomodo del hilo', () => {
    const f = codigo('web/src/central/paginas/ConversacionesNueva.tsx');
    expect(f).toContain("const entro = !primera && snap.docChanges().some((c) => c.type === 'added');");
    expect(f).toContain('paginacion.current = alSnapshot(paginacion.current, entro);');
    expect(f).toContain('let activa = true;');
    expect(f).toContain('return () => { activa = false; paginacion.current = alSuscribir(paginacion.current); baja(); };');
    expect(f).not.toContain('paginacion.current.epoca < mia');
    // la marca fallida se consulta DENTRO del temporizador, justo antes de escribir
    expect(f).toMatch(/setTimeout\(\(\) => \{\s*if \(marcaBloqueada\(fallidas\.current\.get\(idAMarcar\), noLeidosAbierta\)\) return;\s*updateDoc\(/);
    // un cursor invalidado se quita; el mensajeId del servidor se valida; sin la rama muerta TEXTAREA
    expect(f).toContain('if (cursorInvalidado(codigoDe(e), cursor !== null)) setCursorPalabra(null);');
    expect(f).toContain('&& esIdMensaje(r.mensajeId));');
    expect(f).not.toContain("tagName === 'TEXTAREA') { destino.blur()");
    expect(f).toContain("comercioActivo={estadoComercio === 'activo'}");
    const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');
    expect(d).toContain('disabled={!p.comercioActivo}');
    expect(d).toContain('.then((hubo) => { if (!hubo) restaurar.current = null; });');
    expect(d).toContain('return !antes.empty;');
    expect(d).toContain('    setError(null);\n    try {');
  });

  it('ronda de revisión: el buscador no pasa de 100 letras, el teléfono de 15 dígitos y la regla de la lib usa los topes de Core', () => {
    expect(codigo('web/src/central/componentes/ListaConversaciones.tsx')).toContain('maxLength={100}');
    const lib = leer('web/src/central/lib/conversaciones.ts');
    expect(lib).not.toContain('');                 // el carácter especial escrito como escape, no pegado
    expect(lib).toContain("c + '\\uf8ff'");
    expect(codigo('web/src/central/lib/conversaciones.ts')).toContain('palabras: palabrasDe(q, MAX_PALABRAS_CONSULTA)');
  });

  it('ronda de revisión: el hilo mira en vivo solo los últimos 50 y trae los anteriores con `getDocs`, con guarda de vigencia', () => {
    const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');
    expect(d).toContain("orderBy('ts', 'asc'), limitToLast(PAGINA)");
    expect(d).not.toMatch(/limitToLast\(tope\)|setTope|useState\(PAGINA\)/);
    expect(d).toContain('startAfter(primero.snap)');
    const cuerpo = d.slice(d.indexOf('const cargarAnteriores'), d.indexOf('return { clave, cargadaPara'));
    expect(cuerpo).toContain('try {');
    expect(cuerpo).toContain('} catch {');
    expect(cuerpo.match(/claveVista\.current !== miClave/g)!.length).toBeGreaterThanOrEqual(1);
    expect(cuerpo).not.toContain('getDoc(');            // ya no hace falta una lectura de más para saber el `ts`
  });

  it('ronda de revisión: «No contactar» solo para quien puede gestionar; teléfono por <TextoSeguro>; punto «Sin leer» con role="img"; <time dateTime>', () => {
    const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');
    expect(d).toContain('{p.puedeGestionar ? (');
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('posicion={posicion} puedeGestionar={puedeGestionar}');
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('const puedeGestionar = puedeGestionarConversaciones(rol, permisos.propietario);');
    const l = codigo('web/src/central/componentes/ListaConversaciones.tsx');
    expect(l).toContain('+<TextoSeguro valor={f.telefono} maxLargo={15} />');
    expect(l).not.toContain('+{f.telefono}');
    expect(l).toContain('role="img" aria-label="Sin leer"');
    expect(l).toContain('<time className="cv-ficha-hora" dateTime=');
    expect(d).toContain('<time dateTime=');
    // las iniciales viven en un solo lugar
    expect(l).not.toMatch(/function iniciales/);
    expect(d).not.toMatch(/function iniciales/);
  });

  it('el texto de los clientes nunca va como HTML', () => {
    for (const ruta of ARCHIVOS) {
      expect(codigo(ruta), ruta).not.toContain('dangerouslySetInnerHTML');
      expect(codigo(ruta), ruta).not.toContain('innerHTML');
    }
  });

  it('nada del prototipo sobrevive: ni banner, ni simulación, ni Tomar/Devolver/escribir, ni `prototipoSemilla`', () => {
    for (const ruta of ARCHIVOS) {
      const c = codigo(ruta);
      for (const viejo of ['SIMULACION', 'Simulacion', 'simulacion', 'prototipoSemilla', 'quienSoy', 'Tomar la conversación', 'Devolver', 'cv-prototipo', 'PROTOTIPO', '<textarea']) {
        expect(c, `${ruta} conserva ${viejo}`).not.toContain(viejo);
      }
    }
    expect(() => readFileSync(join(RAIZ_ADMIN, 'web/src/central/lib/conversacionesSimulacion.ts'))).toThrow();
    expect(leer('web/src/central/estilos/conversaciones.css')).not.toMatch(/cv-prototipo|cv-simulacion|cv-redactar|cv-reiniciar/);
  });

  it('la normalización NO se define en la pantalla: se importa de Core por ruta relativa', () => {
    const f = codigo('web/src/central/lib/conversaciones.ts');
    expect(f).toContain("'../../../../functions/src/core/conversacion/normalizacion'");
    for (const nombre of ['palabrasDe', 'raizDe', 'normalizarTexto', 'trozosDeTelefono', 'mensajeContiene', 'palabraParaIndice', 'fragmento', 'soloDigitos', 'prefijosValidos']) {
      expect(f, `la pantalla define ${nombre}`).not.toMatch(new RegExp(`function ${nombre}\\b`));
    }
  });

  it('la pantalla de siempre es, BYTE A BYTE, la de antes de H1 (ConversacionesClasica.tsx)', () => {
    const bytes = readFileSync(join(RAIZ_ADMIN, 'web/src/central/paginas/ConversacionesClasica.tsx'));
    // SHA-256 de `Conversaciones.tsx` tal como estaba en main antes de H1 (09/10/2026). Si esta prueba falla, alguien
    // tocó la pantalla de siempre: se revierte, o se decide a propósito y se cambia este hash en el mismo cambio.
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe('ab05d42ef18c65492038cdda52f7402cd2431a28fedc634b0bd7a6b5fc5b6d19');
  });

  it('el selector importa la de siempre con su nombre de antes (`Conversaciones as ConversacionesClasica`) y la nueva', () => {
    const f = codigo('web/src/central/paginas/Conversaciones.tsx');
    expect(f).toContain("import { Conversaciones as ConversacionesClasica } from './ConversacionesClasica';");
    expect(f).toContain("import { ConversacionesNueva } from './ConversacionesNueva';");
  });

  it('la ruta de App.tsx lleva la conversación (`/conversaciones/:conversacionId?`), que es lo que `CONVERSACION_EN_LA_RUTA = true` supone', () => {
    expect(CONVERSACION_EN_LA_RUTA).toBe(true);
    expect(sinComentarios(leer('web/src/App.tsx'))).toContain('path="/negocio/:tenantId/conversaciones/:conversacionId?"');
  });

  it('el LEEME del demo no lleva rutas absolutas ni el nombre de un worktree', () => {
    const leeme = leer('pruebas/central/prototipo-conversaciones/LEEME.md');
    for (const malo of ['/home/', '$HOME', '~/', '.claude/worktrees', 'agent-a', 'C:\\']) expect(leeme, malo).not.toContain(malo);
  });

  it('la siembra del demo solo corre contra emuladores, escribe teléfonos con seis ceros y los campos de H1 (nada de `turno` ni `necesitaHumano`)', () => {
    const siembra = leer('pruebas/central/prototipo-conversaciones/sembrar.mjs');
    const c = sinComentarios(siembra);
    expect(siembra).toContain("startsWith('demo-')");
    expect(siembra).toContain('process.exit(1)');
    expect(siembra).toContain('`591000000${suf}`');
    const telefonos = [...siembra.matchAll(/\b591\d{6,}\b/g)].map((m) => m[0]);
    for (const t of telefonos) expect(t, `número sospechoso en la siembra: ${t}`).toMatch(/0{6}/);
    // La normalización es la de Core, y la bandera de la pantalla nueva se siembra.
    expect(c).toContain("functions/src/core/conversacion/normalizacion.ts");
    expect(c).toContain("consolaConversaciones: 'nueva'");
    for (const campo of ['telefonoTrozos', 'nombrePalabras', 'ultimoEntranteEn', 'ventanaVenceEn', 'noLeidos', 'sinLeer', 'atencionEstado', 'tenantId', 'palabras']) {
      expect(c, `la siembra no escribe ${campo}`).toContain(campo);
    }
    for (const prohibido of ['necesitaHumano', 'turno:', 'autor:', 'autorUid', 'prototipoSemilla']) expect(c, `la siembra escribe ${prohibido}`).not.toContain(prohibido);
  });
});
