/**
 * «GUARDAR COMPROBANTE» EN Q'TACO (26/10/2026). Pedido de Andres: que ningún comprobante se pierda y que Q'Taco no dependa de la
 * ventana de 24 h del dueño. El patrón es el de `rroca-ruben` (`rr-guardar-comprobante`), probado aquí sobre el JSON versionado.
 *
 * Qué se demuestra, siempre con su opuesto:
 *  1. EL CABLEADO. El nodo cuelga de la salida «no es audio» de `¿Es audio?` (solo comprobantes: `¿Bajar medio?` solo deja pasar audio
 *     o `esComprobante`), va ARRIBA de `¿Es PDF?` (executionOrder v1 termina una rama entera antes de la siguiente) y es TERMINAL
 *     (sin salidas): no toca el binario que leen los dos Gemini.
 *  2. NO BLOQUEA. `onError: continueRegularOutput`, `neverError`, 15 s, una sola vez: si falla, el cotejo sigue con `ruta: null`.
 *  3. SEGURIDAD. Solo el token por número (credencial de la ingesta por nombre), cabeceras de número/teléfono/id del mensaje, sin
 *     teléfono en la URL, y la URL es la de las Functions del proyecto (el token no viaja a otro anfitrión).
 *  4. EL COTEJO LLEVA LA RUTA. `Cotejar en el servidor` manda `ruta` (string o null), igual que Rubén.
 *  5. PARIDAD CON RUBÉN: los parámetros del nodo son los mismos (si uno cambia, la prueba obliga a mirar al otro).
 *  6. 0 MENSAJES POR CONVERSACIÓN: el nodo no envía nada al cliente ni al negocio.
 */
import { describe, expect, it } from 'vitest';
import { leerFlujo, destinos, entradas, type J } from './lib/flujo';
import { QTACO, leer, nodoDe } from './lib/venta-minima-mundo';

const PRUEBA = leer('venta-minima.prueba.json');
const DEMO_A = leer('venta-minima.ensayo-demo-a.json');
const PLANTILLA = leer('flujo.plantilla.json');
const RUBEN = leerFlujo('experimental/rroca-ruben/flujo.plantilla.json');
const G = 'Guardar comprobante';

describe('Guardar comprobante: el cableado', () => {
  for (const [nombre, f] of Object.entries({ QTACO, PRUEBA, DEMO_A, PLANTILLA })) {
    it(`${nombre}: cuelga de «¿Es audio?» (salida no-audio), primero que «¿Es PDF?», y es terminal`, () => {
      expect(destinos(f, '¿Es audio?', 1)).toEqual([G, '¿Es PDF?']);
      expect(entradas(f, G)).toEqual(['¿Es audio?']);
      expect(destinos(f, G)).toEqual([]);
      expect(f.connections[G]).toBeUndefined();
      // ARRIBA de «¿Es PDF?» (la misma columna, menor y): n8n corre primero la rama de arriba.
      const g = nodoDe(f, G).position;
      const pdf = nodoDe(f, '¿Es PDF?').position;
      expect(g[0]).toBe(pdf[0]);
      expect(g[1]).toBeLessThan(pdf[1]);
    });
  }

  it('el audio NO lo recorre (la salida de audio de «¿Es audio?» sigue yendo solo a «Transcribir audio»)', () => {
    expect(destinos(QTACO, '¿Es audio?', 0)).toEqual(['Transcribir audio']);
    expect(entradas(QTACO, G)).not.toContain('Descargar medio');
  });

  it('«¿Bajar medio?» solo deja bajar audio o un comprobante esperado: una imagen cualquiera nunca llega al guardado', () => {
    const cond = JSON.stringify(nodoDe(QTACO, '¿Bajar medio?').parameters);
    expect(cond).toContain('esAudio === true');
    expect(cond).toContain('esComprobante === true');
  });

  it('«Interpretar lectura» sigue cogiendo la lectura de los Gemini: el guardado no entra en su cadena', () => {
    expect(entradas(QTACO, 'Interpretar lectura').sort()).toEqual(['Leer comprobante (PDF)', 'Leer comprobante (imagen)']);
  });
});

