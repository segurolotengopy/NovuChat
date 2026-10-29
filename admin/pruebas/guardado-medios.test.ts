/**
 * EL GUARDADO DE MEDIOS, CORRIENDO (contrato M1↔M2 del 29/10/2026, §1, §2 y §4), contra un DOBLE del servidor `guardarMedio` que responde
 * lo que dice el contrato (no el código de M1). Se corre el flujo VERSIONADO de Evy entero en el n8n de mentira, más un recorrido por cada
 * flujo cubierto para ver que la rama no le cambia a nadie lo que recibe el cliente.
 *
 *   - cada respuesta del §2: las de silencio no avisan; 413, 415, 429 y 502 avisan a la recepción (ventana abierta, uno por día, sin datos del paciente);
 *   - docx y xlsx van por ANOTAR, sin pedir la URL ni bajar un byte;
 *   - `guardado_apagado` (la bandera por defecto) es silencio total;
 *   - una falla del guardado (red caída, Meta caída, servidor caído, aviso rechazado) NUNCA impide que el asistente responda, y la rama corre
 *     DESPUÉS de la respuesta;
 *   - mensajes por conversación: 0 agregados al cliente; +1 a la recepción solo cuando falla el guardado, a lo más uno por día.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { doblesDelGuardado, type OpcionesDelGuardado, type RespuestaDelServidor } from './lib/doble-guardado';
import type { Doble } from './lib/n8n-de-mentira';
import type { Flujo, J } from './lib/flujo';
import { ANA, PID, PRUEBA, REC, crear, hablar, mAudio, mDocumento, mImagen, mTexto, textos } from './tenants/rroca-evy/mundo';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const AVISO = (motivo: string): string => `No se pudo guardar un archivo de una conversación (${motivo}). Revísala en la Consola.`;

function mundo(o: OpcionesDelGuardado = {}, flujo?: Flujo) {
  const mu = crear(flujo ? { flujo } : {});
  const g = doblesDelGuardado(o);
  Object.assign(mu.dobles, g.dobles);
  return { mu, g };
}
/** La recepción escribe al número: abre su ventana de 24 h (lo anota «Preparar guardado»). */
const abrirVentana = (mu: ReturnType<typeof mundo>['mu']): void => { hablar(mu, REC, mTexto('hola, soy recepción'), { toleraFallo: true }); };
const r = (statusCode: number, body: J | string): RespuestaDelServidor => ({ statusCode, body });

