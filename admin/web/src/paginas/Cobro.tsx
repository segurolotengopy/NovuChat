import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useParams } from 'react-router-dom';
import jsQR from 'jsqr';
import { db, funciones } from '../lib/firebase';
import { useFlujos } from '../lib/flujos';
import { ConfiguracionVertical } from './ConfiguracionVertical';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * CONFIGURACIÓN DE QR — el QR propio del comercio, para el flujo que cobra.
 *
 * DOS FLUJOS COBRAN CON EL MISMO QR, y la pantalla es una sola:
 *
 *  - **Venta** (pedidos): ⚠️ EL COBRO REAL TODAVÍA NO LO EJECUTA ESE FLUJO. Se
 *    puede registrar y verificar el QR, pero el asistente sigue enviando el de
 *    demostración: el flujo de venta no lee `cobroReal`. Por eso sus textos NO
 *    invitan a hacer nada: la versión anterior decía «avísale a NovuChat para
 *    empezar a usarlo», que dejaba a la persona esperando una gestión que no
 *    existe. Cuando el flujo lo consuma, cambian esos textos.
 *  - **Reservas** (agendamiento), desde el 17/09 (`DISENO.md` §4duodecies): el
 *    flujo manda este QR con el resumen de la cita cuando la SEÑA está activa,
 *    y retiene el horario unos minutos a la espera del comprobante. El
 *    comprobante lo coteja el servidor; la verificación del dinero la hace el
 *    negocio en su banco. Los dos parámetros de la seña se editan al pie.
 *
 * EL DOCUMENTO LO DECIDE LA LISTA DE FLUJOS, igual que en el servidor
 * (`registrarQrDeCobro`): `/config/venta` si el negocio vende, y si solo
 * reserva, `/config/agendamiento`. Es la política de capas (§4sexies): el QR es
 * del flujo que cobra, y un negocio con los dos flujos lo tiene una sola vez,
 * en el de venta, para que los dos manden el mismo.
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

/**
 * UN PROBLEMA SIEMPRE SABE A QUÉ CAMPO PERTENECE. Política de la consola
 * (`admin/DISENO.md` §4quindecies): ningún mensaje genérico, y el control que hay
 * que tocar se resalta. Hasta el 19/09/2026 esta pantalla escribía una lista
 * suelta debajo del botón y la persona tenía que adivinar cuál de los ocho
 * controles estaba mal; con un QR cifrado, que exige dos confirmaciones, eso
 * bastó para trabar a un administrador que tenía todo lo demás bien.
 */
type CampoDelFormulario = 'imagen' | 'nombreCuenta' | 'cuentaDeclarada' | 'venceEl'
  | 'confirmaReutilizable' | 'confirmaMontoAbierto' | 'aceptaMontoFijo';
interface Problema { campo: CampoDelFormulario; texto: string }

/** El rótulo con el que se nombra cada campo en el resumen de arriba. */
const ROTULO: Record<CampoDelFormulario, string> = {
  imagen: 'Imagen del QR',
  nombreCuenta: '¿A nombre de quién está la cuenta?',
  cuentaDeclarada: 'Número de la cuenta que recibe el dinero',
  venceEl: '¿Qué día vence el QR?',
  confirmaReutilizable: 'Se puede usar muchas veces',
  confirmaMontoAbierto: 'No tiene importe fijo grabado',
  aceptaMontoFijo: 'Todos mis cobros son del mismo importe',
};

