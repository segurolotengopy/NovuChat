#!/usr/bin/env python3
"""Genera los recursos del demo NovuChat:
1) calendario-demo-relleno.ics — eventos de relleno para el calendario del Demo A
2) qr-demo.png — QR con estructura EMVCo y datos de COMERCIO_DEMO, rotulado como simulacro
Zona horaria: America/La_Paz (UTC-4 fijo). Demos: 9 y 10 de septiembre de 2026.

POR QUE ESTE GENERADOR SI SE CONSERVA (y build_flows.py no)
-----------------------------------------------------------
Los flujos de n8n se editan en la interfaz y se exportan: un generador para
ellos seria una segunda fuente de verdad que solo puede divergir, y de hecho
divergio (ver Flujos/LEEME-flujos.md §0). Aca es al reves: el .ics y el .png
son artefactos DERIVADOS que nadie edita a mano en otra herramienta, asi que
este script es su fuente legitima y volver a correrlo es reproducible.

DOS CUIDADOS, DE TODAS FORMAS
-----------------------------
1. Sobrescribe qr-demo.png y calendario-demo-relleno.ics en su mismo
   directorio. Si alguien retoco esos archivos por fuera, se pierde. Use
   NOVUCHAT_OUT=/otra/ruta para generar sin pisar nada.
2. El rotulo de simulacro del QR se dibuja aca. Es lo que sostiene la
   prohibicion 3 de CLAUDE.md (nunca presentar un cobro simulado como real).
   No lo quite ni lo achique.
"""
import os
from datetime import datetime, timedelta

OUT = os.environ.get("NOVUCHAT_OUT", os.path.dirname(os.path.abspath(__file__)))
os.makedirs(OUT, exist_ok=True)

# ----------------------------------------------------------------------
# 1. Calendario de relleno (.ics)
# ----------------------------------------------------------------------
# Estrategia (plan 03 §1): ocupar franjas para que el agente proponga
# alternativas REALES y se vea la consulta al calendario en vivo.
# Horario de atención del demo: 09:00–19:00 (coincide con Config del negocio).
#
# - Días de ensayo (1–8 sep) y de demo (9–10 sep), lunes a sábado:
#   * Mañana casi llena: libres solo 10:00 y 11:30 (para el caso "mañana en
#     la mañana" del guion de Salud quedan pocas y concretas).
#   * Tarde: ocupadas 14:00–15:00 y 16:00–17:00 → libres 15:00, 17:00 y 18:00
#     (el agente puede ofrecer 3 opciones exactas de tarde).
# UTC = La Paz + 4 h.

def evento(uid, inicio_local, fin_local, titulo):
    """inicio/fin_local: datetime en hora de Bolivia; se emite en UTC (Z)."""
    fmt = "%Y%m%dT%H%M%SZ"
    ini = (inicio_local + timedelta(hours=4)).strftime(fmt)
    fin = (fin_local + timedelta(hours=4)).strftime(fmt)
    ahora = datetime(2026, 8, 28, 16, 0).strftime(fmt)
    return (
        "BEGIN:VEVENT\r\n"
        f"UID:{uid}@novuchat-demo\r\n"
        f"DTSTAMP:{ahora}\r\n"
        f"DTSTART:{ini}\r\n"
        f"DTEND:{fin}\r\n"
        f"SUMMARY:{titulo}\r\n"
        "DESCRIPTION:Evento de relleno del demo NovuChat. Franja OCUPADA a propósito.\r\n"
        "END:VEVENT\r\n"
    )

NOMBRES = [
    "Cita María F. — Manicure", "Cita Jorge R. — Corte", "Cita Ana P. — Limpieza facial",
    "Cita Luis M. — Odontología General", "Cita Carla T. — Ortodoncia (control)",
    "Cita Pedro S. — Pedicure", "Cita Rosa V. — Evaluación", "Cita Diego A. — Corte",
]

