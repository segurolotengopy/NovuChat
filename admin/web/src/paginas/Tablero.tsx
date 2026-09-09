import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Timestamp, collection, doc, getCountFromServer, getDoc, limit, onSnapshot,
  orderBy, query, where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useSesion } from '../lib/contexto';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { SinSalida } from '../componentes/SinSalida';
import { FLUJOS, etiquetaCatalogo, flujosDe, useFlujos } from '../lib/flujos';
import { etiquetaDePago, pagoAlDia } from '../lib/cuenta';
import { GraficoDias, type DiaDeGrafico } from '../componentes/GraficoDias';

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
    <article className="card elev-sm">
      <h3 className="card-kicker">{titulo}</h3>
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
interface Negocio { id: string; nombre?: unknown; estado?: unknown; vertical?: unknown; flujos?: unknown; plan?: unknown }

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

        {/* ACÁ HABÍA UNA TARJETA, «Lo que NovuChat no ve», que prometía que desde
            esta cuenta no se leen las conversaciones de los clientes. Se quitó
            el 2026-09-08 y el motivo importa más que el texto.

            Era cierta PARA ESTA CUENTA —las reglas de la base la limitan— y
            falsa como promesa, porque la promesa que el cliente entiende es
            «NovuChat no lee mis conversaciones», sin la letra chica. Y lo
            primero que pide un comercio cuando algo no le anda es «entren con
            mi usuario y fíjense»: en ese momento vemos todo, con su permiso, y
            la pantalla queda desmentida por nuestro propio soporte.

            Una garantía escrita en un cartel que la operación normal contradice
            es peor que no escribir nada: enseña a no creerle a los carteles.
            Lo que sí se sostiene está en el producto y no en un texto: el
            acceso de soporte lo otorga el comercio y queda en la bitácora. */}
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
              pie={<Link to={`/negocio/${encodeURIComponent(n.id)}/consumo`}>Ver consumo</Link>}
            >
              <p className="card-title"><TextoSeguro valor={n.nombre} maxLargo={80} /></p>
              <p>
                <span className={`tag ${n.estado === 'activo' ? 'tag-accent' : 'tag-neutral'}`}>
                  <TextoSeguro valor={n.estado} maxLargo={20} />
                </span>{' '}
                {flujosDe(n).map((f) => (
                  <span key={f} className="tag tag-outline">{FLUJOS[f].nombre}</span>
                ))}
              </p>
            </Tarjeta>
          ))}
        </div>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// ACTIVIDAD POR PERÍODO
// -----------------------------------------------------------------------------

/**
 * DE DÓNDE SALEN LOS NÚMEROS DE ESTE HOOK, y por qué no de `metricas`.
 *
 * Ojo con la división, que es la que se equivocó una vez: los contadores de
 * `metricas/{aaaa-mm}` son MENSUALES y son LA FUENTE de lo que se factura —las
 * conversaciones—, así que la tarjeta que muestra esa cifra los lee tal cual y
 * no pasa por acá. Este hook responde otra pregunta, «¿cómo viene hoy?», y para
 * eso los contadores mensuales no sirven. La bitácora sí tiene una marca de
 * tiempo por evento, está indexada por `ts` y ya vive bajo el comercio, así
 * que un rango de fechas es una consulta y no una migración.
 *
 * EL TOPE DE 1.500 EVENTOS NO ES UN ADORNO. Sin él, un comercio con mucho
 * movimiento se descarga miles de documentos en el celular cada vez que abre
 * el inicio. Con tope, el mes de un comercio muy activo puede quedar
 * incompleto — y entonces la pantalla lo DICE, en vez de mostrar un gráfico
 * que parece completo y no lo es.
 */
const TOPE_EVENTOS = 1500;

export type Periodo = 'hoy' | 'semana' | 'mes';

const DIAS_DE: Record<Periodo, number> = { hoy: 1, semana: 7, mes: 30 };

