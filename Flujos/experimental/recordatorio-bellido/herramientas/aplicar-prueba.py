#!/usr/bin/env python3
# Crea o actualiza en n8n el flujo de PRUEBA del recordatorio de Bellido, resolviendo los marcadores EN MEMORIA
# (calendario de pruebas, id del número de Bellido, teléfonos de prueba, rutas de los webhooks) y poniendo las
# credenciales de Bellido por nombre. NO imprime ningún valor sensible y NO escribe los valores en el repositorio.
#
#   set -a; . ~/NovuChat/.env.bellido; set +a          # N8N_BASE_URL, N8N_API_KEY, N8N_WORKFLOW_ID, WA_PHONE_ID
#   python3 herramientas/generar.py > /tmp/rec.json
#   REC_FLUJO=/tmp/rec.json REC_CALENDARIO_ARCHIVO=<archivo con el id del calendario de pruebas> \
#   REC_TEL_ANDRES=<59…> REC_TEL_SILVANA=<59…> REC_ESTADO=<archivo fuera del repo> \
#   python3 herramientas/aplicar-prueba.py
#
# Con REC_ESTADO existente, ACTUALIZA el mismo flujo y conserva las rutas de sus webhooks.
import os, json, secrets, urllib.request, urllib.error
base = os.environ['N8N_BASE_URL'].rstrip('/'); key = os.environ['N8N_API_KEY']
def llamar(m, p, body=None):
    r = urllib.request.Request(base + p, method=m, headers={'X-N8N-API-KEY': key, 'Content-Type': 'application/json'},
                               data=json.dumps(body).encode() if body is not None else None)
    try: return json.load(urllib.request.urlopen(r, timeout=90))
    except urllib.error.HTTPError as e: return {'__error': e.code, 'm': e.read().decode()[:300]}
vivo = llamar('GET', '/api/v1/workflows/' + os.environ['N8N_WORKFLOW_ID'])
if '__error' in vivo: raise SystemExit('no se pudo leer el flujo vivo de Bellido')
cred = {}
for n in vivo['nodes']:
    for t, c in (n.get('credentials') or {}).items(): cred[(t, c['name'])] = c
gh = cred[('httpHeaderAuth', 'Graph WhatsApp Bellido (Bearer)')]
gc = cred[('googleCalendarOAuth2Api', 'Google Calendar account')]
estado_ruta = os.environ['REC_ESTADO']
prev = json.load(open(estado_ruta)) if os.path.exists(estado_ruta) else None
rutas = {k: prev[k] for k in ('REEMPLAZAR_RUTA_CORRER', 'REEMPLAZAR_RUTA_CREAR')} if prev else \
        {'REEMPLAZAR_RUTA_CORRER': 'zz-rec-correr-' + secrets.token_hex(6), 'REEMPLAZAR_RUTA_CREAR': 'zz-rec-crear-' + secrets.token_hex(6)}
sust = {'REEMPLAZAR_CALENDARIO_ENSAYO_1': open(os.environ['REC_CALENDARIO_ARCHIVO']).read().strip(),
        'REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO': os.environ['WA_PHONE_ID'],
        'REEMPLAZAR_TELEFONO_PRUEBA_ANDRES': os.environ['REC_TEL_ANDRES'],
        'REEMPLAZAR_TELEFONO_PRUEBA_SILVANA': os.environ['REC_TEL_SILVANA'], **rutas}
txt = open(os.environ['REC_FLUJO'], encoding='utf-8').read()
for k, v in sust.items(): txt = txt.replace(k, v)
assert 'REEMPLAZAR_' not in txt, 'quedó un marcador sin resolver'
w = json.loads(txt)
for n in w['nodes']:
    if n['type'].endswith('googleCalendar'): n['credentials'] = {'googleCalendarOAuth2Api': {'id': gc['id'], 'name': gc['name']}}
    if n['name'] == 'Enviar plantilla': n['credentials'] = {'httpHeaderAuth': {'id': gh['id'], 'name': gh['name']}}
cuerpo = {k: w[k] for k in ('name', 'nodes', 'connections', 'settings')}
r = llamar('PUT', '/api/v1/workflows/' + prev['id'], cuerpo) if prev else llamar('POST', '/api/v1/workflows', cuerpo)
if '__error' in r: raise SystemExit('n8n respondió %s: %s' % (r['__error'], r['m']))
wid = r['id']
llamar('POST', '/api/v1/workflows/%s/deactivate' % wid)
a = llamar('POST', '/api/v1/workflows/%s/activate' % wid)
# El archivo de estado trae las rutas de los webhooks (URL de capacidad): se crea con permisos 0600 desde el
# principio (sin ventana con permisos de la umask) y, si ya existia, se vuelve a dejar en 0600.
fd = os.open(estado_ruta, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f: f.write(json.dumps({'id': wid, **rutas}))
print('flujo %s, %d nodos, activo=%s' % ('actualizado' if prev else 'creado', len(r['nodes']), a.get('active')))
