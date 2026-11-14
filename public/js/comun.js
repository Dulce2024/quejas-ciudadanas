/* Utilidades compartidas por el portal y el panel. */
window.Comun = (() => {
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const fecha = (iso) =>
    iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  /** Llama al API y lanza un Error con .status y .detalles si la respuesta no es 2xx. */
  async function api(url, opciones = {}) {
    let res;
    try {
      res = await fetch(url, opciones);
    } catch {
      const e = new Error('No se pudo conectar con el servidor. Revisá tu conexión.');
      e.status = 0;
      throw e;
    }
    const tipo = res.headers.get('content-type') || '';
    const cuerpo = tipo.includes('application/json') ? await res.json() : null;
    if (!res.ok) {
      const e = new Error(cuerpo?.error || `Error ${res.status}`);
      e.status = res.status;
      e.detalles = cuerpo?.detalles;
      throw e;
    }
    return cuerpo;
  }


  return { esc, fecha, api };
})();
