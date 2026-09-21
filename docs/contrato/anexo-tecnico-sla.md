# Anexo técnico y de niveles de servicio

> **Plantilla del anexo general del contrato de servicio de NovuChat.** Vale para
> cualquier cliente, sin importar qué flujos tenga. Lo particular de cada cliente
> va en su **anexo particular**, que se guarda en `CLIENTES/<CLIENTE>/` y no en
> este repositorio. La justificación de cada número está en
> `Analisis/37-anexo-tecnico-y-sla.md`.
>
> **Versión 1 · 21/09/2026.** Marcas a completar: `[…]`.
>
> **Regla de mantenimiento de esta plantilla:** no se agrega ningún compromiso
> que el sistema no cumpla hoy. Cuando un prerrequisito de `Analisis/37` §5 se
> cierre, se actualiza la cláusula correspondiente y se sube la versión.

---

## 1. Objeto

Este anexo describe el servicio técnico que NovuChat presta al Cliente, los
niveles de servicio que se compromete a cumplir, lo que queda fuera de ellos y
las obligaciones de cada parte.

En este anexo:

- **Servicio**: el asistente conversacional que atiende el número de WhatsApp
  del Cliente, y la consola de administración.
- **Flujo**: cada capacidad del asistente contratada por el Cliente (reservas,
  pedidos, cobro, captación u otras), detallada en su anexo particular.
- **Conversación**: la unidad de cobro que define el contrato: hasta 25
  respuestas del asistente a un mismo teléfono dentro de una ventana de 24 horas.
- **Hora de Bolivia**: UTC−4.

## 2. Cómo está construido el servicio

- **Canal:** exclusivamente la API oficial de WhatsApp Business de Meta
  (Cloud API). NovuChat no usa canales no oficiales.
- **Orquestación:** flujos versionados que se ejecutan en un servidor de
  NovuChat.
- **Inteligencia artificial:** un modelo de lenguaje de un proveedor externo,
  que redacta las respuestas dentro de los límites que fijan los flujos.
- **Consola:** aplicación web del Cliente, con los datos de su negocio aislados
  de los de cualquier otro cliente.
- **Servicios de terceros** que el asistente usa según los flujos contratados:
  Google Calendar para la agenda, y el banco del Cliente para los cobros con su
  código QR.

## 3. Garantías del servicio

NovuChat garantiza que el Servicio funciona así. **Estas garantías las hace
cumplir el sistema, no dependen de que el modelo de IA obedezca una
instrucción.**

1. **Sin doble reserva.** Cada vez que el asistente registra una cita, el
   sistema la verifica contra el calendario. Si se cruza con otra, la deshace y
   ofrece alternativas. Si el calendario no responde, **la cita no se
   registra**: el asistente lo dice y deriva a recepción.
2. **Aislamiento entre clientes.** Ningún otro cliente de NovuChat puede ver,
   modificar ni borrar los datos del Cliente. Solo el personal autorizado de
   NovuChat accede, y para leer conversaciones necesita un permiso temporal que
   otorga el Cliente desde su consola.
3. **Los cobros nunca se presentan como algo que no son.** Cuando un cliente
   final envía un comprobante de pago, el asistente puede decir que lo recibió y
   que los datos coinciden. **Nunca dice que el pago está acreditado.** Eso lo
   confirma el Cliente con su banco.
4. **La conversación la cuenta el sistema**, con la definición del contrato, y
   el Cliente ve el conteo en su consola. Si por una falla técnica un mensaje no
   se cuenta, el error queda **a favor del Cliente**.
5. **Lo que el Cliente escribe como comportamiento de su asistente se verifica
   antes de aplicarse.** Un texto que intente actuar fuera del negocio del
   Cliente no llega al asistente.
6. **Techo de uso por conversación.** A las 50 respuestas en una ventana, el
   asistente deja de redactar con IA, avisa al cliente final y a recepción, y
   deriva la conversación. A las 100, deja de enviar mensajes a ese teléfono
   hasta que la ventana se renueva. Los dos umbrales se pueden ajustar para el
   Cliente.
