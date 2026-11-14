const { AppError } = require('./errors');

const CATEGORIAS = [
  'Alumbrado público',
  'Baches y calles',
  'Basura y limpieza',
  'Agua y drenaje',
  'Seguridad ciudadana',
  'Parques y áreas verdes',
  'Tránsito y señalización',
  'Ruido y contaminación',
  'Otro',
];

const ESTADOS = ['Recibido', 'En revisión', 'En atención', 'Resuelto', 'Rechazado'];
const PRIORIDADES = ['Baja', 'Media', 'Alta', 'Crítica'];
const AREAS = [
  'Servicios Públicos (alumbrado)',
  'Obras Públicas e Infraestructura Vial',
  'Limpieza y Manejo de Desechos',
  'Agua Potable y Drenajes',
  'Policía Municipal',
  'Parques y Áreas Verdes',
  'Policía Municipal de Tránsito',
  'Medio Ambiente',
  'Atención al Vecino',
];
// Área sugerida automáticamente según la categoría que elige el ciudadano (editable en el panel).
const AREA_POR_CATEGORIA = {
  'Alumbrado público': 'Servicios Públicos (alumbrado)',
  'Baches y calles': 'Obras Públicas e Infraestructura Vial',
  'Basura y limpieza': 'Limpieza y Manejo de Desechos',
  'Agua y drenaje': 'Agua Potable y Drenajes',
  'Seguridad ciudadana': 'Policía Municipal',
  'Parques y áreas verdes': 'Parques y Áreas Verdes',
  'Tránsito y señalización': 'Policía Municipal de Tránsito',
  'Ruido y contaminación': 'Medio Ambiente',
  Otro: 'Atención al Vecino',
};

const FOTO_MAX_BYTES = 700 * 1024; // límite por documento de Firestore (1 MiB con base64)
const MIME_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'];

const limpiar = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const limpiarMultilinea = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '');

/** Detecta el tipo real de la imagen por sus primeros bytes (no confiar en la extensión). */
function detectarMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function validarReporte(body = {}, archivo) {
  const errores = {};

  const nombre = limpiar(body.nombre);
  const correo = limpiar(body.correo).toLowerCase();
  const telefono = limpiar(body.telefono).replace(/[\s-]/g, '');
  const categoria = limpiar(body.categoria);
  const direccion = limpiar(body.direccion);
  const zona = limpiar(body.zona);
  const descripcion = limpiarMultilinea(body.descripcion);

  if (nombre.length < 3 || nombre.length > 80) errores.nombre = 'Ingresá tu nombre (3 a 80 caracteres).';
  else if (!/^[\p{L} .'-]+$/u.test(nombre)) errores.nombre = 'El nombre sólo puede contener letras y espacios.';

  if (!correo && !telefono) {
    errores.contacto = 'Ingresá al menos un medio de contacto: correo o teléfono.';
  }
  if (correo && (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo) || correo.length > 120)) {
    errores.correo = 'El correo electrónico no es válido.';
  }
  if (telefono && !/^\+?\d{8,12}$/.test(telefono)) {
    errores.telefono = 'El teléfono debe tener entre 8 y 12 dígitos.';
  }

  if (!CATEGORIAS.includes(categoria)) errores.categoria = 'Seleccioná una categoría válida.';

  if (direccion.length < 5 || direccion.length > 200) {
    errores.direccion = 'Indicá la dirección o referencia del lugar (5 a 200 caracteres).';
  }
  if (zona && !/^\d{1,2}$/.test(zona)) errores.zona = 'La zona debe ser un número (1-99).';

  if (descripcion.length < 20) errores.descripcion = 'Describí el problema con al menos 20 caracteres.';
  else if (descripcion.length > 2000) errores.descripcion = 'La descripción no puede superar 2000 caracteres.';

  let foto = null;
  if (!archivo || !archivo.buffer || archivo.buffer.length === 0) {
    errores.foto = 'Adjuntá una fotografía del problema.';
  } else {
    const mimeReal = detectarMime(archivo.buffer);
    if (!mimeReal || !MIME_PERMITIDOS.includes(mimeReal)) {
      errores.foto = 'La fotografía debe ser JPG, PNG o WEBP.';
    } else if (archivo.buffer.length > FOTO_MAX_BYTES) {
      errores.foto = `La fotografía no puede superar ${Math.round(FOTO_MAX_BYTES / 1024)} KB.`;
    } else {
      foto = { buffer: archivo.buffer, mime: mimeReal };
    }
  }

  if (Object.keys(errores).length) {
    throw new AppError(422, 'Revisá los datos del formulario.', errores);
  }

  return {
    datos: {
      ciudadano: { nombre, correo: correo || null, telefono: telefono || null },
      categoriaCiudadano: categoria,
      ubicacion: { direccion, zona: zona ? Number(zona) : null },
      descripcion,
    },
    foto,
  };
}

/** Gestión del reporte por el personal municipal: estado, prioridad, área y nota. */
function validarGestion(body = {}) {
  const estado = limpiar(body.estado);
  const prioridad = limpiar(body.prioridad);
  const area = limpiar(body.area);
  const nota = limpiarMultilinea(body.nota);
  const errores = {};
  if (!ESTADOS.includes(estado)) errores.estado = `Estado inválido. Valores: ${ESTADOS.join(', ')}.`;
  if (prioridad && !PRIORIDADES.includes(prioridad)) errores.prioridad = `Prioridad inválida. Valores: ${PRIORIDADES.join(', ')}.`;
  if (area && !AREAS.includes(area)) errores.area = 'Área de atención inválida.';
  if (nota.length > 500) errores.nota = 'La nota no puede superar 500 caracteres.';
  if (['Resuelto', 'Rechazado'].includes(estado) && nota.length < 5) {
    errores.nota = 'Para resolver o rechazar un reporte escribí una nota con el motivo.';
  }
  if (Object.keys(errores).length) throw new AppError(422, 'Datos inválidos.', errores);
  return { estado, prioridad: prioridad || null, area: area || null, nota };
}

const FOLIO_RE = /^Q-\d{8}-[A-Z0-9]{5}$/;
function validarFolio(folio) {
  if (!FOLIO_RE.test(folio || '')) throw new AppError(400, 'Folio con formato inválido.');
  return folio;
}

module.exports = {
  CATEGORIAS,
  ESTADOS,
  PRIORIDADES,
  AREAS,
  AREA_POR_CATEGORIA,
  FOTO_MAX_BYTES,
  validarReporte,
  validarGestion,
  validarFolio,
  detectarMime,
};
