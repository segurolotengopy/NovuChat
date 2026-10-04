/**
 * =============================================================================
 * TOPOLOGÍA DEL CATÁLOGO WEB EN Q'TACO (Venta mínima v0): el cableado, no la conversación
 * =============================================================================
 *
 * DECISIONES DE ANDRES (03/10/2026): el catálogo web como el del Demo B tiene que estar para el lunes 05/10, SIN SUBIR NODOS
 * (la complejidad de los nodos de n8n ya impidió salir otras veces): el JSON de producción de Q'Taco pasa de 49 a 50 nodos
 * COMO MÁXIMO. El único nodo nuevo es la segunda entrada de producción, el webhook `Carrito del catálogo`:
 *
 *   - `Carrito del catálogo` (Webhook, `headerAuth` con la credencial de la ingesta, `responseMode: onReceived`, ruta como el
 *     marcador propio de Q'Taco) cuelga DIRECTO de `Carga de entrada`, que valida el carrito SOLO si ese nodo corrió;
 *   - el enlace de la carta NO tiene nodos: lo trae `Traer configuración` (que ya corre en cada turno) pidiendo
 *     `catalogoCompleto: true`, y el servidor responde `catalogoWeb.enlace`;
 *   - nada de `¿Pedir enlace?`, `Pedir enlace del catálogo`, `Validar carrito`, `Carga del carrito` ni `Entrega fallida`.
 *
 * ESTA SUITE PRUEBA SOLO LA TOPOLOGÍA (lo que es de T). El código de `Carga de entrada` que valida el carrito y el mensaje de
 * la carta con el enlace son de C y se prueban en su suite. Acá se escribe negando: un cuerpo de otro número o sin cabeceras
 * no llega a hablar con nadie, y `construir.mjs --verificar` falla si se rompe cualquiera de las guardias.
 *
 * MENSAJES POR CONVERSACIÓN: 0 agregados por la topología (el enlace va en el mismo mensaje que ya sale; el carrito, por la
 * página, responde con un solo mensaje, igual que en el Demo B).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destinos, entradas, type Flujo, type J } from './lib/flujo';
import {
  boton, CARPETA_VM, crear, editarJson, idDeBoton, leer, nodoDe, PHONE_ID, QTACO, texto, turno, verificarEnCopia,
} from './lib/venta-minima-mundo';

const PRUEBA = leer('venta-minima.prueba.json');
const DEMO_A = leer('venta-minima.ensayo-demo-a.json');
const PLANTILLA = leer('flujo.plantilla.json');
const MARCADOR = 'REEMPLAZAR_RUTA_CARRITO_QTACO';
const CARRITO = 'Carrito del catálogo';
const NOMBRES_QUE_NO_VAN = ['¿Pedir enlace?', 'Pedir enlace del catálogo', 'Enlace del catálogo', 'Validar carrito', '¿Carrito válido?', 'Carga del carrito', 'Config del carrito', 'Mensaje del carrito', 'Entrega fallida'];

// =====================================================================================================
// 1. EL CABLEADO
// =====================================================================================================
describe('el webhook del carrito: la segunda y última entrada de producción', () => {
  const w = nodoDe(QTACO, CARRITO);

  it('es un Webhook POST con headerAuth, responde al recibir y lleva la ruta como el marcador propio de Q\'Taco (no el del Demo B)', () => {
    expect(w.type).toBe('n8n-nodes-base.webhook');
    expect(w.parameters).toMatchObject({ httpMethod: 'POST', authentication: 'headerAuth', responseMode: 'onReceived', path: MARCADOR });
    expect(MARCADOR).not.toBe('REEMPLAZAR_RUTA_CARRITO'); // el del Demo B ya existe en la tabla local con otra ruta
    expect((w as unknown as J)['webhookId']).toBeUndefined(); // un webhookId compartiría la ruta de Meta
  });

  it('usa la credencial de cabecera de la INGESTA de Q\'Taco, por nombre y con el id vacío (la credencial es la que n8n exige)', () => {
    const datos = JSON.parse(readFileSync(join(CARPETA_VM, '../../../admin/scripts/datos/venta-minima/qtaco.json'), 'utf8')) as J;
    expect(w.credentials?.['httpHeaderAuth']).toEqual({ id: '', name: datos['credenciales'].ingesta });
    // La misma credencial con la que el flujo habla con la ingesta (la que el servidor manda en `Authorization`).
    expect(nodoDe(QTACO, 'Traer configuración').credentials?.['httpHeaderAuth']?.name).toBe(datos['credenciales'].ingesta);
  });

  it('cuelga SOLO de `Carga de entrada` (y esa es su única entrada: no hay ningún nodo entre el webhook y la validación)', () => {
    expect(destinos(QTACO, CARRITO)).toEqual(['Carga de entrada']);
    expect(entradas(QTACO, CARRITO)).toEqual([]);
    expect(entradas(QTACO, 'Carga de entrada').sort()).toEqual(['Descartar repetidos', CARRITO].sort());
    // La ruta del receptor sigue igual: firma, 200 o 401, repetidos.
    expect(destinos(QTACO, 'Entrega del receptor')).toEqual(['Verificar firma con el receptor']);
    expect(destinos(QTACO, 'Descartar repetidos')).toEqual(['Carga de entrada']);
  });

  it('el carrito no pasa por el verificador de firma del receptor ni por `Descartar repetidos` (son de WhatsApp, no del carrito)', () => {
    for (const n of ['Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos']) {
      expect(entradas(QTACO, n), n).not.toContain(CARRITO);
    }
  });

  it('el JSON de producción tiene como máximo 50 nodos y ninguno de los nodos que el diseño descartó', () => {
    expect(QTACO.nodes.length).toBeLessThanOrEqual(50);
    const nombres = QTACO.nodes.map((n) => n.name);
    for (const n of NOMBRES_QUE_NO_VAN) expect(nombres, n).not.toContain(n);
    // Dos webhooks, ninguno más; ningún WhatsApp Trigger (prohibición 7).
    expect(QTACO.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.name)).toEqual(['Entrega del receptor', CARRITO]);
    expect(QTACO.nodes.filter((n) => /whatsAppTrigger/i.test(n.type))).toEqual([]);
  });

  it('el marcador de la ruta aparece UNA sola vez en el JSON (repetido en una nota, preparar-import pondría la URL de capacidad a la vista)', () => {
    const t = readFileSync(join(CARPETA_VM, 'venta-minima.qtaco.json'), 'utf8');
    expect(t.split(MARCADOR).length - 1).toBe(1);
    expect(t).not.toMatch(/REEMPLAZAR_RUTA_CARRITO(?!_QTACO)/);
  });
});

describe('la variante de prueba y la del Demo A NO llevan la entrada del carrito', () => {
  it('ni «Carrito del catálogo» ni ninguna conexión a él (el Demo A no tiene flujo `venta`: `enlaceCatalogo` contestaría 409)', () => {
    for (const [nombre, f] of [['prueba', PRUEBA], ['ensayo-demo-a', DEMO_A]] as [string, Flujo][]) {
      expect(f.nodes.map((n) => n.name), nombre).not.toContain(CARRITO);
      expect(Object.keys(f.connections), nombre).not.toContain(CARRITO);
      expect(JSON.stringify(f), nombre).not.toContain(MARCADOR);
    }
    // La plantilla sí lo trae: la exclusión la hace `construir.mjs` por la entrada, no una edición a mano de cada JSON.
    expect(PLANTILLA.nodes.map((n) => n.name)).toContain(CARRITO);
    // Y lo demás es lo mismo: la prueba corre el mismo flujo.
    const sin = (f: Flujo) => f.nodes.map((n) => n.name).filter((n) => !['Entrada de prueba', 'WhatsApp Trigger', 'Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos', CARRITO, 'Simular aviso', '¿Avisar de verdad?'].includes(n));
    expect(sin(PRUEBA)).toEqual(sin(QTACO));
    expect(sin(DEMO_A)).toEqual(sin(QTACO));
  });

  it('`--verificar` FALLA si alguien le agrega el carrito a la variante de prueba o a la del Demo A (copias del JSON versionado)', () => {
    for (const [archivo, mensaje] of [['venta-minima.prueba.json', /la variante de prueba no lleva el webhook «Carrito del catálogo»/], ['venta-minima.ensayo-demo-a.json', /solo va en la variante del receptor/]] as [string, RegExp][]) {
      const r = verificarEnCopia((vm) => editarJson(vm, archivo, (f) => {
        f.nodes.push(JSON.parse(JSON.stringify(nodoDe(QTACO, CARRITO))) as Flujo['nodes'][number]);
        f.connections[CARRITO] = { main: [[{ node: 'Carga de entrada', type: 'main', index: 0 }]] };
      }));
      expect(r.status, archivo).toBe(1);
      expect(r.stderr, archivo).toMatch(mensaje);
    }
  });
});

// =====================================================================================================
// 2. LAS GUARDIAS DE `construir.mjs --verificar`, CADA UNA CON SU NEGATIVO
// =====================================================================================================
describe('`--verificar` impone la forma del webhook del carrito y el presupuesto de nodos', () => {
  const rompe = (etiqueta: string, cambio: (f: Flujo) => void, mensaje: RegExp) => {
    it(`FALLA: ${etiqueta}`, () => {
      const r = verificarEnCopia((vm) => editarJson(vm, 'venta-minima.qtaco.json', cambio));
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(mensaje);
    });
  };

  it('contraprueba: sin tocar nada sale con 0 y las tres variantes quedan al día', () => {
    const r = verificarEnCopia(() => undefined);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.match(/al día/g)).toHaveLength(3);
  });

  rompe('el carrito sin autenticación (cualquiera podría mandar un carrito)', (f) => { delete nodoDe(f, CARRITO).parameters['authentication']; }, /debe autenticar con headerAuth/);
  rompe('el carrito con autenticación básica en vez de cabecera', (f) => { nodoDe(f, CARRITO).parameters['authentication'] = 'basicAuth'; }, /debe autenticar con headerAuth/);
  rompe('el carrito que responde al terminar (el servidor esperaría todo el turno)', (f) => { nodoDe(f, CARRITO).parameters['responseMode'] = 'lastNode'; }, /responseMode onReceived/);
  rompe('el carrito con una ruta real en vez del marcador (una URL de capacidad no se versiona)', (f) => { nodoDe(f, CARRITO).parameters['path'] = 'carrito-de-qtaco'; }, /ruta como marcador REEMPLAZAR_RUTA_CARRITO_QTACO/);
  rompe('el carrito con el marcador del Demo B (preparar-import le pondría la ruta de OTRO flujo)', (f) => { nodoDe(f, CARRITO).parameters['path'] = 'REEMPLAZAR_RUTA_CARRITO'; }, /ruta como marcador REEMPLAZAR_RUTA_CARRITO_QTACO/);
  rompe('el carrito con GET', (f) => { nodoDe(f, CARRITO).parameters['httpMethod'] = 'GET'; }, /debe recibir POST/);
  rompe('el carrito con otra credencial (la de otro negocio)', (f) => { (nodoDe(f, CARRITO).credentials as J)['httpHeaderAuth'] = { id: '', name: 'Cierres de otro negocio' }; }, /debe usar la credencial de cabecera de la ingesta/);
  rompe('el carrito sin credencial', (f) => { delete nodoDe(f, CARRITO).credentials; }, /debe usar la credencial de cabecera de la ingesta/);
  rompe('el carrito con un webhookId (compartiría la ruta que Meta tiene registrada)', (f) => { (nodoDe(f, CARRITO) as unknown as J)['webhookId'] = 'a0000000-0000-4000-8000-000000000000'; }, /no puede traer un webhookId/);
  rompe('el carrito conectado a otro nodo además de `Carga de entrada`', (f) => {
    f.connections[CARRITO] = { main: [[{ node: 'Carga de entrada', type: 'main', index: 0 }, { node: 'Decidir turno', type: 'main', index: 0 }]] };
  }, /debe conectar solo con «Carga de entrada»/);
  rompe('el carrito conectado directo a `Decidir turno` (se saltaría la validación)', (f) => {
    f.connections[CARRITO] = { main: [[{ node: 'Decidir turno', type: 'main', index: 0 }]] };
  }, /debe conectar solo con «Carga de entrada»/);
  rompe('el marcador repetido en una nota', (f) => { nodoDe(f, CARRITO)['notes'] = `la ruta es ${MARCADOR}`; }, /debe aparecer una sola vez/);
  rompe('un tercer webhook con otro nombre', (f) => {
    f.nodes.push({ ...JSON.parse(JSON.stringify(nodoDe(f, CARRITO))), id: 'otro', name: 'Otro carrito' } as Flujo['nodes'][number]);
  }, /el webhook «Otro carrito» no es la entrada del receptor/);
  rompe('«Traer configuración» deja de pedir el catálogo completo (no llegaría el enlace)', (f) => {
    const n = nodoDe(f, 'Traer configuración');
    n.parameters['jsonBody'] = String(n.parameters['jsonBody']).replace(', catalogoCompleto: true', '');
  }, /«Traer configuración» no pide `catalogoCompleto: true`/);
  rompe('el JSON de producción pasa de 50 nodos (se agregó uno)', (f) => {
    f.nodes.push({ id: 'uno-mas', name: 'Uno más', type: 'n8n-nodes-base.noOp', parameters: {} } as Flujo['nodes'][number]);
  }, /tiene 51 nodos y el tope de producción es 50/);
  rompe('el JSON de producción pasa de 50 nodos por MUCHO (se reintrodujeron los nodos del diseño descartado)', (f) => {
    for (const nombre of ['¿Pedir enlace?', 'Pedir enlace del catálogo', 'Validar carrito', 'Carga del carrito']) {
      f.nodes.push({ id: nombre.toLowerCase().replace(/\W+/g, '-'), name: nombre, type: 'n8n-nodes-base.noOp', parameters: {} } as Flujo['nodes'][number]);
    }
  }, /tiene 54 nodos y el tope de producción es 50/);

  it('la guardia existe en `construir.mjs` (si alguien la borra, esta prueba lo dice aunque los JSON sigan limpios)', () => {
    const fuente = readFileSync(join(CARPETA_VM, 'construir.mjs'), 'utf8');
    for (const pieza of ['const TOPE_DE_NODOS = 50', 'function guardiaDelCarrito', 'function guardiasDeEntrega', "const WEBHOOK_DEL_CARRITO = 'Carrito del catálogo'", `const MARCADOR_DEL_CARRITO = '${MARCADOR}'`, 'MARCADORES_FIJOS']) {
      expect(fuente, pieza).toContain(pieza);
    }
    // El marcador está declarado con su formato.
    expect(fuente).toMatch(/MARCADORES_FIJOS = \{ REEMPLAZAR_RUTA_CARRITO_QTACO: \/\^REEMPLAZAR_\[A-Z0-9_\]\+\$\/ \}/);
  });
});

// =====================================================================================================
// 3. EL ORDEN DE EJECUCIÓN Y «CADA NODO UNA VEZ POR TURNO»
// =====================================================================================================
describe('orden de ejecución: `Reportar mensaje (entrante)` sigue arriba y cada nodo corre una vez por turno', () => {
  it('por posición: el reporte entrante está ARRIBA de la rama que contesta (executionOrder v1 termina una rama antes de empezar la siguiente)', () => {
    expect(QTACO.settings?.['executionOrder']).toBe('v1');
    const y = (n: string) => (nodoDe(QTACO, n).position as [number, number])[1];
    // La rama del reporte entrante (140) está por encima de la que contesta (300 en adelante), y el carrito no cambió nada de eso.
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('¿Comercio operativo?'));
    expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Enviar a WhatsApp'));
  });

  it('en un turno de texto, el mensaje se reporta ANTES que la respuesta y `Traer configuración` pide el catálogo completo', () => {
    const w = crear();
    const t = turno(w, texto('hola'));
    const i = (n: string) => t.orden.indexOf(n);
    expect(i('Reportar mensaje (entrante)')).toBeGreaterThanOrEqual(0);
    expect(i('Reportar mensaje (entrante)')).toBeLessThan(i('Decidir turno'));
    expect(i('Reportar mensaje (entrante)')).toBeLessThan(i('Enviar a WhatsApp'));
    expect(i('Reportar mensaje (saliente)')).toBeGreaterThan(i('Enviar a WhatsApp'));
    const cfg = t.registro.find((r) => r.nodo === 'Traer configuración');
    expect(cfg?.cuerpo).toMatchObject({ catalogoCompleto: true });
    expect(String((cfg?.cuerpo as J)['telefono'])).toMatch(/^\d{8,15}$/);
  });

  it('cada nodo corre UNA vez por turno (carta, botón, texto, pedido con QR y aviso): `Plan del turno`, `Armar mensajes` y los envíos no se repiten', () => {
    const w = crear();
    const turnos = [
      turno(w, texto('hola')),
      turno(w, texto('quiero ver la carta')),
      turno(w, texto('hola')),
    ];
    w.estado.extraccion = { lineas: [{ producto: 'tacos de birria', cantidad: 4, forma: 'unidad', detalle: '' }], entrega: 'recojo', direccion: '', referencia: '', nombre: '', quiereHablar: false };
    const resumen = turno(w, texto('quiero 4 tacos de birria'));
    turnos.push(resumen, turno(w, boton(idDeBoton(resumen, 'Confirmar pedido'), 'Confirmar pedido')));
    for (const t of turnos) {
      const veces = new Map<string, number>();
      for (const n of t.orden) veces.set(n, (veces.get(n) ?? 0) + 1);
      const repetidos = [...veces].filter(([, v]) => v > 1).map(([n]) => n);
      expect(repetidos, `orden: ${t.orden.join(' > ')}`).toEqual([]);
    }
    // Y el último turno sí llegó al QR: la prueba no es sobre turnos vacíos.
    expect(turnos[turnos.length - 1]?.ejecutados.has('Enviar a WhatsApp')).toBe(true);
  });
});

// =====================================================================================================
// 4. EL CARRITO ENTRA POR SU WEBHOOK Y NO SE TRATA COMO UN MENSAJE
// =====================================================================================================
describe('un carrito que no corresponde no entra: sin número, sin ítems o de otro número no habla con nadie', () => {
  const cuerpoValido = (extra: J = {}): J => ({
    tipo: 'carrito', tenantId: 'qtaco', telefono: '59100000011', accion: 'responder', pedidoId: 'p1', conversacionId: 'c1',
    items: [{ nombre: 'Tacos de birria', cantidad: 2, subtotal: 110 }], total: 110, moneda: 'Bs', entrega: 'retiro', ...extra,
  });
  const cabeceras = (extra: J = {}): J => ({
    'x-novuchat-numero': PHONE_ID, 'x-novuchat-timestamp': String(Date.UTC(2026, 9, 5, 14)),
    'x-novuchat-signature': `sha256=${'0'.repeat(64)}`, ...extra,
  });
  const casos: [string, J][] = [
    ['de otro número (la cabecera dice un número que no es el del negocio)', { headers: cabeceras({ 'x-novuchat-numero': '100000000000099' }), body: cuerpoValido() }],
    ['sin la cabecera del número', { headers: cabeceras({ 'x-novuchat-numero': '' }), body: cuerpoValido() }],
    ['sin cabeceras', { headers: {}, body: cuerpoValido() }],
    ['sin ítems', { headers: cabeceras(), body: cuerpoValido({ items: [] }) }],
    ['con un tipo que no es carrito', { headers: cabeceras(), body: cuerpoValido({ tipo: 'mensaje' }) }],
    ['con el cuerpo vacío', { headers: cabeceras(), body: {} }],
    ['con una carga de WhatsApp metida a escondidas (mensaje de otro teléfono dentro del carrito)', { headers: cabeceras({ 'x-novuchat-numero': '100000000000099' }), body: { ...cuerpoValido(), messages: [{ from: '59100000099', id: 'wamid.X', type: 'text', text: { body: 'hola' } }], metadata: { phone_number_id: '100000000000099' } } }],
  ];
  for (const [etiqueta, item] of casos) {
    it(`${etiqueta}: llega a «Carga de entrada» una vez y ahí termina (0 mensajes, 0 avisos, 0 reportes, el receptor no corre)`, () => {
      const w = crear();
      const t = w.mundo.turno(item, { via: CARRITO, tolerarFallo: true });
      expect(t.fallo).toBeNull();
      expect(t.orden.filter((n) => n === 'Carga de entrada')).toHaveLength(1);
      for (const n of ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos', 'Reportar mensaje (entrante)']) {
        expect(t.ejecutados.has(n), n).toBe(false);
      }
      expect(t.mensajes).toHaveLength(0);
      expect(t.avisos).toHaveLength(0);
      expect(t.llamadas.ingesta).toHaveLength(0);
      expect(t.llamadas.cierre).toHaveLength(0);
      expect(w.mundo.llamadas.ingesta).toHaveLength(0);
    });
  }

  it('el webhook del carrito no deja pasar a nadie sin la credencial: la autenticación es del nodo (headerAuth) y n8n contesta 403 antes de correr nada', () => {
    // El arnés no simula el 403 de n8n: lo que se prueba es que el nodo la exige y que NO hay un camino alternativo al flujo.
    expect(nodoDe(QTACO, CARRITO).parameters['authentication']).toBe('headerAuth');
    expect(nodoDe(QTACO, CARRITO).credentials?.['httpHeaderAuth']?.name).toBeTruthy();
    expect(entradas(QTACO, 'Carga de entrada').every((n) => ['Descartar repetidos', CARRITO].includes(n))).toBe(true);
  });

  it('un mensaje de WhatsApp normal sigue entrando por el receptor y NO ejecuta el carrito', () => {
    const w = crear();
    const t = turno(w, texto('hola'));
    expect(t.ejecutados.has(CARRITO)).toBe(false);
    expect(t.ejecutados.has('Entrega del receptor')).toBe(true);
    expect(t.mensajes.length).toBeGreaterThan(0);
  });
});
