/**
 * LOS AVISOS AL RESTAURANTE DE «VENTA MÍNIMA v0» (`Flujos/experimental/venta-minima/src/lib/avisos.js`, T4).
 *
 * Qué se prueba, y siempre con su caso negativo:
 *  - destinatarios y roles (`rol:tel[:Nombre]`), sin el propio número y con el rol de menos privilegio;
 *  - el saneo de las variables de plantilla (saltos de línea, enlaces, 5 espacios, tope de 500, vacío);
 *  - la ventana de 24 h por destinatario (2 h, 25 h y el borde de 23 h 30 min) y el tope diario con cambio de día;
 *  - una plantilla por evento (pedido, reserva, derivación), cada una con su orden de variables;
 *  - el rol `cocina`: ni teléfono ni dirección ni números largos;
 *  - el detalle jamás coincide con `VM_PROHIBIDAS` (25 escenarios con contenido hostil) y termina en su cierre;
 *  - ni `avArmar` ni `avPlan` tocan el estado: solo escriben `avAnotarEntrante` y `avContar`.
 *
 * El reloj es un parámetro: `AHORA` es el lunes 05/10/2026 a las 10:00 de La Paz (`Date.UTC(2026,9,5,14)`).
 * Los teléfonos son sintéticos, con seis ceros. La librería es JavaScript plano para un nodo Code de n8n y se
 * evalúa con `ejecutar` de `./lib/flujo`, que le quita los globales que el sandbox de n8n no tiene (URL, Buffer,
 * crypto…): si `avisos.js` usara alguno, aquí reventaría igual que en producción.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RUTA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src/lib/avisos.js');
const FUENTE = readFileSync(RUTA, 'utf8');

const NOMBRES = [
  'avDestinatarios', 'avParametro', 'avPlantilla', 'avTexto', 'avVentanaAbierta', 'avAnotarEntrante',
  'avDentroDelTopeDiario', 'avContar', 'avArmar', 'avPlan', 'avLimpio', 'avFechaLegible',
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
type Lib = Record<(typeof NOMBRES)[number], Fn>;
const cargar = (antes = ''): Lib =>
  ejecutar(`${antes}\n${FUENTE}\nreturn [{ json: { ${NOMBRES.join(', ')} } }];`, [{}])[0] as unknown as Lib;
const L = cargar();

// La lista de palabras que el asistente jamás dice (la misma que `comun.js` define como `VM_PROHIBIDAS`).
const VM_PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo (est[aá]n )?prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto/i;

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026 10:00 en La Paz
const HORA = 60 * 60 * 1000;
const MIN = 60 * 1000;
const ANDRES = '59100000011';
const SILVANA = '59100000022';
const CLIENTE = '59100000033';
const DIRECCION = 'Avenida Banzer 1234';
const REFERENCIA = 'frente a la farmacia azul';
const CUENTA = '1000000000045';

const CSV = `completo:${ANDRES}:Andres,cocina:${SILVANA}:Silvana`;
const CFG = { nombreNegocio: "Q'Taco", prefijosPermitidos: '591' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
const sdCon = (ventana: Record<string, number> = {}): J => ({ av: { ventana, dia: { fecha: '', n: 0 } } });
const abierta = (): J => sdCon({ [ANDRES]: AHORA - 2 * HORA, [SILVANA]: AHORA - 2 * HORA });

const pedido = (extra: J = {}): J => ({
  codigo: 'K7P2', nombre: 'Ana Pérez', telefono: CLIENTE, modalidad: 'delivery', total: 110,
  direccion: DIRECCION, referencia: REFERENCIA, resultado: 'cuadra',
  lineas: [
    { cantidad: 2, nombre: 'Orden de 3 tacos de birria', detalle: 'sin cebolla' },
    { cantidad: 1, nombre: 'Queso fundido con chorizo', detalle: '' },
  ],
  ...extra,
});
const reserva = (extra: J = {}): J => ({
  codigo: 'R4T9', nombre: 'Ana Pérez', telefono: CLIENTE,
  reserva: { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: 'cumpleaños', requerimiento: 'una silla alta' },
  ...extra,
});

/** Todos los textos de un ítem: variables de plantilla, cuerpo o pie de foto. */
const textosDe = (it: J): string[] => {
  const p = it.payload;
  if (p.type === 'template') return p.template.components[0].parameters.map((x: J) => x.text);
  if (p.type === 'text') return [p.text.body];
  if (p.type === 'image') return [p.image.caption];
  return [];
};
const params = (it: J): string[] => it.payload.template.components[0].parameters.map((x: J) => x.text);
const cuerpo = (items: J[], tel: string): string => items.find((i) => i.para === tel && i.clase === 'detalle')?.payload.text.body;
const plantillaDe = (items: J[], tel: string): J => items.find((i) => i.para === tel && i.clase === 'plantilla')!;

describe('avDestinatarios — rol:tel[:Nombre]', () => {
  it('lee el rol, el teléfono y el nombre', () => {
    expect(L.avDestinatarios(CSV, CLIENTE, '591')).toEqual([
      { rol: 'completo', tel: ANDRES, nombre: 'Andres' },
      { rol: 'cocina', tel: SILVANA, nombre: 'Silvana' },
    ]);
  });
  it('un rol desconocido o ausente es cocina (el de menos privilegio)', () => {
    const r = L.avDestinatarios(`jefe:${ANDRES},${SILVANA},:59100000044`, CLIENTE, '591');
    expect(r.map((x: J) => x.rol)).toEqual(['cocina', 'cocina', 'cocina']);
    expect(r.map((x: J) => x.tel)).toEqual([ANDRES, SILVANA, '59100000044']);
    expect(L.avDestinatarios(`COMPLETO:${ANDRES}`, CLIENTE, '591')[0].rol).toBe('completo');
  });
  it('un número repetido queda con el rol de menos privilegio, en cualquier orden', () => {
    const a = L.avDestinatarios(`completo:${ANDRES}:Andres,cocina:${ANDRES}`, CLIENTE, '591');
    const b = L.avDestinatarios(`cocina:${ANDRES},completo:${ANDRES}:Andres`, CLIENTE, '591');
    expect(a).toEqual([{ rol: 'cocina', tel: ANDRES, nombre: 'Andres' }]);
    expect(b).toEqual([{ rol: 'cocina', tel: ANDRES, nombre: 'Andres' }]);
  });
  it('nunca incluye el propio número de quien escribe (con o sin +)', () => {
    expect(L.avDestinatarios(CSV, ANDRES, '591').map((x: J) => x.tel)).toEqual([SILVANA]);
    expect(L.avDestinatarios(CSV, `+${SILVANA}`, '591').map((x: J) => x.tel)).toEqual([ANDRES]);
    expect(L.avDestinatarios(`completo:${CLIENTE}`, CLIENTE, '591')).toEqual([]);
  });
  it('descarta marcadores, números cortos o largos y prefijos no permitidos', () => {
    const csv = `completo:REEMPLAZAR_NUMERO_AVISO_1_QTACO,cocina:1234567,cocina:1234567890123456,cocina:54100000055,cocina:${SILVANA}`;
    expect(L.avDestinatarios(csv, CLIENTE, '591').map((x: J) => x.tel)).toEqual([SILVANA]);
    expect(L.avDestinatarios(`cocina:54100000055`, CLIENTE, '54').map((x: J) => x.tel)).toEqual(['54100000055']);
    // Sin prefijos configurados rige 591, no «cualquiera».
    expect(L.avDestinatarios(`cocina:54100000055,cocina:${SILVANA}`, CLIENTE, '').map((x: J) => x.tel)).toEqual([SILVANA]);
  });
  it('csv vacío o ausente da una lista vacía; el nombre sale saneado', () => {
    expect(L.avDestinatarios('', CLIENTE, '591')).toEqual([]);
    expect(L.avDestinatarios(undefined, CLIENTE, '591')).toEqual([]);
    expect(L.avDestinatarios(`cocina:${SILVANA}:Silvana  <b>\n`, CLIENTE, '591')[0].nombre).toBe('Silvana b');
  });
});

