/**
 * Repositorio de reportes sobre Cloud Firestore (Firebase, plan gratuito Spark).
 *
 * Estructura de datos:
 *   reportes/{folio}  -> datos del ciudadano, ubicación, descripción, estado, prioridad e historial
 *   fotos/{folio}     -> { mime, tamano, data (base64) }
 *
 * La foto va en una colección aparte para que el listado del panel no descargue imágenes
 * y porque Firebase Storage ya no forma parte del plan gratuito para proyectos nuevos.
 * Un documento de Firestore admite hasta 1 MiB, por eso el backend limita la foto a 700 KB.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

/**
 * Lee el JSON de la cuenta de servicio desde una variable de entorno. Tolera los formatos que
 * producen los paneles de hosting: comillas envolventes y saltos de línea reales o escapados
 * dentro de la clave privada.
 */
function parsearJsonCredenciales(texto) {
  let raw = String(texto).trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"') && !raw.startsWith('"{'))) {
    raw = raw.slice(1, -1).trim();
  }
  if (raw.startsWith('"{')) raw = JSON.parse(raw); // JSON serializado como string
  let k;
  try {
    k = JSON.parse(raw);
  } catch {
    // saltos de línea reales dentro de "private_key" no son JSON válido: se escapan
    k = JSON.parse(raw.replace(/\r?\n/g, '\\n'));
  }
  if (typeof k.private_key === 'string') k.private_key = k.private_key.replace(/\\n/g, '\n');
  return k;
}

function cargarCredenciales(cfg) {
  if (cfg.serviceAccountJson) {
    try {
      return parsearJsonCredenciales(cfg.serviceAccountJson);
    } catch (e) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON no es un JSON válido (${e.message})`);
    }
  }
  if (cfg.serviceAccountPath) {
    const ruta = path.resolve(cfg.serviceAccountPath);
    if (!fs.existsSync(ruta)) {
      throw new Error(`No se encontró el archivo de credenciales de Firebase: ${ruta}`);
    }
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  }
  throw new Error('Configurá FIREBASE_SERVICE_ACCOUNT_PATH o FIREBASE_SERVICE_ACCOUNT_JSON en el .env');
}

function crearFirestoreRepo(cfg) {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(cargarCredenciales(cfg)) });
  }
  const db = admin.firestore();
  const reportes = db.collection('reportes');
  const fotos = db.collection('fotos');

  return {
    async crear(reporte, foto) {
      const batch = db.batch();
      batch.create(reportes.doc(reporte.folio), reporte);
      if (foto) {
        batch.create(fotos.doc(reporte.folio), {
          mime: foto.mime,
          tamano: foto.buffer.length,
          data: foto.buffer.toString('base64'),
        });
      }
      await batch.commit();
      return reporte;
    },

    async existe(folio) {
      return (await reportes.doc(folio).get()).exists;
    },

    async actualizar(folio, cambios) {
      await reportes.doc(folio).update(cambios);
      return this.obtener(folio);
    },

    async obtener(folio) {
      const snap = await reportes.doc(folio).get();
      return snap.exists ? snap.data() : null;
    },

    async listar(limite = 500) {
      const snap = await reportes.orderBy('fechaCreacion', 'desc').limit(limite).get();
      return snap.docs.map((d) => d.data());
    },

    async obtenerFoto(folio) {
      const snap = await fotos.doc(folio).get();
      if (!snap.exists) return null;
      const { mime, data } = snap.data();
      return { mime, buffer: Buffer.from(data, 'base64') };
    },

    async ping() {
      await reportes.limit(1).get();
      return true;
    },
  };
}

module.exports = { crearFirestoreRepo };
