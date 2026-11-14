/**
 * Pruebas de la API (node --test). Usan el repositorio en memoria (misma interfaz que el de
 * Firestore) para correr sin internet; la aplicación real (npm start) siempre usa Firebase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { crearMemoryRepo } = require('../src/repo/memoryRepo');
const { crearAuth } = require('../src/middleware/auth');

// JPEG mínimo válido por firma (FF D8 FF ...)
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);

async function levantar({ repo = crearMemoryRepo() } = {}) {
  const auth = crearAuth({ user: 'admin', password: 'clave-segura', secret: 'secreto-de-prueba-123456', ttlMin: 5 });
  const app = createApp({ repo, auth, logger: { error() {} } });
  const server = await new Promise((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, repo, cerrar: () => new Promise((ok) => server.close(ok)) };
}

function formulario(over = {}, foto = JPEG) {
  const fd = new FormData();
  const datos = {
    nombre: 'María López',
    correo: 'maria@example.com',
    telefono: '55551234',
    categoria: 'Basura y limpieza',
    direccion: '5a avenida 10-20',
    zona: '1',
    descripcion: 'Hay basura acumulada desde hace una semana y huele muy mal, es un foco de infección.',
    ...over,
  };
  Object.entries(datos).forEach(([k, v]) => v !== undefined && fd.append(k, v));
  if (foto) fd.append('foto', new Blob([foto], { type: 'image/jpeg' }), 'f.jpg');
  return fd;
}

async function login(base) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'admin', clave: 'clave-segura' }),
  });
  return (await r.json()).token;
}

const enviar = (base, fd = formulario()) => fetch(`${base}/api/reportes`, { method: 'POST', body: fd });

test('flujo completo: ciudadano registra -> se persiste -> panel lo consulta con su foto', async () => {
  const { base, repo, cerrar } = await levantar();
  try {
    const r = await enviar(base);
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.match(body.folio, /^Q-\d{8}-[A-Z0-9]{5}$/);
    assert.equal(body.estado, 'Recibido');
    assert.equal(body.areaAtencion, 'Limpieza y Manejo de Desechos');

    const guardado = await repo.obtener(body.folio);
    assert.ok(guardado, 'el reporte persiste en el repositorio');
    assert.equal(guardado.descripcion, 'Hay basura acumulada desde hace una semana y huele muy mal, es un foco de infección.');
    assert.equal(guardado.prioridad, null);
    assert.ok((await repo.obtenerFoto(body.folio)).buffer.equals(JPEG));

    const token = await login(base);
    const auth = { Authorization: `Bearer ${token}` };
    const lista = await (await fetch(`${base}/api/admin/reportes`, { headers: auth })).json();
    assert.equal(lista.indicadores.total, 1);
    assert.equal(lista.indicadores.sinPrioridad, 1);
    assert.equal(lista.reportes[0].folio, body.folio);
    assert.equal(lista.reportes[0].ciudadano, undefined, 'el listado no expone datos de contacto');

    const detalle = await (await fetch(`${base}/api/admin/reportes/${body.folio}`, { headers: auth })).json();
    assert.equal(detalle.ciudadano.nombre, 'María López');

    const foto = await fetch(`${base}/api/admin/reportes/${body.folio}/foto`, { headers: auth });
    assert.equal(foto.status, 200);
    assert.equal(foto.headers.get('content-type'), 'image/jpeg');
  } finally {
    await cerrar();
  }
});

test('validaciones: rechaza datos inválidos con 422 y errores por campo', async () => {
  const { base, repo, cerrar } = await levantar();
  try {
    const r = await enviar(base, formulario({ nombre: 'A', correo: '', telefono: '', categoria: 'Inventada', descripcion: 'corta' }, null));
    assert.equal(r.status, 422);
    const b = await r.json();
    for (const campo of ['nombre', 'contacto', 'categoria', 'descripcion', 'foto']) {
      assert.ok(b.detalles[campo], `debe reportar error en ${campo}`);
    }
    assert.equal((await repo.listar()).length, 0, 'no se guarda nada si hay errores');

    const correoMalo = await enviar(base, formulario({ correo: 'no-es-correo', telefono: '123' }));
    const d = (await correoMalo.json()).detalles;
    assert.ok(d.correo && d.telefono);
  } finally {
    await cerrar();
  }
});

test('rechaza archivos que no son imagen aunque digan .jpg', async () => {
  const { base, cerrar } = await levantar();
  try {
    const r = await enviar(base, formulario({}, Buffer.from('<?php echo 1; ?> no soy imagen')));
    assert.equal(r.status, 422);
    assert.match((await r.json()).detalles.foto, /JPG, PNG o WEBP/);
  } finally {
    await cerrar();
  }
});

test('si Firebase falla responde 503 con mensaje claro', async () => {
  const repo = crearMemoryRepo();
  repo.crear = async () => {
    throw new Error('UNAVAILABLE');
  };
  const { base, cerrar } = await levantar({ repo });
  try {
    const r = await enviar(base);
    assert.equal(r.status, 503);
    assert.match((await r.json()).error, /No pudimos guardar/);
  } finally {
    await cerrar();
  }
});

test('el panel exige autenticación y rechaza credenciales incorrectas', async () => {
  const { base, cerrar } = await levantar();
  try {
    assert.equal((await fetch(`${base}/api/admin/reportes`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/reportes`, { headers: { Authorization: 'Bearer falso.token' } })).status, 401);
    const mal = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'admin', clave: 'otra' }),
    });
    assert.equal(mal.status, 401);
  } finally {
    await cerrar();
  }
});

test('gestión: asigna prioridad/estado, valida y deja historial', async () => {
  const { base, cerrar } = await levantar();
  try {
    const { folio } = await (await enviar(base)).json();
    const token = await login(base);
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const patch = (b) => fetch(`${base}/api/admin/reportes/${folio}`, { method: 'PATCH', headers: h, body: JSON.stringify(b) });

    assert.equal((await patch({ estado: 'Inventado' })).status, 422);
    assert.equal((await patch({ estado: 'Recibido', prioridad: 'Urgentísima' })).status, 422);
    assert.equal((await patch({ estado: 'Resuelto' })).status, 422, 'resolver exige nota');

    const ok = await patch({ estado: 'En atención', prioridad: 'Alta', nota: 'Cuadrilla asignada' });
    assert.equal(ok.status, 200);
    const act = await ok.json();
    assert.equal(act.prioridad, 'Alta');

    const seg = await (await fetch(`${base}/api/reportes/${folio}/seguimiento`)).json();
    assert.equal(seg.estado, 'En atención');
    assert.equal(seg.historial.length, 2);
    assert.equal(seg.ciudadano, undefined, 'el seguimiento público no expone datos personales');
  } finally {
    await cerrar();
  }
});

test('filtros del panel: estado, prioridad, categoría, zona y búsqueda', async () => {
  const { base, cerrar } = await levantar();
  try {
    await enviar(base);
    await enviar(base, formulario({ categoria: 'Alumbrado público', zona: '7', descripcion: 'El poste de luz de la esquina lleva tres días apagado.' }));
    const token = await login(base);
    const get = async (qs) => (await fetch(`${base}/api/admin/reportes?${qs}`, { headers: { Authorization: `Bearer ${token}` } })).json();

    assert.equal((await get('categoria=Alumbrado público')).totalFiltrado, 1);
    assert.equal((await get('zona=7')).totalFiltrado, 1);
    assert.equal((await get('q=poste')).totalFiltrado, 1);
    assert.equal((await get('prioridad=Sin asignar')).totalFiltrado, 2);
    assert.equal((await get('estado=abiertos')).totalFiltrado, 2);
    const malo = await fetch(`${base}/api/admin/reportes?desde=ayer`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(malo.status, 400);
  } finally {
    await cerrar();
  }
});

test('folio inválido o inexistente', async () => {
  const { base, cerrar } = await levantar();
  try {
    assert.equal((await fetch(`${base}/api/reportes/abc/seguimiento`)).status, 400);
    assert.equal((await fetch(`${base}/api/reportes/Q-20260101-AAAAA/seguimiento`)).status, 404);
  } finally {
    await cerrar();
  }
});
