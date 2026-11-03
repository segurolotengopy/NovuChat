/**
 * «VENTA DIGITAL DE RUBÉN» — LA UBICACIÓN CON ENLACE DE GOOGLE MAPS (adaptada de Evy, no copiada).
 *
 * Cuando el cliente pide la ubicación, el CÓDIGO agrega el enlace de Maps de la Consola (`datosDelNegocio.direccionMaps`, la misma regla que `enlaceDeMapaValido` del servidor) y la dirección en texto si existe.
 * Sin ese dato no se inventa nada: lo único que se ofrece es pasar con Rubén (aviso + botón), según «solo se ofrece lo que se cumple».
 *
 * ESCRIBE NEGANDO: enlace con host ajeno, http, javascript:, espacios o más de 200 caracteres no sale y se deriva; sin dato no hay dirección ni enlace inventados; si el cliente no pide la ubicación no se agrega
 * nada; el modelo no puede poner un enlace por su cuenta; y el conteo de mensajes por conversación no cambia (un solo mensaje al cliente por turno, un solo aviso).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { crearMundo, type Doble, type LlamadaDoble, type Mundo } from '../../lib/n8n-de-mentira';
import { doblesDelGuardado } from '../../lib/doble-guardado';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental/rroca-ruben');
const PRODUCCION = JSON.parse(readFileSync(join(CARPETA, 'rroca-ruben.json'), 'utf8')) as Flujo;
const PID = '59100000042';
const ANA = '59100000011';
const REC = '59100000031';
const AHORA = Date.UTC(2026, 9, 5, 14, 0, 0);
const MAPS = 'https://maps.app.goo.gl/AbCdEf123';
const DIR = 'Calle de Prueba 123, Zona Central';

const codigo = ['cobro.js', 'avisos.js', 'rr.js'].map((a) => readFileSync(join(CARPETA, 'src/lib', a), 'utf8')).join('\n');
// El código evaluado es el de los archivos del propio repositorio (src/lib), en un contexto aislado de `node:vm`.
const L = runInNewContext(codigo + '\n({ rrDireccionDeTexto, rrPideUbicacion, rrEnlaceDeMapa, rrUbicacionSinDato, rrLineasDeUbicacion, RR_PROMPT })') as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let seq = 0;
const entrega = (texto: string, from = ANA): J => ({
  headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `entrega-${++seq}`, 'x-aab1-attempt': '1' },
  body: { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '59100000001', phone_number_id: PID }, contacts: [{ profile: { name: 'Ana' }, wa_id: from }], messages: [{ from, id: `wamid.IN${++seq}`, timestamp: '1', type: 'text', text: { body: texto } }] } },
});
const gemini = (t: string): J => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
function crear(datos: J, modelo: Doble = gemini('Estoy aquí para ayudarte con el libro y los bonos.')): Mundo {
  const dobles: Record<string, Doble> = {
    ...doblesDelGuardado().dobles,
    'Verificar firma con el receptor': (ll: LlamadaDoble) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Traer configuración': () => ({ statusCode: 200, body: { tenantId: 'rroca-ruben', estadoComercio: 'activo', datosDelNegocio: { nombreNegocio: 'Rubén Roca', ...datos }, operacion: { numeroRecepcion: REC, prefijosPermitidos: ['591'] }, voz: { nombreAsistente: '' }, atencion: { estado: 'normal' }, catalogo: [{ id: 'pack-completo', precio: 60, agotado: false }, { id: 'libro-bonos', precio: 32, agotado: false }, { id: 'closer-ventas', precio: 20, agotado: false }, { id: 'videos-ia', precio: 25, agotado: false }], anuncios: [], venta: {} } }),
    'Reportar mensaje (entrante)': () => ({ ok: true }),
    'Reportar mensaje (saliente)': () => ({ ok: true }),
    'Conversar con el modelo': modelo,
    'Enviar aviso': () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.AVISO' }] }),
    'Enviar a WhatsApp': (ll: LlamadaDoble) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${++seq}${ll.n}` }] }),
    'Enviar respaldo': (ll: LlamadaDoble) => ({ messaging_product: 'whatsapp', messages: [{ id: `wamid.RES${++seq}${ll.n}` }] }),
  };
  return crearMundo({ flujo: PRODUCCION, dobles, ahoraMs: AHORA, configBase: { phoneNumberIdEsperado: PID, numeroRecepcion: REC, telefonosDePrueba: ANA } });
}
/** Un turno: devuelve lo que se le envió al cliente y los avisos a recepción. */
function pregunta(datos: J, q: string, modelo?: Doble) {
  const w = crear(datos, modelo);
  const r = w.turno(entrega(q), {});
  return { r, cliente: r.mensajesA(ANA), texto: r.mensajesA(ANA).map((m) => m.cuerpo).join('\n'), avisos: r.avisosA(REC) };
}
const PIDEN = ['¿Dónde quedan?', 'cual es la ubicación?', 'Mándame el mapa', '¿Cómo llego?', '¿Cuál es su dirección?', '¿Dónde está ubicado?', 'mándame el mapa por favor', 'pásame el mapa de ubicación'];
const NO_PIDEN = ['¿Cuánto cuesta el libro?', 'qué incluye el Mapa de Automatización', 'mi dirección de correo es ana@ejemplo.com', '¿dónde queda el libro después de pagar?', 'hola', 'quiero el mapa', 'el mapa me interesa', '¿qué trae el mapa?', 'a qué dirección te mando el comprobante', 'la direccion de pago', 'la dirección del correo', '¿dónde queda el link?', 'donde queda el acceso'];

