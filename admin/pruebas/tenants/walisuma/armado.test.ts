/**
 * EL ARMADO del esqueleto de Walisuma (`Flujos/experimental/walisuma/construir.mjs`): lo que el JSON versionado tiene y lo que NO puede tener. Se prueba NEGANDO: cada guardia se prueba contra un JSON dañado a propósito.
 */
import { spawnSync } from 'node:child_process';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — el armador es un módulo .mjs sin tipos
import * as C from '../../../../Flujos/experimental/walisuma/construir.mjs';
// @ts-expect-error — el módulo común es un .mjs
import { NODOS_DEL_GUARDADO as GUARDADO } from '../../../../Flujos/experimental/comun-sin-agente/src/guardado.mjs';
import type { Flujo, J } from '../../lib/flujo';
import { PRODUCCION, PRUEBA } from './mundo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const FLUJOS = join(RAIZ, 'Flujos/experimental');
const CARPETA = join(FLUJOS, 'walisuma');
const leer = (r: string): string => readFileSync(r, 'utf8');
const DATOS = JSON.parse(leer(join(RAIZ, 'admin/scripts/datos/walisuma/walisuma.json'))) as J;
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodo = (f: Flujo, n: string): J => (f.nodes as J[]).find((x) => x['name'] === n) as J;
const nombres = (f: Flujo): string[] => (f.nodes as J[]).map((x) => String(x['name']));
const corrida = (...args: string[]) => spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), ...args], { encoding: 'utf8', env: entornoDelEmulador({}) });

describe('tamaño y composición', () => {
  it('como máximo 56 nodos (47 + los 9 del guardado de medios, excepción de Andres del 29/10/2026, contrato v2 del 30/10): producción 56 exactos, prueba 51', () => {
    expect(PRODUCCION.nodes.length).toBe(56);
    expect(PRUEBA.nodes.length).toBe(51);
    expect(C.TOPE_DE_NODOS).toBe(56);
  });
  it('los 11 nodos del PR-3 están (el esqueleto de 36 más 11), sin repetirse', () => {
    for (const n of C.NODOS_DEL_PR3 as string[]) { expect(nombres(PRODUCCION)).toContain(n); expect(nombres(PRUEBA)).toContain(n); }
    expect(new Set(C.NODOS_DEL_PR3).size).toBe(11);
  });
  it('NEGADO: un flujo con más de 56 nodos viola la guardia', () => {
    const f = clonar(PRODUCCION);
    for (let i = 0; i < 1; i++) f.nodes.push({ id: `extra-${i}`, name: `Extra ${i}`, type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 0], parameters: {} } as never);
    expect(C.guardias('produccion', f).join(' ')).toMatch(/tiene 57 nodos y el tope es 56/);
  });
  it('los id de nodo son nombres cortos (nunca UUID) y los nombres y los id no se repiten', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const ids = (f.nodes as J[]).map((n) => String(n['id']));
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(nombres(f)).size).toBe(ids.length);
      for (const id of ids) expect(id, id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    }
  });
  it('cada variante tiene las dos entradas que le tocan: producción el receptor y no la prueba; la prueba al revés', () => {
    expect(nombres(PRODUCCION)).not.toContain('Entrada de prueba');
    expect(nombres(PRUEBA)).toContain('Entrada de prueba');
    for (const n of C.NODOS_DEL_RECEPTOR as string[]) { expect(nombres(PRODUCCION)).toContain(n); expect(nombres(PRUEBA)).not.toContain(n); }
  });
  it('las medidas: 6 del receptor, 7 de entrada, 1 de puerta, 13 de medios, 9 de salida, 11 de la venta y 9 del guardado', () => {
    const MEDIOS = ['¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', 'Transcribir audio', 'Preparar transcripción', 'Guardar comprobante', '¿Es un documento?', 'Describir documento', 'Describir imagen', 'Preparar imagen', 'Medio no aceptado'];
    const ENTRADA = ['Config base', 'Carga de entrada', 'Traer configuración', 'Config del negocio', 'Normalizar entrada', '¿Reportar? (entrante)', 'Reportar mensaje (entrante)'];
    const SALIDA = ['Armar mensajes', '¿Meta aceptó?', '¿Enviar de verdad?', 'Enviar a WhatsApp', '¿Falló el envío?', 'Enviar respaldo', '¿Reportar? (saliente)', 'Reportar mensaje (saliente)', 'Resumen del turno'];
    const todos = [...C.NODOS_DEL_RECEPTOR, ...ENTRADA, 'Puerta del turno', ...MEDIOS, ...SALIDA, ...C.NODOS_DEL_PR3, ...GUARDADO];
    expect(new Set(todos).size).toBe(56);
    expect([...nombres(PRODUCCION)].sort()).toEqual([...todos].sort());
  });
});

