/**
 * «EL PUENTE» DE ANTONIO (tenant rroca-antonio) — PR-A: LOS HUECOS DECLARADOS, comparados con su ORIGEN.
 *
 * No existe todavía el módulo común de puerta del turno, ficha por teléfono, carga de entrada ni configuración del negocio para un flujo «sin agente»
 * (`Flujos/experimental/rroca-antonio/PROPIO.md`, §«Común SIN fuente utilizable»). Cada pieza es una COPIA declarada de `chat-novuchat` o de `venta-minima` (NO de `rroca-ruben`),
 * y esta suite la compara con su origen:
 *   - `_comun.js` y `puerta-del-turno.js`: IGUALES al origen una vez aplicadas las sustituciones declaradas (y solo ellas);
 *   - `carga-de-entrada.js` y `config-del-negocio.js`: toda línea con código está en el origen, salvo las líneas propias declaradas aquí (una lista cerrada);
 *   - los 6 nodos de la entrada verificada del receptor (de `venta-minima`) y los nodos HTTP/Set/If de `chat-novuchat`: iguales en `parameters`, tipo, versión, credenciales y opciones;
 *     solo `id`, `notes` y `position` son propios (y el nombre de un nodo, donde se declara abajo).
 * Si el origen cambia, la prueba falla y obliga a decidir: volver a copiar o resolver el módulo común.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { J } from '../../lib/flujo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, '../../../..');
const EXP = join(REPO, 'Flujos/experimental');
const ANTONIO = join(EXP, 'rroca-antonio');
const leer = (r: string): string => readFileSync(r, 'utf8');
const nodoDe = (ruta: string): string => leer(join(ANTONIO, 'src/nodos', ruta));
const NQUITADAS = 44;
const HUELLA = 'c92ff194f2cd0cf6';
const origenChat = (a: string): string => leer(join(EXP, 'chat-novuchat/src/nodos', a));

/** Reemplaza `de` por `a` exigiendo que aparezca exactamente una vez (si el origen cambia, la sustitución deja de aplicar y la prueba lo dice). */
function unico(t: string, de: string, a: string): string {
  const n = t.split(de).length - 1;
  if (n !== 1) throw new Error(`la sustitución declarada ya no aplica (aparece ${n} veces): ${de.slice(0, 70)}`);
  return t.replace(de, () => a);
}

