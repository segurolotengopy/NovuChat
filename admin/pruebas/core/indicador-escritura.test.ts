/**
 * EL INDICADOR DE ESCRITURA («escribiendo…», los tres puntos) — pieza común del núcleo (21/11/2026).
 *
 * `Flujos/src/core/indicador/indicador-escritura.mjs` arma dos nodos (`¿Indicador de escritura activo?` e `Indicador de escritura`) que incluyen los
 * `construir.mjs` de cada flujo con agente y el ensamblador (demos), nunca copiados. La llamada a Meta es
 * `POST /{phoneNumberId}/messages` con `status: read`, `message_id` y `typing_indicator`: no es un mensaje (0 por conversación).
 *
 * Aquí: la forma exacta de los nodos y las NEGATIVAS (cada regla falla nombrando el nodo):
 *   - la credencial es la del envío por Graph, nunca la de ingesta;
 *   - Continue on Fail solo en el nodo HTTP, con tiempo máximo de 3000 ms;
 *   - va DESPUÉS de «¿Atención normal?» y «¿Comercio operativo?», ANTES del modelo, y nunca arriba de «Reportar mensaje (entrante)»;
 *   - es una rama lateral (hoja): nunca devuelve un item al turno;
 *   - el interruptor `indicadorEscritura` de «Config base» lo apaga; en modo de prueba no corre si el envío no es de verdad;
 *   - el ensamblador lo agrega y lo vuelve a agregar canónico (idempotente) a los demos que lo piden.
 * La prueba por flujo (todo flujo con agente lo lleva, los congelados no) está en `nucleo-comun.test.ts`.
 *
 * Hermética: lee solo archivos del repositorio. Las expresiones de n8n se evalúan con `vm.compileFunction` (nunca `new Function`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  ANCLA_REPORTE, NODO_INDICADOR, NODO_INDICADOR_ACTIVO, NODOS_DEL_INDICADOR, TIMEOUT_INDICADOR_MS,
  credencialDeEnvio, esNodoIndicador, hallazgosDelIndicador, injertarIndicador, nodosDelIndicador, quitarIndicador, tieneAgente,
} from '../../../Flujos/src/core/indicador/indicador-escritura.mjs';
import { RAIZ_FLUJOS, ensamblarEnMemoria, leerManifiesto } from '../../scripts/ensamblar-flujo.mjs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Nodo = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Flujo = any;

const leer = (ruta: string): Flujo => JSON.parse(readFileSync(join(RAIZ_FLUJOS, ruta), 'utf8'));
const ANTONIO = 'clientes/rroca-antonio/rroca-antonio.json';
const QTACO = 'clientes/venta-minima/venta-minima.qtaco.json';
const DEMO_A = 'demo-a-agendamiento.json';
const DEMO_B = 'demo-b-venta-cobro.json';
/** Un flujo de cada forma: sin agente de n8n con `¿Conversar con el modelo?`, con `¿Comercio operativo?` y `¿Extraer?`, y los dos demos con agente. */
const FORMAS = [ANTONIO, QTACO, DEMO_A, DEMO_B, 'clientes/novuchat/chat-novuchat.novuchat.json', 'clientes/agenda-minima/agenda-minima.v0.json'];
const copia = (ruta: string): Flujo => structuredClone(leer(ruta));
const nodo = (f: Flujo, nombre: string): Nodo => f.nodes.find((n: Nodo) => n.name === nombre);
const y = (f: Flujo, nombre: string): number => nodo(f, nombre).position[1];

