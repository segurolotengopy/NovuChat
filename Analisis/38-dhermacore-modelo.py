# -*- coding: utf-8 -*-
"""Rentabilidad de la propuesta a Dhermacore e Infoproductos (22/09/2026).

Oferta en estudio (PDF del 22/09):
  - Setup dual a medida: USD 125, pago unico (50 % anticipo).
  - Licencia mensual «Pro Plus»: USD 99 por hasta 800 conversaciones
    COMPARTIDAS entre DOS lineas de WhatsApp (dos numeros propios).
  - Bolsa: 30 conversaciones por USD 10. Cambios extra: USD 15 c/u.
  - Reactivacion: 30 mensajes de marketing por USD 10.
  - Incluye: enrutamiento a recepciones, QR de cobro con validacion humana,
    envio autonomo de imagenes y «seguimiento de rescate» a las 48 h.

Unidad de cobro vigente (CLAUDE.md §2, Analisis/27): una conversacion es un
bloque de hasta 25 respuestas del asistente a un telefono en la ventana de
24 h; la respuesta 26 factura otra.

LO QUE DISTINGUE ESTE CASO DE PLATINUM (Analisis/30 y 32), y en este orden:

  1. EL 70 % DEL TRAFICO ENTRA POR ANUNCIOS DE CLIC A WHATSAPP (dato de Andres,
     22/09/2026). Una conversacion que nace de un anuncio abre la VENTANA DE
     PUNTO DE ENTRADA GRATUITO: todo lo que la empresa manda en las 72 h
     siguientes es gratis, y no consume franquicia (Analisis/31 §1). Es el
     renglon que decide, y por eso este modelo lo parametriza (`CTWA`) en vez
     de darlo por hecho: CLAUDE.md §6 prohibe PROMETERLO antes de medirlo.
  2. SON DOS NUMEROS DE EMPRESA, asi que hay DOS franquicias de 1.000 mensajes
     de servicio gratis al mes.

Tarifas: las de 14-modelo-costos.py (Meta desde el 01/10/2026). Impuestos 16 %.
Correr: python3 Analisis/38-dhermacore-modelo.py
"""
import importlib.util, math, os
_r = os.path.join(os.path.dirname(os.path.abspath(__file__)), '14-modelo-costos.py')
_s = importlib.util.spec_from_file_location('m14', _r); m14 = importlib.util.module_from_spec(_s); _s.loader.exec_module(m14)

SERVICIO, UTILIDAD, MARKETING = m14.SERVICIO, m14.UTILIDAD, m14.MARKETING
GRATIS = m14.GRATIS_SERVICIO      # 1.000 mensajes de servicio POR NUMERO
IMP = 0.16
PRECIO, INCLUIDAS, SETUP = 99.0, 800, 125.0
NETO = PRECIO * (1 - IMP)
BOLSA = 10.0 / 30                 # 0,333 por conversacion
NUMEROS = 2
REPARTO = (0.60, 0.40)            # Dhermacore (leads) / libros, del trafico
# VENTANA DE PUNTO DE ENTRADA GRATUITO: conversaciones que nacen de un anuncio
# de clic a WhatsApp. Meta no cobra NINGUN mensaje de la empresa en las 72 h
# siguientes, y esos mensajes tampoco gastan franquicia.
CTWA = 0.70

# Supuestos de operacion, conservadores y declarados:
AVISO_A_PERSONA = 0.55   # conversaciones que terminan en derivacion o en compra
                         # -> 1 plantilla de utilidad al telefono del equipo
OCR = 0.0005             # lectura del comprobante con Gemini, por compra
COMPRAS = 0.20           # conversaciones de la linea de libros que pagan
RESCATE = 0.40           # leads que no concluyen -> 1 seguimiento a las 48 h
CORP = (90.0, 500)       # el plan de lista mas grande (Pro)


