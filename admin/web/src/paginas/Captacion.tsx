import { useEffect, useRef, useState } from 'react';
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import { auth, db, funciones, storage } from '../lib/firebase';
import {
  ACEPTA, EXTENSIONES, esDelDeposito, mensajeDeFallaStorage, nombreParaProspecto,
  rutaArchivoPlanes, validarArchivoPlanes, type ExtensionPlanes,
} from '../lib/archivoPlanes';
import { useFlujos } from '../lib/flujos';
import { idDeNombre } from '../lib/csv';
import { CampoMonto } from '../componentes/CampoMonto';
import { EditorLista } from '../componentes/EditorLista';
import { TextoSeguro } from '../componentes/TextoSeguro';

/**
 * CAPTACIÓN — la pestaña del flujo de captación de prospectos (`onboarding`).
 *
 * El flujo atiende a quien le escribe al número del comercio: se presenta con
 * el nombre del asistente (capa común, `config/negocio.nombreAsistente`),
 * pregunta si ya es cliente o si quiere conocer el servicio, deduce el rubro
 * del prospecto por el nombre de su empresa, le muestra los planes y cargos
 * del comercio y lo pasa a un asesor. Esta pantalla edita lo que el flujo lee
 * de `/config/onboarding`.
 *
 * QUIÉN LA VE, Y POR QUÉ CAMBIÓ EL 15/09. Nació el 13/09 como el flujo PROPIO
 * de NovuChat: su documento era de NovuChat, la regla le negaba la lectura
 * hasta al administrador del propio tenant `novuchat`, y la pestaña era solo
 * del propietario. Ese día Andres decidió que es un TERCER FLUJO GENÉRICO,
 * como reservas y pedidos: cualquier comercio que capte prospectos lo contrata
 * y lo configura su ADMINISTRADOR. El propietario sigue entrando, para
 * instalarlo y dar soporte. El operador no, como en las demás pantallas de
 * configuración de un flujo. Esconder la pestaña sigue siendo cosmético: quien
 * cierra la puerta es `firestore.rules`.
 *
 * EL TECHO DE COSTO NO SE EDITA ACÁ. Son los umbrales de operador y de bloqueo
 * de la cuenta (`cuenta/estado`), los mismos para todos los flujos
 * (`atencion.ts`). Acá solo está el fin del primer bloque, que es propio de
 * este flujo: en esa respuesta el asistente ofrece un asesor y sigue.
 *
 * TODO LO QUE SE MUESTRA LO USA EL FLUJO (DISENO.md §4sexies.0, punto 7). Un
 * campo ausente no apaga nada: el flujo usa su valor de respaldo de
 * `Config base`, que es el mismo que se muestra acá.
 *
 * LOS TOPES DE LAS LISTAS LOS HACE CUMPLIR LA REGLA (base comercial §7). Acá
 * se repiten para avisar ANTES: el contador «3 de 8», el botón de agregar
 * deshabilitado con su porqué, y el archivo de planes exigido con más de 5
 * planes antes de que el servidor rechace el guardado.
 *
 * SE GUARDA CON `setDoc` Y `merge`. El documento entero es de este flujo, así
 * que no hay campos de otro dueño que un reemplazo pudiera borrar; con
 * `merge`, además, sirve para crearlo si el alta del tenant fue anterior al
 * flujo. Las listas se escriben enteras (un `merge` no mezcla listas: las
 * reemplaza), y el archivo de planes se BORRA con `deleteField()` cuando se
 * vacía, porque un mapa sí se mezclaría y dejaría el enlace viejo.
 *
 * EL ARCHIVO SE SUBE O SE ENLAZA (15/09). Con Storage, «Subir PDF o imagen»
 * lo guarda en `tenants/{id}/captacion/planes.{pdf|jpg|png}` (nombre fijo:
 * subir otro reemplaza) y escribe en `archivoPlanes.url` la dirección de
 * `getDownloadURL`, que es la que descarga Meta. El enlace pegado a mano sigue
 * siendo la alternativa. La subida GUARDA LA PANTALLA ENTERA al terminar, como
 * «Comprobar archivo»: al reemplazar el objeto, el enlace guardado antes deja
 * de servir, así que dejar la dirección nueva sin guardar dejaría al asistente
 * con una rota. Por eso, antes de gastar datos en subir, se revisa que el resto
 * de la pantalla se pueda guardar. Los tipos y tamaños los valida
 * `lib/archivoPlanes.ts` en el navegador; la que manda es `storage.rules`.
 */

/** Sin bucket configurado la consola funciona igual, pero no puede subir. */
const SIN_DEPOSITO = 'La subida de archivos no está disponible en esta instalación de la '
  + 'consola: falta configurar el depósito de archivos. Mientras tanto, pega un enlace '
  + 'público más abajo, o avísale a NovuChat.';

const RESPALDO = {
  mensajeClienteActual:
    'Perfecto. Tu consola está en consola.novuchat.site: entra con el correo de tu ' +
    'cuenta. Si no recuerdas la contraseña, usa «Recuperar contraseña» en la misma ' +
    'pantalla. Si necesitas ayuda de una persona, toca el botón.',
  enlaceConsola: 'https://consola.novuchat.site',
  topeAviso: 25,
  plantillaAviso: 'solicitud_contacto',
};

