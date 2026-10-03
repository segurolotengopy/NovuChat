/**
 * LO COMÚN DE «VENTA MÍNIMA v0» (T1): `src/lib/comun.js` y los cinco nodos de entrada y
 * configuración (`Carga de entrada`, `Config del negocio`, `Interpretar entrada`,
 * `Uso extendido`, `Comercio no operativo`), en `Flujos/experimental/venta-minima/`.
 *
 * Todas las pruebas son puras y negando: cada caso trae su opuesto. El código se corre con
 * `ejecutar` de `./lib/flujo` (el mismo ayudante que las demás suites de flujos), que le quita
 * los globales que el Code de n8n NO tiene (`URL`, `Buffer`, `crypto`, `process`, `require`…):
 * si algo de acá los usara, reventaría igual que en producción. No hay ningún `new Function` nuevo.
 *
 * El reloj es un parámetro: `AHORA` es el lunes 05/10/2026 a las 10:00 de La Paz. Los teléfonos
 * son sintéticos, con seis ceros.
 *
 * QUÉ SE SUPUSO DE LAS LIBRERÍAS DE OTRAS TAREAS (dobles fieles al contrato §4.2, SOLO acá):
 *   - `avDestinatarios(csv, from, prefijos)`: del CSV `rol:tel[:Nombre]`, `[{rol, tel}]` únicos, de 8
 *     a 15 dígitos, con prefijo permitido y distintos de `from` (con `from` vacío no excluye a nadie);
 *   - `avAnotarEntrante(sd, tel, ahoraMs)`: anota que `tel` escribió (el doble lo deja en
 *     `sd.avVentanas[tel]`, solo para poder comprobar que se llamó);
 *   - `cbCobroReal(cuerpoPanel)`: `{activo, qrUrl, titular, banco, pendiente, monto, pedidoRef,
 *     vencidoHaceMin}` desde `cuerpo.cobro` (`activo` solo con un QR `https://`).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type J, type Referencias } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src');
const COMUN = readFileSync(join(RAIZ, 'lib/comun.js'), 'utf8');
const NODOS = ['carga-de-entrada', 'config-del-negocio', 'interpretar-entrada', 'uso-extendido', 'comercio-no-operativo'] as const;
const FUENTE_NODO = (n: (typeof NODOS)[number]): string => readFileSync(join(RAIZ, `nodos/${n}.js`), 'utf8');

// --- El mundo de las pruebas ------------------------------------------------------------------
// Lunes 05/10/2026, 10:00 en La Paz (UTC-4 fijo).
const AHORA = Date.UTC(2026, 9, 5, 14);
const HORA = 60 * 60 * 1000;
const MIN = 60 * 1000;
const CLIENTE = '59100000021';
const AVISO_1 = '59100000011';
const AVISO_2 = '59100000012';
const PNID = 'pnid-de-prueba';

function relojFijo(ms: number): unknown {
  return class extends Date {
    constructor(...a: unknown[]) { if (a.length === 0) super(ms); else super(...(a as [number])); }
    static override now(): number { return ms; }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const NOMBRES = [
  'vmNodo', 'vmPrimero', 'vmTodos', 'vmCfg', 'vmNorm', 'vmDigitos', 'vmRecorte', 'vmLinea', 'vmLista', 'vmEntero',
  'vmTextoDeGemini', 'vmJsonDeGemini', 'vmTextoSeguro', 'vmSd', 'vmEstadoBase', 'vmLeerEstado', 'vmEscribirEstado',
  'vmBarrer', 'vmYaVisto', 'vmMarcarVisto', 'vmAtencion', 'vmPrefijoPermitido', 'vmIdDeBoton', 'vmLeerBoton',
  'vmCodigoCorto', 'vmHuella', 'vmIdEstable', 'vmFechaLocal', 'vmHoraLocal', 'vmDiaSemana', 'vmMsLocal', 'vmFechaLegible', 'vmTablaDeDias',
  'vmHorario', 'vmAbierto', 'vmHorarioLegible', 'VM_PROHIBIDAS', 'vmCanon', 'vmSinProhibidas',
] as const;
type Lib = Record<(typeof NOMBRES)[number], Fn>;

/** La librería, evaluada con los datos estáticos y las referencias que se le den. */
function lib(raiz: J = {}, referencias: Referencias = {}): Lib {
  return ejecutar(`${COMUN}\nreturn [{ json: { ${NOMBRES.join(', ')} } }];`, [{}], referencias, {
    $getWorkflowStaticData: () => raiz, Date: relojFijo(AHORA),
  })[0] as unknown as Lib;
}
const L = lib();

// Dobles de las librerías de T4 y T6 (ver la cabecera).
const DOBLES = `
function avDestinatarios(csv, from, prefijos) {
  const vistos = {};
  const salida = [];
  for (const parte of String(csv || '').split(',')) {
    const p = parte.split(':');
    const rol = (p[0] || '').trim();
    const tel = vmDigitos(p[1]);
    if (!rol || tel.length < 8 || tel.length > 15 || tel === vmDigitos(from) || vistos[tel]) continue;
    if (!vmPrefijoPermitido(tel, prefijos)) continue;
    vistos[tel] = true;
    salida.push({ rol: rol, tel: tel });
  }
  return salida;
}
function avAnotarEntrante(sd, tel, ahoraMs) {
  if (typeof $fallaAnotar !== 'undefined' && $fallaAnotar) throw new Error('falla simulada');
  if (!sd.avVentanas) sd.avVentanas = {};
  sd.avVentanas[tel] = ahoraMs;
  return true;
}
function cbCobroReal(cuerpo) {
  if (typeof $fallaCobro !== 'undefined' && $fallaCobro) throw new Error('falla simulada');
  const c = (cuerpo && cuerpo.cobro) || {};
  const qr = c.qr || {};
  const activo = c.activo === true && typeof qr.url === 'string' && qr.url.indexOf('https://') === 0;
  return {
    activo: activo, qrUrl: activo ? qr.url : '', titular: qr.nombreCuenta || '', banco: qr.banco || '',
    pendiente: activo && c.pendiente === true, monto: typeof c.monto === 'number' ? c.monto : null,
    pedidoRef: c.pedido || null, vencidoHaceMin: typeof c.vencidoHaceMin === 'number' ? c.vencidoHaceMin : null,
  };
}
`;

interface Mundo { raiz?: J | null; ahoraMs?: number; globales?: Record<string, unknown> }
/** Corre un nodo con la librería común y los dobles pegados delante, como lo hará el constructor. */
function correrNodo(n: (typeof NODOS)[number], entradas: J[], refs: Referencias, m: Mundo = {}): J[] {
  const globales: Record<string, unknown> = { Date: relojFijo(m.ahoraMs ?? AHORA), ...(m.globales ?? {}) };
  if (m.raiz !== null) globales['$getWorkflowStaticData'] = () => m.raiz ?? {};
  return ejecutar(`${DOBLES}\n${COMUN}\n${FUENTE_NODO(n)}`, entradas, refs, globales);
}

// --- Entradas de WhatsApp ----------------------------------------------------------------------
const mensaje = (extra: J = {}): J => ({ from: CLIENTE, id: 'wamid.prueba-1', timestamp: '1', type: 'text', text: { body: 'hola' }, ...extra });
const valor = (msg: J | null, extra: J = {}): J => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '59100000001', phone_number_id: PNID },
  contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: CLIENTE }],
  ...(msg ? { messages: [msg] } : { statuses: [{ id: 'wamid.x', status: 'delivered' }] }),
  ...extra,
});
const sobreMeta = (v: J): J => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba-prueba', changes: [{ field: 'messages', value: v }] }] });

// ================================================================================================
describe('comun.js: texto', () => {
  it('vmNorm: sin tildes, en minúsculas y con la puntuación como espacio', () => {
    expect(L.vmNorm('  ¡PROMO Dúo 2x1!!  🌮 ')).toBe('promo duo 2x1');
    expect(L.vmNorm('Piña—Colada')).toBe('pina colada');
    expect(L.vmNorm(null)).toBe('');
    expect(L.vmNorm(undefined)).toBe('');
    // negativo: las letras no se tocan, solo se comparan sin tildes
    expect(L.vmNorm('taco')).not.toBe(L.vmNorm('tacos'));
  });
  it('vmDigitos y vmRecorte', () => {
    expect(L.vmDigitos('+591 (000) 00-021')).toBe('59100000021');
    expect(L.vmDigitos(null)).toBe('');
    expect(L.vmRecorte('abcdef', 4)).toBe('abc…');
    expect(L.vmRecorte('abcd', 4)).toBe('abcd'); // negativo: justo en el tope no se recorta
    expect(L.vmRecorte('abcdef', 0)).toBe('abcdef'); // sin tope, tal cual
  });
  it('vmLinea: sin controles, saltos, < > & ni espacios dobles; recorta', () => {
    expect(L.vmLinea('  Hola\n\tmundo <b>&amp;  x\u2028y\u0007 ')).toBe('Hola mundo b amp; x y');
    expect(L.vmLinea('a'.repeat(100), 10)).toBe('a'.repeat(9) + '…');
    expect(L.vmLinea(undefined, 10)).toBe('');
    expect(L.vmLinea('Q-tacos 12', 10)).toBe('Q-tacos 12'); // negativo: lo que no es peligroso queda igual
  });
  it('vmLista: arreglo o CSV, sin vacíos, repetidos ni marcadores', () => {
    expect(L.vmLista('Cócteles, cervezas ,, Helados , COCTELES')).toEqual(['Cócteles', 'cervezas', 'Helados']);
    expect(L.vmLista(['salón', ' terraza ', ''])).toEqual(['salón', 'terraza']);
    expect(L.vmLista('REEMPLAZAR_ALGO,jardín')).toEqual(['jardín']);
    expect(L.vmLista('')).toEqual([]);
    expect(L.vmLista(undefined)).toEqual([]);
  });
  it('vmEntero: solo enteros dentro del rango; si no, el valor por omisión', () => {
    expect(L.vmEntero(12, 1, 500, 7)).toBe(12);
    expect(L.vmEntero('12', 1, 500, 7)).toBe(12);
    expect(L.vmEntero(0, 1, 500, 7)).toBe(7);
    expect(L.vmEntero(501, 1, 500, 7)).toBe(7);
    expect(L.vmEntero(1.5, 1, 500, 7)).toBe(7);
    expect(L.vmEntero('abc', 1, 500, 7)).toBe(7);
    expect(L.vmEntero('', 1, 500, 7)).toBe(7);
    expect(L.vmEntero(null, 1, 500, 7)).toBe(7);
  });
  it('vmTextoDeGemini y vmJsonDeGemini: las formas de respuesta y sus negativos', () => {
    const cand = (t: string): J => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
    expect(L.vmTextoDeGemini(cand('hola'))).toBe('hola');
    expect(L.vmTextoDeGemini({ content: 'directo' })).toBe('directo');
    expect(L.vmTextoDeGemini({ content: { parts: [{ text: 'a' }, { text: 'b' }] } })).toBe('a\nb');
    expect(L.vmTextoDeGemini({ text: 'plano' })).toBe('plano');
    expect(L.vmTextoDeGemini({ error: { message: 'x' }, text: 'no' })).toBe('');
    expect(L.vmTextoDeGemini(null)).toBe('');
    expect(L.vmTextoDeGemini({ algo: 1 })).toBe('');
    expect(L.vmJsonDeGemini(cand('{"a":1}'))).toEqual({ a: 1 });
    expect(L.vmJsonDeGemini(cand('```json\n{"a":2}\n```'))).toEqual({ a: 2 });
    expect(L.vmJsonDeGemini(cand('[1,2]'))).toBeNull(); // un arreglo no es un objeto
    expect(L.vmJsonDeGemini(cand('no es json'))).toBeNull();
    expect(L.vmJsonDeGemini({ error: 'x' })).toBeNull();
  });
});

// ================================================================================================
describe('comun.js: red de palabras prohibidas', () => {
  const FRASES = [
    'Tu pedido está validado', 'Tu reserva está confirmada', 'Pago acreditado', 'El pedido está pagado',
    'Ya lo están preparando', 'Ya lo preparan', 'Lo preparamos enseguida', 'Recibimos tu pago', 'Pago verificado',
    'Te avisamos cuando salga', 'Tu pedido va en camino', 'Te llamamos luego', 'Te escribirán pronto', 'Lo consulto y te digo',
    'Ya lo estamos preparando', 'Lo estamos preparando', 'Ya lo estoy preparando',
  ];
  it('el regex es el del contrato, literal', () => {
    expect((L.VM_PROHIBIDAS as unknown as RegExp).source).toBe(
      'validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\\S{0,40} (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(amos|ó|o)\\s+(tu|tus|su|sus|la|el|lo|los|las)\\b|\\b(?:est[aá]n?|qued[oó]|queda|quedan|quedaron|fue|fueron|ya)\\s+(?:ya\\s+)?reservad|reserva\\s+((est[aá]|qued[oó])\\s+)?(registrad|agendad)|reservamos tu|\\b(?:te|le|les|se|lo|la|ya)\\s+confirm(?:o|amos|é|ó|aron)\\b');
    expect((L.VM_PROHIBIDAS as unknown as RegExp).flags).toBe('i');
  });
  it('S3 e I1: las raíces nuevas se atrapan en su contexto de afirmación; «reservado» como dato de una carta o de una zona, no', () => {
    for (const t of ['Ya acreditamos el pago', 'Recibí tu pago', 'Recibimos el pago', 'Pago exitoso', 'Pago recibido', 'Pago aprobado', 'Pago realizado',
      'Pago registrado', 'Confirmó su pedido', 'Te confirmamos la mesa', 'Yo confirmo tu pedido', 'Tu mesa está reservada', 'Tu reserva quedó reservada',
      'Confirmamos tu reserva', 'Tu reserva quedó registrada', 'Reservamos tu mesa', 'Tu reserva está agendada']) {
      expect(L.vmTextoSeguro(t), t).toBe(false);
    }
    for (const t of ['No estamos abiertos hoy', '¿A qué hora reservo?', 'Quiero reservar una mesa', 'Confirmar pedido', 'Recibí tu imagen',
      'Estoy esperando el comprobante de tu pedido', 'Solicitud de reserva', 'El pago se coordina con el cliente al entregar o al recoger.',
      'Vino Tinto Reservado', 'Salón, sala reservada y terraza', 'Mesa reservada para eventos', 'Yo confirmo que llego a las 8']) {
      expect(L.vmTextoSeguro(t), t).toBe(true);
    }
  });
  it('P-2: las raíces de reserva y de «te confirmo» cubren las conjugaciones comunes; los datos de una carta o de una zona no', () => {
    for (const t of ['Te confirmo que la mesa está lista', 'Ya lo confirmamos', 'El restaurante te confirmó', 'Tu mesa fue reservada',
      'Tu mesa queda reservada', 'Quedaron reservadas las mesas', 'Las mesas están reservadas', 'Ya reservadas', 'Les confirmamos todo',
      'Se confirmaron los datos', 'Tu mesa ya está ya reservada']) {
      expect(L.vmTextoSeguro(t), t).toBe(false);
    }
    for (const t of ['Mesa reservada para 4', 'Zona reservada', 'Hotel Reservado', 'Vino Tinto Reservado', 'Playa Reservada', 'Confirmo que sí',
      'Quiero confirmar mi pedido', 'Mesa para 4 personas']) {
      expect(L.vmTextoSeguro(t), t).toBe(true);
    }
    // «Confirmo la dirección» ya caía antes de P-2 (`confirm(o)\s+la\b`, S3): no es un efecto nuevo.
    expect(L.vmTextoSeguro('Confirmo la dirección')).toBe(false);
  });
  it('P-3: los invisibles que NFKC deja como letras (U+3164, U+115F, U+1160, U+FFA0, U+2800) no esconden una palabra', () => {
    for (const c of ['ㅤ', 'ᅟ', 'ᅠ', 'ﾠ', '⠀']) {
      const t = `Tu pedido pa${c}gado`;
      expect(L.vmTextoSeguro(t), JSON.stringify(c)).toBe(false);
      expect(L.vmCanon(t), JSON.stringify(c)).toContain('pagado');
    }
    expect(L.vmTextoSeguro('Tu pedido va a salir')).toBe(true);
  });
  it('S3: se compara en NFKC y sin caracteres de formato (ancho cero, guion blando, ancho completo)', () => {
    for (const t of ['va​lidado', 'val­idado', 'ｖａｌｉｄａｄｏ', 'pa⁠gado', 'v‮alidado', 'con‍firmado']) {
      expect(L.vmTextoSeguro(`Tu pedido ${t}`), JSON.stringify(t)).toBe(false);
      expect((L.VM_PROHIBIDAS as unknown as RegExp).test(L.vmNorm(`Tu pedido ${t}`)), JSON.stringify(t)).toBe(true);
    }
    // Negativo: un emoji con unión de ancho cero y un texto normal siguen siendo seguros.
    expect(L.vmTextoSeguro('Tu pedido 👨‍🍳 va a salir'), 'emoji compuesto').toBe(true);
    expect(L.vmTextoSeguro('Tu pedido está en la cocina'), 'texto normal').toBe(true);
  });
  it('«estamos» no es una palabra prohibida por sí sola: solo «lo estamos preparando» y sus formas', () => {
    for (const t of ['No estamos abiertos hoy', 'Estamos en la calle Principal', 'Estamos para ayudarte', 'Estoy aquí para ayudarte']) {
      expect(L.vmTextoSeguro(t), t).toBe(true);
    }
  });
  it('atrapa las frases prohibidas (también con otras mayúsculas) y deja pasar los textos fijos del diseño', () => {
    for (const f of FRASES) {
      expect(L.vmTextoSeguro(f), f).toBe(false);
      expect(L.vmTextoSeguro(f.toUpperCase()), f).toBe(false);
    }
    const LIMPIOS = [
      '¡Hola! Soy el asistente virtual de Q. ¿Qué quieres hacer?',
      'Recibí tu comprobante y los datos coinciden con tu pedido #AB12. Ya pasé tu pedido al restaurante; ellos revisan el pago en su banco antes de despacharlo.',
      'Listo: pasé tu pedido #AB12 al restaurante. El pago lo coordinas con ellos al recoger.',
      'Todavía es una solicitud: el restaurante la revisa según sus mesas.',
      'Revisen el pago en su banco antes de despachar.',
      'Eso lo ve directamente el restaurante. Toca el botón para escribirles.',
      'Confirmar pedido', 'Cambiar algo', 'Enviar solicitud',
    ];
    for (const t of LIMPIOS) expect(L.vmTextoSeguro(t), t).toBe(true);
  });
  it('lo que no es un texto no es seguro', () => {
    expect(L.vmTextoSeguro(undefined)).toBe(false);
    expect(L.vmTextoSeguro(null)).toBe(false);
    expect(L.vmTextoSeguro(5)).toBe(false);
    expect(L.vmTextoSeguro('')).toBe(true);
  });
});

