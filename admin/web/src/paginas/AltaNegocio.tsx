import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import { funciones } from '../lib/firebase';
import { PLANES, PRUEBA, type Modalidad, type PlanId } from '../lib/prepago';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * ALTA DE UN NEGOCIO, desde la consola y con todos sus datos.
 *
 * Hasta el 2026-09-07 el alta solo existía como script, porque `altaTenant`
 * exigía que el administrador ya hubiera ingresado una vez y nadie podía
 * crearse la cuenta. Ahora la Function crea la cuenta con una clave aleatoria
 * que nadie ve y devuelve el enlace para que la persona ponga la suya. Ese
 * enlace se muestra UNA vez, acá, y no se guarda en ningún lado: hay que
 * copiarlo y mandárselo al administrador por un canal que ya tenga.
 *
 * LO QUE NO HACE, a propósito: asignar el número de WhatsApp ni cargar el
 * secreto de su alias. Son trámites con Meta y con Secret Manager que se hacen
 * después, y la pantalla lo dice al terminar.
 */
interface Resultado {
  tenantId: string;
  cuentaCreada: boolean;
  enlaceContrasena: string | null;
  cuenta: { modalidad: string; plan: string; operativo: boolean; disponibles: number | null };
}

const idDesdeNombre = (nombre: string) => nombre.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function AltaNegocio() {
  const [nombre, setNombre] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [idTocado, setIdTocado] = useState(false);
  const [flujos, setFlujos] = useState<string[]>(['agendamiento']);
  const [correoAdmin, setCorreoAdmin] = useState('');
  const [nombreAdmin, setNombreAdmin] = useState('');
  const [razonSocial, setRazonSocial] = useState('');
  const [nit, setNit] = useState('');
  const [duenoNombre, setDuenoNombre] = useState('');
  const [duenoTelefono, setDuenoTelefono] = useState('');
  const [duenoCorreo, setDuenoCorreo] = useState('');
  const [telefonosCobro, setTelefonosCobro] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad>('prueba');
  const [plan, setPlan] = useState<PlanId>('base');
  const [primerMesPagado, setPrimerMesPagado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const cambiarNombre = (v: string) => {
    setNombre(v);
    if (!idTocado) setTenantId(idDesdeNombre(v));
  };
  const alternarFlujo = (f: string) =>
    setFlujos((lista) => (lista.includes(f) ? lista.filter((x) => x !== f) : [...lista, f]));

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (flujos.length === 0) { setError('Elige al menos un flujo.'); return; }
    setOcupado(true);
    try {
      const alta = httpsCallable<unknown, Resultado>(funciones, 'altaTenant');
      const { data } = await alta({
        tenantId, nombre, flujos, correoAdmin, nombreAdmin,
        razonSocial, nit,
        dueno: { nombre: duenoNombre, telefono: duenoTelefono, correo: duenoCorreo },
        telefonosCobro: telefonosCobro.split(/[,\s]+/).filter(Boolean),
        modalidad, plan, primerMesPagado: modalidad === 'prepago' && primerMesPagado,
      });
      setResultado(data);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : '';
      setError(`No se pudo dar de alta el negocio. ${mensaje}`.trim());
    } finally {
      setOcupado(false);
    }
  };

  if (resultado) {
    return (
      <section>
        <h2>Negocio dado de alta</h2>
        <article className="card elev-sm">
          <h3 className="card-kicker">Listo</h3>
          <div className="card-body">
            <p className="card-title"><TextoSeguro valor={nombre} maxLargo={80} /></p>
            <p>
              Identificador <code><TextoSeguro valor={resultado.tenantId} maxLargo={60} /></code>.
              Modalidad <strong>{resultado.cuenta.modalidad}</strong>, plan <strong>{resultado.cuenta.plan}</strong>,
              servicio {resultado.cuenta.operativo ? 'operativo' : 'detenido hasta que se registre el pago'}.
            </p>
          </div>
        </article>

        {resultado.enlaceContrasena ? (
          <article className="card elev-sm">
            <h3 className="card-kicker">Enlace para que el administrador ponga su contraseña</h3>
            <div className="card-body">
              <p>
                Se creó la cuenta de <strong><TextoSeguro valor={correoAdmin} maxLargo={254} /></strong> con
                una clave que nadie conoce. Copia este enlace y mándaselo por un canal que ya tengas con la
                persona. <strong>No se guarda en ningún lado y vence en unas horas.</strong> Al completarlo,
                el correo queda verificado, que es lo que exige el panel para entrar.
              </p>
              <textarea readOnly rows={4} value={resultado.enlaceContrasena} style={{ width: '100%' }}
                        onFocus={(e) => e.currentTarget.select()} />
            </div>
          </article>
        ) : (
          <p className="ayuda">
            La cuenta de <TextoSeguro valor={correoAdmin} maxLargo={254} /> ya existía: se le dio el rol
            de administrador sin tocar su contraseña.
          </p>
        )}

        <article className="card elev-sm">
          <h3 className="card-kicker">Lo que sigue, y no hace esta pantalla</h3>
          <div className="card-body">
            <ol>
              <li>Tomar el secreto del alias libre que sigue (<code>cliente01</code>…) y cargarlo como
                credencial de cabecera en n8n.</li>
              <li>Asignar el número de WhatsApp con <code>asignarNumero</code>, con ese alias en la ruta.</li>
              <li>Que el administrador cargue el catálogo y la configuración desde su consola.</li>
              <li>Si el negocio va a pagar por WhatsApp, verificar que el teléfono de cobro esté cargado en
                la <Link to={`/negocios/${encodeURIComponent(resultado.tenantId)}/cuenta`}>cuenta</Link>.</li>
            </ol>
          </div>
        </article>
      </section>
    );
  }

  return (
    <section>
      <h2>Dar de alta un negocio</h2>
      <form onSubmit={enviar}>
        <h3>El negocio</h3>
        <label>Nombre comercial
          <input required maxLength={80} value={nombre} onChange={(e) => cambiarNombre(e.target.value)} />
        </label>
        <label>Identificador (minúsculas y guiones; no se puede cambiar ni reutilizar)
          <input required pattern="[a-z0-9][a-z0-9-]{2,59}" value={tenantId}
                 onChange={(e) => { setIdTocado(true); setTenantId(e.target.value); }} />
        </label>
        <label>Razón social
          <input maxLength={160} value={razonSocial} onChange={(e) => setRazonSocial(e.target.value)} />
        </label>
        <label>NIT
          <input maxLength={20} pattern="[0-9]{5,15}" value={nit} onChange={(e) => setNit(e.target.value)} />
        </label>
        <fieldset>
          <legend>Flujos</legend>
          <label className="campo-casilla">
            <input type="checkbox" checked={flujos.includes('agendamiento')} onChange={() => alternarFlujo('agendamiento')} />
            Reservas y citas
          </label>
          <label className="campo-casilla">
            <input type="checkbox" checked={flujos.includes('venta')} onChange={() => alternarFlujo('venta')} />
            Pedidos y cobro
          </label>
        </fieldset>

        <h3>El dueño</h3>
        <label>Nombre
          <input maxLength={120} value={duenoNombre} onChange={(e) => setDuenoNombre(e.target.value)} />
        </label>
        <label>Teléfono (con 591, sin +)
          <input maxLength={15} pattern="[0-9]{8,15}" value={duenoTelefono}
                 onChange={(e) => setDuenoTelefono(e.target.value)} />
        </label>
        <label>Correo
          <input type="email" maxLength={254} value={duenoCorreo} onChange={(e) => setDuenoCorreo(e.target.value)} />
        </label>

        <h3>El administrador de la consola</h3>
        <label>Correo (con este entra al panel)
          <input type="email" required maxLength={254} value={correoAdmin}
                 onChange={(e) => setCorreoAdmin(e.target.value)} />
        </label>
        <label>Nombre
          <input maxLength={120} value={nombreAdmin} onChange={(e) => setNombreAdmin(e.target.value)} />
        </label>

        <h3>Cobro por WhatsApp</h3>
        <label>Teléfonos de cobro (desde estos números el negocio paga y recibe los recordatorios; separados por coma)
          <input maxLength={100} value={telefonosCobro} onChange={(e) => setTelefonosCobro(e.target.value)}
                 placeholder="591XXXXXXXX, 591YYYYYYYY" />
        </label>

        <h3>Plan y modalidad</h3>
        <label>Modalidad
          <select value={modalidad} onChange={(e) => setModalidad(e.target.value as Modalidad)}>
            <option value="prueba">Mes calendario de prueba: sin mensualidad, {PRUEBA.conversaciones} conversaciones</option>
            <option value="prepago">Prepago: paga el mes por adelantado</option>
            <option value="demostracion">Demostración interna: sin cobro ni corte</option>
          </select>
        </label>
        <label>Plan {modalidad === 'prueba' ? '(el que se le propondrá al terminar la prueba)' : ''}
          <select value={plan} onChange={(e) => setPlan(e.target.value as PlanId)}>
            {(Object.keys(PLANES) as PlanId[]).map((id) => (
              <option key={id} value={id}>
                {PLANES[id].nombre}: USD {PLANES[id].precioUsd} / mes, {PLANES[id].conversaciones} conversaciones
              </option>
            ))}
          </select>
        </label>
        {modalidad === 'prepago' && (
          <label className="campo-casilla">
            <input type="checkbox" checked={primerMesPagado} onChange={(e) => setPrimerMesPagado(e.target.checked)} />
            El mes en curso ya está pagado (si no se marca, el servicio queda detenido hasta registrar el pago)
          </label>
        )}

        {error && <p role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          {ocupado ? 'Creando…' : 'Dar de alta'}
        </button>
      </form>
    </section>
  );
}
