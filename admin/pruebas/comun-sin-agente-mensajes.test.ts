/**
 * LOS CONSTRUCTORES DE MENSAJES (`Flujos/experimental/comun-sin-agente/src/mensajes.js`).
 *
 * Se EJECUTAN con el mismo ayudante que las demás suites de flujos (`./lib/flujo`), que le quita al código los
 * globales que el sandbox de n8n no tiene (`URL`, `Buffer`, `crypto`, `process`, `require`…): si el módulo usara
 * alguno, aquí reventaría igual que en producción. Cada límite de la Cloud API de Meta tiene su caso que lo pasa.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar } from './lib/flujo';

const RUTA = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/comun-sin-agente/src/mensajes.js');
const FUENTE = readFileSync(RUTA, 'utf8');
const NOMBRES = ['cmRecorte', 'cmTexto', 'cmBotones', 'cmLista', 'cmEnlace', 'cmUrlWa', 'cmMensaje', 'cmSinMencionDelBoton', 'cmContactoConBoton'] as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
const M = ejecutar(`${FUENTE}\nreturn [{ json: { ${NOMBRES.join(', ')} } }];`, [{}])[0] as Record<(typeof NOMBRES)[number], Fn>;

describe('el módulo es autosuficiente', () => {
  it('no usa funciones cn*, nodos, require ni los globales que n8n no tiene', () => {
    const sinComentarios = FUENTE.replace(/\/\/.*$/gm, '');
    expect(sinComentarios).not.toMatch(/\bcn[A-Z]\w*\(/);
    expect(sinComentarios).not.toMatch(/\$\(|\$input|\$json|\brequire\(|\bURL\b|\bBuffer\b|\bcrypto\b|\bprocess\b/);
  });
  it('todos sus nombres llevan el prefijo cm (no choca con las ayudas cn* del flujo)', () => {
    const declarados = [...FUENTE.matchAll(/^(?:function|const) (\w+)/gm)].map((m) => m[1]);
    expect(declarados.length).toBeGreaterThanOrEqual(NOMBRES.length);
    expect(declarados.filter((n) => !/^cm[A-Z]/.test(n!))).toEqual([]);
  });
});

describe('texto', () => {
  it('cuerpo de la Cloud API con `to` vacío (lo pone el último nodo) y vista previa de enlaces', () => {
    expect(M.cmTexto('Hola')).toEqual({ messaging_product: 'whatsapp', recipient_type: 'individual', to: '', type: 'text', text: { preview_url: true, body: 'Hola' } });
  });
  it('recorta a 4000 con «…» y no antes', () => {
    expect(M.cmTexto('a'.repeat(4000)).text.body).toHaveLength(4000);
    const largo = M.cmTexto('a'.repeat(4001)).text.body as string;
    expect(largo).toHaveLength(4000);
    expect(largo.endsWith('…')).toBe(true);
  });
  it('un valor ausente no escribe «undefined» ni «null»', () => {
    expect(M.cmTexto(undefined).text.body).toBe('');
    expect(M.cmTexto(null).text.body).toBe('');
    expect(M.cmRecorte(undefined, 10)).toBe('');
  });
});

describe('botones', () => {
  const tres = [{ id: 'a', title: 'Uno' }, { id: 'b', title: 'Dos' }, { id: 'c', title: 'Tres' }, { id: 'd', title: 'Cuatro' }];
  it('como mucho TRES botones (Meta rechaza cuatro)', () => {
    const b = M.cmBotones('Elige', tres).interactive.action.buttons;
    expect(b).toHaveLength(3);
    expect(b.map((x: { reply: { id: string } }) => x.reply.id)).toEqual(['a', 'b', 'c']);
  });
  it('título a 20, cuerpo a 1024 e id a 200', () => {
    const m = M.cmBotones('c'.repeat(1100), [{ id: 'i'.repeat(300), title: 'T'.repeat(30) }]);
    expect(m.interactive.body.text).toHaveLength(1024);
    expect(m.interactive.action.buttons[0].reply.title).toHaveLength(20);
    expect(m.interactive.action.buttons[0].reply.id).toHaveLength(200);
    expect(m.interactive.type).toBe('button');
  });
  it('sin botones no revienta (lista vacía)', () => {
    expect(M.cmBotones('x', undefined).interactive.action.buttons).toEqual([]);
  });
});

describe('lista', () => {
  const filas = Array.from({ length: 12 }, (_, i) => ({ id: 'f' + i, title: 'Fila ' + i + ' ' + 'x'.repeat(30), description: 'd'.repeat(100) }));
  it('como mucho DIEZ filas, título a 24 y descripción a 72', () => {
    const l = M.cmLista('Cuerpo', 'Ver opciones muy largas del menú', 'Un título de sección larguísimo', filas).interactive;
    expect(l.type).toBe('list');
    expect(l.action.sections[0].rows).toHaveLength(10);
    expect(l.action.sections[0].rows[0].title).toHaveLength(24);
    expect(l.action.sections[0].rows[0].description).toHaveLength(72);
    expect(l.action.button).toHaveLength(20);
    expect(l.action.sections[0].title).toHaveLength(24);
  });
  it('una fila sin descripción la lleva vacía (no «undefined»)', () => {
    expect(M.cmLista('c', 'b', 't', [{ id: 'a', title: 'A' }]).interactive.action.sections[0].rows[0].description).toBe('');
  });
});

describe('enlace y URL de WhatsApp', () => {
  it('cta_url con el texto del botón a 20', () => {
    const e = M.cmEnlace('Mira', 'Un texto de botón largo de más', 'https://ejemplo.com/x').interactive;
    expect(e.type).toBe('cta_url');
    expect(e.action.parameters).toEqual({ display_text: 'Un texto de botón l…', url: 'https://ejemplo.com/x' });
  });
  it('cmUrlWa deja solo dígitos en el número y codifica el saludo', () => {
    expect(M.cmUrlWa('+12 3456-78', 'Hola, soy yo & más')).toBe('https://wa.me/12345678?text=Hola%2C%20soy%20yo%20%26%20m%C3%A1s');
  });
  it('NIEGA: un saludo con «&» o «#» no corta el enlace', () => {
    expect(M.cmUrlWa('1', 'a&b#c')).not.toMatch(/[&#]/);
  });
  it('sin saludo no deja «undefined»', () => {
    expect(M.cmUrlWa('123', undefined)).toBe('https://wa.me/123?text=');
  });
});

describe('item de salida', () => {
  it('el respaldo es el texto si no se da', () => {
    expect(M.cmMensaje('cliente', {}, 'T', undefined, { tipoReporte: 'text' })).toEqual({ para: 'cliente', payload: {}, texto: 'T', respaldo: 'T', tipoReporte: 'text' });
  });
  it('un respaldo explícito manda', () => {
    expect(M.cmMensaje('cliente', {}, 'T', 'R').respaldo).toBe('R');
  });
});

describe('pasar con una persona: el botón, o solo texto', () => {
  const op = { numero: '71234561', desde: '71234562', cuerpo: 'Eso lo coordina recepción. Tócale el botón y le escribes directo.', botonTexto: 'Escribir a recepción', saludo: 'Hola', evento: 'no_contactar' };
  it('con número distinto del de quien escribe: botón cta_url a wa.me, y el respaldo lleva el enlace', () => {
    const m = M.cmContactoConBoton(op);
    expect(m.conBoton).toBe(true);
    expect(m.tipoReporte).toBe('interactive');
    expect(m.payload.interactive.type).toBe('cta_url');
    expect(m.payload.interactive.action.parameters.url).toBe('https://wa.me/71234561?text=Hola');
    expect(m.respaldo).toContain('Escríbele aquí: https://wa.me/71234561?text=Hola');
    expect(m.texto).toBe(op.cuerpo);
    expect(m.evento).toBe('no_contactar');
    expect(m.para).toBe('cliente');
  });
  it('NIEGA: sin número no hay botón y el texto NO nombra uno', () => {
    const m = M.cmContactoConBoton({ ...op, numero: '' });
    expect(m.conBoton).toBe(false);
    expect(m.payload.type).toBe('text');
    expect(m.texto).not.toMatch(/bot[oó]n/i);
    expect(m.texto).toBe('Eso lo coordina recepción.');
    expect(m.respaldo).toBe(m.texto);
  });
  it('NIEGA: si el número es el de quien escribe, tampoco hay botón (un botón a su propio chat no sirve)', () => {
    const m = M.cmContactoConBoton({ ...op, numero: '+7 1234 562', desde: '71234562' });
    expect(m.conBoton).toBe(false);
    expect(m.payload.type).toBe('text');
  });
  it('si al quitar la mención no queda nada, sale el texto por defecto', () => {
    expect(M.cmSinMencionDelBoton('Tócale el botón.', 'Lo coordina una persona.')).toBe('Lo coordina una persona.');
    expect(M.cmSinMencionDelBoton('Hola. Toca el botón de abajo', 'x')).toBe('Hola.');
    expect(M.cmSinMencionDelBoton('Escríbele tocando el botón de abajo.', 'x')).toBe('Escríbele de abajo.');
  });
  it('un texto sin mención del botón queda igual', () => {
    expect(M.cmSinMencionDelBoton('Gracias por escribirnos.', 'x')).toBe('Gracias por escribirnos.');
  });
  it('`para` se puede cambiar (el flujo nombra a sus destinatarios)', () => {
    expect(M.cmContactoConBoton({ ...op, para: 'paciente' }).para).toBe('paciente');
  });
});
