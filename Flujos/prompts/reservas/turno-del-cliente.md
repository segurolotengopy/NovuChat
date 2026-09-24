=[CONTEXTO DEL SISTEMA]
Ahora: {{ $now.setZone('America/La_Paz').setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm") }} (Bolivia, UTC-4). Cliente: {{ $json.nombrePerfil || 'sin nombre' }} · {{ $json.from }}.{{ typeof $json.mensajesRestantes24h === 'number' && $json.mensajesRestantes24h <= 3 ? '\nQuedan ' + $json.mensajesRestantes24h + ' respuestas en esta conversación: resuelve lo esencial ahora y, si algo queda pendiente, indica cómo seguir con el negocio.' : '' }}{{ $json.senaAFavor === 'si' ? '\nTiene a favor el adelanto de una cita cancelada: si agenda, NO pidas seña ni QR; su adelanto se aplica.' : '' }}{{ $json.diasProximos }}
[MENSAJE DEL CLIENTE]
{{ $json.userInput }}
