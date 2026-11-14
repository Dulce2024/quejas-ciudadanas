(() => {
  const { esc, fecha, api } = window.Comun;
  const $ = (s) => document.querySelector(s);

  // ---------- Sesión ----------
  let memoria = null;
  const store = {
    get() { try { return JSON.parse(sessionStorage.getItem('sesion') || 'null'); } catch { return null; } },
    set(v) { memoria = v; try { sessionStorage.setItem('sesion', JSON.stringify(v)); } catch { /* sin storage */ } },
    clear() { memoria = null; try { sessionStorage.removeItem('sesion'); } catch { /* */ } },
  };
  memoria = store.get();
  const token = () => memoria?.token;

  async function apiAuth(url, opciones = {}) {
    try {
      return await api(url, { ...opciones, headers: { ...(opciones.headers || {}), Authorization: `Bearer ${token()}` } });
    } catch (e) {
      if (e.status === 401) cerrarSesion('Tu sesión expiró. Ingresá nuevamente.');
      throw e;
    }
  }

  function mostrarPanel() {
    $('#vista-login').classList.add('oculto');
    $('#vista-panel').classList.remove('oculto');
    $('#sesion').classList.remove('oculto');
    $('#sesion-usuario').textContent = memoria.usuario;
    iniciar();
  }
  function cerrarSesion(msg) {
    store.clear();
    $('#vista-panel').classList.add('oculto');
    $('#sesion').classList.add('oculto');
    $('#vista-login').classList.remove('oculto');
    $('#modal').classList.add('oculto');
    if (msg) {
      $('#login-error').textContent = msg;
      $('#login-error').classList.remove('oculto');
    }
  }

  $('#form-login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#login-error').classList.add('oculto');
    try {
      const r = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: $('#usuario').value.trim(), clave: $('#clave').value }),
      });
      store.set(r);
      $('#clave').value = '';
      mostrarPanel();
    } catch (e) {
      $('#login-error').textContent = e.message;
      $('#login-error').classList.remove('oculto');
    }
  });
  $('#btn-salir').addEventListener('click', (e) => { e.preventDefault(); cerrarSesion(); });

  // ---------- Inicio ----------
  let catalogos = null;
  let iniciado = false;
  async function iniciar() {
    if (!iniciado) {
      iniciado = true;
      catalogos = await api('/api/catalogos');
      const opts = (arr) => arr.map((x) => `<option>${esc(x)}</option>`).join('');
      $('#f-estado').insertAdjacentHTML('beforeend', opts(catalogos.estados));
      $('#f-prioridad').insertAdjacentHTML('beforeend', opts(catalogos.prioridades));
      $('#f-categoria').insertAdjacentHTML('beforeend', opts(catalogos.categorias));
      $('#f-area').insertAdjacentHTML('beforeend', opts(catalogos.areas));
      api('/api/salud').catch(() => {
        $('#servicios-aviso').textContent = 'No hay conexión con Firebase. Revisá la configuración del servidor.';
        $('#servicios-aviso').classList.remove('oculto');
      });
    }
    cargar();
  }

  function parametros() {
    const p = new URLSearchParams();
    const add = (k, v) => v && p.set(k, v);
    add('q', $('#f-q').value.trim());
    add('estado', $('#f-estado').value);
    add('prioridad', $('#f-prioridad').value);
    add('categoria', $('#f-categoria').value);
    add('area', $('#f-area').value);
    add('zona', $('#f-zona').value.trim());
    add('desde', $('#f-desde').value);
    add('hasta', $('#f-hasta').value);
    add('orden', $('#f-orden').value);
    return p.toString();
  }

  async function cargar() {
    $('#lista-error').classList.add('oculto');
    $('#tabla').innerHTML = '<tr><td colspan="6" class="vacio">Cargando…</td></tr>';
    try {
      const r = await apiAuth(`/api/admin/reportes?${parametros()}`);
      pintarIndicadores(r.indicadores);
      pintarTabla(r.reportes);
      $('#conteo').textContent = `Mostrando ${r.totalFiltrado} de ${r.indicadores.total} reportes.`;
    } catch (e) {
      $('#tabla').innerHTML = '';
      $('#lista-error').textContent = e.message;
      $('#lista-error').classList.remove('oculto');
    }
  }

  $('#form-filtros').addEventListener('submit', (e) => { e.preventDefault(); cargar(); });
  $('#btn-limpiar').addEventListener('click', () => { $('#form-filtros').reset(); cargar(); });
  ['#f-estado', '#f-prioridad', '#f-categoria', '#f-area', '#f-orden'].forEach((s) => $(s).addEventListener('change', cargar));

  // ---------- Indicadores ----------
  function pintarIndicadores(ind) {
    $('#kpis').innerHTML = `
      <div class="kpi"><div class="valor">${ind.total}</div><div class="etiqueta">Reportes totales</div></div>
      <div class="kpi"><div class="valor">${ind.hoy}</div><div class="etiqueta">Recibidos hoy</div></div>
      <div class="kpi"><div class="valor">${ind.abiertos}</div><div class="etiqueta">Abiertos (sin resolver)</div></div>
      <div class="kpi aviso"><div class="valor">${ind.sinPrioridad}</div><div class="etiqueta">Pendientes de clasificar</div></div>
      <div class="kpi critico"><div class="valor">${ind.criticosAbiertos}</div><div class="etiqueta">Críticos abiertos</div></div>`;

    const bloque = (titulo, datos, ordenFijo) => {
      let entradas = Object.entries(datos);
      if (ordenFijo) entradas = ordenFijo.map((k) => [k, datos[k] || 0]);
      else entradas.sort((a, b) => b[1] - a[1]);
      entradas = entradas.slice(0, 7);
      const max = Math.max(1, ...entradas.map(([, v]) => v));
      return `<div class="tarjeta" style="margin:0"><h3 style="margin-top:0">${esc(titulo)}</h3>${
        entradas.length
          ? entradas.map(([k, v]) => `<div class="barra-fila"><span class="nombre" title="${esc(k)}">${esc(k)}</span><div class="barra"><span style="width:${(v / max) * 100}%"></span></div><b>${v}</b></div>`).join('')
          : '<p class="ayuda">Sin datos</p>'
      }</div>`;
    };
    $('#graficas').innerHTML =
      bloque('Por estado', ind.porEstado, catalogos.estados) +
      bloque('Por prioridad', ind.porPrioridad, ['Crítica', 'Alta', 'Media', 'Baja', 'Sin asignar']) +
      bloque('Por categoría', ind.porCategoria) +
      bloque('Por zona', ind.porZona);
  }

  // ---------- Tabla ----------
  const chipPrioridad = (p) => (p ? `<span class="chip p-${esc(p)}">${esc(p)}</span>` : '<span class="chip">Sin asignar</span>');
  const ubicacion = (u) => `${esc(u?.direccion || '')}${u?.zona ? `, zona ${esc(u.zona)}` : ''}`;

  function pintarTabla(lista) {
    if (!lista.length) {
      $('#tabla').innerHTML = '<tr><td colspan="6" class="vacio">No hay reportes con esos filtros.</td></tr>';
      return;
    }
    $('#tabla').innerHTML = lista
      .map(
        (r) => `<tr data-folio="${esc(r.folio)}">
          <td><div class="mono">${esc(r.folio)}</div><div class="ayuda">${esc(fecha(r.fechaCreacion))}</div></td>
          <td>${chipPrioridad(r.prioridad)}</td>
          <td><b>${esc(r.categoria)}</b><div>${esc(r.descripcion)}</div></td>
          <td>${ubicacion(r.ubicacion)}</td>
          <td>${esc(r.areaAtencion || '—')}</td>
          <td><span class="chip">${esc(r.estado)}</span></td>
        </tr>`,
      )
      .join('');
  }

  $('#tabla').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-folio]');
    if (tr) abrirDetalle(tr.dataset.folio);
  });

  // ---------- Detalle ----------
  let urlFoto = null;
  function cerrarModal() {
    $('#modal').classList.add('oculto');
    if (urlFoto) URL.revokeObjectURL(urlFoto);
    urlFoto = null;
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

  async function cargarFoto(folio) {
    const res = await fetch(`/api/admin/reportes/${encodeURIComponent(folio)}/foto`, { headers: { Authorization: `Bearer ${token()}` } });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  }

  const opciones = (arr, actual, vacio) =>
    (vacio ? `<option value="">${esc(vacio)}</option>` : '') +
    arr.map((x) => `<option ${x === actual ? 'selected' : ''}>${esc(x)}</option>`).join('');

  function pintarDetalle(r) {
    $('#modal-contenido').innerHTML = `
      <header>
        <div>
          <div class="mono">${esc(r.folio)}</div>
          <h2 style="margin:4px 0">${esc(r.categoria)}</h2>
          <div>${chipPrioridad(r.prioridad)} <span class="chip">${esc(r.estado)}</span></div>
        </div>
        <button class="btn secundario peq" id="btn-cerrar">Cerrar ✕</button>
      </header>

      <div class="detalle-grid" style="margin-top:16px">
        <div>
          <h3>Fotografía asociada</h3>
          ${urlFoto ? `<a href="${urlFoto}" target="_blank" rel="noopener"><img class="foto-detalle" src="${urlFoto}" alt="Fotografía del reporte" /></a><p class="ayuda">Clic en la foto para verla en tamaño completo.</p>` : '<p class="ayuda">No se pudo cargar la fotografía.</p>'}
        </div>
        <div>
          <h3>Descripción original del ciudadano</h3>
          <div class="descripcion-original">${esc(r.descripcion)}</div>
          <dl class="datos" style="margin-top:12px">
            <dt>Ciudadano</dt><dd>${esc(r.ciudadano?.nombre)}</dd>
            <dt>Contacto</dt><dd>${esc([r.ciudadano?.correo, r.ciudadano?.telefono].filter(Boolean).join(' · ') || '—')}</dd>
            <dt>Ubicación</dt><dd>${ubicacion(r.ubicacion)}</dd>
            <dt>Área de atención</dt><dd>${esc(r.areaAtencion || '—')}</dd>
            <dt>Recibido</dt><dd>${esc(fecha(r.fechaCreacion))}</dd>
            <dt>Última actualización</dt><dd>${esc(fecha(r.fechaActualizacion))}</dd>
          </dl>
        </div>
      </div>

      <div class="tarjeta" style="margin-top:18px">
        <h3 style="margin-top:0">Gestión del reporte</h3>
        <div id="gestion-msg" class="alerta oculto"></div>
        <form id="form-gestion">
          <div class="grid-2">
            <div class="campo"><label for="g-estado">Estado</label><select id="g-estado">${opciones(catalogos.estados, r.estado)}</select></div>
            <div class="campo"><label for="g-prioridad">Prioridad</label><select id="g-prioridad">${opciones(catalogos.prioridades, r.prioridad, r.prioridad ? null : 'Sin asignar')}</select></div>
            <div class="campo"><label for="g-area">Área de atención</label><select id="g-area">${opciones(catalogos.areas, r.areaAtencion)}</select></div>
            <div class="campo"><label for="g-nota">Nota <span class="opcional">(obligatoria al resolver o rechazar)</span></label><input id="g-nota" maxlength="500" /></div>
          </div>
          <button class="btn peq" type="submit">Guardar cambios</button>
        </form>
        <h3>Historial</h3>
        <ul class="historial">${(r.historial || []).map((h) => `<li><b>${esc(h.estado)}</b> — ${esc(fecha(h.fecha))} (${esc(h.usuario)})${h.nota ? `: ${esc(h.nota)}` : ''}</li>`).join('')}</ul>
      </div>`;

    $('#btn-cerrar').addEventListener('click', cerrarModal);

    $('#form-gestion').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('#gestion-msg');
      try {
        const act = await apiAuth(`/api/admin/reportes/${encodeURIComponent(r.folio)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            estado: $('#g-estado').value,
            prioridad: $('#g-prioridad').value,
            area: $('#g-area').value,
            nota: $('#g-nota').value,
          }),
        });
        pintarDetalle(act);
        $('#gestion-msg').className = 'alerta ok';
        $('#gestion-msg').textContent = 'Cambios guardados.';
        cargar();
      } catch (er) {
        msg.className = 'alerta error';
        msg.textContent = er.detalles ? Object.values(er.detalles).join(' ') : er.message;
      }
    });
  }

  async function abrirDetalle(folio) {
    $('#modal-contenido').innerHTML = '<p class="vacio">Cargando…</p>';
    $('#modal').classList.remove('oculto');
    try {
      const [r, foto] = await Promise.all([apiAuth(`/api/admin/reportes/${encodeURIComponent(folio)}`), cargarFoto(folio)]);
      urlFoto = foto;
      pintarDetalle(r);
    } catch (e) {
      $('#modal-contenido').innerHTML = `<div class="alerta error">${esc(e.message)}</div>`;
    }
  }

  if (token()) mostrarPanel();
})();
