#!/usr/bin/env python3
"""
PORTAR A UN CLIENTE LO QUE CAMBIÓ EN EL PROMPT (Y EN LAS HERRAMIENTAS) DEL VERTICAL

Por qué existe. `sincronizar-flujo-cliente.mjs` repone en el cliente todo lo
que es mecanismo del vertical, pero NO toca sus nodos propios: el prompt del
agente y las herramientas de calendario tienen texto del cliente (ejemplos
de su rubro, la duración de su consulta). Cuando el vertical gana una regla
nueva en el prompt —«6c. DÓNDE QUEDA EL NEGOCIO», el bloque de la seña— o una
expresión nueva en `agendar_cita`, el cliente la necesita igual, línea por
línea, sin perder lo suyo.

Qué hace. Compara dos versiones del vertical (una referencia de git «antes» y
el archivo «después», o dos referencias) y calcula las operaciones por LÍNEA:
qué líneas se reemplazaron, cuáles se insertaron y detrás de cuál. Después
las aplica al cliente:
  - una línea reemplazada se busca en el cliente tal cual; si no está igual
    (el cliente la tiene con su propia duración, por ejemplo), se busca la
    regla del mismo número («4. CONFIRMACIÓN: …») y se le aplica LA MISMA
    SUSTITUCIÓN DE SUBCADENA que llevó de la línea vieja a la nueva;
  - una línea insertada se pone detrás de la misma línea ancla del cliente;
  - una línea borrada se borra.
Si un ancla no existe o es ambigua, se detiene sin escribir: eso es un
cliente que se separó del vertical y hay que mirarlo a mano.

Lo mismo para los parámetros de texto de las herramientas propias
(`agendar_cita`, `consultar_disponibilidad`, `buscar_mi_cita`, `cancelar_cita`):
se portan como una sola «línea» cada uno, con la sustitución de subcadena.

  python3 admin/scripts/portar-prompt-cliente.py \
      --vertical Flujos/demo-a-agendamiento.json --antes 6e718d7 \
      --cliente Flujos/bellido-agendamiento.json [--aplicar]

`--antes` es la referencia de git del vertical ANTES del cambio (un commit, una
rama, `origin/main`); «después» es el archivo del vertical en el disco. Sin
`--aplicar` informa y no escribe.
"""
import argparse, difflib, json, os, subprocess, sys

AGENTES = ('@n8n/n8n-nodes-langchain.agent',)
HERRAMIENTAS = ('agendar_cita', 'consultar_disponibilidad', 'buscar_mi_cita', 'cancelar_cita')

def flujo_en(ref, ruta):
    return json.loads(subprocess.run(['git', 'show', f'{ref}:{ruta}'], capture_output=True, text=True, check=True).stdout)

def agente(f):
    return next(n for n in f['nodes'] if n['type'] in AGENTES and 'Reintento' not in n['name'])

def prompt(f):
    return agente(f)['parameters']['options']['systemMessage'].split('\n')

def nodo(f, nombre):
    return next((n for n in f['nodes'] if n['name'] == nombre), None)

def sustituir(vieja, nueva, linea):
    """La misma sustitución de subcadena (vieja→nueva) sobre `linea`."""
    if vieja == linea:
        return nueva
    p = os.path.commonprefix([vieja, nueva])
    s = os.path.commonprefix([vieja[::-1], nueva[::-1]])[::-1]
    vm, nm = vieja[len(p):len(vieja) - len(s)], nueva[len(p):len(nueva) - len(s)]
    if nm and nm in linea:          # ya portado: no se repite
        return linea
    if not vm or vm not in linea:
        raise SystemExit(f'✗ No se puede portar (el cliente no tiene el tramo que cambió):\n    vertical: {vieja[:90]}\n    cliente : {linea[:90]}')
    return linea.replace(vm, nm, 1)

def buscar(L, v):
    idx = [k for k, l in enumerate(L) if l == v]
    if len(idx) != 1 and ':' in v:   # la misma regla numerada, con texto propio del cliente
        idx = [k for k, l in enumerate(L) if l.split(':')[0] == v.split(':')[0]]
    if len(idx) != 1:
        raise SystemExit(f'✗ Línea ambigua o ausente en el cliente ({len(idx)} coincidencias): {v[:90]}')
    return idx[0]

def portar_lineas(antes, despues, cliente):
    L, ops = list(cliente), []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, antes, despues, autojunk=False).get_opcodes():
        if tag == 'equal':
            continue
        if tag == 'replace':
            for v, n in zip(antes[i1:i2], despues[j1:j2]):
                if v == n:
                    continue
                k = buscar(L, v); L[k] = sustituir(v, n, L[k]); ops.append(('reemplaza', v))
            for n in despues[j1 + (i2 - i1):j2]:   # lo que sobra del lado nuevo se inserta
                k = buscar(L, antes[i2 - 1]); L[k + 1:k + 1] = [n]; ops.append(('inserta', n))
        elif tag == 'insert':
            nuevas = [n for n in despues[j1:j2] if n not in L]   # ya portadas: no se repiten
            if not nuevas:
                continue
            k = buscar(L, antes[i1 - 1]) if i1 > 0 else -1
            L[k + 1:k + 1] = nuevas; ops.extend(('inserta', n) for n in nuevas)
        else:
            for v in antes[i1:i2]:
                del L[buscar(L, v)]; ops.append(('borra', v))
    return L, ops

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--vertical', required=True); ap.add_argument('--antes', required=True)
    ap.add_argument('--cliente', required=True); ap.add_argument('--aplicar', action='store_true')
    a = ap.parse_args()
    v_antes = flujo_en(a.antes, a.vertical)
    v_despues = json.load(open(a.vertical, encoding='utf-8'))
    cliente = json.load(open(a.cliente, encoding='utf-8'))

    L, ops = portar_lineas(prompt(v_antes), prompt(v_despues), prompt(cliente))
    agente(cliente)['parameters']['options']['systemMessage'] = '\n'.join(L)
    print(f'\n  Prompt: {len(ops)} operación(es)')
    for tag, l in ops:
        print(f'    {tag:9} {l[:100]}')

    for h in HERRAMIENTAS:
        na, nd, nc = nodo(v_antes, h), nodo(v_despues, h), nodo(cliente, h)
        if not (na and nd and nc):
            continue
        for ruta in ('toolDescription', 'calendar.value', 'start', 'end',
                     'additionalFields.summary', 'additionalFields.description', 'options.query'):
            def leer(n):
                x = n['parameters']
                for p in ruta.split('.'):
                    x = x.get(p) if isinstance(x, dict) else None
                return x if isinstance(x, str) else None
            va, vd, vc = leer(na), leer(nd), leer(nc)
            if va is None or vd is None or vc is None or va == vd:
                continue
            nuevo = sustituir(va, vd, vc)
            x = nc['parameters']
            partes = ruta.split('.')
            for p in partes[:-1]:
                x = x[p]
            x[partes[-1]] = nuevo
            print(f'  {h}.{ruta}: portado')

    if not a.aplicar:
        print('\n  Seco: no se escribió nada. Agregue --aplicar.\n'); return
    with open(a.cliente, 'w', encoding='utf-8') as f:
        f.write(json.dumps(cliente, indent=2, ensure_ascii=False) + '\n')
    print(f'\n  ✓ {a.cliente} escrito.\n')

if __name__ == '__main__':
    main()