describe('avParametro — las variables de plantilla', () => {
  it('saltos de línea y tabuladores desaparecen (quedan « · ») y no hay dos espacios seguidos', () => {
    const r = L.avParametro('Taco de birria\nsin cebolla\r\n\tcon  limón     extra');
    expect(r).toBe('Taco de birria · sin cebolla · con limón extra');
    expect(r).not.toMatch(/[\r\n\t]/);
    expect(r).not.toMatch(/\s{2,}/);
    expect(L.avParametro('\n\nhola\n\n')).toBe('hola');
  });
  it('cinco espacios o más seguidos (también NBSP) se vuelven uno', () => {
    expect(L.avParametro('a     b')).toBe('a b');
    expect(L.avParametro('a      b')).toBe('a b');
  });
  it('los enlaces se omiten', () => {
    expect(L.avParametro('mira https://ejemplo.com/pago?x=1 ya')).toBe('mira [enlace omitido] ya');
    expect(L.avParametro('www.ejemplo.bo/menu y wa.me/59100000011')).toBe('[enlace omitido] y [enlace omitido]');
    expect(L.avParametro('visita ejemplo.com')).toBe('visita [enlace omitido]');
    // Negativo: un texto sin enlace queda igual.
    expect(L.avParametro('Taco de birria, 2 unidades.')).toBe('Taco de birria, 2 unidades.');
  });
  it('quita {}<>& (no deben viajar en una variable)', () => {
    const r = L.avParametro('{{1}} <script>x</script> Tom & Jerry');
    expect(r).not.toMatch(/[{}<>&]/);
    expect(r).toContain('Tom Jerry');
  });
  it('tope de 500 caracteres por defecto y tope explícito', () => {
    expect(L.avParametro('x'.repeat(900)).length).toBe(500);
    expect(L.avParametro('x'.repeat(900), 60).length).toBe(60);
    expect(L.avParametro('x'.repeat(499)).length).toBe(499);
    // El recorte no deja un par sustituto partido (el emoji se quita entero o se queda entero).
    const e = L.avParametro('a'.repeat(59) + '😀😀', 60);
    expect(e).toBe('a'.repeat(59) + '😀');
  });
  it('vacío, solo espacios o solo separadores = «—»', () => {
    for (const v of ['', '   ', '\n\t', undefined, null, '\n\n \t']) expect(L.avParametro(v)).toBe('—');
  });
  it('las palabras prohibidas se cambian por «…»', () => {
    const r = L.avParametro('pago confirmado y ya lo preparan');
    expect(r).not.toMatch(VM_PROHIBIDAS);
    expect(r).toContain('…');
  });
  it('para rol cocina se quitan además los números largos', () => {
    expect(L.avLimpio(`llámame al 71234567 o al +591 7123 4567 cuenta ${CUENTA}`, 200, { cocina: true })).not.toMatch(/\d{7}/);
    expect(L.avLimpio('2 tacos y 10 de maíz', 200, { cocina: true })).toBe('2 tacos y 10 de maíz');
    // Negativo: sin la opción, los números largos se conservan.
    expect(L.avLimpio('71234567', 200)).toBe('71234567');
  });
});

describe('avPlantilla y avTexto — la carga útil', () => {
  it('la plantilla lleva nombre, idioma y las variables saneadas', () => {
    const p = L.avPlantilla(`+${ANDRES}`, 'pedido_registrado', 'es', ['a\nb', '', 'x'.repeat(900), 'd']);
    expect(p).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: ANDRES, type: 'template',
      template: {
        name: 'pedido_registrado', language: { code: 'es' },
        components: [{ type: 'body', parameters: [
          { type: 'text', text: 'a · b' }, { type: 'text', text: '—' },
          { type: 'text', text: 'x'.repeat(500) }, { type: 'text', text: 'd' },
        ] }],
      },
    });
  });
  it('un nombre inválido, vacío o un teléfono vacío no producen mensaje; un idioma raro cae a es', () => {
    expect(L.avPlantilla(ANDRES, '', 'es', [])).toBeNull();
    expect(L.avPlantilla(ANDRES, 'Nombre Con Espacios', 'es', [])).toBeNull();
    expect(L.avPlantilla('', 'pedido_registrado', 'es', [])).toBeNull();
    expect(L.avPlantilla(ANDRES, 'pedido_registrado', 'es_MX', ['a']).template.language.code).toBe('es_MX');
    expect(L.avPlantilla(ANDRES, 'pedido_registrado', 'español!', ['a']).template.language.code).toBe('es');
  });
  it('el texto va sin vista previa de enlaces', () => {
    expect(L.avTexto(ANDRES, 'hola\nmundo')).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: ANDRES, type: 'text',
      text: { preview_url: false, body: 'hola\nmundo' },
    });
  });
});

