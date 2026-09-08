import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useParams } from 'react-router-dom';
import { db, funciones } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import {
  BOLSA, ETIQUETA_MODALIDAD, PLANES, corteDe, etiquetaServicio, fechaCorta,
  fechaFinDelPeriodo, numero, useEstadoServicio, type Modalidad, type PlanId,
} from '../lib/prepago';

/**
 * LA CUENTA DE UN NEGOCIO, VISTA POR NOVUCHAT. Es la palanca comercial:
 * ficha, plan y modalidad, saldo, pagos por confirmar y pagos registrados a
 * mano. Todo lo que cambia algo pasa por una Cloud Function y queda auditado.
 *
 * EL BOTÓN QUE IMPORTA ES «Confirmar». Un comprobante que llegó por WhatsApp
 * queda como «comprobante recibido» hasta que una persona de NovuChat lo mira
 * contra el banco y lo confirma acá. Recién entonces se suman los meses o las
 * bolsas y el servicio se reanuda solo. El asistente NUNCA dice «pago
 * acreditado»: lo dice esta pantalla, cuando alguien lo comprobó.
 */
interface Ficha {
  nombre?: unknown; estado?: unknown; razonSocial?: unknown; nit?: unknown;
  dueno?: { nombre?: unknown; telefono?: unknown; correo?: unknown };
  telefonosCobro?: unknown; flujos?: unknown;
}

interface Pago {
  id: string; descripcion?: unknown; monto?: unknown; estado?: unknown; canal?: unknown;
  creadoEn?: { toDate?: () => Date }; confirmadoEn?: { toDate?: () => Date };
  telefonoEnmascarado?: unknown; motivoRechazo?: unknown; cubiertoHasta?: unknown;
}

const ESTADO_PAGO: Record<string, string> = {
  esperando_comprobante: 'Esperando comprobante',
  comprobante_recibido: 'Comprobante recibido: revisar y confirmar',
  confirmado: 'Confirmado',
  rechazado: 'Rechazado',
};

function llamar<T = unknown>(nombre: string, datos: unknown): Promise<T> {
  return httpsCallable<unknown, T>(funciones, nombre)(datos).then((r) => r.data);
}