// ================================================================================================
describe('comun.js: nodos de n8n por nombre', () => {
  const refs: Referencias = {
    'Config del negocio': { moneda: 'BOB' },
    'Lista': [{ a: 1 }, { a: 2 }],
  };
  const R = lib({}, refs);
  it('vmPrimero, vmTodos y vmCfg leen lo que corrió', () => {
    expect(R.vmPrimero('Config del negocio')).toEqual({ moneda: 'BOB' });
    expect(R.vmCfg()).toEqual({ moneda: 'BOB' });
    expect(R.vmTodos('Lista')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(R.vmPrimero('Lista')).toEqual({ a: 1 });
  });
  it('un nodo que no corrió (o no existe en este JSON) da null, [] y {}', () => {
    expect(R.vmNodo('Entrada de prueba')).toBeNull();
    expect(R.vmPrimero('Entrada de prueba')).toBeNull();
    expect(R.vmTodos('Entrada de prueba')).toEqual([]);
    expect(L.vmCfg()).toEqual({});
  });
});

// ================================================================================================
describe('comun.js: datos estáticos, estado por teléfono y repetidos', () => {
  it('vmSd crea las tres claves (estados, vistos, pedidos) y devuelve siempre el mismo objeto', () => {
    const raiz: J = {};
    const A = lib(raiz);
    const sd = A.vmSd();
    expect(sd).toEqual({ estados: {}, vistos: {}, pedidos: {}, reservasDelDia: {} }); // la cuarta es de reserva.js (T3)
    expect(raiz['ventaMinima']).toBe(sd);
    sd.estados['59100000021'] = { paso: 'menu' };
    expect(A.vmSd().estados['59100000021']).toEqual({ paso: 'menu' });
  });
  it('vmSd completa lo que falte sin pisar lo que hay, y repara una clave que no es objeto', () => {
    const raiz: J = { ventaMinima: { estados: { x: 1 }, vistos: [] } };
    const sd = lib(raiz).vmSd();
    expect(sd.estados).toEqual({ x: 1 });
    expect(sd.vistos).toEqual({});
    expect(sd.pedidos).toEqual({});
  });
  it('vmSd da null sin datos estáticos', () => {
    const sinSd = ejecutar(`${COMUN}\nreturn [{ json: { sd: vmSd() } }];`, [{}])[0]!;
    expect(sinSd['sd']).toBeNull();
  });

  it('vmLeerEstado: el de partida si no hay; el vigente es una copia', () => {
    const A = lib();
    const sd = A.vmSd();
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA)).toEqual(A.vmEstadoBase());
    expect(A.vmEstadoBase().paso).toBe('inicio');
    A.vmEscribirEstado(sd, CLIENTE, { ...A.vmEstadoBase(), paso: 'pedido', carrito: [{ id: 'a', cantidad: 2 }] }, AHORA);
    const e = A.vmLeerEstado(sd, CLIENTE, AHORA + 5 * MIN);
    expect(e.paso).toBe('pedido');
    expect(e.carrito).toEqual([{ id: 'a', cantidad: 2 }]);
    expect(e.ultimoMensajeMs).toBe(AHORA);
    e.carrito.push({ id: 'b' }); // mutar la copia no toca lo guardado
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA).carrito).toHaveLength(1);
  });
  it('el estado vence a los 60 minutos; esperando_comprobante dura 24 horas', () => {
    const A = lib();
    const sd = A.vmSd();
    A.vmEscribirEstado(sd, CLIENTE, { ...A.vmEstadoBase(), paso: 'pedido_confirmar' }, AHORA);
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA + 59 * MIN).paso).toBe('pedido_confirmar');
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA + 60 * MIN).paso).toBe('inicio');
    A.vmEscribirEstado(sd, CLIENTE, { ...A.vmEstadoBase(), paso: 'esperando_comprobante' }, AHORA);
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA + 23 * HORA).paso).toBe('esperando_comprobante');
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA + 24 * HORA).paso).toBe('inicio');
  });
  it('dos teléfonos no comparten estado', () => {
    const A = lib();
    const sd = A.vmSd();
    A.vmEscribirEstado(sd, CLIENTE, { ...A.vmEstadoBase(), paso: 'reserva' }, AHORA);
    expect(A.vmLeerEstado(sd, '59100000022', AHORA).paso).toBe('inicio');
    expect(A.vmLeerEstado(sd, CLIENTE, AHORA).paso).toBe('reserva');
  });
  it('una clave que no es un teléfono ni se lee ni se escribe (nada de __proto__)', () => {
    const A = lib();
    const sd = A.vmSd();
    for (const mala of ['__proto__', 'constructor', '', 'abc', '12345', undefined]) {
      expect(A.vmEscribirEstado(sd, mala, A.vmEstadoBase(), AHORA), String(mala)).toBe(false);
      expect(A.vmLeerEstado(sd, mala, AHORA)).toEqual(A.vmEstadoBase());
    }
    expect(Object.keys(sd.estados)).toEqual([]);
    expect(A.vmEscribirEstado(null, CLIENTE, A.vmEstadoBase(), AHORA)).toBe(false);
    expect(A.vmEscribirEstado(sd, CLIENTE, A.vmEstadoBase(), Number.NaN)).toBe(false);
    expect(A.vmEscribirEstado(sd, CLIENTE, [], AHORA)).toBe(false);
    expect(A.vmLeerEstado(null, CLIENTE, AHORA)).toEqual(A.vmEstadoBase());
  });

  it('vmBarrer: quita estados vencidos y repetidos de más de 24 h, y NO barre los pedidos', () => {
    const A = lib();
    const sd = A.vmSd();
    sd.estados['59100000021'] = { ...A.vmEstadoBase(), paso: 'pedido', ultimoMensajeMs: AHORA - 2 * HORA };
    sd.estados['59100000022'] = { ...A.vmEstadoBase(), paso: 'esperando_comprobante', ultimoMensajeMs: AHORA - 2 * HORA };
    sd.estados['59100000023'] = { ...A.vmEstadoBase(), paso: 'pedido', ultimoMensajeMs: AHORA - 5 * MIN };
    sd.vistos['wamid.viejo'] = AHORA - 25 * HORA;
    sd.vistos['wamid.nuevo'] = AHORA - 1 * HORA;
    sd.pedidos['ped-viejo'] = { total: 55, creadoMs: AHORA - 100 * HORA };
    sd.reservasDelDia['59100000021'] = { dia: '2026-10-01', n: 2 };
    const r = A.vmBarrer(sd, AHORA);
    expect(r).toEqual({ estados: 1, vistos: 1 });
    expect(Object.keys(sd.estados).sort()).toEqual(['59100000022', '59100000023']);
    expect(Object.keys(sd.vistos)).toEqual(['wamid.nuevo']);
    expect(Object.keys(sd.pedidos)).toEqual(['ped-viejo']); // los barre T7b con 72 h
    expect(sd.reservasDelDia).toEqual({ '59100000021': { dia: '2026-10-01', n: 2 } }); // la limpia reserva.js, no el barrido
    expect(A.vmBarrer(null, AHORA)).toEqual({ estados: 0, vistos: 0 });
  });
  it('vmBarrer recorta cada mapa a su tope y se van los más viejos', () => {
    const A = lib();
    const sd = A.vmSd();
    for (let i = 0; i < 1005; i++) {
      sd.estados[String(59100000000 + i)] = { ...A.vmEstadoBase(), paso: 'pedido', ultimoMensajeMs: AHORA - i * 1000 };
    }
    for (let i = 0; i < 2010; i++) sd.vistos[`wamid.${i}`] = AHORA - i * 1000;
    A.vmBarrer(sd, AHORA);
    expect(Object.keys(sd.estados)).toHaveLength(1000);
    expect(sd.estados[String(59100000000 + 1004)]).toBeUndefined();
    expect(sd.estados[String(59100000000)]).toBeDefined();
    expect(Object.keys(sd.vistos)).toHaveLength(2000);
    expect(sd.vistos['wamid.2009']).toBeUndefined();
    expect(sd.vistos['wamid.0']).toBeDefined();
  });

  it('vmYaVisto y vmMarcarVisto: la memoria dura 24 horas', () => {
    const A = lib();
    const sd = A.vmSd();
    expect(A.vmYaVisto(sd, 'wamid.1', AHORA)).toBe(false);
    expect(A.vmMarcarVisto(sd, 'wamid.1', AHORA)).toBe(true);
    expect(A.vmYaVisto(sd, 'wamid.1', AHORA)).toBe(true);
    expect(A.vmYaVisto(sd, 'wamid.2', AHORA)).toBe(false); // otro id pasa
    expect(A.vmYaVisto(sd, 'wamid.1', AHORA + 23 * HORA)).toBe(true);
    expect(A.vmYaVisto(sd, 'wamid.1', AHORA + 24 * HORA)).toBe(false);
  });
  it('un id vacío o raro nunca cuenta como visto ni se anota', () => {
    const A = lib();
    const sd = A.vmSd();
    for (const malo of ['', '__proto__', 'constructor', 'prototype', undefined, null, 5, 'a'.repeat(301)]) {
      expect(A.vmMarcarVisto(sd, malo, AHORA), String(malo)).toBe(false);
      expect(A.vmYaVisto(sd, malo, AHORA), String(malo)).toBe(false);
    }
    expect(Object.keys(sd.vistos)).toEqual([]);
    expect(A.vmMarcarVisto(null, 'wamid.1', AHORA)).toBe(false);
    expect(A.vmYaVisto(null, 'wamid.1', AHORA)).toBe(false);
    expect(A.vmMarcarVisto(sd, 'wamid.1', Number.NaN)).toBe(false);
  });
});

// ================================================================================================
describe('comun.js: atención y prefijo', () => {
  it('vmAtencion: lo de la ingesta manda sobre la configuración; ante la duda, normal', () => {
    expect(L.vmAtencion(null, {})).toEqual({ estado: 'normal', avisar: '', mensajeFijo: '', respuestas: 0, venceEn: '' });
    const cfg = { atencionEstado: 'operador', atencionAvisarRecepcion: 'operador', atencionMensajeFijo: 'De la config', atencionRespuestas: 25, atencionVenceEn: 'x' };
    expect(L.vmAtencion(null, cfg)).toEqual({ estado: 'operador', avisar: 'operador', mensajeFijo: 'De la config', respuestas: 25, venceEn: 'x' });
    const ingesta = { atencion: { estado: 'bloqueado', avisarRecepcion: 'bloqueado', mensajeFijo: 'De la ingesta', respuestasEnVentana: 50, ventanaVenceEn: 'y' } };
    expect(L.vmAtencion(ingesta, cfg)).toEqual({ estado: 'bloqueado', avisar: 'bloqueado', mensajeFijo: 'De la ingesta', respuestas: 50, venceEn: 'y' });
    expect(L.vmAtencion({ atencion: { estado: 'cualquiera' } }, {}).estado).toBe('normal');
    expect(L.vmAtencion(null, { atencionEstado: 'raro' }).estado).toBe('normal');
    expect(L.vmAtencion(null, { atencionAvisarRecepcion: 'otro' }).avisar).toBe('');
  });
  it('vmPrefijoPermitido: 591 sí, otros países no, y sin prefijos no se permite nada', () => {
    expect(L.vmPrefijoPermitido('59100000021', '591')).toBe(true);
    expect(L.vmPrefijoPermitido('+591 000 00021', '591')).toBe(true);
    expect(L.vmPrefijoPermitido('54900000021', '591')).toBe(false);
    expect(L.vmPrefijoPermitido('54900000021', '591, 54')).toBe(true);
    expect(L.vmPrefijoPermitido('59100000021', '')).toBe(false);
    expect(L.vmPrefijoPermitido('59100000021', undefined)).toBe(false);
    expect(L.vmPrefijoPermitido('', '591')).toBe(false);
    expect(L.vmPrefijoPermitido('1591000000', '591')).toBe(false); // empieza con, no contiene
  });
});

