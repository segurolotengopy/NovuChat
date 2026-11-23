/**
 * TODO AVISO A RECEPCIÓN LLEVA EL NOMBRE Y EL TELÉFONO DEL CLIENTE (reclamo de Andres, 22/11/2026).
 *
 * Una sola regla, probada contra el código real de cada flujo y en las dos formas en que sale un aviso: plantilla (ventana de 24 h de recepción cerrada) y texto libre (abierta).
 *   - Q'Taco (venta-minima), Rubén, Antonio, Walisuma, Evy, Emma y NovuChat: la derivación (y, donde aplica, el aviso sin respuesta) trae el nombre del cliente y los dígitos de su teléfono
 *     para el rol `completo` / recepción.
 *   - Las formas `cita` de `avisos.js` (reserva y derivación) agregan el teléfono SOLO al rol `completo`.
 *   - Bellido (agenda mínima): se elige ANTES de enviar. Con `plantillaAvisoRecepcion` APPROVED y la ventana de recepción cerrada o desconocida sale la plantilla (nombre, teléfono, motivo); con la ventana abierta, el texto;
 *     sin APPROVED sale exactamente como antes.
 * NIEGA (R2, decisión de Andres del 22/11): el rol `cocina` de Q'Taco NO recibe el teléfono, ni en plantilla ni en texto, y solo el primer nombre.
 *
 * Los teléfonos son sintéticos (con seis ceros). El reloj es un parámetro o el del mundo de cada flujo.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codigoDe, ejecutar, leerFlujo, type J } from '../lib/flujo';
import * as E from '../tenants/rroca-evy/mundo';
import * as M from '../tenants/rroca-emma/mundo';
import * as R from '../tenants/rroca-ruben/mundo';
import * as A from '../tenants/rroca-antonio/mundo';
import * as W from '../tenants/walisuma/mundo';
import * as V from '../lib/venta-minima-mundo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../Flujos');
const leerFuente = (ruta: string): string => readFileSync(join(RAIZ, ruta), 'utf8');

/** Lo que el destinatario lee: el cuerpo de un texto, o los parámetros de una plantilla (más su nombre). */
function visible(payload: J): string {
  if (payload['type'] === 'template') {
    const comp = (payload['template'] as J)['components'] as J[];
    return [(payload['template'] as J)['name'], ...comp.flatMap((c) => (c['parameters'] as J[]).map((p) => String(p['text'])))].join(' | ');
  }
  if (payload['type'] === 'text') return String((payload['text'] as J)['body']);
  return JSON.stringify(payload);
}
const digitos = (s: string): string => s.replace(/\D/g, '');
/** El aviso nombra al cliente y trae su teléfono completo (los dígitos, sin importar el formato). */
function llevaCliente(payload: J, nombre: string, tel: string): void {
  const v = visible(payload);
  expect(v, v).toContain(nombre);
  expect(digitos(v), v).toContain(tel);
}

// --------------------------------------------------------------------------------------- la pieza común del core
const APR = leerFuente('src/core/conversacion/aviso-recepcion.js');
const AP = ejecutar(`${APR}\nreturn [{ json: { apCliente, apPlantillaAviso, apParametro } }];`, [{}])[0] as unknown as Record<'apCliente' | 'apPlantillaAviso' | 'apParametro', (...a: unknown[]) => J | string | null>;
const CFG_OK = { plantillaAvisoRecepcion: 'aviso_recepcion_cliente', plantillaAvisoRecepcionEstado: 'APPROVED', plantillaAvisoRecepcionIdioma: 'es' };

