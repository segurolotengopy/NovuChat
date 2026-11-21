// EXPANDIR CITAS: de una cita por turno a un item por cita. Con un paciente sale un item; con dos
// hermanos, dos (uno por hermano, la 2a empieza donde termina la 1a). «Crear evento» corre una vez por
// item y lee del propio item: `inicio`, `fin`, `titulo` y `descripcion`. Todo lo calcula
// «Resolver con agenda»; aca solo se reparte.
const r = cnPrimero('Resolver con agenda') || {};
return ((r.crear && r.crear.citas) || []).map((c) => ({ json: c }));
