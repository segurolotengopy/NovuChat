/**
 * `scripts/citas-a-calendario.mjs` — LAS CITAS QUE YA EXISTEN, IMPORTABLES.
 *
 * POR QUÉ IMPORTA ESTA SUITE, y no es por el formato del archivo. Una cita
 * cargada a mano en el calendario **no la encuentra el asistente**:
 * `buscar_mi_cita` busca por el TELÉFONO del paciente, que `agendar_cita`
 * escribe en la descripción del evento. Si el .ics no escribe esa línea con el
 * mismo formato, el paciente de octubre que pida mover su cita va a recibir «no
 * encuentro ninguna cita», y nadie va a saber por qué.
 *
 * Así que la prueba central no mira el .ics contra un texto copiado acá: lo
 * mira contra la expresión del nodo `agendar_cita` del flujo que corre de
 * verdad. Si alguien cambia esa descripción en n8n y exporta, esta prueba se
 * pone roja.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(aqui, '..', 'scripts', 'citas-a-calendario.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'citas-'));

const correr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
};

const CABECERA = 'fecha,hora,nombre,telefono,servicio';
const generar = (filas: string[], ...extra: string[]) => {
  const csv = join(tmp, `e-${Math.random().toString(36).slice(2)}.csv`);
  const ics = `${csv}.ics`;
  writeFileSync(csv, [CABECERA, ...filas].join('\n') + '\n', 'utf8');
  const r = correr('--entrada', csv, '--salida', ics, ...extra);
  return { ...r, ics, leer: () => readFileSync(ics, 'utf8') };
};

describe('La llamada', () => {
  it('sin --entrada ni --salida no hace nada y lo dice', () => {
    const r = correr();
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('falta --entrada');
    expect(r.salida).toContain('falta --salida');
  });

  it('una duración disparatada se rechaza', () => {
    const r = correr('--entrada', 'x.csv', '--salida', 'y.ics', '--minutos', '900');
    expect(r.codigo).toBe(2);
    expect(r.salida).toContain('--minutos entre 5 y 480');
  });

  it('la plantilla trae la cabecera exacta y dos filas de ejemplo', () => {
    const p = join(tmp, 'plantilla.csv');
    expect(correr('--plantilla', p).codigo).toBe(0);
    const lineas = readFileSync(p, 'utf8').trim().split('\n');
    expect(lineas[0]).toBe(CABECERA);
    expect(lineas).toHaveLength(3);
  });
});

describe('La planilla se revisa antes de escribir nada', () => {
  it('una cabecera incompleta no se adivina', () => {
    const csv = join(tmp, 'mala.csv');
    writeFileSync(csv, 'fecha,hora,nombre\n2026-10-07,11:00,Ana\n', 'utf8');
    const r = correr('--entrada', csv, '--salida', `${csv}.ics`);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain('telefono');
    expect(r.salida).toContain('servicio');
  });

  it.each([
    ['07/10/2026,11:00,Ana,71234567,x', 'no es AAAA-MM-DD'],
    ['2026-02-31,11:00,Ana,71234567,x', 'no existe'],
    ['2026-10-07,25:00,Ana,71234567,x', 'no existe'],
    ['2026-10-07,11:00,,71234567,x', 'falta el nombre'],
    ['2026-10-07,11:00,Ana,123,x', 'demasiado corto'],
    ['2026-10-07,11:00,Ana,71234567,', 'falta el servicio'],
  ])('«%s» se rechaza con el motivo y el número de fila', (fila, motivo) => {
    const r = generar([fila]);
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(motivo);
    expect(r.salida).toContain('fila 2');
    expect(r.salida).toContain('no se escribió nada');
  });

  it('lista TODOS los problemas de una vez, no solo el primero', () => {
    const r = generar(['mal,11:00,Ana,71234567,x', '2026-10-07,99:99,Ana,71234567,x']);
    expect(r.salida).toContain('2 problema(s)');
  });
});

describe('El .ics', () => {
  it('pone la hora local con el TZID del negocio, sin convertir a UTC', () => {
    const r = generar(['2026-10-07,11:00,Ana Quispe,71234567,control-del-nino-sano']);
    expect(r.codigo).toBe(0);
    const ics = r.leer();
    expect(ics).toContain('DTSTART;TZID=America/La_Paz:20261007T110000');
    expect(ics).toContain('DTEND;TZID=America/La_Paz:20261007T113000');
    // Una hora en «Z» sería una cita corrida cuatro horas.
    expect(ics).not.toMatch(/DTSTART[^\r\n]*Z\r?\n/);
  });

  it('la duración manda, y el fin puede cruzar la hora', () => {
    const ics = generar(['2026-10-07,11:45,Ana,71234567,x'], '--minutos', '45').leer();
    expect(ics).toContain('DTEND;TZID=America/La_Paz:20261007T123000');
  });

  it('el teléfono queda en la forma de Meta: dígitos con código de país, sin «+»', () => {
    for (const escrito of ['+591 7123-4567', '7123 4567', '0059171234567', '59171234567']) {
      const ics = generar([`2026-10-07,11:00,Ana,${escrito},x`]).leer();
      expect(ics.replace(/\r\n /g, ''), escrito).toContain('Telefono: 59171234567');
    }
  });

  it('un nombre con coma no rompe el archivo ni la columna', () => {
    const ics = generar(['2026-10-07,11:00,"Quispe, Ana",71234567,control'], '--minutos', '30').leer();
    expect(ics).toContain('SUMMARY:Cita Quispe\\, Ana — control');
  });

  it('avisa de las citas que se pisan, pero escribe el archivo', () => {
    const r = generar([
      '2026-10-07,11:00,Ana,71234567,x',
      '2026-10-07,11:15,Luis,72345678,y',
    ]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain('se pisan');
    expect(r.leer()).toContain('BEGIN:VEVENT');
  });

  it('dos citas que NO se pisan no generan aviso', () => {
    const r = generar([
      '2026-10-07,11:00,Ana,71234567,x',
      '2026-10-07,11:30,Luis,72345678,y',
    ]);
    expect(r.salida).not.toContain('se pisan');
  });

  it('cada evento tiene un UID propio: importar dos veces no duplica', () => {
    const ics = generar([
      '2026-10-07,11:00,Ana,71234567,x',
      '2026-10-07,11:30,Luis,72345678,y',
    ]).leer();
    const uids = [...ics.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!.trim());
    expect(uids).toHaveLength(2);
    expect(new Set(uids).size).toBe(2);
  });
});

/**
 * LA PRUEBA QUE IMPORTA: la descripción que escribe el script tiene que ser la
 * MISMA que escribe `agendar_cita` en el flujo, porque es lo que hace que
 * `buscar_mi_cita` encuentre la cita. Se lee del flujo, no de una copia.
 */
