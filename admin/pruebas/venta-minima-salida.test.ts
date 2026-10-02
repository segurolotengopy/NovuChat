/**
 * LA SALIDA DE «VENTA MÍNIMA v0»: `armar-avisos.js`, `armar-mensajes.js` y `resumen-del-turno.js`
 * (`Flujos/experimental/venta-minima/src/nodos/`).
 *
 * Qué prueban estas tres piezas, por HECHO y no por lo dicho (CLAUDE.md, «Solo se ofrece lo que se
 * cumple» y prohibición 3):
 *  - las frases «pasé tu pedido al restaurante» y «tu solicitud llegó al restaurante» solo salen si
 *    Meta devolvió un `wamid` para al menos un aviso; con el aviso caído el cliente lee «No pude
 *    pasarle…» y el botón, y nunca «Ya pasé»;
 *  - ningún texto, título de botón, parámetro de plantilla ni detalle trae una palabra de
 *    `VM_PROHIBIDAS` («validado», «pagado», «recibimos tu pago», «ya lo preparan»…);
 *  - el QR solo sale con enlace https, monto y referencia, y con el monto igual al total que calculó
 *    el código; si se rechaza, no se guarda `esperando_comprobante`;
 *  - una derivación por teléfono por hora, y la marca solo se escribe si el aviso salió;
 *  - solo `Armar mensajes` escribe estado.
 *
 * LAS LIBRERÍAS SON DOBLES. `comun.js`, `avisos.js` y `reserva.js` los escriben otros agentes a la
 * vez; acá se definen dobles mínimos con la firma del contrato (§4.2 del diseño) y se concatenan
 * delante del código del nodo, SOLO dentro de esta suite (el archivo de producción no los trae). Lo
 * que se supone de cada una está en `DOBLES`, función por función. El reloj es un parámetro: `AHORA`
 * es el lunes 05/10/2026 a las 10:00 de La Paz. Teléfonos sintéticos, con seis ceros.
 *
 * Se evalúa con `ejecutar` de `./lib/flujo` (que le quita al código los globales de Node: si un nodo
 * usara `URL`, `Buffer` o `crypto`, aquí reventaría igual que en n8n).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type J, type Referencias } from './lib/flujo';

const CARPETA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/venta-minima/src/nodos');
const AVISOS = readFileSync(join(CARPETA, 'armar-avisos.js'), 'utf8');
const MENSAJES = readFileSync(join(CARPETA, 'armar-mensajes.js'), 'utf8');
const RESUMEN = readFileSync(join(CARPETA, 'resumen-del-turno.js'), 'utf8');

const AHORA = Date.UTC(2026, 9, 5, 14); // lunes 05/10/2026, 10:00 en La Paz
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const CLIENTE = '59100000011';
const AV1 = '59100000021';
const AV2 = '59100000022';
const REC = '59100000031';
const PRUEBA = '59100000041';

// La red de palabras del contrato (§4.2, `comun.js`). Se repite acá a propósito: si el contrato cambia,
// esta suite lo dice.
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S* (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(ó|amos|o\b)|reservad/i;

/**
 * LO QUE SE SUPONE DE CADA LIBRERÍA (los dobles de abajo; `avArmar` según lo que informó T4):
 *  - `comun.js` (T1): `vmPrimero/vmTodos/vmCfg` leen por nombre solo si el nodo corrió; `vmTextoSeguro`
 *    devuelve `false` si el texto coincide con `VM_PROHIBIDAS`; `vmSd()` da `ventaMinima` de los datos
 *    estáticos; `vmEscribirEstado` guarda el estado por teléfono; `vmBarrer` limpia vencidos.
 *  - `avisos.js` (T4): `avDestinatarios` filtra a los de 8 a 15 dígitos con prefijo permitido y distintos
 *    del que escribe; `avArmar` devuelve la LISTA de ítems `{para, rol, payload, respaldo:null,
 *    esPlantilla, clase}` (`clase`: plantilla, detalle o imagen; el detalle con ventana abierta y la imagen del
 *    comprobante son ítems aparte) y NO modifica `sd`;
 *    `avDentroDelTopeDiario` lee `sd`; `avContar` escribe en `sd` y SOLO lo llama `Armar mensajes`.
 *  - `reserva.js` (T3): `rsAnotar(sd, from, ahoraMs)` escribe en `sd`; solo lo llama `Armar mensajes`.
 */
const DOBLES = `
const VM_PROHIBIDAS = ${PROHIBIDAS.toString()};
function vmNodo(n) { try { const x = $(n); return x && x.isExecuted ? x : null; } catch (e) { return null; } }
function vmPrimero(n) { const x = vmNodo(n); if (!x) return null; const i = x.first(); return i && i.json ? i.json : null; }
function vmTodos(n) { const x = vmNodo(n); if (!x) return []; return x.all().map((i) => (i && i.json) || {}); }
function vmCfg() { return vmPrimero('Config del negocio') || {}; }
function vmNorm(t) { return String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim(); }
function vmDigitos(v) { return String(v === undefined || v === null ? '' : v).replace(/\\D/g, ''); }
function vmRecorte(t, max) { const s = String(t === undefined || t === null ? '' : t); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; }
function vmLinea(t, max) { return vmRecorte(String(t === undefined || t === null ? '' : t).replace(/[\\u0000-\\u001f\\u007f<>&]/g, ' ').replace(/\\s+/g, ' ').trim(), max); }
function vmTextoSeguro(t) { return !VM_PROHIBIDAS.test(String(t)); }
function vmSd() { const g = $getWorkflowStaticData('global'); if (!g.ventaMinima) g.ventaMinima = {}; return g.ventaMinima; }
function vmEstadoBase() { return { paso: 'inicio' }; }
function vmEscribirEstado(sd, from, e, ms) { __bit.push(['escribirEstado', from, e.paso]); sd.estados = sd.estados || {}; sd.estados[from] = Object.assign({}, e, { ultimoMensajeMs: ms }); }
function vmBarrer(sd, ms) { __bit.push(['barrer']); }
function vmCodigoCorto(ms) { return 'ABCD'; }
function avDestinatarios(csv, from, pref) {
  const out = []; const visto = {};
  const prefijos = String(pref || '591').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of String(csv || '').split(',')) {
    const i = p.indexOf(':'); const rol = i < 0 ? 'completo' : p.slice(0, i).trim(); const d = vmDigitos(i < 0 ? p : p.slice(i + 1));
    if (d.length < 8 || d.length > 15 || !prefijos.some((x) => d.startsWith(x)) || d === vmDigitos(from) || visto[d]) continue;
    visto[d] = true; out.push({ rol: rol, tel: d });
  }
  return out;
}
function avDentroDelTopeDiario(sd, ms, tope) { return Number(sd.avisosDia || 0) < tope; }
function avContar(sd, ms, n) { __bit.push(['avContar', n]); sd.avisosDia = Number(sd.avisosDia || 0) + n; }
function rsAnotar(sd, from, ms) { __bit.push(['rsAnotar', from]); sd.reservasDia = Number(sd.reservasDia || 0) + 1; }
function avArmar(tipo, datos, dest, cfg, sd, ms) {
  __bit.push(['avArmar', tipo, JSON.parse(JSON.stringify(datos))]);
  if (datos.lanzar) throw new Error('falla de prueba');
  const items = [];
  const plantilla = (d) => ({ messaging_product: 'whatsapp', to: d.tel, type: 'template', template: { name: 'plantilla_de_prueba', language: { code: 'es' }, components: [{ type: 'body', parameters: [
    { type: 'text', text: tipo + ' #' + datos.codigo }, { type: 'text', text: String(datos.total === undefined ? '—' : datos.total) },
    { type: 'text', text: (cfg.nombreNegocio || '') + ' · ' + (datos.nombre || '') + (datos.nota ? ' · ' + datos.nota : '') }, { type: 'text', text: '05/10 10:00' },
  ] }] } });
  for (const d of dest) items.push({ para: d.tel, rol: d.rol, payload: plantilla(d), respaldo: datos.respaldo === undefined ? null : datos.respaldo, esPlantilla: true, clase: 'plantilla' });
  if (datos.detalle && dest.length) items.push({ para: dest[0].tel, rol: dest[0].rol, payload: { messaging_product: 'whatsapp', to: dest[0].tel, type: 'text', text: { body: datos.detalle } }, respaldo: null, esPlantilla: false, clase: 'detalle' });
  if (datos.imagen && dest.length) items.push({ para: dest[0].tel, rol: dest[0].rol, payload: { messaging_product: 'whatsapp', to: dest[0].tel, type: 'image', image: { id: datos.mediaId, caption: datos.pieImagen === undefined ? 'Comprobante del cliente.' : datos.pieImagen } }, respaldo: null, esPlantilla: false, clase: 'imagen' });
  return datos.envuelto ? { items: items, errores: ['nota de avisos'] } : items;
}
`;

