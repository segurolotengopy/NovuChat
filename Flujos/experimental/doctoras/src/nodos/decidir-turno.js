// DECIDIR TURNO (esqueleto, PR-A): el CÓDIGO decide qué pasa en este turno. Aquí solo hay dos decisiones: la puerta cerró el turno (`nada`) o la persona mandó algo que este canal no lee (`otro`, texto cortés).
// Todo lo demás queda `pendiente` (sin respuesta) hasta el PR-B (conversación, consentimiento, baja y derivación). Mientras tanto el JSON no se publica.
const t = cnPrimero('Normalizar entrada') || {};
const puerta = cnPrimero('Puerta del turno') || {};
const from = String(t.from || '');
const salir = (plan) => [{ json: { plan: plan, from: from, textoCliente: '', llamarModelo: false, cuerpoModelo: null } }];
if (puerta.ruta !== 'sigue') return salir({ tipo: 'nada' });
if (t.categoria === 'otro') return salir({ tipo: 'otro' });
return salir({ tipo: 'pendiente' });
