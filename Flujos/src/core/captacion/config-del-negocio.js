// LA CONSOLA MANDA: si el panel contesta, sus valores pisan a los de
// `Config base`; si no contesta, se usan los de respaldo. Mismo nombre y misma
// regla que en los flujos de los demos, y por el mismo motivo: las expresiones
// del flujo buscan «Config del negocio».
//
// EL 409 NO ES UN FALLO: ES LA RESPUESTA QUE CORTA EL SERVICIO. El nodo HTTP
// devuelve la respuesta completa -codigo y cuerpo- y aca se decide con el
// codigo (ver `estado-comercio.test.ts`):
//
//   200 + tenantId  -> configuracion del panel
//   409             -> SUSPENDIDO. Es una respuesta valida, no un error.
//   cualquier otra  -> no se pudo saber -> respaldo, y se sigue atendiendo:
//                      una caida del panel no deja a un prospecto sin respuesta.
//
// LO PROPIO DE ESTE FLUJO viene en `onboarding` (el documento
// /config/onboarding, que edita el administrador del comercio (y el propietario)): el fin
// del primer bloque, la plantilla del aviso interno y LA OFERTA -- rubros,
// planes, cargos unicos, aclaraciones y el archivo de planes --. Cada valor se
// valida ACA TAMBIEN: ante la duda gana el respaldo, y un elemento mal formado
// se descarta. El mensaje para quien ya es cliente y el enlace a la consola
// que todavia manda el panel YA NO SE LEEN: desde el 27/09/2026 no hay rama para
// quien ya es cliente (quien pide soporte recibe el boton «Hablar con un asesor»).
//
// LA PLANILLA DE PROSPECTOS sale de `Config base` y de ningun otro lado:
// `planillaProspectosId` y `planillaProspectosHoja`. Un marcador sin llenar o
// un id que no tiene la forma de un id de Google Sheets vale VACIO, y vacio es
// «no se guarda» (lo decide `Salida`). Con id y sin hoja, «Leads_CRM».
//
// LA OFERTA LA MANDA LA CONSOLA, ENTERA. Si el panel contesto, sus listas valen
// aunque vengan vacias: sin planes cargados el asistente no da precios, ofrece
// un asesor. El corpus del sitio (`Conocimiento del sitio`) sigue para todo lo
// demas, y si dice otra cosa sobre precios, gana la consola.
//
// EL HORARIO TAMBIEN MANDA VACIO. NovuChat no tiene horario fijo: si el panel
// contesto con el horario vacio, NO se cae al respaldo de `Config base` -- que
// seria un horario que nadie cumple -- y ni el prompt ni el traspaso lo mencionan.
//
// EL TECHO DE COSTO NO LO PONE ESTE FLUJO: lo pone el servidor, igual que en
// los flujos A y B. `configuracionFlujo` devuelve en `atencion` el estado del
// telefono -- normal, operador o bloqueado -- segun los umbrales de la cuenta
// (`atencion.ts`), y el flujo lo obedece antes de llamar al modelo. Aca solo se
// lee y se valida; quien decide es el servidor.
//
// EL LARGO MAXIMO DEL CUERPO DE UN MENSAJE CON BOTONES (1024) ES DE META Y
// VIVE EN UN SOLO LUGAR DEL FLUJO: `limiteInteractivo` de `Config base`. Aca se
// valida y viaja con el resto de la configuracion, porque lo necesitan dos
// nodos que corren despues: `Procesar respuesta` -- que compacta para que el
// boton sobreviva -- y `Salida` -- que baja el mensaje a texto si ni asi entra --.
//
// AL FINAL SE DERIVAN LOS TEXTOS QUE USAN LAS INSTRUCCIONES DEL AGENTE (la
// presentacion, la oferta, las aclaraciones, la frase del horario). Dependen
// solo de la configuracion, no del turno: las instrucciones siguen fijas entre
// un mensaje y otro, y el proveedor las puede cachear.
const base = $('Config base').first().json;

const respuesta = $input.first().json ?? {};
const codigo = Number(respuesta.statusCode);
const cuerpo = (respuesta.body ?? {});

const util = (v) => (typeof v === 'string' && v.trim() !== '') ? v.trim() : undefined;
const soloLlenos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const entero = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max) ? v : undefined;

// Texto de la consola que va al prompt o a un mensaje: una linea, sin corchetes
// (no puede fingir una marca como [CIERRE]) ni los delimitadores del corpus.
const linea = (v, max) => String(v ?? '')
  .replace(/<<<|>>>/g, '').replace(/[\[\]{}]/g, '')
  .replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