const CFG: J = {
  nombreNegocio: "Q' Taco", numeroRecepcion: REC, destinatariosAviso: `completo:${AV1},cocina:${AV2}`,
  prefijosPermitidos: '591', topeAvisosDia: 150, topeTransferenciasHora: 1, phoneNumberIdEsperado: 'PNID_PRUEBA',
  waGraphVersion: 'v26.0', cobro: { activo: true, qrUrl: 'https://qr.ejemplo.test/qtaco.png' }, modoPrueba: false, telefonoDePrueba: '',
};
const ENTRADA: J = { from: CLIENTE, nombrePerfil: 'Ana Prueba', phoneNumberId: 'PNID_PRUEBA', mensajeId: 'wamid.ENTRANTE1', ahoraMs: AHORA };
const PEDIDO: J = {
  pedidoId: 'ped-2026-10-05-0011-abc', codigo: 'K7Q2', total: 55, modalidad: 'recojo',
  lineas: [{ cantidad: 1, nombre: 'Orden de 3 tacos de birria', detalle: 'sin cebolla' }],
};
const PIE = 'Pedido #K7Q2. Total a pagar por QR: 55 Bs (solo la comida).\nEscanea el QR con la app de tu banco. Cuando termines, envíame aquí la foto o el PDF del comprobante.';
const OK = (n = 1): J => ({ messaging_product: 'whatsapp', contacts: [{ wa_id: CLIENTE }], messages: [{ id: `wamid.AVISO${n}` }] });
const FALLA: J = { error: { message: 'Graph rechazó el envío', code: 131030 } };

interface Entrada {
  plan?: J; nombrePlan?: string; cfg?: J; t?: J; armados?: J[]; enviados?: J[]; respaldos?: J[]; g?: J;
  /** Código que se agrega después de los dobles (una función repetida pisa a la anterior). */
  extra?: string;
}
function nodo(fuente: string, e: Entrada = {}): { items: J[]; g: J; sd: J; bit: unknown[][] } {
  const g: J = e.g ?? {};
  const bit: unknown[][] = [];
  const refs: Referencias = { 'Config del negocio': { ...CFG, ...e.cfg }, 'Interpretar entrada': { ...ENTRADA, ...e.t } };
  if (e.plan) refs[e.nombrePlan ?? 'Plan del turno'] = e.plan;
  if (e.armados) refs['Armar avisos'] = e.armados;
  if (e.enviados) refs['Enviar aviso'] = e.enviados;
  if (e.respaldos) refs['Aviso de respaldo'] = e.respaldos;
  const items = ejecutar(`${DOBLES}\n${e.extra ?? ''}\n${fuente}`, [{}], refs, { $getWorkflowStaticData: () => g, __bit: bit });
  return { items, g, sd: (g['ventaMinima'] ?? {}) as J, bit };
}
const avisos = (plan: J, e: Entrada = {}) => nodo(AVISOS, { plan, ...e });
const mensajes = (plan: J, e: Entrada = {}) => nodo(MENSAJES, { plan, ...e });

const texto = (cuerpo: string, extra: J = {}): J => ({ tipo: 'texto', cuerpo, ...extra });
const botones = (cuerpo: string, ...titulos: string[]): J => ({
  tipo: 'botones', cuerpo, botones: titulos.map((title, i) => ({ id: `b|${i}`, title })),
});
const enlace = (cuerpo: string, extra: J = {}): J => ({ tipo: 'enlace', cuerpo, botones: [{ id: '', title: 'Escribir al local' }], ...extra });
const qr = (extra: J = {}): J => ({ tipo: 'imagen', cuerpo: PIE, evento: 'qr_enviado', referencia: PEDIDO['pedidoId'], monto: 55, ...extra });
const armado = (tipoAviso: string, extra: J = {}): J => ({
  para: AV1, rol: 'completo', payload: { type: 'template' }, respaldo: null, esPlantilla: true, sinAviso: false, tipoAviso, ...extra,
});
const SIN_AVISO: J = { para: '', payload: null, respaldo: null, esPlantilla: false, sinAviso: true, tipoAviso: '', errores: [] };

/** Todo texto que un ítem le muestra a quien lo recibe. */
function textosDe(j: J): string[] {
  const p = (j['payload'] ?? {}) as J;
  const out: string[] = [];
  if (p['text']) out.push(String(p['text'].body));
  if (p['image']) out.push(String(p['image'].caption));
  if (p['interactive']) {
    out.push(String(p['interactive'].body.text));
    for (const b of p['interactive'].action.buttons ?? []) out.push(String(b.reply.title));
    if (p['interactive'].action.parameters) out.push(String(p['interactive'].action.parameters.display_text));
  }
  if (p['template']) for (const c of p['template'].components) for (const x of c.parameters) out.push(String(x.text));
  if (typeof j['respaldo'] === 'string') out.push(j['respaldo']);
  else if (j['respaldo'] && (j['respaldo'] as J)['text']) out.push(String((j['respaldo'] as J)['text'].body));
  if (typeof j['texto'] === 'string') out.push(j['texto']);
  return out;
}
const GENERICO = 'Eso lo ve directamente el restaurante. Toca el botón para escribirles.';
const cuerpoDe = (j: J): string => String(j['payload'].text?.body ?? j['payload'].interactive?.body.text ?? j['payload'].image?.caption);