describe('indicador de escritura: la forma de los dos nodos', () => {
  for (const ruta of FORMAS) {
    it(`${ruta}: lleva los dos nodos canónicos y ninguna guardia lo objeta`, () => {
      const f = leer(ruta);
      expect(tieneAgente(f)).toBe(true);
      expect(NODOS_DEL_INDICADOR.every((n) => nodo(f, n))).toBe(true);
      expect(hallazgosDelIndicador(f)).toEqual([]);
    });
  }

  it('la llamada es la de la documentación de Meta: POST /messages con status read, message_id del entrante normalizado y typing_indicator text', () => {
    const f = leer(ANTONIO);
    const h = nodo(f, NODO_INDICADOR);
    expect(h.type).toBe('n8n-nodes-base.httpRequest');
    expect(h.parameters.method).toBe('POST');
    expect(h.parameters.url).toMatch(/^=https:\/\/graph\.facebook\.com\/\{\{ \(\/\^v\\d\+\\\.\\d\$\/\.test\(String\(\$\('Config del negocio'\)\.first\(\)\.json\.waGraphVersion\)\)/);
    expect(h.parameters.url).toContain("'v26.0'");
    expect(h.parameters.url.endsWith('/messages')).toBe(true);
    expect(h.parameters.jsonBody).toContain("messaging_product: 'whatsapp', status: 'read', message_id: String($('Normalizar entrada').first().json.mensajeId), typing_indicator: { type: 'text' }");
    expect(h.parameters.options.timeout).toBe(TIMEOUT_INDICADOR_MS);
    expect(TIMEOUT_INDICADOR_MS).toBe(3000);
  });

  it('con «Interpretar entrada» (chat, Q\'Taco, Agenda mínima) el message_id sale de ese nodo; con el agente de n8n (demos), la credencial es whatsAppApi', () => {
    expect(nodo(leer(QTACO), NODO_INDICADOR).parameters.jsonBody).toContain("$('Interpretar entrada').first().json.mensajeId");
    const a = nodo(leer(DEMO_A), NODO_INDICADOR);
    expect(a.parameters.authentication).toBe('predefinedCredentialType');
    expect(a.parameters.nodeCredentialType).toBe('whatsAppApi');
    expect(Object.keys(a.credentials)).toEqual(['whatsAppApi']);
  });

  it('Continue on Fail solo en el nodo HTTP del indicador (el IF y el resto de los nodos de Meta que no son de envío conservan su regla)', () => {
    const f = leer(ANTONIO);
    expect(nodo(f, NODO_INDICADOR).onError).toBe('continueRegularOutput');
    expect(nodo(f, NODO_INDICADOR_ACTIVO).onError).toBeUndefined();
    // La entrada verificada del receptor sigue SIN Continue on Fail ni onError.
    for (const n of ['Verificar firma con el receptor', '¿Firma válida?', 'Descartar repetidos']) expect(nodo(f, n)?.onError, n).toBeUndefined();
  });

  it('es una rama lateral: el IF cuelga del ancla junto al modelo, el HTTP es una hoja y el ancla lo lista PRIMERO', () => {
    const f = leer(ANTONIO);
    expect(f.connections['¿Conversar con el modelo?'].main[0].map((x: Nodo) => x.node)).toEqual([NODO_INDICADOR_ACTIVO, 'Conversar con el modelo']);
    expect(f.connections[NODO_INDICADOR_ACTIVO].main).toEqual([[{ node: NODO_INDICADOR, type: 'main', index: 0 }]]);
    expect(f.connections[NODO_INDICADOR]).toBeUndefined();
  });

  it('cero mensajes por conversación: el nodo no es un envío (esNodoIndicador) y un envío de verdad con ese nombre no lo es', () => {
    const f = leer(ANTONIO);
    expect(esNodoIndicador(nodo(f, NODO_INDICADOR))).toBe(true);
    const envio = structuredClone(nodo(f, NODO_INDICADOR));
    envio.parameters.jsonBody = "={{ JSON.stringify({ messaging_product: 'whatsapp', to: '5917', type: 'text', text: { body: 'hola' }, status: 'read', typing_indicator: { type: 'text' } }) }}";
    expect(esNodoIndicador(envio)).toBe(false);
    envio.parameters.jsonBody = "={{ JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: 'x' }) }}";
    expect(esNodoIndicador(envio)).toBe(false);
    expect(esNodoIndicador({ ...nodo(f, NODO_INDICADOR), name: 'Enviar a WhatsApp' })).toBe(false);
  });
});

describe('indicador de escritura: la credencial es la del envío por Graph, nunca la de ingesta (NEGATIVAS)', () => {
  it('es la MISMA del nodo que envía la respuesta en ese flujo', () => {
    for (const ruta of FORMAS.filter((r) => !r.startsWith('demo'))) {
      const f = leer(ruta);
      expect(nodo(f, NODO_INDICADOR).credentials, ruta).toEqual(nodo(f, 'Enviar a WhatsApp').credentials);
      expect(credencialDeEnvio(f)).toEqual({ tipo: 'httpHeaderAuth', nombre: nodo(f, 'Enviar a WhatsApp').credentials.httpHeaderAuth.name });
    }
  });

  it('con la credencial de «Reportar mensaje (entrante)» (ingesta) la guardia falla', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR).credentials = structuredClone(nodo(f, ANCLA_REPORTE).credentials);
    const h = hallazgosDelIndicador(f).join('\n');
    expect(h).toContain('usa la credencial de ingesta');
  });

  it('una credencial cuyo nombre dice «ingesta» falla aunque el reporte use otra', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR).credentials = { httpHeaderAuth: { id: '', name: 'NovuChat ingesta (otra)' } };
    expect(hallazgosDelIndicador(f).join('\n')).toContain('usa la credencial de ingesta');
  });

  it('una credencial que no es la del envío falla (por ejemplo la de otro negocio)', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR).credentials = { httpHeaderAuth: { id: '', name: 'Graph WhatsApp Otro (Bearer)' } };
    expect(hallazgosDelIndicador(f).join('\n')).toContain('no usa la credencial con la que el flujo envía');
  });

  it('en los demos la credencial es la de los nodos de envío por Graph (whatsAppApi), distinta del reporte', () => {
    const f = copia(DEMO_A);
    nodo(f, NODO_INDICADOR).credentials = structuredClone(nodo(f, ANCLA_REPORTE).credentials);
    expect(hallazgosDelIndicador(f).join('\n')).toMatch(/credencial/);
  });

  it('armar el nodo con una credencial de ingesta, sin tipo o sin nombre lanza', () => {
    expect(() => nodosDelIndicador({ credencial: { tipo: 'httpHeaderAuth', nombre: 'NovuChat ingesta (X)' } })).toThrow(/ingesta/);
    expect(() => nodosDelIndicador({ credencial: { tipo: 'otro' as never, nombre: 'x' } })).toThrow(/tipo/);
    expect(() => nodosDelIndicador({ credencial: undefined as never })).toThrow(/tipo/);
    expect(() => nodosDelIndicador({ credencial: { tipo: 'httpHeaderAuth', nombre: undefined as never } })).toThrow(/nombre/);
  });

  it('injertar en un flujo cuyo envío usa la credencial de ingesta lanza', () => {
    const f = copia(ANTONIO);
    quitarIndicador(f);
    nodo(f, 'Enviar a WhatsApp').credentials = structuredClone(nodo(f, ANCLA_REPORTE).credentials);
    expect(() => injertarIndicador(f, { ancla: { nodo: '¿Conversar con el modelo?' } })).toThrow(/ingesta/);
  });
});

