import { useCallback, useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link } from 'react-router-dom';
import { db, funciones } from '../lib/firebase';
import { TextoSeguro } from '../componentes/TextoSeguro';
import { ChipModo } from '../componentes/ChipModo';
import { avisoConsumoVigente, nombreDePlan, type AvisoConsumoVista } from '../lib/planes';
import { modoDelComercio, type ModoComercio } from '../lib/modoComercio';
import { corteDe, fechaCorta, type Corte } from '../lib/prepago';
import { CALLABLES, ETIQUETA_TITULARIDAD, rutaDe, titularidadDe, type RutaWhatsApp } from '../lib/ejes';
import { CortePrepago } from '../plataforma/componentes/CortePrepago';
import { mensajeDeError } from '../plataforma/lib/negocios';

interface Tenant { id: string; nombre?: unknown; estado?: unknown; plan?: unknown }

/**
 * Cartera de clientes. Solo la ve el propietario de NovuChat: la regla
 * `allow list: if esPropietario()` sobre /tenants es lo que impide que un
 * cliente enumere a los demás clientes.
 *
 * El alta y la baja NO se hacen escribiendo Firestore desde acá: se llaman
 * Cloud Functions (`altaTenant`, `bajaTenant`), que son las que emiten los
 * custom claims y escriben la auditoría. Ver admin/DISENO.md §Alta en 48 horas.
 *
 * LA MARCA DEL 80 %. Un comercio que pasa del 70-80 % de su plan es una
 * conversación comercial pendiente («Base comercial» §3), y es de NovuChat, no
 * del comercio: por eso se marca acá, en la cartera, además de avisarle a él.
 *
 * ES LA PÁGINA DE PLATAFORMA (`Analisis/41` §1.2): NovuChat mirando a sus
 * comercios. Muestra los tres ejes (modalidad, plan y titularidad por número)
 * y la compuerta global del corte; asignar cada eje, suspender, cargar un
 * pago a mano y el corte de UN comercio viven en «Administrar»
 * (`plataforma/paginas/CuentaNegocio.tsx`). F2 mueve este archivo a
 * `plataforma/paginas/`.
 */