describe('ventana de 24 h por destinatario', () => {
  it('escribió hace 2 h → plantilla + detalle', () => {
    const items = L.avArmar('pedido', pedido(), CSV, CFG, sdCon({ [ANDRES]: AHORA - 2 * HORA }), AHORA);
    expect(items.filter((i: J) => i.para === ANDRES).map((i: J) => i.clase)).toEqual(['plantilla', 'detalle']);
  });
  it('escribió hace 25 h → solo plantilla (jamás el texto «a ver si pasa»)', () => {
    const items = L.avArmar('pedido', pedido(), CSV, CFG, sdCon({ [ANDRES]: AHORA - 25 * HORA }), AHORA);
    expect(items.filter((i: J) => i.para === ANDRES).map((i: J) => i.clase)).toEqual(['plantilla']);
    expect(items.some((i: J) => i.payload.type === 'text')).toBe(false);
  });
  it('el borde: 23 h 29 min 59 s abierta; 23 h 30 min exactos, cerrada', () => {
    const v = (ms: number): J => sdCon({ [ANDRES]: AHORA - ms });
    expect(L.avVentanaAbierta(v(23 * HORA + 29 * MIN + 59000), ANDRES, AHORA)).toBe(true);
    expect(L.avVentanaAbierta(v(23 * HORA + 30 * MIN), ANDRES, AHORA)).toBe(false);
    expect(L.avVentanaAbierta(v(23 * HORA + 30 * MIN + 1), ANDRES, AHORA)).toBe(false);
    expect(L.avVentanaAbierta(v(0), ANDRES, AHORA)).toBe(true);
    const items = L.avArmar('pedido', pedido(), `completo:${ANDRES}`, CFG, v(23 * HORA + 30 * MIN), AHORA);
    expect(items.map((i: J) => i.clase)).toEqual(['plantilla']);
  });
  it('sin registro, sin estado o con un valor roto, la ventana está cerrada', () => {
    expect(L.avVentanaAbierta(sdCon(), ANDRES, AHORA)).toBe(false);
    expect(L.avVentanaAbierta({}, ANDRES, AHORA)).toBe(false);
    expect(L.avVentanaAbierta(null, ANDRES, AHORA)).toBe(false);
    expect(L.avVentanaAbierta({ av: { ventana: { [ANDRES]: 'ayer' } } }, ANDRES, AHORA)).toBe(false);
  });
  it('cada destinatario tiene su propia ventana', () => {
    const sd = sdCon({ [ANDRES]: AHORA - 2 * HORA, [SILVANA]: AHORA - 30 * HORA });
    const items = L.avArmar('pedido', pedido(), CSV, CFG, sd, AHORA);
    expect(items.filter((i: J) => i.para === ANDRES)).toHaveLength(2);
    expect(items.filter((i: J) => i.para === SILVANA)).toHaveLength(1);
  });
  it('avAnotarEntrante escribe, no retrocede, y no guarda a quien no es un teléfono', () => {
    const sd: J = {};
    expect(L.avAnotarEntrante(sd, `+${ANDRES}`, AHORA)).toBe(true);
    expect(sd.av.ventana[ANDRES]).toBe(AHORA);
    L.avAnotarEntrante(sd, ANDRES, AHORA - HORA);
    expect(sd.av.ventana[ANDRES]).toBe(AHORA);
    expect(L.avVentanaAbierta(sd, ANDRES, AHORA + 2 * HORA)).toBe(true);
    expect(L.avVentanaAbierta(sd, ANDRES, AHORA + 24 * HORA)).toBe(false);
    expect(L.avAnotarEntrante(sd, '', AHORA)).toBe(false);
    expect(L.avAnotarEntrante(null, ANDRES, AHORA)).toBe(false);
    expect(Object.keys(sd.av.ventana)).toEqual([ANDRES]);
  });
  it('avAnotarEntrante barre lo vencido y acota el tamaño', () => {
    const sd: J = { av: { ventana: { '59100000099': AHORA - 40 * HORA } } };
    L.avAnotarEntrante(sd, ANDRES, AHORA);
    expect(sd.av.ventana['59100000099']).toBeUndefined();
    const lleno: J = {};
    for (let i = 0; i < 80; i++) L.avAnotarEntrante(lleno, `591${String(i).padStart(8, '0')}`, AHORA - i * MIN);
    expect(Object.keys(lleno.av.ventana).length).toBeLessThanOrEqual(50);
  });
});

describe('tope diario', () => {
  const tope = 3;
  it('con cupo pasa; al llegar al tope ya no, y se anota el error', () => {
    const sd = sdCon();
    expect(L.avDentroDelTopeDiario(sd, AHORA, tope)).toBe(true);
    expect(L.avContar(sd, AHORA, 2)).toBe(2);
    expect(L.avDentroDelTopeDiario(sd, AHORA, tope)).toBe(true);
    expect(L.avContar(sd, AHORA, 1)).toBe(3);
    expect(L.avDentroDelTopeDiario(sd, AHORA, tope)).toBe(false);
    const r = L.avPlan('pedido', pedido(), CSV, { ...CFG, topeAvisosDia: tope }, sd, AHORA);
    expect(r.items).toEqual([]);
    expect(r.errores).toContain('tope_avisos_dia');
  });
  it('el contador vuelve a cero con el día de La Paz (a medianoche local, no a la UTC)', () => {
    const sd = sdCon();
    L.avContar(sd, AHORA, tope);
    const medianocheLocal = Date.UTC(2026, 9, 6, 4); // 00:00 del martes en La Paz
    expect(L.avDentroDelTopeDiario(sd, medianocheLocal - 1, tope)).toBe(false); // 23:59:59.999 del lunes
    expect(L.avDentroDelTopeDiario(sd, medianocheLocal, tope)).toBe(true);
    expect(L.avContar(sd, medianocheLocal, 1)).toBe(1);
    expect(sd.av.dia).toEqual({ fecha: '2026-10-06', n: 1 });
    const r = L.avPlan('pedido', pedido(), CSV, { ...CFG, topeAvisosDia: tope }, sd, medianocheLocal);
    expect(r.items.length).toBeGreaterThan(0);
  });
  it('avContar suma de a uno por defecto, no resta y sin estado no revienta', () => {
    const sd = sdCon();
    expect(L.avContar(sd, AHORA)).toBe(1);
    expect(L.avContar(sd, AHORA, -5)).toBe(1);
    expect(L.avContar(sd, AHORA, 0)).toBe(1);
    expect(L.avContar(null, AHORA, 1)).toBe(0);
    const vacio: J = {};
    L.avContar(vacio, AHORA, 2);
    expect(vacio.av.dia).toEqual({ fecha: '2026-10-05', n: 2 });
  });
  it('sin tope configurado rige 150; un tope de 0 corta todo', () => {
    const sd = sdCon();
    L.avContar(sd, AHORA, 149);
    expect(L.avDentroDelTopeDiario(sd, AHORA, undefined)).toBe(true);
    expect(L.avDentroDelTopeDiario(sd, AHORA, '')).toBe(true);
    L.avContar(sd, AHORA, 1);
    expect(L.avDentroDelTopeDiario(sd, AHORA, undefined)).toBe(false);
    expect(L.avDentroDelTopeDiario(sdCon(), AHORA, 0)).toBe(false);
  });
  it('con cupo parcial se conservan primero las plantillas', () => {
    const sd = abierta();
    L.avContar(sd, AHORA, 147); // quedan 3 de 150; el pedido da 4 ítems (2 plantillas + 2 detalles)
    const r = L.avPlan('pedido', pedido(), CSV, CFG, sd, AHORA);
    expect(r.items).toHaveLength(3);
    expect(r.items.filter((i: J) => i.esPlantilla)).toHaveLength(2);
    expect(r.errores).toContain('tope_avisos_dia');
    // Negativo: con cupo de sobra salen los 4 y sin error.
    const ok = L.avPlan('pedido', pedido(), CSV, CFG, abierta(), AHORA);
    expect(ok.items).toHaveLength(4);
    expect(ok.errores).toEqual([]);
  });
});

