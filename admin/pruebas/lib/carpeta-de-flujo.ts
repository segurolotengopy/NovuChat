// Dónde vive hoy la carpeta de cada flujo: `Flujos/experimental/<x>/` o `Flujos/clientes/<x>/` (mudanza, `docs/arquitectura/mudanza.md`).
// Las pruebas que arman la ruta con una variable (`${cliente}`, `${c}`, `d`) la piden aquí; una mudanza cambia UNA entrada de este mapa.
// Lo que no está en el mapa sigue en `experimental/`.
export const CARPETA_DE_FLUJO: Readonly<Record<string, 'experimental' | 'clientes'>> = {
  'rroca-emma': 'clientes',
  'rroca-ruben': 'clientes',
  'rroca-evy': 'clientes',
  'venta-minima': 'clientes',
};

/** Subcarpeta de `Flujos/` donde vive el flujo `x`. */
export const carpetaDeFlujo = (x: string): 'experimental' | 'clientes' => CARPETA_DE_FLUJO[x] ?? 'experimental';
