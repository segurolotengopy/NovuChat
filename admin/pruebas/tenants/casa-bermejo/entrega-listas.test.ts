/**
 * LA ENTREGA POR PASOS, CON LISTAS («Intermedio», decisión de Andres del 26/11/2026). Corre el JSON versionado con el n8n de mentira y la librería pura con `cargarFuente`. Se prueba NEGANDO (adversa + sana).
 *   BOLIVIA, 3 pasos: (1) lista de los 9 departamentos; (2) UN mensaje con la ciudad y, si quiere, una aclaración («oficina Zona Sur»); (3) UN mensaje con el nombre completo y la cédula de quien recoge el envío en la flota.
 *   ARGENTINA, 4 pasos: (1) lista de regiones; (2) lista de provincias de esa región; (3) ciudad y aclaración opcional; (4) nombre completo y DNI.   RECOJO: el nombre → el resumen con la dirección de la tienda y «Ver ubicación».
 * Luego el resumen con todos los datos, «Confirmar pedido» y «Corregir datos», y el QR. NO se pide ni se guarda: dirección exacta, teléfono, ubicación compartida ni empresa de transporte (la flota la define la tienda).
 * La SECUENCIA es un DATO (`BM_PASOS_ENTREGA`): juntar pasos o cambiar su orden es cambiar esa tabla, no la lógica (sección «los pasos como dato»).
 * Los ids de las listas son estables y en minúscula (`dep:lp`, `reg:centro`, `prov:ar-c`): «Normalizar entrada» solo deja pasar `[a-z0-9:_-]`.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cargarFuente } from '../../core/fuente-vm';
import { ANA, ARGENTINO, BILLETERA, CATALOGO, ENVIO_AR, ENVIO_BO, catalogoOk, completarEnvio, crear, hablar, mLista, modelo, modeloAdverso, modeloSano, mTexto, mToque, type Opciones } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(AQUI, '../../../../Flujos/experimental');
const RUTAS = [
  'venta-digital/src/cobro.js', 'venta-digital/src/diferencias.js', '../src/modulos/pedidos/comprobante-diferencias.js', 'venta-digital/src/avisos.js', 'venta-digital/src/conversacion.js', 'venta-digital/src/carrito.js', 'venta-digital/src/catalogo-externo.js',
  '../src/core/sin-agente/mensajes.js', '../src/core/texto/filtro-redaccion.js', '../src/core/texto/identidad.js', '../src/modulos/pedidos/confirmar-pedido.js', '../src/modulos/productos/palabra-tolerante.js', '../clientes/casa-bermejo/src/lib/bm.js', '../clientes/casa-bermejo/src/lib/bm-venta.js', 'venta-digital/src/nodos/_comun.js',
].map((r) => join(FLUJOS, r));
const NOMBRES = ['BM_PASOS_ENTREGA', 'BM_DEPARTAMENTOS', 'BM_REGIONES_AR', 'BM_PROVINCIAS_AR', 'bmPideDeEntrega', 'bmPreguntaDelPaso', 'bmEntregaFalta', 'bmEntregaCompleta', 'bmFilasDeLista', 'bmDatosResumen'];
const B = cargarFuente<Record<string, any>>(RUTAS, NOMBRES); // eslint-disable-line @typescript-eslint/no-explicit-any
type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const b = (n: string): Fn => B[n] as Fn;

const J = (x: unknown): string => JSON.stringify(x);
type Mund = ReturnType<typeof crear>;
type Turno = ReturnType<typeof hablar>;
type FichaT = { carrito: { id: string }[]; entrega: Record<string, string>; pide: string[]; pedidos: number };
const ficha = (m: Mund, tel: string = ANA): FichaT => (m.sd['casabermejo'] as Record<string, FichaT>)[tel]!;
const hayQr = (t: Turno): boolean => t.mensajes.some((x) => x.tipo === 'image' && /qr/i.test(J(x.payload)));
type Interactivo = { type: string; body?: { text: string }; action?: { button?: string; buttons?: { reply: { id: string; title: string } }[]; sections?: { title: string; rows: { id: string; title: string; description: string }[] }[]; name?: string; parameters?: { display_text: string; url: string } } };
const interactivo = (t: Turno, i = 0): Interactivo => (t.mensajes[i]!.payload['interactive'] ?? {}) as Interactivo;
const idsDe = (t: Turno): string[] => t.mensajes.flatMap((x) => ((x.payload['interactive'] as Interactivo | undefined)?.action?.buttons ?? []).map((bt) => bt.reply.id));
const confirmaDe = (t: Turno): string | undefined => idsDe(t).find((i) => i.startsWith('pedido:confirmar:'));
const filasDe = (t: Turno): { id: string; title: string; description: string }[] => (interactivo(t).action?.sections ?? []).flatMap((s) => s.rows);
const cuerpos = (t: Turno): string => t.mensajes.map((x) => x.cuerpo).join(' ');
const llamadas = (m: Mund): { n: number } => {
  const c = { n: 0 };
  const previo = m.dobles['Conversar con el modelo'] as (...x: unknown[]) => unknown;
  m.dobles['Conversar con el modelo'] = (...a: unknown[]) => { c.n++; return previo(...a); };
  return c;
};
const itemAr = { ...CATALOGO[1], moneda: 'ARS', precio: 450000, precioCentavos: 45000000, stock: 10, disponible: true };
const catAr = () => catalogoOk({ mercado: 'AR', moneda: 'ARS' }, [itemAr] as never);
const entregaDeNombre = (t: string): Record<string, string> => (/Ana/.test(t) ? { nombre: 'Ana Pérez' } : {});
const sano = (o: Opciones = {}): Opciones => ({ modeloDice: modeloSano(entregaDeNombre), ...o });
const conEnvio = (o: Opciones = {}): Mund => { const m = crear(sano(o)); hablar(m, ANA, mTexto('quiero una billetera')); hablar(m, ANA, mToque('entrega:envio', 'Envío')); return m; };
const conEnvioAr = (o: Opciones = {}): Mund => { const m = crear(sano({ catalogo: catAr(), ...o })); hablar(m, ARGENTINO, mTexto('quiero una billetera')); hablar(m, ARGENTINO, mToque('entrega:envio', 'Envío')); return m; };

describe('LOS DATOS: las listas cerradas y los pasos, fijados', () => {
  it('los 9 departamentos de Bolivia con id estable en minúscula, títulos de a lo más 24 caracteres, y caben en UNA lista (≤ 10 filas)', () => {
    const d = b('BM_DEPARTAMENTOS') as [string, string][];
    expect(d.map((x) => x[1])).toEqual(['La Paz', 'Cochabamba', 'Santa Cruz', 'Oruro', 'Potosí', 'Chuquisaca', 'Tarija', 'Beni', 'Pando']);
    for (const [id, titulo] of d) { expect(id).toMatch(/^dep:[a-z]{2}$/); expect(titulo.length).toBeLessThanOrEqual(24); }
    expect(new Set(d.map((x) => x[0])).size).toBe(9);
  });
  it('Argentina: 5 regiones y 24 jurisdicciones (23 provincias y CABA) repartidas como se decidió, cada región con 4 a 6 filas, ids `prov:ar-<letra>` únicos y en minúscula', () => {
    const r = b('BM_REGIONES_AR') as [string, string][];
    expect(r.map((x) => x[1])).toEqual(['Centro', 'Cuyo', 'NOA', 'NEA', 'Patagonia']);
    const p = b('BM_PROVINCIAS_AR') as Record<string, [string, string][]>;
    expect(Object.keys(p)).toEqual(r.map((x) => x[0]));
    expect(p['reg:centro']!.map((x) => x[1])).toEqual(['Buenos Aires', 'CABA', 'Córdoba', 'Santa Fe', 'Entre Ríos']);
    expect(p['reg:cuyo']!.map((x) => x[1])).toEqual(['Mendoza', 'San Juan', 'San Luis', 'La Rioja']);
    expect(p['reg:noa']!.map((x) => x[1])).toEqual(['Jujuy', 'Salta', 'Tucumán', 'Catamarca', 'Santiago del Estero']);
    expect(p['reg:nea']!.map((x) => x[1])).toEqual(['Formosa', 'Chaco', 'Corrientes', 'Misiones']);
    expect(p['reg:patagonia']!.map((x) => x[1])).toEqual(['La Pampa', 'Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego']);
    const todas = Object.values(p).flat();
    expect(todas).toHaveLength(24);
    expect(new Set(todas.map((x) => x[0])).size).toBe(24);
    for (const [id, titulo] of todas) { expect(id).toMatch(/^prov:ar-[a-z]$/); expect(titulo.length).toBeLessThanOrEqual(24); }
    for (const k of Object.keys(p)) { expect(p[k]!.length).toBeGreaterThanOrEqual(4); expect(p[k]!.length).toBeLessThanOrEqual(6); }
  });
  it('LA SECUENCIA DE PASOS ES UN DATO y queda fijada: retiro 1 paso, envío de Bolivia 3, envío de Argentina 4 (cada paso, la lista de datos que se piden juntos)', () => {
    expect(b('BM_PASOS_ENTREGA')).toEqual({
      retiro: [['nombre']],
      envio_BO: [['departamento'], ['ciudad', 'aclaracion'], ['nombre', 'documento']],
      envio_AR: [['region'], ['provincia'], ['ciudad', 'aclaracion'], ['nombre', 'documento']],
    });
  });
});

describe('los pasos como DATO: cambiar la tabla cambia lo que se pide, sin tocar la lógica', () => {
  const BO = { modo: 'envío' };
  it('con la tabla por defecto el envío de Bolivia pide un paso por vez, en orden', () => {
    const P = b('bmPideDeEntrega');
    expect(P(BO, 'BO')).toEqual(['departamento']);
    expect(P({ ...BO, departamento: 'dep:lp' }, 'BO')).toEqual(['ciudad']);
    expect(P({ ...BO, departamento: 'dep:lp', ciudad: 'La Paz' }, 'BO')).toEqual(['nombre', 'documento']);
    expect(P({ ...BO, departamento: 'dep:lp', ciudad: 'La Paz', nombre: 'Ana Pérez' }, 'BO')).toEqual(['documento']);
  });
  it('JUNTAR pasos: con el departamento y la ciudad en UN solo paso se pide todo junto, y lo que ya está no se repregunta; la pregunta nombra los dos datos', () => {
    const tabla = { ...b('BM_PASOS_ENTREGA'), envio_BO: [['departamento', 'ciudad'], ['nombre', 'documento']] };
    expect(b('bmPideDeEntrega')(BO, 'BO', tabla)).toEqual(['departamento', 'ciudad']);
    expect(b('bmPideDeEntrega')({ ...BO, departamento: 'dep:lp' }, 'BO', tabla)).toEqual(['ciudad']);
    expect(b('bmPreguntaDelPaso')(BO, 'BO', tabla)).toMatch(/departamento[\s\S]*ciudad/i);
  });
  it('CAMBIAR el orden: nombre y cédula primero, el departamento al final; la lógica pide lo que dice la tabla', () => {
    const tabla = { ...b('BM_PASOS_ENTREGA'), envio_BO: [['nombre', 'documento'], ['ciudad', 'aclaracion'], ['departamento']] };
    expect(b('bmPideDeEntrega')(BO, 'BO', tabla)).toEqual(['nombre', 'documento']);
    expect(b('bmPideDeEntrega')({ ...BO, nombre: 'Ana Pérez', documento: '4412345' }, 'BO', tabla)).toEqual(['ciudad']);
    expect(b('bmPideDeEntrega')({ ...BO, nombre: 'Ana Pérez', documento: '4412345', ciudad: 'Oruro' }, 'BO', tabla)).toEqual(['departamento']);
    expect(b('bmEntregaFalta')(BO, 'BO', tabla)).toEqual(['nombre completo', 'carnet de identidad (CI)', 'ciudad de destino', 'departamento']);
  });
  it('NEGADO: la tabla manda también para decir cuándo está COMPLETA: quitar el paso de la ciudad la deja de exigir; con la tabla por defecto sigue exigida', () => {
    const entrega = { modo: 'envío', departamento: 'dep:lp', nombre: 'Ana Pérez', documento: '4412345' };
    expect(b('bmEntregaCompleta')(entrega, 'BO')).toBe(false);
    const sinCiudad = { ...b('BM_PASOS_ENTREGA'), envio_BO: [['departamento'], ['nombre', 'documento']] };
    expect(b('bmEntregaCompleta')(entrega, 'BO', sinCiudad)).toBe(true);
  });
  it('la aclaración es OPCIONAL: nunca falta, aunque su paso esté en la tabla', () => {
    const e = { modo: 'envío', departamento: 'dep:lp', ciudad: 'La Paz', nombre: 'Ana Pérez', documento: '4412345' };
    expect(b('bmEntregaFalta')(e, 'BO')).toEqual([]);
    expect(b('bmEntregaCompleta')(e, 'BO')).toBe(true);
  });
});

describe('BOLIVIA: el envío por pasos, de punta a punta (mensajes y lista)', () => {
  it('la lista de departamentos es UNA lista interactiva con las 9 filas, botón de a lo más 20 caracteres, cuerpo de a lo más 1.024 y el modo ya anotado; sin modelo', () => {
    const m = crear(sano());
    hablar(m, ANA, mTexto('quiero una billetera'));
    const c = llamadas(m);
    const t = hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    expect(c.n).toBe(0);
    expect(t.mensajes).toHaveLength(1);
    const it0 = interactivo(t);
    expect(it0.type).toBe('list');
    expect(filasDe(t).map((x) => x.title)).toEqual(['La Paz', 'Cochabamba', 'Santa Cruz', 'Oruro', 'Potosí', 'Chuquisaca', 'Tarija', 'Beni', 'Pando']);
    expect(filasDe(t).map((x) => x.id)).toEqual(['dep:lp', 'dep:cb', 'dep:sc', 'dep:or', 'dep:pt', 'dep:ch', 'dep:tj', 'dep:bn', 'dep:pd']);
    expect((it0.action?.button ?? '').length).toBeLessThanOrEqual(20);
    expect((it0.body?.text ?? '').length).toBeLessThanOrEqual(1024);
    expect(ficha(m).entrega['modo']).toBe('Envío');
    expect(ficha(m).pide).toEqual(['departamento']);
  });
  it('tocar una opción escribe el departamento SIN modelo y pide la ciudad (con la aclaración opcional) en UN mensaje de texto', () => {
    const m = conEnvio();
    const c = llamadas(m);
    const t = hablar(m, ANA, mLista('dep:sc', 'Santa Cruz'));
    expect(c.n).toBe(0);
    expect(t.mensajes).toHaveLength(1);
    expect(ficha(m).entrega['departamento']).toBe('dep:sc');
    expect(cuerpos(t)).toMatch(/ciudad/i);
    expect(cuerpos(t)).toMatch(/aclaraci[oó]n/i);
    expect(interactivo(t).type).not.toBe('list');
    expect(ficha(m).pide).toEqual(['ciudad']);
  });
  it('de punta a punta: lista → ciudad con aclaración → nombre y cédula → resumen con TODOS los datos y los dos botones → el QR sale al confirmar', () => {
    const m = conEnvio();
    const t = completarEnvio(m, ANA);
    expect(ficha(m).entrega).toMatchObject({ modo: 'Envío', departamento: 'dep:cb', ciudad: 'Cochabamba', aclaracion: 'oficina Zona Sur', nombre: 'Ana Pérez', documento: '4412345' });
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/Billetera de cuero/);
    for (const x of ['Entrega: Envío', 'Recoge el envío: Ana Pérez', 'Departamento: Cochabamba', 'Ciudad: Cochabamba', 'CI: 4412345', 'Aclaración: oficina Zona Sur']) expect(cuerpos(t)).toContain(x);
    expect(interactivo(t).action?.buttons?.map((x) => x.reply.title)).toEqual(['Confirmar pedido', 'Corregir datos']);
    const q = hablar(m, ANA, mToque(confirmaDe(t)!, 'Confirmar pedido'));
    expect(hayQr(q)).toBe(true);
    const ev = q.llamadas.ingesta.find((x) => x['evento'] === 'qr_enviado') as { entrega?: { tipo?: string; direccion?: string; ubicacion?: unknown } } | undefined;
    expect(ev?.entrega?.tipo).toBe('envio');
    expect(ev?.entrega?.direccion).toMatch(/Ana Pérez.*CI 4412345.*Cochabamba.*oficina Zona Sur/);
    expect(ev?.entrega?.ubicacion).toBeUndefined();   // ninguna ubicación compartida viaja al pedido
  });
  it('NEGADO: el aviso a la tienda (el pedido de Argentina, que sale al confirmar) lleva la provincia, la ciudad y la aclaración, pero nunca el documento ni una ubicación', () => {
    const m = conEnvioAr();
    const t = completarEnvio(m, ARGENTINO, 'AR');
    const q = hablar(m, ARGENTINO, mToque(confirmaDe(t)!, 'Confirmar pedido'));
    expect(q.avisos).toHaveLength(1);
    const avisos = J(q.avisos.map((x) => [x.cuerpo, x.payload]));
    expect(avisos).toContain('Córdoba');
    expect(avisos).toContain('sucursal Palermo');
    expect(avisos).not.toContain('30123456');
    expect(avisos).not.toMatch(/ubicaci[oó]n compartida|latitude|location/i);
  });
});

describe('ARGENTINA: región → provincia → ciudad y aclaración → nombre y DNI', () => {
  it('la lista de regiones tiene 5 filas; al elegir una sale la lista de SUS provincias (4 a 6 filas) con los ids `prov:ar-…`', () => {
    const m = conEnvioAr();
    expect(ficha(m, ARGENTINO).pide).toEqual(['region']);
    const t0 = hablar(m, ARGENTINO, mLista('reg:patagonia', 'Patagonia'));
    expect(interactivo(t0).type).toBe('list');
    expect(filasDe(t0).map((x) => x.title)).toEqual(['La Pampa', 'Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego']);
    expect(filasDe(t0).every((x) => /^prov:ar-[a-z]$/.test(x.id))).toBe(true);
    expect(ficha(m, ARGENTINO).pide).toEqual(['provincia']);
  });
  it('de punta a punta: 4 pasos y el resumen con el DNI, la región y la provincia; el pedido de Argentina queda anotado (sin QR de Bolivia)', () => {
    const m = conEnvioAr();
    const t = completarEnvio(m, ARGENTINO, 'AR');
    expect(ficha(m, ARGENTINO).entrega).toMatchObject({ modo: 'Envío', region: 'reg:centro', provincia: 'prov:ar-x', ciudad: 'Córdoba', aclaracion: 'sucursal Palermo', nombre: 'Ana Pérez', documento: '30123456' });
    for (const x of ['Región: Centro', 'Provincia: Córdoba', 'Ciudad: Córdoba', 'DNI: 30123456', 'Aclaración: sucursal Palermo']) expect(cuerpos(t)).toContain(x);
    const q = hablar(m, ARGENTINO, mToque(confirmaDe(t)!, 'Confirmar pedido'));
    expect(hayQr(q)).toBe(false);
    expect(q.llamadas.ingesta.some((x) => x['evento'] === 'pedido_sin_cobro')).toBe(true);
  });
  it('NEGADO: la provincia de OTRA región no se acepta (ni por la lista ni por el nombre exacto), y una región distinta no pisa la ya elegida', () => {
    const m = conEnvioAr();
    hablar(m, ARGENTINO, mLista('reg:cuyo', 'Cuyo'));
    hablar(m, ARGENTINO, mLista('prov:ar-x', 'Córdoba'));   // Córdoba es del Centro
    expect(ficha(m, ARGENTINO).entrega['provincia']).toBe('');
    hablar(m, ARGENTINO, mTexto('Córdoba'));
    expect(ficha(m, ARGENTINO).entrega['provincia']).toBe('');
    hablar(m, ARGENTINO, mLista('reg:noa', 'NOA'));
    expect(ficha(m, ARGENTINO).entrega['region']).toBe('reg:cuyo');
    hablar(m, ARGENTINO, mLista('prov:ar-m', 'Mendoza'));
    expect(ficha(m, ARGENTINO).entrega).toMatchObject({ region: 'reg:cuyo', provincia: 'prov:ar-m' });
  });
});

describe('NEGADO: el departamento y la provincia SOLO por la lista', () => {
  it('un texto libre no fija el departamento y se vuelve a mandar la LISTA; el nombre EXACTO (con el dato pedido) vale como atajo; uno que solo lo contiene, no', () => {
    const m = conEnvio();
    for (const texto of ['vivo en Cochabamba', 'Cochabamba centro', 'cerca de La Paz', 'quiero que lo manden a Santa Cruz']) {
      const t = hablar(m, ANA, mTexto(texto));
      expect(ficha(m).entrega['departamento'], texto).toBe('');
      expect(interactivo(t).type, texto).toBe('list');
      expect(filasDe(t), texto).toHaveLength(9);
    }
    hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['departamento']).toBe('dep:cb');
  });
  it('un id inventado o mal escrito de la lista no cambia nada, ni llama al modelo, ni emite QR', () => {
    for (const id of ['dep:xx', 'dep:CB', 'dep:cb ', 'DEP:CB', 'dep:', 'dep:cbb', 'prov:ar-x', 'reg:centro', 'dep:cb:1']) {
      const m = conEnvio();
      const c = llamadas(m);
      const t = hablar(m, ANA, mLista(id, 'x'));
      expect(ficha(m).entrega['departamento'], id).toBe('');
      expect(ficha(m).entrega['provincia'], id).toBe('');
      expect(c.n, id).toBe(0);
      expect(hayQr(t), id).toBe(false);
    }
  });
  it('un departamento ya capturado NO se pisa con una lista vieja; solo «Corregir datos» lo borra, y entonces sí se puede elegir otro', () => {
    const m = conEnvio();
    hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    hablar(m, ANA, mLista('dep:lp', 'La Paz'));
    expect(ficha(m).entrega['departamento']).toBe('dep:cb');
    hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(m).entrega['departamento']).toBe('');
    hablar(m, ANA, mLista('dep:lp', 'La Paz'));
    expect(ficha(m).entrega['departamento']).toBe('dep:lp');
  });
  it('en el RECOJO una lista no escribe ningún departamento', () => {
    const m = crear(sano());
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    expect(ficha(m).entrega['departamento']).toBe('');
  });
});

describe('NEGADO: sin esos datos no hay resumen confirmable ni QR', () => {
  const SIN_DOC = { modo: 'Envío', departamento: 'dep:cb', ciudad: 'Cochabamba', nombre: 'Ana Pérez' };
  it('con el envío sembrado SIN la cédula, ni «quiero pagar» ni el botón viejo de «Confirmar pedido» emiten QR ni sacan el botón; se pide lo que falta', () => {
    const m = crear({ ...sano(), entregaPrevia: SIN_DOC });
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mTexto('quiero pagar'));
    expect(hayQr(t)).toBe(false);
    expect(confirmaDe(t)).toBeUndefined();
    expect(cuerpos(t)).toMatch(/c[eé]dula|CI/i);
    const t2 = hablar(m, ANA, mToque('pedido:confirmar:abc123', 'Confirmar pedido'));
    expect(hayQr(t2)).toBe(false);
  });
  for (const [falta, entrega] of [['el departamento', { modo: 'Envío', ciudad: 'Cochabamba', nombre: 'Ana Pérez', documento: '4412345' }], ['la ciudad', { modo: 'Envío', departamento: 'dep:cb', nombre: 'Ana Pérez', documento: '4412345' }], ['el nombre completo', { modo: 'Envío', departamento: 'dep:cb', ciudad: 'Cochabamba', nombre: 'Ana', documento: '4412345' }]] as const) {
    it(`NEGADO: sin ${falta} no hay «Confirmar pedido» ni QR (pide justo eso)`, () => {
      const m = crear({ ...sano(), entregaPrevia: entrega });
      hablar(m, ANA, mTexto('quiero una billetera'));
      const t = hablar(m, ANA, mTexto('quiero pagar'));
      expect(confirmaDe(t)).toBeUndefined();
      expect(hayQr(t)).toBe(false);
    });
  }
  it('sana: con los cinco datos sembrados el resumen sale con «Confirmar pedido»', () => {
    const m = crear({ ...sano(), entregaPrevia: ENVIO_BO });
    const t = hablar(m, ANA, mTexto('quiero una billetera'));
    expect(confirmaDe(t)).toBeDefined();
    expect(hayQr(t)).toBe(false);
  });
});

describe('el pedido que llega del SITIO con la entrega y los datos ya dados: salta los pasos que ya tiene y pide solo lo que falta', () => {
  const SITIO = 'Hola, quiero comprar estos productos: 1 x Billetera de cuero (cód. billetera-cuero): Bs 450 c/u, subtotal Bs 450 Total referencial: Bs 450 El precio final y el envío se confirman por WhatsApp';
  it('con el modo, el departamento y la ciudad ya capturados, el pedido del sitio pide DIRECTO el nombre y la cédula (no repite la lista ni la ciudad)', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [] }), entregaPrevia: { modo: 'Envío', departamento: 'dep:cb', ciudad: 'Cochabamba' } });
    const t = hablar(m, ANA, mTexto(SITIO));
    expect(ficha(m).carrito).toHaveLength(1);
    expect(ficha(m).pide).toEqual(['nombre', 'documento']);
    expect(cuerpos(t)).toMatch(/nombre completo/i);
    expect(interactivo(t).type).not.toBe('list');
    expect(confirmaDe(t)).toBeUndefined();
  });
  it('con todo ya capturado, el pedido del sitio sale directo al resumen con «Confirmar pedido» (y sin QR hasta tocarlo)', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [] }), entregaPrevia: ENVIO_BO });
    const t = hablar(m, ANA, mTexto(SITIO));
    expect(confirmaDe(t)).toBeDefined();
    expect(hayQr(t)).toBe(false);
  });
  it('NEGADO: con la entrega a medias (falta la ciudad), el pedido del sitio NO llega al resumen ni al QR y pide la ciudad', () => {
    const m = crear({ modeloDice: modelo('Con gusto.', { lineas: [] }), entregaPrevia: { modo: 'Envío', departamento: 'dep:cb' } });
    const t = hablar(m, ANA, mTexto(SITIO));
    expect(confirmaDe(t)).toBeUndefined();
    expect(hayQr(t)).toBe(false);
    expect(ficha(m).pide).toEqual(['ciudad']);
  });
});

describe('una pregunta en medio se responde (o se deriva) y se vuelve a pedir el MISMO dato: el estado `pide` persiste', () => {
  it('«¿tienen garantía?» en el paso de la ciudad: el modelo contesta, el mensaje repite la pregunta de la ciudad y `pide` sigue siendo la ciudad', () => {
    const m = conEnvio();
    hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    const t = hablar(m, ANA, mTexto('¿tienen garantía?'));
    expect(ficha(m).entrega['ciudad']).toBe('');
    expect(ficha(m).pide).toEqual(['ciudad']);
    expect(cuerpos(t)).toMatch(/ciudad/i);
    hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
  });
  it('«¿tienen garantía?» en el paso del DEPARTAMENTO: la respuesta lleva de nuevo la lista de 9 departamentos', () => {
    const m = conEnvio();
    const t = hablar(m, ANA, mTexto('¿tienen garantía?'));
    expect(interactivo(t).type).toBe('list');
    expect(filasDe(t)).toHaveLength(9);
    expect(ficha(m).pide).toEqual(['departamento']);
  });
  it('el HORARIO de la tienda (lo contesta el código) deja el dato pedido intacto: la lista vieja sigue valiendo', () => {
    const m = conEnvio({ base: { ubicacionTienda: 'Calle Sucre 12', horarioTienda: 'lunes a sábado de 9 a 19' } });
    const t = hablar(m, ANA, mTexto('¿a qué hora abren?'));
    expect(cuerpos(t)).toContain('lunes a sábado de 9 a 19');
    expect(ficha(m).pide).toEqual(['departamento']);
    hablar(m, ANA, mLista('dep:or', 'Oruro'));
    expect(ficha(m).entrega['departamento']).toBe('dep:or');
  });
  it('si la consulta se DERIVA a recepción (modelo adverso) el dato pedido persiste y la respuesta siguiente se captura', () => {
    const m = crear({ modeloDice: modeloAdverso() });
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:envio', 'Envío'));
    hablar(m, ANA, mLista('dep:cb', 'Cochabamba'));
    const t = hablar(m, ANA, mTexto('¿tienen garantía?'));
    expect(t.avisos.length).toBeGreaterThanOrEqual(1);
    expect(ficha(m).pide).toEqual(['ciudad']);
    hablar(m, ANA, mTexto('Cochabamba'));
    expect(ficha(m).entrega['ciudad']).toBe('Cochabamba');
  });
});

describe('«Corregir datos» permite cambiar el modo y vuelve al primer paso', () => {
  it('del envío completo: «Corregir datos» borra los datos, conserva el modo, manda la lista de departamentos; y lo escrito («recojo en tienda») cambia el modo y pide solo el nombre', () => {
    const m = conEnvio();
    completarEnvio(m, ANA);
    const t = hablar(m, ANA, mToque('pedido:corregir', 'Corregir datos'));
    expect(ficha(m).entrega).toMatchObject({ modo: 'Envío', departamento: '', ciudad: '', nombre: '', documento: '', aclaracion: '' });
    expect(interactivo(t).type).toBe('list');
    const t2 = hablar(m, ANA, mTexto('mejor recojo en tienda'));
    expect(ficha(m).entrega['modo']).toBe('Retiro en tienda');
    expect(ficha(m).pide).toEqual(['nombre']);
    expect(cuerpos(t2)).toMatch(/nombre/i);
  });
});

describe('RECOJO: el nombre → el resumen con la dirección de la tienda y «Ver ubicación» → el QR', () => {
  const MAPA = 'https://maps.app.goo.gl/AbC123';
  const TIENDA = { ubicacionTienda: 'Calle Sucre 12', mapaTienda: MAPA };
  it('al elegir el recojo, la pregunta del nombre lleva el botón «Ver ubicación» de la tienda (enlace https al mapa) en el MISMO mensaje, con la dirección', () => {
    const m = crear(sano({ base: TIENDA }));
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(t.mensajes).toHaveLength(1);
    const it0 = interactivo(t);
    expect(it0.type).toBe('cta_url');
    expect(it0.action?.parameters).toEqual({ display_text: 'Ver ubicación', url: MAPA });
    expect(cuerpos(t)).toContain('Calle Sucre 12');
    expect(cuerpos(t)).toMatch(/nombre/i);
  });
  it('el resumen del recojo lista la dirección de la tienda y el enlace «Ver ubicación», con «Confirmar pedido» y «Corregir datos»; el QR sale al confirmar', () => {
    const m = crear(sano({ base: TIENDA }));
    hablar(m, ANA, mTexto('quiero una billetera'));
    hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(cuerpos(t)).toContain('Retira en: Calle Sucre 12');
    expect(cuerpos(t)).toContain('Ver ubicación: ' + MAPA);
    expect(t.mensajes).toHaveLength(1);
    expect(hayQr(hablar(m, ANA, mToque(confirmaDe(t)!, 'Confirmar pedido')))).toBe(true);
  });
  it('NEGADO: el recojo NO pide departamento, ciudad, cédula ni aclaración, y llega al QR sin esos datos', () => {
    const m = crear(sano());
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t1 = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(cuerpos(t1)).not.toMatch(/departamento|ciudad|c[eé]dula|carnet|aclaraci[oó]n/i);
    const t = hablar(m, ANA, mTexto('Ana Pérez'));
    expect(hayQr(hablar(m, ANA, mToque(confirmaDe(t)!, 'Confirmar pedido')))).toBe(true);
  });
  it('NEGADO: sin mapa válido de la tienda no hay botón «Ver ubicación» (nada inventado)', () => {
    const m = crear(sano({ base: { ubicacionTienda: 'Calle Sucre 12' } }));
    hablar(m, ANA, mTexto('quiero una billetera'));
    const t = hablar(m, ANA, mToque('entrega:retiro', 'Recojo en tienda'));
    expect(J(t.mensajes.map((x) => x.payload))).not.toContain('cta_url');
  });
  it('la consulta «¿dónde están ubicados?» sigue mostrando el botón «Ver ubicación» de la tienda', () => {
    const m = crear(sano({ base: TIENDA }));
    const t = hablar(m, ANA, mTexto('¿dónde están ubicados?'));
    expect(interactivo(t).type).toBe('cta_url');
    expect(interactivo(t).action?.parameters?.display_text).toBe('Ver ubicación');
  });
});

describe('MENSAJES por conversación (cada uno cuesta 0,0113 USD): el neto del asistente, medido', () => {
  const turnos = (m: Mund, tel: string, pasos: unknown[]): number[] => pasos.map((p) => hablar(m, tel, p as never).mensajes.length);
  it('envío de Bolivia con todos los datos en el mensaje que corresponde: 1 + 1 + 1 + 1 + 1 + 2 (QR) = 7', () => {
    const m = crear(sano());
    const n = turnos(m, ANA, [mTexto('quiero una billetera'), mToque('entrega:envio', 'Envío'), mLista('dep:cb', 'Cochabamba'), mTexto('Cochabamba, oficina Zona Sur'), mTexto('Ana Pérez 4412345')]);
    expect(n).toEqual([1, 1, 1, 1, 1]);
    const q = hablar(m, ANA, mToque(confirmaDe(hablar(m, ANA, mTexto('hola')))!, 'Confirmar pedido'));
    expect(q.mensajes).toHaveLength(2);
  });
  it('envío de Bolivia con el nombre y la cédula en mensajes SEPARADOS: un mensaje más (8)', () => {
    const m = conEnvio();
    const n = turnos(m, ANA, [mLista('dep:cb', 'Cochabamba'), mTexto('Cochabamba'), mTexto('Ana Pérez'), mTexto('4412345')]);
    expect(n).toEqual([1, 1, 1, 1]);
  });
  it('envío de Argentina: 1 + 1 + 1 + 1 + 1 + 1 + 1 (el pedido anotado) = 7', () => {
    const m = crear(sano({ catalogo: catAr() }));
    const n = turnos(m, ARGENTINO, [mTexto('quiero una billetera'), mToque('entrega:envio', 'Envío'), mLista('reg:centro', 'Centro'), mLista('prov:ar-x', 'Córdoba'), mTexto('Córdoba'), mTexto('Ana Pérez 30123456')]);
    expect(n).toEqual([1, 1, 1, 1, 1, 1]);
    const t = hablar(m, ARGENTINO, mTexto('hola'));
    const q = hablar(m, ARGENTINO, mToque(confirmaDe(t)!, 'Confirmar pedido'));
    expect(q.mensajes).toHaveLength(1);
  });
  it('recojo: 1 + 1 + 1 + 2 (QR) = 5; el botón «Ver ubicación» va en el mismo mensaje de la pregunta del nombre (0 agregados)', () => {
    const m = crear(sano({ base: { ubicacionTienda: 'Calle Sucre 12', mapaTienda: 'https://maps.app.goo.gl/AbC123' } }));
    const n = turnos(m, ANA, [mTexto('quiero una billetera'), mToque('entrega:retiro', 'Recojo en tienda'), mTexto('Ana Pérez')]);
    expect(n).toEqual([1, 1, 1]);
  });
});

describe('NEGADO: nada de dirección, teléfono, ubicación compartida ni flota en la ficha ni en lo que se manda', () => {
  it('con el envío de Bolivia y el de Argentina completos, la ficha solo tiene los datos de la lista', () => {
    const m = conEnvio();
    completarEnvio(m, ANA);
    const a = conEnvioAr();
    completarEnvio(a, ARGENTINO, 'AR');
    for (const e of [ficha(m).entrega, ficha(a, ARGENTINO).entrega]) expect(Object.keys(e).sort()).toEqual(['aclaracion', 'ciudad', 'departamento', 'documento', 'modo', 'nombre', 'provincia', 'region']);
  });
  it('un envío sembrado con la forma vieja (dirección, flota, CP) se rechaza en la prueba y, en producción, esos campos se descartan al leer la ficha', () => {
    const m = crear(sano());
    const viejo = { modo: 'Envío', ciudad: 'Oruro', nombre: 'Ana Pérez', documento: '4412345', flota: 'Bolivar', direccion: 'Calle 1', cp: '1043' };
    m.sd['casabermejo'] = {};
    (m.sd['casabermejo'] as Record<string, unknown>)[ANA] ={ ultimoMs: m.ahora() - 1000, entrega: viejo, carrito: [{ id: 'billetera-cuero', cantidad: 1, detalle: '' }] };
    hablar(m, ANA, mTexto('hola'));
    const e = ficha(m).entrega;
    expect(e['flota']).toBeUndefined();
    expect(e['direccion']).toBeUndefined();
    expect(e['cp']).toBeUndefined();
    expect(e['departamento']).toBe('');   // y como falta el departamento, el envío vuelve a pedir el primer paso
  });
});

void BILLETERA;
void ENVIO_AR;
