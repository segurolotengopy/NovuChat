import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, orderBy, query, limit, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';

interface Reclamo {
  id: string;
  asunto?: unknown;
  texto?: unknown;
  categoria?: unknown;
  estado?: unknown;
  correoNotificado?: unknown;
  creadoEn?: { toDate(): Date };
}

const CATEGORIAS: Record<string, string> = {
  facturacion: 'Facturación',
  falla: 'Falla del asistente',
  configuracion: 'Configuración',
  sugerencia: 'Sugerencia',
  otro: 'Otro',
};

const ESTADOS: Record<string, string> = {
  nuevo: 'Recibido',
  en_curso: 'En curso',
  resuelto: 'Resuelto',
};

/**
 * Reclamos del comercio hacia NovuChat.
 *
 * DOS COSAS DE SEGURIDAD QUE CONVIENE NO DESHACER:
 *
 * 1. El texto de un reclamo se muestra acá con <TextoSeguro>, igual que los
 *    mensajes de WhatsApp. Aunque lo haya escrito un usuario autenticado, es
 *    texto libre que después lee otra persona en otra sesión: se trata como
 *    dato, nunca como marcado. Sin `dangerouslySetInnerHTML`, sin autolinkeo.
 *
 * 2. El reclamo se GUARDA en Firestore, y una Cloud Function avisa por correo
 *    después. Si el proveedor de correo falla, el reclamo no se pierde. La
 *    columna "Aviso" muestra si el correo salió: sin ella, un canal de correo
 *    caído sería invisible durante semanas.
 *
 * El destinatario del correo NO se elige acá ni viaja en el reclamo: sale de la
 * configuración de plataforma, que ninguna sesión de navegador puede escribir.
 */
export function Reclamos() {
  const { tenantId = '' } = useParams();
  const [reclamos, setReclamos] = useState<Reclamo[]>([]);
  const [asunto, setAsunto] = useState('');
  const [texto, setTexto] = useState('');
  const [categoria, setCategoria] = useState('falla');
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(
      query(collection(db, 'tenants', tenantId, 'reclamos'), orderBy('creadoEn', 'desc'), limit(50)),
      (i) => setReclamos(i.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setEstado('No se pudieron leer los reclamos.'));
  }, [tenantId]);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null); setOcupado(true);
    try {
      const id = `rec_${Date.now()}`;
      await setDoc(doc(db, 'tenants', tenantId, 'reclamos', id), {
        asunto, texto, categoria,
        // El estado nace en 'nuevo' y la regla lo exige: crear uno 'resuelto'
        // vaciaría la bandeja de NovuChat sin que nadie lo lea.
        estado: 'nuevo',
        creadoPor: auth.currentUser?.uid ?? '',
        creadoEn: serverTimestamp(),
      });
      setAsunto(''); setTexto('');
      setEstado('Reclamo enviado. Le vamos a responder por correo.');
    } catch {
      setEstado('No se pudo enviar el reclamo. Revise el asunto y el texto.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section>
      <h2>Reclamos</h2>

      <form onSubmit={enviar}>
        <label>Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {Object.entries(CATEGORIAS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <label>Asunto
          <input required maxLength={120} value={asunto}
                 onChange={(e) => setAsunto(e.target.value)} />
        </label>
        <label>Qué pasó
          <textarea required maxLength={4000} value={texto}
                    onChange={(e) => setTexto(e.target.value)} />
        </label>
        <button type="submit" disabled={ocupado}>Enviar reclamo</button>
        <p className="ayuda">
          Su reclamo queda registrado en el sistema y además se le avisa por
          correo al equipo de NovuChat. Una vez enviado no se puede editar ni
          borrar: es el registro de lo que se reclamó y cuándo.
        </p>
      </form>

      {estado && <p role="status">{estado}</p>}

      <h3>Enviados</h3>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Categoría</th><th>Asunto</th><th>Estado</th><th>Aviso</th></tr>
        </thead>
        <tbody>
          {reclamos.map((r) => (
            <tr key={r.id}>
              <td>{r.creadoEn?.toDate ? r.creadoEn.toDate().toLocaleDateString('es-BO') : '—'}</td>
              <td>{CATEGORIAS[String(r.categoria)] ?? 'Otro'}</td>
              <td><TextoSeguro valor={r.asunto} maxLargo={120} /></td>
              <td>{ESTADOS[String(r.estado)] ?? '—'}</td>
              <td>{r.correoNotificado === true ? 'Enviado' : 'Pendiente'}</td>
            </tr>
          ))}
          {reclamos.length === 0 && <tr><td colSpan={5}>Sin reclamos.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
