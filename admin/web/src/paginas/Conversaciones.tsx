import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Mensaje {
  id: string; direccion?: unknown; texto?: unknown; tipo?: unknown; ts?: { toDate(): Date };
}
interface Conversacion { id: string; telefono?: unknown; ultimoMensaje?: unknown }

/**
 * =============================================================================
 * LO QUE LLEGÓ Y NO ERA TEXTO
 * =============================================================================
 *
 * EL COMPROBANTE DE PAGO ES LO MÁS IMPORTANTE DE UNA CONVERSACIÓN DE VENTA, y
 * era justo lo que no se veía: el hilo pintaba `texto` y nada más, así que una
 * imagen aparecía como la frase que el flujo escribe en su lugar —«el cliente
 * envió una IMAGEN»— mezclada con los mensajes normales, sin ninguna marca. El
 * comercio no podía distinguir de un vistazo dónde está el comprobante.
 *
 * LO QUE ESTO HACE Y LO QUE NO, dicho para que nadie suponga de más:
 *
 *   SÍ   marca el mensaje como adjunto, con su tipo, para que se encuentre.
 *   NO   muestra la imagen. NovuChat no la guarda: el archivo vive en los
 *        servidores de Meta y se baja con el token de la cuenta, desde el
 *        servidor y nunca desde el navegador. Y hoy ni siquiera se guarda el
 *        identificador del archivo, así que no hay de dónde traerla.
 *
 * VER LA IMAGEN DE VERDAD son tres cosas, en este orden: guardar el `media id`
 * que manda Meta, una función que la baje con el token y la sirva desde nuestro
 * propio origen —nunca un enlace a Meta, que caduca— y el permiso para leerla.
 * Está anotado en ESTADO.md. Prometerlo con una miniatura rota sería peor que
 * decir que no está.
 */
const ADJUNTOS: Record<string, string> = {
  image: '🧾 Imagen — puede ser el comprobante',
  document: '📄 Documento — puede ser el comprobante',
  audio: '🎤 Audio',
  location: '📍 Ubicación',
  order: '🛒 Pedido del catálogo',
  interactive: '👆 Respuesta a una lista o botón',
};

function Adjunto({ tipo }: { tipo: unknown }) {
  const rotulo = ADJUNTOS[String(tipo ?? '')];
  if (!rotulo) return null;
  return <span className="adjunto">{rotulo}</span>;
}

/**
 * Visor de conversaciones. Todo lo que se pinta acá lo escribió un desconocido:
 * pasa SIEMPRE por <TextoSeguro>, nunca por interpolación directa en HTML.
 *
 * La consulta está anclada bajo /tenants/{tenantId}: es la ruta la que decide
 * qué se puede leer. No hay ningún `where('tenantId', '==', ...)` que un usuario
 * pudiera cambiar en el navegador para mirar a otro negocio.
 */
export function Conversaciones() {
  const { tenantId = '' } = useParams();
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'conversaciones'), orderBy('ultimoEn', 'desc'), limit(50)),
      (i) => setConversaciones(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setError('No se pudieron leer las conversaciones.'),
    );
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !abierta) { setMensajes([]); return; }
    return onSnapshot(
      query(
        collection(db, 'tenants', tenantId, 'conversaciones', abierta, 'mensajes'),
        orderBy('ts', 'asc'), limit(300),
      ),
      (i) => setMensajes(i.docs.map((d) => ({ id: d.id, ...d.data() } as Mensaje))),
      () => setError('No se pudieron leer los mensajes.'),
    );
  }, [tenantId, abierta]);

  return (
    <section className="dos-columnas">
      {error && <p role="alert">{error}</p>}
      <ul className="lista-hilos">
        {conversaciones.map((c) => (
          <li key={c.id}>
            <button onClick={() => setAbierta(c.id)} aria-current={abierta === c.id}>
              <strong><TextoSeguro valor={c.telefono} maxLargo={15} /></strong>
              <TextoSeguro valor={c.ultimoMensaje} maxLargo={80} />
            </button>
          </li>
        ))}
      </ul>

      <ol className="hilo">
        {mensajes.map((m) => (
          <li key={m.id} className={m.direccion === 'entrante' ? 'entrante' : 'saliente'}>
            <Adjunto tipo={m.tipo} />
            <TextoSeguro valor={m.texto} />
            <time>{m.ts?.toDate ? m.ts.toDate().toLocaleString('es-BO') : ''}</time>
          </li>
        ))}
        {abierta && mensajes.length === 0 && (
          <li className="vacio">Esta conversación todavía no tiene mensajes guardados.</li>
        )}
      </ol>
    </section>
  );
}
