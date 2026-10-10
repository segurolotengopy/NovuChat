import type { RefObject } from 'react';
import { Link } from 'react-router-dom';
import { TextoSeguro } from './TextoSeguro';
import {
  FILTROS, etiquetaFicha, textoRestante, ventanaDe, type Ficha, type Filtro,
} from '../lib/conversaciones';

/** Un renglón de la lista: una conversación, o un mensaje encontrado dentro de una. */
export interface Renglon {
  /** Identidad del renglón para «anterior / siguiente»: la conversación, o `conversación#mensaje`. */
  clave: string;
  ficha: Ficha;
  href: string;
  /** Si es un mensaje encontrado: su texto ya recortado y la hora. */
  coincidencia?: { fragmento: string; ts: number };
  /** Si es un teléfono encontrado: por qué coincidió. */
  motivo?: string;
}

export interface PropsLista {
  consulta: string;
  onConsulta: (q: string) => void;
  buscadorRef: RefObject<HTMLInputElement | null>;
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
  conteos: Record<Filtro, number>;
  renglones: Renglon[];
  claveActiva: string | null;
  ahora: number;
  /** Texto de estado de la búsqueda (qué se buscó, cuántos, o por qué no se busca). */
  estadoBusqueda: string;
  buscando: boolean;
  /** `true` si lo escrito es una búsqueda: los filtros se esconden. */
  enBusqueda: boolean;
  totalConversaciones: number;
  cargando: boolean;
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
          autoComplete="off"
          spellCheck={false}
        />
        <p className={`cv-estado-busqueda${p.buscando ? ' cv-estado-busqueda--ocupado' : ''}`} role="status" aria-live="polite">
          {p.estadoBusqueda}
        </p>
      </div>

      {!p.enBusqueda && (
        <div className="cv-filtros" role="group" aria-label="Filtrar conversaciones">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className="cv-chip" aria-pressed={p.filtro === f.id}
              onClick={() => p.onFiltro(f.id)}>
              {f.rotulo}<span className="cv-chip-n">{p.conteos[f.id]}</span>
            </button>
          ))}
        </div>
      )}

      <ul className="cv-lista-scroll" aria-label="Conversaciones">
        {p.cargando && <li className="cv-vacio">Cargando conversaciones…</li>}
        {!p.cargando && p.renglones.length === 0 && !p.buscando && (
          <li className="cv-vacio">
            {p.enBusqueda ? 'Nada coincide con lo que escribió.'
              : p.totalConversaciones === 0 ? 'Todavía no hay conversaciones.'
              : 'Ninguna conversación cumple este filtro.'}
          </li>
        )}
        {p.renglones.map((r) => <RenglonFicha key={r.clave} r={r} activa={r.clave === p.claveActiva} ahora={p.ahora} />)}
      </ul>
    </div>
  );
}

function RenglonFicha({ r, activa, ahora }: { r: Renglon; activa: boolean; ahora: number }) {
  const f = r.ficha;
  const v = ventanaDe(f.ultimoEntranteEn, ahora);
  const hora = r.coincidencia ? etiquetaFicha(r.coincidencia.ts, ahora) : etiquetaFicha(f.ultimoEn, ahora);
  const sinLeer = f.noLeidos > 0;
  return (
    <li>
      <Link to={r.href} className={`cv-ficha${activa ? ' cv-ficha--activa' : ''}${sinLeer ? ' cv-ficha--sin-leer' : ''}`}
        aria-current={activa ? 'true' : undefined}>
        <span className="cv-avatar" aria-hidden="true">{iniciales(f.nombre || f.telefono)}</span>
        <span className="cv-ficha-cuerpo">
          <span className="cv-ficha-fila">
            <strong className="cv-ficha-nombre"><TextoSeguro valor={f.nombre || `+${f.telefono}`} maxLargo={40} /></strong>
            <time className="cv-ficha-hora">{hora}</time>
          </span>
          <span className="cv-ficha-fila">
            <span className="cv-ficha-ultimo">
              {r.coincidencia
                ? <TextoSeguro valor={r.coincidencia.fragmento} maxLargo={120} />
                : <TextoSeguro valor={f.ultimoMensaje} maxLargo={90} />}
            </span>
            {sinLeer && <span className="cv-contador" aria-label={`${f.noLeidos} sin leer`}>{f.noLeidos}</span>}
          </span>
          <span className="cv-ficha-marcas">
            {r.motivo && <span className="cv-etiqueta">{r.motivo}</span>}
            {f.necesitaHumano && f.responde !== 'persona' && <span className="cv-etiqueta cv-etiqueta--humano">Necesita humano</span>}
            {f.responde === 'persona' && <span className="cv-etiqueta cv-etiqueta--persona">Atiende {f.tomadoPor || 'una persona'}</span>}
            {v.estado === 'por-vencer' && <span className="cv-etiqueta cv-etiqueta--vence">Vence en {textoRestante(v.restanteMs)}</span>}
            {v.estado === 'cerrada' && <span className="cv-etiqueta cv-etiqueta--cerrada">Ventana cerrada</span>}
            {r.coincidencia && <span className="cv-ficha-telefono">+{f.telefono}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const a = partes[0]?.[0] ?? '#';
  const b = partes.length > 1 ? (partes[1]?.[0] ?? '') : '';
  return (a + b).toUpperCase().replace('+', '#');
}