def costo_meta_mes(n, msj, ctwa=CTWA):
    """Mensajes de servicio del mes, con UNA franquicia POR NUMERO.

    Las conversaciones que nacen de un anuncio no pagan ni gastan franquicia:
    solo el resto llega al contador de los 1.000 gratis de su numero.
    """
    total = 0.0
    for cuota in REPARTO:
        m = n * msj * cuota * (1 - ctwa)
        total += max(0.0, m - GRATIS) * SERVICIO
    return total


def mes(n, msj, rescate_marketing=False, ctwa=CTWA):
    """Costo del mes con n conversaciones de msj mensajes del asistente.

    El aviso a la persona del equipo va a OTRO telefono: esa conversacion no
    nace de un anuncio y se paga siempre. El seguimiento de rescate a las 48 h
    SI cae dentro de las 72 h de la ventana gratuita, asi que solo lo pagan las
    conversaciones que no vinieron de un anuncio.
    """
    meta = costo_meta_mes(n, msj, ctwa)
    modelo = n * m14.modelo_usd(min(msj, 30))
    avisos = n * AVISO_A_PERSONA * UTILIDAD
    ocr = n * REPARTO[1] * COMPRAS * OCR
    seguimiento = n * RESCATE * (1 - ctwa) * (MARKETING if rescate_marketing else UTILIDAD)
    return meta + modelo + avisos + ocr + seguimiento


def lista(n):
    """Lo que pagaria por lista: Pro (90 por 500) mas bolsas de 30."""
    return CORP[0] + math.ceil(max(0, n - CORP[1]) / 30) * 10


def equilibrio(msj, rescate_marketing=False, ctwa=CTWA):
    n = 0
    while mes(n + 1, msj, rescate_marketing, ctwa) < NETO and n < 40000:
        n += 1
    return n


def ctwa_minimo(n, msj):
    """Fraccion de trafico por anuncio que hace falta para no perder."""
    for k in range(0, 101):
        if mes(n, msj, False, k / 100) <= NETO:
            return k / 100
    return None


