/**
 * LAS DOCTORAS (tenants rroca-evy y rroca-emma) — LOS HUECOS DECLARADOS, comparados con su ORIGEN.
 *
 * Aquí es la TERCERA vez que se pide un flujo «sin agente» con puerta del turno, ficha por teléfono, carga de entrada y configuración del negocio (Antonio, Rubén y las doctoras), y todavía no existe
 * el módulo común (ticket para Rearquitectura: es Core, no se crea en este PR). Mientras tanto cada pieza es una COPIA declarada de `rroca-antonio` (que a su vez declara su origen en `chat-novuchat`
 * y `venta-minima`), y esta suite la compara con su origen, byte a byte:
 *   - `carga-de-entrada.js`: IDÉNTICO al de Antonio; `puerta-del-turno.js` y `config-del-negocio.js`: los de Antonio + SOLO el modo prueba (`etapaPrueba`, fragmentos declarados aquí);
 *   - `_comun.js`: IGUAL al de Antonio una vez aplicadas las sustituciones declaradas (y solo ellas);
 *   - las expresiones de `dr.js` que son de Antonio (NIEGA_IA, violencia o miedo, baja) tienen la MISMA fuente que en su origen, y las funciones de párrafos son las suyas con otro prefijo;
 *   - los nodos JSON de la plantilla (receptor, configuración, medios…) son iguales a los de Antonio en todo salvo `id`, `notes` y `position`.
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
const DR = join(EXP, 'doctoras');
const ANTONIO = join(EXP, 'rroca-antonio');
const leer = (r: string): string => readFileSync(r, 'utf8');
const nodoDe = (carpeta: string, ruta: string): string => leer(join(carpeta, 'src/nodos', ruta));
const huella = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 16);

/** Reemplaza `de` por `a` exigiendo que aparezca exactamente una vez (si el origen cambia, la sustitución deja de aplicar y la prueba lo dice). */
function unico(t: string, de: string, a: string): string {
  const n = t.split(de).length - 1;
  if (n !== 1) throw new Error(`la sustitución declarada ya no aplica (aparece ${n} veces): ${de.slice(0, 70)}`);
  return t.replace(de, () => a);
}

