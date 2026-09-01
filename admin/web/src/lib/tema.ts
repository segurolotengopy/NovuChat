/**
 * Tema claro / oscuro.
 *
 * El sistema de diseño trae su propia paleta oscura y la activa con el atributo
 * `data-tema="oscuro"` en la raíz. Acá solo se decide CUÁNDO ponerlo.
 *
 * POR QUÉ NO SE USA `@media (prefers-color-scheme: dark)` A SECAS. Se podría, y
 * fue lo primero que escribí: duplicar los valores oscuros dentro de una consulta
 * de medios. Está mal por dos razones. La primera es que duplica una paleta que
 * el sistema ya define, y dos copias de una paleta se separan en el primer
 * retoque. La segunda es que una consulta de medios no se puede sobreescribir
 * desde la interfaz: el diseño prevé un control de tema, y con la paleta atada
 * al medio ese control no tendría cómo ganarle.
 *
 * Así, la preferencia del navegador es el valor por defecto y el atributo queda
 * libre para que un control lo fuerce.
 */
const CLAVE = 'novuchat.tema';
export type Tema = 'claro' | 'oscuro' | 'sistema';

function aplicar(tema: Tema, prefiereOscuro: boolean): void {
  const oscuro = tema === 'oscuro' || (tema === 'sistema' && prefiereOscuro);
  const raiz = document.documentElement;
  if (oscuro) raiz.dataset['tema'] = 'oscuro';
  else delete raiz.dataset['tema'];
  // `color-scheme` le dice al navegador cómo pintar lo que no controlamos: las
  // barras de desplazamiento y los controles nativos de formulario. Sin esto
  // quedan claros sobre un panel oscuro.
  raiz.style.colorScheme = oscuro ? 'dark' : 'light';
}

export function leerTema(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === 'claro' || guardado === 'oscuro' || guardado === 'sistema') return guardado;
  } catch {
    // Navegador con almacenamiento bloqueado o ventana privada: no es un error,
    // simplemente no hay preferencia guardada.
  }
  return 'sistema';
}

export function fijarTema(tema: Tema): void {
  try {
    localStorage.setItem(CLAVE, tema);
  } catch { /* ver leerTema */ }
  aplicar(tema, window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Se llama una vez al arrancar. Devuelve la función para dejar de escuchar. */
export function iniciarTema(): () => void {
  const consulta = window.matchMedia('(prefers-color-scheme: dark)');
  const pintar = () => aplicar(leerTema(), consulta.matches);
  pintar();
  // Si el usuario cambia el tema del sistema con el panel abierto, acompaña.
  consulta.addEventListener('change', pintar);
  return () => consulta.removeEventListener('change', pintar);
}
