/**
 * Repositorio en memoria con la MISMA interfaz que firestoreRepo.
 * Se usa únicamente en las pruebas automatizadas (npm test); la aplicación real
 * siempre persiste en Firebase (ver src/server.js).
 */
function crearMemoryRepo() {
  const reportes = new Map();
  const fotos = new Map();
  const clon = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

  return {
    async crear(reporte, foto) {
      if (reportes.has(reporte.folio)) throw new Error('Folio duplicado');
      reportes.set(reporte.folio, clon(reporte));
      if (foto) fotos.set(reporte.folio, { mime: foto.mime, buffer: Buffer.from(foto.buffer) });
      return reporte;
    },
    async existe(folio) {
      return reportes.has(folio);
    },
    async actualizar(folio, cambios) {
      const actual = reportes.get(folio);
      if (!actual) throw new Error('No existe');
      reportes.set(folio, { ...actual, ...clon(cambios) });
      return clon(reportes.get(folio));
    },
    async obtener(folio) {
      return clon(reportes.get(folio));
    },
    async listar() {
      return [...reportes.values()]
        .map(clon)
        .sort((a, b) => b.fechaCreacion.localeCompare(a.fechaCreacion));
    },
    async obtenerFoto(folio) {
      return fotos.get(folio) || null;
    },
    async ping() {
      return true;
    },
  };
}

module.exports = { crearMemoryRepo };