// Un marcador sin llenar (`REEMPLAZAR_…`) no es un valor.
const valor = (v) => (typeof v === 'string' && !/^REEMPLAZAR_/.test(v.trim())) ? v.trim() : '';
// `Config base` es un Set: una lista puede llegar como texto JSON.
const lista = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (err) { return []; } }
  return [];
};
const precio = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000) ? v : undefined;

const NIVELES = ['ninguno', 'pocos', 'muchos'];
const PERIODOS = ['mes', 'anio', 'unico'];

function limpiarOferta(ob) {
  const rubros = lista(ob.rubros).map((r) => ({
    id: linea(r?.id, 40), nombre: linea(r?.nombre, 60),
    solucion: linea(r?.solucion, 400), flujoSugerido: linea(r?.flujoSugerido, 40),
  })).filter((r) => r.id && r.nombre).slice(0, 20);
  // El rubro «a medida» va al final, como la salida de la lista.
  const aMedida = (r) => /medida|^otro/i.test(r.id + ' ' + r.nombre);
  const ordenados = [...rubros.filter((r) => !aMedida(r)), ...rubros.filter(aMedida)];

  const planes = lista(ob.planes).map((p) => ({
    nombre: linea(p?.nombre, 40), precioUsd: precio(p?.precioUsd),
    periodo: PERIODOS.includes(p?.periodo) ? p.periodo : '', incluye: linea(p?.incluye, 200),
  })).filter((p) => p.nombre && p.precioUsd !== undefined && p.periodo).slice(0, 12);

  const cargosUnicos = lista(ob.cargosUnicos).map((c) => ({
    nombre: linea(c?.nombre, 40), precioUsd: precio(c?.precioUsd),
    desde: c?.desde === true, detalle: linea(c?.detalle, 200),
  })).filter((c) => c.nombre && c.precioUsd !== undefined).slice(0, 6);

  const aclaraciones = lista(ob.aclaraciones).map((a) => ({
    tema: linea(a?.tema, 60), texto: linea(a?.texto, 600),
  })).filter((a) => a.tema && a.texto).slice(0, 15);

  const ap = ob.archivoPlanes && typeof ob.archivoPlanes === 'object' ? ob.archivoPlanes : null;
  const url = ap ? String(ap.url ?? '').trim() : '';
  // EL ARCHIVO SOLO DESDE EL ALMACENAMIENTO DE LA CONSOLA (revision de
  // seguridad del PR #238, L2): https, el host exacto de Firebase Storage o de
  // Cloud Storage y la ruta enseguida. Asi no pasa una direccion con usuario
  // («https://novuchat.site@…/p.png», que va al host de despues de la «@») ni la
  // de cualquier otro sitio, que el prospecto veria como de NovuChat. Por
  // expresion y no con `URL`: el nodo Code de n8n no tiene ese global. Si no
  // cumple, no hay archivo y los planes van en texto.
  const HOST_ARCHIVO = /^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\/[^\s@\\]+$/;
  const archivoPlanes = ap && HOST_ARCHIVO.test(url) && ['pdf', 'imagen'].includes(ap.tipo)
    ? { url, tipo: ap.tipo, nombreArchivo: linea(ap.nombreArchivo, 80) || 'Planes.pdf' } : null;
  // CON UN ARCHIVO VALIDO, LOS PLANES VAN EN EL ARCHIVO, sean cuantos sean
  // (Andres, 27/09/2026). El servidor sigue marcando `planesEnArchivo` solo con
  // mas de 5 planes -- es su regla para exigir el archivo --, pero el flujo ya
  // no lo mira: si el comercio cargo la imagen o el PDF, eso es lo que se
  // muestra. Sin un archivo valido no hay encabezado que mandar: se listan en
  // texto, como siempre.
  const planesEnArchivo = archivoPlanes !== null;

  return { rubros: ordenados, planes, cargosUnicos, aclaraciones, archivoPlanes, planesEnArchivo };
}

// El fin del primer bloque del respaldo, como numero. El Set lo guarda como
// numero, pero un export editado a mano podria traerlo como texto.
const baseAviso = Number(base.topeAviso) || 25;

// ESTADO DE ATENCION DEL TELEFONO (servidor). Sin respuesta del panel, `normal`:
// una caida del panel no deja sin respuesta a un prospecto.
const at = (codigo === 200 && cuerpo && typeof cuerpo.atencion === 'object' && cuerpo.atencion)
  ? cuerpo.atencion : {};
