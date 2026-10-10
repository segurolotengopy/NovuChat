/**
 * PROTOTIPO DE CONVERSACIONES (09/10/2026): LA LÓGICA DE LA PANTALLA.
 *
 * Lo que estas pruebas defienden, que es lo que Andres va a poner a prueba con
 * las cinco tareas del criterio de aceptación:
 *
 *  1. UN TELÉFONO SE HALLA SIN PREFIJO Y POR LOS ÚLTIMOS 4 DÍGITOS, y dos números
 *     parecidos no se confunden.
 *  2. UNA PALABRA SE HALLA CON O SIN TILDES, EN SINGULAR O EN PLURAL, y el
 *     resultado trae el mensaje (para saltar a él).
 *  3. «SIGUIENTE» NO SALTEA CONVERSACIONES al recorrer las no leídas, aunque
 *     abrirlas las deje de ser no leídas (la lista no «salta bajo los dedos»).
 *  4. (Celular: dos vistas. Es CSS; se verifica en el navegador, no acá.)
 *  5. TOMAR, DEVOLVER Y ESCRIBIR SON UNA SIMULACIÓN: no hay ninguna escritura ni
 *     llamada a una Function en la pantalla, salvo «No contactar», que ya existía.
 *
 * Son puras: sin navegador, sin emulador y sin red.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FILTROS, POR_VENCER_HORAS, VENTANA_HORAS, aplicarFiltro, buscarPorNombre, buscarPorTelefono, clasificarConsulta,
  coincidenciaTelefono, contarFiltros, cumpleFiltro, etiquetaDia, etiquetaFicha, fragmento, horaCorta, mensajeContiene,
  normalizarTexto, ordenarPorReciente, palabraParaIndice, palabrasDe, raizDe, rutaConversaciones, soloDigitos,
  textoRestante, trozosDeTelefono, vecina, ventanaDe, type Ficha,
} from '../../web/src/central/lib/conversaciones';
import {
  SIMULACION_VACIA, conSimulacion, devolver, enviar, leerSimulacion, marcarLeida, tomar,
} from '../../web/src/central/lib/conversacionesSimulacion';

const HORA = 3_600_000;
const MIN = 60_000;
/** 9 de octubre de 2026, 12:00 de Bolivia (16:00 UTC). */
const AHORA = Date.UTC(2026, 9, 9, 16, 0, 0);

function ficha(id: string, extra: Partial<Ficha> = {}): Ficha {
  const telefono = extra.telefono ?? id.replace(/^wa_/, '');
  return {
    id, telefono, nombre: id, ultimoMensaje: '', ultimoEn: AHORA - 10 * MIN, ultimoEntranteEn: AHORA - 10 * MIN,
    noLeidos: 0, necesitaHumano: false, responde: 'asistente', tomadoPor: '', noContactar: false,
    telefonoTrozos: trozosDeTelefono(telefono), ...extra,
  };
}

