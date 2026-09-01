import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection, doc, getCountFromServer, getDoc, onSnapshot, orderBy, query,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSesion } from '../lib/contexto';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { SinSalida } from '../componentes/SinSalida';

/**
 * TABLERO DE INICIO, DISTINTO SEGÚN QUIÉN ENTRA.
 *
 * Antes, «/» era solo un desvío: el superadministrador rebotaba al listado de
 * negocios y el comercio, directo a conversaciones. Funcionaba, pero la primera
 * pantalla no decía nada — y la primera pantalla es la que decide si alguien
 * siente que el sistema está bajo control o que se lo tiene que adivinar.
 *
 * LO QUE CADA ROL PUEDE VER NO ES UNA DECISIÓN DE ESTA PANTALLA. Está en
 * `firestore.rules` y es más estricto de lo que uno esperaría:
 *
 *   - NovuChat (superadministrador) lee la cartera de negocios, sus miembros y
 *     sus métricas, pero NO la configuración del negocio ni sus conversaciones.
 *     `esMiembro()` no incluye al propietario, a propósito. Por eso este tablero
 *     no le muestra servicios ni catálogo: no es que se los esconda, es que
 *     pedirlos daría error de permiso. Y es una propiedad para contarle al
 *     cliente, no una limitación que disimular.
 *   - El comercio ve lo suyo y nada del resto.
 *
 * Pedir algo que la regla niega es el defecto que este proyecto ya cometió con
 * el menú: ofrecer puertas cerradas hace que el sistema parezca roto y entrena
 * a la gente a ignorar los mensajes de permiso.
 */

/** Tarjeta. Un `<article>` con título y cuerpo; el estilo lo pone la hoja. */
function Tarjeta({ titulo, children, pie }: {
  titulo: string; children: React.ReactNode; pie?: React.ReactNode;
}) {
  return (
    <article className="tarjeta">
      <h3>{titulo}</h3>
      <div className="tarjeta-cuerpo">{children}</div>
      {pie && <div className="tarjeta-pie">{pie}</div>}
    </article>
  );
}

/** Número grande con su rótulo. El rótulo va debajo: el dato manda. */
function Dato({ valor, rotulo }: { valor: React.ReactNode; rotulo: string }) {
  return (
    <div className="dato">
      <strong>{valor}</strong>
      <span>{rotulo}</span>
    </div>
  );
}

const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const;

/** Horario de HOY, que es el único que alguien mira al abrir el panel. */
function horarioDeHoy(horarios: unknown): string {
  if (typeof horarios !== 'object' || horarios === null) return '';
  const clave = DIAS[new Date().getDay()] as string;
  const valor = (horarios as Record<string, unknown>)[clave];
  return typeof valor === 'string' ? valor : '';
}

// -----------------------------------------------------------------------------
// NovuChat
// -----------------------------------------------------------------------------
interface Negocio { id: string; nombre?: unknown; estado?: unknown; vertical?: unknown; plan?: unknown }

