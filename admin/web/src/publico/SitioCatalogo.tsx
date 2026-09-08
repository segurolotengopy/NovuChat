import { useEffect, useMemo, useState } from 'react';
import type { CatalogoPublico, ItemPublico, RespuestaCheckout } from './tipos';
import { imagenSegura, logoSeguro, precioTexto } from './saneo';
import { variablesDe } from '../lib/paletas';

/**
 * =============================================================================
 * EL SITIO DEL CATÁLOGO — lo que ve el cliente final al tocar el enlace
 * =============================================================================
 *
 * QUIÉN LO ABRE Y CÓMO. Una persona en Bolivia, desde WhatsApp, con datos
 * móviles y —en la mayoría de los casos— un teléfono de gama media. Eso decide
 * casi todo lo de acá: una sola columna, imágenes perezosas, ninguna
 * dependencia externa, y una única petición de red para tener todo el catálogo.
 * No hay paginación porque no hay servidor al que volver: los quinientos ítems
 * que como mucho puede tener un comercio entran en una respuesta y se filtran
 * en memoria, que es más rápido y más barato que cualquier búsqueda remota.
 *
 * LA MARCA ES DEL COMERCIO, decidido con Andres. El cliente cree —con razón—
 * que está hablando con la panadería, no con NovuChat: si al tocar el enlace
 * aparece una marca que no le presentaron, duda, y una duda en el momento de
 * pagar es una venta perdida. NovuChat va en el pie, chico y visible.
 *
 * LO QUE ESTA PÁGINA NO MANDA NUNCA: PRECIOS.
 * El checkout viaja con identificadores y cantidades. Los precios que se ven
 * acá son para que la persona decida; el total que vale es el que recalcula el
 * servidor leyendo el catálogo de la consola. Editar el JavaScript de esta
 * página no cambia lo que se le cobra a nadie, porque nada de lo que esta
 * página dice sobre plata se usa para cobrar.
 */

const RUTA_API = '/api/catalogo';

/** El carrito: identificador del ítem -> cantidad. Nada más. */
type Carrito = Record<string, number>;

