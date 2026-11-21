# Entrada verificada del receptor (core)

`entrada-del-receptor.plantilla.json` es la definición canónica de los 6 nodos de la entrada del receptor de clientes
(`Entrega del receptor`, `Verificar firma con el receptor`, `¿Firma válida?`, `Aceptar (200)`, `Rechazar (401)` y
`Descartar repetidos`) con sus conexiones, extraída tal cual de `Flujos/experimental/venta-minima/flujo.plantilla.json`
(PR-7 de la rearquitectura). Es parte del núcleo común obligatorio (CLAUDE.md): verificador interno, `wabaIdEsperado`
fijo, sin «Continue on Fail» y repetidos descartados entre ejecuciones.

- Solo trae marcadores (`@@dato:receptor.*@@`); ninguna ruta de webhook ni URL de capacidad va en este archivo.
- Las conexiones omiten la de `Descartar repetidos`: su destino lo fija cada flujo.
- Lo leen `clientes/walisuma/construir.mjs` y `clientes/casa-bermejo/construir.mjs` (`--verificar`), y lo comparan las
  pruebas de venta-minima, walisuma, casa-bermejo, rroca-ruben y rroca-antonio. Cambiarlo es cambiar a todos.
