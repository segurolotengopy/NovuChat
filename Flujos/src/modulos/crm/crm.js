// MODULO miniCRM (`crm`): la ficha de cada contacto en una Hoja de Google NATIVA del cliente. Este archivo corre DENTRO de un nodo Code de n8n:
// JavaScript puro, sin require, sin URL, sin Buffer ni crypto (no existen en el sandbox), y sin el nombre de ningun cliente. El mapa de columnas
// es DATO del tenant: el constructor lo inyecta en la linea marcada de abajo (debe aparecer exactamente una vez). Lo propio de la captacion
// (calificar, resumir) llega como argumento (`adaptador`), nunca se importa.
// MENSAJES POR CONVERSACION: 0. Escribir en la hoja no envia WhatsApp.
//
// REGLAS FIJAS (Andres, 28 a 30/10/2026): se actualiza la fila MAS RECIENTE del telefono (mayor row_number); un negocio por fila; las columnas del
// equipo (valor, responsable, estado, proxima accion, extras) NUNCA se pisan -- el estado inicial se escribe solo al CREAR la fila--; con
// `crm.activo === false` no se escribe ni se consulta Google.
const CRM_MAPA = null; // @@crm-mapa

// Los campos del contrato de columnas v1 que son del bot (espejo de `COLUMNAS_V1` de Functions; una prueba los compara).
const CRM_CAMPOS_BOT = ['id', 'fecha', 'nombre', 'empresa', 'telefono', 'etapaInicial', 'origen', 'calificacion', 'resumen', 'interes',
  'ultimaInteraccion', 'etapaSugerida', 'idCampana', 'noContactar', 'ultimaActualizacionBot', 'estadoRecordatorio',
  'clasificacion', 'quePidio', 'diaPreferido', 'horarioPreferido', 'derivacion', 'ventana24h'];
const CRM_CAMPOS_EQUIPO = ['valor', 'responsable', 'estado', 'proximaAccion', 'diagnostico'];
// De los del equipo, los que el mapa debe declarar siempre (columna o null); `diagnostico` es opcional: solo existe en las planillas que la traen.
const CRM_EQUIPO_DECLARADO = ['valor', 'responsable', 'estado', 'proximaAccion'];
// Los campos sin los cuales la logica de la fila no puede escribir. `interes` es opcional (hay planillas sin columna de rubro).
const CRM_CAMPOS_OBLIGATORIOS = ['id', 'fecha', 'nombre', 'empresa', 'telefono', 'etapaInicial', 'origen', 'calificacion', 'resumen'];

// LA CLASIFICACION DEL LEAD, POR CODIGO Y POR HECHOS (nunca por lo que diga el modelo). Cada senal es un booleano que deja el flujo;
// solo `=== true` cuenta. Precedencia: no es paciente > Caliente > Frio > Tibio (el resto: llego por anuncio o escribio y no avanzo).
//   Caliente   acepto agendar, pidio la ubicacion o pidio que lo llamen.
//   Frio       pregunto el precio y cerro la conversacion.
//   No es lead proveedor o persona que no es paciente.
const CRM_CLASIFICACIONES = ['No es lead', 'Frío', 'Tibio', 'Caliente'];
function crmClasificar(s) {
  const h = s !== null && typeof s === 'object' ? s : {};
  if (h.noEsPaciente === true) return 'No es lead';
  if (h.aceptoAgendar === true || h.pidioUbicacion === true || h.pidioLlamada === true) return 'Caliente';
  if (h.preguntoPrecioYCerro === true) return 'Frío';
  return 'Tibio';
}
// Prioridad de atencion de cada clasificacion; lo que no es una clasificacion conocida no tiene prioridad.
const CRM_PRIORIDAD_DE = { 'Caliente': 'Alta', 'Tibio': 'Media', 'Frío': 'Baja', 'No es lead': 'N/A' };
function crmPrioridad(clasificacion) {
  return typeof clasificacion === 'string' && Object.hasOwn(CRM_PRIORIDAD_DE, clasificacion) ? CRM_PRIORIDAD_DE[clasificacion] : 'N/A';
}
// La ventana de 24 h de WhatsApp se cierra 24 h despues del ultimo mensaje del cliente (milisegundos). Dato ilegible = null.
function crmVentana24h(ultimaInteraccionMs) {
  return typeof ultimaInteraccionMs === 'number' && Number.isFinite(ultimaInteraccionMs) ? ultimaInteraccionMs + 24 * 3600 * 1000 : null;
}

