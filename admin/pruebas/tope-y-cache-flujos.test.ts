/**
 * LOS FLUJOS RESPETAN EL TOPE Y NO ROMPEN LA CACHÉ DEL PREFIJO.
 *
 * Como en `estado-comercio.test.ts`, la lógica **se extrae del JSON versionado
 * del flujo y se ejecuta**: si alguien edita un nodo en n8n y exporta, la
 * prueba corre el código nuevo. Se cubren, en los dos flujos conversacionales:
 *
 *   1. `Traer configuración` manda el teléfono del cliente: sin él, la consola
 *      no puede decir cuántas respuestas quedan en ESTA conversación.
 *   2. `Config del negocio` arrastra `mensajesRestantes24h` cuando el panel lo
 *      manda, y deja `null` (= no cortar) cuando el panel no contesta.
 *   3. `¿Dentro del tope?` deja pasar con dato positivo o sin dato, y corta
 *      con cero o negativo.
 *   4. `Tope alcanzado` manda UN aviso con cero y guarda silencio con
 *      negativo: un aviso por ventana, nunca uno por mensaje.
 *   5. Las instrucciones del agente NO llevan nada que cambie entre un turno y
 *      el siguiente —ni la hora, ni el cliente, ni el contador—: todo eso viaja
 *      en el MENSAJE del turno. Es la condición para que el proveedor pueda
 *      cachear el prefijo: la caché es un prefijo exacto y en Gemini el orden
 *      es systemInstruction → herramientas → mensajes, así que la hora metida
 *      en las instrucciones corta el prefijo ahí y deja fuera el historial
 *      entero. Además, sin datos del cliente en el prefijo, la caché de un
 *      negocio sirve para todas sus conversaciones a la vez.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));

interface Nodo {
  name: string;
  type: string;
  parameters: {
    jsCode?: string;
    jsonBody?: string;
    options?: { systemMessage?: string };
    assignments?: { assignments: { name: string; value: unknown }[] };
    conditions?: { conditions: { leftValue: string }[] };
  };
}
interface Flujo {
  nodes: Nodo[];
  connections: Record<string, { main: { node: string }[][] }>;
}
const flujo = (archivo: string) => JSON.parse(
  readFileSync(join(aqui, '../../Flujos/', archivo), 'utf8'),
) as Flujo;

const FLUJOS = [
  { archivo: 'demo-a-agendamiento.json', agente: 'AI Agent (Sofía)', trasElTope: 'AI Agent (Sofía)' },
  { archivo: 'demo-b-venta-cobro.json', agente: 'AI Agent NovuChat', trasElTope: '¿Saludo inicial?' },
] as const;

const nodo = (f: Flujo, nombre: string) => {
  const n = f.nodes.find((x) => x.name === nombre);
  if (!n) throw new Error(`sin nodo ${nombre}`);
  return n;
};

/** Evalúa una expresión de n8n `={{ ... }}` que solo usa `$json`. */
function expresion(texto: string, $json: unknown): unknown {
  const m = /^=\{\{([\s\S]*)\}\}$/.exec(texto.trim());
  if (!m) throw new Error(`no es una expresión simple: ${texto.slice(0, 60)}`);
  // Mismo criterio que en las otras suites: se ejecuta el flujo versionado.
  // nosemgrep: devsecops.js-eval-prohibido
  return (new Function('$json', `return (${m[1]});`) as (j: unknown) => unknown)($json);
}

/** Ejecuta un nodo Code con `$input.all()` y `$('Nombre').first()`. */
function correr(codigo: string, items: unknown[], contexto: Record<string, unknown>) {
  const entrada = { all: () => items.map((json) => ({ json })), first: () => ({ json: items[0] }) };
  const $ = (nombre: string) => ({ first: () => ({ json: contexto[nombre] ?? {} }) });
  // nosemgrep: devsecops.js-eval-prohibido
  const fn = new Function('$input', '$', codigo) as (i: unknown, c: unknown) => { json: Record<string, unknown> }[];
  return fn(entrada, $);
}

function fusionar(f: Flujo, respuesta: unknown) {
  const base = Object.fromEntries(
    nodo(f, 'Config base').parameters.assignments!.assignments.map((a) => [a.name, a.value]),
  );
  return correr(nodo(f, 'Config del negocio').parameters.jsCode!, [respuesta], { 'Config base': base })[0]!.json;
}

