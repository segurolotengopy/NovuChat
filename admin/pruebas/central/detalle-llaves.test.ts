// @vitest-environment jsdom
/**
 * EL CAMPO DE ESCRIBIR Y EL SELECTOR DE ADJUNTOS DEL DETALLE (defecto de B4 en producción, 15/11/2026).
 *
 * El defecto: los dos llevaban la MISMA llave (`key={ficha.id}`) como hermanos. React empareja a los hijos por llave y, al
 * quitar y volver a poner el campo (cada tomar/devolver), dejaba vivo el campo viejo: reloj congelado, texto que no se borraba
 * al enviar (de ahí un segundo «Hola» al pulsar de nuevo) y el clip fuera de la vista. Pasaba solo con la bandera de medios
 * encendida (apagada, el selector no se pinta y no hay llave repetida).
 *
 * Estas pruebas pintan `PiezasDePersona`, que es EL MISMO componente que usa el Detalle (con los componentes reales, en un DOM
 * real con React real), y recorren lo que hace una persona:
 *  1. tomar y devolver varias veces deja UN solo campo (y UN selector) al tomar, y ninguno al devolver;
 *  2. un envío sale UNA vez: el texto se borra y el botón queda apagado, un segundo clic no manda nada;
 *  3. React no avisa de llaves repetidas en todo el recorrido;
 *  4. NEGANDO: con la llave repetida, el mismo recorrido deja campos de más (la prueba muerde sin el arreglo);
 *  5. guarda de fuente: las llaves de los dos hermanos son distintas.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapaTurno } from '../../web/src/central/lib/turno';
import type { CapaAdjunto } from '../../web/src/central/lib/adjuntos';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const React = desdeWeb('react') as typeof import('react');
const { createRoot } = desdeWeb('react-dom/client') as typeof import('react-dom/client');
const { flushSync } = desdeWeb('react-dom') as typeof import('react-dom');
const { PiezasDePersona } = await import('../../web/src/central/componentes/PiezasDePersona');
const { EscribirComoPersona } = await import('../../web/src/central/componentes/EscribirComoPersona');
const { AdjuntarComoPersona } = await import('../../web/src/central/componentes/AdjuntarComoPersona');

const enviados: string[] = [];
const CAPA: CapaTurno = {
  tomar: async () => ({}), devolver: async () => ({}),
  enviar: async (e) => { enviados.push(e.texto); return { aceptado: true }; },
};
const CAPA_ADJ: CapaAdjunto = { enviarAdjunto: async () => ({}) };

let avisos: string[] = [];
let raiz: ReturnType<typeof createRoot>;
let cont: HTMLElement;

beforeEach(() => {
  convId = `wa_${++contador}`;                    // los borradores sin confirmar viven en Maps del módulo: uno por prueba
  enviados.length = 0;
  avisos = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { avisos.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { avisos.push(a.map(String).join(' ')); });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  cont = document.createElement('div');
  document.body.appendChild(cont);
  raiz = createRoot(cont);
});
afterEach(() => {
  flushSync(() => raiz.unmount());
  cont.remove();
  vi.restoreAllMocks();
  delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

let contador = 0;
let convId = 'wa_0';
const piezas = (verEscribir: boolean, ya = false) => React.createElement(PiezasDePersona, {
  tenantId: 'demo', conversacionId: convId, nombreContacto: 'Ana', telefono: '59170000000',
  ultimoEntranteEn: Date.now() - 60_000, miUid: 'uid1',
  verEscribir, habilitados: true,
  puedeAdjuntar: verEscribir,                                         // con la bandera encendida y la ventana abierta
  avisoSinArchivos: !verEscribir && ya,                               // lo que arma el Detalle al devolver
  capa: CAPA, capaAdjunto: CAPA_ADJ,
});
const pintar = (verEscribir: boolean, ya = false) => flushSync(() => raiz.render(piezas(verEscribir, ya)));
const campos = () => cont.querySelectorAll('form[data-testid="redactor"]').length;
const selectores = () => cont.querySelectorAll('[data-testid="adjuntar"]').length;

describe('tomar y devolver (con la bandera de medios encendida)', () => {
  it('cinco ciclos dejan UN solo campo y UN selector al tomar, y ninguno al devolver', () => {
    for (let i = 0; i < 5; i++) {
      pintar(true);
      expect([campos(), selectores()], `tomada, ciclo ${i + 1}`).toEqual([1, 1]);
      pintar(false, true);
      expect([campos(), selectores()], `devuelta, ciclo ${i + 1}`).toEqual([0, 0]);
      expect(cont.querySelectorAll('[role="status"]'), `aviso al devolver, ciclo ${i + 1}`).toHaveLength(1);
    }
    expect(cont.querySelectorAll('textarea#cv-redactor-texto')).toHaveLength(0);
  });

  it('React no avisa de llaves repetidas en todo el recorrido', () => {
    for (let i = 0; i < 3; i++) { pintar(true); pintar(false, true); }
    pintar(true);
    expect(avisos.filter((a) => /same key|Encountered two children/i.test(a))).toEqual([]);
  });

  it('el selector (el clip) está en pantalla cuando se tiene la conversación con la bandera', () => {
    pintar(true);
    const sel = cont.querySelector('[data-testid="adjuntar"]');
    expect(sel).not.toBeNull();
    expect(sel!.textContent).toMatch(/Adjuntar|archivo/i);
  });
});

describe('un envío sale UNA vez', () => {
  async function escribirYEnviar(texto: string) {
    const area = cont.querySelector('textarea#cv-redactor-texto') as HTMLTextAreaElement;
    const poner = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    flushSync(() => { poner.call(area, texto); area.dispatchEvent(new Event('input', { bubbles: true })); });
    const boton = cont.querySelector('form[data-testid="redactor"] button[type="submit"]') as HTMLButtonElement;
    flushSync(() => boton.click());
    await vi.waitFor(() => expect(enviados.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(area.value).toBe(''));
    return { area, boton };
  }

  it('tras tomar, devolver y volver a tomar: se envía, el texto se borra, el botón se apaga y otro clic no manda nada', async () => {
    pintar(true); pintar(false, true); pintar(true); pintar(false, true); pintar(true);
    expect(campos()).toBe(1);
    const { area, boton } = await escribirYEnviar('Hola');
    expect(enviados).toEqual(['Hola']);
    expect(area.value).toBe('');                       // el texto NO queda pegado
    expect(boton.disabled).toBe(true);
    flushSync(() => boton.click());
    await new Promise((r) => setTimeout(r, 50));   // no pasa nada que esperar: se comprueba que NADA más sale
    expect(enviados).toEqual(['Hola']);                // sigue siendo UN envío
  });
});

describe('NEGANDO: la misma llave sí deja campos de más (la prueba muerde sin el arreglo)', () => {
  it('con las dos piezas bajo la misma llave, tomar y devolver acumula campos', () => {
    const mal = (verEscribir: boolean) => React.createElement(React.Fragment, null,
      verEscribir && React.createElement(EscribirComoPersona, {
        key: 'wa_1', tenantId: 'demo', conversacionId: 'wa_1', ultimoEntranteEn: Date.now() - 60_000,
        habilitados: true, capa: CAPA, miUid: 'uid1',
      }),
      !verEscribir && React.createElement('p', { role: 'status' }, 'Ya no se pueden enviar archivos'),
      verEscribir && React.createElement(AdjuntarComoPersona, {
        key: 'wa_1', tenantId: 'demo', conversacionId: 'wa_1', nombreContacto: 'Ana', telefono: '59170000000',
        capa: CAPA_ADJ, miUid: 'uid1',
      }));
    for (let i = 0; i < 4; i++) {
      flushSync(() => raiz.render(mal(true)));
      flushSync(() => raiz.render(mal(false)));
    }
    flushSync(() => raiz.render(mal(true)));
    expect(campos()).toBeGreaterThan(1);
  });
});

describe('guarda de fuente', () => {
  it('PiezasDePersona: cada hermano lleva su llave, y son distintas', () => {
    const f = readFileSync(join(ADMIN, 'web/src/central/componentes/PiezasDePersona.tsx'), 'utf8');
    expect(f).toMatch(/<EscribirComoPersona\s+key=\{`escribir-\$\{p\.conversacionId\}`\}/);
    expect(f).toMatch(/<AdjuntarComoPersona\s+key=\{`adjuntar-\$\{p\.conversacionId\}`\}/);
    const llaves = [...f.matchAll(/\bkey=\{([^}]+)\}/g)].map((m) => m[1]);
    expect(new Set(llaves).size).toBe(llaves.length);
  });
});
