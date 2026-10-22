// Registra en bitacora_acciones cada acción de ESCRITURA del personal (y los
// intentos de entrada): quién, cuándo, qué ruta, con qué resultado, desde
// dónde. Nunca guarda PIN, contraseñas ni tokens (ver sanitizar).
// El registro se hace al terminar la respuesta y jamás la retrasa ni la rompe:
// si la bitácora fallara, el sistema sigue atendiendo y deja el error en el log.
const { query } = require('../db');
const { sanitizar, UUID } = require('../services/bitacora');

const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACCION_POR_METODO = { POST: 'crear', PUT: 'editar', PATCH: 'editar', DELETE: 'eliminar' };
const ID_EN_RUTA = /\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)(?=\/|$)/gi;

// /api/materias-primas/:id/ajustar-stock → { entidad: 'materias-primas', accion: 'ajustar-stock' }
function describirRuta(plantilla, metodo) {
  const partes = plantilla.split('/').filter(Boolean); // ['api','materias-primas',':id','ajustar-stock']
  const entidad = partes[1] || null;
  const fijas = partes.slice(2).filter(p => !p.startsWith(':'));
  return { entidad, accion: fijas.length ? fijas.join('/') : ACCION_POR_METODO[metodo] };
}

function filaDeBitacora(req, res, inicio) {
  const metodo = req.method;
  const plantilla = req.route ? `${req.baseUrl}${req.route.path === '/' ? '' : req.route.path}` : req.originalUrl.split('?')[0].replace(ID_EN_RUTA, '/:id');
  const esEntrada = plantilla === '/api/auth/login';
  const auth = req.auth?.tipo === 'staff' ? req.auth : null;
  // Clientes de la app pública no son "usuarios del sistema": solo personal y
  // los intentos de entrada (que aún no tienen sesión).
  if (!esEntrada && !auth) return null;
  const { entidad, accion } = describirRuta(plantilla, metodo);
  const idRuta = Object.values(req.params || {})[0];
  // En la entrada, quien entró lo deja la ruta de login (res.locals); un intento
  // fallido solo conserva el usuario que se haya elegido en pantalla.
  const actor = auth ? { id: auth.id, nombre: auth.nombre, rol: auth.rol, sucursalId: auth.sucursalId }
    : (res.locals.actorBitacora || null);
  const elegido = esEntrada && typeof req.body?.usuarioId === 'string' && UUID.test(req.body.usuarioId) ? req.body.usuarioId : null;
  const sedeBody = esEntrada && typeof req.body?.sucursalId === 'string' && UUID.test(req.body.sucursalId) ? req.body.sucursalId : null;
  return [
    actor?.id || elegido,
    actor?.nombre || null, actor?.rol || null,
    req.sucursalId || actor?.sucursalId || sedeBody || null,
    metodo, plantilla.slice(0, 200), entidad, idRuta ? String(idRuta).slice(0, 80) : null, accion,
    res.statusCode, req.ip || null, (req.get('user-agent') || '').slice(0, 200) || null,
    JSON.stringify({ cuerpo: sanitizar(req.body), consulta: sanitizar(req.query), duracionMs: Date.now() - inicio }),
  ];
}

function bitacoraAcciones({ queryFn = query, onError = err => console.error('No se pudo escribir la bitácora:', err.message) } = {}) {
  return function registrarAccion(req, res, next) {
    if (!METODOS.has(req.method)) return next();
    const inicio = Date.now();
    res.on('finish', () => {
      try {
        const fila = filaDeBitacora(req, res, inicio);
        if (!fila) return;
        // El usuario_id puede venir de un cuerpo no confiable (entrada): solo se guarda si existe.
        Promise.resolve(queryFn(
          `INSERT INTO bitacora_acciones (usuario_id, usuario_nombre, rol, sucursal_id, metodo, ruta, entidad, entidad_id, accion, estado_http, ip, agente, detalle)
           VALUES ((SELECT id FROM usuarios WHERE id = $1::uuid), $2,$3,(SELECT id FROM sucursales WHERE id = $4::uuid),$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`, fila)).catch(onError);
      } catch (err) { onError(err); }
    });
    next();
  };
}

module.exports = { bitacoraAcciones, describirRuta, filaDeBitacora };
