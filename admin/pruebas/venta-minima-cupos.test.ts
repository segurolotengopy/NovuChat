/**
 * =============================================================================
 * LOS CUPOS DE AVISO PASAN AL SERVIDOR (F3b, PR-4b) — Q'Taco «Venta mínima v0»
 * =============================================================================
 *
 * Antes: el contador diario de avisos (`av.dia`), las marcas por hora de derivaciones y de avisos de pedido (`transferencias`, `avisosPedido`) vivían en la memoria de
 * n8n, que se escribe al final y pierde la última escritura. Ahora son CUPOS del servidor (`Consumir cupos`, que cuelga de `¿Hay avisos?`) y `reservasDelDia` viaja
 * en el bloque del teléfono. Contrato: `docs/arquitectura/estado-de-conversacion.md`, §14.
 *
 * El servidor de esta suite es `lib/servidor-de-cupos.ts`: decide con el NÚCLEO REAL (`core/turno/sesion.ts`). La suite corre el JSON VERSIONADO con el n8n de mentira
 * y escribe NEGANDO: cada invariante tiene su mutación (una copia del flujo con la guardia rota) y la prueba tiene que DETECTARLA.
 *
 * COSTO EN MENSAJES: 0 por conversación (la secuencia de abajo sigue en [1, 1, 1, 1, 1]).
 */
import { describe, expect, it } from 'vitest';
import { type Flujo, type J } from './lib/flujo';
import { boton, CLIENTE, crear, idDeBoton, panel, PHONE_ID, QTACO, texto, turno, type Mundial } from './lib/venta-minima-mundo';
import { crearServidorConCupos } from './lib/servidor-de-cupos';

const AV1 = '59100000021';
const AV2 = '59100000022';
const pide = 'quiero hablar con una persona';

const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** Una copia del flujo versionado con `f` aplicado: la MUTACIÓN con que se prueba que cada prueba muerde. */
const mutar = (f: (flujo: Flujo) => void): Flujo => { const c = clonar(QTACO); f(c); return c; };
const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;
const cambiarCodigo = (f: Flujo, n: string, de: string, a: string): void => {
  const x = nodo(f, n);
  const js = String(x.parameters['jsCode']);
  if (!js.includes(de)) throw new Error(`la mutación no encontró «${de.slice(0, 50)}» en ${n}`);
  x.parameters['jsCode'] = js.replace(de, a);
};

const FALLA_META = (): J => ({ error: { message: 'Graph rechazó el envío', code: 131030 } });
const sinAvisos = (w: Mundial): void => { w.mundo.dobles['Enviar aviso'] = FALLA_META; w.mundo.dobles['Aviso de respaldo'] = FALLA_META; };

/** Un pedido de recojo listo para «Confirmar pedido», SIN cobro (sin QR: la confirmación avisa al restaurante en el acto). */
function pedidoListo(flujo: Flujo = QTACO, config: J = {}) {
  const w = crear({}, flujo, config, { 'Traer configuración': () => ({ statusCode: 200, body: { ...panel(), cobro: { activo: false } } }) });
  turno(w, texto('hola'));
  turno(w, texto('hola'));
  w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  const resumen = turno(w, texto('quiero 4 tacos de birria'));
  return { w, id: idDeBoton(resumen, 'Confirmar pedido') };
}
const cuposDe = (w: Mundial, i = 0): J[] => ((w.sesion.consumos[i]!['sesion'] as J)['cupos'] as J[]);

