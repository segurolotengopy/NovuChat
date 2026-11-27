/**
 * LA RÁFAGA DE TEXTOS en el flujo de Walisuma (pieza común `Flujos/src/core/rafaga/`, 25/11/2026). Corre el JSON VERSIONADO con el n8n de mentira; el servidor de la ráfaga es un doble
 * que cumple el contrato de `configuracionFlujo` (hasta 5 predecesores, el propio y hasta 3 sucesores, relativo al mensaje pedido). Se prueba NEGANDO.
 *
 * Costo: 0 mensajes agregados; en una ráfaga de n textos quita n-1. Lo que NO se puede resolver sin estado compartido (los riesgos residuales de `docs/arquitectura/rafagas.md`) queda FIJADO acá.
 *
 * Los DESVÍOS de este flujo (dónde puede terminar o responderse un mensaje por otra rama):
 *   ANTES del ancla («Puerta del turno», en línea; solo un texto con la puerta en «sigue» entra a la ráfaga):
 *     comercio suspendido (409), uso extendido («operador»: aviso fijo) y pausa por Tomar («bloqueado»: silencio). Un mensaje desviado ahí NO llega al ancla: si el texto anterior ya calló por él, queda sin respuesta (huérfano).
 *   DESPUÉS del ancla (dentro de «Decidir turno», que lee el texto AGRUPADO): baja, identidad, catálogo web, cómo pagar, factura, derivar (cambio, corporativo, quiere hablar, sin precio, factura), anuncio y anuncio de Meta.
 *   NO ESPERAN (no son un texto): imágenes y comprobantes, audio, ubicación, botones («Confirmar pedido» incluido) y el pedido del catálogo web.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { Doble } from '../../lib/n8n-de-mentira';
import { ANA, BETO, ENTREGA, PRODUCCION, PRUEBA, crear, entrega, mAudio, mImagen, mTexto, modelo, panelOk, valorMeta } from './mundo';

type Fr = { idMeta: string; tipo: string; texto: string; ms: number };
type Mundo = ReturnType<typeof crear>;
const RAFAGA = ['¿Esperar ráfaga?', 'Esperar ráfaga', 'Consultar ráfaga', 'Agrupar ráfaga'];

/** El servidor de `configuracionFlujo` (rama `rafaga`): lo escrito de este teléfono, relativo al mensaje pedido: hasta 5 predecesores, el propio y hasta 3 sucesores. */
const servidor = (hilo: Fr[], pedidos: string[] = []): Doble => (ll) => {
  const id = String(((ll.cuerpo?.['rafaga'] ?? {}) as J)['idMeta']);
  pedidos.push(id);
  const o = [...hilo].sort((a, b) => (a.ms - b.ms) || (a.idMeta < b.idMeta ? -1 : 1));
  const i = o.findIndex((f) => f.idMeta === id);
  return { rafaga: { v: 1, fragmentos: i < 0 ? [] : o.slice(Math.max(0, i - 5), i + 4) } };
};
const cae: Doble = () => { throw new Error('timeout'); };
const t0 = 1_000_000;
const txt = (n: number, texto: string, ms: number): Fr => ({ idMeta: `wamid.R${n}`, tipo: 'text', texto, ms });
const mediaFr = (n: number, tipo: string, ms: number): Fr => ({ idMeta: `wamid.R${n}`, tipo, texto: '', ms });

/** Corre cada mensaje como su propia ejecución (la misma vista del servidor: todo lo escrito ya está en el hilo), en orden. */
const correr = (m: Mundo, mensajes: { n: number; msg: J }[], de = ANA) => mensajes.map((x) => m.turno(entrega(valorMeta(x.msg, de, { wamid: `wamid.R${x.n}` })), { tolerarFallo: true }));
const plan = (t: ReturnType<Mundo['turno']>): J | undefined => (t.salidas['Decidir turno']?.[0]?.[0] as J | undefined)?.['plan'] as J | undefined;
/** El texto del cliente con el que decidió el turno (el agrupado, si la ráfaga agrupó). */
const textoDe = (t: ReturnType<Mundo['turno']>): string | undefined => (t.salidas['Decidir turno']?.[0]?.[0] as J | undefined)?.['textoCliente'] as string | undefined;
const envios =(ts: ReturnType<Mundo['turno']>[]): number => ts.reduce((s, t) => s + t.mensajes.length, 0);
const pide = (m: Mundo, orden: string[]) => orden.filter((n) => m.flujo.nodes.some((x) => x['name'] === n));