// =================================================================================================
describe('Armar avisos', () => {
  it('sin aviso pedido emite UN ítem con sinAviso y errores, y no llama a avArmar', () => {
    const r = avisos({ ruta: 'menu', mensajes: [texto('hola')], aviso: null, errores: ['uno'] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ sinAviso: true, payload: null, para: '', errores: ['uno'], phoneNumberId: 'PNID_PRUEBA', waGraphVersion: 'v26.0' });
    expect(r.bit.some((b) => b[0] === 'avArmar')).toBe(false);
  });

  it('un aviso de pedido con dos destinatarios da dos plantillas, con rol, tipo y datos de envío', () => {
    const r = avisos({ ruta: 'confirmar', pedido: PEDIDO, aviso: { tipo: 'pedido', datos: { total: 55, nombre: 'Ana' } } });
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => [i['para'], i['rol'], i['esPlantilla'], i['sinAviso'], i['tipoAviso']]))
      .toEqual([[AV1, 'completo', true, false, 'pedido'], [AV2, 'cocina', true, false, 'pedido']]);
    expect(r.items.map((i) => i['payload'].to)).toEqual([AV1, AV2]);
    for (const i of r.items) expect(i).toMatchObject({ phoneNumberId: 'PNID_PRUEBA', waGraphVersion: 'v26.0', from: CLIENTE });
    expect(r.items[0]!['errores']).toEqual([]);
    expect(r.items[1]!['errores']).toBeUndefined();
  });

  it('NUNCA nombra la plantilla ni el aviso de otro tipo: las posee avisos.js', () => {
    expect(AVISOS).not.toMatch(/purchase_transaction|appointment_confirmed|plantillaAviso|plantillaPedido|plantillaReserva|plantillaDerivacion/);
  });

  it('completa con el pedido del plan lo que avArmar necesita, y lo que trae el plan manda', () => {
    const r = avisos({ pedido: PEDIDO, aviso: { tipo: 'pedido', datos: { nombre: 'Del plan' } } });
    const datos = r.bit.find((b) => b[0] === 'avArmar')![2] as J;
    expect(datos).toMatchObject({ codigo: 'K7Q2', from: CLIENTE, total: 55, modalidad: 'recojo', pedidoId: PEDIDO['pedidoId'], nombre: 'Del plan' });
    const sinPedido = avisos({ aviso: { tipo: 'transferencia', datos: { motivo: 'no sabe' } } });
    expect(sinPedido.bit.find((b) => b[0] === 'avArmar')![2]).toMatchObject({ codigo: 'ABCD', nombre: 'Ana Prueba', from: CLIENTE, ahoraMs: AHORA });
  });

  it('acepta plan.aviso como arreglo y plan.avisos, y no repite un aviso idéntico', () => {
    const a = { tipo: 'pedido', datos: { total: 55 } };
    const b = { tipo: 'transferencia', datos: { motivo: 'x' } };
    const r = avisos({ aviso: [a, b], avisos: [a] });
    expect(r.bit.filter((x) => x[0] === 'avArmar').map((x) => x[1])).toEqual(['pedido', 'transferencia']);
    expect(r.items).toHaveLength(4);
    const solo = avisos({ avisos: [b] });
    expect(solo.items.map((i) => i['tipoAviso'])).toEqual(['transferencia', 'transferencia']);
  });

  it('un tipo de aviso desconocido se ignora y se anota', () => {
    const r = avisos({ aviso: { tipo: 'oferta', datos: {} } });
    expect(r.items[0]).toMatchObject({ sinAviso: true });
    expect(String((r.items[0]!['errores'] as string[])[0])).toContain('aviso_de_tipo_desconocido');
    expect(r.bit.some((b) => b[0] === 'avArmar')).toBe(false);
  });

  it.each([['Uso extendido'], ['Comercio no operativo']])('lee el plan de «%s» cuando no hay «Plan del turno»', (nombre) => {
    const r = avisos({ aviso: { tipo: 'transferencia', datos: { motivo: 'uso extendido' } } }, { nombrePlan: nombre });
    expect(r.items.map((i) => i['tipoAviso'])).toEqual(['transferencia', 'transferencia']);
  });

  it('con la ventana abierta, el detalle es un ítem de texto aparte', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { detalle: 'Detalle del pedido. Revisen el pago en su banco antes de despachar.' } } });
    expect(r.items.map((i) => i['esPlantilla'])).toEqual([true, true, false]);
    expect(r.items[2]!['payload'].text.body).toContain('Revisen el pago en su banco antes de despachar');
    expect(r.items[2]!['para']).toBe(AV1);
  });

  it('un parámetro de plantilla con una palabra prohibida se reemplaza y se anota', () => {
    const r = avisos({ pedido: PEDIDO, aviso: { tipo: 'pedido', datos: { nota: 'ya pagado, validado por el banco' } } });
    for (const i of r.items) {
      const ps = i['payload'].template.components[0].parameters.map((p: J) => p.text);
      expect(ps[2]).toBe('—');
      expect(ps[0]).toBe('pedido #K7Q2');
      for (const t of ps) expect(PROHIBIDAS.test(t)).toBe(false);
    }
    expect((r.items[0]!['errores'] as string[]).some((e) => e.startsWith('parametro_de_plantilla_reemplazado'))).toBe(true);
    // el opuesto: sin palabra prohibida, el parámetro sale intacto y no hay errores
    const limpio = avisos({ aviso: { tipo: 'pedido', datos: { nota: 'sin cebolla' } } });
    expect(limpio.items[0]!['payload'].template.components[0].parameters[2].text).toContain('sin cebolla');
    expect(limpio.items[0]!['errores']).toEqual([]);
  });

  it('el primer parámetro prohibido se reemplaza por un genérico', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { codigo: 'pagado' } } });
    expect(r.items[0]!['payload'].template.components[0].parameters[0].text).toBe('consulta de cliente');
  });

  it('un texto de detalle con una palabra prohibida se reemplaza por uno genérico', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { detalle: 'El pago está confirmado y validado.' } } });
    const texto3 = r.items[2]!['payload'].text.body as string;
    expect(PROHIBIDAS.test(texto3)).toBe(false);
    expect(texto3).toContain('Revisen el chat con el cliente');
    expect((r.items[0]!['errores'] as string[]).some((e) => e.startsWith('texto_de_aviso_reemplazado'))).toBe(true);
  });

  it('si avArmar lanza, el turno sigue: un ítem sinAviso y el error anotado', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { lanzar: true } } });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ sinAviso: true });
    expect(String((r.items[0]!['errores'] as string[])[0])).toContain('aviso_no_armado: pedido');
  });

  it('con el tope diario alcanzado no se arma ningún aviso; por debajo, sí', () => {
    const lleno = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: { ventaMinima: { avisosDia: 150 } } });
    expect(lleno.items[0]).toMatchObject({ sinAviso: true });
    expect(String((lleno.items[0]!['errores'] as string[])[0])).toContain('tope_diario_de_avisos');
    expect(lleno.bit.some((b) => b[0] === 'avArmar')).toBe(false);
    const libre = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: { ventaMinima: { avisosDia: 149 } } });
    expect(libre.items[0]).toMatchObject({ sinAviso: false });
    const propio = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { cfg: { topeAvisosDia: 3 }, g: { ventaMinima: { avisosDia: 3 } } });
    expect(propio.items[0]).toMatchObject({ sinAviso: true });
  });

  it('una segunda derivación del mismo teléfono dentro de la hora no avisa; un pedido sí', () => {
    const reciente = { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - 30 * MIN] } } };
    const r = avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: reciente });
    expect(r.items[0]).toMatchObject({ sinAviso: true });
    expect(String((r.items[0]!['errores'] as string[])[0])).toContain('derivacion_repetida');
    // marca vieja (2 h): avisa
    const vieja = avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - 2 * HORA] } } } });
    expect(vieja.items[0]).toMatchObject({ sinAviso: false });
    // marca reciente de OTRO teléfono: avisa
    const otro = avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: { ventaMinima: { transferencias: { '59100000099': [AHORA - 5 * MIN] } } } });
    expect(otro.items[0]).toMatchObject({ sinAviso: false });
    // el límite es solo de las derivaciones: un pedido pasa
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: reciente }).items[0]).toMatchObject({ sinAviso: false });
    // una marca vieja con forma de número también se lee
    expect(avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: { ventaMinima: { transferencias: { [CLIENTE]: AHORA - 10 * MIN } } } }).items[0])
      .toMatchObject({ sinAviso: true });
  });

  it('el tope de derivaciones por hora sale de la configuración', () => {
    const dos = { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - 10 * MIN] } } };
    expect(avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: dos, cfg: { topeTransferenciasHora: 2 } }).items[0]).toMatchObject({ sinAviso: false });
  });

  it('sin destinatarios válidos (o el único es quien escribe) no hay aviso y se anota', () => {
    const propio = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { cfg: { destinatariosAviso: `completo:${CLIENTE}` } });
    expect(propio.items[0]).toMatchObject({ sinAviso: true });
    expect(String((propio.items[0]!['errores'] as string[])[0])).toContain('sin_destinatarios_de_aviso');
    const marcador = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { cfg: { destinatariosAviso: 'completo:REEMPLAZAR_NUMERO_AVISO_1_QTACO' } });
    expect(marcador.items[0]).toMatchObject({ sinAviso: true });
    const extranjero = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { cfg: { destinatariosAviso: 'completo:54100000021' } });
    expect(extranjero.items[0]).toMatchObject({ sinAviso: true });
  });

  it('modo prueba: todo va a telefonoDePrueba con el prefijo «[al restaurante]»', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { detalle: 'Detalle.' } } }, { cfg: { modoPrueba: true, telefonoDePrueba: PRUEBA } });
    expect(r.items.map((i) => i['para'])).toEqual([PRUEBA, PRUEBA, PRUEBA]);
    expect(r.items.map((i) => i['payload'].to)).toEqual([PRUEBA, PRUEBA, PRUEBA]);
    expect(r.items[0]!['payload'].template.components[0].parameters[0].text.startsWith('[al restaurante] ')).toBe(true);
    expect(r.items[2]!['payload'].text.body.startsWith('[al restaurante] ')).toBe(true);
    // el opuesto: fuera del modo prueba, nada de prefijo y a los destinatarios reales
    const real = avisos({ aviso: { tipo: 'pedido', datos: { detalle: 'Detalle.' } } });
    expect(JSON.stringify(real.items)).not.toContain('[al restaurante]');
    expect(real.items.map((i) => i['para'])).toEqual([AV1, AV2, AV1]);
    // modo prueba sin teléfono de prueba: no sale nada, y se anota
    const sinTel = avisos({ aviso: { tipo: 'pedido', datos: {} } }, { cfg: { modoPrueba: true } });
    expect(sinTel.items[0]).toMatchObject({ sinAviso: true });
  });

  it('el respaldo es un payload Graph completo: un texto se envuelve, un nulo queda nulo', () => {
    const conTexto = avisos({ aviso: { tipo: 'pedido', datos: { respaldo: 'Pedido nuevo: revisen el chat.' } } });
    expect(conTexto.items[0]!['respaldo']).toMatchObject({ messaging_product: 'whatsapp', to: AV1, type: 'text', text: { body: 'Pedido nuevo: revisen el chat.' } });
    expect(conTexto.items[1]!['respaldo'].to).toBe(AV2);
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }).items[0]!['respaldo']).toBeNull();
    const prohibido = avisos({ aviso: { tipo: 'pedido', datos: { respaldo: 'Pedido pagado.' } } });
    expect(PROHIBIDAS.test(prohibido.items[0]!['respaldo'].text.body)).toBe(false);
    const prueba = avisos({ aviso: { tipo: 'pedido', datos: { respaldo: 'Pedido nuevo.' } } }, { cfg: { modoPrueba: true, telefonoDePrueba: PRUEBA } });
    expect(prueba.items[0]!['respaldo'].text.body.startsWith('[al restaurante] ')).toBe(true);
  });

  it('acepta que avArmar entregue {items, errores} y anota sus errores', () => {
    const r = avisos({ aviso: { tipo: 'pedido', datos: { envuelto: true } } });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!['errores']).toContain('nota de avisos');
  });

  it('NO escribe estado, ni cuenta avisos, ni anota reservas: eso es de Armar mensajes', () => {
    const r = avisos({ estadoNuevo: { paso: 'menu' }, pedido: PEDIDO, aviso: { tipo: 'reserva', datos: {} }, cierre: { tipo: 'registro', detalle: 'x' } });
    expect(r.sd).toEqual({});
    expect(r.bit.filter((b) => b[0] !== 'avArmar')).toEqual([]);
  });
});

