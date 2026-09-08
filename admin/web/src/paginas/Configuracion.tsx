import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useParams } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { useFlujos } from '../lib/flujos';

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
  logoUrl: 500, colorMarca: 7,
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
        logoUrl: String(v['logoUrl'] ?? ''),
        colorMarca: String(v['colorMarca'] ?? ''),
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

          {campo('logoUrl', 'Logo (dirección https de una imagen)')}
          <label>
            Color de la marca
            <span className="campo-color">
              <input type="color" value={datos['colorMarca'] || '#ec3013'}
                     onChange={(e) => setDatos({ ...datos, colorMarca: e.target.value })} />
              <input value={datos['colorMarca'] ?? ''} maxLength={7} placeholder="#000000"
                     onChange={(e) => setDatos({ ...datos, colorMarca: e.target.value })} />
            </span>
          </label>
          <p className="ayuda">
            Seis dígitos hexadecimales, como <code>#1b7f4f</code>. Es el único
            formato que se acepta: cualquier otra cosa se rechaza al guardar.
            Si lo dejás vacío, la página usa un color neutro.
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