describe('el validador es LA MISMA regla que el servidor', () => {
  it('acepta https de los dominios de mapas de Google y nada más', () => {
    for (const ok of [MAPS, 'https://www.google.com/maps?q=1,2', 'https://goo.gl/maps/xyz', 'https://maps.google.com/?q=1,2', 'https://google.com/maps/place/x']) expect(L.rrEnlaceDeMapa(ok), ok).toBe(ok);
    const largo = 'https://www.google.com/maps?q=' + 'a'.repeat(200);
    for (const mal of ['http://maps.app.goo.gl/x', 'javascript:alert(1)', 'https://evil.example/maps', 'https://www.google.com.bo/maps/x', 'https://www.google.com/maps?q=1, 2', 'https://maps.app.goo.gl.evil.example/x', largo, '', '   ', 42, null, undefined, { a: 1 }]) {
      expect(L.rrEnlaceDeMapa(mal), String(mal)).toBe('');
    }
  });
  it('coincide con la expresión del servidor (prompt.ts) carácter por carácter', () => {
    const srv = readFileSync(join(CARPETA, '../../../admin/functions/src/core/prompt/prompt.ts'), 'utf8');
    const m = /export const ENLACE_DE_MAPA =\s*(\/\^https[^\n]*\$\/);/.exec(srv);
    expect(m, 'no se encontró ENLACE_DE_MAPA en el servidor').not.toBeNull();
    expect(readFileSync(join(CARPETA, 'src/lib/rr.js'), 'utf8')).toContain('const RR_ENLACE_DE_MAPA = ' + m![1] + ';');
    expect(readFileSync(join(CARPETA, 'src/nodos/config-del-negocio.js'), 'utf8')).toContain('const ENLACE_DE_MAPA = ' + m![1] + ';');
  });
});

describe('detección de la pregunta', () => {
  it('pide ubicación: las frases típicas; no la pide: precio, bono «Mapa de Automatización», dirección de correo, dónde queda el libro', () => {
    for (const q of PIDEN) expect(L.rrPideUbicacion(q), q).toBe(true);
    for (const q of NO_PIDEN) expect(L.rrPideUbicacion(q), q).toBe(false);
  });
});

