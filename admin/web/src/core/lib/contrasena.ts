/**
 * =============================================================================
 * LA CONTRASEÑA DEL ADMINISTRADOR DE COMERCIO — un solo número, y acá
 * =============================================================================
 *
 * POR QUÉ ESTE ARCHIVO EXISTE. El mínimo estaba escrito dos veces, con el mismo
 * valor y sin ninguna relación: `minLength` en el ingreso y `MINIMO` en «Mi
 * cuenta». Tres pantallas hablan de lo mismo —el ingreso, el cambio de
 * contraseña y la de restablecimiento que sirve Firebase— y el 16/09/2026 eso
 * costó un alta: al administrador de un cliente nuevo la pantalla de Firebase
 * le aceptó una contraseña de once caracteres (la política propia de Firebase
 * admite desde seis), y después el formulario de ingreso de la consola se la
 * rechazó porque pedía doce. Quedó con una contraseña válida en el sistema de
 * identidad y bloqueado por la pantalla, sin un mensaje que explicara nada:
 * hubo que rotarle la clave y emitir otro enlace.
 *
 * DÓNDE SE VALIDA UNA LONGITUD MÍNIMA, Y DÓNDE NO. Al **crear o cambiar** la
 * contraseña, sí: ahí se decide cuánta resistencia tendrá. Al **usarla**, no:
 * la contraseña ya existe, y exigirle un largo al campo de ingreso no agrega
 * ninguna seguridad —quien la adivina no la escribe más corta— y sí deja
 * afuera a quien la tiene correcta, que es justo lo que pasó. Por eso
 * `Ingresar.tsx` NO pone `minLength` y solo informa el mínimo, mientras que
 * `MiCuenta.tsx` sí lo exige.
 *
 * EL ESTÁNDAR: NIST SP 800-63B, que es lo vigente y lo que siguen hoy los
 * gestores de contraseñas y los navegadores.
 *   · Mínimo ocho caracteres. Doce era una cifra elegida por prudencia, no por
 *     el estándar, y su costo real —personas que no pueden entrar— es mayor que
 *     lo que agrega frente a un atacante que prueba contraseñas filtradas.
 *   · Se admiten contraseñas largas: al menos sesenta y cuatro caracteres. Por
 *     eso los campos de contraseña NO llevan `maxLength`, a diferencia del
 *     correo. Una frase de cuatro palabras es la mejor contraseña que va a
 *     escribir un comercio, y no se la corta.
 *   · NADA de composición obligatoria: no se exigen mayúsculas, números ni
 *     símbolos. Esas reglas producen «Verano2026!» y nada más. La consola no
 *     impone ninguna hoy, y no hay que agregarla.
 *   · NADA de expiración periódica. Se cambia la contraseña cuando hay motivo
 *     —alguien deja el negocio, se sospecha una filtración—, no por calendario.
 *
 * LO QUE ESTE NÚMERO NO PUEDE HACER, Y HAY QUE DECIRLO. Esto corre en el
 * navegador: es una ayuda para la persona, no un control. Quien arme la
 * petición a mano se lo saltea. **El único que puede hacer cumplir una política
 * de contraseñas de verdad —la longitud mínima real, y sobre todo el bloqueo de
 * contraseñas comunes o comprometidas— es Firebase Auth**, con su *password
 * policy*, que se configura en el proyecto de GCP y que exige la actualización
 * a Identity Platform. **Eso es una tarea de configuración de la plataforma, NO
 * de este código**, y mientras no esté hecha la pantalla de restablecimiento que
 * sirve Firebase va a seguir aceptando desde seis caracteres, que es lo que
 * abrió el hueco del 16/09. Ver `admin/SEGURIDAD.md` §1bis y `admin/DISENO.md`
 * §4ter.1 y §11 paso 14d.
 */
export const MINIMO_CONTRASENA = 8;