function TableroNovuChat() {
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'tenants'), orderBy('nombre')),
    (instantanea) => setNegocios(instantanea.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError('No se pudo leer la cartera de negocios.'),
  ), []);

  if (error) return <p role="alert">{error}</p>;
  if (negocios === null) return <p>Cargando…</p>;

  const activos = negocios.filter((n) => n.estado === 'activo').length;
  const suspendidos = negocios.length - activos;

  return (
    <>
      <div className="cuadricula">
        <Tarjeta titulo="Cartera">
          <div className="datos">
            <Dato valor={negocios.length} rotulo="negocios" />
            <Dato valor={activos} rotulo="activos" />
            <Dato valor={suspendidos} rotulo="suspendidos" />
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Lo que NovuChat no ve"
          pie={<span className="ayuda">Es una garantía del producto, no una falta de la pantalla.</span>}
        >
          <p>
            Desde esta cuenta se administra la cartera, pero <strong>no</strong> se
            leen las conversaciones de los clientes de cada negocio ni su
            configuración. Lo impiden las reglas de la base de datos, no el menú.
          </p>
        </Tarjeta>
      </div>

      <h3>Negocios</h3>
      {negocios.length === 0 ? (
        <p className="vacio">
          Todavía no hay ningún negocio dado de alta. El alta se hace desde
          «Negocios» y crea su configuración inicial.
        </p>
      ) : (
        <div className="cuadricula">
          {negocios.map((n) => (
            <Tarjeta
              key={n.id}
              titulo=""
              pie={<Link to={`/negocio/${encodeURIComponent(n.id)}/configuracion`}>Abrir</Link>}
            >
              <p className="titulo-negocio"><TextoSeguro valor={n.nombre} maxLargo={80} /></p>
              <p>
                <span className={`etiqueta ${n.estado === 'activo' ? 'ok' : 'alerta'}`}>
                  <TextoSeguro valor={n.estado} maxLargo={20} />
                </span>{' '}
                <span className="etiqueta">
                  <TextoSeguro valor={n.vertical} maxLargo={20} />
                </span>
              </p>
            </Tarjeta>
          ))}
        </div>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Comercio
// -----------------------------------------------------------------------------
interface ResumenNegocio {
  nombre: unknown; descripcion: unknown; horarioHoy: string;
  items: number; agendas: number; estadoPago: unknown; motivoPago: unknown;
}

function TableroComercio({ tenantId, esAdmin }: { tenantId: string; esAdmin: boolean }) {
  const [datos, setDatos] = useState<ResumenNegocio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // `getCountFromServer` en vez de traer los documentos: para contar el
        // catálogo no hace falta descargarlo, y en un comercio con cientos de
        // ítems la diferencia se nota en un celular con datos móviles.
        const [negocio, items, agendas, cuenta] = await Promise.all([
          getDoc(doc(db, `tenants/${tenantId}/config/negocio`)),
          getCountFromServer(collection(db, `tenants/${tenantId}/catalogo`)),
          getCountFromServer(collection(db, `tenants/${tenantId}/funcionarios`)),
          esAdmin ? getDoc(doc(db, `tenants/${tenantId}/cuenta/estado`)) : Promise.resolve(null),
        ]);
        if (!vivo) return;
        setDatos({
          nombre: negocio.get('nombreNegocio'),
          descripcion: negocio.get('descripcion'),
          horarioHoy: horarioDeHoy(negocio.get('horarios')),
          items: items.data().count,
          agendas: agendas.data().count,
          estadoPago: cuenta?.get('estadoPago'),
          motivoPago: cuenta?.get('motivoVisible'),
        });
      } catch {
        if (vivo) setError('No se pudo leer el resumen del negocio.');
      }
    })();
    return () => { vivo = false; };
  }, [tenantId, esAdmin]);

  if (error) return <p role="alert">{error}</p>;
  if (!datos) return <p>Cargando…</p>;

  const cerrado = datos.horarioHoy === '' || datos.horarioHoy === 'cerrado';

  return (
    <div className="cuadricula">
      <Tarjeta
        titulo="Hoy"
        pie={<Link to={`/negocio/${encodeURIComponent(tenantId)}/conversaciones`}>Ver conversaciones</Link>}
      >
        <p className="titulo-negocio"><TextoSeguro valor={datos.nombre} maxLargo={80} /></p>
        <p className={`situacion ${cerrado ? 'alerta' : 'ok'}`}>
          {cerrado ? 'Hoy cerrado' : `Hoy abierto ${datos.horarioHoy}`}
        </p>
        <p className="ayuda">
          Fuera de horario el asistente sigue respondiendo y avisa cuándo abren.
        </p>
      </Tarjeta>

      <Tarjeta
        titulo="Lo que el asistente sabe ofrecer"
        pie={esAdmin
          ? <Link to={`/negocio/${encodeURIComponent(tenantId)}/configuracion`}>Configurar</Link>
          : undefined}
      >
        <div className="datos">
          <Dato valor={datos.items} rotulo={datos.items === 1 ? 'servicio' : 'servicios'} />
          {datos.agendas > 0 && <Dato valor={datos.agendas} rotulo="agendas" />}
        </div>
        {datos.items === 0 && (
          <p className="vacio">
            Sin servicios cargados, el asistente puede conversar pero no ofrecer
            nada concreto ni agendar. Es lo primero que conviene completar.
          </p>
        )}
      </Tarjeta>

      {esAdmin && (
        <Tarjeta
          titulo="Cuenta"
          pie={<Link to={`/negocio/${encodeURIComponent(tenantId)}/cuenta`}>Ver detalle</Link>}
        >
          <p className={`situacion ${datos.estadoPago === 'vencido' ? 'alerta' : 'ok'}`}>
            <TextoSeguro valor={datos.estadoPago ?? 'sin datos'} maxLargo={30} />
          </p>
          {typeof datos.motivoPago === 'string' && datos.motivoPago !== '' && (
            <p className="ayuda"><TextoSeguro valor={datos.motivoPago} maxLargo={300} /></p>
          )}
        </Tarjeta>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
export function Tablero() {
  const { permisos, cargando } = useSesion();
  if (cargando) return <p>Cargando…</p>;

  if (permisos.propietario) {
    return (
      <section>
        <h2>Panel de NovuChat</h2>
        <TableroNovuChat />
      </section>
    );
  }

  const ids = Object.keys(permisos.tenants);
  if (ids.length === 0) {
    return (
      <SinSalida titulo="Su cuenta todavía no está asociada a ningún negocio">
        <p>
          Es normal si recién la crearon: alguien de NovuChat tiene que vincularla
          a su negocio. Si ya se la vincularon, salga y vuelva a entrar para que
          se actualicen sus permisos.
        </p>
      </SinSalida>
    );
  }

  // Con varios negocios, uno debajo del otro: son pocos (un dueño de PyME
  // administra uno, a lo sumo tres locales) y verlos juntos evita el paso extra
  // de elegir antes de saber cuál necesita atención.
  return (
    <section>
      <h2>{ids.length === 1 ? 'Su negocio' : 'Sus negocios'}</h2>
      {ids.map((id) => (
        <TableroComercio key={id} tenantId={id} esAdmin={permisos.tenants[id] === 'admin'} />
      ))}
    </section>
  );
}
