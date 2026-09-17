import { useEffect, useRef, useState } from 'react';
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
  direccionMaps: 'https://maps.app.goo.gl/AbCdEfGh12',
  numeroRecepcion: '59170000000',
  calendarioId: 'algo@group.calendar.google.com',
  politicaCancelacion: 'Se puede cancelar hasta 2 horas antes sin costo.',
  mensajeCierre: '¡Gracias por escribirnos! Que tenga buen día.',
  mensajeErrorTemporal: 'Disculpe, tuvimos un problema. ¿Puede intentar en unos minutos?',
  mensajeReservaNoConfirmada: 'No pude confirmar la reserva. Le escribe recepción en un momento.',
  mensajeComercioSuspendido: 'Por ahora no estamos atendiendo por este medio.',
};

const TOPES: Record<string, number> = {
  nombreNegocio: 80, descripcion: 400, direccion: 200, direccionMaps: 200, numeroRecepcion: 15,
  calendarioId: 120, politicaCancelacion: 600, instruccionesExtra: 1500,
  mensajeCierre: 300, mensajeErrorTemporal: 300,
  mensajeReservaNoConfirmada: 300, mensajeComercioSuspendido: 300,
};

/**
 * =============================================================================
 * DÓNDE QUEDA EL LOCAL: enlace de Google Maps y coordenadas del pin
 * (Analisis/34 §2)
 * =============================================================================
 *
 * EL ENLACE ES LO ÚNICO QUE EL ASISTENTE REENVÍA TAL CUAL a un cliente final,
 * dentro de la confirmación de cada cita. Por eso no es texto libre: solo
 * `https://` de un dominio de mapas de Google. La regla de `firestore.rules`
 * (`enlaceDeMapaValido`) y el servidor (`prompt.ts`) usan la MISMA lista; acá
 * se repite para que el comercio no descubra el rechazo con un error rojo. Va
 * en el mismo mensaje que la dirección: no agrega mensajes.
 *
 * LAS COORDENADAS SE GUARDAN COMO NÚMEROS, NUNCA COMO TEXTO, y por eso no caben
 * en `datos` (que guarda solo cadenas): van aparte, como el horario. Con una
 * sola de las dos no se guarda nada: un pin con media coordenada cae en el
 * mar, y Meta lo cobra igual. Solo se usan cuando el cliente pide el pin, que
 * es un mensaje más y solo en ese caso.
 */
const ENLACE_DE_MAPA =
  /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;

type Coordenadas = { lat: string; lng: string };
const SIN_COORDENADAS: Coordenadas = { lat: '', lng: '' };

function leerUbicacion(valor: unknown): Coordenadas {
  if (typeof valor !== 'object' || valor === null) return SIN_COORDENADAS;
  const { lat, lng } = valor as Record<string, unknown>;
  return (typeof lat === 'number' && typeof lng === 'number')
    ? { lat: String(lat), lng: String(lng) } : SIN_COORDENADAS;
}

/**
 * `null` si está bien: las dos vacías (no hay pin) o las dos en rango. Si no,
 * qué corregir. Devuelve también el par numérico listo para guardar.
 */
function leerCoordenadas(c: Coordenadas): { error: string | null; ubicacion: { lat: number; lng: number } | null } {
  const lat = c.lat.trim();
  const lng = c.lng.trim();
  if (lat === '' && lng === '') return { error: null, ubicacion: null };
  if (lat === '' || lng === '') {
    return { error: 'Cargue la latitud y la longitud juntas, o deje las dos vacías.', ubicacion: null };
  }
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) {
    return { error: 'La latitud y la longitud tienen que ser números, con punto decimal (por ejemplo -17.7833).', ubicacion: null };
  }
  if (Math.abs(nLat) > 90 || Math.abs(nLng) > 180) {
    return { error: 'La latitud va de -90 a 90 y la longitud de -180 a 180.', ubicacion: null };
  }
  return { error: null, ubicacion: { lat: nLat, lng: nLng } };
}

