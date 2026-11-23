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
  ROTULO_PLANTILLA, TEXTO_ESPERANDO_CLIENTE, accionesDeTurno, cifraDePlantilla, ejecutarRetomar, esPlantilla,
  esperandoRespuestaDelCliente, fuenteDeLaCifra, puedeRetomarDeFicha, retomadoEnDe, textoAvisoRetomar, textoErrorTurno,
  titularidadParaAviso, type CapaTurno, type EntradaAcciones,
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
    expect(codigo('web/src/central/lib/turno.ts')).toContain("limitesDeRetomar(null, TARIFA_DE_RESPALDO, 'novuchat').porMes");
    expect(codigo('web/src/central/lib/turno.ts')).toContain('String(PLANTILLA_UTILIDAD_USD)');
  });
});

// ── B. el aviso de costo ──────────────────────────────────────────────────────

describe('B. el aviso de costo depende de quién paga Meta', () => {
  const cifra = String(PLANTILLA_UTILIDAD_USD).replace('.', ',');

  it('titularidad `comercio`: Meta cobra aparte a su negocio, con la cifra de planes.ts y su fuente', () => {
    const t = textoAvisoRetomar('comercio');
    expect(cifraDePlantilla()).toBe(cifra);
    expect(t).toContain('Meta cobra aparte a su negocio');
    expect(t).toContain(`aprox. USD ${cifra} por envío`);
    expect(t).toContain('tarifa de Meta para Bolivia');
    expect(t).toContain(PLANTILLA_UTILIDAD_FUENTE);
    expect(t).toContain('Si el cliente responde, se abre una conversación nueva que cuenta en su plan.');
    expect(t).not.toMatch(/NovuChat absorbe/);
  });

  it('titularidad `novuchat` (D-R2 a): NovuChat absorbe el costo hasta el tope mensual y no se le cobra al comercio', () => {
    const t = textoAvisoRetomar('novuchat');
    expect(t).toContain('NovuChat absorbe ese costo, sin cobrarle a su negocio');
    expect(t).toContain(`hasta ${limitesDeRetomar(null, 'meta_incluido', 'novuchat').porMes} envíos al mes`);
    expect(t).toContain(`USD ${cifra}`);
    expect(t).not.toContain('cobra aparte a su negocio');
  });

  it('los dos textos son distintos, y sin dato de titularidad no se afirma quién paga', () => {
    const [c, n, x] = [textoAvisoRetomar('comercio'), textoAvisoRetomar('novuchat'), textoAvisoRetomar(null)];
    expect(new Set([c, n, x]).size).toBe(3);
    expect(x).toContain('el costo lo absorbe NovuChat');
    expect(x).toContain('o Meta se lo cobra a su negocio');
  });

  it('mientras la tarifa no está verificada, lo dice (D-R5): «sin verificar en la tarifa oficial de Meta»', () => {
    expect(fuenteDeLaCifra()).toContain('todavía sin verificar en la tarifa oficial de Meta');
    for (const tit of ['comercio', 'novuchat', null] as const) expect(textoAvisoRetomar(tit)).toContain('sin verificar');
  });

  it('`titularidadParaAviso`: un número del comercio basta para avisar que Meta le factura; sin números, no consta', () => {
    expect(titularidadParaAviso(undefined)).toBeNull();
    expect(titularidadParaAviso(null)).toBeNull();
    expect(titularidadParaAviso({ numeros: [] })).toBeNull();
    expect(titularidadParaAviso({ numeros: [{ titularidad: 'novuchat' }] })).toBe('novuchat');
    expect(titularidadParaAviso({ numeros: [{ titularidad: 'novuchat' }, { titularidad: 'comercio' }] })).toBe('comercio');
    expect(titularidadParaAviso({ numeros: [{}] })).toBe('novuchat');   // sin titularidad, la del servidor: NovuChat
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
  const pintar = (tit: 'comercio' | 'novuchat' | null = 'comercio', habilitados = true) => flushSync(() => raiz.render(
    React.createElement(RetomarConversacion, { tenantId: 'demo', conversacionId: 'wa_59170000001', titularidad: tit, habilitados, capa: capa() })));
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
    expect(cont.querySelector('[data-testid="retomar-aviso"]')!.textContent).toBe(textoAvisoRetomar('comercio'));
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
    pintar('comercio', false);
    expect(boton(/Retomar conversación/)!.disabled).toBe(true);
  });

  it('el aviso del modal cambia con la titularidad', () => {
    pintar('novuchat');
    flushSync(() => boton(/Retomar conversación/)!.click());
    expect(cont.querySelector('[data-testid="retomar-aviso"]')!.textContent).toBe(textoAvisoRetomar('novuchat'));
  });

  it('`ejecutarRetomar` nunca reintenta solo y no inventa un teléfono ni un texto en la llamada', async () => {
    const retomar = vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'functions/internal' }); });
    const r = await ejecutarRetomar({ tomar: vi.fn(), devolver: vi.fn(), enviar: vi.fn(), retomar } as CapaTurno, { tenantId: 't', conversacionId: 'wa_1' }, null);
    expect(retomar).toHaveBeenCalledTimes(1);
    expect(r.abierta).toBe(true);
    expect(Object.keys((retomar.mock.calls[0] as unknown as [Record<string, unknown>])[0]).sort()).toEqual(['claveIdempotencia', 'conversacionId', 'tenantId']);
  });

  it('los textos de error de Retomar salen del código y son fijos', () => {
    expect(textoErrorTurno('retomar', 'resource-exhausted', { tope: 'retomarMes' })).toContain('este mes');
    expect(textoErrorTurno('retomar', 'resource-exhausted', { tope: 'retomarDia' })).toContain('hoy');
    expect(textoErrorTurno('retomar', 'failed-precondition')).toContain('No se pudo retomar');
    expect(textoErrorTurno('retomar', 'permission-denied')).toContain('No tiene permiso');
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