describe('pedido: plantilla `pedido_registrado` y su orden', () => {
  it('orden por defecto: items, total, modalidad, cotejo', () => {
    const items = L.avArmar('comprobante', pedido(), CSV, CFG, sdCon(), AHORA);
    const it = plantillaDe(items, ANDRES);
    expect(it.payload.template.name).toBe('pedido_registrado');
    expect(it.payload.template.language.code).toBe('es');
    expect(params(it)).toEqual(['N.º K7P2 de 3 ítems', 'Bs 110', 'Delivery', 'comprobante: datos coinciden']);
    expect(it.esPlantilla).toBe(true);
    expect(it.respaldo).toBeNull();
  });
  it('el orden y el nombre son configuración (ordenPedido, plantillaPedido, idioma)', () => {
    const cfg = { ...CFG, plantillaPedido: 'pedido_nuevo', idiomaPlantillaPedido: 'es_MX', ordenPedido: 'cotejo,modalidad,total,items' };
    const it = plantillaDe(L.avArmar('comprobante', pedido(), CSV, cfg, sdCon(), AHORA), ANDRES);
    expect(it.payload.template.name).toBe('pedido_nuevo');
    expect(it.payload.template.language.code).toBe('es_MX');
    expect(params(it)).toEqual(['comprobante: datos coinciden', 'Delivery', 'Bs 110', 'N.º K7P2 de 3 ítems']);
  });
  it('un orden inválido cae al de por defecto y se anota', () => {
    for (const orden of ['items,total', 'items,total,modalidad,modalidad', 'a,b,c,d']) {
      const r = L.avPlan('comprobante', pedido(), CSV, { ...CFG, ordenPedido: orden }, sdCon(), AHORA);
      expect(r.errores).toContain('orden_invalido_pedido');
      expect(params(plantillaDe(r.items, ANDRES))[0]).toBe('N.º K7P2 de 3 ítems');
    }
  });
  it('la variable del cotejo dice cada resultado; ninguna usa «verificado» ni «pagado»', () => {
    const dicen: Record<string, RegExp> = {
      cuadra: /datos coinciden/, no_cuadra: /NO coinciden/, ilegible: /ilegible/, sin_cotejo: /sin cotejar/, sin_qr: /sin QR/,
    };
    for (const [resultado, re] of Object.entries(dicen)) {
      const items = L.avArmar(resultado === 'sin_qr' ? 'pedido' : 'comprobante', pedido({ resultado }), CSV, CFG, sdCon(), AHORA);
      const cotejo = params(plantillaDe(items, ANDRES))[3];
      expect(cotejo).toMatch(re);
      expect(cotejo).not.toMatch(VM_PROHIBIDAS);
    }
  });
  it('un ítem y los datos faltantes: singular y «—», sin variables vacías', () => {
    const it = plantillaDe(L.avArmar('pedido', { lineas: [{ cantidad: 1, nombre: 'Café' }] }, CSV, CFG, sdCon(), AHORA), ANDRES);
    expect(params(it)).toEqual(['N.º — de 1 ítem', 'Bs —', '—', 'sin QR: se cobra al entregar o al recoger']);
    for (const p of params(it)) expect(p.trim()).not.toBe('');
  });
  it('las variables no llevan saltos de línea aunque el contenido los traiga', () => {
    const r = L.avArmar('comprobante', pedido({ codigo: 'A\nB', nombre: 'Ana\nPérez', modalidad: 'delivery' }), CSV, CFG, sdCon(), AHORA);
    for (const it of r) for (const t of textosDe(it)) { expect(t).not.toMatch(/[\r\n\t]/); expect(t).not.toMatch(/\s{2,}/); }
  });
  it('sin QR no se mezcla con QR: `tipo` y `resultado` deciden el cotejo por defecto', () => {
    expect(params(plantillaDe(L.avArmar('pedido', pedido({ resultado: undefined }), CSV, CFG, sdCon(), AHORA), ANDRES))[3]).toMatch(/sin QR/);
    expect(params(plantillaDe(L.avArmar('comprobante', pedido({ resultado: undefined }), CSV, CFG, sdCon(), AHORA), ANDRES))[3]).toMatch(/sin cotejar/);
  });
  it('un total con centavos usa coma; sin errores de redondeo', () => {
    expect(params(plantillaDe(L.avArmar('pedido', pedido({ total: 0.1 + 0.2 }), CSV, CFG, sdCon(), AHORA), ANDRES))[1]).toBe('Bs 0,30');
    expect(params(plantillaDe(L.avArmar('pedido', pedido({ total: 55.5 }), CSV, CFG, sdCon(), AHORA), ANDRES))[1]).toBe('Bs 55,50');
    expect(params(plantillaDe(L.avArmar('pedido', pedido({ total: 'mucho' }), CSV, CFG, sdCon(), AHORA), ANDRES))[1]).toBe('Bs —');
  });
});