/** Medianoche boliviana de hace `dias-1` días. UTC−4 fijo, como todo el proyecto. */
function desdeHace(dias: number): Date {
  const ahora = new Date();
  const boliviano = new Date(ahora.getTime() - 4 * 3_600_000);
  boliviano.setUTCHours(0, 0, 0, 0);
  return new Date(boliviano.getTime() - (dias - 1) * 86_400_000 + 4 * 3_600_000);
}

/** `aaaa-mm-dd` del día boliviano al que pertenece una fecha. */
function diaBoliviano(f: Date): string {
  return new Date(f.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
}

interface Actividad {
  dias: DiaDeGrafico[];
  entrantes: number;
  salientes: number;
  personas: number;
  /** Veces que el asistente pasó el chat a una persona. NO es una falla. */
  derivaciones: number;
  incompleto: boolean;
}

function useActividad(tenantId: string, periodo: Periodo, activo: boolean): Actividad | null {
  const [datos, setDatos] = useState<Actividad | null>(null);
  useEffect(() => {
    if (!tenantId || !activo) { setDatos(null); return; }
    const desde = desdeHace(DIAS_DE[periodo]);
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'bitacora'),
        where('ts', '>=', Timestamp.fromDate(desde)),
        orderBy('ts', 'asc'), limit(TOPE_EVENTOS)),
      (s) => {
        const porDia = new Map<string, { entrantes: number; salientes: number }>();
        // Los días sin actividad TIENEN que aparecer, con cero. Un gráfico que
        // omite los días vacíos comprime el tiempo y hace parecer constante
        // algo que tuvo un fin de semana muerto en el medio.
        for (let i = 0; i < DIAS_DE[periodo]; i += 1) {
          porDia.set(diaBoliviano(new Date(desde.getTime() + i * 86_400_000)),
            { entrantes: 0, salientes: 0 });
        }
        // LAS PERSONAS SE CUENTAN POR `conversacionId`, no por `telefono`. La
        // bitácora nunca guarda el número crudo: guarda `destinoEnmascarado` y
        // el identificador de la conversación. Leyendo `telefono` —que no
        // existe— el tablero mostraba «0 personas» al lado de 72 mensajes
        // recibidos, que es la clase de número que hace desconfiar de todos los
        // demás de la pantalla. Lo vio Andres el 09/09.
        // ACÁ NO SE CUENTAN CONVERSACIONES, Y ES LA CORRECCIÓN IMPORTANTE.
        // Se contaban como «persona × día natural», y esa NO es la unidad que
        // se factura: la de verdad es una ventana de 24 h que arranca con el
        // primer mensaje, su ancla vive en el documento de la conversación —no
        // en la bitácora— y el contador lo escribe el servidor en `metricas`.
        // Con la aproximación, el tablero decía 4 en siete días y Consumo 3 en
        // todo el mes: imposible, porque los siete días caben dentro del mes.
        // El comercio tenía dos números distintos para la misma palabra, y uno
        // de ellos era el que le facturamos. Lo vio Andres el 09/09.
        //
        // La regla es la misma del catálogo y del CSV: de un dato que se
        // factura hay UNA fuente. El tablero muestra la del servidor.
        const personasVistas = new Set<string>();
        let entrantes = 0; let salientes = 0; let derivaciones = 0;
        for (const d of s.docs) {
          const tipo = String(d.get('tipo') ?? '');
          const ts = d.get('ts') as { toDate?: () => Date } | undefined;
          const dia = typeof ts?.toDate === 'function' ? diaBoliviano(ts.toDate()) : '';
          const casilla = porDia.get(dia);
          const conv = d.get('conversacionId');
          if (typeof conv === 'string' && conv !== '') {
            personasVistas.add(conv);
          }
          if (tipo === 'mensaje_entrante') {
            entrantes += 1; if (casilla) casilla.entrantes += 1;
          } else if (tipo === 'mensaje_saliente') {
            salientes += 1; if (casilla) casilla.salientes += 1;
          } else if (tipo === 'transferencia_humano') {
            derivaciones += 1;
          }
        }
        setDatos({
          dias: [...porDia.entries()].map(([dia, v]) => ({ dia, ...v })),
          entrantes, salientes, personas: personasVistas.size, derivaciones,
          incompleto: s.size >= TOPE_EVENTOS,
        });
      },
      () => setDatos(null));
  }, [tenantId, periodo, activo]);
  return datos;
}