// =================================================================================================
describe('Armar avisos — clase de cada ítem, imagen del comprobante y datos', () => {
  const comprobante = (datos: J = {}): J => ({ pedido: PEDIDO, aviso: { tipo: 'comprobante', datos: { resultado: 'cuadra', ...datos } } });

  it('cada ítem lleva su clase: plantilla, detalle o imagen', () => {
    const r = avisos(comprobante({ detalle: 'Detalle.', imagen: true, mediaId: 'media-1' }));
    expect(r.items.map((i) => [i['clase'], i['esPlantilla']])).toEqual([['plantilla', true], ['plantilla', true], ['detalle', false], ['imagen', false]]);
    expect(avisos(comprobante()).items.map((i) => i['clase'])).toEqual(['plantilla', 'plantilla']);
  });

  it('la imagen del comprobante pasa tal cual (con su id) y su pie por la red de palabras', () => {
    const r = avisos(comprobante({ imagen: true, mediaId: 'media-1', pieImagen: 'Comprobante de Ana.' }));
    expect(r.items[2]!['payload']).toMatchObject({ type: 'image', to: AV1, image: { id: 'media-1', caption: 'Comprobante de Ana.' } });
    const malo = avisos(comprobante({ imagen: true, mediaId: 'media-1', pieImagen: 'Pago verificado' }));
    expect(malo.items[2]!['payload'].image.caption).toBe('Comprobante enviado por el cliente.');
    expect((malo.items[0]!['errores'] as string[]).some((e) => e.startsWith('pie_de_imagen_reemplazado'))).toBe(true);
  });

  it('modo prueba: la imagen va a telefonoDePrueba con el prefijo en su pie, aunque venga sin pie', () => {
    const r = avisos(comprobante({ imagen: true, mediaId: 'media-1', pieImagen: '' }), { cfg: { modoPrueba: true, telefonoDePrueba: PRUEBA } });
    expect(r.items[2]!['payload'].to).toBe(PRUEBA);
    expect(r.items[2]!['payload'].image.caption).toBe('[al restaurante]');
  });

  it('pasa a avArmar codigo, nombre, telefono, direccion, referencia, mediaId, diferencias y motivo', () => {
    const entrega = { ...PEDIDO, direccion: 'Calle 1 #2', referencia: 'portón verde', nombre: 'Luis', mediaId: 'media-ped' };
    const r = avisos({ pedido: entrega, aviso: { tipo: 'comprobante', datos: { resultado: 'no_cuadra', diferencias: ['monto'], motivo: 'x' } } });
    expect(r.bit.find((b) => b[0] === 'avArmar')![2]).toMatchObject({
      codigo: 'K7Q2', nombre: 'Luis', telefono: CLIENTE, from: CLIENTE, direccion: 'Calle 1 #2', referencia: 'portón verde',
      mediaId: 'media-ped', diferencias: ['monto'], motivo: 'x', resultado: 'no_cuadra',
    });
  });

  it('con los campos de T7a (from y nombrePerfil en datos) el nombre y el teléfono salen de ahí', () => {
    const r = avisos({ aviso: { tipo: 'reserva', datos: { from: CLIENTE, nombrePerfil: 'Ana Perfil', codigo: 'R1', reserva: { personas: 4 } } } });
    expect(r.bit.find((b) => b[0] === 'avArmar')![2]).toMatchObject({ codigo: 'R1', nombre: 'Ana Perfil', telefono: CLIENTE, reserva: { personas: 4 } });
  });

  it('el mediaId del comprobante sale de la entrada del turno, y solo para el aviso de comprobante', () => {
    const c = avisos(comprobante(), { t: { mediaId: 'media-turno' } });
    expect((c.bit.find((b) => b[0] === 'avArmar')![2] as J)['mediaId']).toBe('media-turno');
    const p = avisos({ pedido: PEDIDO, aviso: { tipo: 'pedido', datos: {} } }, { t: { mediaId: 'media-turno' } });
    expect((p.bit.find((b) => b[0] === 'avArmar')![2] as J)['mediaId']).toBeUndefined();
    const conPlan = avisos(comprobante({ mediaId: 'media-plan' }), { t: { mediaId: 'media-turno' } });
    expect((conPlan.bit.find((b) => b[0] === 'avArmar')![2] as J)['mediaId']).toBe('media-plan');
  });

  it('un comprobante ya cotejado no arma aviso y lo anota', () => {
    const r = avisos(comprobante({ resultado: 'ya_cotejado' }));
    expect(r.items[0]).toMatchObject({ sinAviso: true });
    expect((r.items[0]!['errores'] as string[]).includes('sin_aviso_ya_cotejado')).toBe(true);
    expect(r.bit.some((b) => b[0] === 'avArmar')).toBe(false);
    // el opuesto: cualquier otro resultado avisa
    for (const resultado of ['cuadra', 'no_cuadra', 'ilegible', 'sin_cotejo']) {
      expect(avisos(comprobante({ resultado })).items[0]).toMatchObject({ sinAviso: false });
    }
  });

  it('un ítem de clase desconocida se deduce: imagen por su payload, plantilla por esPlantilla', () => {
    const sinClase = ['function avArmar(tipo, datos, dest) { return [',
      '{ para: dest[0].tel, rol: dest[0].rol, payload: { type: "template", template: { components: [] } }, respaldo: null, esPlantilla: true },',
      '{ para: dest[0].tel, rol: dest[0].rol, payload: { type: "text", text: { body: "Detalle." } }, respaldo: null, esPlantilla: false },',
      '{ para: dest[0].tel, rol: dest[0].rol, payload: { type: "image", image: { id: "m" } }, respaldo: null, esPlantilla: false }]; }'].join('\n');
    const r = nodo(AVISOS, { plan: { aviso: { tipo: 'pedido', datos: {} } }, extra: sinClase });
    expect(r.items.map((i) => i['clase'])).toEqual(['plantilla', 'detalle', 'imagen']);
  });
});

// =================================================================================================
describe('Armar mensajes — mensajes, botones, enlace y modo prueba', () => {
  it('un texto al cliente: ítem con payload Graph, para el cliente, reportable', () => {
    const r = mensajes({ ruta: 'menu', mensajes: [texto('¡Hola! Soy el asistente virtual de Q\' Taco.')] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      para: CLIENTE, destino: 'cliente', tipoReporte: 'text', reportar: true, sinMensajes: false, from: CLIENTE,
      phoneNumberId: 'PNID_PRUEBA', waGraphVersion: 'v26.0', texto: "¡Hola! Soy el asistente virtual de Q' Taco.",
    });
    expect(r.items[0]!['payload']).toMatchObject({ messaging_product: 'whatsapp', to: CLIENTE, type: 'text' });
    expect(r.items[0]!['evento']).toBeUndefined();
  });

  it('botones: como mucho 3, título de 20 caracteres, y un respaldo en texto', () => {
    const r = mensajes({ mensajes: [botones('¿Qué quieres hacer?', 'Hacer un pedido', 'Reservar mesa', 'Un título larguísimo que no cabe', 'Cuarto')] });
    const bs = r.items[0]!['payload'].interactive.action.buttons;
    expect(bs).toHaveLength(3);
    expect(bs[2].reply.title.length).toBeLessThanOrEqual(20);
    expect(r.items[0]).toMatchObject({ tipoReporte: 'interactive' });
    expect(r.items[0]!['respaldo']).toContain('¿Qué quieres hacer?');
    expect(r.items[0]!['respaldo']).toContain('escribe «menu»');
  });

  it('botones sin ids válidos caen a texto; un id de más de 256 caracteres se descarta', () => {
    const r = mensajes({ mensajes: [{ tipo: 'botones', cuerpo: 'Elige', botones: [{ id: 'x'.repeat(257), title: 'Largo' }, { id: '', title: 'Vacío' }] }] });
    expect(r.items[0]!['payload'].type).toBe('text');
  });

  it('enlace con número de recepción válido: botón «Escribir al local» que abre su chat', () => {
    const r = mensajes({ mensajes: [enlace(GENERICO)] });
    const i = r.items[0]!;
    expect(i['payload'].interactive.type).toBe('cta_url');
    expect(i['payload'].interactive.action.parameters.display_text).toBe('Escribir al local');
    expect(i['payload'].interactive.action.parameters.url).toContain(`https://wa.me/${REC}?text=`);
    expect(i['respaldo']).toContain(`https://wa.me/${REC}`);
    expect(i['texto']).toBe(GENERICO);
  });

  it('enlace con una URL del plan: se usa si es https y no es el chat del propio cliente', () => {
    const buena = mensajes({ mensajes: [enlace(GENERICO, { url: 'https://wa.me/59100000055?text=Hola' })] });
    expect(buena.items[0]!['payload'].interactive.action.parameters.url).toBe('https://wa.me/59100000055?text=Hola');
    const propia = mensajes({ mensajes: [enlace(GENERICO, { url: `https://wa.me/${CLIENTE}` })] });
    expect(propia.items[0]!['payload'].interactive.action.parameters.url).toContain(`wa.me/${REC}`);
    const http = mensajes({ mensajes: [enlace(GENERICO, { url: 'http://wa.me/59100000055' })] });
    expect(http.items[0]!['payload'].interactive.action.parameters.url).toContain(`wa.me/${REC}`);
  });

  it('sin número de recepción válido (marcador, vacío o el propio cliente) se quita la frase del botón', () => {
    for (const numeroRecepcion of ['REEMPLAZAR_NUMERO_RECEPCION_QTACO', '', CLIENTE]) {
      const r = mensajes({ mensajes: [enlace(GENERICO)] }, { cfg: { numeroRecepcion } });
      const i = r.items[0]!;
      expect(i['payload'].type).toBe('text');
      expect(i['payload'].text.body).toBe('Eso lo ve directamente el restaurante.');
      expect(i['tipoReporte']).toBe('text');
      expect(JSON.stringify(i)).not.toMatch(/bot[oó]n/i);
    }
    // el texto con «:» conserva lo que viene antes del «:»
    const r = mensajes({ mensajes: [enlace('No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.')] }, { cfg: { numeroRecepcion: '' } });
    expect(r.items[0]!['payload'].text.body).toBe('No pude pasarle tu pedido al restaurante en este momento.');
    const dos = mensajes({ mensajes: [enlace('Ya tengo el comprobante de tu pedido #K7Q2. Si necesitas algo más, toca el botón.')] }, { cfg: { numeroRecepcion: '' } });
    expect(dos.items[0]!['payload'].text.body).toBe('Ya tengo el comprobante de tu pedido #K7Q2.');
  });

  it('modo prueba: a telefonoDePrueba, sin prefijo y sin reportar; fuera de prueba, reportable', () => {
    const r = mensajes({ mensajes: [texto('Hola'), enlace(GENERICO)] }, { cfg: { modoPrueba: true, telefonoDePrueba: PRUEBA } });
    expect(r.items.map((i) => i['para'])).toEqual([PRUEBA, PRUEBA]);
    expect(r.items.map((i) => i['payload'].to)).toEqual([PRUEBA, PRUEBA]);
    expect(r.items.map((i) => i['reportar'])).toEqual([false, false]);
    expect(JSON.stringify(r.items)).not.toContain('[al restaurante]');
    const real = mensajes({ mensajes: [texto('Hola'), enlace(GENERICO)] });
    expect(real.items.map((i) => i['reportar'])).toEqual([true, true]);
    expect(real.items.map((i) => i['para'])).toEqual([CLIENTE, CLIENTE]);
  });

  it('un mensaje sin cuerpo se ignora; si se ignoran todos, sale la derivación y no el silencio', () => {
    const uno = mensajes({ mensajes: [texto(''), texto('Hola')] });
    expect(uno.items).toHaveLength(1);
    expect(uno.items[0]!['texto']).toBe('Hola');
    const todos = mensajes({ mensajes: [texto('   ')] });
    expect(todos.items).toHaveLength(1);
    expect(cuerpoDe(todos.items[0]!)).toBe(GENERICO);
  });

  it('un evento que no es qr_enviado pasa con su referencia y monto; qr_enviado en un texto se quita', () => {
    const r = mensajes({ mensajes: [texto('Listo', { evento: 'pedido_pasado', referencia: 'ref-1', monto: 12.5 }), texto('Otro', { evento: 'qr_enviado', referencia: 'x', monto: 5 })] });
    expect(r.items[0]).toMatchObject({ evento: 'pedido_pasado', referencia: 'ref-1', monto: 12.5 });
    expect(r.items[1]!['evento']).toBeUndefined();
    expect(r.items[1]!['monto']).toBeUndefined();
  });

  it('sin mensajes: un ítem sinMensajes que lleva el resumen y el cierre', () => {
    const r = mensajes({ ruta: 'nada', mensajes: [], cierre: { tipo: 'registro', detalle: 'Solicitud X' }, pedido: PEDIDO });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ sinMensajes: true, payload: null, reportar: false });
    expect(r.items[0]!['cierre']).toMatchObject({ tipo: 'registro', detalle: 'Solicitud X' });
    expect(r.items[0]!['resumen']).toMatchObject({ ruta: 'nada', mensajesSalientes: 0 });
  });
});

