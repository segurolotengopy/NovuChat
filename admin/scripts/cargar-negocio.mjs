/**
 * CARGAR LA CONFIGURACIÓN DE UN COMERCIO EN LA CONSOLA, DESDE UN JSON.
 *
 * POR QUÉ EXISTE. El alta de un cliente deja la ficha (`alta-comercio.mjs`) y
 * el número (`asignar-numero.mjs`), pero lo que el asistente AFIRMA —quién es
 * el negocio, dónde queda, qué ofrece, a qué precio, quién atiende y con qué
 * agenda— hay que cargarlo después. La consola no tiene pantalla para el
 * horario ni una forma de cargar de una vez negocio + catálogo + agendas;
 * `sembrar-demos.mjs` solo sabe de los dos demos y `cargar-captacion.mjs` solo
 * de `/config/onboarding`. Se descubrió el 15/09/2026 preparando el demo de
 * Clínica Platinum: sin esto, el alta se hacía a mano, pantalla por pantalla,
 * y no se podía repetir.
 *
 * QUÉ ESCRIBE, en UNA transacción, desde un archivo versionado y revisable
 * (`datos/negocio-<id>.json`):
 *   - `config/negocio`: SOLO las claves que trae la sección `negocio`, cada una
 *     reemplazada entera (`mergeFields`: una lista vieja no se mezcla con la
 *     nueva; lo que el archivo no trae queda como estaba);
 *   - `config/agendamiento`: igual, desde la sección `agendamiento`;
 *   - cada ítem de `catalogo` en `catalogo/{idDe(nombre)}` (misma `idDe` que
 *     `sembrar-demos.mjs`);
 *   - cada funcionario en `funcionarios/{id}`, con `horarioTrabajo` = los
 *     horarios del negocio del mismo archivo;
 *   - `contadores/catalogo`, EN LA MISMA TRANSACCIÓN que el catálogo (ver
 *     abajo);
 *   - el sello `actualizadoPor: 'cargar-negocio'` en todo, y una entrada en
 *     `auditoria`;
 *   - si la sección `negocio` trae `instruccionesExtra`, TAMBIÉN
 *     `instruccionesVigentes` (el mismo texto) e `instruccionesRevision`
 *     aprobada con `revisadoPor: 'cargar-negocio'`: ese texto lo revisó
 *     NovuChat, y el flujo solo lee lo vigente (`functions/src/comportamiento.ts`).
 *     Antes de escribirlo pasa por la MISMA capa de patrones que la Function:
 *     lo que NovuChat carga tiene que poder editarse después desde la consola
 *     sin que la capa 1 lo rechace por un carácter que puso NovuChat.
 *   Los ítems y funcionarios que ya existen y el archivo no nombra NO se tocan:
 *   se informan. Retirar es una decisión de la consola, no de una carga.
 *
 * EL CONTADOR DEL CATÁLOGO VIAJA CON EL CATÁLOGO. Corregido el 17/09/2026.
 * Este script escribía los ítems con el SDK Admin y NO tocaba
 * `tenants/{t}/contadores/catalogo`, que es lo que hace cumplir el límite de
 * productos por plan (CLAUDE.md, base comercial §7). Las reglas NIEGAN crear y
 * borrar productos desde el navegador si ese contador falta o no cuadra, así
 * que todo comercio cargado con este script nacía descuadrado y había que
 * arreglarlo después a mano con `contar-catalogo.mjs`: pasó con los cuatro
 * comercios que ya estaban cargados. Ahora, cuando el archivo trae la sección
 * `catalogo`, la misma transacción que escribe los ítems deja el contador en
 * el número REAL de productos del comercio —los documentos de la colección,
 * que es lo que cuentan las reglas, no los que tienen `activo: true`— con el
 * criterio compartido de `lib/contador-catalogo.mjs`. Sin sección `catalogo`
 * no se toca: esta carga no cambió cuántos productos hay, y reconciliar un
 * contador ajeno es trabajo de `contar-catalogo.mjs`.
 *
 * NO BORRA NADA si el comercio queda por encima del límite de su plan: se
 * informa y el contador queda en la verdad, igual que en `contar-catalogo.mjs`.
 * Un contador mentiroso hacia abajo le regalaría cupo; hacia arriba se lo
 * quitaría.
 *
 * EL SDK ADMIN SE SALTA LAS REGLAS. Por eso este script valida el JSON con el
 * MISMO contrato que `firestore.rules` (`configNegocioValida`,
 * `configAgendamientoValida`, `itemValido`, `funcionarioValido`,
 * `calendarioValido`, `horarioDiaValido`): largos, enumerados, formato de los
 * siete días, teléfono `^[0-9]{8,15}$`, calendario de 64 hexadecimales exactos
 * o correo. Rechaza cualquier clave fuera del contrato —igual que las reglas—
 * y además lo que las reglas no pueden mirar: que cada servicio de un
 * funcionario exista en el catálogo del mismo archivo. Y exige que el comercio
 * exista, esté activo y —para `agendamiento` y `funcionarios`— tenga el flujo
 * `agendamiento` en `flujos`.
 *
 * REPOSITORIO PÚBLICO: el número de recepción y los calendarios NO van en el
 * JSON. Van como marcadores (`numeroRecepcionMarcador`, `calendarioMarcador`)
 * que se resuelven contra la tabla de `CONFIGURACION.local.md` (ignorado por
 * git), la MISMA que usan `preparar-import.sh` y `sembrar-demos.mjs`: si la
 * consola leyera su propia copia, las dos se separarían en la primera
 * corrección. Un marcador que no está en la tabla: en seco se avisa en rojo y
 * se sigue; con `--aplicar` se niega.
 *
 *   node scripts/cargar-negocio.mjs --proyecto <id> --tenant platinum \
 *     --archivo scripts/datos/negocio-platinum.json \
 *     [--local <ruta a CONFIGURACION.local.md>]                # en seco
 *   ... --aplicar                                              # escribe
 *
 * Sin `--aplicar` no escribe nada: dice qué cambiaría, con conteos y nombres
 * de campos, nunca los textos largos ni un identificador completo (el número
 * de recepción y los calendarios, solo por sus últimos cuatro). Las claves que
 * empiezan con `_` (p. ej. `_fuente`, `horarios._nota`) son notas del archivo
 * y no se escriben.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opcion = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const APLICAR = args.includes('--aplicar');

// El mismo filtro y el mismo hash que la Function `verificarComportamiento`: el
// módulo es puro y Node 22.18+ lo carga sin compilar, como `planes.ts`.
const { hashCorto, verificarPatrones } = await import('../functions/src/comportamiento.ts');

const PROYECTO = opcion('proyecto');
const TENANT = (opcion('tenant') ?? '').toLowerCase();
const ARCHIVO = opcion('archivo');
// Por defecto, la tabla de la raíz del repositorio, como `sembrar-demos.mjs`.
// Desde un worktree hay que apuntar a la de la carpeta principal con `--local`.
const LOCAL = opcion('local') ?? new URL('../../CONFIGURACION.local.md', import.meta.url).pathname;

const rojo = (s) => `\x1b[1;31m${s}\x1b[0m`;
const cola = (v) => (v ? `…${String(v).slice(-4)}` : '—');

// Mismo formato que `ID_TENANT` en functions/src/index.ts.
const ID_TENANT = /^[a-z0-9][a-z0-9-]{2,59}$/;
const ID_DOC = /^[a-z0-9][a-z0-9-]{0,59}$/;
const MARCADOR = /^REEMPLAZAR_[A-Z0-9_]+$/;

// --- EL CONTRATO -------------------------------------------------------------
// El mismo que las funciones de validación de firestore.rules. Si cambia allá,
// cambia acá: `pruebas/cargar-negocio.test.ts` lo ejercita.
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const TRATAMIENTOS = new Set(['usted', 'tu', 'vos', 'neutro']);
const EMOJIS = new Set(['ninguno', 'pocos', 'muchos']);
const ZONAS = new Set(['America/La_Paz']);
const MONEDAS = new Set(['BOB', 'USD']);
const PALETAS = new Set(['terracota', 'bosque', 'indigo', 'vino', 'oceano']);
const TELEFONO = /^[0-9]{8,15}$/;
// `horarioDiaValido`: «cerrado» o HH:MM-HH:MM con desde < hasta (mismo largo,
// se compara como texto, igual que en las reglas).
const RANGO_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$/;
// `urlImagenValida`: https y nada más.
const URL_HTTPS = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~/?#=&%-]*)?$/;
// `enlaceDeMapaValido`: la MISMA lista cerrada de dominios de mapas de Google
// que las reglas y que `prompt.ts`. El asistente reenvía este enlace tal cual
// al cliente, por eso no es texto libre (Analisis/34 §2).
const ENLACE_MAPA = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.com\/maps|google\.com\/maps|maps\.google\.com)([/?][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;

// Claves que este script acepta en cada sección. Las de marcador se resuelven
// al campo real antes de escribir; el sello lo pone el script y por eso NO se
// acepta en el archivo.
const CLAVES_NEGOCIO = new Set([
  'nombreNegocio', 'descripcion', 'direccion', 'direccionMaps', 'ubicacion',
  'numeroRecepcion', 'numeroRecepcionMarcador',
  'zonaHoraria', 'moneda', 'calendarioId', 'calendarioMarcador',
  'horarios', 'politicaCancelacion', 'prefijosPermitidos', 'datosQueNoTenemos',
  'tratamiento', 'estiloEmojis', 'nombreAsistente',
  'mensajes', 'mensajeCierre', 'mensajeErrorTemporal', 'mensajeReservaNoConfirmada',
  'mensajeComercioSuspendido', 'instruccionesExtra', 'catalogoWebActivo', 'paleta',
]);
const CLAVES_AGENDAMIENTO = new Set([
  'duracionPorDefectoMin', 'anticipacionMinimaMin', 'anticipacionMaximaDias',
  'permitirCancelacion', 'horasRecordatorio', 'mensajeRecordatorio',
  // Seña por QR (bloque 2): importe entero (0 = sin seña) y minutos de
  // retención del horario. Mismos rangos que `configAgendamientoValida`.
  // `cobroReal` NO está: lo escribe solo `registrarQrDeCobro`, desde la consola.
  'senaImporte', 'senaMinutosRetencion',
]);
const CLAVES_ITEM = new Set(['nombre', 'descripcion', 'area', 'precio', 'moneda', 'duracionMin', 'activo', 'imagenUrl']);
const CLAVES_FUNCIONARIO = new Set(['id', 'nombre', 'especialidad', 'calendarioId', 'calendarioMarcador', 'servicios', 'activo']);
const SECCIONES = new Set(['negocio', 'agendamiento', 'catalogo', 'funcionarios']);

/**
 * `calendarioValido` de las reglas, con sus dos trampas: 64 hexadecimales
 * EXACTOS, y lo que termina en `@group.calendar.google.com` se juzga solo con
 * la regla estricta, sin caer en la forma de correo.
 */