export function Cobro() {
  const { tenantId = '' } = useParams();
  const flujos = useFlujos(tenantId);
  const tieneVenta = (flujos ?? []).includes('venta');
  const tieneAgenda = (flujos ?? []).includes('agendamiento');
  // `null` mientras no se sabe qué flujos tiene: no se escucha ningún
  // documento hasta entonces, para no leer `venta` y después saltar a
  // `agendamiento` con el formulario ya rellenado con lo del otro.
  const documento: 'venta' | 'agendamiento' | null =
    flujos === null ? null : tieneVenta ? 'venta' : tieneAgenda ? 'agendamiento' : null;
  const [hayQrDemo, setHayQrDemo] = useState<boolean | null>(null);
  const [registrado, setRegistrado] = useState<Registrado | null>(null);

  const [nombreCuenta, setNombreCuenta] = useState('');
  const [banco, setBanco] = useState('');
  const [cuentaDeclarada, setCuentaDeclarada] = useState('');
  const [confirmaReutilizable, setConfirmaReutilizable] = useState(false);
  const [confirmaMontoAbierto, setConfirmaMontoAbierto] = useState(false);
  const [venceEl, setVenceEl] = useState('');
  const [aceptaMontoFijo, setAceptaMontoFijo] = useState(false);
  const [problemas, setProblemas] = useState<Problema[]>([]);
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  /** Fallos que no pertenecen a ningún campo: red, permiso, un código de error. */
  const [fallo, setFallo] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);
  /** El problema de un campo, si lo tiene: sirve para `aria-invalid` y para el texto de abajo. */
  const problemaDe = (campo: CampoDelFormulario) => problemas.find((p) => p.campo === campo) ?? null;
  const MensajeDelCampo = ({ campo }: { campo: CampoDelFormulario }) => {
    const p = problemaDe(campo);
    return p ? <p className="campo-error" role="alert" id={`error-${campo}`}>{p.texto}</p> : null;
  };
  const yaRellenado = useRef(false);

  useEffect(() => {
    if (problemas.length === 0) return;
    const primero = problemas[0]!.campo;
    const control = document.getElementById(`campo-${primero}`);
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [problemas]);

  useEffect(() => {
    if (!tenantId || documento === null) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', documento), (d) => {
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
  }, [tenantId, documento]);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setProblemas([]); setAdvertencias([]); setEstado(null); setFallo(null);

    const archivo = archivoRef.current?.files?.[0];
    if (!archivo) { setProblemas([{ campo: 'imagen', texto: 'Elige la imagen de tu QR.' }]); return; }
    if (archivo.size > 12 * 1024 * 1024) {
      setProblemas([{ campo: 'imagen', texto: 'La imagen pesa demasiado. Saca una captura en vez de una foto.' }]); return;
    }

    setOcupado(true);
    try {
      const cargaUtil = await leerCodigo(archivo);
      if (cargaUtil === null) {
        setProblemas([{ campo: 'imagen', texto: 'No se encontró ningún código en la imagen. Que se vea el QR '
          + 'completo, derecho y sin reflejos. Lo mejor es una captura de pantalla '
          + 'de la aplicación de tu banco, no una foto.' }]);
        return;
      }
      const registrar = httpsCallable<unknown, {
        registrado: boolean; problemas: Problema[]; advertencias: string[];
        documento?: 'venta' | 'agendamiento';
      }>(funciones, 'registrarQrDeCobro');
      const { data } = await registrar({
        tenantId, cargaUtil, nombreCuenta, cuentaDeclarada, banco, venceEl,
        aceptaMontoFijo, confirmaReutilizable, confirmaMontoAbierto,
      });
      setProblemas(data.problemas ?? []);
      setAdvertencias(data.advertencias ?? []);
      if (data.registrado) {
        // El servidor dice en qué documento lo guardó; si no lo dice (versión
        // anterior de la función), vale lo que esta pantalla dedujo.
        setEstado((data.documento ?? documento) === 'agendamiento'
          ? 'QR guardado y verificado. Cuando NovuChat lo active y la seña tenga '
            + 'un importe, el asistente lo manda con el resumen de cada cita. No '
            + 'tienes que hacer nada más, te avisamos cuando lo activemos.'
          : 'QR guardado y verificado. El asistente todavía envía el QR de '
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
        setFallo('Tu sesión no tiene permiso para guardar el QR. Sal y vuelve a entrar; '
          + 'si sigue igual, avísale a NovuChat.');
      } else if (codigo === 'functions/internal' || codigo === '') {
        setFallo('No se pudo contactar al servidor. Revisa tu conexión y prueba de nuevo; '
          + 'si vuelve a pasar, avísale a NovuChat: es un problema nuestro, no tuyo.');
      } else {
        setFallo(`No se pudo guardar (${codigo}). Avísale a NovuChat con ese código.`);
      }
    } finally {
      setOcupado(false);
    }
  };

  const activo = registrado?.activo === true;

  // Sin un flujo que cobre no se ofrece el formulario: `registrarQrDeCobro` lo
  // rechazaría, y ofrecer una puerta que el servidor cierra es lo que la
  // consola evita en todas partes (`lib/flujos.ts`).
  if (flujos !== null && documento === null) {
    return (
      <section>
        <h2>Configuración de QR</h2>
        <p className="vacio">
          Este negocio no tiene ningún flujo que cobre por QR: ni pedidos ni
          reservas con seña.
        </p>
      </section>
    );
  }

  return (
    <section>
      {/* SE LLAMABA «PEDIDOS Y COBRO» Y NO LISTABA NI UNO NI OTRO: configuraba
          el QR. El nombre prometía dos pantallas que ahora sí existen —«Pedidos»
          y «Cobros»— y esta se queda con lo que de verdad hace. Ver
          `DISENO.md` §4nonies. */}
      <h2>Configuración de QR</h2>
      {/* UN PÁRRAFO POR FLUJO QUE COBRA, y no uno solo con «pedido o cita»: un
          negocio que solo reserva no tiene que leer qué hace el asistente con
          un pedido. Con los dos flujos se leen los dos. */}
      {tieneVenta && (
        <p className="ayuda">
          El asistente toma el pedido de tu catálogo de{' '}
          <Link to={`/negocio/${encodeURIComponent(tenantId)}/catalogo`}>productos</Link>,
          suma la entrega, confirma el total y envía el QR. Después del QR no da el
          pedido por confirmado hasta que el cliente manda su comprobante.
        </p>
      )}
      {tieneAgenda && (
        <p className="ayuda">
          Cuando la seña está activa, el asistente manda este QR con el resumen
          de la cita y retiene el horario unos minutos a la espera del
          comprobante. <strong>El comprobante lo coteja el servidor</strong>:
          revisa que el monto, la cuenta y la hora coincidan. La verificación del
          dinero la haces tú en tu banco: el asistente le dice al cliente que los
          datos coinciden, nunca que el pago entró.
        </p>
      )}
      {/* ------------------------------------------------------------------ */}
      <h3>Tu QR de cobro</h3>
      {/* LAS DOS PIEZAS DE ARRIBA VAN LADO A LADO cuando hay lugar. Tenían un
          `maxWidth: 38rem` escrito a mano, así que en un monitor quedaban en
          una tira angosta contra el borde izquierdo con media pantalla vacía a
          la derecha: el bloque de las cuatro comprobaciones, que es largo,
          empujaba el formulario tan abajo que había que bajar dos pantallas
          para llegar a los campos. Lo vio Andres el 09/09. */}

      {registrado ? (
        <div className="card elev-sm">
          <h4 className="card-kicker">Registrado</h4>
          <p className="card-body">
            A nombre de <strong><TextoSeguro valor={registrado.nombreCuenta} maxLargo={120} /></strong>
            {String(registrado.banco ?? '') !== '' && <> · <TextoSeguro valor={registrado.banco} maxLargo={80} /></>}
            {' · '}cuenta <TextoSeguro valor={(registrado.cuentas as string[] | undefined)?.[0] ?? '—'} maxLargo={30} />
            {' · '}vence el <TextoSeguro valor={registrado.venceEl} maxLargo={10} />
          </p>
          <p className="card-body">
            {activo
              ? <><span className="tag tag-accent">Cobrando</span>{' '}
                  {documento === 'agendamiento'
                    ? 'El asistente manda este QR con el resumen de la cita cuando la seña tiene un importe.'
                    : 'El asistente envía este QR a tus clientes.'}</>
              : <><span className="tag tag-neutral">Guardado, todavía sin cobrar</span> Está
                  verificado y listo.{' '}
                  {documento === 'agendamiento'
                    ? 'El asistente no pide seña hasta que activemos el cobro real para tu negocio; '
                      + 'cuando pase, te avisamos. '
                    : 'El asistente sigue enviando el QR de demostración hasta que activemos el '
                      + 'cobro real para tu negocio; cuando pase, te avisamos. '}
                  <strong>No hay nada que tengas que hacer.</strong></>}
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
          Todavía no cargaste ningún QR propio. Sin él, el asistente puede{' '}
          {documento === 'agendamiento' ? 'agendar citas pero no pedir la seña'
            : 'tomar pedidos pero no cobrarlos'}.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      <h3>{registrado ? 'Cambiar el QR' : 'Cargar mi QR'}</h3>

      <div className="aviso-datos ayuda">
        <p><strong>Abre la aplicación de tu banco y mira estas cuatro cosas junto
        al QR.</strong> La mayoría de los QR bolivianos vienen cifrados: nosotros
        podemos comprobar que sea un código de cobro de un banco, pero <strong>no
        podemos ver lo que dice adentro</strong>. Lo que escribas acá es lo que
        vamos a usar para cotejar los comprobantes de tus clientes.</p>
        <ol>
          <li><strong>Que se pueda usar muchas veces.</strong> Los bancos ofrecen
          QR «de un solo uso» para un cobro puntual. Ese no sirve: el asistente
          se lo manda a todos tus clientes y solo el primero podría pagar.</li>
          <li><strong>Sin monto fijo.</strong> Suele figurar como «Monto: Bs. 0.00»
          o «Sin especificar». Si tiene un importe grabado, le cobraría lo mismo
          a todo el mundo, sin importar el pedido.</li>
          <li><strong>Que sea el QR para COMERCIOS, no el que la aplicación te da por
          defecto.</strong> El QR personal suele vencer el mismo día; el de comercio
          dura mucho más, y la vigencia la eliges al generarlo. Pide la fecha más
          lejana que te permitan: el día que vence, tus clientes dejan de poder pagar
          y te enteras por un reclamo.</li>
          <li><strong>El número de la cuenta que recibe.</strong> Aparece como
          «Cuenta destino». Es el dato más importante de todos: es contra lo que
          se compara el comprobante que manda tu cliente.</li>
        </ol>
      </div>

      {/* SIN `maxWidth` FIJO. Tenía 38rem escritas a mano, así que en un monitor
          el formulario quedaba en una tira angosta contra el borde izquierdo
          por más ancho que hubiera. Ahora lo acomoda la cuadrícula. */}
      <form onSubmit={enviar}>
        <div className="grupo">
          <label className="field">Imagen del QR
            <input className="input" type="file" ref={archivoRef} id="campo-imagen"
            aria-invalid={problemaDe('imagen') !== null}
            aria-describedby={problemaDe('imagen') ? 'error-imagen' : undefined}
            accept="image/png,image/jpeg,image/webp" required />
          </label>
          <MensajeDelCampo campo="imagen" />
          <p className="ayuda">
            Mejor una captura de pantalla de la aplicación de tu banco que una foto:
            se lee siempre. La imagen no se guarda, solo el código que contiene.
          </p>
        </div>

        <div className="grupo">
          <label className="field">¿A nombre de quién está la cuenta?
            <input className="input" required maxLength={120} value={nombreCuenta}
            id="campo-nombreCuenta" aria-invalid={problemaDe('nombreCuenta') !== null}
            aria-describedby={problemaDe('nombreCuenta') ? 'error-nombreCuenta' : undefined}
            placeholder="Como figura en tu banco"
            onChange={(e) => setNombreCuenta(e.target.value)} />
          </label>
          <MensajeDelCampo campo="nombreCuenta" />
          <p className="ayuda">
            Tal como lo escribe el banco. Puede ser una persona o el nombre del
            negocio; lo importante es que sea el mismo que va a aparecer en el
            comprobante de tu cliente.
          </p>
        </div>

        <div className="grupo">
          <label className="field">Número de la cuenta que recibe el dinero
            <input className="input" required maxLength={30} value={cuentaDeclarada}
            id="campo-cuentaDeclarada" aria-invalid={problemaDe('cuentaDeclarada') !== null}
            aria-describedby={problemaDe('cuentaDeclarada') ? 'error-cuentaDeclarada' : undefined}
            inputMode="numeric" placeholder="Cuenta destino, tal como figura junto al QR"
            onChange={(e) => setCuentaDeclarada(e.target.value)} />
          </label>
          <MensajeDelCampo campo="cuentaDeclarada" />
          <p className="ayuda">
            Es con lo que se coteja cada comprobante. Cópialo con cuidado: si
            está mal, ningún comprobante va a coincidir.
          </p>
        </div>

        <div className="grupo">
          <label className="field">Banco (opcional)
            <input className="input" maxLength={80} value={banco}
            onChange={(e) => setBanco(e.target.value)} />
          </label>
        </div>

        <div className="grupo">
          <label className="field">¿Qué día vence el QR?
            <input className="input" type="date" required value={venceEl}
            id="campo-venceEl" aria-invalid={problemaDe('venceEl') !== null}
            aria-describedby={problemaDe('venceEl') ? 'error-venceEl' : undefined}
            onChange={(e) => setVenceEl(e.target.value)} />
          </label>
          <MensajeDelCampo campo="venceEl" />
          <p className="ayuda">
            Lo dice la aplicación de tu banco al generarlo. Te vamos a avisar antes
            de que venza.
          </p>
        </div>

        <label className="field campo-casilla">
          <input type="checkbox" checked={confirmaReutilizable}
                 id="campo-confirmaReutilizable"
                 aria-invalid={problemaDe('confirmaReutilizable') !== null}
                 aria-describedby={problemaDe('confirmaReutilizable') ? 'error-confirmaReutilizable' : undefined}
                 onChange={(e) => setConfirmaReutilizable(e.target.checked)} />
          {' '}Miré en mi banco y confirmo que este QR se puede usar muchas veces
        </label>
        <MensajeDelCampo campo="confirmaReutilizable" />
        <label className="field campo-casilla">
          <input type="checkbox" checked={confirmaMontoAbierto}
                 id="campo-confirmaMontoAbierto"
                 aria-invalid={problemaDe('confirmaMontoAbierto') !== null}
                 aria-describedby={problemaDe('confirmaMontoAbierto') ? 'error-confirmaMontoAbierto' : undefined}
                 onChange={(e) => setConfirmaMontoAbierto(e.target.checked)} />
          {' '}Confirmo que NO tiene un importe fijo grabado
        </label>
        <MensajeDelCampo campo="confirmaMontoAbierto" />

        <label className="field campo-casilla">
          <input type="checkbox" checked={aceptaMontoFijo}
                 id="campo-aceptaMontoFijo"
                 aria-invalid={problemaDe('aceptaMontoFijo') !== null}
                 aria-describedby={problemaDe('aceptaMontoFijo') ? 'error-aceptaMontoFijo' : undefined}
                 onChange={(e) => setAceptaMontoFijo(e.target.checked)} />
          {' '}Todos mis cobros son exactamente del mismo importe
        </label>
        <MensajeDelCampo campo="aceptaMontoFijo" />
        <p className="ayuda">
          Marca esto solo si es literalmente cierto. Habilita los QR de monto
          cerrado, que en cualquier otro caso cobrarían de menos o de más.
        </p>

        <button type="submit" className="btn btn-primary" disabled={ocupado}>
          {ocupado ? 'Revisando el código…' : 'Guardar mi QR'}
        </button>
      </form>

      {problemas.length > 0 && (
        <div role="alert" className="aviso-datos">
          <p><strong>No se pudo guardar. Falta esto:</strong></p>
          <ul>{problemas.map((p) => (
            <li key={p.campo + p.texto}><strong>{ROTULO[p.campo]}</strong>: {p.texto}</li>
          ))}</ul>
        </div>
      )}
      {advertencias.length > 0 && (
        <div role="status" className="ayuda aviso-datos">
          <p><strong>Tenlo en cuenta:</strong></p>
          <ul>{advertencias.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {fallo && (
        <div role="alert" className="ayuda aviso-datos">
          <p>{fallo}</p>
        </div>
      )}
      {estado && <p role="status">{estado}</p>}

      {/* ------------------------------------------------------------------ */}
      {/* SOLO PARA VENTA. El QR de demostración (`mediaIdQr`) vive en
          `/config/venta` y lo manda el flujo de pedidos en las presentaciones.
          En reservas la seña va SIEMPRE por el camino real: un cobro simulado y
          uno real no conviven en un mismo negocio (prohibición 3), y a un
          negocio que solo reserva no se le habla de un simulacro que no tiene. */}
      {tieneVenta && (
        <>
          <h3>QR de demostración</h3>
          <p className="ayuda">
            {hayQrDemo === null ? 'Cargando…' : hayQrDemo
              ? 'Hay un QR de demostración cargado. No cobra ni mueve dinero, y lleva '
                + 'impreso que es un simulacro. Se usa en las presentaciones.'
              : 'No hay ningún QR de demostración cargado.'}
            {' '}Lo administra NovuChat: los rótulos que dicen que el cobro es simulado
            no se pueden quitar.
          </p>
        </>
      )}

      {/* Cada flujo trae sus parámetros propios y CADA UNO va a SU documento
          (§4sexies.2): los costos de entrega a `venta`, la seña a
          `agendamiento`. Un negocio con los dos flujos ve los dos bloques; la
          seña no se muda a `venta` aunque el QR viva ahí. */}
      {tieneVenta && <ConfiguracionVertical tenantId={tenantId} vertical="venta" />}
      {tieneAgenda && <ConfiguracionVertical tenantId={tenantId} vertical="agendamiento" />}
    </section>
  );
}
