/**
 * FLUJO INTERNO DE COBRO — qué se le contesta al negocio, y qué se le cobra.
 *
 * NO NECESITA EMULADOR: `cobroTextos.ts` es puro. Acá hay dinero de por medio,
 * así que lo que se prueba es que el monto salga SIEMPRE de la tabla de planes,
 * que un comprobante sin pago en curso no se dé por bueno, y que ningún texto
 * afirme una acreditación que no se tiene (prohibición 3, mitad de cobro real).
 */
import { describe, expect, it } from 'vitest';
import {
  TEXTOS, armarLista, decidirRespuesta, normalizarComando, opcionDe, pagoDeOpcion,
  type Contexto, type Entrada,
} from '../functions/src/cobroTextos.ts';
import { importeBs, BOLSA, PLANES, VOSEO, estadoDeServicio } from '../functions/src/prepago.ts';

const entrada = (parte: Partial<Entrada>): Entrada => ({
  tipo: 'text', texto: '', seleccionId: '', nombrePerfil: 'Ana', ...parte,
});

const negocio = { tenantId: 'salon-rosa', nombre: 'Salón Rosa' };
const pagado = { modalidad: 'prepago', plan: 'base', periodoPagado: '2026-09', bolsa: 0 };
/** TCO del BCB del 08/09/2026: la lista está en dólares y se cobra en Bs. */
const TCO = 12.60;

const contexto = (parte: Partial<Contexto> = {}): Contexto => ({
  negocio, estado: estadoDeServicio(pagado, 12, '2026-09'), pagoEnCurso: null,
  qrDisponible: true, tco: TCO, ...parte,
});

/** Los textos que acompañan al QR o al comprobante no pueden sonar a «pagado». */
const AFIRMA_ACREDITACION = /acreditad|pago (verificad|confirmad|recibid)|recibimos (tu|el) pago/i;

describe('Reconocer qué quiere el negocio', () => {
  it('la fila tocada manda sobre cualquier texto', () => {
    expect(opcionDe(entrada({ seleccionId: 'bolsa', texto: 'pagar' }))).toBe('bolsa');
  });

  it('una palabra suelta alcanza: pagar, bolsa, saldo, el nombre de un plan', () => {
    expect(opcionDe(entrada({ texto: 'Pagar' }))).toBe('renovar');
    expect(opcionDe(entrada({ texto: 'quiero una bolsa' }))).toBe('bolsa');
    expect(opcionDe(entrada({ texto: 'mi saldo?' }))).toBe('saldo');
    expect(opcionDe(entrada({ texto: 'Corporativo' }))).toBe('plan_corporativo');
  });

  it('una frase larga no es un comando: se muestra el menú', () => {
    expect(opcionDe(entrada({ texto: 'hola, quiero saber cómo pagar el mes que viene' }))).toBeNull();
    expect(opcionDe(entrada({ texto: 'buenas tardes' }))).toBeNull();
  });

  it('normaliza tildes y mayúsculas', () => {
    expect(normalizarComando('  ¡PAGÁR!  ')).toBe('pagar');
  });
});

describe('El menú respeta los topes de WhatsApp', () => {
  it('a lo sumo 10 filas, títulos de 24 y descripciones de 72', () => {
    const lista = armarLista(estadoDeServicio(pagado, 0, '2026-09'), 'Un nombre de negocio bastante largo para probar el tope', 'x'.repeat(2000), TCO);
    const filas = lista.secciones.flatMap((s) => s.filas);
    expect(filas.length).toBeLessThanOrEqual(10);
    for (const f of filas) {
      expect(f.titulo.length).toBeLessThanOrEqual(24);
      expect(f.descripcion.length).toBeLessThanOrEqual(72);
    }
    expect(lista.header.length).toBeLessThanOrEqual(60);
    expect(lista.body.length).toBeLessThanOrEqual(1024);
    expect(lista.footer.length).toBeLessThanOrEqual(60);
    expect(lista.boton.length).toBeLessThanOrEqual(20);
    for (const s of lista.secciones) expect(s.titulo.length).toBeLessThanOrEqual(24);
  });

  it('ofrece renovar el plan actual, cambiar a los otros dos, la bolsa y el saldo', () => {
    const ids = armarLista(estadoDeServicio(pagado, 0, '2026-09'), 'Salón Rosa', 'x', TCO)
      .secciones[0]?.filas.map((f) => f.id);
    expect(ids).toEqual(['renovar', 'plan_crecimiento', 'plan_corporativo', 'bolsa', 'saldo']);
  });

  it('en el mes de prueba la primera opción es CONTRATAR, no renovar', () => {
    const estado = estadoDeServicio({ modalidad: 'prueba', periodoPrueba: '2026-09', bolsaPrueba: 20 }, 0, '2026-09');
    expect(armarLista(estado, 'Salón Rosa', 'x', TCO).secciones[0]?.filas[0]?.titulo).toMatch(/^Contratar/);
  });
});