// =================================================================================================
describe('Armar mensajes — el QR', () => {
  const planQr = (mensaje: J = qr(), extra: J = {}): J => ({
    ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [mensaje], ...extra,
  });

  it('QR válido: imagen con enlace https, pie, qr_enviado, referencia = pedidoId y monto = total', () => {
    const r = mensajes(planQr());
    const i = r.items[0]!;
    expect(i['payload']).toMatchObject({ type: 'image', to: CLIENTE, image: { link: 'https://qr.ejemplo.test/qtaco.png', caption: PIE } });
    expect(i).toMatchObject({ evento: 'qr_enviado', referencia: PEDIDO['pedidoId'], monto: 55, tipoReporte: 'image', reportar: true });
    expect(typeof i['monto']).toBe('number');
    expect(i['respaldo']).toBe(`${PIE}\n\nAbre el QR aquí: https://qr.ejemplo.test/qtaco.png`);
    expect(r.sd['estados'][CLIENTE].paso).toBe('esperando_comprobante');
    expect(r.sd['pedidos'][PEDIDO['pedidoId']]).toMatchObject({ total: 55, guardadoMs: AHORA });
  });

  it('el enlace sale de cfg.cobro.qrUrl y no de lo que traiga el mensaje del plan', () => {
    const r = mensajes(planQr(qr({ url: 'https://otro.ejemplo.test/falso.png' })));
    expect(r.items[0]!['payload'].image.link).toBe('https://qr.ejemplo.test/qtaco.png');
  });

  it.each([
    ['enlace http', { cfg: { cobro: { activo: true, qrUrl: 'http://qr.ejemplo.test/a.png' } } }, qr(), 'qr_sin_https'],
    ['sin enlace', { cfg: { cobro: { activo: true, qrUrl: '' } } }, qr(), 'qr_sin_https'],
    ['cobro apagado', { cfg: { cobro: { activo: false, qrUrl: 'https://qr.ejemplo.test/a.png' } } }, qr(), 'cobro_no_activo'],
    ['sin monto', {}, qr({ monto: undefined }), 'qr_sin_monto'],
    ['monto cero', {}, qr({ monto: 0 }), 'qr_sin_monto'],
    ['monto distinto del total', {}, qr({ monto: 999 }), 'qr_monto_distinto_del_total'],
    ['referencia distinta del pedido', {}, qr({ referencia: 'ped-otro' }), 'qr_referencia_distinta'],
  ])('rechaza el QR: %s. Sale la derivación, no se guarda esperando_comprobante ni el pedido', (_n, ent, mensaje, motivo) => {
    const r = mensajes(planQr(mensaje as J), ent as Entrada);
    const i = r.items[0]!;
    expect(i['payload'].type).not.toBe('image');
    expect(i['evento']).toBeUndefined();
    expect(i['monto']).toBeUndefined();
    expect(cuerpoDe(i)).toBe(GENERICO);
    expect((r.items[0]!['errores'] as string[]).some((e) => e === `qr_rechazado: ${motivo}`)).toBe(true);
    expect(r.items[0]!['resumen']).toMatchObject({ qrRechazado: true });
    expect(r.sd['estados']).toBeUndefined();
    expect(r.sd['pedidos']).toBeUndefined();
    expect(r.bit.some((b) => b[0] === 'escribirEstado')).toBe(false);
  });

  it('un pedido sin total o sin pedidoId no manda QR', () => {
    const sinTotal = mensajes(planQr(qr(), { pedido: { pedidoId: 'ped-x' } }));
    expect(sinTotal.items[0]!['payload'].type).not.toBe('image');
    const sinId = mensajes(planQr(qr({ referencia: undefined }), { pedido: { total: 55 } }));
    expect(sinId.items[0]!['payload'].type).not.toBe('image');
  });

  it('el monto redondea a centavos y la comparación no se rompe con 0,1 + 0,2', () => {
    const r = mensajes(planQr(qr({ monto: 0.1 + 0.2 }), { pedido: { ...PEDIDO, total: 0.3 } }));
    expect(r.items[0]!['payload'].type).toBe('image');
    expect(r.items[0]!['monto']).toBe(0.3);
  });

  it('un QR rechazado no impide que otros estados se guarden', () => {
    const r = mensajes(planQr(qr({ monto: 1 }), { estadoNuevo: { paso: 'pedido_confirmar' } }));
    expect(r.sd['estados'][CLIENTE].paso).toBe('pedido_confirmar');
  });
});