if __name__ == '__main__':
    print(f'Oferta: USD {PRECIO:.0f} por {INCLUIDAS} conv = {PRECIO/INCLUIDAS:.3f} USD/conv; neto de impuestos {NETO:.2f}')
    print(f'Referencias: Pro {CORP[0]/CORP[1]:.3f}/conv; bolsa {BOLSA:.3f}; minimo de la bolsa (bloque lleno) 0,3632')
    print(f'Franquicia: {NUMEROS} numeros x {GRATIS} mensajes de servicio gratis = {NUMEROS*GRATIS} al mes')
    print(f'Ventana de punto de entrada gratuito: {100*CTWA:.0f} % del trafico nace de un anuncio')
    print()

    print(f'1. EL MES con CTWA = {100*CTWA:.0f} % (rescate como utilidad)')
    print(f'   {"conv":>5} | ' + ' | '.join(f'{m:>2} msj: costo margen   %' for m in (10, 12, 14, 16)) + ' | lista')
    for n in (300, 500, 800, 1000, 1500, 2000):
        fila = []
        for msj in (10, 12, 14, 16):
            c = mes(n, msj)
            fila.append(f'{c:>11.1f} {NETO-c:>+6.1f} {100*(NETO-c)/NETO:>3.0f}%')
        print(f'   {n:>5} | ' + ' | '.join(fila) + f' | {lista(n):>5.0f}')
    print()

    print('2. EL MISMO MES SIN LA VENTANA GRATUITA (CTWA = 0): el escenario de respaldo')
    print(f'   {"conv":>5} | ' + ' | '.join(f'{m:>2} msj: costo margen   %' for m in (10, 12, 14, 16)))
    for n in (300, 500, 800, 1000):
        fila = []
        for msj in (10, 12, 14, 16):
            c = mes(n, msj, False, 0.0)
            fila.append(f'{c:>11.1f} {NETO-c:>+6.1f} {100*(NETO-c)/NETO:>3.0f}%')
        print(f'   {n:>5} | ' + ' | '.join(fila))
    print()

    print('3. SENSIBILIDAD a la fraccion que entra por anuncio, con 800 conversaciones')
    print(f'   {"CTWA":>5} | ' + ' | '.join(f'{m:>2} msj: margen' for m in (10, 12, 14, 16)))
    for k in (0.0, 0.25, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90):
        fila = [f'{NETO-mes(800, m, False, k):>+11.1f}' for m in (10, 12, 14, 16)]
        print(f'   {100*k:>4.0f}% | ' + ' | '.join(fila))
    print()
    print('   CTWA MINIMO para no perder con 800 conversaciones:')
    for msj in (10, 12, 14, 16, 20):
        k = ctwa_minimo(800, msj)
        print(f'      {msj:>2} msj: {"nunca alcanza" if k is None else f"{100*k:.0f} % del trafico por anuncio"}')
    print()

    print(f'4. PUNTO DE EQUILIBRIO en conversaciones al mes (CTWA = {100*CTWA:.0f} %)')
    print(f'   {"msj/conv":>8} | {"rescate utilidad":>16} | {"rescate marketing":>17} | {"sin ventana gratuita":>20}')
    for msj in (10, 12, 14, 16, 20, 25):
        print(f'   {msj:>8} | {equilibrio(msj):>16} | {equilibrio(msj, True):>17} | {equilibrio(msj, False, 0.0):>20}')
    print()

    print(f'5. QUE PESA CADA RENGLON a plena carga (800 conv, 14 msj, CTWA = {100*CTWA:.0f} %)')
    n, msj = 800, 14
    partes = [
        ('Meta - servicio del 30 % que NO viene de anuncios', costo_meta_mes(n, msj)),
        ('Meta - avisos a la persona (utilidad, siempre se pagan)', n * AVISO_A_PERSONA * UTILIDAD),
        ('Meta - seguimiento de rescate del 30 %', n * RESCATE * (1 - CTWA) * UTILIDAD),
        ('Modelo (Gemini)', n * m14.modelo_usd(msj)),
        ('OCR de comprobantes', n * REPARTO[1] * COMPRAS * OCR),
    ]
    tot = sum(x[1] for x in partes)
    for nombre, v in partes:
        print(f'   {nombre:<56} {v:>7.2f} USD  {100*v/tot:>4.0f} %')
    print(f'   {"TOTAL":<56} {tot:>7.2f} USD   margen {NETO-tot:+.2f} ({100*(NETO-tot)/NETO:.0f} %)')
    print()

    print('6. MAS ALLA DE LAS 800: cada conversacion de bolsa')
    for msj in (12, 14, 16, 25):
        base = m14.modelo_usd(min(msj, 30)) + AVISO_A_PERSONA*UTILIDAD
        con_anuncio = base
        sin_anuncio = base + msj*SERVICIO + RESCATE*UTILIDAD
        print(f'   {msj:>2} msj: nacida de un anuncio cuesta {con_anuncio:.3f} -> {BOLSA*(1-IMP)-con_anuncio:+.3f};'
              f' sin anuncio cuesta {sin_anuncio:.3f} -> {BOLSA*(1-IMP)-sin_anuncio:+.3f}')
    print()

    print(f'7. EL SETUP: USD {SETUP:.0f} contra lo que hay que construir')
    JORNADA = 200.0   # referencia de Analisis/32 (instalacion a medida 250-350 por ~6 jornadas)
    margen_ref = NETO - mes(800, 14)
    print(f'   margen mensual de referencia (800 conv, 14 msj, CTWA {100*CTWA:.0f} %): {margen_ref:+.1f} USD')
    for jornadas in (3, 4, 6):
        costo = jornadas * JORNADA
        print(f'   {jornadas} jornadas a {JORNADA:.0f} USD = {costo:>6.0f} USD;'
              f' el setup cubre {100*SETUP*(1-IMP)/costo:>4.0f} %;'
              f' lo que falta se recupera en {(costo - SETUP*(1-IMP))/margen_ref:>4.1f} meses')