describe('reserva: plantilla `appointment_confirmed` y su orden', () => {
  it('orden por defecto: destinatario, cuando, detalle, codigo', () => {
    const items = L.avArmar('reserva', reserva(), CSV, CFG, sdCon(), AHORA);
    const a = plantillaDe(items, ANDRES);
    const s = plantillaDe(items, SILVANA);
    expect(a.payload.template.name).toBe('appointment_confirmed');
    expect(params(a)).toEqual(['Andres', 'viernes 9 de octubre a las 20:00', 'Reserva 4 personas · Ana Pérez · terraza', 'R4T9']);
    // Silvana (cocina) ve solo el primer nombre del cliente.
    expect(params(s)).toEqual(['Silvana', 'viernes 9 de octubre a las 20:00', 'Reserva 4 personas · Ana · terraza', 'R4T9']);
  });
  it('sin nombre de destinatario, la variable 1 dice «equipo»', () => {
    const it = plantillaDe(L.avArmar('reserva', reserva(), `completo:${ANDRES}`, CFG, sdCon(), AHORA), ANDRES);
    expect(params(it)[0]).toBe('equipo');
  });
  it('nombre y orden son configuración (ordenReserva, plantillaReserva)', () => {
    const cfg = { ...CFG, plantillaReserva: 'reserva_solicitud', idiomaPlantillaReserva: 'es_ES', ordenReserva: 'codigo,detalle,cuando,destinatario' };
    const it = plantillaDe(L.avArmar('reserva', reserva(), CSV, cfg, sdCon(), AHORA), ANDRES);
    expect(it.payload.template.name).toBe('reserva_solicitud');
    expect(it.payload.template.language.code).toBe('es_ES');
    expect(params(it)).toEqual(['R4T9', 'Reserva 4 personas · Ana Pérez · terraza', 'viernes 9 de octubre a las 20:00', 'Andres']);
    const malo = L.avPlan('reserva', reserva(), CSV, { ...CFG, ordenReserva: 'codigo,detalle' }, sdCon(), AHORA);
    expect(malo.errores).toContain('orden_invalido_reserva');
    expect(params(plantillaDe(malo.items, ANDRES))[0]).toBe('Andres');
  });
  it('el día de la semana lo calcula el código; una fecha imposible o ausente queda en «—»', () => {
    expect(L.avFechaLegible('2026-10-09', '20:00')).toBe('viernes 9 de octubre a las 20:00');
    expect(L.avFechaLegible('2026-10-05', '9:30')).toBe('lunes 5 de octubre a las 09:30');
    expect(L.avFechaLegible('2026-02-30', '20:00')).toBe('');
    const r = reserva(); r.reserva.fecha = '';
    expect(params(plantillaDe(L.avArmar('reserva', r, CSV, CFG, sdCon(), AHORA), ANDRES))[1]).toBe('—');
  });
  it('un persona, zona vacía y sin objeto de reserva', () => {
    const r = reserva(); r.reserva.personas = 1; r.reserva.zona = '';
    expect(params(plantillaDe(L.avArmar('reserva', r, CSV, CFG, sdCon(), AHORA), ANDRES))[2]).toBe('Reserva 1 persona · Ana Pérez');
    const sin = L.avPlan('reserva', {}, CSV, CFG, sdCon(), AHORA);
    expect(sin.items).toEqual([]);
    expect(sin.errores).toEqual(['sin_datos_reserva']);
  });
  it('con ventana abierta, el detalle de la reserva va como texto y no usa «confirmad»', () => {
    const c = cuerpo(L.avArmar('reserva', reserva(), CSV, CFG, abierta(), AHORA), ANDRES);
    expect(c).toContain('Solicitud de reserva N.º R4T9');
    expect(c).toContain('• viernes 9 de octubre a las 20:00');
    expect(c).toContain('• 4 personas, terraza');
    expect(c).toContain('• Celebración: cumpleaños');
    expect(c).toContain('• Pedido especial: una silla alta');
    expect(c).not.toMatch(/confirmad/i);
    expect(c.endsWith('Es una solicitud: revísenla según sus mesas y respondan al cliente.')).toBe(true);
    expect(c).not.toContain('banco');
  });
});

describe('derivación: texto libre con ventana, plantilla sin ella', () => {
  const datos = { nombre: 'Ana Pérez', telefono: CLIENTE, motivo: 'quiero hablar de un evento para 40 personas', codigo: 'C1D2' };
  it('ventana abierta → solo texto libre, sin plantilla', () => {
    const items = L.avArmar('transferencia', datos, CSV, CFG, abierta(), AHORA);
    expect(items.map((i: J) => i.clase)).toEqual(['detalle', 'detalle']);
    expect(items.every((i: J) => !i.esPlantilla)).toBe(true);
    const c = cuerpo(items, ANDRES);
    expect(c).toContain('Consulta de un cliente N.º C1D2');
    expect(c).toContain('Escribió: «quiero hablar de un evento para 40 personas»');
    expect(c.endsWith('El cliente también puede escribirles directo con el botón.')).toBe(true);
    expect(c).not.toContain('banco');
  });
  it('ventana cerrada → la plantilla de reserva por defecto, con el momento de la consulta', () => {
    const items = L.avArmar('transferencia', datos, CSV, CFG, sdCon(), AHORA);
    expect(items.map((i: J) => i.clase)).toEqual(['plantilla', 'plantilla']);
    const it = plantillaDe(items, ANDRES);
    expect(it.payload.template.name).toBe('appointment_confirmed');
    expect(params(it)).toEqual(['Andres', 'lunes 5 de octubre a las 10:00', 'Consulta de cliente · Ana Pérez · quiero hablar de un evento para 40 personas', 'C1D2']);
  });
  it('la derivación hereda el idioma de la reserva; una propia usa el suyo', () => {
    const heredada = L.avArmar('transferencia', datos, CSV, { ...CFG, idiomaPlantillaReserva: 'es_ES' }, sdCon(), AHORA);
    expect(plantillaDe(heredada, ANDRES).payload.template.language.code).toBe('es_ES');
    const propia = L.avArmar('transferencia', datos, CSV, { ...CFG, plantillaDerivacion: 'derivacion_cliente', idiomaPlantillaDerivacion: 'es_MX', ordenDerivacion: 'codigo,detalle,cuando,destinatario' }, sdCon(), AHORA);
    const it = plantillaDe(propia, ANDRES);
    expect(it.payload.template.name).toBe('derivacion_cliente');
    expect(it.payload.template.language.code).toBe('es_MX');
    expect(params(it)[0]).toBe('C1D2');
    expect(params(it)[3]).toBe('Andres');
  });
  it('plantillaDerivacion vacía = sin plantilla: con ventana cerrada no hay aviso y se anota', () => {
    const r = L.avPlan('transferencia', datos, CSV, { ...CFG, plantillaDerivacion: '' }, sdCon(), AHORA);
    expect(r.items).toEqual([]);
    expect(r.errores).toEqual(['sin_plantilla_derivacion']);
    // Con ventana abierta el texto libre sale igual.
    expect(L.avPlan('transferencia', datos, CSV, { ...CFG, plantillaDerivacion: '' }, abierta(), AHORA).items).toHaveLength(2);
  });
  it('sin código, se genera uno corto y estable a partir del reloj', () => {
    const a = L.avArmar('transferencia', { ...datos, codigo: undefined }, CSV, CFG, sdCon(), AHORA);
    const b = L.avArmar('transferencia', { ...datos, codigo: undefined }, CSV, CFG, sdCon(), AHORA);
    expect(params(plantillaDe(a, ANDRES))[3]).toMatch(/^[0-9A-Z]{4}$/);
    expect(params(plantillaDe(a, ANDRES))[3]).toBe(params(plantillaDe(b, ANDRES))[3]);
  });
});

