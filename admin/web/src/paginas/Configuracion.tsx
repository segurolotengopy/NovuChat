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
/**
 * EL EJEMPLO EN GRIS DE CADA CAMPO.
 *
 * Es una PISTA, no una etiqueta: desaparece al escribir, así que nunca puede
 * llevar información que haga falta después. Lo que el campo significa vive en
 * su rótulo; acá va cómo se ve una respuesta buena, que es lo que resuelve la
 * duda de «¿y esto qué pongo?» sin obligar a leer un párrafo.
 *
 * Están escritos con datos bolivianos a propósito —una zona de La Paz, un
 * número que empieza con 591—: un ejemplo genérico no le dice a nadie con qué
 * formato espera el campo su respuesta.
 *
 * EL TELÉFONO LLEVA CEROS Y NO DÍGITOS «REALISTAS» a propósito: `verificar-saneo.sh`
 * marca cualquier secuencia de diez o más dígitos, y con razón —es la red que
 * atrapa un número de verdad copiado sin querer—. Los ejemplos con ceros están
 * en su lista de permitidos y se leen igual de claro. */
const EJEMPLOS: Record<string, string> = {
  nombreNegocio: 'Salón Aurora',
  descripcion: 'Peluquería y estética. Cortes, color y tratamientos.',
  direccion: 'Calacoto, Av. Ballivián 1035, entre calles 17 y 18',
  numeroRecepcion: '59170000000',
  calendarioId: 'algo@group.calendar.google.com',
  politicaCancelacion: 'Se puede cancelar hasta 2 horas antes sin costo.',
  mensajeCierre: '¡Gracias por escribirnos! Que tenga buen día.',
  mensajeErrorTemporal: 'Disculpe, tuvimos un problema. ¿Puede intentar en unos minutos?',
  mensajeReservaNoConfirmada: 'No pude confirmar la reserva. Le escribe recepción en un momento.',
  mensajeComercioSuspendido: 'Por ahora no estamos atendiendo por este medio.',
};

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
  const conAgenda = (useFlujos(tenantId) ?? []).includes('agendamiento');
  const [datos, setDatos] = useState<Record<string, string>>({});
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
      });
    }, () => setEstado('No se pudo leer la configuración.'));
  }, [tenantId]);

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'config', 'negocio'), {
        ...datos,
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

  /**
   * EL CAMPO Y SU AYUDA VIAJAN JUNTOS, dentro de un `.grupo`.
   *
   * No es un detalle de maquetación: el formulario se acomoda en varias
   * columnas según el ancho de la pantalla, y en una cuadrícula cada hijo cae
   * en una celda distinta. Con la ayuda suelta al lado del campo, la
   * advertencia de «Dirección del local» aterrizaba debajo de OTRO campo, o
   * cruzada de lado a lado debajo de la fila entera. Un aviso que dice «si deja
   * este campo vacío» tiene que estar pegado al campo del que habla.
   */
  const grupo = (etiqueta: string, control: React.ReactNode, ayuda?: React.ReactNode) => (
    <div className="grupo">
      <label>
        {etiqueta}
        {control}
      </label>
      {ayuda && <p className="ayuda">{ayuda}</p>}
    </div>
  );

  const opcion = (clave: string, etiqueta: string, opciones: [string, string][],
                  ayuda?: React.ReactNode) => grupo(etiqueta, (
    <select value={datos[clave] ?? ''}
            onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })}>
      {opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  ), ayuda);

  const campo = (clave: string, etiqueta: string, ayuda?: React.ReactNode,
                 multilinea = false) => grupo(etiqueta, multilinea
    ? <textarea
        value={datos[clave] ?? ''}
        maxLength={TOPES[clave] ?? 200}
        placeholder={EJEMPLOS[clave]}
        onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />
    : <input
        value={datos[clave] ?? ''}
        maxLength={TOPES[clave] ?? 200}
        placeholder={EJEMPLOS[clave]}
        inputMode={clave === 'numeroRecepcion' ? 'numeric' : undefined}
        onChange={(e) => setDatos({ ...datos, [clave]: e.target.value })} />,
    ayuda);

  return (
    <section>
      <h2>Configuración del negocio</h2>
      <form onSubmit={guardar}>
        {campo('nombreNegocio', 'Nombre del negocio')}
        {campo('descripcion', 'Descripción', undefined, true)}

        {/* ESTE TEXTO LO LEE EL CLIENTE, NO NOSOTROS. Antes decía «el 28 de
            agosto, sin este campo, el asistente inventó una dirección»: es
            NUESTRA bitácora de un defecto NUESTRO, y en la pantalla del
            comercio se lee como si el accidente hubiera sido en su negocio.
            La consola no es el lugar donde contamos nuestros incidentes.
            Lo que sí tiene que saber el comercio es qué pasa si lo deja
            vacío, y eso queda. */}
        {campo('direccion', 'Dirección del local',
          <>Si lo deja vacío, el asistente <strong>dice que no tiene el dato y que
          lo consulta con recepción</strong>: nunca inventa una dirección.
          Conviene escribirla completa, con la zona y las referencias — un dato
          equivocado acá hace que un cliente se presente donde no debe.</>)}

        {campo('numeroRecepcion', 'Número de recepción (sin +, solo dígitos)')}
        {/* El calendario del negocio vive en el documento común por historia
            (el flujo de citas lo lee de acá), pero solo tiene sentido con
            reservas: a un restaurante no se le pide una agenda. */}
        {conAgenda && campo('calendarioId', 'ID del calendario de Google (agenda del negocio)')}
        {campo('politicaCancelacion', 'Política de cancelación', undefined, true)}

        <h3>Voz del asistente</h3>
        {opcion('tratamiento', 'Cómo trata al cliente', [
          ['usted', 'De usted'], ['tu', 'De tú'], ['neutro', 'Impersonal'],
        ])}
        {opcion('estiloEmojis', 'Emojis', [
          ['ninguno', 'Ninguno'], ['pocos', 'Pocos'], ['muchos', 'Varios'],
        ], <>Son opciones cerradas y no campos de texto a propósito: lo que se
        elige acá entra en las instrucciones del asistente, y una lista cerrada
        no se puede usar para darle órdenes.</>)}

        <h3>Mensajes fijos</h3>
        {campo('mensajeCierre', 'Al cerrar la conversación', undefined, true)}
        {campo('mensajeErrorTemporal', 'Si algo falla temporalmente', undefined, true)}
        {campo('mensajeReservaNoConfirmada', 'Si no se pudo confirmar una reserva', undefined, true)}
        {campo('mensajeComercioSuspendido', 'Si el servicio está suspendido',
          <>Solo se puede escribir mientras el servicio está activo. Conviene
          dejarlo preparado.</>, true)}

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
