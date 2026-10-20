/**
 * «COMPROBANTES MALOS Y EN PDF» del flujo de Rubén (tenant rroca-ruben), de punta a punta y sin red.
 *
 * Caja negra sobre el JSON versionado de producción, corrido con el n8n de mentira (`mundo.ts`, el mismo de `venta.test.ts`). Cubre los casos 1 a 14 del guion de ensayo
 * del 20/10/2026, PARA IMAGEN Y PARA PDF: válido, monto distinto, aproximado, ilegible o escaneado, PDF de varias páginas, tercer inválido, tardío, duplicado, sin cobro pendiente,
 * archivo grande y PDF entre 5 y 10 MB.
 *
 * ESTA SUITE ESCRIBE NEGANDO. Lo que niega, en cada caso y sin ningún `if` que pueda no correr:
 *   - el texto al cliente es EXACTAMENTE el de `rrTextoComprobante` del caso; nunca «acreditado», «verificado», «recibimos tu pago», «ya te lo enviamos» ni un enlace;
 *   - `Guardar comprobante` corre ANTES de la lectura y del cotejo, y lleva el archivo (binario `data`) con el teléfono y el id del mensaje;
 *   - el aviso a Rubén sale SOLO en cuadra, aproximado, tardío, tercer inválido y sin cotejar; NUNCA en el primer inválido ni en el ilegible;
 *   - una lectura dudosa (ilegible, varias hojas con datos distintos) llega al servidor como NO legible: el flujo nunca inventa un comprobante;
 *   - sin cobro pendiente, ni una imagen ni un PDF se bajan, se leen, se cotejan ni se avisan;
 *   - un archivo de más de 5.000.000 de bytes no se descarga.
 *
 * Reloj: lunes 05/10/2026, 10:00 en La Paz. Teléfonos ficticios con seis ceros.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { LlamadaDoble, ResultadoTurno } from '../../lib/n8n-de-mentira';
import { MAXIMO_PDF } from '../../../functions/src/modulos/cobros/comprobantes';
import { ANA, PRODUCCION, PROHIBIDAS, IGUAL_QUE_ANTES, avisosDe, crear, geminiTexto, hablar, mImagen, mPdf, pedirQr, unico, type Mundial, type Opciones } from './mundo';

// ------------------------------------------------------------------------------ los textos del caso (copiados de `rrTextoComprobante`)
const T_CUADRA = IGUAL_QUE_ANTES;
const T_REINTENTAR_5 = 'Recibí tu comprobante, pero veo una diferencia con tu compra: el comprobante dice 5 Bs y tu pedido es de 60 Bs. Si te equivocaste, envíame de nuevo el comprobante correcto (en foto o en PDF desde la app de tu banco). Si prefieres, escríbele a Rubén con el botón.';
const T_APROXIMADO = 'Recibí tu comprobante, pero el monto del comprobante no coincide del todo con tu pedido. Ya pasé tu comprobante a Rubén para que lo revise; si quieres escribirle, toca el botón.';
const T_ILEGIBLE = 'Recibí tu archivo, pero no pude leer bien el comprobante. ¿Me lo envías de nuevo, más nítido o en PDF desde la app de tu banco?';
const T_TARDIO = 'Tu comprobante llegó después de los 15 minutos del QR. Ya lo pasé a Rubén para que lo revise directamente; si quieres escribirle, toca el botón.';
const T_REVISION = 'Como ya van varios intentos, pasé tu comprobante a Rubén para que lo revise directamente. Si quieres escribirle, toca el botón.';
const T_REPETIDO = 'Ya tengo el comprobante de este pedido. Si necesitas algo más, escríbele a Rubén con el botón.';
const T_SIN_COTEJAR = 'Recibí tu comprobante, pero no pude cotejarlo. Ya lo pasé a Rubén para que lo revise; si quieres escribirle, toca el botón.';
const T_SIN_COBRO_IMAGEN = 'Recibí tu imagen, pero por aquí solo puedo leer texto y los comprobantes de un pedido abierto. Cuéntame qué buscas y te ayudo.';
/** Lo que NUNCA debe leer el cliente en ningún caso: lo prohibido de la suite de venta, más «ya te lo enviamos» y cualquier enlace (la promesa «te enviará los enlaces» del caso cuadra no es un enlace). */
const NUNCA = /acreditad|verificad|validad|recibimos tu pago|ya te lo envi|https?:|www\.|\.com\b|wa\.me/i;

