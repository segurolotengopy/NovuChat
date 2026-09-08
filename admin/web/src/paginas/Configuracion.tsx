import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { useFlujos } from '../lib/flujos';
import { PALETAS, PALETA_POR_DEFECTO, type PaletaId } from '../lib/paletas';

/**
 * Edición de la configuración del negocio: lo que hoy vive a mano en el nodo
 * `Config del negocio` de los flujos de n8n.
 *
 * Los mismos topes que valida `firestore.rules` se repiten acá como `maxLength`.
 * La validación del navegador es cortesía para el usuario; la que manda es la
 * del servidor. Nunca al revés.
 */
const TOPES: Record<string, number> = {
  nombreNegocio: 80, descripcion: 400, direccion: 200, numeroRecepcion: 15,
  calendarioId: 120, politicaCancelacion: 600, instruccionesExtra: 1500,
  mensajeCierre: 300, mensajeErrorTemporal: 300,
  mensajeReservaNoConfirmada: 300, mensajeComercioSuspendido: 300,
};

export function Configuracion() {
  const { tenantId = '' } = useParams();
  // Esta pantalla es LO COMÚN a cualquier negocio. Lo propio de cada flujo
  // vive en su pestaña («Agenda», «Pedidos y cobro»): ver lib/flujos.ts.
  const flujos = useFlujos(tenantId) ?? [];
  const conAgenda = flujos.includes('agendamiento');
  const conVenta = flujos.includes('venta');
  // El catálogo web es una capacidad de VENTA y solo de venta (DISENO.md
  // §4octies.0bis). Es cosmético: quien cierra la puerta es la regla, que lee
  // la misma lista. Lo que esto evita es ofrecerle a un salón una casilla que
  // el servidor le va a rechazar.
  const [datos, setDatos] = useState<Record<string, string>>({});
  // `catalogoWebActivo` es un booleano y `datos` guarda solo cadenas, así que
  // va aparte. Convertirlo a 'si'/'no' para que entrara ahí habría hecho que un
  // día alguien lo guardara como la cadena 'false', que en JavaScript es
  // verdadera: el catálogo quedaría publicado creyendo que está apagado.
  const [catalogoWeb, setCatalogoWeb] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'), (d) => {
      const v = d.data() ?? {};
      setDatos({
        nombreNegocio: String(v['nombreNegocio'] ?? ''),
        descripcion: String(v['descripcion'] ?? ''),
        direccion: String(v['direccion'] ?? ''),
        numeroRecepcion: String(v['numeroRecepcion'] ?? ''),
        calendarioId: String(v['calendarioId'] ?? ''),
        politicaCancelacion: String(v['politicaCancelacion'] ?? ''),
        tratamiento: String(v['tratamiento'] ?? 'usted'),
        estiloEmojis: String(v['estiloEmojis'] ?? 'pocos'),
        mensajeCierre: String(v['mensajeCierre'] ?? ''),
        mensajeErrorTemporal: String(v['mensajeErrorTemporal'] ?? ''),
        mensajeReservaNoConfirmada: String(v['mensajeReservaNoConfirmada'] ?? ''),
        mensajeComercioSuspendido: String(v['mensajeComercioSuspendido'] ?? ''),
        instruccionesExtra: String(v['instruccionesExtra'] ?? ''),
        paleta: String(v['paleta'] ?? PALETA_POR_DEFECTO),
      });
      setCatalogoWeb(v['catalogoWebActivo'] === true);
    }, () => setEstado('No se pudo leer la configuración.'));
  }, [tenantId]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'config', 'negocio'), {
        ...datos,
        catalogoWebActivo: catalogoWeb,
        zonaHoraria: 'America/La_Paz',
        moneda: 'BOB',
        // El sello lo verifica la regla: `actualizadoPor == request.auth.uid` y
        // `actualizadoEn == request.time`. No se puede falsear desde el cliente.
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      });
      setEstado('Guardado.');
    } catch {
      setEstado('El servidor rechazó el cambio. Revise los datos.');
    }
  };

  const opcion = (clave: string, etiqueta: string, opciones: [string, string][]) => (
    <label>
      {etiqueta}
      <select value={datos[clave] ?? ''}
              onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })}>
        {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );


  const campo = (clave: string, etiqueta: string, multilinea = false) => (
    <label>
      {etiqueta}
      {multilinea
        ? <textarea
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />
        : <input
            value={datos[clave] ?? ''}
            maxLength={TOPES[clave] ?? 200}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />}
    </label>
  );

  return (
    <section>
      <h2>Configuración del negocio</h2>
      <form onSubmit={guardar}>
        {campo('nombreNegocio', 'Nombre del negocio')}
        {campo('descripcion', 'Descripción', true)}

        {campo('direccion', 'Dirección del local')}
        <p className="ayuda aviso-datos">
          Si deja este campo vacío, el asistente <strong>va a decir que no tiene
          el dato y que lo consulta con recepción</strong>. Es lo correcto: el
          28 de agosto, sin este campo, el asistente inventó una dirección. Un
          dato equivocado acá hace que un cliente se presente donde no debe.
        </p>

        {campo('numeroRecepcion', 'Número de recepción (sin +, solo dígitos)')}
        {/* El calendario del negocio vive en el documento común por historia
            (el flujo de citas lo lee de acá), pero solo tiene sentido con
            reservas: a un restaurante no se le pide una agenda. */}
        {conAgenda && campo('calendarioId', 'ID del calendario de Google (agenda del negocio)')}
        {campo('politicaCancelacion', 'Política de cancelación', true)}

        <h3>Voz del asistente</h3>
        {opcion('tratamiento', 'Cómo trata al cliente', [
          ['usted', 'De usted'], ['tu', 'De tú'], ['neutro', 'Impersonal'],
        ])}
        {opcion('estiloEmojis', 'Emojis', [
          ['ninguno', 'Ninguno'], ['pocos', 'Pocos'], ['muchos', 'Varios'],
        ])}
        <p className="ayuda">
          Son opciones cerradas y no campos de texto a propósito: lo que se elige
          acá entra en las instrucciones del asistente, y una lista cerrada no se
          puede usar para darle órdenes.
        </p>

        <h3>Mensajes fijos</h3>
        {campo('mensajeCierre', 'Al cerrar la conversación', true)}
        {campo('mensajeErrorTemporal', 'Si algo falla temporalmente', true)}
        {campo('mensajeReservaNoConfirmada', 'Si no se pudo confirmar una reserva', true)}
        {campo('mensajeComercioSuspendido', 'Si el servicio está suspendido', true)}
        <p className="ayuda">
          El mensaje de suspensión solo se puede escribir mientras el servicio
          está activo. Conviene dejarlo preparado.
        </p>

        {/* ==================================================================
            CATÁLOGO WEB PROPIO.

            POR QUÉ ESTÁ EN ESTA PANTALLA Y NO EN LA DEL CATÁLOGO. Lo de acá es
            IDENTIDAD —el logo y el color con los que el negocio se presenta—,
            no contenido del catálogo. Y por la política de capas
            (DISENO.md §4sexies) la identidad es común a cualquier flujo: el día
            que un salón derive a un catálogo de servicios, esto ya sirve sin
            mudar nada.

            POR QUÉ LA MARCA ES DEL COMERCIO. Decidido con Andres: el cliente
            final cree —con razón— que está hablando con la panadería. Si al
            tocar el enlace aparece una marca que no le presentaron, duda, y una
            duda en el momento de pagar es una venta perdida. NovuChat va en el
            pie de la página, chico y visible.
            ================================================================== */}
        {conVenta && (<>
          <h3>Catálogo web</h3>
          <label className="campo-casilla">
            <input type="checkbox" checked={catalogoWeb}
                   onChange={(e) => setCatalogoWeb(e.target.checked)} />
            <span>
              Publicar mi catálogo como página web, para que el asistente pueda
              mandarle el enlace a un cliente.
            </span>
          </label>
          <p className="ayuda">
            El cliente navega, elige y confirma en la página, y{' '}
            <strong>el pedido vuelve solo a la conversación de WhatsApp</strong>:
            no tiene que copiar ni pegar nada, y no puede cambiar los precios en el
            camino. Cada enlace sirve para una conversación y vence a los tres días.
          </p>
          <p className="ayuda">
            Se publica lo que esté <strong>activo y con precio</strong> en la
            pestaña de catálogo, con su foto. Lo que esté dado de baja no aparece,
            y <strong>lo que quedó «a consultar» tampoco</strong>: en una página
            con botón de comprar, un ítem sin precio genera una consulta que el
            asistente no puede cerrar. Esos se siguen ofreciendo por chat, que es
            donde se pueden cotizar.
          </p>

          <LogoDelComercio tenantId={tenantId} />

          <fieldset className="paletas">
            <legend>Colores de la página</legend>
            {(Object.keys(PALETAS) as PaletaId[]).map((id) => {
              const p = PALETAS[id];
              const elegida = (datos['paleta'] ?? PALETA_POR_DEFECTO) === id;
              return (
                <label key={id} className="paleta" aria-current={elegida}>
                  <input type="radio" name="paleta" value={id} checked={elegida}
                         onChange={() => setDatos({ ...datos, paleta: id })} />
                  <span className="paleta-muestra" aria-hidden="true">
                    <span style={{ background: p.base }} />
                    <span style={{ background: p.oscuro }} />
                    <span style={{ background: p.suave }} />
                  </span>
                  <span className="paleta-texto">
                    <strong>{p.nombre}</strong>
                    <span className="text-muted">{p.sugerencia}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p className="ayuda">
            Son cinco y no un selector de color libre, por dos razones. La página
            necesita <strong>tres</strong> tonos que combinen —el botón, el botón
            presionado y el fondo de las categorías—, y elegirlos de a uno termina
            casi siempre en texto que no se lee sobre su fondo. Estas cinco están
            medidas: en todas, lo escrito se lee.
          </p>
        </>)}

        {/* AQUI IBA «Indicaciones para el asistente». Se quito el 2026-09-06:
            el texto de ayuda prometia que las indicaciones se le entregan al
            asistente «dentro de una seccion rotulada del prompt», y el flujo NO
            las leia. Prometer eso y no cumplirlo es peor que no ofrecer la
            casilla, sobre todo porque es donde un negocio pondria una promocion
            y despues no entenderia por que el asistente no la menciona.

            Vuelve cuando el flujo lea su configuracion de la consola, y tiene
            que volver DELIMITADA y rotulada como dato: es texto libre de un
            tercero entrando al prompt. La deuda esta en ESTADO.md. */}
        <button type="submit">Guardar</button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}


/**
 * =============================================================================
 * EL LOGO — se sube desde acá, y se guarda dentro del documento
 * =============================================================================
 *
 * POR QUÉ NO HAY UN DEPÓSITO DE ARCHIVOS DETRÁS. Montar Firebase Storage —su
 * bucket, sus reglas, su CORS— para UN archivo por comercio es mucha superficie
 * nueva, y convierte a NovuChat en custodio de archivos de terceros. Un logo
 * recortado a 320 px entra en unas decenas de kilobytes, muy por debajo del
 * máximo de 1 MiB de un documento de Firestore. Es la misma economía que llevó
 * a referenciar las fotos de los productos por URL en vez de alojarlas; la
 * diferencia es que un logo es uno solo, y el comercio no siempre tiene dónde
 * publicarlo — que era justamente el problema de pedirle una dirección.
 *
 * SE RECORTA EN EL NAVEGADOR, ANTES DE SUBIR. La foto que sale de un celular
 * son tres o cuatro megas: sin recortar no entraría en el documento, y el
 * comercio se toparía con un rechazo del servidor sin entender por qué. Acá se
 * reduce a 320 px del lado más largo y se baja la calidad hasta que entre.
 *
 * VIVE EN `/config/marca`, NO EN `/config/negocio`. `configuracionFlujo` lee
 * `negocio` en CADA consulta del flujo de n8n: el logo ahí le agregaría decenas
 * de kilobytes a cada mensaje que responde el asistente, para un dato que el
 * asistente no usa nunca.
 */
function LogoDelComercio({ tenantId }: { tenantId: string }) {
  const [logo, setLogo] = useState('');
  const [estado, setEstado] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'marca'),
      (d) => setLogo(String(d.data()?.['logo'] ?? '')),
      () => setEstado('No se pudo leer el logo.'));
  }, [tenantId]);

  const guardar = async (valor: string) => {
    await setDoc(doc(db, 'tenants', tenantId, 'config', 'marca'), {
      logo: valor,
      actualizadoPor: auth.currentUser?.uid ?? '',
      actualizadoEn: serverTimestamp(),
    });
  };

  const alElegir = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setEstado(null);
    setSubiendo(true);
    try {
      const datos = await recortar(f);
      await guardar(datos);
      setEstado('Logo actualizado. Ya se ve en tu catálogo web.');
    } catch (error) {
      setEstado(error instanceof Error ? error.message
        : 'No se pudo leer esa imagen. Probá con un PNG o un JPG.');
    } finally {
      setSubiendo(false);
      if (archivo.current) archivo.current.value = '';
    }
  };

  const quitar = async () => {
    setEstado(null);
    try {
      await guardar('');
      setEstado('Logo quitado.');
    } catch { setEstado('No se pudo quitar el logo.'); }
  };

  return (
    <div className="campo-logo">
      <label>Logo del negocio
        <input ref={archivo} className="input" type="file"
               accept="image/png,image/jpeg,image/webp"
               onChange={(e) => void alElegir(e)} disabled={subiendo} />
      </label>
      {logo !== '' && (
        <div className="logo-previa">
          {/* Es la imagen que el comercio acaba de elegir y ya está recortada
              por este mismo código; se muestra tal cual para que vea lo que sus
              clientes van a ver, con el mismo encuadre que usa la página. */}
          <img src={logo} alt="Logo cargado" />
          <button type="button" className="btn btn-ghost" onClick={() => void quitar()}>
            Quitar
          </button>
        </div>
      )}
      <p className="ayuda">
        Un PNG o un JPG. Se recorta solo a 320 píxeles, así que no hace falta
        que lo prepares: subí el que tengas. Se ve arriba de todo en la página
        que abren tus clientes.
      </p>
      {subiendo && <p role="status">Procesando la imagen…</p>}
      {estado && <p role="status">{estado}</p>}
    </div>
  );
}

