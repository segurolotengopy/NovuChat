import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { TextoSeguro } from './TextoSeguro';
import {
  FILTROS, etiquetaFicha, iniciales, necesitaHumanoDe, partirResaltado, textoListaVacia, textoRestante, ventanaDeFicha, type Contadores, type Ficha, type Filtro,
} from '../lib/conversaciones';

/** Un renglón de la lista: una conversación, o un mensaje encontrado dentro de una. */
export interface Renglon {
  /** Identidad del renglón para «anterior / siguiente»: la conversación, o `conversación#mensaje`. */
  clave: string;
  ficha: Ficha;
  href: string;
  /** Si es un mensaje encontrado: su texto ya recortado (≤ 100 caracteres), las palabras a resaltar y la hora. */
  coincidencia?: { fragmento: string; ts: number; palabras?: readonly string[] };
  /** Si es un teléfono o un nombre encontrado: por qué coincidió. */
  motivo?: string;
}

export interface PropsLista {
  consulta: string;
  onConsulta: (q: string) => void;
  buscadorRef: RefObject<HTMLInputElement | null>;
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  conteos: Contadores;
  renglones: Renglon[];
  claveActiva: string | null;
  ahora: number;
  /** Texto de estado de la búsqueda (qué se buscó, cuántos, o por qué no se busca). */
  estadoBusqueda: string;
  /** Por qué falló la parte de la búsqueda que falló (la palabra, hoy); el resto de los resultados se muestra igual. */
  errorBusqueda: string | null;
  buscando: boolean;
  /** `true` si lo escrito es una búsqueda: los filtros se esconden. */
  enBusqueda: boolean;
  cargando: boolean;
  /** Hay más conversaciones del filtro para traer (botón «Cargar más»). */
  hayMas: boolean;
  cargandoMas: boolean;
  onMas: () => void;
  /** Hay más resultados de la búsqueda por palabra (el servidor devolvió un cursor). */
  hayMasPalabra: boolean;
  onMasPalabra: () => void;
}