const NODOS_DE_ARCHIVO = ['Obtener URL del medio', 'Descargar medio', 'Guardar comprobante', 'Leer comprobante (imagen)', 'Leer comprobante (PDF)', 'Cotejar en el servidor', 'Enviar aviso'];
const LECTURA_BUENA = { monto: '60.00', cuentaDestino: '59100000077', nombreCuenta: 'Titular Ejemplo', fecha: '05/10/2026', hora: '10:02', banco: 'Banco Ejemplo' };

interface Tipo { nombre: 'imagen' | 'PDF'; msg: () => J; lee: string; noLee: string }
const TIPOS: Tipo[] = [
  { nombre: 'imagen', msg: () => mImagen(), lee: 'Leer comprobante (imagen)', noLee: 'Leer comprobante (PDF)' },
  { nombre: 'PDF', msg: () => mPdf(), lee: 'Leer comprobante (PDF)', noLee: 'Leer comprobante (imagen)' },
];

/** Registra cada llamada que recibe un doble (la del nodo real: parámetros evaluados, cabeceras, cuerpo). */
function espiar(w: Mundial, nodos: string[]): Record<string, LlamadaDoble[]> {
  const vistas: Record<string, LlamadaDoble[]> = {};
  for (const nodo of nodos) {
    vistas[nodo] = [];
    const original = w.mundo.dobles[nodo]!;
    w.mundo.dobles[nodo] = (ll: LlamadaDoble) => {
      vistas[nodo]!.push(ll);
      return typeof original === 'function' ? original(ll) : original;
    };
  }
  return vistas;
}
/** Un mundo con el QR de Ana abierto, con el lector del tipo de archivo sustituido (lo que devolvería Gemini) y los nodos de archivo espiados. */
function mundoCon(tipo: Tipo, o: Opciones & { gemini?: J } = {}): { w: Mundial; vistas: Record<string, LlamadaDoble[]> } {
  const { gemini, ...resto } = o;
  const w = crear(resto);
  pedirQr(w, 'pack');
  if (gemini !== undefined) w.mundo.dobles[tipo.lee] = gemini;
  return { w, vistas: espiar(w, NODOS_DE_ARCHIVO) };
}
/** Un cotejo que se comporta como el servidor ante lo que le llega: lo ilegible se reintenta; lo legible lo decide `legibleCon`. */
const servidorQue = (legibleCon: J) => (ll: LlamadaDoble): J => (
  ll.cuerpo?.['legible'] === false ? { statusCode: 200, body: { estado: 'reintentar', motivo: 'ilegible' } } : { statusCode: 200, body: legibleCon }
);
const cotejoDe = (t: ResultadoTurno) => t.registro.find((r) => r.nodo === 'Cotejar en el servidor')!;
const reportesSalientes = (w: Mundial): J[] => w.mundo.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente' && c['evento'] !== 'qr_enviado');
/** El texto tal cual lo ve el cliente, con los párrafos en una línea: el flujo solo reparte espacios en blanco (los párrafos los vigila `vigilarUx`). */
const plano = (m: { cuerpo: string }): string => m.cuerpo.replace(/\s+/g, ' ');
const limpio = (m: { cuerpo: string }): void => {
  expect(m.cuerpo).not.toMatch(PROHIBIDAS);
  expect(m.cuerpo).not.toMatch(NUNCA);
};

