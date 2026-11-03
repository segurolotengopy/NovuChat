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
 *
 * EL ORIGEN ESTÁ FIJADO POR HUELLA (sha256), no leído en vivo. Antonio se rehace (ventas digitales, fase 2: cambia `config-del-negocio.js`, su prompt de «Describir imagen» y su cadena de avisos al servidor) y no debe
 * arrastrar a las doctoras: las huellas de abajo son las de los archivos de `rroca-antonio` TAL COMO ESTÁN en `main` `afc05293` (`git show afc05293:Flujos/experimental/rroca-antonio/<ruta> | sha256sum`; para un nodo JSON,
 * el sha256 de su JSON canónico —llaves ordenadas— sin `id`, `notes` ni `position`). Las doctoras se comparan contra ELLAS, con los fragmentos propios que declara #634 quitados igual que antes. Si Antonio cambia de nuevo,
 * esta suite NO se entera: a propósito. Cuando se actualice una huella, se avisa a Clínicas (el diff de esta prueba es lo que se le pasa).
 * Los grupos de 8 caracteres separados por espacios evitan que una huella parezca un número largo al saneo del repositorio público.
 *
 * LO QUE DEBERÍA VIVIR EN CORE (núcleo común: se incluye desde su fuente, nunca se copia): NIEGA_IA, RIESGO (violencia o miedo), `raOraciones` y las funciones de párrafos, la entrada verificada del receptor y la protección
 * (`¿Falló la protección?` y `Reportar protección`). Mientras tanto toda corrección de seguridad de Antonio que TAMBIÉN aplique a las doctoras se AVISA a Clínicas: esta prueba ya no lo haría fallar sola.
 * La protección de las doctoras sigue EXISTIENDO en su JSON (la prueba lo exige) aunque Antonio la reemplazó por «Avisar al servidor».
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
const leer = (r: string): string => readFileSync(r, 'utf8');
const nodoDe = (carpeta: string, ruta: string): string => leer(join(carpeta, 'src/nodos', ruta));
/** sha256 completo en grupos de 8 (la forma en que están escritas las huellas de abajo). */
const huella = (t: string): string => (createHash('sha256').update(t).digest('hex').match(/.{8}/g) as string[]).join(' ');
/** JSON canónico: llaves ordenadas, para que el orden de las llaves de un archivo no cambie la huella. */
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as J).sort().map((k) => [k, canon((v as J)[k])])) : v);
const jsonCanonico = (v: unknown): string => JSON.stringify(canon(v));

