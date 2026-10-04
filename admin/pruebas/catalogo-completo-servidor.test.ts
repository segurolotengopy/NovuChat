/**
 * `configuracionFlujo` Y LA BANDERA `catalogoCompleto`, contra el emulador.
 *
 * POR QUÉ EXISTE (Q'Taco, 03/10/2026). Con el catálogo web ENCENDIDO y más de
 * `UMBRAL_CATALOGO_AL_PROMPT` ítems, la Function manda `catalogo: []` y un
 * resumen: el Demo B lo quiere así, porque su pedido entra por la página y el
 * agente solo recibe el resumen. «Venta mínima v0» necesita lo contrario: la
 * carta COMPLETA (calcula el total del pedido en código) Y la página. Si no
 * recibe la carta, deriva todo pedido sin carta. Q'Taco tiene 78 ítems.
 *
 * La solución es una bandera en el cuerpo de la petición que el flujo ya
 * manda: `catalogoCompleto: true`. Esta suite fija, NEGANDO, lo que la bandera
 * NO puede hacer:
 *   - cambiar nada para quien no la manda (el Demo B conserva su resumen);
 *   - valer como texto («true»), número ni ninguna otra cosa que `true`;
 *   - valer fuera del flujo `venta` de la ruta;
 *   - abrir la carta de un comercio suspendido o ajeno;
 *   - mover al comercio: el `tenantId` sale de la ruta autenticada, jamás del
 *     cuerpo.
 *
 * Va en su propio archivo y no en `demo-b-catalogo.test.ts` porque necesita el
 * emulador, y esa suite está en el proyecto `puras` (sin Firestore). Los casos
 * puros de la bandera (el Demo B no la manda) sí están en
 * `demo-b-catalogo.test.ts`.
 *
 * Emulador, con puerto propio:
 *   FIRESTORE_EMULATOR_PORT=8761 FIRESTORE_EMULATOR_WS_PORT=9761 \
 *     bash pruebas/correr.sh --project emulador pruebas/catalogo-completo-servidor.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const PROYECTO = 'demo-novuchat-pruebas';
process.env['FIRESTORE_EMULATOR_HOST'] = `127.0.0.1:${process.env['FIRESTORE_EMULATOR_PORT'] ?? '8231'}`;
process.env['GCLOUD_PROJECT'] = PROYECTO;
// DÓNDE VIVE EL SITIO PÚBLICO, fijado a un valor ficticio ANTES de importar el
// módulo. Sin `SITIO_PUBLICO` no hay enlace (el PR de Hosting, T-37, quitó el
// respaldo `https://<proyecto>.web.app`: ese sitio ya no sirve `/c/**`), así que
// esta suite no puede depender de que el proyecto lo derive.
const SITIO_DE_PRUEBA = 'https://catalogo.ejemplo.test';
process.env['SITIO_PUBLICO'] = SITIO_DE_PRUEBA;
/** Escapa todo metacaracter de una expresión regular, la barra invertida incluida (CodeQL js/incomplete-sanitization). */
const escaparRegex = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TOKEN = 'valor-de-prueba-del-catalogo-completo';
process.env['INGESTA_CLIENTE16'] = TOKEN;

const { initializeApp, getApps } = await import('firebase-admin/app');
if (!getApps().some((a) => a.name === '[DEFAULT]')) initializeApp({ projectId: PROYECTO });
const { getFirestore, Timestamp, FieldValue } = await import('firebase-admin/firestore');
// `firebase-functions` vive en `functions/node_modules`: se importa el mismo
// objeto `logger` que usa `ingesta.ts`, no una copia.
const { createRequire } = await import('node:module');
const { logger } = createRequire(new URL('../functions/package.json', import.meta.url))(
  'firebase-functions') as { logger: Record<'info' | 'warn' | 'error', (...a: unknown[]) => void> };
const db = getFirestore();
const { configuracionFlujo } = await import('../functions/src/ingesta.ts');
const { enlaceCatalogo, catalogoPublico, checkoutCatalogo, emitirFicha } =
  await import('../functions/src/modulos/catalogo-web/catalogoWeb.ts');
const { UMBRAL_CATALOGO_AL_PROMPT } = await import('../functions/src/core/prompt/prompt.ts');
const { limitesDe } = await import('../functions/src/central/cuenta/planes.ts');

/** Un comercio de venta con el catálogo web encendido y 41 ítems (> umbral). */
const T_VENTA = 'cc-venta';
/** Otro comercio, con ítems de nombre distinto: no debe aparecer jamás. */
const T_AJENO = 'cc-ajeno';
/** Venta, 41 ítems, catálogo web APAGADO. */
const T_SIN_WEB = 'cc-sin-web';
/** Ruta de otro flujo (agendamiento), 41 ítems, catálogo web encendido. */
const T_AGENDA = 'cc-agenda';
/** Venta con catálogo web y 41 ítems, pero suspendido. */
const T_SUSP = 'cc-suspendido';
/** Venta con catálogo web y 10 ítems (por debajo del umbral). */
const T_CHICO = 'cc-chico';

/** Venta con catálogo web y 3 ítems activos SIN precio («a consultar»). */
const T_SIN_PRECIO = 'cc-sin-precio';
/** El Demo B: solo llama a `enlaceCatalogo`, nunca a `configuracionFlujo`. */
const T_DEMO_B = 'cc-demob';

const NUMEROS: Record<string, string> = {
  [T_VENTA]: '1000000201', [T_AJENO]: '1000000202', [T_SIN_WEB]: '1000000203',
  [T_AGENDA]: '1000000204', [T_SUSP]: '1000000205', [T_CHICO]: '1000000206',
  [T_SIN_PRECIO]: '1000000207', [T_DEMO_B]: '1000000208',
};
/** Una SEGUNDA línea del mismo comercio de venta (dos líneas, o un número reasignado). */
const SEGUNDA_LINEA = '1000000209';

