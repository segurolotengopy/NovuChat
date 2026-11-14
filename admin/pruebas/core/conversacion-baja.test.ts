/**
 * Core · conversación · baja por texto (`Flujos/src/core/conversacion/baja.js`). El archivo se carga con `node:vm` en un contexto vacío
 * (como el Code de n8n: sin globales de Node). La expresión es, sin un byte de diferencia, la acotada a pedidos de la venta digital
 * (revisión de #584): mientras esa copia exista, una prueba exige que sigan iguales.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAIZ_REPO, cargarFuente } from './fuente-vm';

const L = cargarFuente<{
  BJ_BAJA: RegExp; BJ_TEXTO_BAJA: string; bjPlegar: (t: unknown) => string; bjPideBaja: (t: unknown) => boolean; bjTextoBaja: (p?: unknown) => string;
}>(['Flujos/src/core/conversacion/baja.js'], ['BJ_BAJA', 'BJ_TEXTO_BAJA', 'bjPlegar', 'bjPideBaja', 'bjTextoBaja']);

const SI = [
  'no me escribas más', 'No me escriban', 'NO ME ESCRIBAN MÁS', 'ya no me escriban', 'no me escribás', 'no me escriba más por favor',
  'n0 me escribas', 'ｎｏ　ｍｅ　ｅｓｃｒｉｂａｓ', 'basta, no me escriban', 'para de escribirme', 'dejen de escribirme', 'deja de mandarme mensajes',
  'no me contacten', 'no me molesten', 'no me llamen', 'no quiero recibir más mensajes', 'no quiero más mensajes', 'no vuelvan a escribirme',
  'dame de baja', 'denme de baja', 'bórrenme de la lista', 'stop', 'STOP por favor',
];
const NO = [
  'hola', 'quiero agendar una cita', 'el doctor dijo que no me escriban', 'mi ex no deja de escribirme', 'no me escribas el precio, mándame el QR',
  'no me escribiste el precio', 'no me escribas con tanta formalidad', 'no me llamen la atención', 'quiero dar de baja mi pedido',
  'dame de baja el plan anterior', '¿no me llamaron ayer?', 'no me llegó el mensaje', 'stop the music', '', '   ',
];

describe('bjPideBaja', () => {
  it.each(SI)('SÍ es un pedido de baja: «%s»', (t) => { expect(L.bjPideBaja(t)).toBe(true); });
  it.each(NO)('NIEGA: «%s» no es un pedido de baja', (t) => { expect(L.bjPideBaja(t)).toBe(false); });
  it('NIEGA: lo que no es texto no rompe ni cuenta', () => {
    for (const v of [undefined, null, 0, 42, {}, [], true]) expect(L.bjPideBaja(v)).toBe(false);
  });
  it('un texto larguísimo no cuelga la expresión (menos de 250 ms con 4.096 caracteres hostiles)', () => {
    const hostil = `${'no me escriban '.repeat(270)}pero el doctor dice`.slice(0, 4096);
    const t0 = Date.now();
    L.bjPideBaja(hostil);
    L.bjPideBaja('deja '.repeat(800));
    expect(Date.now() - t0).toBeLessThan(250);
  });
});

describe('bjPlegar', () => {
  it('ancho completo, tildes, mayúsculas, cifras que hacen de letras y espacios', () => {
    expect(L.bjPlegar('  N0   me   ESCRIBÁS  ')).toBe(' no me escribas ');
    expect(L.bjPlegar('ｓｔｏｐ')).toBe('stop');
    expect(L.bjPlegar(undefined)).toBe('');
  });
});

describe('bjTextoBaja', () => {
  it('sin texto propio sale el neutro: una frase, sin pregunta ni promesa', () => {
    expect(L.bjTextoBaja()).toBe(L.BJ_TEXTO_BAJA);
    expect(L.BJ_TEXTO_BAJA).not.toMatch(/\?|te (avis|llam|escribir)|pago|menu|menú/i);
  });
  it('el texto propio del negocio se usa si es útil', () => {
    expect(L.bjTextoBaja('  Listo,  no le escribiremos más. ')).toBe('Listo, no le escribiremos más.');
  });
  it('NIEGA: vacío, solo espacios, no texto o demasiado largo → el neutro', () => {
    for (const v of ['', '   ', 5, null, {}, 'x'.repeat(301)]) expect(L.bjTextoBaja(v)).toBe(L.BJ_TEXTO_BAJA);
  });
});

describe('paridad con la copia de origen (hasta que la etapa 1 la retire)', () => {
  it('BJ_BAJA es literalmente la expresión de la venta digital', () => {
    const origen = readFileSync(join(RAIZ_REPO, 'Flujos/experimental/rroca-antonio/src/lib/ra.js'), 'utf8');
    const m = /^const RA_BAJA = (\/.+\/i);$/m.exec(origen);
    expect(m, 'la copia de origen ya no existe: borrar esta prueba').not.toBeNull();
    expect(String(L.BJ_BAJA)).toBe(m![1]);
  });
});