// =================================================================================================
describe('Armar mensajes — el aviso salió (por hecho) y la defensa extra', () => {
  const PASE = 'Listo: pasé tu pedido #K7Q2 al restaurante. El pago lo coordinas con ellos al recoger.';
  const NO_PASE = 'No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.';
  const plan = (): J => ({
    ruta: 'confirmar', pedido: PEDIDO, aviso: { tipo: 'pedido', datos: {} }, mensajes: [],
    condicionados: { siSalio: [texto(PASE)], siNoSalio: [enlace(NO_PASE)] },
  });
  const armados = [armado('pedido', { para: AV1 }), armado('pedido', { para: AV2, rol: 'cocina' })];

  it('con un wamid en «Enviar aviso» sale siSalio', () => {
    const r = mensajes(plan(), { armados, enviados: [OK(1), FALLA] });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!['texto']).toBe(PASE);
    expect(r.items[0]!['resumen']).toMatchObject({ avisoSalio: true, avisosConWamid: 1 });
  });

  it('con un wamid solo en «Aviso de respaldo» también sale siSalio', () => {
    const r = mensajes(plan(), { armados, enviados: [FALLA, FALLA], respaldos: [OK(2)] });
    expect(r.items[0]!['texto']).toBe(PASE);
  });

  it.each([
    ['las dos plantillas y los respaldos fallan', { armados, enviados: [FALLA, FALLA], respaldos: [FALLA] }],
    ['respuesta vacía de Meta', { armados, enviados: [{}, { messages: [] }] }],
    ['un messages sin id', { armados, enviados: [{ messages: [{}] }] }],
    ['el aviso no se envió (nodo sin ejecutar)', { armados }],
    ['no había aviso que enviar (sinAviso)', { armados: [SIN_AVISO] }],
    ['Armar avisos no corrió', {}],
  ])('SIN wamid (%s): sale siNoSalio y NUNCA «pasé tu pedido»', (_n, ent) => {
    const r = mensajes(plan(), ent as Entrada);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!['payload'].type).toBe('interactive');
    expect(r.items[0]!['texto']).toBe(NO_PASE);
    expect(JSON.stringify(r.items)).not.toMatch(/pas[eé] tu pedido/i);
    expect(r.items[0]!['resumen']).toMatchObject({ avisoSalio: false });
  });

  describe('la imagen del comprobante no cuenta como «el aviso»', () => {
    const conImagen = [armado('comprobante', { para: AV1, clase: 'plantilla' }), armado('comprobante', { para: AV2, rol: 'cocina', clase: 'plantilla' }),
      armado('comprobante', { para: AV1, clase: 'imagen', esPlantilla: false, payload: { type: 'image' } })];

    it('solo con el wamid de la imagen NO salió: sale siNoSalio y el tope cuenta el mensaje', () => {
      const r = mensajes(plan(), { armados: conImagen, enviados: [FALLA, FALLA, OK(3)] });
      expect(r.items[0]!['texto']).toBe(NO_PASE);
      expect(r.items[0]!['resumen']).toMatchObject({ avisoSalio: false, avisosConWamid: 1 });
      expect(r.sd['avisosDia']).toBe(1);
    });

    it('con una plantilla que salió y la imagen rechazada, el aviso SALIÓ', () => {
      const r = mensajes(plan(), { armados: conImagen, enviados: [OK(1), FALLA, FALLA] });
      expect(r.items[0]!['texto']).toBe(PASE);
    });

    it('con plantilla e imagen aceptadas, salió y se cuentan los dos mensajes', () => {
      const r = mensajes(plan(), { armados: conImagen, enviados: [OK(1), FALLA, OK(3)] });
      expect(r.items[0]!['texto']).toBe(PASE);
      expect(r.sd['avisosDia']).toBe(2);
    });

    it('la imagen se reconoce también por su payload cuando el ítem no trae clase', () => {
      const sinClase = [armado('comprobante', { clase: undefined }), armado('comprobante', { clase: undefined, payload: { type: 'image' } })];
      expect(mensajes(plan(), { armados: sinClase, enviados: [FALLA, OK(2)] }).items[0]!['texto']).toBe(NO_PASE);
      expect(mensajes(plan(), { armados: sinClase, enviados: [OK(1), FALLA] }).items[0]!['texto']).toBe(PASE);
    });

    it('si no se pueden emparejar los envíos con los avisos, solo cuenta cuando hay más wamid que imágenes', () => {
      // 3 armados (1 imagen) y 2 envíos: no se empareja
      expect(mensajes(plan(), { armados: conImagen, enviados: [OK(1), OK(2)] }).items[0]!['texto']).toBe(PASE);
      const dosImagenes = [armado('comprobante', { clase: 'imagen' }), armado('comprobante', { clase: 'imagen' }), armado('comprobante', { clase: 'imagen' })];
      expect(mensajes(plan(), { armados: dosImagenes, enviados: [OK(1)] }).items[0]!['texto']).toBe(NO_PASE);
    });

    it('la marca de derivación y rsAnotar tampoco se activan solo por una imagen', () => {
      const t = [armado('transferencia', { clase: 'plantilla' }), armado('transferencia', { clase: 'imagen' })];
      const r = mensajes({ mensajes: [texto('Hola')], aviso: { tipo: 'transferencia', datos: {} } }, { armados: t, enviados: [FALLA, OK(2)] });
      expect(r.sd['transferencias']).toBeUndefined();
      const rs = [armado('reserva', { clase: 'plantilla' }), armado('reserva', { clase: 'imagen' })];
      expect(mensajes({ mensajes: [texto('Hola')] }, { armados: rs, enviados: [FALLA, OK(2)] }).bit.some((b) => b[0] === 'rsAnotar')).toBe(false);
    });
  });

  it('un error de Graph con un id suelto no cuenta: solo cuenta messages[0].id', () => {
    const r = mensajes(plan(), { armados, enviados: [{ error: { message: 'x' }, id: 'wamid.FALSO' }] });
    expect(r.items[0]!['texto']).toBe(NO_PASE);
  });

  it('sin condicionados no se agrega nada; con condicionados nulo tampoco', () => {
    const r = mensajes({ mensajes: [texto('Hola')], condicionados: null }, { armados, enviados: [OK()] });
    expect(r.items.map((i) => i['texto'])).toEqual(['Hola']);
  });

  it('los mensajes base van primero y el condicionado después', () => {
    const r = mensajes({ ...plan(), mensajes: [texto('Recibí tu comprobante.')] }, { armados, enviados: [OK()] });
    expect(r.items.map((i) => i['texto'])).toEqual(['Recibí tu comprobante.', PASE]);
  });

  it.each([
    ['Ya pasé tu pedido al restaurante.'],
    ['Listo, pasé tu pedido #K7Q2 al restaurante.'],
    ['Tu solicitud de reserva llegó al restaurante.'],
    ['Ya pasé tu comprobante.'],
  ])('defensa: «%s» en un mensaje normal SIN aviso salido se reemplaza por la derivación', (frase) => {
    const sin = mensajes({ mensajes: [texto(frase)] });
    expect(cuerpoDe(sin.items[0]!)).toBe(GENERICO);
    expect((sin.items[0]!['errores'] as string[]).includes('pase_afirmado_sin_aviso_salido')).toBe(true);
    // el opuesto: con el aviso salido, la frase se queda
    const con = mensajes({ mensajes: [texto(frase)] }, { armados: [armado('pedido')], enviados: [OK()] });
    expect(con.items[0]!['texto']).toBe(frase);
  });

  it('defensa: una negación honesta («No pude pasarle…») nunca se reemplaza', () => {
    const r = mensajes({ mensajes: [texto('No pude pasarle tu pedido al restaurante en este momento.')] });
    expect(r.items[0]!['texto']).toBe('No pude pasarle tu pedido al restaurante en este momento.');
    expect(r.items[0]!['errores']).toEqual([]);
  });

  it('cuenta los avisos con wamid en el tope diario, y no cuenta si no hubo ninguno', () => {
    const tres = mensajes({ mensajes: [texto('Hola')] }, { armados, enviados: [OK(1), OK(2)], respaldos: [OK(3)] });
    expect(tres.bit.filter((b) => b[0] === 'avContar')).toEqual([['avContar', 3]]);
    expect(tres.sd['avisosDia']).toBe(3);
    const ninguno = mensajes({ mensajes: [texto('Hola')] }, { armados, enviados: [FALLA, FALLA] });
    expect(ninguno.bit.some((b) => b[0] === 'avContar')).toBe(false);
  });
});

// =================================================================================================
describe('Armar mensajes — marcas de derivación y de reservas (solo si el aviso salió)', () => {
  const plan = (tipo: string): J => ({ ruta: 'x', mensajes: [texto('Hola')], aviso: { tipo, datos: {} } });

  it('la derivación escribe su marca solo si el aviso de derivación salió', () => {
    const salio = mensajes(plan('transferencia'), { armados: [armado('transferencia')], enviados: [OK()] });
    expect(salio.sd['transferencias'][CLIENTE]).toEqual([AHORA]);
    const cayo = mensajes(plan('transferencia'), { armados: [armado('transferencia')], enviados: [FALLA] });
    expect(cayo.sd['transferencias']).toBeUndefined();
    const sinAviso = mensajes(plan('transferencia'), { armados: [SIN_AVISO] });
    expect(sinAviso.sd['transferencias']).toBeUndefined();
  });

  it('un aviso de pedido que salió no marca derivación; el de derivación que salió, sí (por posición)', () => {
    const pedidoSalio = mensajes(plan('pedido'), { armados: [armado('pedido')], enviados: [OK()] });
    expect(pedidoSalio.sd['transferencias']).toBeUndefined();
    const dos = [armado('pedido'), armado('transferencia')];
    expect(mensajes(plan('x'), { armados: dos, enviados: [OK(), FALLA] }).sd['transferencias']).toBeUndefined();
    expect(mensajes(plan('x'), { armados: dos, enviados: [FALLA, OK()] }).sd['transferencias'][CLIENTE]).toEqual([AHORA]);
  });

  it('la marca conserva las de la última hora y descarta las vencidas', () => {
    const g = { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - 2 * HORA], '59100000099': [AHORA - 3 * HORA], '59100000098': [AHORA - 10 * MIN] } } };
    const r = mensajes(plan('transferencia'), { g, armados: [armado('transferencia')], enviados: [OK()] });
    expect(r.sd['transferencias'][CLIENTE]).toEqual([AHORA]);
    expect(r.sd['transferencias']['59100000099']).toBeUndefined();
    expect(r.sd['transferencias']['59100000098']).toEqual([AHORA - 10 * MIN]);
  });

  it('rsAnotar corre cuando el aviso de reserva salió, y solo entonces', () => {
    const salio = mensajes(plan('reserva'), { armados: [armado('reserva')], enviados: [OK()] });
    expect(salio.bit.filter((b) => b[0] === 'rsAnotar')).toEqual([['rsAnotar', CLIENTE]]);
    expect(salio.sd['reservasDia']).toBe(1);
    const cayo = mensajes(plan('reserva'), { armados: [armado('reserva')], enviados: [FALLA] });
    expect(cayo.bit.some((b) => b[0] === 'rsAnotar')).toBe(false);
    const sinAviso = mensajes(plan('reserva'), { armados: [SIN_AVISO] });
    expect(sinAviso.bit.some((b) => b[0] === 'rsAnotar')).toBe(false);
    const otroTipo = mensajes(plan('pedido'), { armados: [armado('pedido')], enviados: [OK()] });
    expect(otroTipo.bit.some((b) => b[0] === 'rsAnotar')).toBe(false);
  });
});

