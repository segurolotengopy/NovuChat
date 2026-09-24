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
import {
  type Flujo, configBase, correr, expresion, leerFlujo as flujo, nodo,
} from './lib/flujo.ts';

const FLUJOS = [
  { archivo: 'demo-a-agendamiento.json', agente: 'AI Agent (Sofía)', trasElTope: 'AI Agent (Sofía)' },
  { archivo: 'demo-b-venta-cobro.json', agente: 'AI Agent NovuChat', trasElTope: '¿Saludo inicial?' },
  // Reservas de Clínica Platinum: el Demo A con una sección más en el prompt
  // (`instruccionesExtra`), que es texto del negocio y no cambia entre turnos.
  { archivo: 'platinum-agendamiento.json', agente: 'AI Agent (Sofía)', trasElTope: 'AI Agent (Sofía)' },
  // Reservas del Dr. Bellido: mismo prompt, con `instruccionesExtra` y el bloque
  // conversacional, los dos texto fijo del negocio entre turnos.
  { archivo: 'bellido-agendamiento.json', agente: 'AI Agent (Sofía)', trasElTope: 'AI Agent (Sofía)' },
] as const;

function fusionar(f: Flujo, respuesta: unknown) {
  return correr(nodo(f, 'Config del negocio').parameters.jsCode!, [respuesta as Record<string, unknown>],
    { 'Config base': configBase(f) })[0]!.json;
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

    // EL TOPE NO SE ESQUIVA MOVIENDO EL TEXTO DE LADO (2026-09-23). La prueba
    // de arriba mide la PLANTILLA, que es un proxy: el dia que una linea larga
    // del turno se convierte en `{{ $json.algo }}` y el texto se arma en un
    // nodo Code, la plantilla se achica y lo que el modelo lee cada turno no.
    // Paso con `diasProximos` —el calendario que evita que el modelo calcule el
    // dia de la semana— y en vez de dejarlo pasar se mide tambien lo que se
    // interpola. Si hace falta mas texto por turno, que sea una decision, no un
    // efecto de haberlo mudado de archivo.
    it('lo que se INTERPOLA en el turno tampoco crece sin que se note', () => {
      const cfg = fusionar(f, { statusCode: 200, body: { tenantId: 'x' } }) as Record<string, unknown>;
      const interpolado = ['diasProximos', 'contextoTurno']
        .map((k) => String(cfg[k] ?? '')).join('');
      expect(interpolado.length, interpolado).toBeLessThan(260);
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

/**
 * EL REINTENTO TRAS UN CRUCE (17/09/2026, ejecución #2867 de Platinum) es un
 * segundo agente en los flujos de agendamiento, y juega con las mismas reglas:
 * instrucciones estáticas —cacheables y compartidas por todas las
 * conversaciones del negocio— y lo volátil en el mensaje del turno. Agrega
 * UNA llamada al modelo (el 6 % del costo) y CERO mensajes de WhatsApp: el
 * cliente recibe un solo mensaje, con alternativas en vez de un texto fijo.
 */
for (const { archivo } of FLUJOS.filter((x) => x.archivo !== 'demo-b-venta-cobro.json')) {
  describe(`${archivo} · el reintento tras cruce también es cacheable`, () => {
    const f = flujo(archivo);
    const n = nodo(f, 'Reintento tras cruce');
    const prompt = n.parameters.options!.systemMessage!;
    const texto = (n.parameters as { text?: string }).text!;

    it('las instrucciones no llevan nada volátil ni propio del cliente', () => {
      for (const v of ['$now', '$json.from', 'nombrePerfil', 'mensajesRestantes24h', 'userInput', 'notaCruce']) {
        expect(prompt, `${v} rompe el prefijo cacheable`).not.toContain(v);
      }
    });

    it('el mensaje del turno lleva la hora, el aviso del cruce y el texto del cliente al final', () => {
      expect(texto).toContain('[CONTEXTO DEL SISTEMA]');
      expect(texto).toContain('$now');
      expect(texto).toContain('[AVISO DEL SISTEMA]');
      expect(texto).toContain('notaCruce');
      expect(texto.trimEnd().endsWith("{{ $('Retomar respuesta').first().json.userInput }}")).toBe(true);
    });

    it('pide UN solo mensaje con hasta 3 alternativas: cero mensajes agregados por conversación', () => {
      expect(prompt).toContain('TODO EN UN SOLO MENSAJE');
      expect(prompt).toContain('HASTA 3 horas');
      expect(prompt).not.toMatch(/(envía|manda|agrega)[^.]{0,40}(otro|un segundo|nuevo) mensaje/i);
    });
  });
}

/*
 * ACÁ HABÍA TRES PRUEBAS, «mostrar el catálogo cuesta UN mensaje, no dos», que
 * comprobaban que la lista tocable de WhatsApp saliera junto al texto del
 * agente y no en un mensaje aparte.
 *
 * SE BORRAN PORQUE LA LISTA YA NO EXISTE. Andres la mandó quitar el 08/09
 * («solamente texto»), y el Demo B pasó de 26 nodos a 22. El ahorro que
 * buscaban esas pruebas —no gastar dos mensajes en mostrar el catálogo— hoy es
 * automático: el catálogo lo enumera el asistente dentro de su propia
 * respuesta, que es un solo mensaje y ya está cubierto por la regla de la
 * economía de la conversación.
 *
 * Una prueba que describe una función retirada no protege nada: solo obliga a
 * mantener viva la función para que la prueba pase.
 */

describe('demo-b-venta-cobro.json · a nadie se le avisa de su propio mensaje', () => {
  const f = flujo('demo-b-venta-cobro.json');

  /**
   * EL AVISO AL DUEÑO REPETÍA EL MENSAJE QUE EL CLIENTE ACABABA DE RECIBIR.
   *
   * En un comercio real el número del dueño y el del cliente son distintos y no
   * pasa nada. En las demostraciones son EL MISMO —Andres prueba desde su
   * teléfono, que también figura como dueño— así que recibía la respuesta del
   * asistente y, un segundo después, un aviso que empezaba con «Resumen enviado
   * al cliente:» y copiaba el texto entero. Se veía como si el asistente
   * contestara dos veces. Lo reportó el 08/09 probando el Demo B.
   *
   * Y ADEMÁS CUESTA: desde el 01/10/2026 Meta cobra cada mensaje que envía el
   * asistente. Un aviso duplicado es un mensaje pagado que no le dice nada
   * nuevo a nadie.
   */
  it('el aviso al dueño no sale si el dueño es quien escribió', () => {
    const gate = nodo(f, '¿Pedido confirmado?');
    const cs = (gate.parameters as { conditions?: { conditions?: Array<Record<string, unknown>> } })
      .conditions?.conditions ?? [];
    const guarda = cs.find((c) => String(c['leftValue']).includes('numeroDueno'));
    expect(guarda, 'falta la guarda contra el autoaviso').toBeDefined();
    expect(String(guarda!['rightValue'])).toContain('$json.from');
    expect((guarda!['operator'] as { operation?: string }).operation).toBe('notEquals');
  });
});
