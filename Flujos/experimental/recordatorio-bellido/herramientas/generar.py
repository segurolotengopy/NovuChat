#!/usr/bin/env python3
# Genera, con una sola fuente (src/), el flujo de PRUEBA y el DEFINITIVO del recordatorio de Bellido con marcadores
# (sin ids ni teléfonos):
#   python3 herramientas/generar.py > recordatorio-bellido.prueba.json
#   python3 herramientas/generar.py v1 > recordatorio-bellido.v1.json
import json,sys
import os
AQUI=os.path.dirname(os.path.abspath(__file__))
SRC=os.path.join(AQUI,"..","src")
def j(p): return open(os.path.join(SRC,p),encoding='utf-8').read()
CAL="REEMPLAZAR_CALENDARIO_ENSAYO_1"
def nodo(nombre,tipo,ver,pos,params,**kw):
    n={"id":"rec-"+__import__("hashlib").md5(nombre.encode()).hexdigest()[:12],"name":nombre,"type":tipo,"typeVersion":ver,"position":pos,"parameters":params}
    n.update(kw); return n
CONFIG_PARAMS={"assignments":{"assignments":[
   {"id":"c1","name":"calendarioId","type":"string","value":CAL},
   {"id":"c2","name":"phoneNumberId","type":"string","value":"REEMPLAZAR_PHONE_NUMBER_ID_BELLIDO"},
   {"id":"c3","name":"waGraphVersion","type":"string","value":"v26.0"},
   {"id":"c4","name":"plantilla","type":"string","value":"recordatorio_cita_consultorio"},
   {"id":"c5","name":"idiomaPlantilla","type":"string","value":"es"},
   {"id":"c6","name":"conQuienVariable","type":"string","value":"el Doctor Bellido"},
   {"id":"c7","name":"prefijosPermitidos","type":"string","value":"591"},
   {"id":"c8","name":"estadoComercio","type":"string","value":"operativo"},
   {"id":"c9","name":"telefonoPruebaAndres","type":"string","value":"REEMPLAZAR_TELEFONO_PRUEBA_ANDRES"},
   {"id":"c10","name":"telefonoPruebaSilvana","type":"string","value":"REEMPLAZAR_TELEFONO_PRUEBA_SILVANA"},
   {"id":"c11","name":"saludoVariable","type":"string","value":"te escribimos del consultorio"},
   {"id":"c12","name":"variablesCuerpo","type":"string","value":"4"}]},"options":{}}
