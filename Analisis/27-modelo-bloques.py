# -*- coding: utf-8 -*-
"""Conversacion por BLOQUES de 25 respuestas, contra el tope actual.

Compara las dos definiciones de la unidad de cobro:

  TOPE (vigente, `Analisis/15` y `16`): una conversacion es la ventana de 24 h
    por telefono. A las 25 respuestas el asistente manda UN mensaje fijo, avisa
    a recepcion y no vuelve a llamar al modelo hasta que abra otra ventana.
    Costo de esa ventana: 26 mensajes. Se factura UNA conversacion.

  BLOQUES (propuesta del 13/09/2026): una conversacion es un bloque de hasta 25
    respuestas del asistente a un mismo telefono dentro de la ventana de 24 h.
    La respuesta 26 abre un bloque nuevo y se factura OTRA conversacion. A las
    24 h la ventana se renueva y el conteo vuelve a cero.
    Costo de esa ventana: todas las respuestas que necesite. Se facturan
    ceil(respuestas / 25) conversaciones.

Tarifas y parametros: los de `14-modelo-costos.py` (Meta desde el 01/10/2026).
Impuestos: 16 % (IVA + IT), como en `21-propuesta-de-silvana-comparada.md`.

Correr: python3 Analisis/27-modelo-bloques.py
"""
import importlib.util
import math
import os

_ruta = os.path.join(os.path.dirname(os.path.abspath(__file__)), '14-modelo-costos.py')
_spec = importlib.util.spec_from_file_location('modelo14', _ruta)
m14 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m14)

SERVICIO = m14.SERVICIO
UTILIDAD = m14.UTILIDAD
GRATIS = m14.GRATIS_SERVICIO
RECORD = m14.RECORDATORIO_POR_CONV
IMPUESTOS = 0.16
BLOQUE = 25

# Plan: (nombre, precio USD, conversaciones incluidas)
PLANES = [
    ('Base', 25, 100),
    ('Crecimiento', 50, 220),
    ('Corporativo', 90, 500),
    ("Q'Taco (oferta)", 40, 200),
]
BOLSA_USD_CONV = 10 / 30   # 0,333


def modelo_usd(turnos):
    """Costo del modelo para una ventana de `turnos` respuestas. Por encima de
    la ventana de memoria el costo por turno es constante, asi que se
    extrapola linealmente desde 30 para no depender de la forma exacta."""
    if turnos <= 30:
        return m14.modelo_usd(turnos)
    return m14.modelo_usd(30) + (turnos - 30) * (m14.modelo_usd(30) - m14.modelo_usd(29))


def costo_ventana_usd(mensajes, fuera_franquicia=True):
    """Costo de UNA ventana con `mensajes` respuestas del asistente."""
    servicio = mensajes * SERVICIO if fuera_franquicia else 0.0
    return modelo_usd(mensajes) + servicio + RECORD * UTILIDAD


def bloques(mensajes):
    return max(1, math.ceil(mensajes / BLOQUE))


def mes(plan, ventanas, mezcla, modo):
    """Economia de un comercio en un mes.

    `mezcla`: lista de (proporcion, respuestas naturales por ventana).
    `modo`: 'tope' o 'bloques'.
    Devuelve (ingreso neto de impuestos, costo, facturadas, mensajes).
    """
    nombre, precio, incluidas = plan
    facturadas = 0.0
    mensajes = 0.0
    modelo = 0.0
    for prop, largo in mezcla:
        n = ventanas * prop
        if modo == 'tope':
            enviados = min(largo, BLOQUE + 1)   # 25 + el mensaje fijo
            fact = 1
        else:
            enviados = largo
            fact = bloques(largo)
        facturadas += n * fact
        mensajes += n * enviados
        modelo += n * modelo_usd(enviados)
    servicio = max(0.0, mensajes - GRATIS) * SERVICIO
    record = ventanas * RECORD * UTILIDAD
    costo = modelo + servicio + record
    # Lo que excede el plan se compra en bolsas a 0,333. Supone que el comercio
    # compra; si no compra, el asistente se corta y el ingreso es solo el plan.
    exceso = max(0.0, facturadas - incluidas)
    ingreso = (precio + exceso * BOLSA_USD_CONV) * (1 - IMPUESTOS)
    return ingreso, costo, facturadas, mensajes


def mezcla(cola, largo_cola):
    """60 % cortas (5), 30 % tipicas (10), `cola` en `largo_cola`."""
    resto = 1 - cola
    return [(resto * 2 / 3, 5), (resto / 3, 10), (cola, largo_cola)]


