/**
 * CAMPO DE DINERO: la moneda adentro, el número a la derecha.
 *
 * POR QUÉ LA MONEDA VA DENTRO DEL CAMPO. Fuera —como parte del rótulo, o como
 * texto al lado— se lee como una palabra más de la frase. Adentro se lee como
 * parte del número, que es lo que es. En un panel donde conviven bolivianos y
 * dólares, la diferencia es si el comercio sabe o no en qué está escribiendo
 * el 7 de «costo de envío».
 *
 * NO ES UN CAMPO NUEVO, es el mismo `<input type="number">` con su símbolo al
 * lado: el ancho corto y el número alineado a la derecha salen de la hoja de
 * estilos, por el tipo del control, y no de acá.
 */
export function CampoMonto({ moneda = 'Bs', ...resto }:
{ moneda?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="con-moneda">
      {/* `aria-hidden`: el rótulo del campo ya dice de qué se trata, y un lector
          de pantalla que anuncie «Bs» suelto antes del número solo estorba. */}
      <span className="moneda" aria-hidden="true">{moneda}</span>
      <input type="number" min={0} step="0.01" {...resto} />
    </span>
  );
}
