import { useState } from 'react';

/**
 * =============================================================================
 * BARRAS POR DÍA — mensajes que entran y mensajes que contesta el asistente
 * =============================================================================
 *
 * SVG ESCRITO A MANO, sin biblioteca de gráficos. No es purismo: la consola
 * sirve con `script-src 'self'`, así que una biblioteca por CDN está bloqueada
 * y una empaquetada suma cientos de kilobytes y una dependencia más que
 * auditar, para dibujar rectángulos. Son ochenta líneas.
 *
 * POR QUÉ BARRAS AGRUPADAS Y NO APILADAS. Apiladas se leería bien el total del
 * día y mal cada serie: la de arriba «flota» sobre una base que cambia, y
 * comparar días es justo lo que uno viene a hacer acá. Agrupadas, las dos
 * series se comparan contra la misma línea de base.
 *
 * LOS COLORES NO SE ELIGIERON A OJO. Son un par categórico validado contra la
 * superficie de la tarjeta: banda de luminosidad, piso de croma, separación
 * para daltonismo (ΔE 15,7 en deuteranopía) y contraste. El verde de la marca
 * en su tono `#0b855c` y un azul `#1c7ed6`; en tema oscuro, los dos escalones
 * que pasan las mismas comprobaciones contra el fondo oscuro — no es el mismo
 * color «aclarado», que es como se rompen las paletas en oscuro.
 *
 * EL COLOR NO ES LA ÚNICA SEÑAL. Hay leyenda siempre, y una vista de tabla:
 * quien no distingue los dos tonos tiene los números.
 */

export interface DiaDeGrafico { dia: string; entrantes: number; salientes: number }

const ALTO = 150;
const ANCHO = 560;
const MARGEN = { arriba: 12, abajo: 22, izquierda: 30, derecha: 4 };

/** `2026-09-08` -> `8 sep`. Un eje con fechas completas no entra ni se lee. */
function rotulo(dia: string): string {
  const [, m, d] = dia.split('-');
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(d)} ${meses[Number(m) - 1] ?? ''}`;
}

/**
 * Una barra con las esquinas redondeadas SOLO ARRIBA.
 *
 * Un `<rect rx>` redondea las cuatro, y las de abajo despegan la barra de la
 * línea de base: parece flotar, y el ojo lee mal la altura justo donde la
 * comparación es más fina. El extremo del dato se redondea, el que apoya no.
 */
function barraRedondeadaArriba(x: number, base: number, ancho: number, alto: number): string {
  const r = Math.min(4, ancho / 2, alto);
  const y = base - alto;
  return `M${x} ${base} V${y + r} Q${x} ${y} ${x + r} ${y} `
    + `H${x + ancho - r} Q${x + ancho} ${y} ${x + ancho} ${y + r} V${base} Z`;
}

export function GraficoDias({ datos, titulo }: { datos: DiaDeGrafico[]; titulo: string }) {
  const [tabla, setTabla] = useState(false);
  const [encima, setEncima] = useState<{ i: number; serie: 'entrantes' | 'salientes' } | null>(null);

  const total = datos.reduce((a, d) => a + d.entrantes + d.salientes, 0);
  if (datos.length === 0 || total === 0) {
    return (
      <p className="vacio">
        Todavía no hay mensajes en este período. Cuando entre el primero por
        WhatsApp, aparece acá.
      </p>
    );
  }

  const tope = Math.max(1, ...datos.map((d) => Math.max(d.entrantes, d.salientes)));
  const anchoUtil = ANCHO - MARGEN.izquierda - MARGEN.derecha;
  const altoUtil = ALTO - MARGEN.arriba - MARGEN.abajo;
  const porDia = anchoUtil / datos.length;
  // 2px de aire entre las dos barras del día, y entre los días.
  const anchoBarra = Math.max(2, (porDia - 6) / 2);
  const alturaDe = (v: number) => (v / tope) * altoUtil;

  // Tres marcas en el eje y nada más: la grilla acompaña, no compite.
  const marcas = [0, Math.round(tope / 2), tope].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <figure className="grafico">
      <figcaption>
        <span className="grafico-titulo">{titulo}</span>
        <span className="leyenda">
          <span className="llave"><i className="marca marca-entrantes" />Del cliente</span>
          <span className="llave"><i className="marca marca-salientes" />Del asistente</span>
          <button type="button" className="enlace" onClick={() => setTabla(!tabla)}>
            {tabla ? 'Ver el gráfico' : 'Ver como tabla'}
          </button>
        </span>
      </figcaption>

      {tabla ? (
        <table className="table">
          <thead><tr><th>Día</th><th>Del cliente</th><th>Del asistente</th></tr></thead>
          <tbody>
            {datos.map((d) => (
              <tr key={d.dia}>
                <td>{rotulo(d.dia)}</td><td>{d.entrantes}</td><td>{d.salientes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grafico-lienzo">
          <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img"
               aria-label={`${titulo}. ${total} mensajes en ${datos.length} días.`}>
            {marcas.map((v) => {
              const y = MARGEN.arriba + altoUtil - alturaDe(v);
              return (
                <g key={v}>
                  <line x1={MARGEN.izquierda} x2={ANCHO - MARGEN.derecha} y1={y} y2={y}
                        className="grafico-guia" />
                  <text x={MARGEN.izquierda - 6} y={y + 3} textAnchor="end" className="grafico-eje">{v}</text>
                </g>
              );
            })}
            {datos.map((d, i) => {
              const x = MARGEN.izquierda + i * porDia + 2;
              const base = MARGEN.arriba + altoUtil;
              const barras = [
                { serie: 'entrantes' as const, v: d.entrantes, dx: 0 },
                { serie: 'salientes' as const, v: d.salientes, dx: anchoBarra + 2 },
              ];
              return (
                <g key={d.dia}>
                  {barras.map(({ serie, v, dx }) => (
                    <path key={serie}
                          d={barraRedondeadaArriba(x + dx, base, anchoBarra,
                            Math.max(v > 0 ? 2 : 0, alturaDe(v)))}
                          className={`barra barra-${serie}${encima?.i === i && encima.serie === serie ? ' barra-encima' : ''}`}
                          onMouseEnter={() => setEncima({ i, serie })}
                          onMouseLeave={() => setEncima(null)}>
                      <title>{`${rotulo(d.dia)}: ${v} ${serie === 'entrantes' ? 'del cliente' : 'del asistente'}`}</title>
                    </path>
                  ))}
                  {/* Un rótulo cada tantos días: uno por barra es ilegible y
                      ninguno deja el eje sin referencia. */}
                  {(i === 0 || i === datos.length - 1
                    || (datos.length > 8 && i === Math.floor(datos.length / 2))) && (
                    <text x={x + anchoBarra} y={ALTO - 6} textAnchor="middle" className="grafico-eje">
                      {rotulo(d.dia)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {encima && (
            <p className="grafico-detalle" role="status">
              {rotulo(datos[encima.i]?.dia ?? '')}:{' '}
              <strong>{datos[encima.i]?.[encima.serie] ?? 0}</strong>{' '}
              {encima.serie === 'entrantes' ? 'del cliente' : 'del asistente'}
            </p>
          )}
        </div>
      )}
    </figure>
  );
}
