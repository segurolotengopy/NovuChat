/**
 * =============================================================================
 * «SE ENTREGA LO QUE SE PROMETE» EN Q'TACO (Venta mínima v0) — R1, R3 y R5
 * =============================================================================
 *
 * EL CASO QUE LO ORIGINÓ (03/10/2026, Demo B). El QR del cobro falló porque Meta rechazó un media ID vencido; el texto iba
 * en el PIE de la imagen y el cliente no recibió nada, y n8n mostró `success`. La regla (`NOVUCHAT_plan-entrega-de-lo-prometido`,
 * PR-7 es Q'Taco) y cómo la cumple este flujo SIN NODOS NUEVOS (presupuesto de 50 nodos de producción):
 *
 *   R1  un envío cuenta como hecho solo si Meta devolvió un `messages[0].id` no vacío. `¿Falló el envío?` decide por ese id
 *       (no por `$json.error`) y el reporte saliente cuenta solo con `idMeta`;
 *   R3  si el respaldo en texto TAMBIÉN falla, la ejecución termina en ERROR (no en `success`), sin reportar nada como enviado y
 *       sin dejar el estado del teléfono en el paso nuevo: lo hace `Resumen del turno` (un Code que ya corre al final) con `throw`;
 *   R5  ningún fallo tragado: un envío con `continueRegularOutput` exige un verificador del id y `continueErrorOutput` exige su
 *       salida de error conectada. Lo hace cumplir `construir.mjs --verificar` sobre los JSON versionados.
 *
 * ESTA SUITE ESCRIBE NEGANDO. Corre el JSON VERSIONADO con el n8n de mentira (`lib/n8n-de-mentira.ts`): Meta rechaza de todas
 * las formas posibles (error, cuerpo vacío, sin `messages`, id vacío, excepción de red), y cada caso tiene su contraprueba
 * estática: se rompe una guardia en una COPIA del JSON y `--verificar` tiene que fallar.
 *
 * COSTO EN MENSAJES: 0 por conversación en el camino feliz. +1 al cliente solo en el turno en que el envío principal falla
 * (el respaldo en texto), en lugar del silencio.
 */
import { describe, expect, it } from 'vitest';
import { type Flujo, type J } from './lib/flujo';
import { FalloDeNodo } from './lib/n8n-de-mentira';
import { boton, cobrosAbiertos, CLIENTE, crear, editarJson, estadoDe, idDeBoton, leer, marcar, nodoDe, PHONE_ID, QR_URL, QTACO, RECHAZOS, salientes, texto, turno, verificarEnCopia, type ModoDeEnvio } from './lib/venta-minima-mundo';

const PLANTILLA_R3 = leer('flujo.plantilla.json');

/** Un pedido armado hasta «Confirmar pedido»: la confirmación es el turno que manda el QR. */
function pedidoListoParaConfirmar(envios: Partial<Record<'Enviar a WhatsApp' | 'Enviar respaldo', ModoDeEnvio>> = {}) {
  const w = crear();
  turno(w, texto('hola'));
  turno(w, texto('hola'));
  w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: 'sin cebolla' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
  const resumen = turno(w, texto('quiero 4 tacos de birria'));
  const idConfirmar = idDeBoton(resumen, 'Confirmar pedido');
  // A partir de acá Meta rechaza como diga el caso.
  Object.assign(w.envios, envios);
  return { w, idConfirmar, estadoAntes: JSON.parse(JSON.stringify(estadoDe(w))) as J };
}

// =====================================================================================================
// 1. EL CAMINO FELIZ NO CAMBIA
// =====================================================================================================
describe('entrega: lo que Meta acepta sigue igual (0 mensajes de más)', () => {
  it('con Meta aceptando, el QR sale una sola vez, se reporta con su `idMeta`, abre el cobro una vez y la ejecución no falla', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar();
    const desde = marcar(w);
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes.map((m) => [m.nodo, m.ok, m.tipo])).toEqual([['Enviar a WhatsApp', true, 'image']]);
    expect(t.ejecutados.has('Enviar respaldo')).toBe(false);
    expect(cobrosAbiertos(w, desde)).toHaveLength(1);
    const rep = salientes(w, desde);
    expect(rep.length).toBeGreaterThan(0);
    for (const r of rep) expect(String(r['idMeta']), JSON.stringify(r)).toMatch(/^wamid\./);
    expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
  });
});