for (const tipo of TIPOS) {
  describe(`comprobante en ${tipo.nombre}`, () => {
    it('1 · válido (cuadra): texto exacto, aviso a Rubén, reporte saliente; Guardar corre ANTES de leer y cotejar y lleva el archivo; se usa SOLO el lector de su tipo', () => {
      const { w, vistas } = mundoCon(tipo);
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      expect(m.cuerpo).toBe(T_CUADRA);
      limpio(m);
      expect(avisosDe(t)).toHaveLength(1);
      expect(avisosDe(t)[0]).toContain('Estado: comprobante: datos coinciden');
      expect(reportesSalientes(w)).toHaveLength(1);
      expect(reportesSalientes(w)[0]).toMatchObject({ telefono: ANA, direccion: 'saliente', tipo: 'text', texto: T_CUADRA });
      // Orden v1: guardar -> (¿Es PDF?) -> leer -> interpretar -> cotejar -> decidir.
      const o = t.orden;
      for (const n of ['Obtener URL del medio', 'Descargar medio', 'Guardar comprobante', tipo.lee, 'Cotejar en el servidor', 'Decidir turno']) expect(o.indexOf(n), n).toBeGreaterThanOrEqual(0);
      expect(o.indexOf('Guardar comprobante')).toBeLessThan(o.indexOf(tipo.lee));
      expect(o.indexOf('Guardar comprobante')).toBeLessThan(o.indexOf('Cotejar en el servidor'));
      expect(o.indexOf('Descargar medio')).toBeLessThan(o.indexOf('Guardar comprobante'));
      expect(t.ejecutados.has(tipo.noLee)).toBe(false);
      // El archivo se baja como binario `data` y se guarda tal cual, con el teléfono y el id del mensaje de Meta.
      expect(vistas['Descargar medio']![0]!.parametros['options']).toMatchObject({ response: { response: { responseFormat: 'file', outputPropertyName: 'data' } } });
      const g = vistas['Guardar comprobante']![0]!;
      expect(g.parametros).toMatchObject({ contentType: 'binaryData', inputDataFieldName: 'data', method: 'POST' });
      expect(g.url).toMatch(/\/guardarComprobante$/);
      expect(g.encabezados['X-NovuChat-Telefono']).toBe(ANA);
      expect(g.encabezados['X-NovuChat-IdMeta']).toMatch(/^wamid\.IN/);
      expect(cotejoDe(t).cuerpo).toMatchObject({ telefono: ANA, legible: true, ruta: 'tenants/rroca-ruben/comprobantes/2026-10-05/abc_1.jpg' });
      expect(Object.keys(cotejoDe(t).cuerpo!['leido']).sort()).toEqual(['banco', 'cuentaDestino', 'fecha', 'hora', 'monto', 'nombreCuenta']);
    });

    it('2 · monto distinto («reintentar»): texto con los números del SERVIDOR, sin aviso a Rubén, el cobro sigue abierto; el archivo igual se guardó antes', () => {
      const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', montoLeido: 5, importe: 60 } }) });
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      expect(plano(m)).toBe(T_REINTENTAR_5);
      limpio(m);
      expect(m.cuerpo).not.toMatch(/ya pas[eé]|le avis[eé]/i);
      expect(t.avisos).toHaveLength(0);
      expect(t.ejecutados.has('Enviar aviso')).toBe(false);
      expect(t.ejecutados.has('Guardar comprobante')).toBe(true);
      expect(t.orden.indexOf('Guardar comprobante')).toBeLessThan(t.orden.indexOf(tipo.lee));
      expect(t.ejecutados.has(tipo.noLee)).toBe(false);
      expect(w.cobro.pendiente).toBe(true);
      expect(reportesSalientes(w)).toHaveLength(1);
      expect(m.payload['interactive']?.type).toBe('cta_url');
    });

    it('3 · aproximado: texto exacto (no dice «coinciden»), aviso a Rubén con el motivo exacto y botón', () => {
      const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 200, body: { estado: 'aproximado', motivo: 'monto_distinto', avisarComercio: true, importe: 60 } }) });
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      expect(m.cuerpo).toBe(T_APROXIMADO);
      limpio(m);
      expect(m.cuerpo).not.toMatch(/coinciden con tu compra/);
      expect(m.payload['interactive']?.type).toBe('cta_url');
      expect(avisosDe(t)).toHaveLength(1);
      expect(avisosDe(t)[0]).toContain('Estado: comprobante con datos que casi coinciden: el monto no coincide con el del pedido.');
      expect(t.orden.indexOf('Guardar comprobante')).toBeLessThan(t.orden.indexOf('Cotejar en el servidor'));
    });

    it('4 · ilegible o escaneado: el lector no devuelve nada o devuelve campos vacíos -> el servidor recibe `legible: false`, pide uno más nítido, SIN aviso, y no cierra nada', () => {
      const lecturas: Array<[string, J]> = [
        ['sin respuesta del lector', {}],
        ['campos vacíos (escaneado)', geminiTexto(JSON.stringify({ monto: '', cuentaDestino: '', nombreCuenta: '', fecha: '', hora: '', banco: '' }))],
        ['texto que no es JSON', geminiTexto('No puedo leer este documento.')],
      ];
      for (const [nombre, gemini] of lecturas) {
        const { w } = mundoCon(tipo, { gemini, cotejo: servidorQue({ estado: 'valido', avisarComercio: true, importe: 60, cierreId: 'venta_x' }) });
        const t = hablar(w, ANA, tipo.msg());
        const m = unico(t);
        expect(cotejoDe(t).cuerpo, nombre).toMatchObject({ telefono: ANA, legible: false });
        expect(plano(m), nombre).toBe(T_ILEGIBLE);
        limpio(m);
        expect(t.avisos, nombre).toHaveLength(0);
        expect(t.ejecutados.has('Enviar aviso'), nombre).toBe(false);
        expect(t.orden.indexOf('Guardar comprobante'), nombre).toBeLessThan(t.orden.indexOf(tipo.lee));
        expect(w.cobro.pendiente, nombre).toBe(true);
      }
    });

    it('7 · tercer inválido (en revisión): texto exacto, aviso a Rubén con la causa y botón', () => {
      const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 200, body: { estado: 'en_revision', motivo: 'monto_menor', avisarComercio: true } }) });
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      expect(m.cuerpo).toBe(T_REVISION);
      limpio(m);
      expect(m.payload['interactive']?.type).toBe('cta_url');
      expect(avisosDe(t)).toHaveLength(1);
      expect(avisosDe(t)[0]).toContain('Estado: comprobante en revisión: tercer intento sin cuadrar (el monto es menor al del pedido).');
    });

    it('8 · tardío (pasaron los 15 minutos): texto exacto, aviso a Rubén y botón; no cierra la venta', () => {
      const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 200, body: { estado: 'tardio', avisarComercio: true, importe: 60 } }) });
      w.cobro.pendiente = false;
      w.cobro.vencidoHaceMin = 4;
      const t = hablar(w, ANA, tipo.msg(), { avanzarMin: 19 });
      const m = unico(t);
      expect(m.cuerpo).toBe(T_TARDIO);
      limpio(m);
      expect(m.payload['interactive']?.type).toBe('cta_url');
      expect(avisosDe(t)).toHaveLength(1);
      expect(avisosDe(t)[0]).toContain('Estado: comprobante tardío: llegó después de los 15 minutos del QR');
      expect(t.orden.indexOf('Guardar comprobante')).toBeLessThan(t.orden.indexOf('Cotejar en el servidor'));
    });

    it('9 · duplicado (`ya_cotejado`): «ya tengo el comprobante», con botón y SIN segundo aviso, venga como `repetido` o como `ya_resuelto`', () => {
      for (const cuerpo of [{ estado: 'valido', repetido: true, avisarComercio: false, importe: 60 }, { estado: 'ya_resuelto' }]) {
        const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 200, body: cuerpo }) });
        const t = hablar(w, ANA, tipo.msg());
        const m = unico(t);
        expect(m.cuerpo, JSON.stringify(cuerpo)).toBe(T_REPETIDO);
        limpio(m);
        expect(m.payload['interactive']?.type).toBe('cta_url');
        expect(t.avisos).toHaveLength(0);
        expect(t.ejecutados.has('Enviar aviso')).toBe(false);
      }
    });

    it('sin cotejar (cotejo caído o respuesta desconocida): nunca «coincide»; aviso a Rubén y botón', () => {
      const { w } = mundoCon(tipo, { cotejo: () => ({ statusCode: 500, body: { estado: 'valido', avisarComercio: true } }) });
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      expect(m.cuerpo).toBe(T_SIN_COTEJAR);
      limpio(m);
      expect(avisosDe(t)).toHaveLength(1);
      expect(avisosDe(t)[0]).toContain('comprobante sin cotejar');
    });

    it('10 · SIN cobro pendiente: no se baja, no se lee, no se coteja, no se guarda y no se avisa', () => {
      const w = crear();
      const vistas = espiar(w, NODOS_DE_ARCHIVO);
      const t = hablar(w, ANA, tipo.msg());
      const m = unico(t);
      limpio(m);
      for (const n of NODOS_DE_ARCHIVO) expect(t.ejecutados.has(n), n).toBe(false);
      for (const n of NODOS_DE_ARCHIVO) expect(vistas[n], n).toHaveLength(0);
      expect(t.avisos).toHaveLength(0);
      expect(t.llamadas.cotejo).toHaveLength(0);
      expect(reportesSalientes(w)).toHaveLength(1);
      expect(m.cuerpo).not.toMatch(/comprobante recibido|datos coinciden|ya pas[eé]/i);
    });

    it('11 · archivo de MÁS de 5.000.000 de bytes (o sin tamaño): no se descarga, no se guarda, no se lee; «sin cotejar» con aviso y botón', () => {
      for (const tamano of [5_000_001, 6_000_000, 0]) {
        const { w } = mundoCon(tipo, { tamano });
        const t = hablar(w, ANA, tipo.msg());
        const m = unico(t);
        expect(m.cuerpo, String(tamano)).toBe(T_SIN_COTEJAR);
        limpio(m);
        expect(t.ejecutados.has('Obtener URL del medio'), String(tamano)).toBe(true);
        for (const n of ['Descargar medio', 'Guardar comprobante', 'Leer comprobante (imagen)', 'Leer comprobante (PDF)', 'Cotejar en el servidor']) expect(t.ejecutados.has(n), `${tamano} ${n}`).toBe(false);
        expect(avisosDe(t)).toHaveLength(1);
        expect(avisosDe(t)[0]).toContain('comprobante sin cotejar');
      }
    });

    it('11b · el límite es EXACTO: un archivo de 5.000.000 de bytes sí se descarga, se guarda y se coteja', () => {
      const { w } = mundoCon(tipo, { tamano: 5_000_000 });
      const t = hablar(w, ANA, tipo.msg());
      expect(unico(t).cuerpo).toBe(T_CUADRA);
      for (const n of ['Descargar medio', 'Guardar comprobante', tipo.lee, 'Cotejar en el servidor']) expect(t.ejecutados.has(n), n).toBe(true);
    });
  });
}