describe('la entrada verificada del receptor: INCLUIDA, no copiada', () => {
  const origen = JSON.parse(leer(join(FLUJOS, 'venta-minima/flujo.plantilla.json'))) as Flujo;
  it('los 6 nodos del flujo son idénticos a su origen (con los datos sustituidos)', () => {
    for (const n of C.NODOS_DEL_RECEPTOR as string[]) {
      const esperado = C.reemplazarTextos(clonar(nodo(origen, n)), DATOS, n);
      expect(nodo(PRODUCCION, n), n).toEqual(esperado);
    }
    expect(C.hallazgosDelReceptor(PRODUCCION, DATOS)).toEqual([]);
  });
  it('NEGADO: tocar cualquiera de los 6 nodos (un parámetro, la conexión de la firma) lo delata', () => {
    for (const n of C.NODOS_DEL_RECEPTOR as string[]) {
      const f = clonar(PRODUCCION);
      (nodo(f, n)['parameters'] as J)['__tocado'] = true;
      expect(C.hallazgosDelReceptor(f, DATOS).join(' '), n).toMatch(/difiere de su origen/);
    }
    const sin = clonar(PRODUCCION);
    sin.nodes = (sin.nodes as J[]).filter((x) => x['name'] !== 'Aceptar (200)') as never;
    expect(C.hallazgosDelReceptor(sin, DATOS).join(' ')).toMatch(/falta el nodo «Aceptar \(200\)»/);
  });
  it('NEGADO: un atajo «Entrega del receptor → Config base» (o cambiar las conexiones del receptor) se detecta, sobre una copia en memoria', () => {
    const f = clonar(PRODUCCION);
    const c = f.connections as J;
    c['Entrega del receptor'].main[0].push({ node: 'Config base', type: 'main', index: 0 });
    expect(C.hallazgosDelReceptor(f, DATOS).join(' ')).toMatch(/conexiones de «Entrega del receptor» difieren/);
    const g = C.guardias('produccion', f).join(' ');
    expect(g).toMatch(/única entrada a «Descartar repetidos»/);
    expect(g).toMatch(/salir solo hacia «Verificar firma con el receptor»/);
    expect(C.guardias('produccion', PRODUCCION)).toEqual([]);
  });
  it('la firma inválida corta en «Rechazar (401)» y la válida sigue por «Aceptar (200)» → «Descartar repetidos» → «Config base»', () => {
    const c = PRODUCCION.connections as J;
    expect(c['¿Firma válida?'].main[1][0].node).toBe('Rechazar (401)');
    expect(c['Rechazar (401)']).toBeUndefined();
    expect(c['Aceptar (200)'].main[0][0].node).toBe('Descartar repetidos');
    expect(c['Descartar repetidos'].main[0][0].node).toBe('Config base');
  });
  it('el verificador: SIN «Continue on Fail» ni onError, `wabaIdEsperado` FIJO y «Descartar repetidos» entre ejecuciones', () => {
    const v = nodo(PRODUCCION, 'Verificar firma con el receptor');
    expect(v['onError']).toBeUndefined();
    expect(v['continueOnFail']).toBeUndefined();
    expect(String((v['parameters'] as J)['jsonBody'])).toMatch(/wabaIdEsperado: "REEMPLAZAR_WABA_ID_WALISUMA"/);
    const d = nodo(PRODUCCION, 'Descartar repetidos')['parameters'] as J;
    expect(d['operation']).toBe('removeItemsSeenInPreviousExecutions');
    expect(d['logic']).toBe('removeItemsWithAlreadySeenKeyValues');
    expect(C.guardias('produccion', PRODUCCION)).toEqual([]);
  });
  it('NEGADO: «Continue on Fail», `onError`, un wabaId por expresión o repetidos solo dentro de la ejecución violan la guardia', () => {
    const a = clonar(PRODUCCION); nodo(a, 'Verificar firma con el receptor')['onError'] = 'continueRegularOutput';
    expect(C.guardias('produccion', a).join(' ')).toMatch(/Continue on Fail/);
    const b = clonar(PRODUCCION); nodo(b, 'Verificar firma con el receptor')['continueOnFail'] = true;
    expect(C.guardias('produccion', b).join(' ')).toMatch(/Continue on Fail/);
    const c = clonar(PRODUCCION); const p = nodo(c, 'Verificar firma con el receptor')['parameters'] as J;
    p['jsonBody'] = String(p['jsonBody']).replace(/wabaIdEsperado: "[^"]*"/, 'wabaIdEsperado: $json.body.value.metadata.phone_number_id');
    expect(C.guardias('produccion', c).join(' ')).toMatch(/wabaIdEsperado/);
    const d = clonar(PRODUCCION); (nodo(d, 'Descartar repetidos')['parameters'] as J)['operation'] = 'removeItemsWithinCurrentInput';
    expect(C.guardias('produccion', d).join(' ')).toMatch(/Descartar repetidos/);
    const e = clonar(PRODUCCION); nodo(e, '¿Firma válida?')['onError'] = 'continueRegularOutput';
    expect(C.guardias('produccion', e).join(' ')).toMatch(/Continue on Fail/);
  });
  it('la prueba no lleva el receptor, y la producción no lleva «Entrada de prueba»', () => {
    const f = clonar(PRODUCCION); f.nodes.push(clonar(nodo(PRUEBA, 'Entrada de prueba')) as never);
    expect(C.guardias('produccion', f).join(' ')).toMatch(/Entrada de prueba/);
    const g = clonar(PRUEBA); g.nodes.push(clonar(nodo(PRODUCCION, 'Entrega del receptor')) as never);
    expect(C.guardias('prueba', g).join(' ')).toMatch(/entrada del receptor/);
  });
});

