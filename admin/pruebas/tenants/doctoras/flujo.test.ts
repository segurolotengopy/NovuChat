/**
 * LAS DOCTORAS (tenants rroca-evy y rroca-emma) — EL ESQUELETO, DE PUNTA A PUNTA, SIN RED. La conversación está en `conversacion.test.ts` y `negadas.test.ts`; los medios, en `medios.test.ts`.
 *
 * Caja negra sobre los JSON VERSIONADOS (`doctoras.<tenant>.json`, con la entrada verificada del receptor, y `doctoras.<tenant>.prueba.json`, con la «Entrada de prueba») corridos con el n8n de
 * mentira: la red (verificador, consola, ingesta, Graph, Gemini) son dobles; el código de los nodos es el real. Se usa un sticker como sonda: es un tipo que este canal no lee, así que siempre
 * recibe el texto cortés fijo (sin modelo y sin presentación).
 *
 * ESTA SUITE ESCRIBE NEGANDO: la sesión es el número de origen (dos teléfonos no comparten ficha), los acuses de estado no pasan, los repetidos no se atienden dos veces, la pausa («bloqueado») no
 * envía NADA, el comercio suspendido recibe un texto neutro, una carga con `modoPrueba` adentro no activa el modo prueba, un número de otro país se descarta sin responder y un rechazo de Meta no
 * se reporta como enviado.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import { ANA, BETO, PID, PRODUCCION, PRUEBA, REC, SUSPENDIDO, crear, entrega, hablar, mTexto, textos, valorMeta } from './mundo';
import { NODOS_DEL_GUARDADO } from '../../../../Flujos/experimental/comun-sin-agente/src/guardado.mjs';

const CORTES = /solo puedo leer texto, notas de voz, fotos y archivos PDF/;
const PROHIBIDAS = /acreditad|verificad|validad|recibimos tu pago|pago (?:recibido|confirmado)/i;
const STICKER: J = { type: 'sticker', sticker: { id: 's' } };

describe('la entrada: el receptor verificado y el filtro de eventos', () => {
  it('el endpoint contesta 200 al receptor y la firma se verifica con el waba FIJO, no con lo que diga la entrega', () => {
    const w = crear();
    const llamadas: J[] = [];
    w.dobles['Verificar firma con el receptor'] = (ll) => { llamadas.push(ll.cuerpo as J); return { valido: true, deliveryId: ll.cuerpo?.['deliveryId'] }; };
    const t = hablar(w, ANA, STICKER);
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!['wabaIdEsperado']).toBe('REEMPLAZAR_WABA_ID_RROCA_EVY');
    expect(JSON.parse(String(llamadas[0]!['cuerpo'])).value.metadata.phone_number_id).toBe(PID);
  });

  it('firma inválida: 401 y NADA más (0 mensajes, 0 ingesta, 0 consola)', () => {
    const w = crear({ verificador: () => ({ valido: false }) });
    const t = hablar(w, ANA, STICKER);
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([401]);
    expect(t.mensajes).toHaveLength(0);
    expect(t.llamadas.ingesta).toHaveLength(0);
    expect(t.ejecutados.has('Traer configuración')).toBe(false);
  });

  it('una entrega repetida (mismo deliveryId) se descarta entre ejecuciones: no se atiende dos veces', () => {
    const w = crear();
    const v = valorMeta(STICKER, ANA);
    expect(w.turno(entrega(v, 'entrega-fija')).mensajes).toHaveLength(1);
    expect(w.turno(entrega(v, 'entrega-fija')).mensajes).toHaveLength(0);
  });

  it('un acuse de estado (sin `messages`) se descarta ANTES de traer la configuración: 0 mensajes, 0 ingesta', () => {
    const w = crear();
    const acuse = { messaging_product: 'whatsapp', metadata: { phone_number_id: PID }, statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: ANA }] };
    const t = w.turno(entrega(acuse));
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([200]);
    expect(t.ejecutados.has('Traer configuración')).toBe(false);
    expect(t.mensajes).toHaveLength(0);
    expect(w.llamadas.ingesta).toHaveLength(0);
  });

  it('una carga con `messages` Y `statuses` a la vez tampoco pasa', () => {
    const w = crear();
    const v = valorMeta(mTexto('hola'), ANA);
    v['statuses'] = [{ id: 'wamid.X', status: 'read' }];
    expect(w.turno(entrega(v)).ejecutados.has('Traer configuración')).toBe(false);
  });

  it('un mensaje de OTRO número de la misma WABA se descarta', () => {
    const w = crear();
    expect(hablar(w, ANA, mTexto('hola'), { phoneId: '59100000099' }).ejecutados.has('Traer configuración')).toBe(false);
  });

  it('un campo del receptor que no es `messages` (cambio de plantilla, de calidad) no se lee como un mensaje', () => {
    const w = crear();
    const e = entrega(valorMeta(mTexto('hola'), ANA));
    (e['body'] as J)['field'] = 'message_template_status_update';
    expect(w.turno(e).ejecutados.has('Traer configuración')).toBe(false);
  });

  it('el veredicto del verificador nunca se lee como un mensaje aunque traiga `messages` (el evento sale de `body.value` del receptor)', () => {
    const w = crear({ verificador: (ll) => ({ valido: true, deliveryId: ll.cuerpo?.['deliveryId'], messages: [{ from: BETO, id: 'wamid.FALSO', type: 'text', text: { body: 'hola' } }], metadata: { phone_number_id: PID } }) });
    expect(hablar(w, ANA, STICKER).mensajes.map((m) => m.a)).toEqual([ANA]);
  });

  it('reacciones, mensajes de sistema y bienvenida no son una conversación: sin respuesta', () => {
    const w = crear();
    for (const tipo of ['reaction', 'system', 'request_welcome', 'ephemeral']) expect(hablar(w, ANA, { type: tipo }).mensajes, tipo).toHaveLength(0);
  });
});

describe('la sesión es el número de origen', () => {
  it('dos teléfonos intercalados tienen cada uno su ficha; el id de Meta de uno no descarta el mismo id en el otro', () => {
    const w = crear();
    const a = hablar(w, ANA, STICKER, { wamid: 'wamid.COMPARTIDO' });
    const b = hablar(w, BETO, STICKER, { wamid: 'wamid.COMPARTIDO' });
    expect(a.mensajes.map((m) => m.a)).toEqual([ANA]);
    expect(b.mensajes.map((m) => m.a)).toEqual([BETO]);
    const fichas = (w.sd['doctoras'] ?? {}) as J;
    expect(Object.keys(fichas).sort()).toEqual([ANA, BETO]);
    expect(fichas[ANA]!['ultimosIds']).toEqual(['wamid.COMPARTIDO']);
    expect(fichas[BETO]!['ultimosIds']).toEqual(['wamid.COMPARTIDO']);
  });

  it('un mensaje repetido de Meta (mismo id, otra entrega) no se atiende dos veces', () => {
    const w = crear();
    expect(hablar(w, ANA, STICKER, { wamid: 'wamid.UNO' }).mensajes).toHaveLength(1);
    expect(hablar(w, ANA, STICKER, { wamid: 'wamid.UNO' }).mensajes).toHaveLength(0);
  });

  it('el mensaje responde al `from`, nunca a otro campo de la carga (el nombre de perfil o el `wa_id` ajeno)', () => {
    const w = crear();
    const v = valorMeta(STICKER, ANA);
    v['contacts'] = [{ profile: { name: 'Ana' }, wa_id: BETO }];
    expect(w.turno(entrega(v)).mensajes.map((e) => e.a)).toEqual([ANA]);
  });

  it('un origen que no son solo dígitos (6 a 20) se descarta sin responder', () => {
    const w = crear();
    for (const raro of ['abc', '59100000011; drop', '5910']) expect(hablar(w, raro, STICKER).mensajes, raro).toHaveLength(0);
  });

  it('un número de OTRO país (prefijo no permitido) se descarta sin responder: ni texto, ni modelo, ni medios', () => {
    const w = crear();
    const EXT = '54100000011';
    for (const msg of [mTexto('hola'), STICKER, { type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg' } }]) {
      const t = hablar(w, EXT, msg);
      expect(t.mensajes, JSON.stringify(msg)).toHaveLength(0);
      for (const n of ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio', 'Conversar con el modelo', 'Enviar a WhatsApp']) expect(t.ejecutados.has(n), n).toBe(false);
    }
    // No afecta a una persona de Bolivia.
    expect(hablar(w, ANA, STICKER).mensajes).toHaveLength(1);
  });
});

describe('la puerta del turno', () => {
  it('comercio suspendido (409 de la consola): texto neutro que no revela el motivo, y nada de medios ni de modelo', () => {
    const w = crear({ panel: { statusCode: 409, body: { estado: 'suspendido' } } });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(textos(t)).toEqual([SUSPENDIDO]);
    expect(t.mensajes[0]!.cuerpo).not.toMatch(/deuda|pago|mora|debe/i);
    expect(t.ejecutados.has('Obtener URL del medio (general)')).toBe(false);
  });

  it('uso extendido en estado «operador»: el aviso fijo de la consola, un solo mensaje', () => {
    const w = crear({ ingesta: { ok: true, atencion: { estado: 'operador', respuestasEnVentana: 55 } } });
    const t = hablar(w, ANA, mTexto('hola'));
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]!.cuerpo).toMatch(/una persona del equipo va a continuar/);
  });

  it('PAUSA («bloqueado»): cero envío aunque el entrante sí se cuente, y no es una entrega fallida', () => {
    const w = crear({ ingesta: { ok: true, atencion: { estado: 'bloqueado', respuestasEnVentana: 30 } }, envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(w, ANA, mTexto('hola'), { toleraFallo: true });
    expect(t.fallo).toBeNull();
    expect(t.mensajes).toHaveLength(0);
    expect(w.llamadas.ingesta.some((c) => c['direccion'] === 'entrante')).toBe(true);
    expect(w.llamadas.ingesta.some((c) => c['direccion'] === 'saliente')).toBe(false);
  });

  it('en pausa no se baja ni se lee ningún medio (no se gasta Gemini en quien atiende una persona)', () => {
    const w = crear({ ingesta: { ok: true, atencion: { estado: 'bloqueado', respuestasEnVentana: 30 } } });
    const t = hablar(w, ANA, { type: 'audio', audio: { id: 'media-aud', mime_type: 'audio/ogg' } });
    for (const n of ['Obtener URL del medio (general)', 'Descargar medio', 'Transcribir audio']) expect(t.ejecutados.has(n), n).toBe(false);
  });
});

describe('lo que el canal no lee, y sin prometer nada', () => {
  it('el texto cortés fijo está en párrafos separados por una línea en blanco, no promete nada ni afirma un pago', () => {
    const w = crear();
    const tx = hablar(w, ANA, STICKER).mensajes[0]!.cuerpo;
    expect(tx).toMatch(CORTES);
    expect(tx.split('\n\n')).toHaveLength(2);
    expect(tx).not.toMatch(/\n{3,}/);
    expect(tx).not.toMatch(PROHIBIDAS);
    expect(tx).not.toMatch(/te aviso|te llamo|te escribir|lo consulto|te avisar/i);
    expect(tx.toLowerCase()).not.toMatch(/no soy (un |una )?(bot|ia|asistente|robot)|soy (una )?persona|humano/);
  });

  it('con Meta rechazando el envío y su respaldo, la ejecución falla visible (I-ENTREGA) y NO se reporta como enviado', () => {
    const w = crear({ envio: { 'Enviar a WhatsApp': 'error', 'Enviar respaldo': 'error' } });
    const t = hablar(w, ANA, STICKER, { toleraFallo: true });
    expect(t.fallo?.nodo).toBe('Resumen del turno');
    expect(t.ejecutados.has('Reportar mensaje (saliente)')).toBe(false);
  });

  it('si el envío principal falla y el respaldo en texto sale, la persona recibe el mensaje y se reporta con el id real de Meta', () => {
    const w = crear({ envio: { 'Enviar a WhatsApp': 'error' } });
    const t = hablar(w, ANA, STICKER);
    expect(t.fallo).toBeNull();
    expect(t.mensajes.filter((m) => m.ok)).toHaveLength(1);
    expect(t.llamadas.ingesta.some((c) => c['direccion'] === 'saliente' && /^wamid\.OUT/.test(String(c['idMeta'])))).toBe(true);
  });

  it('los tipos que no son conversación (sticker, contacto, pedido, ubicación) reciben UN mensaje, el cortés', () => {
    const w = crear();
    for (const msg of [STICKER, { type: 'contacts', contacts: [{}] }, { type: 'order', order: {} }, { type: 'location', location: {} }]) {
      const t = hablar(w, ANA, msg);
      expect(t.mensajes.length, JSON.stringify(msg)).toBe(1);
      expect(t.mensajes[0]!.cuerpo).toMatch(CORTES);
    }
  });
});

describe('el orden del lienzo: el entrante se reporta ANTES que la respuesta', () => {
  it('«Reportar mensaje (entrante)» corre antes que cualquier reporte saliente (y está arriba en el lienzo)', () => {
    const w = crear();
    const t = hablar(w, ANA, STICKER);
    expect(t.orden.indexOf('Reportar mensaje (entrante)')).toBeGreaterThan(-1);
    expect(t.orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(t.orden.indexOf('Reportar mensaje (saliente)'));
    const y = (n: string): number => PRODUCCION.nodes.find((x) => x.name === n)!.position![1]!;
    for (const abajo of ['Puerta del turno', '¿Bajar medio?', 'Decidir turno', 'Armar mensajes']) expect(y('Reportar mensaje (entrante)')).toBeLessThan(y(abajo));
  });

  it('«Resumen del turno» corre al final, después de los envíos', () => {
    const w = crear();
    const t = hablar(w, ANA, STICKER);
    // Lo último de la rama que responde; DESPUÉS solo corre la rama común del GUARDADO de medios, que va debajo de todo a propósito.
    const sinGuardado = t.orden.filter((n) => !NODOS_DEL_GUARDADO.includes(n));
    expect(sinGuardado[sinGuardado.length - 1]).toBe('Resumen del turno');
    expect(t.orden.slice(sinGuardado.length).every((n) => NODOS_DEL_GUARDADO.includes(n))).toBe(true);
  });
});

describe('el modo prueba y el JSON de prueba', () => {
  const prueba = (op: J = {}): J => ({ headers: {}, body: { modoPrueba: true, telefonoDePrueba: ANA, ...op, ...valorMeta(STICKER, ANA) } });

  it('una carga de WhatsApp con `modoPrueba` adentro NO activa el modo prueba en producción (ni existe «Entrada de prueba»)', () => {
    const w = crear();
    const v = valorMeta(STICKER, ANA);
    (v['messages'] as J[])[0]!['modoPrueba'] = true;
    v['modoPrueba'] = true;
    const t = w.turno(entrega(v));
    expect(t.mensajes).toHaveLength(1);
    expect(t.porNodo['Config del negocio']![0]!['modoPrueba']).toBe(false);
    expect(w.llamadas.ingesta.some((c) => c['direccion'] === 'saliente')).toBe(true);
  });

  it('«Entrada de prueba» con enviarDeVerdad falso: el mensaje NO sale a Graph, no se reporta y el resumen lo devuelve al teléfono de prueba', () => {
    const w = crear({ flujo: PRUEBA });
    const t = w.turno(prueba({ enviarDeVerdad: false }));
    expect(t.fallo).toBeNull();
    expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
    expect(w.llamadas.ingesta).toHaveLength(0);
    const r = t.resumen as J;
    expect(r['modoPrueba']).toBe(true);
    expect(r['mensajes']).toHaveLength(1);
    expect(r['mensajes'][0].texto).toMatch(CORTES);
    expect(r['mensajes'][0].payload.to).toBe(ANA);
  });

  it('el modo prueba NIEGA POR DEFECTO: sin `telefonosDePrueba` (vacío o con el marcador) no sale nada, ni al teléfono pedido', () => {
    for (const lista of ['', 'REEMPLAZAR_TELEFONOS_DE_PRUEBA']) {
      const w = crear({ flujo: PRUEBA, telefonosDePrueba: lista });
      const t = w.turno(prueba({ enviarDeVerdad: true }));
      expect(t.fallo).toBeNull();
      expect(t.porNodo['Config del negocio']![0]!['telefonoDePrueba']).toBe('');
      expect(t.porNodo['Config del negocio']![0]!['enviarDeVerdad']).toBe(false);
      expect(t.ejecutados.has('Enviar a WhatsApp')).toBe(false);
      expect(w.llamadas.ingesta).toHaveLength(0);
      expect((t.resumen as J)['mensajes']).toHaveLength(0);
    }
  });

  it('con la lista restrictiva y un teléfono no permitido, `resumen.mensajes` dice 0; con el teléfono en la lista, 1', () => {
    const w = crear({ flujo: PRUEBA, telefonosDePrueba: REC });
    expect((w.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: ANA })).resumen as J)['mensajes']).toHaveLength(0);
    const w2 = crear({ flujo: PRUEBA, telefonosDePrueba: ANA });
    expect((w2.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: ANA })).resumen as J)['mensajes']).toHaveLength(1);
  });

  it('en modo prueba el destino es solo el teléfono de prueba', () => {
    const w = crear({ flujo: PRUEBA });
    expect((w.turno(prueba({ enviarDeVerdad: false, telefonoDePrueba: BETO })).resumen as J)['mensajes'][0].payload.to).toBe(BETO);
  });
});