// =====================================================================================================
describe('Consumir cupos: qué se pide y cómo', () => {
  it('una derivación pide `avisos` (comercio, día, un cupo por mensaje) y `transferencias` (contacto, hora, 1) en un espacio NUEVO por turno, sin tocar el estado de la conversación', () => {
    const w = crear();
    const t = turno(w, texto(pide));
    expect(t.fallo).toBeNull();
    expect(w.sesion.consumos).toHaveLength(1); // executeOnce: UNA llamada aunque haya dos avisos
    const q = w.sesion.consumos[0]!['sesion'] as J;
    expect(q).toMatchObject({ v: 1, accion: 'comprometer', canal: 'wa', versionLeida: 0, estado: null, venceEnMin: 1 });
    expect(String(q['espacio'])).toMatch(/^vmc-/);
    expect(q['espacio']).not.toBe('venta-minima');
    expect(w.sesion.consumos[0]!['telefono']).toBe(CLIENTE);
    expect(Object.keys(w.sesion.consumos[0]!).sort()).toEqual(['sesion', 'telefono']);
    expect(cuposDe(w)).toEqual([
      { clave: 'avisos', alcance: 'comercio', periodo: 'dia', cantidad: t.avisos.length, tope: 150 },
      { clave: 'transferencias', alcance: 'contacto', periodo: 'hora', cantidad: 1, tope: 1 },
    ]);
    // el estado de la conversación NO se tocó con esa llamada: ni su versión ni el espacio
    expect(String(w.sesion.malFormado)).toBe('');
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(t.avisos.length);
    expect(w.sesion.servidor.usados(PHONE_ID, 'transferencias', 'contacto', CLIENTE, 'hora')).toBe(1);
  });

  it('un pedido pide `avisos` y `pedidos` (contacto, hora, 1) con el tope de la configuración; una reserva solo `avisos`', () => {
    const { w, id } = pedidoListo(QTACO, { topePedidosHora: 4, topeAvisosDia: 40 });
    const antes = w.sesion.consumos.length;
    turno(w, boton(id, 'Confirmar pedido'));
    expect(cuposDe(w, antes).map((c) => [c['clave'], c['alcance'], c['periodo'], c['cantidad'], c['tope']])).toEqual([
      ['avisos', 'comercio', 'dia', 2, 40], ['pedidos', 'contacto', 'hora', 1, 4],
    ]);
    const r = crear();
    turno(r, boton('m|reserva', 'Reservar'));
    r.estado.extraccion = { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' };
    turno(r, texto('mesa para 4 el viernes a las 8 de la noche en la terraza'));
    const n = r.sesion.consumos.length;
    turno(r, boton('r|enviar', 'Enviar'));
    expect(cuposDe(r, n).map((c) => c['clave'])).toEqual(['avisos']);
  });

  it('el tope viaja en el cuerpo pero con techo de 1000: un tope configurado mayor se manda como 1000 y el servidor rechaza uno que pase de 1000 (400)', () => {
    const w = crear({}, QTACO, { topeAvisosDia: 5000 });
    turno(w, texto(pide));
    expect(cuposDe(w)[0]!['tope']).toBe(1000);
    // el servidor, por su cuenta, también: ningún cupo es límite comercial
    const servidor = crearServidorConCupos({ ahoraMs: () => w.mundo.ahora() });
    const cuerpo = clonar(w.sesion.consumos[0]!) as J;
    ((cuerpo['sesion'] as J)['cupos'] as J[])[0]!['tope'] = 1001;
    expect(servidor.atender(PHONE_ID, cuerpo).statusCode).toBe(400);
  });

  it('tope 0 o ausente en el servidor ⇒ `sin_tope` y se niega (nunca se concede sin tope)', () => {
    const w = crear();
    turno(w, texto(pide));
    const servidor = crearServidorConCupos({ ahoraMs: () => w.mundo.ahora() });
    for (const tope of [0, undefined]) {
      const cuerpo = clonar(w.sesion.consumos[0]!) as J;
      const c = ((cuerpo['sesion'] as J)['cupos'] as J[])[0]!;
      if (tope === undefined) delete c['tope']; else c['tope'] = tope;
      const r = servidor.atender(PHONE_ID, cuerpo);
      expect(r.body).toMatchObject({ resultado: 'cupo_negado', motivo: 'sin_tope', clave: 'avisos' });
    }
    expect(servidor.cupos.size).toBe(0);
  });

  it('un reintento con el MISMO idCompromiso es `repetido`: el cupo se consume una sola vez', () => {
    const w = crear();
    turno(w, texto(pide));
    const usadosAntes = w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia');
    const ll = { encabezados: { 'X-NovuChat-Numero': PHONE_ID }, url: 'https://x.cloudfunctions.net/configuracionFlujo', cuerpo: w.sesion.consumos[0]! } as never;
    const doble = w.sesion.dobles['Consumir cupos'] as (l: never) => J;
    const otra = doble(ll);
    expect((otra['body'] as J)['resultado']).toBe('repetido');
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(usadosAntes);
  });

  it('el orden: «Consumir cupos» corre ANTES de «Enviar aviso», y el comprobante exento de derivación no consume `transferencias` (ver «Armar avisos»)', () => {
    const w = crear();
    const t = turno(w, texto(pide));
    expect(t.orden.indexOf('Consumir cupos')).toBeGreaterThan(-1);
    expect(t.orden.indexOf('Consumir cupos')).toBeLessThan(t.orden.indexOf('Enviar aviso'));
    expect(t.orden.filter((n) => n === 'Consumir cupos')).toHaveLength(1);
  });
});

// =====================================================================================================
describe('cupo agotado: ningún aviso y el cliente recibe exactamente UN mensaje', () => {
  const agotado = (flujo: Flujo) => {
    const w = crear({}, flujo);
    w.sesion.servidor.sembrarCupo(PHONE_ID, 'avisos', 'comercio', null, 'dia', 150, 150);
    const t = turno(w, texto(pide));
    return { w, t };
  };

  it('con `usados` = tope no sale ningún aviso (ni plantilla ni respaldo), el cliente recibe 1 mensaje con el botón y el error queda anotado', () => {
    const { w, t } = agotado(QTACO);
    expect(t.fallo).toBeNull();
    expect(t.avisos).toHaveLength(0);
    expect(t.ejecutados.has('Enviar aviso')).toBe(false);
    expect(t.mensajes).toHaveLength(1);
    expect(String(t.mensajes[0]!.cuerpo)).toContain('Escribir al local');
    expect(String(t.mensajes[0]!.cuerpo)).not.toMatch(/ya (lo |la )?pas[eé]|pasé tu pedido/i);
    expect((t.resumen as J)['resumen'].errores.join(' ')).toMatch(/cupo_negado: avisos: agotado/);
    // el servidor no se movió
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(150);
  });

  it('MUTACIÓN: con «¿Cupo concedido?» siempre en sí, el aviso SALE aunque el cupo esté agotado (la prueba de arriba lo detecta)', () => {
    const f = mutar((c) => { nodo(c, '¿Cupo concedido?').parameters['conditions'].conditions[0].leftValue = '={{ true }}'; });
    const { t } = agotado(f);
    expect(t.avisos.length).toBeGreaterThan(0);
  });

  it('todo o nada: en el borde del día un aviso de varios mensajes se niega COMPLETO (hoy salía parcial)', () => {
    const w = crear();
    w.sesion.servidor.sembrarCupo(PHONE_ID, 'avisos', 'comercio', null, 'dia', 149, 150); // queda 1; el aviso necesita 2
    const t = turno(w, texto(pide));
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes).toHaveLength(1);
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(149);
  });

  it('el cupo por hora: la segunda derivación del mismo teléfono en la misma hora se niega; otro teléfono y la hora siguiente, no', () => {
    const w = crear();
    expect(turno(w, texto(pide)).avisos.length).toBeGreaterThan(0);
    const b = turno(w, texto(pide));
    expect(b.avisos).toHaveLength(0);
    expect((b.resumen as J)['resumen'].errores.join(' ')).toMatch(/cupo_negado: transferencias: agotado/);
    w.mundo.avanzar(61);
    expect(turno(w, texto(pide)).avisos.length).toBeGreaterThan(0);
  });
});