7. **El asistente no promete lo que el sistema no hace.** Ante un error o una
   consulta que no sabe responder, lo único que ofrece es pasar la conversación
   a recepción: avisa a recepción y le da al cliente final un botón para
   escribirle directamente.

Además, el asistente tiene la **instrucción** de presentarse como asistente
virtual y de no negar que es una inteligencia artificial.

## 4. Horario cubierto y canal de soporte

- **Horario cubierto:** lunes a viernes de 09:00 a 19:00 y sábados de 09:00 a
  13:00, hora de Bolivia, excepto feriados nacionales.
- **Fuera del horario cubierto**, el asistente sigue atendiendo, pero la
  atención de incidentes es de mejor esfuerzo.
- **Canal oficial de reportes:** `[canal de soporte: WhatsApp de NovuChat y/o
  correo]`, además de la sección «Reclamos» de la consola. Un reporte por otro
  medio se atiende, pero el plazo corre desde que llega al canal oficial.

## 5. Atención de incidentes

| Severidad | Qué es | Acuse de recibo | Contención | Solución o plan escrito |
|---|---|---|---|---|
| **1 · Crítica** | El asistente no responde a nadie o responde mal a todos; o hay riesgo de doble reserva, de un cobro mal presentado o de exposición de datos | 2 horas hábiles | **4 horas hábiles** | 2 días hábiles |
| **2 · Alta** | Una capacidad falla y el resto del servicio funciona | 4 horas hábiles | 1 día hábil | 3 días hábiles |
| **3 · Normal** | Textos, configuración, consultas, mejoras | 1 día hábil | — | 5 días hábiles |

- **Contención** es detener el daño, aunque la causa no esté corregida:
  apagar la capacidad afectada, suspender la atención automática con un mensaje
  neutro, o derivar todas las conversaciones a recepción.
- Los plazos corren dentro del horario cubierto, desde que el Cliente reporta
  por el canal oficial o desde que NovuChat detecta el incidente, lo que ocurra
  primero.
- La severidad la propone quien reporta y NovuChat la confirma. Ante la duda,
  se trata como la más alta.

## 6. Disponibilidad

**Fase inicial.** Desde el inicio del servicio y hasta que NovuChat comunique
por escrito la activación de su monitoreo externo, **no se compromete un
porcentaje de disponibilidad**. Rigen la atención de incidentes (§5) y el
informe mensual (§10).

**Fase medida.** Desde el mes calendario siguiente a esa comunicación:

- **Compromiso: 98 % de disponibilidad mensual dentro del horario cubierto.**
- **Disponible** significa que el monitoreo externo de NovuChat obtiene
  respuesta de los servicios que atienden los mensajes del Cliente.
- **No cuentan como indisponibilidad:**
  - caídas o restricciones de Meta, de Google o del proveedor del modelo de IA;
  - el mantenimiento anunciado (§8);
  - fallas causadas por cambios que hizo el Cliente;
  - la suspensión por falta de pago;
  - la indisponibilidad del teléfono de recepción o de los datos del Cliente.

## 7. Créditos de servicio

Los créditos se otorgan en **conversaciones de bolsa**, a su precio de lista, y
se suman al saldo del Cliente. No se pagan en dinero.

| Evento | Crédito, en porcentaje de la mensualidad |
|---|---|
| Disponibilidad entre 95 % y 98 % (solo en fase medida) | 10 % |
| Disponibilidad entre 90 % y 95 % (solo en fase medida) | 25 % |
| Disponibilidad inferior a 90 % (solo en fase medida) | 50 %, y derecho a rescindir sin penalidad |
| Contención de un incidente de severidad 1 fuera de plazo | 10 % por incidente |

- **Tope:** la suma de créditos de un mes no supera el 50 % de la
  mensualidad.