describe('HUECOS del núcleo: el código copiado de chat-novuchat, con SOLO las sustituciones declaradas', () => {
  it('_comun.js = origen + sustituciones declaradas (título, clave de la ficha `antonio`, sin el barrido de datos de otros flujos)', () => {
    let t = origenChat('_comun.js');
    t = unico(t, '// UTILIDADES COMUNES DE LOS NODOS DE «CHAT NOVUCHAT v2» (prefijo `cn`)', '// UTILIDADES COMUNES DE LOS NODOS DEL FLUJO DE ANTONIO (prefijo `cn`)');
    t = unico(t, '(`chat.js`, y las `cm*`', '(`ra.js`, y las `cm*`');
    t = unico(t, '// Las fichas de los teléfonos (`staticData.global.chatNovuchat`). Un nodo que SOLO LEE no escribe nada en los datos estáticos. Los que escriben (con `escribir` verdadero)\n// además borran lo que dejaron los flujos anteriores de este mismo workflow (`captacionMinima`, `conversaciones`, `vistos`: datos de prospectos que este flujo no lee).\n', '// Las fichas de los teléfonos (`staticData.global.antonio`). Un nodo que SOLO LEE no escribe nada en los datos estáticos.\n');
    t = unico(t, "sd.chatNovuchat && typeof sd.chatNovuchat === 'object' && !Array.isArray(sd.chatNovuchat)", "sd.antonio && typeof sd.antonio === 'object' && !Array.isArray(sd.antonio)");
    t = unico(t, "    sd.chatNovuchat = {};\n  }\n  if (escribir === true) { delete sd.captacionMinima; delete sd.conversaciones; delete sd.vistos; }\n  return { sd: sd, mapa: sd.chatNovuchat };", '    sd.antonio = {};\n  }\n  return { sd: sd, mapa: sd.antonio };');
    expect(nodoDe('_comun.js')).toBe(t);
  });

  it('puerta-del-turno.js = origen BYTE A BYTE, salvo el nombre del nodo de entrada («Interpretar entrada» → «Normalizar entrada»)', () => {
    const t = unico(origenChat('puerta-del-turno.js'), "cnPrimero('Interpretar entrada')", "cnPrimero('Normalizar entrada')");
    expect(nodoDe('puerta-del-turno.js')).toBe(t);
  });

  /** Líneas con código (no vacías) del propio que no están en el origen: tienen que ser exactamente las declaradas. */
  const propiasDe = (propio: string, origen: string): string[] => {
    const o = new Set(origen.split('\n'));
    return propio.split('\n').filter((l) => l.trim() !== '' && !o.has(l));
  };

  /** Líneas con código del origen que el propio ya no trae: tienen que ser exactamente las declaradas (lista cerrada). */
  const quitadasDe = (propio: string, origen: string): string[] => {
    const p = new Set(propio.split('\n'));
    return origen.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//') && !p.has(l));
  };

  it('carga-de-entrada.js: las únicas líneas de código del origen que se quitan son las dos que el receptor y la prueba reemplazan', () => {
    expect(quitadasDe(nodoDe('carga-de-entrada.js'), origenChat('carga-de-entrada.js'))).toEqual([
      "  const b = j.body && typeof j.body === 'object' ? j.body : null;",
      '  const v = cnValorDeMeta(j) || cnValorDeMeta(b);',
    ]);
  });

  it('config-del-negocio.js: las líneas de código del origen que se quitan son SOLO la oferta, la planilla y los datos del chat (lista cerrada)', () => {
    const quitadas = quitadasDe(nodoDe('config-del-negocio.js'), origenChat('config-del-negocio.js'));
    // Y nada del bloque de atención, de la lectura 200/409/otra ni del modo prueba se quita.
    // Excepciones declaradas: los 3 `Object.assign` que llevaban la oferta, y `telefonoPermitido`, que aquí NIEGA por defecto.
    expect(quitadas.filter((l) => /atencion|statusCode|codigo === |telefonoDePrueba|enviarDeVerdad/.test(l))).toEqual([
      '  cfg = Object.assign({}, deBase, sinOferta, atencion, {',
      '  cfg = Object.assign({}, deBase, sinOferta, atencion, {',
      '  cfg = Object.assign({}, deBase, deLaConsola, limpiarOferta(ob), atencion, {',
      'const telefonoPermitido = permitidos.length === 0 || permitidos.indexOf(telefonoDePrueba) >= 0;',
    ]);
    // La lista se fija con un hash para no repetir 60 líneas: si el origen o la copia cambian, falla y obliga a revisar qué se quitó.
    expect({ n: quitadas.length, huella: createHash('sha256').update(quitadas.join('\n')).digest('hex').slice(0, 16) }).toEqual({ n: NQUITADAS, huella: HUELLA });
  });

  it('carga-de-entrada.js: toda línea está en el origen, salvo la rama del receptor y la lectura del `body` solo con «Entrada de prueba» (lista cerrada)', () => {
    const propias = propiasDe(nodoDe('carga-de-entrada.js'), origenChat('carga-de-entrada.js'));
    expect(propias).toEqual([
      '// 4. LA DEL RECEPTOR: si CORRIÓ «Entrega del receptor», el evento es su `body.value`, y si `body.field` viene, tiene que ser `messages` (otro campo —un cambio de plantilla, de calidad— no es',
      '//    un mensaje). Ese nodo manda sobre las otras formas: lo que pasa por «Verificar firma con el receptor» ya no es el evento sino su veredicto, que nunca se lee como mensaje.',
      '//    Fuera del receptor, el `body` solo se lee si CORRIÓ «Entrada de prueba»: ningún otro Webhook puede hacerse pasar por un mensaje de WhatsApp.',
      "const receptor = cnPrimero('Entrega del receptor');",
      'const cuerpoReceptor = receptor && receptor.body && typeof receptor.body === \'object\' ? receptor.body : {};',
      "const valorReceptor = cuerpoReceptor.value && typeof cuerpoReceptor.value === 'object' && (cuerpoReceptor.field === undefined || cuerpoReceptor.field === 'messages') ? cnValorDeMeta(cuerpoReceptor.value) : null;",
      "  const b = prueba && j.body && typeof j.body === 'object' ? j.body : null;",
      '  const v = receptor ? valorReceptor : (cnValorDeMeta(j) || cnValorDeMeta(b));',
    ]);
  });

  it('config-del-negocio.js: toda línea con código está en el origen, salvo las propias (sin oferta ni planilla ni datos del chat; modo prueba que NIEGA por defecto)', () => {
    const propias = propiasDe(nodoDe('config-del-negocio.js'), origenChat('config-del-negocio.js'));
    // Las líneas de comentario propias y los `Object.assign` sin la oferta se declaran en PROPIO.md; aquí se fija lo que cambia de comportamiento.
    const codigo = propias.filter((l) => !l.trim().startsWith('//'));
    expect(codigo).toEqual([
      '  cfg = {',
      '    ...deBase, ...atencion,',
      '  };',
      '  cfg = {',
      '    ...deBase, ...atencion,',
      '  };',
      '  cfg = {',
      '    ...deBase, ...deLaConsola, ...atencion,',
      '  };',
      'const telefonoPermitido = permitidos.length > 0 && permitidos.indexOf(telefonoDePrueba) >= 0;',
      'return [{ json: {',
      '  ...cfg,',
      "  modelo: /^gemini-[a-z0-9][a-z0-9.-]{1,38}$/.test(String(base.modelo || '')) ? String(base.modelo) : 'gemini-3.5-flash-lite',",
      '} }];',
    ]);
  });

  it('config-del-negocio.js: NIEGA POR DEFECTO el modo prueba (el origen permite todo con la lista vacía) y no trae oferta, planilla ni datos de otro flujo', () => {
    const t = nodoDe('config-del-negocio.js');
    expect(t).toContain('permitidos.length > 0 && permitidos.indexOf(telefonoDePrueba) >= 0');
    expect(t).not.toContain('permitidos.length === 0');
    for (const ajeno of ['limpiarOferta', 'planilla', 'CH_DATOS', 'archivoPlanes', 'cargosUnicos', 'rubros']) expect(t, ajeno).not.toContain(ajeno);
    // Semgrep `insecure-object-assign`: se arma con propagación de objetos propios, nunca con `Object.assign`.
    expect(t).not.toContain('Object.assign');
  });
});

