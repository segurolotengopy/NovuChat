/**
 * RECORDATORIO DE 24 H DE BELLIDO (flujo de PRUEBA): el criterio de «paciente gestionado por NovuChat».
 *
 * Decisión de Andres (03/10/2026): haber agendado por el sistema habilita el recordatorio; el mensaje no
 * lleva datos del paciente («Hola paciente,» y «el consultorio», más fecha y hora); y no se recuerda a
 * pacientes que NovuChat no gestionó. Reemplaza la regla anterior «toda cita con la línea Telefono:».
 *
 * Todas las pruebas son puras y negando: cada caso que NO debe salir trae su opuesto, que sí sale. El Code
 * se corre con `ejecutar` de `./lib/flujo` (sin los globales que el Code de n8n no tiene). Teléfonos
 * sintéticos con seis ceros.
 *
 * LO QUE ESTA SUITE NO PUEDE PROBAR: que Google Calendar devuelva `iCalUID` y `status` como se supone (es
 * el formato del recurso «Event» de la API, que el nodo «Obtener varios» entrega tal cual), ni cómo trate
 * n8n una descripción editada en la interfaz de Calendar. Se verifica en la prueba contra el calendario
 * de pruebas.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ejecutar, expresion, type J } from './lib/flujo';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../../Flujos/experimental/recordatorio-bellido');
const PREPARAR = readFileSync(join(RAIZ, 'src/preparar-recordatorios.js'), 'utf8');
const FLUJO = JSON.parse(readFileSync(join(RAIZ, 'recordatorio-bellido.prueba.json'), 'utf8')) as {
  nodes: { name: string; parameters: J }[];
};

const TEL = '59100000021';
const TITULO = 'Quispe Mamani, Valentina (CNS)';
const NOMBRE = 'Valentina';
const APELLIDO = 'Quispe Mamani';
const MARCA = 'Agendado por NovuChat.';
// Mañana 11:00 de La Paz = 15:00 UTC. El 06/10/2026 es martes.
const INICIO = '2026-10-06T11:00:00-04:00';

const CFG: J = {
  calendarioId: 'cal-de-prueba', phoneNumberId: 'pnid-de-prueba', waGraphVersion: 'v26.0',
  plantilla: 'recordatorio_cita_consultorio', idiomaPlantilla: 'es', nombreNegocio: 'Consultorio del Dr. Bellido',
  prefijosPermitidos: '591', estadoComercio: 'operativo', saludoVariable: 'paciente', variablesCuerpo: '4',
};

const desc = (...lineas: string[]): string => lineas.join('\n');
const GESTIONADA = desc('Cliente: Perfil de WhatsApp', `Telefono: ${TEL}`, 'Servicio: Control del niño sano', MARCA);

const evento = (extra: J = {}): J => ({
  id: 'ev-1', summary: TITULO, status: 'confirmed', iCalUID: ['abc123', 'google.com'].join('@'),
  start: { dateTime: INICIO }, organizer: { email: 'cal-de-prueba' }, description: GESTIONADA, ...extra,
});

const correrPreparar = (eventos: J[], cfg: J = CFG): J[] =>
  ejecutar(PREPARAR, eventos, { 'Config del recordatorio': cfg });

const omitidasDe = (salida: J[]): string[] => (salida[0] && (salida[0]['omitidas'] as string[])) || [];

describe('recordatorio de Bellido: solo pacientes gestionados por NovuChat', () => {
  it('la cita gestionada por NovuChat SÍ sale, con el paciente genérico y sin el nombre', () => {
    const s = correrPreparar([evento()]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      eventoId: 'ev-1', telefono: TEL, negocio: 'Consultorio del Dr. Bellido',
      fecha: 'martes 6 de octubre', hora: '11:00', plantilla: 'recordatorio_cita_consultorio', idioma: 'es',
      parametros: ['paciente', 'Consultorio del Dr. Bellido', 'martes 6 de octubre', '11:00'],
    });
  });

  it('la cita manual con «Telefono:» pero sin la marca NO sale', () => {
    const manual = evento({ description: desc('Cliente: Perfil', `Telefono: ${TEL}`, 'Servicio: Control del niño sano') });
    const s = correrPreparar([manual]);
    expect(s).toEqual([{ sinRecordatorios: true, omitidas: ['no gestionada por NovuChat'] }]);
    // el opuesto: la misma cita con la marca sí sale
    expect(correrPreparar([evento({ description: manual['description'] + '\n' + MARCA })])).toHaveLength(1);
  });

  it('la marca debe ser una línea entera: una frase que la contiene no cuenta', () => {
    const copiada = evento({ description: desc(`Telefono: ${TEL}`, 'Nota: no es Agendado por NovuChat. sino manual') });
    expect(omitidasDe(correrPreparar([copiada]))).toEqual(['no gestionada por NovuChat']);
  });

  it('la importada (iCalUID novuchat-importada-…) NO sale aunque tenga la marca', () => {
    const importada = evento({ iCalUID: `novuchat-importada-20261006-01-${TEL}@novuchat` });
    expect(correrPreparar([importada])).toEqual([{ sinRecordatorios: true, omitidas: ['importada'] }]);
    // el opuesto: un iCalUID de Google sí sale
    expect(correrPreparar([evento({ iCalUID: ['otro', 'google.com'].join('@') })])).toHaveLength(1);
  });

  it('la cancelada NO sale; la confirmada sí', () => {
    expect(correrPreparar([evento({ status: 'cancelled' })])).toEqual([{ sinRecordatorios: true, omitidas: ['cancelada'] }]);
    expect(correrPreparar([evento({ status: 'confirmed' })])).toHaveLength(1);
  });

  it('«[no recordar]» NO sale, con cualquier combinación de mayúsculas', () => {
    for (const marca of ['[no recordar]', '[NO RECORDAR]', '[No Recordar]']) {
      const s = correrPreparar([evento({ description: GESTIONADA + '\n' + marca })]);
      expect(s).toEqual([{ sinRecordatorios: true, omitidas: ['no recordar'] }]);
    }
  });

  it('«[recordado]» NO sale: una vez por cita', () => {
    const s = correrPreparar([evento({ description: GESTIONADA + '\n[recordado] 2026-10-05T21:00:00.000Z' })]);
    expect(s).toEqual([{ sinRecordatorios: true, omitidas: ['ya recordada'] }]);
  });

  it('sin teléfono NO sale, con o sin la marca', () => {
    const sin = evento({ description: desc('Cliente: Perfil', 'Servicio: Control del niño sano', MARCA) });
    expect(correrPreparar([sin])).toEqual([{ sinRecordatorios: true, omitidas: ['sin telefono'] }]);
  });

  it('el prefijo ajeno NO sale; el permitido sí; «Teléfono:» con tilde también cuenta', () => {
    const ajeno = evento({ description: desc(`Telefono: ${['54', '911', '1234', '5678'].join('')}`, MARCA) });
    expect(correrPreparar([ajeno])).toEqual([{ sinRecordatorios: true, omitidas: ['prefijo no permitido'] }]);
    const conTilde = evento({ description: desc(`Teléfono: +${TEL}`, MARCA) });
    expect(correrPreparar([conTilde])[0]).toMatchObject({ telefono: TEL });
  });

  it('el comercio no operativo no manda nada, ni siquiera la cita gestionada', () => {
    for (const estadoComercio of ['suspendido', 'pausado', 'baja']) {
      expect(correrPreparar([evento()], { ...CFG, estadoComercio })).toEqual([]);
    }
    expect(correrPreparar([evento()], { ...CFG, estadoComercio: 'operativo' })).toHaveLength(1);
  });

  it('una mezcla: solo sale la gestionada y cada otra deja su causa (sin nombres)', () => {
    const s = correrPreparar([
      evento({ id: 'a' }),
      evento({ id: 'b', description: desc(`Telefono: ${TEL}`) }),
      evento({ id: 'c', status: 'cancelled' }),
      evento({ id: 'd', iCalUID: 'novuchat-importada-20261006-02-x@novuchat' }),
      evento({ id: 'e', description: GESTIONADA + '\n[no recordar]' }),
    ]);
    expect(s.map((x) => x['eventoId'])).toEqual(['a']);
    expect(omitidasDe(s)).toEqual(['no gestionada por NovuChat', 'cancelada', 'importada', 'no recordar']);
  });
});

describe('recordatorio de Bellido: el mensaje no lleva datos del paciente', () => {
  it('la salida no contiene el título ni el nombre (salvo la descripción que se devuelve al calendario)', () => {
    const conNombre = evento({
      summary: TITULO,
      description: desc(`Cliente: ${NOMBRE} ${APELLIDO}`, `Telefono: ${TEL}`, 'Paciente: ' + NOMBRE, MARCA),
    });
    const s = correrPreparar([conNombre]);
    expect(s).toHaveLength(1);
    expect(s[0]['parametros'][0]).toBe('paciente');
    expect(s[0]['parametros'][0]).not.toBe(NOMBRE);
    // Todo lo que sale a Meta o viaja por el flujo, salvo la descripción que ya era del calendario.
    const { descripcionMarcada, ...resto } = s[0];
    const texto = JSON.stringify(resto);
    for (const dato of [TITULO, NOMBRE, APELLIDO, 'Quispe', 'Mamani', 'Valentina', 'CNS']) expect(texto).not.toContain(dato);
    expect(Object.keys(resto)).not.toContain('summary');
    expect(Object.keys(resto)).not.toContain('servicio');
    // La descripción vuelve intacta con la marca, que es lo que el calendario ya tenía.
    expect(String(descripcionMarcada)).toContain(MARCA);
    expect(String(descripcionMarcada)).toMatch(/\n\[recordado\] \d{4}-\d{2}-\d{2}T/);
  });

  it('el cuerpo que se envía a Meta del flujo generado lleva el saludo, el negocio, la fecha y la hora y ningún nombre', () => {
    const nodo = FLUJO.nodes.find((n) => n.name === 'Enviar plantilla');
    expect(nodo).toBeTruthy();
    const salida = correrPreparar([evento({ description: desc(`Cliente: ${NOMBRE}`, `Telefono: ${TEL}`, MARCA) })])[0];
    const cuerpo = JSON.parse(String(expresion(nodo!.parameters['jsonBody'], salida))) as J;
    const parametros = cuerpo['template'].components[0].parameters.map((p: J) => p['text']);
    expect(cuerpo['template'].name).toBe('recordatorio_cita_consultorio');
    expect(cuerpo['template'].language.code).toBe('es');
    expect(parametros).toEqual(['paciente', 'Consultorio del Dr. Bellido', 'martes 6 de octubre', '11:00']);
    expect(JSON.stringify(cuerpo)).not.toMatch(/Valentina|Quispe|Mamani|CNS/);
  });

  it('el saludo es configurable: con la clave en «paciente» sale «paciente»; con otro valor sale ese valor', () => {
    expect(correrPreparar([evento()])[0]['parametros'][0]).toBe('paciente');
    expect(correrPreparar([evento()], { ...CFG, saludoVariable: 'estimado paciente' })[0]['parametros'][0]).toBe('estimado paciente');
    // sin la clave, el valor por omisión es «paciente»
    const { saludoVariable: _quitada, ...sinClave } = CFG;
    expect(correrPreparar([evento()], sinClave)[0]['parametros'][0]).toBe('paciente');
  });

  it('con una plantilla de 3 variables la lista no lleva el saludo; con 4 sí', () => {
    const tres = correrPreparar([evento()], { ...CFG, variablesCuerpo: '3' })[0]['parametros'];
    expect(tres).toEqual(['Consultorio del Dr. Bellido', 'martes 6 de octubre', '11:00']);
    expect(tres).not.toContain('paciente');
    expect(correrPreparar([evento()], { ...CFG, variablesCuerpo: '4' })[0]['parametros']).toHaveLength(4);
    // y el cuerpo que se envía a Meta sigue esa lista
    const nodo = FLUJO.nodes.find((n) => n.name === 'Enviar plantilla')!;
    const item = correrPreparar([evento()], { ...CFG, variablesCuerpo: '3' })[0];
    const cuerpo = JSON.parse(String(expresion(nodo.parameters['jsonBody'], item))) as J;
    expect(cuerpo['template'].components[0].parameters).toHaveLength(3);
  });

  it('el JSON generado está al día: el Code es el de src/ y la plantilla es la nueva', () => {
    const codigo = (nombre: string): string => String(FLUJO.nodes.find((n) => n.name === nombre)!.parameters['jsCode']);
    expect(codigo('Preparar recordatorios')).toBe(PREPARAR);
    expect(codigo('Citas ficticias')).toBe(readFileSync(join(RAIZ, 'src/citas-ficticias.js'), 'utf8'));
    const config = FLUJO.nodes.find((n) => n.name === 'Config del recordatorio')!;
    const valores = Object.fromEntries(
      (config.parameters['assignments'].assignments as { name: string; value: string }[]).map((a) => [a.name, a.value]),
    );
    expect(valores['plantilla']).toBe('recordatorio_cita_consultorio');
    expect(valores['idiomaPlantilla']).toBe('es');
    expect(valores['nombreNegocio']).toBe('Consultorio del Dr. Bellido');
    expect(valores['saludoVariable']).toBe('paciente');
    expect(valores['variablesCuerpo']).toBe('4');
  });

  it('el repositorio no guarda teléfonos reales: el JSON y las citas de prueba usan los marcadores', () => {
    const texto = JSON.stringify(FLUJO) + readFileSync(join(RAIZ, 'src/citas-ficticias.js'), 'utf8');
    expect(texto).toContain('REEMPLAZAR_TELEFONO_PRUEBA_ANDRES');
    expect(texto).not.toMatch(/\b591[67]\d{7}\b/);
  });
});