/**
 * =============================================================================
 * HORARIO DE ATENCIÓN
 * =============================================================================
 *
 * EL FORMATO GUARDADO ES EL QUE YA LEEN LOS DEMÁS, sin cambiar nada: un mapa
 * `horarios` con claves `lun … dom` y valores `'HH:MM-HH:MM'` o `'cerrado'`.
 * Lo leen `horarioAtencion()` (functions/src/prompt.ts), que arma la frase que
 * el asistente le dice al cliente, y `horarioDeHoy()` en el Tablero.
 *
 * UN DÍA SIN DATOS NO SE GUARDA. No es lo mismo que «cerrado»: «cerrado» es un
 * dato que el asistente dice; un día sin clave es un día del que no sabemos
 * nada, y la frase lo omite. Si no hay ningún día, `datosQueNoTenemos()` avisa
 * al asistente que no tiene el horario, y no lo inventa.
 *
 * LA REGLA DE `firestore.rules` REPITE ESTA VALIDACIÓN (`horarioDiaValido`), y
 * es la que manda: acá solo se evita que el comercio descubra el formato con un
 * rechazo del servidor.
 */
const DIAS_SEMANA = [
  ['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'],
  ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo'],
] as const;

type DiaHorario = {
  cerrado: boolean;
  desde: string;
  hasta: string;
  /** Lo que había guardado y no se pudo leer, para decírselo al comercio. */
  ilegible?: string;
};

const RANGO_HORARIO = /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/;
const DIA_VACIO: DiaHorario = { cerrado: false, desde: '', hasta: '' };

function leerHorarios(valor: unknown): Record<string, DiaHorario> {
  const crudo = (typeof valor === 'object' && valor !== null)
    ? valor as Record<string, unknown> : {};
  const salida: Record<string, DiaHorario> = {};
  for (const [clave] of DIAS_SEMANA) {
    const v = crudo[clave];
    if (v === undefined) { salida[clave] = DIA_VACIO; continue; }
    if (v === 'cerrado') { salida[clave] = { ...DIA_VACIO, cerrado: true }; continue; }
    const rango = typeof v === 'string' ? RANGO_HORARIO.exec(v) : null;
    salida[clave] = rango
      ? { cerrado: false, desde: rango[1]!, hasta: rango[3]! }
      // Un valor viejo con otro formato (cargado por script, antes de que la
      // regla lo cerrara) se muestra vacío y se avisa: guardarlo tal cual haría
      // que el servidor rechazara TODO el formulario sin decir por qué.
      : { ...DIA_VACIO, ilegible: String(v).slice(0, 40) };
  }
  return salida;
}

/** `null` si el día está bien (o sin datos). Si no, qué corregir. */
function errorDelDia(d: DiaHorario): string | null {
  if (d.cerrado) return null;
  if (d.desde === '' && d.hasta === '') return null;
  if (d.desde === '') return 'Falta la hora de apertura.';
  if (d.hasta === '') return 'Falta la hora de cierre.';
  // Se compara como texto: con «HH:MM» de largo fijo da el mismo orden que
  // las horas. Es la misma comparación que hace la regla.
  if (d.desde >= d.hasta) return 'La hora de apertura tiene que ser anterior a la de cierre.';
  return null;
}