describe('el rol cocina no ve teléfono ni dirección', () => {
  const hostil = pedido({
    nombre: `Ana Pérez ${CUENTA}`,
    lineas: [{ cantidad: 1, nombre: 'Queso fundido', detalle: `sin cebolla, llámame al 71234567` }],
    diferencias: [`la cuenta ${CUENTA} no es la del negocio`, 'monto: 100 en vez de 110'],
    resultado: 'no_cuadra',
  });
  const items = L.avArmar('comprobante', hostil, CSV, CFG, abierta(), AHORA);
  const todoCocina = items.filter((i: J) => i.para === SILVANA).flatMap(textosDe).join('\n');
  const todoCompleto = items.filter((i: J) => i.para === ANDRES).flatMap(textosDe).join('\n');

  it('ni el teléfono del cliente, ni la dirección, ni la referencia, ni números largos', () => {
    expect(todoCocina).not.toContain(CLIENTE);
    expect(todoCocina).not.toContain(CLIENTE.slice(-8));
    expect(todoCocina).not.toContain(DIRECCION);
    expect(todoCocina).not.toContain(REFERENCIA);
    expect(todoCocina).not.toContain('Banzer');
    expect(todoCocina).not.toContain(CUENTA);
    expect(todoCocina).not.toMatch(/\d{7,}/);
    expect(todoCocina).not.toMatch(/\btel\b/i);
    expect(todoCocina).not.toContain('Diferencias');
  });
  it('sí ve ítems, notas, modalidad y el primer nombre', () => {
    const c = cuerpo(items, SILVANA);
    expect(c).toContain('• 1 × Queso fundido (sin cebolla, llámame al …)');
    expect(c).toContain('Entrega: delivery');
    expect(c).toContain('Cliente: Ana');
    expect(c).not.toContain('Cliente: Ana Pérez');
  });
  it('el rol completo ve teléfono, dirección y referencia en delivery, y las diferencias', () => {
    expect(todoCompleto).toContain(`tel ${CLIENTE}`);
    expect(todoCompleto).toContain(`Entrega: delivery a ${DIRECCION} (${REFERENCIA})`);
    expect(todoCompleto).toContain('Diferencias: ');
    expect(todoCompleto).toContain('monto: 100 en vez de 110');
    // Negativo: las variables de plantilla no llevan teléfono ni dirección ni para completo.
    const vars = items.filter((i: J) => i.esPlantilla).flatMap(textosDe).join('\n');
    expect(vars).not.toContain(CLIENTE);
    expect(vars).not.toContain(DIRECCION);
  });
  it('en recojo, ni siquiera el rol completo ve dirección', () => {
    const r = L.avArmar('pedido', pedido({ modalidad: 'recojo' }), CSV, CFG, abierta(), AHORA);
    expect(cuerpo(r, ANDRES)).toContain('Entrega: recojo en el local');
    expect(cuerpo(r, ANDRES)).not.toContain(DIRECCION);
    expect(cuerpo(r, ANDRES)).not.toContain(REFERENCIA);
    expect(cuerpo(r, ANDRES)).toContain(`tel ${CLIENTE}`);
  });
  it('la reserva y la derivación tampoco muestran el teléfono a cocina', () => {
    const r1 = L.avArmar('reserva', reserva({ nombre: `Ana ${CUENTA}` }), CSV, CFG, abierta(), AHORA);
    const r2 = L.avArmar('transferencia', { nombre: 'Ana', telefono: CLIENTE, motivo: `mi número es ${CLIENTE}` }, CSV, CFG, abierta(), AHORA);
    for (const r of [r1, r2]) {
      const k = r.filter((i: J) => i.para === SILVANA).flatMap(textosDe).join('\n');
      expect(k).not.toContain(CLIENTE);
      expect(k).not.toMatch(/\d{7,}/);
      expect(r.filter((i: J) => i.para === ANDRES).flatMap(textosDe).join('\n')).toContain(CLIENTE);
    }
  });
});

describe('el cierre del detalle', () => {
  const BANCO = 'Revisen el pago en su banco antes de despachar.';
  const SIN_QR = 'El pago se coordina con el cliente al entregar o al recoger.';
  it('pedido y comprobante con QR terminan en «Revisen el pago en su banco antes de despachar.»', () => {
    for (const resultado of ['cuadra', 'no_cuadra', 'ilegible', 'sin_cotejo']) {
      for (const rol of [ANDRES, SILVANA]) {
        const c = cuerpo(L.avArmar('comprobante', pedido({ resultado }), CSV, CFG, abierta(), AHORA), rol);
        expect(c.endsWith(BANCO)).toBe(true);
        expect(c).not.toContain(SIN_QR);
      }
    }
  });
  it('sin QR cambia el cierre y no menciona el banco', () => {
    for (const tipo of ['pedido', 'comprobante']) {
      const c = cuerpo(L.avArmar(tipo, pedido({ resultado: 'sin_qr' }), CSV, CFG, abierta(), AHORA), ANDRES);
      expect(c.endsWith(SIN_QR)).toBe(true);
      expect(c).not.toContain('banco');
    }
  });
  it('reserva y derivación no llevan la frase del banco', () => {
    expect(cuerpo(L.avArmar('reserva', reserva(), CSV, CFG, abierta(), AHORA), ANDRES)).not.toContain(BANCO);
    expect(cuerpo(L.avArmar('transferencia', { nombre: 'Ana' }, CSV, CFG, abierta(), AHORA), ANDRES)).not.toContain(BANCO);
  });
  it('el cierre sobrevive a un pedido larguísimo (las líneas se acortan, el cierre no)', () => {
    const lineas = Array.from({ length: 40 }, (_, i) => ({ cantidad: 1, nombre: `Plato número ${i} con un nombre bastante largo para llenar espacio`, detalle: 'x'.repeat(120) }));
    const c = cuerpo(L.avArmar('comprobante', pedido({ lineas }), CSV, CFG, abierta(), AHORA), ANDRES);
    expect(c.endsWith(BANCO)).toBe(true);
    expect(c.length).toBeLessThan(4000);
  });
  it('el texto de un pedido completo, tal cual sale', () => {
    const c = cuerpo(L.avArmar('comprobante', pedido(), CSV, CFG, abierta(), AHORA), ANDRES);
    expect(c).toBe([
      'Pedido N.º K7P2 (comprobante: datos coinciden)',
      `Cliente: Ana Pérez · tel ${CLIENTE}`,
      `Entrega: delivery a ${DIRECCION} (${REFERENCIA})`,
      'Ítems:',
      '• 2 × Orden de 3 tacos de birria (sin cebolla)',
      '• 1 × Queso fundido con chorizo',
      'Total de la comida: Bs 110',
      'Revisen el pago en su banco antes de despachar.',
    ].join('\n'));
  });
});