// ================================================================================================
describe('comun.js: botones y códigos', () => {
  it('vmIdDeBoton arma los ids del diseño y vmLeerBoton los lee de vuelta', () => {
    expect(L.vmIdDeBoton('m', 'pedido')).toBe('m|pedido');
    expect(L.vmIdDeBoton('g', 'pedir', 'item-7_a.b')).toBe('g|pedir|item-7_a.b');
    expect(L.vmIdDeBoton('f', '0', 'orden', 'unidad')).toBe('f|0|orden|unidad');
    expect(L.vmLeerBoton('g|pedir|item-7_a.b')).toEqual({ tipo: 'g', partes: ['pedir', 'item-7_a.b'] });
    expect(L.vmLeerBoton('m')).toEqual({ tipo: 'm', partes: [] });
    expect(L.vmLeerBoton(L.vmIdDeBoton('e', 'delivery'))).toEqual({ tipo: 'e', partes: ['delivery'] });
  });
  it('un carácter inválido en el tipo o en una parte da null: nunca se recorta ni se "arregla"', () => {
    expect(L.vmIdDeBoton('g', 'pedir', 'con espacio')).toBeNull();
    expect(L.vmIdDeBoton('g', 'pedir|otro')).toBeNull();
    expect(L.vmIdDeBoton('g', 'pedir', 'ñandú')).toBeNull();
    expect(L.vmIdDeBoton('g', 'pedir', '')).toBeNull();
    expect(L.vmIdDeBoton('g', 'pedir', undefined)).toBeNull();
    expect(L.vmIdDeBoton('', 'x')).toBeNull();
    expect(L.vmIdDeBoton('tipo con espacio', 'x')).toBeNull();
    expect(L.vmIdDeBoton('g|h', 'x')).toBeNull();
  });
  it('el límite es 256 caracteres: 256 pasa, 257 es null, y una parte de más de 200 es null', () => {
    const justo = L.vmIdDeBoton('g', 'a'.repeat(200), 'b'.repeat(53));
    expect(justo).toHaveLength(256);
    expect(L.vmIdDeBoton('g', 'a'.repeat(200), 'b'.repeat(54))).toBeNull();
    expect(L.vmIdDeBoton('g', 'a'.repeat(201))).toBeNull();
    expect(L.vmLeerBoton(justo)).not.toBeNull();
    expect(L.vmLeerBoton(`${justo}c`)).toBeNull();
  });
  it('vmLeerBoton rechaza lo que un cliente pudo falsificar', () => {
    for (const malo of ['', '|', 'g||x', 'g|con espacio', 'g|<script>', 'tipo muy largo de mas de veinte|x', undefined, null, 5]) {
      expect(L.vmLeerBoton(malo), String(malo)).toBeNull();
    }
  });
  it('vmCodigoCorto: 4 caracteres en base 36 y mayúsculas, determinista', () => {
    const c = L.vmCodigoCorto(AHORA);
    expect(c).toMatch(/^[0-9A-Z]{4}$/);
    expect(L.vmCodigoCorto(AHORA)).toBe(c);
    expect(L.vmCodigoCorto(AHORA + 1)).not.toBe(c);
    expect(L.vmCodigoCorto(0)).toBe('0000');
    expect(L.vmCodigoCorto(35)).toBe('000Z');
    expect(L.vmCodigoCorto(undefined)).toBe('0000');
    expect(L.vmCodigoCorto(36 ** 4 + 5)).toBe('0005'); // se queda con los 4 últimos
  });
  it('vmHuella: FNV-1a de 32 bits (vectores de referencia), sin signo y determinista', () => {
    expect(L.vmHuella('')).toBe(0x811c9dc5);
    expect(L.vmHuella('a')).toBe(0xe40c292c);
    expect(L.vmHuella('foobar')).toBe(0xbf9cf968);
    expect(L.vmHuella('foobar')).toBe(L.vmHuella('foobar'));
    expect(L.vmHuella('foobaR')).not.toBe(L.vmHuella('foobar'));
    for (const v of ['á', '😀', { a: 1 }, [1, 2], null, undefined, 7]) {
      const h = L.vmHuella(v);
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, String(v)).toBe(true);
    }
  });
  it('vmHuella de un objeto no depende del orden de sus claves, pero sí de sus valores y del orden de una lista', () => {
    expect(L.vmHuella({ a: 1, b: { c: 2, d: 3 } })).toBe(L.vmHuella({ b: { d: 3, c: 2 }, a: 1 }));
    expect(L.vmHuella({ a: 1, x: undefined })).toBe(L.vmHuella({ a: 1 }));
    expect(L.vmHuella({ a: 1 })).not.toBe(L.vmHuella({ a: 2 }));
    expect(L.vmHuella([1, 2])).not.toBe(L.vmHuella([2, 1]));
    expect(L.vmHuella({ a: '1' })).not.toBe(L.vmHuella({ a: 1 }));
  });
  it('vmIdEstable: el id es <prefijo>-<fecha de La Paz del ancla>-<ultimos 4>-<huella>, y el codigo son 4 caracteres de la misma huella', () => {
    const k = L.vmIdEstable('ped', '59100000011', [{ id: 'x', cantidad: 1 }], AHORA, AHORA + 5);
    expect(k.id).toMatch(/^ped-2026-10-05-0011-[0-9a-z]{7}$/);
    expect(k.codigo).toMatch(/^[0-9A-Z]{4}$/);
    expect(k.codigo).toBe(L.vmCodigoCorto(k.huella));
    expect(k.id.endsWith(k.huella.toString(36).padStart(7, '0'))).toBe(true);
    // la fecha es la del ANCLA (11:00 del 06/10 en La Paz = 15:00 UTC; 23:59 del 05/10 en La Paz = 03:59 UTC del 06/10)
    expect(L.vmIdEstable('res', '59100000011', {}, Date.UTC(2026, 9, 6, 3, 59), AHORA).id).toMatch(/^res-2026-10-05-0011-/);
    expect(L.vmIdEstable('res', '59100000011', {}, Date.UTC(2026, 9, 6, 4, 0), AHORA).id).toMatch(/^res-2026-10-06-0011-/);
  });
  it('vmIdEstable: el reloj de respaldo solo cuenta si no hay ancla; con ancla, el reloj no cambia nada', () => {
    const a = L.vmIdEstable('ped', '59100000011', 'x', AHORA, 1);
    expect(L.vmIdEstable('ped', '59100000011', 'x', AHORA, 999_999).id).toBe(a.id);
    expect(L.vmIdEstable('ped', '59100000011', 'x', AHORA, 999_999).codigo).toBe(a.codigo);
    // negando: sin ancla (0, NaN, texto, ausente) manda el respaldo
    for (const mala of [0, NaN, 'x', '12', undefined, null, -1]) {
      expect(L.vmIdEstable('ped', '59100000011', 'x', mala, AHORA).id, String(mala)).toBe(L.vmIdEstable('ped', '59100000011', 'x', undefined, AHORA).id);
    }
    expect(L.vmIdEstable('ped', '59100000011', 'x', 0, AHORA + 1).id).not.toBe(L.vmIdEstable('ped', '59100000011', 'x', 0, AHORA).id);
    // cada ingrediente cambia la clave
    expect(L.vmIdEstable('res', '59100000011', 'x', AHORA).id.slice(4)).not.toBe(a.id.slice(4)); // otro prefijo (misma fecha y ultimos 4)
    expect(L.vmIdEstable('ped', '59100000011', 'x', AHORA + 1, 1).id).not.toBe(a.id);
    expect(L.vmIdEstable('ped', '59100000012', 'x', AHORA, 1).id).not.toBe(a.id);
    expect(L.vmIdEstable('ped', '59100000011', 'y', AHORA, 1).id).not.toBe(a.id);
  });
});

// ================================================================================================
describe('comun.js: fechas (La Paz, UTC-4 fijo)', () => {
  it('vmFechaLocal y vmHoraLocal: el lunes 05/10 a las 10:00, y los bordes de medianoche', () => {
    expect(L.vmFechaLocal(AHORA)).toBe('2026-10-05');
    expect(L.vmHoraLocal(AHORA)).toBe('10:00');
    expect(L.vmFechaLocal(Date.UTC(2026, 9, 6, 3, 59))).toBe('2026-10-05'); // 23:59 en La Paz
    expect(L.vmHoraLocal(Date.UTC(2026, 9, 6, 3, 59))).toBe('23:59');
    expect(L.vmFechaLocal(Date.UTC(2026, 9, 6, 4, 0))).toBe('2026-10-06'); // medianoche en La Paz
    expect(L.vmHoraLocal(Date.UTC(2026, 9, 6, 4, 0))).toBe('00:00');
  });
  it('vmDiaSemana: lo calcula el código; una fecha que no existe es null', () => {
    expect(L.vmDiaSemana('2026-10-05')).toBe('lunes');
    expect(L.vmDiaSemana('2026-10-09')).toBe('viernes');
    expect(L.vmDiaSemana('2026-10-07')).toBe('miércoles');
    expect(L.vmDiaSemana('2026-10-10')).toBe('sábado');
    expect(L.vmDiaSemana('2026-10-11')).toBe('domingo');
    for (const mala of ['2026-02-30', '2026-13-01', '2026-10-5', 'mañana', '', null, undefined, 20261005]) {
      expect(L.vmDiaSemana(mala), String(mala)).toBeNull();
    }
  });
  it('vmMsLocal: hora de La Paz a instante; NaN si no se entiende', () => {
    expect(L.vmMsLocal('2026-10-05', '10:00')).toBe(AHORA);
    expect(L.vmMsLocal('2026-10-05', '9:30')).toBe(Date.UTC(2026, 9, 5, 13, 30));
    expect(L.vmMsLocal('2026-10-05')).toBe(Date.UTC(2026, 9, 5, 4));
    expect(L.vmMsLocal('2026-10-05', '24:00')).toBe(Date.UTC(2026, 9, 6, 4));
    for (const [f, h] of [['2026-02-30', '10:00'], ['2026-10-05', '25:00'], ['2026-10-05', '10:61'], ['2026-10-05', 'tarde'], ['x', '10:00']]) {
      expect(Number.isNaN(L.vmMsLocal(f, h)), `${f} ${h}`).toBe(true);
    }
  });
  it('vmFechaLegible: «viernes 9 de octubre a las 20:00»', () => {
    expect(L.vmFechaLegible('2026-10-09', '20:00')).toBe('viernes 9 de octubre a las 20:00');
    expect(L.vmFechaLegible('2026-10-09', '8:05')).toBe('viernes 9 de octubre a las 08:05');
    expect(L.vmFechaLegible('2026-10-09')).toBe('viernes 9 de octubre');
    expect(L.vmFechaLegible('2026-10-09', 'tarde')).toBe('viernes 9 de octubre');
    expect(L.vmFechaLegible('2026-11-01', '12:00')).toBe('domingo 1 de noviembre a las 12:00');
    expect(L.vmFechaLegible('2026-02-30', '12:00')).toBe('');
    expect(L.vmFechaLegible('', '12:00')).toBe('');
  });
  it('vmTablaDeDias: 14 días desde hoy con {fecha, dia, texto, relativo}', () => {
    const t = L.vmTablaDeDias(AHORA, 14);
    expect(t).toHaveLength(14);
    expect(t[0]).toEqual({ fecha: '2026-10-05', dia: 'lunes', texto: 'lunes 5 de octubre', relativo: 'hoy' });
    expect(t[1]).toEqual({ fecha: '2026-10-06', dia: 'martes', texto: 'martes 6 de octubre', relativo: 'mañana' });
    expect(t[4]).toEqual({ fecha: '2026-10-09', dia: 'viernes', texto: 'viernes 9 de octubre', relativo: '' });
    expect(t[13]!.fecha).toBe('2026-10-18');
    expect(Object.keys(t[0]!).sort()).toEqual(['dia', 'fecha', 'relativo', 'texto']);
    expect(L.vmTablaDeDias(AHORA)).toHaveLength(14); // 14 por omisión
    expect(L.vmTablaDeDias(AHORA, 3)).toHaveLength(3);
  });
  it('vmTablaDeDias: cruza el fin de mes y hoy es el día de La Paz, no el de UTC', () => {
    const fin = L.vmTablaDeDias(Date.UTC(2026, 9, 30, 14), 4);
    expect(fin.map((d: J) => d['fecha'])).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(fin[2]!['dia']).toBe('domingo');
    // 01:00 UTC del 6 son las 21:00 del 5 en La Paz: hoy sigue siendo el 5
    expect(L.vmTablaDeDias(Date.UTC(2026, 9, 6, 1), 2)[0]!['fecha']).toBe('2026-10-05');
  });
});

// ================================================================================================
describe('comun.js: horario', () => {
  const CSV = 'lun=12:00-22:00,mar=12:00-22:00,mie=12:00-22:00,jue=12:00-22:00,vie=12:00-23:00,sab=12:00-23:00,dom=cerrado';
  it('vmHorario convierte el CSV en {lun:[{desde,hasta}], …}', () => {
    const h = L.vmHorario(CSV);
    expect(h.lun).toEqual([{ desde: '12:00', hasta: '22:00' }]);
    expect(h.vie).toEqual([{ desde: '12:00', hasta: '23:00' }]);
    expect(h.dom).toEqual([]);
    expect(Object.keys(h).sort()).toEqual(['dom', 'jue', 'lun', 'mar', 'mie', 'sab', 'vie']);
  });
  it('acepta nombres largos o con tilde, mayúsculas, espacios, dos tramos y 24:00', () => {
    const h = L.vmHorario(' Lunes = 12:00-15:00 / 18:00-24:00 , MIÉRCOLES=9:00-17:00, domingo=Cerrado ');
    expect(h.lun).toEqual([{ desde: '12:00', hasta: '15:00' }, { desde: '18:00', hasta: '24:00' }]);
    expect(h.mie).toEqual([{ desde: '09:00', hasta: '17:00' }]);
    expect(h.dom).toEqual([]);
    expect(h.mar).toEqual([]); // un día que no se nombra queda cerrado
  });
  it('acepta un objeto ya convertido (arreglos o textos por día) y devuelve la misma forma', () => {
    const conv = L.vmHorario(CSV);
    expect(L.vmHorario(conv)).toEqual(conv);
    expect(L.vmHorario({ lun: '12:00-22:00', dom: 'cerrado' }).lun).toEqual([{ desde: '12:00', hasta: '22:00' }]);
    expect(L.vmHorario({ lun: [{ desde: '9:00', hasta: '13:00' }], _nota: 'texto' }).lun).toEqual([{ desde: '09:00', hasta: '13:00' }]);
  });
  it('devuelve null si algo no se entiende', () => {
    const MALOS = [
      '', '   ', null, undefined, 5, 'lunes 12:00-22:00', 'lun=25:00-26:00', 'lun=12:00-10:00', 'lun=12:00-12:00',
      'xyz=12:00-22:00', 'lun=12:00-22:00,lun=13:00-14:00', 'lun=12:00-15:00/14:00-18:00', 'lun=12-22', 'lun=12:00-22:00-23:00',
      'lun=12:00-22:61', 'lun=24:00-24:00', 'lun=22:00-02:00',
      { lun: [{ desde: '12:00' }] }, { lun: [{ desde: '12:00', hasta: '11:00' }] }, { lun: 5 }, { fiesta: 'cerrado' }, {}, [],
    ];
    for (const m of MALOS) expect(L.vmHorario(m), JSON.stringify(m)).toBeNull();
  });
  it('vmAbierto: dentro del tramo sí (el cierre no cuenta), fuera no, y sabe si hoy es un día cerrado', () => {
    const lunes = (h: number, m = 0): number => Date.UTC(2026, 9, 5, h + 4, m);
    expect(L.vmAbierto(CSV, AHORA)).toEqual({ abierto: false, hoyCerrado: false, sinHorario: false }); // 10:00, abre a las 12
    expect(L.vmAbierto(CSV, lunes(12)).abierto).toBe(true);
    expect(L.vmAbierto(CSV, lunes(21, 59)).abierto).toBe(true);
    expect(L.vmAbierto(CSV, lunes(22)).abierto).toBe(false);
    expect(L.vmAbierto(CSV, lunes(11, 59)).abierto).toBe(false);
    const domingo = Date.UTC(2026, 9, 4, 16); // 12:00 del domingo
    expect(L.vmAbierto(CSV, domingo)).toEqual({ abierto: false, hoyCerrado: true, sinHorario: false });
    const partido = 'lun=12:00-15:00/18:00-22:00';
    expect(L.vmAbierto(partido, lunes(16)).abierto).toBe(false);
    expect(L.vmAbierto(partido, lunes(19)).abierto).toBe(true);
    expect(L.vmAbierto(L.vmHorario(CSV), lunes(13)).abierto).toBe(true); // también con el objeto convertido
  });
  it('vmAbierto(null) y un horario que no se entiende: abierto, con sinHorario', () => {
    expect(L.vmAbierto(null, AHORA)).toEqual({ abierto: true, hoyCerrado: false, sinHorario: true });
    expect(L.vmAbierto('', AHORA).sinHorario).toBe(true);
    expect(L.vmAbierto('lun=25:00-26:00', AHORA)).toEqual({ abierto: true, hoyCerrado: false, sinHorario: true });
    expect(L.vmAbierto(CSV, AHORA).sinHorario).toBe(false); // negativo: con horario no es sinHorario
  });
});