describe('el pedido a guardarMedio: cabeceras, cuerpo y credenciales (§1)', () => {
  it('una imagen: pide la URL a Meta, la baja y la manda con teléfono, id del MENSAJE, tipo y el número del negocio', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'tenants/x/medios/2026-10-05/abc.jpg', repetido: false }) });
    hablar(mu, ANA, mImagen(), { wamid: 'wamid.IMG1' });
    expect(g.llamadas.obtener).toHaveLength(1);
    expect(g.llamadas.obtener[0]!.url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.\d\/media-img$/);
    expect(g.llamadas.descargar).toHaveLength(1);
    expect(g.llamadas.descargar[0]!.url).toBe('https://lookaside.fbsbx.com/whatsapp_business/attachments/guardado-1');
    expect(g.llamadas.anotar).toHaveLength(0);
    expect(g.llamadas.servidor).toHaveLength(1);
    const ll = g.llamadas.servidor[0]!;
    expect(ll.nodo).toBe('Guardar medio');
    expect(ll.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio');
    expect(ll.encabezados).toEqual({ 'X-NovuChat-Numero': PID, 'X-NovuChat-Telefono': ANA, 'X-NovuChat-IdMeta': 'wamid.IMG1', 'X-NovuChat-Tipo': 'image' });
    expect(ll.parametros['contentType']).toBe('binaryData');
    expect(ll.parametros['inputDataFieldName']).toBe('data');
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it('una nota de voz va como `audio`, y un PDF como `document` (se bajan los dos)', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    hablar(mu, ANA, mAudio(), { wamid: 'wamid.AUD1' });
    hablar(mu, ANA, mDocumento(), { wamid: 'wamid.PDF1' });
    expect(g.llamadas.servidor.map((x) => [x.nodo, x.encabezados['X-NovuChat-Tipo'], x.encabezados['X-NovuChat-IdMeta']])).toEqual([
      ['Guardar medio', 'audio', 'wamid.AUD1'], ['Guardar medio', 'document', 'wamid.PDF1'],
    ]);
    expect(g.llamadas.descargar).toHaveLength(2);
  });
  it.each([['docx', DOCX], ['xlsx', XLSX]])('un %s se ANOTA: cuerpo vacío, `X-NovuChat-Anotar: 1` y el mime de Meta, sin pedir la URL ni bajar un byte', (_, mime) => {
    const { mu, g } = mundo({ respuesta: r(200, { anotado: true }) });
    hablar(mu, ANA, mDocumento({ mime_type: mime, filename: 'a' }), { wamid: 'wamid.DOC1' });
    expect(g.llamadas.obtener).toHaveLength(0);
    expect(g.llamadas.descargar).toHaveLength(0);
    expect(g.llamadas.guardar).toHaveLength(0);
    expect(g.llamadas.anotar).toHaveLength(1);
    const ll = g.llamadas.anotar[0]!;
    expect(ll.encabezados).toEqual({ 'X-NovuChat-Numero': PID, 'X-NovuChat-Telefono': ANA, 'X-NovuChat-IdMeta': 'wamid.DOC1', 'X-NovuChat-Tipo': 'document', 'X-NovuChat-Anotar': '1', 'X-NovuChat-Mime': mime });
    expect(ll.parametros['sendBody']).toBeUndefined();
    expect(ll.cuerpo).toBeUndefined();
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it('un texto, un sticker o una ubicación no tocan el guardado', () => {
    const { mu, g } = mundo();
    hablar(mu, ANA, mTexto('hola'));
    hablar(mu, ANA, { type: 'sticker', sticker: { id: 'stk', mime_type: 'image/webp' } }, { toleraFallo: true });
    hablar(mu, ANA, { type: 'location', location: { latitude: 1, longitude: 2 } }, { toleraFallo: true });
    expect(Object.values(g.llamadas).every((l) => l.length === 0)).toBe(true);
  });
  it('un medio que Meta informa por encima del límite NO se baja ni llega al servidor (cuenta como 413)', () => {
    const { mu, g } = mundo({ bytes: 5_000_001, respuesta: r(200, { ruta: 'x', repetido: false }) });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.descargar.map((x) => x.url)).toEqual(['']);
    expect(g.llamadas.servidor).toHaveLength(0);
    expect(g.llamadas.avisos.map((x) => x.cuerpo?.['text']?.['body'])).toEqual([AVISO('el archivo supera el tamaño permitido')]);
  });
  it('los límites son los del contrato: imagen 5 MB, PDF 10 MB, audio 16 MB (justo en el límite se baja)', () => {
    for (const [m, bytes] of [[mImagen(), 5_000_000], [mDocumento(), 10_000_000], [mAudio(), 16_000_000]] as const) {
      const { mu, g } = mundo({ bytes, respuesta: r(200, { ruta: 'x', repetido: false }) });
      hablar(mu, ANA, m);
      expect(g.llamadas.servidor, JSON.stringify(m)).toHaveLength(1);
      const otro = mundo({ bytes: bytes + 1 });
      hablar(otro.mu, ANA, m);
      expect(otro.g.llamadas.servidor, JSON.stringify(m)).toHaveLength(0);
    }
  });
  it('un documento que no es PDF, docx ni xlsx va por Anotar con su mime (el servidor lo rechaza con 415 sin que se baje nada)', () => {
    const { mu, g } = mundo({ respuesta: r(415, { error: 'tipo_no_admitido' }) });
    abrirVentana(mu);
    hablar(mu, ANA, mDocumento({ mime_type: 'application/zip', filename: 'a.zip' }));
    expect(g.llamadas.descargar).toHaveLength(0);
    expect(g.llamadas.anotar.map((x) => x.encabezados['X-NovuChat-Mime'])).toEqual(['application/zip']);
    expect(g.llamadas.avisos.map((x) => x.cuerpo?.['text']?.['body'])).toEqual([AVISO('el tipo de archivo no se admite')]);
  });
});

