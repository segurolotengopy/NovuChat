/**
 * GOOGLE IDENTITY SERVICES, SOLO PARA OBTENER UN ID TOKEN (03/11/2026). No inicia sesión en la app ni se vincula al usuario de
 * Firebase (regla «una identidad, un proveedor»): el token viaja una vez al servidor, que lo verifica y lo descarta. Aquí no se guarda,
 * no se imprime y no sale de la llamada de retorno.
 */
export const URL_GSI = 'https://accounts.google.com/gsi/client';

interface GsiId {
  initialize(o: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  cancel(): void;
}
declare global { interface Window { google?: { accounts?: { id?: GsiId } } } }

let carga: Promise<GsiId> | null = null;

export function cargarGsi(): Promise<GsiId> {
  const ya = window.google?.accounts?.id;
  if (ya) return Promise.resolve(ya);
  carga ??= new Promise<GsiId>((ok, mal) => {
    const s = document.createElement('script');
    s.src = URL_GSI;
    s.async = true;
    s.onload = () => { const g = window.google?.accounts?.id; if (g) ok(g); else { carga = null; mal(new Error('gsi')); } };
    s.onerror = () => { carga = null; mal(new Error('gsi')); };
    document.head.appendChild(s);
  });
  return carga;
}

/** Dibuja el botón de Google (abre su propio selector de cuenta) y entrega el ID token a `alElegir`. */
export async function montarBotonGoogle(el: HTMLElement, clientId: string, alElegir: (idToken: string) => void): Promise<void> {
  const gsi = await cargarGsi();
  gsi.initialize({ client_id: clientId, auto_select: false, cancel_on_tap_outside: true, callback: (r) => { if (r.credential) alElegir(r.credential); } });
  gsi.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', locale: 'es' });
}