// ================================================================================================
describe('comun.js: el horario de dos tramos de Q\'Taco (lunes a viernes 12:00-16:00 y 18:00-22:00; sábado y domingo 12:00-22:00)', () => {
  const QT = 'lun=12:00-16:00/18:00-22:00,mar=12:00-16:00/18:00-22:00,mie=12:00-16:00/18:00-22:00,jue=12:00-16:00/18:00-22:00,vie=12:00-16:00/18:00-22:00,sab=12:00-22:00,dom=12:00-22:00';
  // Hora local de La Paz (UTC-4) de un día de octubre de 2026: 5 = lunes, 9 = viernes, 10 = sábado, 11 = domingo.
  const en = (dia: number, h: number, m = 0): number => Date.UTC(2026, 9, dia, h + 4, m);
  it('vmHorario lo entiende: dos tramos de lunes a viernes y uno el fin de semana', () => {
    const h = L.vmHorario(QT);
    for (const d of ['lun', 'mar', 'mie', 'jue', 'vie']) expect(h[d], d).toEqual([{ desde: '12:00', hasta: '16:00' }, { desde: '18:00', hasta: '22:00' }]);
    for (const d of ['sab', 'dom']) expect(h[d], d).toEqual([{ desde: '12:00', hasta: '22:00' }]);
  });
  it('entre semana: abierto en cada tramo y CERRADO en el hueco de 16:00 a 18:00 (bordes incluidos)', () => {
    for (const dia of [5, 6, 7, 8, 9]) {
      for (const [h, m] of [[12, 0], [15, 59], [18, 0], [21, 59]] as const) expect(L.vmAbierto(QT, en(dia, h, m)).abierto, `${dia} ${h}:${m}`).toBe(true);
      for (const [h, m] of [[11, 59], [16, 0], [16, 1], [17, 0], [17, 59], [22, 0], [23, 0]] as const) expect(L.vmAbierto(QT, en(dia, h, m)).abierto, `${dia} ${h}:${m}`).toBe(false);
    }
  });
  it('sábado y domingo no tienen hueco: a las 17:00 está abierto, a las 22:00 no', () => {
    for (const dia of [10, 11]) {
      expect(L.vmAbierto(QT, en(dia, 17)).abierto, String(dia)).toBe(true);
      expect(L.vmAbierto(QT, en(dia, 12)).abierto, String(dia)).toBe(true);
      expect(L.vmAbierto(QT, en(dia, 11, 59)).abierto, String(dia)).toBe(false);
      expect(L.vmAbierto(QT, en(dia, 22)).abierto, String(dia)).toBe(false);
    }
    expect(L.vmAbierto(QT, en(10, 17)).hoyCerrado).toBe(false);
  });
  it('NEGANDO: un tramo mal formado, pisado o pegado con otro separador NO se entiende (null), y con eso no se bloquea ningún pedido', () => {
    for (const mal of [
      'lun=12:00-16:00/18:00-22', 'lun=12:00-16:00/', 'lun=12:00-16:00//18:00-22:00', 'lun=12:00-16:00/18:00', 'lun=12:00-18:00/16:00-22:00',
      'lun=12:00-16:00/15:00-22:00', 'lun=12:00-16:00 y 18:00-22:00', 'lun=12:00-16:00;18:00-22:00', 'lun=12:00-16:00,18:00-22:00',
      'lun=16:00-12:00/18:00-22:00', 'lun=12:00-16:00/22:00-18:00',
    ]) {
      expect(L.vmHorario(mal), mal).toBeNull();
      expect(L.vmAbierto(mal, en(5, 17)), mal).toEqual({ abierto: true, hoyCerrado: false, sinHorario: true });
    }
  });
  it('los tramos escritos en otro orden dan el mismo horario', () => {
    expect(L.vmHorario('lun=18:00-22:00/12:00-16:00')).toEqual(L.vmHorario('lun=12:00-16:00/18:00-22:00'));
  });
  it('vmHorarioLegible: el texto en palabras, juntando los días seguidos que abren igual', () => {
    expect(L.vmHorarioLegible(QT)).toBe('lunes a viernes de 12:00 a 16:00 y de 18:00 a 22:00; sábado y domingo de 12:00 a 22:00');
    expect(L.vmHorarioLegible('lun=12:00-22:00,mar=12:00-22:00,mie=12:00-22:00,jue=12:00-22:00,vie=12:00-23:00,sab=12:00-23:00,dom=cerrado'))
      .toBe('lunes a jueves de 12:00 a 22:00; viernes y sábado de 12:00 a 23:00; domingo cerrado');
    expect(L.vmHorarioLegible('lun=09:00-13:00')).toBe('lunes de 09:00 a 13:00; martes a domingo cerrado');
    expect(L.vmHorarioLegible(L.vmHorario(QT))).toBe(L.vmHorarioLegible(QT)); // también con el objeto convertido
  });
  it('vmHorarioLegible: lo que no se entiende da texto vacío, y el texto no trae palabras prohibidas', () => {
    for (const m of ['', null, undefined, 5, 'lun=12:00-16:00/18:00-22', 'xyz=1']) expect(L.vmHorarioLegible(m), String(m)).toBe('');
    expect(L.vmHorarioLegible(QT)).not.toMatch(L.VM_PROHIBIDAS as unknown as RegExp);
  });
});

// ================================================================================================
describe('Carga de entrada: las cuatro formas', () => {
  const correr = (entradas: J[], refs: Referencias = {}): J[] => correrNodo('carga-de-entrada', entradas, refs);
  const msgs = (s: J[]): J[] => s[0]!['messages'] as J[];

  it('1. el Trigger: {messages, metadata, contacts} en la raíz', () => {
    const [s] = correr([valor(mensaje())]);
    expect(msgs([s!])).toHaveLength(1);
    expect(s!['phoneNumberId']).toBe(PNID);
    expect(s!['contacts']).toHaveLength(1);
    expect(s!['messaging_product']).toBe('whatsapp');
    expect(s!['ahoraMs']).toBe(AHORA);
    expect(s!['prueba']).toBeNull();
  });
  it('2. el body de la Entrada de prueba, que además activa el modo prueba', () => {
    const body = { ...valor(mensaje()), modoPrueba: true, telefonoDePrueba: '+591 000 00099', enviarDeVerdad: false };
    const [s] = correr([{ body }], { 'Entrada de prueba': { body } });
    expect(msgs([s!])).toHaveLength(1);
    expect(s!['phoneNumberId']).toBe(PNID);
    expect(s!['prueba']).toEqual({ modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: false });
    // el body de un Webhook cualquiera (sin ser la Entrada de prueba) también se lee, pero no da modo prueba
    const [t] = correr([{ body: valor(mensaje()) }]);
    expect(msgs([t!])).toHaveLength(1);
    expect(t!['prueba']).toBeNull();
  });
  it('3. la carga completa entry[0].changes[0].value, en la raíz o dentro de body', () => {
    const [a] = correr([sobreMeta(valor(mensaje()))]);
    expect(msgs([a!])).toHaveLength(1);
    expect(a!['phoneNumberId']).toBe(PNID);
    const [b] = correr([{ body: sobreMeta(valor(mensaje())) }]);
    expect(msgs([b!])).toHaveLength(1);
    expect(b!['contacts']).toHaveLength(1);
  });
  it('4. el receptor: el evento es el body.value de «Entrega del receptor»', () => {
    const entrega = { body: { field: 'messages', value: valor(mensaje()) } };
    // lo que llega después de «Verificar firma» ya no es el evento sino el veredicto
    const [s] = correr([{ valido: true }], { 'Entrega del receptor': entrega });
    expect(msgs([s!])).toHaveLength(1);
    expect(s!['phoneNumberId']).toBe(PNID);
    expect(s!['contacts']).toHaveLength(1);
    // sin `field` también vale (negativo del requisito: solo se exige si viene)
    const [t] = correr([{ valido: true }], { 'Entrega del receptor': { body: { value: valor(mensaje()) } } });
    expect(msgs([t!])).toHaveLength(1);
  });
  it('4. el receptor: un `field` que no es `messages` NO es un mensaje', () => {
    for (const field of ['message_template_status_update', 'account_update', 'Messages', '']) {
      const [s] = correr([{ valido: true }], { 'Entrega del receptor': { body: { field, value: valor(mensaje()) } } });
      expect(msgs([s!]), field).toEqual([]);
    }
  });
  it('4. el receptor sin value, con un value que no es objeto, o con un acuse: messages vacío', () => {
    for (const body of [{}, { field: 'messages' }, { field: 'messages', value: 'texto' }, { field: 'messages', value: valor(null) }]) {
      const [s] = correr([{ valido: true }], { 'Entrega del receptor': { body } });
      expect(msgs([s!]), JSON.stringify(body)).toEqual([]);
    }
  });
  it('4. el receptor manda sobre lo que traiga el ítem de entrada (no se mezclan)', () => {
    const otro = valor(mensaje({ id: 'wamid.otro', text: { body: 'del ítem' } }));
    const [s] = correr([otro], { 'Entrega del receptor': { body: { field: 'messages', value: valor(mensaje({ text: { body: 'del receptor' } })) } } });
    expect((msgs([s!])[0]!['text'] as J)['body']).toBe('del receptor');
  });
  it('un acuse de estado (sin messages) sale con messages: [] en cualquier forma', () => {
    expect(msgs(correr([valor(null)]))).toEqual([]);
    expect(msgs(correr([sobreMeta(valor(null))]))).toEqual([]);
    expect(msgs(correr([{ body: valor(null) }]))).toEqual([]);
    expect(msgs(correr([{}]))).toEqual([]);
    expect(msgs(correr([{ body: 'texto', entry: 'raro' }]))).toEqual([]);
  });
  it('el modo prueba NO se lee de la carga: solo del nodo «Entrada de prueba» que corrió', () => {
    const trampa = { ...valor(mensaje()), modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: false };
    expect(correr([trampa])[0]!['prueba']).toBeNull(); // en la raíz
    expect(correr([{ body: trampa }])[0]!['prueba']).toBeNull(); // en el body
    expect(correr([valor(mensaje({ modoPrueba: true, text: { body: 'modoPrueba: true' } }))])[0]!['prueba']).toBeNull(); // en el mensaje
    expect(correr([trampa], { 'Entrega del receptor': { body: { field: 'messages', value: trampa } } })[0]!['prueba']).toBeNull(); // por el receptor
    // FALLA CERRADA: el nodo existe y corrió, pero el cuerpo no pidió modo prueba o lo pidió mal → igual es modo prueba
    // (nunca `null`, que dejaría a la variante de prueba hablando con la producción como si fuera una entrega real).
    const CERRADO = { modoPrueba: true, telefonoDePrueba: '', enviarDeVerdad: false };
    for (const modoPrueba of [false, 'true', 1, undefined]) {
      const body = { ...valor(mensaje()), modoPrueba };
      expect(correr([{ body }], { 'Entrada de prueba': { body } })[0]!['prueba'], String(modoPrueba)).toEqual(CERRADO);
    }
    // …y con un cuerpo que ni siquiera es un objeto, o sin cuerpo, también.
    for (const body of ['texto', null, 7, undefined]) {
      expect(correr([valor(mensaje())], { 'Entrada de prueba': { body } })[0]!['prueba'], String(body)).toEqual(CERRADO);
    }
    expect(correr([valor(mensaje())], { 'Entrada de prueba': {} })[0]!['prueba']).toEqual(CERRADO);
    // `enviarDeVerdad` sin `modoPrueba` tampoco se pierde ni se inventa: solo vale con === true
    const sinModo = { ...valor(mensaje()), enviarDeVerdad: true, telefonoDePrueba: '59100000099' };
    expect(correr([{ body: sinModo }], { 'Entrada de prueba': { body: sinModo } })[0]!['prueba']).toEqual({ modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: true });
    // `enviarDeVerdad` solo vale con === true
    const body = { ...valor(mensaje()), modoPrueba: true, enviarDeVerdad: 'true' };
    expect(correr([{ body }], { 'Entrada de prueba': { body } })[0]!['prueba']).toEqual({ modoPrueba: true, telefonoDePrueba: '', enviarDeVerdad: false });
  });
  it('un ítem por ítem de entrada, y la metadata de respaldo si el valor no la trae', () => {
    const salida = correr([valor(mensaje()), valor(mensaje({ id: 'wamid.dos' }))]);
    expect(salida).toHaveLength(2);
    const sinMeta = { messages: [mensaje()], metadata: undefined, body: undefined };
    expect(correr([{ ...sinMeta, metadata: { phone_number_id: 'otro-id' } }])[0]!['phoneNumberId']).toBe('otro-id');
  });
});

