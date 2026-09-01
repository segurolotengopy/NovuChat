import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ProveedorSesion, useSesion } from './lib/contexto';
import { rolEn } from './lib/sesion';
import { Proteger } from './componentes/Proteger';
import { Ingresar } from './paginas/Ingresar';
import { Tenants } from './paginas/Tenants';
import { Configuracion } from './paginas/Configuracion';
import { Conversaciones } from './paginas/Conversaciones';
import { Metricas } from './paginas/Metricas';
import { Usuarios } from './paginas/Usuarios';
import { Contactos } from './paginas/Contactos';
import { EstadoCuenta } from './paginas/EstadoCuenta';
import { Reclamos } from './paginas/Reclamos';
import { Bitacora } from './paginas/Bitacora';
import { Funcionarios } from './paginas/Funcionarios';
import { Tablero } from './paginas/Tablero';

/**
 * Menú, filtrado por rol.
 *
 * Es COSMÉTICO —quien autoriza es `firestore.rules`— pero no por eso da igual.
 * Antes se pintaban todos los enlaces para todo el mundo, así que un operador
 * veía «Configuración», «Contactos» y «Cuenta» y al entrar se topaba con «Sin
 * permiso». Un menú que ofrece puertas cerradas hace que el sistema parezca
 * roto y entrena a la gente a ignorar los mensajes de permiso, que es
 * exactamente lo que no se quiere. Se detectó probando a mano con la siembra.
 */
function Cabecera() {
  const { usuario, permisos, salir } = useSesion();
  const { tenantId } = useParams();
  if (!usuario) return null;

  const rol = tenantId ? rolEn(permisos, tenantId) : null;
  const esAdminDelNegocio = rol === 'admin';
  const esPersona = rol === 'admin' || rol === 'oper';

  return (
    <header>
      <nav>
        {permisos.propietario && <Link to="/negocios">Negocios</Link>}
        {permisos.propietario && !tenantId && <Link to="/bitacora">Bitácora</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/configuracion`}>Configuración</Link>}
        {tenantId && esPersona &&
          <Link to={`/negocio/${tenantId}/conversaciones`}>Conversaciones</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/usuarios`}>Usuarios</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/contactos`}>Contactos</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/funcionarios`}>Funcionarios</Link>}
        {tenantId && esPersona &&
          <Link to={`/negocio/${tenantId}/uso`}>Uso</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/cuenta`}>Cuenta</Link>}
        {tenantId && esPersona &&
          <Link to={`/negocio/${tenantId}/reclamos`}>Reclamos</Link>}
        {tenantId && esAdminDelNegocio &&
          <Link to={`/negocio/${tenantId}/bitacora`}>Bitácora</Link>}
      </nav>
      <button onClick={salir}>Salir</button>
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
function Inicio() {
  return <><Cabecera /><Tablero /></>;
}

export function App() {
  return (
    <ProveedorSesion>
      <Routes>
        <Route path="/ingresar" element={<Entrada />} />
        <Route path="/" element={<Proteger><Inicio /></Proteger>} />
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
        <Route path="/negocio/:tenantId/funcionarios" element={
          <Proteger requiere="adminTenant"><><Cabecera /><Funcionarios /></></Proteger>} />
        <Route path="/negocio/:tenantId/uso" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Metricas /></></Proteger>} />
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