// Las HUELLAS de los archivos de rroca-antonio en main afc05293 (el origen de las doctoras). Ver el encabezado.
const ORIGEN: Record<string, string> = {
  'carga-de-entrada.js': '2562bb2b 56c2ea23 74644de1 016bcb91 3c50a372 51db3ca3 65eca902 660e2e5f',
  'puerta-del-turno.js': '3f8a837a 3912eb78 521919d2 07dfc705 2914a7a9 c82be664 c46fa723 50f7678a',
  'config-del-negocio.js': '1aff437f 2f78a08b 6b9adabf eb99af01 60b933b0 840f867f a02c8656 8478d7b4',
  '_comun.js': '304e6d15 ac80e270 3e32afd5 cc64b63b d1a9ccca 2261fd97 704f637d 093f89a3',
  'NIEGA_IA': 'fbecaf98 862e180f f9509c6a 65e2c8e2 78fdf287 17246973 c8f822f2 49d4a503',
  'RIESGO': '1514803b 9fd6e08b 2e06fd3f 7e1eed32 e1dbd175 e5ac2128 5dab25d9 9f858cc0',
  'PARRAFOS': '2cec242f b1b7ab6e 22ce47c8 ed99e6a8 e1f71c40 4a337b7a d5f5da04 71dcc949',
  'BAJA': '82c5cc0e 5b846081 1af864a0 fb4e211b 2dd358ec f37dff0b 50835961 b032c3f5',
};
/** Las huellas de los nodos JSON de la plantilla de Antonio en main afc05293 (JSON canónico sin `id`, `notes` ni `position`; en «Reportar mensaje (entrante)» con la expresión del evento sustituida por EVENTO; en «Describir …» sin `text` ni `options`). */
const NODOS: Record<string, string> = {
  'Entrega del receptor': '9661a6e9 4991a7c0 7022a041 de93991d df38615d d191b3e2 e26863e2 1b925d99',
  'Verificar firma con el receptor': 'a8534fc1 daa81af4 2108b328 8e392c6c 7daee7db 87f38061 4242bebb ad7bc587',
  '¿Firma válida?': '20f72882 e151a27b 25c5f077 9678c2aa cc629395 f30de06d 13e215d1 8b0551a0',
  'Aceptar (200)': '62847d30 7ab506cf ea557716 f7aa2627 f6e18879 81e785d5 f88cfd83 53198289',
  'Rechazar (401)': '369a121c 4440cfbc 54dd7655 b7da923a d2b65a16 048f0b12 2f7223dc df8fb9e4',
  'Descartar repetidos': '854ec28a 6c41186c 4096fb32 4a4d9b84 23aef8ba ae7e8df5 7d33b83c f2ad2144',
  'Entrada de prueba': 'fb7ce40d 5b40e40b e78e9dd5 6a61ec9d 8de0dd0a 8b2a80b0 c09323e1 e724704f',
  'Config base': '1a12c688 74eb96c4 19e56184 e2bd82c3 95880894 2be0ae71 fdf62138 291c2de5',
  'Traer configuración': '51868312 b1f6f5ed b2c9f892 79a5de47 8541802f 40346df0 e68067a5 4a2ff1b8',
  '¿Meta aceptó?': '811a0ce3 0657680f 6fa677ff e8192bd1 5bee3004 63162797 db4f8626 5a3f6dc2',
  '¿Bajar medio?': 'd85adfed 21a8a5cb 183c7c07 ae4ad732 82f26819 c9b684a6 553d76d6 3d7da2ae',
  'Obtener URL del medio (general)': 'b7e1a599 c4784a3b 9566747f 2410ea49 8bf7fec7 bedacb2f ff791530 11e301c6',
  '¿Tamaño aceptable?': '55476dc7 d74056dc 30657b72 c28fb1ea 2be4c3c7 3ded9abf 02739035 b4922037',
  'Descargar medio': '6864a600 5b10d458 0d8a8b8a f950bae2 18f18b26 fcbdb8bc a63929a8 3841ddc7',
  '¿Es audio?': '977929e3 f7575209 4a9ef992 e207db09 3045eb68 a2110124 34217cc4 d321b89b',
  '¿Es un documento?': '6c9e4aa5 811ac181 4cbb1ae3 d3c5c08e 16317317 75b6ba43 59db0b87 a754a662',
  'Transcribir audio': '7503ce27 12979617 5f35b323 db04cc1c 041dd300 63bbe370 7c86c2dd 4d037471',
  'Preparar transcripción': '00f1a729 d9a7e5be 2e750014 1da6a223 28fb023e 647d8c67 172dc5a6 6fade55f',
  'Preparar imagen': '25103f69 f04cac9b 89b3fc85 347b30c1 66c70fa4 bf0f293b 67589659 dd0dab16',
  'Medio no aceptado': '813f23d8 b658badd 5a942123 fadc9c57 f6738c18 777eb03f 55d83e85 f7fae0c9',
  '¿Conversar con el modelo?': '96cbec90 e612c8c7 f87cbb32 ad60431c 06e2a1b2 d2bc3b55 45b78227 9aeec9b3',
  'Conversar con el modelo': 'b5a22ee2 afaf3757 1dda75fc ac13407c e5919a43 6b64bf21 2146572d f7586def',
  '¿Hay avisos?': 'd56d9254 424ee7c6 a9eece06 ef2eef4d e533693f 2eaeb086 e17ba768 04a0b333',
  'Enviar aviso': '6f4f053d ba628c2f be90a91b 052493d5 57fc892b ea73a483 cf59d427 0a8c2ba0',
  '¿Falló la protección?': '90d6a6f9 bd3565c7 edc0b03f 7f993812 95cece0e d62abfd0 1541ca9f 641a46fc',
  'Reportar protección': '64b2ee58 d1a1bdb6 46dc3e9a f8fdd731 64cffca3 00e2fd26 ca378883 d2791d01',
  '¿Reportar? (entrante)': 'eed0f1f4 b474f9cf 7b0f28f2 a286bde6 80479a80 6c078df8 f0f5d012 210b183f',
  'Reportar mensaje (entrante)': '9fbf29b6 b2bf4e6d 5f064c42 821b8c67 ff70944c bee944db 23716146 afe290e3',
  'Describir documento': 'c974ec24 a42d4fae a8285acf 6569fd36 26f6bfdb fc869d66 9ca81927 3c5ef1a4',
  'Describir imagen': '9d1ac6ab 9af9953b 2d326d56 d150a3f2 a03a5430 fb8c7b08 add8f5ff ee615f6d',
};