// ================================================================================================
describe('Interpretar entrada', () => {
  const COBRO_PENDIENTE = { activo: true, pendiente: true, qrUrl: 'https://qr.example/f?x=1' };
  const CFG: J = {
    phoneNumberIdEsperado: PNID, prefijosPermitidos: '591', destinatariosAviso: `completo:${AVISO_1},cocina:${AVISO_2}`,
    cobro: { activo: false, pendiente: false },
  };
  const carga = (msg: J | null, extra: J = {}): J => ({
    messages: msg ? [msg] : [], metadata: { phone_number_id: PNID }, contacts: [{ profile: { name: 'Ana Pérez' }, wa_id: CLIENTE }],
    phoneNumberId: PNID, ahoraMs: AHORA, prueba: null, ...extra,
  });
  const refs = (c: J, cfg: J = CFG): Referencias => ({ 'Carga de entrada': c, 'Config del negocio': cfg });
  /** Un turno con su estado propio. */
  const turno = (msg: J | null, o: { cfg?: J; extra?: J; raiz?: J | null; globales?: Record<string, unknown> } = {}): J[] =>
    correrNodo('interpretar-entrada', [{}], refs(carga(msg, o.extra), o.cfg ?? CFG), { raiz: o.raiz === undefined ? {} : o.raiz, globales: o.globales });
  const uno = (msg: J, o: Parameters<typeof turno>[1] = {}): J => {
    const s = turno(msg, o);
    expect(s).toHaveLength(1);
    return s[0]!;
  };

  it('texto: from, nombre de perfil, ids y origen directo', () => {
    const t = uno(mensaje());
    expect(t).toMatchObject({
      from: CLIENTE, nombrePerfil: 'Ana Pérez', phoneNumberId: PNID, mensajeId: 'wamid.prueba-1', tipo: 'text', texto: 'hola',
      textoReporte: 'hola', origen: 'directo', boton: '', esAudio: false, esComprobante: false, mediaId: '', mimeType: '',
      ubicacion: null, ahoraMs: AHORA, prueba: null,
    });
    expect(Object.keys(t).sort()).toEqual([
      'ahoraMs', 'boton', 'esAudio', 'esComprobante', 'from', 'mediaId', 'mensajeId', 'mimeType', 'nombrePerfil', 'origen',
      'phoneNumberId', 'prueba', 'texto', 'textoReporte', 'tipo', 'ubicacion',
    ]);
  });
  it('recorta el texto a 1.500 caracteres y el nombre de perfil a 60, sin < > & ni saltos', () => {
    expect(uno(mensaje({ text: { body: 'x'.repeat(1600) } }))['texto']).toHaveLength(1500);
    expect(uno(mensaje({ text: { body: 'x'.repeat(1500) } }))['texto']).toHaveLength(1500);
    const c = carga(mensaje(), { contacts: [{ profile: { name: `<b>Ana</b>\n&  ${'z'.repeat(80)}` } }] });
    const [t] = correrNodo('interpretar-entrada', [{}], refs(c), { raiz: {} });
    expect(t!['nombrePerfil']).toMatch(/^b Ana \/b/);
    expect(String(t!['nombrePerfil']).length).toBeLessThanOrEqual(60);
    expect(String(t!['nombrePerfil'])).not.toMatch(/[<>&\n]/);
    const [sin] = correrNodo('interpretar-entrada', [{}], refs(carga(mensaje(), { contacts: [] })), { raiz: {} });
    expect(sin!['nombrePerfil']).toBe('');
  });
  it('interactive: list_reply ANTES que button_reply; el id va a `boton` y el título a `texto`', () => {
    const lista = uno(mensaje({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'g|pedir|a1', title: 'Queso' }, button_reply: { id: 'otro', title: 'Otro' } } }));
    expect(lista).toMatchObject({ tipo: 'interactive', boton: 'g|pedir|a1', texto: 'Queso' });
    const boton = uno(mensaje({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'm|pedido', title: 'Hacer un pedido' } } }));
    expect(boton).toMatchObject({ tipo: 'interactive', boton: 'm|pedido', texto: 'Hacer un pedido' });
    expect(boton['textoReporte']).toContain('Hacer un pedido');
    const vacio = uno(mensaje({ type: 'interactive', interactive: {} }));
    expect(vacio).toMatchObject({ boton: '', texto: '' });
    expect(uno(mensaje({ type: 'interactive', interactive: { button_reply: { id: 'x'.repeat(400), title: 't' } } }))['boton']).toHaveLength(256);
  });
  it('button (respuesta rápida de una plantilla): el texto del botón', () => {
    expect(uno(mensaje({ type: 'button', button: { text: 'Sí', payload: 'p' } }))).toMatchObject({ tipo: 'button', texto: 'Sí', boton: '' });
    expect(uno(mensaje({ type: 'button', button: { payload: 'solo-payload' } }))['texto']).toBe('solo-payload');
  });
  it('audio y voice: esAudio con medio; sin id no hay qué transcribir', () => {
    const a = uno(mensaje({ type: 'audio', audio: { id: 'media-a1', mime_type: 'audio/ogg; codecs=opus' } }));
    expect(a).toMatchObject({ tipo: 'audio', esAudio: true, mediaId: 'media-a1', mimeType: 'audio/ogg; codecs=opus', texto: '' });
    expect(a['textoReporte']).toMatch(/audio/);
    expect(uno(mensaje({ type: 'voice', voice: { id: 'media-v1' } }))).toMatchObject({ tipo: 'audio', esAudio: true, mediaId: 'media-v1' });
    expect(uno(mensaje({ type: 'audio', audio: {} }))).toMatchObject({ tipo: 'audio', esAudio: false, mediaId: '' });
  });
  it('A3: un id de medio que no es [A-Za-z0-9_-]{1,100} se trata como un medio sin id (no se baja, no es comprobante)', () => {
    const cfg = { ...CFG, cobro: COBRO_PENDIENTE };
    for (const id of ['../x', 'a/b', 'a b', 'id?x=1', 'x'.repeat(101), '..%2F', 'a\nb']) {
      expect(uno(mensaje({ type: 'audio', audio: { id } })), id).toMatchObject({ tipo: 'audio', esAudio: false, mediaId: '' });
      expect(uno(mensaje({ type: 'image', image: { id } }), { cfg }), id).toMatchObject({ esComprobante: false, mediaId: '' });
    }
    // negativos: la forma de Meta pasa, con 100 caracteres justos también
    expect(uno(mensaje({ type: 'audio', audio: { id: 'x'.repeat(100) } }))).toMatchObject({ esAudio: true, mediaId: 'x'.repeat(100) });
    expect(uno(mensaje({ type: 'image', image: { id: 'A_b-9' } }), { cfg })).toMatchObject({ esComprobante: true, mediaId: 'A_b-9' });
  });
  it('imagen y documento: el pie de foto es texto; lo que se reporta no es el contenido', () => {
    const i = uno(mensaje({ type: 'image', image: { id: 'media-i1', mime_type: 'image/jpeg', caption: 'mi comprobante' } }));
    expect(i).toMatchObject({ tipo: 'image', texto: 'mi comprobante', mediaId: 'media-i1', mimeType: 'image/jpeg', esAudio: false });
    expect(i['textoReporte']).not.toContain('comprobante');
    const d = uno(mensaje({ type: 'document', document: { id: 'media-d1', mime_type: 'application/pdf', filename: 'a.pdf' } }));
    expect(d).toMatchObject({ tipo: 'document', texto: '', mediaId: 'media-d1', mimeType: 'application/pdf' });
    expect(uno(mensaje({ type: 'image', image: { id: 'm', caption: 'y'.repeat(2000) } }))['texto']).toHaveLength(1500);
  });
  it('esComprobante: imagen o documento, con cobro real activo, QR pendiente y medio', () => {
    const cfg = { ...CFG, cobro: COBRO_PENDIENTE };
    const img = mensaje({ type: 'image', image: { id: 'media-i1' } });
    const doc = mensaje({ type: 'document', document: { id: 'media-d1' } });
    expect(uno(img, { cfg })['esComprobante']).toBe(true);
    expect(uno(doc, { cfg })['esComprobante']).toBe(true);
    // los negativos, uno por condición
    expect(uno(img)['esComprobante']).toBe(false); // cobro apagado
    expect(uno(img, { cfg: { ...CFG, cobro: { ...COBRO_PENDIENTE, pendiente: false } } })['esComprobante']).toBe(false); // sin QR pendiente
    expect(uno(img, { cfg: { ...CFG, cobro: { ...COBRO_PENDIENTE, activo: false } } })['esComprobante']).toBe(false);
    expect(uno(mensaje({ type: 'image', image: {} }), { cfg })['esComprobante']).toBe(false); // sin medio
    expect(uno(mensaje({ type: 'audio', audio: { id: 'a' } }), { cfg })['esComprobante']).toBe(false); // otro tipo
    expect(uno(mensaje({ type: 'video', video: { id: 'v' } }), { cfg })['esComprobante']).toBe(false);
    expect(uno(img, { cfg: { ...CFG, cobro: undefined } })['esComprobante']).toBe(false); // sin bloque de cobro
    expect(uno(img, { cfg: { ...CFG, cobro: { activo: 'true', pendiente: 'true' } } })['esComprobante']).toBe(false); // solo true de verdad
  });
  it('location pasa a `ubicacion`; una coordenada inválida la deja en null', () => {
    const u = uno(mensaje({ type: 'location', location: { latitude: -16.5, longitude: -68.15, name: 'Casa', address: 'Calle 1 <b>' } }));
    expect(u).toMatchObject({ tipo: 'location', texto: '', ubicacion: { latitud: -16.5, longitud: -68.15, nombre: 'Casa', direccion: 'Calle 1 b' } });
    expect(u['textoReporte']).not.toContain('-16.5'); // la ubicación no se reporta a la consola
    for (const l of [{ latitude: 95, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 'x', longitude: 1 }, { latitude: null, longitude: null }, {}, { latitude: -16 }]) {
      expect(uno(mensaje({ type: 'location', location: l }))['ubicacion'], JSON.stringify(l)).toBeNull();
    }
    expect(uno(mensaje({ type: 'location' }))['ubicacion']).toBeNull();
  });
  it('video, contacts, order y los tipos que no se conocen se tratan con cortesía: llegan sin texto', () => {
    for (const tipo of ['video', 'contacts', 'order', 'unsupported', 'interactivo-nuevo']) {
      const t = uno(mensaje({ type: tipo, [tipo]: tipo === 'video' ? { id: 'v1' } : {} }));
      expect(t, tipo).toMatchObject({ tipo, texto: '', esComprobante: false, esAudio: false });
      expect(t['textoReporte'], tipo).toContain(tipo);
    }
    expect(uno(mensaje({ type: undefined }))['tipo']).toBe('desconocido');
  });
  it('CAMBIO AL CONTRATO: reaction, sticker y tipos sin contenido devuelven [] (cada respuesta cuesta dinero)', () => {
    for (const tipo of ['reaction', 'sticker', 'request_welcome', 'system', 'ephemeral']) {
      expect(turno(mensaje({ type: tipo, [tipo]: { emoji: '👍', id: 'x' } })), tipo).toEqual([]);
    }
    // no deja rastro: no se marca como visto, para no tapar un mensaje real con el mismo id
    const raiz: J = {};
    turno(mensaje({ id: 'wamid.misma', type: 'reaction', reaction: { emoji: '👍' } }), { raiz });
    expect(raiz['ventaMinima']?.['vistos'] ?? {}).toEqual({});
    expect(turno(mensaje({ id: 'wamid.misma' }), { raiz })).toHaveLength(1);
    // y un tipo con contenido NO se descarta
    expect(turno(mensaje({ type: 'video', video: { id: 'v' } }))).toHaveLength(1);
  });
  it('un anuncio (referral) marca origen «anuncio»', () => {
    expect(uno(mensaje({ referral: { source_url: 'https://fb.example/ad', headline: 'Promo' } }))['origen']).toBe('anuncio');
    expect(uno(mensaje({ referral: 'texto' }))['origen']).toBe('directo');
  });

  it('[] si no hay mensaje o `from` no es un número', () => {
    expect(turno(null)).toEqual([]);
    for (const from of ['', 'abc', '12345', undefined, '+59100000021']) expect(turno(mensaje({ from })), String(from)).toEqual([]);
    expect(correrNodo('interpretar-entrada', [{}], { 'Carga de entrada': { messages: 'no' }, 'Config del negocio': CFG }, { raiz: {} })).toEqual([]);
    expect(correrNodo('interpretar-entrada', [{}], { 'Carga de entrada': { messages: [null] }, 'Config del negocio': CFG }, { raiz: {} })).toEqual([]);
  });
  it('[] si el phone_number_id no es el esperado; sin esperado (marcador sin reemplazar) se descarta TODO', () => {
    expect(turno(mensaje(), { extra: { phoneNumberId: 'otro-numero', metadata: { phone_number_id: 'otro-numero' } } })).toEqual([]);
    expect(turno(mensaje(), { extra: { phoneNumberId: '', metadata: {} } })).toEqual([]);
    expect(turno(mensaje(), { cfg: { ...CFG, phoneNumberIdEsperado: '' } })).toEqual([]);
    expect(turno(mensaje(), { cfg: { ...CFG, phoneNumberIdEsperado: undefined } })).toEqual([]);
    expect(turno(mensaje())).toHaveLength(1); // el esperado, sí pasa
    // el id se toma de la metadata si la carga no lo trae ya armado
    expect(turno(mensaje(), { extra: { phoneNumberId: '' } })).toHaveLength(1);
  });
  it('en modo prueba el phone_number_id no se mira (ni siquiera sin esperado)', () => {
    // quien escribe en el ensayo es el `telefonoDePrueba` (A2: `from` no es libre en modo prueba)
    const prueba = { modoPrueba: true, telefonoDePrueba: CLIENTE, enviarDeVerdad: false };
    const sinEsperado = { ...CFG, phoneNumberIdEsperado: '' };
    const t = uno(mensaje(), { cfg: sinEsperado, extra: { prueba } });
    expect(t['prueba']).toEqual(prueba);
    expect(turno(mensaje(), { extra: { prueba, phoneNumberId: 'otro-numero' } })).toHaveLength(1);
    // un `prueba` que no dice modoPrueba === true no es modo prueba
    expect(turno(mensaje(), { cfg: sinEsperado, extra: { prueba: { modoPrueba: 'true' } } })).toEqual([]);
  });
  it('A2: en modo prueba `from` solo pasa si es el telefonoDePrueba, un destinatario de aviso de «Config base» o el numeroEnsayo; cualquier otro → []', () => {
    const conBase = (base: J, from: string, prueba: J) => correrNodo('interpretar-entrada', [{}],
      { ...refs(carga(mensaje({ from }), { prueba, phoneNumberId: 'otro-numero' })), 'Config base': base }, { raiz: {} });
    const BASE_A2: J = { destinatariosAviso: `completo:${AVISO_1},cocina:${AVISO_2}`, numeroEnsayo: '59100000077' };
    const prueba = { modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: true };
    // pasan: el telefonoDePrueba, cada destinatario de aviso y el número de ensayo
    for (const from of ['59100000099', AVISO_1, AVISO_2, '59100000077']) expect(conBase(BASE_A2, from, prueba), from).toHaveLength(1);
    // NEGATIVO: un `from` ajeno no pasa (no llegaría a `Traer configuración` ni a `Cotejar en el servidor`), aunque el cuerpo diga enviarDeVerdad
    expect(conBase(BASE_A2, CLIENTE, prueba)).toEqual([]);
    expect(conBase(BASE_A2, '59100000098', prueba)).toEqual([]);
    // sin lista ni número de ensayo (marcador sin reemplazar), solo vale el `telefonoDePrueba`
    expect(conBase({ numeroEnsayo: 'REEMPLAZAR_NUMERO_ENSAYO_QTACO' }, CLIENTE, prueba)).toEqual([]);
    expect(conBase({}, '59100000099', prueba)).toHaveLength(1);
    // sin `telefonoDePrueba` (vacío) un `from` ajeno tampoco pasa
    expect(conBase(BASE_A2, CLIENTE, { ...prueba, telefonoDePrueba: '' })).toEqual([]);
    // y un ajeno no se marca como visto
    const raiz: J = {};
    correrNodo('interpretar-entrada', [{}], { ...refs(carga(mensaje({ from: CLIENTE }), { prueba })), 'Config base': BASE_A2 }, { raiz });
    expect(raiz['ventaMinima']?.['vistos'] ?? {}).toEqual({});
    // Fuera de modo prueba el nodo no mira esa lista: un cliente cualquiera pasa.
    expect(turno(mensaje({ from: CLIENTE }))).toHaveLength(1);
  });
  it('[] si el prefijo no está permitido (54…), y no se marca como visto', () => {
    const raiz: J = {};
    expect(turno(mensaje({ from: '54900000021' }), { raiz })).toEqual([]);
    expect(raiz['ventaMinima']?.['vistos'] ?? {}).toEqual({});
    expect(turno(mensaje({ from: '54900000021' }), { cfg: { ...CFG, prefijosPermitidos: '591,54' } })).toHaveLength(1);
    expect(turno(mensaje(), { cfg: { ...CFG, prefijosPermitidos: '' } })).toEqual([]); // sin prefijos, ninguno
  });
  it('[] si el mensaje ya se vio: el segundo turno con el mismo wamid no hace nada', () => {
    const raiz: J = {};
    expect(turno(mensaje(), { raiz })).toHaveLength(1);
    expect(turno(mensaje(), { raiz })).toEqual([]);
    expect(turno(mensaje({ id: 'wamid.otro' }), { raiz })).toHaveLength(1); // un id distinto pasa
    expect(Object.keys(raiz['ventaMinima']['vistos']).sort()).toEqual(['wamid.otro', 'wamid.prueba-1']);
    // pasadas 24 horas, Meta ya no reintenta ese id: se vuelve a aceptar
    const [deNuevo] = correrNodo('interpretar-entrada', [{}], refs(carga(mensaje(), { ahoraMs: AHORA + 25 * HORA })), { raiz, ahoraMs: AHORA + 25 * HORA });
    expect(deNuevo).toBeDefined();
  });
  it('sin datos estáticos el turno sigue (no hay con qué descartar repetidos)', () => {
    expect(turno(mensaje(), { raiz: null })).toHaveLength(1);
    expect(turno(mensaje(), { raiz: null })).toHaveLength(1);
  });
  it('si quien escribe es un destinatario de los avisos, se anota su entrada (abre su ventana de 24 h)', () => {
    const raiz: J = {};
    uno(mensaje({ from: AVISO_1 }), { raiz });
    expect(raiz['ventaMinima']['avVentanas']).toEqual({ [AVISO_1]: AHORA });
    uno(mensaje({ from: AVISO_2, id: 'wamid.dos' }), { raiz });
    expect(Object.keys(raiz['ventaMinima']['avVentanas']).sort()).toEqual([AVISO_1, AVISO_2]);
  });
  it('un cliente que no es destinatario no anota nada, y una falla al anotar no frena el turno', () => {
    const raiz: J = {};
    uno(mensaje(), { raiz });
    expect(raiz['ventaMinima']['avVentanas']).toBeUndefined();
    const t = uno(mensaje({ from: AVISO_1 }), { raiz: {}, globales: { $fallaAnotar: true } });
    expect(t['from']).toBe(AVISO_1);
    // sin destinatarios configurados tampoco hay nada que anotar
    const raiz2: J = {};
    uno(mensaje({ from: AVISO_1 }), { raiz: raiz2, cfg: { ...CFG, destinatariosAviso: '' } });
    expect(raiz2['ventaMinima']['avVentanas']).toBeUndefined();
  });
  it('un mensaje repetido de un destinatario no vuelve a anotar su ventana', () => {
    const raiz: J = {};
    uno(mensaje({ from: AVISO_1 }), { raiz });
    raiz['ventaMinima']['avVentanas'][AVISO_1] = 1;
    expect(turno(mensaje({ from: AVISO_1 }), { raiz })).toEqual([]);
    expect(raiz['ventaMinima']['avVentanas'][AVISO_1]).toBe(1);
  });
});