describe('la función común del core (`apCliente`, `apPlantillaAviso`)', () => {
  it('«Nombre (+teléfono)», con «sin nombre» si falta el nombre', () => {
    expect(AP.apCliente('Ana Pérez', '59100000011')).toBe('Ana Pérez (+59100000011)');
    expect(AP.apCliente('', '+591 0000 0011')).toBe('sin nombre (+59100000011)');
    expect(AP.apCliente(undefined, '59100000011')).toBe('sin nombre (+59100000011)');
  });
  it('NIEGA: sin teléfono utilizable no inventa uno, y el nombre no lleva saltos de línea', () => {
    expect(AP.apCliente('Ana', '')).toBe('Ana');
    expect(AP.apCliente('Ana', '12')).toBe('Ana');
    expect(AP.apCliente('Ana\nPérez\t', '59100000011')).toBe('Ana Pérez (+59100000011)');
  });
  it('la plantilla: {{1}} nombre, {{2}} teléfono con «+», {{3}} motivo; idioma «es» por defecto; sin saltos de línea', () => {
    const p = AP.apPlantillaAviso(CFG_OK, 'Ana Pérez', '59100000011', 'necesita\nayuda') as J;
    expect(p['type']).toBe('template');
    expect(visible(p)).toBe('aviso_recepcion_cliente | Ana Pérez | +59100000011 | necesita ayuda');
    expect((p['template'] as J)['language']).toEqual({ code: 'es' });
    expect(AP.apPlantillaAviso({ ...CFG_OK, plantillaAvisoRecepcionIdioma: '' }, 'Ana', '59100000011', 'x')).toMatchObject({ template: { language: { code: 'es' } } });
    expect(visible(AP.apPlantillaAviso(CFG_OK, '', '59100000011', '') as J)).toBe('aviso_recepcion_cliente | sin nombre | +59100000011 | no especificado');
  });
  it('NIEGA: sin nombre de plantilla, con estado distinto de APPROVED o con un nombre inválido, no hay plantilla', () => {
    expect(AP.apPlantillaAviso({}, 'Ana', '59100000011', 'x')).toBeNull();
    expect(AP.apPlantillaAviso({ ...CFG_OK, plantillaAvisoRecepcionEstado: 'PENDING' }, 'Ana', '59100000011', 'x')).toBeNull();
    expect(AP.apPlantillaAviso({ ...CFG_OK, plantillaAvisoRecepcionEstado: '' }, 'Ana', '59100000011', 'x')).toBeNull();
    expect(AP.apPlantillaAviso({ ...CFG_OK, plantillaAvisoRecepcion: 'Nombre Con Espacios' }, 'Ana', '59100000011', 'x')).toBeNull();
    expect(AP.apPlantillaAviso({ plantillaAvisoRecepcionEstado: 'APPROVED' }, 'Ana', '59100000011', 'x')).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- las formas `cita` de `avisos.js`
const AVISOS = leerFuente('src/core/sin-agente/avisos.js');
const NOMBRES = ['avPlan'];
const LIB = ejecutar(`${AVISOS}\nreturn [{ json: { ${NOMBRES.join(', ')} } }];`, [{}])[0] as unknown as Record<string, (...a: unknown[]) => { items: { rol: string; payload: J }[]; errores: string[] }>;
const AHORA = Date.UTC(2026, 9, 5, 14);
const HORA = 3_600_000;
const COMPLETO = '59100000011';
const COCINA = '59100000022';
const CLIENTE = '59100000033';
const CFG_CITA = { prefijosPermitidos: '591', plantillaReserva: 'cita_reserva', plantillaDerivacion: 'cita_consulta' };
const sdCon = (abierta: boolean): J => ({ av: { ventana: abierta ? { [COMPLETO]: AHORA - 2 * HORA, [COCINA]: AHORA - 2 * HORA } : {}, dia: { fecha: '', n: 0 } } });
const reservaDatos: J = { codigo: 'R4T9', nombre: 'Ana Pérez', telefono: CLIENTE, reserva: { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez' } };
const consultaDatos: J = { codigo: 'KD7L', nombre: 'Ana Pérez', telefono: CLIENTE, motivo: 'quiero hablar con alguien' };
const para = (tipo: string, datos: J, cfg: J, abierta: boolean, rol: string): J => {
  const r = LIB['avPlan']!(tipo, datos, `completo:${COMPLETO},cocina:${COCINA}`, cfg, sdCon(abierta), AHORA);
  const it = r.items.find((x) => x.rol === rol);
  if (!it) throw new Error(`sin aviso para ${rol}: ${r.errores.join(',')}`);
  return it.payload;
};

describe('avisos.js, forma `cita`: el teléfono va SOLO al rol `completo`', () => {
  for (const abierta of [false, true]) {
    const ventana = abierta ? 'ventana abierta (texto)' : 'ventana cerrada (plantilla)';
    for (const [tipo, datos] of [['reserva', reservaDatos], ['transferencia', consultaDatos]] as const) {
      it(`${tipo}, ${ventana}: el rol completo lleva «Ana Pérez» y los dígitos del cliente`, () => {
        llevaCliente(para(tipo, datos, CFG_CITA, abierta, 'completo'), 'Ana Pérez', CLIENTE);
      });
      it(`NIEGA (R2) ${tipo}, ${ventana}: el rol cocina lleva solo el primer nombre y ni un dígito del teléfono`, () => {
        const v = visible(para(tipo, datos, CFG_CITA, abierta, 'cocina'));
        expect(v).toContain('Ana');
        expect(v).not.toContain('Pérez');
        expect(digitos(v)).not.toContain(CLIENTE.slice(3));
        expect(digitos(v)).not.toContain(CLIENTE);
      });
    }
  }
});

// --------------------------------------------------------------------------------------- Q'Taco (venta mínima): derivación real, por rol
describe("Q'Taco: la derivación llega con nombre y teléfono al rol completo, y sin teléfono a la cocina", () => {
  const AV1 = V.AV1;
  const AV2 = V.AV2;
  const CLI = V.CLIENTE;
  for (const abierta of [false, true]) {
    it(`ventana de recepción ${abierta ? 'abierta (texto)' : 'cerrada (plantilla)'}`, () => {
      const w = V.crear();
      if (abierta) { w.mundo.turno(V.entrega(AV1, V.texto('hola'))); w.mundo.turno(V.entrega(AV2, V.texto('hola'))); }
      const t = V.turno(w, V.texto('quiero hablar con una persona'));
      const completo = t.avisos.find((a) => a.a === AV1)!;
      const cocina = t.avisos.find((a) => a.a === AV2)!;
      expect(completo.tipo).toBe(abierta ? 'text' : 'template');
      llevaCliente(completo.payload, 'Carlos Pérez', CLI);
      // NIEGA (R2): la cocina no recibe el teléfono, en ninguna de las dos formas.
      const vc = visible(cocina.payload);
      expect(vc).toContain('Carlos');
      expect(vc).not.toContain('Pérez');
      expect(digitos(vc)).not.toContain(CLI.slice(3));
    });
  }
});

// --------------------------------------------------------------------------------------- Rubén y Antonio
describe('Rubén y Antonio: la plantilla de consulta lleva el nombre dentro de {{1}} y el teléfono en {{2}}; el texto, «Cliente: Nombre (+teléfono)»', () => {
  const casos = [['Rubén', R], ['Antonio', A]] as const;
  for (const [nombre, X] of casos) {
    it(`${nombre}: ventana cerrada (plantilla)`, () => {
      const t = X.hablar(X.crear(), X.ANA, X.mTexto('quiero hablar con Rubén por una factura'));
      const av = t.avisosA(X.REC);
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('template');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
      const params = (((av[0]!.payload['template'] as J)['components'] as J[])[0]!['parameters'] as J[]).map((p) => String(p['text']));
      expect(params[0]).toContain(' — cliente Ana');
      expect(params[1]).toBe('+' + X.ANA);
      for (const p of params) expect(p.length).toBeLessThanOrEqual(500);
    });
    it(`${nombre}: ventana abierta (texto)`, () => {
      const w = X.crear();
      X.hablar(w, X.REC, X.mTexto('hola'));
      const av = X.hablar(w, X.ANA, X.mTexto('quiero hablar con Rubén por una factura')).avisosA(X.REC);
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('text');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
      expect(visible(av[0]!.payload)).toContain('Cliente: Ana (+' + X.ANA + ')');
    });
  }
});

// --------------------------------------------------------------------------------------- Walisuma
describe('Walisuma: la alerta de derivación trae nombre y teléfono, en plantilla y en texto', () => {
  const base = { nombreNegocio: 'Walisuma' };
  it('ventana cerrada (plantilla)', () => {
    const av = W.hablar(W.crear({ base }), W.ANA, W.mTexto('quiero hablar con una persona')).avisosA(W.REC);
    expect(av).toHaveLength(1);
    expect(av[0]!.tipo).toBe('template');
    llevaCliente(av[0]!.payload, 'Ana', W.ANA);
  });
  it('ventana abierta (texto)', () => {
    const w = W.crear({ base });
    W.hablar(w, W.REC, W.mTexto('hola'));
    const av = W.hablar(w, W.ANA, W.mTexto('quiero hablar con una persona')).avisosA(W.REC);
    expect(av).toHaveLength(1);
    expect(av[0]!.tipo).toBe('text');
    llevaCliente(av[0]!.payload, 'Ana', W.ANA);
  });
});

// --------------------------------------------------------------------------------------- Evy y Emma
describe('Evy y Emma: tanto la solicitud como la consulta sin respuesta llevan nombre y teléfono, en plantilla y en texto', () => {
  const casos = [['Evy', E], ['Emma', M]] as const;
  for (const [nombre, X] of casos) {
    const PRIMER = 'Hola, vi su anuncio y quiero agendar mi valoración';
    it(`${nombre}: solicitud, ventana cerrada (plantilla)`, () => {
      const av = X.avisosARecepcion(X.hablarYa(X.crear({ modeloDice: X.dice('[DERIVAR_RECEPCION]') }), X.ANA, X.mTexto('quiero agendar el martes en la tarde')));
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('template');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
    });
    it(`${nombre}: solicitud, ventana abierta (texto)`, () => {
      const m = X.crear({ modeloDice: X.dice('[DERIVAR_RECEPCION]') });
      X.hablar(m, X.REC, X.mTexto('hola, soy recepción'));
      const av = X.avisosARecepcion(X.hablarYa(m, X.ANA, X.mTexto('quiero agendar el martes en la tarde')));
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('text');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
    });
    it(`${nombre}: consulta sin respuesta (modelo caído), ventana cerrada (plantilla)`, () => {
      const av = X.avisosARecepcion(X.hablar(X.crear({ modeloDice: 'cae' }), X.ANA, X.mTexto(PRIMER)));
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('template');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
    });
    it(`${nombre}: consulta sin respuesta (modelo caído), ventana abierta (texto)`, () => {
      const m = X.crear({ modeloDice: 'cae' });
      X.hablar(m, X.REC, X.mTexto('hola'));
      const av = X.avisosARecepcion(X.hablar(m, X.ANA, X.mTexto(PRIMER)));
      expect(av).toHaveLength(1);
      expect(av[0]!.tipo).toBe('text');
      llevaCliente(av[0]!.payload, 'Ana', X.ANA);
    });
  }
});

// --------------------------------------------------------------------------------------- NovuChat (chat de captación)
describe('NovuChat: la plantilla de aviso a recepción trae el nombre y el teléfono del contacto', () => {
  const CHAT = leerFuente('clientes/novuchat/src/lib/chat.js');
  const CH = ejecutar(`${CHAT}\nreturn [{ json: { chAviso } }];`, [{}])[0] as unknown as { chAviso: (a: J) => J | null };
  const aviso = (extra: J = {}): J | null => CH.chAviso({ avisado: false, numeroRecepcion: '59100000001', desde: '59100000044', plantilla: 'solicitud_contacto', idioma: 'es', estado: 'pidió hablar con un asesor', empresa: 'Panadería Sol', contacto: 'Ana Pérez', nombrePerfil: '', rubro: 'Comida', flujos: 'Pedidos', ...extra });
  it('lleva el contacto y los dígitos de su número', () => {
    llevaCliente(aviso()!, 'Ana Pérez', '59100000044');
  });
  it('sin el nombre dado, usa el del perfil de WhatsApp', () => {
    llevaCliente(aviso({ contacto: '', nombrePerfil: 'Beto' })!, 'Beto', '59100000044');
  });
  it('NIEGA: a quien escribe desde el propio número de recepción no se le avisa de sí mismo', () => {
    expect(aviso({ desde: '59100000001' })).toBeNull();
  });
});

// --------------------------------------------------------------------------------------- Bellido (agenda mínima)
describe('Bellido: se elige texto o plantilla ANTES de enviar, según la ventana de 24 h de recepción', () => {
  const FLUJO = leerFlujo('clientes/agenda-minima/agenda-minima.v0.json');
  const FROM = '59100000011';
  const REC = '59100000001';
  const armar = (cfgExtra: J, sd: J, desde = FROM, plan: J = { plan: 'uso_extendido', responder: false, transferir: true, motivo: 'necesita ayuda', texto: '' }, recepcion = REC): J[] => {
    const cfg = { nombreNegocio: 'Consultorio', numeroRecepcionDigitos: recepcion, numeroDoctorDigitos: '', modoPrueba: false, phoneNumberId: '1', ...cfgExtra };
    const refs = {
      Candado: [plan],
      'Interpretar entrada': [{ from: desde, nombrePerfil: 'Ana Pérez', ahoraMs: AHORA }],
      'Config del negocio': [cfg],
    };
    return ejecutar(codigoDe(FLUJO, 'Armar mensajes'), [{}], refs, { $getWorkflowStaticData: () => sd });
  };
  const aRecepcion = (items: J[]): J => items.find((i) => i['destino'] === 'recepcion')!;
  const ABIERTA = (): J => ({ av: { ventana: { [REC]: AHORA - 2 * HORA } } });
  const CERRADA = (): J => ({ av: { ventana: { [REC]: AHORA - 25 * HORA } } });
  const BORDE = (): J => ({ av: { ventana: { [REC]: AHORA - (23.5 * HORA + 1) } } });
  const DESCONOCIDA = (): J => ({});

  it('plantilla APPROVED + ventana ABIERTA: sale el texto, no la plantilla', () => {
    const r = aRecepcion(armar(CFG_OK, ABIERTA()));
    expect(r['payload']).toMatchObject({ type: 'text', to: REC });
    llevaCliente(r['payload'] as J, 'Ana Pérez', FROM);
  });
  it('plantilla APPROVED + ventana CERRADA (25 h y el borde de 23 h 30 min): sale la plantilla con nombre, teléfono y motivo', () => {
    for (const sd of [CERRADA(), BORDE()]) {
      const r = aRecepcion(armar(CFG_OK, sd));
      expect(r['payload']).toMatchObject({ type: 'template', to: REC });
      expect(visible(r['payload'] as J)).toBe('aviso_recepcion_cliente | Ana Pérez | +59100000011 | necesita ayuda');
      llevaCliente(r['payload'] as J, 'Ana Pérez', FROM);
    }
  });
  it('plantilla APPROVED + ventana DESCONOCIDA (recepción nunca escribió): sale la plantilla', () => {
    const r = aRecepcion(armar(CFG_OK, DESCONOCIDA()));
    expect(r['payload']).toMatchObject({ type: 'template', to: REC });
    llevaCliente(r['payload'] as J, 'Ana Pérez', FROM);
  });
  it('NIEGA: sin APPROVED (sin clave, PENDING, REJECTED, vacío) todo queda idéntico a hoy: texto, en las tres ventanas', () => {
    const antes = aRecepcion(armar({}, ABIERTA()));
    expect(antes['payload']).toMatchObject({ type: 'text' });
    for (const extra of [{}, { plantillaAvisoRecepcion: 'aviso_recepcion_cliente' }, { ...CFG_OK, plantillaAvisoRecepcionEstado: 'PENDING' }, { ...CFG_OK, plantillaAvisoRecepcionEstado: 'REJECTED' }, { ...CFG_OK, plantillaAvisoRecepcionEstado: '' }]) {
      for (const sd of [ABIERTA, CERRADA, DESCONOCIDA]) {
        const r = aRecepcion(armar(extra, sd()));
        expect(r['payload']).toEqual(antes['payload']);
        expect(r['respaldo']).toBe(antes['respaldo']);
      }
    }
  });
  it('el último mensaje entrante de recepción se anota en `sd.av.ventana` y abre la ventana para el aviso siguiente', () => {
    const sd: J = {};
    expect(aRecepcion(armar(CFG_OK, sd)).payload).toMatchObject({ type: 'template' });
    // Recepción escribe al bot (turno sin aviso: plan «nada»).
    armar(CFG_OK, sd, REC, { plan: 'nada' });
    expect((sd['av'] as J)['ventana'][REC]).toBe(AHORA);
    expect(aRecepcion(armar(CFG_OK, sd))['payload']).toMatchObject({ type: 'text' });
  });
  it('NIEGA: lo que escribe un cliente NO abre la ventana de recepción', () => {
    const sd: J = {};
    armar(CFG_OK, sd, FROM, { plan: 'nada' });
    expect(((sd['av'] as J | undefined) ?? {})['ventana'] ?? {}).not.toHaveProperty(REC);
  });
  it('NIEGA: nunca se avisa al propio número de recepción', () => {
    expect(armar(CFG_OK, {}, FROM, undefined, FROM).filter((i) => i['destino'] === 'recepcion')).toHaveLength(0);
  });
  it('«Enviar respaldo» sigue siendo solo el texto de siempre (el error de Graph no elige la plantilla)', () => {
    const cuerpo = String(FLUJO.nodes.find((n) => n.name === 'Enviar respaldo')!.parameters['jsonBody']);
    expect(cuerpo).not.toContain('respaldoPayload');
    expect(cuerpo).toContain("type: 'text'");
  });
  it('el código del nodo trae la pieza común byte a byte, sin copia propia', () => {
    const codigo = codigoDe(FLUJO, 'Armar mensajes');
    expect(codigo).toContain(APR.trimEnd());
    expect(leerFuente('clientes/agenda-minima/src/nodos/armar-mensajes.js')).not.toContain('function apPlantillaAviso');
  });
});

describe('avisos.js: nombre largo, marcas intactas y la reserva en forma `pedido`', () => {
  const nombre60 = 'Maria de los Angeles Fernandez Rodriguez de la Vega Montes 1';
  it('forma cita, rol completo: un nombre de 60 caracteres se recorta antes del teléfono y las dos marcas del final salen enteras (≤ 200)', () => {
    expect(nombre60.length).toBe(60);
    const datos: J = { codigo: 'R4T9', nombre: nombre60, telefono: CLIENTE, reserva: { personas: 100, fecha: '2026-10-09', hora: '20:00', zona: 'z'.repeat(40), nombre: nombre60, grupoGrande: true, diaLleno: true } };
    const v = visible(para('reserva', datos, CFG_CITA, false, 'completo')).split(' | ');
    const detalle = v[3]!;
    expect(detalle).toContain('GRUPO GRANDE · VARIAS RESERVAS HOY DE ESTE NÚMERO/revisar');
    expect(detalle.length).toBeLessThanOrEqual(200);
    expect(detalle).toContain('(+591 0000 0033)');
  });
  it('forma cita, rol completo: con reservaManana (y marcaOrigen) las marcas y el teléfono salen enteros; ceden el nombre y la zona, nunca el final', () => {
    const marcaManana = 'Reserva de mañana (antes de las 12:00): contactar para confirmar o cambiar la hora';
    const casos: J[] = [
      // el caso de la revisión: nombre corto, zona y las tres marcas
      { nombre: 'Ana María Pérez', zona: 'Terraza', extra: { grupoGrande: true, diaLleno: true, reservaManana: '12:00' }, marcas: ['GRUPO GRANDE', 'VARIAS RESERVAS HOY DE ESTE NÚMERO/revisar', marcaManana] },
      // nombre de 60 y zona de 40 con las tres marcas
      { nombre: nombre60, zona: 'z'.repeat(40), extra: { grupoGrande: true, diaLleno: true, reservaManana: '12:00' }, marcas: ['GRUPO GRANDE', 'VARIAS RESERVAS HOY DE ESTE NÚMERO/revisar', marcaManana] },
      // reservaManana + marcaOrigen (una marca de origen corta, como las que arma el flujo)
      { nombre: nombre60, zona: 'z'.repeat(40), extra: { diaLleno: true, reservaManana: '12:00', marcaOrigen: 'Origen: anuncio' }, marcas: ['VARIAS RESERVAS HOY DE ESTE NÚMERO/revisar', marcaManana, 'Origen: anuncio'] },
    ];
    for (const c of casos) {
      const datos: J = { codigo: 'R4T9', nombre: c['nombre'], telefono: CLIENTE, reserva: { personas: 100, fecha: '2026-10-09', hora: '20:00', zona: c['zona'], nombre: c['nombre'], ...(c['extra'] as J) } };
      const detalle = visible(para('reserva', datos, CFG_CITA, false, 'completo')).split(' | ')[3]!;
      expect(detalle.length, detalle).toBeLessThanOrEqual(200);
      expect(detalle, detalle).toContain('(+591 0000 0033)');
      for (const m of c['marcas'] as string[]) expect(detalle, detalle).toContain(m);
      expect(detalle.endsWith((c['marcas'] as string[]).at(-1)!), detalle).toBe(true);
    }
  });
  const CFG_PEDIDO = { prefijosPermitidos: '591', plantillaReserva: 'pedido_registrado', formaPlantillaReserva: 'pedido' };
  it('reserva en forma `pedido`: el rol completo lleva nombre y teléfono; la cocina (R2) solo el primer nombre y ningún dígito del teléfono', () => {
    const completo = visible(para('reserva', reservaDatos, CFG_PEDIDO, false, 'completo'));
    expect(completo).toContain('Ana Pérez');
    expect(digitos(completo)).toContain(CLIENTE);
    const cocina = visible(para('reserva', reservaDatos, CFG_PEDIDO, false, 'cocina'));
    expect(cocina).toContain('Ana');
    expect(cocina).not.toContain('Pérez');
    expect(digitos(cocina)).not.toContain(CLIENTE.slice(3));
  });
});