/** Reemplaza `de` por `a` exigiendo que aparezca exactamente una vez (si el origen cambia, la sustitución deja de aplicar y la prueba lo dice). */
function unico(t: string, de: string, a: string): string {
  const n = t.split(de).length - 1;
  if (n !== 1) throw new Error(`la sustitución declarada ya no aplica (aparece ${n} veces): ${de.slice(0, 70)}`);
  return t.replace(de, () => a);
}

describe('HUECOS del núcleo: el código copiado de rroca-antonio (main afc05293, por huella), con SOLO las sustituciones declaradas', () => {
  it('carga-de-entrada.js es IDÉNTICO byte a byte al de Antonio', () => {
    expect(huella(nodoDe(DR, 'carga-de-entrada.js'))).toBe(ORIGEN['carga-de-entrada.js']);
  });

  it('puerta-del-turno.js y config-del-negocio.js = los de Antonio + SOLO el modo prueba (`etapaPrueba`), declarado: quitados esos fragmentos, son idénticos byte a byte', () => {
    const sin = (t: string, fragmento: string): string => unico(t, fragmento, '');
    // Puerta: la ruta `fuera_de_prueba` (la primera que se mira) y su línea en la cabecera.
    let puerta = nodoDe(DR, 'puerta-del-turno.js');
    puerta = sin(puerta, "//   fuera_de_prueba -> `etapaPrueba = si` y el teléfono no está en `telefonosDePrueba`: no se responde, no se avisa, no se llama al modelo. Nunca se le escribe a un cliente. Es lo PRIMERO que se mira.\n");
    puerta = sin(puerta, "if (cfg.etapaPrueba === true) {\n  const permitidos = Array.isArray(cfg.telefonosEtapaPrueba) ? cfg.telefonosEtapaPrueba : [];\n  const quien = cnDigitos(t.from);\n"
      + "  if (!quien || permitidos.indexOf(quien) < 0) return [{ json: { ruta: 'fuera_de_prueba', texto: '', responder: false, transferir: false, motivo: '', from: t.from } }];\n}\n");
    expect(huella(puerta)).toBe(ORIGEN['puerta-del-turno.js']);
    // Config del negocio: la recepción de «Config base» manda en la etapa de prueba, y se exponen `etapaPrueba` y la lista.
    let config = nodoDe(DR, 'config-del-negocio.js');
    config = sin(config, "// ETAPA DE PRUEBA (`etapaPrueba = si` en `Config base`): el flujo vivo solo atiende a `telefonosDePrueba` (lo cierra `Puerta del turno`). El aviso nunca puede llegar a la recepción REAL de la doctora:\n"
      + "// con la etapa encendida el número de recepción es el de `Config base` y se IGNORA el de la Consola. Sin `si` (vacío, marcador o cualquier otro valor) todo queda como siempre.\n"
      + "const etapaPrueba = valor(base.etapaPrueba).toLowerCase() === 'si';\nif (etapaPrueba) cfg.numeroRecepcion = deBase.numeroRecepcion;\n\n");
    config = sin(config, "  etapaPrueba,\n  telefonosEtapaPrueba: etapaPrueba ? permitidos : [],\n");
    expect(huella(config)).toBe(ORIGEN['config-del-negocio.js']);
  });

  it('_comun.js = el de Antonio + sustituciones declaradas (título, referencia a la librería, clave de la ficha `doctoras`): deshechas, idéntico', () => {
    let t = nodoDe(DR, '_comun.js');
    expect(t).not.toMatch(/antonio/i);
    t = unico(t, 'DEL FLUJO DE LAS DOCTORAS (prefijo `cn`)', 'DEL FLUJO DE ANTONIO (prefijo `cn`)');
    t = unico(t, '(`dr.js`, y las `cm*`', '(`ra.js`, y las `cm*`');
    t = unico(t, '(`staticData.global.doctoras`)', '(`staticData.global.antonio`)');
    t = unico(t, "const valido = sd.doctoras && typeof sd.doctoras === 'object' && !Array.isArray(sd.doctoras);", "const valido = sd.antonio && typeof sd.antonio === 'object' && !Array.isArray(sd.antonio);");
    t = unico(t, '    sd.doctoras = {};', '    sd.antonio = {};');
    t = unico(t, 'return { sd: sd, mapa: sd.doctoras };', 'return { sd: sd, mapa: sd.antonio };');
    expect(huella(t)).toBe(ORIGEN['_comun.js']);
  });

  it('dr.js: NIEGA_IA, violencia o miedo y baja tienen la MISMA fuente que en su origen (rroca-antonio, main afc05293)', () => {
    // eslint-disable-next-line no-new-func
    const dr = new Function(`${leer(join(DR, 'src/lib/dr.js'))}\nreturn { DR_NIEGA_IA, DR_RIESGO, DR_BAJA };`)() as { DR_NIEGA_IA: RegExp; DR_RIESGO: RegExp; DR_BAJA: RegExp }; // nosemgrep: devsecops.js-eval-prohibido
    // El código evaluado es el de un archivo del propio repositorio (src/lib de las doctoras), no una entrada externa: solo prueba.
    expect(huella(`${dr.DR_NIEGA_IA.source}/${dr.DR_NIEGA_IA.flags}`)).toBe(ORIGEN['NIEGA_IA']);
    expect(huella(`${dr.DR_RIESGO.source}/${dr.DR_RIESGO.flags}`)).toBe(ORIGEN['RIESGO']);
    // La baja: la expresión acotada de «Reportar mensaje (entrante)» de Antonio (en su plantilla), literal `/…/i`, sin una coma de diferencia.
    expect(huella(`/${dr.DR_BAJA.source}/${dr.DR_BAJA.flags}`)).toBe(ORIGEN['BAJA']);
  });

  it('dr.js: la hoja de párrafos (raOraciones, raEsPregunta, raParrafos) es la de Antonio con el prefijo `dr`: con el prefijo `ra` devuelto, idéntica', () => {
    const dr = leer(join(DR, 'src/lib/dr.js'));
    const i = dr.indexOf('function drOraciones(');
    const f = dr.indexOf('function drParrafos(');
    const j = dr.indexOf('\n}\n', f) + 2;
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(f);
    const bloque = dr.slice(i, j).replace(/\bdr(Oraciones|EsPregunta|Parrafos)\b/g, 'ra$1').replace(/\bDR_PARRAFO_MAX\b/g, 'RA_PARRAFO_MAX').trim();
    expect(bloque.length).toBeGreaterThan(1000);
    expect(huella(bloque)).toBe(ORIGEN['PARRAFOS']);
  });
});