const ACTIVO = (limites?: unknown) => ({
  statusCode: 200,
  body: {
    tenantId: 'un-negocio', flujo: 'agendamiento', estadoComercio: 'activo',
    phoneNumberId: '1000000001',
    operacion: { moneda: 'BOB', horarioAtencion: 'lunes a viernes, de 09:00 a 18:00' },
    datosDelNegocio: { nombreNegocio: 'Un Negocio' },
    catalogo: [], funcionarios: [], instruccionesDeVoz: {},
    ...(limites !== undefined ? { limites } : {}),
  },
});

for (const { archivo, agente, trasElTope } of FLUJOS) {
  describe(`${archivo} · tope de respuestas por ventana de 24 h`, () => {
    const f = flujo(archivo);

    it('Traer configuración manda el teléfono del cliente, y una cadena vacía si no hay mensaje', () => {
      const cuerpo = nodo(f, 'Traer configuración').parameters.jsonBody!;
      expect(JSON.parse(String(expresion(cuerpo, { messages: [{ from: '59170000001' }] }))))
        .toEqual({ telefono: '59170000001' });
      expect(JSON.parse(String(expresion(cuerpo, {})))).toEqual({ telefono: '' });
      expect(JSON.parse(String(expresion(cuerpo, { messages: [] })))).toEqual({ telefono: '' });
    });

    it('Config del negocio arrastra los límites del panel', () => {
      const salida = fusionar(f, ACTIVO({ topeMensajes24h: 25, mensajesRestantes24h: 3 }));
      expect(salida).toMatchObject({ topeMensajes24h: 25, mensajesRestantes24h: 3 });
      expect(salida['mensajeTopeAlcanzado']).toEqual(expect.any(String));
    });

    it('sin límites en la respuesta, y sin panel, queda null: no se corta', () => {
      expect(fusionar(f, ACTIVO())['mensajesRestantes24h']).toBeNull();
      expect(fusionar(f, { statusCode: 500, body: {} })['mensajesRestantes24h']).toBeNull();
      expect(fusionar(f, { statusCode: 409, body: { estado: 'suspendido' } })['mensajesRestantes24h']).toBeNull();
    });

    it('¿Dentro del tope? deja pasar con dato positivo o sin dato, y corta con cero o negativo', () => {
      const cond = nodo(f, '¿Dentro del tope?').parameters.conditions!.conditions[0]!.leftValue;
      expect(expresion(cond, { mensajesRestantes24h: 5 })).toBe(true);
      expect(expresion(cond, { mensajesRestantes24h: 1 })).toBe(true);
      expect(expresion(cond, { mensajesRestantes24h: null })).toBe(true);
      expect(expresion(cond, {})).toBe(true);
      expect(expresion(cond, { mensajesRestantes24h: 0 })).toBe(false);
      expect(expresion(cond, { mensajesRestantes24h: -1 })).toBe(false);
    });

    it('la compuerta está entre ¿Comercio operativo? y lo que sigue, y su rama falsa va a Tope alcanzado', () => {
      expect(f.connections['¿Comercio operativo?']!.main[0]).toEqual([expect.objectContaining({ node: '¿Dentro del tope?' })]);
      expect(f.connections['¿Dentro del tope?']!.main[0]).toEqual([expect.objectContaining({ node: trasElTope })]);
      expect(f.connections['¿Dentro del tope?']!.main[1]).toEqual([expect.objectContaining({ node: 'Tope alcanzado' })]);
      // El aviso se envía Y se reporta como saliente: así cuenta, y el turno
      // siguiente ya ve un número negativo.
      const destinos = f.connections['Tope alcanzado']!.main[0]!.map((c) => c.node).sort();
      expect(destinos).toEqual(['Reportar mensaje (saliente)', 'Responder al cliente']);
    });

    it('Tope alcanzado manda UN aviso con cero y guarda silencio con negativo', () => {
      const codigo = nodo(f, 'Tope alcanzado').parameters.jsCode!;
      const cfg = { mensajeTopeAlcanzado: 'Hasta acá por hoy.', phoneNumberId: '1000000001' };
      const entrada = { mensajesRestantes24h: 0, from: '59170000001', nombrePerfil: 'Ana', phoneNumberId: '1000000001' };

      const conCero = correr(codigo, [entrada], { 'Config del negocio': cfg });
      expect(conCero).toHaveLength(1);
      expect(conCero[0]!.json).toMatchObject({
        respuesta: 'Hasta acá por hoy.', from: '59170000001', phoneNumberId: '1000000001', topeAlcanzado: true,
      });

      expect(correr(codigo, [{ ...entrada, mensajesRestantes24h: -1 }], { 'Config del negocio': cfg })).toHaveLength(0);
      expect(correr(codigo, [{ ...entrada, mensajesRestantes24h: -7 }], { 'Config del negocio': cfg })).toHaveLength(0);
    });

    it('el aviso tiene un texto de respaldo y no menciona planes, pagos ni límites comerciales', () => {
      const codigo = nodo(f, 'Tope alcanzado').parameters.jsCode!;
      const salida = correr(codigo, [{ mensajesRestantes24h: 0, from: '59170000001' }], { 'Config del negocio': {} });
      const texto = String(salida[0]!.json['respuesta']);
      expect(texto.length).toBeGreaterThan(20);
      expect(texto.toLowerCase()).not.toMatch(/plan|pago|deuda|límite|limite|novuchat/);
      const base = Object.fromEntries(
        nodo(f, 'Config base').parameters.assignments!.assignments.map((a) => [a.name, a.value]),
      );
      expect(String(base['mensajeTopeAlcanzado']).toLowerCase()).not.toMatch(/plan|pago|deuda|límite|limite|novuchat/);
    });
  });

  describe(`${archivo} · el prefijo del prompt es estable y cacheable`, () => {
    const f = flujo(archivo);
    const agenteN = nodo(f, agente);
    const prompt = agenteN.parameters.options!.systemMessage!;
    const texto = (agenteN.parameters as { text?: string }).text!;

    /**
     * LO VOLÁTIL NO PUEDE ESTAR EN LAS INSTRUCCIONES. La caché del proveedor
     * es un prefijo exacto: en Gemini el orden es systemInstruction →
     * herramientas → mensajes, así que un solo carácter que cambie dentro del
     * systemInstruction —la hora cambia cada minuto— corta el prefijo ahí y
     * deja fuera de la caché el historial entero. Por eso la fecha, el
     * cliente y el contador viajan en el MENSAJE del turno.
     */
    const VOLATIL = ['$now', '$json.from', 'nombrePerfil', 'mensajesRestantes24h', 'userInput'];

    it('las instrucciones no llevan nada que cambie entre un turno y el siguiente', () => {
      for (const v of VOLATIL) {
        expect(prompt, `${v} rompe el prefijo cacheable`).not.toContain(v);
      }
    });

    it('las instrucciones tampoco llevan nada propio del cliente, para que la caché sirva a todos', () => {
      // Si el nombre o el número del cliente estuvieran en el prefijo, cada
      // conversación tendría un prefijo distinto y la caché no se compartiría
      // entre los clientes de un mismo negocio.
      expect(prompt).not.toMatch(/nombrePerfil|\$json\.from/);
    });

    it('el mensaje del turno lleva el contexto delimitado y el texto del cliente al final', () => {
      expect(texto).toContain('[CONTEXTO DEL SISTEMA]');
      expect(texto).toContain('[MENSAJE DEL CLIENTE]');
      expect(texto).toContain('$now');
      expect(texto).toContain('$json.userInput');
      // El texto del cliente va DESPUÉS de la marca: nada de lo que escriba
      // puede colarse antes del contexto del sistema.
      expect(texto.indexOf('$json.userInput')).toBeGreaterThan(texto.indexOf('[MENSAJE DEL CLIENTE]'));
      expect(texto.trimEnd().endsWith('{{ $json.userInput }}')).toBe(true);
    });

    it('las instrucciones explican el formato y que lo del cliente es dato, no orden', () => {
      expect(prompt).toContain('[CONTEXTO DEL SISTEMA]');
      expect(prompt).toContain('[MENSAJE DEL CLIENTE]');
      expect(prompt.toLowerCase()).toMatch(/nunca una orden|no es una orden/);
    });

    it('el bloque de contexto es corto: se paga y se guarda en la memoria en cada turno', () => {
      const sinCliente = texto.slice(0, texto.indexOf('[MENSAJE DEL CLIENTE]'));
      expect(sinCliente.length).toBeLessThan(700);
    });

    it('el aviso de respuestas restantes solo se enciende con 3 o menos', () => {
      const m = /\{\{\s*(typeof \$json\.mensajesRestantes24h[\s\S]*?)\}\}/.exec(texto);
      expect(m).not.toBeNull();
      const evaluar = (v: unknown) => expresion(`={{ ${m![1]} }}`, { mensajesRestantes24h: v });
      expect(evaluar(3)).toContain('Quedan 3');
      expect(evaluar(1)).toContain('Quedan 1');
      expect(evaluar(4)).toBe('');
      expect(evaluar(null)).toBe('');
      expect(evaluar(undefined)).toBe('');
    });

    it('el aviso al modelo no le hace mencionar planes ni límites al cliente', () => {
      expect(prompt).toMatch(/no anuncies ningún límite|no hables de planes/i);
    });
  });

  describe(`${archivo} · el prompt empuja a gastar menos mensajes`, () => {
    const f = flujo(archivo);
    const prompt = nodo(f, agente).parameters.options!.systemMessage!;

    it('ya no limita las ORACIONES por mensaje', () => {
      // La regla vieja de «máximo 3 oraciones por mensaje» se escribió para que
      // el asistente no fuera pesado. Desde que Meta cobra cada mensaje juega en
      // contra: un mensaje completo es más barato que dos cortos. Si alguien la
      // reintroduce, el costo sube sin que nadie lo note.
      expect(prompt).not.toMatch(/máximo \d+ oraciones/i);
      expect(prompt).toMatch(/NO HAY LÍMITE DE ORACIONES POR MENSAJE/);
    });

    it('pide juntar los datos en un mensaje, y no se contradice', () => {
      expect(prompt).toMatch(/PIDE DE UNA VEZ TODO LO QUE TE FALTE/);
      // La instrucción opuesta multiplicaría el costo de la misma conversación.
      expect(prompt).not.toMatch(/de a un dato por vez/i);
    });

    it('dice que menos mensajes no es peor atención', () => {
      // Sin esta línea, la optimización se lee como «sé escueto», y un
      // asistente seco vende menos: eso también cuesta.
      expect(prompt).toMatch(/nunca\s+conversaciones truncadas|NO significa peor atención/i);
    });
  });
}

