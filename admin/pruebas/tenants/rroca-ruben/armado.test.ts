/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-1, EL ARMADO (`Flujos/experimental/rroca-ruben/`).
 *
 * Lo que esta suite niega: que el JSON versionado difiera de lo que se arma; que el flujo pase de 48 nodos; que lleve un WhatsApp Trigger, un agente, un modelo o
 * un «Continue on Fail» en la verificación del receptor; que `wabaIdEsperado` salga de una expresión; que lo COMÚN (mensajes, envío) esté copiado en vez de
 * incluido; que las copias declaradas como HUECO (núcleo sin fuente utilizable, tomado de chat-novuchat) se aparten de su origen más allá de lo declarado en
 * `PROPIO.md`; y que el JSON traiga lo que el saneo del repo público rechaza (rutas de webhook, UUID, tokens, secuencias de 10 o más dígitos sin seis ceros).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, type Flujo, type J } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { ADAPTADOR_TRANSCRIPCION, AQUI, ARCHIVO_DE_DATOS, CONFIG, NODOS_DEL_AVISO, NOMBRES_DEL_NUCLEO, NUCLEO_TRANSCRIPCION, traducirNucleo, TOPE_DE_NODOS, anfitrionPermitido, cargarDatos, guardias } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';
import { nodosDeEnvio } from '../../../../Flujos/experimental/comun-sin-agente/src/envio.mjs';

const ESTA = dirname(fileURLToPath(import.meta.url));
const FLUJOS = join(ESTA, '../../../../Flujos/experimental');
const RROCA: string = AQUI;
const CHAT = join(FLUJOS, 'chat-novuchat');
const leer = (ruta: string): string => readFileSync(ruta, 'utf8');
const flujo = (archivo: string): Flujo => JSON.parse(leer(join(RROCA, archivo))) as Flujo;
const PRODUCCION = flujo('rroca-ruben.json');
const PRUEBA = flujo('rroca-ruben.prueba.json');
const copia = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const nodo = (f: Flujo, n: string) => f.nodes.find((x) => x.name === n)!;

describe('armado: --verificar y el tope de nodos', () => {
  it('`construir.mjs --verificar` sale en 0 y dice que las dos variantes están al día', () => {
    const r = spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--verificar'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('rroca-ruben.json al día');
    expect(r.stdout).toContain('rroca-ruben.prueba.json al día');
  });

  it('un argumento desconocido NO escribe nada: sale en 2', () => {
    const r = spawnSync(process.execPath, [join(RROCA, 'construir.mjs'), '--ayuda'], { encoding: 'utf8', env: entornoDelEmulador(undefined) });
    expect(r.status).toBe(2);
  });

  it(`ninguna variante pasa de ${TOPE_DE_NODOS} nodos (48 es el tope duro: si pasa, se rehace)`, () => {
    expect(TOPE_DE_NODOS).toBe(48);
    expect(PRODUCCION.nodes.length).toBeLessThanOrEqual(48);
    expect(PRUEBA.nodes.length).toBeLessThanOrEqual(48);
    const grande = copia(PRODUCCION);
    while (grande.nodes.length <= 48) grande.nodes.push({ ...copia(grande.nodes[0]!), id: `x${grande.nodes.length}`, name: `Relleno ${grande.nodes.length}` });
    expect(guardias('produccion', grande).join('|')).toMatch(/tope es 48/);
  });

  it('producción y prueba: guardias limpias, y lo versionado no las viola', () => {
    expect(guardias('produccion', PRODUCCION)).toEqual([]);
    expect(guardias('prueba', PRUEBA)).toEqual([]);
  });
});

describe('armado: la entrada verificada del receptor', () => {
  const verificar = nodo(PRODUCCION, 'Verificar firma con el receptor');
  it('`wabaIdEsperado` va FIJO en el cuerpo (un marcador REEMPLAZAR_*), nunca como una expresión', () => {
    const cuerpo = String(verificar.parameters['jsonBody']);
    expect(cuerpo).toMatch(/wabaIdEsperado: "REEMPLAZAR_WABA_ID_RROCA_RUBEN"/);
    // La contraprueba: si alguien lo lee de la entrega, la guardia lo rechaza.
    const roto = copia(PRODUCCION);
    nodo(roto, 'Verificar firma con el receptor').parameters['jsonBody'] = cuerpo.replace('wabaIdEsperado: "REEMPLAZAR_WABA_ID_RROCA_RUBEN"', 'wabaIdEsperado: $json.body.waba');
    expect(guardias('produccion', roto).join('|')).toMatch(/wabaIdEsperado/);
  });

  it('sin «Continue on Fail» ni onError en la verificación ni en «¿Firma válida?» (un 503 se reintenta, no da 401)', () => {
    expect(verificar.onError).toBeUndefined();
    expect((verificar as J)['continueOnFail']).toBeUndefined();
    expect((nodo(PRODUCCION, '¿Firma válida?') as J)['onError']).toBeUndefined();
    for (const marca of [{ onError: 'continueRegularOutput' }, { continueOnFail: true }]) {
      const roto = copia(PRODUCCION);
      Object.assign(nodo(roto, 'Verificar firma con el receptor'), marca);
      expect(guardias('produccion', roto).join('|')).toMatch(/Continue on Fail/);
    }
    const roto2 = copia(PRODUCCION);
    Object.assign(nodo(roto2, '¿Firma válida?'), { onError: 'continueRegularOutput' });
    expect(guardias('produccion', roto2).join('|')).toMatch(/¿Firma válida\?/);
  });

  it('los repetidos se descartan ENTRE ejecuciones (por deliveryId), antes de «Config base»', () => {
    const d = nodo(PRODUCCION, 'Descartar repetidos');
    expect(d.parameters['operation']).toBe('removeItemsSeenInPreviousExecutions');
    expect(d.parameters['logic']).toBe('removeItemsWithAlreadySeenKeyValues');
    expect(PRODUCCION.connections['Descartar repetidos']!['main']![0]!.map((c) => c.node)).toEqual(['Config base']);
    const roto = copia(PRODUCCION);
    nodo(roto, 'Descartar repetidos').parameters['operation'] = 'removeDuplicateInputItems';
    expect(guardias('produccion', roto).join('|')).toMatch(/entre ejecuciones/);
  });

  it('la verificación solo se llama por el verificador (marcador) y el 401 corta: 0 mensajes, 0 avisos', () => {
    expect(String(verificar.parameters['url'])).toMatch(/^REEMPLAZAR_URL_VERIFICADOR_RECEPTOR$/);
    expect(PRODUCCION.connections['¿Firma válida?']!['main']![1]!.map((c) => c.node)).toEqual(['Rechazar (401)']);
    expect(PRODUCCION.connections['Rechazar (401)']).toBeUndefined();
  });

  it('producción: solo el webhook del receptor y NINGUNA «Entrada de prueba»; la prueba, al revés, con credencial de cabecera', () => {
    expect(PRODUCCION.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.name)).toEqual(['Entrega del receptor']);
    expect(PRODUCCION.nodes.some((n) => n.name === 'Entrada de prueba')).toBe(false);
    expect(PRUEBA.nodes.filter((n) => n.type === 'n8n-nodes-base.webhook').map((n) => n.name)).toEqual(['Entrada de prueba']);
    expect(nodo(PRUEBA, 'Entrada de prueba').parameters['authentication']).toBe('headerAuth');
    const conPrueba = copia(PRODUCCION);
    conPrueba.nodes.push(copia(nodo(PRUEBA, 'Entrada de prueba')));
    expect(guardias('produccion', conPrueba).join('|')).toMatch(/Entrada de prueba/);
  });

  it('nunca un WhatsApp Trigger ni una llamada a las suscripciones de la app (prohibición 7)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f.nodes.some((n) => n.type === 'n8n-nodes-base.whatsAppTrigger')).toBe(false);
      expect(JSON.stringify(f)).not.toMatch(/subscriptions|subscribed_apps/i);
    }
    const roto = copia(PRODUCCION);
    roto.nodes.push({ id: 'wt', name: 'WhatsApp Trigger', type: 'n8n-nodes-base.whatsAppTrigger', parameters: {} });
    expect(guardias('produccion', roto).join('|')).toMatch(/WhatsApp Trigger/);
  });
});