describe('La descripción es la que el asistente sabe leer', () => {
  const flujo = JSON.parse(
    readFileSync(join(aqui, '../../Flujos/bellido-agendamiento.json'), 'utf8'),
  ) as { nodes: { name: string; parameters: Record<string, unknown> }[] };

  it('coincide letra por letra con la de «agendar_cita» del flujo', () => {
    const agendar = flujo.nodes.find((n) => n.name === 'agendar_cita')!;
    const enElFlujo = String((agendar.parameters['additionalFields'] as Record<string, unknown>)['description']);
    // La expresión del nodo, con los dos datos del cliente puestos.
    const esperada = enElFlujo
      .replace(/^=/, '')
      .replace(/\{\{[^}]*nombrePerfil[^}]*\}\}/, 'Ana Quispe')
      .replace(/\{\{[^}]*\.from[^}]*\}\}/, '59171234567');

    const ics = generar(['2026-10-07,11:00,Ana Quispe,71234567,control-del-nino-sano']).leer();
    // Se deshace el plegado de líneas del ICS y el escapado de la coma.
    const descripcion = /DESCRIPTION:((?:.|\r\n )*?)\r\n[A-Z]/.exec(ics)![1]!
      .replace(/\r\n /g, '')
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',');

    expect(descripcion).toBe(esperada);
    // Y lo que de verdad hace falta: el teléfono, que es por lo que se busca.
    expect(descripcion).toContain('Telefono: 59171234567');
  });

  it('el título sigue el formato «Cita <nombre> — <servicio>» que usa el flujo', () => {
    const agendar = flujo.nodes.find((n) => n.name === 'agendar_cita')!;
    const titulo = String((agendar.parameters['additionalFields'] as Record<string, unknown>)['summary']);
    expect(titulo).toContain('Cita <nombre> — <servicio>');
    const ics = generar(['2026-10-07,11:00,Ana Quispe,71234567,control-del-nino-sano']).leer();
    expect(ics).toContain('SUMMARY:Cita Ana Quispe — control-del-nino-sano');
  });
});
