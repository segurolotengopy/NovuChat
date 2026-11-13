export interface Conversacion { version: number; estado: Record<string, unknown> | null; desde: number | null; vence: number | null; vencido: boolean }
export interface RespuestaHttp { statusCode: number; body: Record<string, unknown> }
export interface ServidorDeSesion {
  docs: Map<string, unknown>;
  llamadas: Record<string, unknown>[];
  antesDeComprometer: ((cuerpo: Record<string, unknown>) => void) | null;
  fallar: ((cuerpo: Record<string, unknown>) => number | null) | null;
  conversacion(pnid: string, espacio: string, tel: string): Conversacion;
  sembrar(pnid: string, espacio: string, tel: string, estado: Record<string, unknown> | null, venceEnMin?: number): void;
  atender(pnid: string, cuerpo: Record<string, unknown>): RespuestaHttp;
}
export function crearServidorDeSesion(opciones?: { ahoraMs?: () => number; espacios?: string[] | null }): ServidorDeSesion;