eventos = []
n = 0
dia = datetime(2026, 9, 1)
while dia <= datetime(2026, 9, 12):
    if dia.weekday() != 6:  # domingo cerrado
        # Mañana: 09:00-10:00, 11:00-11:30 libres a medias → ocupamos
        # 09:00-10:00, 10:30-11:30, 12:00-13:00  ⇒ libres 10:00-10:30, 11:30-12:00, 13:00-14:00
        franjas = [
            (9, 0, 10, 0), (10, 30, 11, 30), (12, 0, 13, 0),
            # Tarde: ocupadas 14:00-15:00 y 16:00-17:00 ⇒ libres 15:00-16:00, 17:00-18:00, 18:00-19:00
            (14, 0, 15, 0), (16, 0, 17, 0),
        ]
        for (h1, m1, h2, m2) in franjas:
            ini = dia.replace(hour=h1, minute=m1)
            fin = dia.replace(hour=h2, minute=m2)
            eventos.append(evento(f"relleno-{n:03d}", ini, fin, NOMBRES[n % len(NOMBRES)]))
            n += 1
    dia += timedelta(days=1)

ics = (
    "BEGIN:VCALENDAR\r\n"
    "VERSION:2.0\r\n"
    "PRODID:-//NovuChat//Relleno Demo A//ES\r\n"
    "CALSCALE:GREGORIAN\r\n"
    "METHOD:PUBLISH\r\n"
    "X-WR-CALNAME:NovuChat Demo A\r\n"
    "X-WR-TIMEZONE:America/La_Paz\r\n"
    + "".join(eventos) +
    "END:VCALENDAR\r\n"
)
with open(os.path.join(OUT, "calendario-demo-relleno.ics"), "w", encoding="utf-8") as f:
    f.write(ics)
print(f"OK calendario-demo-relleno.ics: {n} eventos (1–12 sep, sin domingos)")

# ----------------------------------------------------------------------
# 2. QR DEMO (estructura EMVCo con datos de relleno + rótulo impreso)
# ----------------------------------------------------------------------
# TLV EMVCo MPM. Datos de comercio FICTICIOS (COMERCIO_DEMO): una app
# bancaria real lo rechaza — a propósito (criterio C-12 / lección docs/16).

def tlv(tag, valor):
    return f"{tag}{len(valor):02d}{valor}"

def crc16_ccitt(data: bytes) -> int:
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
            crc &= 0xFFFF
    return crc

payload = (
    tlv("00", "01")                       # Payload Format Indicator
    + tlv("01", "11")                     # Point of Initiation: estático
    + tlv("26", tlv("00", "bo.demo.novuchat") + tlv("01", "COMERCIO_DEMO_000000"))
    + tlv("52", "5814")                   # MCC: restaurante
    + tlv("53", "068")                    # Moneda: BOB (068)
    + tlv("58", "BO")
    + tlv("59", "COMERCIO DEMO")
    + tlv("60", "LA PAZ")
    + tlv("62", tlv("05", "NOVUCHAT-DEMO"))
)
payload += "6304"
payload += f"{crc16_ccitt(payload.encode('ascii')):04X}"

import qrcode
from PIL import Image, ImageDraw, ImageFont

qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=10, border=2)
qr.add_data(payload)
qr.make(fit=True)
img_qr = qr.make_image(fill_color="black", back_color="white").convert("RGB")

W = 720
qr_size = 520
img_qr = img_qr.resize((qr_size, qr_size), Image.NEAREST)
BANDA = 86
H = BANDA + 40 + qr_size + 36 + BANDA
canvas = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(canvas)

f_bold = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 34)
f_med = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
f_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)

def centrado(y, texto, fuente, color):
    w = draw.textlength(texto, font=fuente)
    draw.text(((W - w) / 2, y), texto, font=fuente, fill=color)

# Banda superior roja
draw.rectangle([0, 0, W, BANDA], fill=(198, 40, 40))
centrado(10, "DEMOSTRACIÓN", f_bold, "white")
centrado(52, "ESTE QR NO COBRA", f_med, "white")

# Título y QR
centrado(BANDA + 8, "COMERCIO DEMO — NovuChat", f_small, (60, 60, 60))
canvas.paste(img_qr, ((W - qr_size) // 2, BANDA + 40))

# Pie
centrado(BANDA + 40 + qr_size + 6, "Datos de comercio ficticios · una app bancaria real lo rechaza", f_small, (110, 110, 110))

# Banda inferior roja
draw.rectangle([0, H - BANDA, W, H], fill=(198, 40, 40))
centrado(H - BANDA + 10, "SIMULACRO DE PAGO", f_bold, "white")
centrado(H - BANDA + 52, "NovuChat · demo comercial", f_med, "white")

canvas.save(os.path.join(OUT, "qr-demo.png"))
print(f"OK qr-demo.png ({W}x{H}) — payload EMVCo de {len(payload)} caracteres, CRC verificado")