describe('normalización: una sola regla para la pantalla y para la siembra', () => {
  it('quita tildes y eñes y pasa a minúsculas', () => {
    expect(normalizarTexto('Salteñas CÓMO')).toBe('saltenas como');
    expect(normalizarTexto(undefined)).toBe('');
    expect(normalizarTexto(42)).toBe('');
  });

  it('la raíz quita el plural: «alfajor» y «alfajores» son la misma palabra', () => {
    expect(raizDe('alfajores')).toBe(raizDe('alfajor'));
    expect(raizDe('tortas')).toBe('torta');
    expect(raizDe('mas')).toBe('mas');           // no se come las palabras cortas
    expect(raizDe('tres')).toBe('tre');          // límite conocido: no es un lematizador
  });

  it('palabrasDe: normaliza, descarta lo de menos de 3 letras, no repite y respeta el tope de 30', () => {
    expect(palabrasDe('¡Hola! Quiero DOS salteñas y una torta de chocolate')).toEqual(
      ['hola', 'quiero', 'dos', 'saltena', 'una', 'torta', 'chocolate']);
    expect(palabrasDe('torta Torta TORTAS')).toEqual(['torta']);
    const largo = Array.from({ length: 80 }, (_, i) => `palabra${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    expect(palabrasDe(largo).length).toBe(30);
    expect(palabrasDe(largo, 5).length).toBe(5);
    expect(palabrasDe(undefined)).toEqual([]);
  });

  it('trozosDeTelefono: todos los finales de 4 dígitos o más (para array-contains)', () => {
    const t = trozosDeTelefono('59100000047');
    expect(t).toContain('59100000047');
    expect(t).toContain('00000047');   // sin el prefijo del país
    expect(t).toContain('0047');       // últimos 4
    expect(t).not.toContain('047');    // menos de 4: no se indexa
    expect(t.length).toBe(8);
    expect(trozosDeTelefono('+591 000-00047')).toEqual(t);
    expect(trozosDeTelefono('123')).toEqual([]);
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

  it('lo demás es texto, con sus palabras ya normalizadas', () => {
    expect(clasificarConsulta('Alfajores de Maicena')).toEqual({
      tipo: 'texto', texto: 'alfajores de maicena', palabras: ['alfajor', 'maicena'] });
    // Mezcla de letras y cifras: texto (una palabra), no teléfono.
    expect(clasificarConsulta('pedido 1234').tipo).toBe('texto');
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
    const d = soloDigitos('+591 000 00047');
    const r = buscarPorTelefono(todas, d);
    expect(r.map((x) => x.ficha.id)).toEqual(['wa_59100000047']);
    expect(r[0]?.tipo).toBe('completo');
  });

  it('el número local lo halla también cuando se completa con el prefijo del comercio, aunque no haya trozos guardados', () => {
    const sinTrozos = ficha('wa_59100000047', { telefonoTrozos: [] });
    expect(coincidenciaTelefono(sinTrozos.telefono, sinTrozos.telefonoTrozos, '0047')).toBe('final');
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

  it('ordena de lo más específico a lo menos: número completo, final, completado, inicio', () => {
    const lista = [ficha('wa_59100000047'), ficha('wa_59147000047'), ficha('wa_47100000099')];
    const r = buscarPorTelefono(lista, '59100000047');
    expect(r[0]?.ficha.id).toBe('wa_59100000047');
    const ult = buscarPorTelefono(lista, '0047');
    expect(ult.map((x) => x.tipo)).toEqual(['final', 'final']);
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
    expect(palabraParaIndice(buscadas)).toBe('alfajor');   // a igual largo, la primera
    expect(palabraParaIndice([])).toBeNull();
  });

  it('NEGATIVA: sin palabras buscadas no coincide nada (no «todo»)', () => {
    expect(mensajeContiene(['hola'], 'hola', [])).toBe(false);
  });

  it('el fragmento del resultado muestra el entorno de la palabra, recortado', () => {
    const texto = 'Buenas tardes, quería preguntar si para el cumpleaños de mi hija tienen alfajores de maicena disponibles este sábado';
    const f = fragmento(texto, ['alfajor'], 60);
    expect(f.toLowerCase()).toContain('alfajores');
    expect(f.length).toBeLessThanOrEqual(62);
    expect(fragmento('corto', ['x'])).toBe('corto');
    expect(fragmento(texto, ['inexistente'], 20)).toBe(texto.slice(0, 20) + '…');
  });

  it('la dirección de un resultado lleva la conversación y el mensaje; todo escapado', () => {
    expect(rutaConversaciones('comercio-1')).toBe('/negocio/comercio-1/conversaciones');
    expect(rutaConversaciones('comercio-1', 'wa_59100000012', 'm0119'))
      .toBe('/negocio/comercio-1/conversaciones?c=wa_59100000012&m=m0119');
    expect(rutaConversaciones('c', 'a b&c=d')).toBe('/negocio/c/conversaciones?c=a+b%26c%3Dd');
  });
});

describe('ventana de 24 h', () => {
  it('corre desde el último mensaje DEL CLIENTE; por vencer cuando quedan menos de 6 h; cerrada a las 24', () => {
    expect(VENTANA_HORAS).toBe(24);
    expect(ventanaDe(null, AHORA).estado).toBe('sin-mensaje');
    expect(ventanaDe(AHORA - 1 * HORA, AHORA).estado).toBe('abierta');
    expect(ventanaDe(AHORA - (24 - POR_VENCER_HORAS) * HORA, AHORA).estado).toBe('abierta');       // justo 6 h: todavía no
    expect(ventanaDe(AHORA - (24 - POR_VENCER_HORAS) * HORA - MIN, AHORA).estado).toBe('por-vencer');
    expect(ventanaDe(AHORA - 23.9 * HORA, AHORA).estado).toBe('por-vencer');
    expect(ventanaDe(AHORA - 24 * HORA, AHORA).estado).toBe('cerrada');
    expect(ventanaDe(AHORA - 30 * HORA, AHORA)).toEqual({ estado: 'cerrada', restanteMs: 0 });
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
    ficha('nueva', { noLeidos: 2 }),
    ficha('humano', { necesitaHumano: true }),
    ficha('humano-tomada', { necesitaHumano: true, responde: 'persona', tomadoPor: 'Rosa' }),
    ficha('tomada', { responde: 'persona', tomadoPor: 'Rosa' }),
    ficha('vence', { ultimoEntranteEn: AHORA - 20 * HORA }),
    ficha('cerrada', { ultimoEntranteEn: AHORA - 40 * HORA }),
  ];
  const ids = (f: Parameters<typeof aplicarFiltro>[1]) => aplicarFiltro(lista, f, AHORA).map((x) => x.id);

  it('cada filtro deja lo que dice', () => {
    expect(ids('todas')).toHaveLength(6);
    expect(ids('noLeidas')).toEqual(['nueva']);
    expect(ids('vencer')).toEqual(['vence']);
    expect(ids('asistente')).toEqual(['nueva', 'humano', 'vence', 'cerrada']);
  });

  it('«necesita humano» deja de serlo cuando una persona ya tomó la conversación', () => {
    expect(ids('humano')).toEqual(['humano']);
    expect(cumpleFiltro(lista[2] as Ficha, 'humano', AHORA)).toBe(false);
  });

  it('los contadores de los chips son los de cada filtro', () => {
    expect(contarFiltros(lista, AHORA)).toEqual({ todas: 6, humano: 1, asistente: 4, noLeidas: 1, vencer: 1 });
    expect(FILTROS.map((f) => f.id)).toEqual(['todas', 'humano', 'asistente', 'noLeidas', 'vencer']);
  });

  it('una «fijada» (abierta con el filtro puesto) se queda aunque deje de cumplirlo', () => {
    const r = aplicarFiltro(lista, 'noLeidas', AHORA, new Set(['cerrada']));
    expect(r.map((x) => x.id)).toEqual(['nueva', 'cerrada']);
  });

  it('ordena de lo más reciente a lo más viejo y no toca la lista original', () => {
    const a = ficha('a', { ultimoEn: 1 }); const b = ficha('b', { ultimoEn: 3 }); const c = ficha('c', { ultimoEn: 2 });
    const entrada = [a, b, c];
    expect(ordenarPorReciente(entrada).map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(entrada.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('anterior / siguiente', () => {
  const ids = ['a', 'b', 'c'];

  it('avanza y retrocede de a una', () => {
    expect(vecina(ids, 'a', 1)).toBe('b');
    expect(vecina(ids, 'b', 1)).toBe('c');
    expect(vecina(ids, 'c', -1)).toBe('b');
  });

  it('en el borde se queda donde está: no da la vuelta', () => {
    expect(vecina(ids, 'c', 1)).toBeNull();
    expect(vecina(ids, 'a', -1)).toBeNull();
  });

  it('sin conversación abierta (o fuera de la lista), «siguiente» va a la primera y «anterior» a la última', () => {
    expect(vecina(ids, null, 1)).toBe('a');
    expect(vecina(ids, null, -1)).toBe('c');
    expect(vecina(ids, 'x', 1)).toBe('a');
    expect(vecina([], 'a', 1)).toBeNull();
  });

  it('TAREA 3: recorrer las no leídas con «siguiente» no saltea ninguna, aunque abrirlas las marque leídas', () => {
    const fichas = ['n1', 'n2', 'n3', 'n4', 'n5'].map((id, i) => ficha(id, { noLeidos: i + 1, ultimoEn: AHORA - i * MIN, ultimoEntranteEn: AHORA - 5 * MIN }));
    let sim = SIMULACION_VACIA('s');
    const fijadas = new Set<string>();
    let abierta: string | null = null;
    const visitadas: string[] = [];
    for (let paso = 0; paso < 8; paso++) {
      const vistas = ordenarPorReciente(fichas.map((f) => conSimulacion(f, sim)));
      const visibles = aplicarFiltro(vistas, 'noLeidas', AHORA, new Set([...fijadas, ...(abierta ? [abierta] : [])]));
      const siguiente = vecina(visibles.map((f) => f.id), abierta, 1);
      if (siguiente === null) break;
      abierta = siguiente;
      fijadas.add(abierta);
      sim = marcarLeida(sim, abierta, AHORA);   // abrirla la marca leída
      visitadas.push(abierta);
    }
    expect(visitadas).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    // y al final no queda ninguna sin leer
    expect(contarFiltros(fichas.map((f) => conSimulacion(f, sim)), AHORA).noLeidas).toBe(0);
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
    const casiMedianoche = Date.UTC(2026, 9, 10, 3, 59);   // 23:59 del 9 en Bolivia (ya es el 10 en Greenwich)
    const pasadaLaMedianoche = Date.UTC(2026, 9, 10, 5, 0);   // 01:00 del 10 en Bolivia
    expect(etiquetaDia(casiMedianoche, AHORA)).toBe('Hoy');
    expect(etiquetaDia(casiMedianoche, pasadaLaMedianoche)).toBe('Ayer');
    expect(etiquetaDia(Date.UTC(2026, 9, 10, 4, 1), pasadaLaMedianoche)).toBe('Hoy');
    expect(etiquetaDia(Date.UTC(2026, 9, 8, 20, 0), AHORA)).toBe('Ayer');
    expect(etiquetaDia(Date.UTC(2026, 8, 1, 20, 0), AHORA)).toBe('01/09/2026');
  });
});

describe('TAREA 5: tomar, devolver y escribir son una SIMULACIÓN', () => {
  const f = ficha('wa_1', { noLeidos: 3, necesitaHumano: true, ultimoEn: AHORA - 10 * MIN, ultimoEntranteEn: AHORA - 10 * MIN });

  it('tomar pone a la persona; devolver devuelve al asistente', () => {
    const s1 = tomar(SIMULACION_VACIA('s'), 'wa_1', 'Rosa', AHORA);
    expect(conSimulacion(f, s1)).toMatchObject({ responde: 'persona', tomadoPor: 'Rosa' });
    const s2 = devolver(s1, 'wa_1', AHORA);
    expect(conSimulacion(f, s2)).toMatchObject({ responde: 'asistente', tomadoPor: '' });
  });

  it('NEGATIVA: no se puede «enviar» sin haber tomado la conversación, ni un texto vacío', () => {
    const vacia = SIMULACION_VACIA('s');
    expect(enviar(vacia, 'wa_1', 'hola', AHORA)).toBe(vacia);
    const tomada = tomar(vacia, 'wa_1', 'Rosa', AHORA);
    expect(enviar(tomada, 'wa_1', '   ', AHORA)).toBe(tomada);
    expect(enviar(devolver(tomada, 'wa_1', AHORA), 'wa_1', 'hola', AHORA).enviados).toEqual({});
  });

  it('lo enviado queda como mensaje simulado y se ve como último mensaje de la ficha', () => {
    const s = enviar(tomar(SIMULACION_VACIA('s'), 'wa_1', 'Rosa', AHORA), 'wa_1', '  Hola, le habla Rosa  ', AHORA + MIN);
    expect(s.enviados['wa_1']).toEqual([{ id: `sim-${AHORA + MIN}-0`, texto: 'Hola, le habla Rosa', ts: AHORA + MIN }]);
    const g = conSimulacion(f, s);
    expect(g.ultimoMensaje).toBe('Hola, le habla Rosa');
    expect(g.ultimoEn).toBe(AHORA + MIN);
  });

  it('leer deja los no leídos en 0, y un mensaje nuevo del cliente los vuelve a dejar sin leer', () => {
    const leida = marcarLeida(SIMULACION_VACIA('s'), 'wa_1', AHORA);
    expect(conSimulacion(f, leida).noLeidos).toBe(0);
    expect(conSimulacion({ ...f, ultimoEntranteEn: AHORA + MIN }, leida).noLeidos).toBe(3);
    expect(conSimulacion(f, SIMULACION_VACIA('s')).noLeidos).toBe(3);   // sin simulación, lo que dice la base
  });

  it('no modifica lo que recibe (la ficha de la base queda como estaba)', () => {
    const copia = JSON.stringify(f);
    conSimulacion(f, tomar(marcarLeida(SIMULACION_VACIA('s'), 'wa_1', AHORA), 'wa_1', 'Rosa', AHORA));
    expect(JSON.stringify(f)).toBe(copia);
  });

  it('lo guardado en el navegador se descarta si es de otra siembra o si está dañado', () => {
    const guardado = JSON.stringify(tomar(SIMULACION_VACIA('uno'), 'wa_1', 'Rosa', AHORA));
    expect(leerSimulacion(guardado, 'uno').turnos['wa_1']?.responde).toBe('persona');
    expect(leerSimulacion(guardado, 'dos')).toEqual(SIMULACION_VACIA('dos'));
    expect(leerSimulacion('{no es json', 'uno')).toEqual(SIMULACION_VACIA('uno'));
    expect(leerSimulacion('null', 'uno')).toEqual(SIMULACION_VACIA('uno'));
    expect(leerSimulacion(null, 'uno')).toEqual(SIMULACION_VACIA('uno'));
  });
});

describe('NEGATIVA: la pantalla no escribe en la base ni llama a ninguna Function (salvo «No contactar»)', () => {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const RAIZ_ADMIN = join(aqui, '..', '..');
  const leer = (ruta: string) => readFileSync(join(RAIZ_ADMIN, ruta), 'utf8');
  /** El código sin comentarios: lo que de verdad se ejecuta. */
  const sinComentarios = (f: string) => f.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const ARCHIVOS = [
    'web/src/central/paginas/Conversaciones.tsx',
    'web/src/central/componentes/DetalleConversacion.tsx',
    'web/src/central/componentes/ListaConversaciones.tsx',
    'web/src/central/lib/conversaciones.ts',
    'web/src/central/lib/conversacionesSimulacion.ts',
  ];

  it('ninguna escritura que no sea «No contactar», ninguna callable, ningún fetch', () => {
    for (const ruta of ARCHIVOS) {
      const codigo = sinComentarios(leer(ruta));
      for (const prohibido of ['httpsCallable', 'setDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'funciones']) {
        expect(codigo, `${ruta} usa ${prohibido}`).not.toContain(prohibido);
      }
    }
    const escrituras = ARCHIVOS.flatMap((r) => [...sinComentarios(leer(r)).matchAll(/updateDoc\([^;]*;/g)].map((m) => m[0]));
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]).toContain('noContactar');
  });

  it('el texto de los clientes nunca va como HTML', () => {
    for (const ruta of ARCHIVOS) {
      expect(sinComentarios(leer(ruta)), ruta).not.toContain('dangerouslySetInnerHTML');
      expect(sinComentarios(leer(ruta)), ruta).not.toContain('innerHTML');
    }
  });

  it('la siembra solo corre contra emuladores y solo escribe teléfonos con seis ceros', () => {
    const siembra = leer('pruebas/central/prototipo-conversaciones/sembrar.mjs');
    expect(siembra).toContain("startsWith('demo-')");
    expect(siembra).toContain('process.exit(1)');
    expect(siembra).toContain('`591000000${suf}`');
    const telefonos = [...siembra.matchAll(/\b591\d{6,}\b/g)].map((m) => m[0]);
    for (const t of telefonos) expect(t, `número sospechoso en la siembra: ${t}`).toMatch(/0{6}/);
  });
});