export function SitioCatalogo({ ficha }: { ficha: string }) {
  const [datos, setDatos] = useState<CatalogoPublico | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carrito, setCarrito] = useState<Carrito>(() => leerCarrito(ficha));
  const [vista, setVista] = useState<'catalogo' | 'pedido' | 'listo'>('catalogo');
  const [detalle, setDetalle] = useState<ItemPublico | null>(null);
  const [recibo, setRecibo] = useState<RespuestaCheckout | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`${RUTA_API}/${ficha}`, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: CatalogoPublico) => { if (vivo) setDatos(d); })
      .catch(() => {
        if (vivo) {
          // El enlace vencido y el enlace inexistente dan el MISMO mensaje. El
          // servidor tampoco los distingue: decir «este existía pero venció» le
          // confirma a quien prueba fichas al azar que acertó una.
          setError('Este enlace ya no está disponible. Escribinos por WhatsApp '
            + 'y te mandamos uno nuevo.');
        }
      });
    return () => { vivo = false; };
  }, [ficha]);

  useEffect(() => { guardarCarrito(ficha, carrito); }, [ficha, carrito]);

  /**
   * EL TÍTULO ES EL DEL COMERCIO.
   *
   * `index.html` es uno solo para las dos aplicaciones, así que su `<title>`
   * dice «NovuChat · Panel administrativo». Un cliente final que guarda el
   * enlace, o que mira sus pestañas abiertas, veía el nombre de un panel
   * administrativo que no es suyo — justo lo contrario de la decisión de que la
   * marca sea la del comercio. Se detectó mirando la pestaña, no leyendo el
   * código.
   */
  useEffect(() => {
    if (datos?.negocio.nombre) document.title = datos.negocio.nombre;
  }, [datos]);

  /**
   * Los tres colores de la paleta entran como propiedades personalizadas.
   *
   * LOS VALORES SALEN DE LA TABLA LOCAL, NO DE LA RESPUESTA. El servidor manda
   * el NOMBRE de la paleta —`terracota`, `bosque`…— y `variablesDe` lo traduce
   * contra `lib/paletas.ts`. Un nombre desconocido cae en la paleta por
   * defecto. Así no hay ningún color del servidor entrando a una propiedad de
   * CSS: no queda nada que inyectar, ni siquiera si el servidor estuviera
   * comprometido.
   */
  const estilo = variablesDe(datos?.negocio.paleta) as React.CSSProperties;

  if (error) return <Aviso texto={error} />;
  if (!datos) return <Aviso texto="Cargando el catálogo…" />;

  const items = datos.items;
  const total = totalDelCarrito(items, carrito);
  const unidades = Object.values(carrito).reduce((a, b) => a + b, 0);

  return (
    <div className="cat" style={estilo}>
      <Cabecera negocio={datos.negocio} />

      {vista === 'listo' && recibo ? (
        <Confirmacion recibo={recibo} negocio={datos.negocio.nombre} />
      ) : vista === 'pedido' ? (
        <Pedido
          ficha={ficha} items={items} carrito={carrito} entrega={datos.entrega}
          moneda={datos.negocio.moneda} total={total}
          alCambiar={setCarrito}
          alVolver={() => setVista('catalogo')}
          alConfirmar={(r) => {
            setRecibo(r); setCarrito({}); setVista('listo');
          }}
        />
      ) : (
        <Catalogo
          items={items} carrito={carrito} moneda={datos.negocio.moneda}
          conFotos={items.some((i) => imagenSegura(i.imagenUrl) !== '')}
          alSumar={(id, n) => setCarrito((c) => sumar(c, id, n))}
          alAbrir={setDetalle}
        />
      )}

      {detalle && (
        <Detalle
          item={detalle} moneda={datos.negocio.moneda}
          cantidad={carrito[detalle.id] ?? 0}
          alSumar={(n) => setCarrito((c) => sumar(c, detalle.id, n))}
          alCerrar={() => setDetalle(null)}
        />
      )}

      {vista === 'catalogo' && unidades > 0 && (
        <button type="button" className="cat-barra" onClick={() => setVista('pedido')}>
          <span>{unidades} {unidades === 1 ? 'ítem' : 'ítems'}</span>
          <strong>Ver mi pedido</strong>
          <span>{precioTexto(total, datos.negocio.moneda)}</span>
        </button>
      )}

      <Pie />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cabecera con la marca del comercio
// ---------------------------------------------------------------------------

function Cabecera({ negocio }: { negocio: CatalogoPublico['negocio'] }) {
  const logo = logoSeguro(negocio.logo);
  return (
    <header className="cat-cabecera">
      {logo && <img className="cat-logo" src={logo} alt="" loading="lazy" />}
      <div>
        <h1>{negocio.nombre}</h1>
        {negocio.descripcion && <p className="cat-sub">{negocio.descripcion}</p>}
        {negocio.direccion && <p className="cat-sub">{negocio.direccion}</p>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Lista, con buscador y filtro por área
// ---------------------------------------------------------------------------

function Catalogo({ items, carrito, moneda, conFotos, alSumar, alAbrir }: {
  items: ItemPublico[]; carrito: Carrito; moneda: string;
  /**
   * Si NINGÚN ítem del catálogo tiene foto, no se reserva la casilla.
   *
   * Se vio mirando la página, no el código: un comercio que todavía no cargó
   * fotos tenía una columna de rectángulos grises vacíos a lo largo de toda la
   * lista, que se lee como «las fotos no cargan» —o sea, como algo roto— y
   * además empuja la mitad del catálogo fuera de la primera pantalla.
   *
   * En cambio, si ALGUNO tiene foto, la casilla se reserva en todos: sin eso,
   * los nombres quedan desalineados y la lista se vuelve difícil de recorrer.
   */
  conFotos: boolean;
  alSumar: (id: string, n: number) => void;
  alAbrir: (i: ItemPublico) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [area, setArea] = useState('');

  const areas = useMemo(
    () => [...new Set(items.map((i) => i.area).filter((a) => a !== ''))].sort(),
    [items]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return items.filter((i) =>
      (area === '' || i.area === area)
      && (q === '' || i.nombre.toLowerCase().includes(q)
          || i.descripcion.toLowerCase().includes(q)));
  }, [items, busqueda, area]);

  return (
    <main className="cat-cuerpo">
      <input
        className="cat-buscar" type="search" inputMode="search"
        placeholder="Buscar" value={busqueda} maxLength={60}
        onChange={(e) => setBusqueda(e.target.value)}
        aria-label="Buscar en el catálogo"
      />

      {/* Solo si hay más de un área. Un único botón de filtro no filtra nada y
          ocupa la primera pantalla, que es la que decide si la persona sigue. */}
      {areas.length > 1 && (
        <div className="cat-areas">
          <button type="button" aria-pressed={area === ''} onClick={() => setArea('')}>Todo</button>
          {areas.map((a) => (
            <button key={a} type="button" aria-pressed={area === a}
                    onClick={() => setArea(area === a ? '' : a)}>{a}</button>
          ))}
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="cat-vacio">No encontramos nada con eso. Probá con otra palabra.</p>
      ) : (
        <ul className="cat-lista">
          {visibles.map((i) => (
            <Tarjeta key={i.id} item={i} moneda={moneda} conFotos={conFotos}
                     cantidad={carrito[i.id] ?? 0}
                     alSumar={(n) => alSumar(i.id, n)}
                     alAbrir={() => alAbrir(i)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function Tarjeta({ item, moneda, cantidad, conFotos, alSumar, alAbrir }: {
  item: ItemPublico; moneda: string; cantidad: number; conFotos: boolean;
  alSumar: (n: number) => void; alAbrir: () => void;
}) {
  const img = imagenSegura(item.imagenUrl);
  return (
    <li className="cat-tarjeta">
      <button type="button" className="cat-tarjeta-toque" onClick={alAbrir}>
        {img
          ? <img className="cat-foto" src={img} alt="" loading="lazy" decoding="async" />
          : conFotos && <span className="cat-foto cat-foto-sin" aria-hidden="true" />}
        <span className="cat-datos">
          <strong>{item.nombre}</strong>
          {item.descripcion && <span className="cat-desc">{item.descripcion}</span>}
          <span className="cat-precio">
            {precioTexto(item.precio, item.moneda || moneda)}
          </span>
        </span>
      </button>
      <Contador cantidad={cantidad} alSumar={alSumar} nombre={item.nombre} />
    </li>
  );
}

/**
 * Sumar y restar, sin campo de texto.
 *
 * Un campo numérico en un teléfono abre el teclado, tapa media pantalla y
 * admite «-3» y «1e9». El servidor los rechaza igual, pero el rechazo llega
 * después de que la persona armó el pedido entero. Dos botones no admiten un
 * valor inválido por construcción.
 */
function Contador({ cantidad, alSumar, nombre }: {
  cantidad: number; alSumar: (n: number) => void; nombre: string;
}) {
  if (cantidad === 0) {
    return (
      <button type="button" className="cat-agregar" onClick={() => alSumar(1)}>
        Agregar<span className="cat-oculto"> {nombre}</span>
      </button>
    );
  }
  return (
    <div className="cat-contador">
      <button type="button" onClick={() => alSumar(-1)} aria-label={`Quitar uno de ${nombre}`}>−</button>
      <span aria-live="polite">{cantidad}</span>
      <button type="button" onClick={() => alSumar(1)} aria-label={`Agregar uno de ${nombre}`}
              disabled={cantidad >= 99}>+</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

function Detalle({ item, moneda, cantidad, alSumar, alCerrar }: {
  item: ItemPublico; moneda: string; cantidad: number;
  alSumar: (n: number) => void; alCerrar: () => void;
}) {
  const img = imagenSegura(item.imagenUrl);
  // Escape cierra. En un teléfono no hay teclado, pero en un escritorio la
  // hoja sin salida por teclado es una trampa de accesibilidad.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [alCerrar]);

  return (
    <div className="cat-hoja" role="dialog" aria-modal="true" aria-label={item.nombre}>
      <div className="cat-hoja-fondo" onClick={alCerrar} aria-hidden="true" />
      <div className="cat-hoja-panel">
        <button type="button" className="cat-cerrar" onClick={alCerrar} aria-label="Cerrar">×</button>
        {img && <img className="cat-foto-grande" src={img} alt="" />}
        <h2>{item.nombre}</h2>
        <p className="cat-precio-grande">{precioTexto(item.precio, item.moneda || moneda)}</p>
        {item.descripcion && <p>{item.descripcion}</p>}
        <Contador cantidad={cantidad} alSumar={alSumar} nombre={item.nombre} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pedido y checkout
// ---------------------------------------------------------------------------

function Pedido({ ficha, items, carrito, entrega, moneda, total, alCambiar, alVolver, alConfirmar }: {
  ficha: string; items: ItemPublico[]; carrito: Carrito;
  entrega: CatalogoPublico['entrega']; moneda: string; total: number;
  alCambiar: (c: Carrito) => void;
  alVolver: () => void;
  alConfirmar: (r: RespuestaCheckout) => void;
}) {
  const [modo, setModo] = useState<'retiro' | 'envio'>(
    entrega.aceptaRetiroEnLocal ? 'retiro' : 'envio');
  // Los dos botones solo tienen sentido si el comercio ofrece las dos cosas.
  // Un comercio que solo entrega a domicilio no tiene que ver un botón de
  // «retiro en el local» que después le va a traer gente a la puerta.
  const eligeEntrega = entrega.aceptaRetiroEnLocal && entrega.aceptaDelivery;
  const [direccion, setDireccion] = useState('');
  const [nota, setNota] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const elegidos = items.filter((i) => (carrito[i.id] ?? 0) > 0);
  const costoEnvio = modo === 'envio' && entrega.costoDelivery !== null ? entrega.costoDelivery : 0;
  const totalConEnvio = total + costoEnvio;
  // SOLO CON ENVÍO. El mínimo es una condición de la entrega a domicilio, y
  // anunciarlo con «retiro en el local» elegido decía «el pedido mínimo para
  // envío es Bs 50» a alguien que no pidió ningún envío: se lee como que su
  // pedido no alcanza para nada. Se vio usando la página.
  const bajoMinimo = modo === 'envio'
    && entrega.pedidoMinimo !== null && total < entrega.pedidoMinimo;

  const enviar = async () => {
    setFallo(null);
    setEnviando(true);
    try {
      const r = await fetch(`${RUTA_API}/${ficha}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // SOLO IDENTIFICADORES Y CANTIDADES. Ver la cabecera del archivo.
        body: JSON.stringify({
          items: elegidos.map((i) => ({ id: i.id, cantidad: carrito[i.id] })),
          entrega: modo,
          ...(modo === 'envio' ? { direccion } : {}),
          ...(nota.trim() ? { nota: nota.trim() } : {}),
        }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok || !cuerpo?.ok) {
        setFallo(mensajeDeFallo(r.status, cuerpo?.error));
        return;
      }
      alConfirmar(cuerpo as RespuestaCheckout);
    } catch {
      setFallo('No pudimos enviar el pedido. Revisá tu conexión y probá de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="cat-cuerpo">
      <button type="button" className="cat-volver" onClick={alVolver}>← Seguir viendo</button>
      <h2>Tu pedido</h2>

      <ul className="cat-resumen">
        {elegidos.map((i) => (
          <li key={i.id}>
            <span>{i.nombre}</span>
            <Contador cantidad={carrito[i.id] ?? 0} nombre={i.nombre}
                      alSumar={(n) => alCambiar(sumar(carrito, i.id, n))} />
            <strong>{precioTexto(
              i.precio === null ? null : i.precio * (carrito[i.id] ?? 0),
              i.moneda || moneda)}</strong>
          </li>
        ))}
      </ul>

      {eligeEntrega && (
        <div className="cat-modo">
          <button type="button" aria-pressed={modo === 'retiro'} onClick={() => setModo('retiro')}>
            Retiro en el local
          </button>
          <button type="button" aria-pressed={modo === 'envio'} onClick={() => setModo('envio')}>
            Envío{entrega.costoDelivery ? ` (+${precioTexto(entrega.costoDelivery, moneda)})` : ''}
          </button>
        </div>
      )}

      {modo === 'envio' && (
        <label className="cat-campo">
          ¿A dónde lo llevamos?
          <textarea value={direccion} maxLength={200} rows={2}
                    placeholder="Calle, número, zona y alguna referencia"
                    onChange={(e) => setDireccion(e.target.value)} />
        </label>
      )}

      <label className="cat-campo">
        ¿Algo que debamos saber? (opcional)
        <textarea value={nota} maxLength={300} rows={2}
                  placeholder="Sin cebolla, tocar el timbre de al lado…"
                  onChange={(e) => setNota(e.target.value)} />
      </label>

      <p className="cat-total">Total {precioTexto(totalConEnvio, moneda)}</p>

      {/* El mínimo se avisa, no se impone acá: quien decide si acepta el pedido
          es el comercio, y el servidor lo vuelve a mirar. Frenar el botón haría
          que la persona abandone en vez de agregar una cosa más. */}
      {bajoMinimo && (
        <p className="cat-nota">
          El pedido mínimo para envío es {precioTexto(entrega.pedidoMinimo, moneda)}.
          Podés mandarlo igual y te confirmamos por WhatsApp.
        </p>
      )}

      {fallo && <p className="cat-error" role="alert">{fallo}</p>}

      <button type="button" className="cat-confirmar"
              disabled={enviando || elegidos.length === 0
                        || (modo === 'envio' && direccion.trim() === '')}
              onClick={() => void enviar()}>
        {enviando ? 'Enviando…' : 'Confirmar el pedido'}
      </button>
      <p className="cat-nota">
        Al confirmar, tu pedido llega directo a la conversación de WhatsApp que
        ya tenías abierta. No hace falta que copies ni pegues nada.
      </p>
    </main>
  );
}

function Confirmacion({ recibo, negocio }: { recibo: RespuestaCheckout; negocio: string }) {
  return (
    <main className="cat-cuerpo cat-fin">
      <h2>Listo, {negocio} ya tiene tu pedido</h2>
      {recibo.siguiente === 'respuesta' ? (
        <p>Volvé a WhatsApp: te estamos contestando ahí mismo.</p>
      ) : (
        // VENTANA DE 24 HORAS CERRADA. Se lo decimos con todas las letras, sin
        // tecnicismos: la persona no tiene por qué saber qué es una ventana de
        // atención, pero sí tiene que saber que le va a llegar un aviso y que
        // hasta que no lo responda no hay nadie del otro lado.
        <p>
          Te va a llegar un mensaje nuestro por WhatsApp en un momento.
          <strong> Respondelo</strong> y seguimos con tu pedido desde ahí.
        </p>
      )}
      {/* «No pudimos incluir» y no «ya no estaba disponible»: son dos causas
          —lo dieron de baja, o le sacaron el precio mientras elegías— y desde
          acá no se sabe cuál fue. Decir la que no era hace que el comercio
          reciba una pregunta que no esperaba. */}
      {recibo.descartados.length > 0 && (
        <p className="cat-nota">
          {recibo.descartados.length === 1
            ? 'Un ítem de tu pedido no lo pudimos incluir.'
            : `${recibo.descartados.length} ítems de tu pedido no los pudimos incluir.`}
          {' '}Te lo aclaramos por WhatsApp.
        </p>
      )}
    </main>
  );
}

function Pie() {
  return (
    <footer className="cat-pie">
      <span>Pedidos por WhatsApp con NovuChat</span>
    </footer>
  );
}

function Aviso({ texto }: { texto: string }) {
  return <div className="cat"><p className="cat-aviso">{texto}</p></div>;
}

// ---------------------------------------------------------------------------
// Estado del carrito
// ---------------------------------------------------------------------------

function sumar(carrito: Carrito, id: string, n: number): Carrito {
  const cantidad = Math.min(99, Math.max(0, (carrito[id] ?? 0) + n));
  const copia = { ...carrito };
  if (cantidad === 0) delete copia[id]; else copia[id] = cantidad;
  return copia;
}

function totalDelCarrito(items: ItemPublico[], carrito: Carrito): number {
  let total = 0;
  for (const i of items) {
    const n = carrito[i.id] ?? 0;
    if (n > 0 && i.precio !== null) total += i.precio * n;
  }
  return Number(total.toFixed(2));
}

/**
 * El carrito sobrevive a una recarga, y solo a eso.
 *
 * `sessionStorage` y no `localStorage`: se borra al cerrar la pestaña. En un
 * teléfono compartido —que en el público de este producto no es raro— un
 * carrito que sigue ahí mañana le muestra a otra persona lo que compró la
 * primera. Y la clave lleva la ficha, así que dos enlaces distintos no se
 * mezclan nunca.
 */
function leerCarrito(ficha: string): Carrito {
  try {
    const crudo = sessionStorage.getItem(`carrito:${ficha}`);
    if (!crudo) return {};
    const v = JSON.parse(crudo) as unknown;
    if (typeof v !== 'object' || v === null) return {};
    const limpio: Carrito = {};
    for (const [id, n] of Object.entries(v as Record<string, unknown>)) {
      if (typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 99) limpio[id] = n;
    }
    return limpio;
  } catch {
    return {};
  }
}

function guardarCarrito(ficha: string, carrito: Carrito): void {
  try {
    sessionStorage.setItem(`carrito:${ficha}`, JSON.stringify(carrito));
  } catch {
    // Modo privado o almacenamiento lleno. El carrito sigue funcionando en
    // memoria: no perder una venta por no poder guardar una comodidad.
  }
}

/**
 * Traduce el error del servidor a algo que una persona pueda hacer. Los códigos
 * del servidor son deliberadamente escuetos; la traducción vive acá para que
 * ese vocabulario técnico no se filtre a la pantalla de un cliente final.
 */
function mensajeDeFallo(estado: number, codigo: unknown): string {
  if (estado === 404) return 'Este enlace ya no está disponible. Escribinos por WhatsApp.';
  if (estado === 429) return 'Ya mandaste varios pedidos con este enlace. Escribinos por WhatsApp y seguimos por ahí.';
  if (codigo === 'falta la direccion') return 'Falta la dirección de entrega.';
  if (codigo === 'nada de lo pedido sigue disponible') {
    return 'Lo que elegiste ya no se puede pedir por acá. Actualizá la página para ver el catálogo de ahora.';
  }
  if (codigo === 'monedas mezcladas') {
    return 'Tu pedido mezcla precios en bolivianos y en dólares. Separalos en dos pedidos.';
  }
  return 'No pudimos registrar el pedido. Probá de nuevo en un momento.';
}