// =====================================================================================================
// 2. R1 y la réplica del caso del 03/10: el envío principal falla y el respaldo en texto SÍ sale
// =====================================================================================================
describe('R1: el envío falla por cualquiera de sus formas y el cliente recibe el respaldo en texto', () => {
  for (const modo of [...Object.keys(RECHAZOS), 'lanza']) {
    it(`QR rechazado por Meta (${modo}): sale el mismo texto con el enlace al QR, se reporta SOLO el respaldo y el cobro se abre una vez`, () => {
      const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': modo });
      const desde = marcar(w);
      const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
      expect(t.fallo).toBeNull();
      // Por nodo, no por `ok`: una respuesta VACÍA no trae `error` y el arnés la da por `ok`, pero no es un envío hecho.
      expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
      expect(t.mensajes[1]?.ok).toBe(true);
      // El texto que iba en el PIE de la imagen (caso del 03/10) llega entero, más el enlace para abrir el QR.
      const imagen = t.mensajes[0]?.payload['image']?.caption as string;
      const respaldo = t.mensajes[1]?.cuerpo ?? '';
      expect(typeof imagen).toBe('string');
      expect(respaldo).toContain(imagen.slice(0, 60));
      expect(respaldo).toContain(`Abre el QR aquí: ${QR_URL}`);
      // Reporte por hecho: uno, con el id del respaldo; el rechazado no cuenta.
      const rep = salientes(w, desde);
      expect(rep).toHaveLength(1);
      expect(String(rep[0]?.['idMeta'])).toMatch(/^wamid\.Enviarrespaldo/);
      expect(cobrosAbiertos(w, desde)).toHaveLength(1);
      expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
    });
  }
});