// =================================================================================================
describe('Armar mensajes — estado, pedido guardado y cierre (el único que escribe)', () => {
  it('escribe el estado con vmBarrer antes de vmEscribirEstado; «nada» y sin estadoNuevo no escriben', () => {
    const r = mensajes({ ruta: 'menu', estadoNuevo: { paso: 'menu' }, mensajes: [texto('Hola')] });
    const pasos = r.bit.map((b) => b[0]);
    expect(pasos.indexOf('barrer')).toBeGreaterThanOrEqual(0);
    expect(pasos.indexOf('barrer')).toBeLessThan(pasos.indexOf('escribirEstado'));
    expect(r.bit.find((b) => b[0] === 'escribirEstado')).toEqual(['escribirEstado', CLIENTE, 'menu']);
    expect(r.items[0]!['resumen']).toMatchObject({ estadoDespues: { paso: 'menu' } });
    const nada = mensajes({ ruta: 'nada', estadoNuevo: { paso: 'menu' }, mensajes: [texto('Hola')] });
    expect(nada.bit.some((b) => b[0] === 'escribirEstado')).toBe(false);
    const sin = mensajes({ ruta: 'menu', estadoNuevo: null, mensajes: [texto('Hola')] });
    expect(sin.bit.some((b) => b[0] === 'escribirEstado')).toBe(false);
    const claveMala = mensajes({ ruta: 'menu', estadoNuevo: { paso: 'menu' }, mensajes: [texto('Hola')] }, { t: { from: 'abc' } });
    expect(claveMala.bit.some((b) => b[0] === 'escribirEstado')).toBe(false);
  });

  it('el estado es por teléfono: dos clientes no comparten', () => {
    const g: J = {};
    mensajes({ ruta: 'm', estadoNuevo: { paso: 'pedido' }, mensajes: [texto('a')] }, { g });
    mensajes({ ruta: 'm', estadoNuevo: { paso: 'reserva' }, mensajes: [texto('b')] }, { g, t: { from: '59100000012' } });
    expect(g['ventaMinima'].estados[CLIENTE].paso).toBe('pedido');
    expect(g['ventaMinima'].estados['59100000012'].paso).toBe('reserva');
  });

  it('guarda el pedido con guardadoMs y lo fusiona en el turno siguiente (mediaId, resultado)', () => {
    const g: J = {};
    mensajes({ ruta: 'm', pedido: PEDIDO, mensajes: [texto('a')] }, { g });
    expect(g['ventaMinima'].pedidos[PEDIDO['pedidoId']]).toMatchObject({ total: 55, codigo: 'K7Q2', guardadoMs: AHORA });
    mensajes({ ruta: 'm', pedido: { pedidoId: PEDIDO['pedidoId'], mediaId: 'media-1', resultado: 'cuadra' }, mensajes: [texto('b')] }, { g, t: { ahoraMs: AHORA + 5 * MIN } });
    expect(g['ventaMinima'].pedidos[PEDIDO['pedidoId']]).toMatchObject({
      total: 55, lineas: PEDIDO['lineas'], mediaId: 'media-1', resultado: 'cuadra', guardadoMs: AHORA + 5 * MIN,
    });
  });

  it('los pedidos de más de 72 horas se borran; los de menos, no', () => {
    const g = { ventaMinima: { pedidos: { viejo: { guardadoMs: AHORA - 73 * HORA }, reciente: { guardadoMs: AHORA - 71 * HORA }, roto: null } } };
    const r = mensajes({ ruta: 'm', mensajes: [texto('a')] }, { g });
    expect(Object.keys(r.sd['pedidos'])).toEqual(['reciente']);
  });

  it('sin datos estáticos (vmSd da null) el turno responde igual, sin estado ni conteo', () => {
    const sinSd = 'function vmSd() { return null; }';
    const r = nodo(MENSAJES, { plan: { ruta: 'm', estadoNuevo: { paso: 'menu' }, pedido: PEDIDO, mensajes: [texto('Hola')] }, extra: sinSd });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!['texto']).toBe('Hola');
    expect(r.bit).toEqual([]);
    const a = nodo(AVISOS, { plan: { aviso: { tipo: 'pedido', datos: {} } }, extra: sinSd });
    expect(a.items).toHaveLength(2);
    expect(a.items[0]!['errores']).toEqual(['sin_datos_estaticos: no se pudo comprobar el tope de avisos']);
  });

  it('el cierre va solo en el primer ítem, con referencia = primer wamid del aviso', () => {
    const r = mensajes({ ruta: 'm', pedido: PEDIDO, mensajes: [texto('a'), texto('b')], cierre: { tipo: 'registro', detalle: 'Pedido K7Q2 sin QR: cobrar al recoger.' } },
      { armados: [armado('pedido')], enviados: [OK(7)] });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!['cierre']).toEqual({ tipo: 'registro', detalle: 'Pedido K7Q2 sin QR: cobrar al recoger.', referencia: 'wamid.AVISO7' });
    expect(r.items[1]!['cierre']).toBeUndefined();
  });

  it('la referencia del cierre cae a pedidoId y luego a mensajeId si no hubo wamid', () => {
    const cierre = { tipo: 'registro', detalle: 'x' };
    expect(mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe(PEDIDO['pedidoId']);
    expect(mensajes({ mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe('wamid.ENTRANTE1');
  });

  it('el detalle del cierre se recorta a 300 caracteres y pasa por vmTextoSeguro', () => {
    const largo = mensajes({ mensajes: [texto('a')], cierre: { tipo: 'registro', detalle: 'abc '.repeat(200) } });
    expect(largo.items[0]!['cierre'].detalle.length).toBeLessThanOrEqual(300);
    const malo = mensajes({ mensajes: [texto('a')], cierre: { tipo: 'registro', detalle: 'Pedido pagado y validado' } });
    expect(PROHIBIDAS.test(malo.items[0]!['cierre'].detalle)).toBe(false);
    expect((malo.items[0]!['errores'] as string[]).includes('detalle_de_cierre_reemplazado')).toBe(true);
    const saltos = mensajes({ mensajes: [texto('a')], cierre: { tipo: 'registro', detalle: 'línea 1\nlínea 2 <b>x</b>' } });
    expect(saltos.items[0]!['cierre'].detalle).toBe('línea 1 línea 2 b x /b');
  });

  it('solo se permite un cierre de tipo registro: cita o venta se descartan y se anotan', () => {
    const r = mensajes({ mensajes: [texto('a')], cierre: { tipo: 'venta', detalle: 'x' } });
    expect(r.items[0]!['cierre']).toBeNull();
    expect((r.items[0]!['errores'] as string[]).some((e) => e.startsWith('cierre_de_tipo_no_permitido'))).toBe(true);
  });

  it('arrastra los errores de Armar avisos al resumen', () => {
    const r = mensajes({ mensajes: [texto('a')], errores: ['del plan'] }, { armados: [{ ...SIN_AVISO, errores: ['del plan', 'sin_destinatarios_de_aviso'] }] });
    expect(r.items[0]!['errores']).toEqual(['del plan', 'sin_destinatarios_de_aviso']);
    expect(mensajes({ mensajes: [texto('a')], errores: ['solo plan'] }).items[0]!['errores']).toEqual(['solo plan']);
  });

  it.each([['Uso extendido'], ['Comercio no operativo']])('lee el plan de «%s» cuando no hay «Plan del turno»', (nombre) => {
    const r = mensajes({ ruta: 'u', mensajes: [texto('Gracias por tu paciencia.')] }, { nombrePlan: nombre });
    expect(r.items[0]!['texto']).toBe('Gracias por tu paciencia.');
  });
});

// =================================================================================================
describe('Las diez reglas: nada prohibido sale, en ningún texto', () => {
  const FRASES = [
    'Tu pedido está validado.', 'Pedido confirmado.', 'Pago confirmado.', 'Ya está pagado.', 'Pago acreditado.', 'Datos verificados: verificado.',
    'Recibimos tu pago.', 'Ya lo preparan.', 'Ya lo están preparando.', 'Ya lo estamos preparando.', 'Lo estamos preparando.', 'Lo preparamos enseguida.', 'Te avisamos cuando salga.',
    'Ya va en camino.', 'Te llamamos pronto.', 'Te escribirán en un rato.', 'Lo consulto y te digo.',
  ];

  it('el regex del contrato atrapa cada frase prohibida (el negativo de la red)', () => {
    for (const f of FRASES) expect(PROHIBIDAS.test(f), f).toBe(true);
    expect(PROHIBIDAS.test('Recibí tu comprobante y los datos coinciden con tu pedido.')).toBe(false);
    expect(PROHIBIDAS.test('No estamos abiertos hoy.')).toBe(false);
  });

  it.each(FRASES)('«%s» en un mensaje al cliente se reemplaza por la derivación', (frase) => {
    const r = mensajes({ mensajes: [texto(frase)] });
    expect(cuerpoDe(r.items[0]!)).toBe(GENERICO);
    expect(PROHIBIDAS.test(JSON.stringify(textosDe(r.items[0]!)))).toBe(false);
    expect((r.items[0]!['errores'] as string[]).includes('texto_reemplazado_por_palabra_prohibida')).toBe(true);
  });

  it.each(['Pagado', 'Confirmado', 'Validado', 'Verificado', 'Ya lo preparan', 'En camino', 'Lo consulto', 'Te avisamos', 'Te llamamos'])(
    'el título de botón «%s» reemplaza todo el mensaje por la derivación', (titulo) => {
      const r = mensajes({ mensajes: [botones('Elige', 'Hacer un pedido', titulo)] });
      expect(r.items[0]!['payload'].interactive.action.buttons).toBeUndefined();
      expect(cuerpoDe(r.items[0]!)).toBe(GENERICO);
      expect(PROHIBIDAS.test(JSON.stringify(textosDe(r.items[0]!)))).toBe(false);
      expect((r.items[0]!['errores'] as string[]).includes('boton_reemplazado_por_palabra_prohibida')).toBe(true);
    });

  it('el pie del QR con una palabra prohibida no sale como QR', () => {
    const r = mensajes({ estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [qr({ cuerpo: 'Total pagado: 55 Bs' })] });
    expect(r.items[0]!['payload'].type).not.toBe('image');
    expect(r.sd['estados']).toBeDefined(); // el estado se guarda: el QR no se rechazó por monto sino por texto
  });

  it('el texto inyectado «pago confirmado» dentro de una línea del pedido no llega al cliente', () => {
    const r = mensajes({ mensajes: [texto('Tu pedido:\n• 1 × Birria (pago confirmado): 55 Bs')] });
    expect(PROHIBIDAS.test(cuerpoDe(r.items[0]!))).toBe(false);
  });

  it('25 escenarios: ni un texto, parámetro, título, pie ni detalle coincide con VM_PROHIBIDAS', () => {
    // Los textos fijos del diseño (§5), con aviso salido y sin él, más los avisos de cada tipo.
    const FIJOS = [
      '¡Hola! Soy el asistente virtual de Q\' Taco. ¿Qué quieres hacer?',
      'Esta es nuestra carta:\n\nTacos\n• Orden de 3 tacos de birria: 55 Bs\n\nEscríbeme en un mensaje qué quieres y cuántos.',
      '¿«3 tacos de birria» es 1 orden de 3 (55 Bs) o 3 sueltos (63 Bs)?',
      'No encuentro «micheladas» en la carta. ¿Me lo escribes como figura en la carta?',
      '¿Es para delivery o para recoger en el local?',
      'Para el delivery necesito la dirección. El delivery no va en el QR: se lo pagas al repartidor al recibir tu pedido.',
      'Tu pedido:\n• 1 × Orden de 3 tacos de birria (sin cebolla): 55 Bs\nEntrega: recojo en el local.\nTotal de la comida: 55 Bs.',
      PIE,
      'Recibí tu comprobante y los datos coinciden con tu pedido #K7Q2. Ya pasé tu pedido al restaurante; ellos revisan el pago en su banco antes de despacharlo.',
      'Recibí tu comprobante y los datos coinciden con tu pedido #K7Q2. No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.',
      'Recibí tu comprobante, pero algunos datos no coinciden con tu pedido #K7Q2 (monto). Ya pasé tu pedido y tu comprobante al restaurante para que lo revisen. Si quieres hablar con ellos, toca el botón.',
      'Recibí tu comprobante, pero no pude leerlo bien. ¿Me lo envías de nuevo, más nítido o como PDF desde la app de tu banco?',
      'Ya tengo el comprobante de tu pedido #K7Q2. Si necesitas algo más, toca el botón.',
      'Listo: pasé tu pedido #K7Q2 al restaurante. El pago lo coordinas con ellos al recoger.',
      'Para tu solicitud de reserva dime, en un solo mensaje: cuántas personas, qué día y a qué hora.',
      'Tu solicitud de reserva:\n• viernes 9 de octubre a las 20:00\n• 4 personas, salón\n• A nombre de Ana Prueba',
      'Listo, Ana: tu solicitud de reserva llegó al restaurante. Todavía es una solicitud: el restaurante la revisa según sus mesas. Si quieres hablar con ellos, toca el botón.',
      'No pude hacer llegar tu solicitud al restaurante en este momento. Escríbeles con el botón para reservar.',
      '¡Hola! Qué bueno que viste nuestra promo. Promo Dúo: 2 órdenes. Precio: 99 Bs.',
      'Soy un asistente virtual con inteligencia artificial de Q\' Taco. Si prefieres hablar con una persona del restaurante, toca el botón.',
      GENERICO,
      'Ahora no estamos tomando pedidos. Atendemos de lunes a domingo de 12:00 a 22:00.',
    ];
    const salidas: string[] = [];
    let escenarios = 0;
    for (const f of FIJOS) {
      for (const aviso of [true, false]) {
        const ent: Entrada = aviso ? { armados: [armado('pedido')], enviados: [OK()] } : { armados: [SIN_AVISO] };
        for (const tipo of ['texto', 'botones', 'enlace']) {
          const m = tipo === 'texto' ? texto(f) : tipo === 'botones' ? botones(f, 'Confirmar pedido', 'Cambiar algo') : enlace(f);
          const r = mensajes({ mensajes: [m], pedido: PEDIDO, cierre: { tipo: 'registro', detalle: f } }, ent);
          for (const i of r.items) salidas.push(...textosDe(i));
          salidas.push(String(r.items[0]!['cierre']?.detalle ?? ''));
          escenarios++;
        }
      }
    }
    // Los avisos de cada tipo, con y sin datos del cliente adversariales.
    for (const tipo of ['pedido', 'comprobante', 'reserva', 'transferencia']) {
      for (const nota of ['sin cebolla', 'pago validado', 'ya pagado']) {
        const r = avisos({ pedido: PEDIDO, aviso: { tipo, datos: { nota, detalle: `Detalle ${nota}. Revisen el pago en su banco antes de despachar.`, respaldo: `Aviso ${nota}` } } });
        for (const i of r.items) salidas.push(...textosDe(i));
        escenarios++;
      }
    }
    expect(escenarios).toBeGreaterThanOrEqual(25);
    expect(salidas.length).toBeGreaterThan(100);
    for (const s of salidas) expect(PROHIBIDAS.test(s), s).toBe(false);
    // Y los textos sanos no se tocan sin motivo: el comprobante «coincide» sale tal cual con el aviso salido.
    const sano = mensajes({ mensajes: [texto(FIJOS[8]!)] }, { armados: [armado('pedido')], enviados: [OK()] });
    expect(sano.items[0]!['texto']).toBe(FIJOS[8]);
  });
});

// =================================================================================================
describe('Resumen del turno', () => {
  const corrida = (items: J[], armados: J[] = [], cfg: J = {}): J[] =>
    ejecutar(`${DOBLES}\n${RESUMEN}`, [{}], { 'Config del negocio': { ...CFG, ...cfg }, 'Armar mensajes': items, 'Armar avisos': armados },
      { $getWorkflowStaticData: () => ({}), __bit: [] });

  it('junta los mensajes, los avisos armados y el resumen del primer ítem', () => {
    const m = mensajes({ ruta: 'confirmar', pedido: PEDIDO, estadoNuevo: { paso: 'menu' }, mensajes: [texto('a'), qr()],
      cierre: { tipo: 'registro', detalle: 'Detalle' }, aviso: { tipo: 'pedido', datos: {} } }, { armados: [armado('pedido')], enviados: [OK()] });
    const a = avisos({ aviso: { tipo: 'pedido', datos: {} } });
    const [r] = corrida(m.items, a.items);
    expect(r).toMatchObject({ ok: true, modoPrueba: false });
    expect(r!['mensajes']).toHaveLength(2);
    expect(r!['mensajes'][0]).toMatchObject({ para: CLIENTE, destino: 'cliente', reportar: true });
    expect(r!['avisos'].map((x: J) => [x['para'], x['rol'], x['tipoAviso'], x['esPlantilla']])).toEqual([[AV1, 'completo', 'pedido', true], [AV2, 'cocina', 'pedido', true]]);
    expect(r!['resumen']).toMatchObject({ ruta: 'confirmar', avisoSalio: true, avisosArmados: 2, avisosConWamid: 1, mensajesSalientes: 2, cierre: { tipo: 'registro', detalle: 'Detalle' } });
  });

  it('sin avisos armados (sinAviso) la lista de avisos va vacía; sin ítems, valores neutros', () => {
    const m = mensajes({ ruta: 'menu', mensajes: [texto('a')] });
    const [r] = corrida(m.items, [SIN_AVISO]);
    expect(r!['avisos']).toEqual([]);
    expect(r!['resumen']).toMatchObject({ avisosArmados: 0, mensajesSalientes: 1, avisoSalio: false, cierre: null });
    const [vacio] = corrida([]);
    expect(vacio).toMatchObject({ ok: true, mensajes: [], avisos: [], resumen: { ruta: 'nada', mensajesSalientes: 0, errores: [] } });
  });

  it('un ítem sinMensajes no cuenta como mensaje saliente', () => {
    const m = mensajes({ ruta: 'nada', mensajes: [] });
    const [r] = corrida(m.items);
    expect(r!['mensajes']).toEqual([]);
    expect(r!['resumen']).toMatchObject({ mensajesSalientes: 0, ruta: 'nada' });
  });

  it('modoPrueba se refleja', () => {
    expect(corrida([], [], { modoPrueba: true })[0]).toMatchObject({ modoPrueba: true });
  });
});

// =================================================================================================
describe('Los tres nodos son JavaScript plano', () => {
  it.each([['armar-avisos', AVISOS], ['armar-mensajes', MENSAJES], ['resumen-del-turno', RESUMEN]])('%s no usa globales de Node ni código dinámico', (_n, fuente) => {
    expect(fuente).not.toMatch(/\brequire\s*\(|\bnew URL\b|\bBuffer\b|\bcrypto\b|\bprocess\.|\bnew Function\b|\beval\s*\(|\bimport\s/);
    expect(fuente).not.toMatch(/\bfetch\s*\(|\bsetTimeout\b/);
  });

  it('no traen secretos, UUID, ni números de teléfono reales', () => {
    for (const f of [AVISOS, MENSAJES, RESUMEN]) {
      expect(f).not.toMatch(/\b\d{10,}\b/);
      expect(f).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(f).not.toMatch(/\/home\/|EAA[A-Za-z0-9]{20,}/);
    }
  });

  it('solo Armar mensajes escribe estado: los otros dos no llaman a las funciones que escriben', () => {
    for (const f of [AVISOS, RESUMEN]) expect(f).not.toMatch(/vmEscribirEstado|vmBarrer|avContar|rsAnotar|\$getWorkflowStaticData/);
    expect(MENSAJES).toMatch(/vmEscribirEstado/);
    expect(MENSAJES).toMatch(/avContar/);
  });
});
