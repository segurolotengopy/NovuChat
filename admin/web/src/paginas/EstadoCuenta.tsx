import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import {
  BOLSA, ETIQUETA_MODALIDAD, PLANES, corteDe, fechaCorta, fechaFinDelPeriodo, numero,
  useEstadoServicio,
} from '../lib/prepago';

interface Pago {
  id: string; descripcion?: unknown; monto?: unknown; estado?: unknown;
  creadoEn?: { toDate?: () => Date }; cubiertoHasta?: unknown;
}

const ESTADO_PAGO: Record<string, string> = {
  esperando_comprobante: 'Esperando tu comprobante',
  comprobante_recibido: 'Comprobante recibido, en revisión',
  confirmado: 'Confirmado',
  rechazado: 'No se pudo confirmar',
};

/**
 * Estado de cuenta, visible para el administrador del comercio.
 *
 * SOLO LECTURA. Cambiarlo es de NovuChat, por Cloud Function y con auditoría.
 * Si el comercio pudiera escribirlo se pondría "al día" y el estado de cuenta
 * dejaría de significar nada.
 *
 * Se lee con `tenantLegible`, así que **un comercio suspendido o cortado sigue
 * viendo esta pantalla**. Es deliberado: si el comercio conserva la vista de
 * sus datos, tiene que ver también por qué se le cortó el servicio y cómo lo
 * reanuda. Un corte sin explicación visible es una llamada de reclamo
 * garantizada.
 *
 * EL SALDO SE CALCULA CON EL MISMO MÓDULO QUE USA EL SERVIDOR PARA CORTAR
 * (`lib/prepago.ts`): el número que ve el negocio es el número con el que se
 * decide.
 */
