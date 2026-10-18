import { useMemo, useState } from 'react';
import { Confirmacion } from './Confirmacion';
import { TextoSeguro } from '../../central/componentes/TextoSeguro';
import {
  BOLSAS_POSIBLES, MESES_POSIBLES, PRECIOS, avisoPrecioPorContrato, bolsaDe, bolsasOfrecidas, mesEscrito, planDeLaCuenta,
  planesOfrecidos, planInicial, tipoTrasCambioDeBolsas, type PlanEnVenta, type TipoBolsa,
} from '../../central/lib/pagar';
import { tipoCambioVigente, type Pago } from '../../central/lib/prepago';
import {
  ACEPTA_COMPROBANTE, MEDIOS_MANUALES, diaBolivia, vistaDelPagoManual, type MedioManual,
} from '../lib/negocios';

/** Lo que la página manda a `registrarPagoManual`, más el comprobante a subir antes. */
export interface PedidoDePagoManual {
  pedido: Pago;
  medio: MedioManual;
  referencia: string;
  tcoAplicado: number;
  tcoFuente: string;
  tcoFecha: string;
  montoRecibidoBs: number;
  motivoDiferencia: string;
  comprobante: File | null;
}

// Lo que el operador puede elegir: la mensualidad, la instalación y la bolsa que corresponde a la TARIFA de la
// cuenta (`bolsasOfrecidas`, que pregunta a `bolsaPermitida`, la misma regla con que el servidor rechaza).
export type Tipo = 'mensualidad' | 'instalacion' | TipoBolsa;

/**
 * CARGAR UN PAGO A MANO, CON COMPROBANTE (lo que A-3b prometía; `DISENO.md`
 * §4undecies.1 y §4undecies.7). Efectivo o transferencia: la transferencia
 * exige el comprobante, que la página sube a Storage bajo el `pagoId` antes
 * de llamar al servidor, y el servidor comprueba que existe y de qué tipo es.
 *
 * TRES COSAS QUE ESTE FORMULARIO NO HACE:
 *  1. NO CALCULA EL IMPORTE POR SU CUENTA: `vistaDelPagoManual` usa `importeBs`
 *     y `aplicarPago` del módulo del servidor. Lo que se ve antes de confirmar
 *     es lo que el servidor va a comparar con lo recibido.
 *  2. NO DICE «PAGO ACREDITADO»: registra lo que el propietario declara haber
 *     recibido, con su referencia; quien lo mira después ve el comprobante.
 *  3. NO ESCRIBE EN FIRESTORE: es una callable, con `pagoId` de idempotencia.
 *
 * El TCO viene precargado con el vigente del BCB (`plataforma/tipoCambio`) y
 * se puede cambiar: si difiere del vigente, el servidor exige
 * `motivoDiferencia`, y acá se avisa antes.
 */
