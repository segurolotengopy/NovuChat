import type { Ref } from 'react';

/**
 * BOTÓN SÁNDWICH: abre y cierra el menú lateral (`#menu-lateral`, en App.tsx).
 * El nombre accesible cambia con el estado y `aria-expanded` lo repite para
 * los lectores de pantalla. 44×44 px: el mínimo cómodo para el dedo.
 */
export function BotonMenu({ abierto, alAlternar, botonRef }: {
  abierto: boolean;
  alAlternar: () => void;
  botonRef: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      ref={botonRef}
      className="boton-menu"
      aria-expanded={abierto}
      aria-controls="menu-lateral"
      aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
      onClick={alAlternar}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
