/**
 * Visor de comprobantes, parte de la consola (T22 del plan). Se prueba negando:
 * el texto nunca habla de dinero acreditado, un cobro aproximado no dice
 * «coinciden» a secas, la imagen solo entra por `<img src="data:…">` con un MIME
 * de la lista cerrada, el PDF solo se baja, y el error sale por `code`, nunca por
 * `message`. Pura: no toca Firestore ni red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AVISO_PDF, bytesDeBase64, claseDeRespuesta, puedeVerComprobante, srcDeImagen, textoDeError, textosDelVisor,
} from '../../../web/src/modulos/cobros/visorComprobante.ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const carpeta = join(aqui, '../../../web/src/modulos/cobros');
const leer = (f: string) => readFileSync(join(carpeta, f), 'utf8');
/** Sin comentarios: los de este módulo nombran lo prohibido para explicar por qué. */
const sinComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const PROHIBIDAS = /acreditad|acreditaci[oó]n|verificad|recibimos tu pago/i;
const CODIGOS = [
  'functions/unauthenticated', 'functions/permission-denied', 'functions/not-found',
  'functions/failed-precondition', 'functions/invalid-argument', 'functions/resource-exhausted',
  'functions/unavailable', 'functions/internal', 'algo-raro', undefined, null, 42,
];

describe('textos del visor', () => {
  it('ningún texto del visor dice acreditado, acreditación, verificado ni «recibimos tu pago»', () => {
    const todos = [
      AVISO_PDF,
      ...CODIGOS.map(textoDeError),
      ...['valido', 'aproximado', undefined, 'invalido'].flatMap((q) => [true, false].flatMap((a) => textosDelVisor(q, a))),
    ];
    for (const t of todos) expect(t).not.toMatch(PROHIBIDAS);
  });

  it('ni el código de la pantalla (sin comentarios) lo dice', () => {
    for (const f of ['visorComprobante.ts', 'VisorComprobante.tsx', 'Cobros.tsx']) {
      expect(sinComentarios(leer(f)), f).not.toMatch(PROHIBIDAS);
    }
  });

  it('un cobro aproximado no dice «coinciden» a secas', () => {
    const t = textosDelVisor('aproximado', true);
    expect(t.join(' ')).toContain('de forma aproximada');
    expect(t.join(' ')).not.toContain('Los datos coinciden con el pedido');
    for (const x of t) expect(x).not.toMatch(/coinciden\.$/);
    // Una calidad que no se reconoce tampoco: ante la duda, el texto prudente.
    expect(textosDelVisor(undefined, false).join(' ')).toContain('de forma aproximada');
    expect(textosDelVisor('valido', false).join(' ')).toContain('Los datos coinciden con el pedido.');
  });

  it('el texto cambia con el rol: el administrador marca, el operador remite al administrador', () => {
    expect(textosDelVisor('valido', true)[2]).toContain('márquelo como comprobado cuando lo vea');
    expect(textosDelVisor('valido', false)[2]).toContain('el administrador lo marca como comprobado');
    expect(textosDelVisor('valido', false)[0]).toBe('El comprobante se conserva hasta 90 días desde que llegó, como evidencia.');
  });

  it('el error sale por su code, con el texto del contrato', () => {
    // La tabla ENTERA del contrato, literal: un texto cambiado, o dos códigos mezclados, la rompe.
    const TABLA: Record<string, string> = {
      'functions/unauthenticated': 'No se pudo comprobar su sesión. Recargue la página e inicie sesión de nuevo.',
      'functions/permission-denied': 'No tiene permiso para ver este comprobante.',
      'functions/not-found': 'No hay un comprobante guardado para este cobro. Se conserva hasta 90 días desde que llegó.',
      'functions/failed-precondition': 'Este comprobante no se puede mostrar desde la consola.',
      'functions/invalid-argument': 'Este comprobante no se puede mostrar desde la consola.',
      'functions/resource-exhausted': 'Alcanzó el máximo de comprobantes que se pueden ver: 30 por hora y 100 por día. Vuelva a intentar más tarde.',
    };
    expect(Object.fromEntries(Object.keys(TABLA).map((k) => [k, textoDeError(k)]))).toEqual(TABLA);
    // Cualquier otra cosa, incluido un objeto raro, cae en el texto genérico.
    for (const c of ['functions/internal', 'x', undefined, null, 42, {}]) {
      expect(textoDeError(c)).toBe('No se pudo abrir el comprobante. Intente de nuevo en unos minutos.');
    }
  });

  it('el componente nunca lee el mensaje del error', () => {
    const c = sinComentarios(leer('VisorComprobante.tsx'));
    expect(c).not.toMatch(/\.message\b/);
    expect(c).toMatch(/\.code\b/);
  });
});

