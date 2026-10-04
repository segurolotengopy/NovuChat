/**
 * RECORDATORIO DE 24 H DE BELLIDO (flujo de PRUEBA): el criterio de «paciente gestionado por NovuChat».
 *
 * Decisión de Andres (03/10/2026): haber agendado por el sistema habilita el recordatorio; el mensaje no
 * lleva datos del paciente (saludo y «tu peque» configurables, más fecha y hora); y no se recuerda a
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
const SALUDO = 'te escribimos del consultorio';
// Cómo lo lee el paciente: el cuerpo aprobado de la plantilla con las 4 variables puestas.
const leido = (p: string[]): string =>
  `Hola ${p[0]}, Este es un recordatorio sobre tu próxima cita con ${p[1]} el ${p[2]} a las ${p[3]}. ¡Esperamos verte!`;
const TITULO = 'Quispe Mamani, Valentina (CNS)';
const NOMBRE = 'Valentina';
const APELLIDO = 'Quispe Mamani';
const MARCA = 'Agendado por NovuChat.';
// Mañana 11:00 de La Paz = 15:00 UTC. El 06/10/2026 es martes.
const INICIO = '2026-10-06T11:00:00-04:00';

const CFG: J = {
  calendarioId: 'cal-de-prueba', phoneNumberId: 'pnid-de-prueba', waGraphVersion: 'v26.0',
  plantilla: 'recordatorio_cita_consultorio', idiomaPlantilla: 'es', conQuienVariable: 'el Doctor Bellido',
  prefijosPermitidos: '591', estadoComercio: 'operativo', saludoVariable: SALUDO, variablesCuerpo: '4',
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
  it('la cita gestionada por NovuChat SÍ sale, con las variables de configuración y sin el nombre', () => {
    const s = correrPreparar([evento()]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      eventoId: 'ev-1', telefono: TEL,
      fecha: 'martes 6 de octubre', hora: '11:00', plantilla: 'recordatorio_cita_consultorio', idioma: 'es',
      parametros: [SALUDO, 'el Doctor Bellido', 'martes 6 de octubre', '11:00'],
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
    expect(s[0]['parametros'][0]).toBe(SALUDO);
    expect(s[0]['parametros'][1]).toBe('el Doctor Bellido');
    expect(s[0]['parametros'].join(' ')).not.toContain(NOMBRE);
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

  it('el cuerpo que se envía a Meta del flujo generado se lee completo, no manda parámetro de botón y no lleva ningún nombre', () => {
    const nodo = FLUJO.nodes.find((n) => n.name === 'Enviar plantilla');
    expect(nodo).toBeTruthy();
    const salida = correrPreparar([evento({ description: desc(`Cliente: ${NOMBRE}`, `Telefono: ${TEL}`, MARCA) })])[0];
    const cuerpo = JSON.parse(String(expresion(nodo!.parameters['jsonBody'], salida))) as J;
    const parametros = cuerpo['template'].components[0].parameters.map((p: J) => p['text']);
    expect(cuerpo['template'].name).toBe('recordatorio_cita_consultorio');
    expect(cuerpo['template'].language.code).toBe('es');
    expect(parametros).toEqual([SALUDO, 'el Doctor Bellido', 'martes 6 de octubre', '11:00']);
    expect(leido(parametros)).toBe('Hola te escribimos del consultorio, Este es un recordatorio sobre tu próxima cita con el Doctor Bellido el martes 6 de octubre a las 11:00. ¡Esperamos verte!');
    // el botón de la plantilla es una URL fija: no se manda ningún componente de botón, solo el cuerpo
    expect(cuerpo['template'].components).toHaveLength(1);
    expect(cuerpo['template'].components[0].type).toBe('body');
    expect(JSON.stringify(cuerpo)).not.toMatch(/button/i);
    expect(String(nodo!.parameters['jsonBody'])).not.toMatch(/button/i);
    expect(JSON.stringify(cuerpo)).not.toMatch(/Valentina|Quispe|Mamani|CNS/);
  });

  it('las variables 1 y 2 son configurables; sin la clave rigen los valores por omisión', () => {
    expect(correrPreparar([evento()])[0]['parametros'].slice(0, 2)).toEqual([SALUDO, 'el Doctor Bellido']);
    const otras = correrPreparar([evento()], { ...CFG, saludoVariable: 'le escribimos', conQuienVariable: 'su hijo' })[0];
    expect(otras['parametros'].slice(0, 2)).toEqual(['le escribimos', 'su hijo']);
    const { saludoVariable: _a, conQuienVariable: _b, ...sinClaves } = CFG;
    expect(correrPreparar([evento()], sinClaves)[0]['parametros'].slice(0, 2)).toEqual([SALUDO, 'el Doctor Bellido']);
    // una clave vacía no manda una variable vacía (Meta la rechaza): rige el valor por omisión
    expect(correrPreparar([evento()], { ...CFG, saludoVariable: '  ' })[0]['parametros'][0]).toBe(SALUDO);
  });

  it('la fecha y la hora van solas, sin «el» ni «a las»', () => {
    const p = correrPreparar([evento()])[0]['parametros'];
    expect(p[2]).toBe('martes 6 de octubre');
    expect(p[3]).toBe('11:00');
    expect(p[2]).not.toMatch(/^el\b/i);
    expect(p[3]).not.toMatch(/a las/i);
  });

  it('ninguna variable lleva saltos de línea, tabuladores ni 4 o más espacios seguidos (límite de Meta)', () => {
    const sucia = { ...CFG, saludoVariable: 'te escribimos\n\tdel   Dr.      Bellido\r\n', conQuienVariable: ' el\n\n Doctor    Bellido ' };
    for (const cfg of [CFG, sucia]) {
      const p = correrPreparar([evento()], cfg)[0]['parametros'] as string[];
      expect(p).toHaveLength(4);
      for (const v of p) {
        expect(v).not.toMatch(/[\r\n\t]/);
        expect(v).not.toMatch(/ {4,}/);
        expect(v).toBe(v.trim());
        expect(v.length).toBeGreaterThan(0);
      }
    }
    // la sucia se limpia, no se descarta: el texto queda legible
    expect(correrPreparar([evento()], sucia)[0]['parametros'].slice(0, 2)).toEqual(['te escribimos del Dr. Bellido', 'el Doctor Bellido']);
  });

  it('con una plantilla de 3 variables la lista no lleva el saludo; con 4 sí', () => {
    const tres = correrPreparar([evento()], { ...CFG, variablesCuerpo: '3' })[0]['parametros'];
    expect(tres).toEqual(['el Doctor Bellido', 'martes 6 de octubre', '11:00']);
    expect(tres).not.toContain(SALUDO);
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
    expect(valores['conQuienVariable']).toBe('el Doctor Bellido');
    expect(valores['saludoVariable']).toBe(SALUDO);
    expect(valores).not.toHaveProperty('nombreNegocio');
    expect(valores['variablesCuerpo']).toBe('4');
  });

  it('el repositorio no guarda teléfonos reales: el JSON y las citas de prueba usan los marcadores', () => {
    const texto = JSON.stringify(FLUJO) + readFileSync(join(RAIZ, 'src/citas-ficticias.js'), 'utf8');
    expect(texto).toContain('REEMPLAZAR_TELEFONO_PRUEBA_ANDRES');
    expect(texto).not.toMatch(/\b591[67]\d{7}\b/);
  });
  it('Meta rechaza una variable de más de 30 caracteres: las de por omisión caben y una más larga omite la cita con su causa', () => {
    const r = correrPreparar([evento()], CFG);
    for (const v of r[0]['parametros'] as string[]) expect(v.length, v).toBeLessThanOrEqual(30);
    expect(SALUDO.length).toBeLessThanOrEqual(30);
    const larga = correrPreparar([evento()], { ...CFG, saludoVariable: 'te escribimos del consultorio del Dr. Bellido' });
    expect(larga).toHaveLength(1);
    expect(larga[0]['sinRecordatorios']).toBe(true);
    expect(larga[0]['omitidas']).toContain('variable de plantilla de mas de 30 caracteres');
  });

});

describe('recordatorio de Bellido: el teléfono se lee posicional y anclado (hallazgo MEDIUM de la revisión de seguridad del PR 405)', () => {
  const ATACANTE = '59100000099';
  const conDescripcion = (d: string): J[] => correrPreparar([evento({ description: d })]);

  it('un perfil con «\nTelefono: …» antes de la línea real NO sale: la cita es ambigua y se omite', () => {
    const inyectada = desc(`Cliente: Valentina`, `Telefono: ${ATACANTE}`, `Telefono: ${TEL}`, 'Servicio: Control del niño sano', MARCA);
    expect(conDescripcion(inyectada)).toEqual([{ sinRecordatorios: true, omitidas: ['telefono ambiguo'] }]);
    // aunque la línea inyectada vaya después de la real
    expect(conDescripcion(desc('Cliente: Valentina', `Telefono: ${TEL}`, `Telefono: ${ATACANTE}`, MARCA)))
      .toEqual([{ sinRecordatorios: true, omitidas: ['telefono ambiguo'] }]);
    // el opuesto: con una sola línea, sale a ese número
    expect(conDescripcion(GESTIONADA)[0]).toMatchObject({ telefono: TEL });
  });

  it('la ambigüedad se cuenta sobre la descripción COMPLETA: una segunda línea «Telefono:» pasada de los 4000 caracteres también omite la cita', () => {
    const relleno = 'x'.repeat(4100);
    const tarde = desc('Cliente: Valentina', `Telefono: ${TEL}`, MARCA, relleno, `Telefono: ${ATACANTE}`);
    expect(tarde.indexOf(`Telefono: ${ATACANTE}`)).toBeGreaterThan(4000);
    expect(conDescripcion(tarde)).toEqual([{ sinRecordatorios: true, omitidas: ['telefono ambiguo'] }]);
    // el opuesto: el mismo relleno sin la segunda línea sale
    expect(conDescripcion(desc('Cliente: Valentina', `Telefono: ${TEL}`, MARCA, relleno))[0]).toMatchObject({ telefono: TEL });
  });

  it('solo cuenta la línea que le toca: la 2 si la 1 es «Cliente:», la 1 si no; una línea «Telefono:» más abajo NO sirve', () => {
    expect(conDescripcion(desc('Cliente: Perfil', 'Servicio: Control del niño sano', `Telefono: ${TEL}`, MARCA)))
      .toEqual([{ sinRecordatorios: true, omitidas: ['sin telefono'] }]);
    expect(conDescripcion(desc('Nota del doctor', `Telefono: ${TEL}`, MARCA)))
      .toEqual([{ sinRecordatorios: true, omitidas: ['sin telefono'] }]);
    // los opuestos
    expect(conDescripcion(desc(`Telefono: ${TEL}`, 'Servicio: x', MARCA))[0]).toMatchObject({ telefono: TEL });
    expect(conDescripcion(desc('Cliente: Perfil', `Teléfono: +${TEL}`, MARCA))[0]).toMatchObject({ telefono: TEL });
  });

  it('la línea es entera: texto antes o después del número no vale; 16 o más dígitos NO es un teléfono', () => {
    const con = (linea: string): J[] => conDescripcion(desc('Cliente: Perfil', linea, MARCA));
    const noValida = [{ sinRecordatorios: true, omitidas: ['sin telefono'] }];
    expect(con(`Telefono: ${TEL}0000000`)).toEqual(noValida);            // 18 dígitos
    expect(con(`Telefono: ${'5910000002100000'}`)).toEqual(noValida);     // 16 dígitos
    expect(con(`Telefono: ${TEL} y otro`)).toEqual(noValida);
  });

  it('con 15 dígitos y prefijo permitido sale; con 7 no', () => {
    const con = (n: string): J[] => conDescripcion(desc('Cliente: Perfil', `Telefono: ${n}`, MARCA));
    expect(con('591000000212345')[0]).toMatchObject({ telefono: '591000000212345' });
    expect(con('5910000')).toEqual([{ sinRecordatorios: true, omitidas: ['sin telefono'] }]);
  });

  it('sin prefijos configurados falla cerrado: no sale nada a ningún prefijo y se marca como falla de configuración', () => {
    for (const prefijosPermitidos of ['', '  ', ' , ']) {
      expect(correrPreparar([evento()], { ...CFG, prefijosPermitidos })).toEqual([
        { sinRecordatorios: true, omitidas: ['sin prefijos configurados'], fallaConfiguracion: ['sin prefijos configurados'] },
      ]);
    }
    const { prefijosPermitidos: _p, ...sinClave } = CFG;
    expect(correrPreparar([evento()], sinClave)[0]['fallaConfiguracion']).toEqual(['sin prefijos configurados']);
    expect(correrPreparar([evento()], { ...CFG, prefijosPermitidos: '591' })).toHaveLength(1);
  });
});

describe('recordatorio de Bellido: calendario, descripción completa y fallas de configuración', () => {
  it('el calendario del evento es siempre el configurado, nunca el organizer', () => {
    const s = correrPreparar([evento({ organizer: { email: 'otro-calendario@example.org' } })]);
    expect(s[0]['calendarioDelEvento']).toBe('cal-de-prueba');
    expect(JSON.stringify(s)).not.toContain('otro-calendario');
  });

  it('la descripción NO se trunca al marcar: vuelve entera con la marca; solo se trunca para analizarla', () => {
    const larga = GESTIONADA + '\n' + 'x'.repeat(6000) + '\nfin-de-la-descripcion';
    const [s] = correrPreparar([evento({ description: larga })]);
    expect(String(s!['descripcionMarcada']).startsWith(larga + '\n[recordado] ')).toBe(true);
    expect(String(s!['descripcionMarcada'])).toContain('fin-de-la-descripcion');
    // una marca [recordado] o [no recordar] más allá de los 4000 caracteres tampoco se pierde
    const marcadaAlFinal = GESTIONADA + '\n' + 'x'.repeat(5000) + '\n[recordado] 2026-10-05T21:00:00.000Z';
    expect(omitidasDe(correrPreparar([evento({ description: marcadaAlFinal })]))).toEqual(['ya recordada']);
    expect(omitidasDe(correrPreparar([evento({ description: GESTIONADA + '\n' + 'x'.repeat(5000) + '\n[no recordar]' })]))).toEqual(['no recordar']);
  });

  it('una variable de más de 30 caracteres es una falla de CONFIGURACIÓN (el flujo termina en error); una cita que no corresponde no', () => {
    const larga = correrPreparar([evento()], { ...CFG, saludoVariable: 'te escribimos del consultorio del Dr. Bellido' });
    expect(larga[0]['fallaConfiguracion']).toEqual(['variable de plantilla de mas de 30 caracteres']);
    expect(correrPreparar([evento({ status: 'cancelled' })])[0]).not.toHaveProperty('fallaConfiguracion');
    expect(correrPreparar([evento({ description: 'sin marca' })])[0]).not.toHaveProperty('fallaConfiguracion');
  });
});

describe('recordatorio de Bellido (prueba): nada sale a un número que no sea de prueba', () => {
  const OTRO = '59100000055';
  const conLista: J = { ...CFG, telefonoPruebaAndres: TEL, telefonoPruebaSilvana: '59100000022' };
  const de = (tel: string): J => evento({ description: desc('Cliente: Perfil', `Telefono: ${tel}`, MARCA) });

  it('con la lista de prueba en el Config solo salen Andres y Silvana; cualquier otro número se omite con su causa', () => {
    const s = correrPreparar([de(TEL), de('59100000022'), de(OTRO)], conLista);
    expect(s.map((x) => x['telefono'])).toEqual([TEL, '59100000022']);
    expect(omitidasDe(s)).toEqual(['fuera de la lista de prueba']);
    expect(correrPreparar([de(OTRO)], conLista)).toEqual([{ sinRecordatorios: true, omitidas: ['fuera de la lista de prueba'] }]);
  });

  it('con la lista de prueba vacía (marcador sin resolver) falla cerrado; sin las claves (flujo definitivo) no filtra', () => {
    const vacia = { ...CFG, telefonoPruebaAndres: '', telefonoPruebaSilvana: '' };
    expect(correrPreparar([de(TEL)], vacia)).toEqual([{ sinRecordatorios: true, omitidas: ['fuera de la lista de prueba'] }]);
    expect(correrPreparar([de(OTRO)], CFG)).toHaveLength(1);
  });

  it('las citas ficticias del flujo de prueba, con el formato del chat, dejan salir SOLO a Andres y a Silvana', () => {
    const fuente = readFileSync(join(RAIZ, 'src/citas-ficticias.js'), 'utf8');
    const cfgPrueba = { calendarioId: 'cal-de-prueba', telefonoPruebaAndres: TEL, telefonoPruebaSilvana: '59100000022' };
    const citas = ejecutar(fuente, [{}], { 'Config de la prueba': cfgPrueba });
    expect(citas).toHaveLength(6);
    const eventos = citas.map((c, i) => ({
      id: `f${i}`, status: 'confirmed', iCalUID: `f${i}@google.com`, start: { dateTime: c['start'] }, description: c['description'],
    }));
    const s = correrPreparar(eventos, conLista);
    expect(s.map((x) => x['telefono'])).toEqual([TEL, '59100000022']);
  });
});