nodos=[
 nodo("Todos los días 17:00 (apagado en la prueba)","n8n-nodes-base.scheduleTrigger",1.2,[0,300],{"rule":{"interval":[{"field":"cronExpression","expression":"0 17 * * *"}]}},disabled=True),
 nodo("Correr recordatorio ahora","n8n-nodes-base.webhook",2,[0,500],{"httpMethod":"POST","path":"REEMPLAZAR_RUTA_CORRER","responseMode":"onReceived","responseData":"allEntries","options":{}},webhookId="rec-correr"),
 nodo("Crear citas ficticias","n8n-nodes-base.webhook",2,[0,0],{"httpMethod":"POST","path":"REEMPLAZAR_RUTA_CREAR","responseMode":"onReceived","responseData":"allEntries","options":{}},webhookId="rec-crear"),
 nodo("Config del recordatorio","n8n-nodes-base.set",3.4,[300,300],CONFIG_PARAMS),
 nodo("Config de la prueba","n8n-nodes-base.set",3.4,[300,0],CONFIG_PARAMS),
 nodo("Citas ficticias","n8n-nodes-base.code",2,[600,0],{"jsCode":j("citas-ficticias.js")}),
 nodo("Crear cita de prueba","n8n-nodes-base.googleCalendar",1.3,[900,0],{"operation":"create","calendar":{"__rl":True,"mode":"id","value":"={{ $json.calendario }}"},"start":"={{ $json.start }}","end":"={{ $json.end }}","additionalFields":{"summary":"={{ $json.summary }}","description":"={{ $json.description }}"}}),
 nodo("Citas de mañana","n8n-nodes-base.googleCalendar",1.3,[600,300],{"operation":"getAll","calendar":{"__rl":True,"mode":"id","value":"={{ $json.calendarioId }}"},"returnAll":True,"timeMin":"={{ $now.setZone('America/La_Paz').plus({days:1}).startOf('day').toISO() }}","timeMax":"={{ $now.setZone('America/La_Paz').plus({days:1}).endOf('day').toISO() }}","options":{"singleEvents":True}},alwaysOutputData=True),
 nodo("Preparar recordatorios","n8n-nodes-base.code",2,[900,300],{"jsCode":j("preparar-recordatorios.js")}),
 nodo("¿Hay recordatorios?","n8n-nodes-base.if",2.2,[1200,300],{"conditions":{"options":{"caseSensitive":True,"typeValidation":"loose","version":2},"conditions":[{"id":"h1","leftValue":"={{ $json.sinRecordatorios !== true }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}),
 nodo("Enviar plantilla","n8n-nodes-base.httpRequest",4.2,[1500,200],{"method":"POST","url":"=https://graph.facebook.com/{{ $json.waGraphVersion }}/{{ $json.phoneNumberId }}/messages","authentication":"genericCredentialType","genericAuthType":"httpHeaderAuth","sendBody":True,"specifyBody":"json","jsonBody":"={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.telefono, type: 'template', template: { name: $json.plantilla, language: { code: $json.idioma || 'es' }, components: [{ type: 'body', parameters: $json.parametros.map((t) => ({ type: 'text', text: t })) }] } }) }}","options":{"response":{"response":{"neverError":True,"fullResponse":False}}}},onError="continueRegularOutput"),
 nodo("Después del envío","n8n-nodes-base.code",2,[1800,200],{"jsCode":j("despues-del-envio.js")}),
 nodo("¿Se envió?","n8n-nodes-base.if",2.2,[2100,200],{"conditions":{"options":{"caseSensitive":True,"typeValidation":"loose","version":2},"conditions":[{"id":"e1","leftValue":"={{ $json.enviado }}","rightValue":"","operator":{"type":"boolean","operation":"true","singleValue":True}}],"combinator":"and"},"options":{}}),
 nodo("Marcar como recordada","n8n-nodes-base.googleCalendar",1.3,[2400,100],{"operation":"update","eventId":"={{ $json.eventoId }}","calendar":{"__rl":True,"mode":"id","value":"={{ $json.calendarioDelEvento }}"},"updateFields":{"description":"={{ $json.descripcionMarcada }}"}}),
]
con={
 "Todos los días 17:00 (apagado en la prueba)":{"main":[[{"node":"Config del recordatorio","type":"main","index":0}]]},
 "Correr recordatorio ahora":{"main":[[{"node":"Config del recordatorio","type":"main","index":0}]]},
 "Crear citas ficticias":{"main":[[{"node":"Config de la prueba","type":"main","index":0}]]},
 "Config de la prueba":{"main":[[{"node":"Citas ficticias","type":"main","index":0}]]},
 "Citas ficticias":{"main":[[{"node":"Crear cita de prueba","type":"main","index":0}]]},
 "Config del recordatorio":{"main":[[{"node":"Citas de mañana","type":"main","index":0}]]},
 "Citas de mañana":{"main":[[{"node":"Preparar recordatorios","type":"main","index":0}]]},
 "Preparar recordatorios":{"main":[[{"node":"¿Hay recordatorios?","type":"main","index":0}]]},
 "¿Hay recordatorios?":{"main":[[{"node":"Enviar plantilla","type":"main","index":0}],[]]},
 "Enviar plantilla":{"main":[[{"node":"Después del envío","type":"main","index":0}]]},
 "Después del envío":{"main":[[{"node":"¿Se envió?","type":"main","index":0}]]},
 "¿Se envió?":{"main":[[{"node":"Marcar como recordada","type":"main","index":0}],[]]},
}
def v1():
    """Flujo DEFINITIVO: mismos nodos y mismo código que la prueba, sin lo que es de prueba, con disparador diario."""
    import copy
    por={n["name"]:copy.deepcopy(n) for n in nodos}
    cal_def="REEMPLAZAR_CALENDARIO_BELLIDO"
    # Config: sin teléfonos de prueba y con el calendario real. «estadoComercio» queda como clave de datos (ver LEEME).
    cfg=copy.deepcopy(CONFIG_PARAMS)
    cfg["assignments"]["assignments"]=[a for a in cfg["assignments"]["assignments"] if not a["name"].startswith("telefonoPrueba")]
    for a in cfg["assignments"]["assignments"]:
        if a["name"]=="calendarioId": a["value"]=cal_def
    disparador=nodo("Todos los días 17:00","n8n-nodes-base.scheduleTrigger",1.2,[0,300],{"rule":{"interval":[{"field":"cronExpression","expression":"0 17 * * *"}]}})
    config=nodo("Config del recordatorio","n8n-nodes-base.set",3.4,[300,300],cfg,
        notes="estadoComercio: clave de datos, fija en operativo. Mejora posterior: leer el estado del comercio del servidor (ver LEEME).")
    manana=por["Citas de mañana"]
    manana["credentials"]={"googleCalendarOAuth2Api":{"id":"","name":"Google Calendar account"}}
    envio=por["Enviar plantilla"]
    envio["credentials"]={"httpHeaderAuth":{"id":"","name":"Graph WhatsApp Bellido (Bearer)"}}
    marcar=por["Marcar como recordada"]
    marcar["credentials"]={"googleCalendarOAuth2Api":{"id":"","name":"Google Calendar account"}}
    # Si la marca falla DESPUÉS de enviar, error visible (salida de error) y nunca una ejecución completa (reenviaría).
    marcar["onError"]="continueErrorOutput"
    sin_marca=nodo("Enviado pero no marcado","n8n-nodes-base.code",2,[2700,200],{"jsCode":j("marca-fallida.js")})
    omision=nodo("Revisar omisión","n8n-nodes-base.code",2,[1500,500],{"jsCode":j("omision-por-configuracion.js")})
    rechazo=nodo("Recordatorio no enviado","n8n-nodes-base.code",2,[2400,300],{"jsCode":j("envio-rechazado.js")})
    nodos1=[disparador,config,manana,por["Preparar recordatorios"],por["¿Hay recordatorios?"],omision,envio,por["Después del envío"],por["¿Se envió?"],marcar,sin_marca,rechazo]
    def sig(a,b): return {"main":[[{"node":b,"type":"main","index":0}]]}
    con1={
     "Todos los días 17:00":sig(0,"Config del recordatorio"),
     "Config del recordatorio":sig(0,"Citas de mañana"),
     "Citas de mañana":sig(0,"Preparar recordatorios"),
     "Preparar recordatorios":sig(0,"¿Hay recordatorios?"),
     "¿Hay recordatorios?":{"main":[[{"node":"Enviar plantilla","type":"main","index":0}],[{"node":"Revisar omisión","type":"main","index":0}]]},
     "Enviar plantilla":sig(0,"Después del envío"),
     "Después del envío":sig(0,"¿Se envió?"),
     # Salida 0 (arriba): se marcan las enviadas; salida 1 (abajo, corre después con executionOrder v1): error visible.
     "¿Se envió?":{"main":[[{"node":"Marcar como recordada","type":"main","index":0}],[{"node":"Recordatorio no enviado","type":"main","index":0}]]},
     "Marcar como recordada":{"main":[[],[{"node":"Enviado pero no marcado","type":"main","index":0}]]},
    }
    # El saneo del repositorio público rechaza 10 o más dígitos seguidos (también en un id de nodo): se vuelve a calcular
    # el id, de forma determinista, solo si el hash cayó en ese caso.
    for n in nodos1:
        k=0
        while __import__("re").search(r"\d{10}",n["id"]):
            k+=1; n["id"]="rec-"+__import__("hashlib").md5((n["name"]+"#"+str(k)).encode()).hexdigest()[:12]
    return {"name":"NovuChat Bellido — Recordatorio de citas (24 h)","nodes":nodos1,"connections":con1,"settings":{"executionOrder":"v1","timezone":"America/La_Paz","saveDataSuccessExecution":"none"}}
if len(sys.argv)>1 and sys.argv[1]=="v1":
    print(json.dumps(v1(),ensure_ascii=False,indent=1)); sys.exit(0)
print(json.dumps({"name":"ZZ Recordatorio Bellido (prueba)","nodes":nodos,"connections":con,"settings":{"executionOrder":"v1"}},ensure_ascii=False,indent=1))
