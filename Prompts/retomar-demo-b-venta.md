# Retomar el Demo B: catálogo web, carrito y cobro por QR

> Traspaso escrito al cerrar la sesión del 23 al 25/09/2026, a pedido de Andres.
> Todo lo que dice acá está **verificado contra producción y contra `origin/main`
> el 25/09**, no recordado. Sin secretos ni identificadores.

## 0. LO PRIMERO, Y NO ES NEGOCIABLE

**Andres anunció que encontró errores de ARQUITECTURA y por eso cerró la sesión.**
No se sabe cuáles. **Antes de construir nada de lo que figura abajo, preguntale qué
encontró**: puede invalidar parte de este documento, empezando por las decisiones de
diseño del cobro. Lo que sigue describe el estado, no un permiso para seguir.

## 1. Estado verificado el 25/09

| Qué | Estado |
|---|---|
| Ramas `catalogo/demo-b-derivar` y `catalogo/demo-b-cualquier-rubro` | **Fusionadas** (PR #163 y #165). Cero commits fuera de `main` |
| Etiquetas | `v0.9.0` (25/09), `v0.8.0` (24/09). El trabajo está desplegado |
| `scripts/estado-de-versiones.sh` | **Los ocho flujos al día**, Demo B incluido. Ningún atraso sin declarar |
| Flujo del Demo B | **55 nodos**, publicado |
| Comercio `demo-venta` | Es **Walisuma**, 10 ítems con precio en USD, fotos subidas a `fotosCatalogo`, logo puesto, catálogo web encendido, paleta terracota |
| Cobro real del Demo B | **APAGADO**, y así se decidió entregarlo |

**No quedó trabajo mío sin fusionar ni sin publicar.** Otras sesiones siguieron
después (PR #177 a #181) y dejaron el Demo B al día.

## 2. DOS DEFECTOS ABIERTOS, los dos verificados hoy

### 2.1 El nodo que debía olvidar un turno BORRA LA MEMORIA ENTERA

**Dónde:** `Olvidar turno fallido`, en `Flujos/demo-a-agendamiento.json`,
`platinum-agendamiento.json` y `bellido-agendamiento.json`.

**Qué pasa:** declara `"deleteMode": "lastMessages"`, y en n8n 2.36.5 los únicos
valores válidos son `lastN` y `all`. El código hace
`if (deleteMode === 'lastN') { … } else { await memory.chatHistory.clear() }`, así que
**cualquier valor desconocido borra el historial completo** del paciente en vez de los
dos últimos mensajes.

**Por qué importa:** está en **dos clientes reales en producción** (Platinum y Bellido).
Se dispara en el reintento tras un cruce de agenda, que es justo cuando la conversación
importa. Lo encontró un agente verificando parámetros contra el paquete de npm.

**Cómo arreglarlo:** confirmá primero el valor correcto contra el paquete
(`npm pack @n8n/n8n-nodes-langchain@2.36.5` y leer `dist/node-definitions`), que es lo
que manda la memoria `parametros-de-nodos-n8n-desde-npm`. Con prueba que lo fije, y
**respetando la ventana de mantenimiento de 2 a 3** para publicar.

### 2.2 El Demo B ya NO acepta cualquier imagen como comprobante

**Dónde:** `Normalizar entrada` de `Flujos/demo-b-venta-cobro.json`, y la compuerta
`¿Hay comprobante?`.

**Qué pasa:** desde el port del cobro, una imagen solo se trata como comprobante si el
servidor abrió un pago pendiente. Sin pendiente, al modelo le llega literalmente:

> «El cliente envió una IMAGEN y no hay ningún pago pendiente: no lo trates como un
> comprobante.»

**Por qué importa:** el 23/09 Andres pidió **explícitamente** lo contrario para la
demostración: «que acepte cualquier imagen como comprobante y le deje pasar, con los
mismos mensajes de OK», y eligió seguir con el **QR de demostración**. La exigencia del
pendiente tiene todo el sentido con cobro **real**, donde el comprobante se cotea de
verdad; con cobro **simulado** estorba, porque ahí la gracia es que la conversación
fluya.

**El arreglo propuesto, y quedó sin hacer:** que la exigencia del pendiente aplique
**solo al modo real**. En simulado, cualquier imagen sigue pasando, como antes. Es
acotado y toca un solo nodo.

**Verificar antes de tocar:** el PR #181 dice «una venta cobrada en simulado cierra su
QR», así que alguien ya trabajó cerca. Leé ese cambio antes de escribir.

## 3. Decisiones tomadas, para no volver a discutirlas

- **El cobro real se construyó entero y se entregó APAGADO** (decisión de Andres,
  23/09). Encenderlo es un acto aparte.
- **El cierre de una venta nace del cotejo**, no de buscar una palabra en el texto del
  modelo. Era el patrón que costó las citas duplicadas del 17/09.
- **Para el demo va el QR de demostración**, no el QR real de Andres (decisión del
  23/09). El de demostración se escanea pero tiene datos ficticios y el banco lo
  rechaza solo, así que **nadie puede pagar por error**. El `cobroReal` registrado en
  `demo-venta` es un QR **de Andres**, del BNB, **vencido el 15/09**.
- **El comercio se llama «Walisuma — vitrina de demostración NovuChat»** y su
  descripción dice que no es la tienda de Walisuma. Los teléfonos, direcciones y redes
  que trae el catálogo en PDF **no se cargaron**, a propósito: son datos de un tercero.
- **Hay dos catálogos de datos** y la vista previa sirve cualquiera con `--datos`:
  `resto` (el genérico), `walisuma-10` (los diez que están en producción) y `walisuma`
  (los 154 del catálogo completo, por si se quiere mostrar el otro lado del umbral de
  40 ítems).

## 4. Lecciones que conviene no volver a pagar

- **Las pruebas corrían en un entorno más rico que producción.** El nodo Code de n8n no
  tiene los globales de Node, y `new URL(...)` dentro de un `try/catch` hizo que el
  enlace del catálogo se perdiera **en producción** con las 85 pruebas en verde. Está
  cerrado con `GLOBALES_FUERA_DEL_SANDBOX` en `admin/pruebas/lib/flujo.ts`: **no se le
  quita un nombre a esa lista para que pase una prueba.**
- **Una función HTTP nueva no nace invocable.** `enlaceCatalogo` se desplegó sin
  binding y devolvía un 403 de Google antes de correr su código.
  `scripts/nube-catalogo.sh` lo diagnostica; conviene correrlo después de cada
  despliegue que agregue una función HTTP.
- **Verificar antes de afirmar.** Se dio por bueno que la cadena OCR de Platinum «nunca
  corrió», porque lo decía una entrada de bitácora del 19/09. Andres lo corrigió: había
  corrido más de diez veces. Los datos lo confirmaron: **nueve comprobantes reales
  cotejados**, seis que cuadraron, dos que no y uno ilegible.

## 5. Deuda anotada y sin tocar

- El `media id` del comprobante no se guarda, así que la pantalla «Cobros» no puede
  mostrar la imagen; y un pedido conversado no se guarda como `pedido`, solo como
  cierre, sin ítems. Los dos los espera la consola desde el 09/09.
- El Demo B no tiene un embudo único de salida, y por eso no puede llevar el botón
  «escribile directo» que la política del 21/09 pide. Es un cambio de topología y
  merece su propia rama.
- `Config base` del Demo B sigue vestido de «Resto & Tienda» con hamburguesas. No es un
  defecto —ese respaldo solo rige si el panel no contesta— pero si el panel se cae en
  medio de una reunión, una marca de artesanía empieza a ofrecer salchipapas.
- La ingesta manda `agotado` por ítem y el flujo lo ignora: un producto sin existencias
  se ofrece igual.

## 5bis. Dónde está el material de Walisuma

`CLIENTES/` está ignorado por git y **vive en la copia base**, no en un worktree
(memoria `directorio-clientes-por-cliente`). Al cerrar esta sesión se copió ahí todo lo
que se había generado:

| Archivo | Qué es |
|---|---|
| `~/NovuChat/CLIENTES/WALISUMA/Catalogo GIFTS Walisuma 2024.pdf` | El catálogo original, 34 páginas |
| `~/NovuChat/CLIENTES/WALISUMA/fotos/` | **154 fotos** recortadas de las páginas con las mismas coordenadas del texto, para que ninguna caiga en otro producto |
| `~/NovuChat/CLIENTES/WALISUMA/fotos-10/` | Las **diez** que están cargadas en producción |
| `~/NovuChat/CLIENTES/WALISUMA/logo-walisuma.webp` | El logo ya recortado a 320 px, como lo deja la consola |

Sin esa carpeta, recargar el catálogo exige volver a extraer las fotos del PDF, que es
lo más caro de rehacer.

## 6. Cómo verificar el estado al retomar

```bash
cd ~/NovuChat/.claude/worktrees/<el que uses>
bash scripts/estado-de-versiones.sh          # qué flujo vivo está atrasado
bash scripts/verificar-saneo.sh              # los dos modos
node admin/scripts/ensamblar-flujo.mjs verificar
```

Y para las suites, con **puerto propio** porque el emulador se comparte entre worktrees:

```bash
cd admin && FIRESTORE_EMULATOR_PORT=8712 FIRESTORE_EMULATOR_WS_PORT=9712 bash pruebas/correr.sh
```

`admin/` se instala **con pnpm, nunca con npm**.