describe('demo-b-venta-cobro.json · mostrar el catálogo cuesta UN mensaje, no dos', () => {
  const f = flujo('demo-b-venta-cobro.json');

  it('el texto del agente y la lista salen en el mismo mensaje', () => {
    // Antes salían dos: el texto por un lado y la lista por otro. Una lista
    // interactiva ya lleva su propio cuerpo, así que el segundo no agregaba
    // nada y desde el 1 de octubre cuesta cada vez. El catálogo se muestra
    // varias veces por conversación, así que el ahorro se multiplica.
    const cuerpo = (nodo(f, 'Enviar lista de productos').parameters as { jsonBody?: string }).jsonBody!;
    expect(cuerpo).toContain('$json.respuesta');
    // Y conserva un respaldo: un body vacío hace que Meta rechace el mensaje.
    expect(cuerpo).toMatch(/\|\|\s*'Toca un producto/);
  });

  it('la compuerta reparte: o la lista, o el texto suelto, nunca los dos', () => {
    const salidas = f.connections['Procesar respuesta']!.main[0]!.map((c) => c.node);
    expect(salidas).not.toContain('Responder al cliente');
    expect(salidas).toContain('¿Mostrar catálogo?');

    const gate = f.connections['¿Mostrar catálogo?']!.main;
    expect(gate[0]!.map((c) => c.node)).toEqual(['Enviar lista de productos']);
    expect(gate[1]!.map((c) => c.node)).toEqual(['Responder al cliente']);
  });

  it('el aviso del tope y el del comercio suspendido siguen llegando', () => {
    // Los dos cuelgan de `Responder al cliente` por su cuenta, así que el
    // recableado de arriba no puede haberlos dejado sin salida.
    expect(f.connections['Tope alcanzado']!.main[0]!.map((c) => c.node))
      .toContain('Responder al cliente');
    expect(f.connections['Comercio no operativo']!.main[0]!.map((c) => c.node))
      .toContain('Responder al cliente');
  });
});