describe('el flujo completo: conexiones y guardias de la venta', () => {
  const c = PRODUCCION.connections as J;
  it('cada empalme del PR-3 existe (EMPALMES_DEL_PR3) y la guardia lo exige (NEGADO si se corta)', () => {
    expect(C.EMPALMES_DEL_PR3.length).toBeGreaterThanOrEqual(19);
    for (const [de, a] of C.EMPALMES_DEL_PR3 as [string, string][]) expect(JSON.stringify(c[de]), `${de} → ${a}`).toContain(`"${a}"`);
    for (const [de, a] of C.EMPALMES_DEL_PR3 as [string, string][]) {
      const f = clonar(PRODUCCION);
      for (const o of ((f.connections as J)[de].main as J[][])) { const i = o.findIndex((x: J) => x['node'] === a); if (i >= 0) o.splice(i, 1); }
      expect(C.guardias('produccion', f).join(' '), `${de} → ${a}`).toMatch(new RegExp(`«${de.replace(/[?¿()]/g, '.')}» no está conectado a «${a.replace(/[?¿()]/g, '.')}»|tiene que ir a «Decidir turno»|único nodo sin entradas`));
    }
  });
  it('todas las ramas de medios terminan en «Armar mensajes» (que escribe la ficha): sin nodo suelto salvo «Guardar comprobante»', () => {
    const alcanzan = new Set<string>(['Armar mensajes']);
    let crecio = true;
    while (crecio) {
      crecio = false;
      for (const [de, s] of Object.entries(c)) if (!alcanzan.has(de) && ((s as J).main as J[][]).some((o) => (o ?? []).some((x: J) => alcanzan.has(String(x['node']))))) { alcanzan.add(de); crecio = true; }
    }
    const sueltos = nombres(PRODUCCION).filter((n) => !alcanzan.has(n) && !(GUARDADO as string[]).includes(n) && !['Rechazar (401)', 'Guardar comprobante', 'Resumen del turno', 'Reportar mensaje (saliente)', '¿Meta aceptó?', 'Armar mensajes', '¿Enviar de verdad?', 'Enviar a WhatsApp', '¿Falló el envío?', 'Enviar respaldo', '¿Reportar? (saliente)'].includes(n));
    expect(sueltos).toEqual([]);
  });
  it('el único nodo sin entradas es el receptor (producción) o «Entrada de prueba» (prueba); NEGADO: un disparador o un nodo huérfano', () => {
    expect(C.guardias('produccion', PRODUCCION)).toEqual([]);
    expect(C.guardias('prueba', PRUEBA)).toEqual([]);
    const a = clonar(PRODUCCION); a.nodes.push({ id: 'huerfano', name: 'Huérfano', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [0, 9999], parameters: {} } as never);
    expect(C.guardias('produccion', a).join(' ')).toMatch(/único nodo sin entradas/);
    const b = clonar(PRODUCCION); b.nodes.push({ id: 'disparo', name: 'Disparo', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, position: [0, 9999], parameters: {} } as never);
    expect(C.guardias('produccion', b).join(' ')).toMatch(/nodo disparador/);
    const d = clonar(PRUEBA); (d.nodes as J[]).push({ id: 'dos', name: 'Entrada dos', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 9999], parameters: {} });
    expect(C.guardias('prueba', d).join(' ')).toMatch(/único nodo sin entradas/);
  });
  it('«Avisar al servidor»: solo `cobro_cancelado`, sin reintentos; «Enviar aviso»: sin reintentos y sin cortar el turno (NEGADO si se cambia)', () => {
    const a = clonar(PRODUCCION); const p = nodo(a, 'Avisar al servidor')['parameters'] as J;
    p['jsonBody'] = String(p['jsonBody']).replace("evento: 'cobro_cancelado'", "evento: 'otro_evento'");
    expect(C.guardias('produccion', a).join(' ')).toMatch(/único evento permitido/);
    const b = clonar(PRODUCCION); nodo(b, 'Avisar al servidor')['retryOnFail'] = true;
    expect(C.guardias('produccion', b).join(' ')).toMatch(/no puede reintentar/);
    const e = clonar(PRODUCCION); nodo(e, 'Enviar aviso')['retryOnFail'] = true; delete e.nodes.find((x: J) => x['name'] === 'Enviar aviso')!['onError'];
    expect(C.guardias('produccion', e).join(' ')).toMatch(/Enviar aviso/);
  });
});