describe('La opción elegida se traduce a un pago con el monto de la tabla', () => {
  const estado = estadoDeServicio({ ...pagado, plan: 'crecimiento' }, 0, '2026-09');
  it('renovar es el plan ACTUAL por un mes', () => {
    expect(pagoDeOpcion('renovar', estado)).toEqual({ tipo: 'mensualidad', plan: 'crecimiento', meses: 1 });
  });
  it('plan_x es cambiar de plan por un mes; bolsa es una bolsa', () => {
    expect(pagoDeOpcion('plan_base', estado)).toEqual({ tipo: 'mensualidad', plan: 'base', meses: 1 });
    expect(pagoDeOpcion('bolsa', estado)).toEqual({ tipo: 'bolsa', cantidad: 1 });
  });
  it('un plan inventado no es un pago', () => {
    expect(pagoDeOpcion('plan_oro', estado)).toBeNull();
    expect(pagoDeOpcion('saldo', estado)).toBeNull();
  });
});

describe('Decidir la respuesta', () => {
  it('un teléfono desconocido recibe una explicación y ningún menú', () => {
    const d = decidirRespuesta(entrada({ texto: 'hola' }), contexto({ negocio: null, estado: null }));
    expect(d.respuesta).toBe(TEXTOS.desconocido);
    expect(d.lista).toBeNull();
    expect(d.crearPago).toBeNull();
  });

  it('un saludo recibe el resumen de la cuenta y el menú', () => {
    const d = decidirRespuesta(entrada({ texto: 'hola' }), contexto());
    expect(d.respuesta).toMatch(/Hola Ana/);
    expect(d.respuesta).toMatch(/Plan Base, pagado hasta el 30\/09\/2026/);
    expect(d.lista).not.toBeNull();
    expect(d.crearPago).toBeNull();
    expect(d.enviarQr).toBe(false);
  });

  it('elegir «renovar» crea el pago del plan actual, con su monto, y manda el QR', () => {
    const d = decidirRespuesta(entrada({ seleccionId: 'renovar' }), contexto());
    expect(d.crearPago).toEqual({ tipo: 'mensualidad', plan: 'base', meses: 1 });
    expect(d.enviarQr).toBe(true);
    // Lo que se le dice al negocio es el importe en bolivianos: USD 20 × 12,60.
    expect(d.respuesta).toMatch(/Bs 315/);
    expect(d.respuesta).toMatch(/comprobante antes de salir/);
    expect(d.lista).toBeNull();
  });

  it('elegir la bolsa crea el pago de la bolsa', () => {
    const d = decidirRespuesta(entrada({ texto: 'bolsa' }), contexto());
    expect(d.crearPago).toEqual({ tipo: 'bolsa', cantidad: 1 });
    expect(d.respuesta).toMatch(new RegExp(`Bs ${importeBs(BOLSA.precioUsd, TCO)}`));
  });

  it('cambiar de plan crea el pago del plan nuevo', () => {
    const d = decidirRespuesta(entrada({ seleccionId: 'plan_corporativo' }), contexto());
    expect(d.crearPago).toEqual({ tipo: 'mensualidad', plan: 'corporativo', meses: 1 });
    expect(d.respuesta).toMatch(new RegExp(`Bs ${importeBs(PLANES.corporativo.precioUsd, TCO)}`));
  });

  it('sin QR cargado no se manda QR, se crea el pago igual y se avisa al equipo', () => {
    const d = decidirRespuesta(entrada({ seleccionId: 'renovar' }), contexto({ qrDisponible: false }));
    expect(d.enviarQr).toBe(false);
    expect(d.crearPago).not.toBeNull();
    expect(d.avisoAdmin).toMatch(/no tiene QR/);
  });

  it('un comprobante CON pago en curso se marca y avisa a NovuChat; nunca dice acreditado', () => {
    const d = decidirRespuesta(entrada({ tipo: 'image' }),
      // El pago en curso ya trae su importe en bolivianos, calculado y guardado
      // cuando se creó, con el TCO de ese momento.
      contexto({ pagoEnCurso: { id: 'p1', descripcion: 'Plan Base · 1 mes', monto: 252 } }));
    expect(d.marcarComprobante).toBe(true);
    expect(d.avisoAdmin).toMatch(/Comprobante recibido · Salón Rosa \(salon-rosa\) · Plan Base · 1 mes · Bs 252/);
    expect(d.respuesta).toMatch(/Recibí tu comprobante/);
    expect(d.respuesta).not.toMatch(AFIRMA_ACREDITACION);
    expect(d.crearPago).toBeNull();
  });

  it('un PDF también es un comprobante', () => {
    const d = decidirRespuesta(entrada({ tipo: 'document' }),
      contexto({ pagoEnCurso: { id: 'p1', descripcion: 'Bolsa', monto: 50 } }));
    expect(d.marcarComprobante).toBe(true);
  });

  it('un comprobante SIN pago en curso no se da por bueno: se pide elegir primero', () => {
    const d = decidirRespuesta(entrada({ tipo: 'image' }), contexto());
    expect(d.marcarComprobante).toBe(false);
    expect(d.avisoAdmin).toBeNull();
    expect(d.lista).not.toBeNull();
    expect(d.respuesta).toMatch(/no tengo ningún pago en curso/);
  });

  it('«saldo» con un pago en curso lo recuerda', () => {
    const d = decidirRespuesta(entrada({ texto: 'saldo' }),
      contexto({ pagoEnCurso: { id: 'p1', descripcion: 'Bolsa de 150 conversaciones', monto: 50 } }));
    expect(d.respuesta).toMatch(/Tienes un pago en curso: Bolsa de 150 conversaciones por Bs 50/);
    expect(d.crearPago).toBeNull();
  });

  it('un audio o un sticker no rompen nada: menú con aviso', () => {
    const d = decidirRespuesta(entrada({ tipo: 'audio' }), contexto());
    expect(d.respuesta).toMatch(/^No pude leer ese mensaje/);
    expect(d.lista).not.toBeNull();
  });

  it('cortado por falta de pago, el resumen lo dice y el menú ofrece pagar', () => {
    const d = decidirRespuesta(entrada({ texto: 'hola' }),
      contexto({ estado: estadoDeServicio(pagado, 0, '2026-10') }));
    expect(d.respuesta).toMatch(/DETENIDO porque este mes no está pagado/);
    expect(d.lista?.secciones[0]?.filas[0]?.id).toBe('renovar');
  });
});

describe('Ningún texto del flujo afirma una acreditación ni vosea', () => {
  it('los textos fijos y los generados', () => {
    const generados = [
      TEXTOS.saludo('Ana'), TEXTOS.desconocido, TEXTOS.elegir, TEXTOS.noEntendi,
      TEXTOS.pagoElegido('Plan Base · 1 mes', 250), TEXTOS.pagoElegidoSinQr('Bolsa', 50),
      TEXTOS.epigrafeQr('Plan Base · 1 mes', 250), TEXTOS.comprobanteRecibido('Bolsa', 50),
      TEXTOS.comprobanteSinPago('Salón Rosa'), TEXTOS.pagoEnCurso('Bolsa', 50),
    ];
    for (const t of generados) {
      expect(t).not.toMatch(AFIRMA_ACREDITACION);
      expect(VOSEO.test(t)).toBe(false);
    }
  });
});
