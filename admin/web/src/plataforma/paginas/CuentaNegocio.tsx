import { useCallback, useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { ref, uploadBytes } from 'firebase/storage';
import { Link, useParams } from 'react-router-dom';
import { auth, db, funciones, storage } from '../../lib/firebase';
import { TextoSeguro } from '../../componentes/TextoSeguro';
import { ChipModo } from '../../componentes/ChipModo';
import { modoDelComercio } from '../../lib/modoComercio';
import { useEjesDeCuenta, useTipoCambio } from '../../central/lib/lecturas';
import { CALLABLES, type Modalidad, type Modelo, type Titularidad } from '../../lib/ejes';
import type { IdPlanVendible } from '../../lib/planes';
import { corteDe, fechaCorta } from '../../lib/prepago';
import { PanelEjes } from '../componentes/PanelEjes';
import { SuspensionNegocio } from '../componentes/SuspensionNegocio';
import { FormularioPagoManual, type PedidoDePagoManual } from '../componentes/FormularioPagoManual';
import { CortePrepago } from '../componentes/CortePrepago';
import {
  esIdTenant, mensajeDeError, motivoDeRechazoPrevio, nombreEvidencia, nuevoPagoId, pideSesionReciente, rutaEvidencia,
  validarComprobante,
} from '../lib/negocios';

/** Lo que se dice si la ruta trae un identificador que el servidor no aceptaría. */
const TENANT_INVALIDO = 'Identificador de comercio inválido: no se llama a nada.';

interface FilaPago {
  id: string;
  estado?: unknown;
  descripcion?: unknown;
  monto?: unknown;
  medio?: unknown;
  creadoEn?: { toMillis(): number };
}

/**
 * UN NEGOCIO, VISTO POR NOVUCHAT (Plataforma, `Analisis/41` §1.2 y §7 fila F1:
 * absorbe A-3b del prepago). Acá, y solo acá, se asignan los tres ejes y el
 * modelo, se fijan los umbrales, se suspende y se reactiva, se carga un pago a
 * mano con su comprobante y se enciende el corte de ESTE comercio.
 *
 * LA PANTALLA ACOMPAÑA, EL SERVIDOR MANDA (`CLAUDE.md` §7). Ninguna acción
 * escribe Firestore desde el navegador: todas son callables del propietario
 * (`lib/ejes.ts`, `CALLABLES`), cada una con su confirmación explícita antes,
 * y el error que devuelve el servidor se muestra tal cual, porque está escrito
 * para quien opera. Lo que el servidor rechaza, no pasa, aunque alguien arme
 * la petición a mano.
 *
 * EL PAGO MANUAL, EN ORDEN: se genera un `pagoId` UNA vez por formulario; si
 * hay comprobante, se sube a `tenants/{t}/pagos/{pagoId}/evidencia.{ext}`
 * (la regla de Storage lo deja solo antes de registrar); recién entonces se
 * llama a `registrarPagoManual`, que comprueba el objeto y crea el pago
 * confirmado. Un reintento reusa el mismo `pagoId`, y el servidor no suma dos
 * meses. Si la sesión tiene más de media hora, el servidor lo dice y acá se
 * ofrece volver a entrar con Google sin perder lo escrito.
 *
 * SOLO EL PROPIETARIO, con sesión de Google: lo exige cada callable y lo
 * repite la ruta (`Proteger requiere="propietario"`), que es cortesía.
 */
export function CuentaNegocio() {
  const { tenantId = '' } = useParams();
  const [ficha, setFicha] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [cuenta, setCuenta] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [pagos, setPagos] = useState<FilaPago[] | null>(null);
  // Titularidad por número, modelo y cambios del mes: del servidor, y se
  // vuelven a pedir después de cada cambio confirmado.
  const { ejes, error: errorEjes, recargar } = useEjesDeCuenta(tenantId);
  const tipoCambio = useTipoCambio();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [reautenticar, setReautenticar] = useState<PedidoDePagoManual | null>(null);
  // El `pagoId` de ESTE formulario: se renueva solo cuando un pago se registró.
  const [pagoId, setPagoId] = useState(() => nuevoPagoId());

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId),
      (d) => setFicha(d.exists() ? d.data() : null),
      () => setError('No se pudo leer la ficha del comercio.'));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'cuenta', 'estado'),
      (d) => setCuenta(d.data() ?? {}),
      () => setError('No se pudo leer la cuenta del comercio.'));
  }, [tenantId]);

  // Los últimos pagos, para ver el que se acaba de cargar. Si la lectura
  // falla se esconde la lista y nada más.
  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'pagos'), orderBy('creadoEn', 'desc'), limit(10)),
      (i) => setPagos(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setPagos(null));
  }, [tenantId]);

  /**
   * Llama a una callable y muestra el resultado real: el error del servidor,
   * tal cual. GUARDIA DEL `tenantId` (revisión de seguridad de #203, LOW 2):
   * con un identificador que no cumple `ID_TENANT` no se llama a NADA, porque
   * `fijarCortePrepago` con cadena vacía significa «la compuerta global».
   */
  const operar = useCallback(async (nombre: string, datos: Record<string, unknown>, exito: string): Promise<boolean> => {
    if (!esIdTenant(tenantId)) { setError(TENANT_INVALIDO); return false; }
    setOcupado(true); setError(null); setAviso(null);
    try {
      await httpsCallable(funciones, nombre)({ tenantId, ...datos });
      setAviso(exito);
      recargar();
      return true;
    } catch (e) {
      setError(mensajeDeError(e, `No se pudo completar la operación (${nombre}).`));
      return false;
    } finally {
      setOcupado(false);
    }
  }, [tenantId, recargar]);

  const registrarPago = useCallback(async (pedido: PedidoDePagoManual) => {
    if (!esIdTenant(tenantId)) { setError(TENANT_INVALIDO); return; }
    setOcupado(true); setError(null); setAviso(null); setReautenticar(null);
    try {
      const { pedido: pago, comprobante, ...resto } = pedido;
      // ANTES DE SUBIR NADA: lo que el servidor rechazaría antes de mirar la
      // evidencia se rechaza acá, para no dejar comprobantes huérfanos en
      // Storage (LOW 1). Las mismas cotas del módulo compartido.
      const rechazo = motivoDeRechazoPrevio(resto, Date.now());
      if (rechazo) throw new Error(rechazo);
      let evidencia: string | undefined;
      if (resto.medio === 'transferencia') {
        if (!comprobante) throw new Error('Una transferencia exige el comprobante.');
        if (!storage) throw new Error('La consola se compiló sin depósito de archivos: no se puede subir el comprobante.');
        const v = await validarComprobante(comprobante);
        if (!v.ok) throw new Error(v.motivo);
        await uploadBytes(ref(storage, rutaEvidencia(tenantId, pagoId, v.ext)), comprobante, { contentType: v.contentType });
        evidencia = nombreEvidencia(v.ext);
      }
      const r = await httpsCallable<Record<string, unknown>, { cubiertoHasta?: string; monto?: number }>(funciones, CALLABLES.pagoManual)({
        tenantId, ...pago, ...resto, pagoId, ...(evidencia ? { evidencia } : {}),
      });
      setPagoId(nuevoPagoId());
      setAviso(`Pago registrado: Bs ${r.data.monto ?? '—'}${r.data.cubiertoHasta ? ` · cubierto hasta ${r.data.cubiertoHasta}` : ''}.`);
    } catch (e) {
      if (pideSesionReciente(e)) setReautenticar(pedido);
      setError(mensajeDeError(e, 'No se pudo registrar el pago.'));
    } finally {
      setOcupado(false);
    }
  }, [tenantId, pagoId]);

  const volverAEntrar = async () => {
    const pendiente = reautenticar;
    if (!auth.currentUser || !pendiente) return;
    setError(null);
    try {
      const proveedor = new GoogleAuthProvider();
      proveedor.setCustomParameters({ prompt: 'select_account' });
      await reauthenticateWithPopup(auth.currentUser, proveedor);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo volver a iniciar sesión.'));
      return;
    }
    await registrarPago(pendiente);
  };

  if (error && ficha === undefined) return <section><p role="alert">{error}</p></section>;
  if (ficha === undefined || cuenta === undefined) return <section><h2>Negocio</h2><p>Cargando…</p></section>;
  if (ficha === null) return <section><h2>Negocio</h2><p role="alert">No existe ese comercio.</p><p><Link to="/negocios">Volver a Negocios</Link></p></section>;

  const corte = corteDe(cuenta);
  const ahoraMs = Date.now();

  return (
    <section>
      <p><Link to="/negocios">← Negocios</Link></p>
      <h2>
        <TextoSeguro valor={ficha['nombre']} maxLargo={80} />{' '}
        <ChipModo modo={modoDelComercio(cuenta)} />
      </h2>
      <p className="text-muted">
        Identificador <code>{tenantId}</code> · estado <TextoSeguro valor={ficha['estado']} maxLargo={20} />
        {' '}· <Link to={`/negocio/${encodeURIComponent(tenantId)}/consumo`}>consumo</Link>
        {' '}· <Link to={`/negocio/${encodeURIComponent(tenantId)}/pagar`}>pagar</Link>
      </p>
      {error && <p role="alert">{error}</p>}
      {reautenticar && (
        <p>
          <button type="button" className="btn btn-primary" disabled={ocupado} onClick={() => void volverAEntrar()}>
            Volver a entrar con Google y registrar el pago
          </button>
        </p>
      )}
      {aviso && <p role="status" className="ayuda">{aviso}</p>}
      {corte && (
        <p className={corte.aplicado ? 'situacion alerta' : 'text-muted'}>
          {corte.aplicado ? 'Corte aplicado' : 'Corte observado (no aplicado)'} por{' '}
          {corte.motivo === 'sin_pago' ? 'falta de pago' : 'fin de conversaciones'} desde el {fechaCorta(corte.desdeMs)}
          {corte.perdidas > 0 && <> · {corte.perdidas} {corte.perdidas === 1 ? 'cliente' : 'clientes'} sin atender</>}
        </p>
      )}

      {errorEjes && <p role="alert">{errorEjes}</p>}
      <PanelEjes cuenta={cuenta} ejes={ejes} tipoCambio={tipoCambio} ahoraMs={ahoraMs} ocupado={ocupado}
        onPlan={(plan: IdPlanVendible) => void operar(CALLABLES.cuenta, { plan }, 'Plan cambiado.')}
        onModalidad={(modalidad: Modalidad) => void operar(CALLABLES.cuenta, { modalidad }, 'Modalidad cambiada.')}
        onTitularidad={(phoneNumberId: string, titularidad: Titularidad) =>
          void operar(CALLABLES.ejes, { titularidad: { phoneNumberId, titularidad } }, 'Titularidad cambiada.')}
        onModelo={(modelo: Modelo) => void operar(CALLABLES.ejes, { modelo }, 'Modelo cambiado.')}
        onUmbrales={(u) => void operar(CALLABLES.cuenta,
          u ? { umbralOperador: u.operador, umbralBloqueo: u.bloqueo } : { umbralOperador: null, umbralBloqueo: null },
          u ? 'Umbrales fijados.' : 'Umbrales de respaldo restaurados.')}
        onCambio={(descripcion, forzar) => void operar(CALLABLES.cambio, { descripcion, ...(forzar ? { forzar: true } : {}) },
          forzar ? 'Cambio registrado por encima de los incluidos.' : 'Cambio registrado.')}
        onCambiosIncluidos={(cambiosIncluidos) => void operar(CALLABLES.cuenta, { cambiosIncluidos },
          cambiosIncluidos === null ? 'Cambios incluidos: rigen los del plan.' : 'Cambios incluidos fijados por contrato.')} />

      <SuspensionNegocio ficha={ficha} ocupado={ocupado}
        onSuspender={(motivo, motivoVisible) => void operar(CALLABLES.suspender, { motivo, motivoVisible }, 'Servicio suspendido.')}
        onReactivar={() => void operar(CALLABLES.reactivar, {}, 'Servicio reactivado.')} />

      <FormularioPagoManual key={pagoId} cuenta={cuenta} tipoCambio={tipoCambio} ahoraMs={ahoraMs} ocupado={ocupado}
        onRegistrar={(pedido) => void registrarPago(pedido)} />

      {pagos !== null && (
        <>
          <h3>Últimos pagos</h3>
          {pagos.length === 0
            ? <p className="text-muted">Todavía no hay pagos registrados.</p>
            : (
              <table className="table">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Bs</th><th>Medio</th><th>Estado</th></tr></thead>
                <tbody>
                  {pagos.map((p) => (
                    <tr key={p.id}>
                      <td>{p.creadoEn?.toMillis ? fechaCorta(p.creadoEn.toMillis()) : '—'}</td>
                      <td><TextoSeguro valor={p.descripcion} maxLargo={80} /></td>
                      <td>{typeof p.monto === 'number' ? p.monto : '—'}</td>
                      <td><TextoSeguro valor={p.medio} maxLargo={12} /></td>
                      <td><TextoSeguro valor={p.estado} maxLargo={20} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </>
      )}

      <h3>Corte de este comercio</h3>
      <CortePrepago plataforma={cuenta} alcance="comercio" ocupado={ocupado}
        onFijar={(corteActivo, motivo) => void operar(CALLABLES.corte, { corteActivo, motivo },
          corteActivo ? 'Corte encendido para este comercio.' : 'Corte apagado para este comercio.')} />
    </section>
  );
}
