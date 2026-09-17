# -*- coding: utf-8 -*-
"""Factibilidad comercial de la oferta a Clinica Platinum (16/09/2026).

Oferta en estudio: USD 180 por 2.000 conversaciones al mes, flujo mixto
(reservas con 7 agendas + sena de 50 Bs por QR con cotejo del comprobante),
consola operada por NovuChat.

Unidad de cobro vigente (CLAUDE.md §2, Analisis/27): una conversacion es un
bloque de hasta 25 respuestas del asistente a un telefono en la ventana de
24 h; la respuesta 26 factura otra.

Tarifas: las de 14-modelo-costos.py (Meta desde el 01/10/2026). Impuestos 16 %.
Correr: python3 Analisis/30-platinum-modelo.py
"""
import importlib.util, os
_r = os.path.join(os.path.dirname(os.path.abspath(__file__)), '14-modelo-costos.py')
_s = importlib.util.spec_from_file_location('m14', _r); m14 = importlib.util.module_from_spec(_s); _s.loader.exec_module(m14)

SERVICIO, UTILIDAD, GRATIS = m14.SERVICIO, m14.UTILIDAD, m14.GRATIS_SERVICIO
IMP = 0.16
PRECIO, INCLUIDAS = 180.0, 2000
NETO = PRECIO * (1 - IMP)
CITAS_PAGADAS = 0.40      # conversaciones que terminan en cita con sena (supuesto)
OCR_USD = 0.0005          # lectura de una imagen/PDF con Gemini flash: ~260 tokens de entrada
CORP = (90.0, 500)        # plan de lista mas grande
BOLSA = 10.0 / 30

def costo_conv(msj):
    """Costo variable de UNA conversacion fuera de la franquicia."""
    meta = msj * SERVICIO
    modelo = m14.modelo_usd(min(msj, 30))
    # por cita pagada: recordatorio (utilidad) + aviso a recepcion con el comprobante (servicio) + OCR
    por_cita = CITAS_PAGADAS * (UTILIDAD + SERVICIO + OCR_USD)
    return meta + modelo + por_cita, meta + por_cita * 0  # (total, solo meta)

def mes(n, msj):
    total_msj = n * msj
    meta = max(0.0, total_msj - GRATIS) * SERVICIO
    modelo = n * m14.modelo_usd(min(msj, 30))
    por_cita = n * CITAS_PAGADAS * (UTILIDAD + SERVICIO + OCR_USD)
    return meta + modelo + por_cita, meta

def lista(n):
    """Lo que pagaria por lista: Corporativo + bolsas de 30."""
    exceso = max(0, n - CORP[1])
    import math
    return CORP[0] + math.ceil(exceso / 30) * 10

if __name__ == '__main__':
    print(f'Oferta: USD {PRECIO:.0f} por {INCLUIDAS} conv = {PRECIO/INCLUIDAS:.3f} USD/conv; neto de impuestos {NETO:.2f}')
    print(f'Referencias: Corporativo {CORP[0]/CORP[1]:.3f}/conv; bolsa {BOLSA:.3f}; minimo bolsa (bloque lleno) 0,3632; bloque lleno cuesta 0,305')
    print()
    print('1. COSTO DE UNA CONVERSACION fuera de la franquicia, segun mensajes del asistente')
    print(f'   {"msj":>4} {"costo":>7} {"ingreso 0,09":>13} {"margen":>8}')
    for msj in (8, 10, 13, 16, 20, 25):
        c, _ = costo_conv(msj)
        print(f'   {msj:>4} {c:>7.3f} {PRECIO/INCLUIDAS*(1-IMP):>13.3f} {PRECIO/INCLUIDAS*(1-IMP)-c:>+8.3f}')
    print()
    print('2. EL MES, segun cuantas conversaciones use la clinica y cuantos mensajes tenga cada una')
    print(f'   {"conv":>5} | ' + ' | '.join(f'{m} msj: costo  margen  %' for m in (10, 13, 16)) + ' | lista USD')
    for n in (300, 500, 800, 1000, 1250, 1500, 2000):
        fila = []
        for msj in (10, 13, 16):
            c, _ = mes(n, msj)
            fila.append(f'{c:>12.1f} {NETO-c:>+7.1f} {100*(NETO-c)/NETO:>3.0f}%')
        print(f'   {n:>5} | ' + ' | '.join(fila) + f' | {lista(n):>6.0f}')
    print()
    print('3. PUNTO DE EQUILIBRIO (conversaciones al mes a partir de las cuales se pierde)')
    for msj in (10, 13, 16, 25):
        n = 0
        while mes(n + 1, msj)[0] < NETO and n < 20000: n += 1
        print(f'   {msj:>3} msj/conv: {n:>5} conversaciones')
    print()
    print('4. ALTERNATIVAS con el mismo precio USD 180')
    for inc in (600, 800, 1000, 1250, 2000):
        print(f'   USD 180 por {inc:>5}: {PRECIO/inc:.3f} USD/conv; a plena carga con 13 msj margen {NETO-mes(inc,13)[0]:>+7.1f} ({100*(NETO-mes(inc,13)[0])/NETO:.0f} %)')
    print()
    print('5. Que pesa cada renglon a plena carga (2.000 conv, 13 msj)')
    n, msj = 2000, 13
    meta = max(0, n*msj-GRATIS)*SERVICIO; modelo = n*m14.modelo_usd(msj)
    rec = n*CITAS_PAGADAS*UTILIDAD; aviso = n*CITAS_PAGADAS*SERVICIO; ocr = n*CITAS_PAGADAS*OCR_USD
    for k, v in (('Meta servicio', meta), ('Modelo IA', modelo), ('Recordatorios', rec), ('Avisos a recepcion (comprobante)', aviso), ('OCR', ocr)):
        print(f'   {k:34} {v:>7.2f}')
    print(f'   {"TOTAL":34} {meta+modelo+rec+aviso+ocr:>7.2f}   ingreso neto {NETO:.2f}')
