/**
 * «NOCHES SIN INSOMNIO» DE RUBÉN (tenant rroca-ruben) — LA MARCA `riesgo: true` HACIA LA INGESTA (PR-4).
 *
 * El servidor del rescate (PR #566) escribe `riesgoEn` en la conversación cuando la ingesta recibe `evento: 'no_contactar'` junto con `riesgo: true`; esa marca la consola no puede borrar y
 * el rescate de 22 h nunca le escribe a quien la tenga. Este flujo la envía en TODA ruta de CRISIS y SOLO en ellas: «no me escribas» y las derivaciones comunes llevan `no_contactar` a secas.
 * Costo: 0 mensajes por conversación (es un campo más del mismo reporte). Un servidor sin #566 ignora el campo desconocido.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, COMPROBANTE, crear, hablar, mAudio, mImagen, mTexto, panelConQr } from './mundo';
import { vigilarUx } from './vigilante-ux';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DISENO = readFileSync(join(AQUI, '../../../../Flujos/experimental/rroca-ruben/DISENO.md'), 'utf8');
const mundo = (o: Parameters<typeof crear>[0] = {}): ReturnType<typeof crear> => { const w = crear(o); vigilarUx(w); return w; };
const conRiesgo = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => 'riesgo' in c && c['riesgo'] !== undefined);
const avisosNoContactar = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => c['evento'] === 'no_contactar');

describe('riesgo: true acompaña a no_contactar en TODA ruta de crisis', () => {
  const caminos: Array<[string, Parameters<typeof crear>[0], J, (w: ReturnType<typeof crear>) => void]> = [
    ['texto con raíz de crisis', {}, mTexto('ya no quiero vivir'), () => undefined],
    ['nota de voz transcrita', { medio: { transcripcion: 'ya no quiero seguir viviendo' } }, mAudio(), () => undefined],
    ['texto leído en una captura', { medio: { clasificacion: { categoria: 'publicidad', texto: 'quiero morir' } } }, mImagen(), () => undefined],
    ['la marca RIESGO del modelo', { modeloDice: 'RIESGO' }, mTexto('no sé cuánto más voy a poder con esto'), (w) => { hablar(w, ANA, mTexto('hola')); }],
    ['el respaldo en texto (el envío principal cae)', { envio: { 'Enviar a WhatsApp': 'error' as const } }, mTexto('quiero quitarme la vida'), () => undefined],
  ];
  for (const [rotulo, opciones, msg, antes] of caminos) {
    it(`${rotulo}: todo reporte con no_contactar lleva riesgo true y hay al menos uno`, () => {
      const w = mundo(opciones);
      antes(w);
      const t = hablar(w, ANA, msg);
      const nc = avisosNoContactar(t);
      expect(nc.length, rotulo).toBeGreaterThan(0);
      for (const c of nc) expect(c['riesgo'], rotulo).toBe(true);
      expect(conRiesgo(t).every((c) => c['evento'] === 'no_contactar' && c['riesgo'] === true)).toBe(true);
    });
  }
  it('el pie de foto de un comprobante que habla de una crisis: el reporte del entrante lleva riesgo true', () => {
    const t = hablar(mundo({ panel: panelConQr(70), medio: { clasificacion: COMPROBANTE } }), ANA, mImagen({ caption: 'ya no quiero vivir' }));
    const entrante = t.llamadas.ingesta.filter((c) => c['direccion'] === 'entrante' && c['evento'] === 'no_contactar');
    expect(entrante).toHaveLength(1);
    expect(entrante[0]!['riesgo']).toBe(true);
  });
  it('ficha con la protección vigente: cada respuesta posterior sigue reportando riesgo true', () => {
    const w = mundo();
    hablar(w, ANA, mTexto('ya no quiero vivir'));
    for (const msg of [mTexto('quiero comprar el libro'), mTexto('¿cuánto cuesta?'), mTexto('hola')]) {
      const t = hablar(w, ANA, msg);
      const sal = t.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente');
      expect(sal.length).toBeGreaterThan(0);
      for (const c of sal) { expect(c['evento']).toBe('no_contactar'); expect(c['riesgo']).toBe(true); }
    }
  });
});

describe('riesgo: true NUNCA viaja fuera de la crisis (prueba negada)', () => {
  it('«no me escribas» lleva no_contactar y NO riesgo', () => {
    for (const texto of ['no me escribas más', 'stop', 'dame de baja', 'no me contacten']) {
      const t = hablar(mundo(), ANA, mTexto(texto));
      expect(avisosNoContactar(t).length, texto).toBeGreaterThan(0);
      expect(conRiesgo(t), texto).toHaveLength(0);
    }
  });
  it('una consulta médica informativa o una conversación común NO lleva riesgo', () => {
    for (const texto of ['¿hay riesgo de sobredosis con melatonina?', 'hola', 'quiero el libro']) {
      const t = hablar(mundo(), ANA, mTexto(texto));
      expect(conRiesgo(t), texto).toHaveLength(0);
    }
  });
  it('quien pidió la baja y luego conversa sigue sin llevar riesgo', () => {
    const w = mundo();
    hablar(w, ANA, mTexto('no me escribas más'));
    const t = hablar(w, ANA, mTexto('hola'));
    expect(conRiesgo(t)).toHaveLength(0);
  });
});

describe('compatibilidad y costo', () => {
  it('el servidor sin #566 ignora el campo `riesgo` y DISENO.md lo declara', () => {
    expect(DISENO).toMatch(/riesgo: true/);
    expect(DISENO).toMatch(/#566/);
  });
  it('0 mensajes agregados: la crisis responde con los mismos mensajes de siempre', () => {
    const t = hablar(mundo(), ANA, mTexto('ya no quiero vivir'));
    expect(t.mensajes.length).toBeLessThanOrEqual(1);
  });
});