/** Tope del campo en las reglas. Acá se usa para saber cuándo seguir bajando. */
const TOPE_LOGO = 200_000;

/**
 * Reduce la imagen a 320 px del lado más largo y devuelve `data:image/…`.
 *
 * BAJA LA CALIDAD HASTA QUE ENTRE, en vez de rechazar. Un logo con mucho
 * detalle o con transparencia puede pasarse del tope incluso a 320 px; probar
 * con calidades decrecientes resuelve el caso sin que el comercio tenga que
 * saber qué es un kilobyte. Si aun así no entra, se lo dice con una salida.
 */
async function recortar(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const i = new Image();
      i.onload = () => resolver(i);
      i.onerror = () => rechazar(new Error('Ese archivo no es una imagen que podamos leer.'));
      i.src = url;
    });

    const LADO = 320;
    const escala = Math.min(1, LADO / Math.max(img.naturalWidth, img.naturalHeight));
    const lienzo = document.createElement('canvas');
    lienzo.width = Math.max(1, Math.round(img.naturalWidth * escala));
    lienzo.height = Math.max(1, Math.round(img.naturalHeight * escala));
    const ctx = lienzo.getContext('2d');
    if (!ctx) throw new Error('El navegador no pudo procesar la imagen.');
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);

    // WebP primero por tamaño; si el navegador no sabe codificarlo, `toDataURL`
    // devuelve un PNG en silencio, que la validación acepta igual.
    for (const calidad of [0.9, 0.75, 0.6, 0.45]) {
      const datos = lienzo.toDataURL('image/webp', calidad);
      if (datos.length <= TOPE_LOGO) return datos;
    }
    throw new Error('Esa imagen es demasiado pesada incluso reducida. '
      + 'Probá con una más simple o con menos detalle.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
