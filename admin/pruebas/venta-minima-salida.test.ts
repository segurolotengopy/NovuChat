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
const PROHIBIDAS = /validad|confirmad|pagad[oa]|acreditad|verificad|recibimos tu pago|ya lo prepar|lo (est[aá](n|mos)|estoy) prepar|lo preparamos|te avisa(mos|remos)|en camino|te llama(mos|remos)|te escribir[aá]n|lo consulto|acredit|recib\S{0,40} (tu|el) pago|pago (recibid|aprobad|[eé]xitos|realizad|registrad)|confirm(amos|ó|o)\s+(tu|tus|su|sus|la|el|lo|los|las)\b|(est[aá]|qued[oó])\s+reservad|reserva\s+((est[aá]|qued[oó])\s+)?(registrad|agendad)|reservamos tu/i;

/**
 * LO QUE SE SUPONE DE CADA LIBRERÍA (los dobles de abajo; `avArmar` según lo que informó T4):
 *  - `comun.js` (T1): `vmPrimero/vmTodos/vmCfg` leen por nombre solo si el nodo corrió; `vmTextoSeguro`
 *    devuelve `false` si el texto coincide con `VM_PROHIBIDAS`; `vmSd()` da `ventaMinima` de los datos
 *    estáticos; `vmEscribirEstado` guarda el estado por teléfono; `vmBarrer` limpia vencidos.
 *  - `avisos.js` (T4): `avPlan` envuelve a `avArmar` con los errores; `avDestinatarios` filtra a los de 8 a 15 dígitos con prefijo permitido y distintos
 *    del que escribe, y asigna el rol `completo` SOLO a «completo:» (un número sin rol o con un rol desconocido es `cocina`, como la
 *    librería real: antes el doble daba `completo` por omisión y ocultaba la diferencia; ver `venta-minima-integracion`);
 *    `avArmar` devuelve la LISTA de ítems `{para, rol, payload, respaldo:null,
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
function vmIdDeBoton() { return Array.prototype.slice.call(arguments).join('|'); }
function avDestinatarios(csv, from, pref) {
  const out = []; const visto = {};
  const prefijos = String(pref || '591').split(',').map((s) => s.trim()).filter(Boolean);
  for (const p of String(csv || '').split(',')) {
    // Igual que la librería real (avisos.js): solo el rol «completo» (sin tildes ni mayúsculas) es completo; un número SIN rol o
    // con un rol desconocido es «cocina», el de menos privilegio. Un número repetido queda con el rol de menos privilegio.
    const i = p.indexOf(':'); const nombreRol = i < 0 ? '' : p.slice(0, i).trim().toLowerCase(); const rol = nombreRol === 'completo' ? 'completo' : 'cocina'; const d = vmDigitos(i < 0 ? p : p.slice(i + 1));
    if (d.length < 8 || d.length > 15 || !prefijos.some((x) => d.startsWith(x)) || d === vmDigitos(from)) continue;
    if (visto[d]) { if (rol === 'cocina') visto[d].rol = 'cocina'; continue; }
    visto[d] = { rol: rol, tel: d }; out.push(visto[d]);
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
// avPlan (la que llama el nodo) = avArmar + los errores; el doble solo envuelve la lista.
function avPlan(tipo, datos, dest, cfg, sd, ms) {
  const r = avArmar(tipo, datos, dest, cfg, sd, ms);
  return Array.isArray(r) ? { items: r, errores: [] } : r;
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
const GENERICO = 'Esto prefiero que lo vea una persona del restaurante 🙂. Toca «Escribir al local» para hablar con ellos. Si quieres seguir con tu pedido o tu reserva, escribe «menú».';
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
    const r = mensajes({ mensajes: [botones('¿Qué te gustaría hacer?', 'Hacer un pedido', 'Reservar mesa', 'Un título larguísimo que no cabe', 'Cuarto')] });
    const bs = r.items[0]!['payload'].interactive.action.buttons;
    expect(bs).toHaveLength(3);
    expect(bs[2].reply.title.length).toBeLessThanOrEqual(20);
    expect(r.items[0]).toMatchObject({ tipoReporte: 'interactive' });
    expect(r.items[0]!['respaldo']).toContain('¿Qué te gustaría hacer?');
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

  it('S5: enlace con una URL del plan: solo `https://wa.me/<número de recepción>` (con ?text= opcional); cualquier otra se descarta', () => {
    const url = (m: J) => m.items[0]!['payload'].interactive.action.parameters.url as string;
    // Positivos: el número de recepción, con y sin ?text=.
    expect(url(mensajes({ mensajes: [enlace(GENERICO, { url: `https://wa.me/${REC}?text=Hola` })] }))).toBe(`https://wa.me/${REC}?text=Hola`);
    expect(url(mensajes({ mensajes: [enlace(GENERICO, { url: `https://wa.me/${REC}` })] }))).toBe(`https://wa.me/${REC}`);
    // Negativos: otro número, el chat del propio cliente, http, otro dominio, usuario con @, puerto, texto con espacios o con enlace.
    const malas = [
      'https://wa.me/59100000055?text=Hola', `https://wa.me/${CLIENTE}`, `http://wa.me/${REC}`, `https://wa.me.malo.test/${REC}`,
      `https://malo.test/https://wa.me/${REC}`, `https://wa.me\u0040malo.test/${REC}`, `https://wa.me:8080/${REC}`, `https://wa.me/${REC}/mas`,
      `https://wa.me/${REC}?text=hola mundo`, `https://wa.me/${REC}?text=a&b=c`, `https://wa.me/${REC}?x=1`, 'https://wa.me/123', `https://wa.me/${REC}0000000000`,
      'javascript:alert(1)', 'https://malo.test/pagar',
    ];
    for (const mala of malas) {
      const u = url(mensajes({ mensajes: [enlace(GENERICO, { url: mala })] }));
      expect(u, mala).toContain(`https://wa.me/${REC}?text=`);
      expect(u, mala).not.toMatch(/malo\.test|javascript|\u0040|:8080/);
    }
  });

  it('sin número de recepción válido (marcador, vacío o el propio cliente) se quita la frase del botón', () => {
    for (const numeroRecepcion of ['REEMPLAZAR_NUMERO_RECEPCION_QTACO', '', CLIENTE]) {
      const r = mensajes({ mensajes: [enlace(GENERICO)] }, { cfg: { numeroRecepcion } });
      const i = r.items[0]!;
      expect(i['payload'].type).toBe('text');
      // Sin botón no se nombra el botón («Escribir al local»): queda lo demás, con el camino de vuelta al menú.
      expect(i['payload'].text.body).toBe('Esto prefiero que lo vea una persona del restaurante 🙂. Si quieres seguir con tu pedido o tu reserva, escribe «menú».');
      expect(i['tipoReporte']).toBe('text');
      expect(JSON.stringify(i)).not.toMatch(/bot[oó]n/i);
    }
    // el texto con «:» conserva lo que viene antes del «:»
    const r = mensajes({ mensajes: [enlace('No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.')] }, { cfg: { numeroRecepcion: '' } });
    expect(r.items[0]!['payload'].text.body).toBe('No pude pasarle tu pedido al restaurante en este momento. Si quieres seguir con tu pedido o tu reserva, escribe «menú».');
    const dos = mensajes({ mensajes: [enlace('Ya tengo el comprobante de tu pedido #K7Q2. Si necesitas algo más, toca el botón.')] }, { cfg: { numeroRecepcion: '' } });
    expect(dos.items[0]!['payload'].text.body).toBe('Ya tengo el comprobante de tu pedido #K7Q2. Si quieres seguir con tu pedido o tu reserva, escribe «menú».');
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

// -------------------------------------------------------------------------------------------------
// El QR SIMULADO: los dos modos son excluyentes y el modo coherente con el pie es lo último que se mira.
describe('Armar mensajes — el QR del cobro simulado', () => {
  // La imagen permitida del QR simulado (la misma que fija `construir.mjs`); `URL_OTRA` es https pero NO es esa imagen.
  const URL_SIM = 'https://raw.githubusercontent.com/segurolotengopy/NovuChat/v0.11.0/Demo-Recursos/qr-demo.png';
  const URL_OTRA = 'https://qr.ejemplo.test/qr-demo.png';
  const COBRO_SIM: J = { activo: false, modo: 'simulado', qrUrl: URL_SIM };
  const PIE_SIM = 'PRUEBA · COBRO SIMULADO: este QR es de demostración, no cobra ni mueve dinero.\nPedido #K7Q2. Total de la prueba: 55 Bs (solo la comida).\nNo intentes pagarlo: tu banco lo va a rechazar. Para seguir con la prueba, envíame aquí cualquier foto como comprobante simulado.';
  const planQr = (mensaje: J = qr({ cuerpo: PIE_SIM }), extra: J = {}): J => ({
    ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [mensaje], ...extra,
  });

  it('simulado con el pie correcto: sale la imagen con el enlace de `cfg.cobro.qrUrl` y el evento `qr_enviado`', () => {
    const r = mensajes(planQr(), { cfg: { cobro: COBRO_SIM } });
    const i = r.items[0]!;
    expect(i['payload']).toMatchObject({ type: 'image', to: CLIENTE, image: { link: URL_SIM, caption: PIE_SIM } });
    expect(i).toMatchObject({ evento: 'qr_enviado', referencia: PEDIDO['pedidoId'], monto: 55, tipoReporte: 'image' });
    expect(r.sd['estados'][CLIENTE].paso).toBe('esperando_comprobante');
    // el enlace no sale de lo que traiga el mensaje del plan
    const otro = mensajes(planQr(qr({ cuerpo: PIE_SIM, url: 'https://otro.ejemplo.test/falso.png' })), { cfg: { cobro: COBRO_SIM } });
    expect(otro.items[0]!['payload'].image.link).toBe(URL_SIM);
  });

  it.each([
    ['los dos modos a la vez (`activo:true` con `modo:simulado`)', { cfg: { cobro: { ...COBRO_SIM, activo: true } } }, qr({ cuerpo: PIE_SIM }), 'cobro_en_dos_modos'],
    ['simulado con un pie SIN la palabra «simulado»', { cfg: { cobro: COBRO_SIM } }, qr({ cuerpo: PIE }), 'qr_simulado_sin_rotulo'],
    ['simulado con un pie «simulado» pero sin «no cobra»', { cfg: { cobro: COBRO_SIM } }, qr({ cuerpo: 'Pedido #K7Q2. Total: 55 Bs. Cobro simulado, envía una foto.' }), 'qr_simulado_sin_rotulo'],
    ['real con un pie que dice «PRUEBA»', { cfg: { cobro: { activo: true, modo: 'real', qrUrl: URL_SIM } } }, qr({ cuerpo: `${PIE} PRUEBA` }), 'qr_real_con_rotulo_simulado'],
    ['real con un pie que dice «demostración»', {}, qr({ cuerpo: `${PIE} Es una demostración.` }), 'qr_real_con_rotulo_simulado'],
    ['real con el pie del cobro simulado', {}, qr({ cuerpo: PIE_SIM }), 'qr_real_con_rotulo_simulado'],
    // H7 (defensa en profundidad): una imagen https que no es el QR de demostración del repositorio no sale con la marca «SIMULADO».
    ['simulado con otra imagen https (otro anfitrión)', { cfg: { cobro: { ...COBRO_SIM, qrUrl: URL_OTRA } } }, qr({ cuerpo: PIE_SIM }), 'qr_simulado_imagen_no_permitida'],
    ['simulado con la imagen del repositorio en otra ruta', { cfg: { cobro: { ...COBRO_SIM, qrUrl: URL_SIM.replace('qr-demo.png', 'otra.png') } } }, qr({ cuerpo: PIE_SIM }), 'qr_simulado_imagen_no_permitida'],
    ['simulado con la imagen de otro repositorio', { cfg: { cobro: { ...COBRO_SIM, qrUrl: URL_SIM.replace('segurolotengopy/NovuChat', 'otro/Repo') } } }, qr({ cuerpo: PIE_SIM }), 'qr_simulado_imagen_no_permitida'],
    ['simulado sin enlace https', { cfg: { cobro: { ...COBRO_SIM, qrUrl: 'http://qr.ejemplo.test/a.png' } } }, qr({ cuerpo: PIE_SIM }), 'qr_sin_https'],
    ['simulado con un monto distinto del total', { cfg: { cobro: COBRO_SIM } }, qr({ cuerpo: PIE_SIM, monto: 999 }), 'qr_monto_distinto_del_total'],
    ['modo desconocido sin `activo`', { cfg: { cobro: { activo: false, modo: 'apagado', qrUrl: URL_SIM } } }, qr({ cuerpo: PIE_SIM }), 'cobro_no_activo'],
  ])('rechaza el QR: %s. No sale `type:image`, sale el genérico y no se guarda esperando_comprobante', (_n, ent, mensaje, motivo) => {
    const r = mensajes(planQr(mensaje as J), ent as Entrada);
    const i = r.items[0]!;
    expect(i['payload'].type).not.toBe('image');
    expect(i['evento']).toBeUndefined();
    expect(i['monto']).toBeUndefined();
    expect(cuerpoDe(i)).toBe(GENERICO);
    expect((i['errores'] as string[]).some((e) => e === `qr_rechazado: ${motivo}`), String(i['errores'])).toBe(true);
    expect(i['resumen']).toMatchObject({ qrRechazado: true });
    expect(r.sd['estados']).toBeUndefined();
    expect(r.sd['pedidos']).toBeUndefined();
  });

  it('negativo: el real con su pie de siempre sigue saliendo (el rótulo de prueba solo se exige y se prohíbe donde corresponde)', () => {
    const r = mensajes(planQr(qr()), { cfg: { cobro: { activo: true, modo: 'real', qrUrl: URL_SIM } } });
    expect(r.items[0]!['payload'].type).toBe('image');
  });

  it('el titular de la cuenta real («Pruebas SRL») no es un rótulo: su QR sale; pero un «PRUEBA» fuera del titular sí lo rechaza', () => {
    const cobro = { activo: true, modo: 'real', qrUrl: URL_SIM, titular: 'Pruebas y Demostraciones SRL' };
    const pie = PIE.replace('Escanea el QR', 'Titular: Pruebas y Demostraciones SRL. Escanea el QR');
    expect(mensajes(planQr(qr({ cuerpo: pie })), { cfg: { cobro } }).items[0]!['payload'].type).toBe('image');
    const malo = mensajes(planQr(qr({ cuerpo: `${pie} PRUEBA` })), { cfg: { cobro } });
    expect(malo.items[0]!['payload'].type).not.toBe('image');
    expect((malo.items[0]!['errores'] as string[])).toContain('qr_rechazado: qr_real_con_rotulo_simulado');
    // sin titular declarado, la misma palabra en el pie sí cuenta como rótulo
    const sin = mensajes(planQr(qr({ cuerpo: pie })), { cfg: { cobro: { ...cobro, titular: '' } } });
    expect(sin.items[0]!['payload'].type).not.toBe('image');
  });
});

// =================================================================================================
describe('Armar mensajes — el aviso salió (por hecho) y la defensa extra', () => {
  const PASE = 'Listo: pasé tu pedido #K7Q2 al restaurante. El pago lo coordinas con ellos al recoger.';
  const NO_PASE_PLAN = 'No pude pasarle tu pedido al restaurante en este momento: escríbeles con el botón.';
  // Lo que sale: el mensaje con botón de enlace lleva al final el camino de vuelta al menú (03/10).
  const NO_PASE = NO_PASE_PLAN + ' Si quieres seguir con tu pedido o tu reserva, escribe «menú».';
  const plan = (): J => ({
    ruta: 'confirmar', pedido: PEDIDO, aviso: { tipo: 'pedido', datos: {} }, mensajes: [],
    condicionados: { siSalio: [texto(PASE)], siNoSalio: [enlace(NO_PASE_PLAN)] },
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

  it('el cierre va solo en el primer ítem, con referencia = pedidoId (B0: ya no el primer wamid del aviso)', () => {
    const r = mensajes({ ruta: 'm', pedido: PEDIDO, mensajes: [texto('a'), texto('b')], cierre: { tipo: 'registro', detalle: 'Pedido K7Q2 sin QR: cobrar al recoger.' } },
      { armados: [armado('pedido')], enviados: [OK(7)] });
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!['cierre']).toEqual({ tipo: 'registro', detalle: 'Pedido K7Q2 sin QR: cobrar al recoger.', referencia: PEDIDO['pedidoId'] });
    expect(JSON.stringify(r.items[0]!['cierre'])).not.toContain('AVISO7');
    expect(r.items[1]!['cierre']).toBeUndefined();
  });

  it('la referencia del cierre, sin referencia en el plan, cae a pedidoId y luego a mensajeId (nunca al wamid del aviso)', () => {
    const cierre = { tipo: 'registro', detalle: 'x' };
    expect(mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe(PEDIDO['pedidoId']);
    expect(mensajes({ mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe('wamid.ENTRANTE1');
    // con un aviso que SÍ salió (wamid del aviso), la referencia sigue siendo el pedidoId
    const conAviso = mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre }, { armados: [armado('pedido')], enviados: [OK(7)] });
    expect(conAviso.items[0]!['cierre'].referencia).toBe(PEDIDO['pedidoId']);
  });

  it('B0: la `cierre.referencia` del plan GANA sobre el pedidoId (y sobre el wamid del aviso)', () => {
    const cierre = { tipo: 'registro', detalle: 'x', referencia: 'res-2026-10-05-0011-abc1234' };
    expect(mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe('res-2026-10-05-0011-abc1234');
    expect(mensajes({ mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia).toBe('res-2026-10-05-0011-abc1234');
    const conAviso = mensajes({ mensajes: [texto('a')], cierre }, { armados: [armado('reserva')], enviados: [OK(7)] });
    expect(conAviso.items[0]!['cierre'].referencia).toBe('res-2026-10-05-0011-abc1234');
  });

  it('B0: una referencia del plan que no cumple ^[A-Za-z0-9_-]{1,120}$ (con «/», vacía, de 121 caracteres, con espacio o no texto) cae a pedidoId y luego a mensajeId', () => {
    const malas: unknown[] = ['ped/otro', '', 'a'.repeat(121), 'con espacio', 'ñandú', 'x\ny', 42, null, { a: 1 }];
    for (const referencia of malas) {
      const cierre = { tipo: 'registro', detalle: 'x', referencia };
      expect(mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia, JSON.stringify(referencia)).toBe(PEDIDO['pedidoId']);
      expect(mensajes({ mensajes: [texto('a')], cierre }).items[0]!['cierre'].referencia, JSON.stringify(referencia)).toBe('wamid.ENTRANTE1');
    }
    // negando: los bordes válidos sí pasan (1 y 120 caracteres, guion y guion bajo)
    for (const buena of ['a', 'a'.repeat(120), 'res-2026_10-05']) {
      expect(mensajes({ pedido: PEDIDO, mensajes: [texto('a')], cierre: { tipo: 'registro', detalle: 'x', referencia: buena } }).items[0]!['cierre'].referencia).toBe(buena);
    }
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

  it('solo Armar mensajes escribe estado: los otros dos no llaman a las funciones que escriben (salvo que Resumen del turno DEVUELVE el estado previo si la entrega falla del todo: R3)', () => {
    expect(AVISOS).not.toMatch(/vmEscribirEstado|vmBarrer|avContar|rsAnotar|\$getWorkflowStaticData/);
    expect(RESUMEN).not.toMatch(/vmBarrer|avContar|rsAnotar|\$getWorkflowStaticData/);
    // La única escritura de Resumen es la reversión, y va justo antes del `throw` de la entrega fallida.
    expect(RESUMEN.match(/vmEscribirEstado/g)).toHaveLength(1);
    expect(RESUMEN).toMatch(/vmEscribirEstado\([\s\S]{0,200}\}\s*throw new Error\('Entrega fallida/);
    expect(MENSAJES).toMatch(/vmEscribirEstado/);
    expect(MENSAJES).toMatch(/avContar/);
  });
});

// =================================================================================================
// Correcciones de la revisión del PR-1 (S4, S5, S6, R3), cada una probada negando el defecto.
describe('Armar mensajes — S4: «Reenviar QR» sí reenvía, sin reabrir el cobro', () => {
  const reenvio = (extra: J = {}, plan: J = {}): J => ({
    ruta: 'reenviar_qr', estadoNuevo: { paso: 'esperando_comprobante', pedido: PEDIDO },
    mensajes: [qr({ evento: undefined, ...extra })], ...plan,
  });

  it('con monto y referencia del pedido del estado, la imagen sale SIN el evento `qr_enviado`', () => {
    const r = mensajes(reenvio());
    const i = r.items[0]!;
    expect(i['payload']).toMatchObject({ type: 'image', image: { link: 'https://qr.ejemplo.test/qtaco.png' } });
    expect(i).toMatchObject({ referencia: PEDIDO['pedidoId'], monto: 55, tipoReporte: 'image' });
    expect(i['evento']).toBeUndefined();
    expect(r.sd['estados'][CLIENTE].paso).toBe('esperando_comprobante');
  });

  it('el evento solo lo lleva el QR que el plan pidió como evento (el primer envío)', () => {
    const primero = mensajes({ ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [qr()] });
    expect(primero.items[0]!['evento']).toBe('qr_enviado');
    // Negado: un mensaje con otro evento o con un evento vacío no abre cobro alguno.
    for (const evento of [undefined, '', 'pedido_pasado']) {
      expect(mensajes(reenvio({ evento })).items[0]!['evento'], String(evento)).toBeUndefined();
    }
  });

  it('se compara contra el pedido del estado: sin pedido, o con otro monto, se rechaza y se deriva', () => {
    const sinPedido = mensajes(reenvio({}, { estadoNuevo: { paso: 'esperando_comprobante' } }));
    expect(sinPedido.items[0]!['payload'].type).not.toBe('image');
    expect((sinPedido.items[0]!['errores'] as string[]).some((e) => e.startsWith('qr_rechazado'))).toBe(true);
    const otroMonto = mensajes(reenvio({ monto: 999 }));
    expect(otroMonto.items[0]!['payload'].type).not.toBe('image');
    expect((otroMonto.items[0]!['errores'] as string[])).toContain('qr_rechazado: qr_monto_distinto_del_total');
    const otraRef = mensajes(reenvio({ referencia: 'ped-otro' }));
    expect((otraRef.items[0]!['errores'] as string[])).toContain('qr_rechazado: qr_referencia_distinta');
    // Y sin monto (el defecto original: el plan no lo mandaba) sigue siendo un rechazo.
    expect((mensajes(reenvio({ monto: undefined })).items[0]!['errores'] as string[])).toContain('qr_rechazado: qr_sin_monto');
  });
});

describe('Armar mensajes — S5: la URL del QR solo vale con https, dominio con nombre, sin @ y sin puerto', () => {
  const plan = (): J => ({ ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [qr()] });
  const con = (qrUrl: string) => mensajes(plan(), { cfg: { cobro: { activo: true, qrUrl } } });

  it('acepta https con dominio, ruta, consulta y fragmento', () => {
    for (const u of ['https://qr.ejemplo.test/qtaco.png', 'https://a.b-c.example.bo/x/y.png?v=2#f', 'https://almacen.ejemplo.test']) {
      expect(con(u).items[0]!['payload'].type, u).toBe('image');
      expect(con(u).items[0]!['payload'].image.link, u).toBe(u);
    }
  });

  it.each([
    'http://qr.ejemplo.test/a.png', 'https://127.0.0.1/qr.png', 'https://10.0.0.5/qr.png', 'https://localhost/qr.png', `https://${['2130706', '433'].join('')}/qr.png`,
    'https://[::1]/qr.png', 'https://usuario\u0040qr.ejemplo.test/a.png', 'https://qr.ejemplo.test\u0040malo.test/a.png', 'https://qr.ejemplo.test:8443/a.png',
    'https://qr.ejemplo.test/a b.png', 'https://qr.ejemplo.test/a.png"onerror=', 'ftp://qr.ejemplo.test/a.png', 'https://', 'https://.ejemplo.test/a.png',
    'https://qr.ejemplo.test/a\u0040b.png',
  ])('rechaza «%s»: sale la derivación y no se manda ningún QR', (u) => {
    const r = con(u);
    expect(r.items[0]!['payload'].type).not.toBe('image');
    expect((r.items[0]!['errores'] as string[])).toContain('qr_rechazado: qr_sin_https');
    expect(r.sd['estados']).toBeUndefined();
  });
});

describe('Armar mensajes y Armar avisos — S6: topes por teléfono y por hora, y tope de pedidos guardados', () => {
  const planPedido = (tipo = 'pedido'): J => ({ ruta: 'x', mensajes: [texto('Hola')], aviso: { tipo, datos: {} } });
  const marcas = (n: number, extra: J = {}): J => ({
    ventaMinima: { avisosPedido: { [CLIENTE]: Array.from({ length: n }, (_, i) => AHORA - (i + 1) * MIN) }, ...extra },
  });

  it('con 6 avisos de pedido o comprobante en la última hora no se arma otro; con 5, sí (tope por defecto 6)', () => {
    for (const tipo of ['pedido', 'comprobante']) {
      const lleno = avisos({ aviso: { tipo, datos: {} } }, { g: marcas(6) });
      expect(lleno.items[0], tipo).toMatchObject({ sinAviso: true });
      expect(String((lleno.items[0]!['errores'] as string[])[0]), tipo).toContain('tope_pedidos_hora');
      expect(lleno.bit.some((b) => b[0] === 'avArmar'), tipo).toBe(false);
      expect(avisos({ aviso: { tipo, datos: {} } }, { g: marcas(5) }).items[0], tipo).toMatchObject({ sinAviso: false });
    }
  });

  it('el tope sale de la configuración (también 0 = ninguno); las marcas viejas y las de otro teléfono no cuentan', () => {
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: marcas(2), cfg: { topePedidosHora: 2 } }).items[0]).toMatchObject({ sinAviso: true });
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: marcas(2), cfg: { topePedidosHora: 3 } }).items[0]).toMatchObject({ sinAviso: false });
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: marcas(0), cfg: { topePedidosHora: 0 } }).items[0]).toMatchObject({ sinAviso: true });
    const viejas = { ventaMinima: { avisosPedido: { [CLIENTE]: [1, 2, 3, 4, 5, 6].map((i) => AHORA - (60 + i) * MIN) } } };
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: viejas }).items[0]).toMatchObject({ sinAviso: false });
    const ajenas = { ventaMinima: { avisosPedido: { '59100000099': [1, 2, 3, 4, 5, 6, 7].map((i) => AHORA - i * MIN) } } };
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: ajenas }).items[0]).toMatchObject({ sinAviso: false });
    // Una clave heredada del prototipo no es una marca.
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { t: { from: '59100000011' }, g: { ventaMinima: { avisosPedido: {} } } }).items[0]).toMatchObject({ sinAviso: false });
  });

  it('el tope de pedidos no frena las derivaciones ni las reservas, y el de derivaciones no frena los pedidos', () => {
    expect(avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: marcas(6) }).items[0]).toMatchObject({ sinAviso: false });
    expect(avisos({ aviso: { tipo: 'reserva', datos: {} } }, { g: marcas(6) }).items[0]).toMatchObject({ sinAviso: false });
    const deriv = { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - MIN] } } };
    expect(avisos({ aviso: { tipo: 'pedido', datos: {} } }, { g: deriv }).items[0]).toMatchObject({ sinAviso: false });
  });

  it('la marca de pedido se escribe solo si el aviso de pedido o de comprobante SALIÓ (una vez por aviso, no por mensaje)', () => {
    const salio = mensajes(planPedido(), { armados: [armado('pedido'), armado('pedido', { clase: 'detalle', esPlantilla: false })], enviados: [OK(1), OK(2)] });
    expect(salio.sd['avisosPedido'][CLIENTE]).toEqual([AHORA]);
    expect(mensajes(planPedido('comprobante'), { armados: [armado('comprobante')], enviados: [OK()] }).sd['avisosPedido'][CLIENTE]).toEqual([AHORA]);
    // Negativos: cayó, no hubo aviso, o fue de otro tipo.
    expect(mensajes(planPedido(), { armados: [armado('pedido')], enviados: [FALLA] }).sd['avisosPedido']).toBeUndefined();
    expect(mensajes(planPedido(), { armados: [SIN_AVISO] }).sd['avisosPedido']).toBeUndefined();
    expect(mensajes(planPedido('reserva'), { armados: [armado('reserva')], enviados: [OK()] }).sd['avisosPedido']).toBeUndefined();
    expect(mensajes(planPedido('transferencia'), { armados: [armado('transferencia')], enviados: [OK()] }).sd['avisosPedido']).toBeUndefined();
  });

  it('las marcas de más de una hora se podan y no hay más de 500 teléfonos con marca', () => {
    const g = { ventaMinima: { avisosPedido: { '59100000098': [AHORA - 2 * HORA], '59100000097': [AHORA - 5 * MIN] } } };
    const r = mensajes(planPedido(), { g, armados: [armado('pedido')], enviados: [OK()] });
    expect(r.sd['avisosPedido']['59100000098']).toBeUndefined();
    expect(r.sd['avisosPedido']['59100000097']).toEqual([AHORA - 5 * MIN]);
    const muchos: J = {};
    for (let i = 0; i < 600; i++) muchos[`5917${String(i).padStart(7, '0')}`] = [AHORA - 30 * MIN + i];
    const tope = mensajes(planPedido(), { g: { ventaMinima: { avisosPedido: muchos } }, armados: [armado('pedido')], enviados: [OK()] });
    const claves = Object.keys(tope.sd['avisosPedido']);
    expect(claves.length).toBeLessThanOrEqual(500);
    expect(claves).toContain(CLIENTE); // la marca recién escrita nunca se expulsa
    expect(claves).not.toContain('59170000000'); // las más antiguas, sí
  });

  it('`sd.pedidos` guarda como mucho 500 pedidos: al pasarse se expulsan los más antiguos, nunca el recién guardado', () => {
    const viejos: J = {};
    for (let i = 0; i < 520; i++) viejos[`ped-${i}`] = { pedidoId: `ped-${i}`, from: '59100000099', total: 10, guardadoMs: AHORA - 60 * MIN + i };
    const r = mensajes({ ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [qr()] }, { g: { ventaMinima: { pedidos: viejos } } });
    const claves = Object.keys(r.sd['pedidos']);
    expect(claves).toHaveLength(500);
    expect(claves).toContain(PEDIDO['pedidoId']);
    expect(claves).not.toContain('ped-0');
    expect(claves).toContain('ped-519');
    // Negado: por debajo del tope no se expulsa nada.
    const pocos: J = { 'ped-a': { pedidoId: 'ped-a', from: '59100000099', total: 10, guardadoMs: AHORA - 60 * MIN } };
    const q = mensajes({ ruta: 'confirmar', estadoNuevo: { paso: 'esperando_comprobante' }, pedido: PEDIDO, mensajes: [qr()] }, { g: { ventaMinima: { pedidos: pocos } } });
    expect(Object.keys(q.sd['pedidos']).sort()).toEqual(['ped-a', PEDIDO['pedidoId']].sort());
  });
});

describe('Armar avisos — R3: el tope de derivaciones respeta el 0 y lee solo la marca por hecho', () => {
  it('topeTransferenciasHora = 0 significa «ninguna derivación avisa» (antes caía a 1)', () => {
    const r = avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { cfg: { topeTransferenciasHora: 0 } });
    expect(r.items[0]).toMatchObject({ sinAviso: true });
    expect(String((r.items[0]!['errores'] as string[])[0])).toContain('derivacion_repetida');
    // Negado: sin el dato rige 1 (avisa la primera) y con 1 marca reciente ya no.
    expect(avisos({ aviso: { tipo: 'transferencia', datos: {} } }).items[0]).toMatchObject({ sinAviso: false });
    expect(avisos({ aviso: { tipo: 'transferencia', datos: {} } }, { g: { ventaMinima: { transferencias: { [CLIENTE]: [AHORA - MIN] } } } }).items[0]).toMatchObject({ sinAviso: true });
  });
});

// =================================================================================================
describe('Armar mensajes — el camino de vuelta al menú y el nivel de emojis (03/10)', () => {
  const titulos = (j: J): string[] => (j['payload'].interactive?.action?.buttons ?? []).map((b: J) => String(b.reply.title));
  const ids = (j: J): string[] => (j['payload'].interactive?.action?.buttons ?? []).map((b: J) => String(b.reply.id));
  const SEGUIR = 'Si quieres seguir con tu pedido o tu reserva, escribe «menú».';

  it('todo mensaje con botones y lugar (menos de tres) sale con «Menú» (`m|menu`) al final; con tres, no se agrega nada', () => {
    const uno = mensajes({ mensajes: [botones('Elige', 'A')] }).items[0]!;
    expect(titulos(uno)).toEqual(['A', 'Menú']);
    expect(ids(uno)).toEqual(['b|0', 'm|menu']);
    const dos = mensajes({ mensajes: [botones('Elige', 'A', 'B')] }).items[0]!;
    expect(titulos(dos)).toEqual(['A', 'B', 'Menú']);
    // Negado: con tres no hay lugar; con el propio menú (`sinMenu`) no se repite; sin botones sigue siendo un texto.
    expect(titulos(mensajes({ mensajes: [botones('Elige', 'A', 'B', 'C')] }).items[0]!)).toEqual(['A', 'B', 'C']);
    expect(titulos(mensajes({ mensajes: [{ ...botones('Elige', 'A', 'B'), sinMenu: true }] }).items[0]!)).toEqual(['A', 'B']);
    expect(mensajes({ mensajes: [texto('Hola')] }).items[0]!['payload'].type).toBe('text');
    // Un botón «m|menu» que el plan ya trae no se duplica.
    const ya = mensajes({ mensajes: [{ tipo: 'botones', cuerpo: 'Elige', botones: [{ id: 'm|menu', title: 'Menú' }] }] }).items[0]!;
    expect(ids(ya)).toEqual(['m|menu']);
    // Agregar el botón no agrega mensajes.
    expect(mensajes({ mensajes: [botones('Elige', 'A', 'B')] }).items).toHaveLength(1);
  });

  it('el mensaje con botón de enlace lleva al final «escribe «menú»», sin repetirlo si ya lo trae', () => {
    const e = mensajes({ mensajes: [enlace('Texto del plan.')] }).items[0]!;
    expect(e['texto']).toBe(`Texto del plan. ${SEGUIR}`);
    expect(e['payload'].interactive.body.text).toBe(`Texto del plan. ${SEGUIR}`);
    const ya = mensajes({ mensajes: [enlace(`Texto del plan. ${SEGUIR}`)] }).items[0]!;
    expect(ya['texto']).toBe(`Texto del plan. ${SEGUIR}`);
  });

  it('solo en la conversación: el aviso fijo de «Uso extendido» y de «Comercio no operativo» NO ofrece «menú» (ahí no funciona)', () => {
    for (const nombrePlan of ['Uso extendido', 'Comercio no operativo']) {
      const r = mensajes({ ruta: 'uso_extendido', mensajes: [enlace('Una persona del equipo sigue contigo.'), botones('Elige', 'A')] }, { nombrePlan }).items;
      expect(r[0]!['texto'], nombrePlan).toBe('Una persona del equipo sigue contigo.');
      expect(titulos(r[1]!), nombrePlan).toEqual(['A']);
      expect(JSON.stringify(r), nombrePlan).not.toMatch(/«menú»/);
    }
  });

  it('el texto sin botón (recepción igual al cliente) nombra «menú» y NO el botón «Escribir al local»', () => {
    const r = mensajes({ mensajes: [enlace(GENERICO)] }, { cfg: { numeroRecepcion: CLIENTE } }).items[0]!;
    expect(r['payload'].type).toBe('text');
    expect(r['texto']).toContain('escribe «menú»');
    expect(r['texto']).not.toMatch(/escribir al local|bot[oó]n/i);
  });

  it('el enlace a la carta del catálogo abre ESA URL (no el chat del local); sin URL segura se pasa con el local y no se promete una carta', () => {
    const URL_CARTA = 'https://carta.ejemplo.invalid/c?t=abc123';
    const carta = (extra: J = {}): J => ({ tipo: 'enlace', catalogo: true, cuerpo: 'Mira nuestra carta y arma tu pedido.', botones: [{ id: '', title: 'Ver la carta' }], url: URL_CARTA, ...extra });
    const ok = mensajes({ mensajes: [carta()] }).items[0]!;
    expect(ok['payload'].interactive.type).toBe('cta_url');
    expect(ok['payload'].interactive.action.parameters).toEqual({ display_text: 'Ver la carta', url: URL_CARTA });
    expect(ok['payload'].interactive.action.parameters.url).not.toContain(REC);
    expect(ok['texto']).toBe(`Mira nuestra carta y arma tu pedido. ${SEGUIR}`);
    expect(ok['respaldo']).toContain(`Ver la carta: ${URL_CARTA}`);
    expect(ok['tipoReporte']).toBe('interactive');
    // Negativos: http, IP, usuario, puerto, vacío, otra cosa → la derivación (nunca un botón «Ver la carta» que abre el chat del local).
    for (const mala of ['http://carta.ejemplo.invalid/c', 'https://10.0.0.1/c', ['https://usuario', 'carta.ejemplo.invalid/c'].join('@'), 'https://carta.ejemplo.invalid:8443/c', '', 'ftp://carta.ejemplo.invalid/c']) {
      const i = mensajes({ mensajes: [carta({ url: mala })] }).items[0]!;
      expect(i['texto'], mala).toBe(GENERICO);
      expect(JSON.stringify(i['payload']), mala).not.toContain('Ver la carta');
    }
    // Sin la marca `catalogo`, un enlace con otra URL sigue siendo el chat del local (la regla de siempre).
    const chat = mensajes({ mensajes: [enlace(GENERICO, { url: URL_CARTA })] }).items[0]!;
    expect(chat['payload'].interactive.action.parameters.url).toMatch(new RegExp(`^https://wa\\.me/${REC}`));
  });

  it('`nivelEmojis`: «pocos» deja el primer emoji de cada mensaje, «ninguno» los quita todos, «muchos» no toca nada', () => {
    const t = '¡Hola! 👋 Soy el asistente 🌮 de Q. ¿Qué te gustaría hacer? 😅';
    const cuerpo = (nivel: string) => mensajes({ mensajes: [texto(t)] }, { cfg: { nivelEmojis: nivel } }).items[0]!['payload'].text.body;
    expect(cuerpo('pocos')).toBe('¡Hola! 👋 Soy el asistente de Q. ¿Qué te gustaría hacer?');
    expect(cuerpo('ninguno')).toBe('¡Hola! Soy el asistente de Q. ¿Qué te gustaría hacer?');
    expect(cuerpo('muchos')).toBe(t);
    // Sin el dato rige «pocos»; y un emoji al principio no deja un espacio suelto.
    expect(mensajes({ mensajes: [texto(t)] }).items[0]!['payload'].text.body).toBe('¡Hola! 👋 Soy el asistente de Q. ¿Qué te gustaría hacer?');
    expect(mensajes({ mensajes: [texto('🙂 Hola')] }, { cfg: { nivelEmojis: 'ninguno' } }).items[0]!['payload'].text.body).toBe('Hola');
    // También en el mensaje con botón de enlace.
    expect(mensajes({ mensajes: [enlace(GENERICO)] }, { cfg: { nivelEmojis: 'ninguno' } }).items[0]!['texto']).not.toContain('🙂');
  });

  it('el mensaje GENÉRICO (palabra prohibida, QR rechazado…) también respeta `nivelEmojis`: con «ninguno» no sale el 🙂, en ningún texto del ítem', () => {
    for (const mal of [texto('Ya va en camino.'), texto('Pagado')]) {
      const r = mensajes({ mensajes: [mal] }, { cfg: { nivelEmojis: 'ninguno' } }).items[0]!;
      expect(JSON.stringify([r['payload'], r['texto'], r['respaldo']]), JSON.stringify(mal)).not.toContain('🙂');
      expect(r['texto']).toContain('Esto prefiero que lo vea una persona del restaurante.'); // la frase queda entera, sin el emoji ni un espacio suelto
    }
    // NEGANDO: con «pocos» (o sin el dato) el 🙂 sigue; con «muchos» también.
    for (const cfg of [{ nivelEmojis: 'pocos' }, { nivelEmojis: 'muchos' }, {}]) {
      expect(mensajes({ mensajes: [texto('Ya va en camino.')] }, { cfg }).items[0]!['texto'], JSON.stringify(cfg)).toContain('🙂');
    }
  });
});