describe('el injerto: cuatro nodos, en línea, después del reporte y de la puerta', () => {
  it('los 4 nodos de la ráfaga están en las dos variantes, y solo ellos; +4 sobre el tope anterior de 71', () => {
    for (const f of [PRODUCCION, PRUEBA]) for (const n of RAFAGA) expect(f.nodes.filter((x) => x['name'] === n)).toHaveLength(1);
    expect(PRODUCCION.nodes).toHaveLength(75);
  });
  it('«Puerta del turno» → «¿Esperar ráfaga?» → («Esperar ráfaga» → «Consultar ráfaga» → «Agrupar ráfaga» | directo) → «¿Bajar medio?»', () => {
    const c = PRODUCCION.connections as J;
    const a = (n: string, i = 0): string[] => (c[n].main[i] as J[]).map((x) => x['node']);
    expect(a('Puerta del turno')).toEqual(['¿Esperar ráfaga?']);
    expect(a('¿Esperar ráfaga?', 0)).toEqual(['Esperar ráfaga']);
    expect(a('¿Esperar ráfaga?', 1)).toEqual(['¿Bajar medio?']);
    expect(a('Esperar ráfaga')).toEqual(['Consultar ráfaga']);
    expect(a('Consultar ráfaga')).toEqual(['Agrupar ráfaga']);
    expect(a('Agrupar ráfaga')).toEqual(['¿Bajar medio?']);
  });
  it('NEGADO: nada llega a «¿Bajar medio?» sin pasar por la ráfaga (ni «Puerta del turno» ni otro nodo le dan entrada directa)', () => {
    const c = PRODUCCION.connections as J;
    const entradas = Object.entries(c).filter(([, s]) => (s.main as J[][]).some((o) => (o ?? []).some((x) => x['node'] === '¿Bajar medio?'))).map(([de]) => de).sort();
    expect(entradas).toEqual(['Agrupar ráfaga', '¿Esperar ráfaga?']);
  });
  it('«Reportar mensaje (entrante)» corre ANTES de la ráfaga: por posición (más arriba que ella) y en ejecución', () => {
    const pos = (n: string): number => ((PRODUCCION.nodes.find((x) => x['name'] === n) as J)['position'] as number[])[1] as number;
    for (const n of RAFAGA) expect(pos('Reportar mensaje (entrante)')).toBeLessThan(pos(n));
    const m = crear({ dobles: { 'Consultar ráfaga': servidor([txt(1, 'hola', t0)]) } });
    const t = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    expect(t.orden.indexOf('Reportar mensaje (entrante)')).toBeGreaterThanOrEqual(0);
    expect(t.orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(t.orden.indexOf('¿Esperar ráfaga?'));
  });
  it('la consulta usa la URL y la cabecera de «Traer configuración» (mismo número) y lleva Continue on Fail, 3 s y un reintento', () => {
    const consultar = PRODUCCION.nodes.find((x) => x['name'] === 'Consultar ráfaga') as J;
    const traer = PRODUCCION.nodes.find((x) => x['name'] === 'Traer configuración') as J;
    expect((consultar['parameters'] as J)['url']).toBe((traer['parameters'] as J)['url']);
    expect(consultar['onError']).toBe('continueRegularOutput');
    expect(((consultar['parameters'] as J)['options'] as J)['timeout']).toBe(3000);
    expect(consultar['maxTries']).toBe(2);
  });
});

describe('PUNTA A PUNTA: lo que recibe el MODELO (la llamada a Gemini) en una ráfaga, con los mensajes en orden', () => {
  /** Los turnos del usuario que recibió el modelo en cada llamada (el último es el de ESTE turno). */
  const conModelo = (hilo: Fr[], extra: Partial<Parameters<typeof crear>[0]> = {}) => {
    const vistos: string[][] = [];
    const m = crear({
      dobles: { 'Consultar ráfaga': servidor(hilo) },
      modeloDice: (ll) => { vistos.push(((ll.cuerpo?.['contents'] ?? []) as { role?: string; parts: { text: string }[] }[]).filter((c) => c.role !== 'model').map((c) => c.parts.map((p) => p.text).join(' '))); return modelo('Con gusto.'); },
      ...extra,
    });
    return { m, vistos };
  };
  const ultimoTurnoDelModelo = (vistos: string[][]): string => { const v = vistos[vistos.length - 1] ?? []; return v[v.length - 1] ?? ''; };
  const cuerpoModelo = (t: ReturnType<Mundo['turno']>): string => JSON.stringify((t.salidas['Decidir turno']?.[0]?.[0] as J | undefined)?.['cuerpoModelo'] ?? null).replace(/\\n/g, '\n'); // el JSON escapa el salto de línea: se deshace para mirar el texto tal cual lo ve el modelo

  it('2 textos: el primero CALLA, sale UN envío y el modelo recibe «hola» y «quiero una billetera» EN ORDEN (textoCliente, cuerpoModelo y la llamada real)', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const { m, vistos } = conModelo(hilo);
    const [a, b] = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]) as [ReturnType<Mundo['turno']>, ReturnType<Mundo['turno']>];
    expect(a.mensajes).toHaveLength(0); // 1) el primero calla
    expect(a.orden).not.toContain('Conversar con el modelo');
    expect(envios([a, b])).toBe(1); // 2) UN solo envío
    expect(vistos).toHaveLength(1); // el modelo se llama UNA vez
    expect(textoDe(b)).toBe('hola\nquiero una billetera'); // 3) todos, en orden
    expect(cuerpoModelo(b)).toContain('hola\nquiero una billetera');
    expect(ultimoTurnoDelModelo(vistos)).toContain('hola\nquiero una billetera');
  });
  it('3 textos: el primero y el segundo CALLAN, UN envío y el modelo recibe los tres EN ORDEN', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 600), txt(3, 'de cuero por favor', t0 + 1200)];
    const { m, vistos } = conModelo(hilo);
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }, { n: 3, msg: mTexto('de cuero por favor') }]);
    expect(ts[0]!.mensajes).toHaveLength(0);
    expect(ts[1]!.mensajes).toHaveLength(0);
    expect(envios(ts)).toBe(1);
    expect(vistos).toHaveLength(1);
    expect(textoDe(ts[2]!)).toBe('hola\nquiero una billetera\nde cuero por favor');
    expect(cuerpoModelo(ts[2]!)).toContain('hola\nquiero una billetera\nde cuero por favor');
    expect(ultimoTurnoDelModelo(vistos)).toContain('hola\nquiero una billetera\nde cuero por favor');
  });
  it('NEGADO (tope de 1.500 caracteres): un grupo que lo supera conserva el FINAL (lo más reciente) y descarta el principio, en «Decidir turno» y en lo que ve el modelo', () => {
    const hilo = [txt(1, `INICIO ${'a'.repeat(900)}`, t0), txt(2, `${'b'.repeat(900)} FINAL`, t0 + 800)];
    const { m, vistos } = conModelo(hilo);
    const ts = correr(m, [{ n: 1, msg: mTexto(hilo[0]!.texto) }, { n: 2, msg: mTexto(hilo[1]!.texto) }]);
    const t = textoDe(ts[1]!) as string;
    expect(t.length).toBeLessThanOrEqual(1500);
    expect(t.endsWith('FINAL')).toBe(true);
    expect(t).not.toContain('INICIO');
    expect(ultimoTurnoDelModelo(vistos)).toContain('FINAL');
    expect(ultimoTurnoDelModelo(vistos)).not.toContain('INICIO');
  });
  it('con la consulta caída (falla abierto) el segundo responde SOLO con su texto: el modelo no recibe el primero', () => {
    const { m, vistos } = conModelo([]);
    m.dobles['Consultar ráfaga'] = cae;
    const t = correr(m, [{ n: 2, msg: mTexto('quiero una billetera') }])[0]!;
    expect(t.mensajes).toHaveLength(1);
    expect(textoDe(t)).toBe('quiero una billetera');
    expect(ultimoTurnoDelModelo(vistos)).toContain('quiero una billetera');
    expect(ultimoTurnoDelModelo(vistos)).not.toContain('hola');
  });
  it('con la consulta caída en la ráfaga de 3, el último responde solo y el modelo recibe solo su texto (los otros ya callaron: riesgo declarado)', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 600), txt(3, 'de cuero por favor', t0 + 1200)];
    const { m, vistos } = conModelo(hilo);
    const a = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    m.dobles['Consultar ráfaga'] = cae;
    const c = correr(m, [{ n: 3, msg: mTexto('de cuero por favor') }])[0]!;
    expect(envios(a)).toBe(0);
    expect(c.mensajes).toHaveLength(1);
    expect(textoDe(c)).toBe('de cuero por favor');
    expect(ultimoTurnoDelModelo(vistos)).not.toContain('hola');
  });
  it('NEGADO (dientes): sin la pieza (rafagaActiva false) el modelo recibe SOLO el segundo texto en su llamada y el primero se contesta aparte', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const { m, vistos } = conModelo(hilo, { base: { rafagaActiva: false } });
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    expect(envios(ts)).toBe(2);
    expect(textoDe(ts[1]!)).toBe('quiero una billetera');
    expect(vistos).toHaveLength(2);
  });
});

