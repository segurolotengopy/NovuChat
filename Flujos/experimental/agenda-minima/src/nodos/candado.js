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
  estado: en, creada: false, eventoCreadoId: '', deshacerId: '', registrarCierre: false, huboCruce: false,
}, extra || {}) }];

if (!r.crear) return pasar({});

const propio = cnPrimero('Crear evento');
const idCreado = propio && !propio.error && propio.id ? String(propio.id) : '';
if (!idCreado) {
  // No se creo nada: nada que confirmar, nada que deshacer, y la cita anterior no se toca.
  return pasar({ plan: 'error', crear: null, borrarId: '', errores: (r.errores || []).concat(['no se pudo crear la cita en el calendario']),
    params: { motivo: 'no se pudo crear la cita en el calendario' } });
}

const releidos = cnTodos('Releer el hueco');
const relecturaFalla = releidos.length === 0 || releidos.some((e) => e && e.error);
const eventos = releidos.filter((e) => e && e.start);
const visible = eventos.some((e) => String(e.id) === idCreado);
const hc = hayCruce({ eventos: eventos, inicio: r.crear.inicio, fin: r.crear.fin, exceptoId: idCreado });

if (relecturaFalla || !visible || hc.cruce) {
  // Se deshace lo propio y se vuelve a ofrecer con lo que se ve ahora.
  const propia = en.moverInicio ? msDe(en.moverInicio) : null;
  const fecha = fechaLocal(msDe(r.crear.inicio));
  const o = relecturaFalla ? null : ofertaDeHuecos({
    eventos: eventos, cfg: { horario: cfg.horario, duracionPorDefectoMin: cfg.duracionPorDefectoMin,
      anticipacionMinimaMin: cfg.anticipacionMinimaMin, anticipacionMaximaDias: cfg.anticipacionMaximaDias },
    ahoraMs: ahora, fechaPreferida: fecha > fechaLocal(ahora) ? fecha : null, pidioHoy: fecha === fechaLocal(ahora),
    franja: 'cualquiera', ignorarIds: [idCreado].concat(en.moverId ? [en.moverId] : []), maximo: 4,
  });
  const huecos = o ? o.huecos.filter((h) => propia === null || msDe(h.inicio) !== propia).slice(0, 3) : [];
  en.huecoElegido = null;
  if (huecos.length) {
    en.paso = 'ofreciendo_huecos';
    en.ultimaOferta = huecos.map((h) => h.inicio);
  }
  return pasar({
    plan: 'cruce', crear: null, borrarId: '', deshacerId: idCreado, huboCruce: true, eventoCreadoId: idCreado,
    oferta: { huecos: huecos, dia: o ? o.dia : null, aviso: null, franjaLlena: false, diaPedido: null },
    cruzaCon: hc.con, sinComprobar: relecturaFalla || !visible,
    errores: (r.errores || []).concat([relecturaFalla ? 'no se pudo releer el calendario despues de crear' : (!visible ? 'el evento creado no aparece al releer' : 'la cita se cruza con otra')]),
  });
}

// Candado limpio: la cita esta y no pisa a nadie.
en.paso = 'inicio'; en.servicio = null; en.hermanos = false; en.huecoElegido = null; en.moverId = null;
en.moverInicio = null; en.moverTitulo = ''; en.ultimaOferta = []; en.pacientes = []; en.primerTexto = ''; en.pidioSegundoNombre = false;
return pasar({ creada: true, eventoCreadoId: idCreado, registrarCierre: true, borrarId: r.borrarId || '' });
