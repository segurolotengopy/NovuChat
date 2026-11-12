/**
 * MEDIOS B4 — LA PANTALLA: qué pinta y qué NO hace (guardas de fuente), sin navegador ni red. El comportamiento con
 * clic (grabar, confirmar, reintentar) lo prueba `pruebas-navegador/conversaciones-medios.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACCEPT, type CapaAdjunto } from '../../web/src/central/lib/adjuntos';

const ADMIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (r: string) => readFileSync(join(ADMIN, r), 'utf8');
const codigo = (r: string) => leer(r).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

const desdeWeb = createRequire(join(ADMIN, 'web', 'package.json'));
const { createElement } = desdeWeb('react') as { createElement: (c: unknown, p: unknown, ...h: unknown[]) => unknown };
const { renderToStaticMarkup } = desdeWeb('react-dom/server') as { renderToStaticMarkup: (e: unknown) => string };
const { AdjuntarComoPersona } = await import('../../web/src/central/componentes/AdjuntarComoPersona');

const CAPA: CapaAdjunto = { enviarAdjunto: async () => ({}) };
const pintar = (formatoInicial: unknown) => renderToStaticMarkup(createElement(AdjuntarComoPersona, {
  miUid: 'u', tenantId: 't', conversacionId: 'wa_1', nombreContacto: 'Ana', telefono: '59100000047', capa: CAPA, formatoInicial,
}));

describe('AdjuntarComoPersona (render)', () => {
  it('con formato webm se ven «Adjuntar archivo» y «Grabar nota de voz»', () => {
    const h = pintar({ mimeGrabacion: 'audio/webm;codecs=opus', mimeDeclarado: 'audio/webm' });
    expect(h).toContain('Adjuntar archivo');
    expect(h).toContain('Grabar nota de voz');
  });
  it('NEGANDO: sin formato no existe «Grabar nota de voz» y se explica', () => {
    const h = pintar(null);
    expect(h).toContain('Adjuntar archivo');
    expect(h).not.toContain('Grabar nota de voz');
    expect(h).toContain('no puede grabar notas de voz');
  });
  it('NEGANDO: mientras no se sabe el formato, no se ofrece ni se explica', () => {
    const h = pintar(undefined);
    expect(h).not.toContain('Grabar nota de voz');
    expect(h).not.toContain('no puede grabar notas de voz');
  });
  it('el input usa la lista de la consola y NO tiene capture; hay región aria-live', () => {
    const h = pintar(null);
    expect(h).toContain(`accept="${ACCEPT}"`);
    expect(h).not.toMatch(/capture/);
    expect(h).toContain('aria-live="polite"');
  });
  it('nada de enviar ni de confirmar hasta que haya un archivo preparado', () => {
    const h = pintar(null);
    expect(h).not.toContain('Enviar archivo');
    expect(h).not.toContain('alertdialog');
  });
});

describe('el Detalle', () => {
  const detalle = codigo('web/src/central/componentes/DetalleConversacion.tsx');
  it('<AdjuntarComoPersona aparece una sola vez, dentro de la condición que usa verAdjuntar', () => {
    expect(detalle.match(/<AdjuntarComoPersona/g)).toHaveLength(1);
    expect(detalle).toMatch(/verAdjuntar\(/);
    // La condición del componente es la expresión de verAdjuntar (no otra): la variable se arma con la función y se usa en el JSX.
    const def = /const (\w+) = verAdjuntar\(/.exec(detalle);
    expect(def).not.toBeNull();
    expect(detalle).toMatch(new RegExp(`\\{${def![1]} && \\(\\s*<AdjuntarComoPersona`));
  });
  it('un archivo enviado se pide por el id del mensaje', () => expect(detalle).toMatch(/mensajeId=\{x\.id\}/));
  it('NEGANDO: el texto de una burbuja de persona no dice «puede ser el comprobante»', () => {
    const persona = /const ADJUNTOS_DE_PERSONA[\s\S]*?};/.exec(detalle)?.[0] ?? '';
    expect(persona).toMatch(/image/);
    expect(persona).not.toMatch(/comprobante/);
  });
  it('la línea de «ya no se pueden enviar archivos» es un status y solo se muestra con la bandera en true', () => {
    expect(detalle).toMatch(/p\.puedeEnviarMedios && [\s\S]{0,160}role="status"[\s\S]{0,120}Ya no se pueden enviar archivos/);
  });
});

describe('AdjuntarComoPersona: fuente', () => {
  const c = codigo('web/src/central/componentes/AdjuntarComoPersona.tsx');
  it('NEGANDO: con un borrador abierto el texto no se puede editar', () => {
    expect(c).toMatch(/id="cv-adjunto-leyenda"[\s\S]{0,400}disabled=\{[^}]*abierto/);
  });
  it('la imagen no guarda su vista previa aparte (se arma al pintar)', () => expect(c).not.toMatch(/vistaPrevia/));
  it('sin uid no se recuerda nada', () => expect(c).toMatch(/p\.miUid !== null\) ADJUNTOS_SIN_CONFIRMAR\.set/));
  it('el envío se anota como sin confirmar ANTES de llamar a la capa', () => {
    const i = c.indexOf('recordar({ preparado, leyenda, borrador: abierto0 })');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(c.indexOf('await ejecutarEnvioDeAdjunto'));
  });
});

describe('negativas de fuente', () => {
  const ARCHIVOS = [
    'web/src/central/lib/adjuntos.ts', 'web/src/central/componentes/AdjuntarComoPersona.tsx',
    'web/src/central/lib/medios.ts', 'web/src/central/componentes/VisorMedio.tsx',
  ];
  const PROHIBIDO = [
    /innerHTML/, /dangerouslySetInnerHTML/, /localStorage/, /sessionStorage/, /indexedDB/, /\bfetch\(/, /XMLHttpRequest/,
    /\.message\b/, /Math\.random/, /capture=/, /\blink:/, /\beval\(/, /console\./,
  ];
  for (const r of ARCHIVOS) {
    it(`${r} no usa nada de lo prohibido`, () => {
      const c = codigo(r);
      for (const re of PROHIBIDO) expect(c, String(re)).not.toMatch(re);
    });
  }
  it('createObjectURL solo junto a <audio y siempre con revokeObjectURL', () => {
    const c = codigo('web/src/central/componentes/AdjuntarComoPersona.tsx');
    expect(c.match(/createObjectURL/g)).toHaveLength(1);
    expect(c).toMatch(/revokeObjectURL/);
    expect(c).toContain('<audio');
    expect(codigo('web/src/central/lib/adjuntos.ts')).not.toMatch(/createObjectURL/);
  });
  it('AdjuntarComoPersona no importa Firebase', () => {
    expect(codigo('web/src/central/componentes/AdjuntarComoPersona.tsx')).not.toMatch(/from 'firebase|core\/lib\/firebase/);
  });
  it('la única httpsCallable de adjuntos.ts es la de adjuntos, con su espera', () => {
    const c = codigo('web/src/central/lib/adjuntos.ts');
    expect(c.match(/httpsCallable</g)).toHaveLength(1);
    expect(c).toMatch(/'enviarAdjuntoComoPersona', \{ timeout: TIEMPO_DE_ESPERA_ADJUNTO_MS \}/);
  });
  it('turno.ts conserva solo sus tres callables', () => {
    expect(codigo('web/src/central/lib/turno.ts').match(/httpsCallable</g)).toHaveLength(3);
  });
  it('la página crea la capa real y el hook de la bandera falla cerrado', () => {
    expect(codigo('web/src/central/paginas/ConversacionesNueva.tsx')).toContain('capaAdjuntoReal(funciones)');
    const h = codigo('web/src/central/componentes/ConsolaConversaciones.tsx');
    const f = h.slice(h.indexOf('export function usePersonaPuedeEnviarMedios'));
    expect(f).toContain('() => setPuede(false)');
    expect(f).toContain('useState(false)');
  });
});

describe('cabeceras de la consola', () => {
  const firebase = JSON.parse(leer('firebase.json')) as { hosting: Array<{ target?: string; headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }> };
  const valores = (destino: string, clave: string) => (firebase.hosting.find((h) => h.target === destino)?.headers ?? [])
    .flatMap((b) => b.headers).filter((h) => h.key === clave).map((h) => h.value);
  it('la consola permite el micrófono solo a sí misma y nada más', () => {
    expect(valores('consola', 'Permissions-Policy')).toEqual(['geolocation=(), camera=(), microphone=(self), payment=(), usb=()']);
  });
  it('NEGANDO: el catálogo conserva microphone=() y ninguna abre el micrófono a otros', () => {
    expect(valores('catalogo', 'Permissions-Policy')[0]).toContain('microphone=()');
    for (const t of ['consola', 'catalogo']) {
      for (const v of valores(t, 'Permissions-Policy')) expect(v).not.toMatch(/microphone=(\*|\([^)]*https?:)/);
    }
  });
  it('NEGANDO: el img-src de la consola sigue sin blob:', () => {
    for (const v of valores('consola', 'Content-Security-Policy')) expect(/img-src ([^;]+)/.exec(v)?.[1] ?? '').not.toMatch(/blob:/);
  });
});