describe('cada respuesta del §2 se trata, y ninguna rompe el turno', () => {
  const SILENCIO: [string, RespuestaDelServidor][] = [
    ['200 guardado', r(200, { ruta: 'x', repetido: false })], ['200 repetido', r(200, { ruta: 'x', repetido: true })], ['200 anotado', r(200, { anotado: true })],
    ['400 telefono_invalido', r(400, { error: 'telefono_invalido' })], ['400 falta_idmeta', r(400, { error: 'falta_idmeta' })],
    ['400 tipo_invalido', r(400, { error: 'tipo_invalido' })], ['400 vacio', r(400, { error: 'vacio' })],
    ['401', r(401, 'no autorizado')], ['405', r(405, 'metodo')],
    ['409 guardado_apagado', r(409, { error: 'guardado_apagado' })], ['409 sin_mensaje', r(409, { error: 'sin_mensaje' })],
    ['409 en_curso', r(409, { error: 'en_curso' })], ['409 {estado}', r(409, { estado: 'suspendido' })],
    ['500 inesperado', r(500, {})], ['cuerpo ilegible', r(200, '<html>')],
  ];
  const AVISAN: [string, RespuestaDelServidor, string][] = [
    ['413 demasiado_grande', r(413, { error: 'demasiado_grande' }), 'el archivo supera el tamaño permitido'],
    ['415 tipo_no_admitido', r(415, { error: 'tipo_no_admitido' }), 'el tipo de archivo no se admite'],
    ['429 cupo_diario_lleno', r(429, { error: 'cupo_diario_lleno' }), 'se llenó el cupo diario de archivos del comercio'],
    ['502 no_se_guardo', r(502, { error: 'no_se_guardo' }), 'el servidor no pudo guardarlo'],
    ['502 no_se_registro', r(502, { error: 'no_se_registro' }), 'el servidor no pudo guardarlo'],
  ];
  // Lo que el cliente recibe sin guardado de por medio (la bandera apagada): la referencia de cada caso.
  const referencia = (() => { const { mu } = mundo(); abrirVentana(mu); return textos(hablar(mu, ANA, mImagen())); })();

  it.each(SILENCIO)('%s: silencio (sin aviso), y el cliente recibe lo mismo de siempre', (_, resp) => {
    const { mu, g } = mundo({ respuesta: resp });
    abrirVentana(mu);
    const t = hablar(mu, ANA, mImagen());
    expect(t.fallo).toBeNull();
    expect(textos(t)).toEqual(referencia);
    expect(g.llamadas.servidor).toHaveLength(1);
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it.each(AVISAN)('%s: UN aviso a la recepción con el motivo, sin datos del paciente; el cliente recibe lo mismo de siempre', (_, resp, motivo) => {
    const { mu, g } = mundo({ respuesta: resp });
    abrirVentana(mu);
    const t = hablar(mu, ANA, mImagen({ caption: 'mi foto' }), { wamid: 'wamid.PACIENTE1', nombre: 'Ana Pérez' });
    expect(t.fallo).toBeNull();
    expect(textos(t)).toEqual(referencia);
    expect(g.llamadas.avisos).toHaveLength(1);
    const aviso = g.llamadas.avisos[0]!;
    expect(aviso.cuerpo).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: REC, type: 'text', text: { preview_url: false, body: AVISO(motivo) } });
    expect(aviso.url).toMatch(new RegExp(`^https://graph\\.facebook\\.com/v\\d+\\.\\d/${PID}/messages$`));
    // Ningún dato del paciente: ni su teléfono, ni su nombre, ni el id de su mensaje, ni su pie de foto.
    const todo = JSON.stringify(aviso.cuerpo);
    for (const dato of [ANA, 'Ana', 'wamid.PACIENTE1', 'mi foto', 'media-img']) expect(todo, dato).not.toContain(dato);
  });
  it('guardado_apagado (la bandera por defecto) es SILENCIO TOTAL: ni aviso, ni marca del día', () => {
    const { mu, g } = mundo();
    abrirVentana(mu);
    for (let i = 0; i < 3; i++) hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(3);
    expect(g.llamadas.avisos).toHaveLength(0);
    expect((mu.sd['guardadoDeMedios'] as J)['avisoDia']).toBeUndefined();
  });
});

