// @vitest-environment jsdom
/**
 * «RETOMAR CONVERSACIÓN» EN LA CONSOLA: EL COSTO, LA CASILLA Y CUÁNDO SE OFRECE (bloque R3, plan de Retomar 23/11/2026).
 *
 * Lo que se defiende, negando:
 *  A. LAS CIFRAS SON DEL PLAN (C9): `limitesDeRetomar` da 7 días, 20 por día y 100 por mes a TODOS (D-R3), y el precio de la
 *     plantilla (`PLANTILLA_UTILIDAD_USD`) con su fuente salen de `planes.ts`. Ni la pantalla ni `lib/turno.ts` escriben la cifra.
 *  B. EL AVISO DE COSTO cambia con la titularidad (comercio: Meta le cobra; novuchat: NovuChat absorbe hasta el tope mensual;
 *     sin dato: no afirma quién paga) y, mientras la tarifa no esté verificada (D-R5), lo dice con su fuente.
 *  C. EL MODAL EXIGE LA CASILLA: sin marcarla no se llama a `retomarConversacion`, ni forzando el clic; marcada, se llama UNA
 *     vez y SOLO con `{ tenantId, conversacionId, claveIdempotencia }`; un reintento sin respuesta usa la MISMA clave.
 *  D. CUÁNDO SE VE «Retomar»: solo con la ventana cerrada, las dos banderas EXACTAS, sin `noContactar` ni bloqueo, con dato de
 *     ventana y para quien gestiona. Cada condición se niega por separado.
 *  E. EL HILO Y EL CAMPO: la plantilla se rotula «Plantilla para retomar»; con la ventana cerrada y `retomadoEn` el campo dice
 *     «Esperando la respuesta del cliente».
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLANTILLA_UTILIDAD_FUENTE, PLANTILLA_UTILIDAD_USD, PLANTILLA_UTILIDAD_VERIFICADA_EL, PLANES, TARIFAS, limitesDeRetomar,
} from '../../functions/src/central/cuenta/planes';
import {
  ROTULO_PLANTILLA, TEXTO_ESPERANDO_CLIENTE, accionesDeTurno, cifraDePlantilla, contextoDeAviso, ejecutarRetomar, esPlantilla,
  esperandoRespuestaDelCliente, fuenteDeLaCifra, puedeRetomarDeFicha, quienPagaLaPlantilla, retomadaPendienteDe, retomadoEnDe,
  textoAvisoRetomar, textoErrorTurno, type CapaTurno, type ContextoDeAviso, type EntradaAcciones,
} from '../../web/src/central/lib/turno';
import { accionesSinBloqueadas } from '../../web/src/central/lib/bloqueo';

const aqui = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(aqui, '..', '..');
const codigo = (ruta: string) => readFileSync(join(ADMIN, ruta), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const React = desdeWeb('react') as typeof import('react');
const { createRoot } = desdeWeb('react-dom/client') as typeof import('react-dom/client');
const { flushSync } = desdeWeb('react-dom') as typeof import('react-dom');
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { RetomarConversacion } = await import('../../web/src/central/componentes/RetomarConversacion');
const { EscribirComoPersona } = await import('../../web/src/central/componentes/EscribirComoPersona');

const AHORA = Date.now();
const HORA = 3_600_000;

// ── A. las cifras son del plan ────────────────────────────────────────────────

describe('A. las cifras salen de `planes.ts` (C9, D-R3, D-R5)', () => {
  it('7 días entre retomadas, 20 por día y 100 por mes, para TODOS los planes, tarifas y titularidades', () => {
    for (const plan of [...Object.keys(PLANES), 'demostracion', undefined, 'no-existe']) {
      for (const tarifa of TARIFAS) {
        for (const tit of ['novuchat', 'comercio'] as const) {
          expect(limitesDeRetomar(plan, tarifa, tit), `${String(plan)}/${tarifa}/${tit}`).toEqual({ diasEntreRetomadas: 7, porDia: 20, porMes: 100 });
        }
      }
    }
  });

  it('el precio de la plantilla es 0,0113 USD, con fuente, y NO está verificado (D-R5): la fecha es `null`', () => {
    expect(PLANTILLA_UTILIDAD_USD).toBe(0.0113);
    expect(PLANTILLA_UTILIDAD_FUENTE).toMatch(/base comercial/i);
    expect(PLANTILLA_UTILIDAD_VERIFICADA_EL).toBeNull();
  });

  it('NEGATIVA de fuente: ni la pantalla ni la lógica de la consola escriben la cifra (ni la 0,0113 ni la 100 del tope)', () => {
    for (const ruta of ['web/src/central/componentes/RetomarConversacion.tsx', 'web/src/central/lib/turno.ts', 'web/src/central/componentes/BarraTurno.tsx']) {
      const c = codigo(ruta);
      expect(c, ruta).not.toMatch(/0[.,]0113/);
      expect(c, ruta).not.toMatch(/0[.,]0130/);
    }
    // el tope mensual del aviso se lee de `limitesDeRetomar`, no se escribe
    expect(codigo('web/src/central/lib/turno.ts')).toContain("const l = limitesDeRetomar(null, TARIFA_DE_RESPALDO, 'novuchat');");
    expect(codigo('web/src/central/lib/turno.ts')).toContain('hasta ${l.porDia} por día y ${l.porMes} por mes');
    expect(codigo('web/src/central/lib/turno.ts')).toContain('String(PLANTILLA_UTILIDAD_USD)');
  });
});

// ── B. el aviso de costo ──────────────────────────────────────────────────────

describe('B. el aviso de costo depende de la TARIFA y de la línea (D-R2 a)', () => {
  const cifra = String(PLANTILLA_UTILIDAD_USD).replace('.', ',');
  const ctx = (tarifa: ContextoDeAviso['tarifa'], titularidad: ContextoDeAviso['titularidad'], linea: string | null = null): ContextoDeAviso => ({ tarifa, titularidad, linea });
  const l = limitesDeRetomar(null, 'meta_incluido', 'novuchat');

  it('las 4 combinaciones tarifa × titularidad: NovuChat absorbe SOLO con `meta_incluido` y una línea suya', () => {
    expect(quienPagaLaPlantilla(ctx('meta_incluido', 'novuchat'))).toBe('novuchat');
    expect(quienPagaLaPlantilla(ctx('meta_incluido', 'comercio'))).toBe('comercio');   // la línea es del comercio: Meta le factura a él
    expect(quienPagaLaPlantilla(ctx('estandar', 'novuchat'))).toBe('comercio');        // `estandar`: Meta cobra aparte al comercio
    expect(quienPagaLaPlantilla(ctx('estandar', 'comercio'))).toBe('comercio');
    expect(textoAvisoRetomar(ctx('meta_incluido', 'novuchat'))).toContain('NovuChat absorbe ese costo, sin cobrarle a su negocio');
    for (const [t, tit] of [['meta_incluido', 'comercio'], ['estandar', 'novuchat'], ['estandar', 'comercio']] as const) {
      const x = textoAvisoRetomar(ctx(t, tit));
      expect(x, `${t}/${tit}`).toContain('Meta cobra aparte a su negocio');
      expect(x, `${t}/${tit}`).not.toContain('NovuChat absorbe');
    }
  });

  it('NEGATIVA: sin tarifa o sin titularidad (con `meta_incluido`) no se afirma quién paga', () => {
    for (const c of [ctx(null, null), ctx(null, 'novuchat'), ctx(null, 'comercio'), ctx('meta_incluido', null)]) {
      expect(quienPagaLaPlantilla(c)).toBeNull();
      const x = textoAvisoRetomar(c);
      expect(x).toContain('el costo lo absorbe NovuChat o Meta se lo cobra a su negocio');
      expect(x).not.toContain('NovuChat absorbe ese costo');
      expect(x).not.toContain('Meta cobra aparte a su negocio');
    }
    expect(textoAvisoRetomar()).toBe(textoAvisoRetomar(ctx(null, null)));
  });

  it('la cifra sale de planes.ts, con su fuente y, sin verificar (D-R5), lo dice', () => {
    expect(cifraDePlantilla()).toBe(cifra);
    for (const c of [ctx('estandar', 'comercio'), ctx('meta_incluido', 'novuchat'), ctx(null, null)]) {
      const t = textoAvisoRetomar(c);
      expect(t).toContain(`aprox. USD ${cifra} por envío`);
      expect(t).toContain('tarifa de Meta para Bolivia');
      expect(t).toContain(PLANTILLA_UTILIDAD_FUENTE);
      expect(t).toContain('todavía sin verificar en la tarifa oficial de Meta');
      expect(t).toContain('Si el cliente responde, se abre una conversación nueva que cuenta en su plan.');
    }
    expect(fuenteDeLaCifra()).toContain('sin verificar');
  });

  it('los 20 por día y 100 por mes se dicen como límite de envío de TODOS los negocios (también en el del comercio), no como cobro posterior', () => {
    for (const c of [ctx('estandar', 'comercio'), ctx('meta_incluido', 'novuchat'), ctx(null, null)]) {
      const t = textoAvisoRetomar(c);
      expect(t).toContain(`Es un límite de envío para todos los negocios: hasta ${l.porDia} por día y ${l.porMes} por mes.`);
      expect(t).not.toMatch(/después se cobra|luego se cobra/i);
    }
    expect(textoAvisoRetomar(ctx('estandar', 'comercio'))).toContain('hasta 20 por día y 100 por mes');
  });

  it('el aviso nombra la línea si la ficha la tiene; si no, queda genérico', () => {
    expect(textoAvisoRetomar(ctx('estandar', 'comercio', '1234'))).toContain('por la línea terminada en 1234');
    expect(textoAvisoRetomar(ctx('estandar', 'comercio', null))).not.toContain('línea terminada');
  });

  it('`contextoDeAviso`: la titularidad de la línea de la conversación manda; si no consta, un número propio basta; sin números, no consta', () => {
    const ejes = { tarifa: 'meta_incluido', numeros: [{ phoneNumberId: 'AAA111', titularidad: 'novuchat' }, { phoneNumberId: 'BBB222', titularidad: 'comercio' }] };
    expect(contextoDeAviso(ejes, 'AAA111')).toEqual({ tarifa: 'meta_incluido', titularidad: 'novuchat', linea: 'A111' });
    expect(contextoDeAviso(ejes, 'BBB222')).toEqual({ tarifa: 'meta_incluido', titularidad: 'comercio', linea: 'B222' });
    expect(contextoDeAviso(ejes, undefined)).toEqual({ tarifa: 'meta_incluido', titularidad: 'comercio', linea: null });
    expect(contextoDeAviso(ejes, '')).toMatchObject({ titularidad: 'comercio', linea: null });
    expect(contextoDeAviso({ tarifa: 'estandar', numeros: [] }, 'AAA111')).toEqual({ tarifa: 'estandar', titularidad: null, linea: null });
    for (const v of [undefined, null, {}, { tarifa: 'rara' }]) expect(contextoDeAviso(v as never, 'AAA111'), JSON.stringify(v)).toEqual({ tarifa: null, titularidad: null, linea: null });
  });

  it('el servidor manda la tarifa en `ejesDeCuenta` y la consola la lee de ahí', () => {
    expect(codigo('functions/src/central/ejesDeCuenta.ts')).toMatch(/^\s*tarifa,$/m);
    expect(codigo('web/src/central/lib/ejes.ts')).toContain("tarifa?: 'estandar' | 'meta_incluido'");
    expect(codigo('web/src/central/componentes/DetalleConversacion.tsx')).toContain('contextoDeAviso(p.ejes, ficha.phoneNumberId)');
  });
});

// ── C. el modal ───────────────────────────────────────────────────────────────

describe('C. el modal exige la casilla antes de llamar', () => {
  let cont: HTMLElement;
  let raiz: ReturnType<typeof createRoot>;
  let llamadas: Array<Record<string, unknown>>;
  let respuestas: Array<() => Promise<unknown>>;
  const capa = (): CapaTurno => ({
    tomar: vi.fn(), devolver: vi.fn(), enviar: vi.fn(),
    retomar: async (e) => { llamadas.push({ ...e }); const r = respuestas.shift() ?? (async () => ({ estado: 'pendiente', mensajeId: 'm1' })); return r(); },
  });
  const AV_COMERCIO: ContextoDeAviso = { tarifa: 'estandar', titularidad: 'comercio', linea: null };
  const AV_NOVUCHAT: ContextoDeAviso = { tarifa: 'meta_incluido', titularidad: 'novuchat', linea: null };
  const pintar = (aviso: ContextoDeAviso = AV_COMERCIO, habilitados = true) => flushSync(() => raiz.render(
    React.createElement(RetomarConversacion, { tenantId: 'demo', conversacionId: 'wa_59170000001', aviso, habilitados, capa: capa() })));
  const boton = (re: RegExp) => [...cont.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '')) as HTMLButtonElement | undefined;
  const casilla = () => cont.querySelector('[data-testid="retomar-casilla"]') as HTMLInputElement | null;
  const asentar = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    llamadas = []; respuestas = [];
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    cont = document.createElement('div'); document.body.appendChild(cont); raiz = createRoot(cont);
  });
  afterEach(() => {
    flushSync(() => raiz.unmount()); cont.remove(); vi.restoreAllMocks();
    delete (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('antes de pulsar «Retomar conversación» no hay modal ni llamada; al pulsarlo aparece el aviso y la casilla SIN marcar', () => {
    pintar();
    expect(cont.querySelector('[data-testid="retomar-modal"]')).toBeNull();
    flushSync(() => boton(/Retomar conversación/)!.click());
    expect(cont.querySelector('[data-testid="retomar-modal"]')).not.toBeNull();
    expect(cont.querySelector('[data-testid="retomar-aviso"]')!.textContent).toBe(textoAvisoRetomar(AV_COMERCIO));
    expect(casilla()!.checked).toBe(false);
    expect(boton(/Enviar plantilla/)!.disabled).toBe(true);
    expect(llamadas).toHaveLength(0);
  });

  it('NEGATIVA: sin la casilla no se llama, ni forzando el clic en el botón deshabilitado', async () => {
    pintar();
    flushSync(() => boton(/Retomar conversación/)!.click());
    const b = boton(/Enviar plantilla/)!;
    b.disabled = false;                 // se fuerza: la guarda del código vuelve a comprobar la casilla
    b.click(); await asentar();
    expect(llamadas).toHaveLength(0);
  });

  it('con la casilla marcada se llama UNA vez y SOLO con tenantId, conversacionId y claveIdempotencia; el doble clic no duplica', async () => {
    pintar();
    flushSync(() => boton(/Retomar conversación/)!.click());
    flushSync(() => casilla()!.click());
    expect(boton(/Enviar plantilla/)!.disabled).toBe(false);
    const b = boton(/Enviar plantilla/)!;
    b.click(); b.click(); await asentar();
    expect(llamadas).toHaveLength(1);
    expect(Object.keys(llamadas[0]!).sort()).toEqual(['claveIdempotencia', 'conversacionId', 'tenantId']);
    expect(llamadas[0]).toMatchObject({ tenantId: 'demo', conversacionId: 'wa_59170000001' });
    expect(String(llamadas[0]!['claveIdempotencia'])).toMatch(/^[A-Za-z0-9_.:-]{16,128}$/);
    expect(cont.querySelector('[data-testid="retomar-modal"]')).toBeNull();           // se cerró
    expect(boton(/Plantilla enviada/)!.disabled).toBe(true);                          // y no se puede repetir
  });

  it('un error muestra el texto fijo de su CÓDIGO (topes) y deja el modal abierto; no sale `e.message`', async () => {
    respuestas.push(async () => { throw Object.assign(new Error('detalle interno'), { code: 'functions/resource-exhausted', details: { tope: 'retomarDia' } }); });
    pintar();
    flushSync(() => boton(/Retomar conversación/)!.click());
    flushSync(() => casilla()!.click());
    boton(/Enviar plantilla/)!.click(); await asentar();
    const alerta = cont.querySelector('[role="alert"]')!.textContent!;
    expect(alerta).toContain('retomar hoy');
    expect(alerta).not.toContain('detalle interno');
    expect(cont.querySelector('[data-testid="retomar-modal"]')).not.toBeNull();
  });

  it('sin respuesta del servidor (red) el reintento usa LA MISMA clave: el servidor lo reconoce y no manda otra plantilla', async () => {
    respuestas.push(async () => { throw Object.assign(new Error('x'), { code: 'functions/unavailable' }); });
    pintar();
    flushSync(() => boton(/Retomar conversación/)!.click());
    flushSync(() => casilla()!.click());
    boton(/Enviar plantilla/)!.click(); await asentar();
    expect(cont.querySelector('[role="alert"]')!.textContent).toBeTruthy();
    boton(/Enviar plantilla/)!.click(); await asentar();
    expect(llamadas).toHaveLength(2);
    expect(llamadas[1]!['claveIdempotencia']).toBe(llamadas[0]!['claveIdempotencia']);
  });

  it('con el comercio no activo el botón se ve pero no se puede pulsar', () => {
    pintar(AV_COMERCIO, false);
    expect(boton(/Retomar conversación/)!.disabled).toBe(true);
  });

  it('el aviso del modal cambia con la tarifa y la titularidad', () => {
    pintar(AV_NOVUCHAT);
    flushSync(() => boton(/Retomar conversación/)!.click());
    expect(cont.querySelector('[data-testid="retomar-aviso"]')!.textContent).toBe(textoAvisoRetomar(AV_NOVUCHAT));
  });

  it('`ejecutarRetomar` nunca reintenta solo y no inventa un teléfono ni un texto en la llamada', async () => {
    const retomar = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'functions/internal' }); });
    const r = await ejecutarRetomar({ tomar: vi.fn(), devolver: vi.fn(), enviar: vi.fn(), retomar } as CapaTurno, { tenantId: 't', conversacionId: 'wa_1' }, null);
    expect(retomar).toHaveBeenCalledTimes(1);
    expect(r.abierta).toBe(true);
    expect(Object.keys((retomar.mock.calls[0] as unknown as [Record<string, unknown>])[0]).sort()).toEqual(['claveIdempotencia', 'conversacionId', 'tenantId']);
  });

  it('FOCO: al abrir va a la casilla; Tab y Mayús+Tab quedan dentro del modal; al cerrar vuelve al botón «Retomar conversación»', () => {
    document.body.appendChild(cont);
    pintar();
    const abrir = boton(/Retomar conversación/)!;
    abrir.focus();
    flushSync(() => abrir.click());
    expect(document.activeElement).toBe(casilla());
    const tab = (shift: boolean) => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }));
    // con la casilla sin marcar el botón «Enviar plantilla» está deshabilitado: el ciclo es casilla ↔ Cancelar
    const cancelar = boton(/Cancelar/)!;
    cancelar.focus();
    tab(false);
    expect(document.activeElement).toBe(casilla());
    casilla()!.focus();
    tab(true);
    expect(document.activeElement).toBe(cancelar);
    // el foco que se escapó del modal vuelve adentro
    (document.body as HTMLElement).focus();
    abrir.focus();
    tab(false);
    expect(cont.querySelector('[data-testid="retomar-modal"]')!.contains(document.activeElement)).toBe(true);
    // Escape cierra y devuelve el foco al botón
    flushSync(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(cont.querySelector('[data-testid="retomar-modal"]')).toBeNull();
    expect(document.activeElement).toBe(boton(/Retomar conversación/));
  });

  it('el texto de `failed-precondition` de Retomar nombra noContactar, bloqueo, canal y clave usada; `permission-denied` tiene el suyo', () => {
    const f = textoErrorTurno('retomar', 'failed-precondition');
    for (const frase of ['pidió que no se le escriba', 'bloqueado', 'canal de WhatsApp', 'otros datos', 'ventana de 24 h esté abierta', 'ya se haya enviado una plantilla', 'plantilla no esté disponible']) {
      expect(f, frase).toContain(frase);
    }
    expect(textoErrorTurno('retomar', 'permission-denied')).toContain('Retomar conversaciones todavía no está activo para su negocio');
    expect(textoErrorTurno('enviar', 'permission-denied')).toContain('No tiene permiso para intervenir');   // el de siempre no cambia
  });

  it('los textos de error de Retomar salen del código y son fijos', () => {
    expect(textoErrorTurno('retomar', 'resource-exhausted', { tope: 'retomarMes' })).toContain('este mes');
    expect(textoErrorTurno('retomar', 'resource-exhausted', { tope: 'retomarDia' })).toContain('hoy');
    expect(textoErrorTurno('retomar', 'failed-precondition')).toContain('No se pudo retomar');
    expect(textoErrorTurno('retomar', 'permission-denied')).toContain('Retomar conversaciones todavía no está activo');
    expect(textoErrorTurno('retomar', 'cosa-rara')).toBe('No se pudo retomar la conversación. Intente de nuevo.');
  });
});

// ── D. cuándo se ve ───────────────────────────────────────────────────────────

describe('D. cuándo se ve «Retomar» (cada condición se niega por separado)', () => {
  const base: EntradaAcciones = {
    situacion: 'asistente', puedeGestionar: true, esAdmin: false, comercioActivo: true, puedeIntervenir: true,
    ventanaAbierta: false, puedeRetomar: true, ventanaConDato: true, noContactar: false, bloqueada: false,
  };
  it('el caso feliz: ventana cerrada con dato, las dos banderas, sin noContactar ni bloqueo', () => {
    expect(accionesDeTurno(base).verRetomar).toBe(true);
  });
  it.each([
    ['sin la bandera de retomar', { puedeRetomar: false }],
    ['con la bandera ausente', { puedeRetomar: undefined }],
    ['sin la bandera de escribir (intervenir)', { puedeIntervenir: false }],
    ['con la ventana abierta (se usa Tomar)', { ventanaAbierta: true }],
    ['sin dato de cuándo escribió el cliente', { ventanaConDato: false }],
    ['con `noContactar`', { noContactar: true }],
    ['con el contacto bloqueado', { bloqueada: true }],
    ['sin permiso de gestionar (propietario o soporte)', { puedeGestionar: false }],
    ['si ya responde una persona (mía)', { situacion: 'mio' }],
    ['si ya responde una persona (ajena)', { situacion: 'ajeno' }],
  ] as const)('NEGATIVA: no se ve %s', (_t, cambio) => {
    expect(accionesDeTurno({ ...base, ...cambio } as EntradaAcciones).verRetomar).toBe(false);
  });
  describe('retomada pendiente (el servidor rechazaría con `retomadaPendiente`)', () => {
    const ultimo = AHORA - 3 * 24 * HORA;
    const conRetomada = (ultimaRetomadaEn: number | null, ahora = AHORA): EntradaAcciones => ({ ...base, ultimoEntranteEn: ultimo, ultimaRetomadaEn, ahora });
    it('NEGATIVA: con una plantilla posterior al último mensaje del cliente y dentro de 7 días no se ve «Retomar»; se dice que se espera', () => {
      const a = accionesDeTurno(conRetomada(ultimo + HORA));
      expect(a.verRetomar).toBe(false);
      expect(a.esperandoRetomada).toBe(true);
      expect(a.sinTomarPorVentana).toBe(true);
      const antes = AHORA - 7 * 24 * HORA;      // el cliente escribió hace 7 días y se retomó hace 6: todavía dentro del plazo
      expect(accionesDeTurno({ ...base, ultimoEntranteEn: antes, ultimaRetomadaEn: AHORA - 6 * 24 * HORA, ahora: AHORA }).verRetomar).toBe(false);
    });
    it('pasados los `diasEntreRetomadas` (7) de planes.ts, o si el cliente respondió después, vuelve a verse', () => {
      const dias = limitesDeRetomar(null, 'meta_incluido', 'novuchat').diasEntreRetomadas;
      expect(dias).toBe(7);
      expect(accionesDeTurno(conRetomada(ultimo + HORA, ultimo + HORA + dias * 24 * HORA)).verRetomar).toBe(true);
      expect(accionesDeTurno(conRetomada(ultimo - HORA)).verRetomar).toBe(true);            // la plantilla es ANTERIOR al último entrante
      expect(accionesDeTurno(conRetomada(null)).verRetomar).toBe(true);
      expect(accionesDeTurno(conRetomada(null)).esperandoRetomada).toBe(false);
    });
    it('`retomadaPendienteDe` falla hacia mostrar el botón con datos ausentes (el servidor decide); el plazo sale del plan, no de la pantalla', () => {
      expect(retomadaPendienteDe(undefined, ultimo, AHORA)).toBe(false);
      expect(retomadaPendienteDe(ultimo + HORA, null, AHORA)).toBe(false);
      expect(retomadaPendienteDe(ultimo + HORA, ultimo, undefined)).toBe(false);
      expect(retomadaPendienteDe(ultimo + HORA, ultimo, AHORA)).toBe(true);
      expect(codigo('web/src/central/lib/turno.ts')).toContain("limitesDeRetomar(null, TARIFA_DE_RESPALDO, 'novuchat').diasEntreRetomadas");
    });
    it('sin permiso de gestionar no se ve ni el aviso de espera', () => {
      expect(accionesDeTurno({ ...conRetomada(ultimo + HORA), puedeGestionar: false }).esperandoRetomada).toBe(false);
    });
    it('el Detalle pasa `ultimaRetomadaEn`, `ultimoEntranteEn` y el reloj; la ficha los lee de la conversación', () => {
      const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');
      expect(d).toContain('ultimaRetomadaEn: ficha.ultimaRetomadaEn, ultimoEntranteEn: ficha.ultimoEntranteEn, ahora: p.ahora');
      expect(codigo('web/src/central/lib/conversaciones.ts')).toContain("ultimaRetomadaEn: ms(x['ultimaRetomadaEn'])");
    });
  });
  it('el bloqueo también lo quita en `accionesSinBloqueadas` (no solo en el cálculo)', () => {
    expect(accionesSinBloqueadas(accionesDeTurno(base), true).verRetomar).toBe(false);
  });
  it('la bandera de la ficha es `true` EXACTO y exige las dos de intervenir', () => {
    const ok = { consolaConversaciones: 'nueva', personaPuedeEscribir: true, personaPuedeRetomar: true };
    expect(puedeRetomarDeFicha(ok)).toBe(true);
    for (const v of [undefined, false, 'true', 1, null, {}]) {
      expect(puedeRetomarDeFicha({ ...ok, personaPuedeRetomar: v }), String(v)).toBe(false);
    }
    expect(puedeRetomarDeFicha({ ...ok, personaPuedeEscribir: false })).toBe(false);
    expect(puedeRetomarDeFicha({ ...ok, consolaConversaciones: undefined })).toBe(false);
    expect(puedeRetomarDeFicha(null)).toBe(false);
  });
  it('el hook de la bandera falla cerrado y la callable se llama solo con tres campos', () => {
    const h = codigo('web/src/central/componentes/ConsolaConversaciones.tsx');
    expect(h).toMatch(/usePersonaPuedeRetomar[\s\S]*useState\(false\)[\s\S]*setPuede\(puedeRetomarDeFicha\(d\.data\(\)\)\)[\s\S]*setPuede\(false\)/);
    // la titularidad solo se pide con Retomar activo
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain("useEjesDeCuenta(puedeRetomar ? tenantId : '')");
  });
});

// ── E. el hilo y el campo ─────────────────────────────────────────────────────

describe('E. el mensaje de plantilla y «Esperando la respuesta del cliente»', () => {
  const ts = (ms: number) => ({ toMillis: () => ms });

  it('el hilo rotula la plantilla como «Plantilla para retomar», sin su texto, y le deja su estado de envío', () => {
    expect(ROTULO_PLANTILLA).toBe('Plantilla para retomar');
    expect(esPlantilla('plantilla')).toBe(true);
    for (const t of ['text', 'image', '', undefined, 'Plantilla']) expect(esPlantilla(t), String(t)).toBe(false);
    const d = codigo('web/src/central/componentes/DetalleConversacion.tsx');
    expect(d).toContain('esPlantilla(x.tipo)');
    expect(d).toContain('{ROTULO_PLANTILLA}');
    expect(d).toContain('{esPersona && x.estadoEnvio && (');      // el estado (Enviando…, Enviado a WhatsApp…) sigue saliendo
    expect(d).toContain('retomadoEn={retomadoEn}');
  });

  it('`retomadoEnDe` lee solo una fecha de Firestore; lo demás es `null`', () => {
    expect(retomadoEnDe({ responde: 'persona', retomadoEn: ts(123) })).toBe(123);
    for (const v of [undefined, null, 'x', 5, [], {}, { retomadoEn: 'ayer' }, { retomadoEn: { toMillis: () => 'x' } }]) expect(retomadoEnDe(v), JSON.stringify(v)).toBeNull();
  });

  it('esperando: ventana CERRADA y `retomadoEn` no anterior al último entrante; abierta o sin retomar, no', () => {
    const ultimo = AHORA - 30 * HORA;
    expect(esperandoRespuestaDelCliente(ultimo + HORA, ultimo, AHORA)).toBe(true);
    expect(esperandoRespuestaDelCliente(ultimo, ultimo, AHORA)).toBe(true);                 // `>=`, la misma comparación de Core
    expect(esperandoRespuestaDelCliente(ultimo - HORA, ultimo, AHORA)).toBe(false);         // el cliente respondió después de retomar
    expect(esperandoRespuestaDelCliente(null, ultimo, AHORA)).toBe(false);
    expect(esperandoRespuestaDelCliente(AHORA - HORA, null, AHORA)).toBe(false);
    expect(esperandoRespuestaDelCliente(AHORA, AHORA - HORA, AHORA)).toBe(false);           // ventana abierta
  });

  const campo = (o: { ultimoEntranteEn: number | null; retomadoEn?: number | null }) => renderToStaticMarkup(React.createElement(EscribirComoPersona, {
    miUid: 'u', tenantId: 'demo', conversacionId: 'wa_59170000002', habilitados: true,
    capa: { tomar: vi.fn(), devolver: vi.fn(), enviar: vi.fn(), retomar: vi.fn() } as CapaTurno, ...o,
  }));

  it('el campo dice «Esperando la respuesta del cliente» con la ventana cerrada y `retomadoEn`', () => {
    const ultimo = Date.now() - 30 * HORA;
    const h = campo({ ultimoEntranteEn: ultimo, retomadoEn: Date.now() - 60_000 });
    expect(h).toContain('Esperando la respuesta del cliente');
    expect(h).toContain(TEXTO_ESPERANDO_CLIENTE.slice(0, 40));
    expect(h).toContain('disabled=""');                                                      // y no se puede escribir
  });

  it('NEGATIVA: sin `retomadoEn` dice lo de siempre (ventana cerrada), no «Esperando»; con la ventana abierta, ninguno de los dos', () => {
    const sin = campo({ ultimoEntranteEn: Date.now() - 30 * HORA });
    expect(sin).not.toContain('Esperando la respuesta');
    expect(sin).toContain('está cerrada');
    expect(sin).not.toContain('plantillas no están disponibles');                           // ya no se afirma lo que dejó de ser cierto
    const abierta = campo({ ultimoEntranteEn: Date.now() - HORA, retomadoEn: Date.now() - 2 * HORA });
    expect(abierta).not.toContain('Esperando la respuesta');
    expect(abierta).not.toContain('está cerrada');
  });
});