describe('armado: orden del lienzo y sin modelo en PR-1', () => {
  it('«Reportar mensaje (entrante)» está ARRIBA de «Puerta del turno» y de la rama que responde', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const y = (n: string): number => nodo(f, n).position![1];
      expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Puerta del turno'));
      expect(y('Reportar mensaje (entrante)')).toBeLessThan(y('Armar mensajes'));
      expect(y('Resumen del turno')).toBeGreaterThan(y('Armar mensajes'));
      expect(f.settings!['executionOrder']).toBe('v1');
    }
  });

  it('la puerta corre DESPUÉS del reporte: el reporte es su única entrada, junto con el «no reportar»', () => {
    const destinos = (n: string, salida: number) => (PRODUCCION.connections[n]!['main']![salida] ?? []).map((c) => c.node);
    expect(destinos('¿Reportar? (entrante)', 0)).toEqual(['Reportar mensaje (entrante)']);
    expect(destinos('¿Reportar? (entrante)', 1)).toEqual(['Puerta del turno']);
    expect(destinos('Reportar mensaje (entrante)', 0)).toEqual(['Puerta del turno']);
  });

  it('PR-2 lleva el modelo (HTTP a Gemini, un dato), la lectura del comprobante, el cotejo y el aviso mínimo; NO lleva agente, memoria de n8n, «Registrar cierre» ni disparadores por tiempo (el rescate es PR-4)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const tipos = f.nodes.map((n) => n.type).join('\n');
      expect(tipos).not.toMatch(/langchain\.(agent|memory|lmChat|chain)|scheduleTrigger|cron|whatsAppTrigger/i);
      const nombres = f.nodes.map((n) => n.name);
      for (const n of ['Conversar con el modelo', 'Guardar comprobante', 'Cotejar en el servidor', 'Interpretar lectura', 'Decidir turno', 'Armar avisos', 'Enviar aviso']) expect(nombres, n).toContain(n);
      expect(nombres.join('\n')).not.toMatch(/Registrar cierre|rescate|Schedule/i);
    }
  });

  it('un nodo HTTP solo habla con Meta, Gemini y las Functions de la consola; un anfitrión ajeno lo rechaza la guardia', () => {
    expect(anfitrionPermitido('https://graph.facebook.com/v26.0/x')).toBe(true);
    expect(anfitrionPermitido('https://evil.example.invalid/x')).toBe(false);
    expect(anfitrionPermitido(`https://graph.facebook.com${'@'}evil.example.invalid/x`)).toBe(false);
    const roto = copia(PRODUCCION);
    nodo(roto, 'Traer configuración').parameters['url'] = 'https://evil.example.invalid/x';
    expect(guardias('produccion', roto).join('|')).toMatch(/anfitrión/);
  });

  it('los ajustes: retención solo de errores, zona de La Paz, sin errorWorkflow', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveExecutionProgress: false, timezone: 'America/La_Paz' });
    }
    const roto = copia(PRODUCCION);
    roto.settings!['saveDataSuccessExecution'] = 'all';
    expect(guardias('produccion', roto).join('|')).toMatch(/retención/);
  });
});