describe('Guardar comprobante: nunca bloquea la respuesta al cliente', () => {
  const n = nodoDe(QTACO, G) as unknown as J;
  it('continueRegularOutput, neverError, fullResponse, 15 s y sin reintentos', () => {
    expect(n.onError).toBe('continueRegularOutput');
    expect(n.alwaysOutputData).toBe(true);
    expect(n.retryOnFail).toBeUndefined();
    expect(n.parameters.options.timeout).toBe(15000);
    expect(n.parameters.options.response.response).toEqual({ fullResponse: true, neverError: true });
  });
});

describe('Guardar comprobante: seguridad y forma de la llamada', () => {
  const n = nodoDe(QTACO, G) as unknown as J;
  it('POST de los bytes (binario `data`) a la Function guardarComprobante del proyecto, con la credencial de la ingesta (no firma, no token de Meta)', () => {
    expect(n.type).toBe('n8n-nodes-base.httpRequest');
    expect(n.parameters.method).toBe('POST');
    expect(n.parameters.url).toBe('https://us-east1-novuchat-demo.cloudfunctions.net/guardarComprobante');
    expect(n.parameters.contentType).toBe('binaryData');
    expect(n.parameters.inputDataFieldName).toBe('data');
    expect(n.parameters.genericAuthType).toBe('httpHeaderAuth');
    expect(n.credentials.httpHeaderAuth.name).toBe(nodoDe(QTACO, 'Cotejar en el servidor').credentials?.['httpHeaderAuth']?.name);
    expect(Object.keys(n.credentials)).toEqual(['httpHeaderAuth']);
  });

  it('cabeceras: número (con el patrón modoPrueba/phoneNumberId), teléfono e id del mensaje; el teléfono NO va en la URL ni en el cuerpo', () => {
    const h = Object.fromEntries(n.parameters.headerParameters.parameters.map((p: J) => [p.name, String(p.value)]));
    expect(Object.keys(h).sort()).toEqual(['X-NovuChat-IdMeta', 'X-NovuChat-Numero', 'X-NovuChat-Telefono']);
    expect(h['X-NovuChat-Numero']).toContain('modoPrueba === true');
    expect(h['X-NovuChat-Numero']).toContain('phoneNumberIdEsperado');
    expect(h['X-NovuChat-Numero']).toContain("$('Interpretar entrada').first().json.phoneNumberId");
    expect(h['X-NovuChat-Telefono']).toContain("$('Interpretar entrada').first().json.from");
    expect(h['X-NovuChat-IdMeta']).toContain("$('Interpretar entrada').first().json.mensajeId");
    expect(n.parameters.url).not.toMatch(/\{\{|\d{8,}/);
    expect(n.parameters.jsonBody).toBeUndefined();
  });

  it('ni el JSON ni las notas del nodo llevan un token, una clave o un número real', () => {
    const t = JSON.stringify(n);
    expect(t).not.toMatch(/EAA[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9]/);
  });

  it('PARIDAD con Rubén: mismos parámetros, credencial y política de error', () => {
    const r = nodoDe(RUBEN, G) as unknown as J;
    expect(n.parameters).toEqual(r.parameters);
    expect(n.onError).toBe(r.onError);
    expect(n.alwaysOutputData).toBe(r.alwaysOutputData);
    expect(n.typeVersion).toBe(r.typeVersion);
  });
});

describe('El cotejo lleva la ruta', () => {
  const body = String(nodoDe(QTACO, 'Cotejar en el servidor').parameters['jsonBody']);
  it('«Cotejar en el servidor» manda `ruta` (solo si es texto; si no, null), como Rubén', () => {
    expect(body).toContain("ruta: typeof $json.ruta === 'string' ? $json.ruta : null");
    const r = String(nodoDe(RUBEN, 'Cotejar en el servidor').parameters['jsonBody']);
    expect(r).toContain("ruta: typeof $json.ruta === 'string' ? $json.ruta : null");
  });
  it('los otros tres campos del cuerpo no cambian (la respuesta al cliente es la misma)', () => {
    for (const c of ['telefono: $json.telefono', 'legible: $json.legible === true', "idMeta: $json.idMeta || ''"]) expect(body).toContain(c);
  });
});

describe('Costo: 0 mensajes por conversación', () => {
  it('«Guardar comprobante» no es un nodo de envío ni de reporte, y ningún nodo de envío cuelga de él', () => {
    const n = nodoDe(QTACO, G);
    expect(String(n.parameters['url'])).not.toMatch(/graph\.facebook|\/messages|ingesta|reportar/i);
    expect(destinos(QTACO, G)).toEqual([]);
  });
});