// Mismo contrato que `neutralizarTexto` de Functions (una prueba compara ambas sobre la misma tabla): sin controles ni caracteres de formato,
// acotado, y un apostrofo delante si la hoja lo tomaria por formula.
function crmNeutralizarTexto(valor, largoMax) {
  if (typeof valor !== 'string') return '';
  const max = largoMax === undefined ? 500 : largoMax;
  const limpio = valor
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\p{Cf}/gu, '')
    .slice(0, max);
  return /^[\s ]*[=+\-@]/.test(limpio) ? "'" + limpio : limpio;
}

// Un elemento de una lista de la consola: un texto recortado de hasta 40 caracteres, neutralizado. Lo demas (largo, numero, objeto) se descarta (null).
function crmElemento(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > 40) return null;
  const n = crmNeutralizarTexto(t, 40);
  return n === '' ? null : n;
}

// `config/crm` de la consola, saneado: solo `activo`, `moneda` (1 a 5 caracteres) y `listas` (etapas, origenes; hasta 20 cada una).
function crmSanearConfig(c) {
  const o = c !== null && typeof c === 'object' && !Array.isArray(c) ? c : {};
  const moneda = typeof o.moneda === 'string' ? o.moneda.trim() : '';
  const listas = {};
  const l = o.listas !== null && typeof o.listas === 'object' ? o.listas : {};
  for (const k of ['etapas', 'origenes']) {
    if (!Array.isArray(l[k])) continue;
    listas[k] = l[k].map(crmElemento).filter((x) => x !== null).slice(0, 20);
  }
  return { activo: o.activo !== false, moneda: moneda.length >= 1 && moneda.length <= 5 ? crmNeutralizarTexto(moneda, 5) : '', listas };
}

// Solo `activo === false` apaga; ausente o ilegible = encendido.
function crmActivo(c) {
  return c === null || typeof c !== 'object' || c.activo !== false;
}

const crmTituloValido = (t) => typeof t === 'string' && t.trim() === t && t.length >= 1 && t.length <= 60 && !/^[=+\-@]/.test(t);
const crmLetraValida = (l) => typeof l === 'string' && /^[A-Z]$/.test(l);