describe('prohibición 7 y rutas de webhook', () => {
  it('ningún WhatsApp Trigger, `subscriptions` ni `subscribed_apps` en ninguna variante ni en el código fuente del flujo', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect((f.nodes as J[]).some((n) => String(n['type']).includes('whatsAppTrigger'))).toBe(false);
      expect(JSON.stringify(f)).not.toMatch(/subscriptions|subscribed_apps/i);
    }
    const propios = [join(CARPETA, 'src/lib/wl.js'), join(CARPETA, 'src/nodos/armar-mensajes.js'), join(CARPETA, 'flujo.plantilla.json'), ...readdirSync(join(FLUJOS, 'venta-digital/src/nodos')).map((x) => join(FLUJOS, 'venta-digital/src/nodos', x))];
    for (const r of propios) expect(leer(r), r).not.toMatch(/subscriptions|subscribed_apps|whatsAppTrigger/i);
  });
  it('NEGADO: agregar un WhatsApp Trigger o mencionar `subscribed_apps` viola la guardia', () => {
    const a = clonar(PRODUCCION); a.nodes.push({ id: 't', name: 'WhatsApp Trigger', type: 'n8n-nodes-base.whatsAppTrigger', typeVersion: 1, position: [0, 0], parameters: {} } as never);
    expect(C.guardias('produccion', a).join(' ')).toMatch(/WhatsApp Trigger/);
    const b = clonar(PRODUCCION); (nodo(b, 'Traer configuración')['parameters'] as J)['url'] = 'https://graph.facebook.com/v26.0/123/subscribed_apps';
    expect(C.guardias('produccion', b).join(' ')).toMatch(/subscribed_apps/);
  });
  it('las rutas de los webhooks no aparecen en ninguna nota (ni la del receptor ni la de prueba), y las notas no traen URL de webhook', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      for (const n of f.nodes as J[]) {
        const notas = String(n['notes'] ?? '');
        expect(notas, String(n['name'])).not.toContain(String((DATOS['receptor'] as J)['ruta']));
        expect(notas, String(n['name'])).not.toContain(String(DATOS['pruebaRuta']));
        expect(notas, String(n['name'])).not.toMatch(/\/webhook(-test)?\/|webhook-test/i);
      }
    }
  });
  it('NEGADO: una nota con la ruta de un webhook viola la guardia', () => {
    const f = clonar(PRODUCCION); nodo(f, 'Entrega del receptor')['notes'] = 'la ruta es https://n8n.example/webhook/abc123';
    expect(C.guardias('produccion', f).join(' ')).toMatch(/ruta de un webhook/);
  });
});

