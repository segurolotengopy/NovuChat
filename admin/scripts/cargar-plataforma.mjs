#!/usr/bin/env node
/**
 * =============================================================================
 * CARGA DE `/plataforma/cobroSimulado` — LOS RÓTULOS DEL COBRO SIMULADO
 * =============================================================================
 *
 * Estos cuatro textos son la prohibición 3 de CLAUDE.md hecha dato: un cobro
 * simulado NUNCA se presenta como real. No son configurables por el comercio ni
 * por vertical; son de NovuChat y valen para todos. Por eso viven en
 * `/plataforma/`, donde las reglas de Firestore no dejan escribir a nadie salvo
 * al SDK Admin, y por eso los carga este script y no el panel.
 *
 * POR QUÉ NO ALCANZA CON `sembrar.mjs`: aquél es deliberadamente incapaz de
 * tocar un proyecto real —se niega si el proyecto no empieza con `demo-`— y
 * está bien que así sea. Esto tiene que escribir en producción, así que las
 * salvaguardas son otras, y más caras.
 *
 * LA VALIDACIÓN ES EL PUNTO, NO LA ESCRITURA. Escribir cuatro cadenas en
 * Firestore es trivial; lo que no lo es, es garantizar que ninguna de las
 * cuatro pueda quedar sin rótulo. Un epígrafe vacío, o uno al que alguien le
 * saca la palabra «SIMULADO» por hacerlo más vendedor, convierte la demo en la
 * cosa exacta que la prohibición 3 impide. Este script se niega a escribir un
 * texto que no se delate a sí mismo, y esa negativa es su razón de existir.
 *
 * SECO POR DEFECTO. Sin `--aplicar` no abre conexión: imprime lo que escribiría
 * y el resultado de la validación. Es la misma convención de
 * `scripts/publicar-flujo.sh`, y sirve para revisar los textos sin credenciales
 * ni base de datos delante.
 *
 * Uso:
 *   node scripts/cargar-plataforma.mjs                          # seco
 *   node scripts/cargar-plataforma.mjs --emulador --aplicar     # al emulador
 *   node scripts/cargar-plataforma.mjs --proyecto X --aplicar   # a un proyecto real
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// -----------------------------------------------------------------------------
// LOS TEXTOS
// -----------------------------------------------------------------------------
// `rotuloSuperior` y `rotuloInferior` NO son decorativos ni los inventa este
// script: describen lo que está IMPRESO en `Demo-Recursos/qr-demo.png`. El flujo
// los usa para poder afirmar por escrito lo que la imagen ya dice. Si alguna vez
// se rehace la imagen, estos dos textos se cambian con ella, o el mensaje pasa a
// afirmar algo que la foto no muestra.
//
// `epigrafe` es el pie que viaja junto a la imagen; `confirmacion` es lo que se
// responde cuando el cliente manda el comprobante. Los dos van tal cual al
// cliente, y por eso están en tuteo boliviano, sin voseo.
export const TEXTOS = {
  rotuloSuperior: 'DEMOSTRACIÓN · ESTE QR NO COBRA',
  rotuloInferior: 'SIMULACRO DE PAGO',
  epigrafe:
    '🧪 DEMOSTRACIÓN — cobro SIMULADO. Este QR no cobra ni mueve dinero. ' +
    'Envía la foto de tu comprobante para continuar con la demo.',
  confirmacion: 'Pago verificado (SIMULADO — demostración, sin cobro real).',
};

// -----------------------------------------------------------------------------
// VALIDACIÓN
// -----------------------------------------------------------------------------
// Cada texto tiene que delatarse solo, sin depender del contexto ni de que el
// cliente vea la imagen. Se exige la MARCA, no una redacción concreta: la
// redacción puede mejorarse, la marca no puede faltar.
const EXIGENCIAS = {
  rotuloSuperior: [/DEMOSTRACI[ÓO]N/i, /NO\s+COBRA/i],
  rotuloInferior: [/SIMULACRO|SIMULAD/i],
  epigrafe: [/SIMULAD/i, /DEMOSTRACI[ÓO]N/i],
  confirmacion: [/SIMULAD/i],
};

// CLAUDE.md: español boliviano SIN voseo. Solo se aplica a lo que lee el
// cliente; los rótulos impresos son sustantivos y no tienen verbo conjugado.
// El cierre NO puede ser `\b`: en JavaScript `á` no es carácter de palabra, así
// que entre «á» y un espacio no hay frontera y la expresión no coincide NUNCA.
// Se cierra con un lookahead negativo de letras, acentuadas incluidas.
//
// Y la terminación se separa por conjugación para no marcar pasados legítimos:
// en los verbos -ar el voseo termina en «á» (enviá) mientras que «envié» es
// primera persona del pasado y es correcto; en los -er termina en «é»
// (respondé) y el pasado va con «í» (respondí), así que ahí no hay ambigüedad.
const VOSEO = new RegExp(
  '\\b(?:' +
    '(?:envi|mand|avis|confirm|mir|pas|dej|prob|escane|agend|reserv|llam|habl|cancel)á' +
    '|(?:respond|ten|hac|corr|volv|pon|le)é' +
    '|(?:ten|quer|pod|sab)és' +
  ')(?![a-záéíóúüñ])',
  'i',
);
const AL_CLIENTE = ['epigrafe', 'confirmacion'];

export function validar(textos) {
  const problemas = [];
  for (const [clave, exigidas] of Object.entries(EXIGENCIAS)) {
    const valor = textos[clave];
    if (typeof valor !== 'string' || valor.trim() === '') {
      problemas.push(`${clave}: vacío — un rótulo ausente es un cobro sin rotular`);
      continue;
    }
    for (const re of exigidas) {
      if (!re.test(valor)) problemas.push(`${clave}: no contiene ${re}`);
    }
  }
  for (const clave of AL_CLIENTE) {
    const m = VOSEO.exec(textos[clave] ?? '');
    if (m) problemas.push(`${clave}: voseo «${m[0]}» — el estilo es tuteo boliviano`);
  }
  return problemas;
}

// -----------------------------------------------------------------------------
// COHERENCIA CON LA IMAGEN
// -----------------------------------------------------------------------------
// Los rótulos afirman lo que la imagen muestra. No se puede leer el PNG desde
// acá, pero sí comprobar que sigue siendo el mismo archivo que se revisó: si
// alguien lo reemplaza por un QR sin rótulo, esto avisa. El fallo NO frena la
// carga —el texto puede cargarse antes que la imagen definitiva—, pero se dice.
const QR = '../../Demo-Recursos/qr-demo.png';
function huellaDelQr() {
  try {
    const b = readFileSync(new URL(QR, import.meta.url));
    return `${b.length} bytes`;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Ejecución
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// FALLAS ESPERABLES
// -----------------------------------------------------------------------------
// Las tres formas en que esto no funciona --API apagada, base sin crear, sin
// credenciales-- NO son defectos: son estados normales de un proyecto que
// todavia no se termino de armar. Escupir la traza cruda del SDK por cualquiera
// de ellas convierte un "falta un paso" en "algo se rompio", que es justo la
// lectura equivocada. Cada una se traduce a una linea y al comando que la
// resuelve.
export function explicar(e, proyecto) {
  const texto = `${e?.code ?? ''} ${e?.message ?? e}`;
  const det = JSON.stringify(e?.errorInfoMetadata ?? e?.details ?? '');

  if (/SERVICE_DISABLED/.test(texto + det) || /has not been used in project/.test(texto)) {
    return ['La API de Cloud Firestore esta apagada en este proyecto.',
            `  gcloud services enable firestore.googleapis.com --project=${proyecto}`,
            '  Despues hay que CREAR la base, que es un paso aparte.'];
  }
  if (/NOT_FOUND/.test(texto) || e?.code === 5) {
    return ['El proyecto no tiene ninguna base de Firestore creada.',
            `  gcloud firestore databases create --location=southamerica-east1 --project=${proyecto}`,
            '  OJO: la region es PERMANENTE. Google no deja mover una base despues.'];
  }
  if (/UNAUTHENTICATED/.test(texto) || /Could not load the default credentials/.test(texto)) {
    return ['No hay credenciales por defecto para el SDK Admin.',
            '  gcloud auth application-default login'];
  }
  if (/PERMISSION_DENIED/.test(texto) || e?.code === 7) {
    return ['La cuenta autenticada no puede escribir en Firestore de este proyecto.',
            '  Hace falta el rol roles/datastore.user sobre ' + proyecto];
  }
  return [`Fallo no previsto: ${e?.message ?? e}`];
}

// Importado desde una prueba, este archivo NO debe ejecutar nada: solo expone
// TEXTOS y validar(). Sin este guard, importarlo dispararia la carga entera.
const ESTE = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (!ESTE) { /* importado como modulo */ } else {

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const EMULADOR = args.includes('--emulador');
const iProy = args.indexOf('--proyecto');
const PROYECTO = iProy >= 0 ? args[iProy + 1] : null;

const problemas = validar(TEXTOS);

console.log('\nTextos de /plataforma/cobroSimulado\n');
for (const [k, v] of Object.entries(TEXTOS)) console.log(`  ${k}\n      ${v}`);

const huella = huellaDelQr();
console.log(`\n  imagen rotulada: ${huella ? `${QR} (${huella})` : 'NO ENCONTRADA'}`);

console.log('\nValidación');
if (problemas.length) {
  for (const p of problemas) console.log(`  ✗ ${p}`);
  console.error('\nNEGADO: no se escribe un rótulo que no se delate a sí mismo.\n');
  process.exit(1);
}
console.log('  ✓ los cuatro textos llevan su marca y están en tuteo');

if (!APLICAR) {
  console.log('\nSeco: no se abrió ninguna conexión ni se escribió nada.');
  console.log('  al emulador:  node scripts/cargar-plataforma.mjs --emulador --aplicar');
  console.log('  a un proyecto: node scripts/cargar-plataforma.mjs --proyecto <id> --aplicar\n');
  process.exit(0);
}

if (!EMULADOR && !PROYECTO) {
  console.error('\nNEGADO: --aplicar exige --emulador o --proyecto <id>.');
  console.error('El SDK Admin se salta las reglas: el destino se nombra a mano.\n');
  process.exit(1);
}

const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

let destino;
if (EMULADOR) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8232';
  destino = process.env.PROYECTO_EMULADOR ?? 'demo-novuchat-panel';
  console.log(`\nDestino: EMULADOR ${process.env.FIRESTORE_EMULATOR_HOST} · ${destino}`);
} else {
  // Un host de emulador colgado en el entorno mandaría a un proyecto real a la
  // base equivocada, en silencio. Se corta antes.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('\nNEGADO: hay FIRESTORE_EMULATOR_HOST y se pidió un proyecto real.');
    console.error('Limpie la variable o use --emulador.\n');
    process.exit(1);
  }
  destino = PROYECTO;
  console.log(`\nDestino: PROYECTO REAL ${destino}`);
}

initializeApp({ projectId: destino });
const db = getFirestore();

// `merge: true` e identificador fijo: correrlo dos veces deja el mismo estado.
let escrito;
try {
  await db.doc('plataforma/cobroSimulado').set(
    { ...TEXTOS, actualizado: FieldValue.serverTimestamp() },
    { merge: true },
  );
  escrito = (await db.doc('plataforma/cobroSimulado').get()).data() ?? {};
} catch (e) {
  const [linea, ...pasos] = explicar(e, destino);
  console.error(`\n✗ No se escribio nada. ${linea}`);
  for (const paso of pasos) console.error(paso);
  console.error('\nLos textos son validos: lo unico que falta es el destino.\n');
  process.exit(1);
}

const iguales = Object.entries(TEXTOS).every(([k, v]) => escrito[k] === v);
console.log(iguales
  ? '\n✓ Escrito y releído: los cuatro textos coinciden.\n'
  : '\n✗ Se escribió pero la relectura NO coincide. Revíselo.\n');
process.exit(iguales ? 0 : 1);

} // fin del guard de modulo principal
