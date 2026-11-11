/**
 * AVISOS AL LOCAL EN VIÑETAS (Q'Taco 3727, 07/11/2026; decisión de Andres «plantillas nuevas por tipo»). Ejecuta el `avisos.js` versionado.
 * Plantillas aprobadas por Meta: `pedido_lista_mapa` (6 variables de cuerpo + 1 de botón URL), `pedido_lista` (6, sin botón), `reserva_lista` (5);
 * `consulta_atencion` (3) queda PREPARADA y apagada (PENDING). Fuente de los textos: el borrador del 06/11 (QTACO_plantillas-avisos-vinetas-borrador).
 * Lo que se niega: un número de parámetros distinto del de la plantilla; el botón sin ubicación válida; un producto partido por el tope de 500;
 * el teléfono o la ubicación al rol `cocina`; palabras de la red de prohibidas; una plantilla que no está APPROVED; un cliente sin las claves con
 * otro comportamiento que el de hoy; un mensaje de más (el respaldo es la plantilla de hoy y solo sale si la nueva no salió).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configBase, ejecutar, type Flujo } from './lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const VM = join(AQUI, '../../Flujos/experimental/venta-minima');
const FUENTE = readFileSync(join(VM, 'src/lib/avisos.js'), 'utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const L = ejecutar(`${FUENTE}\nreturn [{ json: { avArmar, avPlan, avCoincide } }];`, [{}])[0] as unknown as { avArmar: Fn; avPlan: Fn; avCoincide: Fn };

const AHORA = Date.UTC(2026, 10, 7, 15);
const HORA = 3600 * 1000;
const COMPLETO = '59100000011';
const COCINA = '59100000022';
const CLIENTE = '59170000001';
const CSV = `completo:${COMPLETO}:Andres,cocina:${COCINA}:Silvana`;
// La configuración de HOY del 3727 (sin las claves nuevas): la de siempre, por líneas, y las formas de reserva y derivación.
const HOY: J = {
  prefijosPermitidos: '591', plantillaPedido: 'pedido_registrado', idiomaPlantillaPedido: 'es',
  plantillasPedidoLineas: '2:pedido_registrado_l2,4:pedido_registrado_l4,6:pedido_registrado_l6', idiomaPlantillaPedidoLineas: 'es',
  plantillaReserva: 'pedido_registrado', formaPlantillaReserva: 'pedido', plantillaReservaCompleto: 'solicitud_reserva', formaPlantillaReservaCompleto: 'solicitud',
  plantillaDerivacion: 'pedido_registrado', formaPlantillaDerivacion: 'pedido',
};
const VINETAS: J = {
  plantillaPedidoMapa: 'pedido_lista_mapa', plantillaPedidoMapaEstado: 'APPROVED',
  plantillaPedidoLista: 'pedido_lista', plantillaPedidoListaEstado: 'APPROVED',
  plantillaReservaLista: 'reserva_lista', plantillaReservaListaEstado: 'APPROVED',
  plantillaConsultaAtencion: 'consulta_atencion', plantillaConsultaAtencionEstado: 'PENDING',
  idiomaPlantillasVinetas: 'es',
};
const CON = { ...HOY, ...VINETAS };
const sd = (abierta = false): J => ({ av: { ventana: abierta ? { [COMPLETO]: AHORA - 2 * HORA, [COCINA]: AHORA - 2 * HORA } : {}, dia: { fecha: '', n: 0 } } });

const UBICACION = { lat: -16.5, lng: -68.15 };
const pedido = (extra: J = {}): J => ({
  codigo: 'OR0V', nombre: 'Ana Pérez', telefono: CLIENTE, modalidad: 'delivery', total: 80, direccion: 'Calle Ejemplo 123',
  referencia: 'frente a la farmacia', ubicacion: UBICACION, resultado: 'cuadra',
  lineas: [{ cantidad: 1, nombre: 'Quesabirria' }, { cantidad: 1, nombre: 'Tacos de Birria (orden de 3)' }], ...extra,
});
const reserva = (extra: J = {}): J => ({
  codigo: 'WZ0M', nombre: 'Ana Pérez', telefono: CLIENTE,
  reserva: { personas: 4, fecha: '2026-11-06', hora: '19:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' }, ...extra,
});
const consulta = (extra: J = {}): J => ({ codigo: 'KD7L', nombre: 'Ana Pérez', telefono: CLIENTE, motivo: 'quiero hablar con alguien', ...extra });

const plan = (tipo: string, d: J, cfg: J = CON, s: J = sd()): J => L.avPlan(tipo, d, CSV, cfg, s, AHORA);
const plantillaDe = (r: J, tel: string): J => r.items.find((i: J) => i.para === tel && i.clase === 'plantilla');
const cuerpo = (it: J): string[] => it.payload.template.components.find((c: J) => c.type === 'body').parameters.map((p: J) => p.text);
const botones = (it: J): J[] => it.payload.template.components.filter((c: J) => c.type === 'button');
const todasLasVariables = (it: J): string[] => it.payload.template.components.flatMap((c: J) => c.parameters.map((p: J) => p.text));

describe('pedido_lista_mapa: 6 variables de cuerpo en el orden del borrador y el botón con la ubicación', () => {
  it('reproduce las muestras aprobadas por Meta (rol completo, delivery con ubicación)', () => {
    const it0 = plantillaDe(plan('pedido', pedido()), COMPLETO);
    expect(it0.payload.template.name).toBe('pedido_lista_mapa');
    expect(it0.payload.template.language.code).toBe('es');
    expect(cuerpo(it0)).toEqual([
      'N.º OR0V de 2 ítems', 'Bs 80', 'Delivery a Calle Ejemplo 123 (frente a la farmacia)', 'Ana Pérez · +591 7000 0001',
      '1 × Quesabirria · 1 × Tacos de Birria (orden de 3)', 'datos coinciden',
    ]);
    // El cuerpo va primero (el prefijo del modo prueba se pone en el primer parámetro del primer componente) y el botón después.
    expect(it0.payload.template.components.map((c: J) => c.type)).toEqual(['body', 'button']);
    expect(botones(it0)).toEqual([{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '-16.500000%2C-68.150000' }] }]);
  });
  it('la ubicación no se repite en el cuerpo: ni el enlace ni las coordenadas (van en el botón)', () => {
    const it0 = plantillaDe(plan('pedido', pedido({ coordenadas: 'ubicación compartida -16.500000, -68.150000' })), COMPLETO);
    expect(cuerpo(it0).join(' ')).not.toMatch(/google|mapa|-16\.5|-68\.15/);
  });
  it('también el comprobante (mismo cuerpo); el cotejo dice solo lo que pasó, sin palabras de acreditación', () => {
    const esperado: Record<string, string> = { cuadra: 'datos coinciden', no_cuadra: 'NO coinciden los datos', ilegible: 'ilegible' };
    for (const [resultado, texto] of Object.entries(esperado)) {
      const it0 = plantillaDe(plan('comprobante', pedido({ resultado })), COMPLETO);
      expect(it0.payload.template.name).toBe('pedido_lista_mapa');
      expect(cuerpo(it0)).toHaveLength(6);
      expect(cuerpo(it0)[5]).toBe(texto);
    }
  });
});

describe('pedido_lista: sin ubicación válida, en recojo o para cocina; nunca un botón', () => {
  it('NEGANDO el botón: recojo, delivery sin ubicación y ubicaciones inválidas (texto, 0,0, fuera de rango, NaN) → pedido_lista con 6 variables', () => {
    const casos: J[] = [
      { modalidad: 'recojo' },
      { ubicacion: undefined },
      { ubicacion: { lat: '-16.5', lng: '-68.15' } },
      { ubicacion: { lat: 0, lng: 0 } },
      { ubicacion: { lat: 95, lng: -68.15 } },
      { ubicacion: { lat: Number.NaN, lng: -68.15 } },
      { ubicacion: 'https://www.google.com/maps/search/?api=1&query=-16.5%2C-68.15' },
    ];
    for (const extra of casos) {
      const it0 = plantillaDe(plan('pedido', pedido(extra)), COMPLETO);
      expect(it0.payload.template.name, JSON.stringify(extra)).toBe('pedido_lista');
      expect(botones(it0), JSON.stringify(extra)).toEqual([]);
      expect(cuerpo(it0)).toHaveLength(6);
    }
    expect(cuerpo(plantillaDe(plan('pedido', pedido({ modalidad: 'recojo' })), COMPLETO))[2]).toBe('Recojo en el local');
  });
  it('con la de mapa sin aprobar, un delivery con ubicación sale por pedido_lista (sin botón), nunca por la de mapa', () => {
    const it0 = plantillaDe(plan('pedido', pedido(), { ...CON, plantillaPedidoMapaEstado: 'PENDING' }), COMPLETO);
    expect(it0.payload.template.name).toBe('pedido_lista');
    expect(botones(it0)).toEqual([]);
    // Sin botón, el rol completo conserva el enlace al mapa en {{3}}, entero, como hoy (revisión del PR #850).
    expect(cuerpo(it0)[2]).toBe('Delivery a Calle Ejemplo 123 (frente a la farmacia) · mapa: https://www.google.com/maps/search/?api=1&query=-16.500000%2C-68.150000');
    // NEGANDO: cocina nunca lo recibe, ni con la de mapa sin aprobar.
    expect(cuerpo(plantillaDe(plan('pedido', pedido(), { ...CON, plantillaPedidoMapaEstado: 'PENDING' }), COCINA)).join(' ')).not.toMatch(/mapa|google/);
    // Con el botón, el enlace no se repite en el cuerpo.
    expect(cuerpo(plantillaDe(plan('pedido', pedido()), COMPLETO)).join(' ')).not.toMatch(/mapa|google/);
  });
  it('rol cocina: pedido_lista, primer nombre, sin teléfono, dirección, referencia ni ubicación', () => {
    const it0 = plantillaDe(plan('pedido', pedido({ notaPedido: 'tocar timbre 77712345' })), COCINA);
    expect(it0.payload.template.name).toBe('pedido_lista');
    expect(botones(it0)).toEqual([]);
    const v = cuerpo(it0);
    expect(v).toHaveLength(6);
    expect(v[2]).toBe('Delivery · nota: tocar timbre …');
    expect(v[3]).toBe('Ana');
    const todo = v.join(' | ');
    for (const malo of ['7000', CLIENTE, 'Ejemplo', 'farmacia', 'Pérez', '-16.5', '77712345']) expect(todo, malo).not.toContain(malo);
  });
});

describe('{{5}}: los ítems en UNA línea, cortados por ítem a 500 caracteres', () => {
  const muchos = (n: number): J[] => Array.from({ length: n }, (_, i) => ({ cantidad: (i % 3) + 1, nombre: `Taco especial de la casa número ${i + 1}`, detalle: i % 2 ? 'sin cebolla y con salsa aparte' : '' }));
  it('si no caben termina en « … y K más», con K = los productos que no entraron, y ningún producto partido', () => {
    for (const n of [12, 25, 30]) {
      const d = pedido({ lineas: muchos(n) });
      for (const tel of [COMPLETO, COCINA]) {
        const v = cuerpo(plantillaDe(plan('pedido', d), tel))[4]!;
        expect(Array.from(v).length, `n=${n}`).toBeLessThanOrEqual(500);
        const m = / … y (\d+) más$/.exec(v);
        expect(m, v).not.toBeNull();
        const mostrados = v.slice(0, m!.index).split(' · ');
        expect(mostrados.length + Number(m![1])).toBe(n);
        mostrados.forEach((p, i) => expect(p).toBe(`${(i % 3) + 1} × Taco especial de la casa número ${i + 1}${i % 2 ? ' (sin cebolla y con salsa aparte)' : ''}`));
      }
    }
  });
  it('NEGANDO el error 132005 de Meta: 30 ítems con dirección, referencia y nota largas ⇒ el CUERPO entero (texto fijo + variables) ≤ 1024 y sigue en viñetas', () => {
    const FIJO = "Se registró un pedido en Q'Taco.\n• Pedido: \n• Total de la comida: \n• Modalidad: \n• Cliente: \n• Detalle: \n• Comprobante: \nRevise el pedido en la consola antes de despachar.";
    const largo = (t: string): number => Array.from(t).length;
    const d = pedido({
      lineas: muchos(30), nombre: 'Ana María de los Ángeles Pérez Mamani Gutiérrez', notaPedido: 'tocar el timbre dos veces y esperar en la puerta '.repeat(4),
      direccion: 'Avenida Arce esquina calle Rosendo Gutiérrez edificio Torres del Poeta bloque B piso 12 departamento 1204 '.repeat(2),
      referencia: 'frente a la plaza grande, al lado de la farmacia con el portón verde '.repeat(2),
    });
    for (const [tel, cfg, nombre] of [[COMPLETO, CON, 'pedido_lista_mapa'], [COMPLETO, { ...CON, plantillaPedidoMapaEstado: 'PENDING' }, 'pedido_lista'], [COCINA, CON, 'pedido_lista']] as [string, J, string][]) {
      const it0 = plantillaDe(plan('pedido', d, cfg), tel);
      expect(it0.payload.template.name).toBe(nombre);
      const v = cuerpo(it0);
      expect(v).toHaveLength(6);
      expect(largo(FIJO) + v.reduce((a, x) => a + largo(x), 0), `${tel} ${nombre}`).toBeLessThanOrEqual(1024);
      // Los ítems y el total nunca se recortan para hacer lugar: el total entero y la lista cortada por ítem.
      expect(v[1]).toBe('Bs 80');
      const m = / … y (\d+) más$/.exec(v[4]!);
      expect(m, v[4]).not.toBeNull();
      const mostrados = v[4]!.slice(0, m!.index).split(' · ');
      expect(mostrados.length).toBeGreaterThan(0);
      expect(mostrados.length + Number(m![1])).toBe(30);
      mostrados.forEach((p, i) => expect(p).toBe(`${(i % 3) + 1} × Taco especial de la casa número ${i + 1}${i % 2 ? ' (sin cebolla y con salsa aparte)' : ''}`));
    }
    // Con los topes por variable de hoy, el presupuesto se cubre recortando la lista de ítems (por ítem); {{3}} conserva la nota y el mapa entero.
    // (El recorte de nota, referencia y dirección de {{3}} es la segunda red: solo corre si a los ítems no les quedaran ni 150 caracteres.)
    const recortado = cuerpo(plantillaDe(plan('pedido', d, { ...CON, plantillaPedidoMapaEstado: 'PENDING' }), COMPLETO))[2]!;
    expect(recortado).toContain('nota: tocar el timbre');
    expect(recortado).toMatch(/ · mapa: https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-16\.500000%2C-68\.150000$/);
  });
  it('si caben van todos, sin marca; sin ítems dice «sin ítems»', () => {
    expect(cuerpo(plantillaDe(plan('pedido', pedido({ lineas: muchos(3) })), COMPLETO))[4]).not.toMatch(/más$/);
    expect(cuerpo(plantillaDe(plan('pedido', pedido({ lineas: [] })), COMPLETO))[4]).toBe('sin ítems');
  });
  it('ninguna variable lleva saltos, tabuladores, 4+ espacios ni queda vacía, ni empieza o termina con espacio (texto del cliente sucio)', () => {
    const sucio = { cantidad: 1, nombre: 'Taco\n\n  grande\t   x', detalle: 'sin\r\ncebolla\u2028   y    ajo' };
    const d = pedido({ lineas: [sucio, sucio, sucio], direccion: 'Calle\n 5\t\t   y\n6', nombre: 'Ana\nPérez', notaPedido: 'a\n\nb       c', referencia: '  \n ' });
    for (const tipo of ['pedido', 'comprobante']) {
      for (const tel of [COMPLETO, COCINA]) {
        for (const v of todasLasVariables(plantillaDe(plan(tipo, d), tel))) {
          expect(v).not.toMatch(/[\n\r\t\u2028\u2029]/);
          expect(v).not.toMatch(/ {4,}/);
          expect(v.trim()).not.toBe('');
          expect(v).toBe(v.trim());
        }
      }
    }
  });
});

describe('reserva_lista: 5 variables (código · cliente, personas, cuándo, teléfono, notas)', () => {
  it('reproduce la muestra aprobada para el rol completo', () => {
    const it0 = plantillaDe(plan('reserva', reserva()), COMPLETO);
    expect(it0.payload.template.name).toBe('reserva_lista');
    expect(cuerpo(it0)).toEqual(['WZ0M · Ana Pérez', '4 personas', 'viernes 6 de noviembre a las 19:00, terraza', '+591 7000 0001', 'sin datos adicionales']);
    expect(botones(it0)).toEqual([]);
  });
  it('rol cocina: primer nombre y SIN teléfono («—»)', () => {
    const v = cuerpo(plantillaDe(plan('reserva', reserva()), COCINA));
    expect(v).toHaveLength(5);
    expect(v[0]).toBe('WZ0M · Ana');
    expect(v[3]).toBe('—');
    expect(v.join(' ')).not.toMatch(/7000|Pérez/);
  });
  it('las marcas de la reserva (grupo grande, origen del anuncio) van en las notas', () => {
    const v = cuerpo(plantillaDe(plan('reserva', reserva({ reserva: { ...reserva().reserva, grupoGrande: true, marcaOrigen: 'vino por el anuncio Jueves de +2' } })), COMPLETO));
    expect(v[4]).toContain('GRUPO GRANDE');
    expect(v[4]).toContain('anuncio Jueves de +2');
  });
});

describe('consulta_atencion: preparada y APAGADA (PENDING en Meta)', () => {
  it('con PENDING la derivación sale EXACTAMENTE como hoy (plantilla de pedido, 4 variables, sin respaldo)', () => {
    expect(JSON.stringify(plan('transferencia', consulta(), CON))).toBe(JSON.stringify(plan('transferencia', consulta(), HOY)));
    const it0 = plantillaDe(plan('transferencia', consulta(), CON), COMPLETO);
    expect(it0.payload.template.name).toBe('pedido_registrado');
    expect(it0.respaldo).toBeNull();
  });
  it('el mapeo listo para cuando Meta la apruebe: 3 variables (cliente, motivo, consulta) y la de hoy de respaldo; cocina sin teléfono', () => {
    const cfg = { ...CON, plantillaConsultaAtencionEstado: 'APPROVED' };
    const c = plantillaDe(plan('transferencia', consulta(), cfg), COMPLETO);
    expect(c.payload.template.name).toBe('consulta_atencion');
    expect(cuerpo(c)).toEqual(['Ana Pérez · +591 7000 0001', 'quiero hablar con alguien', 'KD7L']);
    expect(c.respaldo.template.name).toBe('pedido_registrado');
    expect(cuerpo(plantillaDe(plan('transferencia', consulta({ motivo: '' }), cfg), COCINA))).toEqual(['Ana', 'pide hablar con una persona', 'KD7L']);
  });
});

describe('caída a la plantilla de hoy y cero mensajes agregados', () => {
  const eventos: [string, J][] = [['pedido', pedido()], ['comprobante', pedido({ mediaId: 'media.1' })], ['pedido', pedido({ modalidad: 'recojo' })], ['reserva', reserva()], ['transferencia', consulta()]];
  it('cada plantilla nueva lleva de respaldo el payload EXACTO que hoy sale para ese destinatario (y nada más cambia)', () => {
    for (const [tipo, d] of eventos.slice(0, 4)) {
      for (const abierta of [false, true]) {
        const hoy = plan(tipo, d, HOY, sd(abierta));
        const con = plan(tipo, d, CON, sd(abierta));
        expect(con.items.length, tipo).toBe(hoy.items.length);
        expect(con.errores).toEqual(hoy.errores);
        con.items.forEach((it: J, i: number) => {
          const h = hoy.items[i];
          expect(it.clase).toBe(h.clase);
          expect(it.para).toBe(h.para);
          if (it.clase === 'plantilla') {
            expect(it.payload.template.name).not.toBe(h.payload.template.name);
            expect(it.respaldo).toEqual(h.payload);
          } else {
            expect(it).toEqual(h);
          }
        });
      }
    }
  });
  it('NEGANDO: un estado distinto de APPROVED, un nombre inválido o sin las claves → idéntico a hoy, byte a byte, y sin respaldo', () => {
    const variantes: J[] = [
      {},
      { ...VINETAS, plantillaPedidoMapaEstado: 'PENDING', plantillaPedidoListaEstado: 'REJECTED', plantillaReservaListaEstado: 'PAUSED' },
      { ...VINETAS, plantillaPedidoMapaEstado: '', plantillaPedidoListaEstado: undefined, plantillaReservaListaEstado: 'approved ya' },
      // El estado vale EXACTAMENTE «APPROVED» (revisión de seguridad del PR #850).
      { ...VINETAS, plantillaPedidoMapaEstado: 'approved', plantillaPedidoListaEstado: 'Approved', plantillaReservaListaEstado: ' APPROVED' },
      { ...VINETAS, plantillaPedidoMapa: 'Pedido Lista', plantillaPedidoLista: 'pedido-lista', plantillaReservaLista: '' },
    ];
    for (const extra of variantes) {
      for (const [tipo, d] of eventos) {
        for (const abierta of [false, true]) {
          const hoy = plan(tipo, d, HOY, sd(abierta));
          const con = plan(tipo, d, { ...HOY, ...extra }, sd(abierta));
          expect(JSON.stringify(con), `${tipo} ${JSON.stringify(extra)}`).toBe(JSON.stringify(hoy));
          for (const it of con.items) expect(it.respaldo).toBeNull();
        }
      }
    }
  });
  it('un cliente sin la configuración de Q\'Taco (solo plantillaPedido / forma cita) sigue igual aunque traiga claves a medias', () => {
    const otro = { prefijosPermitidos: '591', plantillaPedido: 'pedido_registrado', plantillaReserva: 'appointment_confirmed', plantillaDerivacion: 'appointment_confirmed' };
    for (const [tipo, d] of eventos) {
      expect(JSON.stringify(plan(tipo, d, { ...otro, plantillaPedidoLista: 'pedido_lista' }))).toBe(JSON.stringify(plan(tipo, d, otro)));
    }
  });
  it('si la plantilla de hoy no está configurada, la nueva sale igual (sin respaldo) y se anota como siempre', () => {
    const r = plan('pedido', pedido(), { prefijosPermitidos: '591', ...VINETAS });
    expect(plantillaDe(r, COMPLETO).payload.template.name).toBe('pedido_lista_mapa');
    expect(plantillaDe(r, COMPLETO).respaldo).toBeNull();
    expect(r.errores).toContain('plantilla_no_configurada_pedido');
  });
});

describe('sin palabras de la red de prohibidas en ninguna variable', () => {
  it('texto del cliente con «pagado», «confirmado», «verificado» o «acreditado» sale omitido; los fijos nunca los dicen', () => {
    const malo = 'pago confirmado y verificado, ya pagado y acreditado';
    const datos: [string, J][] = [
      ['pedido', pedido({ nombre: `Ana ${malo}`, direccion: malo, referencia: malo, notaPedido: malo, lineas: [{ cantidad: 1, nombre: 'Taco', detalle: malo }] })],
      ['comprobante', pedido({ resultado: 'simulado' })],
      ['comprobante', pedido({ resultado: 'sin_qr', modalidad: 'recojo' })],
      ['reserva', reserva({ reserva: { ...reserva().reserva, celebracion: malo, requerimiento: malo } })],
      ['transferencia', consulta({ motivo: malo })],
    ];
    const cfg = { ...CON, plantillaConsultaAtencionEstado: 'APPROVED' };
    for (const [tipo, d] of datos) {
      for (const tel of [COMPLETO, COCINA]) {
        const it0 = plantillaDe(plan(tipo, d, cfg), tel);
        for (const v of todasLasVariables(it0)) {
          expect(L.avCoincide(v), `${tipo}: ${v}`).toBe(false);
          expect(v).not.toMatch(/acreditad|pagad[oa]|verificad|confirmad/i);
        }
      }
    }
  });
});

describe("los datos de Q'Taco: el 3727 las enciende; el vivo y los demás clientes no las traen", () => {
  const cb = (f: string): Record<string, unknown> => configBase(JSON.parse(readFileSync(join(VM, f), 'utf8')) as Flujo);
  it('venta-minima.qtaco-3727.json (07/11 20:47: Q\'Taco volvió al formato por líneas): las tres plantillas en viñetas quedan DESACTIVADAS (nombres intactos) y consulta_atencion en PENDING', () => {
    const c = cb('venta-minima.qtaco-3727.json');
    const apagadas = { ...VINETAS, plantillaPedidoMapaEstado: 'DESACTIVADA', plantillaPedidoListaEstado: 'DESACTIVADA', plantillaReservaListaEstado: 'DESACTIVADA' };
    for (const [k, v] of Object.entries(apagadas)) expect(c[k], k).toBe(v);
    // el código solo las usa con APPROVED exacto: con el dato real del 3727 el aviso es el de siempre (por líneas), y con su propia config de prueba (VINETAS) la viñeta sigue cubierta en el resto de la suite
    for (const k of ['plantillaPedidoMapaEstado', 'plantillaPedidoListaEstado', 'plantillaReservaListaEstado']) expect(c[k], k).not.toBe('APPROVED');
  });
  it('el flujo vivo de Q\'Taco, la prueba, el ensayo y los derivados (Emma, Evy, doctoras) no traen ninguna clave nueva', () => {
    let revisados = 0;
    const otros = ['venta-minima.qtaco.json', 'venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json', '../rroca-emma/rroca-emma.json', '../rroca-evy/rroca-evy.json', '../doctoras/doctoras.rroca-emma.json', '../doctoras/doctoras.rroca-evy.json'];
    for (const f of otros) {
      const f0 = JSON.parse(readFileSync(join(VM, f), 'utf8')) as Flujo;
      const nodo = f0.nodes.find((n) => n.name === 'Config base');
      // Ningún archivo se salta en silencio: todos tienen que traer «Config base».
      expect(nodo, `${f}: sin «Config base»`).toBeDefined();
      revisados++;
      const c = configBase(f0);
      for (const k of Object.keys(VINETAS)) expect(c[k], `${f}: ${k}`).toBeUndefined();
    }
    expect(revisados).toBe(otros.length);
  });
  it('el 3727 sigue con 81 nodos (ninguno agregado)', () => {
    expect((JSON.parse(readFileSync(join(VM, 'venta-minima.qtaco-3727.json'), 'utf8')) as Flujo).nodes).toHaveLength(81);
  });
});
