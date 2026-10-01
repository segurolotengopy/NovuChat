# -*- coding: utf-8 -*-
"""Bellido desde noviembre y Q'Taco reducido: lo que queda por decidir, en dolares.

Acompana a `Analisis/47-bellido-y-qtaco-decisiones-abiertas.md` (01/10/2026).
Autocontenido: las cifras de Gemini son las medidas en `Analisis/43` §8 (PR #274)
y las de los flujos con agente, las de `Analisis/43` §2.

Correr: python3 Analisis/47-modelo-bellido-qtaco.py
"""

SERVICIO = UTILIDAD = 0.0113   # Meta, USD por mensaje (Resto de Latinoamerica, 01/10/2026)
MARKETING = 0.0740             # si Meta recategoriza una plantilla
GRATIS = 1000                  # mensajes de servicio gratis por numero y mes
IMPUESTOS = 0.16               # IVA 13 % + IT 3 %
FIJO_PRORRATEADO = 21.82 / 10  # fijo de plataforma (43 §5) entre 10 comercios
CHIP = 1.50                    # supuesto
TCO = 12.60                    # Bs por USD (base comercial §3; se cobra al TCO del dia)


def mes(precio, conv, resp_por_conv, gemini_conv, plantillas_por_conv=0.0,
        plantilla_usd=UTILIDAD):
    msj = conv * resp_por_conv
    d = {
        'Impuestos': precio * IMPUESTOS,
        'Meta serv.': max(0, msj - GRATIS) * SERVICIO,
        'Meta plant.': conv * plantillas_por_conv * plantilla_usd,
        'Gemini': conv * gemini_conv,
        'Chip+fijo': CHIP + FIJO_PRORRATEADO,
    }
    return d, precio - sum(d.values())


def linea(nombre, precio, d, margen):
    partes = '  '.join(f'{k} {v:5.2f}' for k, v in d.items())
    print(f'   {nombre:50} {partes}  | margen {margen:6.2f} USD ({100 * margen / precio:5.1f} %)')


if __name__ == '__main__':
    # ---------------- BELLIDO: Impulso 25/100, Agenda minima ----------------
    G_AM = 0.0015          # 43 §8: 2 extracciones + 1 redaccion, Flash-Lite
    CITA = 0.40            # conversaciones que terminan en cita (aviso al doctor por plantilla)
    print('=' * 120)
    print('1. BELLIDO desde noviembre: Impulso USD 25 por 100 conversaciones (decidido el 01/10)')
    print('=' * 120)
    for uso in (0.5, 1.0):
        conv = 100 * uso
        d, m = mes(25, conv, 5, G_AM, CITA)
        linea(f'{int(conv)} conv, sin recordatorio', 25, d, m)
        d, m = mes(25, conv, 5, G_AM, 2 * CITA)
        linea(f'{int(conv)} conv, con recordatorio 24 h', 25, d, m)
        d, m = mes(25, conv, 5, G_AM, 2 * CITA, MARKETING)
        linea(f'{int(conv)} conv, plantillas recategorizadas a Marketing', 25, d, m)
    print(f'   Mensajes de servicio al 100 %: {100 * 5} de {GRATIS} gratis -> Meta servicio = 0')
    print(f'   Con 5 respuestas por conversacion caben {GRATIS // 5} conversaciones en la franquicia')
    print(f'   Una consulta de 250 Bs = {250 / TCO:.1f} USD; una inasistencia evitada paga '
          f'{250 / TCO / (CITA * 100 * UTILIDAD):.0f} meses de recordatorios al 100 %')
    for n in (0, 1, 2, 4):
        print(f'   Cambios incluidos {n}: a USD 15 de referencia = {15 * n:3d} USD = '
              f'{100 * 15 * n / 25:4.0f} % del precio')

    # ---------------- Q'TACO: pedidos con el Demo B (agente) ----------------
    G_B = 0.0067           # 43 §2.3: Demo B con cache (0,0125 sin cache)
    print('\n' + '=' * 120)
    print("2. Q'TACO reducido (Demo B, flujo con agente, 10 respuestas por conversacion)")
    print('=' * 120)
    casos = [
        ("(c) Demo B tal cual, propuesta 40/200", 40, 200, 10, G_B, 0),
        ("(c) Demo B tal cual, lista Crecimiento 50/220", 50, 220, 10, G_B, 0),
        ("(b) + cobro real: QR y comprobante (+2 resp)", 50, 220, 12, G_B + 0.0005, 0),
        ("(a) + mesas y avisos por plantilla", 50, 220, 10, G_B, 0.5),
    ]
    for nombre, precio, inc, rpc, g, pl in casos:
        for uso in (0.6, 1.0):
            d, m = mes(precio, inc * uso, rpc, g, pl)
            linea(f'{nombre} [{int(uso * 100)} %]', precio, d, m)