export function ListaConversaciones(p: PropsLista) {
  return (
    <div className="cv-lista" data-testid="lista">
      <div className="cv-buscador">
        <input
          ref={p.buscadorRef}
          type="search"
          value={p.consulta}
          onChange={(e) => p.onConsulta(e.target.value)}
          placeholder="Buscar por teléfono, nombre o palabra  ( / )"
          aria-label="Buscar conversaciones por teléfono, nombre o palabra"
          maxLength={100}
          title="Atajos: / busca · Alt+↑/↓ cambia de conversación · Esc vuelve"
          autoComplete="off"
          spellCheck={false}
        />
        <p className={`cv-estado-busqueda${p.buscando ? ' cv-estado-busqueda--ocupado' : ''}`} role="status" aria-live="polite">
          {p.estadoBusqueda}
        </p>
        {p.errorBusqueda && <p className="cv-error cv-error-busqueda" role="alert">{p.errorBusqueda}</p>}
      </div>

      {!p.enBusqueda && (
        <div className="cv-filtros" role="group" aria-label="Filtrar conversaciones">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="cv-chip" aria-pressed={p.filtro === f.id}
              onClick={() => p.onFiltro(f.id)}>
              {f.rotulo}
              {p.conteos[f.id] !== null && <span className="cv-chip-n">{p.conteos[f.id]}</span>}
            </button>
          ))}
        </div>
      )}

      <ul className="cv-lista-scroll" aria-label="Conversaciones">
        {p.cargando && <li className="cv-vacio">Cargando conversaciones…</li>}
        {!p.cargando && p.renglones.length === 0 && !p.buscando && (
          <li className="cv-vacio">
            {textoListaVacia({ enBusqueda: p.enBusqueda, hayMasPalabra: p.hayMasPalabra, filtro: p.filtro })}
          </li>
        )}
        {p.renglones.map((r) => <RenglonFicha key={r.clave} r={r} activa={r.clave === p.claveActiva} ahora={p.ahora} />)}
        {!p.cargando && !p.enBusqueda && p.hayMas && (
          <li className="cv-mas-lista">
            <button type="button" className="btn btn-secondary" disabled={p.cargandoMas} onClick={p.onMas}>
              {p.cargandoMas ? 'Cargando…' : 'Cargar más conversaciones'}
            </button>
          </li>
        )}
        {p.enBusqueda && p.hayMasPalabra && (
          <li className="cv-mas-lista">
            <button type="button" className="btn btn-secondary" disabled={p.buscando} onClick={p.onMasPalabra}>
              {p.renglones.length === 0 ? 'Buscar más atrás' : 'Más resultados'}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function RenglonFicha({ r, activa, ahora }: { r: Renglon; activa: boolean; ahora: number }) {
  const f = r.ficha;
  const v = ventanaDeFicha(f, ahora);
  const hora = r.coincidencia ? etiquetaFicha(r.coincidencia.ts, ahora) : etiquetaFicha(f.ultimoEn, ahora);
  const sinLeer = f.noLeidos > 0 || f.sinLeer;
  return (
    <li>
      <Link to={r.href} className={`cv-ficha${activa ? ' cv-ficha--activa' : ''}${sinLeer ? ' cv-ficha--sin-leer' : ''}`}
        aria-current={activa ? 'true' : undefined}>
        <span className="cv-avatar" aria-hidden="true">{iniciales(f.nombre || f.telefono)}</span>
        <span className="cv-ficha-cuerpo">
          <span className="cv-ficha-fila">
            <strong className="cv-ficha-nombre"><TextoSeguro valor={f.nombre || `+${f.telefono}`} maxLargo={40} /></strong>
            <time className="cv-ficha-hora" dateTime={horaIso(r.coincidencia ? r.coincidencia.ts : f.ultimoEn)}>{hora}</time>
          </span>
          <span className="cv-ficha-fila">
            <span className="cv-ficha-ultimo">
              {r.coincidencia
                ? <Resaltado texto={r.coincidencia.fragmento} palabras={r.coincidencia.palabras ?? []} />
                : <TextoSeguro valor={f.ultimoMensaje} maxLargo={90} />}
            </span>
            {sinLeer && (f.noLeidos > 0
              ? <span className="cv-contador" aria-label={`${f.noLeidos} sin leer`}>{f.noLeidos}</span>
              : <span className="cv-contador cv-contador--punto" role="img" aria-label="Sin leer" />)}
          </span>
          <span className="cv-ficha-marcas">
            {r.motivo && <span className="cv-etiqueta">{r.motivo}</span>}
            {necesitaHumanoDe(f, ahora) && <span className="cv-etiqueta cv-etiqueta--humano">Necesita humano</span>}
            {v.estado === 'por-vencer' && <span className="cv-etiqueta cv-etiqueta--vence">Vence en {textoRestante(v.restanteMs)}</span>}
            {v.estado === 'cerrada' && <span className="cv-etiqueta cv-etiqueta--cerrada">Ventana cerrada</span>}
            {r.coincidencia && <span className="cv-ficha-telefono">+<TextoSeguro valor={f.telefono} maxLargo={15} /></span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

function horaIso(ms: number | null): string | undefined {
  return ms === null || !Number.isFinite(ms) || ms <= 0 ? undefined : new Date(ms).toISOString();
}

/** El fragmento con lo buscado marcado: se parte la cadena y cada tramo se pinta como TEXTO (<TextoSeguro>), nunca como HTML. */
function Resaltado({ texto, palabras }: { texto: string; palabras: readonly string[] }) {
  return (
    <>
      {partirResaltado(texto.slice(0, 120), palabras).map((t, i) => (t.resaltado
        ? <mark key={i} className="cv-resalte-palabra"><TextoSeguro valor={t.texto} maxLargo={120} /></mark>
        : <TextoSeguro key={i} valor={t.texto} maxLargo={120} />))}
    </>
  );
}