// ================================================================================================
describe('Config del negocio', () => {
  const BASE: J = {
    pedidosActivo: true, reservasActivo: true, promosActivo: true,
    areasExcluidas: 'Cócteles, Cervezas ,Helados', areasSinDelivery: 'Bebidas', zonasReserva: 'salón,terraza',
    horario: 'lun=12:00-22:00,mar=12:00-22:00,dom=cerrado',
    maxPersonasReserva: 15, anticipacionReservaMin: 90, maxDiasReserva: 45, topeReservasDia: 5, topeAvisosDia: 200, topeTransferenciasHora: 2,
    destinatariosAviso: `completo:${AVISO_1},cocina:${AVISO_2}:Silvana`,
    plantillaPedido: 'plantilla_pedido_x', idiomaPlantillaPedido: 'es', plantillaReserva: 'plantilla_reserva_x', idiomaPlantillaReserva: 'es_ES',
    plantillaDerivacion: 'plantilla_derivacion_x', idiomaPlantillaDerivacion: 'es',
    phoneNumberIdEsperado: PNID, waGraphVersion: 'v25.0',
    nombreNegocio: 'Restaurante de ejemplo', respaldoNumeroRecepcion: '59100000031',
  };
  const PANEL: J = {
    tenantId: 'tenant-de-ejemplo', estadoComercio: 'activo',
    datosDelNegocio: { nombreNegocio: 'Casa de Tacos', direccion: 'Calle 1 #23' },
    operacion: { moneda: 'BOB', numeroRecepcion: '+591 000 00041', horarioAtencion: 'Lunes a sábado de 12:00 a 22:00', prefijosPermitidos: ['591', '51'] },
    voz: { nombreAsistente: 'Kai', nivelEmojis: 'muchos' },
    venta: { aceptaDelivery: true, aceptaRetiroEnLocal: true },
    catalogo: [{ id: 'a1', nombre: 'Queso fundido', precio: 40, area: 'Entradas', descripcion: 'Con chorizo' }],
    campanas: [{ id: 'c1', texto: 'Promo Dúo', inicio: '2026-10-01T04:00:00.000Z', fin: '2026-10-31T04:00:00.000Z' }],
    cobro: { activo: true, pendiente: true, qr: { url: 'https://qr.example/f?x=1', nombreCuenta: 'Casa de Tacos SRL', banco: 'Banco X' }, monto: 55, pedido: 'ped-1' },
    atencion: { estado: 'normal' },
  };
  const correr = (resp: J, o: { base?: J; carga?: J; globales?: Record<string, unknown> } = {}): J => {
    const [c] = correrNodo('config-del-negocio', [resp], { 'Config base': o.base ?? BASE, 'Carga de entrada': o.carga ?? { phoneNumberId: PNID, prueba: null } }, { globales: o.globales });
    return c!;
  };
  const ok = (panel: J = PANEL, o: Parameters<typeof correr>[1] = {}): J => correr({ statusCode: 200, body: panel }, o);

  it('con el panel en 200: sus datos pisan a «Config base» y al respaldo', () => {
    const c = ok();
    expect(c).toMatchObject({
      configDeLaConsola: true, panelSinRespuesta: false, estadoComercio: 'operativo', nombreNegocio: 'Casa de Tacos', direccion: 'Calle 1 #23',
      nombreAsistente: 'Kai', nivelEmojis: 'muchos', moneda: 'BOB', horarioAtencion: 'Lunes a sábado de 12:00 a 22:00',
      numeroRecepcion: '59100000041', prefijosPermitidos: '591,51', aceptaDelivery: true, aceptaRetiroEnLocal: true,
    });
    expect(c['cobro']).toEqual({ activo: true, qrUrl: 'https://qr.example/f?x=1', titular: 'Casa de Tacos SRL', banco: 'Banco X', pendiente: true, monto: 55, pedidoRef: 'ped-1', vencidoHaceMin: null });
    expect(c['campanas']).toEqual([{ id: 'c1', texto: 'Promo Dúo', inicio: '2026-10-01T04:00:00.000Z', fin: '2026-10-31T04:00:00.000Z' }]);
    expect(c['catalogo']).toEqual([{ id: 'a1', nombre: 'Queso fundido', precio: 40, area: 'Entradas', descripcion: 'Con chorizo', agotado: false }]);
    expect(c['phoneNumberId']).toBe(PNID);
  });
  it('areasExcluidas, areasSinDelivery y zonasReserva salen como ARREGLOS', () => {
    const c = ok();
    expect(c['areasExcluidas']).toEqual(['Cócteles', 'Cervezas', 'Helados']);
    expect(c['areasSinDelivery']).toEqual(['Bebidas']);
    expect(c['zonasReserva']).toEqual(['salón', 'terraza']);
    const vacio = ok(PANEL, { base: {} });
    for (const k of ['areasExcluidas', 'areasSinDelivery', 'zonasReserva']) expect(vacio[k], k).toEqual([]);
    expect(ok(PANEL, { base: { zonasReserva: ['salón', 'jardín'] } })['zonasReserva']).toEqual(['salón', 'jardín']);
  });
  it('palabrasExcluidas sale como ARREGLO y SOLO de «Config base»: la clave del panel o de la consola no pasa', () => {
    const lista = 'helado, cerveza ,bebida alcoholica,REEMPLAZAR_X,cerveza';
    expect(ok(PANEL, { base: { ...BASE, palabrasExcluidas: lista } })['palabrasExcluidas']).toEqual(['helado', 'cerveza', 'bebida alcoholica']);
    // ausente o vacía = sin lista
    expect(ok(PANEL)['palabrasExcluidas']).toEqual([]);
    expect(ok(PANEL, { base: { ...BASE, palabrasExcluidas: '' } })['palabrasExcluidas']).toEqual([]);
    expect(ok(PANEL, { base: { ...BASE, palabrasExcluidas: 'REEMPLAZAR_PALABRAS_QTACO' } })['palabrasExcluidas']).toEqual([]);
    // el panel intenta ponerla (en cada sección y en la raíz): no pasa ni pisa la de «Config base»
    const hostil: J = {
      ...PANEL, palabrasExcluidas: 'pizza', datosDelNegocio: { ...(PANEL['datosDelNegocio'] as J), palabrasExcluidas: 'pizza' },
      operacion: { ...(PANEL['operacion'] as J), palabrasExcluidas: 'pizza' }, venta: { ...(PANEL['venta'] as J), palabrasExcluidas: 'pizza' },
      voz: { ...(PANEL['voz'] as J), palabrasExcluidas: ['pizza'] },
    };
    expect(ok(hostil)['palabrasExcluidas']).toEqual([]);
    expect(ok(hostil, { base: { ...BASE, palabrasExcluidas: 'helado' } })['palabrasExcluidas']).toEqual(['helado']);
    // y con el panel suspendido o sin respuesta, la lista de «Config base» sigue ahí (lo que no se vende por WhatsApp no depende del panel)
    expect(correr({ statusCode: 500, body: {} }, { base: { ...BASE, palabrasExcluidas: 'helado' } })['palabrasExcluidas']).toEqual(['helado']);
    expect(correr({ statusCode: 409, body: {} }, { base: { ...BASE, palabrasExcluidas: 'helado' } })['palabrasExcluidas']).toEqual(['helado']);
  });
  it('`horario` queda como CSV crudo, y `prefijosPermitidos` y `destinatariosAviso` como CSV', () => {
    const c = ok();
    expect(c['horario']).toBe(BASE['horario']);
    expect(typeof c['horario']).toBe('string');
    expect(c['destinatariosAviso']).toBe(`completo:${AVISO_1},cocina:${AVISO_2}:Silvana`);
    expect(typeof c['prefijosPermitidos']).toBe('string');
    // un marcador sin reemplazar no entra a la lista de destinatarios
    expect(ok(PANEL, { base: { destinatariosAviso: `completo:${AVISO_1},cocina:REEMPLAZAR_NUMERO_AVISO_2_QTACO` } })['destinatariosAviso']).toBe(`completo:${AVISO_1}`);
    // un horario que ya viene como objeto se conserva tal cual (vmHorario lo acepta)
    const obj = { lun: [{ desde: '12:00', hasta: '22:00' }] };
    expect(ok(PANEL, { base: { horario: obj } })['horario']).toEqual(obj);
    expect(ok(PANEL, { base: { horario: 'REEMPLAZAR_HORARIO' } })['horario']).toBe('');
  });
  it('copia de «Config base» cualquier clave `plantilla*` o `idioma*`, y solo esas', () => {
    const c = ok();
    for (const k of Object.keys(BASE).filter((x) => /^(plantilla|idioma)/.test(x))) expect(c[k], k).toBe(BASE[k]);
    const raro = ok(PANEL, { base: { plantillaNueva: 'otra', idiomaNuevo: 'pt_BR', plantilla_x: 'y', plantillaVacia: '', plantillaMarcador: 'REEMPLAZAR_X', plantillaNumero: 5, otraCosa: 'no', Plantilla: 'no', 'plantilla-guion': 'no', miplantilla: 'no' } });
    expect(raro['plantillaNueva']).toBe('otra');
    expect(raro['idiomaNuevo']).toBe('pt_BR');
    expect(raro['plantilla_x']).toBe('y');
    for (const k of ['plantillaVacia', 'plantillaMarcador', 'plantillaNumero', 'otraCosa', 'Plantilla', 'plantilla-guion', 'miplantilla']) expect(raro[k], k).toBeUndefined();
    // el panel y el respaldo no inventan plantillas
    expect(Object.keys(ok(PANEL, { base: {} })).filter((k) => /^(plantilla|idioma)/.test(k))).toEqual([]);
  });
  it('B1: copia de «Config base» `ordenPedido`, `ordenReserva` y `ordenDerivacion` (el orden de las variables de la plantilla), y no otras claves con «orden»', () => {
    const c = ok(PANEL, { base: { ordenPedido: 'cotejo,modalidad,total,items', ordenReserva: 'codigo,detalle,cuando,destinatario', ordenDerivacion: 'codigo,detalle,cuando,destinatario' } });
    expect(c).toMatchObject({ ordenPedido: 'cotejo,modalidad,total,items', ordenReserva: 'codigo,detalle,cuando,destinatario', ordenDerivacion: 'codigo,detalle,cuando,destinatario' });
    // también con el panel caído o suspendido (el aviso sale igual)
    for (const r of [{ statusCode: 500, body: {} }, { statusCode: 409, body: {} }]) {
      expect(correr(r, { base: { ordenPedido: 'cotejo,modalidad,total,items' } })['ordenPedido'], String(r.statusCode)).toBe('cotejo,modalidad,total,items');
    }
    // negativos: vacío, marcador sin reemplazar, algo que no es texto, demasiado largo o con otro nombre, no pasan
    const raro = ok(PANEL, { base: { ordenPedido: '', ordenReserva: 'REEMPLAZAR_ORDEN', ordenDerivacion: 5, ordenLargo: 'x'.repeat(101), Orden: 'no', 'orden-x': 'no', miorden: 'no' } });
    for (const k of ['ordenPedido', 'ordenReserva', 'ordenDerivacion', 'ordenLargo', 'Orden', 'orden-x', 'miorden']) expect(raro[k], k).toBeUndefined();
    // el panel y el respaldo no inventan órdenes
    expect(Object.keys(ok(PANEL, { base: {} })).filter((k) => /^orden/.test(k))).toEqual([]);
  });
  it('las banderas pedidosActivo, reservasActivo y promosActivo valen false si faltan', () => {
    const c = ok(PANEL, { base: {} });
    expect([c['pedidosActivo'], c['reservasActivo'], c['promosActivo']]).toEqual([false, false, false]);
    expect(ok(PANEL, { base: { pedidosActivo: true } })).toMatchObject({ pedidosActivo: true, reservasActivo: false, promosActivo: false });
    expect(ok(PANEL, { base: { reservasActivo: 'true' } })['reservasActivo']).toBe(true); // n8n puede guardarlo como texto
    for (const raro of ['si', 1, 'false', 'yes', null, 'TRUE']) {
      expect(ok(PANEL, { base: { pedidosActivo: raro } })['pedidosActivo'], String(raro)).toBe(false);
    }
    // también con el panel caído o suspendido
    expect(correr({ statusCode: 500, body: {} }, { base: { pedidosActivo: true } })['pedidosActivo']).toBe(true);
    expect(correr({ statusCode: 409, body: {} }, { base: {} })['pedidosActivo']).toBe(false);
  });
  it('valores por omisión de la reserva y de los topes: 12 personas, 60 min, 30 días, 3, 150 y 1', () => {
    const c = ok(PANEL, { base: {} });
    expect(c).toMatchObject({ maxPersonasReserva: 12, anticipacionReservaMin: 60, maxDiasReserva: 30, topeReservasDia: 3, topeAvisosDia: 150, topeTransferenciasHora: 1, topePedidosHora: 6 });
    expect(ok()).toMatchObject({ maxPersonasReserva: 15, anticipacionReservaMin: 90, maxDiasReserva: 45, topeReservasDia: 5, topeAvisosDia: 200, topeTransferenciasHora: 2, topePedidosHora: 6 });
    // S6: el tope de avisos de pedido y comprobante por teléfono y por hora (def. 6; 0 = ninguno; un dato malo vuelve al 6).
    expect(ok(PANEL, { base: { topePedidosHora: '2' } })).toMatchObject({ topePedidosHora: 2 });
    expect(ok(PANEL, { base: { topePedidosHora: 0 } })).toMatchObject({ topePedidosHora: 0 });
    for (const malo of [-1, 'abc', 1.5, null, '', 5000]) expect(ok(PANEL, { base: { topePedidosHora: malo } }), String(malo)).toMatchObject({ topePedidosHora: 6 });
    expect(ok(PANEL, { base: { maxPersonasReserva: '20', topeAvisosDia: '0' } })).toMatchObject({ maxPersonasReserva: 20, topeAvisosDia: 0 });
    // lo que no es un entero válido vuelve al valor por omisión
    const malos = ok(PANEL, { base: { maxPersonasReserva: -3, anticipacionReservaMin: 'abc', maxDiasReserva: 0, topeReservasDia: 1.5, topeAvisosDia: null, topeTransferenciasHora: '' } });
    expect(malos).toMatchObject({ maxPersonasReserva: 12, anticipacionReservaMin: 60, maxDiasReserva: 30, topeReservasDia: 3, topeAvisosDia: 150, topeTransferenciasHora: 1 });
  });
  it('phoneNumberIdEsperado: el de «Config base»; un marcador sin reemplazar queda vacío', () => {
    expect(ok()['phoneNumberIdEsperado']).toBe(PNID);
    expect(ok(PANEL, { base: { ...BASE, phoneNumberIdEsperado: 'REEMPLAZAR_PHONE_NUMBER_ID_QTACO' } })['phoneNumberIdEsperado']).toBe('');
    expect(ok(PANEL, { base: {} })['phoneNumberIdEsperado']).toBe('');
    expect(ok(PANEL, { base: { phoneNumberIdEsperado: 12345 } })['phoneNumberIdEsperado']).toBe('');
  });
  it('catálogo saneado: sin nombre se descarta, el precio es número o null, una línea por campo, hasta 200', () => {
    const c = ok({ ...PANEL, catalogo: [
      { id: 'a', nombre: ' Tacos <b>de</b>\nbirria ', precio: '55', area: 'Platos', descripcion: 'x\ny', agotado: true },
      { id: 'b', nombre: '', precio: 10 },
      { id: 'c', nombre: 'Sin precio', precio: 'abc' },
      { id: 'd', nombre: 'Negativo', precio: -1 },
      { id: 'e', nombre: 'Agotado como texto', precio: 5, agotado: 'true' },
      { id: 'f', nombre: 'Largo '.repeat(50), precio: 1.5 },
      null, 'texto', 5,
    ] });
    const cat = c['catalogo'] as J[];
    expect(cat.map((i) => i['id'])).toEqual(['a', 'c', 'd', 'e', 'f']);
    expect(cat[0]).toEqual({ id: 'a', nombre: 'Tacos b de /b birria', precio: 55, area: 'Platos', descripcion: 'x y', agotado: true });
    expect(cat[1]!['precio']).toBeNull();
    expect(cat[2]!['precio']).toBeNull();
    expect(cat[3]!['agotado']).toBe(false); // solo true de verdad
    expect(String(cat[4]!['nombre']).length).toBeLessThanOrEqual(120);
    expect(cat[4]!['precio']).toBe(1.5);
    const muchos = Array.from({ length: 250 }, (_, i) => ({ id: `i${i}`, nombre: `Item ${i}`, precio: 1 }));
    expect((ok({ ...PANEL, catalogo: muchos })['catalogo'] as J[])).toHaveLength(200);
    expect(ok({ ...PANEL, catalogo: 'no es lista' })['catalogo']).toEqual([]);
    expect(ok({ ...PANEL, catalogo: [] })['catalogo']).toEqual([]);
  });
  it('campañas: solo {id, texto, inicio, fin}, una línea, sin texto vacío, hasta 20', () => {
    const c = ok({ ...PANEL, campanas: [
      { id: 'c1', texto: 'Promo\nDúo', inicio: 'i', fin: 'f', secreto: 'no' },
      { id: 'c2', texto: '   ' }, null,
    ] });
    expect(c['campanas']).toEqual([{ id: 'c1', texto: 'Promo Dúo', inicio: 'i', fin: 'f' }]);
    expect(ok({ ...PANEL, campanas: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, texto: `t${i}` })) })['campanas']).toHaveLength(20);
    expect(ok({ ...PANEL, campanas: undefined })['campanas']).toEqual([]);
  });
  it('R1: aceptaDelivery y aceptaRetiroEnLocal solo se apagan con `false` (falta = «sí», como en el servidor)', () => {
    // Un panel sin las claves de modalidad acepta las dos: es lo que hace el servidor (`!== false`).
    expect(ok({ ...PANEL, venta: undefined })).toMatchObject({ aceptaDelivery: true, aceptaRetiroEnLocal: true });
    expect(ok({ ...PANEL, venta: {} })).toMatchObject({ aceptaDelivery: true, aceptaRetiroEnLocal: true });
    expect(ok({ ...PANEL, venta: { aceptaDelivery: 'true', aceptaRetiroEnLocal: 1 } })).toMatchObject({ aceptaDelivery: true, aceptaRetiroEnLocal: true });
    // Negativos: solo el booleano `false` apaga cada modalidad, por separado.
    expect(ok({ ...PANEL, venta: { aceptaDelivery: false, aceptaRetiroEnLocal: true } })).toMatchObject({ aceptaDelivery: false, aceptaRetiroEnLocal: true });
    expect(ok({ ...PANEL, venta: { aceptaDelivery: true, aceptaRetiroEnLocal: false } })).toMatchObject({ aceptaDelivery: true, aceptaRetiroEnLocal: false });
    expect(ok({ ...PANEL, venta: { aceptaDelivery: false, aceptaRetiroEnLocal: false } })).toMatchObject({ aceptaDelivery: false, aceptaRetiroEnLocal: false });
  });
  it('cobro: lo arma `cbCobroReal`; si falla o el panel no está en 200, queda apagado (plan B)', () => {
    expect(ok()['cobro']).toMatchObject({ activo: true });
    const apagado = { activo: false, qrUrl: '', titular: '', banco: '', pendiente: false, monto: null, pedidoRef: null, vencidoHaceMin: null };
    expect(ok(PANEL, { globales: { $fallaCobro: true } })['cobro']).toEqual(apagado);
    expect(ok({ ...PANEL, cobro: { activo: true, qr: { url: 'http://sin-https.example/q' } } })['cobro']).toMatchObject({ activo: false });
    expect(correr({ statusCode: 500, body: PANEL })['cobro']).toEqual(apagado);
    expect(correr({ statusCode: 409, body: PANEL })['cobro']).toEqual(apagado);
  });
  it('numeroRecepcion: dígitos del panel; si falta, el respaldo de «Config base»; un marcador cuenta como vacío', () => {
    expect(ok()['numeroRecepcion']).toBe('59100000041');
    const sinPanel = { ...PANEL, operacion: { ...PANEL['operacion'], numeroRecepcion: '' } };
    expect(ok(sinPanel)['numeroRecepcion']).toBe('59100000031');
    expect(ok(sinPanel, { base: { respaldoNumeroRecepcion: 'REEMPLAZAR_NUMERO_RECEPCION_QTACO' } })['numeroRecepcion']).toBe('');
    expect(ok(sinPanel, { base: { numeroRecepcion: '+591 000 00032' } })['numeroRecepcion']).toBe('59100000032');
    expect(ok(sinPanel, { base: {} })['numeroRecepcion']).toBe('');
  });
  it('prefijosPermitidos: los del panel; si no, los de «Config base»; si no, 591', () => {
    expect(ok()['prefijosPermitidos']).toBe('591,51');
    const sinPrefijos = { ...PANEL, operacion: { ...PANEL['operacion'], prefijosPermitidos: [] } };
    expect(ok(sinPrefijos, { base: { prefijosPermitidos: '591, 54' } })['prefijosPermitidos']).toBe('591,54');
    expect(ok(sinPrefijos, { base: {} })['prefijosPermitidos']).toBe('591');
    expect(ok(sinPrefijos, { base: { prefijosPermitidos: 'REEMPLAZAR_X' } })['prefijosPermitidos']).toBe('591');
    expect(ok({ ...PANEL, operacion: { ...PANEL['operacion'], prefijosPermitidos: ['+591', 'abc'] } })['prefijosPermitidos']).toBe('591');
  });
  it('un 409 es SUSPENDIDO (respuesta válida), con el texto de cortesía del servidor', () => {
    const c = correr({ statusCode: 409, body: { mensajeCortesia: 'Volvemos pronto.' } });
    expect(c).toMatchObject({ estadoComercio: 'suspendido', mensajeComercioSuspendido: 'Volvemos pronto.', configDeLaConsola: false, panelSinRespuesta: false });
    expect(c['catalogo']).toEqual([]);
    const sinTexto = correr({ statusCode: 409, body: {} });
    expect(sinTexto['mensajeComercioSuspendido']).toBe('En este momento no podemos atenderte por este medio. Gracias por escribirnos.');
    expect(correr({ statusCode: 409, body: {} }, { base: { mensajeComercioSuspendido: 'Texto de Config base' } })['mensajeComercioSuspendido']).toBe('Texto de Config base');
    expect(ok({ ...PANEL, estadoComercio: 'suspendido' })['estadoComercio']).toBe('suspendido');
    expect(ok({ ...PANEL, estadoComercio: undefined })['estadoComercio']).toBe('operativo');
  });
  it('si el panel no responde (500, sin tenantId, cuerpo roto): respaldo sin carta, sin QR y con panelSinRespuesta', () => {
    for (const resp of [{ statusCode: 500, body: {} }, { statusCode: 200, body: {} }, { statusCode: 200, body: 'no es json' }, { statusCode: undefined, body: undefined }, {}]) {
      const c = correr(resp);
      expect(c, JSON.stringify(resp)).toMatchObject({ panelSinRespuesta: true, configDeLaConsola: false, estadoComercio: 'operativo', catalogo: [], campanas: [] });
      // Sin respuesta del panel no se sabe qué modalidades acepta: no se fija ninguna (falta = «sí», el mismo criterio de R1).
      expect(c).not.toHaveProperty('aceptaDelivery');
      expect(c).not.toHaveProperty('aceptaRetiroEnLocal');
      expect((c['cobro'] as J)['activo']).toBe(false);
      expect(c['nombreNegocio']).toBe('Restaurante de ejemplo'); // lo de «Config base» sigue
    }
    expect(correr({ statusCode: 500, body: {} })['codigoDelPanel']).toBe(500);
    // el cuerpo puede llegar como texto JSON
    expect(correr({ statusCode: 200, body: JSON.stringify(PANEL) })).toMatchObject({ configDeLaConsola: true, nombreNegocio: 'Casa de Tacos' });
  });
  it('el respaldo sin nada: textos neutros, en tuteo, y sin datos de ningún cliente', () => {
    const c = correr({ statusCode: 500, body: {} }, { base: {} });
    expect(c).toMatchObject({ nombreNegocio: 'nuestro restaurante', moneda: 'BOB', prefijosPermitidos: '591', waGraphVersion: 'v26.0', nivelEmojis: 'pocos', numeroRecepcion: '' });
    const textos = JSON.stringify(c);
    expect(textos).not.toMatch(/consultorio|doctor|paciente|bellido|taco|\busted\b|\bsu paciencia\b/i);
    expect(textos).not.toMatch(/\b(vos|tenés|querés|podés|sabés)\b/i);
    expect(L.vmTextoSeguro(String(c['atencionMensajeFijo']))).toBe(true);
    expect(L.vmTextoSeguro(String(c['mensajeComercioSuspendido']))).toBe(true);
  });
  it('atención del panel: umbrales y aviso; sin panel, normal', () => {
    const c = ok({ ...PANEL, atencion: { estado: 'operador', avisarRecepcion: 'operador', mensajeFijo: 'Te atiende una persona.', respuestasEnVentana: 25, ventanaVenceEn: '2026-10-06T04:00:00.000Z' } });
    expect(c).toMatchObject({ atencionEstado: 'operador', atencionAvisarRecepcion: 'operador', atencionMensajeFijo: 'Te atiende una persona.', atencionRespuestas: 25, atencionVenceEn: '2026-10-06T04:00:00.000Z' });
    expect(ok()).toMatchObject({ atencionEstado: 'normal', atencionAvisarRecepcion: '', atencionRespuestas: 0 });
    expect(correr({ statusCode: 500, body: { atencion: { estado: 'bloqueado' } } })['atencionEstado']).toBe('normal');
    expect(ok({ ...PANEL, atencion: { estado: 'raro', avisarRecepcion: 'otro' } })).toMatchObject({ atencionEstado: 'normal', atencionAvisarRecepcion: '' });
  });
  it('modo prueba: lo que dijo `Carga de entrada`; sin él, se envía de verdad', () => {
    expect(ok()).toMatchObject({ modoPrueba: false, telefonoDePrueba: '', enviarDeVerdad: true });
    const prueba = { modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: false };
    expect(ok(PANEL, { carga: { phoneNumberId: PNID, prueba } })).toMatchObject({ modoPrueba: true, telefonoDePrueba: '59100000099', enviarDeVerdad: false });
    expect(ok(PANEL, { carga: { phoneNumberId: PNID, prueba: { ...prueba, enviarDeVerdad: true } } })['enviarDeVerdad']).toBe(true);
    // un `prueba` que no dice modoPrueba === true no cuenta
    expect(ok(PANEL, { carga: { phoneNumberId: PNID, prueba: { modoPrueba: 'true', telefonoDePrueba: '59100000099' } } })).toMatchObject({ modoPrueba: false, telefonoDePrueba: '', enviarDeVerdad: true });
  });
  it('waGraphVersion: la de «Config base» o v26.0', () => {
    expect(ok()['waGraphVersion']).toBe('v25.0');
    expect(ok(PANEL, { base: {} })['waGraphVersion']).toBe('v26.0');
  });
});