if __name__ == '__main__':
    print('=' * 92)
    print('1. LA UNIDAD: que cuesta y que rinde UN bloque, fuera de la franquicia (USD)')
    print('=' * 92)
    print('   Ingreso neto de impuestos por conversacion facturada:')
    for nombre, precio, inc in PLANES:
        print(f'     {nombre:16} {precio/inc:.3f} bruto -> {precio/inc*(1-IMPUESTOS):.3f} neto')
    print(f'     {"Bolsa":16} {BOLSA_USD_CONV:.3f} bruto -> {BOLSA_USD_CONV*(1-IMPUESTOS):.3f} neto')
    print()
    print(f'   {"respuestas":>10} {"costo":>8}   margen neto por conversacion facturada, por plan')
    print(f'   {"":>10} {"":>8}   ' + ''.join(f'{n[:11]:>12}' for n, _, _ in PLANES) + f'{"Bolsa":>12}')
    for r in (5, 10, 15, 20, 25):
        c = costo_ventana_usd(r)
        fila = ''.join(f'{p/i*(1-IMPUESTOS)-c:>+12.3f}' for _, p, i in PLANES)
        fila += f'{BOLSA_USD_CONV*(1-IMPUESTOS)-c:>+12.3f}'
        print(f'   {r:>10} {c:>8.3f}   {fila}')

    print()
    print('=' * 92)
    print('2. UNA VENTANA LARGA, con las dos reglas (USD, fuera de la franquicia)')
    print('=' * 92)
    print(f'   {"resp. nat.":>10} | {"TOPE: msj":>9} {"fact":>5} {"costo":>7} | {"BLOQUES: msj":>12} {"fact":>5} {"costo":>7} | '
          f'{"resultado Crecimiento":>22} {"resultado Bolsa":>16}')
    neto_cre = 50 / 220 * (1 - IMPUESTOS)
    neto_bolsa = BOLSA_USD_CONV * (1 - IMPUESTOS)
    for L in (10, 25, 26, 30, 35, 50, 75, 100, 200):
        ct = costo_ventana_usd(min(L, 26)); cb = costo_ventana_usd(L)
        fb = bloques(L)
        rt_c = neto_cre - ct; rb_c = fb * neto_cre - cb
        rt_b = neto_bolsa - ct; rb_b = fb * neto_bolsa - cb
        print(f'   {L:>10} | {min(L,26):>9} {1:>5} {ct:>7.3f} | {L:>12} {fb:>5} {cb:>7.3f} | '
              f'{rt_c:>+9.3f} -> {rb_c:>+8.3f} | {rt_b:>+6.3f} -> {rb_b:>+6.3f}')

    print()
    print('=' * 92)
    print('3. EL MES DE UN COMERCIO CON EL PLAN LLENO, segun la cola de ventanas largas')
    print('   Mezcla: 60 % de 5, 30 % de 10, y la cola con el largo natural indicado.')
    print('   Lo que excede el plan se compra en bolsas a 0,333.')
    print('=' * 92)
    for largo in (35, 50):
        print(f'\n   --- Cola de ventanas que necesitarian {largo} respuestas ({bloques(largo)} bloques) ---')
        print(f'   {"plan":16} {"cola":>5} | {"TOPE: ingreso":>13} {"costo":>7} {"margen":>8} | '
              f'{"BLOQUES: fact.":>14} {"ingreso":>8} {"costo":>7} {"margen":>8} | {"delta USD":>9}')
        for plan in PLANES:
            for cola in (0.02, 0.05, 0.10, 0.20, 0.30):
                it, ct, ft, mt = mes(plan, plan[2], mezcla(cola, largo), 'tope')
                ib, cb, fb, mb = mes(plan, plan[2], mezcla(cola, largo), 'bloques')
                print(f'   {plan[0]:16} {cola*100:>4.0f}% | {it:>13.2f} {ct:>7.2f} {it-ct:>+8.2f} | '
                      f'{fb:>14.0f} {ib:>8.2f} {cb:>7.2f} {ib-cb:>+8.2f} | {(ib-cb)-(it-ct):>+9.2f}')

    print()
    print('=' * 92)
    print('4. LO QUE VE EL COMERCIO: cuantas ventanas reales cubre su plan')
    print('=' * 92)
    print(f'   {"plan":16} {"cola":>5} {"largo":>6} | {"ventanas que cubre":>19} {"(hoy: las incluidas)":>21}')
    for plan in PLANES:
        for cola, largo in ((0.05, 35), (0.10, 35), (0.10, 50), (0.20, 50)):
            fact_por_ventana = sum(p * bloques(l) for p, l in mezcla(cola, largo))
            print(f'   {plan[0]:16} {cola*100:>4.0f}% {largo:>6} | {plan[2]/fact_por_ventana:>19.0f} {plan[2]:>21}')

    print()
    print('=' * 92)
    print('5. EL CASO SIN TECHO: una sola ventana desbocada (bucle, cliente que insiste)')
    print('=' * 92)
    print(f'   {"respuestas":>10} {"bloques":>8} {"costo USD":>10} | {"Corporativo":>12} {"Bolsa":>8}   (resultado neto)')
    neto_corp = 90 / 500 * (1 - IMPUESTOS)
    for L in (25, 50, 100, 200, 500):
        c = costo_ventana_usd(L); b = bloques(L)
        print(f'   {L:>10} {b:>8} {c:>10.2f} | {b*neto_corp-c:>+12.2f} {b*neto_bolsa-c:>+8.2f}')
    print('   Con el tope vigente, ninguna ventana cuesta mas de', f'{costo_ventana_usd(26):.3f} USD.')

    print()
    print('=' * 92)
    print('6. LOS DOS UMBRALES DE CORTE (13/09): operador a las 50, bloqueo a las 100')
    print('   Entre 50 y 100 cada consulta recibe el aviso fijo (sin modelo): 1 msj de servicio.')
    print('   A partir de 100 no se envia nada. Techo de costo de UNA ventana, USD:')
    print('=' * 92)
    OPERADOR, BLOQUEO = 50, 100
    # Aviso fijo por consulta hasta el bloqueo (lo decidido).
    fijos = BLOQUEO - OPERADOR
    techo = costo_ventana_usd(OPERADOR) + fijos * SERVICIO
    fact = bloques(BLOQUEO)
    # Alternativa: un solo aviso y silencio.
    techo_uno = costo_ventana_usd(OPERADOR) + SERVICIO
    fact_uno = bloques(OPERADOR + 1)
    print(f'   {"regla":42} {"msj":>5} {"fact":>5} {"costo":>7} | {"Corporativo":>12} {"Bolsa":>8}')
    for nombre, msj, f, c in (
        ('Sin umbrales (200 respuestas)', 200, bloques(200), costo_ventana_usd(200)),
        ('Aviso fijo por consulta hasta el bloqueo', BLOQUEO, fact, techo),
        ('Un solo aviso y silencio (alternativa)', OPERADOR + 1, fact_uno, techo_uno),
        ('Tope con corte del 08/09 (referencia)', 26, 1, costo_ventana_usd(26)),
    ):
        print(f'   {nombre:42} {msj:>5} {f:>5} {c:>7.3f} | {f*neto_corp-c:>+12.3f} {f*neto_bolsa-c:>+8.3f}')
    print(f'   Los {fijos} avisos fijos cuestan {fijos*SERVICIO:.3f} USD y facturan '
          f'{bloques(BLOQUEO)-bloques(OPERADOR)} bloques al comercio.')

    print()
    print('=' * 92)
    print('7. LO MISMO, CONTANDO LOS AVISOS A RECEPCION (correccion del 13/09)')
    print('   "Avisar a recepcion" es un nodo de WhatsApp: texto libre desde el numero')
    print('   del negocio a `numeroRecepcion`. Cada aviso es 1 mensaje de Meta (servicio si')
    print('   recepcion tiene la ventana abierta; plantilla de utilidad si no: igual precio).')
    print('   No se factura al comercio: es costo de NovuChat y consume su franquicia.')
    print('=' * 92)
    print(f'   {"regla":42} {"avisos":>6} {"costo":>7} | {"Corporativo":>12} {"Bolsa":>8} {"% Meta":>7}')
    for nombre, avisos, f, c, mod in (
        ('Tope con corte del 08/09 (aviso al tope)', 1, 1, costo_ventana_usd(26), modelo_usd(26)),
        ('Umbrales 50/100: avisos en 50 y 100 (codigo)', 2, fact, techo, modelo_usd(OPERADOR)),
        ('Umbrales 50/100 + aviso al abrir el bloque 2', 3, fact, techo, modelo_usd(OPERADOR)),
        ('Un solo aviso y silencio: bloqueo inalcanzable', 1, fact_uno, techo_uno, modelo_usd(OPERADOR)),
    ):
        ct = c + avisos * SERVICIO
        print(f'   {nombre:42} {avisos:>6} {ct:>7.3f} | {f*neto_corp-ct:>+12.3f} {f*neto_bolsa-ct:>+8.3f} '
              f'{100*(ct-mod)/ct:>6.0f}%')
    print(f'   Techo por conversacion facturada con los umbrales: '
          f'{(techo + 2*SERVICIO)/fact:.3f} USD, bruto {(techo + 2*SERVICIO)/fact/(1-IMPUESTOS):.4f} '
          f'(minimo de la bolsa: 0,3632).')

    print()
    print('=' * 92)
    print('8. LA FRANQUICIA DEL PLAN BASE: 100 ventanas, cola del 10 % en 50 respuestas')
    print('=' * 92)
    for modo in ('tope', 'bloques'):
        _, _, _, msj = mes(PLANES[0], 100, mezcla(0.10, 50), modo)
        fuera = max(0.0, msj - GRATIS)
        print(f'   {modo:8} mensajes {msj:>6.0f}   fuera de franquicia {fuera:>5.0f}   Meta servicio {fuera*SERVICIO:>5.2f} USD')
