/**
 * Autenticación del panel municipal.
 * - Credenciales en variables de entorno (nunca en el código ni en el frontend).
 * - Token firmado con HMAC-SHA256 y fecha de expiración.
 * - Comparaciones en tiempo constante y bloqueo temporal por intentos fallidos.
 */
const crypto = require('crypto');
const { AppError } = require('../errors');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function igualSeguro(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function crearAuth(cfg) {
  const intentos = new Map(); // ip -> { fallos, bloqueadoHasta }

  function firmar(payload) {
    const cuerpo = b64url(JSON.stringify(payload));
    const firma = b64url(crypto.createHmac('sha256', cfg.secret).update(cuerpo).digest());
    return `${cuerpo}.${firma}`;
  }

  function verificar(token) {
    const [cuerpo, firma] = String(token || '').split('.');
    if (!cuerpo || !firma) return null;
    const esperada = b64url(crypto.createHmac('sha256', cfg.secret).update(cuerpo).digest());
    if (!igualSeguro(firma, esperada)) return null;
    try {
      const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
      if (!payload.exp || Date.now() > payload.exp) return null;
      return payload;
    } catch {
      return null;
    }
  }

  return {
    configurado: Boolean(cfg.user && cfg.password && cfg.secret && cfg.secret.length >= 16),

    login(usuario, clave, ip) {
      if (!this.configurado) {
        throw new AppError(503, 'El acceso administrativo no está configurado en el servidor (.env).');
      }
      const reg = intentos.get(ip) || { fallos: 0, bloqueadoHasta: 0 };
      if (reg.bloqueadoHasta > Date.now()) {
        throw new AppError(429, 'Demasiados intentos fallidos. Esperá unos minutos.');
      }
      if (typeof usuario !== 'string' || typeof clave !== 'string' || !usuario || !clave) {
        throw new AppError(422, 'Ingresá usuario y contraseña.');
      }
      const ok = igualSeguro(usuario, cfg.user) & igualSeguro(clave, cfg.password);
      if (!ok) {
        reg.fallos += 1;
        if (reg.fallos >= 5) {
          reg.fallos = 0;
          reg.bloqueadoHasta = Date.now() + 5 * 60 * 1000;
        }
        intentos.set(ip, reg);
        throw new AppError(401, 'Usuario o contraseña incorrectos.');
      }
      intentos.delete(ip);
      const exp = Date.now() + cfg.ttlMin * 60 * 1000;
      return { token: firmar({ sub: usuario, rol: 'municipal', exp }), expira: new Date(exp).toISOString(), usuario };
    },

    requerir(req, _res, next) {
      const h = req.headers.authorization || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : null;
      const payload = token && verificar(token);
      if (!payload) return next(new AppError(401, 'Sesión inválida o expirada. Iniciá sesión nuevamente.'));
      req.usuario = payload;
      next();
    },
  };
}

module.exports = { crearAuth };
