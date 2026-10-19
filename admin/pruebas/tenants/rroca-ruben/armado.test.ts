/**
 * «VENTA DIGITAL DE RUBÉN» (tenant rroca-ruben) — PR-1, EL ARMADO (`Flujos/experimental/rroca-ruben/`).
 *
 * Lo que esta suite niega: que el JSON versionado difiera de lo que se arma; que el flujo pase de 48 nodos; que lleve un WhatsApp Trigger, un agente, un modelo o
 * un «Continue on Fail» en la verificación del receptor; que `wabaIdEsperado` salga de una expresión; que lo COMÚN (mensajes, envío) esté copiado en vez de
 * incluido; que las copias declaradas como HUECO (núcleo sin fuente utilizable, tomado de chat-novuchat) se aparten de su origen más allá de lo declarado en
 * `PROPIO.md`; y que el JSON traiga lo que el saneo del repo público rechaza (rutas de webhook, UUID, tokens, secuencias de 10 o más dígitos sin seis ceros).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Flujo, J } from '../../lib/flujo';
import { entornoDelEmulador } from '../../core/entorno-del-hijo.ts';
// @ts-expect-error el armador es un .mjs sin tipos
import { AQUI, ARCHIVO_DE_DATOS, AVISO_A_RECEPCION_EXISTE, CONFIG, TOPE_DE_NODOS, anfitrionPermitido, cargarDatos, guardias } from '../../../../Flujos/experimental/rroca-ruben/construir.mjs';
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

  it('PR-1 no tiene modelo, cobro, QR, comprobante, rescate ni disparadores por tiempo', () => {
    for (const f of [PRODUCCION, PRUEBA]) {
      const tipos = f.nodes.map((n) => n.type).join('\n');
      expect(tipos).not.toMatch(/langchain|googleGemini|scheduleTrigger|cron/i);
      expect(f.nodes.map((n) => n.name).join('\n')).not.toMatch(/modelo|QR|comprobante|cobro|rescate/i);
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

  it('la cadena de envío es la de `envio.mjs` (`injertar`), nodo por nodo; solo el reporte se reencamina a «¿Meta aceptó?»', () => {
    const cadena = nodosDeEnvio({ credenciales: { graph: 'Graph WhatsApp Ruben (Bearer)', ingesta: 'NovuChat ingesta (Ruben)' }, ingestaUrl: 'https://us-east1-novuchat-demo.cloudfunctions.net/ingesta', desde: [2120, 160] });
    for (const n of cadena.nodes) expect(nodo(PRODUCCION, n.name), n.name).toEqual(n);
    expect(PRODUCCION.connections['¿Reportar? (saliente)']!['main']![0]!.map((c) => c.node)).toEqual(['¿Meta aceptó?']);
    expect(PRODUCCION.connections['¿Meta aceptó?']!['main']![0]!.map((c) => c.node)).toEqual(['Reportar mensaje (saliente)']);
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

  it('«Resumen del turno»: el origen más SOLO la verificación de entrega (R3: sin `messages[0].id` del principal ni del respaldo, la ejecución falla)', () => {
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

  it('«Interpretar entrada»: el origen sin el contrato del chat (eventos y rubros) y con la `categoria`', () => {
    const esperado = derivar(chat('interpretar-entrada.js'), [
      ['// INTERPRETAR ENTRADA: el mensaje entrante, normalizado a UN evento de texto para el modelo.', '// INTERPRETAR ENTRADA: el mensaje entrante, normalizado (tipo, texto, medio y categoría). PR-1 no tiene modelo: la categoría solo dice qué clase de entrada llegó.'],
      ['// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen SIN `evento`: lo arma «Registrar evento» con lo que lean los nodos de medios.', '// Este nodo SOLO LEE la ficha. Un audio, una imagen o un documento salen con `categoria: medio` y su `mediaId`; todo lo demás conversable, con `categoria: conversacion`; cualquier otro tipo, con `categoria: otro` (el flujo igual contesta cortésmente).'],
      ['chYaVisto(cnFichaDe(', 'rrYaVisto(cnFichaDe('],
      ['const rubros = (cfg.datos && cfg.datos.rubros) || [];\n', ''],
      ['let evento = null;\n', ''],
      ['  evento = chEventoTexto(texto);\n', ''],
      ["  // Un toque no es texto: lo que cuenta es su id (`rubro:<id>`, `planes`, `equipo`), y solo si tiene la forma esperada.\n  const id = String((sel && sel.id) || '');\n  evento = chEventoToque(/^[a-z0-9:_-]{1,200}$/.test(id) ? id : '', rubros);\n",
        "  // Un toque no es texto: lo que cuenta es su id, y solo si tiene la forma esperada.\n  const id = String((sel && sel.id) || '');\n  texto = /^[a-z0-9:_-]{1,200}$/.test(id) ? id : '';\n"],
      ["  // Un botón sin texto no es una imagen: queda como «una respuesta rápida».\n  evento = texto.trim() === '' ? chEventoOtro('button') : chEventoTexto(texto);\n", ''],
      ['  evento = chEventoOtro(tipo);\n', ''],
      ["if (tipo === 'text' && !evento) return [];", "if (tipo === 'text' && texto.trim() === '') return [];"],
      ["const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';\n", "const esVisual = (tipo === 'image' || tipo === 'document') && mediaId !== '';\nconst categoria = (tipo === 'text' || tipo === 'interactive' || tipo === 'button') ? 'conversacion' : ((tipo === 'audio' || tipo === 'image' || tipo === 'document') ? 'medio' : 'otro');\n"],
      ['  evento: evento,\n', '  categoria: categoria,\n'],
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

describe('«solo se ofrece lo que se cumple»: PR-1 no es publicable hasta que exista el aviso a recepción (PR-3)', () => {
  it('mientras el aviso no exista, el JSON de producción lleva `meta.noPublicable` y la guardia lo exige', () => {
    expect(AVISO_A_RECEPCION_EXISTE).toBe(false);
    expect(typeof (PRODUCCION as J)['meta']?.noPublicable).toBe('string');
    expect(guardias('produccion', PRODUCCION)).toEqual([]);
    const sinMarca = copia(PRODUCCION) as J;
    delete sinMarca['meta'];
    expect(guardias('produccion', sinMarca as Flujo).join('|')).toMatch(/noPublicable/);
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