// =====================================================================================================
describe('asentar: el cupo vuelve solo si NINGÚN aviso fue aceptado por Meta', () => {
  const confirmar = (flujo: Flujo = QTACO, falla = true) => {
    const { w, id } = pedidoListo(flujo);
    if (falla) sinAvisos(w);
    const antes = w.sesion.asentados.length;
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    return { w, t, antes };
  };

  it('con todos los avisos fallidos (plantilla y respaldo), `Confirmar envío` manda el `asentar` y el cupo queda en 0; el cliente lee la frase honesta', () => {
    const { w, t, antes } = confirmar();
    expect(t.fallo).toBeNull();
    expect(w.sesion.asentados.length - antes).toBe(1);
    expect(w.sesion.asentados.at(-1)).toMatchObject({ telefono: CLIENTE, sesion: { accion: 'asentar' } });
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(0);
    expect(w.sesion.servidor.usados(PHONE_ID, 'pedidos', 'contacto', CLIENTE, 'hora')).toBe(0);
    expect(t.mensajes.length).toBeGreaterThan(0);
    expect(t.mensajes.map((m) => m.cuerpo).join('\n')).toContain('No pude pasarle tu pedido');
    // el `asentar` llegó por el nodo existente, sin un nodo nuevo: «Comprometer compensación» recibió el segundo ítem de «Confirmar envío»
    expect(t.ejecutados.has('Comprometer compensación')).toBe(true);
  });

  it('MUTACIÓN: sin la emisión del `asentar` el cupo queda consumido y la prueba de arriba lo detecta', () => {
    const f = mutar((c) => cambiarCodigo(c, 'Confirmar envío', 'const cuerpoAsentar = items[0] &&', 'const cuerpoAsentar = null &&'));
    const { w } = confirmar(f);
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBeGreaterThan(0);
  });

  it('si un aviso SÍ salió (aunque otro fallara), el cupo queda consumido: no se manda `asentar`', () => {
    const { w, id } = pedidoListo();
    let n = 0;
    w.mundo.dobles['Enviar aviso'] = (ll) => (++n === 1 ? { messaging_product: 'whatsapp', messages: [{ id: 'wamid.AV1' }] } : FALLA_META());
    w.mundo.dobles['Aviso de respaldo'] = FALLA_META;
    const antes = w.sesion.asentados.length;
    const t = turno(w, boton(id, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(w.sesion.asentados.length).toBe(antes);
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(2);
  });

  it('un 5xx del `asentar` deja el cupo CONSUMIDO (lado conservador) y no rompe el turno', () => {
    const { w, id } = pedidoListo();
    sinAvisos(w);
    w.sesion.servidor.fallar = (c) => ((c['sesion'] as J | undefined)?.['accion'] === 'asentar' ? 503 : null);
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    expect(t.fallo).toBeNull();
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(2);
  });

  it('«Resumen del turno» localiza la compensación entre sus dos ítems: Meta rechaza al cliente y a los avisos ⇒ se restaura el estado Y se devuelve el cupo', () => {
    const { w, id } = pedidoListo();
    sinAvisos(w);
    w.envios['Enviar a WhatsApp'] = 'error explícito (media ID vencido)';
    w.envios['Enviar respaldo'] = 'error explícito (media ID vencido)';
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    expect(t.fallo?.mensaje).toMatch(/Entrega fallida/);
    expect(t.fallo?.mensaje).toContain('[estado restaurado]');
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(0);
  });

  const soloAsentar = (flujo: Flujo) => {
    const w = crear({}, flujo);
    w.sesion.servidor.fallar = (c) => ((c['sesion'] as J | undefined)?.['accion'] === 'leer' ? 503 : null); // sin estado: no hay nada que compensar; solo el cupo
    sinAvisos(w);
    w.envios['Enviar a WhatsApp'] = 'error explícito (media ID vencido)';
    w.envios['Enviar respaldo'] = 'error explícito (media ID vencido)';
    return { w, t: turno(w, texto('hola'), true) };
  };
  it('con SOLO el `asentar` (sin compensación) «Resumen del turno» no confunde su respuesta con la de la compensación', () => {
    const { w, t } = soloAsentar(QTACO);
    expect(t.porNodo['Confirmar envío']!.map((x) => x['tipo'])).toEqual(['asentar']);
    expect(t.fallo?.mensaje).toMatch(/Entrega fallida/);
    expect(t.fallo?.mensaje).not.toMatch(/restaurado|NO se pudo restaurar/);
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(0);
  });
  it('MUTACIÓN: si «Resumen del turno» tomara la primera respuesta de «Comprometer compensación» sin buscar la de la compensación, diría que el estado NO se pudo restaurar', () => {
    const f = mutar((c) => cambiarCodigo(c, 'Resumen del turno', 'const RT_comp = RT_k >= 0 && RT_respuestas[RT_k] ? ssResultadoDeCompromiso(RT_respuestas[RT_k]) : null;', 'const RT_comp = RT_respuestas.length ? ssResultadoDeCompromiso(RT_respuestas[0]) : null;'));
    expect(soloAsentar(f).t.fallo?.mensaje).toMatch(/NO se pudo restaurar/);
  });
});

// =====================================================================================================
describe('servidor caído: fail-open con el tope LOCAL de caída (política del 21/09/2026: nunca silencio)', () => {
  it('«Consumir cupos» con 5xx: el aviso SALE igual, se cuenta en la memoria local y el cliente recibe 1 mensaje', () => {
    const w = crear();
    w.sesion.servidor.fallar = (c) => (Array.isArray((c['sesion'] as J | undefined)?.['cupos']) ? 503 : null);
    const t = turno(w, texto(pide));
    expect(t.fallo).toBeNull();
    expect(t.avisos.length).toBeGreaterThan(0);
    expect(t.mensajes).toHaveLength(1);
    const sd = (w.mundo.sd['ventaMinima'] ?? {}) as J;
    expect(sd['transferencias'][CLIENTE]).toHaveLength(1);
    expect(sd['av']['dia']['n']).toBe(t.avisos.length);
    expect(w.sesion.servidor.usados(PHONE_ID, 'avisos', 'comercio', null, 'dia')).toBe(0);
    // la segunda derivación de la hora la corta el tope LOCAL (el servidor no responde): sin aviso, igual 1 mensaje
    const b = turno(w, texto(pide));
    expect(b.avisos).toHaveLength(0);
    expect(b.mensajes).toHaveLength(1);
  });

  it('con el servidor TOTALMENTE caído (ni `leer`): el genérico CON el botón y CON aviso a recepción dentro de su tope; nunca silencio', () => {
    const w = crear();
    w.sesion.servidor.fallar = () => 503;
    const t = turno(w, texto('hola'));
    expect(t.fallo).toBeNull();
    expect(t.ejecutados.has('Sin estado')).toBe(true);
    expect(t.mensajes).toHaveLength(1);
    expect(String(t.mensajes[0]!.cuerpo)).toContain('Escribir al local');
    expect(t.avisos.length).toBeGreaterThan(0);
    // el mismo teléfono en la misma hora no vuelve a avisar (tope local de la derivación)
    expect(turno(w, texto('hola')).avisos).toHaveLength(0);
  });

  it('«¿Cupo concedido?» niega SOLO ante `cupo_negado`: un 400, un cuerpo raro o un timeout dejan pasar', () => {
    for (const falla of [400, 500, 503]) {
      const w = crear();
      w.sesion.servidor.fallar = (c) => (Array.isArray((c['sesion'] as J | undefined)?.['cupos']) ? falla : null);
      expect(turno(w, texto(pide)).avisos.length, `${falla}`).toBeGreaterThan(0);
    }
    const raro = crear();
    raro.mundo.dobles['Consumir cupos'] = () => ({ statusCode: 200, body: 'no es json' });
    expect(turno(raro, texto(pide)).avisos.length).toBeGreaterThan(0);
    const lanza = crear();
    lanza.mundo.dobles['Consumir cupos'] = () => { throw new Error('timeout'); };
    expect(turno(lanza, texto(pide)).avisos.length).toBeGreaterThan(0);
  });
});

// =====================================================================================================
describe('reservasDelDia viaja en el bloque del teléfono', () => {
  const reservar = (w: Mundial): ReturnType<typeof turno> => {
    turno(w, boton('m|reserva', 'Reservar'));
    w.estado.extraccion = { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' };
    turno(w, texto('mesa para 4 el viernes a las 8 de la noche en la terraza'));
    return turno(w, boton('r|enviar', 'Enviar'));
  };

  it('tras una reserva cuyo aviso salió, el bloque lleva `reservas: {dia, n: 1}`; la memoria de n8n no guarda nada', () => {
    const w = crear();
    const t = reservar(w);
    expect(t.avisos.length).toBeGreaterThan(0);
    const bloque = w.sesion.bloque(CLIENTE) as J;
    expect(bloque['reservas']).toEqual({ dia: '2026-10-05', n: 1 });
    expect(((w.mundo.sd['ventaMinima'] ?? {}) as J)['reservasDelDia']).toBeUndefined();
  });

  it('si el aviso de la reserva NO salió, no se cuenta (ni queda en la compensación)', () => {
    const w = crear();
    sinAvisos(w);
    reservar(w);
    expect((w.sesion.bloque(CLIENTE) as J | null)?.['reservas']).toBeUndefined();
  });

  it('el techo duro (2 × topeReservasDia) sale del bloque: con 2 reservas anotadas y tope 1, la tercera no arma aviso ni dice que se anotó', () => {
    const w = crear({}, QTACO, { topeReservasDia: 1 });
    expect(reservar(w).avisos.length).toBeGreaterThan(0);
    expect(reservar(w).avisos.length).toBeGreaterThan(0); // blando: se anota y el aviso lo marca
    expect((w.sesion.bloque(CLIENTE) as J)['reservas']).toEqual({ dia: '2026-10-05', n: 2 });
    const tercera = reservar(w);
    expect(tercera.avisos).toHaveLength(0);
    expect(tercera.mensajes.map((m) => m.cuerpo).join('\n')).toContain('No pude hacer llegar tu reserva');
  });

  it('la replanificación (2.º intento) conserva las reservas del ganador y suma la de este turno', () => {
    const w = crear();
    turno(w, boton('m|reserva', 'Reservar'));
    w.estado.extraccion = { personas: 4, fecha: '2026-10-09', hora: '20:00', zona: 'terraza', nombre: 'Ana Pérez', celebracion: '', requerimiento: '' };
    turno(w, texto('mesa para 4 el viernes a las 8 de la noche en la terraza'));
    // otra ejecución del mismo teléfono comprometió primero (con 2 reservas del día): conflicto de versión CON hecho externo (el aviso ya salió)
    let rival = false;
    w.sesion.servidor.antesDeComprometer = (c) => {
      const q = c['sesion'] as J;
      if (rival || q['accion'] !== 'comprometer' || Array.isArray(q['cupos'])) return;
      rival = true;
      const b = (w.sesion.bloque(CLIENTE) ?? { v: 1, estado: {}, pedidos: {} }) as J;
      w.sesion.sembrarBloque(CLIENTE, { ...b, reservas: { dia: '2026-10-05', n: 2 } });
    };
    const t = turno(w, boton('r|enviar', 'Enviar'), true);
    expect(t.fallo).toBeNull();
    expect(t.ejecutados.has('Comprometer turno (2.º intento)')).toBe(true);
    expect((w.sesion.bloque(CLIENTE) as J)['reservas']).toEqual({ dia: '2026-10-05', n: 3 });
  });
});

// =====================================================================================================
describe('0 mensajes por conversación agregados o quitados', () => {
  it('hola → pedido → confirmar con QR → foto → menú: UN mensaje por turno, igual que antes de PR-4b', () => {
    const w = crear();
    const cuenta: number[] = [];
    cuenta.push(turno(w, texto('hola')).mensajes.length);
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    cuenta.push(resumen.mensajes.length);
    const conf = turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido'));
    cuenta.push(conf.mensajes.length);
    cuenta.push(turno(w, { type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: '' } }).mensajes.length);
    cuenta.push(turno(w, texto('menú')).mensajes.length);
    expect(cuenta).toEqual([1, 1, 1, 1, 1]);
    expect(AV1).not.toBe(AV2);
  });
});

// =====================================================================================================
describe('tope de 71 nodos: «Consumir cupos» y «¿Cupo concedido?» no agregan ni alteran lo que lee el cliente', () => {
  /** Lo que el cliente recibe, tal cual (texto, botones, tipo): la secuencia completa de un recorrido con aviso. */
  const recorrido = (w: Mundial): string[] => {
    const v: string[] = [];
    const anota = (t: ReturnType<typeof turno>) => v.push(JSON.stringify(t.mensajes));
    anota(turno(w, texto('hola')));
    anota(turno(w, texto(pide)));
    w.mundo.avanzar(61);
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    anota(resumen);
    anota(turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido')));
    return v;
  };
  const conPanel = (flujo: Flujo = QTACO) => crear({}, flujo, {}, { 'Traer configuración': () => ({ statusCode: 200, body: { ...panel(), cobro: { activo: false } } }) });

  it('misma secuencia al cliente (mensajes, botones y textos) con el servidor contando que con «Consumir cupos» fuera de servicio (el flujo anterior): ni uno más, ni uno menos, ni uno distinto', () => {
    const con = recorrido(conPanel());
    const sin = conPanel();
    sin.sesion.servidor.fallar = (c) => (Array.isArray((c['sesion'] as J | undefined)?.['cupos']) ? 503 : null); // sin el servidor de cupos: lo mismo que no tener los dos nodos
    expect(recorrido(sin)).toEqual(con);
    expect(con.map((x) => (JSON.parse(x) as unknown[]).length)).toEqual([1, 1, 1, 1]);
  });

  it('BORDE: con el cupo agotado el cliente lee «No pude pasarle tu pedido…» y NO «pasé tu pedido»; sigue siendo UN mensaje', () => {
    const { w, id } = pedidoListo();
    w.sesion.servidor.sembrarCupo(PHONE_ID, 'avisos', 'comercio', null, 'dia', 150, 150);
    const t = turno(w, boton(id, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(t.avisos).toHaveLength(0);
    expect(t.mensajes).toHaveLength(1);
    const leido = t.mensajes.map((m) => String(m.cuerpo)).join('\n');
    expect(leido).toContain('No pude pasarle');
    expect(leido).not.toMatch(/pas[eé] tu pedido|ya (lo |la )?pas[eé]/i);
  });

  it('el flujo versionado de Q\'Taco tiene exactamente 71 nodos y ninguno de los dos es de mensajería al cliente', () => {
    expect(QTACO.nodes).toHaveLength(71);
    for (const n of ['Consumir cupos', '¿Cupo concedido?']) {
      expect(String(nodo(QTACO, n).type)).not.toMatch(/whatsapp/i);
      expect(JSON.stringify(nodo(QTACO, n).parameters)).not.toMatch(/graph\.facebook|messages/);
    }
  });
});

// =====================================================================================================
describe('avisos ya enviados cuyo compromiso falló: la marca lleva el teléfono (`teléfono|clave`)', () => {
  const sinCompromiso = (c: J): number | null => { const q = c['sesion'] as J | undefined; return q && q['accion'] === 'comprometer' && !Array.isArray(q['cupos']) ? 503 : null; };
  const huerfanos = (w: Mundial): string[] => Object.keys((((w.mundo.sd['ventaMinima'] ?? {}) as J)['avisosHuerfanos'] ?? {}) as J);
  const escenario = (flujo: Flujo) => {
    const { w, id } = pedidoListo(flujo);
    w.sesion.servidor.fallar = sinCompromiso;
    const t1 = turno(w, boton(id, 'Confirmar pedido'), true);
    const marcas = huerfanos(w);
    w.sesion.servidor.fallar = null;
    const consumos = w.sesion.consumos.length;
    const t2 = turno(w, boton(id, 'Confirmar pedido'), true);
    return { w, t1, t2, marcas, consumos };
  };

  it('el aviso salió y el estado no se guardó: la marca es `teléfono|clave`; el reintento NO repite el aviso ni pide otro cupo, y al avanzar el estado la marca se borra (reutiliza `clavesYa`)', () => {
    const { w, t1, t2, marcas, consumos } = escenario(QTACO);
    expect(t1.avisos.length).toBeGreaterThan(0);
    expect(t1.mensajes).toHaveLength(1); // el genérico con el botón
    expect(marcas.length).toBeGreaterThan(0);
    for (const k of marcas) expect(k.startsWith(`${CLIENTE}|`), k).toBe(true);
    expect(t2.avisos).toHaveLength(0);
    expect(w.sesion.consumos.length).toBe(consumos); // sin aviso que armar no se pide cupo
    expect((t2.resumen as J)['resumen'].errores.join(' ')).toMatch(/aviso_ya_enviado/);
    expect(huerfanos(w)).toEqual([]);
  });

  it('MUTACIÓN: sin el prefijo del teléfono en `Armar avisos` el aviso del pedido de otro cliente se suprimiría; el de OTRO teléfono nunca tapa el de este', () => {
    const { w, id } = pedidoListo();
    // la marca de otro teléfono con el mismo `tipo:pedidoId` no suprime el aviso de este
    w.sesion.servidor.fallar = sinCompromiso;
    turno(w, boton(id, 'Confirmar pedido'), true);
    w.sesion.servidor.fallar = null;
    const sd = (w.mundo.sd['ventaMinima'] ?? {}) as J;
    const m = sd['avisosHuerfanos'] as J;
    const [k] = Object.keys(m);
    const clave = k!.slice(k!.indexOf('|') + 1);
    delete m[k!];
    m[`59100000099|${clave}`] = w.mundo.ahora();
    const t = turno(w, boton(id, 'Confirmar pedido'), true);
    expect(t.avisos.length).toBeGreaterThan(0);
  });

  it('MUTACIÓN: si `Armar mensajes` anotara las marcas de `clavesYa` sin prefijo, la marca no se borraría al avanzar el estado (la prueba la detecta)', () => {
    const f = mutar((c) => cambiarCodigo(c, 'Armar mensajes', "AM_claves.indexOf(AM_FROM + '|' + c) < 0) AM_claves.push(AM_FROM + '|' + c);", 'AM_claves.indexOf(c) < 0) AM_claves.push(c);'));
    const { w } = escenario(f);
    expect(huerfanos(w).length).toBeGreaterThan(0);
  });
});
