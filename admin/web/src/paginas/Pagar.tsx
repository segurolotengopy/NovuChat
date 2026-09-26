import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable, type FunctionsError } from 'firebase/functions';
import { Link, useParams } from 'react-router-dom';
import { db, funciones, urlDeFuncionHttp } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import {
  BOLSAS_POSIBLES, MESES_POSIBLES, PRECIOS, mesEscrito,
  planesQuePuedePagar, vistaDelPedido, type Pago, type PlanEnVenta,
} from '../lib/pagar';
import { BOLSA, PLANES, fechaCorta } from '../lib/prepago';
import { EjesDeLaCuenta } from '../central/componentes/EjesDeLaCuenta';
import { useEjesDeCuenta } from '../central/lib/lecturas';
import { facturaMetaAlComercio } from '../lib/ejes';

/**
 * PAGAR — NovuChat cobrándole al comercio (`Analisis/41` §6.1 punto 6; «Cobros»
 * es el comercio cobrándole a su cliente): el comercio compra su mes, sus
 * bolsas o su instalación, y recibe un QR del banco (`DISENO.md` §4undecies,
 * bloque A-3 de `Prompts/prepago-estricto.md`).
 *
 * TRES COSAS QUE ESTA PANTALLA NO HACE, Y SON DELIBERADAS:
 *
 * 1. NO CALCULA IMPORTES NI MESES. Todo sale de `lib/pagar.ts`, que a su vez
 *    llama al módulo del servidor. La cifra de la vista previa y la del QR
 *    tienen que coincidir, y coinciden porque es la misma función sobre el
 *    mismo documento de tipo de cambio.
 * 2. NO ESCRIBE NADA EN FIRESTORE. Emitir, consultar y anular son callables
 *    (`crearCobroPrepago`, `consultarPagoPendiente`, `anularPagoPendiente`);
 *    las reglas niegan toda escritura del navegador sobre `/pagos` y
 *    `/cuenta`. Si el comercio pudiera escribir «confirmado», el pago dejaría
 *    de significar algo.
 * 3. NO DICE «PAGO ACREDITADO» POR SU CUENTA. El estado lo trae el servidor
 *    desde el cobrador, y hasta que el banco confirme se dice «esperando la
 *    confirmación del banco» (`CLAUDE.md`, prohibición 3).
 *
 * EL QR SE PIDE POR LA FICHA, no por el pago. `imagenDePago` es una Function
 * pública que recibe un identificador opaco de 32 hexadecimales, y devuelve
 * 404 en cuanto el cobro deja de estar pendiente. La imagen no pasa por el
 * SDK: no hay forma de ponerle un token a un `<img src>` sin descargarla
 * aparte, y descargarla aparte no agrega ninguna protección cuando la ficha ya
 * es el secreto.
 */

type Tipo = 'mensualidad' | 'bolsa' | 'instalacion';

interface Pendiente {
  pagoId: string;
  descripcion?: unknown;
  monto?: unknown;
  montoUsd?: unknown;
  moneda?: unknown;
  tcoAplicado?: unknown;
  tcoFuente?: unknown;
  tcoFecha?: unknown;
  venceEn?: number | null;
  creadoEn?: number | null;
  cobroEstado?: unknown;
  fichaQr?: string | null;
}

interface FilaPago {
  id: string;
  estado?: unknown;
  descripcion?: unknown;
  monto?: unknown;
  montoUsd?: unknown;
  moneda?: unknown;
  tcoAplicado?: unknown;
  tcoFecha?: unknown;
  medio?: unknown;
  canal?: unknown;
  creadoEn?: { toMillis(): number };
}

/** Lo que el comercio lee de cada estado del cobro en el banco. */
const ESTADO_DEL_COBRO: Record<string, string> = {
  SIN_EMITIR: 'todavía sin QR',
  BORRADOR: 'el banco todavía no emitió el QR',
  QR_ACTIVO: 'esperando el pago',
  PAGO_DETECTADO: 'el banco detectó un pago y lo está confirmando',
  EN_REVISION: 'un pago tardío está en revisión en el banco',
  QR_SUELTO: 'NovuChat lo está revisando',
};