// ================================================================================================
describe('Uso extendido', () => {
  const T = { from: CLIENTE, nombrePerfil: 'Ana Pérez', ahoraMs: AHORA };
  const CFG: J = { numeroRecepcion: '59100000041', atencionMensajeFijo: 'Te atiende una persona del restaurante.', atencionEstado: 'normal', atencionAvisarRecepcion: '' };
  const correr = (previo: J | null, cfg: J = CFG): J => {
    const refs: Referencias = { 'Interpretar entrada': T, 'Config del negocio': cfg };
    if (previo) refs['Reportar mensaje (entrante)'] = previo;
    const salida = correrNodo('uso-extendido', [{}], refs);
    expect(salida).toHaveLength(1);
    return salida[0]!;
  };
  const OPERADOR = { atencion: { estado: 'operador', avisarRecepcion: 'operador', mensajeFijo: 'Pasaste el límite; te atiende una persona.', respuestasEnVentana: 25 } };
  const BLOQUEADO = { atencion: { estado: 'bloqueado', avisarRecepcion: 'bloqueado', respuestasEnVentana: 50, ventanaVenceEn: '2026-10-06T14:00:00.000Z' } };

  it('operador: responde el texto del panel con el botón al local, y avisa con una transferencia', () => {
    const p = correr(OPERADOR);
    expect(p).toMatchObject({ estadoNuevo: null, condicionados: null, pedido: null, cierre: null, ruta: 'uso_extendido', errores: [] });
    expect(p['mensajes']).toEqual([{ tipo: 'enlace', cuerpo: 'Pasaste el límite; te atiende una persona.', botones: [], url: 'https://wa.me/59100000041', etiqueta: 'Escribir al local' }]);
    expect(p['aviso']).toMatchObject({ tipo: 'transferencia', datos: { from: CLIENTE, nombre: 'Ana Pérez', ahoraMs: AHORA, codigo: L.vmCodigoCorto(AHORA) } });
    expect(p['aviso'].datos.motivo).toMatch(/uso extendido: 25 respuestas/);
  });
  it('operador sin aviso pendiente: responde pero no avisa de nuevo', () => {
    const p = correr({ atencion: { estado: 'operador', respuestasEnVentana: 26 } });
    expect(p['aviso']).toBeNull();
    expect((p['mensajes'] as J[])).toHaveLength(1);
  });
  it('bloqueado: no responde nada; la primera vez avisa, con la fecha en que vuelve', () => {
    const p = correr(BLOQUEADO);
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']).toMatchObject({ tipo: 'transferencia' });
    expect(p['aviso'].datos.motivo).toContain('hasta el martes 6 de octubre a las 10:00');
    expect(p['aviso'].datos.motivo).toContain('50 respuestas');
    expect(correr({ atencion: { estado: 'bloqueado', respuestasEnVentana: 50 } })['aviso']).toBeNull(); // ya se avisó
    const sinFecha = correr({ atencion: { estado: 'bloqueado', avisarRecepcion: 'bloqueado', respuestasEnVentana: 50 } });
    expect(sinFecha['aviso'].datos.motivo).toContain('hasta mañana');
    const fechaRota = correr({ atencion: { estado: 'bloqueado', avisarRecepcion: 'bloqueado', ventanaVenceEn: 'ayer' } });
    expect(fechaRota['aviso'].datos.motivo).toContain('hasta mañana');
  });
  it('sin lo que devolvió la ingesta, manda la configuración; y sin nada, no es bloqueado', () => {
    const p = correr(null, { ...CFG, atencionEstado: 'bloqueado', atencionAvisarRecepcion: 'bloqueado', atencionRespuestas: 50 });
    expect(p['mensajes']).toEqual([]);
    expect(p['aviso']).not.toBeNull();
    const q = correr(null);
    expect((q['mensajes'] as J[])[0]!['cuerpo']).toBe('Te atiende una persona del restaurante.'); // operador por omisión
    expect(q['aviso']).toBeNull();
  });
  it('sin número de recepción no se ofrece un botón que no lleva a ninguna parte: va el texto solo', () => {
    const p = correr(OPERADOR, { ...CFG, numeroRecepcion: '' });
    expect(p['mensajes']).toEqual([{ tipo: 'texto', cuerpo: 'Pasaste el límite; te atiende una persona.', botones: [] }]);
    expect(p['aviso']).not.toBeNull(); // el aviso al restaurante sale igual
  });
  it('sin texto en el panel ni en la configuración, un texto genérico en tuteo', () => {
    const p = correr({ atencion: { estado: 'operador' } }, { numeroRecepcion: '59100000041' });
    const cuerpo = String((p['mensajes'] as J[])[0]!['cuerpo']);
    expect(cuerpo).toMatch(/Gracias por tu paciencia/);
    expect(L.vmTextoSeguro(cuerpo)).toBe(true);
    expect(cuerpo).not.toMatch(/\busted\b|\bsu paciencia\b|\batenderle\b/i);
  });
  it('lo que sale no usa la red de palabras prohibidas', () => {
    for (const previo of [OPERADOR, BLOQUEADO, null]) {
      const p = correr(previo);
      for (const m of p['mensajes'] as J[]) expect(L.vmTextoSeguro(m['cuerpo'])).toBe(true);
      if (p['aviso']) expect(L.vmTextoSeguro(p['aviso'].datos.motivo)).toBe(true);
    }
  });
});