const ITEMS = UMBRAL_CATALOGO_AL_PROMPT + 1;

interface Respuesta { codigo: number; cuerpo: Record<string, unknown> }

async function configuracion(tenant: string, cuerpo: unknown = {}): Promise<Respuesta> {
  const cabeceras: Record<string, string> = {
    'x-novuchat-numero': NUMEROS[tenant]!, authorization: `Bearer ${TOKEN}`,
    'content-type': 'application/json',
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; },
    getHeader() { return undefined; },
    set() { return respuesta; },
    on() { return respuesta; },
    end() { return respuesta; },
  };
  await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

/** Llama a una Function HTTP del catálogo web con un método y una ruta. */
async function llamar(
  funcion: unknown,
  o: { metodo: 'GET' | 'POST'; ruta: string; numero?: string; cuerpo?: unknown },
): Promise<Respuesta> {
  const cuerpo = o.cuerpo ?? {};
  const cabeceras: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json',
    ...(o.numero ? { 'x-novuchat-numero': o.numero } : {}),
  };
  const leer = (n: string) => cabeceras[n.toLowerCase()];
  const peticion = {
    method: o.metodo, body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
    headers: cabeceras, get: leer, header: leer,
    path: o.ruta, url: o.ruta, originalUrl: o.ruta,
  };
  const r: Respuesta = { codigo: 0, cuerpo: {} };
  const respuesta = {
    status(c: number) { r.codigo = c; return respuesta; },
    send(b: unknown) { r.cuerpo = { texto: b }; return respuesta; },
    json(b: unknown) { r.cuerpo = b as Record<string, unknown>; return respuesta; },
    setHeader() { return respuesta; }, getHeader() { return undefined; },
    set() { return respuesta; }, type() { return respuesta; },
    on() { return respuesta; }, end() { return respuesta; },
  };
  await (funcion as (q: unknown, s: unknown) => Promise<void>)(peticion, respuesta);
  return r;
}

const catalogoDe = (r: Respuesta) => r.cuerpo['catalogo'] as Record<string, unknown>[];

async function sembrar(
  tenant: string,
  o: { flujo: string; web: boolean; items: number; estado?: string; prefijo?: string },
) {
  await db.doc(`rutasWhatsApp/${NUMEROS[tenant]}`).set({
    tenantId: tenant, flujo: o.flujo, aliasSecreto: 'cliente16', estado: 'activo',
  });
  await db.doc(`tenants/${tenant}`).set({
    nombre: tenant, estado: o.estado ?? 'activo', plan: 'crecimiento', flujos: [o.flujo],
  });
  await db.doc(`tenants/${tenant}/cuenta/estado`).set({
    plan: 'crecimiento', limites: limitesDe('crecimiento'), modalidad: 'demostracion',
  });
  await db.doc(`tenants/${tenant}/config/negocio`).set({
    nombreNegocio: tenant, numeroRecepcion: '70000001', catalogoWebActivo: o.web,
  });
  const prefijo = o.prefijo ?? 'Taco';
  for (let i = 0; i < o.items; i++) {
    await db.doc(`tenants/${tenant}/catalogo/i${String(i).padStart(3, '0')}`).set({
      nombre: `${prefijo} ${i}`, area: i % 2 ? 'tacos' : 'bebidas', precio: 10 + i,
      moneda: 'BOB', activo: true,
    });
  }
}

beforeAll(async () => {
  await sembrar(T_VENTA, { flujo: 'venta', web: true, items: ITEMS });
  await sembrar(T_AJENO, { flujo: 'venta', web: true, items: ITEMS, prefijo: 'AJENO' });
  await sembrar(T_SIN_WEB, { flujo: 'venta', web: false, items: ITEMS });
  await sembrar(T_AGENDA, { flujo: 'agendamiento', web: true, items: ITEMS });
  await sembrar(T_SUSP, { flujo: 'venta', web: true, items: ITEMS, estado: 'suspendido' });
  await sembrar(T_CHICO, { flujo: 'venta', web: true, items: 10 });
  await sembrar(T_SIN_PRECIO, { flujo: 'venta', web: true, items: 3 });
  for (let i = 0; i < 3; i++) {
    await db.doc(`tenants/${T_SIN_PRECIO}/catalogo/i${String(i).padStart(3, '0')}`).update({
      precio: FieldValue.delete(),
    });
  }
  await sembrar(T_DEMO_B, { flujo: 'venta', web: true, items: 5 });
  await db.doc(`rutasWhatsApp/${SEGUNDA_LINEA}`).set({
    tenantId: T_VENTA, flujo: 'venta', aliasSecreto: 'cliente16', estado: 'activo',
  });
}, 120_000);

afterAll(async () => {
  await db.doc(`rutasWhatsApp/${SEGUNDA_LINEA}`).delete();
  for (const t of Object.keys(NUMEROS)) {
    await db.recursiveDelete(db.doc(`tenants/${t}`));
    await db.doc(`rutasWhatsApp/${NUMEROS[t]}`).delete();
    for (const f of (await db.collection('fichasCatalogo').where('tenantId', '==', t).get()).docs) {
      await f.ref.delete();
    }
  }
});

describe('Sin la bandera, todo queda como estaba (el Demo B conserva su resumen)', () => {
  it('con el catálogo web encendido y más de 40 ítems: `catalogo` vacío, resumen y `derivar: true`', async () => {
    const r = await configuracion(T_VENTA, { telefono: '59170000001' });
    expect(r.codigo).toBe(200);
    expect(catalogoDe(r)).toEqual([]);
    expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: true });
    expect(r.cuerpo['catalogoResumen']).toBeTruthy();
  });

  it('`catalogoCompleto: false` o ausente es lo mismo que no mandarla', async () => {
    for (const cuerpo of [{}, { catalogoCompleto: false }, { catalogoCompleto: null }]) {
      const r = await configuracion(T_VENTA, cuerpo);
      expect(catalogoDe(r)).toEqual([]);
      expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: true });
    }
  });
});