const calendarioValido = (v) => typeof v === 'string'
  && (/^[0-9a-fA-F]{64}@group\.calendar\.google\.com$/.test(v)
    || (!/@group\.calendar\.google\.com$/.test(v)
      && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/.test(v)));

/** Misma `idDe` que `sembrar-demos.mjs`: el identificador del ítem sale del nombre. */
const idDe = (nombre) => nombre.toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esTexto = (v, max, { vacio = true } = {}) =>
  typeof v === 'string' && v.length <= max && (vacio || v.trim().length > 0);
const esEntero = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Devuelve la lista de problemas del JSON; vacía si cumple el contrato. */
function validar(d) {
  const p = [];
  if (!esObjeto(d)) return ['el archivo no es un objeto JSON'];
  for (const k of Object.keys(d)) {
    if (!k.startsWith('_') && !SECCIONES.has(k)) p.push(`sección desconocida: «${k}» (no está en el contrato; no se escribe nada)`);
  }
  const soloClaves = (obj, permitidas, donde) => {
    for (const k of Object.keys(obj)) {
      if (k.startsWith('_')) continue;
      if (!permitidas.has(k)) p.push(`${donde}: clave desconocida «${k}»`);
    }
  };
  const texto = (obj, k, max, donde, opts) => {
    if (k in obj && !esTexto(obj[k], max, opts)) {
      p.push(`${donde}.${k}: texto de ${opts?.vacio === false ? '1 a' : 'hasta'} ${max} caracteres (tiene ${String(obj[k] ?? '').length})`);
    }
  };
  const marcador = (obj, k, donde) => {
    if (k in obj && !(typeof obj[k] === 'string' && MARCADOR.test(obj[k]))) p.push(`${donde}.${k}: un marcador REEMPLAZAR_… de CONFIGURACION.local.md`);
  };

  // --- negocio (configNegocioValida) ---
  if ('negocio' in d) {
    const n = d.negocio;
    if (!esObjeto(n)) p.push('negocio: tiene que ser un objeto');
    else {
      soloClaves(n, CLAVES_NEGOCIO, 'negocio');
      if (!Object.keys(n).some((k) => !k.startsWith('_'))) p.push('negocio: no trae ningún campo');
      texto(n, 'nombreNegocio', 80, 'negocio', { vacio: false });
      texto(n, 'descripcion', 400, 'negocio');
      texto(n, 'direccion', 200, 'negocio');
      // `enlaceDeMapaValido`: vacío, o https:// de un dominio de mapas de Google.
      if ('direccionMaps' in n && !(typeof n.direccionMaps === 'string' && n.direccionMaps.length <= 200
          && (n.direccionMaps === '' || ENLACE_MAPA.test(n.direccionMaps)))) {
        p.push('negocio.direccionMaps: vacío o un enlace https:// de Google Maps (maps.app.goo.gl, goo.gl/maps, google.com/maps, maps.google.com), hasta 200 caracteres');
      }
      // `ubicacionValida`: exactamente lat y lng, números en rango. Las notas
      // (`_…`) se toleran y no se escriben, como en `horarios`.
      if ('ubicacion' in n) {
        const u = n.ubicacion;
        const claves = esObjeto(u) ? Object.keys(u).filter((k) => !k.startsWith('_')).sort() : null;
        const coordenada = (v, max) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max;
        if (!(claves && claves.join(',') === 'lat,lng' && coordenada(u.lat, 90) && coordenada(u.lng, 180))) {
          p.push('negocio.ubicacion: objeto con exactamente lat (-90 a 90) y lng (-180 a 180), como números');
        }
      }
      if ('numeroRecepcion' in n && 'numeroRecepcionMarcador' in n) p.push('negocio: numeroRecepcion y numeroRecepcionMarcador a la vez; uno solo');
      if ('numeroRecepcion' in n && !(typeof n.numeroRecepcion === 'string' && TELEFONO.test(n.numeroRecepcion))) p.push('negocio.numeroRecepcion: solo dígitos, 8 a 15, sin «+»');
      marcador(n, 'numeroRecepcionMarcador', 'negocio');
      if ('calendarioId' in n && 'calendarioMarcador' in n) p.push('negocio: calendarioId y calendarioMarcador a la vez; uno solo');
      if ('calendarioId' in n && n.calendarioId !== '' && !calendarioValido(n.calendarioId)) p.push('negocio.calendarioId: 64 hexadecimales + @group.calendar.google.com, o un correo');
      marcador(n, 'calendarioMarcador', 'negocio');
      if ('zonaHoraria' in n && !ZONAS.has(n.zonaHoraria)) p.push(`negocio.zonaHoraria: una de ${[...ZONAS].join(', ')}`);
      if ('moneda' in n && !MONEDAS.has(n.moneda)) p.push('negocio.moneda: BOB o USD');
      if ('horarios' in n) {
        const h = n.horarios;
        if (!esObjeto(h)) p.push('negocio.horarios: tiene que ser un objeto con los siete días');
        else {
          for (const k of Object.keys(h)) if (!k.startsWith('_') && !DIAS.includes(k)) p.push(`negocio.horarios: día desconocido «${k}»`);
          for (const dia of DIAS) {
            const v = h[dia];
            // Las reglas toman un día ausente como «cerrado»; acá se exige
            // escribirlo: en un archivo de carga, un día que falta es más
            // probablemente un olvido que un cierre.
            if (v === undefined) { p.push(`negocio.horarios.${dia}: falta (escriba «cerrado» si no atiende)`); continue; }
            const ok = v === 'cerrado' || (typeof v === 'string' && RANGO_HORA.test(v) && v.split('-')[0] < v.split('-')[1]);
            if (!ok) p.push(`negocio.horarios.${dia}: «cerrado» o HH:MM-HH:MM con inicio antes que fin`);
          }
        }
      }
      texto(n, 'politicaCancelacion', 600, 'negocio');
      if ('prefijosPermitidos' in n && !(Array.isArray(n.prefijosPermitidos) && n.prefijosPermitidos.length <= 10
          && n.prefijosPermitidos.every((x) => typeof x === 'string' && /^[0-9]{1,4}$/.test(x)))) {
        p.push('negocio.prefijosPermitidos: lista de hasta 10 prefijos numéricos');
      }
      if ('datosQueNoTenemos' in n && !(Array.isArray(n.datosQueNoTenemos) && n.datosQueNoTenemos.length <= 20
          && n.datosQueNoTenemos.every((x) => esTexto(x, 80, { vacio: false })))) {
        p.push('negocio.datosQueNoTenemos: lista de hasta 20 textos de 1 a 80 caracteres');
      }
      if ('tratamiento' in n && !TRATAMIENTOS.has(n.tratamiento)) p.push(`negocio.tratamiento: uno de ${[...TRATAMIENTOS].join(', ')}`);
      if ('estiloEmojis' in n && !EMOJIS.has(n.estiloEmojis)) p.push(`negocio.estiloEmojis: uno de ${[...EMOJIS].join(', ')}`);
      texto(n, 'nombreAsistente', 40, 'negocio');
      if (typeof n.nombreAsistente === 'string' && /[\r\n]/.test(n.nombreAsistente)) p.push('negocio.nombreAsistente: una sola línea');
      if ('mensajes' in n && !(esObjeto(n.mensajes) && Object.values(n.mensajes).every((x) => esTexto(x, 300)))) {
        p.push('negocio.mensajes: objeto de textos de hasta 300 caracteres');
      }
      for (const k of ['mensajeCierre', 'mensajeErrorTemporal', 'mensajeReservaNoConfirmada', 'mensajeComercioSuspendido']) texto(n, k, 300, 'negocio');
      texto(n, 'instruccionesExtra', 1500, 'negocio');
      if (typeof n.instruccionesExtra === 'string') {
        const patrones = verificarPatrones(n.instruccionesExtra);
        if (patrones.nivel === 'rechazado') p.push(`negocio.instruccionesExtra: ${patrones.motivo}`);
      }
      if ('catalogoWebActivo' in n && typeof n.catalogoWebActivo !== 'boolean') p.push('negocio.catalogoWebActivo: true o false');
      if ('paleta' in n && !PALETAS.has(n.paleta)) p.push(`negocio.paleta: una de ${[...PALETAS].join(', ')}`);
    }
  }

  // --- agendamiento (configAgendamientoValida) ---
  if ('agendamiento' in d) {
    const a = d.agendamiento;
    if (!esObjeto(a)) p.push('agendamiento: tiene que ser un objeto');
    else {
      soloClaves(a, CLAVES_AGENDAMIENTO, 'agendamiento');
      if ('duracionPorDefectoMin' in a && !esEntero(a.duracionPorDefectoMin, 1, 480)) p.push('agendamiento.duracionPorDefectoMin: entero de 1 a 480');
      if ('anticipacionMinimaMin' in a && !esEntero(a.anticipacionMinimaMin, 0, 10080)) p.push('agendamiento.anticipacionMinimaMin: entero de 0 a 10080');
      if ('anticipacionMaximaDias' in a && !esEntero(a.anticipacionMaximaDias, 1, 365)) p.push('agendamiento.anticipacionMaximaDias: entero de 1 a 365');
      if ('permitirCancelacion' in a && typeof a.permitirCancelacion !== 'boolean') p.push('agendamiento.permitirCancelacion: true o false');
      if ('horasRecordatorio' in a && !esEntero(a.horasRecordatorio, 0, 168)) p.push('agendamiento.horasRecordatorio: entero de 0 a 168');
      texto(a, 'mensajeRecordatorio', 400, 'agendamiento');
      if ('senaImporte' in a && !esEntero(a.senaImporte, 0, 10000)) p.push('agendamiento.senaImporte: entero de 0 a 10000 (0 = sin seña)');
      if ('senaMinutosRetencion' in a && !esEntero(a.senaMinutosRetencion, 5, 180)) p.push('agendamiento.senaMinutosRetencion: entero de 5 a 180');
    }
  }

  // --- catalogo (itemValido) ---
  const idsCatalogo = new Set();
  if ('catalogo' in d) {
    if (!Array.isArray(d.catalogo)) p.push('catalogo: tiene que ser una lista');
    else d.catalogo.forEach((it, i) => {
      const donde = `catalogo[${i}]`;
      if (!esObjeto(it)) { p.push(`${donde}: tiene que ser un objeto`); return; }
      soloClaves(it, CLAVES_ITEM, donde);
      if (!esTexto(it.nombre, 80, { vacio: false })) p.push(`${donde}.nombre: texto de 1 a 80 caracteres`);
      else {
        const id = idDe(it.nombre);
        if (!id) p.push(`${donde}.nombre: no produce un identificador`);
        else if (idsCatalogo.has(id)) p.push(`${donde}.nombre: «${it.nombre}» repite el identificador ${id}`);
        else idsCatalogo.add(id);
      }
      texto(it, 'descripcion', 300, donde);
      texto(it, 'area', 40, donde);
      if ('precio' in it && it.precio !== null && !(typeof it.precio === 'number' && Number.isFinite(it.precio) && it.precio >= 0 && it.precio <= 1000000)) {
        p.push(`${donde}.precio: ausente (a consultar) o número de 0 a 1000000`);
      }
      if ('moneda' in it && !MONEDAS.has(it.moneda)) p.push(`${donde}.moneda: BOB o USD`);
      if ('duracionMin' in it && !(esEntero(it.duracionMin, 1, 1440) && it.duracionMin % 15 === 0)) p.push(`${donde}.duracionMin: entero de 15 a 1440, múltiplo de 15`);
      if (typeof it.activo !== 'boolean') p.push(`${donde}.activo: true o false (obligatorio)`);
      if ('imagenUrl' in it && it.imagenUrl !== '' && !(typeof it.imagenUrl === 'string' && it.imagenUrl.length <= 500 && URL_HTTPS.test(it.imagenUrl))) p.push(`${donde}.imagenUrl: una dirección https://`);
    });
  }

  // --- funcionarios (funcionarioValido, más lo que las reglas no pueden mirar) ---
  if ('funcionarios' in d) {
    if (!Array.isArray(d.funcionarios)) p.push('funcionarios: tiene que ser una lista');
    else {
      if (d.funcionarios.length > 50) p.push(`funcionarios: ${d.funcionarios.length}, el máximo es 50`);
      if (d.funcionarios.length && !esObjeto(d.negocio?.horarios)) p.push('funcionarios: exigen negocio.horarios en el mismo archivo (es su horarioTrabajo)');
      const ids = new Set();
      d.funcionarios.forEach((f, i) => {
        const donde = `funcionarios[${i}]`;
        if (!esObjeto(f)) { p.push(`${donde}: tiene que ser un objeto`); return; }
        soloClaves(f, CLAVES_FUNCIONARIO, donde);
        if (!(typeof f.id === 'string' && ID_DOC.test(f.id))) p.push(`${donde}.id: minúsculas, dígitos y guiones, 1 a 60`);
        else if (ids.has(f.id)) p.push(`${donde}.id: «${f.id}» repetido`);
        else ids.add(f.id);
        if (!esTexto(f.nombre, 120, { vacio: false })) p.push(`${donde}.nombre: texto de 1 a 120 caracteres`);
        texto(f, 'especialidad', 80, donde);
        if ('calendarioId' in f && 'calendarioMarcador' in f) p.push(`${donde}: calendarioId y calendarioMarcador a la vez; uno solo`);
        if ('calendarioId' in f && f.calendarioId !== '' && !calendarioValido(f.calendarioId)) p.push(`${donde}.calendarioId: 64 hexadecimales + @group.calendar.google.com, o un correo`);
        marcador(f, 'calendarioMarcador', donde);
        if ('servicios' in f) {
          if (!(Array.isArray(f.servicios) && f.servicios.length <= 50 && f.servicios.every((s) => typeof s === 'string'))) {
            p.push(`${donde}.servicios: lista de hasta 50 identificadores del catálogo`);
          } else {
            // Las reglas solo miran tipo y tamaño; una referencia colgada la
            // descarta la Function en silencio, y el asistente no ofrecería
            // ese servicio sin que nadie sepa por qué. Acá se frena antes.
            for (const s of f.servicios) if (!idsCatalogo.has(s)) p.push(`${donde}.servicios: «${s}» no está en el catálogo de este archivo`);
          }
        }
        if (typeof f.activo !== 'boolean') p.push(`${donde}.activo: true o false (obligatorio)`);
      });
    }
  }
  return p;
}