describe('lo incluido es byte a byte igual a su fuente', () => {
  const codigo = (f: Flujo, n: string): string => String((nodo(f, n)['parameters'] as J)['jsCode']);
  const fuente = (r: string): string => leer(join(FLUJOS, r)).trimEnd();
  const LIBS = ['venta-digital/src/cobro.js', 'venta-digital/src/avisos.js', 'venta-digital/src/conversacion.js', 'venta-digital/src/carrito.js', 'walisuma/src/lib/wl.js', 'walisuma/src/lib/wl-venta.js'];
  it('los módulos comunes de medios, tal cual de Flujos/src/core/medios', () => {
    const medios = join(RAIZ, 'Flujos/src/core/medios');
    expect(codigo(PRODUCCION, 'Preparar transcripción')).toBe(leer(join(medios, 'preparar-transcripcion.js')).trimEnd() + '\n');
    expect(codigo(PRODUCCION, 'Medio no aceptado')).toBe(leer(join(medios, 'medio-no-aceptado.js')).trimEnd() + '\n');
    expect(codigo(PRODUCCION, 'Preparar imagen')).toBe([leer(join(medios, 'anuncio-por-titular.js')).trimEnd(), leer(join(medios, 'preparar-imagen.js')).trimEnd()].join('\n\n') + '\n');
  });
  it('los nodos comunes neutros: librerías + _comun + el nodo de venta-digital/src/nodos, sin una edición', () => {
    const libs = LIBS.map(fuente);
    const comun = fuente('venta-digital/src/nodos/_comun.js');
    const pares: [string, string][] = [['Carga de entrada', 'carga-de-entrada'], ['Config del negocio', 'config-del-negocio'], ['Normalizar entrada', 'normalizar-entrada'], ['Puerta del turno', 'puerta-del-turno'], ['Resumen del turno', 'resumen-del-turno']];
    for (const f of [PRODUCCION, PRUEBA]) {
      for (const [n, a] of pares) expect(codigo(f, n), n).toBe([...libs, comun, fuente(`venta-digital/src/nodos/${a}.js`)].join('\n\n') + '\n');
    }
  });
  it('«Armar mensajes»: librerías + _comun + los constructores de mensajes comunes + su código', () => {
    const libs = LIBS.map(fuente);
    const esperado = [...libs, fuente('venta-digital/src/nodos/_comun.js'), fuente('comun-sin-agente/src/mensajes.js'), fuente('comun-sin-agente/src/filtro-redaccion.js'), fuente('walisuma/src/nodos/armar-mensajes.js')].join('\n\n') + '\n';
    expect(codigo(PRODUCCION, 'Armar mensajes')).toBe(esperado);
    const avisos = [...libs, fuente('venta-digital/src/nodos/_comun.js'), fuente('comun-sin-agente/src/filtro-redaccion.js'), fuente('walisuma/src/nodos/armar-avisos.js')].join('\n\n') + '\n';
    expect(codigo(PRODUCCION, 'Armar avisos')).toBe(avisos);
    for (const [n, a] of [['Decidir turno', 'decidir-turno'], ['Interpretar lectura', 'interpretar-lectura']]) expect(codigo(PRODUCCION, n), n).toBe([...libs, fuente('venta-digital/src/nodos/_comun.js'), fuente(`walisuma/src/nodos/${a}.js`)].join('\n\n') + '\n');
  });
  it('«Guardar comprobante» es el de Antonio (commit 7188637c), tal cual: huella fijada del nodo entero', () => {
    // La plantilla lleva la credencial como `@@cred:ingesta`; el armado la sustituye por el nombre del dato. Se vuelve a la forma de la plantilla antes de la huella.
    const guardar = clonar(nodo(PRODUCCION, 'Guardar comprobante'));
    ((guardar['credentials'] as J)['httpHeaderAuth'] as J)['name'] = '@@cred:ingesta';
    const huella = createHash('sha256').update(JSON.stringify(guardar)).digest('hex');
    expect(huella).toBe('c5cda520c8e24ff3258215c6fbb94a9c9b58344a3bf4000683aa71ecdf43b85e');
    // Sin el nombre de la credencial resuelto (se sustituye por el dato) el nodo es el de la plantilla de ese commit.
    const c = PRODUCCION.connections as J;
    expect(c['Guardar comprobante']).toBeUndefined();
    expect(c['¿Es audio?'].main[1].map((x: J) => x['node'])).toEqual(['Guardar comprobante', '¿Es un documento?']);
    expect((nodo(PRODUCCION, 'Guardar comprobante')['position'] as number[])[1]).toBeLessThan((nodo(PRODUCCION, '¿Es un documento?')['position'] as number[])[1]);
  });
  it('NEGADO: sacar «Guardar comprobante», colgarle una salida o ponerlo debajo de «¿Es un documento?» viola la guardia', () => {
    const a = clonar(PRODUCCION); a.nodes = (a.nodes as J[]).filter((x) => x['name'] !== 'Guardar comprobante') as never;
    expect(C.guardias('produccion', a).join(' ')).toMatch(/falta el nodo «Guardar comprobante»/);
    const b = clonar(PRODUCCION); (b.connections as J)['Guardar comprobante'] = { main: [[{ node: 'Armar mensajes', type: 'main', index: 0 }]] };
    expect(C.guardias('produccion', b).join(' ')).toMatch(/terminal/);
    const c = clonar(PRODUCCION); (nodo(c, 'Guardar comprobante')['position'] as number[])[1] = 9000;
    expect(C.guardias('produccion', c).join(' ')).toMatch(/arriba de «¿Es un documento\?»/);
  });
  it('«Reportar mensaje (entrante)» va ARRIBA de la puerta, de los medios y de «Armar mensajes»; NEGADO si se baja', () => {
    expect(C.guardias('produccion', PRODUCCION)).toEqual([]);
    const f = clonar(PRODUCCION); (nodo(f, 'Reportar mensaje (entrante)')['position'] as number[])[1] = 9000;
    expect(C.guardias('produccion', f).join(' ')).toMatch(/tiene que ir arriba de/);
  });
});

