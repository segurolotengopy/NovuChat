import { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { descargarCsv } from '../lib/exportar';

/**
 * =============================================================================
 * COBROS — la pantalla de la plata
 * =============================================================================
 *
 * Arriba lo que se mira de un vistazo —cuántos pagos, cuánto suma, cuántos
 * están comprobados— y abajo el listado. El detalle de cada cobro va en un
 * MODAL, al revés que en «Pedidos»: acá lo que se recorre son montos, y los
 * ítems son la excepción que se consulta.
 *
 * EL BOTÓN DE COMPROBAR ES DE UNA PERSONA, NUNCA DEL SISTEMA. Es la
 * PROHIBICIÓN 3 del proyecto puesta en una pantalla: el cotejo automático mira
 * un comprobante, y un comprobante es una imagen que se edita. Quien afirma que
 * la plata entró es el comercio mirando su cuenta bancaria.
 *
 * De ahí tres cosas que no son adorno:
 *
 *  - la etiqueta dice **«comprobado por el negocio»** y jamás «pago acreditado»;
 *  - se guarda QUIÉN lo marcó y CUÁNDO, como cualquier otro sello de la consola;
 *  - marcar es un solo sentido. Desmarcar borraría el rastro de que alguien
 *    afirmó algo, y ese rastro es el que sirve el día que un cobro se discute.
 *
 * DESDE EL 17/09 HAY DOS COLUMNAS QUE PARECEN LA MISMA Y NO LO SON. La seña de
 * una reserva (`DISENO.md` §4duodecies) trae un `cotejo`: el servidor leyó el
 * comprobante y comparó monto, cuenta y hora con lo esperado. Eso es
 * «Comprobante: datos coinciden». La columna «Estado» sigue siendo la de la
 * persona: «comprobado por el negocio» contra su banco. Un cotejo que cuadra NO
 * comprueba nada —una imagen se edita— y por eso el botón «Comprobar» sigue
 * apareciendo al lado de un cotejo que cuadra. Se dice en pantalla, en la
 * ayuda y en la cabecera de la columna.
 */

/** Lo que el servidor leyó del comprobante y contra qué lo comparó. */
interface Cotejo {
  resultado?: unknown;
  diferencias?: unknown;
  montoLeido?: unknown;
  banco?: unknown;
  intentos?: unknown;
  en?: { toDate?: () => Date };
}

interface Cobro {
  id: string;
  ocurridoEn?: { toDate(): Date };
  tipo?: unknown;
  telefonoEnmascarado?: unknown;
  referencia?: unknown;
  monto?: unknown;
  moneda?: unknown;
  comprobadoPor?: unknown;
  comprobadoEn?: { toDate(): Date };
  items?: unknown;
  nota?: unknown;
  cotejo?: Cotejo;
}

/**
 * Etiqueta del cotejo. `null` cuando el cierre no trae uno: un pedido, o una
 * cita sin seña. Los rótulos hablan de DATOS, nunca de dinero: «coinciden» y
 * no «acreditado» (prohibición 3).
 */
function etiquetaCotejo(c: Cobro): { texto: string; clase: string } | null {
  switch (c.cotejo?.resultado) {
    case 'cuadra': return { texto: 'Datos coinciden', clase: 'tag tag-accent' };
    case 'no_cuadra': return { texto: 'Hay una diferencia', clase: 'tag tag-aviso' };
    case 'ilegible': return { texto: 'Ilegible', clase: 'tag tag-neutral' };
    default: return null;
  }
}

type Rango = 'hoy' | 'semana' | 'mes' | 'entre';

/** Medianoche boliviana de hace `dias-1` días. UTC−4 fijo, como todo el proyecto. */
function desdeHace(dias: number): Date {
  const b = new Date(Date.now() - 4 * 3_600_000);
  b.setUTCHours(0, 0, 0, 0);
  return new Date(b.getTime() - (dias - 1) * 86_400_000 + 4 * 3_600_000);
}

const DIAS: Record<Exclude<Rango, 'entre'>, number> = { hoy: 1, semana: 7, mes: 30 };

export function Cobros() {
  const { tenantId = '' } = useParams();
  const [cobros, setCobros] = useState<Cobro[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rango, setRango] = useState<Rango>('semana');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [abierto, setAbierto] = useState<Cobro | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    // Se traen los últimos 300 y se filtra en memoria. Filtrar por fecha en la
    // consulta exigiría un índice por cada combinación de rango, y son 300
    // documentos: el filtro en el navegador es instantáneo y no le agrega un
    // índice —con su costo en cada escritura— a una colección que crece sola.
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'cierres'), orderBy('ocurridoEn', 'desc'), limit(300)),
      (s) => setCobros(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError('No se pudieron leer los cobros.'));
  }, [tenantId]);

  const visibles = useMemo(() => {
    if (!cobros) return [];
    let inicio: number; let fin = Infinity;
    if (rango === 'entre') {
      if (desde === '' || hasta === '') return cobros;
      inicio = new Date(`${desde}T00:00:00-04:00`).getTime();
      fin = new Date(`${hasta}T23:59:59-04:00`).getTime();
    } else {
      inicio = desdeHace(DIAS[rango]).getTime();
    }
    return cobros.filter((c) => {
      const t = c.ocurridoEn?.toDate?.().getTime();
      return typeof t === 'number' && t >= inicio && t <= fin;
    });
  }, [cobros, rango, desde, hasta]);

  const total = visibles.reduce((a, c) => a + (typeof c.monto === 'number' ? c.monto : 0), 0);
  const comprobados = visibles.filter((c) => typeof c.comprobadoPor === 'string').length;
  const moneda = visibles.find((c) => typeof c.moneda === 'string')?.moneda ?? 'BOB';

  const comprobar = async (c: Cobro) => {
    setError(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'cierres', c.id), {
        comprobadoPor: auth.currentUser?.uid ?? '',
        comprobadoEn: serverTimestamp(),
      });
    } catch {
      setError('El servidor rechazó la comprobación. Revise que siga teniendo permiso.');
    }
  };

  return (
    <section>
      <h2>Cobros</h2>
      <p className="ayuda">
        Los pagos que pasaron por el QR. <strong>Comprobar un pago lo hace usted
        mirando su cuenta</strong>: el comprobante que manda el cliente es una
        imagen, y una imagen no es una acreditación del banco. En las señas de
        reserva, NovuChat coteja los datos del comprobante —monto, cuenta y
        hora— y lo dice en la columna «Comprobante»; eso no confirma que el
        dinero entró.
      </p>

      <div className="filtros">
        <div className="periodos seg" role="group" aria-label="Período">
          {([['hoy', 'Hoy'], ['semana', '7 días'], ['mes', '30 días'], ['entre', 'Entre fechas']] as [Rango, string][])
            .map(([v, t]) => (
              <button key={v} type="button" className="seg-opt"
                      aria-pressed={rango === v} onClick={() => setRango(v)}>{t}</button>
            ))}
        </div>
        {rango === 'entre' && (
          <>
            <label>Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
          </>
        )}
      </div>

      <div className="cuadricula">
        <article className="tarjeta">
          <h3>Cobros</h3>
          <div className="datos">
            <div className="dato"><strong>{visibles.length}</strong><span>en el período</span></div>
            <div className="dato">
              <strong>{Math.round(total * 100) / 100}</strong>
              <span><TextoSeguro valor={moneda} maxLargo={3} /></span>
            </div>
          </div>
        </article>
        <article className="tarjeta">
          <h3>Comprobados</h3>
          <div className="datos">
            <div className="dato"><strong>{comprobados}</strong><span>con su banco</span></div>
            <div className="dato"><strong>{visibles.length - comprobados}</strong><span>sin comprobar</span></div>
          </div>
          <p className="ayuda tarjeta-pie">
            «Comprobado» significa que una persona del negocio lo vio en su
            cuenta. NovuChat nunca lo marca solo.
          </p>
        </article>
      </div>

      {error && <p role="alert">{error}</p>}
      {cobros === null && <p>Cargando…</p>}
      {cobros !== null && visibles.length === 0 && (
        <p className="vacio">Sin cobros en este período.</p>
      )}

      {visibles.length > 0 && (
        <>
          <div className="acciones">
            <button type="button" className="btn btn-secondary" onClick={() => descargarCsv(
              'cobros',
              ['Fecha', 'Hora', 'Cliente', 'Monto', 'Moneda', 'Referencia', 'Comprobante', 'Comprobado'],
              visibles.map((c) => {
                const f = c.ocurridoEn?.toDate?.();
                return [
                  f?.toLocaleDateString('es-BO') ?? '', f?.toLocaleTimeString('es-BO') ?? '',
                  c.telefonoEnmascarado, c.monto, c.moneda, c.referencia,
                  etiquetaCotejo(c)?.texto ?? '',
                  typeof c.comprobadoPor === 'string' ? 'sí' : 'no',
                ];
              }),
            )}>Exportar ({visibles.length})</button>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Hora</th><th>Cliente</th><th>Monto</th>
                {/* «Comprobante» es lo que leyó el servidor; «Estado» es lo que
                    afirmó una persona. Van una al lado de la otra a propósito:
                    la diferencia entre las dos es la prohibición 3. */}
                <th>Comprobante</th><th>Estado</th><th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => {
                const f = c.ocurridoEn?.toDate?.();
                const listo = typeof c.comprobadoPor === 'string';
                const cotejo = etiquetaCotejo(c);
                return (
                  <tr key={c.id}>
                    <td>{f?.toLocaleDateString('es-BO') ?? '—'}</td>
                    <td>{f?.toLocaleTimeString('es-BO') ?? '—'}</td>
                    <td><TextoSeguro valor={c.telefonoEnmascarado} maxLargo={20} /></td>
                    <td>
                      {typeof c.monto === 'number'
                        ? <>{c.monto} <TextoSeguro valor={c.moneda ?? ''} maxLargo={3} /></>
                        : '—'}
                    </td>
                    <td>{cotejo ? <span className={cotejo.clase}>{cotejo.texto}</span> : '—'}</td>
                    <td>
                      {listo
                        ? <span className="tag tag-accent-2">Comprobado por el negocio</span>
                        : <span className="tag tag-neutral">Sin comprobar</span>}
                    </td>
                    <td>
                      <button type="button" className="btn btn-secondary btn-chico"
                              onClick={() => setAbierto(c)}>Ver</button>
                      {!listo && (
                        <button type="button" className="btn btn-primary btn-chico"
                                onClick={() => void comprobar(c)}>Comprobar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {abierto && <DetalleCobro cobro={abierto} cerrar={() => setAbierto(null)} />}
    </section>
  );
}

function DetalleCobro({ cobro, cerrar }: { cobro: Cobro; cerrar: () => void }) {
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [cerrar]);

  const items = Array.isArray(cobro.items) ? cobro.items as Record<string, unknown>[] : [];
  const cotejo = etiquetaCotejo(cobro);
  const diferencias = Array.isArray(cobro.cotejo?.diferencias)
    ? (cobro.cotejo.diferencias as unknown[]).filter((d): d is string => typeof d === 'string')
    : [];
  return (
    <div className="dialog-backdrop" onClick={cerrar}>
      <div className="dialog dialog-ancho" role="dialog" aria-modal="true" aria-label="Detalle del cobro"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">
          Cobro del {cobro.ocurridoEn?.toDate?.().toLocaleString('es-BO') ?? '—'}
        </h3>
        <div className="dialog-body">
          <p>
            <strong>
              {typeof cobro.monto === 'number' ? cobro.monto : '—'}{' '}
              <TextoSeguro valor={cobro.moneda ?? ''} maxLargo={3} />
            </strong>
            {' · '}<TextoSeguro valor={cobro.telefonoEnmascarado} maxLargo={20} />
          </p>

          {items.length > 0 ? (
            <ul className="pedido-items">
              {items.map((i, n) => (
                <li key={n}>
                  <span className="pedido-cantidad">{String(i['cantidad'] ?? 1)}×</span>
                  <span><TextoSeguro valor={i['nombre']} maxLargo={80} /></span>
                  {typeof i['detalle'] === 'string' && i['detalle'] !== '' && (
                    <em className="pedido-detalle"><TextoSeguro valor={i['detalle']} maxLargo={140} /></em>
                  )}
                </li>
              ))}
            </ul>
          ) : cobro.tipo === 'cita' ? (
            // Una seña no tiene ítems: es una cita. Decir «no tiene el detalle
            // guardado» haría buscar un dato que nunca existió.
            <p className="text-muted">
              Seña de una reserva · cita <TextoSeguro valor={cobro.referencia} maxLargo={60} />
            </p>
          ) : (
            <p className="text-muted">Este cobro no tiene el detalle de los ítems guardado.</p>
          )}

          {/* EL COTEJO DEL SERVIDOR, cuando lo hay (señas de reserva, `DISENO.md`
              §4duodecies). Se muestra lo que se leyó y contra qué se comparó,
              para que la persona que va a mirar su banco sepa qué buscar. Lo
              que NO se muestra es la imagen: el comprobante no se guarda, se
              coteja; solo queda lo leído y el resultado. */}
          {cotejo && (
            <div className="aviso-datos">
              <p>
                <strong>Comprobante:</strong>{' '}
                <span className={cotejo.clase}>{cotejo.texto}</span>
                {cobro.cotejo?.en?.toDate && (
                  <>{' · '}cotejado el {cobro.cotejo.en.toDate().toLocaleString('es-BO')}</>
                )}
              </p>
              <p>
                Monto leído:{' '}
                <strong>
                  {typeof cobro.cotejo?.montoLeido === 'number' ? cobro.cotejo.montoLeido : '—'}
                </strong>
                {typeof cobro.cotejo?.banco === 'string' && cobro.cotejo.banco !== '' && (
                  <>{' · '}Banco: <TextoSeguro valor={cobro.cotejo.banco} maxLargo={80} /></>
                )}
                {typeof cobro.cotejo?.intentos === 'number' && (
                  <>{' · '}{cobro.cotejo.intentos === 1
                    ? 'un comprobante recibido'
                    : `${cobro.cotejo.intentos} comprobantes recibidos`}</>
                )}
              </p>
              {diferencias.length > 0 && (
                <ul>
                  {diferencias.map((d, n) => <li key={n}><TextoSeguro valor={d} maxLargo={200} /></li>)}
                </ul>
              )}
              <p className="ayuda">
                NovuChat cotejó los datos del comprobante con la seña esperada.
                Eso no confirma que el dinero entró: mírelo en su banco y, si
                está, márquelo como comprobado.
              </p>
            </div>
          )}

          {/* EL COMPROBANTE NO SE PUEDE MOSTRAR, y se dice en vez de dejar un
              hueco. NovuChat no guarda la imagen: vive en los servidores de
              Meta y se baja con el token desde el servidor solo para cotejarla.
              Ver `DISENO.md` §4nonies.3 y §4duodecies. Un recuadro vacío haría
              pensar que la foto se perdió. */}
          <p className="ayuda aviso-datos">
            El comprobante que mandó el cliente está en su conversación. No se
            puede ver desde acá: NovuChat no guarda la imagen
            {cotejo ? ', solo lo que leyó de ella' : ''}.
          </p>

          {typeof cobro.comprobadoPor === 'string' && (
            <p className="text-muted">
              Comprobado por el negocio el{' '}
              {cobro.comprobadoEn?.toDate?.().toLocaleString('es-BO') ?? '—'}.
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={cerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