describe('config-del-negocio.js sin Object.assign: el cuerpo de «Traer configuración» es entrada y no contamina (prueba negada)', () => {
  const correr = (cuerpo: unknown, codigo = 200): Record<string, unknown> => {
    const cnPrimero = (n: string): unknown => (n === 'Config base' ? { nombreNegocio: 'Base', numeroRecepcion: '5917123' } : { phoneNumberId: 'p1' });
    const entrada = { first: () => ({ json: { statusCode: codigo, body: cuerpo } }) };
    const f = new Function('cnPrimero', 'cnDigitos', '$input', nodoDe('config-del-negocio.js'));
    const r = f(cnPrimero, (v: unknown) => String(v ?? '').replace(/\D/g, ''), entrada) as Array<{ json: Record<string, unknown> }>;
    return r[0].json;
  };

  it('un cuerpo con __proto__, constructor y prototype no aparece en la salida ni contamina Object.prototype', () => {
    const cuerpo = JSON.parse('{"tenantId":"t","__proto__":{"contaminado":true},"constructor":{"prototype":{"contaminado2":true}},"prototype":{"x":1},"datosDelNegocio":{"__proto__":{"contaminado3":true},"nombreNegocio":"Panel"},"operacion":{"__proto__":{"contaminado4":true}},"atencion":{"__proto__":{"contaminado5":true},"estado":"operador"}}');
    const j = correr(cuerpo);
    for (const k of ['contaminado', 'contaminado2', 'contaminado3', 'contaminado4', 'contaminado5']) {
      expect(j[k], k).toBeUndefined();
      expect(({} as Record<string, unknown>)[k], k).toBeUndefined();
    }
    expect(Object.keys(j)).not.toContain('constructor');
    expect(Object.keys(j)).not.toContain('prototype');
    expect(Object.getPrototypeOf(j)).toBe(Object.prototype);
    expect(j).toMatchObject({ nombreNegocio: 'Panel', atencionEstado: 'operador', configDeLaConsola: true, estadoComercio: 'operativo' });
  });

  it('409 y panel sin respuesta siguen igual: suspendido con el texto neutro, y respaldo operativo', () => {
    expect(correr({ mensajeCortesia: 'Volvemos pronto' }, 409)).toMatchObject({ estadoComercio: 'suspendido', configDeLaConsola: false, mensajeComercioSuspendido: 'Volvemos pronto' });
    expect(correr({}, 500)).toMatchObject({ estadoComercio: 'operativo', configDeLaConsola: false, panelSinRespuesta: true, codigoDelPanel: 500, nombreNegocio: 'Base' });
  });
});