const atencion = {
  atencionEstado: ['normal', 'operador', 'bloqueado'].includes(at.estado) ? at.estado : 'normal',
  atencionAvisarRecepcion: ['operador', 'bloqueado'].includes(at.avisarRecepcion) ? at.avisarRecepcion : '',
  // Respuestas del asistente YA enviadas en la ventana. `null` si no se sabe.
  atencionRespuestas: (typeof at.respuestasEnVentana === 'number' && Number.isFinite(at.respuestasEnVentana))
    ? at.respuestasEnVentana : null,
  atencionVenceEn: util(at.ventanaVenceEn) || '',
};

// Respaldo de la oferta y de la voz: lo que trae `Config base`.
const ofertaBase = limpiarOferta({
  rubros: base.rubros, planes: base.planes, cargosUnicos: base.cargosUnicos,
  aclaraciones: base.aclaraciones, archivoPlanes: null, planesEnArchivo: false,
});
// El id de una planilla de Google: letras, digitos, «-» y «_», de 25 o mas.
const idPlanilla = (v) => (/^[A-Za-z0-9_-]{25,100}$/.test(valor(v)) ? valor(v) : '');
const respaldo = {
  ...base,
  ...ofertaBase,
  planillaProspectosId: idPlanilla(base.planillaProspectosId),
  // Con id y sin nombre de hoja, la hoja de siempre.
  planillaProspectosHoja: idPlanilla(base.planillaProspectosId)
    ? (linea(valor(base.planillaProspectosHoja), 100) || 'Leads_CRM') : '',
  // Limite del cuerpo interactivo (Meta). Un export editado a mano podria
  // traerlo como texto, en cero o sin el campo: ahi manda el valor de siempre.
  limiteInteractivo: entero(Number(base.limiteInteractivo), 200, 4096) ?? 1024,
  nombreAsistente: linea(valor(base.nombreAsistente), 40),
  nivelEmojis: NIVELES.includes(base.nivelEmojis) ? base.nivelEmojis : 'pocos',
  horarioAtencion: linea(valor(base.horarioAtencion), 120),
};

// TEXTOS DERIVADOS de la configuracion final, para las instrucciones del
// agente y las ramas sin modelo. Ver el comentario de arriba.
const monto = (n) => Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
const SUFIJO = { mes: '/mes', anio: '/año', unico: ', pago único' };
function derivar(c) {
  const negocio = c.nombreNegocio || 'NovuChat';
  const presentacion = (c.nombreAsistente ? c.nombreAsistente + ', ' : '') + 'el asistente virtual de ' + negocio;
  // NUMERADOS, Y ESO NO CONTRADICE QUE AL CLIENTE SE LE MUESTREN COMO
  // REFERENCIA. Esta lista la lee el MODELO, no el cliente: lo que el cliente
  // ve lo arma `Procesar respuesta`, en linea y sin numerar. Se probo quitarle
  // los numeros tambien aca, suponiendo que numerados el modelo los numeraria
  // en el chat, y la medicion dijo lo contrario (`scripts/comparar-prompt.mjs`,
  // 30 corridas por version contra gemini-3.5-flash-lite, 22/09/2026):
  //   rubrosTexto numerado    -> [RUBROS] en 83 %, y le pide un numero al
  //                              cliente en 0 de 30
  //   rubrosTexto sin numerar -> [RUBROS] en 10-37 %
  //   (la version de antes del 22/09, con la lista numerada TAMBIEN en el
  //    chat, ponia la marca en el 50-73 % y le pedia un numero al cliente en
  //    el 20 % de los turnos, que es justo lo que se quiso sacar)
  // Sin los numeros el modelo deja de reconocer la lista como algo que se
  // muestra. El temor de que numerara en el chat no se verifico ni una vez.
  const rubrosTexto = c.rubros.length
    ? c.rubros.map((r, i) => (i + 1) + '. ' + r.nombre +
        (r.solucion ? ' - solución: ' + r.solucion : '')).join('\n')
    : '(no hay rubros cargados: pregúntale a qué se dedica su negocio, sin lista)';
  const planesTexto = c.planes.length
    ? c.planes.map((p) => p.nombre + ' (USD ' + monto(p.precioUsd) + SUFIJO[p.periodo] + ')' +
        (p.incluye ? ': ' + p.incluye : '')).join('\n')
    : '(no hay planes cargados: no des ningún precio; ofrece que un asesor se los confirme)';
  const cargosTexto = c.cargosUnicos.length
    ? c.cargosUnicos.map((x) => x.nombre + ' (pago único): ' + (x.desde ? 'desde ' : '') + 'USD ' +
        monto(x.precioUsd) + (x.detalle ? '. ' + x.detalle : '')).join('\n')
    : '(ninguno)';
  const aclaracionesTexto = c.aclaraciones.length
    ? c.aclaraciones.map((a) => '- ' + a.tema + ': ' + a.texto).join('\n')
    : '(ninguna)';
  const h = c.horarioAtencion;
  return { ...c,
    presentacion,
    rubrosTexto, planesTexto, cargosTexto, aclaracionesTexto,
    // Cuando escribe una persona del equipo. Sin horario, «lo antes posible».
    fraseContacto: h ? 'en horario de atención (' + h + ')' : 'lo antes posible',
    lineaHorario: h
      ? 'Las personas del equipo atienden en este horario: ' + h + '.'
      : 'Las personas del equipo responden lo antes posible, sin días ni horas fijos: no prometas ninguno.',
  };
}