describe('(a) pide ubicación y hay enlace válido: sale el enlace (y la dirección si existe)', () => {
  for (const q of PIDEN) {
    it(`«${q}»`, () => {
      const { cliente, texto, avisos } = pregunta({ direccionMaps: MAPS, direccion: DIR }, q);
      expect(cliente).toHaveLength(1);
      expect(texto).toContain(`📍 Ubicación: ${MAPS}`);
      expect(texto).toContain(`Dirección: ${DIR}`);
      expect(avisos).toHaveLength(0);
    });
  }
  it('solo con el enlace (sin dirección): sale el enlace y no se inventa una dirección', () => {
    const { texto } = pregunta({ direccionMaps: MAPS }, '¿Dónde quedan?');
    expect(texto).toContain(`📍 Ubicación: ${MAPS}`);
    expect(texto).not.toMatch(/Dirección:/);
  });
  it('solo con la dirección (sin enlace): sale la dirección, sin línea de enlace y sin derivar', () => {
    const { texto, avisos } = pregunta({ direccion: DIR }, '¿Dónde quedan?');
    expect(texto).toContain(`Dirección: ${DIR}`);
    expect(texto).not.toContain('📍');
    expect(avisos).toHaveLength(0);
  });
});

describe('(b) enlace inválido: no sale y se ofrece recepción', () => {
  const largo = 'https://www.google.com/maps?q=' + 'a'.repeat(200);
  for (const [nombre, valor] of [['host ajeno', 'https://evil.example/maps/x'], ['http', 'http://maps.app.goo.gl/x'], ['javascript:', 'javascript:alert(1)'], ['con espacios', 'https://www.google.com/maps?q=1, 2'], ['más de 200 caracteres', largo], ['no es texto', 42]] as const) {
    it(`enlace ${nombre}, sin dirección: ni enlace ni dirección; aviso a recepción y botón`, () => {
      const { cliente, texto, avisos } = pregunta({ direccionMaps: valor }, '¿Dónde quedan?');
      expect(texto).not.toContain('📍');
      expect(texto).not.toMatch(/https?:|javascript:|evil\.example/);
      expect(texto).not.toMatch(/Dirección:/);
      expect(cliente).toHaveLength(1);
      expect(JSON.stringify(cliente[0]!.payload)).toMatch(/wa\.me|Rubén/); // el botón o el respaldo con el contacto de Rubén
      expect(avisos.length).toBeGreaterThan(0);
    });
  }
});

describe('(c) sin dato: no se inventa nada; lo único que se ofrece es pasar con Rubén', () => {
  for (const q of PIDEN) {
    it(`«${q}» con la Consola sin ubicación`, () => {
      const { cliente, texto, avisos, r } = pregunta({}, q, gemini('Estamos en la Calle Falsa 123, https://maps.app.goo.gl/inventado'));
      expect(cliente).toHaveLength(1);
      expect(texto).not.toMatch(/Calle Falsa|inventado|https?:|📍|Dirección:/);
      expect(texto).toMatch(/Rubén/);
      expect(avisos.length).toBeGreaterThan(0);
      expect(JSON.stringify(avisos[0]!.payload)).toMatch(/ubicaci/i);
      expect(r.fallo).toBeNull();
    });
  }
  it('sin dato, el texto no promete nada sin respaldo: ni «te aviso luego» ni «te llamamos»', () => {
    const { texto } = pregunta({}, '¿Dónde quedan?');
    expect(texto).not.toMatch(/te aviso luego|te llamamos|te escribir[aá]n|lo consulto/i);
  });
});

describe('(d) el cliente NO pide la ubicación: no se agrega nada', () => {
  for (const q of NO_PIDEN) {
    it(`«${q}»`, () => {
      const { texto } = pregunta({ direccionMaps: MAPS, direccion: DIR }, q);
      expect(texto).not.toContain('📍');
      expect(texto).not.toContain(MAPS);
      expect(texto).not.toContain(DIR);
    });
  }
});