describe('HUECOS del núcleo: el código copiado de rroca-antonio, con SOLO las sustituciones declaradas', () => {
  it('carga-de-entrada.js es IDÉNTICO byte a byte al de Antonio', () => {
    expect(huella(nodoDe(DR, 'carga-de-entrada.js'))).toBe(huella(nodoDe(ANTONIO, 'carga-de-entrada.js')));
    expect(nodoDe(DR, 'carga-de-entrada.js')).toBe(nodoDe(ANTONIO, 'carga-de-entrada.js'));
  });

  it('puerta-del-turno.js y config-del-negocio.js = los de Antonio + SOLO el modo prueba (`etapaPrueba`), declarado: quitados esos fragmentos, son idénticos byte a byte', () => {
    const sin = (t: string, fragmento: string): string => unico(t, fragmento, '');
    // Puerta: la ruta `fuera_de_prueba` (la primera que se mira) y su línea en la cabecera.
    let puerta = nodoDe(DR, 'puerta-del-turno.js');
    puerta = sin(puerta, "//   fuera_de_prueba -> `etapaPrueba = si` y el teléfono no está en `telefonosDePrueba`: no se responde, no se avisa, no se llama al modelo. Nunca se le escribe a un cliente. Es lo PRIMERO que se mira.\n");
    puerta = sin(puerta, "if (cfg.etapaPrueba === true) {\n  const permitidos = Array.isArray(cfg.telefonosEtapaPrueba) ? cfg.telefonosEtapaPrueba : [];\n  const quien = cnDigitos(t.from);\n"
      + "  if (!quien || permitidos.indexOf(quien) < 0) return [{ json: { ruta: 'fuera_de_prueba', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];\n}\n");
    expect(puerta).toBe(nodoDe(ANTONIO, 'puerta-del-turno.js'));
    // Config del negocio: la recepción de «Config base» manda en la etapa de prueba, y se exponen `etapaPrueba` y la lista.
    let config = nodoDe(DR, 'config-del-negocio.js');
    config = sin(config, "// ETAPA DE PRUEBA (`etapaPrueba = si` en `Config base`): el flujo vivo solo atiende a `telefonosDePrueba` (lo cierra `Puerta del turno`). El aviso nunca puede llegar a la recepción REAL de la doctora:\n"
      + "// con la etapa encendida el número de recepción es el de `Config base` y se IGNORA el de la Consola. Sin `si` (vacío, marcador o cualquier otro valor) todo queda como siempre.\n"
      + "const etapaPrueba = valor(base.etapaPrueba).toLowerCase() === 'si';\nif (etapaPrueba) cfg.numeroRecepcion = deBase.numeroRecepcion;\n\n");
    config = sin(config, "  etapaPrueba,\n  telefonosEtapaPrueba: etapaPrueba ? permitidos : [],\n");
    expect(config).toBe(nodoDe(ANTONIO, 'config-del-negocio.js'));
  });

  it('_comun.js = el de Antonio + sustituciones declaradas (título, referencia a la librería, clave de la ficha `doctoras`)', () => {
    let t = nodoDe(ANTONIO, '_comun.js');
    t = unico(t, 'DEL FLUJO DE ANTONIO (prefijo `cn`)', 'DEL FLUJO DE LAS DOCTORAS (prefijo `cn`)');
    t = unico(t, '(`ra.js`, y las `cm*`', '(`dr.js`, y las `cm*`');
    t = unico(t, '(`staticData.global.antonio`)', '(`staticData.global.doctoras`)');
    t = unico(t, "const valido = sd.antonio && typeof sd.antonio === 'object' && !Array.isArray(sd.antonio);", "const valido = sd.doctoras && typeof sd.doctoras === 'object' && !Array.isArray(sd.doctoras);");
    t = unico(t, '    sd.antonio = {};', '    sd.doctoras = {};');
    t = unico(t, 'return { sd: sd, mapa: sd.antonio };', 'return { sd: sd, mapa: sd.doctoras };');
    expect(nodoDe(DR, '_comun.js')).toBe(t);
    expect(nodoDe(DR, '_comun.js')).not.toMatch(/antonio/i);
  });

  it('dr.js: NIEGA_IA, violencia o miedo y baja tienen la MISMA fuente que en su origen (rroca-antonio)', () => {
    // eslint-disable-next-line no-new-func
    const cargar = (ruta: string, nombres: string): J => new Function(`${leer(ruta)}\nreturn { ${nombres} };`)() as J; // nosemgrep: devsecops.js-eval-prohibido
    // El código evaluado es el de los archivos del propio repositorio (src/lib de Antonio y de las doctoras), no una entrada externa: solo prueba.
    const ra = cargar(join(ANTONIO, 'src/lib/ra.js'), 'RA_NIEGA_IA, RA_RIESGO, raOraciones, raEsPregunta, raParrafos') as unknown as { RA_NIEGA_IA: RegExp; RA_RIESGO: RegExp };
    const dr = cargar(join(DR, 'src/lib/dr.js'), 'DR_NIEGA_IA, DR_RIESGO, DR_BAJA') as unknown as { DR_NIEGA_IA: RegExp; DR_RIESGO: RegExp; DR_BAJA: RegExp };
    expect(dr.DR_NIEGA_IA.source).toBe(ra.RA_NIEGA_IA.source);
    expect(dr.DR_NIEGA_IA.flags).toBe(ra.RA_NIEGA_IA.flags);
    expect(dr.DR_RIESGO.source).toBe(ra.RA_RIESGO.source);
    expect(dr.DR_RIESGO.flags).toBe(ra.RA_RIESGO.flags);
    // La baja: la expresión acotada de «Reportar mensaje (entrante)» de Antonio (en su plantilla), sin una coma de diferencia.
    const plantilla = JSON.parse(leer(join(ANTONIO, 'flujo.plantilla.json'))) as { nodes: J[] };
    const cuerpo = String((plantilla.nodes.find((n) => n['name'] === 'Reportar mensaje (entrante)')!['parameters'] as J)['jsonBody']);
    const i = cuerpo.indexOf('(t.riesgoEscrito === true || /') + '(t.riesgoEscrito === true || '.length;
    const j = cuerpo.indexOf('/i.test(', i);
    expect(i).toBeGreaterThan(40);
    const literalDeAntonio = cuerpo.slice(i, j + 2);
    expect(`/${dr.DR_BAJA.source}/${dr.DR_BAJA.flags}`).toBe(literalDeAntonio);
  });

  it('dr.js: la hoja de párrafos (raOraciones, raEsPregunta, raParrafos) es la de Antonio con el prefijo `dr`', () => {
    const fuente = (t: string): string => {
      const i = t.indexOf('function raOraciones(');
      const j = t.indexOf('// El texto que ve el cliente, con la barrera aplicada');
      return t.slice(i, j);
    };
    const origen = fuente(leer(join(ANTONIO, 'src/lib/ra.js'))).replace(/\bra(Oraciones|EsPregunta|Parrafos)\b/g, 'dr$1').replace(/\bRA_PARRAFO_MAX\b/g, 'DR_PARRAFO_MAX');
    const propio = leer(join(DR, 'src/lib/dr.js'));
    expect(origen.length).toBeGreaterThan(1000);
    expect(propio).toContain(origen.trim());
  });
});