- El Cliente los solicita dentro de los 30 días siguientes al mes afectado.
- Los créditos son la única compensación por incumplimiento de los niveles de
  servicio.

## 8. Cambios y mantenimiento

- **Cambios que hace el Cliente en su consola** (precios, horarios, catálogo,
  comportamiento del asistente ya verificado): se aplican en el mensaje
  siguiente, en menos de un minuto.
- **Cambios que opera NovuChat a pedido del Cliente:** 2 días hábiles desde que
  el pedido llega completo. Se prueban con un teléfono real antes de darlos por
  hechos.
- **Mejoras de los flujos:** se aplican a todos los clientes que usan ese flujo
  a la vez, previa prueba.
- **Mantenimiento programado:** se anuncia con 24 horas de anticipación y se
  hace fuera del horario cubierto.
- **Correcciones de seguridad urgentes:** en cualquier momento, con aviso.

## 9. Datos

- **Qué se guarda:** los mensajes de texto de las conversaciones, las citas,
  los pedidos y un registro de eventos técnicos que no incluye el contenido de
  los mensajes.
- **Qué no se guarda:** los audios, las imágenes y los comprobantes que envían
  los clientes finales. Se leen para responder y se descartan.
  `[Confirmar antes de firmar: Analisis/37 §5, P5.]`
- **Durante el contrato:** los datos se conservan y el Cliente los ve en su
  consola.
- **Al terminar el contrato:** NovuChat borra los datos del Cliente dentro de
  los 30 días hábiles siguientes a su pedido, y entrega constancia escrita.
- **Credenciales:** los tokens y claves del Cliente se guardan cifrados en un
  gestor de secretos y nunca en archivos compartidos ni en el código.
- **Configuración:** la configuración del asistente del Cliente está
  versionada y se puede reconstruir.

## 10. Informe mensual

Dentro de los primeros 5 días hábiles de cada mes, NovuChat entrega al Cliente:

- las conversaciones del mes y los bloques adicionales;
- los mensajes del asistente contra los mensajes gratuitos de Meta del número;
- los avisos de consumo, las derivaciones por uso extendido y los bloqueos;
- los incidentes del mes, con sus tiempos de acuse, contención y solución;
- el tiempo de respuesta del asistente (objetivo: el 90 % de las respuestas de
  texto en 10 segundos o menos; las de audio o imagen, en 15 segundos o menos).
  **Este objetivo se informa y no genera créditos;**
- la disponibilidad, en fase medida.

## 11. Lo que no cubre este anexo

1. La disponibilidad, las políticas y las decisiones de Meta: restricción o
   baja del número, calificación de calidad, rechazo de plantillas y cambios de
   tarifa.
2. La disponibilidad de Google Calendar, del proveedor del modelo de IA y del
   banco del Cliente.
3. La exactitud de los datos, precios, horarios y textos que carga o aprueba el
   Cliente, y el contenido comercial, técnico o clínico de su negocio.
4. La atención de las conversaciones derivadas a recepción, que es del Cliente.
5. **Los errores de redacción del modelo de IA.** Un asistente basado en
   inteligencia artificial puede equivocarse al redactar. NovuChat garantiza lo
   del §3, que el sistema hace cumplir, y que todo error reportado se contiene
   dentro de los plazos del §5. No garantiza que el asistente nunca se equivoque.

## 12. Obligaciones del Cliente

1. Entregar por escrito los datos de su negocio y confirmar los que NovuChat
   haya cargado como supuestos.
2. Mantener compartidos con NovuChat los calendarios que usa el asistente.
3. Atender en su horario las conversaciones que el asistente deriva a
   recepción.
4. Verificar en su banco los pagos que reciba.
5. No instalar la aplicación de WhatsApp en el número del asistente.
6. Avisar con 48 horas de anticipación los cambios que no haga él mismo en la
   consola.
7. Reportar los incidentes por el canal oficial.
