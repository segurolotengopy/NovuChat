# ESTADO — dónde está NovuChat, en una pantalla

> **Se reescribe entero en cada cierre de jornada; nunca crece.** Lo que se
> decide y se descubre va a **`bitacora/<aaaa-mm>.md`** (solo para agregar,
> lo más nuevo arriba); lo que se puede derivar de git, GitHub, la nube y n8n
> lo imprime **`./scripts/estado-generado.sh`** (`--proyecto <id>` para la
> nube, `--sin-nube` para lo demás). Al retomar, leer esto primero, después la
> bitácora del mes. **Nunca contiene secretos**: solo estado, decisiones y
> próximos pasos. (`Analisis/41` §5.5 y §9.4.)

**Última actualización:** 2026-10-02, madrugada. **F2 de la rearquitectura quedó
cerrada en `main` el 02/10 a las ~00:40** (#353, el Cierre). La etiqueta `v0.11.0`
(sobre `e23bf34`) la creó Andres a las 00:21, fuera de la ventana de 02:00 a 03:00
por decisión suya («hagámoslo ahora»), y **quedó en producción a las 00:37**
(hora de Bolivia; corrida de la etiqueta, producción aprobada a las 00:34). Asiento de hoy en `bitacora/2026-10.md`; lo anterior,
en `bitacora/2026-09.md`.

## En producción

- **Consola y Functions:** **`v0.11.0`** (02/10, `e23bf34`), con F1b (la regla de
  planes, el pago en revisión) y todas las mudanzas de F2 (solo rutas).
  `desplegar-produccion` y `post-despliegue` en verde (chequeo de salud OK), 55
  Functions actualizadas, 0 creadas y 0 eliminadas; el canal `previa` de Hosting
  quedó clonado para la reversión; 0 errores ni 5xx en Cloud Run en los primeros
  minutos. Antes: `v0.10.0` (26/09, `4f7e091`).
- **Flujos de n8n:** Bellido corre el piloto «Agenda mínima v0» (45 nodos,
  `f3f7411`, #293; el respaldo de 96 nodos está fuera del repositorio y se vuelve
  con `--restaurar-respaldo`). Demo A y Platinum están atrasados en «Procesar
  respuesta» (#284), declarado en el #289. F2 no cambió ningún JSON de `Flujos/`
  (8 de 8 idénticos byte a byte).
- **Cuentas:** Bellido (bolsa 20) y Platinum (bolsa 100) en prueba; los demos y
  la captación, en demostración. Nadie está en producción.
- **Staging:** en verde; cada push a `main` que toca `admin/` despliega ahí.

## F2 cerrada

- **Última tanda (fusionada el 01 y 02/10):** #349 (`basic-ftp` 6.2.1, arreglo
  del SCA), #343 S1, #340 S2, #344 P1, #347 W0e, #350 Pz, #352 (citas de agentes,
  con revisión de Andres: `admin/scripts/modulos/<m>/` pasa a la zona del agente
  `modulo`; criterio «sin dueño» aprobado) y #353 (Cierre: se borran
  `destinos-f2.ts`, `medir-zonas.mjs` y `f2-orden-de-movimiento.md`; carpeta =
  zona). Quedan **3 cruces hacia `ingesta.ts` y 0 archivos sin zona** (eran 19 y
  47). Lo que dejó el movimiento: `docs/arquitectura/registro.md`, «Mover archivos
  entre zonas».
- **Rojos previos aceptados por Andres para este pase:** el ruleset de `main` sin
  revisor obligatorio, sin GitHub Releases y sin ruleset de etiquetas `v*` (queda
  un PR del estándar esta semana).
- **B8** (receptor de AAB1): el bloque 0 está hecho (#260, #264, #272, #323, #329,
  #265, #277). Los bloques A a C van después de H3a, con WhatsApp-Modular.

## Lo próximo, en orden

1. Vigilar `v0.11.0` durante 60 minutos (en curso) y probar con teléfono real
   (ver «Requiere a Andres»).
2. **H2** de la revisora (informe en
   `~/Descargas/NOVUCHAT_informe-hito-H2-F2_2026-10-02.md`); después **F3a**.
3. Pendientes que señaló el informe H2: repetir el seco de `migrar-ejes`
   (`scripts/plataforma/migrar-ejes.mjs`) tras S1; Bellido corre un JSON de
   `Flujos/` experimental fuera de los 8 que verifica el ensamblador; un
   Deployment `production` falso en failure de una corrida cancelada del PR #345 ensucia las
   métricas DORA.
4. Plantillas `prueba_termina` y `conversaciones_agotadas` con texto nuevo
   (Meta), antes del primer pase real.

## Coordinación

Orden general de la sesión de cartera. Trabajan la de **rearquitectura**, la
**operadora**, la **revisora** (H2) y la **cartera** (clientes); el tablero está en
`Prompts/COORDINACION.md`.

**Requiere a Andres** (cada una con su «sí»; las corre Claude):

1. Prueba con teléfono real sobre `v0.11.0`: Bellido (agendar y cancelar) y
   Platinum (seña). La vigilancia de 60 minutos sigue en curso.
2. **Gemini:** credencial de producción prepago (`NovuchatDemo`); recarga
   automática con límite mensual decidida. Se sigue con 3.5 Flash-Lite
   (`Analisis/44`).
3. Q'Taco: alcance a elegir (`Analisis/47` §2); lo lleva la cartera.
4. Bellido: contrato (USD 25 al mes, sin instalación, Meta a cargo de Andres) al
   `anexo-particular.md` y firma del doctor; invitación de administrador del
   portafolio de Meta; plantillas `prueba_termina` y `conversaciones_agotadas`;
   reiniciar memoria y estado por teléfono y ronda de aceptación.
5. El correo de María René, para darle el rol `oper` en la consola.
6. Sin decidir: si `--alta-waba` puede usarse con una app propia de NovuChat
   sobre una WABA que el receptor ya entrega (detalle en `bitacora/2026-10.md`).

## Dónde está cada cosa

| Qué | Dónde |
|---|---|
| Invariantes del proyecto | `CLAUDE.md` |
| El dinero de cada decisión técnica | `docs/base-comercial.md`; límites y dónde se hacen cumplir: `docs/arquitectura/limites.md` |
| Arquitectura por zona y módulo, con el índice de las secciones viejas de `admin/DISENO.md` | `docs/arquitectura/indice.md` |
| El plano de la rearquitectura | `Analisis/41-arquitectura-por-capas.md` y su anexo A |
| Ciclo de vida del cliente (ocho etapas) | `docs/clientes/CICLO-DE-VIDA.md`; runbooks en `docs/alta-cliente/` y `docs/pase-a-produccion/` |
| Parámetros e identificadores | `CONFIGURACION.md` (y `CONFIGURACION.local.md`, ignorado) |
| Cada cliente | `CLIENTES/<T>/` (ignorado por git, en la copia base) |
| Riesgos vivos y decisiones pendientes heredadas | `bitacora/2026-09.md` («Riesgos vivos», «Riesgos del repositorio público», «Próximos pasos») y `bitacora/2026-08.md` («Decisiones pendientes») |
| El número de prueba y sus destinatarios registrados (prohibición 6) | `CONFIGURACION.md`; el riesgo, en `bitacora/2026-09.md` «Riesgos vivos» |