describe('indicador de escritura: Continue on Fail solo en el HTTP y tiempo máximo de 3000 ms (NEGATIVAS)', () => {
  it('sin Continue on Fail en el HTTP: falla', () => {
    const f = copia(ANTONIO);
    delete nodo(f, NODO_INDICADOR).onError;
    expect(hallazgosDelIndicador(f).join('\n')).toContain('tiene que llevar Continue on Fail');
  });

  it('con un tiempo máximo mayor a 3000 ms: falla; con 3000 pasa', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR).parameters.options.timeout = 15000;
    expect(hallazgosDelIndicador(f).join('\n')).toContain('tiempo máximo de 3000 ms');
    nodo(f, NODO_INDICADOR).parameters.options.timeout = 3000;
    expect(hallazgosDelIndicador(f)).toEqual([]);
  });

  it('sin tiempo máximo: falla', () => {
    const f = copia(ANTONIO);
    delete nodo(f, NODO_INDICADOR).parameters.options.timeout;
    expect(hallazgosDelIndicador(f).join('\n')).toContain('tiempo máximo');
  });

  it('Continue on Fail en el IF: falla (es solo del nodo HTTP)', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR_ACTIVO).onError = 'continueRegularOutput';
    expect(hallazgosDelIndicador(f).join('\n')).toContain('no lleva Continue on Fail');
  });

  it('con reintentos, versión fija o una URL de otro anfitrión: el nodo ya no es el común', () => {
    for (const cambio of [(n: Nodo) => { n.retryOnFail = true; }, (n: Nodo) => { n.parameters.url = n.parameters.url.replace('graph.facebook.com', 'otro.example'); }, (n: Nodo) => { n.parameters.url = n.parameters.url.replace("'v26.0'", "'v1.0'"); }]) {
      const f = copia(ANTONIO);
      cambio(nodo(f, NODO_INDICADOR));
      expect(hallazgosDelIndicador(f).join('\n')).toContain('no es el nodo común');
    }
  });
});

