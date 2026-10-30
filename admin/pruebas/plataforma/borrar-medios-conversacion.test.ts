/** `borrar-medios-conversacion`: lógica con dobles de Firestore y de Storage; nada toca la nube. Se prueba negando. */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ejecutar, limpiarError, rutaValida, ultimos4 } from '../../scripts/plataforma/borrar-medios-conversacion-logica.mjs';

const H = (n: number) => createHash('sha256').update(`wamid.${n}`).digest('hex');
const TEL = ['591', '7', '12', '34567'].join('');
const TEL2 = ['591', '7', '99', '98888'].join('');
const CONV = 'wa_' + TEL;
const OTRA = 'wa_' + TEL2;
const ruta = (t: string, n: number) => `tenants/${t}/medios/2026-10-30/${H(n)}.jpg`;

function crear(datos: Record<string, any>, opts: { fallaAuditoria?: boolean } = {}) {
  const docs = new Map<string, any>(Object.entries(datos));
  const ref = (p: string): any => ({
    path: p,
    get: async () => ({ exists: docs.has(p) }),
    set: async (v: any) => { if (opts.fallaAuditoria) throw new Error('no'); docs.set(p, v); },
    update: async (v: any) => {
      const x = { ...docs.get(p) };
      for (const [k, val] of Object.entries(v)) { const [a, b] = k.split('.'); if (b) x[a] = { ...x[a], [b]: val }; else x[a] = val; }
      docs.set(p, x);
    },
    delete: async () => { docs.delete(p); },
  });
  const snap = (p: string) => ({ id: p.split('/').pop(), ref: ref(p), data: () => docs.get(p), get: (k: string) => docs.get(p)[k] });
  const db: any = {
    doc: (p: string) => ({ ...ref(p), get: async () => ({ exists: docs.has(p), data: () => docs.get(p) }) }),
    collection: (col: string) => ({
      doc: () => ref(`${col}/${docs.size}-${Math.random()}`),
      where: (campo: string, _op: string, valor: unknown) => ({
        limit: () => ({
          get: async () => ({
            docs: [...docs.keys()].filter((k) => k.startsWith(col + '/') && !k.slice(col.length + 1).includes('/') && docs.get(k)[campo] === valor).map(snap),
          }),
        }),
      }),
    }),
  };
  return { db, docs };
}
function almacenDoble(objetos: string[], o: { ciego?: boolean; sinBucket?: boolean } = {}) {
  const set = new Set(objetos); const llamadas: string[] = [];
  return {
    llamadas, set,
    verificar: async () => { if (o.sinBucket) throw new Error('sin bucket'); },
    estado: async (r: string) => { if (o.ciego) throw new Error('403'); return set.has(r) ? 'existe' : 'ausente'; },
    borrar: async (r: string) => { llamadas.push(r); set.delete(r); },
  } as any;
}
const medio = (t: string, n: number, conv: string, extra: Record<string, unknown> = {}) => ({
  idMeta: `wamid.${n}`, conversacionId: conv, tipo: 'image', mime: 'image/jpeg', ext: 'jpg', estado: 'guardado', ruta: ruta(t, n), ...extra,
});
const escenario = () => {
  const datos: Record<string, any> = {
    'tenants/clinica-uno': { nombre: 'Clínica Uno' }, 'tenants/clinica-dos': { nombre: 'Clínica Dos' },
    [`tenants/clinica-uno/mediosRecibidos/m1`]: medio('clinica-uno', 1, CONV),
    [`tenants/clinica-uno/mediosRecibidos/m2`]: medio('clinica-uno', 2, CONV, { estado: 'pendiente', tipo: 'audio' }),
    [`tenants/clinica-uno/mediosRecibidos/m3`]: medio('clinica-uno', 3, CONV, { estado: 'anotado', ruta: null, tipo: 'document' }),
    [`tenants/clinica-uno/mediosRecibidos/m4`]: medio('clinica-uno', 4, OTRA),
    [`tenants/clinica-dos/mediosRecibidos/m5`]: medio('clinica-dos', 5, CONV),
  };
  for (const n of [1, 2, 3, 4]) datos[`tenants/clinica-uno/conversaciones/${CONV}/mensajes/s${n}`] = { idMeta: `wamid.${n}`, texto: 'hola', medio: { estado: 'guardado' } };
  datos[`tenants/clinica-uno/conversaciones/${OTRA}/mensajes/o4`] = { idMeta: 'wamid.4', texto: 'otra', medio: { estado: 'guardado' } };
  return datos;
};
const carpeta = () => mkdtempSync(join(tmpdir(), 'resp-'));
const base = (o: Record<string, unknown>) => ({ tenant: 'clinica-uno', conversacion: CONV, motivo: 'pedido del titular', proyecto: 'p1', proyectosPermitidos: ['p1'], confirmarComercio: 'Clínica Uno', respaldoEn: carpeta(), ...o });
const objetosDe = () => [ruta('clinica-uno', 1), ruta('clinica-uno', 2), ruta('clinica-uno', 4), ruta('clinica-dos', 5)];

