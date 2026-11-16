// @vitest-environment jsdom
/**
 * LLAVES DE LOS HERMANOS DEL DETALLE DE CONVERSACIÓN (defecto de B4 en producción, 15/11/2026).
 *
 * El defecto: el campo de escribir (`EscribirComoPersona`) y el selector de adjuntos (`AdjuntarComoPersona`) llevaban la
 * MISMA llave (`key={ficha.id}`) y son hermanos en el mismo arreglo de hijos. React empareja a los hijos por llave: con dos
 * iguales pierde a uno en cada actualización, y los campos de escribir se acumulaban en pantalla (uno nuevo cada ~15 s, el
 * viejo seguía vivo con su reloj congelado) y empujaban el clip fuera de la vista.
 *
 *  1. Mecanismo, con React real y un DOM: dos hermanos con la misma llave se acumulan al actualizar; con llaves distintas, no.
 *  2. Guarda de fuente: en `DetalleConversacion.tsx` no hay dos `key=` idénticas, y cada hermano tiene la suya.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const React = desdeWeb('react') as typeof import('react');
const { createRoot } = desdeWeb('react-dom/client') as typeof import('react-dom/client');
const { flushSync } = desdeWeb('react-dom') as typeof import('react-dom');

function Campo() { return React.createElement('form', { className: 'campo' }, 'campo'); }
function Clip() { return React.createElement('section', { className: 'clip' }, 'clip'); }

/** Pinta lo que pinta el Detalle (campo y selector hermanos), actualiza `vueltas` veces y cuenta los campos en el DOM. */
function camposTrasActualizar(llaveCampo: string, llaveClip: string, vueltas: number): number {
  const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  g.IS_REACT_ACT_ENVIRONMENT = false;
  const aviso = vi.spyOn(console, 'error').mockImplementation(() => undefined);   // React avisa de la llave repetida
  try {
    const cont = document.createElement('div');
    const raiz = createRoot(cont);
    // Posiciones FIJAS, como el Detalle: [campo?, aviso?, selector?]; lo que no aplica queda en `false`.
    const arbol = (campo: boolean, clip: boolean) => React.createElement('div', null,
      campo && React.createElement(Campo, { key: llaveCampo }),
      false,
      clip && React.createElement(Clip, { key: llaveClip }));
    for (let i = 0; i < vueltas; i++) {
      flushSync(() => raiz.render(arbol(true, true)));
      // Como en producción: el turno cambia y el campo se quita y se vuelve a poner mientras el selector sigue.
      flushSync(() => raiz.render(arbol(false, true)));
      flushSync(() => raiz.render(arbol(true, true)));
    }
    const n = cont.querySelectorAll('form.campo').length;
    raiz.unmount();
    return n;
  } finally { aviso.mockRestore(); }
}

describe('llaves de los hermanos del Detalle', () => {
  it('con llaves distintas hay un solo campo de escribir, por mucho que se actualice', () => {
    expect(camposTrasActualizar('escribir-wa_1', 'adjuntar-wa_1', 6)).toBe(1);
  });

  it('con la MISMA llave React pierde un hermano en cada actualización (el defecto de producción)', () => {
    expect(camposTrasActualizar('wa_1', 'wa_1', 6)).toBeGreaterThan(1);
  });

  it('DetalleConversacion.tsx: ninguna llave repetida entre hermanos, y cada pieza lleva la suya', () => {
    const fuente = readFileSync(join(ADMIN, 'web/src/central/componentes/DetalleConversacion.tsx'), 'utf8');
    const llaves = [...fuente.matchAll(/\bkey=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => m[1]!.trim());
    const cuenta = new Map<string, number>();
    for (const l of llaves) cuenta.set(l, (cuenta.get(l) ?? 0) + 1);
    const repetidas = [...cuenta].filter(([, n]) => n > 1).map(([l]) => l);
    expect(repetidas).toEqual([]);
    expect(fuente).toMatch(/<EscribirComoPersona\s+key=\{`escribir-\$\{ficha\.id\}`\}/);
    expect(fuente).toMatch(/<AdjuntarComoPersona\s+key=\{`adjuntar-\$\{ficha\.id\}`\}/);
  });
});