// Valida el mapa de columnas del tenant: devuelve la lista de errores (vacia = valido).
function crmValidarMapa(m) {
  const e = [];
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return ['el mapa no es un objeto'];
  if (!Number.isInteger(m.filaEncabezados) || m.filaEncabezados < 1 || m.filaEncabezados > 20) e.push('filaEncabezados debe ser un entero de 1 a 20');
  if (typeof m.prefijoId !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,9}$/.test(m.prefijoId)) e.push('prefijoId no es valido');
  if (!Number.isInteger(m.primerId) || m.primerId < 1) e.push('primerId debe ser un entero mayor que 0');
  const letras = new Map();
  const titulos = new Set();
  const usa = (letra, titulo, quien) => {
    if (!crmLetraValida(letra)) { e.push(quien + ': la letra no es valida'); return; }
    if (!crmTituloValido(titulo)) e.push(quien + ': el titulo no es valido (1 a 60 caracteres, sin empezar por = + - @)');
    if (letras.has(letra)) e.push(quien + ': la letra ' + letra + ' ya la usa ' + letras.get(letra));
    else letras.set(letra, quien);
    if (typeof titulo === 'string') {
      if (titulos.has(titulo)) e.push(quien + ': el titulo se repite');
      titulos.add(titulo);
    }
  };
  const col = m.columnas !== null && typeof m.columnas === 'object' ? m.columnas : null;
  if (!col) e.push('faltan las columnas del bot');
  const letrasBot = [];
  if (col) {
    for (const k of CRM_CAMPOS_OBLIGATORIOS) if (!col[k]) e.push('falta la columna del bot «' + k + '»');
    for (const k of Object.keys(col)) {
      if (CRM_CAMPOS_BOT.indexOf(k) < 0) { e.push('«' + k + '» no es una columna del bot'); continue; }
      usa(col[k] && col[k].letra, col[k] && col[k].titulo, 'columnas.' + k);
      if (col[k] && crmLetraValida(col[k].letra)) letrasBot.push(col[k].letra);
    }
  }
  const eq = m.equipo !== null && typeof m.equipo === 'object' ? m.equipo : null;
  if (!eq) e.push('falta el bloque «equipo»');
  const letrasEquipo = [];
  if (eq) {
    for (const k of CRM_EQUIPO_DECLARADO) {
      if (!Object.prototype.hasOwnProperty.call(eq, k)) { e.push('equipo.' + k + ' debe declararse (columna o null)'); continue; }
      if (eq[k] === null) continue;
      usa(eq[k] && eq[k].letra, eq[k] && eq[k].titulo, 'equipo.' + k);
      if (eq[k] && crmLetraValida(eq[k].letra)) letrasEquipo.push(eq[k].letra);
    }
    if (eq.diagnostico !== undefined && eq.diagnostico !== null) {
      usa(eq.diagnostico.letra, eq.diagnostico.titulo, 'equipo.diagnostico');
      if (crmLetraValida(eq.diagnostico.letra)) letrasEquipo.push(eq.diagnostico.letra);
    }
    for (const k of Object.keys(eq)) if (CRM_CAMPOS_EQUIPO.indexOf(k) < 0) e.push('equipo.' + k + ' no es un campo del equipo');
  }
  const ex = m.extrasDelEquipo !== undefined && m.extrasDelEquipo !== null ? m.extrasDelEquipo : {};
  if (typeof ex !== 'object' || Array.isArray(ex)) e.push('extrasDelEquipo debe ser un objeto letra -> titulo');
  else for (const l of Object.keys(ex)) { usa(l, ex[l], 'extrasDelEquipo.' + l); if (crmLetraValida(l)) letrasEquipo.push(l); }
  // Las columnas del bot ya no son contiguas (las del equipo quedan en medio): el bot solo escribe las letras de sus campos (una letra no tiene dos
  // dueños: `usa` lo comprueba) y lo que se LEE es A..ultima letra del mapa, sin huecos, para poder comparar los encabezados letra por letra.
  const todas = letrasBot.concat(letrasEquipo);
  if (todas.length) {
    const ultima = todas.slice().sort().pop();
    for (let c = 65; c <= ultima.charCodeAt(0); c++) {
      const l = String.fromCharCode(c);
      if (!letras.has(l)) e.push('la columna ' + l + ' cae dentro del rango que se lee (A a ' + ultima + ') y no esta declarada');
    }
  }
  const a = m.alCrear !== null && typeof m.alCrear === 'object' ? m.alCrear : null;
  if (!a) e.push('falta alCrear');
  else {
    for (const k of ['etapaInicial', 'origen', 'origenAnuncio']) if (crmElemento(a[k]) === null || crmElemento(a[k]) !== a[k]) e.push('alCrear.' + k + ' no es un texto valido (1 a 40 caracteres, sin empezar por = + - @)');
    if (a.estado !== undefined) {
      if (crmElemento(a.estado) === null || crmElemento(a.estado) !== a.estado) e.push('alCrear.estado no es un texto valido');
      if (!eq || !eq.estado) e.push('alCrear.estado exige la columna equipo.estado');
    }
  }
  return e;
}

// La fila mas RECIENTE entre las coincidencias de un telefono: la de mayor row_number (la primera si empatan).
function crmFilaMasReciente(coincidencias) {
  return (Array.isArray(coincidencias) ? coincidencias : []).reduce((m, f) => (!m || Number(f.row_number) > Number(m.row_number) ? f : m), undefined);
}

// Quita invisibles y marcas de direccion (U+00AD, U+061C, U+200B a U+200F, U+202A a U+202E, U+2060 a U+2069, BOM): nada que el cliente no ve llega a la hoja.
const crmLimpio = (v) => String(v ?? '').replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const crmDigitos = (v) => String(v ?? '').replace(/\D/g, '');
// Quita TODOS los bloques de signos de formula del comienzo («= =1» no queda «=1»).
const crmSeguro = (v) => crmLimpio(v).replace(/^(?:[=+\-@]\s*)+/, '');
// `Agregar fila` escribe con USER_ENTERED: el apostrofo inicial deja el texto como texto y no se ve en la celda.
const crmComoTexto = (v) => (crmSeguro(v) ? "'" + crmSeguro(v) : '');
const crmFechaLaPaz = (ahoraMs) => new Date(ahoraMs - 4 * 3600 * 1000).toISOString().slice(0, 10);
// «AAAA-MM-DD HH:MM» en La Paz (UTC-4 fijo); dato ilegible = ''.
const crmFechaHoraLaPaz = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms - 4 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ') : '');
// Un texto libre del cliente (dia, horario, que pidio): acotado ANTES de neutralizarlo.
const crmTextoCorto = (v, max) => crmLimpio(v).slice(0, max);