export function Tenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [avisos, setAvisos] = useState<Record<string, AvisoConsumoVista | null>>({});
  // PRUEBA / PRODUCCIÓN por comercio, con el mismo criterio que la cabecera
  // (`modoDelComercio`, que usa `modalidadDe` del servidor). Sale de la misma
  // lectura de `cuenta/estado` que ya se hacía para el aviso: cero lecturas más.
  const [modos, setModos] = useState<Record<string, ModoComercio | null>>({});
  // EL CORTE, TAMBIEN EL OBSERVADO. Es el dato que solo ve NovuChat: mientras
  // el corte corre en modo observacion el servidor anota lo que HABRIA
  // cortado (`aplicado: false`). Verlo en gris es lo que permite encender el
  // corte sabiendo a quien alcanza; el comercio no lo ve hasta que se aplica.
  const [cortes, setCortes] = useState<Record<string, Corte | null>>({});
  // LA TITULARIDAD ES POR NÚMERO (`Analisis/41` §4): una sola lectura de
  // `rutasWhatsApp` (decenas de documentos, solo el propietario la lista) y
  // se agrupa por comercio. `null` si no se pudo leer.
  const [rutas, setRutas] = useState<Record<string, RutaWhatsApp[]> | null>({});
  // LA COMPUERTA GLOBAL DEL CORTE (`plataforma/prepago`): se ve y se cambia
  // desde acá, con motivo y confirmación. Es la decisión que alcanza a todos
  // los comercios en producción.
  const [plataforma, setPlataforma] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSnapshot(
    query(collection(db, 'tenants'), orderBy('nombre')),
    (instantanea) => setTenants(instantanea.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => setError('No se pudo leer la cartera de clientes.'),
  ), []);

  useEffect(() => onSnapshot(collection(db, 'rutasWhatsApp'),
    (i) => {
      const porTenant: Record<string, RutaWhatsApp[]> = {};
      for (const d of i.docs) {
        const r = rutaDe(d.id, d.data());
        (porTenant[r.tenantId] ??= []).push(r);
      }
      setRutas(porTenant);
    },
    () => setRutas(null)), []);

  useEffect(() => onSnapshot(doc(db, 'plataforma', 'prepago'),
    (d) => setPlataforma(d.data() ?? null),
    () => setPlataforma(null)), []);

  const fijarCorte = useCallback(async (corteActivo: boolean, motivo: string) => {
    setOcupado(true); setError(null); setAviso(null);
    try {
      // SIN `tenantId`: es la compuerta global. La de un comercio se toca en su página.
      await httpsCallable(funciones, CALLABLES.corte)({ corteActivo, motivo });
      setAviso(corteActivo ? 'Corte encendido para todos los comercios en producción.' : 'Corte apagado: vuelve el modo observación.');
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo cambiar el corte.'));
    } finally {
      setOcupado(false);
    }
  }, []);

  // Un documento por comercio: `cuenta/estado` vive debajo de cada uno y la
  // regla lo abre al propietario de a uno (no hay consulta de grupo). La
  // cartera es de decenas, no de miles, y cada lectura es un documento chico.
  // Un error de lectura deja la casilla vacía: la marca es un recordatorio, y
  // su ausencia no puede tapar la lista entera.
  const ids = tenants.map((t) => t.id).join('|');
  useEffect(() => {
    if (!ids) return;
    const bajas = ids.split('|').map((id) => onSnapshot(doc(db, 'tenants', id, 'cuenta', 'estado'),
      (d) => {
        setAvisos((a) => ({ ...a, [id]: avisoConsumoVigente(d.data()) }));
        setModos((m) => ({ ...m, [id]: modoDelComercio(d.data()) }));
        setCortes((c) => ({ ...c, [id]: corteDe(d.data()) }));
      },
      () => {
        setAvisos((a) => ({ ...a, [id]: null }));
        setModos((m) => ({ ...m, [id]: null }));
        setCortes((c) => ({ ...c, [id]: null }));
      }));
    return () => bajas.forEach((baja) => baja());
  }, [ids]);

  const conAviso = tenants.filter((t) => avisos[t.id]).length;

  return (
    <section>
      <h2>Negocios</h2>
      {error && <p role="alert">{error}</p>}
      {aviso && <p role="status" className="ayuda">{aviso}</p>}
      <CortePrepago plataforma={plataforma} alcance="global" ocupado={ocupado} onFijar={(c, m) => void fijarCorte(c, m)} />
      {conAviso > 0 && (
        <p className="ayuda aviso-datos">
          {conAviso === 1 ? 'Un negocio pasó' : `${conAviso} negocios pasaron`} el
          80 % de las conversaciones de su plan este mes. Es el momento de
          ofrecerles una bolsa o un plan más grande, antes de que se pasen.
        </p>
      )}
      <table className="table">
        <thead><tr><th>Negocio</th><th>Modalidad</th><th>Estado</th><th>Plan</th><th>Titularidad</th><th>Consumo del mes</th><th>Corte</th><th /></tr></thead>
        <tbody>
          {tenants.map((t) => {
            const aviso = avisos[t.id];
            const modo = modos[t.id];
            const corte = cortes[t.id];
            const numeros = rutas === null ? null : (rutas[t.id] ?? []);
            return (
              <tr key={t.id}>
                <td><TextoSeguro valor={t.nombre} maxLargo={80} /></td>
                <td>{modo ? <ChipModo modo={modo} /> : <span className="text-muted">—</span>}</td>
                <td><TextoSeguro valor={t.estado} maxLargo={20} /></td>
                <td>{nombreDePlan(t.plan) ?? <TextoSeguro valor={t.plan} maxLargo={20} />}</td>
                <td>
                  {/* Un renglón por número: es el eje que decide quién paga
                      Meta y de quién es la franquicia, y es por número. */}
                  {numeros === null && <span className="text-muted">sin información</span>}
                  {numeros !== null && numeros.length === 0 && <span className="text-muted">sin número</span>}
                  {numeros !== null && numeros.map((r) => (
                    <span key={r.phoneNumberId} className="tag tag-neutral" style={{ display: 'inline-block', marginRight: 4 }}>
                      {ETIQUETA_TITULARIDAD[titularidadDe(r)]}
                    </span>
                  ))}
                </td>
                <td>
                  {aviso
                    ? <span className="tag tag-aviso" title="El servidor marcó el aviso de consumo este mes">
                        {aviso.porcentaje} %: {aviso.conversaciones} de {aviso.limite}
                      </span>
                    : <span className="text-muted">—</span>}
                </td>
                <td>
                  {corte
                    ? <span className={corte.aplicado ? 'tag tag-aviso' : 'tag'}
                        title={corte.aplicado
                          ? 'El corte se esta aplicando: el flujo recibe 409'
                          : 'Modo observacion: se anota lo que cortaria, no se corta'}>
                        {corte.aplicado ? 'corta' : 'cortaria'} por{' '}
                        {corte.motivo === 'sin_pago' ? 'falta de pago' : 'fin de conversaciones'}
                        {' '}desde el {fechaCorta(corte.desdeMs)}
                        {corte.perdidas > 0 && <> · {corte.perdidas} sin atender</>}
                      </span>
                    : <span className="text-muted">—</span>}
                </td>
                <td>
                  <Link to={`/negocios/${encodeURIComponent(t.id)}/administrar`}>Administrar</Link>
                  {' · '}
                  <Link to={`/negocio/${encodeURIComponent(t.id)}/consumo`}>Ver consumo</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
