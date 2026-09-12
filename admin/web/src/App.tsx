import { NavLink, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { ProveedorSesion, useSesion } from './lib/contexto';
import { rolEn } from './lib/sesion';
import { Proteger } from './componentes/Proteger';
import { Marca } from './componentes/Marca';
import { Ingresar } from './paginas/Ingresar';
import { Tenants } from './paginas/Tenants';
import { Configuracion } from './paginas/Configuracion';
import { Conversaciones } from './paginas/Conversaciones';
import { Consumo } from './paginas/Consumo';
import { Usuarios } from './paginas/Usuarios';
import { Contactos } from './paginas/Contactos';
import { EstadoCuenta } from './paginas/EstadoCuenta';
import { Reclamos } from './paginas/Reclamos';
import { Bitacora } from './paginas/Bitacora';
import { Funcionarios } from './paginas/Funcionarios';
import { Tablero } from './paginas/Tablero';
import { MiCuenta } from './paginas/MiCuenta';
import { Catalogo } from './paginas/Catalogo';
import { Cobro } from './paginas/Cobro';
import { Inventario } from './paginas/Inventario';
import { Pedidos } from './paginas/Pedidos';
import { Cobros } from './paginas/Cobros';
import { FLUJOS, etiquetaCatalogo, useFlujos } from './lib/flujos';
import type { FlujoId } from './lib/flujos';

/**
 * Menú, filtrado por rol.
 *
 * Es COSMÉTICO —quien autoriza es `firestore.rules`— pero no por eso da igual.
 * Antes se pintaban todos los enlaces para todo el mundo, así que un operador
 * veía «Configuración», «Contactos» y «Cuenta» y al entrar se topaba con «Sin
 * permiso». Un menú que ofrece puertas cerradas hace que el sistema parezca
 * roto y entrena a la gente a ignorar los mensajes de permiso, que es
 * exactamente lo que no se quiere. Se detectó probando a mano con la siembra.
 *
 * PESTAÑAS POR FLUJO. Un negocio tiene uno o más flujos y cada flujo trae las
 * suyas (`lib/flujos.ts`): «Agenda» solo con reservas, «Pedidos y cobro» solo
 * con venta. Antes «Funcionarios» se ofrecía a todo administrador, y el de un
 * restaurante entraba a una pantalla cuyo alta el servidor le rechazaba.
 *
 * EL MENÚ NO PUEDE DEPENDER SOLO DE LA RUTA. Los enlaces del negocio salían del
 * `tenantId` de la dirección, así que en las pantallas que no lo llevan —el
 * tablero de inicio y «Mi cuenta»— la barra quedaba vacía: se entraba y no
 * había por dónde salir. Ahora, si la ruta no dice a qué negocio, se toma el
 * único que la persona administra, que es el caso de casi todos los comercios.
 * Con varios negocios no se adivina: se ofrece volver al inicio a elegir.
 */
/**
 * TÍTULO DE LA PESTAÑA DEL NAVEGADOR, por página.
 *
 * Decía «NovuChat · Panel administrativo» en las quince pantallas. Quien deja
 * la consola abierta al lado del correo y de WhatsApp Web —que es exactamente
 * cómo la usa el dueño de un negocio— no tiene forma de saber cuál de sus
 * pestañas es cuál, ni de volver a la que estaba. Con dos pestañas de la
 * consola abiertas, menos.
 *
 * El nombre sale del último tramo de la RUTA y no de un rótulo que cada página
 * escriba por su cuenta: así una pantalla nueva ya sale con título y no hay dos
 * listas de nombres que se separen con el tiempo. La única que no es literal es
 * el catálogo, que se llama «Servicios» o «Productos» según los flujos del
 * negocio, igual que su pestaña del menú.
 */
const TITULOS: Record<string, string> = {
  '': 'Inicio',
  negocios: 'Negocios',
  bitacora: 'Bitácora',
  'mi-cuenta': 'Mi cuenta',
  configuracion: 'Configuración',
  conversaciones: 'Conversaciones',
  usuarios: 'Usuarios',
  contactos: 'Contactos',
  agenda: 'Agenda',
  cobro: 'Pedidos y cobro',
  consumo: 'Consumo',
  cuenta: 'Cuenta',
  reclamos: 'Reclamos',
  ingresar: 'Ingresar',
};

function useTituloDePagina(flujos: FlujoId[] | null): void {
  const { pathname } = useLocation();
  const tramo = pathname.replace(/\/+$/, '').split('/').pop() ?? '';
  const nombre = tramo === 'catalogo' ? etiquetaCatalogo(flujos ?? []) : TITULOS[tramo];
  useEffect(() => {
    document.title = nombre ? `${nombre} · NovuChat` : 'NovuChat · Panel administrativo';
  }, [nombre]);
}

function Cabecera() {
  const { usuario, permisos, salir } = useSesion();
  const { tenantId: tenantDeLaRuta } = useParams();
  const negocios = Object.keys(permisos.tenants);
  const tenantId = tenantDeLaRuta ?? (negocios.length === 1 ? negocios[0] : undefined);
  const flujos = useFlujos(tenantId);
  useTituloDePagina(flujos);
  if (!usuario) return null;

  const rol = tenantId ? rolEn(permisos, tenantId) : null;
  const esAdminDelNegocio = rol === 'admin';
  const esPersona = rol === 'admin' || rol === 'oper';

  return (
    /* La cabecera es PEGAJOSA y su contenido va dentro de `.contenedor`, igual
       que en novuchat.site. Antes era un `<header class="nav">` a borde
       completo: en un monitor ancho el nombre quedaba pegado al filo izquierdo
       y «Salir» al derecho, con un metro de vacío en medio, mientras el
       contenido de abajo sí venía centrado. Se leía como dos páginas distintas
       una encima de la otra. */
    <header className="cabecera">
      <div className="contenedor nav">
      <Marca />
      <nav>
        {permisos.propietario && <NavLink to="/negocios">Negocios</NavLink>}
        {permisos.propietario && <NavLink to="/bitacora">Bitácora</NavLink>}
        {/* Con varios negocios y sin uno elegido, la salida es el inicio, que
            los lista. Adivinar cuál quiere ver sería peor que preguntarlo. */}
        {!tenantId && negocios.length > 1 && <NavLink to="/" end>Mis negocios</NavLink>}
        {tenantId && esAdminDelNegocio &&
          <NavLink to={`/negocio/${tenantId}/configuracion`}>Configuración</NavLink>}
        {tenantId && esAdminDelNegocio && flujos &&
          <NavLink to={`/negocio/${tenantId}/catalogo`}>{etiquetaCatalogo(flujos)}</NavLink>}
        {/* LA COMPUERTA DE ROLES YA NO DA POR SENTADO QUE PESTAÑA DE FLUJO =
            ADMINISTRADOR. Lo era hasta el 09/09, y «Pedidos» rompe la regla: la
            mira el cocinero o el repartidor. Cada pestaña declara sus roles en
            `lib/flujos.ts`; sin declararlos, sigue siendo solo del admin, que es
            el comportamiento que ya había.
            Esto es COSMÉTICO, como todo el menú: quien autoriza es
            `firestore.rules`. Lo que evita es ofrecerle a un operador una puerta
            que el servidor le va a cerrar. */}
        {tenantId && (flujos ?? []).flatMap((f) =>
          FLUJOS[f].pestanas
            .filter((p) => (p.roles ?? ['admin']).includes(rol as 'admin' | 'oper'))
            .map((p) =>
              <NavLink key={p.ruta} to={`/negocio/${tenantId}/${p.ruta}`}>{p.etiqueta}</NavLink>))}
        {tenantId && esPersona &&
          <NavLink to={`/negocio/${tenantId}/conversaciones`}>Conversaciones</NavLink>}
        {tenantId && esAdminDelNegocio &&
          <NavLink to={`/negocio/${tenantId}/usuarios`}>Usuarios</NavLink>}
        {tenantId && esAdminDelNegocio &&
          <NavLink to={`/negocio/${tenantId}/contactos`}>Contactos</NavLink>}
        {tenantId && (esPersona || permisos.propietario) &&
          <NavLink to={`/negocio/${tenantId}/consumo`}>Consumo</NavLink>}
        {tenantId && esAdminDelNegocio &&
          <NavLink to={`/negocio/${tenantId}/cuenta`}>Cuenta</NavLink>}
        {tenantId && esPersona &&
          <NavLink to={`/negocio/${tenantId}/reclamos`}>Reclamos</NavLink>}
        {tenantId && esAdminDelNegocio &&
          <NavLink to={`/negocio/${tenantId}/bitacora`}>Bitácora</NavLink>}
      </nav>
      <NavLink to="/mi-cuenta">Mi cuenta</NavLink>
      <button type="button" className="btn btn-secondary" onClick={salir}>Salir</button>
      </div>
    </header>
  );
}

/**
 * Pantalla de ingreso, pero solo para quien NO tiene sesión.
 *
 * DEFECTO QUE ARREGLA, encontrado probando a mano con datos sembrados: al
 * ingresar correctamente, el panel se quedaba en `/ingresar`. La petición a
 * Firebase devolvía 200, la sesión quedaba abierta y no había ningún error en
 * consola — simplemente nada pasaba. `Proteger` empuja al NO autenticado HACIA
 * `/ingresar`, pero nada empujaba al autenticado en el sentido contrario.
 *
 * No lo detectó ninguna prueba de reglas, porque no es un problema de permisos.
 * Es la clase de cosa que solo aparece cuando una persona usa el sistema.
 */
function Entrada() {
  const { usuario, cargando } = useSesion();
  if (cargando) return <p>Cargando…</p>;
  if (usuario) return <Navigate to="/" replace />;
  return <Ingresar />;
}

/**
 * Inicio. Ya no desvía: muestra el tablero que corresponde al rol.
 *
 * El desvío era correcto y no decía nada. La primera pantalla es la que decide
 * si alguien siente que el sistema está bajo control o que se lo tiene que
 * adivinar, y para el dueño de una PyME que entra desde el celular esa
 * impresión es la que sostiene —o no— que vuelva a entrar mañana.
 */
function DesvioAConsumo() {
  const { tenantId } = useParams();
  return <Navigate to={`/negocio/${tenantId}/consumo`} replace />;
}

function DesvioAAgenda() {
  const { tenantId } = useParams();
  return <Navigate to={`/negocio/${tenantId}/agenda`} replace />;
}

function Inicio() {
  return <><Cabecera /><Tablero /></>;
}

export function App() {
  return (
    <ProveedorSesion>
      <Routes>
        <Route path="/ingresar" element={<Entrada />} />
        <Route path="/" element={<Proteger><Inicio /></Proteger>} />
        {/* Mi cuenta la ve CUALQUIERA que haya entrado, sin importar el rol ni
            si tiene un negocio asociado: hasta quien todavía no fue vinculado
            necesita poder cambiar su contraseña. */}
        <Route path="/mi-cuenta" element={
          <Proteger><><Cabecera /><MiCuenta /></></Proteger>} />
        <Route path="/negocios" element={
          <Proteger requiere="propietario"><><Cabecera /><Tenants /></></Proteger>} />
        <Route path="/negocio/:tenantId/configuracion" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Configuracion /></></Proteger>} />
        <Route path="/negocio/:tenantId/conversaciones" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Conversaciones /></></Proteger>} />
        <Route path="/negocio/:tenantId/usuarios" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Usuarios /></></Proteger>} />
        <Route path="/negocio/:tenantId/contactos" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Contactos /></></Proteger>} />
        {/* Pestañas de FLUJO. Se pintan solo si el negocio tiene ese flujo, y
            las reglas rechazan la escritura si no lo tiene: la ruta existe
            siempre, la puerta la cierra el servidor. */}
        <Route path="/negocio/:tenantId/catalogo" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Catalogo /></></Proteger>} />
        <Route path="/negocio/:tenantId/agenda" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Funcionarios /></></Proteger>} />
        <Route path="/negocio/:tenantId/funcionarios" element={<DesvioAAgenda />} />
        <Route path="/negocio/:tenantId/inventario" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Inventario /></></Proteger>} />
        {/* PEDIDOS la ve también el OPERADOR: es la pantalla del cocinero y del
            repartidor. Es la única ruta de flujo que no exige administrador. */}
        <Route path="/negocio/:tenantId/pedidos" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Pedidos /></></Proteger>} />
        <Route path="/negocio/:tenantId/cobros" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Cobros /></></Proteger>} />
        <Route path="/negocio/:tenantId/cobro" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Cobro /></></Proteger>} />
        <Route path="/negocio/:tenantId/consumo" element={
          <Proteger requiere="miembroOPropietario"><><Cabecera /><Consumo /></></Proteger>} />
        {/* Los dos nombres anteriores de esta pantalla —«Uso» y «Cierres»—
            siguen funcionando. Un enlace viejo en un correo o en un marcador no
            tiene por qué romperse porque nosotros cambiamos de vocabulario. */}
        <Route path="/negocio/:tenantId/uso" element={<DesvioAConsumo />} />
        <Route path="/negocio/:tenantId/cierres" element={<DesvioAConsumo />} />
        <Route path="/negocio/:tenantId/cuenta" element={
          <Proteger requiere="adminTenant"><><Cabecera /><EstadoCuenta /></></Proteger>} />
        <Route path="/negocio/:tenantId/reclamos" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Reclamos /></></Proteger>} />
        {/* Vista de plataforma: todos los comercios, por consulta de grupo. */}
        <Route path="/bitacora" element={
          <Proteger requiere="propietario"><><Cabecera /><Bitacora /></></Proteger>} />
        <Route path="/negocio/:tenantId/bitacora" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Bitacora /></></Proteger>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProveedorSesion>
  );
}