describe('comprobante en PDF: varias páginas', () => {
  const PDF = TIPOS[1]!;
  const OTRA_HOJA = { monto: '1500.00', cuentaDestino: '59100000099', nombreCuenta: 'Otra Persona', fecha: '01/09/2026', hora: '08:00', banco: 'Otro Banco' };

  it('12a · el comprobante trae hojas de relleno y el lector devuelve SOLO el comprobante (con texto alrededor y cercos de código): se coteja ese resultado', () => {
    const { w } = mundoCon(PDF, { gemini: geminiTexto('```json\n' + JSON.stringify(LECTURA_BUENA) + '\n```\nLas otras hojas son términos y condiciones.') });
    const t = hablar(w, ANA, PDF.msg());
    expect(cotejoDe(t).cuerpo).toMatchObject({ telefono: ANA, legible: true, leido: { monto: '60.00', cuentaDestino: '59100000077' } });
    const m = unico(t);
    expect(m.cuerpo).toBe(T_CUADRA);
    limpio(m);
    expect(t.orden.indexOf('Guardar comprobante')).toBeLessThan(t.orden.indexOf('Leer comprobante (PDF)'));
  });

  it('12b · el lector devuelve DOS comprobantes distintos (varias hojas con datos contradictorios): el flujo NO elige uno, manda `legible: false` y pide uno claro; sin aviso', () => {
    const { w } = mundoCon(PDF, { gemini: geminiTexto(JSON.stringify(LECTURA_BUENA) + '\n' + JSON.stringify(OTRA_HOJA)), cotejo: servidorQue({ estado: 'valido', avisarComercio: true, importe: 60, cierreId: 'venta_x' }) });
    const t = hablar(w, ANA, PDF.msg());
    expect(cotejoDe(t).cuerpo).toMatchObject({ legible: false });
    const m = unico(t);
    expect(plano(m)).toBe(T_ILEGIBLE);
    limpio(m);
    expect(t.avisos).toHaveLength(0);
    expect(w.cobro.pendiente).toBe(true);
  });

  it('12c · el lector devuelve una LISTA con un comprobante por hoja: tampoco se elige uno (se pide uno claro) y jamás se cierra el cobro', () => {
    const { w } = mundoCon(PDF, { gemini: geminiTexto(JSON.stringify([LECTURA_BUENA, OTRA_HOJA])), cotejo: servidorQue({ estado: 'valido', avisarComercio: true, importe: 60, cierreId: 'venta_x' }) });
    const t = hablar(w, ANA, PDF.msg());
    expect(cotejoDe(t).cuerpo).toMatchObject({ legible: false });
    const m = unico(t);
    expect(plano(m)).toBe(T_ILEGIBLE);
    limpio(m);
    expect(t.avisos).toHaveLength(0);
    expect(w.cobro.pendiente).toBe(true);
  });

  it('12d · si el servidor, con los datos de UN solo comprobante legible, los encuentra malos, el flujo los transmite tal cual y no inventa nada: el cliente ve la diferencia del servidor', () => {
    const { w } = mundoCon(PDF, {
      gemini: geminiTexto(JSON.stringify({ ...LECTURA_BUENA, monto: '5.00' })),
      cotejo: (ll) => ({ statusCode: 200, body: { estado: 'reintentar', motivo: 'monto_menor', montoLeido: Number(String((ll.cuerpo?.['leido'] as J)['monto']).replace(',', '.')), importe: 60 } }),
    });
    const t = hablar(w, ANA, PDF.msg());
    expect(cotejoDe(t).cuerpo!['leido']).toMatchObject({ monto: '5.00' });
    expect(plano(unico(t))).toBe(T_REINTENTAR_5);
    expect(t.avisos).toHaveLength(0);
  });
});