export function FormularioPagoManual({ cuenta, tipoCambio, ahoraMs, ocupado, onRegistrar, tipoInicial = 'mensualidad' }: {
  cuenta: Record<string, unknown> | null | undefined;
  tipoCambio: unknown;
  ahoraMs: number;
  ocupado: boolean;
  onRegistrar: (pedido: PedidoDePagoManual) => void;
  /** Qué radio nace marcado. Solo lo usan las pruebas para dibujar el desplegable de una bolsa. */
  tipoInicial?: Tipo;
}) {
  const vigente = tipoCambioVigente(tipoCambio, ahoraMs);
  const [tipoElegido, setTipo] = useState<Tipo>(tipoInicial);
  const [plan, setPlan] = useState<PlanEnVenta>(planInicial(cuenta));
  const [meses, setMeses] = useState(1);
  const [cantidad, setCantidad] = useState(1);
  const [medio, setMedio] = useState<MedioManual>('transferencia');
  const [referencia, setReferencia] = useState('');
  const [tco, setTco] = useState(vigente ? String(vigente.tco) : '');
  const [tcoFuente, setTcoFuente] = useState(vigente?.fuente ?? 'BCB');
  const [tcoFecha, setTcoFecha] = useState(vigente?.fecha ?? diaBolivia(ahoraMs));
  const [recibido, setRecibido] = useState('');
  const [motivoDiferencia, setMotivoDiferencia] = useState('');
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [pendiente, setPendiente] = useState(false);

  const planes = useMemo(() => planesOfrecidos(cuenta), [cuenta]);
  // Las bolsas de ESTA cuenta, según su tarifa: estandar ve 300 por USD 15; meta_incluido o sin campo, 30 por USD 10.
  // Sin titularidades (la consola no las lee): la de seguimiento no sale mientras `VENTA_BOLSA_SALIENTES` sea `false`,
  // y encendida tampoco hasta que el bloque 2 traiga la consulta de titularidades.
  const bolsas = useMemo(() => bolsasOfrecidas(cuenta), [cuenta]);
  const tipo: Tipo = tipoTrasCambioDeBolsas(tipoElegido, bolsas);
  const pedido: Pago = tipo === 'instalacion' ? { tipo }
    : tipo === 'mensualidad' ? { tipo, plan, meses }
    : { tipo, cantidad };
  const tcoNumero = Number(tco);
  const vista = vistaDelPagoManual(cuenta, pedido, tcoNumero, ahoraMs);
  const montoRecibidoBs = recibido.trim() === '' ? (vista?.montoBs ?? null) : Number(recibido);
  const recibidoValido = montoRecibidoBs !== null && Number.isInteger(montoRecibidoBs) && montoRecibidoBs >= 0;
  const difiereDelImporte = vista !== null && recibidoValido && montoRecibidoBs !== vista.montoBs;
  const difiereDelVigente = vigente !== null && Number.isFinite(tcoNumero) && Math.abs(tcoNumero - vigente.tco) > 0.01;
  const exigeMotivo = difiereDelImporte || difiereDelVigente;
  const listo = vista !== null && recibidoValido && referencia.trim() !== '' && tcoFuente.trim() !== ''
    && /^\d{4}-\d{2}-\d{2}$/.test(tcoFecha) && (!exigeMotivo || motivoDiferencia.trim() !== '')
    && (medio === 'efectivo' || comprobante !== null);

  const confirmar = () => {
    if (!listo || montoRecibidoBs === null) return;
    onRegistrar({
      pedido, medio, referencia: referencia.trim(), tcoAplicado: tcoNumero, tcoFuente: tcoFuente.trim(), tcoFecha,
      montoRecibidoBs, motivoDiferencia: motivoDiferencia.trim(), comprobante: medio === 'transferencia' ? comprobante : null,
    });
    setPendiente(false);
  };

  return (
    <section>
      <h3>Cargar un pago a mano</h3>
      <p className="ayuda">
        Para lo que el comercio pagó fuera del QR: efectivo o transferencia. Un pago
        registrado no se corrige: se compensa con otro asiento.
      </p>
      <fieldset>
        <legend>Qué pagó</legend>
        {([
          { t: 'mensualidad' as Tipo, texto: 'Mensualidad' },
          ...bolsas.map((b) => ({ t: b.tipo as Tipo, texto: b.etiqueta })),
          { t: 'instalacion' as Tipo, texto: 'Instalación' },
        ]).map(({ t, texto }) => (
          <label key={t}>
            <input type="radio" name="pago-tipo" checked={tipo === t} disabled={ocupado || pendiente}
              onChange={() => setTipo(t)} />{' '}
            {texto}
          </label>
        ))}
      </fieldset>
      {tipo === 'mensualidad' && (
        <>
          <label htmlFor="pago-plan">Plan</label>
          <select id="pago-plan" value={plan} disabled={ocupado || pendiente} onChange={(e) => setPlan(e.target.value as PlanEnVenta)}>
            {/* Lo que ESTA cuenta paga y recibe con cada plan (F1b): con un
                contrato, su precio y sus conversaciones, que un cambio de plan conserva. */}
            {planes.map((p) => {
              const suyo = planDeLaCuenta(cuenta, p);
              return (
                <option key={p} value={p}>
                  {suyo.nombre} · USD {suyo.precioUsd}{suyo.precioPorContrato ? ' por contrato' : ''} · {suyo.conversaciones} conversaciones
                </option>
              );
            })}
          </select>
          {/* Otro plan sobre una cuenta con contrato: se cobra el contrato (revisión del #221). */}
          {avisoPrecioPorContrato(cuenta, plan) && <p className="ayuda" role="note">{avisoPrecioPorContrato(cuenta, plan)}</p>}
          <label htmlFor="pago-meses">Meses</label>
          <select id="pago-meses" value={meses} disabled={ocupado || pendiente} onChange={(e) => setMeses(Number(e.target.value))}>
            {MESES_POSIBLES.map((m) => <option key={m} value={m}>{m === 1 ? '1 mes' : `${m} meses`}</option>)}
          </select>
        </>
      )}
      {tipo !== 'mensualidad' && tipo !== 'instalacion' && (
        <>
          <label htmlFor="pago-cantidad">Cuántas bolsas</label>
          <select id="pago-cantidad" value={cantidad} disabled={ocupado || pendiente} onChange={(e) => setCantidad(Number(e.target.value))}>
            {BOLSAS_POSIBLES.map((c) => (
              <option key={c} value={c}>
                {c === 1 ? '1 bolsa' : `${c} bolsas`} · {c * bolsaDe(tipo).unidades} {bolsaDe(tipo).unidad} · USD {c * bolsaDe(tipo).precioUsd}
              </option>
            ))}
          </select>
        </>
      )}
      {tipo === 'instalacion' && <p className="ayuda">Instalación llave en mano: USD {PRECIOS.instalacionUsd}, una sola vez.</p>}

      <fieldset>
        <legend>Cómo pagó</legend>
        {MEDIOS_MANUALES.map((m) => (
          <label key={m}>
            <input type="radio" name="pago-medio" checked={medio === m} disabled={ocupado || pendiente} onChange={() => setMedio(m)} />{' '}
            {m === 'efectivo' ? 'Efectivo' : 'Transferencia'}
          </label>
        ))}
      </fieldset>
      <label htmlFor="pago-referencia">Referencia</label>
      <input id="pago-referencia" type="text" maxLength={120} value={referencia} disabled={ocupado || pendiente}
        onChange={(e) => setReferencia(e.target.value)}
        placeholder={medio === 'efectivo' ? 'recibido por <nombre>' : 'número de operación del banco'} />
      {medio === 'transferencia' && (
        <>
          <label htmlFor="pago-comprobante">Comprobante (PDF, JPG o PNG)</label>
          <input id="pago-comprobante" type="file" accept={ACEPTA_COMPROBANTE} disabled={ocupado || pendiente}
            onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} />
          <p className="ayuda">
            Se guarda junto al pago y no se reemplaza después de registrarlo. Que el
            comprobante llegó no es que la plata entró: eso lo confirma el banco.
          </p>
        </>
      )}

      <label htmlFor="pago-tco">Tipo de cambio aplicado</label>
      <input id="pago-tco" type="number" step="0.01" min={5} max={40} value={tco} disabled={ocupado || pendiente}
        onChange={(e) => setTco(e.target.value)} style={{ width: '8em' }} />
      {' '}
      <label htmlFor="pago-tco-fuente">Fuente</label>
      <input id="pago-tco-fuente" type="text" maxLength={60} value={tcoFuente} disabled={ocupado || pendiente}
        onChange={(e) => setTcoFuente(e.target.value)} style={{ width: '8em' }} />
      {' '}
      <label htmlFor="pago-tco-fecha">Del día</label>
      <input id="pago-tco-fecha" type="date" value={tcoFecha} disabled={ocupado || pendiente}
        onChange={(e) => setTcoFecha(e.target.value)} />
      {vigente
        ? <p className="ayuda">Vigente del BCB: {vigente.tco} del {vigente.fecha}{difiereDelVigente && ' · el declarado difiere: hay que decir por qué.'}</p>
        : <p className="ayuda">No hay tipo de cambio del día cargado: se registra con el que se declare acá.</p>}

      {vista && (
        <table>
          <tbody>
            <tr><th>Concepto</th><td>{vista.descripcion}</td></tr>
            <tr><th>Precio de lista</th><td>USD {vista.montoUsd}</td></tr>
            <tr><th>Importe al tipo de cambio declarado</th><td><strong>Bs {vista.montoBs}</strong></td></tr>
            {vista.cubiertoHasta && <tr><th>Quedaría cubierto hasta</th><td>{mesEscrito(vista.cubiertoHasta)}</td></tr>}
            <tr><th>Bolsa después del pago</th><td>{vista.bolsa} conversaciones{vista.conRegalo && <span className="tag"> incluye la bolsa de regalo</span>}</td></tr>
          </tbody>
        </table>
      )}

      <label htmlFor="pago-recibido">Recibido, en bolivianos (entero)</label>
      <input id="pago-recibido" type="number" step="1" min={0} value={recibido} disabled={ocupado || pendiente}
        onChange={(e) => setRecibido(e.target.value)} placeholder={vista ? String(vista.montoBs) : ''} style={{ width: '8em' }} />
      {difiereDelImporte && <p className="ayuda">Lo recibido no es el importe de la cuenta: hay que decir por qué.</p>}
      {exigeMotivo && (
        <>
          <label htmlFor="pago-motivo">Motivo de la diferencia</label>
          <input id="pago-motivo" type="text" maxLength={300} value={motivoDiferencia} disabled={ocupado || pendiente}
            onChange={(e) => setMotivoDiferencia(e.target.value)} />
        </>
      )}

      {pendiente && vista && montoRecibidoBs !== null
        ? <Confirmacion ocupado={ocupado}
            resumen={`Registrar ${vista.descripcion}: Bs ${montoRecibidoBs} recibidos por ${medio} (lista Bs ${vista.montoBs} al ${tcoNumero})`}
            advertencia={comprobante ? `Se sube «${comprobante.name}» antes de registrar.` : undefined}
            onConfirmar={confirmar} onCancelar={() => setPendiente(false)} />
        : <button type="button" className="btn btn-primary" disabled={ocupado || !listo} onClick={() => setPendiente(true)}>
            Registrar el pago
          </button>}
      {comprobante && !pendiente && <p className="text-muted">Comprobante elegido: <TextoSeguro valor={comprobante.name} maxLargo={80} /></p>}
    </section>
  );
}