describe('HUECOS de los nodos JSON de la plantilla: iguales a su origen en todo salvo `id`, `notes` y `position`', () => {
  const plantilla = JSON.parse(leer(join(DR, 'flujo.plantilla.json'))) as { nodes: J[] };
  const antonio = JSON.parse(leer(join(ANTONIO, 'flujo.plantilla.json'))) as { nodes: J[] };
  const de = (f: { nodes: J[] }, n: string): J => f.nodes.find((x) => x['name'] === n) as J;
  const sinLibres = (n: J): J => { const { id: _i, notes: _n, position: _p, ...resto } = n; return resto; };

  it('los 6 nodos de la entrada verificada del receptor son los de Antonio (a su vez los de venta-minima), sin ninguna diferencia', () => {
    for (const n of ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(de(antonio, n)));
    }
  });

  it('Entrada de prueba, Config base, Traer configuración, ¿Meta aceptó? y ¿Reportar? (entrante) son los de Antonio, sin ninguna diferencia', () => {
    for (const n of ['Entrada de prueba', 'Config base', 'Traer configuración', '¿Meta aceptó?', '¿Reportar? (entrante)']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(de(antonio, n)));
    }
  });

  it('Reportar mensaje (entrante) es el de Antonio con UN cambio PROPIO declarado: el `evento` sale de `bajaEscrita` y `riesgoEscrito` (la expresión de la baja vive una sola vez, en dr.js)', () => {
    const origen = JSON.stringify(sinLibres(de(antonio, 'Reportar mensaje (entrante)')));
    const propio = JSON.stringify(sinLibres(de(plantilla, 'Reportar mensaje (entrante)')));
    const viejo = origen.match(/evento: \(t\.riesgoEscrito === true \|\| \/[^]*?\/i\.test\(String\(t\.texto \|\| ''\)[^]*?\)\) \? 'no_contactar' : undefined/);
    expect(viejo, 'el origen ya no trae la expresión declarada: hay que revisar').not.toBeNull();
    const nuevo = "evento: (t.riesgoEscrito === true || t.bajaEscrita === true) ? 'no_contactar' : undefined";
    expect(propio).toContain(nuevo);
    expect(propio.replace(nuevo, 'EVENTO')).toBe(origen.replace(viejo![0], 'EVENTO'));
  });

  it('los nodos de medios (bajar, tamaño, descarga, audio, documento, transcripción) son los de Antonio; «Describir …» cambian el prompt y las opciones (propios) y nada más', () => {
    for (const n of ['¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', '¿Es un documento?', 'Transcribir audio', 'Preparar transcripción', 'Preparar imagen', 'Medio no aceptado']) {
      expect(sinLibres(de(plantilla, n)), n).toEqual(sinLibres(de(antonio, n)));
    }
    for (const n of ['Describir documento', 'Describir imagen']) {
      const propio = sinLibres(de(plantilla, n));
      const origen = sinLibres(de(antonio, n));
      const sinPrompt = (x: J): J => ({ ...x, parameters: { ...(x['parameters'] as J), text: undefined, options: undefined } });
      expect(sinPrompt(propio), n).toEqual(sinPrompt(origen));
      expect(String((propio['parameters'] as J)['text'])).toMatch(/publicidad\|documento_salud\|otro/);
    }
  });

  it('«Conversar con el modelo», «¿Conversar con el modelo?», «Armar avisos»-«Enviar aviso» y la protección (si están) son los de Antonio', () => {
    for (const n of ['¿Conversar con el modelo?', 'Conversar con el modelo', '¿Hay avisos?', 'Enviar aviso', '¿Falló la protección?', 'Reportar protección']) {
      const propio = plantilla.nodes.find((x) => x['name'] === n);
      if (!propio) continue; // todavía no llegó (PR-B)
      expect(sinLibres(propio), n).toEqual(sinLibres(de(antonio, n)));
    }
  });
});
