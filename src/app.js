/**
 * API REST del sistema de quejas ciudadanas.
 * createApp recibe sus dependencias (repositorio y auth) para poder probarse sin tocar Firebase.
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { AppError } = require('./errors');
const {
  CATEGORIAS,
  ESTADOS,
  PRIORIDADES,
  AREAS,
  AREA_POR_CATEGORIA,
  FOTO_MAX_BYTES,
  validarReporte,
  validarGestion,
  validarFolio,
} = require('./validation');

const CERRADOS = ['Resuelto', 'Rechazado'];

function generarFolio() {
  const d = new Date();
  const fecha = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const rnd = [...crypto.randomBytes(5)].map((b) => alfabeto[b % alfabeto.length]).join('');
  return `Q-${fecha}-${rnd}`;
}

/** Limitador simple por IP (ventana fija) para evitar spam de reportes. */
function limitador(max, ventanaMs) {
  const hits = new Map();
  return (req, _res, next) => {
    const ahora = Date.now();
    const r = hits.get(req.ip) || { n: 0, desde: ahora };
    if (ahora - r.desde > ventanaMs) {
      r.n = 0;
      r.desde = ahora;
    }
    r.n += 1;
    hits.set(req.ip, r);
    if (r.n > max) return next(new AppError(429, 'Enviaste demasiados reportes seguidos. Intentá de nuevo en un minuto.'));
    next();
  };
}

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function calcularIndicadores(lista) {
  const contar = (fn) =>
    lista.reduce((acc, r) => {
      const k = fn(r) || 'Sin dato';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  const hoy = new Date().toISOString().slice(0, 10);
  return {
    total: lista.length,
    abiertos: lista.filter((r) => !CERRADOS.includes(r.estado)).length,
    nuevos: lista.filter((r) => r.estado === 'Recibido').length,
    hoy: lista.filter((r) => r.fechaCreacion.slice(0, 10) === hoy).length,
    criticosAbiertos: lista.filter((r) => r.prioridad === 'Crítica' && !CERRADOS.includes(r.estado)).length,
    sinPrioridad: lista.filter((r) => !r.prioridad && !CERRADOS.includes(r.estado)).length,
    porPrioridad: contar((r) => r.prioridad || 'Sin asignar'),
    porEstado: contar((r) => r.estado),
    porCategoria: contar((r) => r.categoria),
    porZona: contar((r) => (r.ubicacion?.zona ? `Zona ${r.ubicacion.zona}` : 'Sin zona')),
  };
}

function filtrar(lista, q) {
  const texto = (q.q || '').toString().toLowerCase().trim();
  const desde = q.desde ? new Date(`${q.desde}T00:00:00`) : null;
  const hasta = q.hasta ? new Date(`${q.hasta}T23:59:59.999`) : null;
  if ((desde && isNaN(desde)) || (hasta && isNaN(hasta))) throw new AppError(400, 'Formato de fecha inválido (AAAA-MM-DD).');
  if (q.zona && !/^\d{1,2}$/.test(q.zona)) throw new AppError(400, 'La zona debe ser un número.');

  return lista.filter((r) => {
    if (q.estado === 'abiertos' ? CERRADOS.includes(r.estado) : q.estado && r.estado !== q.estado) return false;
    if (q.prioridad === 'Sin asignar' ? r.prioridad : q.prioridad && r.prioridad !== q.prioridad) return false;
    if (q.categoria && r.categoria !== q.categoria) return false;
    if (q.area && r.areaAtencion !== q.area) return false;
    if (q.zona && String(r.ubicacion?.zona ?? '') !== String(Number(q.zona))) return false;
    const f = new Date(r.fechaCreacion);
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    if (texto) {
      const blob = [r.folio, r.descripcion, r.categoria, r.ubicacion?.direccion, r.ciudadano?.nombre].join(' ').toLowerCase();
      if (!blob.includes(texto)) return false;
    }
    return true;
  });
}

const nivel = (p) => (p ? PRIORIDADES.indexOf(p) : -1);
const ORDEN = {
  // Críticas primero; las que aún no tienen prioridad van antes de las Bajas para que alguien las revise.
  prioridad: (a, b) => {
    const pa = a.prioridad ? nivel(a.prioridad) : 0.5;
    const pb = b.prioridad ? nivel(b.prioridad) : 0.5;
    return pb - pa || a.fechaCreacion.localeCompare(b.fechaCreacion);
  },
  recientes: (a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion),
  antiguos: (a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion),
};

/** Vista resumida para el listado (sin datos de contacto). */
function resumenLista(r) {
  return {
    folio: r.folio,
    fechaCreacion: r.fechaCreacion,
    fechaActualizacion: r.fechaActualizacion,
    estado: r.estado,
    categoria: r.categoria,
    ubicacion: r.ubicacion,
    descripcion: r.descripcion.length > 160 ? `${r.descripcion.slice(0, 160)}…` : r.descripcion,
    prioridad: r.prioridad,
    areaAtencion: r.areaAtencion,
  };
}

function createApp({ repo, auth, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '50kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 20 },
  });

  // ---------------- Público ----------------
  app.get('/api/salud', asyncH(async (_req, res) => {
    let firebase = false;
    try {
      firebase = await repo.ping();
    } catch {
      firebase = false;
    }
    res.status(firebase ? 200 : 503).json({ ok: firebase, firebase, adminConfigurado: auth.configurado });
  }));

  app.get('/api/catalogos', (_req, res) => {
    res.json({ categorias: CATEGORIAS, estados: ESTADOS, prioridades: PRIORIDADES, areas: AREAS, fotoMaxBytes: FOTO_MAX_BYTES });
  });

  app.post(
    '/api/reportes',
    limitador(10, 60 * 1000),
    upload.single('foto'),
    asyncH(async (req, res) => {
      const { datos, foto } = validarReporte(req.body, req.file);

      let folio = generarFolio();
      for (let i = 0; i < 3 && (await repo.existe(folio)); i++) folio = generarFolio();

      const ahora = new Date().toISOString();
      const reporte = {
        folio,
        ciudadano: datos.ciudadano,
        categoria: datos.categoriaCiudadano,
        ubicacion: datos.ubicacion,
        descripcion: datos.descripcion,
        fotoMime: foto.mime,
        fotoTamano: foto.buffer.length,
        estado: 'Recibido',
        prioridad: null, // la asigna el personal municipal
        areaAtencion: AREA_POR_CATEGORIA[datos.categoriaCiudadano] || 'Atención al Vecino',
        historial: [{ estado: 'Recibido', fecha: ahora, nota: 'Reporte registrado por el ciudadano', usuario: 'ciudadano' }],
        fechaCreacion: ahora,
        fechaActualizacion: ahora,
      };

      try {
        await repo.crear(reporte, foto);
      } catch (e) {
        logger.error(`[Firebase] No se pudo guardar ${folio}: ${e.message}`);
        throw new AppError(503, 'No pudimos guardar tu reporte en este momento. Intentá de nuevo en unos minutos.');
      }

      res.status(201).json({
        mensaje: 'Tu reporte fue registrado correctamente.',
        folio,
        fechaCreacion: ahora,
        estado: reporte.estado,
        categoria: reporte.categoria,
        areaAtencion: reporte.areaAtencion,
      });
    }),
  );

  // Seguimiento público por folio: sólo datos no sensibles.
  app.get('/api/reportes/:folio/seguimiento', asyncH(async (req, res) => {
    const r = await repo.obtener(validarFolio(req.params.folio));
    if (!r) throw new AppError(404, 'No existe un reporte con ese folio.');
    res.json({
      folio: r.folio,
      estado: r.estado,
      fechaCreacion: r.fechaCreacion,
      fechaActualizacion: r.fechaActualizacion,
      categoria: r.categoria,
      areaAtencion: r.areaAtencion,
      historial: (r.historial || []).map(({ estado, fecha, nota }) => ({ estado, fecha, nota })),
    });
  }));

  // ---------------- Autenticación ----------------
  app.post('/api/auth/login', asyncH(async (req, res) => {
    res.json(auth.login(req.body?.usuario, req.body?.clave, req.ip));
  }));

  // ---------------- Panel municipal (protegido) ----------------
  const admin = express.Router();
  admin.use((req, res, next) => auth.requerir(req, res, next));

  admin.get('/reportes', asyncH(async (req, res) => {
    const todos = await repo.listar();
    const filtrados = filtrar(todos, req.query).sort(ORDEN[req.query.orden] || ORDEN.prioridad);
    res.json({
      indicadores: calcularIndicadores(todos),
      totalFiltrado: filtrados.length,
      reportes: filtrados.map(resumenLista),
    });
  }));

  admin.get('/reportes/:folio', asyncH(async (req, res) => {
    const r = await repo.obtener(validarFolio(req.params.folio));
    if (!r) throw new AppError(404, 'Reporte no encontrado.');
    res.json(r);
  }));

  admin.get('/reportes/:folio/foto', asyncH(async (req, res) => {
    const foto = await repo.obtenerFoto(validarFolio(req.params.folio));
    if (!foto) throw new AppError(404, 'El reporte no tiene fotografía.');
    res.set('Content-Type', foto.mime);
    res.set('Cache-Control', 'private, max-age=300');
    res.send(foto.buffer);
  }));

  admin.patch('/reportes/:folio', asyncH(async (req, res) => {
    const folio = validarFolio(req.params.folio);
    const g = validarGestion(req.body);
    const r = await repo.obtener(folio);
    if (!r) throw new AppError(404, 'Reporte no encontrado.');

    const cambios = [];
    if (g.estado !== r.estado) cambios.push(`estado: ${r.estado} → ${g.estado}`);
    if (g.prioridad && g.prioridad !== r.prioridad) cambios.push(`prioridad: ${r.prioridad || 'sin asignar'} → ${g.prioridad}`);
    if (g.area && g.area !== r.areaAtencion) cambios.push(`área: ${g.area}`);
    if (!cambios.length && !g.nota) throw new AppError(422, 'No hay cambios que guardar.');

    const ahora = new Date().toISOString();
    const historial = [
      ...(r.historial || []),
      { estado: g.estado, fecha: ahora, nota: [cambios.join('; '), g.nota].filter(Boolean).join(' — '), usuario: req.usuario.sub },
    ];
    res.json(
      await repo.actualizar(folio, {
        estado: g.estado,
        prioridad: g.prioridad || r.prioridad,
        areaAtencion: g.area || r.areaAtencion,
        historial,
        fechaActualizacion: ahora,
      }),
    );
  }));

  app.use('/api/admin', admin);

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'Ruta no encontrada.')));

  // ---------------- Manejo centralizado de errores ----------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: err.message, detalles: err.detalles });
    }
    if (err instanceof multer.MulterError) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'La fotografía es demasiado grande (máx. 5 MB antes de comprimir).' : 'Archivo inválido: sólo se permite una fotografía en el campo "foto".';
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg, detalles: { foto: msg } });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Solicitud demasiado grande.' });
    logger.error(err);
    res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
  });

  return app;
}

module.exports = { createApp, generarFolio, calcularIndicadores, filtrar };