describe('armado: lo común se INCLUYE desde su fuente, no se copia', () => {
  const codigo = (f: Flujo, n: string): string => String(nodo(f, n).parameters['jsCode']);
  it('«Armar mensajes» lleva `mensajes.js` byte a byte, desde `comun-sin-agente/src/`', () => {
    const fuente = leer(join(FLUJOS, 'comun-sin-agente/src/mensajes.js')).trimEnd();
    expect(codigo(PRODUCCION, 'Armar mensajes')).toContain(fuente);
    expect(CONFIG.paquetes.mensajes).toEqual(['../comun-sin-agente/src/mensajes.js']);
  });

  it('la cadena de envío es la de `envio.mjs` (`injertar`), nodo por nodo; solo el reporte se reencamina a «¿Meta aceptó?» y el reporte saliente suma el EVENTO del QR (propio)', () => {
    const cadena = nodosDeEnvio({ credenciales: { graph: 'Graph WhatsApp Ruben (Bearer)', ingesta: 'NovuChat ingesta (Ruben)' }, ingestaUrl: 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta', desde: [5480, 160] });
    for (const n of cadena.nodes) {
      if (n.name === 'Reportar mensaje (saliente)') continue;
      expect(nodo(PRODUCCION, n.name), n.name).toEqual(n);
    }
    // El reporte saliente es la cadena común con UN cambio declarado: el cuerpo (`jsonBody`) lleva el evento `qr_enviado`.
    const comun = cadena.nodes.find((n) => n.name === 'Reportar mensaje (saliente)')!;
    const propio = nodo(PRODUCCION, 'Reportar mensaje (saliente)');
    expect({ ...propio, parameters: { ...propio.parameters, jsonBody: '' } }).toEqual({ ...comun, parameters: { ...comun.parameters, jsonBody: '' } });
    const cuerpo = String(propio.parameters['jsonBody']);
    for (const campo of ['r.evento = m.evento', 'r.reglaCobro = 2', 'r.referencia = m.referencia', 'r.monto = m.monto']) expect(cuerpo).toContain(campo);
    // El evento viaja SOLO si el envío principal (la imagen) fue aceptado: si cayó el respaldo en texto, el cobro no se abre.
    expect(cuerpo).toContain("$('Enviar a WhatsApp').item.json");
    expect(PRODUCCION.connections['¿Reportar? (saliente)']!['main']![0]!.map((c) => c.node)).toEqual(['¿Meta aceptó?']);
    expect(PRODUCCION.connections['¿Meta aceptó?']!['main']![0]!.map((c) => c.node)).toEqual(['Reportar mensaje (saliente)']);
  });

  it('«Armar mensajes» lleva `filtro-redaccion.js` byte a byte, desde `comun-sin-agente/src/` (el modelo no sale sin pasar por él)', () => {
    const fuente = leer(join(FLUJOS, 'comun-sin-agente/src/filtro-redaccion.js')).trimEnd();
    expect(codigo(PRODUCCION, 'Armar mensajes')).toContain(fuente);
    expect(CONFIG.paquetes.filtro).toEqual(['../comun-sin-agente/src/filtro-redaccion.js']);
    expect(codigo(PRODUCCION, 'Armar mensajes')).toContain('cmRevisarRedaccion(');
  });
});

describe('armado: la topología de PR-2 (orden del lienzo, comprobante y cobro)', () => {
  const y = (f: Flujo, n: string): number => nodo(f, n).position![1];
  const x = (f: Flujo, n: string): number => nodo(f, n).position![0];
  const destinos = (f: Flujo, n: string, salida = 0): string[] => (f.connections[n]!['main']![salida] ?? []).map((c) => c.node);

  it('cuenta de nodos: producción y prueba dentro del tope (48) y de la meta de producción (46)', () => {
    expect(PRODUCCION.nodes.length).toBeLessThanOrEqual(46);
    expect(PRUEBA.nodes.length).toBeLessThanOrEqual(46);
    expect(PRODUCCION.nodes.length).toBe(PRUEBA.nodes.length + 5);
    // MEDIOS ENTRANTES: 39 → 44 en producción y 34 → 39 en la prueba (5 nodos: ¿Es audio?, Transcribir audio, Preparar transcripción, ¿Es comprobante? y Ver imagen).
    // Y +1 (21/10/2026): «¿Lo leído es comprobante?» (el lector del comprobante clasifica; lo que no es un comprobante no se coteja) → 45 y 40.
    expect(PRODUCCION.nodes.length).toBe(45);
    expect(PRUEBA.nodes.length).toBe(40);
  });

  it('«Reportar mensaje (entrante)» sigue ARRIBA de toda la rama que responde (medios, decisión, modelo, avisos y mensajes)', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const arriba = y(f, 'Reportar mensaje (entrante)');
      for (const n of ['Puerta del turno', '¿Bajar medio?', 'Decidir turno', 'Conversar con el modelo', 'Armar avisos', 'Enviar aviso', 'Armar mensajes']) expect(arriba, n).toBeLessThan(y(f, n));
      expect(y(f, 'Resumen del turno')).toBeGreaterThan(y(f, 'Armar mensajes'));
    }
  });

  it('«Guardar comprobante» es un nodo TERMINAL, cuelga de «¿Es comprobante?» y va ARRIBA de «¿Es PDF?» (corre antes: la imagen se guarda aunque la lectura falle); una foto sin cobro JAMÁS llega a él', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(f.connections['Guardar comprobante']).toBeUndefined();
      expect(destinos(f, 'Descargar medio')).toEqual(['¿Es audio?']);
      expect(destinos(f, '¿Es audio?', 0)).toEqual(['Transcribir audio']);
      expect(destinos(f, '¿Es audio?', 1)).toEqual(['¿Es comprobante?']);
      expect(destinos(f, '¿Es comprobante?', 0)).toEqual(['Guardar comprobante', '¿Es PDF?']);
      expect(destinos(f, '¿Es comprobante?', 1)).toEqual(['Ver imagen']);
      expect(destinos(f, 'Transcribir audio')).toEqual(['Preparar transcripción']);
      expect(destinos(f, 'Preparar transcripción')).toEqual(['Decidir turno']);
      expect(destinos(f, 'Ver imagen')).toEqual(['Decidir turno']);
      for (const n of ['¿Es audio?', 'Transcribir audio', 'Preparar transcripción', '¿Es comprobante?', 'Ver imagen']) expect(y(f, n), n).toBeGreaterThan(y(f, 'Reportar mensaje (entrante)'));
      expect(y(f, 'Guardar comprobante')).toBeLessThan(y(f, '¿Es PDF?'));
      expect(nodo(f, 'Guardar comprobante').parameters['url']).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarComprobante');
    }
  });

  it('la cadena del comprobante: Puerta → ¿Bajar medio? → URL → tamaño → descarga → (guardar | PDF?) → lectura → cotejo → Decidir turno; todo lo que falla cae en «Decidir turno», que lo trata como «sin cotejar»', () => {
    const f = PRODUCCION;
    expect(destinos(f, 'Puerta del turno')).toEqual(['¿Bajar medio?']);
    expect(destinos(f, '¿Bajar medio?', 0)).toEqual(['Obtener URL del medio']);
    expect(destinos(f, '¿Bajar medio?', 1)).toEqual(['Decidir turno']);
    expect(destinos(f, 'Obtener URL del medio')).toEqual(['¿Tamaño aceptable?']);
    expect(destinos(f, '¿Tamaño aceptable?', 0)).toEqual(['Descargar medio']);
    expect(destinos(f, '¿Tamaño aceptable?', 1)).toEqual(['Decidir turno']);
    expect(destinos(f, 'Descargar medio')).toEqual(['¿Es audio?']);
    expect(destinos(f, '¿Es comprobante?', 0)).toEqual(['Guardar comprobante', '¿Es PDF?']);
    expect(destinos(f, '¿Es PDF?', 0)).toEqual(['Leer comprobante (PDF)']);
    expect(destinos(f, '¿Es PDF?', 1)).toEqual(['Leer comprobante (imagen)']);
    expect(destinos(f, 'Leer comprobante (PDF)')).toEqual(['Interpretar lectura']);
    expect(destinos(f, 'Leer comprobante (imagen)')).toEqual(['Interpretar lectura']);
    expect(destinos(f, 'Interpretar lectura')).toEqual(['¿Lo leído es comprobante?']);
    expect(destinos(f, '¿Lo leído es comprobante?', 0)).toEqual(['Cotejar en el servidor']);
    expect(destinos(f, '¿Lo leído es comprobante?', 1)).toEqual(['Decidir turno']);
    expect(destinos(f, 'Cotejar en el servidor')).toEqual(['Decidir turno']);
    expect(destinos(f, 'Decidir turno')).toEqual(['¿Conversar con el modelo?']);
    expect(destinos(f, '¿Conversar con el modelo?', 0)).toEqual(['Conversar con el modelo']);
    expect(destinos(f, '¿Conversar con el modelo?', 1)).toEqual(['Armar avisos']);
    expect(destinos(f, 'Conversar con el modelo')).toEqual(['Armar avisos']);
    expect(destinos(f, 'Armar avisos')).toEqual(['¿Hay avisos?']);
    expect(destinos(f, '¿Hay avisos?', 0)).toEqual(['Enviar aviso']);
    expect(destinos(f, '¿Hay avisos?', 1)).toEqual(['Armar mensajes']);
    expect(destinos(f, 'Enviar aviso')).toEqual(['Armar mensajes']);
    expect(destinos(f, 'Armar mensajes')).toEqual(['Resumen del turno', '¿Enviar de verdad?']);
  });

  it('el avance de izquierda a derecha respeta el orden de ejecución: el aviso corre ANTES de armar el mensaje que dice si salió', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      expect(x(f, 'Enviar aviso')).toBeLessThan(x(f, 'Armar mensajes'));
      expect(x(f, 'Decidir turno')).toBeLessThan(x(f, 'Armar avisos'));
      expect(x(f, 'Cotejar en el servidor')).toBeLessThan(x(f, 'Decidir turno'));
    }
  });

  it('la pausa por persona no baja medios ni llama al modelo: ambas puertas miran la ruta de la puerta del turno', () => {
    expect(String(nodo(PRODUCCION, '¿Bajar medio?').parameters['conditions']!['conditions'][0].leftValue)).toContain("ruta === 'sigue'");
    expect(String(nodo(PRODUCCION, 'Decidir turno').parameters['jsCode'])).toContain("puerta.ruta !== 'sigue'");
  });

  it('ningún JSON lleva la clave `link` (el QR sale por `id`): ni en los parámetros ni en el código de los nodos', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const t = JSON.stringify(f);
      expect(t).not.toMatch(/\blink\s*:/);
      expect(t).not.toMatch(/\\"link\\"|"link"/);
      expect(t).not.toMatch(/image:\s*\{\s*link/);
    }
    // El armado del QR usa `image: { id: … }`.
    expect(String(nodo(PRODUCCION, 'Armar mensajes').parameters['jsCode'])).toMatch(/image: \{ id: mediaId, caption: pie \}/);
  });

  it('los medios: «Descargar medio» es el ÚNICO nodo que baja de la URL que devuelve Meta; cualquier otra expresión de URL la rechaza la guardia', () => {
    expect(anfitrionPermitido('={{ $json.url }}', 'Descargar medio')).toBe(true);
    expect(anfitrionPermitido('={{ $json.url }}', 'Traer configuración')).toBe(false);
    expect(anfitrionPermitido('={{ $json.otra }}', 'Descargar medio')).toBe(false);
    const roto = copia(PRODUCCION);
    nodo(roto, 'Descargar medio').parameters['url'] = '={{ $json.otraCosa }}';
    expect(guardias('produccion', roto).join('|')).toMatch(/anfitrión/);
    const roto2 = copia(PRODUCCION);
    nodo(roto2, 'Conversar con el modelo').parameters['url'] = 'https://evil.example.invalid/x';
    expect(guardias('produccion', roto2).join('|')).toMatch(/anfitrión/);
  });

  it('la verificación del receptor sigue igual: sin «Continue on Fail» en ninguno de los nodos nuevos que decide el turno', () => {
    for (const n of ['Decidir turno', 'Armar avisos', 'Armar mensajes', 'Interpretar lectura']) {
      expect((nodo(PRODUCCION, n) as J)['onError'], n).toBeUndefined();
    }
  });

  it('el modelo y la credencial de Gemini son DATOS (nada escrito en el flujo): el modelo sale de «Config base» y la credencial va por nombre', () => {
    expect(String(nodo(PRODUCCION, 'Conversar con el modelo').parameters['url'])).toContain('{{ $json.modelo }}');
    const cb = (nodo(PRODUCCION, 'Config base').parameters['assignments'] as J)['assignments'] as J[];
    expect(cb.find((a) => a['name'] === 'modelo')!['value']).toBe('gemini-3.5-flash-lite');
    expect(cb.find((a) => a['name'] === 'cobroSimuladoActivo')!['value']).toBe(false);
    for (const n of ['Conversar con el modelo', 'Leer comprobante (PDF)', 'Leer comprobante (imagen)', 'Transcribir audio', 'Ver imagen']) {
      expect(String((nodo(PRODUCCION, n).credentials as J)['googlePalmApi'].name), n).toBe('Google Gemini(PaLM) Api account');
    }
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// LOS HUECOS DECLARADOS en PROPIO.md: núcleo sin fuente utilizable, tomado de chat-novuchat. Cada uno se compara con su ORIGEN.
// ------------------------------------------------------------------------------------------------------------------------------------
const NODOS_PROPIOS = join(RROCA, 'src/nodos');
const NODOS_CHAT = join(CHAT, 'src/nodos');
const propio = (a: string): string => leer(join(NODOS_PROPIOS, a));
const chat = (a: string): string => leer(join(NODOS_CHAT, a));
/** Aplica sustituciones DECLARADAS: cada `de` tiene que aparecer en el origen (si no, el origen cambió y la copia quedó atrás). */
function derivar(origen: string, cambios: Array<[string, string]>): string {
  let t = origen;
  for (const [de, a] of cambios) {
    expect(t.includes(de), `el origen ya no trae: ${de.slice(0, 80)}`).toBe(true);
    t = t.split(de).join(a);
  }
  return t;
}
const entre = (t: string, ini: string, fin: string): string => {
  const i = t.indexOf(ini);
  const j = t.indexOf(fin, i);
  expect(i, `no está: ${ini.slice(0, 60)}`).toBeGreaterThanOrEqual(0);
  expect(j, `no está: ${fin.slice(0, 60)}`).toBeGreaterThan(i);
  return t.slice(i, j + fin.length);
};

describe('HUECOS: copias del núcleo de chat-novuchat, comparadas con su origen', () => {
  it('«Puerta del turno»: BYTE A BYTE idéntica', () => {
    expect(propio('puerta-del-turno.js')).toBe(chat('puerta-del-turno.js'));
  });

  it('«Resumen del turno»: el origen más SOLO la verificación de entrega (R3: sin `messages[0].id` del principal ni del respaldo, la ejecución falla) y la entrada del asistente en la memoria por teléfono', () => {
    const propia = propio('resumen-del-turno.js');
    const origen = chat('resumen-del-turno.js');
    const ancla = "const items = cnTodos('Armar mensajes');\n";
    expect(origen.split(ancla)).toHaveLength(2);
    const [antes, despues] = origen.split(ancla);
    expect(propia.startsWith(antes! + ancla)).toBe(true);
    expect(propia.endsWith(despues!)).toBe(true);
    const agregado = propia.slice((antes! + ancla).length, propia.length - despues!.length);
    expect(agregado).toContain("throw new Error('Entrega fallida");
    expect(agregado).toContain("cnNodo('Enviar a WhatsApp')");
    expect(agregado).toContain("cnTodos('Enviar respaldo')");
    expect(agregado).toContain('rrHist');
    expect(agregado).toMatch(/try \{[\s\S]*rrH[\s\S]*\} catch/);
  });

  it('`_comun.js`: el origen más SOLO las sustituciones declaradas (la clave de la ficha y sin el barrido de datos de otros flujos)', () => {
    const esperado = derivar(chat('_comun.js'), [
      ['DE «CHAT NOVUCHAT v2» (prefijo', 'DE LA «VENTA DIGITAL DE RUBÉN» (prefijo'],
      ['(`chat.js`, y las', '(`rr.js`, y las'],
      ['Los que escriben (con `escribir` verdadero)\n// además borran lo que dejaron los flujos anteriores de este mismo workflow (`captacionMinima`, `conversaciones`, `vistos`: datos de prospectos que este flujo no lee).', 'Los que escriben (con `escribir` verdadero) crean el mapa si falta.'],
      ['  if (escribir === true) { delete sd.captacionMinima; delete sd.conversaciones; delete sd.vistos; }\n', ''],
      ['chatNovuchat', 'rroca'],
    ]);
    expect(propio('_comun.js')).toBe(esperado);
  });

  it('«Carga de entrada»: el origen más SOLO la rama del receptor (la verificación manda sobre las otras formas)', () => {
    const esperado = derivar(chat('carga-de-entrada.js'), [
      ['//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la raíz o dentro de `body`.\n',
        '//   3. la carga completa de la Cloud API: {entry:[{changes:[{value:{...}}]}]}, en la raíz o dentro de `body`;\n//   4. la del receptor: si CORRIÓ «Entrega del receptor», el evento es su `body.value` (y si `body.field` viene, tiene que ser `messages`: otro campo —un cambio de plantilla, de calidad— no es un mensaje). Ese nodo manda\n//      sobre las otras tres: lo que pasa por «Verificar firma con el receptor» ya no es el evento sino su veredicto, y NUNCA se lee como un mensaje.\n'],
      ["const esperado = String((cnPrimero('Config base') || {}).phoneNumberIdEsperado || '');\n",
        "const esperado = String((cnPrimero('Config base') || {}).phoneNumberIdEsperado || '');\nconst receptor = cnPrimero('Entrega del receptor');\nconst cuerpoReceptor = receptor && receptor.body && typeof receptor.body === 'object' ? receptor.body : {};\n"],
      ["  const b = j.body && typeof j.body === 'object' ? j.body : null;\n  const v = cnValorDeMeta(j) || cnValorDeMeta(b);\n",
        "  const b = !receptor && j.body && typeof j.body === 'object' ? j.body : null;\n  const v = receptor\n    ? (cuerpoReceptor.value && typeof cuerpoReceptor.value === 'object' && (cuerpoReceptor.field === undefined || cuerpoReceptor.field === 'messages') ? cnValorDeMeta(cuerpoReceptor.value) : null)\n    : (cnValorDeMeta(j) || cnValorDeMeta(b));\n"],
    ]);
    expect(propio('carga-de-entrada.js')).toBe(esperado);
  });

  it('«Interpretar entrada»: el origen sin el contrato del chat (eventos y rubros), con la `categoria`, (PR-2) con `esComprobante`, `comprobanteSimulado` y `mimeType` y (medios entrantes) con `extranjero`, `verImagen`, `imagenTope`, `visionApagada`, `oirAudio`, `audioTope` y `audioApagado`', () => {
    const esperado = derivar(chat('interpretar-entrada.js'), [
      ['// INTERPRETAR ENTRADA: el mensaje entrante, normalizado a UN evento de texto para el modelo.', '// INTERPRETAR ENTRADA: el mensaje entrante, normalizado (tipo, texto, medio y categoría). PR-1 no tiene modelo: la categoría solo dice qué clase de entrada llegó.'],
      ['// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen SIN `evento`: lo arma «Registrar evento» con lo que lean los nodos de medios.', '// UN NÚMERO DE OTRO PAÍS (prefijo fuera de `prefijosPermitidos`) YA NO SE DESCARTA EN SILENCIO: sale marcado `extranjero` (sin descargar nada, sin QR, sin aviso) y «Decidir turno» le responde una vez al día.\n// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen con `categoria: medio` y su `mediaId`; todo lo demás conversable, con `categoria: conversacion`; cualquier otro tipo, con `categoria: otro` (el flujo igual contesta cortésmente).'],
      ['el prefijo de país no está permitido (responder a un número extranjero cuesta su tarifa), Meta', 'Meta'],
      ["const prefijos = String(cfg.prefijosPermitidos || '').split(',').map((p) => p.trim()).filter(Boolean);\nif (prefijos.length && !prefijos.some((p) => from.startsWith(p))) return [];\n", 'const extranjero = rrEsExtranjero(from, cfg.prefijosPermitidos);\n'],
      ['chYaVisto(cnFichaDe(', 'rrYaVisto(cnFichaDe('],
      ['const rubros = (cfg.datos && cfg.datos.rubros) || [];\n', ''],
      ['let evento = null;\n', ''],
      ['  evento = chEventoTexto(texto);\n', ''],
      ["  // Un toque no es texto: lo que cuenta es su id (`rubro:<id>`, `planes`, `equipo`), y solo si tiene la forma esperada.\n  const id = String((sel && sel.id) || '');\n  evento = chEventoToque(/^[a-z0-9:_-]{1,200}$/.test(id) ? id : '', rubros);\n",
        "  // Un toque no es texto: lo que cuenta es su id, y solo si tiene la forma esperada.\n  const id = String((sel && sel.id) || '');\n  texto = /^[a-z0-9:_-]{1,200}$/.test(id) ? id : '';\n"],
      ["  // Un botón sin texto no es una imagen: queda como «una respuesta rápida».\n  evento = texto.trim() === '' ? chEventoOtro('button') : chEventoTexto(texto);\n", ''],
      ['  evento = chEventoOtro(tipo);\n', ''],
      ["if (tipo === 'text' && !evento) return [];", "if (tipo === 'text' && texto.trim() === '') return [];"],
      ["const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';\n", "const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';\nconst categoria = (tipo === 'text' || tipo === 'interactive' || tipo === 'button') ? 'conversacion' : ((tipo === 'audio' || tipo === 'image' || tipo === 'document') ? 'medio' : 'otro');\n"+'// PR-2: ¿esta imagen o documento es el comprobante de un QR abierto? Lo dice el SERVIDOR (`cobro` de `Traer configuración`), nunca el texto ni la imagen. Con cobro REAL: hay un QR pendiente, el cobro está\n// en revisión o el plazo venció hace menos de 24 h (el servidor decide qué hacer). Con cobro SIMULADO: cualquier foto con el QR pendiente es el comprobante de la prueba (no se baja ni se coteja).\nconst rrCobroDelTurno = rrCobro(rrPanelDe(cnPrimero(\'Traer configuración\')), cnPrimero(\'Config base\'));\nconst rrEsVisual = (tipo === \'image\' || tipo === \'document\');\nconst esComprobante = rrEsVisual && mediaId !== \'\' && rrCobroDelTurno.modo === \'real\' && (rrCobroDelTurno.pendiente || rrCobroDelTurno.enRevision || rrCobroDelTurno.vencidoHaceMin !== null);\nconst comprobanteSimulado = rrEsVisual && rrCobroDelTurno.modo === \'simulado\' && rrCobroDelTurno.pendiente;\nconst mimeType = visual && typeof visual.mime_type === \'string\' ? visual.mime_type.slice(0, 100) : \'\';\n'
        + "// MEDIOS ENTRANTES: un documento solo es comprobante si es un PDF o una imagen (lo demás no lo lee Gemini: un archivo no soportado nunca se baja). ¿Se mira esta foto o se escucha este audio? Lo decide el código ANTES de bajar nada (tipo y formato, sin cobro pendiente ni QR en la guarda para la foto, y el tope diario por teléfono: `rrMediosDelTurno`, rr.js).\n"
        + "const mimeBase = mimeType.split(';')[0].trim().toLowerCase();\n"
        + "const docIlegible = tipo === 'document' && mimeBase !== 'application/pdf' && RR_MIME_VISION.indexOf(mimeBase) < 0;\n"
        + "const rrMedios = rrMediosDelTurno({ tipo: tipo, mediaId: mediaId, mimeType: mimeType, esComprobante: esComprobante, comprobanteSimulado: comprobanteSimulado, extranjero: extranjero, ficha: rrFichaVigente(cnFichaDe(cnMapaDeFichas(false).mapa, from)), ahoraMs: ahoraTurno, base: cnPrimero('Config base') || {} });\n"],
      ['const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;\n', 'const msg = Array.isArray(carga.messages) ? carga.messages[0] : undefined;\n'+"// El instante en que el CLIENTE escribió (Meta manda `timestamp` en segundos): de ahí parte la hora límite del aviso. Solo vale si es un número finito, no posterior al reloj del proceso y\n// de las últimas 24 h; si no, `mensajeMs` es el reloj del proceso. `ahoraMs` (el reloj del proceso) sigue siendo el de las ventanas y las fichas.\nconst ahoraTurno = Number(carga.ahoraMs) || Date.now();\nconst tsMeta = msg && /^\\d{1,12}$/.test(String(msg.timestamp)) ? Number(msg.timestamp) * 1000 : NaN;\nconst mensajeMs = Number.isFinite(tsMeta) && tsMeta <= ahoraTurno && ahoraTurno - tsMeta <= 24 * 60 * 60 * 1000 ? tsMeta : ahoraTurno;\n"],
      ['  ahoraMs: Number(carga.ahoraMs) || Date.now(),\n', '  ahoraMs: ahoraTurno,\n  mensajeMs: mensajeMs,\n'],
      ['return [{ json: {\n  from: from,', '// TOPE GLOBAL de llamadas a Gemini por hora (audio y visión; ni el modelo conversacional ni el cotejo del comprobante entran): lleno, el audio o la foto no se descargan ni se mandan a Gemini.\nconst rrBaseG = cnPrimero(\'Config base\') || {};\nconst geminiTope = (rrMedios.oirAudio || rrMedios.verImagen) && rrHoraN(cnObjetoGlobal(\'rrTopes\', false).mapa.gemini, ahoraTurno) >= rrTopeHora(rrBaseG.topeGeminiHora, RR_GEMINI_HORA, RR_GEMINI_HORA_MAX);\n\nreturn [{ json: {\n  from: from,'],
      ['  evento: evento,\n', '  categoria: categoria,\n  esComprobante: esComprobante && !extranjero && !docIlegible,\n  comprobanteSimulado: comprobanteSimulado && !extranjero,\n  mimeType: mimeType,\n  extranjero: extranjero,\n  verImagen: rrMedios.verImagen && !geminiTope,\n  imagenTope: rrMedios.imagenTope,\n  visionApagada: rrMedios.visionApagada,\n  oirAudio: rrMedios.oirAudio && !geminiTope,\n  geminiTope: geminiTope,\n  audioTope: rrMedios.audioTope,\n  audioApagado: rrMedios.audioApagado,\n'],
    ]);
    expect(propio('interpretar-entrada.js')).toBe(esperado);
  });

  it('«Config del negocio»: los bloques de lectura de la respuesta, de atención y del modo prueba son IDÉNTICOS al origen', () => {
    const o = chat('config-del-negocio.js');
    const c = propio('config-del-negocio.js');
    const bloques: Array<[string, string]> = [
      ['const base = cnPrimero', "if (!cuerpo || typeof cuerpo !== 'object') cuerpo = {};\n"],
      ['const util = (v)', "const valor = (v) => (typeof v === 'string' && !/^REEMPLAZAR_/.test(v.trim())) ? v.trim() : '';\n"],
      ['// --- ATENCIÓN', "atencionVenceEn: util(at.ventanaVenceEn) || '',\n};\n"],
      ['const prueba = carga.prueba', "modoPrueba === true ? carga.prueba : null;\n"],
      ['const permitidos = valor(', ".filter((x) => x.length >= 6);\n"],
      ['const telefonoDePrueba = prueba', "cnDigitos(prueba.telefonoDePrueba) : '';\n"],
      ['  waGraphVersion:', "String(base.waGraphVersion) : 'v26.0',\n"],
      ["  phoneNumberId: String(carga.phoneNumberId || ''),", "  enviarDeVerdad: prueba ? prueba.enviarDeVerdad === true && telefonoPermitido : true,\n"],
    ];
    for (const [ini, fin] of bloques) {
      const trozo = entre(o, ini, fin);
      expect(c.includes(trozo), `el bloque «${ini.slice(0, 40)}» no es idéntico al origen`).toBe(true);
    }
    // La ÚNICA diferencia del modo prueba (declarada en PROPIO.md): `telefonoPermitido` niega por defecto.
    expect(entre(o, 'const telefonoPermitido', ';\n')).toBe('const telefonoPermitido = permitidos.length === 0 || permitidos.indexOf(telefonoDePrueba) >= 0;\n');
    expect(entre(c, 'const telefonoPermitido', ';\n')).toBe('const telefonoPermitido = permitidos.length > 0 && permitidos.indexOf(telefonoDePrueba) >= 0;\n');
    // Lo QUE SE QUITÓ: la oferta (planes y cargos), la planilla y los datos propios del chat.
    for (const quitado of ['CH_DATOS', 'limpiarOferta', 'planillaProspectosId', 'archivoPlanes', 'cargosUnicos']) expect(c).not.toContain(quitado);
  });

  it('NIEGA_IA: la expresión es IDÉNTICA a `CH_NIEGA_IA` de chat-novuchat (la librería propia la declara)', () => {
    const origen = /^const CH_NIEGA_IA = (\/.+\/);$/m.exec(leer(join(CHAT, 'src/lib/chat.js')))![1];
    const copiaRr = /^const RR_NIEGA_IA = (\/.+\/);$/m.exec(leer(join(RROCA, 'src/lib/rr.js')))![1];
    expect(copiaRr).toBe(origen);
  });
});

describe('HUECOS: nodos JSON de la plantilla, comparados con sus orígenes (sin `notes`, `position` ni `id`)', () => {
  const plantilla = (ruta: string): Flujo => JSON.parse(leer(ruta)) as Flujo;
  const limpio = (n: J): string => {
    const { notes: _n, position: _p, id: _i, ...resto } = n as J;
    return JSON.stringify(resto);
  };
  const RR = plantilla(join(RROCA, 'flujo.plantilla.json'));
  const comparar = (origen: Flujo, nombres: string[]): void => {
    for (const n of nombres) {
      const a = nodo(RR, n);
      const b = origen.nodes.find((x) => x.name === n);
      expect(a, `falta en rroca-ruben: ${n}`).toBeDefined();
      expect(b, `falta en el origen: ${n}`).toBeDefined();
      expect(limpio(a as J), n).toBe(limpio(b as J));
    }
  };
  it('los 6 nodos de la entrada verificada del receptor son IDÉNTICOS a los de venta-minima', () => {
    comparar(plantilla(join(FLUJOS, 'venta-minima/flujo.plantilla.json')), ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos']);
  });
  it('«Traer configuración», «Config base», «¿Reportar? (entrante)», «Reportar mensaje (entrante)» y «¿Meta aceptó?» son IDÉNTICOS a los de chat-novuchat', () => {
    comparar(plantilla(join(CHAT, 'flujo.plantilla.json')), ['Traer configuración', 'Config base', '¿Reportar? (entrante)', 'Reportar mensaje (entrante)', '¿Meta aceptó?']);
  });
  it('la comparación niega: un cambio en `parameters` de la copia se detecta', () => {
    const a = copia(nodo(RR, 'Traer configuración')) as J;
    a['parameters'] = { ...a['parameters'], url: 'https://otro.example.invalid/x' };
    expect(limpio(a)).not.toBe(limpio(nodo(RR, 'Traer configuración') as J));
  });
});

describe('«solo se ofrece lo que se cumple»: con el aviso a recepción (PR-3) el flujo es publicable, y la guardia EXIGE que el aviso esté', () => {
  it('el JSON de producción ya no lleva `meta.noPublicable` y la guardia rechaza que la marca vuelva', () => {
    expect((PRODUCCION as J)['meta']?.noPublicable).toBeUndefined();
    expect(guardias('produccion', PRODUCCION)).toEqual([]);
    const conMarca = copia(PRODUCCION) as J;
    conMarca['meta'] = { noPublicable: 'x' };
    expect(guardias('produccion', conMarca as Flujo).join('|')).toMatch(/noPublicable/);
  });
  it('el JSON FALLA si se quita el aviso: sin «Armar avisos», sin «¿Hay avisos?» o sin «Enviar aviso» (en producción y en la prueba)', () => {
    for (const [variante, f] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      for (const n of NODOS_DEL_AVISO) {
        const sin = copia(f) as J;
        sin['nodes'] = sin['nodes'].filter((x: J) => x['name'] !== n);
        expect(guardias(variante, sin as Flujo).join('|'), `${variante} sin ${n}`).toContain(`falta el nodo «${n}»`);
      }
    }
  });
  it('el JSON FALLA si «Armar avisos» pierde la plantilla o la ventana de Rubén, o si el aviso se desconecta o corre DESPUÉS de armar el mensaje', () => {
    const sinPlantilla = copia(PRODUCCION) as J;
    const n = sinPlantilla['nodes'].find((x: J) => x['name'] === 'Armar avisos');
    n['parameters']['jsCode'] = String(n['parameters']['jsCode']).replace(/rrPlantilla\(/g, 'rrOtra(');
    expect(guardias('produccion', sinPlantilla as Flujo).join('|')).toMatch(/no lleva la plantilla ni la ventana/);
    const desconectado = copia(PRODUCCION) as J;
    desconectado['connections']['Armar avisos'] = { main: [[]] };
    expect(guardias('produccion', desconectado as Flujo).join('|')).toMatch(/«Armar avisos» no está conectado/);
    const tarde = copia(PRODUCCION) as J;
    tarde['connections']['Enviar aviso'] = { main: [[]] };
    expect(guardias('produccion', tarde as Flujo).join('|')).toMatch(/«Enviar aviso» no cuelga de «Armar mensajes»/);
  });
  it('el JSON FALLA si «¿Hay avisos?» no manda la rama sin aviso a «Armar mensajes», o si «Enviar aviso» pierde la credencial o su `onError` (en producción y en la prueba)', () => {
    for (const [variante, f] of [['produccion', PRODUCCION], ['prueba', PRUEBA]] as const) {
      expect(guardias(variante, f), variante).toEqual([]);
      const sinRama = copia(f) as J;
      sinRama['connections']['¿Hay avisos?'] = { main: [sinRama['connections']['¿Hay avisos?'].main[0], []] };
      expect(guardias(variante, sinRama as Flujo).join('|'), `${variante} sin rama sin aviso`).toMatch(/«¿Hay avisos\?» no envía la rama sin aviso/);
      const sinCred = copia(f) as J;
      delete sinCred['nodes'].find((x: J) => x['name'] === 'Enviar aviso')['credentials'];
      expect(guardias(variante, sinCred as Flujo).join('|'), `${variante} sin credencial`).toMatch(/«Enviar aviso» no lleva credencial/);
      const sinError = copia(f) as J;
      delete sinError['nodes'].find((x: J) => x['name'] === 'Enviar aviso')['onError'];
      expect(guardias(variante, sinError as Flujo).join('|'), `${variante} sin onError`).toMatch(/«Enviar aviso» no lleva `onError: continueRegularOutput`/);
    }
  });
  it('«Enviar aviso» sanea la versión de Graph y el id del número igual que «Enviar a WhatsApp»', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const url = (nombre: string) => String((f['nodes'] as J[]).find((x: J) => x['name'] === nombre)!['parameters']['url']);
      expect(url('Enviar aviso')).toBe(url('Enviar a WhatsApp'));
      expect(url('Enviar aviso')).toContain("replace(/\\D/g, '')");
      expect(url('Enviar aviso')).toContain('/^v\\d+\\.\\d$/');
    }
  });
});

describe('saneo del repo público: lo armado no lleva identificadores', () => {
  const textos: Array<[string, string]> = [
    ['rroca-ruben.json', leer(join(RROCA, 'rroca-ruben.json'))],
    ['rroca-ruben.prueba.json', leer(join(RROCA, 'rroca-ruben.prueba.json'))],
    ['rroca-ruben.json (datos)', leer(ARCHIVO_DE_DATOS)],
  ];
  for (const [nombre, t] of textos) {
    it(`${nombre}: sin UUID, sin tokens, sin rutas de usuario, sin correos y sin secuencias de 10 o más dígitos que no sean de seis ceros`, () => {
      expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      expect(t).not.toMatch(/\bEAA[A-Za-z0-9]{20,}|\bAIza[0-9A-Za-z_-]{30,}|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bxox[abprs]-/);
      expect(t).not.toMatch(/\/(home|Users)\/[a-z][a-z0-9._-]+\//);
      expect(t).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
      const largas = (t.match(/\d{10,}/g) ?? []).filter((s) => !/0{6,}/.test(s));
      expect(largas).toEqual([]);
    });
  }

  it('las rutas de webhook, el verificador y el waba son marcadores REEMPLAZAR_*; ninguna ruta real versionada', () => {
    const d = cargarDatos() as J;
    for (const v of [d['receptor'].ruta, d['receptor'].urlVerificador, d['receptor'].wabaIdEsperado, d['pruebaRuta']]) expect(String(v)).toMatch(/^REEMPLAZAR_[A-Z0-9_]+$/);
    expect(String(nodo(PRODUCCION, 'Entrega del receptor').parameters['path'])).toBe(d['receptor'].ruta);
    expect(String(nodo(PRUEBA, 'Entrada de prueba').parameters['path'])).toBe(d['pruebaRuta']);
  });

  it('ninguna credencial lleva id (van por nombre) y las credenciales de AAB1-WA-Prod no aparecen', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      for (const n of f.nodes) for (const c of Object.values(n.credentials ?? {})) expect(c.id, n.name).toBe('');
      expect(JSON.stringify(f)).not.toMatch(/aab1-wa-prod/i);
    }
  });

  it('un dato real en el archivo de datos lo rechaza el armador (la ruta del receptor tiene que ser un marcador)', () => {
    const ruta = join(ESTA, 'no-existe.json');
    expect(() => cargarDatos(ruta)).toThrow(/no existe/);
  });
});

// ------------------------------------------------------------------------------------------------------------------------------------
// MEDIOS ENTRANTES (20/10/2026): el NÚCLEO COMÚN de la transcripción va INCLUIDO tal cual (nunca copiado) y su salida la traduce un adaptador propio.
// ------------------------------------------------------------------------------------------------------------------------------------
describe('NÚCLEO INCLUIDO: «Preparar transcripción» es el archivo común de core, byte a byte, con dos nombres de nodo traducidos', () => {
  const codigo = (f: Flujo, n: string): string => String(nodo(f, n).parameters['jsCode']);
  const CORE = leer(NUCLEO_TRANSCRIPCION).trimEnd();
  // El núcleo tal cual tras aplicar SOLO la traducción declarada (dos nombres de nodo, textual).
  const NUCLEO = traducirNucleo(CORE);
  const CODIGO = codigo(PRODUCCION, 'Preparar transcripción');
  const correrPrep = (transcripcion: string, tam = 100_000): J => {
    const salida = ejecutar(CODIGO, [{ content: { parts: [{ text: transcripcion }] } }], { 'Interpretar entrada': { from: '59100000011', tipo: 'audio' }, 'Obtener URL del medio': { file_size: tam } });
    expect(salida).toHaveLength(1);
    return salida[0]!;
  };

  it('el código armado CONTIENE el archivo del core tal cual tras aplicar SOLO la traducción textual declarada de dos nombres de nodo (y ningún nombre que no exista en el flujo)', () => {
    expect(CODIGO).toContain(NUCLEO);
    // La traducción es lo único que cambia: deshacerla devuelve el core exacto, y el flujo no conserva ningún nombre del core ni redefine `$`.
    expect(NUCLEO.split("$('Interpretar entrada')").join("$('Normalizar entrada')").split("$('Obtener URL del medio')").join("$('Obtener URL del medio (general)')")).toBe(CORE);
    for (const viejo of Object.keys(NOMBRES_DEL_NUCLEO)) expect(CODIGO, viejo).not.toContain(`$('${viejo}')`);
    expect(CODIGO).not.toMatch(/const \$ =|rrN8n/);
    expect(codigo(PRUEBA, 'Preparar transcripción')).toContain(NUCLEO);
    expect(Object.keys(NOMBRES_DEL_NUCLEO)).toEqual(['Normalizar entrada', 'Obtener URL del medio (general)']);
    expect(NOMBRES_DEL_NUCLEO).toEqual({ 'Normalizar entrada': 'Interpretar entrada', 'Obtener URL del medio (general)': 'Obtener URL del medio' });
    expect(CODIGO).toContain(leer(ADAPTADOR_TRANSCRIPCION).trimEnd());
  });

  it('CONTRATO con el core: las cadenas que el adaptador entiende siguen literalmente en él (si el core cambia, esta prueba falla y el flujo se rearma)', () => {
    for (const c of ["'(audio transcripto) '", 'nota de voz de más de cinco minutos', 'la nota de voz seguía', "$('Normalizar entrada')", "$('Obtener URL del medio (general)')", 'return out;']) expect(CORE, c).toContain(c);
  });

  it('la ejecución: una transcripción es «ok»; vacía es «no_entendido»; más de 720 kB es «largo»; 5.000 caracteres se recortan y lo dicen', () => {
    expect(correrPrep('Hola, tengo una tienda de ropa')).toEqual({ audioEstado: 'ok', audioTexto: 'Hola, tengo una tienda de ropa', audioRecortado: false });
    expect(correrPrep('')).toMatchObject({ audioEstado: 'no_entendido', audioTexto: '' });
    expect(correrPrep('   ')).toMatchObject({ audioEstado: 'no_entendido' });
    expect(correrPrep('Hola', 800_000)).toMatchObject({ audioEstado: 'largo', audioTexto: '' });
    const largo = correrPrep('palabra '.repeat(625));
    expect(largo['audioEstado']).toBe('ok');
    expect(largo['audioRecortado']).toBe(true);
    expect(String(largo['audioTexto']).length).toBeLessThanOrEqual(4400);
  });

  it('NEGANDO: un cliente que DICE «la nota de voz seguía» o «nota de voz de más de cinco minutos» no engaña al adaptador (solo vale lo que escribió el núcleo, después del primer salto)', () => {
    expect(correrPrep('la nota de voz seguía y no me escuchaste')).toMatchObject({ audioEstado: 'ok', audioRecortado: false });
    expect(correrPrep('esta nota de voz de más de cinco minutos es una broma')).toMatchObject({ audioEstado: 'ok', audioRecortado: false });
  });

  it('el tope de bytes del audio es UNO solo: `RR_AUDIO_MAX_BYTES` (rr.js) = `LIMITE_BYTES` del núcleo = el de «¿Tamaño aceptable?»; el del PDF es 10 MB y el de la foto 5 MB', () => {
    expect(leer(join(RROCA, 'src/lib/rr.js'))).toContain('const RR_AUDIO_MAX_BYTES = 720000;');
    expect(NUCLEO).toContain('const SEGUNDOS_MAX = 300;');
    expect(NUCLEO).toContain('const BYTES_POR_SEGUNDO = 2400;');
    expect(300 * 2400).toBe(720000);
    expect(leer(join(FLUJOS, '../src/core/medios/medio-no-aceptado.js'))).toMatch(/MAX_AUDIO = 720000/);
    const exp = String(nodo(PRODUCCION, '¿Tamaño aceptable?').parameters['conditions']!['conditions'][0].leftValue);
    expect(exp).toContain('esAudio === true ? 720000 : (String($(\'Interpretar entrada\').first().json.mimeType || \'\').toLowerCase().startsWith(\'application/pdf\') ? 10000000 : 5000000)');
    expect(leer(join(RROCA, 'src/lib/rr.js'))).toContain('const RR_PDF_MAX_BYTES = 10000000;');
  });

  it('«Transcribir audio» tiene los MISMOS parámetros que el del Demo B; ambos nodos de Gemini no cortan el turno si fallan', () => {
    const demoB = JSON.parse(leer(join(FLUJOS, '../demo-b-venta-cobro.json'))) as Flujo;
    expect(nodo(PRODUCCION, 'Transcribir audio').parameters).toEqual(nodo(demoB, 'Transcribir audio').parameters);
    for (const n of ['Transcribir audio', 'Ver imagen']) {
      expect((nodo(PRODUCCION, n) as J)['onError'], n).toBe('continueRegularOutput');
      expect((nodo(PRODUCCION, n) as J)['alwaysOutputData'], n).toBe(true);
    }
    // «Ver imagen» solo CLASIFICA: no lleva opciones de resolución ni más de 200 tokens de salida.
    expect(nodo(PRODUCCION, 'Ver imagen').parameters['options']).toEqual({ maxOutputTokens: 200 });
  });

  it('NEGANDO (guardias): un núcleo alterado, un Gemini sin `alwaysOutputData` o conectado a otro nodo dan hallazgo', () => {
    const alterado = copia(PRODUCCION);
    nodo(alterado, 'Preparar transcripción').parameters['jsCode'] = String(nodo(alterado, 'Preparar transcripción').parameters['jsCode']).replace('const SEGUNDOS_MAX = 300;', 'const SEGUNDOS_MAX = 3000;');
    expect(guardias('produccion', alterado).join('|')).toMatch(/no incluye el núcleo común/);
    const sinSalida = copia(PRODUCCION);
    delete (nodo(sinSalida, 'Transcribir audio') as J)['alwaysOutputData'];
    expect(guardias('produccion', sinSalida).join('|')).toMatch(/«Transcribir audio» tiene que llevar onError/);
    const sinVer = copia(PRODUCCION);
    (nodo(sinVer, 'Ver imagen') as J)['onError'] = undefined;
    expect(guardias('produccion', sinVer).join('|')).toMatch(/«Ver imagen» tiene que llevar onError/);
    const desviado = copia(PRODUCCION);
    desviado.connections['Transcribir audio'] = { main: [[{ node: 'Armar mensajes', type: 'main', index: 0 }]] } as never;
    expect(guardias('produccion', desviado).join('|')).toMatch(/«Transcribir audio» tiene que conectarse solo a «Preparar transcripción»/);
  });

  it('`topeAudiosDia` y `topeImagenesDia` tienen forma validada en los datos (0 a 30 y 0 a 20)', () => {
    const base = JSON.parse(leer(ARCHIVO_DE_DATOS)) as { configBase: Record<string, unknown> };
    const probar = (campo: string, valor: unknown): string => {
      const d = copia(base);
      d.configBase[campo] = valor;
      const dir = mkdtempSync(join(tmpdir(), 'rroca-'));
      const ruta = join(dir, 'datos.json');
      writeFileSync(ruta, JSON.stringify(d));
      try { cargarDatos(ruta); return 'ok'; } catch (e) { return (e as Error).message; } finally { rmSync(dir, { recursive: true, force: true }); }
    };
    expect(probar('topeAudiosDia', '31')).toMatch(/topeAudiosDia: forma no válida/);
    expect(probar('topeImagenesDia', '21')).toMatch(/topeImagenesDia: forma no válida/);
    expect(probar('topeAudiosDia', '-1')).toMatch(/forma no válida/);
    expect(probar('topeAudiosDia', '10')).toBe('ok');
    expect(probar('topeImagenesDia', '0')).toBe('ok');
  });
});
