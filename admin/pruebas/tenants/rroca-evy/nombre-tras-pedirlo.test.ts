/**
 * EL NOMBRE QUE EL CLIENTE DA TRAS PEDÍRSELO (reclamo 59, 11/11/2026): «Cuando pregunta el nombre, sigue respondiendo con el título del teléfono origen».
 * La bienvenida termina pidiendo el nombre («¿cuál es tu nombre y qué te gustaría mejorar?»). Si el cliente contestaba solo «Rosa» (o «Rosa, quiero mejorar la
 * mandíbula»), `evNombreDelMensaje` lo descartaba —solo valía tras aceptar agendar o tras pedir agendar— y los avisos, el cierre y el miniCRM salían con el nombre
 * del PERFIL de WhatsApp. Ahora cuenta cuando el ÚLTIMO mensaje del asistente pide el nombre. Mismo código en Evy y Emma (y en sus tres/dos variantes).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../../../Flujos/experimental');
type Turno = { r: 'u' | 'a'; t: string };
const cargar = (cliente: string): ((texto: string, historial: Turno[]) => string) => {
  const codigo = readFileSync(join(RAIZ, `${cliente}/src/lib/ev.js`), 'utf8');
  const lib = runInNewContext(`const EV_PROMPT='';\n${readFileSync(join(RAIZ, '../src/core/texto/filtro-redaccion.js'), 'utf8')}\n${codigo}\n({ f: evNombreDelMensaje })`, {}) as { f: (t: string, h: Turno[]) => string };
  return lib.f;
};
const BIENVENIDA = '¡Hola! 👋 Soy el asistente virtual de la Dra. Cuéntame, ¿cuál es tu nombre y qué te gustaría mejorar?';
const PIDE: Turno[] = [{ r: 'u', t: 'Hola' }, { r: 'a', t: BIENVENIDA }];
const NO_PIDE: Turno[] = [{ r: 'u', t: 'Hola' }, { r: 'a', t: 'Hola, ¿en qué te puedo ayudar?' }];

describe.each(['rroca-evy', 'rroca-emma'])('%s: el nombre dado tras pedírselo gana sobre el del perfil', (cliente) => {
  const nombre = cargar(cliente);
  it('«Rosa», «Rosa Pérez» y «Rosa, quiero mejorar la mandíbula» dan «Rosa»', () => {
    for (const t of ['Rosa', 'Rosa Pérez', 'Rosa, quiero mejorar la mandíbula']) expect(nombre(t, PIDE), t).toBe('Rosa');
  });
  it('NEGADA: sin que el asistente haya pedido el nombre, «Rosa» suelto no se toma por nombre', () => {
    expect(nombre('Rosa', NO_PIDE)).toBe('');
  });
  it('NEGADA: lo que no es un nombre sigue sin serlo aunque se haya pedido', () => {
    for (const t of ['Quiero precios', 'Embarazada', '¿Cuánto cuesta?', 'de La Paz']) expect(nombre(t, PIDE), t).toBe('');
  });
  it('NEGADA: si el último mensaje es del cliente (el asistente aún no pidió nada), no cuenta', () => {
    expect(nombre('Rosa', [{ r: 'a', t: BIENVENIDA }, { r: 'u', t: 'Hola' }])).toBe('');
  });
  it('«Soy Rosa» y «Mi nombre es Rosa» siguen funcionando sin que se lo pidan', () => {
    expect(nombre('Soy Rosa', NO_PIDE)).toBe('Rosa');
    expect(nombre('Mi nombre es Rosa y quiero ver precios', NO_PIDE)).toBe('Rosa');
  });
});
