import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * MENÚ LATERAL: el estado abierto/cerrado de la barra izquierda de la consola.
 *
 * Dos reglas distintas según el tamaño de la pantalla:
 *  - ESCRITORIO (>= 60rem): abierto por defecto, y el sándwich lo pliega del
 *    todo. La preferencia se recuerda en `localStorage`; no se cierra al navegar.
 *  - MÓVIL (< 60rem): cerrado por defecto, es un panel sobre el contenido. La
 *    preferencia ni se lee ni se escribe (un «abierto» heredado de la
 *    computadora taparía la pantalla en el celular), y se cierra al navegar.
 */
export const CLAVE_MENU_LATERAL = 'novuchat.menuLateral';
export const ID_MENU_LATERAL = 'menu-lateral';
const CONSULTA_ESCRITORIO = '(min-width: 60rem)';

/** Pura: ¿empieza abierto? Un valor guardado que no sea «cerrado» se ignora. */
export function estadoInicial(esEscritorio: boolean, guardado: string | null): boolean {
  if (!esEscritorio) return false;
  return guardado !== 'cerrado';
}

/** Pura: lo que pasa con el menú al cambiar de ruta. Solo el móvil lo cierra. */
export function alCambiarRuta(esEscritorio: boolean, abierto: boolean): boolean {
  return esEscritorio ? abierto : false;
}

function leerPreferencia(): string | null {
  try { return window.localStorage.getItem(CLAVE_MENU_LATERAL); } catch { return null; }
}
function guardarPreferencia(abierto: boolean): void {
  try { window.localStorage.setItem(CLAVE_MENU_LATERAL, abierto ? 'abierto' : 'cerrado'); } catch { /* sin almacenamiento: no se recuerda */ }
}
/** Sin `matchMedia` (jsdom, pruebas) se asume escritorio. */
function consultarEscritorio(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(CONSULTA_ESCRITORIO).matches;
}

export function useMenuLateral(pathname: string) {
  const [esEscritorio, setEsEscritorio] = useState<boolean>(consultarEscritorio);
  const [abierto, setAbierto] = useState<boolean>(() => estadoInicial(consultarEscritorio(), leerPreferencia()));
  const botonRef = useRef<HTMLButtonElement>(null);
  const rutaAnterior = useRef(pathname);

  // Cruzar el umbral de 60rem (girar el celular, redimensionar) recalcula el estado.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const consulta = window.matchMedia(CONSULTA_ESCRITORIO);
    const alCruzar = (e: MediaQueryListEvent) => {
      // El menú puede quedar inerte con el foco adentro: se lo lleva al botón.
      if (document.getElementById(ID_MENU_LATERAL)?.contains(document.activeElement)) botonRef.current?.focus();
      setEsEscritorio(e.matches);
      setAbierto(estadoInicial(e.matches, leerPreferencia()));
    };
    consulta.addEventListener('change', alCruzar);
    return () => consulta.removeEventListener('change', alCruzar);
  }, []);

  // En móvil, navegar cierra el panel y el foco vuelve al botón (el enlace tocado quedó inerte).
  useEffect(() => {
    if (rutaAnterior.current === pathname) return;
    rutaAnterior.current = pathname;
    const sigue = alCambiarRuta(esEscritorio, abierto);
    if (sigue !== abierto) {
      setAbierto(sigue);
      botonRef.current?.focus();
    }
  }, [pathname, esEscritorio, abierto]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    botonRef.current?.focus();
  }, []);

  const alternar = useCallback(() => {
    setAbierto((previo) => {
      const siguiente = !previo;
      if (esEscritorio) guardarPreferencia(siguiente);
      return siguiente;
    });
  }, [esEscritorio]);

  // Escape cierra el panel móvil.
  useEffect(() => {
    if (esEscritorio || !abierto) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [esEscritorio, abierto, cerrar]);

  // El CSS (margen del contenido, panel) lee el estado del `<html>`. Va en
  // `useLayoutEffect` para que el primer dibujo ya salga con el menú en su
  // lugar: con `useEffect` la página se pintaba un instante sin menú y saltaba.
  // SIN OPCIONES (quien todavía no eligió cuenta, «Mi cuenta» sin negocio) no
  // hay nada que abrir: el estado es «vacio», el CSS esconde el sándwich y el
  // contenido no deja un hueco a la izquierda. Corre en cada dibujo porque las
  // opciones llegan después (los módulos del negocio se cargan aparte).
  useLayoutEffect(() => {
    const raiz = document.documentElement;
    // Sin `<nav>` (la cabecera no se dibuja sin sesión) tampoco hay menú.
    const nav = document.getElementById(ID_MENU_LATERAL);
    const vacio = !nav || nav.childElementCount === 0;
    raiz.setAttribute('data-menu-lateral', vacio ? 'vacio' : abierto ? 'abierto' : 'cerrado');
  });
  // La limpieza también va en `useLayoutEffect`: entre rutas se desmonta una
  // cabecera y se monta otra, y la limpieza de un `useEffect` corre DESPUÉS del
  // efecto de diseño de la nueva, así que le borraba el atributo recién puesto.
  useLayoutEffect(() => () => document.documentElement.removeAttribute('data-menu-lateral'), []);

  useEffect(() => {
    const raiz = document.documentElement;
    const cabecera = botonRef.current?.closest('header');
    if (!cabecera) return;
    const medir = () => raiz.style.setProperty('--alto-cabecera-real', `${cabecera.getBoundingClientRect().height}px`);
    medir();
    if (typeof ResizeObserver === 'undefined') return () => raiz.style.removeProperty('--alto-cabecera-real');
    const observador = new ResizeObserver(medir);
    observador.observe(cabecera);
    return () => { observador.disconnect(); raiz.style.removeProperty('--alto-cabecera-real'); };
  }, []);

  return { abierto, alternar, cerrar, botonRef, esEscritorio };
}