describe('indicador de escritura: ubicación (NEGATIVAS)', () => {
  it('ubicado ANTES de «¿Comercio operativo?» (colgado del normalizador, junto a la puerta): falla', () => {
    const f = copia(QTACO);
    quitarIndicador(f);
    // El mismo par de nodos, pero colgado de «Interpretar entrada» (de donde cuelga «¿Comercio operativo?» por el reporte), no de «¿Extraer?».
    const [si, http] = nodosDelIndicador({ credencial: credencialDeEnvio(f)!, normalizador: 'Interpretar entrada', posicion: [5000, 160] });
    f.nodes.push(si, http);
    f.connections['Interpretar entrada'].main[0].unshift({ node: NODO_INDICADOR_ACTIVO, type: 'main', index: 0 });
    f.connections[NODO_INDICADOR_ACTIVO] = { main: [[{ node: NODO_INDICADOR, type: 'main', index: 0 }]] };
    const h = hallazgosDelIndicador(f).join('\n');
    expect(h).toContain('DESPUÉS de «¿Comercio operativo?»');
  });

  it('colgado de la salida «no» de «¿Atención normal?» (el mensaje que se descarta o pasa a una persona): falla', () => {
    const f = copia(DEMO_A);
    const m = f.connections['¿Atención normal?'].main;
    const enlace = m[0].shift();
    m[1].unshift(enlace);
    expect(hallazgosDelIndicador(f).join('\n')).toContain('DESPUÉS de «¿Atención normal?»');
  });

  it('arriba de «Reportar mensaje (entrante)» en el lienzo: falla (el reporte del entrante corre primero)', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR_ACTIVO).position[1] = y(f, ANCLA_REPORTE) - 40;
    nodo(f, NODO_INDICADOR).position[1] = y(f, ANCLA_REPORTE) - 40;
    const h = hallazgosDelIndicador(f).join('\n');
    expect(h).toContain(`no puede ir arriba de «${ANCLA_REPORTE}»`);
  });

  it('abajo del modelo en el lienzo (correría después de él): falla', () => {
    const f = copia(ANTONIO);
    nodo(f, NODO_INDICADOR_ACTIVO).position[1] = y(f, 'Conversar con el modelo') + 40;
    expect(hallazgosDelIndicador(f).join('\n')).toContain('MÁS ARRIBA que «Conversar con el modelo»');
  });

  it('devolviendo algo al turno (el HTTP con una salida) o con el «no» conectado: falla', () => {
    const f = copia(ANTONIO);
    f.connections[NODO_INDICADOR] = { main: [[{ node: 'Conversar con el modelo', type: 'main', index: 0 }]] };
    expect(hallazgosDelIndicador(f).join('\n')).toContain('es una hoja');
    const g = copia(ANTONIO);
    g.connections[NODO_INDICADOR_ACTIVO].main[1] = [{ node: 'Conversar con el modelo', type: 'main', index: 0 }];
    expect(hallazgosDelIndicador(g).join('\n')).toContain('(no) no se conecta a nada');
  });

  it('el modelo colgado de otro punto que el indicador: falla', () => {
    const f = copia(ANTONIO);
    const m = f.connections['¿Conversar con el modelo?'].main;
    m[0] = m[0].filter((x: Nodo) => x.node !== 'Conversar con el modelo');
    f.connections['Decidir turno'].main[0].push({ node: 'Conversar con el modelo', type: 'main', index: 0 });
    expect(hallazgosDelIndicador(f).join('\n')).toMatch(/no cuelga del mismo punto|Conversar con el modelo/);
  });

  it('un flujo con agente sin los nodos: falla nombrándolos; sin agente no aplica', () => {
    const f = copia(ANTONIO);
    quitarIndicador(f);
    expect(hallazgosDelIndicador(f)).toEqual([`indicador: falta el nodo «${NODO_INDICADOR_ACTIVO}»`, `indicador: falta el nodo «${NODO_INDICADOR}»`]);
    const sin = leer('clientes/qtaco-redireccion/qtaco-redireccion.qtaco.json');
    expect(tieneAgente(sin)).toBe(false);
    expect(hallazgosDelIndicador(sin)).toEqual([]);
    expect(hallazgosDelIndicador(sin, { exigir: true }).length).toBeGreaterThan(0);
  });

  it('el hermano del ancla con el mismo y o más arriba que el reporte: injertar se niega a armar (no se fuerza)', () => {
    const f = copia(ANTONIO);
    quitarIndicador(f);
    nodo(f, 'Conversar con el modelo').position[1] = y(f, ANCLA_REPORTE) + 10;
    expect(() => injertarIndicador(f, { ancla: { nodo: '¿Conversar con el modelo?' } })).toThrow(/no hay lugar en el lienzo/);
  });
});

