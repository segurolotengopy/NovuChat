# -*- coding: utf-8 -*-
"""Q'Taco: seguir en Crecimiento (NovuChat pone el numero y paga Meta) o pasar a BYOC.

Acompana a `Analisis/48-qtaco-crecimiento-o-byoc.md` (04/10/2026). Autocontenido.
Tarifas y fijos: los de `Analisis/47`. Mezcla y mensajes: el diseno de
«Venta minima» de Q'Taco (CLIENTES/QTACO, no versionado), con el costo al
restaurante que Andres confirmo el 02/10 (5 mensajes por pedido, 4 por reserva).

Correr: python3 Analisis/48-modelo-qtaco-crecimiento-o-byoc.py
"""
import math

SERVICIO = UTILIDAD = 0.0113   # Meta, USD por mensaje (01/10/2026)
GRATIS = 1000                  # mensajes de servicio gratis por numero y mes
IMPUESTOS = 0.16               # IVA 13 % + IT 3 %
FIJO = 21.82 / 10              # fijo de plataforma (43 §5) entre 10 comercios
CHIP = 1.50                    # la linea que pone NovuChat (supuesto de 47)
GEMINI_CONV = 0.004            # Extraer por turno + comprobante + audio, Flash-Lite
BOLSA = (30, 10)               # 30 conversaciones por USD 10

# Mezcla supuesta (diseno): 60 % pedidos, 25 % reservas, 15 % consultas o derivaciones.
MEZCLA = {'pedido': 0.60, 'reserva': 0.25, 'consulta': 0.15}
AL_CLIENTE = {'pedido': 6.5, 'reserva': 4.5, 'consulta': 2.0}       # respuestas de servicio
AL_RESTAURANTE = {'pedido': 5.0, 'reserva': 4.0, 'consulta': 1.5}   # avisos (plantilla utility)

R_CLIENTE = sum(MEZCLA[k] * AL_CLIENTE[k] for k in MEZCLA)
R_REST = sum(MEZCLA[k] * AL_RESTAURANTE[k] for k in MEZCLA)


def meta_usd(conv):
    """Factura de Meta del numero en el mes, quien sea que la pague."""
    servicio = max(0.0, conv * R_CLIENTE - GRATIS) * SERVICIO
    avisos = conv * R_REST * UTILIDAD
    return servicio + avisos


def ingreso_con_bolsas(precio, incluidas, conv):
    """Plan prepago: lo que pasa de las incluidas se compra en bolsas de 30."""
    bolsas = max(0, math.ceil((conv - incluidas) / BOLSA[0]))
    return precio + bolsas * BOLSA[1], bolsas


def novuchat_paga_meta(precio, incluidas, conv):
    ingreso, bolsas = ingreso_con_bolsas(precio, incluidas, conv)
    costo = ingreso * IMPUESTOS + meta_usd(conv) + conv * GEMINI_CONV + FIJO + CHIP
    return ingreso, ingreso - costo, ingreso, bolsas      # cliente paga solo a NovuChat


def byoc(precio, incluidas, conv):
    ingreso, bolsas = ingreso_con_bolsas(precio, incluidas, conv)
    costo = ingreso * IMPUESTOS + conv * GEMINI_CONV + FIJO   # sin Meta ni chip
    return ingreso, ingreso - costo, ingreso + meta_usd(conv), bolsas


def precio_byoc_mismo_margen(conv, margen_objetivo):
    """Precio BYOC que deja a NovuChat el mismo margen en USD."""
    return (margen_objetivo + conv * GEMINI_CONV + FIJO) / (1 - IMPUESTOS)


if __name__ == '__main__':
    print(f'Mensajes por conversacion: {R_CLIENTE:.2f} al cliente + {R_REST:.2f} al restaurante'
          f' = {R_CLIENTE + R_REST:.2f}')
    print(f'Caben {GRATIS / R_CLIENTE:.0f} conversaciones en la franquicia de servicio\n')

    VOLS = (150, 225, 300, 400, 600, 1000)
    planes = [
        ('Crecimiento por contrato 40/220 (hoy)', novuchat_paga_meta, 40, 220),
        ('Crecimiento de lista 50/220', novuchat_paga_meta, 50, 220),
        ('Pro 90/500', novuchat_paga_meta, 90, 500),
        ('BYOC 50/2000 (Q\'Taco paga Meta)', byoc, 50, 2000),
        ('BYOC por contrato 45/500', byoc, 45, 500),
    ]
    print(f'{"conv/mes":>8} {"Meta":>6} | ' + ' | '.join(f'{n[:30]:>30}' for n, *_ in planes))
    print(f'{"":>8} {"":>6} | ' + ' | '.join(f'{"cobra  margen  Q paga":>30}' for _ in planes))
    for conv in VOLS:
        celdas = []
        for _, f, p, inc in planes:
            ing, mg, total_cliente, bolsas = f(p, inc, conv)
            celdas.append(f'{ing:6.0f} {mg:6.1f} ({100 * mg / ing:3.0f}%) {total_cliente:6.0f}')
        print(f'{conv:>8} {meta_usd(conv):6.1f} | ' + ' | '.join(f'{c:>30}' for c in celdas))

    print('\nPrecio BYOC que iguala el margen de hoy (Crecimiento 40/220 con bolsas):')
    for conv in VOLS:
        _, mg, total_hoy, _ = novuchat_paga_meta(40, 220, conv)
        p = precio_byoc_mismo_margen(conv, mg)
        print(f'  {conv:5d} conv: margen hoy {mg:6.1f} USD -> BYOC a {p:6.1f} USD'
              f' (Q\'Taco pagaria {p + meta_usd(conv):6.1f} con Meta; hoy paga {total_hoy:6.0f})')
