import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ProveedorSesion, useSesion } from './lib/contexto';
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

function Cabecera() {
  const { usuario, permisos, salir } = useSesion();
  const { tenantId } = useParams();
  if (!usuario) return null;
  return (
    <header>
      <nav>
        {permisos.propietario && <Link to="/negocios">Negocios</Link>}
        {tenantId && <>
          <Link to={`/negocio/${tenantId}/configuracion`}>Configuración</Link>
          <Link to={`/negocio/${tenantId}/conversaciones`}>Conversaciones</Link>
          <Link to={`/negocio/${tenantId}/usuarios`}>Usuarios</Link>
          <Link to={`/negocio/${tenantId}/contactos`}>Contactos</Link>
          <Link to={`/negocio/${tenantId}/uso`}>Uso</Link>
          <Link to={`/negocio/${tenantId}/cuenta`}>Cuenta</Link>
          <Link to={`/negocio/${tenantId}/reclamos`}>Reclamos</Link>
        </>}
      </nav>
      <button onClick={salir}>Salir</button>
    </header>
  );
}

/** Manda al usuario a su único negocio, o al listado si administra varios. */
function Inicio() {
  const { permisos, cargando } = useSesion();
  if (cargando) return <p>Cargando…</p>;
  if (permisos.propietario) return <Navigate to="/negocios" replace />;
  const ids = Object.keys(permisos.tenants);
  if (ids.length === 1 && ids[0]) return <Navigate to={`/negocio/${ids[0]}/conversaciones`} replace />;
  if (ids.length === 0) return <p>Su cuenta todavía no está asociada a ningún negocio.</p>;
  return (
    <ul>{ids.map((id) => <li key={id}><Link to={`/negocio/${id}/conversaciones`}>{id}</Link></li>)}</ul>
  );
}

export function App() {
  return (
    <ProveedorSesion>
      <Routes>
        <Route path="/ingresar" element={<Ingresar />} />
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
        <Route path="/negocio/:tenantId/uso" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Metricas /></></Proteger>} />
        <Route path="/negocio/:tenantId/cuenta" element={
          <Proteger requiere="adminTenant"><><Cabecera /><EstadoCuenta /></></Proteger>} />
        <Route path="/negocio/:tenantId/reclamos" element={
          <Proteger requiere="miembroTenant"><><Cabecera /><Reclamos /></></Proteger>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProveedorSesion>
  );
}