describe('indicador de escritura: injertar y quitar', () => {
  it('quitar + injertar devuelve exactamente lo mismo (idempotente) y no deja conexiones sueltas', () => {
    for (const ruta of FORMAS) {
      const f = copia(ruta);
      const ancla = [...NODOS_DEL_INDICADOR].map((n) => Object.entries(f.connections).find(([, c]) => (c as Nodo).main?.some((l: Nodo[]) => l.some((e) => e.node === n)))![0])[0]!;
      const salida = (f.connections[ancla] as Nodo).main.findIndex((l: Nodo[]) => l.some((e) => e.node === NODO_INDICADOR_ACTIVO));
      // El orden de `nodes` y de las claves de `connections` no es parte del contrato (los constructores injertan en otro momento): se compara canónico.
      const canonico = (x: Flujo): string => JSON.stringify({ n: [...x.nodes].sort((a: Nodo, b: Nodo) => a.name.localeCompare(b.name)), c: Object.fromEntries(Object.entries(x.connections).sort(([a], [b]) => a.localeCompare(b))) });
      const antes = canonico(f);
      quitarIndicador(f);
      expect(JSON.stringify(f), ruta).not.toContain('Indicador de escritura');
      injertarIndicador(f, { ancla: { nodo: ancla, salida } });
      expect(canonico(f), ruta).toBe(antes);
    }
  });

  it('injertar dos veces, sin ancla, sin reporte o sin Config base lanza', () => {
    const f = copia(ANTONIO);
    expect(() => injertarIndicador(f, { ancla: { nodo: '¿Conversar con el modelo?' } })).toThrow(/ya tiene/);
    quitarIndicador(f);
    expect(() => injertarIndicador(copia(ANTONIO), { ancla: { nodo: 'No existe' } })).toThrow(/no tiene «No existe»/);
    const sinConfig = copia(ANTONIO);
    quitarIndicador(sinConfig);
    sinConfig.nodes = sinConfig.nodes.filter((n: Nodo) => n.name !== 'Config base');
    expect(() => injertarIndicador(sinConfig, { ancla: { nodo: '¿Conversar con el modelo?' } })).toThrow(/Config base/);
    const sinReporte = copia(ANTONIO);
    quitarIndicador(sinReporte);
    sinReporte.nodes = sinReporte.nodes.filter((n: Nodo) => n.name !== ANCLA_REPORTE);
    expect(() => injertarIndicador(sinReporte, { ancla: { nodo: '¿Conversar con el modelo?' } })).toThrow(/Reportar mensaje/);
  });
});