describe('el aviso de falla: ventana de la recepción, uno por día y por comercio', () => {
  const falla = r(502, { error: 'no_se_guardo' });
  it('sin ventana abierta (la recepción no escribió) no sale', () => {
    const { mu, g } = mundo({ respuesta: falla });
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(1);
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it('con la ventana vencida (23 h 30 min) no sale; con la ventana recién abierta, sí', () => {
    const { mu, g } = mundo({ respuesta: falla });
    abrirVentana(mu);
    mu.avanzar(23 * 60 + 30);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.avisos).toHaveLength(0);
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.avisos).toHaveLength(1);
  });
  it('a lo más UNO por día de La Paz, aunque fallen muchos; al día siguiente, otro', () => {
    const { mu, g } = mundo({ respuesta: falla });
    abrirVentana(mu);
    for (let i = 0; i < 5; i++) hablar(mu, ANA, mImagen());
    hablar(mu, ANA, mDocumento({ mime_type: DOCX }));
    expect(g.llamadas.avisos).toHaveLength(1);
    // AHORA es 10:00 en La Paz: 14 h después ya es otro día; la recepción vuelve a escribir.
    mu.avanzar(14 * 60);
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.avisos).toHaveLength(2);
  });
  it('si Meta rechaza el aviso, ese día no se reintenta (nunca dos avisos el mismo día)', () => {
    const { mu, g } = mundo({ respuesta: falla, aviso: 'error' });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen(), { toleraFallo: true });
    hablar(mu, ANA, mImagen(), { toleraFallo: true });
    expect(g.llamadas.avisos).toHaveLength(1);
  });
  it('el estado estático del guardado no guarda nada del paciente: solo el último mensaje de la recepción y el día del aviso', () => {
    const { mu } = mundo({ respuesta: falla });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen(), { wamid: 'wamid.PACIENTE2' });
    const estado = mu.sd['guardadoDeMedios'] as J;
    expect(Object.keys(estado).sort()).toEqual(['avisoDia', 'recepcionMs']);
    expect(JSON.stringify(estado)).not.toContain(ANA);
  });
});

