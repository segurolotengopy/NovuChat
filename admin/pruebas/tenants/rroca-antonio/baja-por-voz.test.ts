/**
 * LA BAJA POR NOTA DE VOZ SE REGISTRA (17/11/2026). «Decidir turno» lee la transcripción como texto del cliente, así que «no me escriban más» dicho por audio toma la ruta `baja` y se confirma; pero el `no_contactar`
 * del texto escrito viaja con el reporte del ENTRANTE y el de un audio va sin texto: la confirmación debe llevar el evento ella misma («solo se ofrece lo que se cumple»). Solo cuentan las transcripciones cortas
 * (tope `BAJA_POR_VOZ_MAX`): un audio largo que menciona «no me contacten» sigue el camino normal.
 */
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';
import type { ResultadoTurno } from '../../lib/n8n-de-mentira';
import { ANA, PRODUCCION, PRUEBA, crear, hablar, mAudio, mTexto } from './mundo';

const saliente = (t: ResultadoTurno): J[] => t.llamadas.ingesta.filter((c) => c['direccion'] === 'saliente');
const noContactarSaliente = (t: ResultadoTurno): J[] => saliente(t).filter((c) => c['evento'] === 'no_contactar');
const porVoz = (transcripcion: string): ResultadoTurno => hablar(crear({ medio: { transcripcion } }), ANA, mAudio());
const confirma = (t: ResultadoTurno): boolean => t.mensajes.some((m) => /no quieres recibir más mensajes/.test(JSON.stringify(m)));

describe('baja por nota de voz', () => {
  it('«no me escriban más» por audio: ruta baja, confirmación enviada y el reporte saliente lleva no_contactar', () => {
    const t = porVoz('no me escriban más');
    expect(t.fallo).toBeNull();
    expect(confirma(t)).toBe(true);
    expect(noContactarSaliente(t)).toHaveLength(1);
  });
  it('el texto escrito sigue igual: confirma y el saliente NO lleva el evento (viaja con el entrante)', () => {
    const t = hablar(crear(), ANA, mTexto('no me escriban más'));
    expect(confirma(t)).toBe(true);
    expect(noContactarSaliente(t)).toHaveLength(0);
  });
  it('un audio largo (más de 160 caracteres) que dice «no me contacten» NO es baja', () => {
    const t = porVoz('hola, quería preguntarte por el libro y por el precio del pack completo, porque mi hermana también quiere comprarlo y me pidió que averigüe todo antes de decidir. Por favor, no me escriban más');
    expect(confirma(t)).toBe(false);
    expect(noContactarSaliente(t)).toHaveLength(0);
  });
  it('un audio «mándame el QR» no es baja', () => {
    const t = porVoz('mándame el QR');
    expect(confirma(t)).toBe(false);
    expect(noContactarSaliente(t)).toHaveLength(0);
  });
  it('borde exacto: 160 caracteres cuentan como baja por voz; 161 no', () => {
    const base = 'no me escriban más';
    const de = (n: number): string => 'quiero saber del libro '.repeat(10).slice(0, n - base.length - 2) + '. ' + base;
    expect(de(160)).toHaveLength(160);
    expect(de(161)).toHaveLength(161);
    const corto = porVoz(de(160));
    expect(confirma(corto)).toBe(true);
    expect(noContactarSaliente(corto)).toHaveLength(1);
    const largo = porVoz(de(161));
    expect(confirma(largo)).toBe(false);
    expect(noContactarSaliente(largo)).toHaveLength(0);
  });
  it('el código lleva la marca y su lectura (comprobación estática; el comportamiento lo prueban los casos de arriba)', () => {
    for (const flujo of [PRODUCCION, PRUEBA]) {
      const codigo = (n: string): string => String(flujo.nodes.find((x) => x.name === n)!.parameters['jsCode']);
      expect(codigo('Decidir turno')).toMatch(/BAJA_POR_VOZ_MAX\s*=\s*160/);
      expect(codigo('Armar mensajes')).toMatch(/plan\.porVoz[^\n]*no_contactar/);
    }
  });
});
