/**
 * LOS ENVÍOS DE LOS FLUJOS DE AGENDA SE ENTREGAN O SE RESPALDAN (PR-5 del plan «se entrega lo que se promete»).
 *
 * El texto del turno promete un botón («toca el botón»), el pin de la ubicación o el QR de la seña. Si Meta
 * rechaza cada uno de esos envíos, el paciente NUNCA se queda con una promesa sin respaldo: recibe un texto
 * con el enlace (Maps o `wa.me`) o, en el caso del QR, el mensaje con el botón para escribir a recepción, y
 * ninguno promete nada («le aviso», «le escribimos», «le llamamos»).
 *
 * LA PRUEBA ES POR RECORRIDO, NO POR LISTA DE NODOS: un recorredor mínimo sigue el JSON versionado (Demo A y
 * Platinum) desde un nodo, ejecuta los Code y las expresiones TAL COMO ESTÁN en el JSON, hace fallar a Meta en
 * los envíos que se le pidan (la salida de error si el nodo la tiene; si no, la ejecución se detiene, que es el
 * «último recurso ruidoso») y devuelve lo que se envió, a quién, y lo que se reportó a la consola.
 *
 * CANDADO DE CITAS (regla del 17/09 de CLAUDE.md): esta suite NO lo reemplaza. `candado-agenda.test.ts` y
 * `platinum-flujo.test.ts` («verbo no previsto y la herramienta sí corrió») siguen corriendo sobre los mismos
 * JSON. Acá solo se comprueba que el código de `Mensaje a enviar` es el mismo en los dos flujos y que el
 * respaldo no toca el candado: nada de lo nuevo es alcanzable desde `Procesar respuesta` hacia atrás.
 *
 * COSTO: +1 mensaje al paciente SOLO cuando falla el pin, el botón o el QR; 0 en el camino normal.
 */
import { describe, expect, it } from 'vitest';
import { type Flujo, type J, codigoDe, correr, destinos, expresion, leerFlujo, nodo, plantilla } from './lib/flujo.ts';

const FLUJOS = ['demo-a-agendamiento.json', 'platinum-agendamiento.json'] as const;
const PROMESA = /\b(le|te)\s+(aviso|avisamos|avisar[eé]|escrib\w*|llam\w*|contact\w*|respond\w*|confirm\w*)\b|enseguida|en breve|pronto|tomar[aá] el chat|ya le avis/i;
const VOSEO = /\b(escrib[ií]|toc[aá]|abr[ií]|pod[eé]s|mand[aá]|ten[eé]s)\b/i;

const NUMERO = '59170000009';
const CLIENTE = '59170000001';
const CFG: J = {
  phoneNumberId: '1000000001', waGraphVersion: 'v26.0', numeroRecepcion: NUMERO, nombreNegocio: 'Negocio de Prueba',
  tratamiento: 'tutear', emojis: 'si', senaImporte: '50', senaMoneda: 'Bs', senaMinutosRetencion: '30',
  senaQrUrl: 'https://ejemplo.invalid/qr.png', cobroSena: 'si', ubicacionLat: -16.5, ubicacionLng: -68.15,
  direccion: 'Calle 1, zona Sur',
};