function escribirHorarios(h: Record<string, DiaHorario>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave] of DIAS_SEMANA) {
    const d = h[clave] ?? DIA_VACIO;
    if (d.cerrado) salida[clave] = 'cerrado';
    else if (d.desde !== '' && d.hasta !== '') salida[clave] = `${d.desde}-${d.hasta}`;
  }
  return salida;
}

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
  // El horario tampoco cabe en `datos`: son siete días con tres piezas cada
  // uno, y se arma como texto recién al guardar.
  const [horarios, setHorarios] = useState<Record<string, DiaHorario>>(() => leerHorarios({}));
  // Las coordenadas del pin tampoco caben en `datos`: se guardan como NÚMEROS
  // dentro de un mapa `ubicacion`, y `datos` escribe cadenas. Ver arriba.
  const [coordenadas, setCoordenadas] = useState<Coordenadas>(SIN_COORDENADAS);
  // Y, como con el nombre del asistente, los dos se escriben solo si traen
  // valor o si el documento ya los tenía (para poder vaciarlos): así un
  // comercio que no los usa guarda su configuración igual aunque la consola
  // llegue a producción antes que la regla que admite los campos.
  const [teniaUbicacion, setTeniaUbicacion] = useState({ direccionMaps: false, ubicacion: false });
  // NOMBRE DEL ASISTENTE, aparte de `datos` por una razón de despliegue: solo
  // se escribe si tiene texto o si el documento ya lo tenía (para poder
  // vaciarlo). Así un comercio que nunca lo usa guarda su configuración igual
  // aunque la consola llegue a producción antes que la regla que admite el
  // campo, y no descubre el desfase con un «el servidor rechazó el cambio».
  const [nombreAsistente, setNombreAsistente] = useState('');
  const [teniaNombreAsistente, setTeniaNombreAsistente] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'negocio'), (d) => {
      const v = d.data() ?? {};
      setDatos({
        nombreNegocio: String(v['nombreNegocio'] ?? ''),
        descripcion: String(v['descripcion'] ?? ''),
        direccion: String(v['direccion'] ?? ''),
        direccionMaps: String(v['direccionMaps'] ?? ''),
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
      setHorarios(leerHorarios(v['horarios']));
      setCoordenadas(leerUbicacion(v['ubicacion']));
      setTeniaUbicacion({
        direccionMaps: Object.prototype.hasOwnProperty.call(v, 'direccionMaps'),
        ubicacion: Object.prototype.hasOwnProperty.call(v, 'ubicacion'),
      });
      setNombreAsistente(typeof v['nombreAsistente'] === 'string' ? v['nombreAsistente'] : '');
      setTeniaNombreAsistente(Object.prototype.hasOwnProperty.call(v, 'nombreAsistente'));
    }, () => setEstado('No se pudo leer la configuración.'));
  }, [tenantId]);

  const cambiarDia = (clave: string, cambio: Partial<DiaHorario>) =>
    setHorarios((h) => ({
      ...h,
      // Cualquier cambio en el día descarta el aviso de «no se pudo leer»:
      // el comercio ya lo está corrigiendo.
      [clave]: { ...(h[clave] ?? DIA_VACIO), ...cambio, ilegible: undefined },
    }));

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEstado(null);
    if (DIAS_SEMANA.some(([clave]) => errorDelDia(horarios[clave] ?? DIA_VACIO) !== null)) {
      setEstado('Revisa el horario de atención: hay un día con las horas incompletas o al revés.');
      return;
    }
    // Una sola línea y hasta 40 caracteres, igual que la regla. El salto de
    // línea no llega desde un `<input>`, pero sí pegando texto: se aplana.
    const nombre = nombreAsistente.replace(/[\r\n]+/g, ' ').trim();
    if (nombre.length > 40) {
      setEstado('El nombre del asistente puede tener hasta 40 caracteres.');
      return;
    }
    // El enlace del mapa: la misma lista de dominios que la regla. El `pattern`
    // del campo ya lo frena en el navegador; esto es para decir POR QUÉ, en vez
    // de un «el servidor rechazó el cambio».
    const direccionMaps = (datos['direccionMaps'] ?? '').trim();
    if (direccionMaps !== '' && !ENLACE_DE_MAPA.test(direccionMaps)) {
      setEstado('El enlace del mapa tiene que ser el que da Google Maps al tocar Compartir → Copiar enlace (empieza con https://maps.app.goo.gl/ o https://www.google.com/maps/). No se aceptan enlaces a otros sitios: el asistente se lo manda a sus clientes.');
      return;
    }
    const { error: errorCoordenadas, ubicacion } = leerCoordenadas(coordenadas);
    if (errorCoordenadas !== null) {
      setEstado(errorCoordenadas);
      return;
    }
    try {
      await updateDoc(doc(db, 'tenants', tenantId, 'config', 'negocio'), {
        ...datos,
        ...(direccionMaps !== '' || teniaUbicacion.direccionMaps ? { direccionMaps } : {}),
        // NÚMEROS en un mapa, o el campo se quita: nunca la cadena vacía, que
        // la regla rechaza, ni un par a medias.
        ...(ubicacion ? { ubicacion } : teniaUbicacion.ubicacion ? { ubicacion: deleteField() } : {}),
        ...(nombre !== '' || teniaNombreAsistente ? { nombreAsistente: nombre } : {}),
        // El mapa se reemplaza entero: un día que se vació desaparece del
        // documento, en vez de quedar con el horario viejo.
        horarios: escribirHorarios(horarios),
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

        {/* EL ENLACE Y EL PIN, DEBAJO DE LA DIRECCIÓN. El enlace va en el MISMO
            mensaje que la confirmación de la cita: no cuesta un mensaje más.
            El pin sí (uno, y solo cuando el cliente lo pide), y se le dice. */}
        {grupo('Enlace de Google Maps (opcional)', (
          <input value={datos['direccionMaps'] ?? ''} maxLength={TOPES['direccionMaps']}
                 placeholder={EJEMPLOS['direccionMaps']} inputMode="url"
                 pattern="https://(maps\.app\.goo\.gl|goo\.gl/maps|www\.google\.com/maps|google\.com/maps|maps\.google\.com)([/?].*)?"
                 title="El enlace que da Google Maps al tocar Compartir → Copiar enlace"
                 onChange={(e) => setDatos({ ...datos, direccionMaps: e.target.value })} />
        ), <>Se incluye, junto con la dirección, <strong>en la confirmación de cada
          cita</strong> y cuando un cliente pregunta dónde quedan. Para obtenerlo:
          busque su local en Google Maps, toque <strong>Compartir → Copiar
          enlace</strong> y péguelo acá. Solo se aceptan enlaces de Google Maps.</>)}
        {grupo('Latitud (opcional)', (
          <input type="number" step="any" min={-90} max={90} inputMode="decimal"
                 placeholder="-17.7833" value={coordenadas.lat}
                 onChange={(e) => setCoordenadas({ ...coordenadas, lat: e.target.value })} />
        ))}
        {grupo('Longitud (opcional)', (
          <input type="number" step="any" min={-180} max={180} inputMode="decimal"
                 placeholder="-63.1821" value={coordenadas.lng}
                 onChange={(e) => setCoordenadas({ ...coordenadas, lng: e.target.value })} />
        ), <>Solo se usan cuando un cliente pide <strong>que le manden la
          ubicación</strong>: el asistente le envía el pin de WhatsApp, que es un
          mensaje más y se cuenta como tal. Para obtenerlas: en Google Maps, clic
          derecho sobre su local y copie las coordenadas (el primer número es la
          latitud). Las dos juntas o ninguna.</>)}

        {campo('numeroRecepcion', 'Número de recepción (sin +, solo dígitos)')}
        {/* El calendario del negocio vive en el documento común por historia
            (el flujo de citas lo lee de acá), pero solo tiene sentido con
            reservas: a un restaurante no se le pide una agenda. */}
        {conAgenda && campo('calendarioId', 'ID del calendario de Google (agenda del negocio)')}
        {campo('politicaCancelacion', 'Política de cancelación', undefined, true)}

        <h3>Horario de atención (opcional)</h3>
        <p className="ayuda">
          El asistente usa este horario para responder «¿a qué hora atienden?».
          Marca <strong>Cerrado</strong> los días que no abres; un día que dejas
          sin datos no se menciona. <strong>Es opcional</strong>: si no tienes
          horario fijo, deja todos los días vacíos y el asistente no mencionará
          horarios.
          {conAgenda && <> Si en «Agenda» no cargaste a nadie, las citas también
          se ofrecen dentro de este horario.</>}
        </p>
        <fieldset className="horario">
          <legend>Días y horas</legend>
          {DIAS_SEMANA.map(([clave, nombre]) => {
            const d = horarios[clave] ?? DIA_VACIO;
            const error = errorDelDia(d);
            return (
              <div key={clave} className="horario-dia">
                <strong>{nombre}</strong>
                <label className="campo-casilla">
                  <input type="checkbox" checked={d.cerrado}
                         onChange={(e) => cambiarDia(clave, { cerrado: e.target.checked })} />
                  <span>Cerrado</span>
                </label>
                <div className="horario-horas">
                  {/* Paso de 15 minutos: nadie abre a las 9:07. Las horas se
                      conservan al marcar «Cerrado», para que desmarcarlo no
                      obligue a escribirlas de nuevo. */}
                  <label>desde
                    <input type="time" step={900} value={d.desde} disabled={d.cerrado}
                           aria-label={`${nombre}, desde`} aria-invalid={error !== null}
                           onChange={(e) => cambiarDia(clave, { desde: e.target.value })} />
                  </label>
                  <label>hasta
                    <input type="time" step={900} value={d.hasta} disabled={d.cerrado}
                           aria-label={`${nombre}, hasta`} aria-invalid={error !== null}
                           onChange={(e) => cambiarDia(clave, { hasta: e.target.value })} />
                  </label>
                </div>
                {error && <p role="alert" className="ayuda aviso-datos">{error}</p>}
                {d.ilegible !== undefined && (
                  <p role="alert" className="ayuda aviso-datos">
                    Lo que había guardado («{d.ilegible}») no tiene un formato que el
                    asistente pueda leer. Vuelve a cargar este día; si guardas sin
                    tocarlo, queda sin datos.
                  </p>
                )}
              </div>
            );
          })}
        </fieldset>
        <p className="ayuda">
          Un horario que pasa la medianoche (por ejemplo, de 18:00 a 02:00) todavía
          no se puede cargar. Por ahora, carga el cierre a las 23:45 y aclara el
          horario real en la descripción del negocio.
        </p>

        <h3>Voz del asistente</h3>
        {/* CAPA COMÚN: el nombre vale para TODOS los flujos del negocio
            (reservas, pedidos, captación), por eso vive acá y no en la pestaña
            de un flujo. NovuChat usa «Kenji». */}
        {grupo('Nombre del asistente (opcional)', (
          <input value={nombreAsistente} maxLength={40} placeholder="Sofía"
                 onChange={(e) => setNombreAsistente(e.target.value.replace(/[\r\n]+/g, ' '))} />
        ), <>Es el nombre con el que se presenta en todas tus conversaciones. Si
          lo dejas vacío, se presenta como «el asistente virtual
          de {(datos['nombreNegocio'] ?? '').trim() || 'tu negocio'}». Ponerle
          nombre no lo hace pasar por una persona: el asistente siempre dice que
          es una inteligencia artificial.</>)}
        {opcion('tratamiento', 'Cómo trata al cliente', [
          ['usted', 'De usted'], ['tu', 'De tú'],
          ['vos', 'De vos (Santa Cruz)'], ['neutro', 'Impersonal'],
        ])}
        <p className="ayuda">
          En Bolivia el trato cambia por región: en La Paz se usa <em>usted</em> o
          <em> tú</em>, en Santa Cruz se vosea. Es de las cosas que tu cliente
          nota en el primer mensaje.
        </p>
        {opcion('estiloEmojis', 'Emojis', [
          ['ninguno', 'Ninguno'], ['pocos', 'Pocos'], ['muchos', 'Varios'],
        ])}

        <h3>Mensajes fijos</h3>
        {campo('mensajeCierre', 'Al cerrar la conversación', undefined, true)}
        {campo('mensajeErrorTemporal', 'Si algo falla temporalmente', undefined, true)}
        {campo('mensajeReservaNoConfirmada', 'Si no se pudo confirmar una reserva', undefined, true)}
        {campo('mensajeComercioSuspendido', 'Si el servicio está suspendido',
          <>Solo se puede escribir mientras el servicio está activo. Conviene
          dejarlo preparado.</>, true)}

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
        : 'No se pudo leer esa imagen. Intenta con un PNG o un JPG.');
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
        que lo prepares: sube el que tengas. Se ve arriba de todo en la página
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
      + 'Intenta con una más simple o con menos detalle.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