// =====================================================================================================
// 3. R3: Meta rechaza el envío principal Y el respaldo
// =====================================================================================================
describe('R3: si el respaldo también falla, la ejecución termina en ERROR, sin reportes y sin estado nuevo', () => {
  for (const principal of [...Object.keys(RECHAZOS), 'lanza']) {
    for (const respaldo of [...Object.keys(RECHAZOS), 'lanza']) {
      // 7 x 7 = 49 combinaciones es mucho ruido: se prueban las diagonales y los extremos.
      if (principal !== respaldo && !(principal === 'lanza' || respaldo === 'lanza' || principal.startsWith('error') || respaldo.startsWith('cuerpo'))) continue;
      it(`principal «${principal}» y respaldo «${respaldo}»: error visible (Entrega fallida), 0 reportes salientes, el cobro NO se abre y el estado vuelve al previo`, () => {
        const { w, idConfirmar, estadoAntes } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': principal, 'Enviar respaldo': respaldo });
        // Sin tolerar el fallo, el turno LANZA: es lo que n8n marca como ejecución con error.
        const desde = marcar(w);
        expect(() => turno(w, boton(idConfirmar, 'Confirmar pedido'))).toThrow(/Entrega fallida/);
        expect(salientes(w, desde)).toHaveLength(0);
        expect(cobrosAbiertos(w, desde)).toHaveLength(0);
        // El estado no quedó en el paso que el cliente nunca vio (un QR que no llegó).
        expect(estadoDe(w)['paso']).not.toBe('esperando_comprobante');
        expect(estadoDe(w)['paso']).toBe(estadoAntes['paso']);
      });
    }
  }

  it('la nota del nodo «Resumen del turno» describe la regla del HECHO EXTERNO (no la reversión incondicional de antes), en la plantilla y en los tres JSON', () => {
    for (const f of [PLANTILLA_R3, QTACO, leer('venta-minima.prueba.json'), leer('venta-minima.ensayo-demo-a.json')]) {
      const nota = String((nodoDe(f, 'Resumen del turno') as unknown as J)['notes']);
      expect(nota).toContain('SIN hecho externo');
      expect(nota).toContain('CON un aviso ya enviado o un cierre ya registrado NO lo revierte');
      expect(nota).toContain('conservando su ancla');
      expect(nota).not.toContain('y antes devuelve el estado del teléfono al de antes del turno');
    }
  });

  it('el fallo queda en «Resumen del turno» (el último nodo), el error no lleva texto ni teléfono del cliente, y ese nodo es el único que lo lanza', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'), true);
    expect(t.fallo?.nodo).toBe('Resumen del turno');
    expect(t.fallo?.mensaje).toMatch(/Entrega fallida/);
    expect(t.fallo?.mensaje).not.toContain(CLIENTE);
    expect(t.fallo?.mensaje).not.toMatch(/birria|Q'Taco|QR/i);
    expect(t.orden[t.orden.length - 1]).toBe('Resumen del turno');
    // Todo lo anterior corrió: los envíos se intentaron antes de dar el turno por fallido.
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
  });

  it('el mismo turno que falla se puede reintentar: el cliente toca «Confirmar» otra vez y, con Meta de vuelta, recibe el QR y se abre UN cobro', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    expect(() => turno(w, boton(idConfirmar, 'Confirmar pedido'))).toThrow(/Entrega fallida/);
    w.envios['Enviar a WhatsApp'] = 'acepta';
    w.envios['Enviar respaldo'] = 'acepta';
    const desde = marcar(w);
    const t = turno(w, boton(idConfirmar, 'Confirmar pedido'));
    expect(t.fallo).toBeNull();
    expect(t.mensajes.some((m) => m.ok && m.tipo === 'image')).toBe(true);
    expect(cobrosAbiertos(w, desde)).toHaveLength(1);
    expect(estadoDe(w)['paso']).toBe('esperando_comprobante');
  });

  it('un turno cuyos mensajes sí salieron (aunque sea por el respaldo) nunca falla, y un turno SIN mensajes tampoco', () => {
    const { w } = pedidoListoParaConfirmar();
    expect(turno(w, texto('hola')).fallo).toBeNull();
    // Acuse de estado: no es un mensaje, no pasa por los envíos.
    const acuse = w.mundo.turno({ headers: { 'x-aab1-delivery-id': 'acuse-1' }, body: { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'x', status: 'delivered' }] } } }, { tolerarFallo: true });
    expect(acuse.fallo).toBeNull();
  });
});

