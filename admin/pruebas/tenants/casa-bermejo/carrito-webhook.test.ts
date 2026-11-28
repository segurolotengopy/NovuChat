/**
 * EL WEBHOOK DEL CARRITO DEL CATÁLOGO WEB EN EL FLUJO DE CASA BERMEJO (B4-a, estructura): el nodo, su guardia, su conexión y qué pasa con un carrito en el turno.
 * Sin la lógica de decisión (la pone B4-b): aquí se prueba que el carrito ENTRA bien y que, mientras nadie lo decida, el turno termina en algo SEGURO. Se prueba NEGANDO.
 * Costo: 0 mensajes por conversación; +1 nodo (el webhook, solo en la variante de producción).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
// @ts-expect-error — el armador es un módulo .mjs sin tipos
import * as C from '../../../../Flujos/clientes/casa-bermejo/construir.mjs';
// @ts-expect-error — el módulo común es un .mjs
import { WEBHOOK_DEL_CARRITO, marcadorDeRuta } from '../../../../Flujos/src/modulos/catalogo-web/carrito-del-catalogo.mjs';
import { ANA, CARPETA, PID, PRODUCCION, PRUEBA, crear, mTexto, hablar, panelOk, textos } from './mundo';

const RUTA_DE_DATOS = join(CARPETA, '../../../admin/scripts/datos/casa-bermejo/casa-bermejo.json');
const DATOS = JSON.parse(readFileSync(RUTA_DE_DATOS, 'utf8')) as J;
const MARCADOR = 'REEMPLAZAR_RUTA_CARRITO_CASA_BERMEJO';
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodo = (f: J, n: string): J => (f['nodes'] as J[]).find((x) => x['name'] === n) as J;
const destinos = (f: J, de: string): string[] => ((((f['connections'] as J)[de] ?? {}) as J)['main'] as J[][] | undefined ?? []).flat().map((x) => String(x['node']));

const cabeceras = (m: ReturnType<typeof crear>, numero = PID): J => ({ 'x-novuchat-numero': numero, 'x-novuchat-timestamp': String(m.ahora()), 'x-novuchat-signature': `sha256=${'0'.repeat(64)}` });
const cuerpo = (op: J = {}): J => ({
  tipo: 'carrito', tenantId: 'casa-bermejo', telefono: ANA, accion: 'responder', pedidoId: 'cat_a1', conversacionId: `wa_${ANA}`, ventanaAbierta: true,
  items: [{ id: 'billetera-cuero', nombre: 'Billetera de cuero', cantidad: 1, subtotal: 450, precioCentavos: 45000 }],
  total: 450, moneda: 'BOB', mercado: 'BO', catalogo: 'externo', entrega: 'retiro', costoEnvio: 0, direccion: '', nota: '', descartados: [], ...op,
});
const enviar = (m: ReturnType<typeof crear>, body: J, hdr?: J) => m.turno({ headers: hdr ?? cabeceras(m), body }, { via: WEBHOOK_DEL_CARRITO, tolerarFallo: true });

describe('el nodo «Carrito del catálogo»: solo en producción, con su forma exacta', () => {
  it('producción lo lleva (POST, headerAuth con la credencial de la ingesta, ruta como marcador) y la variante de prueba NO', () => {
    const n = nodo(PRODUCCION as J, WEBHOOK_DEL_CARRITO);
    expect(n).toBeTruthy();
    expect(n['type']).toBe('n8n-nodes-base.webhook');
    expect((n['parameters'] as J)['httpMethod']).toBe('POST');
    expect((n['parameters'] as J)['authentication']).toBe('headerAuth');
    expect((n['parameters'] as J)['path']).toBe(MARCADOR);
    expect(marcadorDeRuta('casa-bermejo')).toBe(MARCADOR);
    expect((((n['credentials'] as J)['httpHeaderAuth']) as J)['name']).toBe((DATOS['credenciales'] as J)['ingesta']);
    expect(nodo(PRUEBA as J, WEBHOOK_DEL_CARRITO)).toBeUndefined();
    expect(C.guardias('prueba', PRUEBA)).toEqual([]);
    expect(C.guardias('produccion', PRODUCCION, { credencialIngesta: (DATOS['credenciales'] as J)['ingesta'] })).toEqual([]);
  });
  it('NEGADO: sin credencial o sin autenticación, con otra credencial, con otro método o con una ruta real, la guardia lo rechaza', () => {
    const ing = (DATOS['credenciales'] as J)['ingesta'];
    const g = (f: J): string => C.guardias('produccion', f, { credencialIngesta: ing }).join(' | ');
    const sinCred = clonar(PRODUCCION) as J; delete (nodo(sinCred, WEBHOOK_DEL_CARRITO) as J)['credentials'];
    expect(g(sinCred)).toMatch(/credencial de cabecera de la ingesta/);
    const sinAuth = clonar(PRODUCCION) as J; (nodo(sinAuth, WEBHOOK_DEL_CARRITO)['parameters'] as J)['authentication'] = 'none';
    expect(g(sinAuth)).toMatch(/headerAuth/);
    const otraCred = clonar(PRODUCCION) as J; (((nodo(otraCred, WEBHOOK_DEL_CARRITO)['credentials'] as J)['httpHeaderAuth']) as J)['name'] = 'OtraCredencial';
    expect(g(otraCred)).toMatch(/credencial de cabecera de la ingesta/);
    const get = clonar(PRODUCCION) as J; (nodo(get, WEBHOOK_DEL_CARRITO)['parameters'] as J)['httpMethod'] = 'GET';
    expect(g(get)).toMatch(/POST/);
    const real = clonar(PRODUCCION) as J; (nodo(real, WEBHOOK_DEL_CARRITO)['parameters'] as J)['path'] = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    expect(g(real)).toMatch(/ruta como marcador/);
    const conId = clonar(PRODUCCION) as J; nodo(conId, WEBHOOK_DEL_CARRITO)['webhookId'] = 'abc';
    expect(g(conId)).toMatch(/webhookId/);
  });
  it('NEGADO: la variante de prueba con el webhook, o la producción sin él, no pasan las guardias', () => {
    const p = clonar(PRUEBA) as J; (p['nodes'] as J[]).push(clonar(nodo(PRODUCCION as J, WEBHOOK_DEL_CARRITO)));
    expect(C.guardias('prueba', p).join(' ')).toMatch(/no lleva el webhook/);
    const s = clonar(PRODUCCION) as J; s['nodes'] = (s['nodes'] as J[]).filter((x) => x['name'] !== WEBHOOK_DEL_CARRITO);
    expect(C.guardias('produccion', s, { credencialIngesta: (DATOS['credenciales'] as J)['ingesta'] }).join(' ')).toMatch(/falta el webhook/);
  });
  it('la ruta real nunca aparece: el marcador está UNA vez en el JSON, no en notas, y los datos lo declaran', () => {
    const texto = readFileSync(join(CARPETA, 'casa-bermejo.json'), 'utf8');
    expect(texto.split(MARCADOR).length - 1).toBe(1);
    expect(readFileSync(join(CARPETA, 'casa-bermejo.prueba.json'), 'utf8')).not.toContain(MARCADOR);
    expect(DATOS['carritoMarcador']).toBe(MARCADOR);
    for (const f of [PRODUCCION, PRUEBA]) for (const n of f.nodes as J[]) expect(String(n['notes'] ?? ''), String(n['name'])).not.toMatch(/webhook\/|https?:\/\/[^ ]*carrito|[0-9a-f]{24,}/i);
    // El marcador copiado a una nota: la guardia lo exige una sola vez.
    const f = clonar(PRODUCCION) as J; nodo(f, 'Config base')['notes'] = `la ruta es ${MARCADOR}`;
    expect(C.guardias('produccion', f, { credencialIngesta: (DATOS['credenciales'] as J)['ingesta'] }).join(' ')).toMatch(/una sola vez/);
  });
  it('`--publicable` exige sustituir el marcador de la ruta del carrito (está declarado en los datos)', () => {
    expect(C.marcadoresDeLoArmado([PRODUCCION], RUTA_DE_DATOS)).toContain(MARCADOR);
    expect(C.marcadoresDeLoArmado([PRUEBA], RUTA_DE_DATOS)).not.toContain(MARCADOR);
  });
});

describe('la guardia de `--publicable` con la ruta ya sustituida', () => {
  const ing = (DATOS['credenciales'] as J)['ingesta'];
  const con = (path: string): string[] => { const f = clonar(PRODUCCION) as J; (nodo(f, WEBHOOK_DEL_CARRITO)['parameters'] as J)['path'] = path; return C.guardias('produccion', f, { credencialIngesta: ing, rutaCarritoSustituida: true }); };
  it('una ruta con forma de ruta pasa; una forma rara, o el marcador a medias, no; y sin la opción siempre se exige el marcador', () => {
    expect(con('ruta_carrito_de_ensayo_0001')).toEqual([]);
    expect(con('con/barra/y espacios').join(' ')).toMatch(/ruta como marcador/);
    expect(con('REEMPLAZAR_OTRA_COSA').join(' ')).toMatch(/ruta como marcador/);
    const f = clonar(PRODUCCION) as J; (nodo(f, WEBHOOK_DEL_CARRITO)['parameters'] as J)['path'] = 'ruta_carrito_de_ensayo_0001';
    expect(C.guardias('produccion', f, { credencialIngesta: ing }).join(' ')).toMatch(/ruta como marcador/);
  });
  it('NEGADO (LOW de seguridad, ronda 2): ya sustituida la credencial, el webhook del carrito debe usar LA MISMA que «Traer configuración»; cualquier otro nombre, o ninguno, se rechaza', () => {
    const prep = (cartera: string | null, panel: string): J => {
      const f = clonar(PRODUCCION) as J;
      (nodo(f, WEBHOOK_DEL_CARRITO)['parameters'] as J)['path'] = 'ruta_carrito_de_ensayo_0001';
      ((nodo(f, 'Traer configuración')['credentials'] as J)['httpHeaderAuth'] as J)['name'] = panel;
      if (cartera === null) delete (nodo(f, WEBHOOK_DEL_CARRITO) as J)['credentials'];
      else ((nodo(f, WEBHOOK_DEL_CARRITO)['credentials'] as J)['httpHeaderAuth'] as J)['name'] = cartera;
      return f;
    };
    const g = (f: J): string => C.guardias('produccion', f, { credencialIngesta: ing, rutaCarritoSustituida: true }).join(' | ');
    expect(g(prep('IngestaReal', 'IngestaReal'))).toBe('');                                  // SANO: la misma
    expect(g(prep('CredencialAjena', 'IngestaReal'))).toMatch(/MISMA credencial.*«Traer configuración».*«CredencialAjena»/);
    expect(g(prep(null, 'IngestaReal'))).toMatch(/MISMA credencial/);
  });
});

describe('las conexiones: el carrito entra solo a «Config base» y «Carga de entrada» corre después', () => {
  it('el webhook solo conecta con «Config base», que sigue a «Carga de entrada»; «Config base» tiene dos entradas y ninguna más', () => {
    expect(destinos(PRODUCCION as J, WEBHOOK_DEL_CARRITO)).toEqual(['Config base']);
    expect(destinos(PRODUCCION as J, 'Config base')).toEqual(['Carga de entrada']);
    const entradas = Object.entries((PRODUCCION as J)['connections'] as J).filter(([, s]) => (((s as J)['main'] as J[][]) ?? []).some((o) => (o ?? []).some((x) => x['node'] === 'Config base'))).map(([de]) => de).sort();
    expect(entradas).toEqual(['Carrito del catálogo', 'Descartar repetidos']);
  });
  it('NEGADO: el webhook conectado directo a «Carga de entrada» (sin «Config base») o a otro nodo se detecta', () => {
    const ing = (DATOS['credenciales'] as J)['ingesta'];
    const f = clonar(PRODUCCION) as J; ((f['connections'] as J)[WEBHOOK_DEL_CARRITO] as J)['main'] = [[{ node: 'Carga de entrada', type: 'main', index: 0 }]];
    expect(C.guardias('produccion', f, { credencialIngesta: ing }).join(' ')).toMatch(/debe conectar solo con «Config base»/);
    const g = clonar(PRODUCCION) as J; ((g['connections'] as J)[WEBHOOK_DEL_CARRITO] as J)['main'] = [[{ node: 'Config base', type: 'main', index: 0 }, { node: 'Normalizar entrada', type: 'main', index: 0 }]];
    expect(C.guardias('produccion', g, { credencialIngesta: ing }).join(' ')).toMatch(/debe conectar solo con/);
  });
  it('el código de «Carga de entrada» lleva la rama del carrito ANTES del código común, también en la variante de prueba (que no tiene el webhook y no la ejecuta)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const js = String(((nodo(f as J, 'Carga de entrada')['parameters']) as J)['jsCode']);
      expect(js).toContain('ccEntradaDelCarrito');
      expect(js.indexOf('ccEntradaDelCarrito')).toBeLessThan(js.indexOf('Carrito del catálogo') + 1_000_000);
      expect(js).toContain('pcDecision'); // la pieza común del pedido del carrito, incluida DESPUÉS de carrito.js para la lógica que viene
      expect(js.indexOf('function vcLineas')).toBeLessThan(js.indexOf('function pcLineasDelCarrito'));
    }
  });
  it('«Traer configuración» pide el catálogo completo y el carrito no se reporta como mensaje entrante', () => {
    const cuerpoTraer = String(((nodo(PRODUCCION as J, 'Traer configuración')['parameters']) as J)['jsonBody']);
    expect(cuerpoTraer).toMatch(/catalogoCompleto: true/);
    expect(String((nodo(PRODUCCION as J, '¿Reportar? (entrante)')['parameters'] as J)['conditions'] ? JSON.stringify(nodo(PRODUCCION as J, '¿Reportar? (entrante)')['parameters']) : '')).toContain("tipo !== 'carrito'");
  });
});

describe('un carrito en el turno', () => {
  const PANEL = (): ReturnType<typeof panelOk> => panelOk();
  it('Decidir turno decide el plan `carrito` (nunca el mensaje de «tipo no soportado»): sin el nombre del retiro, pide lo que falta, sin modelo y sin QR', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo());
    expect(t.fallo).toBeNull();
    const norm = (t.porNodo['Normalizar entrada'] ?? [])[0] ?? {};
    expect(norm['tipo']).toBe('carrito');
    expect((norm['carrito'] as J | undefined)?.['pedidoId']).toBe('cat_a1');
    expect(t.ejecutados.has('Decidir turno')).toBe(true);
    const dec = (t.porNodo['Decidir turno'] ?? [])[0] ?? {};
    expect((dec['plan'] as J)['tipo']).toBe('carrito');
    expect(t.ejecutados.has('Conversar con el modelo')).toBe(false);
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/Recibí (?:su|tu) pedido del catálogo/);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/solo puedo leer|texto, notas de voz/i);
    expect(t.mensajes.some((e) => e.tipo === 'image')).toBe(false);
    for (const x of t.mensajes) expect(x.cuerpo).not.toMatch(/acreditad|verificad|recibimos tu pago/i);
    expect(t.ejecutados.has('Reportar mensaje (entrante)')).toBe(false);
  });
  it('NEGADO: un carrito de OTRO comercio (`tenantId` distinto de casa-bermejo) no se contesta: ni el plan carrito, ni un mensaje, ni la ficha con su pedido; el sano sí', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo({ tenantId: 'otro-comercio', pedidoId: 'cat_x1' }));
    expect(t.mensajes).toHaveLength(0);
    expect(((t.porNodo['Decidir turno'] ?? [])[0]?.['plan'] as J | undefined)?.['tipo']).toBe('nada');
    const ficha = ((m.sd['casabermejo'] ?? {}) as Record<string, J>)[ANA] ?? {};
    expect(ficha['carrito']).toEqual([]);
    expect(ficha['pedidoCatalogo']).toBe('');
    // El panel de ESTE número es de casa-bermejo: un carrito que dice ser de casa-bermejo pero cuyo panel es de otro tampoco se contesta.
    const m2 = crear({ panel: panelOk({ tenantId: 'otro-comercio' }) });
    expect(enviar(m2, cuerpo({ pedidoId: 'cat_x2' })).mensajes).toHaveLength(0);
    // Control: el mismo cuerpo sano sí se contesta.
    expect(enviar(crear({ panel: PANEL() }), cuerpo({ pedidoId: 'cat_x3' })).mensajes).toHaveLength(1);
  });
  it('un webhook para otro phoneNumberId no hace nada', () => {
    const m = crear({ panel: PANEL() });
    const t = enviar(m, cuerpo(), cabeceras(m, '59100000099'));
    expect(t.mensajes).toHaveLength(0);
    expect(t.ejecutados.has('Normalizar entrada')).toBe(false);
  });
  it('NEGADO: una entrada sin forma de carrito (sin ítems, firma basura, teléfono que no es número) no se procesa', () => {
    const m = crear({ panel: PANEL() });
    expect(enviar(m, cuerpo({ items: [] })).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c3' }), { ...cabeceras(m), 'x-novuchat-signature': 'basura' }).mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c4', telefono: 'no-es-un-numero' })).mensajes).toHaveLength(0);
    // Negando la negación: el cuerpo bueno sí entra.
    expect(enviar(m, cuerpo({ pedidoId: 'cat_c9' })).ejecutados.has('Normalizar entrada')).toBe(true);
  });
  it('el mismo pedidoId dos veces se procesa una sola; otro pedidoId sí', () => {
    const m = crear({ panel: PANEL() });
    const a = enviar(m, cuerpo());
    expect(a.ejecutados.has('Decidir turno')).toBe(true);
    const b = enviar(m, cuerpo());
    expect(b.ejecutados.has('Decidir turno')).toBe(false);
    expect(b.mensajes).toHaveLength(0);
    expect(enviar(m, cuerpo({ pedidoId: 'cat_otro' })).ejecutados.has('Decidir turno')).toBe(true);
  });
  it('un mensaje de texto normal sigue por su camino (la rama del carrito no corre sin el webhook)', () => {
    const m = crear({ panel: PANEL() });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.fallo).toBeNull();
    expect(textos(t).length).toBeGreaterThan(0);
  });
});
