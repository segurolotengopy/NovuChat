# Anexo técnico y de niveles de servicio: propuesta de cambio del §9 (BORRADOR)

> **BORRADOR. No vigente. PENDIENTE de revisión legal y de Andres.** No es una
> versión del anexo: es una propuesta de redacción para el §9 «Datos». El anexo
> vigente (`docs/contrato/anexo-tecnico-sla.md`) **no se modifica**. Origen:
> decisiones de Andres del 20/10 y 22/10/2026, asentadas el 23/10
> (`docs/arquitectura/core.md`, «Medios guardados (H3)»). Las cláusulas de
> abajo son propuestas técnicas, no texto legal.

## Qué cambia respecto del §9 vigente

El §9 vigente dice, en «Qué no se guarda», que los audios, las imágenes y los
comprobantes de los clientes finales «se leen para responder y se descartan».
Con H3 eso deja de ser cierto **para los comercios que activen la función**.

## Propuesta para «Qué se guarda» y «Qué no se guarda»

- **Qué se guarda (adición, solo si el Cliente aceptó este anexo):** los audios,
  las fotos y los PDF que envían los clientes finales del Cliente, durante
  **90 días** desde su recepción. `[PENDIENTE de revisión legal y de Andres]`
- **Quién accede:** solo los administradores y operadores del Cliente, desde su
  consola, con registro de cada acceso. El personal de soporte de NovuChat no
  ve estos medios. No existen enlaces públicos.
- **Límites:** imagen hasta 5 MB, audio hasta 16 MB, PDF hasta 10 MB; hasta
  1.000 medios o 2 GB por día y por comercio. Otros documentos (por ejemplo
  docx y xlsx) no se guardan.
- **Qué sigue sin guardarse:** los demás documentos, y todo medio de un comercio
  que no activó la función. `[Confirmar el tratamiento del comprobante de pago
  con el §9 vigente y Analisis/37 §5, P5.]`
- **Borrado:** automático a los 90 días, y al terminar el contrato o dar de baja
  el comercio. `[PENDIENTE: plazo y constancia; el §9 vigente fija 30 días
  hábiles y constancia escrita.]`
- **Baja anticipada de un medio o de la función:** el Cliente podría pedirla si
  el contrato lo permite. `[PENDIENTE de revisión legal y de Andres: no se
  inventa la cláusula; falta decidir si existe, con qué plazo y quién responde
  por los datos de salud de terceros que puedan aparecer.]`
- **Datos de salud de terceros:** una foto o un PDF pueden contener datos de
  salud. `[PENDIENTE de revisión legal: responsabilidad del Cliente frente a
  sus pacientes, retención y privacidad.]`

## Cómo se aplica (§13 del anexo vigente)

Esto **reduce** un compromiso vigente («no se guarda»), de modo que el §13,
punto 3, exige el **acuerdo escrito del Cliente**; sin él sigue rigiendo la
versión anterior o el Cliente puede rescindir sin penalidad. La bandera
`guardarMedios` de un comercio **no se enciende** sin ese acuerdo y sin el «sí»
explícito de Andres. Habría que sumar a la tabla del §13 una fila para esta
mejora.
