import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { db, funciones } from '../lib/firebase';
import { ConfiguracionVertical } from './ConfiguracionVertical';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * PEDIDOS Y COBRO — la pestaña propia del flujo de venta.
 *
 * ⚠️ EL COBRO REAL TODAVÍA NO LO EJECUTA NINGÚN FLUJO. Se puede registrar y
 * verificar el QR —que es lo que hace esta pantalla— pero el asistente sigue
 * enviando el de demostración: el flujo de venta no lee `cobroReal`. Por eso
 * los textos NO invitan a hacer nada: la versión anterior decía «avísale a
 * NovuChat para empezar a usarlo», que dejaba a la persona esperando una
 * gestión que no existe. Cuando el flujo lo consuma, cambian estos textos y
 * aparece el control para activarlo.
 *
 * DOS FORMAS DE COBRAR, y la pantalla las separa a propósito:
 *
 *  - **Demostración**: el QR y sus rótulos los pone NovuChat y no mueve dinero.
 *    Es lo que se usa en las presentaciones, y lleva impreso que es simulado.
 *  - **Cobro real**: el QR es del comercio y el dinero va directo a su cuenta.
 *    NovuChat no lo toca ni lo ve pasar.
 *
 * LA IMAGEN NO SE GUARDA. El navegador lee el código de la foto y manda el
 * TEXTO; el servidor lo valida y, cada vez que hay que enviarlo, lo dibuja de
 * nuevo. Así no puede pasar que se valide un código y se envíe otro, y además
 * el cliente recibe un QR limpio en vez de una foto de una pantalla, que muchas
 * veces no escanea.
 *
 * LO QUE SE LE PIDE AL COMERCIO Y POR QUÉ, porque cada casilla evita un modo de
 * fallo concreto que se descubre tarde y con un cliente enojado:
 *
 *  - **Nombre de la cuenta**: es contra lo que se compara el comprobante. Si no
 *    coincide con el del QR, no hay forma de verificar ningún pago.
 *  - **Vencimiento**: un QR vencido no cobra, y el negocio se entera por un
 *    reclamo.
 *  - **Reutilizable**: uno de un solo uso sirve para el primer cliente y deja a
 *    los demás sin poder pagar.
 *  - **Monto abierto**: uno de monto cerrado cobra siempre lo mismo, sin
 *    importar el pedido.
 *
 * Las cuatro las comprueba el servidor leyendo el código; la pantalla las
 * explica antes para que el comercio genere el QR correcto de entrada.
 */
interface Registrado {
  activo?: unknown; nombreCuenta?: unknown; nombreEnElQr?: unknown;
  banco?: unknown; venceEl?: unknown; moneda?: unknown; montoFijo?: unknown;
  cuentas?: unknown; familia?: unknown;
}

/** Lee el código de una imagen. Devuelve el texto, o `null` si no hay ninguno. */
async function leerCodigo(archivo: File): Promise<string | null> {
  const datos = await new Promise<string>((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error('lectura'));
    lector.readAsDataURL(archivo);
  });
  const imagen = await new Promise<HTMLImageElement>((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rechazar(new Error('imagen'));
    img.src = datos;
  });
  // Se limita el lado mayor: una foto de 12 megapíxeles no mejora la lectura y
  // hace esperar varios segundos en un celular modesto, que es justo el equipo
  // desde el que una peluquería va a cargar esto.
  const maximo = 1400;
  const escala = Math.min(1, maximo / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho; lienzo.height = alto;
  const contexto = lienzo.getContext('2d');
  if (!contexto) return null;
  contexto.drawImage(imagen, 0, 0, ancho, alto);
  const pixeles = contexto.getImageData(0, 0, ancho, alto);
  return jsQR(pixeles.data, ancho, alto)?.data ?? null;
}