describe('Con `catalogoCompleto: true` (booleano) el flujo `venta` recibe la carta entera', () => {
  it('41 ítems, con su id, y `catalogoWeb: { activo: true, derivar: false }`; sin resumen', async () => {
    const r = await configuracion(T_VENTA, { telefono: '59170000001', catalogoCompleto: true });
    expect(r.codigo).toBe(200);
    expect(catalogoDe(r)).toHaveLength(ITEMS);
    expect(catalogoDe(r).every((i) => typeof i['id'] === 'string' && i['id'] !== '')).toBe(true);
    // Sin teléfono en la petición no hay enlace (se prueba más abajo); acá sí
    // hay teléfono, así que a las dos claves se suman el enlace y su vencimiento.
    expect(r.cuerpo['catalogoWeb']).toMatchObject({ activo: true, derivar: false });
    expect(r.cuerpo['catalogoResumen']).toBeUndefined();
  });

  it('el umbral no cambió: el catálogo chico sigue completo, con o sin bandera', async () => {
    for (const cuerpo of [{}, { catalogoCompleto: true }]) {
      const r = await configuracion(T_CHICO, cuerpo);
      expect(catalogoDe(r)).toHaveLength(10);
      expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: false });
    }
  });
});

describe('La bandera es booleana estricta', () => {
  it.each([
    ['el texto «true»', 'true'], ['el texto «TRUE»', 'TRUE'], ['el número 1', 1],
    ['un objeto', { valor: true }], ['una lista', [true]], ['el texto «1»', '1'],
  ])('%s no vale: `catalogo` sigue vacío y se deriva', async (_nombre, valor) => {
    const r = await configuracion(T_VENTA, { catalogoCompleto: valor });
    expect(r.codigo).toBe(200);
    expect(catalogoDe(r)).toEqual([]);
    expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: true });
  });
});

describe('La bandera no cambia nada fuera del caso para el que existe', () => {
  it('sin catálogo web: la carta completa viaja con o sin bandera, y no aparece `catalogoWeb`', async () => {
    for (const cuerpo of [{}, { catalogoCompleto: true }]) {
      const r = await configuracion(T_SIN_WEB, cuerpo);
      expect(catalogoDe(r)).toHaveLength(ITEMS);
      expect(r.cuerpo['catalogoWeb']).toBeUndefined();
    }
  });

  it('en una ruta que NO es `venta` la bandera se ignora: sigue el resumen', async () => {
    const r = await configuracion(T_AGENDA, { catalogoCompleto: true });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['flujo']).toBe('agendamiento');
    expect(catalogoDe(r)).toEqual([]);
    expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: true });
  });

  it('un comercio suspendido sigue dando 409, con la bandera y sin ella, y sin carta', async () => {
    for (const cuerpo of [{}, { catalogoCompleto: true }]) {
      const r = await configuracion(T_SUSP, cuerpo);
      expect(r.codigo).toBe(409);
      expect(r.cuerpo['estado']).toBe('suspendido');
      expect(r.cuerpo['catalogo']).toBeUndefined();
      expect(r.cuerpo['tenantId']).toBeUndefined();
    }
  });
});

describe('El comercio sale de la ruta autenticada, nunca del cuerpo', () => {
  it('un `tenantId` en el cuerpo se ignora: la carta es la de la ruta y no se cuela la ajena', async () => {
    const r = await configuracion(T_VENTA, {
      catalogoCompleto: true, tenantId: T_AJENO, flujo: 'agendamiento', tenant: T_AJENO,
    });
    expect(r.codigo).toBe(200);
    expect(r.cuerpo['tenantId']).toBe(T_VENTA);
    expect(r.cuerpo['flujo']).toBe('venta');
    expect(catalogoDe(r)).toHaveLength(ITEMS);
    expect(JSON.stringify(r.cuerpo)).not.toContain('AJENO');
  });

  it('un `tenantId` ajeno sin bandera tampoco mueve nada', async () => {
    const r = await configuracion(T_VENTA, { tenantId: T_AJENO });
    expect(r.cuerpo['tenantId']).toBe(T_VENTA);
    expect(catalogoDe(r)).toEqual([]);
    expect(JSON.stringify(r.cuerpo)).not.toContain('AJENO');
  });

  it('el comercio ajeno, con su propia ruta, recibe SU carta y no la de otro', async () => {
    const r = await configuracion(T_AJENO, { catalogoCompleto: true, tenantId: T_VENTA });
    expect(r.cuerpo['tenantId']).toBe(T_AJENO);
    expect(catalogoDe(r).every((i) => String(i['nombre']).startsWith('AJENO'))).toBe(true);
  });
});

// =============================================================================
// EL ENLACE DE LA CARTA EN LA MISMA RESPUESTA (`catalogoWeb.enlace`)
//
// «Venta mínima v0» no agrega un nodo HTTP: el enlace de ESA conversación viaja
// en la respuesta de `configuracionFlujo`, con la misma bandera. Es una
// capacidad (quien lo tiene arma un carrito en esa conversación), así que lo
// que se defiende acá es: ni una ficha de más, ni un enlace para quien no lo
// pidió, ni uno compartido entre dos conversaciones, ni uno en un registro.
// =============================================================================
const FORMA_ENLACE = /^https:\/\/catalogo\.ejemplo\.test\/c\/[0-9a-f]{32}$/;
const fichasDe = async (tenant: string, telefono?: string) => {
  const q = await db.collection('fichasCatalogo').where('tenantId', '==', tenant).get();
  // El puntero `ult_…` no es una ficha: se cuentan solo las de 32 hexadecimales.
  return q.docs.filter((d) => /^[0-9a-f]{32}$/.test(d.id)
    && (telefono === undefined || d.get('telefono') === telefono));
};
const enlaceDe = (r: Respuesta) =>
  (r.cuerpo['catalogoWeb'] as Record<string, unknown> | undefined)?.['enlace'] as string | undefined;
