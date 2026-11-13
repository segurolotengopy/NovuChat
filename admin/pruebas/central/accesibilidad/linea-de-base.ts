/**
 * LÍNEA DE BASE DEL LINT DE ACCESIBILIDAD DE LA CONSOLA (13/11/2026): SOLO PUEDE BAJAR.
 *
 * Lista CERRADA de las violaciones de `eslint-plugin-jsx-a11y` (reglas recomendadas) que ya existían al darla de alta. Clave:
 * `<ruta relativa a admin/web, con />#<regla>`; valor: cuántas hay. El CI falla ante una violación NUEVA y también cuando la base sobra
 * (se arregló una y no se bajó), de modo que el tope solo baja. Cómo: docs/arquitectura/accesibilidad-consola.md.
 *
 * ATENCIÓN: subir `ALTA`, `TOPE` o una cuenta exige pasar por el agente `seguridad` y una decisión escrita de Andres (ver `tope-fijado.ts`).
 */
export const ALTA = '2026-11-13';

export const LINEA_DE_BASE: Readonly<Record<string, number>> = {
  'src/central/componentes/AdjuntarComoPersona.tsx#jsx-a11y/media-has-caption': 1,
  'src/central/componentes/AdjuntarComoPersona.tsx#jsx-a11y/no-noninteractive-element-interactions': 1,
  'src/central/componentes/DetalleConversacion.tsx#jsx-a11y/no-noninteractive-tabindex': 1,
  'src/central/componentes/VisorMedio.tsx#jsx-a11y/media-has-caption': 1,
  'src/central/componentes/VisorMedio.tsx#jsx-a11y/no-noninteractive-element-interactions': 1,
  'src/central/paginas/Configuracion.tsx#jsx-a11y/label-has-associated-control': 1,
  'src/central/paginas/Consumo.tsx#jsx-a11y/click-events-have-key-events': 2,
  'src/central/paginas/Consumo.tsx#jsx-a11y/no-noninteractive-element-interactions': 1,
  'src/central/paginas/Consumo.tsx#jsx-a11y/no-static-element-interactions': 1,
  'src/modulos/captacion/Captacion.tsx#jsx-a11y/label-has-associated-control': 2,
  'src/modulos/cobros/Cobros.tsx#jsx-a11y/click-events-have-key-events': 2,
  'src/modulos/cobros/Cobros.tsx#jsx-a11y/no-noninteractive-element-interactions': 1,
  'src/modulos/cobros/Cobros.tsx#jsx-a11y/no-static-element-interactions': 1,
};

/** Total de violaciones admitidas. Solo baja. */
export const TOPE = 16;

/** Desglose por regla (suma `TOPE`). Solo baja. */
export const TOPE_POR_REGLA: Readonly<Record<string, number>> = {
  'jsx-a11y/click-events-have-key-events': 4,
  'jsx-a11y/label-has-associated-control': 3,
  'jsx-a11y/media-has-caption': 2,
  'jsx-a11y/no-noninteractive-element-interactions': 4,
  'jsx-a11y/no-noninteractive-tabindex': 1,
  'jsx-a11y/no-static-element-interactions': 2,
};

/** Compara lo encontrado con la base. Devuelve los problemas legibles; `[]` si coinciden exactamente. Pura. */
export function compararConLineaDeBase(encontradas: Record<string, number>, base: Readonly<Record<string, number>> = LINEA_DE_BASE): string[] {
  const problemas: string[] = [];
  for (const clave of Object.keys(encontradas).sort()) {
    const hay = encontradas[clave] ?? 0;
    const admite = base[clave] ?? 0;
    if (hay > admite) {
      const [archivo, regla] = clave.split('#');
      problemas.push(`violación NUEVA de accesibilidad: ${archivo} · ${regla} (hay ${hay}, la línea de base admite ${admite}): arréglala; la línea de base no sube`);
    }
  }
  for (const clave of Object.keys(base).sort()) {
    const hay = encontradas[clave] ?? 0;
    const dice = base[clave] ?? 0;
    if (hay < dice) {
      problemas.push(`la línea de base sobra en ${clave} (hay ${hay}, dice ${dice}): bájala en linea-de-base.ts y baja TOPE y TOPE_MAXIMO`);
    }
  }
  return problemas;
}