describe('una falla del guardado NUNCA impide que el asistente responda, y corre DESPUÉS de la respuesta', () => {
  const referencia = (() => { const { mu } = mundo(); return textos(hablar(mu, ANA, mImagen())); })();
  const caidas: [string, OpcionesDelGuardado, Record<string, Doble>][] = [
    ['guardarMedio no responde (red caída)', { respuesta: 'lanza' }, {}],
    ['Meta no da la URL', {}, { 'Pedir el medio a Meta (guardado)': () => { throw new Error('fetch failed'); } }],
    ['Meta no deja bajar el archivo', {}, { 'Descargar medio (guardado)': () => { throw new Error('403'); } }],
  ];
  it.each(caidas)('%s: el cliente recibe exactamente lo mismo y el turno no falla', (_, o, extra) => {
    const { mu } = mundo(o);
    Object.assign(mu.dobles, extra);
    abrirVentana(mu);
    const t = hablar(mu, ANA, mImagen());
    expect(t.fallo).toBeNull();
    expect(textos(t)).toEqual(referencia);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
  it('si Meta rechaza el AVISO, la ejecución termina en error (ningún fallo tragado), pero DESPUÉS de que el cliente recibió lo mismo de siempre', () => {
    for (const aviso of ['lanza', 'error'] as const) {
      const { mu } = mundo({ respuesta: r(502, { error: 'no_se_guardo' }), aviso });
      abrirVentana(mu);
      const t = hablar(mu, ANA, mImagen(), { toleraFallo: true });
      expect(t.fallo?.nodo, aviso).toBe('Avisar falla del guardado');
      expect(textos(t), aviso).toEqual(referencia);
    }
  });
  it('la rama corre al final: la respuesta al cliente sale ANTES de «Preparar guardado»', () => {
    const { mu } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    const t = hablar(mu, ANA, mImagen());
    const orden = t.orden;
    expect(orden.indexOf('Enviar a WhatsApp')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(orden.indexOf('Enviar a WhatsApp'));
    expect(orden.indexOf('Enviar a WhatsApp')).toBeLessThan(orden.indexOf('Preparar guardado'));
    expect(orden.lastIndexOf('Reportar mensaje (saliente)')).toBeLessThan(orden.indexOf('Preparar guardado'));
  });
  it('en modo PRUEBA el entrante no se reporta, así que tampoco se guarda (el servidor no tendría el mensaje)', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) }, PRUEBA);
    hablar(mu, ANA, mImagen(), { toleraFallo: true });
    expect(g.llamadas.servidor).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------ todos los flujos cubiertos
const FLUJOS = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental');
const leer = (a: string): Flujo => JSON.parse(readFileSync(join(FLUJOS, a), 'utf8')) as Flujo;
describe('en cada flujo cubierto la rama se arma igual (mismo código, mismas cabeceras) y las credenciales son las del propio flujo', () => {
  const CUBIERTOS = [
    'rroca-evy/rroca-evy.json', 'rroca-emma/rroca-emma.json', 'rroca-ruben/rroca-ruben.json', 'rroca-antonio/rroca-antonio.json',
    'venta-minima/venta-minima.qtaco.json', 'venta-minima/venta-minima.ensayo-demo-a.json', 'venta-minima/venta-minima.prueba.json',
    'doctoras/doctoras.rroca-evy.json', 'doctoras/doctoras.rroca-emma.json', 'chat-novuchat/chat-novuchat.novuchat.json', 'captacion-minima/captacion-minima.novuchat.json',
  ];
  const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
  it.each(CUBIERTOS)('%s', (archivo) => {
    const f = leer(archivo);
    const ingesta = (nodo(f, 'Reportar mensaje (entrante)').credentials as J)['httpHeaderAuth']['name'];
    const descarga = nodo(f, 'Descargar medio').credentials as J;
    for (const n of ['Anotar medio', 'Guardar medio']) expect(nodo(f, n).credentials, `${archivo} · ${n}`).toEqual({ httpHeaderAuth: { id: '', name: ingesta } });
    for (const n of ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)', 'Avisar falla del guardado']) expect(nodo(f, n).credentials, `${archivo} · ${n}`).toEqual(descarga);
    // El número del negocio: la misma expresión que el reporte del entrante (misma ruta del token).
    const numero = ((nodo(f, 'Reportar mensaje (entrante)').parameters as J)['headerParameters']['parameters'] as J[]).find((h) => h['name'] === 'X-NovuChat-Numero')!['value'];
    for (const n of ['Anotar medio', 'Guardar medio']) {
      expect(((nodo(f, n).parameters as J)['headerParameters']['parameters'] as J[]).find((h) => h['name'] === 'X-NovuChat-Numero')!['value'], `${archivo} · ${n}`).toBe(numero);
    }
  });
});
