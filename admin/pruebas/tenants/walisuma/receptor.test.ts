/**
 * LA ENTRADA VERIFICADA DEL RECEPTOR en el esqueleto de Walisuma, con el n8n de mentira. Se prueba NEGANDO: una firma inválida, un repetido o un campo que no es `messages` no llegan a nada.
 */
import { describe, expect, it } from 'vitest';
import { ANA, EXTRANJERO, crear, entrega, hablar, mSticker, mTexto, valorMeta } from './mundo';

const sinRastro = (t: ReturnType<typeof hablar>): void => {
  expect(t.mensajes).toHaveLength(0);
  expect(t.avisos).toHaveLength(0);
  expect(t.llamadas.ingesta).toHaveLength(0);
  expect(t.registro.map((r) => r.nodo).filter((n) => n !== 'Verificar firma con el receptor')).toEqual([]);
};

describe('receptor: firma inválida', () => {
  it('responde 401 y no hay mensajes, avisos, reportes ni llamadas', () => {
    const m = crear({ verificador: () => ({ valido: false }) });
    const t = hablar(m, ANA, mTexto('hola'));
    expect(t.respuestasWebhook.map((r) => r.codigo)).toEqual([401]);
    sinRastro(t);
  });
  it('NEGADO: ni el sticker (que sí contestaría) pasa con firma inválida', () => {
    const m = crear({ verificador: () => ({ valido: false }) });
    sinRastro(hablar(m, ANA, mSticker()));
    expect(m.llamadas.ingesta).toHaveLength(0);
  });
});

describe('receptor: repetidos entre ejecuciones', () => {
  it('la misma entrega dos veces: la primera contesta una vez; la segunda, cero envíos y cero llamadas', () => {
    const m = crear();
    const primera = hablar(m, ANA, mSticker(), { entrega: 'entrega-fija-1' });
    expect(primera.mensajes).toHaveLength(1);
    const segunda = hablar(m, ANA, mSticker(), { entrega: 'entrega-fija-1' });
    expect(segunda.mensajes).toHaveLength(0);
    expect(segunda.llamadas.ingesta).toHaveLength(0);
    expect(segunda.registro.map((r) => r.nodo).filter((n) => n !== 'Verificar firma con el receptor')).toEqual([]);
  });
  it('el mismo mensaje de Meta con otra entrega: lo frena la ficha (ids de mensaje), cero envíos', () => {
    const m = crear();
    expect(hablar(m, ANA, mSticker(), { wamid: 'wamid.REPETIDO', entrega: 'e-a' }).mensajes).toHaveLength(1);
    const otra = hablar(m, ANA, mSticker(), { wamid: 'wamid.REPETIDO', entrega: 'e-b' });
    expect(otra.mensajes).toHaveLength(0);
  });
});

describe('receptor: solo `messages`', () => {
  it('un `field` distinto (cambio de plantilla, de calidad) no es un mensaje: cero envíos, cero llamadas a la consola', () => {
    const m = crear();
    const t = m.turno(entrega(valorMeta(mSticker(), ANA), undefined, 'message_template_status_update'));
    expect(t.mensajes).toHaveLength(0);
    expect(t.llamadas.ingesta).toHaveLength(0);
    expect(t.registro.map((r) => r.nodo)).not.toContain('Traer configuración');
  });
  it('un acuse de estado (`statuses`, sin `messages`) se descarta antes de traer la configuración', () => {
    const m = crear();
    const valor = { messaging_product: 'whatsapp', metadata: { phone_number_id: '59100000042' }, statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: ANA }] };
    const t = m.turno(entrega(valor));
    expect(t.mensajes).toHaveLength(0);
    expect(t.registro.map((r) => r.nodo)).not.toContain('Traer configuración');
  });
  it('NEGADO: el mensaje de OTRO número de negocio (phone_number_id distinto) se descarta', () => {
    const m = crear();
    const t = hablar(m, ANA, mSticker(), { phoneId: '59100000099' });
    expect(t.mensajes).toHaveLength(0);
    expect(t.registro.map((r) => r.nodo)).not.toContain('Traer configuración');
  });
});

describe('receptor: camino feliz del esqueleto', () => {
  it('un tipo que el canal no lee recibe UN texto cortés; un texto común recibe UNA respuesta de la conversación', () => {
    const m = crear();
    const t = hablar(m, ANA, mSticker());
    expect(t.mensajes).toHaveLength(1);
    expect(t.mensajes[0]?.cuerpo).toMatch(/solo puedo leer texto/);
    expect(hablar(m, ANA, mTexto('hola, ¿tienen mantas?')).mensajes).toHaveLength(1);
  });
  it('un número de otro país recibe el texto fijo UNA vez en 24 horas', () => {
    const m = crear();
    expect(hablar(m, EXTRANJERO, mTexto('hello')).mensajes).toHaveLength(1);
    expect(hablar(m, EXTRANJERO, mTexto('hello again')).mensajes).toHaveLength(0);
  });
});
