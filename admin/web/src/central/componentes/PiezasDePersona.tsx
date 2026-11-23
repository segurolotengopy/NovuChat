import { EscribirComoPersona } from './EscribirComoPersona';
import { AdjuntarComoPersona } from './AdjuntarComoPersona';
import type { CapaTurno } from '../lib/turno';
import type { CapaAdjunto } from '../lib/adjuntos';

/**
 * LO QUE EL DETALLE DE UNA CONVERSACIÓN LE OFRECE A LA PERSONA QUE LA TIENE: el campo de texto, el aviso de que ya no se
 * pueden enviar archivos y el selector de adjuntos. Son HERMANOS (un fragmento: en pantalla cuelgan directo del detalle).
 *
 * POR QUÉ ES UN COMPONENTE APARTE. En B4 el campo y el selector llevaban la MISMA llave (`key={ficha.id}`) como hermanos:
 * al devolver o volver a tomar la conversación React emparejaba por llave, perdía a uno y dejaba vivo el campo viejo
 * (reloj congelado, texto pegado, el clip fuera de la vista; se acumulaba un campo por cada tomar/devolver). Aquí cada
 * hermano tiene su llave propia, y la prueba (`detalle-llaves.test.ts`) pinta ESTE componente, el mismo del Detalle.
 */
export interface PropsPiezasDePersona {
  tenantId: string;
  conversacionId: string;
  nombreContacto: string;
  telefono: string;
  ultimoEntranteEn: number | null;
  miUid: string | null;
  /** Quien mira tiene la conversación (el campo de texto se pinta solo entonces). */
  verEscribir: boolean;
  habilitados: boolean;
  /** `turno.retomadoEn` en ms (se retomó con plantilla): el campo dice «Esperando la respuesta del cliente». */
  retomadoEn?: number | null;
  /** `verAdjuntar(...)`: bandera, turno, ventana y comercio habilitado, todo junto. */
  puedeAdjuntar: boolean;
  /** Se veía el selector y dejó de verse: se explica por qué (el archivo preparado se pierde con él). */
  avisoSinArchivos: boolean;
  capa: CapaTurno;
  capaAdjunto: CapaAdjunto;
  /** Dónde se pinta cada pieza: `barra` = el campo de texto (bajo el hilo); `opciones` = el aviso y los adjuntos (menú «Opciones»); sin valor, todo. */
  zona?: 'barra' | 'opciones';
}

export function PiezasDePersona(p: PropsPiezasDePersona) {
  return (
    <>
      {p.zona !== 'opciones' && (
        <>
          {p.verEscribir && (
            <EscribirComoPersona
              key={`escribir-${p.conversacionId}`} tenantId={p.tenantId} conversacionId={p.conversacionId}
              ultimoEntranteEn={p.ultimoEntranteEn} habilitados={p.habilitados} capa={p.capa} miUid={p.miUid}
              retomadoEn={p.retomadoEn ?? null}
            />
          )}
        </>
      )}
      {p.zona !== 'barra' && (
        <>
          {p.avisoSinArchivos && (
            <p role="status" className="cv-aviso-linea">
              Ya no se pueden enviar archivos en esta conversación: la ventana de 24 h de WhatsApp se cerró o usted ya no la tiene.
            </p>
          )}
          {p.puedeAdjuntar && (
            <AdjuntarComoPersona
              key={`adjuntar-${p.conversacionId}`} tenantId={p.tenantId} conversacionId={p.conversacionId}
              nombreContacto={p.nombreContacto} telefono={p.telefono} capa={p.capaAdjunto} miUid={p.miUid}
            />
          )}
        </>
      )}
    </>
  );
}