// Por que no se pudo leer: SOLO el tipo y el codigo del error, nunca su mensaje, que podria repetir un dato del cliente.
const CRM_ESTADOS_GOOGLE = /\b(PERMISSION_DENIED|NOT_FOUND|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|UNAUTHENTICATED|UNAVAILABLE|FAILED_PRECONDITION|DEADLINE_EXCEEDED|INTERNAL)\b/;
function crmPorque(err) {
  if (!err || typeof err !== 'object') return 'error';
  const tipo = /^[A-Za-z]{1,40}$/.test(String(err.name ?? '')) ? err.name : 'error';
  const codigo = [err.httpCode, err.context?.httpCode, err.status, err.statusCode]
    .map((v) => String(v ?? '')).find((v) => /^\d{3}$/.test(v))
    || (/\b([45]\d{2})\b/.exec(String(err.message ?? '')) || [])[1] || '';
  const estado = (CRM_ESTADOS_GOOGLE.exec(String(err.message ?? '') + ' ' + String(err.description ?? '')) || [])[1] || '';
  return [tipo, codigo && 'HTTP ' + codigo, estado].filter(Boolean).join(' ');
}
// Un nodo de Google que fallo con `continueRegularOutput` devuelve el item de entrada con `error` al lado de `json`.
const crmFallido = (x) => x.error || (x.json && x.json.error !== undefined && x.json.row_number === undefined);

// Los encabezados que el codigo espera, en orden de columna: A hasta la ultima letra del BOT (las del equipo que quedan en medio incluidas).
function crmLetrasDeclaradas(mapa) {
  const porLetra = {};
  for (const k of Object.keys(mapa.columnas)) porLetra[mapa.columnas[k].letra] = { titulo: mapa.columnas[k].titulo, bot: true };
  for (const k of Object.keys(mapa.equipo || {})) if (mapa.equipo[k]) porLetra[mapa.equipo[k].letra] = { titulo: mapa.equipo[k].titulo, bot: false };
  for (const l of Object.keys(mapa.extrasDelEquipo || {})) porLetra[l] = { titulo: mapa.extrasDelEquipo[l], bot: false };
  return porLetra;
}
function crmEncabezadosEsperados(mapa) {
  const porLetra = crmLetrasDeclaradas(mapa);
  const letras = Object.keys(porLetra).sort();
  const ultimaBot = letras.filter((l) => porLetra[l].bot).pop();
  return letras.filter((l) => l <= ultimaBot).map((l) => porLetra[l].titulo);
}
// Las columnas del equipo que quedan DESPUES de la ultima del bot: se leen (el rango llega a la ultima letra del mapa) y, si llegan, deben ser las declaradas.
function crmEncabezadosCola(mapa) {
  const porLetra = crmLetrasDeclaradas(mapa);
  const letras = Object.keys(porLetra).sort();
  const ultimaBot = letras.filter((l) => porLetra[l].bot).pop();
  return letras.filter((l) => l > ultimaBot).map((l) => porLetra[l].titulo);
}
const CRM_COLUMNAS_DE_MAS = '\u0000columnas de mas';
// Primer encabezado leido que no es el esperado (letra por letra: orden y sin sobrantes), o '' si coinciden. Una fila leida lleva `row_number` aparte.
// Tras los `esperados` pueden venir, en orden, los de la `cola` (equipo, solo lectura); cualquier otro sobrante es «columnas de mas».
function crmPrimerEncabezadoDistinto(fila, esperados, cola) {
  const claves = Object.keys(fila).filter((k) => k !== 'row_number');
  for (let i = 0; i < esperados.length; i++) if (claves[i] !== esperados[i]) return esperados[i];
  const resto = claves.slice(esperados.length);
  const tail = Array.isArray(cola) ? cola : [];
  for (let j = 0; j < resto.length; j++) if (resto[j] !== tail[j]) return CRM_COLUMNAS_DE_MAS;
  return '';
}