describe('PDF o imagen SIN cobro pendiente: el texto', () => {
  it('imagen: «Recibí tu imagen…» (texto fijo del flujo)', () => {
    const t = hablar(crear(), ANA, mImagen());
    expect(unico(t).cuerpo).toBe(T_SIN_COBRO_IMAGEN);
  });

  // DEFECTO CONOCIDO (bloque de medios entrantes): hoy a un PDF sin QR abierto el flujo le dice «Recibí tu imagen». El guion (casos 8 y 13) pide un texto que diga «archivo».
  // `it.fails` deja el defecto a la vista: pasa (en verde) mientras el texto siga diciendo «imagen» y se pondrá ROJO el día que se corrija, para que alguien quite el `.fails`.
  it.fails('DEFECTO · a un PDF sin QR abierto debería decirle «archivo», no «imagen» (hoy dice «Recibí tu imagen…»)', () => {
    const t = hablar(crear(), ANA, mPdf());
    const m = unico(t);
    expect(m.cuerpo).toMatch(/archivo/i);
    expect(m.cuerpo).not.toMatch(/imagen/i);
  });

  it('el defecto no cambia nada más: el PDF sin QR sigue sin bajarse, leerse, cotejarse ni avisarse', () => {
    const t = hablar(crear(), ANA, mPdf());
    for (const n of NODOS_DE_ARCHIVO) expect(t.ejecutados.has(n), n).toBe(false);
    expect(t.avisos).toHaveLength(0);
  });
});

describe('PDF entre 5 y 10 MB: desajuste entre el flujo y la Function', () => {
  it('la Function de guardado acepta PDF hasta 10 MiB, pero el flujo corta TODO archivo de comprobante en 5.000.000 de bytes: un PDF de 7 MB nunca llega a la Function (desajuste documentado, no corregido)', () => {
    expect(MAXIMO_PDF).toBe(10 * 1024 * 1024);
    const nodo = PRODUCCION.nodes.find((n) => n.name === '¿Tamaño aceptable?')!;
    expect(JSON.stringify(nodo.parameters)).toContain('5000000');
    const w2 = crear({ tamano: 7_000_000 });
    pedirQr(w2, 'pack');
    const t = hablar(w2, ANA, mPdf());
    expect(unico(t).cuerpo).toBe(T_SIN_COTEJAR);
    expect(7_000_000).toBeGreaterThan(5_000_000);
    expect(7_000_000).toBeLessThanOrEqual(MAXIMO_PDF);
    for (const n of ['Descargar medio', 'Guardar comprobante', 'Leer comprobante (PDF)', 'Cotejar en el servidor']) expect(t.ejecutados.has(n), n).toBe(false);
    expect(avisosDe(t)).toHaveLength(1);
  });
});