export function EstadoCuenta() {
  const { tenantId = '' } = useParams();
  const { cuenta, estado, periodo, error } = useEstadoServicio(tenantId);
  const [telefonosCobro, setTelefonosCobro] = useState<string[]>([]);
  const [pagos, setPagos] = useState<Pago[]>([]);

  useEffect(() => {
    if (!tenantId) return;
    const a = onSnapshot(doc(db, 'tenants', tenantId), (d) => {
      const t = d.get('telefonosCobro');
      setTelefonosCobro(Array.isArray(t) ? t.map(String) : []);
    }, () => undefined);
    const b = onSnapshot(
      query(collection(db, 'tenants', tenantId, 'pagos'), orderBy('creadoEn', 'desc'), limit(10)),
      (i) => setPagos(i.docs.map((d) => ({ id: d.id, ...d.data() } as Pago))),
      () => undefined);
    return () => { a(); b(); };
  }, [tenantId]);

  if (error) return <section><p role="alert">{error}</p></section>;
  if (!cuenta || !estado) return <section><p>Cargando…</p></section>;

  const corte = corteDe(cuenta);
  const motivoVisible = typeof cuenta['motivoVisible'] === 'string' ? cuenta['motivoVisible'] : '';

  if (estado.modalidad === 'demostracion') {
    return (
      <section>
        <h2>Estado de cuenta</h2>
        <p className="situacion ok"><strong>Cuenta de demostración</strong></p>
        <p className="ayuda">Sin mensualidad ni límite de conversaciones. No hay nada que pagar.</p>
        {motivoVisible && <p className="ayuda" role="status"><TextoSeguro valor={motivoVisible} maxLargo={300} /></p>}
      </section>
    );
  }

  const plan = PLANES[estado.plan];
  const situacion = estado.operativo
    ? (estado.enPrueba ? 'Mes de prueba activo' : 'Al día')
    : estado.motivo === 'sin_pago' ? 'Servicio detenido: el mes no está pagado'
    : 'Servicio detenido: se agotaron las conversaciones';

  return (
    <section>
      <h2>Estado de cuenta</h2>

      <p className={estado.operativo ? 'situacion ok' : 'situacion alerta'}><strong>{situacion}</strong></p>

      {!estado.operativo && (
        <p className="ayuda" role="status">
          Mientras esté detenido, tus clientes reciben un aviso cortés de que no se los puede atender por
          este medio, y sus mensajes no se responden.
          {corte && corte.perdidas > 0 && <> Desde el {fechaCorta(corte.desdeMs)} llegaron <strong>{corte.perdidas}</strong> mensajes sin atención.</>}
          {estado.motivo === 'sin_pago'
            ? ' Se reanuda apenas NovuChat confirme el pago del mes.'
            : ` Se reanuda apenas NovuChat confirme una bolsa de ${BOLSA.conversaciones} conversaciones (Bs ${BOLSA.precio}) o el pago del mes siguiente.`}
        </p>
      )}

      <div className="cuadricula">
        <article className="card elev-sm">
          <h3 className="card-kicker">Conversaciones de {periodo}</h3>
          <div className="datos">
            <div className="dato"><strong>{numero(estado.disponibles)}</strong><span>disponibles</span></div>
            <div className="dato"><strong>{estado.consumidas}</strong><span>usadas</span></div>
            <div className="dato"><strong>{estado.enPrueba ? estado.bolsaPrueba : estado.incluidas}</strong>
              <span>{estado.enPrueba ? 'de prueba' : 'incluidas'}</span></div>
            <div className="dato"><strong>{estado.bolsa}</strong><span>de bolsa</span></div>
          </div>
          <p className="text-muted">
            Una conversación son todos los mensajes con un mismo cliente durante 24 horas. Las incluidas
            se renuevan cada mes; las de bolsa no vencen y se usan cuando las incluidas se acaban.
          </p>
        </article>

        <article className="card elev-sm">
          <h3 className="card-kicker">Plan</h3>
          <table>
            <tbody>
              <tr><th>Modalidad</th><td>{ETIQUETA_MODALIDAD[estado.modalidad]}</td></tr>
              <tr><th>Plan</th><td>{plan.nombre} · {plan.conversaciones} conversaciones por mes</td></tr>
              <tr><th>Mensualidad</th><td>{estado.enPrueba ? 'Bs 0 este mes' : `Bs ${plan.mensualidad}`}</td></tr>
              <tr><th>{estado.enPrueba ? 'Prueba hasta' : 'Pagado hasta'}</th>
                <td>{estado.cubiertoHasta ? fechaFinDelPeriodo(estado.cubiertoHasta) : 'sin pagos registrados'}</td></tr>
            </tbody>
          </table>
        </article>

        <article className="card elev-sm">
          <h3 className="card-kicker">Cómo pagar</h3>
          <div className="card-body">
            <p>
              Escribe <strong>pagar</strong> al WhatsApp de NovuChat desde
              {telefonosCobro.length > 0
                ? <> tu número registrado ({telefonosCobro.map((t) => <code key={t}>{t}</code>).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])})</>
                : ' el número que registraste con NovuChat'}
              . Te llega el QR, pagas desde tu banco y mandas el comprobante por el mismo chat.
            </p>
            <p className="text-muted">
              Escribe <strong>bolsa</strong> para sumar {BOLSA.conversaciones} conversaciones por Bs {BOLSA.precio},
              o <strong>saldo</strong> para ver este mismo resumen. El servicio se reanuda cuando NovuChat
              confirma el pago; el asistente no lo da por acreditado solo con la foto.
            </p>
          </div>
        </article>
      </div>

      {motivoVisible && <p className="ayuda" role="status"><TextoSeguro valor={motivoVisible} maxLargo={300} /></p>}

      {pagos.length > 0 && (
        <>
          <h3>Pagos</h3>
          <table className="table">
            <thead><tr><th>Cuándo</th><th>Qué</th><th>Monto</th><th>Estado</th></tr></thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.id}>
                  <td>{p.creadoEn?.toDate?.().toLocaleDateString('es-BO') ?? '—'}</td>
                  <td><TextoSeguro valor={p.descripcion} maxLargo={80} /></td>
                  <td>Bs {typeof p.monto === 'number' ? p.monto : '—'}</td>
                  <td>{ESTADO_PAGO[String(p.estado)] ?? <TextoSeguro valor={p.estado} maxLargo={30} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="ayuda">
        Para consultas sobre tu facturación, usa la pantalla de Reclamos con la categoría <em>Facturación</em>.
      </p>
    </section>
  );
}