export function Cobro() {
  const { tenantId = '' } = useParams();
  const [hayQrDemo, setHayQrDemo] = useState<boolean | null>(null);
  const [registrado, setRegistrado] = useState<Registrado | null>(null);

  const [nombreCuenta, setNombreCuenta] = useState('');
  const [banco, setBanco] = useState('');
  const [cuentaDeclarada, setCuentaDeclarada] = useState('');
  const [confirmaReutilizable, setConfirmaReutilizable] = useState(false);
  const [confirmaMontoAbierto, setConfirmaMontoAbierto] = useState(false);
  const [venceEl, setVenceEl] = useState('');
  const [aceptaMontoFijo, setAceptaMontoFijo] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);
  const yaRellenado = useRef(false);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'venta'), (d) => {
      setHayQrDemo(String(d.get('mediaIdQr') ?? '') !== '');
      const cobro = d.get('cobroReal') as Registrado | undefined;
      setRegistrado(cobro ?? null);
      // El formulario se rellena UNA sola vez. Sin la marca, cada cambio que
      // llegue de la base pisaría lo que la persona está escribiendo en ese
      // momento: se registra un QR, la escucha se dispara, y el formulario
      // vuelve a los valores guardados mientras alguien corrige un dígito.
      if (cobro && !yaRellenado.current) {
        yaRellenado.current = true;
        setNombreCuenta(String(cobro.nombreCuenta ?? ''));
        setCuentaDeclarada(String((cobro.cuentas as string[] | undefined)?.[0] ?? ''));
        setBanco(String(cobro.banco ?? ''));
        setVenceEl(String(cobro.venceEl ?? ''));
      }
    }, () => setEstado('No se pudo leer la configuración de cobro.'));
  }, [tenantId]);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setProblemas([]); setAdvertencias([]); setEstado(null);

    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) { setProblemas(['Elige la imagen de tu QR.']); return; }
    if (archivo.size > 12 * 1024 * 1024) {
      setProblemas(['La imagen pesa demasiado. Saca una captura en vez de una foto.']); return;
    }

    setOcupado(true);
    try {
      const cargaUtil = await leerCodigo(archivo);
      if (cargaUtil === null) {
        setProblemas(['No se encontró ningún código en la imagen. Que se vea el QR '
          + 'completo, derecho y sin reflejos. Lo mejor es una captura de pantalla '
          + 'de la aplicación de tu banco, no una foto.']);
        return;
      }
      const registrar = httpsCallable<unknown, {
        registrado: boolean; problemas: string[]; advertencias: string[];
      }>(funciones, 'registrarQrDeCobro');
      const { data } = await registrar({
        tenantId, cargaUtil, nombreCuenta, cuentaDeclarada, banco, venceEl,
        aceptaMontoFijo, confirmaReutilizable, confirmaMontoAbierto,
      });
      setProblemas(data.problemas ?? []);
      setAdvertencias(data.advertencias ?? []);
      if (data.registrado) {
        setEstado('QR guardado y verificado. El asistente todavía envía el QR de '
          + 'demostración: el cobro real no está habilitado. No tienes que hacer '
          + 'nada más, te avisamos cuando lo activemos.');
        if (archivoRef.current) archivoRef.current.value = '';
      }
    } catch (e) {
      // EL MENSAJE GENÉRICO TAPABA LA CAUSA. El 2026-09-07 esto falló por una
      // política de seguridad del navegador que impedía llamar a la función, y
      // lo único que se veía era «vuelve a intentar en unos minutos»: un
      // consejo falso, porque intentar de nuevo no iba a arreglarlo nunca. Se
      // distinguen los casos que la persona PUEDE resolver de los que no.
      const codigo = (e as { code?: string }).code ?? '';
      if (codigo === 'functions/permission-denied' || codigo === 'functions/unauthenticated') {
        setProblemas(['Tu sesión no tiene permiso para guardar el QR. Sal y vuelve a entrar; '
          + 'si sigue igual, avísale a NovuChat.']);
      } else if (codigo === 'functions/internal' || codigo === '') {
        setProblemas(['No se pudo contactar al servidor. Revisa tu conexión y prueba de nuevo; '
          + 'si vuelve a pasar, avísale a NovuChat: es un problema nuestro, no tuyo.']);
      } else {
        setProblemas([`No se pudo guardar (${codigo}). Avísale a NovuChat con ese código.`]);
      }
    } finally {
      setOcupado(false);
    }
  };

  const activo = registrado?.activo === true;

  return (
    <section>
      <h2>Pedidos y cobro</h2>
      <p className="ayuda">
        El asistente toma el pedido de tu catálogo de{' '}
        <Link to={`/negocio/${encodeURIComponent(tenantId)}/catalogo`}>productos</Link>,
        suma la entrega, confirma el total y envía el QR. Después del QR no da el
        pedido por confirmado hasta que el cliente manda su comprobante.
      </p>

      {/* ------------------------------------------------------------------ */}
      <h3>Tu QR de cobro</h3>

      {registrado ? (
        <div className="card elev-sm" style={{ maxWidth: '38rem' }}>
          <h4 className="card-kicker">Registrado</h4>
          <p className="card-body">
            A nombre de <strong><TextoSeguro valor={registrado.nombreCuenta} maxLargo={120} /></strong>
            {String(registrado.banco ?? '') !== '' && <> · <TextoSeguro valor={registrado.banco} maxLargo={80} /></>}
            {' · '}cuenta <TextoSeguro valor={(registrado.cuentas as string[] | undefined)?.[0] ?? '—'} maxLargo={30} />
            {' · '}vence el <TextoSeguro valor={registrado.venceEl} maxLargo={10} />
          </p>
          <p className="card-body">
            {activo
              ? <><span className="tag tag-accent">Cobrando</span> El asistente envía este QR a tus clientes.</>
              : <><span className="tag tag-neutral">Guardado, todavía sin cobrar</span> Está
                  verificado y listo. El asistente sigue enviando el QR de demostración
                  hasta que activemos el cobro real para tu negocio; cuando pase, te
                  avisamos. <strong>No hay nada que tengas que hacer.</strong></>}
          </p>
          {typeof registrado.montoFijo === 'number' && (
            <p className="ayuda aviso-datos">
              Este QR cobra siempre {registrado.montoFijo}. Si algún día vendes algo
              de otro precio, hay que cambiarlo.
            </p>
          )}
        </div>
      ) : (
        <p className="vacio">
          Todavía no cargaste ningún QR propio. Sin él, el asistente puede tomar
          pedidos pero no cobrarlos.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      <h3>{registrado ? 'Cambiar el QR' : 'Cargar mi QR'}</h3>

      <div className="aviso-datos ayuda" style={{ maxWidth: '38rem' }}>
        <p><strong>Abre la aplicación de tu banco y mira estas cuatro cosas junto
        al QR.</strong> La mayoría de los QR bolivianos vienen cifrados: nosotros
        podemos comprobar que sea un código de cobro de un banco, pero <strong>no
        podemos ver lo que dice adentro</strong>. Lo que escribas acá es lo que
        vamos a usar para verificar los pagos de tus clientes.</p>
        <ol>
          <li><strong>Que se pueda usar muchas veces.</strong> Los bancos ofrecen
          QR «de un solo uso» para un cobro puntual. Ese no sirve: el asistente
          se lo manda a todos tus clientes y solo el primero podría pagar.</li>
          <li><strong>Sin monto fijo.</strong> Suele figurar como «Monto: Bs. 0.00»
          o «Sin especificar». Si tiene un importe grabado, le cobraría lo mismo
          a todo el mundo, sin importar el pedido.</li>
          <li><strong>Con la fecha de vencimiento más lejana que te permitan.</strong> Ojo
          con esto: el QR que genera la aplicación por defecto suele vencer <strong>el
          mismo día</strong>. Pide en tu banco el QR para comercios, que dura mucho
          más. El día que vence, tus clientes dejan de poder pagar.</li>
          <li><strong>El número de la cuenta que recibe.</strong> Aparece como
          «Cuenta destino». Es el dato más importante de todos: es contra lo que
          se compara el comprobante que manda tu cliente.</li>
        </ol>
      </div>

      <form onSubmit={enviar} style={{ maxWidth: '38rem' }}>
        <label className="field">Imagen del QR
          <input className="input" type="file" ref={archivoRef}
                 accept="image/png,image/jpeg,image/webp" required />
        </label>
        <p className="ayuda">
          Mejor una captura de pantalla de la aplicación de tu banco que una foto:
          se lee siempre. La imagen no se guarda, solo el código que contiene.
        </p>

        <label className="field">¿A nombre de quién está la cuenta?
          <input className="input" required maxLength={120} value={nombreCuenta}
                 placeholder="Como figura en tu banco"
                 onChange={(e) => setNombreCuenta(e.target.value)} />
        </label>
        <p className="ayuda">
          Tal como lo escribe el banco. Puede ser una persona o el nombre del
          negocio; lo importante es que sea el mismo que va a aparecer en el
          comprobante de tu cliente.
        </p>

        <label className="field">Número de la cuenta que recibe el dinero
          <input className="input" required maxLength={30} value={cuentaDeclarada}
                 inputMode="numeric" placeholder="Cuenta destino, tal como figura junto al QR"
                 onChange={(e) => setCuentaDeclarada(e.target.value)} />
        </label>
        <p className="ayuda">
          Es con lo que verificamos cada pago. Cópialo con cuidado: si está mal,
          ningún comprobante va a poder confirmarse.
        </p>

        <label className="field">Banco (opcional)
          <input className="input" maxLength={80} value={banco}
                 onChange={(e) => setBanco(e.target.value)} />
        </label>

        <label className="field">¿Qué día vence el QR?
          <input className="input" type="date" required value={venceEl}
                 onChange={(e) => setVenceEl(e.target.value)} />
        </label>
        <p className="ayuda">
          Lo dice la aplicación de tu banco al generarlo. Te vamos a avisar antes
          de que venza.
        </p>

        <label className="field campo-casilla">
          <input type="checkbox" checked={confirmaReutilizable}
                 onChange={(e) => setConfirmaReutilizable(e.target.checked)} />
          {' '}Miré en mi banco y confirmo que este QR se puede usar muchas veces
        </label>
        <label className="field campo-casilla">
          <input type="checkbox" checked={confirmaMontoAbierto}
                 onChange={(e) => setConfirmaMontoAbierto(e.target.checked)} />
          {' '}Confirmo que NO tiene un importe fijo grabado
        </label>

        <label className="field campo-casilla">
          <input type="checkbox" checked={aceptaMontoFijo}
                 onChange={(e) => setAceptaMontoFijo(e.target.checked)} />
          {' '}Todos mis cobros son exactamente del mismo importe
        </label>
        <p className="ayuda">
          Marca esto solo si es literalmente cierto. Habilita los QR de monto
          cerrado, que en cualquier otro caso cobrarían de menos o de más.
        </p>

        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          {ocupado ? 'Revisando el código…' : 'Guardar mi QR'}
        </button>
      </form>

      {problemas.length > 0 && (
        <div role="alert" className="aviso-datos" style={{ maxWidth: '38rem' }}>
          <p><strong>No se pudo guardar:</strong></p>
          <ul>{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {advertencias.length > 0 && (
        <div role="status" className="ayuda aviso-datos" style={{ maxWidth: '38rem' }}>
          <p><strong>Tenlo en cuenta:</strong></p>
          <ul>{advertencias.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {estado && <p role="status">{estado}</p>}

      {/* ------------------------------------------------------------------ */}
      <h3>QR de demostración</h3>
      <p className="ayuda">
        {hayQrDemo === null ? 'Cargando…' : hayQrDemo
          ? 'Hay un QR de demostración cargado. No cobra ni mueve dinero, y lleva '
            + 'impreso que es un simulacro. Se usa en las presentaciones.'
          : 'No hay ningún QR de demostración cargado.'}
        {' '}Lo administra NovuChat: los rótulos que dicen que el cobro es simulado
        no se pueden quitar.
      </p>

      <ConfiguracionVertical tenantId={tenantId} vertical="venta" />
    </section>
  );
}
