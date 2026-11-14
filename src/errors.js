class AppError extends Error {
  /**
   * @param {number} status   Código HTTP
   * @param {string} message  Mensaje legible para el usuario
   * @param {object} [detalles] Errores por campo, p. ej. { descripcion: 'Muy corta' }
   */
  constructor(status, message, detalles) {
    super(message);
    this.status = status;
    this.detalles = detalles;
  }
}

module.exports = { AppError };
