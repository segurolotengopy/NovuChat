import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';

/**
 * CAPTACIÓN — la pestaña del flujo PROPIO de NovuChat.
 *
 * El flujo atiende a quien le escribe a NovuChat por WhatsApp: pregunta si ya
 * es cliente o si quiere conocer el servicio, conversa con el prospecto y avisa
 * a una persona cuando tiene sus datos. Esta pantalla edita lo que el flujo lee
 * de `/config/onboarding`.
 *
 * SOLO EL PROPIETARIO. Lo exige la regla —ni el administrador del propio tenant
 * `novuchat` lee este documento— y lo repite la ruta. Esconder la pestaña es
 * cosmético: quien cierra la puerta es `firestore.rules`.
 *
 * TODO LO QUE SE MUESTRA LO USA EL FLUJO (DISENO.md §4sexies.0, punto 7). Un
 * campo vacío o ausente no apaga nada: el flujo usa su valor de respaldo de
 * `Config base`, que es el mismo que se muestra acá como sugerencia.
 *
 * SE GUARDA CON `setDoc` Y `merge`. El documento entero es de NovuChat, así que
 * no hay campos de otro dueño que un reemplazo pudiera borrar; con `merge`,
 * además, sirve para crearlo si el alta del tenant fue anterior al flujo.
 */

const RESPALDO = {
  mensajeClienteActual:
    'Perfecto. Tu consola está en consola.novuchat.site: entra con el correo de tu ' +
    'cuenta. Si no recuerdas la contraseña, usa «Recuperar contraseña» en la misma ' +
    'pantalla. Si necesitas ayuda de una persona, toca el botón.',
  enlaceConsola: 'https://consola.novuchat.site',
  topeAviso: 25,
  topeDuro: 50,
  plantillaAviso: 'solicitud_contacto',
};

type Datos = {
  mensajeClienteActual: string;
  enlaceConsola: string;
  topeAviso: string;
  topeDuro: string;
  plantillaAviso: string;
};

const texto = (v: unknown, respaldo: string | number) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : String(respaldo);

export function Captacion() {
  const { tenantId = '' } = useParams();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'onboarding'),
      (d) => {
        const v = d.data() ?? {};
        setDatos({
          mensajeClienteActual: texto(v['mensajeClienteActual'], RESPALDO.mensajeClienteActual),
          enlaceConsola: texto(v['enlaceConsola'], RESPALDO.enlaceConsola),
          topeAviso: texto(v['topeAviso'], RESPALDO.topeAviso),
          topeDuro: texto(v['topeDuro'], RESPALDO.topeDuro),
          plantillaAviso: texto(v['plantillaAviso'], RESPALDO.plantillaAviso),
        });
      },
      () => setEstado('No se pudo leer la configuración de captación. '
        + 'Solo la ve el propietario de NovuChat, con su cuenta de Google.'));
  }, [tenantId]);

  if (!datos) return <section><h2>Captación de clientes</h2>{estado && <p role="status">{estado}</p>}</section>;

  const aviso = Number(datos.topeAviso);
  const duro = Number(datos.topeDuro);
  // La pantalla avisa antes, para no descubrir el límite con un error rojo;
  // la regla es la que manda y rechaza lo mismo.
  const problema = !Number.isInteger(aviso) || aviso < 3 || aviso > 100
    ? 'El fin del primer bloque tiene que ser un número entero entre 3 y 100.'
    : !Number.isInteger(duro) || duro > 200 || duro <= aviso
      ? 'El corte tiene que ser un número entero mayor que el fin del primer bloque, y como mucho 200.'
      : !/^[a-z0-9_]{1,64}$/.test(datos.plantillaAviso)
        ? 'El nombre de la plantilla va en minúsculas, números y guion bajo, igual que en Meta.'
        : datos.enlaceConsola !== '' && !/^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?#=&%-]*)?$/.test(datos.enlaceConsola)
          ? 'El enlace a la consola tiene que empezar con https://.'
          : null;

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    if (problema) { setEstado(problema); return; }
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'config', 'onboarding'), {
        mensajeClienteActual: datos.mensajeClienteActual.trim().slice(0, 600),
        enlaceConsola: datos.enlaceConsola.trim(),
        topeAviso: aviso,
        topeDuro: duro,
        plantillaAviso: datos.plantillaAviso.trim(),
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      }, { merge: true });
      setEstado('Guardado. El flujo lo toma en el próximo mensaje.');
    } catch {
      setEstado('El servidor rechazó el cambio. Revisa los valores.');
    }
  };

  const cambiar = (clave: keyof Datos) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDatos({ ...datos, [clave]: e.target.value });

  return (
    <section>
      <h2>Captación de clientes</h2>
      <p className="ayuda">
        Esto lo lee el asistente del número de NovuChat. A quien escribe le pregunta
        si ya es cliente o si quiere conocer el servicio. A los clientes les indica
        cómo entrar a la consola; a los nuevos les responde con la información del
        sitio, les pide sus datos y, al tenerlos, avisa a una persona con la
        plantilla de abajo.
      </p>
      <form onSubmit={guardar}>
        <label>
          Mensaje para quien ya es cliente
          <textarea rows={4} maxLength={600} value={datos.mensajeClienteActual}
                    onChange={cambiar('mensajeClienteActual')} />
          <span className="ayuda">
            Se envía una sola vez, con un botón para hablar con una persona, y el
            asistente no sigue la conversación. No incluyas contraseñas ni códigos:
            lo lee cualquiera que diga ser cliente.
          </span>
        </label>
        <label>
          Enlace a la consola
          <input type="url" value={datos.enlaceConsola} onChange={cambiar('enlaceConsola')} />
        </label>
        <label>
          Fin del primer bloque (respuestas)
          <input type="number" min={3} max={100} step={1} value={datos.topeAviso}
                 onChange={cambiar('topeAviso')} />
          <span className="ayuda">
            En esa respuesta el asistente ofrece hablar con un especialista, con un
            botón, y la conversación sigue.
          </span>
        </label>
        <label>
          Corte de la conversación (respuestas)
          <input type="number" min={4} max={200} step={1} value={datos.topeDuro}
                 onChange={cambiar('topeDuro')} />
          <span className="ayuda">
            Al llegar, el asistente se despide, avisa a una persona y no vuelve a
            responder hasta pasadas 24 horas. Es el techo de costo de una conversación.
          </span>
        </label>
        <label>
          Plantilla del aviso interno
          <input type="text" value={datos.plantillaAviso} onChange={cambiar('plantillaAviso')} />
          <span className="ayuda">
            El nombre exacto de la plantilla aprobada en Meta. Si no está aprobada,
            el aviso no llega.
          </span>
        </label>
        {problema && <p className="ayuda" role="alert">{problema}</p>}
        <button type="submit" disabled={problema !== null}>Guardar</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