describe('ráfaga de 2 y de 3 textos: UN solo envío, con todo el texto', () => {
  it('2 textos (hola + quiero una billetera): la primera ejecución calla, la segunda responde UNA vez y el modelo ve los dos', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const [a, b] = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]) as [ReturnType<Mundo['turno']>, ReturnType<Mundo['turno']>];
    expect(a.mensajes).toHaveLength(0);
    expect(a.orden).toContain('Agrupar ráfaga');
    expect(a.orden).not.toContain('Decidir turno');
    expect(b.mensajes).toHaveLength(1);
    expect(textoDe(b)).toBe('hola\nquiero una billetera');
    expect(a.esperas).toHaveLength(1);
    expect(a.esperas[0]!.segundos).toBe(2);
  });
  it('3 textos: UN envío, con los tres textos', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 600), txt(3, 'de cuero por favor', t0 + 1200)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }, { n: 3, msg: mTexto('de cuero por favor') }]);
    expect(envios(ts)).toBe(1);
    expect(ts[0]!.mensajes).toHaveLength(0);
    expect(ts[1]!.mensajes).toHaveLength(0);
    expect(textoDe(ts[2]!)).toBe('hola\nquiero una billetera\nde cuero por favor');
  });
  it('control (la prueba tiene dientes): con `rafagaActiva` en false cada texto responde por su cuenta (2 envíos) y «Esperar ráfaga» no corre', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const m = crear({ base: { rafagaActiva: false }, dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    expect(envios(ts)).toBe(2);
    for (const t of ts) { expect(t.orden).not.toContain('Esperar ráfaga'); expect(t.orden).not.toContain('Consultar ráfaga'); }
  });
  it('el interruptor por comercio (`rafagaApagada`, que el servidor agrega a la configuración) apaga la pieza: el IF da «no»', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    // La respuesta de configuracionFlujo trae la bandera y el nodo común «Config del negocio» (venta-digital) la propaga (#1135): ya no se parchea el código del nodo.
    const apagado = crear({ base: { rafagaActiva: true }, panel: panelOk({ rafagaApagada: true }), dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(apagado, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    expect(envios(ts)).toBe(2);
    for (const t of ts) expect(t.orden).not.toContain('Esperar ráfaga');
  });
});

describe('un mensaje aislado y los fallos de la consulta', () => {
  it('un texto aislado sale IGUAL que hoy (mismo mensaje y mismo plan que con la ráfaga apagada), tras la espera', () => {
    const conRafaga = crear({ dobles: { 'Consultar ráfaga': servidor([txt(1, 'hola, ¿qué tienen?', t0)]) } });
    const sin = crear({ base: { rafagaActiva: false } });
    const a = correr(conRafaga, [{ n: 1, msg: mTexto('hola, ¿qué tienen?') }])[0]!;
    const b = correr(sin, [{ n: 1, msg: mTexto('hola, ¿qué tienen?') }])[0]!;
    expect(a.mensajes.map((x) => x.cuerpo)).toEqual(b.mensajes.map((x) => x.cuerpo));
    expect(a.mensajes).toHaveLength(1);
    expect(plan(a)).toEqual(plan(b));
    expect(a.orden).toContain('Esperar ráfaga');
    expect(b.orden).not.toContain('Esperar ráfaga');
  });
  it('la consulta caída (después del reintento) FALLA ABIERTO: responde solo, no se pierde', () => {
    const m = crear({ dobles: { 'Consultar ráfaga': cae } });
    const t = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(1);
    expect(textoDe(t)).toBe('hola');
  });
  it('una respuesta que no es la de la ráfaga (otro JSON) también responde solo', () => {
    const m = crear({ dobles: { 'Consultar ráfaga': () => ({ ok: true }) } });
    const t = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    expect(t.mensajes).toHaveLength(1);
  });
});

describe('RIESGOS RESIDUALES declarados (docs/arquitectura/rafagas.md): se FIJA lo que pasa', () => {
  it('(a) 7 textos seguidos a menos de 1,5 s: sale UN envío con los 6 últimos; el más viejo queda SIN respuesta (comportamiento declarado)', () => {
    const hilo = [1, 2, 3, 4, 5, 6, 7].map((n) => txt(n, `mensaje ${n}`, t0 + n * 100));
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, hilo.map((f, i) => ({ n: i + 1, msg: mTexto(f.texto) })));
    expect(envios(ts)).toBe(1);
    const t = textoDe(ts[6]!) as string;
    expect(t).toBe('mensaje 2\nmensaje 3\nmensaje 4\nmensaje 5\nmensaje 6\nmensaje 7');
    expect(t).not.toContain('mensaje 1');
  });
  it('(a, control) 6 textos seguidos caben: UN envío con los 6', () => {
    const hilo = [1, 2, 3, 4, 5, 6].map((n) => txt(n, `mensaje ${n}`, t0 + n * 100));
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, hilo.map((f, i) => ({ n: i + 1, msg: mTexto(f.texto) })));
    expect(envios(ts)).toBe(1);
    expect(textoDe(ts[5]!)).toContain('mensaje 1');
  });
  it('(b) la consulta de la ejecución ANTERIOR cae: responde sola y la siguiente la incluye en su grupo: el primer texto se contesta DOS veces (lado seguro, no se pierde)', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    m.dobles['Consultar ráfaga'] = cae;
    const a = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    m.dobles['Consultar ráfaga'] = servidor(hilo);
    const b = correr(m, [{ n: 2, msg: mTexto('quiero una billetera') }])[0]!;
    expect(a.mensajes).toHaveLength(1);
    expect(b.mensajes).toHaveLength(1);
    expect(textoDe(a)).toBe('hola');
    expect(textoDe(b)).toBe('hola\nquiero una billetera');
  });
  it('(b2) la consulta de quien debía responder el grupo cae: responde solo y el texto que la otra calló NO se contesta (costo de fallar abierto)', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const a = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    m.dobles['Consultar ráfaga'] = cae;
    const b = correr(m, [{ n: 2, msg: mTexto('quiero una billetera') }])[0]!;
    expect(a.mensajes).toHaveLength(0);
    expect(textoDe(b)).toBe('quiero una billetera');
    expect(envios([a, b])).toBe(1);
  });
});

