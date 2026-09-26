# Módulo Menú interactivo

> Manifiesto en prosa según `Analisis/41-arquitectura-por-capas.md` §3.1, con
> lo que el módulo es hoy (§3.2 y §5). El manifiesto ejecutable vive en
> `registro.ts` cuando F2 lo cree. Sin secretos ni identificadores.

## Manifiesto

| Campo | Valor hoy |
|---|---|
| **Qué contiene hoy** | los 19 nodos propios de Bellido: menú inicial, contacto directo, emergencia, aviso al doctor, redes |
| **Depende de** | — |
| **Límite por plan** | — |
| **Configuración** | textos del menú, destinos (contacto directo, emergencia, redes), palabras que transfieren |
| **Colecciones** | ninguna propia |
| **Pestañas** | ninguna hoy; la configuración del menú como pestaña del módulo cuando exista |
| **Prompt** | las opciones del menú y sus respuestas fijas |
| **Herramientas** | — |
| **Nodos (lo que queda en n8n)** | `Flujos/src/modulos/menu-interactivo/*.js` (F5) |
| **Ganchos** | `antesDelTurno` (menú inicial) |
| **Mensajes por conversación** | 0 (el menú reemplaza una respuesta del modelo, no la suma) |
| **Pruebas** | `bellido-flujo.test.ts` hasta F5; después, pruebas del módulo y una prueba de instancia corta de Bellido |

**Observación:** hoy es código de un tenant (`Flujos/bellido-*.json` es fuente); la ficha del registro general ya lo lista como reutilizable. En F5 pasa a `Flujos/src/modulos/menu-interactivo/` con bandera, encendido en Bellido y apagado en los demás, y el JSON de Bellido vuelve a ser salida de construcción. Los títulos de botón tienen 20 caracteres; un menú de 3 botones a lista de 4 filas cambia la topología (§12.4 de `Analisis/41`)

Carpetas destino (F2): `admin/functions/src/modulos/<m>/`,
`admin/web/src/modulos/<m>/`, `Flujos/src/modulos/<m>/`,
`admin/pruebas/modulos/<m>/`, y una línea en el registro.