const idDeFicha = (url: string) => url.slice(url.lastIndexOf('/') + 1);
const bitacoraDe = async (tenant: string) =>
  (await db.collection(`tenants/${tenant}/bitacora`).get()).docs.map((d) => d.data());

describe('Con la bandera, `catalogoWeb.enlace` es el de ESTA conversación', () => {
  const TEL = '70010001';

  it('trae la URL con una ficha de 128 bits, su vencimiento a 72 h y la carta completa', async () => {
    const antes = Date.now();
    const r = await configuracion(T_VENTA, { telefono: TEL, catalogoCompleto: true });
    const url = enlaceDe(r);
    expect(url).toMatch(FORMA_ENLACE);
    const web = r.cuerpo['catalogoWeb'] as Record<string, unknown>;
    expect(web['activo']).toBe(true);
    expect(web['derivar']).toBe(false);
    const vence = Date.parse(String(web['enlaceCaducaEn']));
    expect(vence - antes).toBeGreaterThan(71.9 * 3_600_000);
    expect(vence - antes).toBeLessThan(72.1 * 3_600_000);
    expect(catalogoDe(r)).toHaveLength(ITEMS);
    // La ficha es de ESTE comercio y de ESTE teléfono, con el número de la ruta.
    const ficha = await db.doc(`fichasCatalogo/${idDeFicha(url!)}`).get();
    expect(ficha.get('tenantId')).toBe(T_VENTA);
    expect(ficha.get('telefono')).toBe(TEL);
    expect(ficha.get('phoneNumberId')).toBe(NUMEROS[T_VENTA]);
    expect(ficha.get('flujo')).toBe('venta');
    expect(ficha.get('checkouts')).toBe(0);
  });

  it('tres turnos de la misma conversación: el MISMO enlace y UNA sola ficha', async () => {
    const tel = '70010002';
    const antes = (await fichasDe(T_VENTA)).length;
    const bitacoraAntes = (await bitacoraDe(T_VENTA)).filter((b) => b['tipo'] === 'catalogo_enlace').length;
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }));
    const b = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }));
    const c = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }));
    expect(a).toMatch(FORMA_ENLACE);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(await fichasDe(T_VENTA, tel)).toHaveLength(1);
    expect((await fichasDe(T_VENTA)).length).toBe(antes + 1);
    // Y un solo renglón de bitácora: se anota la ficha que se abre, no el reuso.
    const bitacoraDespues = (await bitacoraDe(T_VENTA)).filter((x) => x['tipo'] === 'catalogo_enlace').length;
    expect(bitacoraDespues).toBe(bitacoraAntes + 1);
  });

  it('diez turnos SIMULTÁNEOS tampoco abren diez fichas', async () => {
    const tel = '70010003';
    const rs = await Promise.all(Array.from({ length: 10 },
      () => configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true })));
    expect(new Set(rs.map(enlaceDe)).size).toBe(1);
    expect(await fichasDe(T_VENTA, tel)).toHaveLength(1);
  });

  it('dos conversaciones distintas NUNCA comparten enlace ni ficha', async () => {
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: '70010004', catalogoCompleto: true }));
    const b = enlaceDe(await configuracion(T_VENTA, { telefono: '70010005', catalogoCompleto: true }));
    expect(a).toMatch(FORMA_ENLACE);
    expect(b).toMatch(FORMA_ENLACE);
    expect(a).not.toBe(b);
    const fa = await db.doc(`fichasCatalogo/${idDeFicha(a!)}`).get();
    const fb = await db.doc(`fichasCatalogo/${idDeFicha(b!)}`).get();
    expect(fa.get('telefono')).toBe('70010004');
    expect(fb.get('telefono')).toBe('70010005');
  });

  it('el mismo teléfono en dos comercios distintos: dos enlaces, cada uno a su comercio', async () => {
    const tel = '70010006';
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }));
    const b = enlaceDe(await configuracion(T_AJENO, { telefono: tel, catalogoCompleto: true }));
    expect(a).not.toBe(b);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(a!)}`).get()).get('tenantId')).toBe(T_VENTA);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(b!)}`).get()).get('tenantId')).toBe(T_AJENO);
  });

  it('borde de vida: con 6 h restantes se reutiliza; con 5 h 59 min, o 1 ms menos, no', async () => {
    // Reloj fijo (solo `Date`) para que «6 h exactas» sea exacto y no una carrera.
    vi.useFakeTimers({ toFake: ['Date'] });
    const T0 = Date.now();
    try {
      const casos: [string, number, boolean][] = [
        ['70010007', 6 * 3_600_000, true],
        ['70010008', 6 * 3_600_000 - 1, false],
        ['70010009', (5 * 60 + 59) * 60_000, false],
      ];
      for (const [tel, resta, seReutiliza] of casos) {
        const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
        await db.doc(`fichasCatalogo/${idDeFicha(a)}`).update({
          caducaEn: Timestamp.fromMillis(T0 + resta),
        });
        const b = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
        expect(b === a, `resta ${resta} ms`).toBe(seReutiliza);
      }
    } finally { vi.useRealTimers(); }
  });

  it('una ficha con UN carrito ya no se reutiliza: el segundo pedido abre enlace nuevo y el puntero apunta a él', async () => {
    const tel = '70010010';
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    // Antes del primer carrito, el mismo enlace.
    expect(enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))).toBe(a);
    // El carrito entra por el checkout de verdad (no se simula el contador).
    const checkout = await llamar(checkoutCatalogo, {
      metodo: 'POST', ruta: `/api/catalogo/${idDeFicha(a)}/checkout`,
      cuerpo: { items: [{ id: 'i000', cantidad: 2 }], entrega: 'retiro' },
    });
    expect(checkout.codigo).toBe(200);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(a)}`).get()).get('checkouts')).toBe(1);
    // El pedido no llegó marcado como compartido: era el primero de esa ficha.
    const pedidos = await db.collection(`tenants/${T_VENTA}/pedidos`).get();
    expect(pedidos.docs.filter((d) => d.get('fichaCompartida') === true)).toHaveLength(0);
    // El siguiente turno de la conversación: ficha NUEVA.
    const b = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(b).not.toBe(a);
    const puntero = await db.doc(`fichasCatalogo/ult_${T_VENTA}_${tel}`).get();
    expect(puntero.get('ficha')).toBe(idDeFicha(b));
    expect((await db.doc(`fichasCatalogo/${idDeFicha(b)}`).get()).get('checkouts')).toBe(0);
    // Y el segundo pedido, con el enlace nuevo, tampoco llega como compartido.
    const segundo = await llamar(checkoutCatalogo, {
      metodo: 'POST', ruta: `/api/catalogo/${idDeFicha(b)}/checkout`,
      cuerpo: { items: [{ id: 'i001', cantidad: 1 }], entrega: 'retiro' },
    });
    expect(segundo.codigo).toBe(200);
    const todos = await db.collection(`tenants/${T_VENTA}/pedidos`).get();
    expect(todos.docs.filter((d) => d.get('fichaCompartida') === true)).toHaveLength(0);
    // Cada pedido consume su enlace: el tercer turno abre otro, distinto de los dos anteriores.
    const c = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(new Set([a, b, c]).size).toBe(3);
    // El enlace viejo sigue abriendo hasta su tope propio (cinco carritos, 72 h): el límite de
    // la ficha no cambió, solo dejó de dársela a la conversación.
    expect((await llamar(catalogoPublico, { metodo: 'GET', ruta: `/api/catalogo/${idDeFicha(a)}` })).codigo).toBe(200);
  });

  it('`caducaEn` es un Timestamp de Firestore en la ficha y en el puntero: es lo único sobre lo que el TTL actúa (revisión del PR #380)', async () => {
    const tel = '70010012';
    const enlace = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    const ficha = await db.doc(`fichasCatalogo/${idDeFicha(enlace)}`).get();
    const puntero = await db.doc(`fichasCatalogo/ult_${T_VENTA}_${tel}`).get();
    for (const doc of [ficha, puntero]) {
      // Ni un número (milisegundos) ni un texto ISO: TTL ignora cualquier valor que no sea Timestamp.
      expect(doc.get('caducaEn'), doc.id).toBeInstanceOf(Timestamp);
      expect(typeof doc.get('caducaEn')).toBe('object');
    }
    // El puntero vence con la ficha a la que apunta: ninguno de los dos sobrevive al otro por diseño.
    expect((puntero.get('caducaEn') as InstanceType<typeof Timestamp>).toMillis())
      .toBe((ficha.get('caducaEn') as InstanceType<typeof Timestamp>).toMillis());
    // Y vence en el futuro, dentro de la vida de la ficha (72 h).
    const resta = (ficha.get('caducaEn') as InstanceType<typeof Timestamp>).toMillis() - Date.now();
    expect(resta).toBeGreaterThan(71 * 3_600_000);
    expect(resta).toBeLessThanOrEqual(72 * 3_600_000);
  });

  it('una ficha ya vencida, y purgada o no por el TTL, no abre: 404 en la página y el turno siguiente abre ficha nueva', async () => {
    const tel = '70010013';
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    const ruta = `/api/catalogo/${idDeFicha(a)}`;
    // Vencida pero todavía presente (el TTL borra con demora de hasta unos días): no abre.
    await db.doc(`fichasCatalogo/${idDeFicha(a)}`).update({ caducaEn: Timestamp.fromMillis(Date.now() - 1000) });
    expect((await llamar(catalogoPublico, { metodo: 'GET', ruta })).codigo).toBe(404);
    // Ya purgada (lo que hace el TTL): sigue siendo 404, y el puntero que quedó apuntando a la nada no sirve.
    await db.doc(`fichasCatalogo/${idDeFicha(a)}`).delete();
    expect((await llamar(catalogoPublico, { metodo: 'GET', ruta })).codigo).toBe(404);
    const b = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(b).not.toBe(a);
    expect((await llamar(catalogoPublico, { metodo: 'GET', ruta: `/api/catalogo/${idDeFicha(b)}` })).codigo).toBe(200);
  });

  it('la ficha de OTRO número, o de otro flujo, no se reutiliza (dos líneas, número reasignado)', async () => {
    const tel = '70010011';
    const a = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    // Misma conversación, pero por la segunda línea del comercio: otro webhook.
    const peticion = async (numero: string) => {
      const cuerpo = { telefono: tel, catalogoCompleto: true };
      return llamar(configuracionFlujo, { metodo: 'POST', ruta: '/', numero, cuerpo });
    };
    const b = enlaceDe(await peticion(SEGUNDA_LINEA))!;
    expect(b).toMatch(FORMA_ENLACE);
    expect(b).not.toBe(a);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(b)}`).get()).get('phoneNumberId')).toBe(SEGUNDA_LINEA);
    // De vuelta por la primera: la del puntero es la de la segunda línea, no sirve.
    const c = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(c).not.toBe(b);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(c)}`).get()).get('phoneNumberId')).toBe(NUMEROS[T_VENTA]);
    // Un número reasignado dentro de las 72 h: la ficha vigente es del número viejo.
    await db.doc(`fichasCatalogo/${idDeFicha(c)}`).update({ phoneNumberId: '1000000299' });
    const d = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(d).not.toBe(c);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(d)}`).get()).get('phoneNumberId')).toBe(NUMEROS[T_VENTA]);
    // Otro flujo en la ficha vigente: tampoco.
    await db.doc(`fichasCatalogo/${idDeFicha(d)}`).update({ flujo: 'agendamiento' });
    const e = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))!;
    expect(e).not.toBe(d);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(e)}`).get()).get('flujo')).toBe('venta');
    // Y la de ahora, intacta, se reutiliza.
    expect(enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }))).toBe(e);
  });

  it('sin teléfono no hay conversación a la que atar un enlace: no sale, y la carta sí', async () => {
    const antes = (await fichasDe(T_VENTA)).length;
    const r = await configuracion(T_VENTA, { catalogoCompleto: true });
    expect(enlaceDe(r)).toBeUndefined();
    expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: false });
    expect(catalogoDe(r)).toHaveLength(ITEMS);
    expect((await fichasDe(T_VENTA)).length).toBe(antes);
  });
});

describe('Sin la bandera, o con la bandera mal escrita, no sale enlace ni se abre una ficha', () => {
  it.each([
    ['sin bandera', {}],
    ['`false`', { catalogoCompleto: false }],
    ['el texto «true»', { catalogoCompleto: 'true' }],
    ['el número 1', { catalogoCompleto: 1 }],
  ])('%s', async (_nombre, extra) => {
    const tel = '70020001';
    const r = await configuracion(T_VENTA, { telefono: tel, ...extra });
    expect(r.codigo).toBe(200);
    expect(enlaceDe(r)).toBeUndefined();
    expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: true });
    expect(await fichasDe(T_VENTA, tel)).toHaveLength(0);
  });
});

describe('Los límites del enlace: sin catálogo web, suspendido o de otro flujo, nada', () => {
  const TEL = '70030001';

  it('el comercio sin catálogo web: sin enlace, sin `catalogoWeb` y sin ficha', async () => {
    const r = await configuracion(T_SIN_WEB, { telefono: TEL, catalogoCompleto: true });
    expect(r.codigo).toBe(200);
    expect(enlaceDe(r)).toBeUndefined();
    expect(r.cuerpo['catalogoWeb']).toBeUndefined();
    expect(await fichasDe(T_SIN_WEB)).toHaveLength(0);
  });

  it('el comercio suspendido: 409, sin enlace en la respuesta y sin ficha', async () => {
    const r = await configuracion(T_SUSP, { telefono: TEL, catalogoCompleto: true });
    expect(r.codigo).toBe(409);
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/\/c\/[0-9a-f]{32}/);
    expect(await fichasDe(T_SUSP)).toHaveLength(0);
  });

  it('una ruta que no es `venta`: la bandera no abre ninguna ficha', async () => {
    const r = await configuracion(T_AGENDA, { telefono: TEL, catalogoCompleto: true });
    expect(r.codigo).toBe(200);
    expect(enlaceDe(r)).toBeUndefined();
    expect(await fichasDe(T_AGENDA)).toHaveLength(0);
  });

  it('un comercio con ítems pero NINGUNO con precio: sin enlace (una vitrina vacía no se ofrece)', async () => {
    const r = await configuracion(T_SIN_PRECIO, { telefono: TEL, catalogoCompleto: true });
    expect(r.codigo).toBe(200);
    expect(enlaceDe(r)).toBeUndefined();
    expect(catalogoDe(r)).toHaveLength(3);
    expect(await fichasDe(T_SIN_PRECIO)).toHaveLength(0);
  });

  it('un comercio que perdió el flujo `venta` en su ficha: sin enlace', async () => {
    await db.doc(`tenants/${T_CHICO}`).update({ flujos: ['agendamiento'] });
    try {
      const r = await configuracion(T_CHICO, { telefono: TEL, catalogoCompleto: true });
      expect(r.codigo).toBe(200);
      expect(enlaceDe(r)).toBeUndefined();
      expect(await fichasDe(T_CHICO)).toHaveLength(0);
    } finally { await db.doc(`tenants/${T_CHICO}`).update({ flujos: ['venta'] }); }
  });
});

describe('Si la ficha no se puede crear, el turno sigue sin enlace', () => {
  it('un error de Firestore al abrirla: 200, carta completa, sin `enlace`', async () => {
    const tel = '70040001';
    const espia = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('caido'));
    try {
      const r = await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true });
      expect(r.codigo).toBe(200);
      expect(enlaceDe(r)).toBeUndefined();
      expect(r.cuerpo['catalogoWeb']).toEqual({ activo: true, derivar: false });
      expect(catalogoDe(r)).toHaveLength(ITEMS);
      expect(espia).toHaveBeenCalledTimes(1);
    } finally { espia.mockRestore(); }
    // Y al turno siguiente, ya sin la falla, el enlace sale.
    expect(enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true })))
      .toMatch(FORMA_ENLACE);
  });
});

describe('El enlace es una capacidad: nunca en un registro, y solo para la ruta autenticada', () => {
  it('ni los registros del servidor ni la bitácora llevan la ficha entera: solo sus últimos 4', async () => {
    const tel = '70050001';
    const salidas: string[] = [];
    const captura = (...a: unknown[]) => { salidas.push(JSON.stringify(a)); };
    const e1 = vi.spyOn(logger, 'info').mockImplementation(captura as never);
    const e2 = vi.spyOn(logger, 'warn').mockImplementation(captura as never);
    const e3 = vi.spyOn(logger, 'error').mockImplementation(captura as never);
    let url: string | undefined;
    try {
      url = enlaceDe(await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true }));
      await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true });
    } finally { e1.mockRestore(); e2.mockRestore(); e3.mockRestore(); }
    expect(url).toMatch(FORMA_ENLACE);
    const id = idDeFicha(url!);
    const todo = salidas.join('\n');
    expect(todo).toContain('configuracionFlujo: turno servido');
    expect(todo).not.toContain(id);
    expect(todo).not.toContain(url!);
    expect(todo).toContain(`"catalogoEnlaceUlt4":"${id.slice(-4)}"`);
    expect(todo).toContain('"catalogoEnlace":"reutilizado"');
    expect(JSON.stringify(await bitacoraDe(T_VENTA))).not.toContain(id);
  });

  it('sin autenticación: 401, sin cuerpo y ni una ficha', async () => {
    const antes = (await fichasDe(T_VENTA)).length;
    const cabeceras: Record<string, string> = {
      'x-novuchat-numero': NUMEROS[T_VENTA]!, authorization: 'Bearer otro-valor',
    };
    const leer = (n: string) => cabeceras[n.toLowerCase()];
    const cuerpo = { telefono: '70050002', catalogoCompleto: true };
    let codigo = 0;
    let json: unknown;
    const respuesta = {
      status(c: number) { codigo = c; return respuesta; },
      send() { return respuesta; }, json(b: unknown) { json = b; return respuesta; },
      setHeader() { return respuesta; }, set() { return respuesta; }, end() { return respuesta; },
      on() { return respuesta; }, getHeader() { return undefined; },
    };
    await (configuracionFlujo as unknown as (q: unknown, s: unknown) => Promise<void>)({
      method: 'POST', body: cuerpo, rawBody: Buffer.from(JSON.stringify(cuerpo)),
      headers: cabeceras, get: leer, header: leer,
    }, respuesta);
    expect(codigo).toBe(401);
    expect(json).toBeUndefined();
    expect((await fichasDe(T_VENTA)).length).toBe(antes);
  });

  it('un `tenantId` en el cuerpo se ignora: la ficha es de la ruta y el comercio ajeno no suma ninguna', async () => {
    const tel = '70050003';
    const antesAjeno = (await fichasDe(T_AJENO)).length;
    const r = await configuracion(T_VENTA, {
      telefono: tel, catalogoCompleto: true, tenantId: T_AJENO, tenant: T_AJENO,
    });
    const url = enlaceDe(r)!;
    expect(url).toMatch(FORMA_ENLACE);
    expect((await db.doc(`fichasCatalogo/${idDeFicha(url)}`).get()).get('tenantId')).toBe(T_VENTA);
    expect((await fichasDe(T_AJENO)).length).toBe(antesAjeno);
  });

  it('la página no abre el puntero: su identificador no tiene forma de ficha', async () => {
    const punteros = (await db.collection('fichasCatalogo').where('tenantId', '==', T_VENTA).get())
      .docs.filter((d) => d.id.startsWith('ult_'));
    expect(punteros.length).toBeGreaterThan(0);
    for (const p of punteros) expect(p.id).not.toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('El puntero `ult_…` no abre nada desde afuera', () => {
  it('`catalogoPublico` y `checkoutCatalogo` con el id del puntero dan 404, y no se crea ningún pedido', async () => {
    const tel = '70010020';
    await configuracion(T_VENTA, { telefono: tel, catalogoCompleto: true });
    const id = `ult_${T_VENTA}_${tel}`;
    expect((await db.doc(`fichasCatalogo/${id}`).get()).exists).toBe(true);
    const pedidosAntes = (await db.collection(`tenants/${T_VENTA}/pedidos`).get()).size;
    for (const ruta of [`/api/catalogo/${id}`, `/${id}`, `/c/${id}?x=1`]) {
      const p = await llamar(catalogoPublico, { metodo: 'GET', ruta });
      expect(p.codigo, ruta).toBe(404);
      expect(JSON.stringify(p.cuerpo)).not.toContain(tel);
      const c = await llamar(checkoutCatalogo, {
        metodo: 'POST', ruta: `${ruta.split('?')[0]}/checkout`,
        cuerpo: { items: [{ id: 'i000', cantidad: 1 }], entrega: 'retiro' },
      });
      expect(c.codigo, `${ruta}/checkout`).toBe(404);
    }
    expect((await db.collection(`tenants/${T_VENTA}/pedidos`).get()).size).toBe(pedidosAntes);
  });
});

describe('`emitirFicha` rechaza una entrada que no tiene forma de comercio y teléfono', () => {
  it('un comercio o un teléfono mal formados lanzan «entrada invalida» y no escriben nada, con y sin reutilizar', async () => {
    const antes = (await db.collection('fichasCatalogo').get()).size;
    const base = { phoneNumberId: NUMEROS[T_VENTA], flujo: 'venta' };
    const malas = [
      { tenantId: T_VENTA, telefono: '' },
      { tenantId: T_VENTA, telefono: '7001' },
      { tenantId: T_VENTA, telefono: '70010050/../x' },
      { tenantId: T_VENTA, telefono: '+591' + '70010050' },
      { tenantId: T_VENTA, telefono: '1'.repeat(16) },
      { tenantId: '', telefono: '70010050' },
      { tenantId: 'a/b', telefono: '70010050' },
      { tenantId: 'CC-VENTA', telefono: '70010050' },
      { tenantId: `${T_VENTA}_ult`, telefono: '70010050' },
    ];
    for (const m of malas) {
      for (const reutilizar of [true, false]) {
        await expect(emitirFicha({ ...base, ...m, reutilizar }), `${m.tenantId}|${m.telefono}|${reutilizar}`)
          .rejects.toThrow('entrada invalida');
      }
    }
    expect((await db.collection('fichasCatalogo').get()).size).toBe(antes);
    // Y con la forma correcta, sigue funcionando.
    const ok = await emitirFicha({ ...base, tenantId: T_VENTA, telefono: '70010051', reutilizar: true });
    expect(ok.id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('`enlaceCatalogo` (el Demo B) no cambió: una ficha nueva por llamada y ningún puntero', () => {
  it('dos llamadas con el mismo teléfono: dos URL distintas, dos fichas, ningún `ult_…` y los 7 campos de siempre', async () => {
    const tel = '70010030';
    const pedir = () => llamar(enlaceCatalogo, {
      metodo: 'POST', ruta: '/', numero: NUMEROS[T_DEMO_B], cuerpo: { telefono: tel },
    });
    const a = await pedir();
    const b = await pedir();
    expect(a.codigo).toBe(200);
    expect(b.codigo).toBe(200);
    expect(a.cuerpo['url']).toMatch(FORMA_ENLACE);
    expect(b.cuerpo['url']).toMatch(FORMA_ENLACE);
    expect(a.cuerpo['url']).not.toBe(b.cuerpo['url']);
    const todo = await db.collection('fichasCatalogo').where('tenantId', '==', T_DEMO_B).get();
    expect(todo.docs.filter((d) => d.id.startsWith('ult_'))).toHaveLength(0);
    const fichas = todo.docs.filter((d) => d.get('telefono') === tel);
    expect(fichas).toHaveLength(2);
    for (const f of fichas) {
      expect(Object.keys(f.data()).sort()).toEqual(
        ['caducaEn', 'checkouts', 'creadaEn', 'flujo', 'phoneNumberId', 'telefono', 'tenantId']);
      expect(f.get('caducaEn')).toBeInstanceOf(Timestamp);
      expect(f.get('checkouts')).toBe(0);
    }
  });
});

describe('Si no hay enlace, el registro dice por qué (`catalogoEnlaceMotivo`) y sin datos sensibles', () => {
  /** Corre una petición y devuelve lo que se escribió en el log del servidor. */
  async function conLog(tenant: string, cuerpo: unknown) {
    const lineas: unknown[][] = [];
    const captura = (...a: unknown[]) => { lineas.push(a); };
    const espias = (['info', 'warn', 'error'] as const).map(
      (n) => vi.spyOn(logger, n).mockImplementation(captura as never));
    try { return { r: await configuracion(tenant, cuerpo), log: JSON.stringify(lineas) }; }
    finally { espias.forEach((e) => e.mockRestore()); }
  }

  it('sin teléfono: `sinTelefono`', async () => {
    const { r, log } = await conLog(T_VENTA, { catalogoCompleto: true });
    expect(enlaceDe(r)).toBeUndefined();
    expect(log).toContain('"catalogoEnlaceMotivo":"sinTelefono"');
  });

  it('sin ítems con precio: `sinVendibles`', async () => {
    const { r, log } = await conLog(T_SIN_PRECIO, { telefono: '70010040', catalogoCompleto: true });
    expect(enlaceDe(r)).toBeUndefined();
    expect(log).toContain('"catalogoEnlaceMotivo":"sinVendibles"');
  });

  it('el comercio perdió el flujo `venta` en su ficha: `sinVenta`', async () => {
    await db.doc(`tenants/${T_CHICO}`).update({ flujos: ['agendamiento'] });
    try {
      const { log } = await conLog(T_CHICO, { telefono: '70010041', catalogoCompleto: true });
      expect(log).toContain('"catalogoEnlaceMotivo":"sinVenta"');
    } finally { await db.doc(`tenants/${T_CHICO}`).update({ flujos: ['venta'] }); }
  });

  it('`SITIO_PUBLICO` ausente (o que no es https): `sinSitio`, la señal que faltaba', async () => {
    // Se borra SITIO_PUBLICO, que es lo que decide. Los dos de proyecto se
    // quitan también para que la prueba valga igual con o sin el respaldo
    // `https://<proyecto>.web.app` que quitó T-37: con la rama sola (respaldo
    // presente) y con la rama junto a Hosting (respaldo ausente) da `sinSitio`.
    const claves = ['SITIO_PUBLICO', 'GCLOUD_PROJECT', 'GCP_PROJECT'] as const;
    const guardado = Object.fromEntries(claves.map((k) => [k, process.env[k]]));
    const restaurar = () => {
      for (const k of claves) {
        if (guardado[k] === undefined) delete process.env[k]; else process.env[k] = guardado[k];
      }
    };
    try {
      for (const sitio of [undefined, 'http://catalogo.ejemplo.test', 'catalogo.ejemplo.test']) {
        for (const k of claves) delete process.env[k];
        if (sitio !== undefined) process.env['SITIO_PUBLICO'] = sitio;
        const { r, log } = await conLog(T_VENTA, { telefono: '70010042', catalogoCompleto: true });
        expect(r.codigo).toBe(200);
        expect(enlaceDe(r), String(sitio)).toBeUndefined();
        expect(log).toContain('"catalogoEnlaceMotivo":"sinSitio"');
        expect(catalogoDe(r)).toHaveLength(ITEMS);
      }
    } finally { restaurar(); }
    // Y con el sitio configurado, el enlace sale en ESE sitio.
    const r = await configuracion(T_VENTA, { telefono: '70010042', catalogoCompleto: true });
    expect(enlaceDe(r)).toMatch(new RegExp(`^${escaparRegex(SITIO_DE_PRUEBA)}/c/[0-9a-f]{32}$`));
  });

  it('un error al abrir la ficha: `error`, con el código y el teléfono (últimos 4), sin el mensaje ni la ruta', async () => {
    const tel = '70010043';
    const falla = Object.assign(
      new Error(`9 FAILED_PRECONDITION: projects/p/databases/(default)/documents/fichasCatalogo/ult_${T_VENTA}_${tel}`),
      { code: 9 });
    const espia = vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(falla);
    let salida: { r: Respuesta; log: string };
    try { salida = await conLog(T_VENTA, { telefono: tel, catalogoCompleto: true }); }
    finally { espia.mockRestore(); }
    expect(salida.r.codigo).toBe(200);
    expect(enlaceDe(salida.r)).toBeUndefined();
    expect(salida.log).toContain('"catalogoEnlaceMotivo":"error"');
    expect(salida.log).toContain('"codigo":9');
    expect(salida.log).toContain('"telefonoUlt4":"0043"');
    expect(salida.log).not.toContain('FAILED_PRECONDITION');
    expect(salida.log).not.toContain('projects/');
    expect(salida.log).not.toContain(tel);
  });
});