describe('(c) DESVÍOS ANTES del ancla: el mensaje desviado no entra a la ráfaga y el anterior queda huérfano (declarado)', () => {
  const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
  /** El primer texto corre con la puerta abierta (espera y calla porque el siguiente es su vecino); el segundo corre con la puerta que se pide. */
  const desviado = (preparar: (m: Mundo) => void) => {
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const a = correr(m, [{ n: 1, msg: mTexto('hola') }])[0]!;
    preparar(m);
    const b = correr(m, [{ n: 2, msg: mTexto('quiero una billetera') }])[0]!;
    return { a, b };
  };
  it('uso extendido («operador»): el segundo responde el aviso fijo SIN esperar; el primero (ya silenciado) queda sin respuesta; el cliente recibe UN mensaje', () => {
    const { a, b } = desviado((m) => { m.dobles['Reportar mensaje (entrante)'] = () => ({ ok: true, atencion: { estado: 'operador' } }); });
    expect(a.mensajes).toHaveLength(0);
    expect(b.orden).not.toContain('Esperar ráfaga');
    expect(b.mensajes).toHaveLength(1);
  });
  it('pausa por Tomar («bloqueado»): nadie responde (la atiende una persona), y el segundo no espera ni consulta', () => {
    const { a, b } = desviado((m) => { m.dobles['Reportar mensaje (entrante)'] = () => ({ ok: true, atencion: { estado: 'bloqueado', avisarRecepcion: '' } }); });
    expect(a.mensajes).toHaveLength(0);
    expect(b.mensajes).toHaveLength(0);
    expect(b.orden).not.toContain('Esperar ráfaga');
  });
  it('comercio no operativo (la consola dice 409): el segundo responde el texto neutro SIN esperar; el primero queda sin respuesta', () => {
    const { a, b } = desviado((m) => { m.dobles['Traer configuración'] = () => ({ statusCode: 409, body: { mensajeCortesia: 'En este momento no podemos atenderle por este medio. Gracias por escribirnos.' } }); });
    expect(a.mensajes).toHaveLength(0);
    expect(b.orden).not.toContain('Esperar ráfaga');
    expect(b.mensajes).toHaveLength(1);
  });
  it('NEGADO: con la puerta cerrada desde el PRIMER texto, ninguno espera ni consulta (no hay huérfano: ambos se desvían igual que hoy)', () => {
    const m = crear({ ingesta: { atencion: { estado: 'operador' } }, dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    for (const t of ts) { expect(t.orden).not.toContain('Esperar ráfaga'); expect(t.orden).not.toContain('Consultar ráfaga'); }
  });
});

describe('(c) DESVÍOS DESPUÉS del ancla: «Decidir turno» decide sobre el texto AGRUPADO (un solo envío, el del desvío)', () => {
  const grupo = (a: string, b: string, op: Parameters<typeof crear>[0] = {}) => {
    const hilo = [txt(1, a, t0), txt(2, b, t0 + 700)];
    const m = crear({ ...op, dobles: { 'Consultar ráfaga': servidor(hilo), ...(op.dobles ?? {}) } });
    const ts = correr(m, [{ n: 1, msg: mTexto(a) }, { n: 2, msg: mTexto(b) }]);
    return { m, ts, ultimo: ts[1]! };
  };
  const CASOS: [string, string, string, string][] = [
    ['identidad', 'hola', '¿eres un bot?', 'identidad'],
    ['cómo pagar', 'hola', '¿aceptan tarjeta?', 'pago_info'],
    ['quiere hablar', 'hola', 'quiero hablar con una persona', 'derivar'],
    ['cambio o devolución', 'hola', 'quiero hacer un cambio', 'derivar'],
    ['el desvío en el PRIMER texto (identidad) y una frase suelta después', '¿eres un bot?', 'bueno', 'identidad'],
  ];
  for (const [nombre, a, b, tipo] of CASOS) {
    it(`${nombre}: UN envío y el plan es «${tipo}»`, () => {
      const { ts, ultimo } = grupo(a, b);
      expect(envios(ts)).toBe(1);
      expect(ts[0]!.mensajes).toHaveLength(0);
      expect(plan(ultimo)?.['tipo']).toBe(tipo);
    });
  }
  it('derivar a recepción: UN aviso a recepción y UN botón, sin duplicar (la ráfaga no repite la derivación)', () => {
    const { ts, ultimo } = grupo('hola', 'quiero hablar con una persona');
    expect(ts.reduce((s, t) => s + t.avisos.length, 0)).toBe(1);
    expect(ultimo.mensajes).toHaveLength(1);
  });
  it('BAJA en el último texto («no me escribas más»): el texto fijo de la baja, sin modelo, y UN envío', () => {
    const { ts, ultimo } = grupo('hola', 'no me escribas más');
    expect(envios(ts)).toBe(1);
    expect(plan(ultimo)?.['tipo']).toBe('baja');
    expect(ultimo.orden).not.toContain('Conversar con el modelo');
  });
  it('BAJA en un texto ANTERIOR (línea por línea sobre el agrupado): «dame de baja» + «gracias» sigue siendo baja, no se pierde', () => {
    const { ts, ultimo } = grupo('dame de baja', 'gracias');
    expect(envios(ts)).toBe(1);
    expect(plan(ultimo)?.['tipo']).toBe('baja');
    expect(ultimo.orden).not.toContain('Conversar con el modelo');
  });
  it('control: sin baja en ninguna línea, la ráfaga sigue a la conversación libre (el modelo)', () => {
    const { ultimo } = grupo('hola', 'quiero una billetera');
    expect(plan(ultimo)?.['tipo']).toBe('modelo');
  });
  it('un solo envío también cuando el modelo responde con un pedido completo: UN QR por ráfaga (no se duplica ni se pierde)', () => {
    const dice = modelo('Listo.', { lineas: [{ id: 'billetera-cuero', cantidad: 1 }], entrega: ENTREGA });
    const { ts } = grupo('quiero una billetera de cuero', 'recojo en tienda, Ana Pérez 71234567', { modeloDice: dice });
    expect(ts.flatMap((t) => t.mensajes).filter((e) => e.tipo === 'image')).toHaveLength(1);
    expect(ts[0]!.mensajes).toHaveLength(0);
  });
});

describe('lo que NO es un texto no espera ni se calla: responde como hoy', () => {
  const comoHoy = (msg: J, op: Parameters<typeof crear>[0] = {}) => {
    const hilo = [txt(1, 'hola', t0), mediaFr(2, 'image', t0 + 500)];
    const a = crear({ ...op, dobles: { 'Consultar ráfaga': servidor(hilo), ...(op.dobles ?? {}) } });
    const b = crear({ ...op, base: { rafagaActiva: false } });
    const ta = correr(a, [{ n: 2, msg }])[0]!;
    const tb = correr(b, [{ n: 2, msg }])[0]!;
    return { ta, tb };
  };
  for (const [nombre, msg] of [['imagen', mImagen()], ['audio', mAudio()], ['ubicación', { type: 'location', location: { latitude: -16.5, longitude: -68.1 } }], ['respuesta de botón', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'otro', title: 'Sí' } } }], ['sticker', { type: 'sticker', sticker: { id: 'st-1' } }]] as [string, J][]) {
    it(`${nombre}: no espera ni consulta, y responde igual que con la ráfaga apagada`, () => {
      const { ta, tb } = comoHoy(msg);
      expect(ta.orden).not.toContain('Esperar ráfaga');
      expect(ta.orden).not.toContain('Consultar ráfaga');
      expect(ta.mensajes.map((x) => x.cuerpo)).toEqual(tb.mensajes.map((x) => x.cuerpo));
    });
  }
  it('texto + imagen seguidos: el texto NO se agrupa con la imagen (la imagen es un separador) y cada uno responde como hoy: 2 envíos', () => {
    const hilo = [txt(1, 'mira esta pieza', t0), mediaFr(2, 'image', t0 + 400)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const [a, b] = [correr(m, [{ n: 1, msg: mTexto('mira esta pieza') }])[0]!, correr(m, [{ n: 2, msg: mImagen() }])[0]!];
    expect(a.mensajes).toHaveLength(1);
    expect(b.mensajes.length).toBeGreaterThanOrEqual(1);
    expect(b.orden).not.toContain('Esperar ráfaga');
  });
  it('el pedido del catálogo web (webhook «Carrito del catálogo») no espera: no es un texto de WhatsApp ni se reporta', () => {
    const m = crear({ panel: panelOk({ catalogo: [{ id: 'billetera-clasica', nombre: 'Billetera clásica', area: 'Accesorios', precio: 450, moneda: 'BOB', activo: true }] }), dobles: { 'Consultar ráfaga': servidor([]) } });
    const cuerpo = { tipo: 'carrito', tenantId: 'walisuma', telefono: ANA, accion: 'responder', pedidoId: 'cat_a1', conversacionId: `wa_${ANA}`, ventanaAbierta: true, items: [{ id: 'billetera-clasica', nombre: 'Billetera clásica', cantidad: 1, subtotal: 450 }], total: 450, moneda: 'Bs', entrega: 'retiro', costoEnvio: 0, direccion: '', nota: '', descartados: [] };
    const t = m.turno({ headers: { 'x-novuchat-numero': '59100000042', 'x-novuchat-timestamp': String(m.ahora()), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` }, body: cuerpo }, { via: 'Carrito del catálogo', tolerarFallo: true });
    expect(t.orden).not.toContain('Esperar ráfaga');
    expect(t.orden).not.toContain('Consultar ráfaga');
  });
  it('NEGADO: dos teléfonos distintos no se mezclan (la consulta pide el teléfono del propio mensaje)', () => {
    const pedidos: string[] = [];
    const m = crear({ dobles: { 'Consultar ráfaga': (ll) => { pedidos.push(String(ll.cuerpo?.['telefono'])); return { rafaga: { v: 1, fragmentos: [] } }; } } });
    correr(m, [{ n: 1, msg: mTexto('hola') }], ANA);
    correr(m, [{ n: 2, msg: mTexto('hola') }], BETO);
    expect(pedidos).toEqual([ANA, BETO]);
  });
});

describe('el reporte del entrante NO cambia', () => {
  it('cada texto de la ráfaga se reporta por separado, con su propio idMeta y su propio texto (ni el agrupado ni el de otro)', () => {
    const hilo = [txt(1, 'hola', t0), txt(2, 'quiero una billetera', t0 + 800)];
    const m = crear({ dobles: { 'Consultar ráfaga': servidor(hilo) } });
    const ts = correr(m, [{ n: 1, msg: mTexto('hola') }, { n: 2, msg: mTexto('quiero una billetera') }]);
    const rep = ts.map((t) => t.registro.filter((r) => r.nodo === 'Reportar mensaje (entrante)').map((r) => r.cuerpo));
    expect(rep[0]).toHaveLength(1);
    expect(rep[1]).toHaveLength(1);
    expect(rep[0]![0]).toMatchObject({ idMeta: 'wamid.R1', texto: 'hola', direccion: 'entrante' });
    expect(rep[1]![0]).toMatchObject({ idMeta: 'wamid.R2', texto: 'quiero una billetera', direccion: 'entrante' });
    expect(pide(m, ['Agrupar ráfaga'])).toHaveLength(1);
  });
});