const ESTADO_DEL_PAGO: Record<string, string> = {
  pendiente: 'pendiente',
  confirmado: 'confirmado',
  vencido: 'vencido',
  anulado: 'anulado',
};

const numero = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function Pagar() {
  const { tenantId = '' } = useParams();
  const [cuenta, setCuenta] = useState<Record<string, unknown> | null>(null);
  const [tipoCambio, setTipoCambio] = useState<unknown>(undefined);
  const [historial, setHistorial] = useState<FilaPago[]>([]);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [consultado, setConsultado] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // LOS NÚMEROS DEL COMERCIO, por su titularidad: es lo que dice si Meta le
  // factura el consumo a él (`facturaMetaAlComercio`), no el plan.
  // `ejesDeCuenta`: la titularidad de cada número, que el comercio no puede
  // leer de `rutasWhatsApp` (es del propietario).
  const { ejes, error: errorEjes } = useEjesDeCuenta(tenantId);

  const [tipo, setTipo] = useState<Tipo>('mensualidad');
  const [plan, setPlan] = useState<PlanEnVenta | null>(null);
  const [meses, setMeses] = useState(1);
  const [cantidad, setCantidad] = useState(1);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}),
      () => setError('No se pudo leer el estado de la cuenta.'));
  }, [tenantId]);

  // EL TIPO DE CAMBIO ES PÚBLICO: es el oficial que publica el BCB, y el
  // comercio tiene derecho a ver con cuál se le cobra antes de pagar. Si la
  // lectura falla, `null` deja la vista previa sin importe en bolivianos y el
  // botón deshabilitado, que es exactamente lo que hará el servidor.
  useEffect(() => onSnapshot(doc(db, 'plataforma', 'tipoCambio'),
    (d) => setTipoCambio(d.data() ?? null),
    () => setTipoCambio(null)), []);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'pagos'), orderBy('creadoEn', 'desc'), limit(24)),
      (i) => setHistorial(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError('No se pudo leer el historial de pagos.'));
  }, [tenantId]);

  /**
   * La consulta al abrir: le pregunta al banco por el pendiente y aplica lo
   * que diga. Es lo que hace que «ya pagué» se vea sin esperar al barrido.
   */
  const consultar = useCallback(async (silencioso: boolean) => {
    if (!tenantId) return;
    if (!silencioso) setTrabajando(true);
    try {
      const r = await httpsCallable<{ tenantId: string },
        { pendiente: Pendiente | null; consultado?: boolean }>(funciones, 'consultarPagoPendiente')({ tenantId });
      setPendiente(r.data.pendiente ?? null);
      setConsultado(r.data.consultado === true);
      if (!silencioso && !r.data.pendiente) setAviso('No queda ningún cobro pendiente.');
    } catch {
      if (!silencioso) setError('No se pudo consultar el cobro pendiente.');
    } finally {
      setCargando(false);
      if (!silencioso) setTrabajando(false);
    }
  }, [tenantId]);

  useEffect(() => { void consultar(true); }, [consultar]);

  // EL PLAN QUE VIENE MARCADO ES EL SUYO, y se fija una sola vez, cuando la
  // cuenta llega. Si se recalculara en cada dibujo, la escucha en vivo de
  // `cuenta/estado` le pisaría la elección al comercio mientras elige.
  // Desde el 26/09 es UNO SOLO: el que la cuenta ya tiene (el cambio de plan
  // lo hace NovuChat). Sin plan del catálogo, ninguno: no hay qué renovar.
  const planes = useMemo(() => planesQuePuedePagar(cuenta), [cuenta]);
  useEffect(() => { if (plan === null && planes[0]) setPlan(planes[0]); }, [planes, plan]);

  const pedido: Pago | null = useMemo(() => {
    if (tipo === 'instalacion') return { tipo: 'instalacion' };
    if (tipo === 'bolsa') return { tipo: 'bolsa', cantidad };
    return plan === null ? null : { tipo: 'mensualidad', plan, meses };
  }, [tipo, plan, meses, cantidad]);

  const vista = useMemo(
    () => (pedido ? vistaDelPedido(cuenta, pedido, tipoCambio, Date.now()) : null),
    [cuenta, pedido, tipoCambio]);

  const emitir = async () => {
    if (!pedido || !vista?.montoBs) return;
    setTrabajando(true); setError(null); setAviso(null);
    try {
      await httpsCallable(funciones, 'crearCobroPrepago')({ tenantId, ...pedido });
      await consultar(true);
      setAviso('QR emitido. Páguelo desde su aplicación bancaria antes de que venza.');
    } catch (e) {
      // El servidor manda mensajes pensados para el comercio («Ya hay un cobro
      // pendiente», «No hay tipo de cambio del día»): se muestran tal cual y no
      // se reemplazan por uno genérico, que obligaría a llamar por teléfono.
      setError(mensajeDeError(e, 'No se pudo emitir el cobro.'));
      await consultar(true);
    } finally { setTrabajando(false); }
  };

  const anular = async () => {
    if (!pendiente) return;
    setTrabajando(true); setError(null); setAviso(null);
    try {
      await httpsCallable(funciones, 'anularPagoPendiente')({ tenantId, pagoId: pendiente.pagoId });
      setPendiente(null);
      setAviso('El cobro se canceló. Ya puede emitir otro.');
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cancelar el cobro.'));
      await consultar(true);
    } finally { setTrabajando(false); }
  };

  if (cargando) return <section><h2>Pagar</h2><p>Cargando…</p></section>;

  return (
    <section>
      <h2>Pagar</h2>
      {error && <p role="alert">{error}</p>}
      {aviso && <p role="status" className="ayuda">{aviso}</p>}

      {/* Lo que se está pagando, en sus tres ejes: el plan (con la doble
          moneda), la modalidad y de quién es el número. Es lo que evita la
          pregunta de por qué dos comercios con el mismo plan pagan distinto. */}
      {errorEjes && <p role="alert">{errorEjes}</p>}
      <EjesDeLaCuenta ejes={ejes} tipoCambio={tipoCambio} ahoraMs={Date.now()} />

      {pendiente
        ? <CobroPendiente
            pendiente={pendiente} consultado={consultado} trabajando={trabajando}
            onConsultar={() => void consultar(false)} onAnular={() => void anular()} />
        : (
          <>
            <fieldset>
              <legend>Qué quiere pagar</legend>
              <label>
                <input type="radio" name="tipo" checked={tipo === 'mensualidad'}
                  onChange={() => setTipo('mensualidad')} /> Mensualidad
              </label>
              <label>
                <input type="radio" name="tipo" checked={tipo === 'bolsa'}
                  onChange={() => setTipo('bolsa')} /> Bolsa de conversaciones
              </label>
              <label>
                <input type="radio" name="tipo" checked={tipo === 'instalacion'}
                  onChange={() => setTipo('instalacion')} /> Instalación
              </label>
            </fieldset>

            {tipo === 'mensualidad' && (
              <>
                {/* EL COMERCIO RENUEVA SU PLAN; NO LO ELIGE (Andres, 26/09/2026).
                    Pagar una mensualidad fija el plan, así que acá no hay
                    selector: se paga el que la cuenta tiene. Para cambiarlo,
                    el camino que existe es un reclamo de Facturación, que
                    NovuChat ve (como en Catálogo y Campañas). */}
                {planes[0]
                  ? <p>Plan <strong>{PLANES[planes[0]].nombre}</strong> · USD {PLANES[planes[0]].precioUsd} al mes
                      · {PLANES[planes[0]].conversaciones} conversaciones</p>
                  : <p className="ayuda">Su cuenta todavía no tiene un plan asignado: lo asigna NovuChat.</p>}
                <p className="ayuda">
                  El cambio de plan, para subir o para bajar, lo hace NovuChat. Para pedirlo,
                  escríbanos desde <Link to={`/negocio/${encodeURIComponent(tenantId)}/reclamos`}>Reclamos</Link>{' '}
                  con la categoría <em>Facturación</em>.
                </p>
                {/* NÚMERO PROPIO DEL COMERCIO: el comercio le paga a Meta con
                    su tarjeta. Lo dice la titularidad de sus números, no el
                    plan (`Analisis/41` §4). Decirlo acá evita la pregunta de
                    por qué lo que paga a NovuChat no incluye WhatsApp. */}
                {facturaMetaAlComercio(ejes?.numeros ?? []) && (
                  <p className="ayuda">
                    Su número es propio: el consumo de WhatsApp lo factura Meta directamente a su
                    tarjeta. Lo que se paga acá es el servicio de NovuChat.
                  </p>
                )}
                <label htmlFor="meses">Meses por adelantado</label>
                <select id="meses" value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
                  {MESES_POSIBLES.map((m) => (
                    <option key={m} value={m}>{m === 1 ? '1 mes' : `${m} meses`}</option>
                  ))}
                </select>
                {/* El regalo de los seis meses es la única bonificación que
                    existe: no hay descuento por pagar varios meses. */}
                <p className="ayuda">
                  Pagando {MESES_POSIBLES.length} meses de una vez se suma una bolsa de{' '}
                  {BOLSA.conversaciones} conversaciones sin costo. No hay descuento sobre la
                  mensualidad.
                </p>
              </>
            )}

            {tipo === 'bolsa' && (
              <>
                <label htmlFor="cantidad">Cuántas bolsas</label>
                <select id="cantidad" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>
                  {BOLSAS_POSIBLES.map((c) => (
                    <option key={c} value={c}>
                      {c === 1 ? '1 bolsa' : `${c} bolsas`} · {c * PRECIOS.bolsa.conversaciones} conversaciones
                    </option>
                  ))}
                </select>
                <p className="ayuda">
                  Cada bolsa son {PRECIOS.bolsa.conversaciones} conversaciones por USD{' '}
                  {PRECIOS.bolsa.precioUsd}, y no vencen.
                </p>
              </>
            )}

            {tipo === 'instalacion' && (
              <p className="ayuda">Instalación llave en mano: USD {PRECIOS.instalacionUsd}, una sola vez.</p>
            )}

            {vista && <VistaPrevia vista={vista} />}

            <button type="button" className="btn btn-primary"
              disabled={trabajando || !vista || vista.montoBs === null}
              onClick={() => void emitir()}>
              {trabajando ? 'Emitiendo…' : 'Emitir el QR'}
            </button>
          </>
        )}

      <h3>Pagos anteriores</h3>
      {historial.length === 0
        ? <p className="text-muted">Todavía no hay pagos registrados.</p>
        : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th><th>Concepto</th><th>USD</th><th>Bs</th>
                <th>Tipo de cambio</th><th>Medio</th><th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((p) => (
                <tr key={p.id}>
                  <td>{p.creadoEn?.toMillis ? fechaCorta(p.creadoEn.toMillis()) : '—'}</td>
                  <td><TextoSeguro valor={p.descripcion} maxLargo={80} /></td>
                  <td>{numero(p.montoUsd) ?? '—'}</td>
                  <td>{numero(p.monto) ?? '—'} <TextoSeguro valor={p.moneda} maxLargo={3} /></td>
                  <td>
                    {numero(p.tcoAplicado) ?? '—'}
                    {typeof p.tcoFecha === 'string' && <> <span className="text-muted">({p.tcoFecha})</span></>}
                  </td>
                  <td><TextoSeguro valor={p.medio} maxLargo={12} /></td>
                  <td>{ESTADO_DEL_PAGO[String(p.estado)] ?? <TextoSeguro valor={p.estado} maxLargo={20} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <p className="ayuda">
        Cada pago guarda el tipo de cambio con el que se calculó el importe en bolivianos.
        Es lo que permite reconstruir una factura meses después.
      </p>
    </section>
  );
}

function VistaPrevia({ vista }: { vista: NonNullable<ReturnType<typeof vistaDelPedido>> }) {
  return (
    <table>
      <tbody>
        <tr><th>Concepto</th><td>{vista.descripcion}</td></tr>
        <tr><th>Precio de lista</th><td>USD {vista.montoUsd}</td></tr>
        <tr>
          <th>Se cobra en bolivianos</th>
          <td>
            {vista.montoBs === null || vista.tipoCambio === null
              ? <span role="alert">
                  No hay tipo de cambio del día cargado. No se puede emitir un cobro hasta
                  que NovuChat lo cargue; escríbanos por Reclamos si esto sigue mañana.
                </span>
              : <>
                  <strong>Bs {vista.montoBs}</strong>{' '}
                  <span className="text-muted">
                    al tipo de cambio oficial de {vista.tipoCambio.tco} del {vista.tipoCambio.fecha}
                    {' '}(fuente: <TextoSeguro valor={vista.tipoCambio.fuente} maxLargo={20} />)
                  </span>
                </>}
          </td>
        </tr>
        {vista.cubiertoHasta && (
          <tr><th>Quedaría cubierto hasta</th><td>{mesEscrito(vista.cubiertoHasta)}</td></tr>
        )}
        <tr>
          <th>Bolsa después del pago</th>
          <td>
            {vista.bolsa} conversaciones
            {vista.conRegalo && <span className="tag"> incluye la bolsa de regalo</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function CobroPendiente({ pendiente, consultado, trabajando, onConsultar, onAnular }: {
  pendiente: Pendiente; consultado: boolean; trabajando: boolean;
  onConsultar: () => void; onAnular: () => void;
}) {
  const estado = String(pendiente.cobroEstado ?? 'SIN_EMITIR');
  const vencido = typeof pendiente.venceEn === 'number' && pendiente.venceEn < Date.now();
  return (
    <>
      <h3>Hay un cobro emitido</h3>
      <table>
        <tbody>
          <tr><th>Concepto</th><td><TextoSeguro valor={pendiente.descripcion} maxLargo={80} /></td></tr>
          <tr>
            <th>Importe</th>
            <td>
              <strong>{numero(pendiente.monto) ?? '—'} <TextoSeguro valor={pendiente.moneda} maxLargo={3} /></strong>
              {numero(pendiente.montoUsd) !== null && <> <span className="text-muted">(USD {numero(pendiente.montoUsd)})</span></>}
            </td>
          </tr>
          <tr>
            <th>Tipo de cambio aplicado</th>
            <td>
              {numero(pendiente.tcoAplicado) ?? '—'}
              {typeof pendiente.tcoFecha === 'string' && <> <span className="text-muted">del {pendiente.tcoFecha}</span></>}
            </td>
          </tr>
          <tr>
            <th>Vence</th>
            <td>
              {typeof pendiente.venceEn === 'number' ? fechaCorta(pendiente.venceEn) : '—'}
              {vencido && <> <span role="alert">— ya venció: cancélelo y emita otro.</span></>}
            </td>
          </tr>
          <tr><th>En el banco</th><td>{ESTADO_DEL_COBRO[estado] ?? estado}</td></tr>
        </tbody>
      </table>

      {pendiente.fichaQr
        ? (
          <p>
            {/* Sin `crossOrigin` ni token: la ficha ES la credencial, y la
                Function devuelve 404 apenas el cobro se cierra. */}
            <img src={urlDeFuncionHttp('imagenDePago', { f: pendiente.fichaQr })}
              alt="Código QR para pagar" width={320} height={320} />
          </p>
        )
        : <p className="ayuda">El QR todavía no está disponible. Actualícelo en unos minutos.</p>}

      <p className="ayuda">
        Escanee el QR desde su aplicación bancaria. NovuChat no ve su cuenta ni confirma
        pagos: la confirmación la da el banco, y cuando llega, esta pantalla lo muestra.
        {consultado
          ? ' Lo que ve recién se consultó al banco.'
          : ' Todavía no se pudo consultar al banco; lo que ve es lo último registrado.'}
      </p>

      <button type="button" className="btn btn-secondary" disabled={trabajando} onClick={onConsultar}>
        {trabajando ? 'Consultando…' : 'Ya pagué: consultar al banco'}
      </button>{' '}
      <button type="button" className="btn btn-secondary" disabled={trabajando} onClick={onAnular}>
        Cancelar este cobro
      </button>
    </>
  );
}

/**
 * El mensaje del servidor, si lo hay. Las Functions del prepago escriben
 * mensajes para el comercio, no para el registro: repetirlos es mejor que
 * taparlos con «ocurrió un error».
 */
function mensajeDeError(e: unknown, respaldo: string): string {
  const mensaje = (e as FunctionsError | undefined)?.message;
  return typeof mensaje === 'string' && mensaje.trim() !== '' && !/^internal$/i.test(mensaje)
    ? mensaje : respaldo;
}