/** Topes del contrato con `firestore.rules`. La regla es la que manda. */
const MAXIMO = { rubros: 8, planes: 20, cargosUnicos: 5, aclaraciones: 15 } as const;
/** Con más planes que estos, el asistente manda el archivo en vez de listarlos. */
const PLANES_SIN_ARCHIVO = 5;

type FlujoSugerido = 'agendamiento' | 'venta' | 'recordatorios' | 'a_medida';
type Periodo = 'mes' | 'anio' | 'unico';
type TipoArchivo = 'pdf' | 'imagen';

const FLUJOS_SUGERIDOS: [FlujoSugerido, string][] = [
  ['agendamiento', 'Citas y reservas'],
  ['venta', 'Ventas con cobro por QR'],
  ['recordatorios', 'Recordatorios'],
  ['a_medida', 'A medida'],
];
const PERIODOS: [Periodo, string][] = [['mes', 'por mes'], ['anio', 'por año'], ['unico', 'pago único']];
const TIPOS_ARCHIVO: [TipoArchivo, string][] = [['pdf', 'PDF'], ['imagen', 'Imagen']];

/* Las filas llevan `_k`, una clave SOLO para React (ver `EditorLista`). No se
   guarda: al escribir se arma cada objeto con los campos del contrato. */
interface Rubro { _k: string; nombre: string; solucion: string; flujoSugerido: FlujoSugerido }
interface Plan { _k: string; nombre: string; precioUsd: string; periodo: Periodo; incluye: string }
interface Cargo { _k: string; nombre: string; precioUsd: string; desde: boolean; detalle: string }
interface Aclaracion { _k: string; tema: string; texto: string }
interface Archivo { url: string; tipo: TipoArchivo; nombreArchivo: string }

type Datos = {
  mensajeClienteActual: string;
  enlaceConsola: string;
  topeAviso: string;
  plantillaAviso: string;
  rubros: Rubro[];
  planes: Plan[];
  cargosUnicos: Cargo[];
  aclaraciones: Aclaracion[];
  archivo: Archivo;
};
type CampoTexto = 'mensajeClienteActual' | 'enlaceConsola' | 'topeAviso' | 'plantillaAviso';

let contador = 0;
const nuevaClave = () => `k${(contador += 1)}`;

const texto = (v: unknown, respaldo: string | number) =>
  typeof v === 'string' || typeof v === 'number' ? String(v) : String(respaldo);
const cadena = (v: unknown) => (typeof v === 'string' ? v : '');
const numeroComoTexto = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const registros = (v: unknown): Record<string, unknown>[] => (Array.isArray(v)
  ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
  : []);
const deLaLista = <T extends string>(v: unknown, opciones: [T, string][], respaldo: T): T =>
  (opciones.some(([o]) => o === v) ? v as T : respaldo);

