# Registrar la llave del relé B9 de un cliente en n8n

La sesión que opera el relé (WAM) emite la llave de cada cliente y la deja en un archivo; nadie la ve por
el chat. `scripts/registrar-llave-rele-n8n.sh` la lleva a la credencial Header Auth «AAB1 envío · <alias>»
de nuestro n8n sin imprimirla ni leerla.

- **Entrega** (acordada con WAM): `$XDG_RUNTIME_DIR/llave-rele-<alias>`, modo 600, una línea con la llave
  sola, de la forma `aab1e_<wabaId>_<64 hexadecimales>`. Si la forma no calza el script dice solo
  «forma inválida».
- **Alias**: `evy`, `emma`, `ruben`, `antonio`, `cliente07`, `cliente08`, `qtaco`, `cliente03` y `ensayo01` (línea de ensayo). Otro alias se niega.
  Evy = `cliente08` y Emma = `cliente07` (alias del receptor confirmados por WAM el 03/11); los de Rubén y
  Antonio se confirmarán antes de su publicación. `qtaco` = Q'Taco y `cliente03` = Bellido: alias a confirmar
  con WAM antes de usarlos.
- **Seco** (por omisión, solo GET): `./scripts/registrar-llave-rele-n8n.sh --alias <alias> --env .env`.
  Dice si la credencial existe, cuántos flujos la citan y si la entrega es válida.
- **Aplicar**: `./scripts/registrar-llave-rele-n8n.sh --alias <alias> --env .env --aplicar --confirmo produccion`.
  Respalda el estado (sin valor), actualiza EN EL LUGAR por id (nunca borra y crea), relee por nombre, tipo e
  id y solo entonces borra la entrega. Si algo falla, la conserva.
- **La credencial debe existir** (la deja `cargar-timbre-n8n.sh`, con valor inerte). Si falta, hay duplicados
  o el nombre es de otro tipo, aborta sin escribir; solo `ensayo01` la crea si falta.
- **Requisitos**: `N8N_BASE_URL` https (sin redirecciones ni proxies), `$XDG_RUNTIME_DIR` del usuario y de modo 700; la clave de la API la lee Python del --env, no pasa por el entorno.
- **Límite**: la API de n8n no devuelve el valor de una credencial; que la llave sirva se prueba con un envío
  real por el relé (sesión de WAM). Este script no toca el receptor, el relé ni la red de Docker.

Costo: 0 mensajes por conversación; una escritura en n8n por corrida.
