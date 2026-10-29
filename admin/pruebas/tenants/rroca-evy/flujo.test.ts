/**
 * EL FLUJO NUEVO DE EVY — la ruta feliz y el núcleo común: entrada verificada del receptor, sesión por `messages[0].from`, filtro de eventos, conversación libre con memoria de 15 entradas (48 h),
 * conteo (reporta entrante y saliente), uso extendido, comercio no operativo, topología y tamaño. Corre los JSON VERSIONADOS con el n8n de mentira.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, BETO, CARPETA, EXTRANJERO, PID, PRODUCCION, PRUEBA, REC, SUSPENDIDO, conPreferencia, crear, entrega, hablar, mTexto, panelOk, textos, valorMeta, tel } from './mundo';

describe('topología y tamaño', () => {
  it('producción 44 nodos y prueba 39 (36 y 31 más los 8 del guardado de medios), con el tope de 44', () => {
    expect(PRODUCCION.nodes.length).toBe(44);
    expect(PRUEBA.nodes.length).toBe(39);
  });
  it('sin agente, memoria ni modelo de chat de n8n, y sin WhatsApp Trigger', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f.nodes.some((n) => /langchain\.(agent|memory|lmChat|chain)/i.test(n.type))).toBe(false);
      expect(f.nodes.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')).toBe(false);
      expect(JSON.stringify(f)).not.toMatch(/subscriptions|subscribed_apps/);
    }
  });
});

describe('la conversación libre', () => {
  it('todo mensaje va al modelo: sin saludo fijo, sin menú, sin botones (salvo la recepción)', () => {
    const m = crear({ modeloDice: '¡Hola! Soy el asistente virtual. ¿Cómo te llamas?' });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.mensajes.length).toBe(1);
    expect(t.mensajes[0]!.tipo).toBe('text');
    expect(textos(t)[0]).toContain('asistente virtual');
    expect(t.llamadas.ingesta.length).toBe(2);   // entrante + saliente
  });
  it('la memoria: el segundo turno lleva el primero, hasta 15 entradas, y vence a las 48 h', () => {
    let visto: J[] = [];
    const m = crear({ modeloDice: (ll) => { visto = (ll.cuerpo?.['contents'] as J[]) ?? []; return 'Entendido, cuéntame más.'; } });
    hablar(m, ANA, mTexto('quiero saber de la valoración'));
    hablar(m, ANA, mTexto('me interesa el contorno'));
    const partes = visto.flatMap((c) => (c['parts'] as J[]).map((p) => String(p['text'])));
    expect(partes.join('\n')).toContain('quiero saber de la valoración');
    expect(partes.join('\n')).toContain('Entendido, cuéntame más.');
    // 20 turnos: nunca más de 15 entradas previas + el turno actual
    for (let i = 0; i < 20; i++) hablar(m, ANA, mTexto(`mensaje ${i}`));
    const previas = visto.flatMap((c) => (c['parts'] as J[]).map((p) => String(p['text'])));
    expect(previas.filter((p) => !p.startsWith('Mensaje')).length).toBeLessThanOrEqual(16);
    // 49 horas después, la memoria se olvidó
    m.avanzar(49 * 60);
    hablar(m, ANA, mTexto('hola otra vez'));
    expect(JSON.stringify(visto)).not.toContain('mensaje 19');
  });
  it('la sesión es el número de origen: dos clientes no comparten memoria', () => {
    let visto = '';
    const m = crear({ modeloDice: (ll) => { visto = JSON.stringify(ll.cuerpo); return 'ok, dime'; } });
    hablar(m, ANA, mTexto('mi secreto de Ana'));
    hablar(m, BETO, mTexto('hola soy Beto'));
    expect(visto).not.toContain('secreto de Ana');
  });
  it('el prompt que ve el modelo lleva la dirección de la Consola y no deja marcadores sin resolver', () => {
    let sistema = '';
    const m = crear({ modeloDice: (ll) => { sistema = String(((ll.cuerpo?.['systemInstruction'] as J)['parts'] as J[])[0]!['text']); return 'ok'; } });
    hablar(m, ANA, mTexto('hola'));
    expect(sistema).toContain('Piraí');
    expect(sistema).not.toMatch(/\{\{/);
    expect(sistema).toContain('Radiesse');
  });
});

describe('el núcleo común', () => {
  it('la entrega del receptor se verifica y un repetido entre ejecuciones se descarta', () => {
    const m = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    const e = entrega(v, 'entrega-fija');
    expect(m.turno(e).mensajes.length).toBe(1);
    expect(m.turno(e).mensajes.length).toBe(0);
  });
  it('una firma inválida corta con 401: cero mensajes y cero llamadas al modelo', () => {
    const m = crear({ verificador: () => ({ valido: false }) });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.mensajes.length).toBe(0);
    expect(t.respuestasWebhook.some((r) => r.codigo === 401)).toBe(true);
    expect(t.registro.some((r) => r.nodo === 'Conversar con el modelo')).toBe(false);
  });
  it('los acuses de estado y los mensajes de otro número se descartan', () => {
    const m = crear();
    const estado = { messaging_product: 'whatsapp', metadata: { phone_number_id: PID }, statuses: [{ id: 'x', status: 'read' }] };
    expect(m.turno(entrega(estado)).mensajes.length).toBe(0);
    expect(hablar(m, ANA, mTexto('hola'), { phoneId: tel(77) }).mensajes.length).toBe(0);
  });
  it('comercio suspendido: texto neutro y NINGUNA llamada al modelo', () => {
    const m = crear({ panel: { statusCode: 409, body: { mensajeCortesia: SUSPENDIDO } } });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(textos(t)).toEqual([SUSPENDIDO]);
    expect(t.registro.some((r) => r.nodo === 'Conversar con el modelo')).toBe(false);
  });
  it('uso extendido: operador responde su aviso fijo y bloqueado no responde nada; ninguno llama al modelo', () => {
    const op = crear({ ingesta: { atencion: { estado: 'operador', mensajeFijo: 'Una persona del equipo continúa.', respuestasEnVentana: 40 } } });
    const t1 = hablar(op, ANA, mTexto('hola'));
    expect(textos(t1)[0]).toMatch(/botón/);
    expect(textos(t1)[0]).not.toMatch(/persona del equipo/i);
    expect(t1.mensajes[0]!.tipo).toBe('interactive');
    const bl = crear({ ingesta: { atencion: { estado: 'bloqueado', respuestasEnVentana: 60 } } });
    const t2 = hablar(bl, ANA, mTexto('hola'));
    expect(t2.mensajes.length).toBe(0);
    for (const t of [t1, t2]) expect(t.registro.some((r) => r.nodo === 'Conversar con el modelo')).toBe(false);
  });
  it('la consola de OTRO tenant se ignora (multi-tenant estricto): rige el respaldo y no se usa su dirección', () => {
    let sistema = '';
    const otra = panelOk(); (otra.body as J)['tenantId'] = 'rroca-emma'; ((otra.body as J)['datosDelNegocio'] as J)['direccion'] = 'Calle de la otra doctora 1';
    const m = crear({ panel: otra, modeloDice: (ll) => { sistema = String(((ll.cuerpo?.['systemInstruction'] as J)['parts'] as J[])[0]!['text']); return 'ok'; } });
    hablar(m, ANA, mTexto('hola'));
    expect(sistema).not.toContain('otra doctora');
    expect(sistema).toContain('Piraí');
  });
  it('un número de otro país no recibe respuesta, no llama al modelo y no se reporta a la ingesta', () => {
    const m = crear();
    const t = hablar(m, EXTRANJERO, mTexto('hola'));
    expect(t.mensajes.length).toBe(0);
    expect(t.llamadas.ingesta.length).toBe(0);
    expect(t.registro.some((r) => r.nodo === 'Conversar con el modelo')).toBe(false);
    expect(JSON.stringify(m.sd)).not.toContain(EXTRANJERO);
  });
  it('la etapa de prueba tiene UNA fuente: «Config del negocio» calcula `fueraDePrueba` y la leen la puerta y el reporte del entrante', () => {
    const t = hablar(crear({ base: { etapaPrueba: 'si', telefonosDePrueba: ANA } }), BETO, mTexto('hola'));
    expect(t.porNodo['Config del negocio']![0]!['fueraDePrueba']).toBe(true);
    expect(t.porNodo['Puerta del turno']![0]!['ruta']).toBe('fuera_de_prueba');
    expect(t.llamadas.ingesta.length).toBe(0);
    const dentro = hablar(crear({ base: { etapaPrueba: 'si', telefonosDePrueba: ANA } }), ANA, mTexto('hola'));
    expect(dentro.porNodo['Config del negocio']![0]!['fueraDePrueba']).toBe(false);
    expect(dentro.mensajes.length).toBe(1);
  });
  it('el reporte saliente se hace una vez por mensaje al cliente', () => {
    const m = crear();
    const t = hablar(m, ANA, mTexto('hola'));
    const sal = t.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente');
    expect(sal.length).toBe(1);
    expect(sal[0]!['telefono']).toBe(ANA);
  });
  it('la recepción no tiene a quién pasar: escribe desde su propio número y no recibe botón', () => {
    const m = crear({ modeloDice: '[DERIVAR_RECEPCION]' });
    const t = hablar(m, REC, mTexto('quiero agendar'));
    expect(t.mensajes[0]!.tipo).toBe('text');
  });
});

describe('saludo neutro (decisión de Andres, 24/10/2026): la campaña no se menciona hasta que el flujo reconozca su texto de entrada', () => {
  it('ni el prompt, ni el código, ni los textos fijos, ni los dos JSON dicen «campaña»; el saludo dice «Hoy tu valoración…»', () => {
    const archivos = ['prompts/evy.md', 'src/lib/ev.js', 'flujo.plantilla.json', 'rroca-evy.json', 'rroca-evy.prueba.json', ...readdirSync(join(CARPETA, 'src/nodos')).map((f) => `src/nodos/${f}`)];
    for (const a of archivos) expect(readFileSync(join(CARPETA, a), 'utf8'), a).not.toMatch(/campa[ñn]a/i);
    // AJUSTE (observaciones de Rubén, 28/10/2026): sin «hoy bonificado» y con «sin pagar nada para agendar».
    expect(readFileSync(join(CARPETA, 'prompts/evy.md'), 'utf8')).toContain('Hoy tu valoración con la Dra. Evy es **100% gratuita y sin compromiso**, sin pagar nada para agendar (su costo habitual es de 250 Bs)');
  });
});

describe('el texto prellenado del anuncio en el primer contacto', () => {
  const saludo = '¡Hola! 👋 Soy el asistente virtual de la Dra. Evy. Tu valoración es 100% gratuita y sin compromiso. ¿Cómo te llamas y qué te gustaría mejorar?';
  it('NO cierra de golpe (ni botón ni aviso a recepción): el saludo pide nombre y deseo', () => {
    const t = hablar(crear({ modeloDice: saludo }), ANA, mTexto('Hola Dra. Evy, vi su anuncio de armonización facial y quiero agendar mi valoración gratuita 🙌'));
    expect(t.mensajes.every((e) => e.tipo !== 'interactive')).toBe(true);
    expect(t.avisos.length).toBe(0);
    expect(textos(t).join(' ')).toContain('¿Cómo te llamas');
  });
  it('con el nombre en el mensaje («Soy Rosa. Quiero agendar») sí cierra, y con conversación previa («Ok, quiero agendar») también', () => {
    // AJUSTE (28/10/2026): sin día ni horario en el pedido, el código pregunta primero y la respuesta cierra (`conPreferencia`).
    const r = crear({ modeloDice: saludo });
    expect(conPreferencia(r, ANA, hablar(r, ANA, mTexto('Soy Rosa. Quiero agendar mi valoración'))).mensajes.some((e) => e.tipo === 'interactive')).toBe(true);
    const m = crear({ modeloDice: saludo });
    hablar(m, ANA, mTexto('hola'));
    expect(conPreferencia(m, ANA, hablar(m, ANA, mTexto('Ok, quiero agendar'))).mensajes.some((e) => e.tipo === 'interactive')).toBe(true);
  });
});