export function CuentaNegocio() {
  const { tenantId = '' } = useParams();
  const { cuenta, estado, periodo, error: errorCuenta } = useEstadoServicio(tenantId);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [pagos, setPagos] = useState<Pago[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    const a = onSnapshot(doc(db, 'tenants', tenantId), (d) => setFicha((d.data() ?? {}) as Ficha),
      () => setAviso('No se pudo leer la ficha.'));
    const b = onSnapshot(
      query(collection(db, 'tenants', tenantId, 'pagos'), orderBy('creadoEn', 'desc'), limit(20)),
      (i) => setPagos(i.docs.map((d) => ({ id: d.id, ...d.data() } as Pago))),
      () => setAviso('No se pudieron leer los pagos.'));
    return () => { a(); b(); };
  }, [tenantId]);

  const ejecutar = async (accion: () => Promise<unknown>, exito: string) => {
    setAviso(null); setOcupado(true);
    try { await accion(); setAviso(exito); }
    catch (e) { setAviso(`No se pudo. ${e instanceof Error ? e.message : ''}`.trim()); }
    finally { setOcupado(false); }
  };

  if (errorCuenta) return <section><p role="alert">{errorCuenta}</p></section>;
  if (!ficha || !estado || !cuenta) return <section><p>Cargando…</p></section>;

  const servicio = etiquetaServicio(estado);
  const corte = corteDe(cuenta);
  const pendientes = pagos.filter((p) => p.estado === 'comprobante_recibido' || p.estado === 'esperando_comprobante');

  return (
    <section>
      <h2><TextoSeguro valor={ficha.nombre} maxLargo={80} /> · cuenta</h2>
      <p className="text-muted">
        <Link to="/negocios">Negocios</Link> · <Link to={`/negocio/${encodeURIComponent(tenantId)}/consumo`}>Consumo</Link>
        {' '}· <Link to={`/negocio/${encodeURIComponent(tenantId)}/bitacora`}>Bitácora</Link>
      </p>
      {aviso && <p role="status">{aviso}</p>}

      <div className="cuadricula">
        <article className="card elev-sm">
          <h3 className="card-kicker">Servicio</h3>
          <div className="card-body">
            <p className={`situacion ${servicio.ok ? 'ok' : 'alerta'}`}><strong>{servicio.texto}</strong></p>
            <p>
              {ETIQUETA_MODALIDAD[estado.modalidad]} · {PLANES[estado.plan].nombre}
              {estado.cubiertoHasta ? ` · cubierto hasta el ${fechaFinDelPeriodo(estado.cubiertoHasta)}` : ' · nada cubierto'}
            </p>
            <div className="datos">
              <div className="dato"><strong>{numero(estado.disponibles)}</strong><span>disponibles</span></div>
              <div className="dato"><strong>{estado.consumidas}</strong><span>usadas en {periodo}</span></div>
              <div className="dato"><strong>{estado.incluidas}</strong><span>incluidas</span></div>
              <div className="dato"><strong>{estado.bolsa}</strong><span>de bolsa</span></div>
              {estado.enPrueba && <div className="dato"><strong>{estado.bolsaPrueba}</strong><span>de prueba</span></div>}
            </div>
            {corte && (
              <p className="text-muted">
                Cortado desde el {fechaCorta(corte.desdeMs)} ({corte.motivo === 'sin_pago' ? 'mes sin pagar' : 'sin conversaciones'}).
                Desde entonces {corte.perdidas} mensajes de clientes quedaron sin atención.
              </p>
            )}
            <p className="text-muted">
              Estado en la ficha: <TextoSeguro valor={ficha.estado} maxLargo={20} />. Una suspensión manual se
              maneja aparte y pisa todo esto.
            </p>
          </div>
        </article>

        <FichaComercial tenantId={tenantId} ficha={ficha} ocupado={ocupado} ejecutar={ejecutar} />
      </div>

      {pendientes.length > 0 && (
        <article className="card elev-sm">
          <h3 className="card-kicker">Pagos por confirmar</h3>
          <div className="card-body">
            <p className="text-muted">
              Confirmar suma los meses o las bolsas y reanuda el servicio al instante. Antes, comprobar
              en el banco que el dinero entró: el comprobante es una imagen y una imagen se edita.
            </p>
            <table className="table">
              <thead><tr><th>Cuándo</th><th>Qué</th><th>Monto</th><th>Estado</th><th>Desde</th><th /></tr></thead>
              <tbody>
                {pendientes.map((p) => (
                  <tr key={p.id}>
                    <td>{p.creadoEn?.toDate?.().toLocaleString('es-BO') ?? '—'}</td>
                    <td><TextoSeguro valor={p.descripcion} maxLargo={80} /></td>
                    <td>Bs {typeof p.monto === 'number' ? p.monto : '—'}</td>
                    <td>{ESTADO_PAGO[String(p.estado)] ?? <TextoSeguro valor={p.estado} maxLargo={30} />}</td>
                    <td><TextoSeguro valor={p.telefonoEnmascarado} maxLargo={20} /></td>
                    <td>
                      <button type="button" className="btn btn-primary" disabled={ocupado}
                        onClick={() => ejecutar(() => llamar('confirmarPago', { tenantId, pagoId: p.id }),
                          'Pago confirmado y aplicado.')}>Confirmar</button>{' '}
                      <button type="button" className="btn btn-secondary" disabled={ocupado}
                        onClick={() => {
                          const motivo = window.prompt('Motivo del rechazo (lo ve NovuChat, no el negocio):') ?? '';
                          if (motivo.trim() === '') return;
                          void ejecutar(() => llamar('rechazarPago', { tenantId, pagoId: p.id, motivo }), 'Pago rechazado.');
                        }}>Rechazar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}

      <div className="cuadricula">
        <RegistrarPago tenantId={tenantId} planActual={estado.plan} ocupado={ocupado} ejecutar={ejecutar} />
        <ConfigurarCuenta tenantId={tenantId} cuenta={cuenta} ocupado={ocupado} ejecutar={ejecutar} />
      </div>

      <h3>Pagos</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="table">
          <thead><tr><th>Cuándo</th><th>Qué</th><th>Monto</th><th>Estado</th><th>Canal</th><th>Cubre hasta</th></tr></thead>
          <tbody>
            {pagos.map((p) => (
              <tr key={p.id}>
                <td>{(p.confirmadoEn ?? p.creadoEn)?.toDate?.().toLocaleDateString('es-BO') ?? '—'}</td>
                <td><TextoSeguro valor={p.descripcion} maxLargo={80} /></td>
                <td>Bs {typeof p.monto === 'number' ? p.monto : '—'}</td>
                <td>{ESTADO_PAGO[String(p.estado)] ?? <TextoSeguro valor={p.estado} maxLargo={30} />}</td>
                <td><TextoSeguro valor={p.canal} maxLargo={10} /></td>
                <td><TextoSeguro valor={p.cubiertoHasta} maxLargo={7} /></td>
              </tr>
            ))}
            {pagos.length === 0 && <tr><td colSpan={6}>Todavía no hay pagos registrados.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Ejecutar = (accion: () => Promise<unknown>, exito: string) => Promise<void>;

function FichaComercial({ tenantId, ficha, ocupado, ejecutar }: {
  tenantId: string; ficha: Ficha; ocupado: boolean; ejecutar: Ejecutar;
}) {
  const [nombre, setNombre] = useState(String(ficha.nombre ?? ''));
  const [razonSocial, setRazonSocial] = useState(String(ficha.razonSocial ?? ''));
  const [nit, setNit] = useState(String(ficha.nit ?? ''));
  const [duenoNombre, setDuenoNombre] = useState(String(ficha.dueno?.nombre ?? ''));
  const [duenoTelefono, setDuenoTelefono] = useState(String(ficha.dueno?.telefono ?? ''));
  const [duenoCorreo, setDuenoCorreo] = useState(String(ficha.dueno?.correo ?? ''));
  const [telefonos, setTelefonos] = useState(
    Array.isArray(ficha.telefonosCobro) ? ficha.telefonosCobro.map(String).join(', ') : '');

  return (
    <article className="card elev-sm">
      <h3 className="card-kicker">Ficha comercial</h3>
      <form className="card-body" onSubmit={(e) => {
        e.preventDefault();
        void ejecutar(() => llamar('editarTenant', {
          tenantId, nombre, razonSocial, nit,
          dueno: { nombre: duenoNombre, telefono: duenoTelefono, correo: duenoCorreo },
          telefonosCobro: telefonos.split(/[,\s]+/).filter(Boolean),
        }), 'Ficha guardada.');
      }}>
        <label>Nombre comercial<input required maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>
        <label>Razón social<input maxLength={160} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} /></label>
        <label>NIT<input maxLength={20} pattern="[0-9]{5,15}" value={nit} onChange={(e) => setNit(e.target.value)} /></label>
        <label>Dueño<input maxLength={120} value={duenoNombre} onChange={(e) => setDuenoNombre(e.target.value)} /></label>
        <label>Teléfono del dueño<input maxLength={15} pattern="[0-9]{8,15}" value={duenoTelefono} onChange={(e) => setDuenoTelefono(e.target.value)} /></label>
        <label>Correo del dueño<input type="email" maxLength={254} value={duenoCorreo} onChange={(e) => setDuenoCorreo(e.target.value)} /></label>
        <label>Teléfonos de cobro (paga y recibe recordatorios desde estos; separados por coma)
          <input maxLength={100} value={telefonos} onChange={(e) => setTelefonos(e.target.value)} />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={ocupado}>Guardar ficha</button>
      </form>
    </article>
  );
}

function RegistrarPago({ tenantId, planActual, ocupado, ejecutar }: {
  tenantId: string; planActual: PlanId; ocupado: boolean; ejecutar: Ejecutar;
}) {
  const [tipo, setTipo] = useState<'mensualidad' | 'bolsa'>('mensualidad');
  const [plan, setPlan] = useState<PlanId>(planActual);
  const [meses, setMeses] = useState(1);
  const [cantidad, setCantidad] = useState(1);
  const [referencia, setReferencia] = useState('');
  const monto = tipo === 'mensualidad' ? PLANES[plan].mensualidad * meses : BOLSA.precio * cantidad;

  return (
    <article className="card elev-sm">
      <h3 className="card-kicker">Registrar un pago visto por fuera</h3>
      <form className="card-body" onSubmit={(e) => {
        e.preventDefault();
        void ejecutar(() => llamar('registrarPago', {
          tenantId, tipo, ...(tipo === 'mensualidad' ? { plan, meses } : { cantidad }), referencia,
        }), 'Pago registrado y aplicado.');
      }}>
        <p className="text-muted">
          Para una transferencia o un efectivo que no pasó por el flujo de WhatsApp. Se aplica al instante.
        </p>
        <label>Qué
          <select value={tipo} onChange={(e) => setTipo(e.target.value === 'bolsa' ? 'bolsa' : 'mensualidad')}>
            <option value="mensualidad">Mensualidad</option>
            <option value="bolsa">Bolsa de {BOLSA.conversaciones} conversaciones</option>
          </select>
        </label>
        {tipo === 'mensualidad' ? (
          <>
            <label>Plan
              <select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
                {(Object.keys(PLANES) as PlanId[]).map((id) => (
                  <option key={id} value={id}>{PLANES[id].nombre} · Bs {PLANES[id].mensualidad}</option>
                ))}
              </select>
            </label>
            <label>Meses<input type="number" min={1} max={12} value={meses} onChange={(e) => setMeses(Number(e.target.value))} /></label>
          </>
        ) : (
          <label>Cantidad de bolsas<input type="number" min={1} max={20} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} /></label>
        )}
        <label>Referencia (número de transacción, quién lo vio)
          <input maxLength={120} value={referencia} onChange={(e) => setReferencia(e.target.value)} />
        </label>
        <p><strong>Bs {monto}</strong></p>
        <button type="submit" className="btn btn-primary" disabled={ocupado}>Registrar y aplicar</button>
      </form>
    </article>
  );
}

function ConfigurarCuenta({ tenantId, cuenta, ocupado, ejecutar }: {
  tenantId: string; cuenta: Record<string, unknown>; ocupado: boolean; ejecutar: Ejecutar;
}) {
  const [modalidad, setModalidad] = useState<Modalidad>(
    (['prueba', 'prepago', 'demostracion'] as const).find((m) => m === cuenta['modalidad']) ?? 'demostracion');
  const [plan, setPlan] = useState<PlanId>(
    (Object.keys(PLANES) as PlanId[]).find((p) => p === cuenta['plan']) ?? 'base');
  const [periodoPrueba, setPeriodoPrueba] = useState(String(cuenta['periodoPrueba'] ?? ''));
  const [periodoPagado, setPeriodoPagado] = useState(String(cuenta['periodoPagado'] ?? ''));
  const [bolsa, setBolsa] = useState(Number(cuenta['bolsa'] ?? 0));
  const [bolsaPrueba, setBolsaPrueba] = useState(Number(cuenta['bolsaPrueba'] ?? 0));
  const [motivoVisible, setMotivoVisible] = useState(String(cuenta['motivoVisible'] ?? ''));

  return (
    <article className="card elev-sm">
      <h3 className="card-kicker">Plan, modalidad y saldos</h3>
      <form className="card-body" onSubmit={(e) => {
        e.preventDefault();
        void ejecutar(() => llamar('configurarCuenta', {
          tenantId, modalidad, plan, periodoPrueba, periodoPagado, bolsa, bolsaPrueba, motivoVisible,
        }), 'Cuenta configurada.');
      }}>
        <p className="text-muted">
          Para arrancar o corregir a mano. Un pago normal se registra en la tarjeta de al lado, no acá.
        </p>
        <label>Modalidad
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value as Modalidad)}>
            <option value="prueba">Mes de prueba</option>
            <option value="prepago">Prepago</option>
            <option value="demostracion">Demostración (sin cobro ni corte)</option>
          </select>
        </label>
        <label>Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            {(Object.keys(PLANES) as PlanId[]).map((id) => <option key={id} value={id}>{PLANES[id].nombre}</option>)}
          </select>
        </label>
        <label>Mes de prueba (aaaa-mm)<input pattern="\d{4}-\d{2}" value={periodoPrueba} onChange={(e) => setPeriodoPrueba(e.target.value)} /></label>
        <label>Pagado hasta (aaaa-mm; vacío = nada cubierto)<input pattern="(\d{4}-\d{2})?" value={periodoPagado} onChange={(e) => setPeriodoPagado(e.target.value)} /></label>
        <label>Bolsa (conversaciones compradas sin usar)<input type="number" min={0} value={bolsa} onChange={(e) => setBolsa(Number(e.target.value))} /></label>
        <label>Bolsa de prueba<input type="number" min={0} value={bolsaPrueba} onChange={(e) => setBolsaPrueba(Number(e.target.value))} /></label>
        <label>Nota visible para el negocio<input maxLength={300} value={motivoVisible} onChange={(e) => setMotivoVisible(e.target.value)} /></label>
        <button type="submit" className="btn btn-secondary" disabled={ocupado}>Guardar</button>
      </form>
    </article>
  );
}