// =====================================================================================================
// 3b. LOS DEFECTOS VIEJOS, REPRODUCIDOS: la prueba de que estas pruebas sí los verían
// =====================================================================================================
describe('contrapruebas: con el defecto viejo puesto, el cliente se queda sin nada y la ejecución sale en success', () => {
  const sin = (cambio: (f: Flujo) => void): Flujo => {
    const f = JSON.parse(JSON.stringify(QTACO)) as Flujo;
    cambio(f);
    return f;
  };
  it('IF que mira solo `$json.error`: Meta contesta sin id y sin error, NO se manda el respaldo y nadie lo nota (el flujo real SÍ lo manda)', () => {
    const viejo = sin((f) => { nodoDe(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ !!($json && $json.error) }}'; });
    const w = crear({ 'Enviar a WhatsApp': 'sin `messages`' }, viejo);
    const t = turno(w, texto('hola'), true);
    // El cliente no recibió nada: ni respaldo ni nada. (Solo el último recurso de `Resumen del turno` evita que la ejecución salga en success.)
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp']);
    // El flujo versionado, con el mismo rechazo, manda el respaldo.
    const real = crear({ 'Enviar a WhatsApp': 'sin `messages`' });
    const tr = turno(real, texto('hola'), true);
    expect(tr.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
  });

  it('respaldo sin `throw`: el principal y el respaldo fallan y la ejecución termina en success (el flujo real termina en error)', () => {
    const viejo = sin((f) => { const n = nodoDe(f, 'Resumen del turno'); n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/throw new Error\(/g, 'void ('); });
    const w = crear({ 'Enviar a WhatsApp': 'sin `messages`', 'Enviar respaldo': 'cuerpo vacío' }, viejo);
    const t = turno(w, texto('hola'), true);
    expect(t.fallo).toBeNull(); // success con el cliente sin respuesta: el defecto del 03/10
    expect(t.mensajes.map((m) => m.nodo)).toEqual(['Enviar a WhatsApp', 'Enviar respaldo']);
    const real = crear({ 'Enviar a WhatsApp': 'sin `messages`', 'Enviar respaldo': 'cuerpo vacío' });
    expect(turno(real, texto('hola'), true).fallo?.nodo).toBe('Resumen del turno');
  });

  it('el reporte saliente sin la condición del id contaría un mensaje que no salió (el flujo real no reporta nada)', () => {
    const viejo = sin((f) => { nodoDe(f, '¿Reportar? (saliente)').parameters['conditions'].conditions[0].leftValue = "={{ $('Armar mensajes').item.json.reportar === true }}"; });
    const w = crear({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' }, viejo);
    const desde = marcar(w);
    const t = turno(w, texto('hola'), true);
    expect(salientes(w, desde).length).toBeGreaterThan(0); // reportó como enviado lo que Meta rechazó
    expect(t.fallo).not.toBeNull();
    const real = crear({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    const d2 = marcar(real);
    turno(real, texto('hola'), true);
    expect(salientes(real, d2)).toHaveLength(0);
  });
});

// =====================================================================================================
// 4. Las guardias de `construir.mjs --verificar` (R1, R3, R5): cada una con su negativo sobre una COPIA del JSON versionado
// =====================================================================================================
describe('las guardias de entrega de `construir.mjs --verificar` (sobre los JSON versionados)', () => {
  const nodo = nodoDe;
  const rompe = (etiqueta: string, cambio: (f: Flujo) => void, mensaje: RegExp, archivo = 'venta-minima.qtaco.json') => {
    it(`FALLA: ${etiqueta}`, () => {
      const r = verificarEnCopia((vm) => editarJson(vm, archivo, cambio));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(mensaje);
    });
  };

  it('contraprueba: sin tocar nada, `--verificar` sale con 0 (las tres variantes al día)', () => {
    const r = verificarEnCopia(() => undefined);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('venta-minima.qtaco.json al día');
  });

  // R1
  rompe('`¿Falló el envío?` mira SOLO `$json.error` (la forma vieja)', (f) => {
    const c = nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0];
    c.leftValue = '={{ !!($json && $json.error) }}';
  }, /R1: «¿Falló el envío\?»/);
  rompe('`¿Falló el envío?` mira el id Y el `error`', (f) => {
    const c = nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0];
    c.leftValue = '={{ !!($json.error) || !((($json.messages || [])[0] || {}).id) }}';
  }, /R1: «¿Falló el envío\?» mira `error`/);
  rompe('`¿Reportar? (saliente)` ya no exige el id de Meta', (f) => {
    nodo(f, '¿Reportar? (saliente)').parameters['conditions'].conditions[0].leftValue = "={{ $('Armar mensajes').item.json.reportar === true }}";
  }, /R1: «¿Reportar\? \(saliente\)» no exige/);
  rompe('`Reportar mensaje (saliente)` no manda `idMeta` desde el id de Meta', (f) => {
    const n = nodo(f, 'Reportar mensaje (saliente)');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).replace("((($json || {}).messages || [])[0] || {}).id || ''", "''");
  }, /R1: «Reportar mensaje \(saliente\)» no manda `idMeta`/);

  // R3
  rompe('`Resumen del turno` sin `throw` (el respaldo falla y la ejecución termina en success)', (f) => {
    const n = nodo(f, 'Resumen del turno');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/throw new Error\(/g, 'console.log(');
  }, /R3: «Resumen del turno» no lanza error/);
  rompe('`Resumen del turno` ya no mira el respaldo', (f) => {
    const n = nodo(f, 'Resumen del turno');
    n.parameters['jsCode'] = String(n.parameters['jsCode']).replace(/Enviar respaldo/g, 'Otro nodo');
  }, /R3: «Resumen del turno» no lanza error/);
  rompe('`Resumen del turno` queda ARRIBA de los envíos (correría antes de enviar)', (f) => {
    nodo(f, 'Resumen del turno').position = [7400, 100];
  }, /R3: «Resumen del turno» debe estar por debajo/);
  rompe('alguien agrega un nodo «Entrega fallida» (consume presupuesto de nodos; el último recurso va en Resumen)', (f) => {
    f.nodes.push({ id: 'entrega-fallida', name: 'Entrega fallida', type: 'n8n-nodes-base.code', parameters: { jsCode: 'throw new Error("x")' } } as Flujo['nodes'][number]);
  }, /R3: no hay nodo «Entrega fallida»/);

  // R5
  rompe('un envío con `continueErrorOutput` y la salida de error VACÍA', (f) => {
    nodo(f, 'Enviar a WhatsApp').onError = 'continueErrorOutput';
    f.connections['Enviar a WhatsApp'] = { main: [(f.connections['Enviar a WhatsApp'] as J).main[0], []] };
  }, /R5: «Enviar a WhatsApp» usa continueErrorOutput con la salida de error desconectada/);
  rompe('el respaldo con `continueErrorOutput` y la salida de error desconectada', (f) => {
    nodo(f, 'Enviar respaldo').onError = 'continueErrorOutput';
  }, /R5: «Enviar respaldo» usa continueErrorOutput con la salida de error desconectada/);
  rompe('un envío NUEVO a Meta con `continueRegularOutput` y sin verificador del id', (f) => {
    const molde = nodo(f, 'Enviar a WhatsApp');
    f.nodes.push({ ...molde, id: 'enviar-otro', name: 'Enviar otro', position: [7640, 900] });
  }, /R5: «Enviar otro» \(envío a Meta con continueRegularOutput\) no tiene un verificador/);
  // CodeQL `js/regex/missing-regexp-anchor` (revisión del PR #382): «es un envío a Meta» se decide por el ANFITRIÓN de la URL, anclado al inicio
  // (con o sin el `=` de una expresión de n8n), no por un texto que aparece en cualquier parte (un parámetro, otra ruta).
  describe('«es un envío a Meta» se decide por el anfitrión anclado de la URL', () => {
    const conUrl = (url: string) => verificarEnCopia((vm) => editarJson(vm, 'venta-minima.qtaco.json', (f) => {
      const molde = nodo(f, 'Enviar a WhatsApp');
      f.nodes.push({ ...molde, id: 'enviar-otro', name: 'Enviar otro', position: [7640, 900], parameters: { ...molde.parameters, url } });
    }));
    const DETECTADO = /R5: «Enviar otro» \(envío a Meta con continueRegularOutput\) no tiene un verificador/;
    for (const url of [
      'https://graph.facebook.com/v26.0/x/messages', 'HTTPS://GRAPH.FACEBOOK.COM/v26.0/x/messages', '  https://graph.facebook.com/v26.0/x/messages',
      'http://graph.facebook.com:443/x/messages', '=https://graph.facebook.com/{{ $json.v }}/x/messages', '= https://graph.facebook.com/{{ $json.v }}/messages',
      "=https://graph.facebook.com/{{ $json.waGraphVersion || 'v26.0' }}/{{ $json.phoneNumberId }}/messages",
    ]) {
      it(`SÍ cuenta como envío a Meta: ${url.trim().slice(0, 60)}`, () => {
        expect(conUrl(url).stderr).toMatch(DETECTADO);
      });
    }
    for (const url of [
      'https://otro.dominio/?x=graph.facebook.com/messages', 'https://otro.dominio/graph.facebook.com/x/messages', 'https://graph.facebook.com.otro.invalid/x/messages',
      'https://otro.dominio/x/messages#graph.facebook.com', 'ftp://graph.facebook.com/x/messages',
      // El anfitrión solo dentro de una expresión (no abre la URL): tampoco es un envío a Meta (CodeQL js/incomplete-url-substring-sanitization).
      "={{ 'x' }}graph.facebook.com/x/messages", '={{ "https://" + "graph.facebook.com" + "/x/messages" }}', '={{ $json.base }}/graph.facebook.com/x/messages',
    ]) {
      it(`NO cuenta como envío a Meta (el anfitrión no es el de Meta): ${url.slice(0, 60)}`, () => {
        const r = conUrl(url);
        expect(r.stderr).not.toMatch(DETECTADO);
        expect(r.status).toBe(1); // y `--verificar` igual lo rechaza por otra guardia (anfitrión fuera de la lista)
        expect(r.stderr).toContain('anfitrión fuera de la lista');
      });
    }
  });
  rompe('el verificador del envío ya no lee el id (`¿Falló el envío?` decide por un campo cualquiera)', (f) => {
    nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ $json.ok !== true }}';
  }, /R5: el verificador «¿Falló el envío\?» de «Enviar a WhatsApp» no lee messages\[0\]\.id/);
  rompe('el verificador del respaldo ya no corre después de él (su rama pasa ARRIBA)', (f) => {
    nodo(f, 'Resumen del turno').position = [7400, 100];
  }, /R5: el verificador «Resumen del turno» no corre después de «Enviar respaldo»/);
  rompe('el envío principal con `continueOnFail`', (f) => {
    (nodo(f, 'Enviar a WhatsApp') as unknown as J)['continueOnFail'] = true;
  }, /R5: «Enviar a WhatsApp» es un envío a Meta con continueOnFail/);

  // Variantes: las guardias valen para las tres salidas
  for (const archivo of ['venta-minima.prueba.json', 'venta-minima.ensayo-demo-a.json']) {
    rompe(`(${archivo}) `+ '`¿Falló el envío?` mira solo `error`', (f) => {
      nodo(f, '¿Falló el envío?').parameters['conditions'].conditions[0].leftValue = '={{ !!($json && $json.error) }}';
    }, /R1: «¿Falló el envío\?»/, archivo);
  }
});

// =====================================================================================================
// 5. El presupuesto de nodos: la regla de entrega NO sumó ningún nodo
// =====================================================================================================
describe('presupuesto de nodos de producción (Andres, 03/10/2026): 50 como máximo', () => {
  it('el JSON de Q\'Taco tiene como máximo 50 nodos y NO tiene un nodo «Entrega fallida» (R3 va dentro de «Resumen del turno»)', () => {
    expect(QTACO.nodes.length).toBeLessThanOrEqual(50);
    expect(QTACO.nodes.map((n) => n.name)).not.toContain('Entrega fallida');
  });

  it('`--verificar` FALLA si un JSON de producción crece por encima de 50 nodos', () => {
    const r = verificarEnCopia((vm) => editarJson(vm, 'venta-minima.qtaco.json', (f) => {
      f.nodes.push({ id: 'uno-de-mas', name: 'Uno de más', type: 'n8n-nodes-base.noOp', parameters: {} } as Flujo['nodes'][number]);
    }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/tiene 51 nodos y el tope de producción es 50/);
  });

  it('el error de entrega es de verdad un error de n8n: `FalloDeNodo` (y no un `success` con un aviso adentro)', () => {
    const { w, idConfirmar } = pedidoListoParaConfirmar({ 'Enviar a WhatsApp': 'cuerpo vacío', 'Enviar respaldo': 'cuerpo vacío' });
    let capturado: unknown = null;
    try { turno(w, boton(idConfirmar, 'Confirmar pedido')); } catch (e) { capturado = e; }
    expect(capturado).toBeInstanceOf(FalloDeNodo);
  });
});
