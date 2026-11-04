/**
 * REDIRECCION DE Q'TACO (numero anterior): flujo minimo, sin IA ni medios. Se corre el JSON VERSIONADO con el n8n de mentira.
 * COSTO EN MENSAJES: 1 por conversacion (ventana de 24 h) de un cliente que escribe al numero viejo; 0 en todo lo demas.
 * La suite escribe NEGANDO: otra WABA, repetido, acuse, eco, segundo mensaje de la ventana, envio sin id.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { entornoDelEmulador } from './core/entorno-del-hijo.ts';
import { describe, expect, it } from 'vitest';
import { type Flujo, type J } from './lib/flujo';
import { crearMundo, type Doble } from './lib/n8n-de-mentira';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/clientes/qtaco-redireccion');
const cargar = (f: string): Flujo => JSON.parse(readFileSync(join(CARPETA, f), 'utf8')) as Flujo;
const PLAN_A = cargar('qtaco-redireccion.qtaco.json');
const PLAN_B = cargar('qtaco-redireccion.qtaco-ruta-nueva.json');
const PHONE_ID = '100000000000042';
const AHORA = Date.UTC(2026, 10, 4, 14);
const CLIENTE = '59100000011';
const AVISO = "¡Hola! Q'Taco estrenó su nuevo WhatsApp. Escríbenos desde ahora al +591 78933727 👉 https://wa.me/" + "591" + "78933727 y te atendemos igual que siempre. ¡Gracias por tu preferencia!";

type Opc = { valida?: boolean; envio?: 'acepta' | 'sin_id' };
function doblesDe(o: Opc = {}): Record<string, Doble> {
  const dobles: Record<string, Doble> = {
    'Verificar firma con el receptor': (ll) => ({ valido: o.valida !== false, deliveryId: ll.cuerpo?.['deliveryId'] }),
    'Enviar aviso': (ll) => (o.envio === 'sin_id' ? { messaging_product: 'whatsapp', messages: [] } : { messaging_product: 'whatsapp', messages: [{ id: `wamid.A${ll.n}` }] }),
  };
  return dobles;
}
// `Config del negocio` es un Set: se le pone el phone_number_id real de la prueba en una copia del flujo.
function conPhone(flujo: Flujo, phone: string): Flujo {
  const c = JSON.parse(JSON.stringify(flujo)) as Flujo;
  const set = (c.nodes as J[]).find((n) => n['name'] === 'Config del negocio')!;
  for (const a of set['parameters'].assignments.assignments as J[]) if (a['name'] === 'phoneNumberIdEsperado') a['value'] = phone;
  return c;
}
let n = 0;
function entrega(msgs: J[], meta: J = { display_phone_number: '59100000001', phone_number_id: PHONE_ID }, extra: J = {}): J {
  return {
    headers: { 'x-aab1-signature': 'v1=abc', 'x-aab1-timestamp': '1', 'x-aab1-delivery-id': `e-${++n}`, 'x-aab1-attempt': '1' },
    body: { field: 'messages', value: { messaging_product: 'whatsapp', metadata: meta, ...extra, ...(msgs.length ? { messages: msgs } : {}) } },
  };
}
const msg = (from: string, tipo = 'text'): J => ({ from, id: `wamid.${++n}`, timestamp: '1', type: tipo, text: { body: 'hola' } });
const nuevo = (o?: Opc) => crearMundo({ flujo: conPhone(PLAN_A, PHONE_ID), dobles: doblesDe(o), ahoraMs: AHORA, roles: { avisos: 'Enviar aviso' } });

describe('redireccion de Q\'Taco', () => {
  it('un cliente que escribe recibe UN aviso con el texto exacto, y el 200 sale antes', () => {
    const w = nuevo();
    const r = w.turno(entrega([msg(CLIENTE)]));
    expect(r.respuestasWebhook.map((x) => x.codigo)).toEqual([200]);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]!.a).toBe(CLIENTE);
    expect(r.avisos[0]!.cuerpo).toBe(AVISO);
    expect(r.orden.indexOf('Aceptar (200)')).toBeLessThan(r.orden.indexOf('Enviar aviso'));
  });
  it('cualquier tipo de mensaje (imagen, audio, boton) dispara el aviso; sistema y reaccion no', () => {
    for (const tipo of ['image', 'audio', 'interactive', 'order', 'document', 'location']) {
      expect(nuevo().turno(entrega([msg(CLIENTE, tipo)])).avisos).toHaveLength(1);
    }
    for (const tipo of ['system', 'reaction']) expect(nuevo().turno(entrega([msg(CLIENTE, tipo)])).avisos).toHaveLength(0);
  });
  it('un solo aviso por conversacion: el segundo mensaje dentro de 24 h no responde; pasada la ventana, si', () => {
    const w = nuevo();
    expect(w.turno(entrega([msg(CLIENTE)])).avisos).toHaveLength(1);
    expect(w.turno(entrega([msg(CLIENTE)]), { avanzarMin: 60 }).avisos).toHaveLength(0);
    expect(w.turno(entrega([msg(CLIENTE)]), { avanzarMin: 22 * 60 }).avisos).toHaveLength(0);
    expect(w.turno(entrega([msg(CLIENTE)]), { avanzarMin: 120 }).avisos).toHaveLength(1);
  });
  it('dos mensajes del mismo cliente en la misma entrega: un aviso; dos clientes: uno cada uno', () => {
    expect(nuevo().turno(entrega([msg(CLIENTE), msg(CLIENTE)])).avisos).toHaveLength(1);
    expect(nuevo().turno(entrega([msg(CLIENTE), msg('59100000012')])).avisos).toHaveLength(2);
  });
  it('NEGANDO: evento de otra WABA (el verificador dice no) -> 401, nunca 200, 0 avisos', () => {
    const w = nuevo({ valida: false });
    const r = w.turno(entrega([msg(CLIENTE)]));
    expect(r.respuestasWebhook.map((x) => x.codigo)).toEqual([401]);
    expect(r.avisos).toHaveLength(0);
    expect(r.ejecutados.has('Decidir aviso')).toBe(false);
  });
  it('NEGANDO: el verificador nunca recibe otro wabaIdEsperado que el fijo del flujo', () => {
    const v = (PLAN_A.nodes as J[]).find((x) => x['name'] === 'Verificar firma con el receptor')!;
    expect(v['onError']).toBeUndefined();
    expect(v['parameters'].jsonBody).toContain('wabaIdEsperado: "REEMPLAZAR_WABA_ID_QTACO"');
  });
  it('NEGANDO: un numero de otra linea de la misma WABA no recibe aviso', () => {
    const r = nuevo().turno(entrega([msg(CLIENTE)], { display_phone_number: '59100000009', phone_number_id: '999' }));
    expect(r.respuestasWebhook.map((x) => x.codigo)).toEqual([200]);
    expect(r.avisos).toHaveLength(0);
  });
  it('NEGANDO: sin phone_number_id configurado (marcador) no se avisa a nadie', () => {
    const w = crearMundo({ flujo: PLAN_A, dobles: doblesDe(), ahoraMs: AHORA, roles: { avisos: 'Enviar aviso' } });
    expect(w.turno(entrega([msg(CLIENTE)])).avisos).toHaveLength(0);
  });
  it('NEGANDO: un acuse de estado (sin messages) no responde', () => {
    const r = nuevo().turno(entrega([], undefined, { statuses: [{ id: 'wamid.x', status: 'delivered', recipient_id: CLIENTE }] }));
    expect(r.avisos).toHaveLength(0);
  });
  it('NEGANDO: un campo que no es messages (plantilla, calidad) no responde', () => {
    const e = entrega([msg(CLIENTE)]);
    (e['body'] as J)['field'] = 'message_template_status_update';
    expect(nuevo().turno(e).avisos).toHaveLength(0);
  });
  it('NEGANDO: no responde a su propio eco (from = el numero de la linea)', () => {
    expect(nuevo().turno(entrega([msg('59100000001')])).avisos).toHaveLength(0);
    expect(nuevo().turno(entrega([msg(PHONE_ID)])).avisos).toHaveLength(0);
  });
  it('NEGANDO: un repetido (misma entrega reintentada) no responde dos veces', () => {
    const w = nuevo();
    const e = entrega([msg(CLIENTE)]);
    expect(w.turno(e).avisos).toHaveLength(1);
    const otra = w.turno(e, { avanzarMin: 0 });
    expect(otra.avisos).toHaveLength(0);
  });
  it('NEGANDO: si Meta no devuelve id, la ejecucion falla y el cliente NO queda marcado (el proximo mensaje reintenta)', () => {
    const w = nuevo({ envio: 'sin_id' });
    const r = w.turno(entrega([msg(CLIENTE)]), { tolerarFallo: true });
    expect(r.fallo?.nodo).toBe('Marcar avisado');
    expect(w.sd['avisadosRedireccion']).toEqual({});
    w.dobles['Enviar aviso'] = () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ok' }] });
    expect(w.turno(entrega([msg(CLIENTE)])).avisos).toHaveLength(1);
  });
  it('estructura: 11 nodos, sin IA ni medios, un solo webhook, ruta y nombre parametrizables (plan A y plan B)', () => {
    for (const f of [PLAN_A, PLAN_B]) {
      expect(f.nodes).toHaveLength(11);
      expect((f.nodes as J[]).filter((x) => /langchain|gemini|whatsApp/i.test(String(x['type'])))).toHaveLength(0);
      expect((f.nodes as J[]).filter((x) => x['type'] === 'n8n-nodes-base.webhook')).toHaveLength(1);
    }
    const ruta = (f: Flujo) => (f.nodes as J[]).find((x) => x['name'] === 'Entrega del receptor')!['parameters'].path;
    expect(ruta(PLAN_A)).toBe('REEMPLAZAR_RUTA_RECEPTOR_QTACO');
    expect(ruta(PLAN_B)).toBe('REEMPLAZAR_RUTA_RECEPTOR_QTACO_REDIRECCION');
    expect(PLAN_A.name).toBe("NovuChat — Venta mínima (v0) — Q'Taco");
    expect(PLAN_B.name).not.toBe(PLAN_A.name);
    const cred = (PLAN_A.nodes as J[]).find((x) => x['name'] === 'Enviar aviso')!['credentials'];
    expect(cred.httpHeaderAuth.name).toBe("Graph WhatsApp Q'Taco (Bearer)");
    expect(cred.httpHeaderAuth.id).toBe('');
  });
  it('nunca promete algo sin respaldo: el unico texto es el aviso con el numero nuevo', () => {
    expect(AVISO).not.toMatch(/te (aviso|llamamos|escribir[aá]n)|lo consulto/i);
  });
  it('construir.mjs --verificar reproduce los JSON versionados', () => {
    const r = spawnSync(process.execPath, [join(CARPETA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stderr).toBe(0);
  });
});
