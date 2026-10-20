/**
 * «EL PUENTE» DE ANTONIO (tenant rroca-antonio) — EL CONTRATO CON EL RESCATE DE LAS 22 H (módulo `rescate-22h` del PR #567; este flujo NO construye el rescate, solo declara y prueba su contrato).
 *
 * El módulo del rescate (un flujo-barrido aparte, uno por tenant) le manda UN mensaje a toda conversación de venta con 22 h de silencio. Para no escribirle a quien no corresponde exige al flujo consumidor
 * seis cosas (`Flujos/experimental/rescate-22h/LEEME.md`, «Contrato del flujo consumidor»); los datos del rescate de Antonio declararán `contratoConsumidor: { prueba: <esta ruta> }`:
 *
 *   1. reporta CADA entrante a la ingesta con `tipo` y el `texto` real;
 *   2. reporta las derivaciones a una persona con `evento: 'no_contactar'`, aunque salga el respaldo;
 *   3. conserva la expresión de «no me escribas» del reporte entrante;
 *   4. el cobro va con `qr_enviado`/regla 2 y cotejo en el servidor, o el comprobante llega como imagen o documento;
 *   5. la ruta del número tiene `flujo: 'venta'` (precondición de operación, no de código: `fijar-flujos --tenant rroca-antonio --flujos venta`);
 *   6. CONDICIÓN DURA DE ANTONIO: todo camino de protección por violencia o miedo reporta `evento: 'no_contactar'` y desde ese momento no recibe rescate. Sin esta prueba negativa NO se publica su rescate.
 *
 * Riesgo residual declarado (el mismo del módulo): si el mensaje de protección no salió ni en su respaldo, no se reporta y esa persona podría recibir un rescate.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { COMPROBANTE, ANA, PRELLENADOS, crear, hablar, mAudio, mBoton, mDocumento, mImagen, mTexto, panelConQr } from './mundo';
import { vigilarUx } from './vigilante-ux';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DISENO = readFileSync(join(AQUI, '../../../../Flujos/experimental/rroca-antonio/DISENO.md'), 'utf8');
const entrantes = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => c['direccion'] === 'entrante');
const noContactar = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => c['evento'] === 'no_contactar');
const mundo = (o: Parameters<typeof crear>[0] = {}): ReturnType<typeof crear> => { const w = crear(o); vigilarUx(w); return w; };

describe('punto 1: cada entrante se reporta con `tipo` y el `texto` real', () => {
  it('texto, toque de botón, audio, imagen, documento y lo que el canal no lee: un reporte entrante con tipo y texto', () => {
    const w = mundo();
    const casos: Array<[J, string, RegExp]> = [
      [mTexto('hola, quiero el libro'), 'text', /hola, quiero el libro/],
      [mBoton('b_pack'), 'interactive', /El cliente seleccionó una opción/],
      [mAudio(), 'audio', /nota de voz/],
      [mImagen(), 'image', /foto/],
      [mDocumento(), 'document', /archivo/],
      [{ type: 'sticker', sticker: { id: 's' } }, 'sticker', /sticker/],
    ];
    for (const [msg, tipo, texto] of casos) {
      const t = hablar(w, ANA, msg);
      const e = entrantes(t);
      expect(e, tipo).toHaveLength(1);
      expect(e[0]!['tipo'], tipo).toBe(tipo);
      expect(String(e[0]!['texto']), tipo).toMatch(texto);
      expect(e[0]!['telefono']).toBe(ANA);
    }
  });
  it('el entrante se reporta ANTES que la respuesta (el reporte está arriba en el lienzo)', () => {
    const t = hablar(mundo(), ANA, mTexto('hola'));
    expect(t.orden.indexOf('Reportar mensaje (entrante)')).toBeLessThan(t.orden.indexOf('Reportar mensaje (saliente)'));
  });
});

describe('punto 3: la petición de «no me escribas» del reporte entrante (regex PROPIA acotada a peticiones)', () => {
  it('«no me escribas más», «no me manden mensajes», «no me llamen», «no me molesten», «déjenme de escribir», «bórrame», «stop» salen con `evento: no_contactar`', () => {
    for (const texto of ['no me escribas más', 'no me manden más mensajes', 'por favor no me llamen', 'no me molesten', 'dejen de escribir por favor', 'bórrame de la lista', 'stop', 'no quiero más mensajes', 'no me contacten']) {
      const t = hablar(mundo(), ANA, mTexto(texto));
      expect(noContactar(t).filter((c) => c['direccion'] === 'entrante').length, texto).toBe(1);
    }
  });
  it('las QUEJAS no son una petición: «no me mandaron el material», «no me contactan», «pagué y no me contactan», «no me llegó», «no me escribieron» NO marcan `no_contactar`', () => {
    for (const texto of ['no me mandaron el material', 'no me contactan', 'pagué y no me contactan', 'no me llegó nada', 'no me escribieron todavía', 'no me llamaron', 'quiero escribirte una duda']) {
      const t = hablar(mundo(), ANA, mTexto(texto));
      expect(noContactar(t), texto).toHaveLength(0);
    }
  });
});

describe('punto 2: las derivaciones a una persona reportan `no_contactar` aunque salga el respaldo (VER punto 6 para la protección)', () => {
  it('el reporte saliente de la protección viaja con el evento aunque el envío principal falle y salga el respaldo en texto', () => {
    const w = mundo({ envio: { 'Enviar a WhatsApp': 'error' } });
    const t = hablar(w, ANA, mTexto('mi pareja me golpea'));
    expect(t.mensajes.filter((m) => m.ok && m.respaldo)).toHaveLength(1);
    expect(noContactar(t).filter((c) => c['direccion'] === 'saliente')).toHaveLength(1);
  });
});

describe('punto 4: el cobro va con `qr_enviado`/regla 2 y cotejo en el servidor', () => {
  it('el QR reporta `qr_enviado` con `reglaCobro: 2`, la referencia del pedido y el monto del catálogo; el comprobante (imagen o PDF) se coteja en el servidor', () => {
    const w = mundo();
    const q = hablar(w, ANA, mTexto(PRELLENADOS.pack));
    expect(q.llamadas.ingesta.find((c) => c['evento'] === 'qr_enviado')).toMatchObject({ reglaCobro: 2, monto: 49, direccion: 'saliente' });
    for (const [msg, mime] of [[mImagen(), 'image/jpeg'], [mDocumento(), 'application/pdf']] as const) {
      const v = mundo({ panel: panelConQr(49), medio: { clasificacion: COMPROBANTE, mime } });
      const t = hablar(v, ANA, msg);
      expect(t.llamadas.cotejo, mime).toHaveLength(1);
    }
  });
});

describe('punto 5: la ruta del número tiene `flujo: venta` (precondición de operación)', () => {
  it('queda DECLARADA en el diseño: sin ella el rescate no encuentra la conversación como de venta', () => {
    expect(DISENO).toMatch(/fijar-flujos[^\n]*rroca-antonio[^\n]*venta/);
  });
});

describe('punto 6 (CONDICIÓN DURA): todo camino de protección por violencia o miedo reporta `no_contactar`', () => {
  const caminos: Array<[string, Parameters<typeof crear>[0], J, (w: ReturnType<typeof crear>) => void]> = [
    ['texto con raíz de violencia', {}, mTexto('mi pareja me golpea'), () => undefined],
    ['miedo dirigido a la pareja', {}, mTexto('le tengo miedo a mi esposo'), () => undefined],
    ['amenazas', {}, mTexto('me amenaza todos los días'), () => undefined],
    ['nota de voz transcrita', { medio: { transcripcion: 'mi marido me pega' } }, mAudio(), () => undefined],
    ['texto leído en una captura', { medio: { clasificacion: { categoria: 'publicidad', texto: 'me maltrata mi pareja' } } }, mImagen(), () => undefined],
    ['pie de foto de un comprobante', { panel: panelConQr(49), medio: { clasificacion: COMPROBANTE } }, mImagen({ caption: 'me controla y tengo miedo' }), () => undefined],
    ['la marca RIESGO del modelo', { modeloDice: 'RIESGO' }, mTexto('no aguanto más esta situación en mi casa'), (w) => { hablar(w, ANA, mTexto('hola')); }],
    ['el respaldo en texto (el envío principal cae)', { envio: { 'Enviar a WhatsApp': 'error' as const } }, mTexto('mi pareja me agrede'), () => undefined],
  ];
  for (const [rotulo, opciones, msg, antes] of caminos) {
    it(`${rotulo}: el reporte saliente lleva el evento y no hay oferta`, () => {
      const w = mundo(opciones);
      antes(w);
      const t = hablar(w, ANA, msg);
      expect(t.mensajes.some((m) => m.tipo === 'image')).toBe(false);
      expect(noContactar(t).filter((c) => c['direccion'] === 'saliente'), rotulo).toHaveLength(1);
    });
  }
  it('desde ese momento TODA respuesta del flujo a ese teléfono vuelve a reportar `no_contactar` (comprar, pedir el QR, preguntar el precio): nunca queda una respuesta de venta sin el evento', () => {
    const w = mundo();
    hablar(w, ANA, mTexto('mi pareja me golpea'));
    for (const msg of [mTexto('quiero comprar el libro'), mTexto(PRELLENADOS.pack), mBoton('b_libro'), mTexto('¿cuánto cuesta?'), mTexto('hola')]) {
      const t = hablar(w, ANA, msg);
      expect(t.mensajes.length).toBeLessThanOrEqual(1);
      expect(noContactar(t).filter((c) => c['direccion'] === 'saliente'), JSON.stringify(msg)).toHaveLength(t.mensajes.length);
    }
  });
});
