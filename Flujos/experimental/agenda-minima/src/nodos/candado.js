// CANDADO: el paso de DESPUES de crear. Regla mandatoria de Andres (17/09/2026): nunca
// una cita encima de otra. Se dispara por lo que el flujo HIZO (creo un evento), no por lo
// que se dijo, y no se omite nunca:
//
//   1. «Resolver con agenda» ya valido el hueco contra la lectura fresca (antes de crear).
//   2. «Crear evento» creo la cita.
//   3. «Releer el hueco» volvio a leer el calendario. Aca:
//        - si hay OTRO evento que se cruza con el propio, se BORRA EL PROPIO
//          (`deshacerId`), se le dice al paciente y se le vuelve a ofrecer;
//        - si la relectura falla, o el evento propio no aparece, no se puede comprobar:
//          falla cerrado y tambien se deshace;
//        - solo con relectura limpia hay confirmacion y cierre.
//      Dos hermanos = DOS eventos (uno por hermano, seguidos): el candado es POR HECHO sobre cada
//      uno. Si no se crearon todos, se deshacen los que si (nunca queda una cita a medias); si
//      cualquiera se cruza, no aparece o no son contiguos, se deshacen todos. Un solo cierre por par.
//   4. Reagendar: la cita anterior (`borrarId`) se borra RECIEN ahora, y solo si el
//      candado paso. Si la nueva falla o se cruza, la anterior NO se toca.
//
// «Nunca se confirma lo que no se creo»: si el calendario fallo al crear, no hay cita
// ni confirmacion (plan `error`).
const r = cnPrimero('Resolver con agenda') || {};
const cfg = cnCfg();
const t = cnPrimero('Interpretar entrada') || {};
const ahora = Number(t.ahoraMs) || Date.now();
const en = Object.assign(cnEstadoBase(), r.estado || {});
const pasar = (extra) => [{ json: Object.assign({}, r, {
  estado: en, creada: false, eventoCreadoId: '', eventosCreadosIds: [], deshacerId: '', deshacerIds: [], registrarCierre: false, huboCruce: false,
}, extra || {}) }];
// Con ids que deshacer sale UN item por id (`deshacerId`): «Deshacer cita» corre una vez por item.
const deshaciendo = (ids, extra) => ids.map((id) => ({ json: Object.assign({}, r, {
  estado: en, creada: false, eventoCreadoId: ids[0], eventosCreadosIds: ids, registrarCierre: false, huboCruce: true,
}, extra || {}, { deshacerId: id, deshacerIds: ids }) }));

if (!r.crear) return pasar({});

const citas = Array.isArray(r.crear.citas) && r.crear.citas.length ? r.crear.citas
  : [{ inicio: r.crear.inicio, fin: r.crear.fin }];
const creados = cnTodos('Crear evento');
const ids = creados.filter((e) => e && !e.error && e.id).map((e) => String(e.id));
if (ids.length === 0) {
  // No se creo nada: nada que confirmar, nada que deshacer, y la cita anterior no se toca.
  return pasar({ plan: 'error', crear: null, borrarId: '', errores: (r.errores || []).concat(['no se pudo crear la cita en el calendario']),
    params: { motivo: 'no se pudo crear la cita en el calendario' } });
}
if (ids.length < citas.length || creados.length !== citas.length) {
  // Se creo solo una parte (hermanos): se deshace TODO lo creado, sin confirmar y sin tocar la cita anterior.
  return deshaciendo(ids, {
    plan: 'error', crear: null, borrarId: '', eventoCreadoId: '', eventosCreadosIds: [],
    errores: (r.errores || []).concat(['no se pudieron crear todas las citas en el calendario']),
    params: { motivo: 'no se pudieron crear todas las citas en el calendario' },
  });
}

const releidos = cnTodos('Releer el hueco');
const relecturaFalla = releidos.length === 0 || releidos.some((e) => e && e.error);
const eventos = releidos.filter((e) => e && e.start);
const visibles = ids.every((id) => eventos.some((e) => String(e.id) === id));
let cruce = false;
let con = [];
for (const c of citas) {
  const hc = hayCruce({ eventos: eventos, inicio: c.inicio, fin: c.fin, exceptoIds: ids });
  if (hc.cruce) { cruce = true; con = con.concat(hc.con); }
}
// Contiguas: cada evento relido empieza donde termina el anterior (la relectura es lo que quedo en el calendario).
let contiguas = true;
if (!relecturaFalla && visibles) {
  const finDe = (e) => msDe(e.end && (e.end.dateTime || e.end.date));
  const iniDe = (e) => msDe(e.start && (e.start.dateTime || e.start.date));
  const vistos = ids.map((id) => eventos.filter((e) => String(e.id) === id)[0]);
  for (let k = 1; k < vistos.length; k++) if (!(iniDe(vistos[k]) === finDe(vistos[k - 1]))) contiguas = false;
}
const sinComprobar = relecturaFalla || !visibles;

if (sinComprobar || cruce || !contiguas) {
  // Se deshace lo propio (todos los eventos) y se vuelve a ofrecer con lo que se ve ahora.
  const propia = en.moverInicio ? msDe(en.moverInicio) : null;
  const fecha = fechaLocal(msDe(r.crear.inicio));
  const o = relecturaFalla ? null : ofertaDeHuecos({
    eventos: eventos, cfg: { horario: cfg.horario, duracionPorDefectoMin: cfg.duracionPorDefectoMin,
      anticipacionMinimaMin: cfg.anticipacionMinimaMin, anticipacionMaximaDias: cfg.anticipacionMaximaDias },
    // La duracion de lo que se iba a crear (60 min con dos hermanos), no la de un solo control.
    duracionMin: (Number(cfg.duracionPorDefectoMin) > 0 ? Number(cfg.duracionPorDefectoMin) : 30) * citas.length,
    ahoraMs: ahora, fechaPreferida: fecha > fechaLocal(ahora) ? fecha : null, pidioHoy: fecha === fechaLocal(ahora),
    franja: 'cualquiera', ignorarIds: ids.concat(en.moverId ? [en.moverId] : []), maximo: 4,
  });
  const huecos = o ? o.huecos.filter((h) => propia === null || msDe(h.inicio) !== propia).slice(0, 3) : [];
  en.huecoElegido = null;
  if (huecos.length) {
    en.paso = 'ofreciendo_huecos';
    en.ultimaOferta = huecos.map((h) => h.inicio);
  }
  return deshaciendo(ids, {
    plan: 'cruce', crear: null, borrarId: '',
    oferta: { huecos: huecos, dia: o ? o.dia : null, aviso: null, franjaLlena: false, diaPedido: null },
    cruzaCon: con, sinComprobar: sinComprobar,
    errores: (r.errores || []).concat([relecturaFalla ? 'no se pudo releer el calendario despues de crear' : (!visibles ? 'un evento creado no aparece al releer' : (cruce ? 'la cita se cruza con otra' : 'las citas de los hermanos no quedaron seguidas'))]),
  });
}

// Candado limpio: las citas estan y no pisan a nadie.
en.paso = 'inicio'; en.servicio = null; en.hermanos = false; en.huecoElegido = null; en.moverId = null;
en.moverInicio = null; en.moverTitulo = ''; en.ultimaOferta = []; en.pacientes = []; en.primerTexto = ''; en.pidioSegundoNombre = false;
return pasar({ creada: true, eventoCreadoId: ids[0], eventosCreadosIds: ids, registrarCierre: true, borrarId: r.borrarId || '' });