describe('(e) el modelo no puede poner un enlace por su cuenta', () => {
  it('el prompt sigue sin enlaces ni direcciones', () => {
    expect(String(L.RR_PROMPT)).not.toMatch(/https?:|www\.|maps/i);
  });
  it('un enlace de Maps que escribe el modelo se descarta; el único que sale es el de la Consola', () => {
    const { texto } = pregunta({ direccionMaps: MAPS }, '¿Dónde quedan?', gemini('Nos ubicas aquí: https://maps.app.goo.gl/inventado'));
    expect(texto).not.toContain('inventado');
    expect(texto).toContain(MAPS);
  });
  it('si el cliente NO pidió la ubicación y el modelo pone un enlace, no sale', () => {
    const { texto } = pregunta({ direccionMaps: MAPS }, '¿Cuánto cuesta el libro?', gemini('Mira esto https://maps.app.goo.gl/inventado'));
    expect(texto).not.toContain('inventado');
    expect(texto).not.toContain(MAPS);
  });
});

describe('(f) el conteo de mensajes por conversación no cambia', () => {
  it('pidiendo la ubicación, con dato o sin él, sale UN mensaje al cliente por turno (el mismo que ya salía) y a lo más un aviso', () => {
    for (const datos of [{ direccionMaps: MAPS, direccion: DIR }, {}, { direccionMaps: 'http://x' }]) {
      const w = crear(datos);
      const normal = w.turno(entrega('hola'), {});
      const r = w.turno(entrega('¿Dónde quedan?'), {});
      expect(normal.mensajesA(ANA)).toHaveLength(1);
      expect(r.mensajesA(ANA)).toHaveLength(1);
      expect(r.avisos.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('cancelación, dirección disfrazada, clave propia y costo del modelo', () => {
  it('«cancela mi pedido, ¿dónde quedan?» no se trata como pedido de ubicación (gana la cancelación)', () => {
    expect(L.rrPideUbicacion('cancela mi pedido, ¿dónde quedan?')).toBe(false);
    expect(L.rrPideUbicacion('¿dónde quedan?')).toBe(true);
  });
  it('una dirección con dominio sin esquema, con «maps» o con caracteres invisibles se rechaza', () => {
    for (const mal of ['bit.ly/abc', 'ejemplo.com/ir', 't.me/x', 'Calle 5 ejemplo.com', 'Plaza Maps 12', 'https\u200B://x.example', 'Calle\u2060 5', 'Calle\uFEFF 5', 'http://x.example']) expect(L.rrDireccionDeTexto(mal), mal).toBe('');
    expect(L.rrDireccionDeTexto(DIR)).toBe(DIR);
    // y por la Consola: no sale como dirección y, sin más dato, se deriva
    const { texto, avisos } = pregunta({ direccion: 'bit.ly/abc' }, '¿Dónde quedan?');
    expect(texto).not.toMatch(/bit\.ly|Dirección:/);
    expect(avisos.length).toBeGreaterThan(0);
  });
  it('el aviso sin dato lleva su clave propia `ubicacion`, y no comparte el límite de 30 minutos con «no supo»', () => {
    const w = crear({});
    const r1 = w.turno(entrega('¿Dónde quedan?'), {});
    expect(r1.avisosA(REC).length).toBeGreaterThan(0);
    expect(JSON.stringify(r1.porNodo['Armar avisos'])).toContain('"clave":"ubicacion"');
    expect(r1.mensajesA(ANA)[0]!.cuerpo).toMatch(/ubicación cargada/);
  });
  it('sin dato no se llama al modelo (sin costo de Gemini); con dato sí', () => {
    const sin = crear({});
    expect(sin.turno(entrega('¿Dónde quedan?'), {}).registro.filter((x) => x.nodo === 'Conversar con el modelo')).toHaveLength(0);
    const con = crear({ direccionMaps: MAPS });
    expect(con.turno(entrega('¿Dónde quedan?'), {}).registro.filter((x) => x.nodo === 'Conversar con el modelo')).toHaveLength(1);
  });
});
