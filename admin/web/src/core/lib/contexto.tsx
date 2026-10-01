import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';
import { leerPermisos, type Permisos } from './sesion';

interface Sesion {
  usuario: User | null;
  permisos: Permisos;
  cargando: boolean;
  refrescar: () => Promise<void>;
  salir: () => Promise<void>;
}

const ContextoSesion = createContext<Sesion | null>(null);
const SIN_PERMISOS: Permisos = { propietario: false, tenants: {}, version: 0 };

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [permisos, setPermisos] = useState<Permisos>(SIN_PERMISOS);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // `onIdTokenChanged` y no `onAuthStateChanged`: así el panel reacciona
    // también a la renovación del token, que es cuando llegan los claims nuevos
    // después de un cambio de rol.
    return onIdTokenChanged(auth, async (u) => {
      setUsuario(u);
      setPermisos(await leerPermisos(u));
      setCargando(false);
    });
  }, []);

  const valor = useMemo<Sesion>(() => ({
    usuario,
    permisos,
    cargando,
    refrescar: async () => setPermisos(await leerPermisos(auth.currentUser, true)),
    salir: async () => { await signOut(auth); },
  }), [usuario, permisos, cargando]);

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const ctx = useContext(ContextoSesion);
  if (!ctx) throw new Error('useSesion fuera de ProveedorSesion');
  return ctx;
}