/** Una expresión `={{ … }}` simple, o una plantilla con texto y varias `{{ … }}`. */
const evaluar = (texto: unknown, j: J, refs: Record<string, J[]>): unknown => {
  const t = String(texto);
  return /^=\{\{[\s\S]*\}\}$/.test(t.trim()) && (t.match(/\{\{/g) ?? []).length === 1 ? expresion(t, j, refs) : plantilla(t, j, refs);
};

interface Envio { nodo: string; clase: string; para: string; texto: string; cuerpo: J }
interface Resultado { envios: Envio[]; reportes: { nodo: string; cuerpo: J }[]; detenida: string | null; pasos: string[] }

/**
 * Recorre el flujo desde `inicio` con `items`. `fallan`: nodos de envío que Meta rechaza. `previo`: lo que ya
 * corrió en la ejecución (sus salidas, para `$('Nombre')`). Sin `onError: continueErrorOutput`, un envío
 * rechazado detiene la ejecución (como en n8n).
 */
function recorrer(f: Flujo, inicio: string, items: J[], opciones: { fallan?: string[]; previo?: Record<string, J[]>; cfg?: J } = {}): Resultado {
  const fallan = new Set(opciones.fallan ?? []);
  const refs: Record<string, J[]> = {
    'Config del negocio': [opciones.cfg ?? CFG],
    'Normalizar entrada': [{ from: CLIENTE, phoneNumberId: CFG['phoneNumberId'] }],
    ...(opciones.previo ?? {}),
  };
  const r: Resultado = { envios: [], reportes: [], detenida: null, pasos: [] };
  const pila: { n: string; items: J[]; prev: string }[] = [{ n: inicio, items, prev: '' }];
  let vueltas = 0;
  while (pila.length && !r.detenida) {
    if (++vueltas > 200) throw new Error('el recorrido no termina: hay un ciclo sin salida');
    const { n, items: its, prev } = pila.shift() as { n: string; items: J[]; prev: string };
    const nd = nodo(f, n);
    r.pasos.push(n);
    const seguir = (salida: number, out: J[]) => {
      const dest = (f.connections[n]?.['main']?.[salida] ?? []).map((c) => c.node);
      // DFS en el orden de las conexiones: lo que cuelga de la primera salida corre antes que la siguiente.
      pila.unshift(...dest.map((d) => ({ n: d, items: out, prev: n })));
    };
    const tipo = nd.type.split('.').pop();
    if (tipo === 'code') {
      const salida = correr(codigoDe(f, n), its, refs, { $prevNode: { name: prev } }).map((x) => x.json);
      refs[n] = salida;
      seguir(0, salida);
    } else if (tipo === 'if') {
      const cond = nd.parameters['conditions'].conditions[0].leftValue;
      const verdaderos = its.filter((j) => expresion(cond, j, refs) === true);
      const falsos = its.filter((j) => expresion(cond, j, refs) !== true);
      refs[n] = its;
      if (verdaderos.length) seguir(0, verdaderos);
      if (falsos.length) seguir(1, falsos);
    } else if (tipo === 'whatsApp') {
      const j = its[0] as J;
      r.envios.push({ nodo: n, clase: 'text', para: String(evaluar(nd.parameters['recipientPhoneNumber'], j, refs)),
        texto: String(evaluar(nd.parameters['textBody'], j, refs)), cuerpo: {} });
      if (fallan.has(n)) { r.detenida = n; break; }
      const ok = [{ messages: [{ id: `wamid.${n}` }] }];
      refs[n] = ok;
      seguir(0, ok);
    } else if (tipo === 'httpRequest' && String(nd.parameters['url']).includes('/messages')) {
      const j = its[0] as J;
      const cuerpo = JSON.parse(String(expresion(nd.parameters['jsonBody'], j, refs))) as J;
      r.envios.push({ nodo: n, clase: String(cuerpo['type']), para: String(cuerpo['to']),
        texto: String(cuerpo['text']?.body ?? cuerpo['interactive']?.body?.text ?? cuerpo['image']?.caption ?? ''), cuerpo });
      if (fallan.has(n)) {
        if (nd.onError !== 'continueErrorOutput') { r.detenida = n; break; }
        const error = [{ error: { message: 'Meta rechazó el envío' } }];
        refs[n] = error;
        seguir(1, error);
      } else {
        const ok = [{ messages: [{ id: `wamid.${n}` }] }];
        refs[n] = ok;
        seguir(0, ok);
      }
    } else if (tipo === 'httpRequest') {
      const j = its[0] as J;
      r.reportes.push({ nodo: n, cuerpo: JSON.parse(String(expresion(nd.parameters['jsonBody'], j, refs))) as J });
      seguir(0, its);
    } else {
      throw new Error(`el recorredor no sabe correr «${n}» (${nd.type})`);
    }
  }
  return r;
}

/** El item que sale de `Mensaje a enviar` en un turno normal que además pide pin y botón. */
const turno = (extra: J = {}): J => ({
  from: CLIENTE, respuesta: 'Nos encuentras en Calle 1, zona Sur.', phoneNumberId: CFG['phoneNumberId'],
  nombreNegocio: CFG['nombreNegocio'], ...extra,
});
const aCliente = (r: Resultado) => r.envios.filter((e) => e.para === CLIENTE);
const aRecepcion = (r: Resultado) => r.envios.filter((e) => e.para === NUMERO);

for (const archivo of FLUJOS) {
  describe(`${archivo} · cada envío con respaldo`, () => {
    const f = leerFlujo(archivo);

    describe('el cableado', () => {
      it('la salida de error de «Enviar ubicación» y de «Enviar contacto» va al respaldo, y ya no queda sin conectar', () => {
        expect(nodo(f, 'Enviar ubicación').onError).toBe('continueErrorOutput');
        expect(nodo(f, 'Enviar contacto').onError).toBe('continueErrorOutput');
        expect(destinos(f, 'Enviar ubicación', 1)).toEqual(['Respaldo del envío']);
        expect(destinos(f, 'Enviar contacto', 1)).toEqual(['Respaldo del envío']);
        expect(destinos(f, 'Respaldo del envío')).toEqual(['Enviar respaldo']);
        expect(destinos(f, 'Enviar respaldo')).toEqual(['Reportar respaldo (saliente)']);
      });

      it('«Enviar respaldo» NO tiene onError (si Meta también lo rechaza, la ejecución se detiene y se ve)', () => {
        expect(nodo(f, 'Enviar respaldo').onError ?? 'stopWorkflow').toBe('stopWorkflow');
        expect(nodo(f, 'Reportar respaldo (saliente)').onError).toBe('continueRegularOutput');
      });

      it('el rechazo del QR avisa a recepción Y escribe al paciente, por el embudo; el paciente va primero', () => {
        expect(destinos(f, 'Enviar QR de la seña', 1)).toEqual(['QR no enviado']);
        expect(destinos(f, 'QR no enviado')).toEqual(['Mensaje a enviar', '¿Transferir a humano?']);
      });

      it('el código de «Mensaje a enviar» y de «Procesar respuesta» es el mismo en los dos flujos (el candado no se bifurca)', () => {
        const otro = leerFlujo(archivo === FLUJOS[0] ? FLUJOS[1] : FLUJOS[0]);
        for (const n of ['Mensaje a enviar', 'Procesar respuesta', 'Comprobar reserva', 'Procesar reintento', 'Respaldo del envío', 'QR no enviado']) {
          expect(codigoDe(f, n), n).toBe(codigoDe(otro, n));
        }
      });

      it('nada del respaldo es alcanzable desde el candado hacia atrás: no hay camino de «Respaldo del envío» a «Procesar respuesta»', () => {
        const alcanza = (desde: string): Set<string> => {
          const vistos = new Set<string>();
          const pend = [desde];
          while (pend.length) {
            for (const g of Object.values(f.connections[pend.pop() as string] ?? {})) {
              for (const s of g) for (const c of s) if (!vistos.has(c.node)) { vistos.add(c.node); pend.push(c.node); }
            }
          }
          return vistos;
        };
        const a = alcanza('Respaldo del envío');
        for (const n of ['Procesar respuesta', '¿Afirma que agendó?', 'Comprobar reserva', 'Deshacer cita solapada', 'Mensaje a enviar']) {
          expect(a.has(n), n).toBe(false);
        }
      });
    });

    describe('Meta rechaza el pin', () => {
      const r = recorrer(f, 'Mensaje a enviar', [turno({ enviarUbicacion: true, ubicacionLat: CFG['ubicacionLat'], ubicacionLng: CFG['ubicacionLng'] })],
        { fallan: ['Enviar ubicación'] });

      it('el paciente recibe el texto con el enlace al mapa, tras el texto del turno, y la ejecución no se detiene', () => {
        expect(r.detenida).toBeNull();
        const textos = aCliente(r).filter((e) => e.clase === 'text');
        expect(textos.map((e) => e.nodo)).toEqual(['Responder al cliente', 'Enviar respaldo']);
        const respaldo = textos[1] as Envio;
        expect(respaldo.texto).toContain('No pude enviarte el pin');
        expect(respaldo.texto).toContain('https://www.google.com/maps/search/?api=1&query=-16.5%2C-68.15');
        expect(respaldo.texto).not.toMatch(PROMESA);
        expect(respaldo.texto).not.toMatch(VOSEO);
      });

      it('lo que se reporta como saliente es el respaldo con el id que devolvió Meta; el pin que no salió no se reporta', () => {
        const cuerpos = r.reportes.map((x) => x.cuerpo);
        const respaldo = r.reportes.find((x) => x.nodo === 'Reportar respaldo (saliente)');
        expect(respaldo?.cuerpo).toMatchObject({ telefono: CLIENTE, direccion: 'saliente', tipo: 'text', idMeta: 'wamid.Enviar respaldo' });
        expect(String(respaldo?.cuerpo['texto'])).toContain('maps');
        expect(cuerpos.some((c) => c['tipo'] === 'location')).toBe(false);
      });
    });

    describe('Meta rechaza el botón', () => {
      const r = recorrer(f, 'Mensaje a enviar', [turno({ enviarContacto: true })], { fallan: ['Enviar contacto'] });

      it('el paciente recibe el texto con el enlace wa.me de recepción y sin promesas', () => {
        expect(r.detenida).toBeNull();
        const respaldo = aCliente(r).find((e) => e.nodo === 'Enviar respaldo') as Envio;
        expect(respaldo).toBeDefined();
        expect(respaldo.texto).toContain('No pude enviarte el botón');
        expect(respaldo.texto).toContain(`https://wa.me/${NUMERO}?text=`);
        expect(respaldo.texto).not.toMatch(PROMESA);
        expect(respaldo.texto).not.toMatch(VOSEO);
      });

      it('con trato de usted, el respaldo no tutea', () => {
        const u = recorrer(f, 'Mensaje a enviar', [turno({ enviarContacto: true })],
          { fallan: ['Enviar contacto'], cfg: { ...CFG, tratamiento: 'usted' } });
        const t = (aCliente(u).find((e) => e.nodo === 'Enviar respaldo') as Envio).texto;
        expect(t).toContain('No pude enviarle el botón');
        expect(t).toContain('abra este enlace');
        expect(t).not.toMatch(/enviarte|abre este/);
      });
    });

    describe('Meta rechaza el pin Y el botón en el mismo turno', () => {
      it('el paciente recibe los dos respaldos, uno por cada cosa que no salió', () => {
        const r = recorrer(f, 'Mensaje a enviar', [turno({ enviarUbicacion: true, enviarContacto: true, ubicacionLat: -16.5, ubicacionLng: -68.15 })],
          { fallan: ['Enviar ubicación', 'Enviar contacto'] });
        expect(r.detenida).toBeNull();
        const respaldos = aCliente(r).filter((e) => e.nodo === 'Enviar respaldo').map((e) => e.texto);
        expect(respaldos).toHaveLength(2);
        expect(respaldos.some((t) => t.includes('maps'))).toBe(true);
        expect(respaldos.some((t) => t.includes('wa.me'))).toBe(true);
      });
    });

    describe('Meta rechaza el respaldo: último recurso ruidoso', () => {
      it('la ejecución se detiene en «Enviar respaldo» (no se pierde en silencio)', () => {
        const r = recorrer(f, 'Mensaje a enviar', [turno({ enviarContacto: true })], { fallan: ['Enviar contacto', 'Enviar respaldo'] });
        expect(r.detenida).toBe('Enviar respaldo');
      });
    });

    describe('Meta rechaza el QR de la seña', () => {
      const ITEM_SENA: J = {
        from: CLIENTE, nombrePerfil: 'Ana', respuesta: 'Su horario queda reservado 30 minutos. A continuación le llega el QR.',
        reservaVerificada: true, senaActiva: 'si', eventoId: 'ev-1', phoneNumberId: CFG['phoneNumberId'],
        nombreNegocio: CFG['nombreNegocio'], eventoSena: { evento: 'qr_enviado', referencia: 'ev-1' }, reenviarQr: false, enviarUbicacion: false,
      };
      const previoTurno: Record<string, J[]> = { 'Mensaje a enviar': [ITEM_SENA] };
      const r = recorrer(f, 'Preparar seña', [ITEM_SENA], { fallan: ['Enviar QR de la seña'], previo: previoTurno });

      it('(c) el paciente recibe UN mensaje con el botón para escribir a recepción, y sin promesas', () => {
        expect(r.detenida).toBeNull();
        const aElla = aCliente(r);
        const texto = aElla.find((e) => e.nodo === 'Responder al cliente') as Envio;
        expect(texto.texto).toBe('No pude enviarte la imagen del QR de la seña.');
        expect(texto.texto).not.toMatch(PROMESA);
        const boton = aElla.find((e) => e.nodo === 'Enviar contacto') as Envio;
        expect(boton.cuerpo['interactive']?.action?.name).toBe('cta_url');
        expect(boton.cuerpo['interactive']?.action?.parameters?.url).toContain(`https://wa.me/${NUMERO}`);
        // Y nada más: ni el pin ni otro QR (no hay ciclo).
        expect(aElla.map((e) => e.nodo).sort()).toEqual(['Enviar QR de la seña', 'Enviar contacto', 'Responder al cliente'].sort());
        expect(r.pasos.filter((p) => p === 'Enviar QR de la seña')).toHaveLength(1);
      });

      it('recepción recibe el aviso con el motivo, y es el único mensaje a recepción', () => {
        const avisos = aRecepcion(r);
        expect(avisos).toHaveLength(1);
        expect(avisos[0]?.nodo).toBe('Avisar a recepción');
        expect(avisos[0]?.texto).toContain('no se pudo enviar el QR de la seña');
        expect(avisos[0]?.texto).toContain('PENDIENTE DE SEÑA');
      });

      it('el QR que no salió NO se reporta (sin `qr_enviado`); el mensaje al paciente SÍ, con su id y sin el evento de seña', () => {
        expect(r.reportes.some((x) => x.nodo === 'Reportar QR (saliente)')).toBe(false);
        const msg = r.reportes.find((x) => x.nodo === 'Reportar mensaje (saliente)');
        expect(msg?.cuerpo).toMatchObject({ telefono: CLIENTE, tipo: 'text', texto: 'No pude enviarte la imagen del QR de la seña.', idMeta: 'wamid.Responder al cliente' });
        expect(msg?.cuerpo['referencia']).toBeUndefined();
        expect(msg?.cuerpo['evento']).not.toBe('qr_enviado');
      });

      it('si además Meta rechaza el botón, el paciente recibe el enlace wa.me: nunca se queda sin nada', () => {
        const dos = recorrer(f, 'Preparar seña', [ITEM_SENA], { fallan: ['Enviar QR de la seña', 'Enviar contacto'], previo: previoTurno });
        expect(dos.detenida).toBeNull();
        const respaldo = aCliente(dos).find((e) => e.nodo === 'Enviar respaldo') as Envio;
        expect(respaldo.texto).toContain(`https://wa.me/${NUMERO}`);
      });

      it('con trato de usted no tutea; sin número de recepción no sale botón pero sí el texto y el aviso queda con el motivo', () => {
        const u = recorrer(f, 'Preparar seña', [ITEM_SENA], { fallan: ['Enviar QR de la seña'], previo: previoTurno, cfg: { ...CFG, tratamiento: 'usted' } });
        expect((aCliente(u).find((e) => e.nodo === 'Responder al cliente') as Envio).texto).toBe('No pude enviarle la imagen del QR de la seña.');
        const sin = recorrer(f, 'Preparar seña', [ITEM_SENA], { fallan: ['Enviar QR de la seña'], previo: previoTurno, cfg: { ...CFG, numeroRecepcion: '' } });
        expect(aCliente(sin).some((e) => e.nodo === 'Enviar contacto')).toBe(false);
        expect(aCliente(sin).some((e) => e.nodo === 'Responder al cliente')).toBe(true);
      });
    });

    describe('(e) el reenvío del QR no lee un preparador que no corrió', () => {
      const PEDIDO = turno({ reenviarQr: true, respuesta: 'Te lo mando de nuevo.', senaQrEnviadoEn: '2026-10-03T15:00:00Z' });
      const cfgSena: J = { ...CFG, senaQrEnviadoEn: '2026-10-03T15:00:00Z' };

      it('con el QR aceptado, el reporte sale con el teléfono y el pie del reenvío, sin evento `qr_enviado` (no abre otra solicitud)', () => {
        const r = recorrer(f, 'Mensaje a enviar', [PEDIDO], { cfg: cfgSena, previo: { 'Mensaje a enviar': [PEDIDO] } });
        expect(r.detenida).toBeNull();
        const qr = r.reportes.find((x) => x.nodo === 'Reportar QR (saliente)');
        expect(qr, 'el reporte del QR del reenvío se perdía porque leía «Preparar seña»').toBeDefined();
        expect(qr?.cuerpo).toMatchObject({ telefono: CLIENTE, direccion: 'saliente', tipo: 'image', idMeta: 'wamid.Enviar QR de la seña' });
        expect(String(qr?.cuerpo['texto'])).toContain('QR de la seña');
        expect(qr?.cuerpo['evento']).toBeUndefined();
        expect(qr?.cuerpo['referencia']).toBeUndefined();
      });

      it('con el QR rechazado, «QR no enviado» lee el reenvío (antes tiraba la ejecución) y el paciente recibe el mensaje con el botón', () => {
        const r = recorrer(f, 'Mensaje a enviar', [PEDIDO], { cfg: cfgSena, fallan: ['Enviar QR de la seña'], previo: { 'Mensaje a enviar': [PEDIDO] } });
        expect(r.detenida).toBeNull();
        expect(r.pasos).toContain('QR no enviado');
        const mensajes = aCliente(r).filter((e) => e.nodo === 'Responder al cliente').map((e) => e.texto);
        expect(mensajes).toContain('No pude enviarte la imagen del QR de la seña.');
        expect(aCliente(r).some((e) => e.nodo === 'Enviar contacto')).toBe(true);
        expect(aRecepcion(r).map((e) => e.nodo)).toEqual(['Avisar a recepción']);
        // Sin ciclo: el reenvío NO se reintenta (el item de «QR no enviado» sale con `reenviarQr: false`).
        expect(r.pasos.filter((p) => p === 'Enviar QR de la seña')).toHaveLength(1);
      });

      it('la expresión de «Reportar QR (saliente)» ya no nombra solo a «Preparar seña»', () => {
        const cuerpo = String(nodo(f, 'Reportar QR (saliente)').parameters['jsonBody']);
        expect(cuerpo).toContain("$('Preparar reenvío del QR').isExecuted");
        // La reserva nueva sigue reportando el evento y la referencia de la seña.
        const nueva = JSON.parse(String(expresion(cuerpo, { messages: [{ id: 'wamid.X' }] },
          { 'Preparar seña': [{ from: CLIENTE, captionQr: 'pie', eventoId: 'ev-9', calendarioDelEvento: 'cal' }] }))) as J;
        expect(nueva).toMatchObject({ evento: 'qr_enviado', referencia: 'ev-9', calendario: 'cal', idMeta: 'wamid.X' });
      });
    });

    describe('el camino normal no cambia: 0 mensajes agregados', () => {
      it('sin fallas, el respaldo no sale: pin y botón entregados = texto + pin + botón, y nada más', () => {
        const r = recorrer(f, 'Mensaje a enviar', [turno({ enviarUbicacion: true, enviarContacto: true, ubicacionLat: -16.5, ubicacionLng: -68.15 })]);
        expect(aCliente(r).map((e) => e.nodo).sort()).toEqual(['Enviar contacto', 'Enviar ubicación', 'Responder al cliente'].sort());
        expect(r.pasos).not.toContain('Respaldo del envío');
        expect(r.pasos).not.toContain('Enviar respaldo');
      });

      it('un turno de texto simple manda UN solo mensaje', () => {
        const r = recorrer(f, 'Mensaje a enviar', [turno()]);
        expect(r.envios.map((e) => e.nodo)).toEqual(['Responder al cliente']);
      });

      it('la seña entregada: texto + QR, y el QR se reporta con su evento', () => {
        const item: J = { from: CLIENTE, respuesta: 'Reservado.', reservaVerificada: true, senaActiva: 'si', eventoId: 'ev-1', phoneNumberId: '1000000001' };
        const r = recorrer(f, 'Preparar seña', [item], { previo: { 'Mensaje a enviar': [item] } });
        expect(r.envios.map((e) => e.nodo)).toEqual(['Enviar QR de la seña']);
        expect(r.reportes.find((x) => x.nodo === 'Reportar QR (saliente)')?.cuerpo).toMatchObject({ evento: 'qr_enviado', referencia: 'ev-1' });
        expect(r.pasos).not.toContain('QR no enviado');
      });
    });

    describe('(d) lo que se dice de la derivación se cumple', () => {
      const procesar = (output: string, cfg: J) => correr(codigoDe(f, 'Procesar respuesta'),
        [{ output, intermediateSteps: [] }],
        { 'Normalizar entrada': [{ from: CLIENTE, userInput: '¿Hacen estética facial?' }], 'Config del negocio': [cfg] })[0]?.json ?? {};

      it('negar un servicio deriva con el botón y SIN «ya le paso su consulta» ni «te escribe por acá»', () => {
        const r = procesar('No realizamos estética facial.', { nombreNegocio: 'Negocio', numeroRecepcion: NUMERO, tratamiento: 'tutear' });
        expect(r['transferir']).toBe(true);
        expect(r['respuesta']).toBe('Sobre eso te asesora una persona del equipo. Toca el botón para escribirle directo a recepción.');
        expect(String(r['respuesta'])).not.toMatch(PROMESA);
        expect(String(r['respuesta'])).not.toMatch(/escribe por ac[aá]|ya le pas/i);
      });

      it('de usted, y sin número de recepción no nombra un botón que no existe', () => {
        const u = procesar('No realizamos estética facial.', { nombreNegocio: 'Negocio', numeroRecepcion: NUMERO, tratamiento: 'usted' });
        expect(u['respuesta']).toBe('Sobre eso le asesora una persona del equipo. Toque el botón para escribirle directo a recepción.');
        const sin = procesar('No realizamos estética facial.', { nombreNegocio: 'Negocio', numeroRecepcion: '', tratamiento: 'tutear' });
        expect(sin['respuesta']).toBe('Sobre eso te asesora una persona del equipo.');
      });

      it('el prompt del tercer rechazo ya no manda decir que «un humano tomará el chat»: lo prohíbe', () => {
        const p = String(nodo(f, 'AI Agent (Sofía)').parameters['options'].systemMessage);
        expect(p).not.toContain('avisa que un humano');
        expect(p).toContain('No digas que ya avisaste ni que alguien tomará el chat.');
        expect(p).toContain('dile en una línea que lo pasas con recepción');
        expect(p).toContain('[TRANSFERIR]');
      });
    });
  });
}
