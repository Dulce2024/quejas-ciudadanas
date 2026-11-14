(() => {
  const { esc, fecha, api } = window.Comun;
  const $ = (s) => document.querySelector(s);

  const form = $('#form-reporte');
  const alerta = $('#alerta-form');
  const btn = $('#btn-enviar');
  const inputFoto = $('#foto');
  let fotoLista = null; // Blob ya comprimido
  let maxBytes = 700 * 1024;

  // ---------- Catálogos desde el backend ----------
  api('/api/catalogos')
    .then((c) => {
      maxBytes = c.fotoMaxBytes;
      $('#categoria').insertAdjacentHTML('beforeend', c.categorias.map((x) => `<option>${esc(x)}</option>`).join(''));
    })
    .catch((e) => mostrarAlerta(`No se pudieron cargar las categorías: ${e.message}`));

  $('#descripcion').addEventListener('input', (e) => ($('#contador').textContent = e.target.value.length));

  // ---------- Errores ----------
  function limpiarErrores() {
    alerta.classList.add('oculto');
    document.querySelectorAll('.campo').forEach((c) => {
      c.classList.remove('invalido');
      c.querySelector('.error-campo').textContent = '';
    });
    document.querySelector('[data-campo-error="contacto"]').textContent = '';
  }
  function mostrarAlerta(msg) {
    alerta.textContent = msg;
    alerta.classList.remove('oculto');
  }
  function marcarErrores(errores) {
    Object.entries(errores).forEach(([campo, msg]) => {
      if (campo === 'contacto') {
        document.querySelector('[data-campo-error="contacto"]').textContent = msg;
        return;
      }
      const c = document.querySelector(`.campo[data-campo="${campo}"]`);
      if (c) {
        c.classList.add('invalido');
        c.querySelector('.error-campo').textContent = msg;
      }
    });
    const primero = document.querySelector('.campo.invalido input, .campo.invalido select, .campo.invalido textarea');
    if (primero) primero.focus();
  }

  // ---------- Validación en el cliente (el servidor vuelve a validar todo) ----------
  function validar(d) {
    const e = {};
    if (d.nombre.length < 3) e.nombre = 'Ingresá tu nombre (mínimo 3 caracteres).';
    if (!d.correo && !d.telefono) e.contacto = 'Ingresá al menos un medio de contacto: correo o teléfono.';
    if (d.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.correo)) e.correo = 'El correo no es válido.';
    if (d.telefono && !/^\+?\d{8,12}$/.test(d.telefono.replace(/[\s-]/g, ''))) e.telefono = 'Debe tener entre 8 y 12 dígitos.';
    if (!d.categoria) e.categoria = 'Seleccioná el tipo de problema.';
    if (d.direccion.length < 5) e.direccion = 'Indicá la dirección o una referencia.';
    if (d.zona && !/^\d{1,2}$/.test(d.zona)) e.zona = 'La zona debe ser un número.';
    if (d.descripcion.length < 20) e.descripcion = 'Describí el problema con al menos 20 caracteres.';
    if (!fotoLista) e.foto = 'Adjuntá una fotografía del problema.';
    return e;
  }

  // ---------- Foto: vista previa y compresión ----------
  function cargarImagen(file) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => ok({ img, url });
      img.onerror = () => fail(new Error('No se pudo leer la imagen.'));
      img.src = url;
    });
  }
  const aBlob = (canvas, calidad) => new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', calidad));

  async function comprimir(file) {
    const { img, url } = await cargarImagen(file);
    const MAX_LADO = 1600;
    if (file.size <= maxBytes && Math.max(img.width, img.height) <= MAX_LADO) return { blob: file, url };
    let escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
    for (let intento = 0; intento < 6; intento++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.75, 0.65, 0.55]) {
        const blob = await aBlob(canvas, q);
        if (blob && blob.size <= maxBytes) return { blob, url };
      }
      escala *= 0.75;
    }
    throw new Error('No se pudo reducir la fotografía lo suficiente. Probá con otra imagen.');
  }

  inputFoto.addEventListener('change', async () => {
    fotoLista = null;
    const c = document.querySelector('.campo[data-campo="foto"]');
    c.classList.remove('invalido');
    c.querySelector('.error-campo').textContent = '';
    $('#preview').classList.add('oculto');
    const file = inputFoto.files[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      marcarErrores({ foto: 'La fotografía debe ser JPG, PNG o WEBP.' });
      inputFoto.value = '';
      return;
    }
    try {
      const { blob, url } = await comprimir(file);
      fotoLista = blob;
      $('#preview img').src = url;
      $('#preview-info').textContent = `${Math.round(blob.size / 1024)} KB listos para enviar`;
      $('#preview').classList.remove('oculto');
    } catch (e) {
      marcarErrores({ foto: e.message });
    }
  });

  // ---------- Envío ----------
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    limpiarErrores();
    const d = {
      nombre: $('#nombre').value.trim(),
      correo: $('#correo').value.trim(),
      telefono: $('#telefono').value.trim(),
      categoria: $('#categoria').value,
      direccion: $('#direccion').value.trim(),
      zona: $('#zona').value.trim(),
      descripcion: $('#descripcion').value.trim(),
    };
    const errores = validar(d);
    if (Object.keys(errores).length) {
      mostrarAlerta('Revisá los campos marcados.');
      marcarErrores(errores);
      return;
    }

    const fd = new FormData();
    Object.entries(d).forEach(([k, v]) => fd.append(k, v));
    fd.append('foto', fotoLista, 'foto.jpg');

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      const r = await api('/api/reportes', { method: 'POST', body: fd });
      $('#ok-folio').textContent = r.folio;
      $('#ok-fecha').textContent = fecha(r.fechaCreacion);
      $('#ok-estado').textContent = r.estado;
      $('#ok-categoria').textContent = r.categoria || '—';
      $('#ok-area').textContent = r.areaAtencion || 'Atención al Vecino';
      $('#seccion-form').classList.add('oculto');
      $('#seccion-ok').classList.remove('oculto');
      $('#seg-folio').value = r.folio;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      mostrarAlerta(e.message);
      if (e.detalles) marcarErrores(e.detalles);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar reporte';
    }
  });

  $('#btn-nuevo').addEventListener('click', () => {
    form.reset();
    fotoLista = null;
    $('#preview').classList.add('oculto');
    $('#contador').textContent = '0';
    limpiarErrores();
    $('#seccion-ok').classList.add('oculto');
    $('#seccion-form').classList.remove('oculto');
  });

  // ---------- Seguimiento por folio ----------
  $('#form-seguimiento').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const folio = $('#seg-folio').value.trim().toUpperCase();
    const out = $('#seg-resultado');
    if (!/^Q-\d{8}-[A-Z0-9]{5}$/.test(folio)) {
      out.innerHTML = '<div class="alerta error">El folio tiene el formato Q-AAAAMMDD-XXXXX.</div>';
      return;
    }
    out.textContent = 'Consultando…';
    try {
      const r = await api(`/api/reportes/${encodeURIComponent(folio)}/seguimiento`);
      out.innerHTML = `
        <dl class="datos">
          <dt>Folio</dt><dd class="mono">${esc(r.folio)}</dd>
          <dt>Estado</dt><dd><span class="chip">${esc(r.estado)}</span></dd>
          <dt>Categoría</dt><dd>${esc(r.categoria)}</dd>
          <dt>Área</dt><dd>${esc(r.areaAtencion || 'Pendiente de asignar')}</dd>
          <dt>Actualizado</dt><dd>${esc(fecha(r.fechaActualizacion))}</dd>
        </dl>
        <h3>Historial</h3>
        <ul class="historial">${r.historial.map((h) => `<li><b>${esc(h.estado)}</b> — ${esc(fecha(h.fecha))}${h.nota ? `: ${esc(h.nota)}` : ''}</li>`).join('')}</ul>`;
    } catch (e) {
      out.innerHTML = `<div class="alerta error">${esc(e.message)}</div>`;
    }
  });
})();
