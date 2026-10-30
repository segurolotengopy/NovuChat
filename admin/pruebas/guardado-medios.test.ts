/**
 * EL GUARDADO DE MEDIOS, CORRIENDO (contrato M1↔M2 del 29/10/2026, §1, §2 y §4, con el contrato v2 «guardar y descargar TODO» del 30/10), contra un DOBLE del servidor `guardarMedio` que responde
 * lo que dice el contrato (no el código de M1). Se corre el flujo VERSIONADO de Evy entero en el n8n de mentira, más un recorrido por cada
 * flujo cubierto para ver que la rama no le cambia a nadie lo que recibe el cliente.
 *
 *   - cada respuesta del §2: las de silencio no avisan; 413, 415, 429 (cupo del comercio o del teléfono) y 502 avisan a la recepción (ventana abierta, uno
 *     por día, sin datos del paciente); un 5xx se reintenta UNA vez;
 *   - TODO medio se guarda con sus bytes: imagen, audio, video, documento de cualquier tipo y sticker (como `image`); ya no hay modo Anotar;
 *   - el `Content-Type` va saneado (lista cerrada o application/octet-stream) y lo que Meta informa por encima de 16 MiB no se baja (cuenta como 413);
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
import * as EMMA from './tenants/rroca-emma/mundo';
import * as DOCTORAS from './tenants/doctoras/mundo';
import * as ANTONIO from './tenants/rroca-antonio/mundo';
import * as VM from './lib/venta-minima-mundo';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIB16 = 16 * 1024 * 1024;
const mVideo = (op: J = {}): J => ({ type: 'video', video: { id: 'media-vid', mime_type: 'video/mp4', ...op } });
const mSticker = (): J => ({ type: 'sticker', sticker: { id: 'media-stk', mime_type: 'image/webp' } });
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
    expect(g.llamadas.servidor).toHaveLength(1);
    const ll = g.llamadas.servidor[0]!;
    expect(ll.nodo).toBe('Guardar medio');
    expect(ll.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarMedio');
    expect(ll.encabezados).toEqual({ 'X-NovuChat-Numero': PID, 'X-NovuChat-Telefono': ANA, 'X-NovuChat-IdMeta': 'wamid.IMG1', 'X-NovuChat-Tipo': 'image', 'Content-Type': 'image/jpeg' });
    expect(ll.parametros['contentType']).toBe('binaryData');
    expect(ll.parametros['inputDataFieldName']).toBe('data');
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it('TODOS LOS TIPOS se bajan y se guardan con su categoría y el Content-Type saneado (contrato v2 §1 y §4)', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    const casos: [string, J, string, string][] = [
      ['nota de voz', mAudio(), 'audio', 'audio/ogg'],
      ['PDF', mDocumento(), 'document', 'application/pdf'],
      ['docx', mDocumento({ mime_type: DOCX, filename: 'a.docx' }), 'document', DOCX],
      ['xlsx', mDocumento({ mime_type: XLSX, filename: 'a.xlsx' }), 'document', XLSX],
      ['zip', mDocumento({ mime_type: 'application/zip', filename: 'a.zip' }), 'document', 'application/zip'],
      ['ejecutable (mime fuera de la lista)', mDocumento({ mime_type: 'application/x-msdownload', filename: 'a.exe' }), 'document', 'application/octet-stream'],
      ['html disfrazado de documento', mDocumento({ mime_type: 'text/html', filename: 'a.html' }), 'document', 'application/octet-stream'],
      ['documento sin mime', mDocumento({ mime_type: '', filename: 'a' }), 'document', 'application/octet-stream'],
      ['video', mVideo(), 'video', 'video/mp4'],
      ['video 3gp', mVideo({ mime_type: 'video/3gpp' }), 'video', 'video/3gpp'],
      ['sticker (como imagen webp)', mSticker(), 'image', 'image/webp'],
      ['imagen con mime de otra categoría', mImagen({ mime_type: 'video/mp4' }), 'image', 'application/octet-stream'],
      ['imagen svg (fuera de la lista)', mImagen({ mime_type: 'image/svg+xml' }), 'image', 'application/octet-stream'],
    ];
    casos.forEach(([, m], i) => hablar(mu, ANA, m, { wamid: `wamid.T${i}`, toleraFallo: true }));
    expect(g.llamadas.servidor.map((x) => [x.nodo, x.encabezados['X-NovuChat-IdMeta'], x.encabezados['X-NovuChat-Tipo'], x.encabezados['Content-Type']]))
      .toEqual(casos.map(([, , tipo, ct], i) => ['Guardar medio', `wamid.T${i}`, tipo, ct]));
    expect(g.llamadas.descargar).toHaveLength(casos.length);
    // Ningún pedido lleva las cabeceras del modo Anotar que el contrato v2 quitó.
    for (const ll of g.llamadas.servidor) {
      expect(ll.encabezados['X-NovuChat-Anotar'], ll.nodo).toBeUndefined();
      expect(ll.encabezados['X-NovuChat-Mime'], ll.nodo).toBeUndefined();
      expect(ll.parametros['contentType']).toBe('binaryData');
    }
  });
  it('un texto, una ubicación o una reacción no tocan el guardado', () => {
    const { mu, g } = mundo();
    hablar(mu, ANA, mTexto('hola'));
    hablar(mu, ANA, { type: 'location', location: { latitude: 1, longitude: 2 } }, { toleraFallo: true });
    hablar(mu, ANA, { type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } }, { toleraFallo: true });
    expect(Object.values(g.llamadas).every((l) => l.length === 0)).toBe(true);
  });
  it('un medio que Meta informa por encima de 16 MiB NO se baja ni llega al servidor (cuenta como 413, con aviso)', () => {
    for (const m of [mImagen(), mDocumento(), mVideo(), mAudio()]) {
      const { mu, g } = mundo({ bytes: MIB16 + 1, respuesta: r(200, { ruta: 'x', repetido: false }) });
      abrirVentana(mu);
      hablar(mu, ANA, m, { toleraFallo: true });
      expect(g.llamadas.descargar.map((x) => x.url), JSON.stringify(m)).toEqual(['']);
      expect(g.llamadas.servidor, JSON.stringify(m)).toHaveLength(0);
      expect(g.llamadas.avisos.map((x) => x.cuerpo?.['text']?.['body']), JSON.stringify(m)).toEqual([AVISO('el archivo supera el tamaño permitido')]);
    }
  });
  it('el flujo NO se adelanta al tope por tipo del servidor: justo 16 MiB se baja en todos los tipos (una imagen de 6 MB también; la rechaza el servidor con 413)', () => {
    for (const [m, bytes] of [[mImagen(), 6_000_000], [mImagen(), MIB16], [mDocumento(), MIB16], [mAudio(), MIB16], [mVideo(), MIB16]] as const) {
      const { mu, g } = mundo({ bytes, respuesta: r(200, { ruta: 'x', repetido: false }) });
      hablar(mu, ANA, m, { toleraFallo: true });
      expect(g.llamadas.servidor, `${JSON.stringify(m)} ${bytes}`).toHaveLength(1);
    }
  });
});

describe('cada respuesta del §2 se trata, y ninguna rompe el turno', () => {
  const SILENCIO: [string, RespuestaDelServidor][] = [
    ['200 guardado', r(200, { ruta: 'x', repetido: false })], ['200 repetido', r(200, { ruta: 'x', repetido: true })], ['200 anotado', r(200, { anotado: true, repetido: false })], ['200 anotado repetido', r(200, { anotado: true, repetido: true })],
    ['400 telefono_invalido', r(400, { error: 'telefono_invalido' })], ['400 falta_idmeta', r(400, { error: 'falta_idmeta' })],
    ['400 tipo_invalido', r(400, { error: 'tipo_invalido' })], ['400 vacio', r(400, { error: 'vacio' })],
    ['401', r(401, 'no autorizado')], ['405', r(405, 'metodo')],
    ['409 guardado_apagado', r(409, { error: 'guardado_apagado' })], ['409 sin_mensaje', r(409, { error: 'sin_mensaje' })],
    ['409 en_curso', r(409, { error: 'en_curso' })], ['409 {estado}', r(409, { estado: 'suspendido' })],
    ['cuerpo ilegible', r(200, '<html>')],
  ];
  const AVISAN: [string, RespuestaDelServidor, string][] = [
    ['413 demasiado_grande', r(413, { error: 'demasiado_grande' }), 'el archivo supera el tamaño permitido'],
    ['415 tipo_no_admitido', r(415, { error: 'tipo_no_admitido' }), 'el tipo de archivo no se admite'],
    ['429 cupo_diario_lleno', r(429, { error: 'cupo_diario_lleno' }), 'se llenó el cupo diario de archivos del comercio'],
    ['429 cupo_telefono_lleno', r(429, { error: 'cupo_telefono_lleno' }), 'se llenó el cupo diario de archivos de una conversación'],
    ['502 no_se_guardo', r(502, { error: 'no_se_guardo' }), 'el servidor no pudo guardarlo'],
    ['502 no_se_registro', r(502, { error: 'no_se_registro' }), 'el servidor no pudo guardarlo'],
    ['500 inesperado', r(500, {}), 'el servidor no pudo guardarlo'],
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
  it('un 400 que solo daba el modo Anotar (anotar_con_cuerpo) ya no tiene trato propio: se registra como pedidoInvalido, sin aviso', () => {
    const { mu, g } = mundo({ respuesta: r(400, { error: 'anotar_con_cuerpo' }) });
    abrirVentana(mu);
    hablar(mu, ANA, mDocumento({ mime_type: DOCX }), { wamid: 'wamid.DOCX1' });
    expect(g.llamadas.avisos).toHaveLength(0);
    const estado = mu.sd['guardadoDeMedios'] as J;
    expect(estado['pedidoInvalido']).toEqual({ dia: '2026-10-05', n: 1 });
    expect(estado['anotarConCuerpo']).toBeUndefined();
    expect(JSON.stringify(estado)).not.toContain('wamid.DOCX1');
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

describe('el ÚNICO reintento ante un 5xx (revisión del integrador)', () => {
  const secuencia = (...rs: RespuestaDelServidor[]) => { let i = 0; return () => rs[Math.min(i++, rs.length - 1)]!; };
  it('502 y después 200: un reintento con el MISMO pedido, sin aviso', () => {
    const { mu, g } = mundo({ respuesta: secuencia(r(502, { error: 'no_se_guardo' }), r(200, { ruta: 'x', repetido: false })) });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen(), { wamid: 'wamid.R1' });
    expect(g.llamadas.guardar).toHaveLength(1);
    expect(g.llamadas.reintentos).toHaveLength(1);
    const ll = g.llamadas.reintentos[0]!;
    expect(ll.parametros['sendBody']).toBe(true);
    expect(JSON.parse(String(ll.parametros['jsonHeaders']))).toEqual({ 'X-NovuChat-Numero': PID, 'X-NovuChat-Telefono': ANA, 'X-NovuChat-IdMeta': 'wamid.R1', 'X-NovuChat-Tipo': 'image', 'Content-Type': 'image/jpeg' });
    expect(g.llamadas.descargar).toHaveLength(1); // el reintento NO vuelve a pedir el medio a Meta
    expect(g.llamadas.avisos).toHaveLength(0);
  });
  it('502 dos veces: UN solo reintento y después el aviso de falla', () => {
    const { mu, g } = mundo({ respuesta: r(502, { error: 'no_se_registro' }) });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(2);
    expect(g.llamadas.avisos.map((x) => x.cuerpo?.['text']?.['body'])).toEqual([AVISO('el servidor no pudo guardarlo')]);
  });
  it('un documento cualquiera (xlsx) también se reintenta CON sus bytes y su Content-Type (ya no hay Anotar)', () => {
    const { mu, g } = mundo({ respuesta: secuencia(r(503, {}), r(200, { ruta: 'x', repetido: false })) });
    hablar(mu, ANA, mDocumento({ mime_type: XLSX }), { wamid: 'wamid.R2' });
    const ll = g.llamadas.reintentos[0]!;
    expect(ll.parametros['sendBody']).toBe(true);
    expect(ll.parametros['contentType']).toBe('binaryData');
    expect(JSON.parse(String(ll.parametros['jsonHeaders']))).toEqual({ 'X-NovuChat-Numero': PID, 'X-NovuChat-Telefono': ANA, 'X-NovuChat-IdMeta': 'wamid.R2', 'X-NovuChat-Tipo': 'document', 'Content-Type': XLSX });
    expect(g.llamadas.servidor.map((x) => x.nodo)).toEqual(['Guardar medio', 'Reintentar el guardado']);
  });
  it('NIEGA: un 4xx, un 409 o un 200 no se reintentan', () => {
    for (const resp of [r(413, { error: 'demasiado_grande' }), r(415, { error: 'tipo_no_admitido' }), r(409, { error: 'guardado_apagado' }), r(409, { error: 'en_curso' }), r(429, { error: 'cupo_diario_lleno' }), r(429, { error: 'cupo_telefono_lleno' }), r(200, { ruta: 'x', repetido: false })]) {
      const { mu, g } = mundo({ respuesta: resp });
      hablar(mu, ANA, mImagen());
      expect(g.llamadas.reintentos, JSON.stringify(resp)).toHaveLength(0);
    }
  });
  it('un medio a la vez: un solo pedido por mensaje (nunca una ráfaga en paralelo)', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    const t = hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(1);
    expect(t.orden.filter((n) => n === 'Guardar medio')).toHaveLength(1);
  });
});

describe('el aviso de falla: ventana de la recepción, uno por día y por comercio', () => {
  const falla = r(502, { error: 'no_se_guardo' });
  it('sin ventana abierta (la recepción no escribió) no sale', () => {
    const { mu, g } = mundo({ respuesta: falla });
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(2); // el pedido y su único reintento (502)
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
  it('a lo más UNO por ejecución y día de La Paz con ejecuciones SECUENCIALES (con concurrentes pueden salir varios: n8n no da un candado); al día siguiente, otro', () => {
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
    'rroca-ruben/rroca-ruben.prueba.json', 'agenda-minima/agenda-minima.v0.json',
  ];
  const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
  it.each(CUBIERTOS)('%s', (archivo) => {
    const f = leer(archivo);
    const ingesta = (nodo(f, 'Reportar mensaje (entrante)').credentials as J)['httpHeaderAuth']['name'];
    const descarga = nodo(f, 'Descargar medio').credentials as J;
    for (const n of ['Guardar medio', 'Reintentar el guardado']) expect(nodo(f, n).credentials, `${archivo} · ${n}`).toEqual({ httpHeaderAuth: { id: '', name: ingesta } });
    // Contrato v2: sin Anotar, nueve nodos.
    expect(f.nodes.some((x) => /Anotar medio/.test(x.name)), archivo).toBe(false);
    for (const n of ['Pedir el medio a Meta (guardado)', 'Descargar medio (guardado)']) expect(nodo(f, n).credentials, `${archivo} · ${n}`).toEqual(descarga);
    // El aviso sale con la credencial de ENVÍO de su variante (prueba o producción), no con la de descarga.
    expect(nodo(f, 'Avisar falla del guardado').credentials, `${archivo} · aviso`).toEqual(nodo(f, 'Enviar a WhatsApp').credentials);
    // El número del negocio: la misma expresión que el reporte del entrante (misma ruta del token).
    const numero = ((nodo(f, 'Reportar mensaje (entrante)').parameters as J)['headerParameters']['parameters'] as J[]).find((h) => h['name'] === 'X-NovuChat-Numero')!['value'];
    for (const n of ['Guardar medio']) {
      expect(((nodo(f, n).parameters as J)['headerParameters']['parameters'] as J[]).find((h) => h['name'] === 'X-NovuChat-Numero')!['value'], `${archivo} · ${n}`).toBe(numero);
    }
  });
});

describe('revisión de código de #699: lo que falla sin aviso queda REGISTRADO (sin datos del paciente)', () => {
  it('401 (token rotado o número equivocado) → guardadoDeMedios.sinAcceso, sin aviso', () => {
    const { mu, g } = mundo({ respuesta: r(401, 'no autorizado') });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    hablar(mu, ANA, mAudio());
    expect(g.llamadas.avisos).toHaveLength(0);
    expect((mu.sd['guardadoDeMedios'] as J)['sinAcceso']).toEqual({ dia: '2026-10-05', n: 2 });
  });
  it.each(['telefono_invalido', 'falta_idmeta', 'tipo_invalido', 'vacio'])('400 %s → guardadoDeMedios.pedidoInvalido, sin aviso', (error) => {
    const { mu, g } = mundo({ respuesta: r(400, { error }) });
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.avisos).toHaveLength(0);
    const estado = mu.sd['guardadoDeMedios'] as J;
    expect(estado['pedidoInvalido']).toEqual({ dia: '2026-10-05', n: 1 });
    expect(estado['anotarConCuerpo']).toBeUndefined();
  });
  it('una descarga de Meta que falla → guardadoDeMedios.sinDescarga, sin llamar al servidor y sin aviso', () => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    mu.dobles['Descargar medio (guardado)'] = () => { throw new Error('403'); };
    abrirVentana(mu);
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.servidor).toHaveLength(0);
    expect(g.llamadas.avisos).toHaveLength(0);
    expect((mu.sd['guardadoDeMedios'] as J)['sinDescarga']).toEqual({ dia: '2026-10-05', n: 1 });
  });
  it.each([0, undefined])('si Meta NO informa el tamaño (%s), el medio se baja igual y llega al servidor (que impone el tope por tipo)', (bytes) => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    mu.dobles['Pedir el medio a Meta (guardado)'] = () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/g', mime_type: 'image/jpeg', ...(bytes === undefined ? {} : { file_size: bytes }) });
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.descargar.map((x) => x.url)).toEqual(['https://lookaside.fbsbx.com/whatsapp_business/attachments/g']);
    expect(g.llamadas.servidor).toHaveLength(1);
  });
  // Revisión de seguridad de #713: video y documento pueden pesar 100 MB; sin tamaño informado NO se bajan. Imagen, audio y sticker sí (el servidor los acota).
  it.each([
    ['video sin file_size', mVideo(), undefined], ['video con file_size 0', mVideo(), 0],
    ['documento sin file_size', mDocumento(), undefined], ['documento con file_size 0', mDocumento(), 0],
  ] as const)('NIEGA: %s NO se baja ni llega al servidor; queda en guardadoDeMedios.sinTamano y avisa como falla de tamaño', (_, m, bytes) => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    mu.dobles['Pedir el medio a Meta (guardado)'] = () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/g', mime_type: 'video/mp4', ...(bytes === undefined ? {} : { file_size: bytes }) });
    abrirVentana(mu);
    const t = hablar(mu, ANA, m, { wamid: 'wamid.SINTAM', toleraFallo: true });
    expect(g.llamadas.descargar.map((x) => x.url)).toEqual(['']);
    expect(g.llamadas.servidor).toHaveLength(0);
    const estado = mu.sd['guardadoDeMedios'] as J;
    expect(estado['sinTamano']).toEqual({ dia: '2026-10-05', n: 1 });
    expect(estado['sinDescarga']).toBeUndefined();
    expect(g.llamadas.avisos.map((x) => x.cuerpo?.['text']?.['body'])).toEqual([AVISO('no se pudo comprobar su tamaño')]);
    expect(JSON.stringify(estado)).not.toContain('wamid.SINTAM');
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
  it.each([['imagen', mImagen()], ['nota de voz', mAudio()], ['sticker', mSticker()]] as const)('%s SIN file_size SÍ se baja (el servidor la acota por tipo)', (_, m) => {
    const { mu, g } = mundo({ respuesta: r(200, { ruta: 'x', repetido: false }) });
    mu.dobles['Pedir el medio a Meta (guardado)'] = () => ({ id: 'm', url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/g', mime_type: 'image/jpeg' });
    hablar(mu, ANA, m, { toleraFallo: true });
    expect(g.llamadas.descargar.map((x) => x.url)).toEqual(['https://lookaside.fbsbx.com/whatsapp_business/attachments/g']);
    expect(g.llamadas.servidor).toHaveLength(1);
    expect((mu.sd['guardadoDeMedios'] as J)['sinTamano']).toBeUndefined();
  });
  it('NIEGA: una URL que no es del CDN de Meta no se baja, con o sin tamaño', () => {
    const { mu, g } = mundo({ url: 'https://otro.ejemplo.invalid/x' });
    hablar(mu, ANA, mImagen());
    expect(g.llamadas.descargar.map((x) => x.url)).toEqual(['']);
    expect(g.llamadas.servidor).toHaveLength(0);
  });
  it('la descarga del guardado no reintenta (con la URL vacía no hay qué reintentar)', () => {
    const { mu } = mundo();
    const n = mu.flujo.nodes.find((x) => x.name === 'Descargar medio (guardado)')!;
    expect((n as J)['retryOnFail']).toBeUndefined();
  });
});

describe('el mensaje de la RECEPCIÓN (los comandos del operador) llega a «Preparar guardado» y abre su ventana, en cada flujo', () => {
  const ventana = (sd: J): unknown => (sd['guardadoDeMedios'] as J | undefined)?.['recepcionMs'];
  it('Evy', () => { const { mu } = mundo(); abrirVentana(mu); expect(ventana(mu.sd)).toBeGreaterThan(0); });
  it('Emma', () => { const mu = EMMA.crear(); EMMA.hablar(mu, EMMA.REC, EMMA.mTexto('hola'), { toleraFallo: true }); expect(ventana(mu.sd)).toBeGreaterThan(0); });
  it('doctoras', () => { const mu = DOCTORAS.crear(); DOCTORAS.hablar(mu, DOCTORAS.REC, DOCTORAS.mTexto('hola'), { toleraFallo: true }); expect(ventana(mu.sd)).toBeGreaterThan(0); });
  it('Antonio', () => { const mu = ANTONIO.crear(); ANTONIO.hablar(mu, ANTONIO.REC, ANTONIO.mTexto('hola'), { toleraFallo: true }); expect(ventana(mu.sd)).toBeGreaterThan(0); });
  it('Q\'Taco (venta-minima)', () => { const w = VM.crear(); w.mundo.turno(VM.entrega(VM.REC, VM.texto('hola')), { tolerarFallo: true }); expect(ventana(w.mundo.sd)).toBeGreaterThan(0); });
});