describe('versionado, no publicable y datos', () => {
  it('`--verificar` sale 0: los dos JSON versionados son lo que arma la plantilla', () => {
    const r = corrida('--verificar');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/walisuma\.json al día \(56 nodos\)/);
    expect(r.stdout).toMatch(/walisuma\.prueba\.json al día \(51 nodos\)/);
  });
  it('`--publicable` FALLA hoy, con un mensaje claro: quedan marcadores REEMPLAZAR_*, la plantilla sin aprobar y el costo de entrega sin declarar', () => {
    const r = corrida('--publicable');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NO se puede publicar todavía/);
    expect(r.stderr).toMatch(/marcador sin sustituir: REEMPLAZAR_/);
    expect(r.stderr).toMatch(/avisoPedidoEstado tiene que ser APPROVED/);
    expect(r.stderr).toMatch(/costoDeEntrega sin declarar/);
    expect(r.stderr).not.toMatch(/ESQUELETO/);
    // Los mensajes nombran marcadores, nunca valores de los datos.
    expect(r.stdout).toBe('');
  });
  it('ningún `REEMPLAZAR_` en la variante publicable: las dos variantes los traen hoy, y la guardia los detecta uno por uno (NEGADO)', () => {
    for (const f of [PRODUCCION, PRUEBA]) expect(C.guardiaDePublicacion({ flujo: f, datos: DATOS }).filter((x: string) => /marcador sin sustituir/.test(x)).length).toBeGreaterThan(5);
    // Un flujo completo y sin marcadores pasa; basta UN marcador, una plantilla sin aprobar, un costo vacío o un nodo menos para que falle.
    const flujoListo = JSON.parse(JSON.stringify(PRODUCCION).replace(/REEMPLAZAR_[A-Z0-9_]+/g, 'valor')) as Flujo;
    const ponerBase = (f: Flujo, nombre: string, valor: string): void => {
      for (const a of (((nodo(f, 'Config base')['parameters'] as J)['assignments'] as J)['assignments']) as J[]) if (a['name'] === nombre) a['value'] = valor;
    };
    ponerBase(flujoListo, 'avisoPedidoEstado', 'APPROVED');
    ponerBase(flujoListo, 'costoDeEntrega', '10');
    expect(C.guardiaDePublicacion({ flujo: flujoListo, datos: DATOS })).toEqual([]);
    const conMarcador = clonar(flujoListo); (nodo(conMarcador, 'Traer configuración')['parameters'] as J)['x'] = 'REEMPLAZAR_ALGO';
    expect(C.guardiaDePublicacion({ flujo: conMarcador, datos: DATOS }).join(' ')).toMatch(/REEMPLAZAR_ALGO/);
    const sinAprobar = clonar(flujoListo);
    ponerBase(sinAprobar, 'avisoPedidoEstado', 'PENDING');
    expect(C.guardiaDePublicacion({ flujo: sinAprobar, datos: DATOS }).join(' ')).toMatch(/APPROVED/);
    const sinCosto = clonar(flujoListo);
    ponerBase(sinCosto, 'costoDeEntrega', '');
    expect(C.guardiaDePublicacion({ flujo: sinCosto, datos: DATOS }).join(' ')).toMatch(/costoDeEntrega/);
    const sinNodo = clonar(flujoListo); sinNodo.nodes = (sinNodo.nodes as J[]).filter((x) => x['name'] !== 'Armar avisos') as never;
    expect(C.guardiaDePublicacion({ flujo: sinNodo, datos: DATOS }).join(' ')).toMatch(/faltan 1 nodos/);
  });
  it('`--publicable` rechaza argumentos de más (sale 2) y `construir.mjs` solo acepta --verificar y --publicable', () => {
    expect(corrida('--publicable', '--otro').status).toBe(2);
    expect(corrida('--escribe-todo').status).toBe(2);
  });
  it('los datos del tenant: solo marcadores, sin secretos, UUID, IPv4, rutas de usuario ni números largos; el costo de entrega va VACÍO', () => {
    const texto = leer(join(RAIZ, 'admin/scripts/datos/walisuma/walisuma.json'));
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(texto).not.toMatch(/\/home\/|\/Users\/|https?:\/\/|token|secret|api[_-]?key|AIza|EAA[A-Za-z0-9]/i);
    const d = JSON.parse(texto) as J;
    for (const v of Object.values(d['credenciales'] as J)) expect(String(v)).toMatch(/^REEMPLAZAR_/);
    for (const v of Object.values(d['receptor'] as J)) expect(String(v)).toMatch(/^REEMPLAZAR_/);
    expect((d['configBase'] as J)['costoDeEntrega']).toBe('');
    expect((d['configBase'] as J)['avisoPedidoPlantilla']).toBe('pedido_registrado');
    expect((d['configBase'] as J)['avisoPlantillaIdioma']).toBe('es');
  });
  it('NEGADO: un dato con forma inválida (credencial real, ruta real, modelo ajeno, costo ausente) no se carga', () => {
    const tmp = (mod: (x: J) => void): string => {
      const x = clonar(DATOS); mod(x);
      return JSON.stringify(x);
    };
    const probar = (mod: (x: J) => void): string => {
      const ruta = join(process.env['TMPDIR'] ?? '/tmp', `walisuma-datos-${Math.abs(Math.random() * 1e9) | 0}.json`);
      writeFileSync(ruta, tmp(mod));
      try { C.cargarDatos(ruta); return ''; } catch (e) { return String((e as Error).message); } finally { rmSync(ruta, { force: true }); }
    };
    expect(probar((x) => { (x['credenciales'] as J)['graph'] = 'Graph real'; })).toMatch(/credenciales\.graph/);
    expect(probar((x) => { (x['receptor'] as J)['ruta'] = 'ruta-real-abc'; })).toMatch(/receptor\.ruta/);
    expect(probar((x) => { (x['configBase'] as J)['modelo'] = 'gemini-2.0-flash'; })).toMatch(/configBase\.modelo/);
    expect(probar((x) => { delete (x['configBase'] as J)['costoDeEntrega']; })).toMatch(/costoDeEntrega/);
    expect(probar(() => {})).toBe('');
  });
});
