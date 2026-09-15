import { useId, type ReactNode } from 'react';

/**
 * EDITOR DE UNA LISTA CON TOPE: agregar, quitar y reordenar filas.
 *
 * Nació para «Captación» (rubros, planes, cargos, aclaraciones), que tiene
 * cuatro listas iguales en forma y distintas en campos. Los campos de cada
 * fila los dibuja quien lo usa; esto pone lo que las cuatro comparten.
 *
 * EL TOPE LO MANDA EL SERVIDOR. `firestore.rules` rechaza una lista más larga
 * aunque alguien arme la petición a mano (base comercial §7). Acá la pantalla
 * ACOMPAÑA: el contador «3 de 8» dice cuánto queda antes de llegar, y en el
 * máximo el botón de agregar se deshabilita CON EL PORQUÉ al lado. Un botón
 * gris sin explicación se lee como que la consola se trabó.
 *
 * NADA SE ESCRIBE HASTA «GUARDAR». Quitar o mover una fila cambia el borrador;
 * por eso no hay confirmación al quitar: si fue un error, basta con no guardar.
 *
 * `clave` es un identificador estable de la fila, solo para React. Con el
 * índice como clave, al subir una fila el foco del teclado se quedaba en el
 * lugar y no acompañaba a la fila que se movió.
 */
export function EditorLista<T>({
  titulo, filas, maximo, porqueMaximo, nueva, rotuloAgregar, rotuloFila, clave,
  onCambio, ayuda, children,
}: {
  titulo: string;
  filas: T[];
  maximo: number;
  /** Por qué no se pueden agregar más. Se muestra al llegar al máximo. */
  porqueMaximo: string;
  nueva: () => T;
  rotuloAgregar: string;
  /** Nombre de la fila para los lectores de pantalla: «Plan 2», «Rubro Salud». */
  rotuloFila: (fila: T, indice: number) => string;
  clave: (fila: T) => string;
  onCambio: (filas: T[]) => void;
  ayuda?: ReactNode;
  children: (fila: T, cambiar: (cambio: Partial<T>) => void, indice: number) => ReactNode;
}) {
  const idPorque = useId();
  const lleno = filas.length >= maximo;

  const mover = (i: number, paso: number) => {
    const j = i + paso;
    if (j < 0 || j >= filas.length) return;
    const copia = [...filas];
    const a = copia[i] as T;
    copia[i] = copia[j] as T;
    copia[j] = a;
    onCambio(copia);
  };

  return (
    <fieldset className="lista-editable">
      <legend>
        {titulo}
        <span className="lista-contador">{filas.length} de {maximo}</span>
      </legend>
      {ayuda}
      {filas.length > 0 && (
        <ol className="lista-filas">
          {filas.map((fila, i) => {
            const rotulo = rotuloFila(fila, i);
            return (
              <li key={clave(fila)} className="lista-fila" aria-label={rotulo}>
                <div className="lista-fila-campos">
                  {children(fila,
                    (cambio) => onCambio(filas.map((x, k) => (k === i ? { ...x, ...cambio } : x))),
                    i)}
                </div>
                <div className="lista-fila-acciones" role="group" aria-label={`Acciones de ${rotulo}`}>
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0}
                          aria-label={`Subir ${rotulo}`} title="Subir">↑</button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === filas.length - 1}
                          aria-label={`Bajar ${rotulo}`} title="Bajar">↓</button>
                  <button type="button" onClick={() => onCambio(filas.filter((_, k) => k !== i))}
                          aria-label={`Quitar ${rotulo}`}>Quitar</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <button type="button" onClick={() => onCambio([...filas, nueva()])} disabled={lleno}
              aria-describedby={lleno ? idPorque : undefined}>
        {rotuloAgregar}
      </button>
      {lleno && <p id={idPorque} className="ayuda">{porqueMaximo}</p>}
    </fieldset>
  );
}