function SelectorDePeriodo({ valor, onCambio }:
{ valor: Periodo; onCambio: (p: Periodo) => void }) {
  const opciones: [Periodo, string][] = [['hoy', 'Hoy'], ['semana', '7 días'], ['mes', '30 días']];
  return (
    <div className="periodos seg" role="group" aria-label="Período">
      {opciones.map(([v, t]) => (
        <button key={v} type="button" className="seg-opt"
                aria-pressed={valor === v} onClick={() => onCambio(v)}>{t}</button>
      ))}
    </div>
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
  const flujos = useFlujos(tenantId) ?? [];
  const nombreItems = etiquetaCatalogo(flujos).toLowerCase();
  const [datos, setDatos] = useState<ResumenNegocio | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [conversacionesDelMes, setConversacionesDelMes] = useState<number | null>(null);
  // La bitácora la leen el administrador y NovuChat, no el operador: para él
  // esta parte no se pide y no se dibuja, en vez de pedirla y mostrar un error.
  const actividad = useActividad(tenantId, periodo, esAdmin);

  // EL CONTADOR DEL SERVIDOR, tal cual. `metricas/{aaaa-mm}.conversaciones` es
  // lo que se factura y lo que muestra «Consumo»; el tablero lo LEE, no lo
  // recalcula. `atenciones` es el nombre viejo del mismo campo y se acepta
  // para que una ficha anterior al cambio no muestre un cero.
  useEffect(() => {
    if (!tenantId || !esAdmin) return;
    const mes = new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 7);
    return onSnapshot(doc(db, 'tenants', tenantId, 'metricas', mes),
      (d) => setConversacionesDelMes(
        (d.get('conversaciones') as number | undefined)
        ?? (d.get('atenciones') as number | undefined) ?? 0),
      () => setConversacionesDelMes(null));
  }, [tenantId, esAdmin]);

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
    <>
    {esAdmin && (
      <>
        <SelectorDePeriodo valor={periodo} onCambio={setPeriodo} />
        <div className="cuadricula">
          {/* LA CIFRA QUE SE FACTURA SALE DEL CONTADOR DEL SERVIDOR, y por eso
              dice «este mes» aunque arriba haya un selector de período: es el
              mismo número exacto que muestra «Consumo», no una segunda cuenta
              hecha acá. El rótulo lo aclara porque un número que no reacciona
              al selector, sin explicación, se lee como que está congelado. */}
          <Tarjeta
            titulo="Conversaciones"
            pie={<Link to={`/negocio/${encodeURIComponent(tenantId)}/consumo`}>Ver el consumo</Link>}
          >
            <div className="datos">
              <Dato valor={conversacionesDelMes ?? 0} rotulo="este mes" />
            </div>
            <p className="text-muted">
              Todos los mensajes con un mismo cliente en 24 horas.{' '}
              <strong>Es lo que se factura</strong>, y va por mes: no cambia con
              el período de arriba.
            </p>
          </Tarjeta>
          <Tarjeta titulo="Mensajes del asistente">
            {/* La cifra que predice la factura de Meta: desde el 01/10/2026
                cobra cada mensaje que ENVÍA el asistente, con 1.000 gratis por
                número y por mes. Esta SÍ es del período. */}
            <div className="datos">
              <Dato valor={actividad?.salientes ?? 0} rotulo="enviados" />
              <Dato valor={actividad?.entrantes ?? 0} rotulo="recibidos" />
              <Dato valor={actividad?.personas ?? 0} rotulo="personas" />
            </div>
          </Tarjeta>
          {/* SE LLAMABA «FALLAS» Y CONTABA ERRORES, y estaba mal en las dos
              mitades. Una derivación a una persona NO es una falla: es el
              asistente haciendo lo correcto cuando algo lo excede, y es lo que
              el comercio quiere mirar para saber cuánto trabajo le llega.
              Contarlo como falla enseñaba a leer el tablero al revés. */}
          <Tarjeta titulo="Derivaciones a operador">
            <div className="datos">
              <Dato valor={actividad?.derivaciones ?? 0} rotulo="en el período" />
            </div>
            <p className="text-muted">
              Veces que el asistente pasó el chat a una persona del negocio. No
              es una falla: es cuando decide que algo lo excede.
            </p>
          </Tarjeta>
        </div>

        <div className="tarjeta">
          <GraficoDias titulo="Mensajes por día"
                       datos={actividad?.dias ?? ([] as DiaDeGrafico[])} />
          {actividad?.incompleto === true && (
            <p className="ayuda aviso-datos">
              El período tiene más movimiento del que esta pantalla trae de una
              vez, así que el gráfico muestra solo el principio. Los totales
              para facturar salen de «Consumo», que no tiene este tope.
            </p>
          )}
        </div>
      </>
    )}

    <div className="cuadricula">
      <Tarjeta
        titulo="Hoy"
        pie={<Link to={`/negocio/${encodeURIComponent(tenantId)}/conversaciones`}>Ver conversaciones</Link>}
      >
        <p className="card-title"><TextoSeguro valor={datos.nombre} maxLargo={80} /></p>
        <p className={`situacion ${cerrado ? 'alerta' : 'ok'}`}>
          {cerrado ? 'Hoy cerrado' : `Hoy abierto ${datos.horarioHoy}`}
        </p>
        <p className="text-muted">
          Fuera de horario el asistente sigue respondiendo y avisa cuándo abres.
        </p>
      </Tarjeta>

      <Tarjeta
        titulo="Lo que el asistente sabe ofrecer"
        pie={esAdmin
          ? <Link to={`/negocio/${encodeURIComponent(tenantId)}/catalogo`}>Editar {nombreItems}</Link>
          : undefined}
      >
        <div className="datos">
          <Dato valor={datos.items} rotulo={nombreItems} />
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
          {/* La etiqueta sale de `lib/cuenta`, la misma que usa «Estado de
              cuenta». Acá se pintaba el valor crudo de la base y en la consola
              del comercio de demostración se leía «sin_cargo». Y el color se
              decidía por `!== 'vencido'`, así que un estado desconocido salía
              en verde: ahora el verde lo tiene que ganar un estado conocido. */}
          <p className={`situacion ${pagoAlDia(datos.estadoPago) ? 'ok' : 'alerta'}`}>
            {etiquetaDePago(datos.estadoPago)}
          </p>
          {typeof datos.motivoPago === 'string' && datos.motivoPago !== '' && (
            <p className="text-muted"><TextoSeguro valor={datos.motivoPago} maxLargo={300} /></p>
          )}
        </Tarjeta>
      )}
    </div>
    </>
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
      <SinSalida titulo="Tu cuenta todavía no está asociada a ningún negocio">
        <p>
          Es normal si recién la crearon: alguien de NovuChat tiene que vincularla
          a tu negocio. Si ya te la vincularon, sal y vuelve a entrar para que se
          actualicen tus permisos.
        </p>
      </SinSalida>
    );
  }

  // Con varios negocios, uno debajo del otro: son pocos (un dueño de PyME
  // administra uno, a lo sumo tres locales) y verlos juntos evita el paso extra
  // de elegir antes de saber cuál necesita atención.
  return (
    <section>
      <h2>{ids.length === 1 ? 'Tu negocio' : 'Tus negocios'}</h2>
      {ids.map((id) => (
        <TableroComercio key={id} tenantId={id} esAdmin={permisos.tenants[id] === 'admin'} />
      ))}
    </section>
  );
}