describe('HUECOS de los nodos JSON de la plantilla: iguales a su origen en todo salvo `id`, `notes` y `position`', () => {
  const plantilla = JSON.parse(leer(join(ANTONIO, 'flujo.plantilla.json'))) as { nodes: J[] };
  const chat = JSON.parse(leer(join(EXP, 'chat-novuchat/flujo.plantilla.json'))) as { nodes: J[] };
  const venta = JSON.parse(leer(join(EXP, 'venta-minima/flujo.plantilla.json'))) as { nodes: J[] };
  const de = (f: { nodes: J[] }, n: string): J => f.nodes.find((x) => x.name === n) as J;
  const sinLibres = (n: J): J => { const { id: _i, notes: _n, position: _p, ...resto } = n; return resto; };
  /** La única sustitución de contenido: el nodo de entrada se llama «Normalizar entrada» (contrato con los módulos comunes de medios). */
  const renombrado = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/Interpretar entrada/g, 'Normalizar entrada').replace(/\.esAudio\b/g, '.esMedioAudio').replace(/\.esVisual\b/g, '.esMedioVisual');
    if (Array.isArray(v)) return v.map(renombrado);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as J).map(([k, x]) => [k, renombrado(x)]));
    return v;
  };

  it('los 6 nodos de la entrada verificada del receptor son los de venta-minima, sin ninguna diferencia', () => {
    for (const n of ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(de(venta, n)));
    }
  });

  it('Entrada de prueba, Config base, Traer configuración y ¿Meta aceptó? son los de chat-novuchat, sin ninguna diferencia', () => {
    for (const n of ['Entrada de prueba', 'Config base', 'Traer configuración', '¿Meta aceptó?']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(de(chat, n)));
    }
  });

  it('¿Reportar? (entrante) es el de chat-novuchat (solo cambia el nombre del nodo de entrada que lee)', () => {
    expect(sinLibres(de(plantilla, '¿Reportar? (entrante)'))).toEqual(sinLibres(renombrado(de(chat, '¿Reportar? (entrante)')) as J));
  });

  it('Reportar mensaje (entrante) es el de chat-novuchat con UN cambio PROPIO declarado: el `evento` ya no sale de la regex heredada («no me mandaron el material» la disparaba) sino de una regex acotada a PETICIONES más `riesgoEscrito`', () => {
    const origen = JSON.stringify(sinLibres(renombrado(de(chat, 'Reportar mensaje (entrante)')) as J));
    const propio = JSON.stringify(sinLibres(de(plantilla, 'Reportar mensaje (entrante)')));
    const viejo = origen.match(/evento: \/[^]*?\/i\.test\(String\(t\.texto \|\| ''\)\) \? 'no_contactar' : undefined/);
    expect(viejo, 'el origen ya no trae la regex heredada: hay que revisar la declaración').not.toBeNull();
    const nuevo = propio.match(/evento: \(t\.riesgoEscrito === true \|\| \/[^]*?\/i\.test\(String\(t\.texto \|\| ''\)\.normalize\('NFD'\)[^]*?\)\) \? 'no_contactar' : undefined/);
    expect(nuevo, 'el propio no trae el evento declarado').not.toBeNull();
    // Todo lo demás es idéntico al origen.
    expect(propio.replace(nuevo![0], 'EVENTO')).toBe(origen.replace(viejo![0], 'EVENTO'));
  });

  it('los nodos de medios (bajar, tamaño, descarga, audio, documento) son los de chat-novuchat con los campos del contrato común (`esMedioAudio`, `esMedioVisual`) y las credenciales por nombre', () => {
    for (const n of ['¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', '¿Es un documento?']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(renombrado(de(chat, n)) as J));
    }
    // Los de Gemini cambian el prompt (propio: solo `publicidad`, `comprobante`, `otro`) y la credencial (`@@cred:gemini`); el resto es igual.
    for (const n of ['Transcribir audio', 'Describir documento', 'Describir imagen']) {
      const propio = sinLibres(de(plantilla, n));
      const origen = sinLibres(renombrado(de(chat, n)) as J);
      // «Describir …» también sube `maxOutputTokens` (600): lee en la MISMA llamada los seis campos del comprobante (el cotejo lo hace el servidor).
      const sinOpciones = n === 'Transcribir audio' ? {} : { options: undefined };
      expect({ ...propio, credentials: undefined, parameters: { ...propio.parameters, text: undefined, ...sinOpciones } }, n)
        .toEqual({ ...origen, credentials: undefined, parameters: { ...origen.parameters, text: undefined, ...sinOpciones } });
      if (n !== 'Transcribir audio') expect((propio.parameters as J).options).toEqual({ maxOutputTokens: 600 });
      expect(propio.credentials).toEqual({ googlePalmApi: { id: '', name: '@@cred:gemini' } });
    }
  });
});