describe('indicador de escritura: el interruptor por tenant y el modo de prueba (las expresiones, evaluadas)', () => {
  const evaluar = (expresion: string, contexto: Record<string, unknown>): unknown => {
    const cuerpo = expresion.replace(/^=\{\{/, '').replace(/\}\}$/, '').trim();
    const d = (obj: unknown) => ({ first: () => ({ json: obj }) });
    const $ = (nombre: string) => d(contexto[nombre]);
    return vm.compileFunction(`return (${cuerpo});`, ['$', 'JSON', 'String'])($, JSON, String);
  };
  const condicion = (f: Flujo): string => nodo(f, NODO_INDICADOR_ACTIVO).parameters.conditions.conditions[0].leftValue;
  const base = { 'Config base': {}, 'Config del negocio': { waGraphVersion: 'v26.0', modoPrueba: false }, 'Normalizar entrada': { mensajeId: 'wamid.X', phoneNumberId: '123456789' } };

  it('por defecto (sin la clave) corre; `indicadorEscritura: false` lo apaga y `true` lo deja', () => {
    const c = condicion(leer(ANTONIO));
    expect(evaluar(c, base)).toBe(true);
    expect(evaluar(c, { ...base, 'Config base': { indicadorEscritura: true } })).toBe(true);
    expect(evaluar(c, { ...base, 'Config base': { indicadorEscritura: false } })).toBe(false);
    expect(evaluar(c, { ...base, 'Config base': { indicadorEscritura: 'false' } })).toBe(false);
  });

  it('sin id de mensaje no corre (no hay a qué marcar)', () => {
    expect(evaluar(condicion(leer(ANTONIO)), { ...base, 'Normalizar entrada': { phoneNumberId: '1' } })).toBe(false);
  });

  it('en modo de prueba solo corre si el envío es de verdad (como «¿Enviar de verdad?»)', () => {
    const c = condicion(leer(ANTONIO));
    const prueba = (extra: Record<string, unknown>) => ({ ...base, 'Config del negocio': { waGraphVersion: 'v26.0', modoPrueba: true, ...extra } });
    expect(evaluar(c, prueba({}))).toBe(false);
    expect(evaluar(c, prueba({ enviarDeVerdad: true }))).toBe(false);
    expect(evaluar(c, prueba({ enviarDeVerdad: true, telefonoDePrueba: '5910000' }))).toBe(true);
  });

  it('la URL usa waGraphVersion de Config (v26.0 si falta o es inválida) y solo dígitos del número; el cuerpo es el de Meta', () => {
    const h = nodo(leer(ANTONIO), NODO_INDICADOR);
    const ctx = (v: unknown) => ({ ...base, 'Config del negocio': { waGraphVersion: v } });
    // La URL es texto con dos expresiones `{{ … }}`: se evalúa cada una.
    const url = (v: unknown): string => String(h.parameters.url).replace(/^=/, '').replace(/\{\{([\s\S]+?)\}\}/g, (_: string, e: string) => String(evaluar(`={{${e}}}`, ctx(v))));
    expect(url('v27.1')).toBe('https://graph.facebook.com/v27.1/123456789/messages');
    expect(url(undefined)).toBe('https://graph.facebook.com/v26.0/123456789/messages');
    expect(url('../../x')).toBe('https://graph.facebook.com/v26.0/123456789/messages');
    expect(JSON.parse(evaluar(h.parameters.jsonBody, base) as string)).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X', typing_indicator: { type: 'text' } });
  });
});

describe('indicador de escritura: el ensamblador lo agrega a los demos que lo piden', () => {
  for (const archivo of [DEMO_A, DEMO_B]) {
    it(`${archivo}: el manifiesto lo declara y ensamblar reproduce el JSON byte a byte`, () => {
      const m = leerManifiesto(archivo) as { indicador?: { ancla: { nodo: string; salida: number } } };
      expect(m.indicador?.ancla).toEqual({ nodo: '¿Atención normal?', salida: 0 });
      const e = ensamblarEnMemoria(archivo);
      expect(e.indicador).toBe(true);
      expect(Buffer.from(e.texto, 'utf8').equals(readFileSync(join(RAIZ_FLUJOS, archivo)))).toBe(true);
    });
  }

  it('un indicador alterado a mano en el JSON no pasa: el ensamblador lo vuelve a poner canónico', () => {
    const e = ensamblarEnMemoria(DEMO_A);
    const alterado = JSON.parse(e.texto) as Flujo;
    nodo(alterado, NODO_INDICADOR).parameters.options.timeout = 60000;
    expect(hallazgosDelIndicador(alterado).length).toBeGreaterThan(0);
    quitarIndicador(alterado);
    injertarIndicador(alterado, { ancla: { nodo: '¿Atención normal?', salida: 0 }, normalizador: 'Normalizar entrada' });
    expect(JSON.stringify(alterado, null, 2) + '\n').toBe(e.texto);
  });
});