if (codigo === 409) {
  return [{ json: derivar({ ...respaldo, ...atencion,
    topeAviso: baseAviso,
    estadoComercio: 'suspendido',
    // Texto neutro del panel: no menciona pagos ni deudas.
    mensajeComercioSuspendido: util(cuerpo.mensajeCortesia) || base.mensajeComercioSuspendido,
    configDeLaConsola: false,
    panelDice: 'no operativo',
  }) }];
}

const contesto = codigo === 200 && cuerpo && typeof cuerpo.tenantId === 'string';
if (!contesto) {
  return [{ json: derivar({ ...respaldo, ...atencion,
    topeAviso: baseAviso,
    estadoComercio: base.estadoComercio ?? 'operativo',
    configDeLaConsola: false,
    panelSinRespuesta: true,
    codigoDelPanel: Number.isFinite(codigo) ? codigo : 0,
  }) }];
}

const r = cuerpo;
const dn = r.datosDelNegocio ?? {};
const op = r.operacion ?? {};
const ob = r.onboarding ?? {};
const voz = r.voz ?? {};

const topeAviso = entero(ob.topeAviso, 3, 100) ?? baseAviso;

const plantilla = util(ob.plantillaAviso);
const recepcion = util(op.numeroRecepcion);

const deLaConsola = soloLlenos({
  nombreNegocio: util(dn.nombreNegocio),
  // Solo digitos: es el destino de la plantilla y del boton a una persona.
  numeroRecepcion: recepcion ? (recepcion.replace(/\D/g, '') || undefined) : undefined,
  phoneNumberId: util(r.phoneNumberId),
  zonaHoraria: util(op.zonaHoraria),
  // La voz sale ROTULADA del panel (`voz`), no por posicion del arreglo.
  tratamiento: util(voz.tratamiento),
  estiloEmojis: util(voz.emojis),
  nivelEmojis: NIVELES.includes(voz.nivelEmojis) ? voz.nivelEmojis : undefined,
  plantillaAviso: plantilla && /^[a-z0-9_]{1,64}$/.test(plantilla) ? plantilla : undefined,
});

// El estado siempre sale del panel: es lo que corta el servicio.
const estadoComercio = util(r.estadoComercio) === 'activo' ? 'operativo'
  : (util(r.estadoComercio) ? 'suspendido' : (base.estadoComercio ?? 'operativo'));

// --- CAMPAÑAS VIGENTES (Andres, 02/10/2026, D4) ------------------------------
// Copia de `core/config-del-negocio.js`: el servidor manda en `campanas` SOLO las
// aplicadas y vigentes con el tope del plan cumplido; aca se vuelve a mirar la
// vigencia contra el reloj. Viaja como texto JSON y `Normalizar entrada` compara
// el texto. Sin `campanas` o con el panel caido no hay campañas.
const campanasActivas = JSON.stringify((Array.isArray(r.campanas) ? r.campanas : [])
  .filter((k) => k && typeof k.texto === 'string' && k.texto.trim() !== '' && k.texto.length <= 300)
  .filter((k) => {
    const desde = Date.parse(String(k.inicio || ''));
    const hasta = Date.parse(String(k.fin || ''));
    const ahora = Date.now();
    return Number.isFinite(desde) && Number.isFinite(hasta) && desde <= ahora && ahora < hasta;
  })
  .slice(0, 10)
  .map((k) => ({ id: String(k.id || '').slice(0, 60), texto: k.texto.trim() })));

return [{ json: derivar({
  ...respaldo,
  ...deLaConsola,
  // Mandan aunque vengan vacios (ver arriba): el nombre del asistente, el
  // horario y la oferta entera.
  nombreAsistente: linea(voz.nombreAsistente, 40),
  horarioAtencion: linea(op.horarioAtencion, 120),
  ...limpiarOferta(ob),
  ...atencion,
  topeAviso,
  campanasActivas,
  estadoComercio,
  configDeLaConsola: true,
}) }];