// La decision de la fila. `adaptador` = { calificar(prospecto), resumir(prospecto, conEstado, calificacionFinal), prioridad: [de menor a mayor] }.
// Devuelve un item por prospecto con `accionPlanilla` (agregar, actualizar o nada) y `veredictoPlanilla`; las celdas llevan el TITULO del encabezado como clave.
function crmDecidirFila(a) {
  const mapa = a.mapa;
  const adaptador = a.adaptador;
  const prospectos = a.prospectos;
  const T = (campo) => mapa.columnas[campo].titulo;
  const mapeado = (campo) => !!mapa.columnas[campo];
  const errores = crmValidarMapa(mapa);
  const out = [];
  const nada = (i, veredicto) => out.push({ json: { accionPlanilla: 'nada', veredictoPlanilla: veredicto }, pairedItem: { item: i } });
  if (errores.length) { prospectos.forEach((it, i) => nada(i, 'mapa_invalido')); return out; }
  const busqueda = a.busqueda;
  const lecturaIds = a.lecturaIds;
  const fallo = [...busqueda, ...lecturaIds].find(crmFallido);
  const coincidencias = busqueda.map((x) => x.json).filter((f) => f && f.row_number !== undefined);
  const ids = lecturaIds.map((x) => x.json).filter((f) => f && f.row_number !== undefined);
  const DESFASE = mapa.filaEncabezados - 1;
  const esperados = crmEncabezadosEsperados(mapa);
  const cola = crmEncabezadosCola(mapa);
  // Letra por letra, antes de escribir: A en la lectura de IDs; A hasta la ultima del bot en la fila encontrada.
  const faltan = [];
  if (ids.length && crmPrimerEncabezadoDistinto(ids[0], [T('id')])) faltan.push(crmPrimerEncabezadoDistinto(ids[0], [T('id')]) === CRM_COLUMNAS_DE_MAS ? CRM_COLUMNAS_DE_MAS : T('id'));
  if (coincidencias.length) { const d = crmPrimerEncabezadoDistinto(coincidencias[0], esperados, cola); if (d) faltan.push(d); }
  const prioridad = (v) => adaptador.prioridad.indexOf(crmLimpio(v));
  const idRe = new RegExp('^\\s*' + mapa.prefijoId.replace(/[^A-Za-z0-9]/g, '\\$&') + '(\\d+)\\s*$', 'i');

  prospectos.forEach((it, i) => {
    const p = it.json;
    if (!p || !p.telefono) return nada(i, 'sin_telefono');
    if (fallo) return nada(i, 'no_leida: ' + crmPorque(fallo.error ?? fallo.json.error));
    if (faltan.length) return nada(i, faltan[0] === CRM_COLUMNAS_DE_MAS ? 'encabezados_distintos: columnas de más en la fila ' + mapa.filaEncabezados
      : 'encabezados_distintos: la fila ' + mapa.filaEncabezados + ' no tiene «' + faltan[0] + '»');
    // Una persona que vuelve tras 48 h (ficha nueva: `nuevoContacto`) es un registro NUEVO; si no, se actualiza SIEMPRE la fila mas reciente de ese telefono.
    const actual = p.nuevoContacto === true ? undefined : crmFilaMasReciente(coincidencias.filter((f) => crmDigitos(f[T('telefono')]) === p.telefono));
    // Los hechos viajan dentro del prospecto; `cerrado` sigue siendo un pedido de una persona.
    const prospecto = { ...p, ...(p.hechos && typeof p.hechos === 'object' ? p.hechos : {}),
      pidioAsesor: p.estado === 'cerrado' || p.hechos?.pidioAsesor === true };
    const calificacion = adaptador.calificar(prospecto);
    // CAMPOS NUEVOS (todos opcionales: sin ellos la salida es la de siempre). La clasificacion y el cierre de la ventana los calcula el codigo.
    const clasificacion = p.senales !== null && typeof p.senales === 'object' && mapeado('clasificacion') ? crmClasificar(p.senales) : '';
    const ultimaMs = typeof p.ultimaInteraccionMs === 'number' && Number.isFinite(p.ultimaInteraccionMs) ? p.ultimaInteraccionMs : null;
    const derivacionTxt = p.derivacion === true ? 'Sí' : crmTextoCorto(p.derivacion, 80);
    const extras = [
      ['clasificacion', clasificacion],
      ['quePidio', crmTextoCorto(p.quePidio, 200)],
      ['diaPreferido', crmTextoCorto(p.diaPreferido, 60)],
      ['horarioPreferido', crmTextoCorto(p.horarioPreferido, 60)],
      ['derivacion', derivacionTxt],
      ['ultimaInteraccion', crmFechaHoraLaPaz(ultimaMs)],
      ['ventana24h', crmFechaHoraLaPaz(crmVentana24h(ultimaMs))],
    ].filter(([campo, v]) => v !== '' && mapeado(campo));

    if (actual) {
      // YA EXISTE: solo nombre, empresa, interes, calificacion y resumen, y solo si el dato nuevo no esta vacio y cambia algo. La calificacion no baja.
      const antesI = actual[T('calificacion')];
      const quedaEnI = prioridad(antesI) >= 0 && prioridad(calificacion) < prioridad(antesI) ? crmLimpio(antesI) : calificacion;
      const nuevo = { nombre: crmSeguro(p.nombre), empresa: crmSeguro(p.empresa), interes: crmSeguro(p.rubro), calificacion,
        resumen: crmSeguro(adaptador.resumir(prospecto, false, quedaEnI)) };
      const celdas = {};
      for (const campo of ['nombre', 'empresa', 'interes', 'calificacion', 'resumen']) {
        if (!mapeado(campo)) continue;
        const v = nuevo[campo];
        const antes = actual[T(campo)];
        if (!v || crmLimpio(antes) === v) continue;
        // El nombre ya dado nunca se pisa con el del perfil de WhatsApp.
        if (campo === 'nombre' && p.nombreDePerfil === true && crmLimpio(antes)) continue;
        if (campo === 'calificacion' && prioridad(antes) >= 0 && prioridad(v) < prioridad(antes)) continue;
        celdas[T(campo)] = v;
      }
      for (const [campo, v] of extras) {
        const antes = actual[T(campo)];
        const nuevoV = crmSeguro(v);
        if (!nuevoV || crmLimpio(antes) === nuevoV) continue;
        // La clasificacion sube y no baja (como la calificacion); un valor que escribio una persona se sobrescribe.
        if (campo === 'clasificacion' && CRM_CLASIFICACIONES.indexOf(crmLimpio(antes)) >= 0 && CRM_CLASIFICACIONES.indexOf(nuevoV) < CRM_CLASIFICACIONES.indexOf(crmLimpio(antes))) continue;
        celdas[T(campo)] = nuevoV;
      }
      if (!Object.keys(celdas).length) return nada(i, 'sin_cambios');
      out.push({ json: { accionPlanilla: 'actualizar', veredictoPlanilla: 'actualizar', row_number: Number(actual.row_number) + DESFASE, ...celdas }, pairedItem: { item: i } });
      return;
    }

    // NUEVA: el ID que sigue al mayor que haya, y la fila entera. Las columnas del equipo no se escriben (salvo el estado inicial, solo aqui, al crear).
    const numeros = ids.map((f) => (idRe.exec(String(f[T('id')] ?? '')) || [])[1]).filter(Boolean).map(Number);
    const siguiente = numeros.length ? Math.max(...numeros) + 1 : mapa.primerId;
    const fila = {
      accionPlanilla: 'agregar',
      veredictoPlanilla: 'agregar',
      [T('id')]: mapa.prefijoId + siguiente,
      [T('fecha')]: crmFechaLaPaz(a.ahoraMs),
      [T('nombre')]: crmComoTexto(p.nombre),
      [T('empresa')]: crmComoTexto(p.empresa),
      [T('telefono')]: "'" + p.telefono,
      [T('etapaInicial')]: mapa.alCrear.etapaInicial,
      [T('origen')]: p.anuncio ? mapa.alCrear.origenAnuncio : mapa.alCrear.origen,
      [T('calificacion')]: calificacion,
      [T('resumen')]: crmComoTexto(adaptador.resumir(prospecto, true, calificacion)),
    };
    if (mapeado('interes')) fila[T('interes')] = crmComoTexto(p.rubro);
    for (const [campo, v] of extras) fila[T(campo)] = campo === 'clasificacion' ? v : (campo === 'ultimaInteraccion' || campo === 'ventana24h' ? v : crmComoTexto(v));
    if (mapa.alCrear.estado !== undefined && mapa.equipo.estado) fila[mapa.equipo.estado.titulo] = mapa.alCrear.estado;
    out.push({ json: fila, pairedItem: { item: i } });
  });
  return out;
}
