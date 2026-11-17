/**
 * MENÚ LATERAL (sándwich): el estado inicial, el cierre al navegar y el
 * cableado de accesibilidad entre App.tsx, BotonMenu.tsx y estilos.css.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alCambiarRuta, estadoInicial } from '../../web/src/central/lib/useMenuLateral';

const aqui = dirname(fileURLToPath(import.meta.url));
const leer = (rel: string) => readFileSync(join(aqui, '..', '..', 'web', 'src', rel), 'utf8');

describe('estado inicial', () => {
  it('escritorio sin preferencia: abierto', () => expect(estadoInicial(true, null)).toBe(true));
  it('escritorio con «cerrado» guardado: cerrado', () => expect(estadoInicial(true, 'cerrado')).toBe(false));
  it('escritorio con «abierto» guardado: abierto', () => expect(estadoInicial(true, 'abierto')).toBe(true));
  it('un valor inválido se ignora', () => {
    expect(estadoInicial(true, 'quizás')).toBe(true);
    expect(estadoInicial(true, '')).toBe(true);
  });
  it('móvil empieza cerrado aunque haya «abierto» guardado', () => {
    expect(estadoInicial(false, 'abierto')).toBe(false);
    expect(estadoInicial(false, null)).toBe(false);
  });
});

describe('al cambiar de ruta', () => {
  it('móvil se cierra', () => expect(alCambiarRuta(false, true)).toBe(false));
  it('escritorio no se cierra', () => {
    expect(alCambiarRuta(true, true)).toBe(true);
    expect(alCambiarRuta(true, false)).toBe(false);
  });
});

describe('cableado de accesibilidad', () => {
  const app = leer('App.tsx');
  const boton = leer('central/componentes/BotonMenu.tsx');
  it('aria-controls del botón coincide con el id del nav', () => {
    expect(boton).toContain('aria-controls="menu-lateral"');
    expect(app).toContain('id="menu-lateral"');
  });
  it('el nav tiene aria-label y se vuelve inerte al cerrarse', () => {
    expect(app).toMatch(/<nav id="menu-lateral" aria-label="[^"]+"[^>]*inert=\{!abierto\}/);
  });
  it('el botón anuncia su estado y su nombre', () => {
    expect(boton).toContain('aria-expanded={abierto}');
    expect(boton).toContain("aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}");
  });
  it('el velo está oculto a lectores de pantalla', () => {
    expect(app).toMatch(/className="menu-velo"[^>]*aria-hidden="true"/);
  });
  it('estilos.css apaga la transición con prefers-reduced-motion', () => {
    const css = leer('central/estilos/estilos.css');
    const bloque = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*menu-lateral[^}]*\}/);
    expect(bloque).not.toBeNull();
  });
});

describe('la barra de arriba: solo ☰, NovuChat y el negocio (17/11/2026)', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../web/src/App.tsx'), 'utf8');
  const cabecera = app.slice(app.indexOf('<header className="cabecera">'), app.indexOf('</header>'));
  const nav = cabecera.slice(cabecera.indexOf('<nav id="menu-lateral"'), cabecera.indexOf('</nav>'));
  const barra = cabecera.replace(nav, '');
  it('«Mi cuenta» y «Salir» están en el menú lateral y NO en la barra', () => {
    expect(nav).toContain('<NavLink to="/mi-cuenta">Mi cuenta</NavLink>');
    expect(nav).toMatch(/onClick=\{salir\}>Salir<\/button>/);
    expect(barra).not.toContain('Mi cuenta');
    expect(barra).not.toContain('Salir');
  });
  it('el nombre del negocio y la pastilla van en la misma barra, sin franja propia debajo', () => {
    expect(barra).toMatch(/<Marca \/>[\s\S]*<EncabezadoComercio /);
    expect(cabecera.indexOf('<EncabezadoComercio ')).toBeLessThan(cabecera.indexOf('</div>'));
    const encabezado = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../web/src/central/componentes/EncabezadoComercio.tsx'), 'utf8');
    expect(encabezado).not.toContain('contenedor franja-comercio');
  });
});
