# Origen CONGELADO del núcleo copiado de `chat-novuchat` (estado previo a PR-4c2)

Los flujos de Antonio (`rroca-antonio`) y de Rubén (`rroca-ruben`) llevan COPIAS DECLARADAS del núcleo de `chat-novuchat` (huecos sin fuente común utilizable) y sus pruebas
(`tenants/rroca-antonio/huecos.test.ts`, `tenants/rroca-ruben/armado.test.ts`) las comparan byte a byte con su origen. PR-4c2 cambió la fuente VIVA del chat (estado de la conversación en
el servidor) y esos dos flujos NO adoptan `sesion` en ese PR: su JSON vivo no cambia (0 mensajes por conversación). Por eso su origen queda **congelado** aquí.

- **Qué es:** los archivos que esas pruebas leen del chat, tal como estaban en el commit `1fff3d59` (`Merge pull request #770`, el último antes de PR-4c2):
  `Flujos/experimental/chat-novuchat/src/nodos/{_comun,puerta-del-turno,carga-de-entrada,config-del-negocio,interpretar-entrada,resumen-del-turno}.js` y `.../flujo.plantilla.json`.
  Sin datos de clientes ni secretos (son el código y la plantilla ya versionados).
- **Qué NO está aquí:** `src/lib/chat.js` (las pruebas solo leen su línea `CH_NIEGA_IA`, que sigue igual en la fuente viva y debe seguir idéntica) y la batería (`herramientas/bateria.mjs`).
- **Huellas (SHA-256, en 8 grupos de 8 separados por guion, para no parecer un identificador numérico):** las verifica `core/origen-chat-congelado.test.ts`; si alguien edita un archivo de aquí, falla. Si `git` tiene el commit, también lo compara con `git show 1fff3d59:<ruta>`.

| archivo | sha256 |
|---|---|
| `nodos/_comun.js` | `927ae74c-ef114412-a9e25dff-214e9669-80404266-b05e4c98-4ef15c09-f7ebc545` |
| `nodos/puerta-del-turno.js` | `5813184d-194b498a-e6d38c54-bf9cb7cf-94d81f1f-334bcf5c-04b00583-1d047c17` |
| `nodos/carga-de-entrada.js` | `455bb86f-af2ed0ce-8c9526b5-3f7e09a9-48ae2d69-569f7183-5e167ac1-5d09a3ff` |
| `nodos/config-del-negocio.js` | `15261cee-a7a6576e-a08bfdce-8c3547a6-e9a24bbb-e355ec90-be795087-81630fca` |
| `nodos/interpretar-entrada.js` | `e99ede0f-a541136e-b67df1eb-c872f185-b959d205-52d7a859-f4e76508-43d9b545` |
| `nodos/resumen-del-turno.js` | `c7b36146-0c431a5a-766b9109-1bb2f53c-161d5d7e-f0b5d31a-c476d0cf-7300d16e` |
| `flujo.plantilla.json` | `733d2782-d0cf02dd-b649942b-60f8437b-0fd93348-a5e62d7f-e91bd363-6eefd8e7` |

**Se retira** cuando Antonio y Rubén adopten `sesion` (cada uno en su propio PR, y entonces sus pruebas vuelven a leer la fuente viva) o cuando el núcleo se INCLUYA desde un módulo común en vez de copiarse.