// ================================================================================================
describe('Comercio no operativo', () => {
  const correr = (cfg: J): J => {
    const s = correrNodo('comercio-no-operativo', [{}], { 'Interpretar entrada': { from: CLIENTE }, 'Config del negocio': cfg });
    expect(s).toHaveLength(1);
    return s[0]!;
  };
  it('contesta el texto neutro de la configuración y nada más: sin botón, sin aviso, sin tocar el estado', () => {
    const p = correr({ mensajeComercioSuspendido: 'Volvemos pronto.' });
    expect(p).toEqual({
      estadoNuevo: null, mensajes: [{ tipo: 'texto', cuerpo: 'Volvemos pronto.', botones: [] }], condicionados: null,
      aviso: null, pedido: null, cierre: null, ruta: 'suspendido', errores: [],
    });
  });
  it('sin texto, el de respaldo; y ese texto nunca revela el motivo', () => {
    for (const cfg of [{}, { mensajeComercioSuspendido: '   ' }, { mensajeComercioSuspendido: undefined }]) {
      const cuerpo = String((correr(cfg)['mensajes'] as J[])[0]!['cuerpo']);
      expect(cuerpo).toBe('En este momento no podemos atenderte por este medio. Gracias por escribirnos.');
      expect(cuerpo).not.toMatch(/deuda|pago|suspendid|baja|plan|cuenta/i);
    }
  });
  it('sin `Config del negocio` corrida tampoco revienta', () => {
    const s = correrNodo('comercio-no-operativo', [{}], {});
    expect((s[0]!['mensajes'] as J[])[0]!['cuerpo']).toMatch(/no podemos atenderte/);
  });
});

// ================================================================================================
describe('Los cinco nodos y la librería: reglas de la zona', () => {
  const sinComentarios = (f: string): string => f.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const FUENTES: [string, string][] = [['comun.js', COMUN], ...NODOS.map((n): [string, string] => [`${n}.js`, FUENTE_NODO(n)])];
  const CODIGOS: [string, string][] = FUENTES.map(([n, f]): [string, string] => [n, sinComentarios(f)]);

  it('cada nodo corre pegado a la librería (sin nombres repetidos) y ningún archivo usa globales de Node', () => {
    // `ejecutar` quita URL, Buffer, crypto, process, require… : si un archivo los usara, las pruebas de arriba reventarían.
    for (const [nombre, fuente] of CODIGOS) {
      expect(fuente, nombre).not.toMatch(/\brequire\s*\(/);
      expect(fuente, nombre).not.toMatch(/\bnew\s+URL\b|\bURLSearchParams\b|\bBuffer\b|\bcrypto\b|\bprocess\.|\bstructuredClone\b|\bsetTimeout\b|\bfetch\s*\(/);
      expect(fuente, nombre).not.toMatch(/new Function|\beval\s*\(/);
    }
  });
  it('la librería no mira el reloj: el tiempo entra por parámetro (los nodos solo lo toman de la entrada)', () => {
    expect(sinComentarios(COMUN)).not.toMatch(/Date\.now\s*\(|new Date\(\s*\)/);
    // la carga de entrada es la única que lee el reloj, una vez, y lo pasa en `ahoraMs`
    expect(sinComentarios(FUENTE_NODO('carga-de-entrada'))).toMatch(/Date\.now\(\)/);
  });
  it('sin secretos, sin UUID, sin rutas de usuario, sin números de teléfono reales ni nombres de clientes', () => {
    for (const [nombre, fuente] of FUENTES) {
      expect(fuente, nombre).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(fuente, nombre).not.toMatch(/\/home\/|\/Users\/|C:\\Users/);
      expect(fuente, nombre).not.toMatch(/\d{9,}/);
      expect(fuente, nombre).not.toMatch(/bellido|q'?taco|doctor|consultorio|paciente|dhermacore/i);
      expect(fuente, nombre).not.toMatch(/EAA[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}/);
    }
  });
  it('textos al cliente en español de Bolivia, con tuteo y sin voseo', () => {
    for (const [nombre, fuente] of FUENTES) {
      const sc = sinComentarios(fuente);
      expect(sc, nombre).not.toMatch(/\b(tenés|querés|podés|sabés|decime|escribime|fijate|vení|elegí|mirá)\b/i);
      expect(sc, nombre).not.toMatch(/\busted\b|\batenderle\b|\bsu paciencia\b/i);
    }
  });
  it('lo que declara cada nodo: prefijos propios y ningún nombre de las librerías de otras tareas redefinido', () => {
    const OTROS = /\bfunction\s+(pd|rs|av|pr|cb)[A-Z]\w*\s*\(/;
    for (const [nombre, fuente] of FUENTES) expect(fuente, nombre).not.toMatch(OTROS);
    // toda función de la librería lleva el prefijo vm (o _vm si es privada)
    for (const m of COMUN.matchAll(/^function\s+(\w+)\s*\(/gm)) expect(m[1], m[1]).toMatch(/^_?vm[A-Z]/);
    for (const m of COMUN.matchAll(/^const\s+(\w+)\s*=/gm)) expect(m[1], m[1]).toMatch(/^_?VM_/);
  });
  it('ningún nodo agrega mensajes: a lo sumo uno por turno', () => {
    // Uso extendido en operador: 1; bloqueado: 0; comercio no operativo: 1; el resto no emite mensajes.
    const refs = (prev: J): Referencias => ({ 'Interpretar entrada': { from: CLIENTE, ahoraMs: AHORA }, 'Config del negocio': { numeroRecepcion: '59100000041' }, 'Reportar mensaje (entrante)': prev });
    expect((correrNodo('uso-extendido', [{}], refs({ atencion: { estado: 'operador' } }))[0]!['mensajes'] as J[]).length).toBe(1);
    expect((correrNodo('uso-extendido', [{}], refs({ atencion: { estado: 'bloqueado' } }))[0]!['mensajes'] as J[]).length).toBe(0);
    expect((correrNodo('comercio-no-operativo', [{}], {})[0]!['mensajes'] as J[]).length).toBe(1);
  });
});

// =================================================================================================
// RONDA 2 DEL PR-1: I1 (raíces acotadas), I2 (punto fijo, forma sin puntuación, marca explícita) y S-1 (homoglifos y marcas).
// =================================================================================================
describe('I1, I2 y S-1: la red de prohibidas y el saneo del texto de terceros', () => {
  const RED = (): RegExp => L.VM_PROHIBIDAS as unknown as RegExp;
  const sinProhibidas = L.vmSinProhibidas as (t: unknown, max?: number) => string;
  const canon = L.vmCanon as (t: unknown) => string;
  const MARCA = '[texto omitido]';

  it('I1: «reservado» y «confirmo» como dato no traban; las afirmaciones sí', () => {
    for (const t of ['Vino Tinto Reservado', 'Salón, terraza y sala reservada', 'Mesa reservada para eventos']) expect(L.vmTextoSeguro(t), t).toBe(true);
    for (const t of ['Tu reserva quedó reservada', 'Tu mesa está reservada', 'Confirmamos tu reserva', 'Reservamos tu mesa', 'Tu reserva está registrada', 'Reserva confirmada']) {
      expect(L.vmTextoSeguro(t), t).toBe(false);
    }
  });
  it('I2: los tres casos de la tabla, con puntuación, se omiten por palabra entera y con la marca explícita', () => {
    for (const t of ['Calle 3 en, camino a Obrajes', 'pago: recibido', 'en-camino']) {
      const r = sinProhibidas(t);
      expect(r, t).toContain(MARCA);
      expect(r, t).not.toContain('…');
      expect(RED().test(canon(r)), t).toBe(false);
      expect(RED().test(L.vmNorm(r)), t).toBe(false);
    }
    expect(sinProhibidas('Calle 3 en, camino a Obrajes')).toBe(`Calle 3 ${MARCA} a Obrajes`);
    expect(sinProhibidas('pago: recibido')).toBe(MARCA);
    expect(sinProhibidas('en-camino')).toBe(MARCA);
  });
  it('I2: por palabra entera, sin cortar ni normalizar fuera de la coincidencia (N.º, tildes, mayúsculas)', () => {
    expect(sinProhibidas('N.º 5 casa validada')).toBe(`N.º 5 casa ${MARCA}`);
    expect(sinProhibidas('Ñandú Pérez VALIDADO ya')).toBe(`Ñandú Pérez ${MARCA} ya`);
    expect(sinProhibidas('xvalidadox')).toBe(MARCA);
    expect(sinProhibidas('hola recibimos tu pago gracias')).toBe(`hola ${MARCA} gracias`);
    // Sin coincidencia, el texto vuelve idéntico (sin normalizar).
    expect(sinProhibidas('N.º 5 Ñandú, casa reservada')).toBe('N.º 5 Ñandú, casa reservada');
    expect(sinProhibidas('  dos  espacios\ty tab ')).toBe('  dos  espacios\ty tab ');
  });
  it('I2: punto fijo (si aún coincide tras reemplazar, devuelve solo la marca) y tope opcional sin cortar palabras', () => {
    const conRedPropia = ejecutar(`const VM_PROHIBIDAS = /texto/i;\n${COMUN.replace(/^const VM_PROHIBIDAS = .*$/m, '')}\nreturn [{ json: { vmSinProhibidas } }];`, [{}], {}, { $getWorkflowStaticData: () => ({}), Date: relojFijo(AHORA) })[0] as unknown as { vmSinProhibidas: (t: string) => string };
    expect(conRedPropia.vmSinProhibidas('hola texto')).toBe(MARCA);
    const largo = sinProhibidas('Calle 3 en camino a la casa azul del fondo', 20);
    expect(largo.length).toBeLessThanOrEqual(20);
    expect(largo).toBe('Calle 3');
    for (const palabra of largo.split(' ')) expect(['Calle', '3', MARCA]).toContain(palabra);
  });
  it('S-1: homoglifos, marcas combinantes y controles C1 no esconden una palabra prohibida', () => {
    const escondidas = ['pаgаdo', 'vαlidado', 'valídado', 'valídado', 'vali\u0090dado', 'раgаdo', 'acrеditado', 'ｖａｌｉｄａｄｏ'];
    for (const t of escondidas) {
      expect(L.vmTextoSeguro(`Tu pedido ${t}`), JSON.stringify(t)).toBe(false);
      expect(RED().test(L.vmNorm(`Tu pedido ${t}`)), JSON.stringify(t)).toBe(true);
      expect(sinProhibidas(`Tu pedido ${t} ya`), JSON.stringify(t)).toBe(`Tu pedido ${MARCA} ya`);
    }
    // Texto legítimo (también en cirílico, griego o con tildes) no cambia por la tabla.
    for (const t of ['Piña colada, jalapeño y café', 'Москва 5', 'Ελλάδα']) {
      expect(L.vmTextoSeguro(t), t).toBe(true);
      expect(sinProhibidas(t), t).toBe(t);
    }
    // Las dos cadenas de la tabla de confusables tienen la misma longitud.
    const m = /const VM_CONFUSABLES_DE = '([^']+)' \+ '([^']+)';\nconst VM_CONFUSABLES_A = '([^']+)' \+ '([^']+)';/.exec(COMUN)!;
    expect(Array.from(m[1]!).length).toBe(m[3]!.length);
    expect(Array.from(m[2]!).length).toBe(m[4]!.length);
  });
  it('S-1: `vmLinea` quita los controles C1 (no los cambia por un espacio) y el resultado sigue atrapado', () => {
    expect(L.vmLinea('vali\u0090dado')).toBe('validado');
    expect(sinProhibidas(L.vmLinea('vali\u0090dado'))).toBe(MARCA);
    // \u0085 (NEL) sí separa.
    expect(L.vmLinea('a\u0085b')).toBe('a b');
    expect(L.vmLinea('Hola\u0080 mundo')).toBe('Hola mundo');
  });
  it('S-5: `recib\\S{0,40}` acota la raíz; una palabra de 41 caracteres tras «recib» no la dispara', () => {
    expect(RED().source).toContain('recib\\S{0,40} (tu|el) pago');
    expect(L.vmTextoSeguro('recib' + 'x'.repeat(41) + ' tu pago')).toBe(true);
    expect(L.vmTextoSeguro('recibimos tu pago')).toBe(false);
  });
});