describe('ya cotejado, tipos raros y destinatarios', () => {
  it('con `ya_cotejado` no hay aviso (el 409 después de `cuadra`)', () => {
    const r = L.avPlan('comprobante', pedido({ resultado: 'ya_cotejado' }), CSV, CFG, abierta(), AHORA);
    expect(r.items).toEqual([]);
    expect(r.errores).toEqual(['sin_aviso_ya_cotejado']);
    expect(L.avArmar('comprobante', pedido({ resultado: 'ya_cotejado' }), CSV, CFG, abierta(), AHORA)).toEqual([]);
    // Negativo: otro resultado, sí.
    expect(L.avPlan('comprobante', pedido({ resultado: 'cuadra' }), CSV, CFG, abierta(), AHORA).items.length).toBeGreaterThan(0);
  });
  it('sin destinatarios o con un tipo desconocido no hay aviso y se anota', () => {
    expect(L.avPlan('pedido', pedido(), '', CFG, abierta(), AHORA).errores).toEqual(['sin_destinatarios']);
    expect(L.avPlan('pedido', pedido(), [], CFG, abierta(), AHORA).errores).toEqual(['sin_destinatarios']);
    expect(L.avPlan('pedido', pedido(), `completo:${CLIENTE}`, CFG, abierta(), AHORA).errores).toEqual(['sin_destinatarios']);
    expect(L.avPlan('regalo', pedido(), CSV, CFG, abierta(), AHORA)).toEqual({ items: [], errores: ['tipo_desconocido'] });
  });
  it('acepta la lista ya armada por avDestinatarios y nunca avisa a quien escribe', () => {
    const dest = L.avDestinatarios(CSV, '', '591');
    const items = L.avArmar('pedido', pedido({ telefono: ANDRES }), dest, CFG, sdCon(), AHORA);
    expect(items.map((i: J) => i.para)).toEqual([SILVANA]);
    expect(L.avArmar('pedido', pedido(), dest, CFG, sdCon(), AHORA).map((i: J) => i.para)).toEqual([ANDRES, SILVANA]);
  });
  it('una plantilla inválida o vacía de pedido no envía plantilla; con ventana abierta sale el texto', () => {
    const r1 = L.avPlan('pedido', pedido(), CSV, { ...CFG, plantillaPedido: 'Nombre Raro!' }, sdCon(), AHORA);
    expect(r1.items).toEqual([]);
    expect(r1.errores).toContain('plantilla_invalida');
    const r2 = L.avPlan('pedido', pedido(), CSV, { ...CFG, plantillaPedido: '' }, abierta(), AHORA);
    expect(r2.items.map((i: J) => i.clase)).toEqual(['detalle', 'detalle']);
  });
  it('`respaldo` es siempre null y `esPlantilla` distingue plantilla de texto', () => {
    const items = L.avArmar('comprobante', pedido(), CSV, CFG, abierta(), AHORA);
    expect(items.every((i: J) => i.respaldo === null)).toBe(true);
    expect(items.map((i: J) => [i.clase, i.esPlantilla])).toEqual([
      ['plantilla', true], ['detalle', false], ['plantilla', true], ['detalle', false],
    ]);
  });
});

describe('la imagen del comprobante', () => {
  it('solo con ventana abierta, solo para el rol completo y con un id de medio válido', () => {
    const items = L.avArmar('comprobante', pedido({ mediaId: '99887766' }), CSV, CFG, abierta(), AHORA);
    const img = items.filter((i: J) => i.clase === 'imagen');
    expect(img).toHaveLength(1);
    expect(img[0].para).toBe(ANDRES);
    expect(img[0].esPlantilla).toBe(false);
    expect(img[0].payload.type).toBe('image');
    expect(img[0].payload.image.id).toBe('99887766');
    expect(img[0].payload.image.caption).toBe('Comprobante del pedido N.º K7P2');
  });
  it('negativos: ventana cerrada, sin id, id raro, y un pedido sin QR', () => {
    expect(L.avArmar('comprobante', pedido({ mediaId: '123' }), CSV, CFG, sdCon(), AHORA).some((i: J) => i.clase === 'imagen')).toBe(false);
    expect(L.avArmar('comprobante', pedido(), CSV, CFG, abierta(), AHORA).some((i: J) => i.clase === 'imagen')).toBe(false);
    expect(L.avArmar('comprobante', pedido({ mediaId: 'https://x.com/a b' }), CSV, CFG, abierta(), AHORA).some((i: J) => i.clase === 'imagen')).toBe(false);
    expect(L.avArmar('pedido', pedido({ mediaId: '123' }), CSV, CFG, abierta(), AHORA).some((i: J) => i.clase === 'imagen')).toBe(false);
    expect(L.avArmar('comprobante', pedido({ mediaId: '123' }), `cocina:${SILVANA}`, CFG, abierta(), AHORA).some((i: J) => i.clase === 'imagen')).toBe(false);
  });
});