const URL_CONSOLA = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?#=&%-]*)?$/;
/** Enlace público del archivo de planes. Solo https: igual que las fotos del catálogo. */
const URL_ARCHIVO = /^https:\/\/[^\s'"<>]+$/;

function leer(v: Record<string, unknown>): Datos {
  const archivo = typeof v['archivoPlanes'] === 'object' && v['archivoPlanes'] !== null
    ? v['archivoPlanes'] as Record<string, unknown> : {};
  return {
    mensajeClienteActual: texto(v['mensajeClienteActual'], RESPALDO.mensajeClienteActual),
    enlaceConsola: texto(v['enlaceConsola'], RESPALDO.enlaceConsola),
    topeAviso: texto(v['topeAviso'], RESPALDO.topeAviso),
    plantillaAviso: texto(v['plantillaAviso'], RESPALDO.plantillaAviso),
    rubros: registros(v['rubros']).map((r) => ({
      _k: nuevaClave(), nombre: cadena(r['nombre']), solucion: cadena(r['solucion']),
      flujoSugerido: deLaLista(r['flujoSugerido'], FLUJOS_SUGERIDOS, 'a_medida'),
    })),
    planes: registros(v['planes']).map((p) => ({
      _k: nuevaClave(), nombre: cadena(p['nombre']), precioUsd: numeroComoTexto(p['precioUsd']),
      periodo: deLaLista(p['periodo'], PERIODOS, 'mes'), incluye: cadena(p['incluye']),
    })),
    cargosUnicos: registros(v['cargosUnicos']).map((c) => ({
      _k: nuevaClave(), nombre: cadena(c['nombre']), precioUsd: numeroComoTexto(c['precioUsd']),
      desde: c['desde'] === true, detalle: cadena(c['detalle']),
    })),
    aclaraciones: registros(v['aclaraciones']).map((a) => ({
      _k: nuevaClave(), tema: cadena(a['tema']), texto: cadena(a['texto']),
    })),
    archivo: {
      url: cadena(archivo['url']),
      tipo: deLaLista(archivo['tipo'], TIPOS_ARCHIVO, 'pdf'),
      nombreArchivo: cadena(archivo['nombreArchivo']),
    },
  };
}

/**
 * Identificador de cada rubro, generado del nombre: minúsculas, dígitos y
 * guiones, hasta 30, único en la lista. Es lo que el flujo usa para decir qué
 * rubro eligió el prospecto; el nombre es lo que se le muestra.
 */
function idsDeRubros(rubros: Rubro[]): string[] {
  const usados = new Set<string>();
  return rubros.map((r, i) => {
    const base = idDeNombre(r.nombre).slice(0, 30).replace(/-+$/, '') || `rubro-${i + 1}`;
    let id = base;
    for (let n = 2; usados.has(id); n += 1) {
      const sufijo = `-${n}`;
      id = base.slice(0, 30 - sufijo.length).replace(/-+$/, '') + sufijo;
    }
    usados.add(id);
    return id;
  });
}

const precioInvalido = (s: string) => {
  const n = Number(s);
  return s.trim() === '' || !Number.isFinite(n) || n < 0;
};

/** El primer problema del borrador, o `null`. Mismo criterio que la regla. */
function problemaDe(d: Datos): string | null {
  const aviso = Number(d.topeAviso);
  if (!Number.isInteger(aviso) || aviso < 3 || aviso > 100) {
    return 'El fin del primer bloque tiene que ser un número entero entre 3 y 100.';
  }
  if (!/^[a-z0-9_]{1,64}$/.test(d.plantillaAviso)) {
    return 'El nombre de la plantilla va en minúsculas, números y guion bajo, igual que en Meta.';
  }
  if (d.enlaceConsola !== '' && !URL_CONSOLA.test(d.enlaceConsola)) {
    return 'El enlace para clientes actuales tiene que empezar con https://.';
  }

  const largo = (valor: string, max: number, rotulo: string, obligatorio = true) => {
    const t = valor.trim();
    if (obligatorio && t === '') return `${rotulo}: falta completarlo.`;
    if (t.length > max) return `${rotulo}: puede tener hasta ${max} caracteres.`;
    return null;
  };

  const vistos = new Map<string, number>();
  for (const [i, r] of d.rubros.entries()) {
    const p = largo(r.nombre, 40, `Rubro ${i + 1}, nombre`)
      ?? largo(r.solucion, 300, `Rubro ${i + 1}, qué le ofreces`);
    if (p) return p;
    const base = idDeNombre(r.nombre).slice(0, 30);
    const previo = vistos.get(base);
    if (base !== '' && previo !== undefined) {
      return `Los rubros ${previo + 1} y ${i + 1} tienen el mismo nombre: el asistente `
        + 'le mostraría al prospecto dos opciones iguales.';
    }
    vistos.set(base, i);
  }
  for (const [i, p] of d.planes.entries()) {
    const e = largo(p.nombre, 40, `Plan ${i + 1}, nombre`)
      ?? largo(p.incluye, 200, `Plan ${i + 1}, qué incluye`, false);
    if (e) return e;
    if (precioInvalido(p.precioUsd)) {
      return `Plan ${i + 1}: el precio en dólares tiene que ser un número de cero para arriba.`;
    }
  }
  for (const [i, c] of d.cargosUnicos.entries()) {
    const e = largo(c.nombre, 60, `Cargo ${i + 1}, nombre`)
      ?? largo(c.detalle, 200, `Cargo ${i + 1}, detalle`, false);
    if (e) return e;
    if (precioInvalido(c.precioUsd)) {
      return `Cargo ${i + 1}: el precio en dólares tiene que ser un número de cero para arriba.`;
    }
  }
  for (const [i, a] of d.aclaraciones.entries()) {
    const e = largo(a.tema, 60, `Aclaración ${i + 1}, tema`)
      ?? largo(a.texto, 600, `Aclaración ${i + 1}, texto`);
    if (e) return e;
  }

  const url = d.archivo.url.trim();
  if (url !== '') {
    if (!URL_ARCHIVO.test(url)) {
      return 'El enlace del archivo de planes tiene que empezar con https:// y no llevar espacios.';
    }
    const e = largo(d.archivo.nombreArchivo, 80, 'Archivo de planes, nombre del archivo');
    if (e) return e;
  }
  if (d.planes.length > PLANES_SIN_ARCHIVO && url === '') {
    return `Tienes ${d.planes.length} planes: con más de ${PLANES_SIN_ARCHIVO} hace falta el `
      + 'archivo de planes, porque el asistente lo manda en vez de una lista larga. '
      + 'Cárgalo más abajo, o deja 5 planes o menos.';
  }
  return null;
}

export function Captacion() {
  const { tenantId = '' } = useParams();
  const flujos = useFlujos(tenantId);
  const [datos, setDatos] = useState<Datos | null>(null);
  /** El documento no tiene mensaje propio: se muestra el de ejemplo. */
  const [mensajeDeEjemplo, setMensajeDeEjemplo] = useState(false);
  const [estado, setEstado] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [comprobando, setComprobando] = useState(false);
  const [comprobacion, setComprobacion] = useState<{ ok: boolean; motivo: string } | null>(null);
  /** Porcentaje de la subida en curso, o `null` si no hay ninguna. */
  const [subida, setSubida] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);
  /** Lo que salió mal al subir o al quitar: se dice al lado de esos botones. */
  const [avisoArchivo, setAvisoArchivo] = useState<string | null>(null);
  /**
   * El borrador VIGENTE. Una subida tarda; al terminar se guarda lo que hay en
   * pantalla en ese momento, no lo que había cuando se eligió el archivo.
   */
  const ultimo = useRef<Datos | null>(null);
  useEffect(() => { ultimo.current = datos; }, [datos]);

  useEffect(() => {
    if (!tenantId) return;
    return onSnapshot(doc(db, 'tenants', tenantId, 'config', 'onboarding'),
      (d) => {
        const v = d.data() ?? {};
        setDatos(leer(v));
        setMensajeDeEjemplo(typeof v['mensajeClienteActual'] !== 'string');
      },
      () => setEstado('No se pudo leer la configuración de captación. La ven el '
        + 'administrador del negocio y NovuChat, y solo si el negocio tiene el flujo '
        + 'de captación.'));
  }, [tenantId]);

  if (flujos !== null && !flujos.includes('onboarding')) {
    return (
      <section>
        <h2>Captación de clientes</h2>
        <p className="vacio">
          Este negocio no tiene el flujo de captación. Se habilita al contratarlo;
          mientras tanto no hay nada que configurar acá.
        </p>
      </section>
    );
  }

  if (!datos) return <section><h2>Captación de clientes</h2>{estado && <p role="status">{estado}</p>}</section>;

  // La pantalla avisa antes, para no descubrir el límite con un error rojo;
  // la regla es la que manda y rechaza lo mismo.
  const problema = problemaDe(datos);

  /**
   * Guarda el borrador `d` (por defecto, el de pantalla). Recibe el borrador
   * como parámetro porque la subida y «Quitar» guardan uno que todavía no llegó
   * al estado de React.
   */
  const guardar = async (d: Datos = datos): Promise<boolean> => {
    setEstado(null);
    const p = problemaDe(d);
    if (p) { setEstado(p); return false; }
    const ids = idsDeRubros(d.rubros);
    const url = d.archivo.url.trim();
    setGuardando(true);
    try {
      await setDoc(doc(db, 'tenants', tenantId, 'config', 'onboarding'), {
        mensajeClienteActual: d.mensajeClienteActual.trim().slice(0, 600),
        enlaceConsola: d.enlaceConsola.trim(),
        topeAviso: Number(d.topeAviso),
        plantillaAviso: d.plantillaAviso.trim(),
        rubros: d.rubros.map((r, i) => ({
          id: ids[i] as string, nombre: r.nombre.trim(), solucion: r.solucion.trim(),
          flujoSugerido: r.flujoSugerido,
        })),
        planes: d.planes.map((pl) => ({
          nombre: pl.nombre.trim(), precioUsd: Number(pl.precioUsd), periodo: pl.periodo,
          incluye: pl.incluye.trim(),
        })),
        cargosUnicos: d.cargosUnicos.map((c) => ({
          nombre: c.nombre.trim(), precioUsd: Number(c.precioUsd), desde: c.desde,
          detalle: c.detalle.trim(),
        })),
        aclaraciones: d.aclaraciones.map((a) => ({ tema: a.tema.trim(), texto: a.texto.trim() })),
        archivoPlanes: url === ''
          ? deleteField()
          : { url, tipo: d.archivo.tipo, nombreArchivo: d.archivo.nombreArchivo.trim() },
        actualizadoPor: auth.currentUser?.uid ?? '',
        actualizadoEn: serverTimestamp(),
      }, { merge: true });
      setEstado('Guardado. El flujo lo toma en el próximo mensaje.');
      return true;
    } catch {
      setEstado('El servidor rechazó el cambio. Revisa los valores.');
      return false;
    } finally {
      setGuardando(false);
    }
  };

  /**
   * «Comprobar archivo»: GUARDA PRIMERO y después le pide al servidor que
   * descargue el archivo. El servidor comprueba lo guardado, no lo que está en
   * pantalla; comprobar un borrador sin guardar daría un «funciona» sobre un
   * enlace que el asistente todavía no conoce.
   */
  const comprobar = async () => {
    setComprobacion(null);
    if (!(await guardar())) return;
    await pedirComprobacion();
  };

  /** Le pide al servidor que descargue lo GUARDADO. Llamarla después de guardar. */
  const pedirComprobacion = async () => {
    setComprobando(true);
    try {
      const r = await httpsCallable<{ tenantId: string }, { ok?: unknown; motivo?: unknown }>(
        funciones, 'comprobarArchivoPlanes')({ tenantId });
      setComprobacion({
        ok: r.data.ok === true,
        motivo: typeof r.data.motivo === 'string' ? r.data.motivo : '',
      });
    } catch (e) {
      // Se distinguen los casos que la persona puede resolver de los que no,
      // igual que en «Configuración de QR».
      const codigo = (e as { code?: string }).code ?? '';
      const motivo = codigo === 'functions/permission-denied' || codigo === 'functions/unauthenticated'
        ? 'Tu sesión no tiene permiso para comprobar el archivo. Sal y vuelve a entrar.'
        : codigo === 'functions/not-found' || codigo === 'functions/unimplemented'
          ? 'La comprobación todavía no está disponible en el servidor. El archivo quedó '
            + 'guardado; avísale a NovuChat.'
          : 'No se pudo contactar al servidor. Revisa tu conexión y prueba de nuevo.';
      setComprobacion({ ok: false, motivo });
    } finally {
      setComprobando(false);
    }
  };

  /**
   * Borra del depósito las extensiones dadas. «No existe» cuenta como éxito:
   * se borran a ciegas los nombres posibles, así que lo normal es que falten.
   */
  const borrarDelDeposito = async (exts: ExtensionPlanes[]): Promise<boolean> => {
    const s = storage;
    if (!s) return true;
    const r = await Promise.allSettled(
      exts.map((e) => deleteObject(ref(s, rutaArchivoPlanes(tenantId, e)))));
    return r.every((x) => x.status === 'fulfilled'
      || (x.reason as { code?: string } | null)?.code === 'storage/object-not-found');
  };

  /**
   * «Subir PDF o imagen». El orden importa:
   *  1. valida en el navegador (extensión, primeros bytes, tamaño) y que el
   *     resto de la pantalla se pueda guardar, ANTES de gastar datos;
   *  2. sube a la ruta fija con su `contentType`, mostrando el avance;
   *  3. guarda la pantalla con la dirección nueva;
   *  4. RECIÉN AHÍ borra el archivo anterior de otra extensión: si se borrara
   *     antes y el guardado fallara, lo guardado apuntaría a un archivo que ya
   *     no existe;
   *  5. pide la comprobación, como «Comprobar archivo».
   */
  const subir = async (archivo: File | undefined) => {
    setAvisoArchivo(null);
    setComprobacion(null);
    if (!archivo) return;
    const s = storage;
    if (!s) { setAvisoArchivo(SIN_DEPOSITO); return; }
    const v = await validarArchivoPlanes(archivo);
    if (!v.ok) { setAvisoArchivo(v.motivo); return; }
    const nombreArchivo = nombreParaProspecto(archivo.name, v.ext);
    const antes = problemaDe({
      ...(ultimo.current ?? datos),
      archivo: { url: 'https://archivo', tipo: v.formato.tipo, nombreArchivo },
    });
    if (antes) {
      setAvisoArchivo(`Antes de subir, corrige esto: ${antes} Al terminar de subir se `
        + 'guarda toda la pantalla, y con ese problema el servidor no lo aceptaría.');
      return;
    }

    const destino = ref(s, rutaArchivoPlanes(tenantId, v.ext));
    let url: string;
    setSubida(0);
    try {
      const tarea = uploadBytesResumable(destino, archivo, { contentType: v.formato.contentType });
      tarea.on('state_changed', (paso) => {
        if (paso.totalBytes > 0) setSubida(Math.round((paso.bytesTransferred / paso.totalBytes) * 100));
      }, () => { /* el error lo atrapa el `await` de abajo */ });
      await tarea;
      url = await getDownloadURL(destino);
    } catch (e) {
      setAvisoArchivo(mensajeDeFallaStorage((e as { code?: string } | null)?.code ?? ''));
      return;
    } finally {
      setSubida(null);
    }

    const final: Datos = {
      ...(ultimo.current ?? datos),
      archivo: { url, tipo: v.formato.tipo, nombreArchivo },
    };
    setDatos(final);
    if (!(await guardar(final))) {
      setAvisoArchivo('El archivo se subió, pero la configuración no se pudo guardar. Corrige '
        + 'lo que dice abajo y toca Guardar: hasta entonces el asistente sigue con el enlace '
        + 'anterior, que puede haber dejado de funcionar.');
      return;
    }
    await borrarDelDeposito(EXTENSIONES.filter((e) => e !== v.ext));
    await pedirComprobacion();
  };

  /**
   * «Quitar archivo». Primero se guarda sin el campo y después se borra del
   * depósito, por la misma razón que en la subida. Con más de cinco planes no
   * se deja: la regla lo rechazaría, y acá se avisa antes.
   */
  const quitar = async () => {
    setAvisoArchivo(null);
    setComprobacion(null);
    const base = ultimo.current ?? datos;
    if (base.planes.length > PLANES_SIN_ARCHIVO) {
      setAvisoArchivo(`Con ${base.planes.length} planes el archivo es obligatorio: el asistente `
        + `lo manda en vez de listar más de ${PLANES_SIN_ARCHIVO}. Sube otro en su lugar (reemplaza `
        + `al actual), o deja ${PLANES_SIN_ARCHIVO} planes o menos y guarda antes de quitarlo.`);
      return;
    }
    setQuitando(true);
    try {
      if (!(await guardar({ ...base, archivo: { url: '', tipo: 'pdf', nombreArchivo: '' } }))) return;
      setEstado(await borrarDelDeposito(EXTENSIONES)
        ? 'Archivo quitado. El asistente ya no lo manda.'
        : 'El asistente ya no manda el archivo, pero no se pudo borrar la copia guardada: quien '
          + 'ya recibió el enlace todavía podría abrirla. Avísale a NovuChat para que la borre.');
    } finally {
      setQuitando(false);
    }
  };

  const cambiar = (clave: CampoTexto) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDatos({ ...datos, [clave]: e.target.value });
  const cambiarArchivo = (cambio: Partial<Archivo>) => {
    setComprobacion(null);
    setDatos({ ...datos, archivo: { ...datos.archivo, ...cambio } });
  };

  const cantidadPlanes = datos.planes.length;
  const urlArchivo = datos.archivo.url.trim();
  const ocupado = guardando || comprobando || quitando || subida !== null;
  const sinSubir = storage === null || ocupado;
  const archivoObligatorio = cantidadPlanes > PLANES_SIN_ARCHIVO;

  return (
    <section>
      <h2>Captación de clientes</h2>
      <p className="ayuda">
        Esto lo lee el asistente de captación de tu número. A quien escribe se le
        presenta con el nombre que pusiste en Configuración y le pregunta si ya es
        cliente o si quiere conocer el servicio. A los clientes actuales les manda
        el mensaje de abajo; a los nuevos les deduce el rubro, les cuenta qué les
        ofreces, les muestra tus planes y cargos, y al tener sus datos avisa a una
        persona con la plantilla del aviso. Nada cambia hasta que tocas{' '}
        <strong>Guardar</strong>.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
        <div className="grupo">
          <label>
            Mensaje para quien ya es cliente
            <textarea rows={4} maxLength={600} value={datos.mensajeClienteActual}
                      onChange={cambiar('mensajeClienteActual')} />
          </label>
          <p className="ayuda">
            Se envía una sola vez, con un botón para hablar con una persona. No
            incluyas contraseñas ni códigos: lo lee cualquiera que diga ser cliente.
          </p>
          {mensajeDeEjemplo && (
            <p className="ayuda aviso-datos">
              Este es el texto de ejemplo, el que usa NovuChat con sus propios
              clientes. Mientras no guardes uno tuyo, el asistente manda este:
              cámbialo por el de tu negocio.
            </p>
          )}
        </div>
        <div className="grupo">
          <label>
            Enlace para clientes actuales
            <input type="url" value={datos.enlaceConsola} onChange={cambiar('enlaceConsola')} />
          </label>
          <p className="ayuda">
            Adónde mandar a quien ya es cliente: tu portal, tu consola o tu web.
            Tiene que empezar con <code>https://</code>. Puede quedar vacío.
          </p>
        </div>
        <div className="grupo">
          <label>
            Fin del primer bloque (respuestas)
            <input type="number" min={3} max={100} step={1} value={datos.topeAviso}
                   onChange={cambiar('topeAviso')} />
          </label>
          <p className="ayuda">
            En esa respuesta el asistente ofrece hablar con un asesor, con un botón,
            y la conversación sigue. El techo de costo no se fija acá: son los
            umbrales de operador y de bloqueo de la cuenta, iguales para todos los
            flujos.
          </p>
        </div>
        <div className="grupo">
          <label>
            Plantilla del aviso interno
            <input type="text" value={datos.plantillaAviso} onChange={cambiar('plantillaAviso')} />
          </label>
          <p className="ayuda">
            El nombre exacto de la plantilla aprobada en Meta. Si no está aprobada,
            el aviso no llega.
          </p>
        </div>

        <h3>Rubros</h3>
        <EditorLista<Rubro>
          titulo="Rubros de tus prospectos"
          filas={datos.rubros}
          maximo={MAXIMO.rubros}
          porqueMaximo={`Máximo ${MAXIMO.rubros}. Cuando el asistente duda, le muestra al `
            + 'prospecto esta lista numerada, y más opciones en un chat ya no se leen. '
            + 'Junta los rubros parecidos en uno.'}
          nueva={() => ({ _k: nuevaClave(), nombre: '', solucion: '', flujoSugerido: 'a_medida' })}
          rotuloAgregar="Agregar rubro"
          rotuloFila={(r, i) => `Rubro ${i + 1}${r.nombre.trim() ? ` (${r.nombre.trim()})` : ''}`}
          clave={(r) => r._k}
          onCambio={(rubros) => setDatos({ ...datos, rubros })}
          ayuda={(
            <p className="ayuda">
              El asistente <strong>deduce el rubro por el nombre de la empresa</strong>{' '}
              del prospecto: «Clínica Dental Sonrisa» es salud. Si hay duda, le
              muestra esta lista numerada para que elija. Conviene dejar al final
              un rubro <strong>«Otro / a medida»</strong>, para quien no encaja en
              ninguno.
            </p>
          )}
        >
          {(r, cambiarRubro) => (
            <>
              <label>Nombre
                <input maxLength={40} value={r.nombre} placeholder="Salud"
                       onChange={(e) => cambiarRubro({ nombre: e.target.value })} />
              </label>
              <label>Flujo sugerido
                <select value={r.flujoSugerido}
                        onChange={(e) => cambiarRubro({
                          flujoSugerido: deLaLista(e.target.value, FLUJOS_SUGERIDOS, 'a_medida') })}>
                  {FLUJOS_SUGERIDOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label className="ancho-total">Qué le ofreces a ese rubro
                <textarea rows={2} maxLength={300} value={r.solucion}
                          placeholder="Recordatorios de turno y reservas por WhatsApp, sin llamadas."
                          onChange={(e) => cambiarRubro({ solucion: e.target.value })} />
              </label>
            </>
          )}
        </EditorLista>

        <h3>Planes y cargos</h3>
        <p className="ayuda">
          Los precios van <strong>en dólares</strong>. La pantalla no los convierte
          a bolivianos: si cobras en bolivianos, el importe sale del tipo de cambio
          del día del pago, no de un número fijo escrito acá.
        </p>
        <EditorLista<Plan>
          titulo="Planes"
          filas={datos.planes}
          maximo={MAXIMO.planes}
          porqueMaximo={`Máximo ${MAXIMO.planes}. Más planes no se pueden comparar en una `
            + 'conversación: agrupa los parecidos y detállalos en el archivo de planes.'}
          nueva={() => ({ _k: nuevaClave(), nombre: '', precioUsd: '', periodo: 'mes', incluye: '' })}
          rotuloAgregar="Agregar plan"
          rotuloFila={(p, i) => `Plan ${i + 1}${p.nombre.trim() ? ` (${p.nombre.trim()})` : ''}`}
          clave={(p) => p._k}
          onCambio={(planes) => { setComprobacion(null); setDatos({ ...datos, planes }); }}
          ayuda={cantidadPlanes > PLANES_SIN_ARCHIVO ? (
            <p className="ayuda aviso-datos">
              Tienes {cantidadPlanes} planes. Con más de {PLANES_SIN_ARCHIVO}, el
              asistente no los lista en el chat —una lista larga en WhatsApp no se
              lee— y manda el <strong>archivo de planes</strong>. Es obligatorio:
              {urlArchivo === '' ? ' sin él no se puede guardar.' : ' ya lo cargaste abajo.'}
            </p>
          ) : cantidadPlanes === PLANES_SIN_ARCHIVO ? (
            <p className="ayuda">
              Con un plan más vas a necesitar el archivo de planes: con más
              de {PLANES_SIN_ARCHIVO}, el asistente manda el archivo en vez de listarlos.
            </p>
          ) : null}
        >
          {(p, cambiarPlan) => (
            <>
              <label>Nombre
                <input maxLength={40} value={p.nombre} placeholder="Plan Básico"
                       onChange={(e) => cambiarPlan({ nombre: e.target.value })} />
              </label>
              <label>Precio
                <CampoMonto moneda="USD" value={p.precioUsd}
                            onChange={(e) => cambiarPlan({ precioUsd: e.target.value })} />
              </label>
              <label>Período
                <select value={p.periodo}
                        onChange={(e) => cambiarPlan({ periodo: deLaLista(e.target.value, PERIODOS, 'mes') })}>
                  {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label className="ancho-total">Qué incluye (opcional)
                <input maxLength={200} value={p.incluye}
                       placeholder="100 conversaciones al mes, una agenda"
                       onChange={(e) => cambiarPlan({ incluye: e.target.value })} />
              </label>
            </>
          )}
        </EditorLista>

        <EditorLista<Cargo>
          titulo="Cargos únicos"
          filas={datos.cargosUnicos}
          maximo={MAXIMO.cargosUnicos}
          porqueMaximo={`Máximo ${MAXIMO.cargosUnicos}. Muchos cargos sueltos hacen que el `
            + 'precio parezca un laberinto: junta los que se cobran juntos.'}
          nueva={() => ({ _k: nuevaClave(), nombre: '', precioUsd: '', desde: false, detalle: '' })}
          rotuloAgregar="Agregar cargo"
          rotuloFila={(c, i) => `Cargo ${i + 1}${c.nombre.trim() ? ` (${c.nombre.trim()})` : ''}`}
          clave={(c) => c._k}
          onCambio={(cargosUnicos) => setDatos({ ...datos, cargosUnicos })}
          ayuda={(
            <p className="ayuda">
              Lo que se paga una sola vez, como la instalación. Marca{' '}
              <strong>«Es un precio desde»</strong> si el monto final depende del
              caso: el asistente dice «desde USD 65» y no promete un precio cerrado.
            </p>
          )}
        >
          {(c, cambiarCargo) => (
            <>
              <label>Nombre
                <input maxLength={60} value={c.nombre} placeholder="Instalación"
                       onChange={(e) => cambiarCargo({ nombre: e.target.value })} />
              </label>
              <label>Precio
                <CampoMonto moneda="USD" value={c.precioUsd}
                            onChange={(e) => cambiarCargo({ precioUsd: e.target.value })} />
              </label>
              <label className="campo-casilla">
                <input type="checkbox" checked={c.desde}
                       onChange={(e) => cambiarCargo({ desde: e.target.checked })} />
                <span>Es un precio «desde»</span>
              </label>
              <label className="ancho-total">Detalle (opcional)
                <input maxLength={200} value={c.detalle}
                       placeholder="Configuración del número y carga inicial del catálogo"
                       onChange={(e) => cambiarCargo({ detalle: e.target.value })} />
              </label>
            </>
          )}
        </EditorLista>

        <h3>Archivo de planes {archivoObligatorio ? '(obligatorio)' : '(opcional)'}</h3>
        <p className="ayuda">
          Tus planes en un PDF o una imagen, para que el asistente los mande de
          una vez. Es obligatorio con más de {PLANES_SIN_ARCHIVO} planes.{' '}
          <strong>Es parte de tu oferta pública</strong>: lo recibe cualquier
          prospecto que le escriba a tu número, así que no pongas nada privado
          —costos internos, datos de clientes, contraseñas—.
        </p>
        <div className="acciones">
          <label className="btn btn-secondary" aria-disabled={sinSubir}>
            {subida !== null ? `Subiendo… ${subida} %` : 'Subir PDF o imagen'}
            <input type="file" accept={ACEPTA} hidden disabled={sinSubir}
                   onChange={(e) => { void subir(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {urlArchivo !== '' && (
            <button type="button" className="btn btn-ghost" disabled={ocupado || archivoObligatorio}
                    onClick={() => void quitar()}>
              {quitando ? 'Quitando…' : 'Quitar archivo'}
            </button>
          )}
        </div>
        {subida !== null && (
          <progress max={100} value={subida} aria-label="Avance de la subida del archivo de planes" />
        )}
        <p className="ayuda">
          PDF hasta 10 MB, o imagen JPG o PNG hasta 5 MB, que es lo más que
          WhatsApp acepta en una imagen. Subir otro archivo reemplaza al anterior.
          Al terminar se guarda la pantalla y se comprueba que el asistente lo
          pueda mandar.
          {urlArchivo !== '' && archivoObligatorio
            && ` Con más de ${PLANES_SIN_ARCHIVO} planes no se puede quitar: sube otro en su lugar.`}
        </p>
        {storage === null && <p className="ayuda aviso-datos">{SIN_DEPOSITO}</p>}
        {avisoArchivo && <p className="ayuda aviso-datos" role="alert">{avisoArchivo}</p>}
        <div className="grupo">
          <label>
            O pega un enlace público
            <input type="url" maxLength={500} value={datos.archivo.url} placeholder="https://…"
                   aria-invalid={archivoObligatorio && urlArchivo === ''}
                   onChange={(e) => cambiarArchivo({ url: e.target.value })} />
          </label>
          <p className="ayuda">
            Si el archivo ya está publicado —tu web, un Drive con enlace público—,
            pega el enlace <code>https://</code>. Si lo borras de allá, el
            asistente deja de poder mandarlo. Cuando subes un archivo, este campo
            se llena solo.
          </p>
        </div>
        <div className="grupo">
          <label>
            Tipo
            <select value={datos.archivo.tipo} disabled={esDelDeposito(urlArchivo)}
                    onChange={(e) => cambiarArchivo({ tipo: deLaLista(e.target.value, TIPOS_ARCHIVO, 'pdf') })}>
              {TIPOS_ARCHIVO.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="grupo">
          <label>
            Nombre con el que le llega al prospecto
            <input maxLength={80} value={datos.archivo.nombreArchivo} placeholder="Planes 2026.pdf"
                   onChange={(e) => cambiarArchivo({ nombreArchivo: e.target.value })} />
          </label>
        </div>
        <div className="acciones">
          <button type="button" disabled={urlArchivo === '' || guardando || comprobando}
                  onClick={() => void comprobar()}>
            {comprobando ? 'Comprobando…' : 'Comprobar archivo'}
          </button>
        </div>
        <p className="ayuda">
          «Comprobar archivo» guarda los cambios y le pide al servidor que
          descargue el archivo, para confirmar que el asistente lo va a poder
          mandar.
        </p>
        {comprobacion && (
          <p role="status" className={comprobacion.ok ? 'ayuda' : 'ayuda aviso-datos'}>
            <strong>{comprobacion.ok ? 'El archivo se puede mandar.' : 'El archivo no se pudo comprobar.'}</strong>
            {comprobacion.motivo !== '' && <> <TextoSeguro valor={comprobacion.motivo} maxLargo={300} /></>}
          </p>
        )}

        <h3>Aclaraciones</h3>
        <EditorLista<Aclaracion>
          titulo="Aclaraciones de tu oferta"
          filas={datos.aclaraciones}
          maximo={MAXIMO.aclaraciones}
          porqueMaximo={`Máximo ${MAXIMO.aclaraciones}. Cuantas más hay, más le cuesta al `
            + 'asistente elegir la que corresponde: junta las que hablan de lo mismo.'}
          nueva={() => ({ _k: nuevaClave(), tema: '', texto: '' })}
          rotuloAgregar="Agregar aclaración"
          rotuloFila={(a, i) => `Aclaración ${i + 1}${a.tema.trim() ? ` (${a.tema.trim()})` : ''}`}
          clave={(a) => a._k}
          onCambio={(aclaraciones) => setDatos({ ...datos, aclaraciones })}
          ayuda={(
            <p className="ayuda">
              Conceptos de tu oferta que el asistente explica{' '}
              <strong>solo si el prospecto pregunta</strong>. Por ejemplo, tema
              «Qué es una conversación» y texto «Hasta 25 respuestas del asistente
              a un mismo teléfono dentro de 24 horas. Es lo que se factura.».
            </p>
          )}
        >
          {(a, cambiarAclaracion) => (
            <>
              <label>Tema
                <input maxLength={60} value={a.tema} placeholder="Qué es una conversación"
                       onChange={(e) => cambiarAclaracion({ tema: e.target.value })} />
              </label>
              <label className="ancho-total">Texto
                <textarea rows={3} maxLength={600} value={a.texto}
                          onChange={(e) => cambiarAclaracion({ texto: e.target.value })} />
              </label>
            </>
          )}
        </EditorLista>

        {problema && <p className="ayuda aviso-datos" role="alert">{problema}</p>}
        <button type="submit" disabled={problema !== null || guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
      {estado && <p role="status">{estado}</p>}
    </section>
  );
}