/**
 * Tabla de marcadores de `CONFIGURACION.local.md`. Copia de `leerMarcadores`
 * de `sembrar-demos.mjs` (aquél la lee de una ruta fija; acá la ruta se puede
 * pasar con `--local`, porque desde un worktree la tabla vive en la carpeta
 * principal). Mismo formato de fila: | `REEMPLAZAR_X` | valor | … |
 */
function leerMarcadores(ruta) {
  try {
    const texto = readFileSync(ruta, 'utf8');
    const tabla = {};
    for (const m of texto.matchAll(/^\|\s*`(REEMPLAZAR_[^`]*)`\s*\|([^|]*)\|/gm)) {
      const valor = m[2].trim().replace(/^`|`$/g, '').trim();
      if (valor && !/pendiente/i.test(valor)) tabla[m[1]] = valor;
    }
    return tabla;
  } catch {
    return null;
  }
}

/** Quita las notas (`_…`) de un objeto, un nivel. */
const sinNotas = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('_')));

// --- argumentos y archivo ----------------------------------------------------
const problemasArgs = [];
if (!PROYECTO) problemasArgs.push('falta --proyecto');
if (!ID_TENANT.test(TENANT)) problemasArgs.push('--tenant inválido (minúsculas, guiones, 3 a 60)');
if (!ARCHIVO) problemasArgs.push('falta --archivo');
if (problemasArgs.length) {
  console.error('\n  ✗ ' + problemasArgs.join('\n  ✗ '));
  console.error('\n  node scripts/cargar-negocio.mjs --proyecto <id> --tenant <id> --archivo <json> [--local <CONFIGURACION.local.md>] [--aplicar]\n');
  process.exit(2);
}

let datos;
try {
  datos = JSON.parse(readFileSync(ARCHIVO, 'utf8'));
} catch (e) {
  console.error(`\n  ✗ No se pudo leer ${ARCHIVO} como JSON: ${e.message}\n`);
  process.exit(2);
}
const problemas = validar(datos);
if (problemas.length) {
  console.error(`\n  ✗ El archivo no cumple el contrato de la configuración del comercio (${problemas.length}):`);
  console.error('    - ' + problemas.join('\n    - '));
  console.error('\n  No se escribió nada.\n');
  process.exit(2);
}
const secciones = [...SECCIONES].filter((s) => s in datos);
if (!secciones.length) {
  console.error('\n  ✗ El archivo no trae ninguna sección que cargar (negocio, agendamiento, catalogo, funcionarios).\n');
  process.exit(2);
}

// --- marcadores -> valores reales ------------------------------------------
const marcas = leerMarcadores(LOCAL);
const sinResolver = [];
/** Devuelve el valor del marcador, o '' y lo anota como pendiente. */
function resolver(nombre, donde) {
  const v = marcas?.[nombre];
  if (v) return v;
  sinResolver.push(`${donde}: el marcador ${nombre} no está en ${LOCAL}`);
  return '';
}

// Lo que se va a escribir, ya sin notas y con los marcadores resueltos.
const negocio = 'negocio' in datos ? sinNotas(datos.negocio) : null;
if (negocio) {
  if ('horarios' in negocio) negocio.horarios = sinNotas(negocio.horarios);
  if ('ubicacion' in negocio) negocio.ubicacion = sinNotas(negocio.ubicacion);
  if ('numeroRecepcionMarcador' in negocio) {
    negocio.numeroRecepcion = resolver(negocio.numeroRecepcionMarcador, 'negocio.numeroRecepcion');
    delete negocio.numeroRecepcionMarcador;
  }
  if ('calendarioMarcador' in negocio) {
    negocio.calendarioId = resolver(negocio.calendarioMarcador, 'negocio.calendarioId');
    delete negocio.calendarioMarcador;
  }
}
const agendamiento = 'agendamiento' in datos ? sinNotas(datos.agendamiento) : null;
const catalogo = 'catalogo' in datos
  ? datos.catalogo.map((it) => ({ id: idDe(it.nombre), datos: sinNotas(it) })) : null;
const funcionarios = 'funcionarios' in datos
  ? datos.funcionarios.map((f) => {
    const { id, calendarioMarcador, ...resto } = sinNotas(f);
    const doc = { ...resto, horarioTrabajo: negocio.horarios };
    if (calendarioMarcador !== undefined) doc.calendarioId = resolver(calendarioMarcador, `funcionarios/${id}.calendarioId`);
    return { id, datos: doc };
  }) : null;

// Lo resuelto tiene que cumplir el mismo contrato que un valor escrito a mano:
// la tabla local también la editó una persona.
const problemasResueltos = [];
if (negocio?.numeroRecepcion && !TELEFONO.test(negocio.numeroRecepcion)) problemasResueltos.push('negocio.numeroRecepcion (resuelto): solo dígitos, 8 a 15, sin «+»');
if (negocio?.calendarioId && !calendarioValido(negocio.calendarioId)) problemasResueltos.push('negocio.calendarioId (resuelto): 64 hexadecimales exactos + sufijo, o un correo');
for (const f of funcionarios ?? []) {
  if (f.datos.calendarioId && !calendarioValido(f.datos.calendarioId)) problemasResueltos.push(`funcionarios/${f.id}.calendarioId (resuelto): 64 hexadecimales exactos + sufijo, o un correo`);
}
if (problemasResueltos.length) {
  console.error('\n  ✗ Un valor de la tabla local no cumple el contrato:');
  console.error('    - ' + problemasResueltos.join('\n    - '));
  console.error('\n  No se escribió nada.\n');
  process.exit(2);
}

console.log(`\n  Negocio   : ${TENANT}`);
console.log(`  Archivo   : ${ARCHIVO}`);
console.log(`  Tabla     : ${marcas ? `${LOCAL} (${Object.keys(marcas).length} marcadores)` : rojo(`${LOCAL} no se pudo leer`)}`);
console.log(`  Proyecto  : ${PROYECTO}\n`);

if (sinResolver.length) {
  for (const s of sinResolver) console.log(`  ${rojo('✗ sin resolver')} ${s}`);
  if (APLICAR) {
    console.error(`\n  ${rojo('NEGADO')}: con --aplicar todos los marcadores tienen que estar en la tabla local.`);
    console.error('  Agregue las filas | `REEMPLAZAR_…` | valor | … | y repita.\n');
    process.exit(2);
  }
  console.log('  (en seco se sigue con esos valores vacíos; con --aplicar se niega)\n');
}

// --- Firestore ---------------------------------------------------------------
const { initializeApp } = await import('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = await import('firebase-admin/firestore');
// El criterio del contador del catálogo, compartido con `contar-catalogo.mjs`.
const { CLAVES_CONTADOR, contarProductos, escribirContador, limiteDe } =
  await import('./lib/contador-catalogo.mjs');
initializeApp({ projectId: PROYECTO });
const db = getFirestore();

// CERRAR EL CLIENTE ANTES DE SALIR, Y NO ES CORTESÍA. Con `process.exit()` a
// secas la conexión se corta de golpe y el emulador conserva los bloqueos de
// la última transacción hasta que vencen (medido el 17/09: 60 s). La suite que
// corre después se queda esperando y falla con «Transaction lock timeout», que
// es un diagnóstico que no lleva a ninguna parte. `terminate()` cierra el
// cliente y libera todo; contra Firestore de verdad es igual de correcto.
const salir = async (codigo) => { await db.terminate().catch(() => {}); process.exit(codigo); };

const refTenant = db.doc(`tenants/${TENANT}`);
const refNegocio = db.doc(`tenants/${TENANT}/config/negocio`);
const refAgend = db.doc(`tenants/${TENANT}/config/agendamiento`);
const refItem = (id) => db.doc(`tenants/${TENANT}/catalogo/${id}`);
const refFunc = (id) => db.doc(`tenants/${TENANT}/funcionarios/${id}`);
const refContador = db.doc(`tenants/${TENANT}/contadores/catalogo`);
const refCuenta = db.doc(`tenants/${TENANT}/cuenta/estado`);
const colCatalogo = db.collection(`tenants/${TENANT}/catalogo`);

// Comparación que no depende del orden de las claves: Firestore no lo conserva.
const canonico = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const igual = (a, b) => canonico(a ?? null) === canonico(b ?? null);
const estadoDe = (actual, k, nuevo) => (!actual || !(k in actual) ? 'nuevo' : igual(actual[k], nuevo) ? 'igual' : 'cambia');
// Un ítem sin precio en el archivo y con precio guardado también «cambia»: el
// precio se borra (ver la escritura más abajo).
const estadoDoc = (doc, datos, { borraPrecio = false } = {}) => (!doc.exists ? 'nuevo'
  : Object.keys(datos).every((k) => igual(doc.get(k), datos[k]))
    && !(borraPrecio && !('precio' in datos) && doc.get('precio') !== undefined) ? 'igual' : 'cambia');

// Cómo se muestra cada campo en seco: conteos y formas, nunca el texto ni un
// identificador completo.
const resumen = {
  numeroRecepcion: (v) => (v ? `termina en ${cola(v)}` : rojo('vacío')),
  calendarioId: (v) => (v ? `termina en ${cola(v.split('@')[0])}` : rojo('vacío')),
  horarios: (v) => DIAS.map((d) => `${d} ${v[d]}`).join(' · '),
  prefijosPermitidos: (v) => v.join(', '),
  datosQueNoTenemos: (v) => `${v.length} elemento(s)`,
  mensajes: (v) => `${Object.keys(v).length} mensaje(s): ${Object.keys(v).join(', ')}`,
  tratamiento: (v) => v, estiloEmojis: (v) => v, zonaHoraria: (v) => v, moneda: (v) => v, paleta: (v) => v,
  nombreNegocio: (v) => `«${v}»`,
  nombreAsistente: (v) => (v ? `«${v}»` : '(vacío: el flujo usa su nombre genérico)'),
  // El enlace no es secreto, pero tampoco hace falta pegarlo entero: el dominio
  // dice si es de mapas, que es lo que se valida.
  direccionMaps: (v) => (v ? `enlace de ${new URL(v).host}` : '(vacío: el asistente da la dirección sin mapa)'),
  ubicacion: (v) => `lat ${v.lat}, lng ${v.lng} (pin de WhatsApp, solo si el cliente lo pide)`,
  instruccionesExtra: (v) => `${v.length} caracteres · queda VIGENTE y aprobado (revisado por NovuChat)`,
};
const mostrar = (k, v) => (resumen[k] ? resumen[k](v)
  : typeof v === 'string' ? `${v.length} caracteres`
    : typeof v === 'boolean' || typeof v === 'number' ? String(v) : JSON.stringify(v));

// Lo que ya existe y el archivo NO nombra se lee FUERA de la transacción, y es
// a propósito: es solo para informarlo, y una consulta de colección dentro de
// la transacción bloquea el rango entero y el emulador no deja después crear
// documentos nuevos en él («Transaction lock timeout» al confirmar).
const idsAjenos = async (col, propios) =>
  (await db.collection(`tenants/${TENANT}/${col}`).select().get()).docs.map((d) => d.id).filter((id) => !propios.has(id));
const ajenosCatalogo = catalogo ? await idsAjenos('catalogo', new Set(catalogo.map((it) => it.id))) : [];
const ajenosFunc = funcionarios ? await idsAjenos('funcionarios', new Set(funcionarios.map((f) => f.id))) : [];

let plan;
try {
  await db.runTransaction(async (tx) => {
    // Lecturas antes que escrituras, como exige la transacción; puntuales, por
    // identificador, para que la escritura de cada documento sea sobre algo
    // que la propia transacción leyó.
    const refsItems = (catalogo ?? []).map((it) => refItem(it.id));
    const refsFunc = (funcionarios ?? []).map((f) => refFunc(f.id));
    const leidos = await tx.getAll(refTenant, refNegocio, refAgend, refContador, refCuenta,
                                   ...refsItems, ...refsFunc);
    const [tenant, docNegocio, docAgend, docContador, docCuenta] = leidos;
    const docsItems = leidos.slice(5, 5 + refsItems.length);
    const docsFunc = leidos.slice(5 + refsItems.length);
    if (!tenant.exists) throw new Error(`No existe el comercio «${TENANT}». Primero alta-comercio.mjs.`);
    // Como las reglas: un comercio suspendido o dado de baja no se reconfigura.
    const estado = tenant.get('estado') ?? 'activo';
    if (estado !== 'activo') throw new Error(`«${TENANT}» está ${estado}: no se reconfigura.`);
    const flujos = tenant.get('flujos') ?? [tenant.get('vertical')].filter(Boolean);
    if ((agendamiento || funcionarios) && !flujos.includes('agendamiento')) {
      throw new Error(`«${TENANT}» no tiene el flujo agendamiento (flujos: ${JSON.stringify(flujos)}). `
        + 'Las secciones agendamiento y funcionarios se cargan solo en un comercio con ese flujo.');
    }
    // `configNegocioValida`: el catálogo web solo se enciende con el flujo de venta.
    if (negocio?.catalogoWebActivo === true && !flujos.includes('venta')) {
      throw new Error(`«${TENANT}» no tiene el flujo venta: catalogoWebActivo no puede ser true.`);
    }

    // EL CONTADOR, CONTADO ANTES DE ESCRIBIR. La consulta de colección es una
    // LECTURA de la transacción y por eso va acá, antes de todo `tx.set`:
    // devuelve cuántos productos había, y los que esta carga está por crear se
    // suman aparte (son los que `tx.getAll` trajo inexistentes). Si alguien da
    // un alta desde la consola en el medio, la transacción se reintenta y
    // vuelve a contar.
    //
    // Se cuentan los DOCUMENTOS, no los `activo: true`: es lo que cuentan las
    // reglas (`altaContada()` suma uno por documento que nace, mire o no
    // `activo`), y un producto dado de baja sigue ocupando cupo del plan.
    let contador = null;
    if (catalogo) {
      const antes = await contarProductos(tx, colCatalogo);
      const nuevos = catalogo.filter((_, i) => !docsItems[i].exists);
      const previo = docContador.get('ultimoItem');
      contador = {
        antes: docContador.exists ? docContador.get('items') : null,
        items: antes + nuevos.length,
        nuevos: nuevos.length,
        // El último que nace en ESTA carga; si no nace ninguno, se conserva lo
        // que decía. Ver `escribirContador` en la librería.
        ultimoItem: nuevos.at(-1)?.id ?? (typeof previo === 'string' ? previo : ''),
        ...limiteDe(docCuenta.exists ? docCuenta.data() : undefined),
      };
    }

    plan = {
      contador,
      flujos,
      negocio: negocio && {
        nuevo: !docNegocio.exists,
        campos: Object.keys(negocio).map((k) => ({ k, estado: estadoDe(docNegocio.data(), k, negocio[k]) })),
      },
      agendamiento: agendamiento && {
        nuevo: !docAgend.exists,
        campos: Object.keys(agendamiento).map((k) => ({ k, estado: estadoDe(docAgend.data(), k, agendamiento[k]) })),
      },
      catalogo: catalogo && {
        items: catalogo.map((it, i) => ({ ...it, estado: estadoDoc(docsItems[i], it.datos, { borraPrecio: true }) })),
        ajenos: ajenosCatalogo,
      },
      funcionarios: funcionarios && {
        items: funcionarios.map((f, i) => ({ ...f, estado: estadoDoc(docsFunc[i], f.datos) })),
        ajenos: ajenosFunc,
      },
    };
    if (!APLICAR) return;

    const ahora = Timestamp.now();
    const sello = { actualizadoPor: 'cargar-negocio', actualizadoEn: FieldValue.serverTimestamp() };
    const selloCampos = ['actualizadoPor', 'actualizadoEn'];
    if (negocio) {
      // EL COMPORTAMIENTO GENERAL QUEDA APROBADO EN LA MISMA ESCRITURA. El flujo
      // lee `instruccionesVigentes`, no `instruccionesExtra`; sin esto, el
      // comercio quedaría con el texto en la consola y el asistente sin él.
      // La Function ve la revisión con el hash del texto y no vuelve a
      // revisar (`hayQueRevisar`, verificarComportamiento.ts).
      const verificadas = typeof negocio.instruccionesExtra === 'string'
        ? {
            instruccionesVigentes: negocio.instruccionesExtra,
            instruccionesRevision: {
              estado: 'aprobado', motivo: 'texto cargado y revisado por NovuChat',
              hash: hashCorto(negocio.instruccionesExtra), capa: 'patrones',
              revisadoPor: 'cargar-negocio', revisadoEn: ahora,
            },
          }
        : {};
      tx.set(refNegocio, { ...negocio, ...verificadas, ...sello },
        { mergeFields: [...Object.keys(negocio), ...Object.keys(verificadas), ...selloCampos] });
    }
    if (agendamiento) {
      tx.set(refAgend, { ...agendamiento, ...sello }, { mergeFields: [...Object.keys(agendamiento), ...selloCampos] });
    }
    for (const it of catalogo ?? []) {
      // Con merge, un precio que el archivo YA NO trae quedaría escrito de la
      // carga anterior, y ausente significa «a consultar»: se borra a
      // propósito, con su moneda. Lo demás que la consola haya agregado
      // (foto, existencias) se conserva.
      const doc = { ...it.datos, ...sello };
      if (!('precio' in doc) || doc.precio === null) { doc.precio = FieldValue.delete(); doc.moneda = FieldValue.delete(); }
      tx.set(refItem(it.id), doc, { merge: true });
    }
    // En la MISMA transacción que los ítems: si una se escribe, la otra
    // también. Se reescribe aunque no nazca ningún producto —la carga puede
    // haber caído sobre un comercio sin contador, que es justamente el caso
    // que trababa la consola— y `set` sin `merge` limpia cualquier clave de
    // más, que la regla del contador no perdona.
    if (contador) escribirContador(tx, refContador, contador);
    for (const f of funcionarios ?? []) {
      tx.set(refFunc(f.id), { ...f.datos, ...sello }, { merge: true });
    }
    tx.create(db.collection(`tenants/${TENANT}/auditoria`).doc(), {
      accion: 'cargar_negocio', uid: 'cargar-negocio', en: ahora,
      secciones,
      campos: {
        ...(negocio ? { negocio: Object.keys(negocio) } : {}),
        ...(agendamiento ? { agendamiento: Object.keys(agendamiento) } : {}),
      },
      conteos: {
        ...(catalogo ? { catalogo: catalogo.length } : {}),
        ...(funcionarios ? { funcionarios: funcionarios.length } : {}),
      },
    });
  });
} catch (e) {
  console.error(`  ✗ ${e.message}\n`);
  await salir(1);
}

// --- el plan, en seco y en aplicado ------------------------------------------
console.log(`  Flujos del comercio: ${plan.flujos.join(', ')}`);
for (const [nombre, seccion, valores] of [['negocio', plan.negocio, negocio], ['agendamiento', plan.agendamiento, agendamiento]]) {
  if (!seccion) continue;
  console.log(`\n  config/${nombre}${seccion.nuevo ? ' (se crea)' : ''}:`);
  for (const { k, estado } of seccion.campos) console.log(`    ${estado.padEnd(6)} ${k.padEnd(27)} ${mostrar(k, valores[k])}`);
}
if (plan.catalogo) {
  console.log(`\n  catalogo (${plan.catalogo.items.length} ítem(s)):`);
  for (const it of plan.catalogo.items) {
    const d = it.datos;
    console.log(`    ${it.estado.padEnd(6)} ${it.id.padEnd(36)} ${d.area ?? '—'} · ${typeof d.precio === 'number' ? `${d.precio} ${d.moneda ?? 'BOB'}` : 'a consultar'}`
      + `${d.duracionMin ? ` · ${d.duracionMin} min` : ''} · ${d.activo ? 'activo' : 'inactivo'}`);
  }
  if (plan.catalogo.ajenos.length) console.log(`    ! ${plan.catalogo.ajenos.length} ítem(s) existente(s) que el archivo no nombra quedan como están: ${plan.catalogo.ajenos.join(', ')}`);
  // El contador que hace cumplir el límite por plan. Sin él, la consola no
  // puede dar de alta ni de baja un producto: las reglas lo niegan.
  const c = plan.contador;
  console.log(`    contador: ${c.antes === null ? 'FALTA' : c.antes} → ${c.items}`
    + ` (${c.nuevos} ítem(s) nuevo(s)) · límite ${c.limite} (${c.origen})`);
  if (c.items > c.limite) {
    console.log(`    ${rojo('⚠')} por encima del límite: el comercio no puede crear productos hasta bajar de ${c.limite}.`
      + ' No se borra nada; el contador queda en la verdad.');
  }
}
if (plan.funcionarios) {
  console.log(`\n  funcionarios (${plan.funcionarios.items.length} agenda(s)):`);
  for (const f of plan.funcionarios.items) {
    const d = f.datos;
    console.log(`    ${f.estado.padEnd(6)} ${f.id.padEnd(36)} «${d.nombre}» · calendario ${d.calendarioId ? `termina en ${cola(d.calendarioId.split('@')[0])}` : rojo('vacío (hereda el del comercio)')}`
      + ` · ${(d.servicios ?? []).length} servicio(s) · horario del negocio`);
  }
  if (plan.funcionarios.ajenos.length) console.log(`    ! ${plan.funcionarios.ajenos.length} agenda(s) existente(s) que el archivo no nombra quedan como están: ${plan.funcionarios.ajenos.join(', ')}`);
}
const todoIgual = [plan.negocio, plan.agendamiento].every((s) => !s || s.campos.every((c) => c.estado === 'igual'))
  && [plan.catalogo, plan.funcionarios].every((s) => !s || s.items.every((i) => i.estado === 'igual'));
if (todoIgual) console.log('\n  Sin cambios de contenido (se renovaría solo el sello).');

if (!APLICAR) {
  console.log('\n  Seco: no se escribió nada. Agregue --aplicar.\n');
  await salir(0);
}

// --- verificación por relectura ---------------------------------------------
// No basta con que las escrituras no fallen: se relee cada documento y se
// compara campo por campo con lo que el archivo pedía.
const fallas = [];
const revisarDoc = async (ref, esperado, donde) => {
  const doc = await ref.get();
  if (!doc.exists) { fallas.push(`${donde}: no existe`); return; }
  for (const k of Object.keys(esperado)) if (!igual(doc.get(k), esperado[k])) fallas.push(`${donde}.${k}`);
  if (doc.get('actualizadoPor') !== 'cargar-negocio') fallas.push(`${donde}.sello`);
};
if (negocio) {
  await revisarDoc(refNegocio, negocio, 'config/negocio');
  if (typeof negocio.instruccionesExtra === 'string') {
    // Lo vigente y la revisión, releídos como todo lo demás: es lo que lee el flujo.
    const doc = await refNegocio.get();
    if (doc.get('instruccionesVigentes') !== negocio.instruccionesExtra) fallas.push('config/negocio.instruccionesVigentes');
    const rev = doc.get('instruccionesRevision') ?? {};
    if (rev.estado !== 'aprobado' || rev.hash !== hashCorto(negocio.instruccionesExtra)) fallas.push('config/negocio.instruccionesRevision');
  }
}
if (agendamiento) await revisarDoc(refAgend, agendamiento, 'config/agendamiento');
for (const it of catalogo ?? []) {
  const { precio, moneda, ...resto } = it.datos;
  await revisarDoc(refItem(it.id), resto, `catalogo/${it.id}`);
  const doc = await refItem(it.id).get();
  if (typeof precio === 'number' ? doc.get('precio') !== precio : doc.get('precio') !== undefined) fallas.push(`catalogo/${it.id}.precio`);
  if (typeof precio === 'number' && moneda && doc.get('moneda') !== moneda) fallas.push(`catalogo/${it.id}.moneda`);
}
for (const f of funcionarios ?? []) await revisarDoc(refFunc(f.id), f.datos, `funcionarios/${f.id}`);
if (plan.contador) {
  // Se relee el contador como todo lo demás, y se mira también la FORMA: con
  // una clave de más, la regla del contador rechaza cualquier cambio posterior
  // y el comercio queda trabado sin poder tocar su catálogo.
  const doc = await refContador.get();
  if (doc.get('items') !== plan.contador.items) fallas.push(`contadores/catalogo.items (dice ${doc.get('items')})`);
  if (!Object.keys(doc.data() ?? {}).every((k) => CLAVES_CONTADOR.includes(k))) fallas.push('contadores/catalogo.claves');
}

const releidos = [
  negocio && `config/negocio (${Object.keys(negocio).length} campos)`,
  agendamiento && `config/agendamiento (${Object.keys(agendamiento).length} campos)`,
  catalogo && `${catalogo.length} ítem(s) del catálogo`,
  funcionarios && `${funcionarios.length} agenda(s)`,
  plan.contador && `contador del catálogo (${plan.contador.items})`,
].filter(Boolean).join(' · ');
console.log(`\n  ${fallas.length ? '✗' : '✓'} Verificación: ${fallas.length ? `no coincide ${fallas.join(', ')}` : `releídos ${releidos}`}\n`);
if (fallas.length) await salir(1);
console.log('  SIGUE (docs/alta-cliente/RUNBOOK.md, etapa 4): revisar en la consola, con el');
console.log('  administrador del comercio, que la pantalla muestre lo cargado; y compartir cada');
console.log('  calendario con la cuenta de Google de la credencial de n8n.\n');
await salir(0);