describe('el detalle nunca usa palabras de VM_PROHIBIDAS (25 escenarios hostiles)', () => {
  const HOSTILES = [
    'Pago confirmado y verificado', 'ya lo preparan, te llamamos', 'pagado', 'acreditado, en camino', 'recibimos tu pago',
    'te avisamos', 'te escribirán', 'lo consulto', 'validado', 'ya lo están preparando', 'lo preparamos', 'confirmada',
  ];
  const RESULTADOS = ['cuadra', 'no_cuadra', 'ilegible', 'sin_cotejo', 'sin_qr'];
  const escenarios: { tipo: string; datos: J }[] = [];
  for (let i = 0; i < 25; i++) {
    const h = (k: number): string => HOSTILES[(i + k) % HOSTILES.length]!;
    if (i < 15) {
      escenarios.push({
        tipo: i % 3 === 0 ? 'pedido' : 'comprobante',
        datos: pedido({
          resultado: RESULTADOS[i % RESULTADOS.length], modalidad: i % 2 ? 'delivery' : 'recojo', total: i * 7.5 + 20,
          nombre: `Ana ${h(0)}`, direccion: `Calle ${h(1)} 12`, referencia: h(2), diferencias: [h(3)],
          lineas: [{ cantidad: (i % 4) + 1, nombre: `Taco ${h(4)}`, detalle: h(5) }, { cantidad: 2, nombre: 'Birria', detalle: `${h(6)}\n${h(7)}` }],
        }),
      });
    } else if (i < 20) {
      escenarios.push({ tipo: 'reserva', datos: reserva({
        nombre: h(0),
        reserva: { personas: (i % 6) + 1, fecha: '2026-10-09', hora: '20:00', zona: h(1), nombre: `Luis ${h(2)}`, celebracion: h(3), requerimiento: h(4) },
      }) });
    } else {
      escenarios.push({ tipo: 'transferencia', datos: { nombre: `Eva ${h(0)}`, telefono: CLIENTE, motivo: `${h(1)}. ${h(2)}\n${h(3)}`, codigo: h(4) } });
    }
  }
  it('hay 25 escenarios y el contenido hostil SÍ coincide con la lista (la prueba no es trivial)', () => {
    expect(escenarios).toHaveLength(25);
    for (const h of HOSTILES) expect(h).toMatch(VM_PROHIBIDAS);
  });
  it('ningún texto armado (detalles, variables, pies de foto) coincide con VM_PROHIBIDAS', () => {
    let revisados = 0;
    for (const [n, e] of escenarios.entries()) {
      const items = L.avArmar(e.tipo, { ...e.datos, mediaId: n % 2 ? '99887766' : undefined }, CSV, CFG, abierta(), AHORA);
      expect(items.length, `escenario ${n}`).toBeGreaterThan(0);
      for (const it of items) for (const t of textosDe(it)) { expect(t, `escenario ${n}`).not.toMatch(VM_PROHIBIDAS); revisados++; }
      // Con la ventana cerrada, las variables de plantilla tampoco.
      for (const it of L.avArmar(e.tipo, e.datos, CSV, CFG, sdCon(), AHORA)) for (const t of textosDe(it)) expect(t, `escenario ${n} cerrada`).not.toMatch(VM_PROHIBIDAS);
    }
    expect(revisados).toBeGreaterThan(100);
  });
  it('el regex SÍ atrapa las 12 frases prohibidas (el negativo de la red)', () => {
    const frases = ['validado', 'confirmada', 'pagado', 'pagada', 'acreditado', 'verificado', 'recibimos tu pago',
      'ya lo preparan', 'lo preparamos', 'te avisamos', 'en camino', 'te llamaremos'];
    for (const f of frases) expect(f).toMatch(VM_PROHIBIDAS);
  });
  it('si existe VM_PROHIBIDAS (la de comun.js), manda esa; si no, la copia local', () => {
    const estricta = cargar('const VM_PROHIBIDAS = /empanada/i;');
    const base = pedido({ nombre: 'Ana', lineas: [{ cantidad: 1, nombre: 'Empanada', detalle: 'pago confirmado' }] });
    const conVm = cuerpo(estricta.avArmar('pedido', base, CSV, CFG, abierta(), AHORA), ANDRES);
    expect(conVm).not.toMatch(/empanada/i);
    expect(conVm).toContain('pago confirmado'); // la lista de comun.js es la que manda: esta frase no está en ella
    const sinVm = cuerpo(L.avArmar('pedido', base, CSV, CFG, abierta(), AHORA), ANDRES);
    expect(sinVm).toMatch(/Empanada/);
    expect(sinVm).not.toMatch(/confirmad/);
  });
});

describe('el estado: solo escriben avAnotarEntrante y avContar', () => {
  it('avArmar y avPlan dejan `sd` idéntico, con ventana abierta o cerrada y al llegar al tope', () => {
    for (const sd of [abierta(), sdCon(), {} as J, { av: { ventana: {}, dia: { fecha: '2026-10-05', n: 150 } } } as J]) {
      const antes = JSON.stringify(sd);
      L.avArmar('comprobante', pedido(), CSV, CFG, sd, AHORA);
      L.avPlan('comprobante', pedido(), CSV, CFG, sd, AHORA);
      L.avVentanaAbierta(sd, ANDRES, AHORA);
      L.avDentroDelTopeDiario(sd, AHORA, 150);
      expect(JSON.stringify(sd)).toBe(antes);
    }
  });
  it('los datos de entrada tampoco se modifican', () => {
    const datos = pedido({ mediaId: '123' });
    const copia = JSON.stringify(datos);
    L.avArmar('comprobante', datos, CSV, CFG, abierta(), AHORA);
    expect(JSON.stringify(datos)).toBe(copia);
  });
  it('funciona sin `sd` (todas las ventanas cerradas) y sin `cfg`', () => {
    const r = L.avPlan('pedido', pedido(), CSV, undefined, undefined, AHORA);
    expect(r.items.map((i: J) => i.clase)).toEqual(['plantilla', 'plantilla']);
    expect(r.errores).toEqual([]);
  });
});

describe('la librería es JavaScript plano para el Code de n8n', () => {
  it('no usa globales de Node ni el reloj de la máquina (sin contar los comentarios)', () => {
    const codigo = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/^\s*\/\/.*$|\s\/\/\s.*$/, '')).join('\n');
    for (const prohibido of [/\brequire\s*\(/, /\bURL\b/, /\bBuffer\b/, /\bcrypto\b/, /\bprocess\b/, /Date\.now\s*\(/, /new Date\(\s*\)/, /\bnew Function\b/, /\beval\s*\(/]) {
      expect(codigo).not.toMatch(prohibido);
    }
  });
  it('todas sus funciones y constantes llevan el prefijo av / AV_', () => {
    const decl = [...FUENTE.matchAll(/^(?:function|const) ([A-Za-z_]\w*)/gm)].map((m) => m[1]!);
    expect(decl.length).toBeGreaterThan(30);
    for (const d of decl) expect(d, d).toMatch(/^(av[A-Z]\w*|AV_\w+)$/);
  });
  it('sin secretos, UUID ni números de teléfono reales (solo los sintéticos de seis ceros)', () => {
    expect(FUENTE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(FUENTE).not.toMatch(/\d{10,}/);
    expect(FUENTE).not.toMatch(/\/home\/|Bearer |EAA[A-Za-z0-9]{10}/);
  });
});