describe('HUECOS de los nodos JSON de la plantilla: iguales a su origen (main afc05293, por huella) en todo salvo `id`, `notes` y `position`', () => {
  const plantilla = JSON.parse(leer(join(DR, 'flujo.plantilla.json'))) as { nodes: J[] };
  const de = (n: string): J => plantilla.nodes.find((x) => x['name'] === n) as J;
  const sinLibres = (n: J): J => { const { id: _i, notes: _n, position: _p, ...resto } = n; return resto; };
  const hNodo = (n: string): string => huella(jsonCanonico(sinLibres(de(n))));

  it('los 6 nodos de la entrada verificada del receptor son los de Antonio (a su vez los de venta-minima), sin ninguna diferencia', () => {
    for (const n of ['Entrega del receptor', 'Verificar firma con el receptor', '¿Firma válida?', 'Aceptar (200)', 'Rechazar (401)', 'Descartar repetidos']) expect(hNodo(n), n).toBe(NODOS[n]);
  });

  it('Entrada de prueba, Config base, Traer configuración y ¿Meta aceptó? son los de Antonio, sin ninguna diferencia', () => {
    for (const n of ['Entrada de prueba', 'Config base', 'Traer configuración', '¿Meta aceptó?']) expect(hNodo(n), n).toBe(NODOS[n]);
  });

  it('¿Reportar? (entrante) es el de Antonio con UN cambio PROPIO declarado: tampoco reporta (ni cuenta conversación) a un número ajeno en la etapa de prueba', () => {
    const propio = jsonCanonico(sinLibres(de('¿Reportar? (entrante)')));
    const viejo = "$('Config del negocio').first().json.modoPrueba !== true }}";
    const i = propio.indexOf("$('Config del negocio').first().json.modoPrueba !== true && !(");
    const j = propio.indexOf(' }}', i);
    expect(i).toBeGreaterThan(0);
    const nuevo = propio.slice(i, j + 3);
    expect(nuevo).toContain('etapaPrueba === true');
    expect(nuevo).toContain('telefonosEtapaPrueba');
    expect(huella(propio.replace(nuevo, viejo))).toBe(NODOS['¿Reportar? (entrante)']);
  });

  it('Reportar mensaje (entrante) es el de Antonio con UN cambio PROPIO declarado: el `evento` sale de `bajaEscrita` y `riesgoEscrito` (la expresión de la baja vive una sola vez, en dr.js)', () => {
    const propio = jsonCanonico(sinLibres(de('Reportar mensaje (entrante)')));
    const nuevo = "evento: (t.riesgoEscrito === true || t.bajaEscrita === true) ? 'no_contactar' : undefined";
    expect(propio).toContain(nuevo);
    expect(huella(propio.replace(nuevo, 'EVENTO'))).toBe(NODOS['Reportar mensaje (entrante)']);
  });

  it('los nodos de medios (bajar, tamaño, descarga, audio, documento, transcripción) son los de Antonio; «Describir …» cambian el prompt y las opciones (propios) y nada más', () => {
    for (const n of ['¿Bajar medio?', 'Obtener URL del medio (general)', '¿Tamaño aceptable?', 'Descargar medio', '¿Es audio?', '¿Es un documento?', 'Transcribir audio', 'Preparar transcripción', 'Preparar imagen', 'Medio no aceptado']) expect(hNodo(n), n).toBe(NODOS[n]);
    for (const n of ['Describir documento', 'Describir imagen']) {
      const propio = sinLibres(de(n));
      const sinPrompt = { ...propio, parameters: { ...(propio['parameters'] as J), text: undefined, options: undefined } };
      expect(huella(jsonCanonico(sinPrompt)), n).toBe(NODOS[n]);
      expect(String((propio['parameters'] as J)['text'])).toMatch(/publicidad\|documento_salud\|otro/);
    }
  });

  it('«Conversar con el modelo», «¿Conversar con el modelo?», «Armar avisos»-«Enviar aviso» y la protección son los de Antonio de main afc05293; la protección DEBE existir en el JSON de las doctoras', () => {
    for (const n of ['¿Conversar con el modelo?', 'Conversar con el modelo', '¿Hay avisos?', 'Enviar aviso']) expect(hNodo(n), n).toBe(NODOS[n]);
    // «¿Falló la protección?» y «Reportar protección» EXISTEN en las doctoras (Antonio ya los reemplazó por «Avisar al servidor»): su origen es el de main afc05293, no el vivo.
    for (const n of ['¿Falló la protección?', 'Reportar protección']) {
      expect(de(n), `falta el nodo «${n}» en el flujo de las doctoras`).toBeDefined();
      expect(hNodo(n), n).toBe(NODOS[n]);
    }
  });
});