describe('imagen: solo data:image/(jpeg|png|webp) con base64', () => {
  it('los tres MIME de la lista dan un data URL', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(srcDeImagen(m, 'QUJD')).toBe(`data:${m};base64,QUJD`);
    }
  });

  it('cualquier otro MIME da null', () => {
    for (const m of ['image/svg+xml', 'text/html', 'application/pdf', 'image/gif', 'IMAGE/PNG',
      'image/png;charset=x', 'image/png,<script>', '', undefined, null, 5]) {
      expect(srcDeImagen(m, 'QUJD'), String(m)).toBeNull();
    }
  });

  it('un base64 que no lo es da null', () => {
    for (const b of ['', 'a b', '"onerror="x', 'QUJD<', 'QUJD\n', undefined, null, 7]) {
      expect(srcDeImagen('image/png', b), String(b)).toBeNull();
    }
  });

  it('claseDeRespuesta separa imagen, pdf e inválida', () => {
    expect(claseDeRespuesta('image/webp')).toBe('imagen');
    expect(claseDeRespuesta('application/pdf')).toBe('pdf');
    for (const m of ['image/svg+xml', 'text/html', undefined, 3]) expect(claseDeRespuesta(m)).toBe('invalida');
  });

  it('bytesDeBase64 decodifica y rechaza lo que no es base64', () => {
    expect(Array.from(bytesDeBase64('QUJD') ?? [])).toEqual([65, 66, 67]);
    expect(bytesDeBase64('no es base64')).toBeNull();
    expect(bytesDeBase64(undefined)).toBeNull();
  });

  it('la pantalla dibuja la imagen solo desde srcDeImagen', () => {
    const c = sinComentarios(leer('VisorComprobante.tsx'));
    expect(c).toMatch(/<img src=\{estado\.src\}/);
    expect(c).toContain('srcDeImagen(');
    expect(c.match(/<img\b/g)?.length).toBe(1);
    expect(c).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('PDF: se baja, nunca se abre', () => {
  const fuentes = () => ['visorComprobante.ts', 'VisorComprobante.tsx', 'Cobros.tsx']
    .map((f) => [f, sinComentarios(leer(f))] as const);

  it('ningún archivo del visor abre, incrusta ni guarda en el navegador', () => {
    const PROHIBIDO = [/window\.open/, /<iframe/i, /<embed/i, /<object/i, /localStorage/, /sessionStorage/, /indexedDB/i,
      /\.srcdoc/, /document\.write/];
    for (const [f, c] of fuentes()) for (const r of PROHIBIDO) expect(c, `${f} ${r}`).not.toMatch(r);
  });

  it('el PDF se baja con un Blob de tipo fijo, un enlace de descarga y se suelta la URL', () => {
    const c = sinComentarios(leer('VisorComprobante.tsx'));
    expect(c).toMatch(/new Blob\(\[[^\]]*\], \{ type: MIME_DE_PDF \}\)/);
    expect(c).toContain('URL.createObjectURL(blob)');
    expect(c).toMatch(/\.download\s*=\s*NOMBRE_DEL_PDF/);
    expect(c).toMatch(/URL\.revokeObjectURL\(url\)/);
    expect(c).toContain('AVISO_PDF');
    expect(AVISO_PDF).toBe('Archivo enviado por el cliente; ábralo con un lector actualizado.');
  });

  it('la callable se llama con el contrato y sin ruta', () => {
    const c = sinComentarios(leer('VisorComprobante.tsx'));
    expect(c).toContain("'verComprobante'");
    const plano = c.replace(/\s+/g, ' ');
    // La llamada misma, no la firma del componente: exactamente una, con solo esas dos claves.
    expect(plano.split("'verComprobante')({ tenantId, cierreId })").length - 1).toBe(1);
    expect(plano.split("'verComprobante'").length - 1).toBe(1);
    expect(c).not.toMatch(/ruta/i);
  });
});

describe('quién ve qué', () => {
  it('puedeVerComprobante: solo ventas cotejadas con calidad valido o aproximado', () => {
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: { calidad: 'valido' } })).toBe(true);
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: { calidad: 'aproximado' } })).toBe(true);
    // Negando: una cita, sin calidad, calidad inválida, sin cotejo.
    expect(puedeVerComprobante({ id: 'cita_x', cotejo: { calidad: 'valido' } })).toBe(false);
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: {} })).toBe(false);
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: { calidad: 'invalido' } })).toBe(false);
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: { calidad: 'en_revision' } })).toBe(false);
    expect(puedeVerComprobante({ id: 'venta_abc' })).toBe(false);
    expect(puedeVerComprobante({ id: 'venta_abc', cotejo: null })).toBe(false);
    expect(puedeVerComprobante({ id: 'ventaabc', cotejo: { calidad: 'valido' } })).toBe(false);
    expect(puedeVerComprobante({ id: 7, cotejo: { calidad: 'valido' } })).toBe(false);
    expect(puedeVerComprobante({})).toBe(false);
  });

  it('Exportar y Comprobar solo se dibujan para el administrador, por el rol de la sesión', () => {
    const c = sinComentarios(leer('Cobros.tsx'));
    expect(c).toMatch(/const soyAdmin = rolEn\(permisos, tenantId\) === 'admin'/);
    expect(c).toMatch(/\{soyAdmin && \(\s*<div className="acciones">/);
    expect(c).toMatch(/\{soyAdmin && !listo && \(/);
    // «Exportar» y «Comprobar» no aparecen fuera de esas dos guardas.
    expect(c.match(/>Exportar \(/g)?.length).toBe(1);
    expect(c.match(/>Comprobar</g)?.length).toBe(1);
    expect(c.indexOf('soyAdmin &&')).toBeLessThan(c.indexOf('>Exportar ('));
  });

  it('la elegibilidad no usa el literal de flujo entre comillas', () => {
    for (const f of ['visorComprobante.ts', 'VisorComprobante.tsx', 'Cobros.tsx']) {
      expect(sinComentarios(leer(f)), f).not.toMatch(/['"`](agendamiento|venta|onboarding)['"`]/);
    }
  });

  it('la etiqueta del listado y la ayuda dicen lo del plan', () => {
    const c = leer('Cobros.tsx');
    expect(c).toContain("'Datos coinciden de forma aproximada'");
    expect(c).toContain('una imagen se puede editar');
    expect(c).toContain('Desde acá solo se ven los comprobantes de ventas cotejadas.');
    expect(c).not.toContain('NovuChat no guarda la imagen');
  });
});

describe('guardas de fuente de la ronda de revisión del #466', () => {
  const cobros = () => sinComentarios(leer('Cobros.tsx')).replace(/\s+/g, ' ');
  const visor = () => sinComentarios(leer('VisorComprobante.tsx')).replace(/\s+/g, ' ');

  it('al cambiar de negocio con la ruta montada se desmonta todo: key={tenantId}', () => {
    // Sin la `key`, el modal abierto y los cobros cargados serían los del negocio anterior.
    expect(cobros()).toContain('return <CobrosDelNegocio key={tenantId} />;');
    expect(cobros().split('<CobrosDelNegocio').length - 1).toBe(1);
  });

  it('el operador sin Pedidos se redirige; el administrador y la carga no', () => {
    const c = cobros();
    expect(c).toContain("if (rolEn(permisos, tenantId) !== 'admin') {");
    expect(c).toContain('if (modulos === null) return');
    expect(c).toContain('if (!capacidadesDeConsola(modulos).conPedidos) return <Navigate to="/" replace />;');
    // Orden: primero el rol, luego la carga, luego la capacidad, y solo después el contenido.
    const i = [
      "if (rolEn(permisos, tenantId) !== 'admin') {", 'if (modulos === null) return',
      'capacidadesDeConsola(modulos).conPedidos', 'return <CobrosDelNegocio',
    ].map((x) => c.indexOf(x));
    expect(i.every((x) => x >= 0)).toBe(true);
    expect(i).toEqual([...i].sort((a, b) => a - b));
  });

  it('la respuesta tardía de otra consulta se descarta, tanto al responder como al fallar', () => {
    expect(visor().split('if (mia !== vuelta.current) return;').length - 1).toBe(2);
  });

  it('al desmontar o cambiar de cobro se descartan los bytes', () => {
    expect(visor()).toContain(
      "return () => { vuelta.current += 1; setEstado({ tipo: 'reposo' }); }; }, [tenantId, cierreId]);");
  });

  it('el texto del detalle depende del rol real, no de un valor fijo', () => {
    expect(cobros()).toContain('textosDelVisor(cobro.cotejo?.calidad, soyAdmin)');
    expect(cobros()).toContain("c.cotejo.calidad === 'aproximado'");
  });

  it('la URL del Blob se suelta a los 5 s: antes, Firefox y Safari pueden cancelar la descarga', () => {
    expect(visor()).toContain('setTimeout(() => URL.revokeObjectURL(url), 5000);');
    expect(visor()).not.toMatch(/revokeObjectURL\(url\), 0\)/);
  });

  it('accesibilidad: región status siempre montada y foco devuelto al terminar o fallar', () => {
    const c = visor();
    // Siempre montada: ni dentro de un condicional ni con `&&` delante.
    expect(c).toContain('<div role="status" ref={aviso} tabIndex={-1}>{mensaje}</div>');
    expect(c).not.toMatch(/&& <div role="status"/);
    expect(c).toContain("if (estado.tipo === 'imagen' || estado.tipo === 'pdf' || estado.tipo === 'error') aviso.current?.focus();");
    expect(c).toContain("else if (estado.tipo === 'reposo' && hubo.current) boton.current?.focus();");
    // El error y la carga se escriben en esa región, no en otra que aparezca después.
    expect(c).toContain("estado.tipo === 'error' ? estado.texto");
    expect(c).not.toContain('role="alert"');
  });

  it('useFicha no decide con la ficha del negocio anterior', () => {
    const f = sinComentarios(readFileSync(join(carpeta, '../../central/lib/flujos.ts'), 'utf8')).replace(/\s+/g, ' ');
    expect(f).toContain('guardada.de === tenantId ? guardada.ficha : null');
    expect(f).toContain('setGuardada(null);');
  });
});