describe('borrar-medios-conversacion', () => {
  it('seco: cuenta por tipo y estado y no escribe nada', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe()); const antes = new Map(docs); const logs: string[] = [];
    const r = await ejecutar({ db, almacen: al, ...base({}), log: (t: string) => logs.push(t) }) as any;
    expect(r.ok && r.seco).toBe(true);
    expect(r.antes).toMatchObject({ medios: 3, objetos: 2, porEstado: { guardado: 1, pendiente: 1, anotado: 1 } });
    expect(al.llamadas).toEqual([]);
    expect(docs).toEqual(antes);
  });

  it('aplicar: borra solo esa conversación de ese comercio (pendiente y anotado incluidos); otra conversación y otro comercio intactos', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe());
    const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
    expect(r.ok).toBe(true);
    expect(r.despues).toMatchObject({ medios: 0, objetos: 0 });
    expect([...docs.keys()].filter((k) => k.includes('mediosRecibidos'))).toEqual(['tenants/clinica-uno/mediosRecibidos/m4', 'tenants/clinica-dos/mediosRecibidos/m5']);
    expect(al.set.has(ruta('clinica-uno', 4))).toBe(true);
    expect(al.set.has(ruta('clinica-dos', 5))).toBe(true);
    expect(al.set.size).toBe(2);
    expect(docs.get(`tenants/clinica-uno/conversaciones/${CONV}/mensajes/s1`)).toMatchObject({ texto: 'hola', medio: { estado: 'borrado' } });
    expect(docs.get(`tenants/clinica-uno/conversaciones/${OTRA}/mensajes/o4`).medio.estado).toBe('guardado');
  });

  it('NEGACIÓN: una ruta fuera de formato (.., otro comercio, otro nombre) no se omite en silencio: aborta sin escribir y conserva el documento', async () => {
    for (const mala of [
      `tenants/clinica-uno/medios/../../clinica-dos/medios/2026-10-30/${H(1)}.jpg`, ruta('clinica-dos', 1), `otra/${H(1)}.jpg`,
      `tenants/clinica-uno/medios/2026-10-30/${H(9)}.jpg`, `tenants/clinica-uno/medios/2026-10-30/${H(1)}.exe`,
    ]) {
      const d = escenario(); d['tenants/clinica-uno/mediosRecibidos/m1'].ruta = mala;
      const { db, docs } = crear(d); const al = almacenDoble(objetosDe()); const antes = new Map(docs);
      const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
      expect(r.ok).toBe(false);
      expect(al.llamadas).toEqual([]);
      expect(docs).toEqual(antes);
    }
    for (const mala of ['tenants/a/medios/../x', 'tenants/clinica-uno/medios/2026-10-30/x.jpg', 'tenants/clinica-uno/otro/2026-10-30/' + H(1) + '.jpg', 'tenants/clinica-uno/medios//2026-10-30/' + H(1) + '.jpg']) {
      expect(rutaValida(mala, 'clinica-uno')).toBe(false);
    }
    expect(rutaValida(ruta('clinica-uno', 1), 'clinica-uno', 'wamid.1')).toBe(true);
    for (const e of ['mp4', '3gp', 'bin', 'docx', 'xlsx', 'pptx', 'zip', 'txt', 'csv']) expect(rutaValida(`tenants/t-uno/medios/2026-10-30/${H(1)}.${e}`, 't-uno')).toBe(true);
  });

  it('NEGACIÓN: bucket equivocado (ningún objeto hallado) o inalcanzable no borra metadatos', async () => {
    for (const al of [almacenDoble([]), almacenDoble(objetosDe(), { sinBucket: true }), almacenDoble(objetosDe(), { ciego: true })]) {
      const { db, docs } = crear(escenario()); const antes = new Map(docs);
      const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
      expect(r.ok).toBe(false);
      expect(al.llamadas).toEqual([]);
      expect(docs).toEqual(antes);
    }
  });

  it('NEGACIÓN: --confirmar-comercio incorrecto o proyecto no permitido aborta', async () => {
    for (const o of [{ confirmarComercio: 'Clínica Dos' }, { confirmarComercio: null }, { proyecto: 'otro' }, { proyectosPermitidos: [] }]) {
      const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe()); const antes = new Map(docs);
      expect((await ejecutar({ db, almacen: al, ...base({ aplicar: true, ...o }) }) as any).ok).toBe(false);
      expect(al.llamadas).toEqual([]);
      expect(docs).toEqual(antes);
    }
  });

  it('corte intermedio: la auditoría queda fallida, los metadatos siguen y la reejecución termina', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe());
    const original = al.borrar; let n = 0;
    al.borrar = async (r: string) => { if (++n === 2) throw new Error(`falla en ${CONV} ${TEL}`); return original(r); };
    const r1 = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
    expect(r1.ok).toBe(false);
    expect(r1.error).not.toContain(TEL);
    expect([...docs.keys()].filter((k) => k.startsWith('tenants/clinica-uno/mediosRecibidos') && docs.get(k).conversacionId === CONV)).toHaveLength(3);
    expect([...docs.entries()].find(([k]) => k.includes('/auditoria/'))![1].estado).toBe('fallida');
    al.borrar = original;
    const r2 = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
    expect(r2.ok).toBe(true);
    expect(r2.despues.medios).toBe(0);
  });

  it('la auditoría se anota ANTES del primer borrado y termina completada, con hash y sin datos personales', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe());
    let audAntes = false; const original = al.borrar;
    al.borrar = async (r: string) => { audAntes ||= [...docs.entries()].some(([k, v]) => k.includes('/auditoria/') && v.estado === 'iniciada'); return original(r); };
    await ejecutar({ db, almacen: al, ...base({ aplicar: true }) });
    expect(audAntes).toBe(true);
    const aud = [...docs.entries()].find(([k]) => k.includes('/auditoria/'))![1];
    expect(aud).toMatchObject({ estado: 'completada', conversacionHash: createHash('sha256').update(CONV).digest('hex') });
  });

  it('limpiarError quita teléfonos, conversaciones y rutas', () => {
    expect(limpiarError(new Error(`x wa_${TEL} ${TEL} tenants/clinica-uno/medios/a`))).not.toMatch(new RegExp(`${TEL}|clinica-uno`));
  });

  it('NEGACIÓN: conversación mal formada, tenant mal formado y comercio inexistente', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe()); const antes = new Map(docs);
    for (const conversacion of ['wa_123', 'wa_' + TEL + '1234567', TEL, 'wa_*', '']) {
      expect((await ejecutar({ db, almacen: al, ...base({ conversacion, aplicar: true }) }) as any).ok).toBe(false);
    }
    expect((await ejecutar({ db, almacen: al, ...base({ tenant: '../x', aplicar: true }) }) as any).ok).toBe(false);
    const r = await ejecutar({ db, almacen: al, ...base({ tenant: 'no-existe', aplicar: true }) }) as any;
    expect(r).toMatchObject({ ok: false, error: 'el comercio no existe' });
    expect(al.llamadas).toEqual([]);
    expect(docs).toEqual(antes);
  });

  it('NEGACIÓN: si la auditoría falla, no se borra nada', async () => {
    const { db, docs } = crear(escenario(), { fallaAuditoria: true }); const al = almacenDoble(objetosDe()); const antes = new Map(docs);
    const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
    expect(r.ok).toBe(false);
    expect(al.llamadas).toEqual([]);
    expect(docs).toEqual(antes);
  });

  it('el respaldo existe con permisos 600 antes de borrar, sin bytes ni rutas en la salida', async () => {
    const dir = carpeta(); const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe()); const logs: string[] = [];
    let respaldoAntes = false;
    const original = al.borrar;
    al.borrar = async (r: string) => { respaldoAntes ||= readdirSync(dir).length === 1; return original(r); };
    await ejecutar({ db, almacen: al, ...base({ aplicar: true, respaldoEn: dir }), log: (t: string) => logs.push(t) });
    expect(respaldoAntes).toBe(true);
    const [f] = readdirSync(dir);
    expect(statSync(join(dir, f)).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(join(dir, f), 'utf8')).medios).toHaveLength(3);
    const salida = logs.join('\n');
    expect(salida).not.toContain(TEL);
    expect(salida).not.toContain('tenants/clinica-uno/medios');
    expect(salida).not.toContain('wamid');
    expect(salida).toContain(ultimos4(CONV));
    const aud = [...docs.entries()].find(([k]) => k.includes('/auditoria/'))![1];
    expect(aud).toMatchObject({ accion: 'borrar_medios_conversacion', motivo: 'pedido del titular', medios: 3, estado: 'completada' });
    expect(JSON.stringify(aud)).not.toMatch(new RegExp(`${TEL}|wamid|tenants/`));
  });

  it('idempotente: un segundo --aplicar no falla ni vuelve a auditar', async () => {
    const { db, docs } = crear(escenario()); const al = almacenDoble(objetosDe());
    await ejecutar({ db, almacen: al, ...base({ aplicar: true }) });
    const n = [...docs.keys()].filter((k) => k.includes('/auditoria/')).length;
    const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true }) }) as any;
    expect(r.ok).toBe(true);
    expect([...docs.keys()].filter((k) => k.includes('/auditoria/')).length).toBe(n);
  });

  it('reanuda: si los objetos ya se borraron pero los metadatos quedaron, termina', async () => {
    const { db } = crear(escenario()); const al = almacenDoble([ruta('clinica-uno', 4)]);
    const r = await ejecutar({ db, almacen: al, ...base({ aplicar: true, objetosYaBorrados: true }) }) as any;
    expect(r.ok).toBe(true);
    expect(r.despues.medios).toBe(0);
  });

  it('con --aplicar exige motivo y carpeta de respaldo', async () => {
    const { db } = crear(escenario()); const al = almacenDoble(objetosDe());
    expect((await ejecutar({ db, almacen: al, ...base({ aplicar: true, motivo: '' }) }) as any).ok).toBe(false);
    expect((await ejecutar({ db, almacen: al, ...base({ aplicar: true, respaldoEn: null }) }) as any).ok).toBe(false);
    expect(al.llamadas).toEqual([]);
  });
});
