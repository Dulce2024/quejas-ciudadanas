# Sistema de Atención de Quejas Ciudadanas

Sistema web para que los ciudadanos reporten problemas de su comunidad con una fotografía y el
personal municipal los revise y atienda. Los datos se guardan en **Firebase Firestore (capa gratuita)**.

```
Ciudadano ──(Portal público)──multipart──▶ Backend / API (Node + Express) ──▶ Firebase Firestore
                                                     ▲                               │
Personal municipal ──(Panel de Administración)──token┘◀──────────────────────────────┘
```

Flujo: **Ciudadano registra queja → Frontend → Backend/API → Firebase → Backend/API → Panel de Administración**.

## Cómo cumple cada serie

| Serie | Requisito | Dónde está |
|---|---|---|
| I.A Portal público | Ingresar queja, adjuntar foto, enviar, recibir confirmación | `public/index.html` y `public/js/portal.js`. Entrega folio, fecha, categoría y área responsable. También permite consultar el estado por folio. |
| I.B Panel municipal | Ver reportes, descripción original, foto, información organizada | `public/admin.html` y `public/js/admin.js`. Incluye indicadores, gráficas por estado, prioridad, categoría y zona, filtros, orden, detalle con foto y gestión (estado, prioridad, área y nota) con historial. |
| II Backend + Firebase | Recibir, procesar, registrar en Firebase, consultar, validar, manejar errores | `src/app.js` (API), `src/validation.js` (reglas), `src/repo/firestoreRepo.js` (Firebase) y `src/middleware/auth.js` (seguridad del panel) |

**Condición de las series:** ninguna pantalla tiene datos escritos en el código. Todo lo que muestra
el panel viene de Firestore a través de la API.

## Estructura del proyecto

```
src/
  server.js              arranque: conecta Firebase y levanta Express
  app.js                 rutas de la API, filtros, indicadores y manejo de errores
  validation.js          catálogos y validación de datos
  errors.js              AppError (status + mensaje + errores por campo)
  config.js              lee el .env
  middleware/auth.js     login del panel y verificación de token
  repo/firestoreRepo.js  acceso a Firebase Firestore
  repo/memoryRepo.js     misma interfaz en memoria (sólo para pruebas)
public/
  index.html, js/portal.js   Portal público
  admin.html, js/admin.js    Panel de Administración
  js/comun.js, css/styles.css
test/api.test.js         pruebas automatizadas
```

## Estructura de datos (Firestore)

```
reportes/{folio}                       ej. Q-20261114-9D4XD
  folio, fechaCreacion, fechaActualizacion
  ciudadano   { nombre, correo, telefono }
  categoria   (elegida por el ciudadano)
  ubicacion   { direccion, zona }
  descripcion (texto original)
  fotoMime, fotoTamano
  estado      Recibido | En revisión | En atención | Resuelto | Rechazado
  prioridad   null | Baja | Media | Alta | Crítica    (la asigna el personal)
  areaAtencion (sugerida según la categoría, editable)
  historial[] { estado, fecha, nota, usuario }

fotos/{folio}
  mime, tamano, data (base64)
```

La foto va en una colección aparte por dos razones: el listado del panel no descarga imágenes, y
Firebase Storage ya no está incluido en el plan gratuito para proyectos nuevos. Un documento de
Firestore admite como máximo 1 MiB, así que el portal comprime la foto en el navegador y el
backend acepta **hasta 700 KB** (el base64 ocupa un tercio más).

## API

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| GET | `/api/salud` | público | Verifica la conexión con Firebase |
| GET | `/api/catalogos` | público | Categorías, estados, prioridades y áreas |
| POST | `/api/reportes` | público (máx. 10/min por IP) | `multipart/form-data` con nombre, correo, telefono, categoria, direccion, zona, descripcion y **foto** → `201 { folio, ... }` |
| GET | `/api/reportes/:folio/seguimiento` | público | Estado e historial (sin datos personales) |
| POST | `/api/auth/login` | público | `{ usuario, clave }` → `{ token, expira }` |
| GET | `/api/admin/reportes` | token | Listado + indicadores. Filtros: `q, estado (o abiertos), prioridad (o Sin asignar), categoria, area, zona, desde, hasta, orden=prioridad\|recientes\|antiguos` |
| GET | `/api/admin/reportes/:folio` | token | Detalle completo |
| GET | `/api/admin/reportes/:folio/foto` | token | Fotografía |
| PATCH | `/api/admin/reportes/:folio` | token | `{ estado, prioridad, area, nota }` (al resolver o rechazar, la nota es obligatoria) |

### Validaciones y errores

Validaciones que hace el **backend** (el frontend repite las mismas para avisar antes de enviar):
- **Nombre:** de 3 a 80 caracteres, sólo letras.
- **Contacto:** se exige al menos un correo o un teléfono. El correo debe tener formato válido y el teléfono de 8 a 12 dígitos.
- **Categoría:** debe estar en el catálogo.
- **Dirección:** de 5 a 200 caracteres.
- **Zona:** un número del 1 al 99.
- **Descripción:** de 20 a 2000 caracteres.
- **Foto:** obligatoria. Se revisa el **tipo real** del archivo por sus primeros bytes (JPG, PNG o WEBP) y que pese como máximo 700 KB.

Todas las respuestas de error tienen el mismo formato: `{ "error": "mensaje", "detalles": { "campo": "mensaje" } }`.

| Código | Cuándo |
|---|---|
| 400 | Folio, fecha o JSON con formato inválido |
| 401 | Sin sesión o sesión vencida |
| 404 | Reporte inexistente |
| 413 | Archivo demasiado grande |
| 422 | Datos inválidos |
| 429 | Demasiados intentos o envíos |
| 503 | Firebase no disponible |
| 500 | Error inesperado (sin exponer detalles internos) |

## Seguridad

- La clave de Firebase y la contraseña del administrador están **sólo en `.env`** y en
  `serviceAccountKey.json`. Los dos están en `.gitignore`, así que nunca se suben al repositorio.
- El navegador nunca habla directo con Firebase: todo pasa por el backend, que separa el frontend del backend.
- El panel usa un token firmado (HMAC-SHA256) que vence. Las contraseñas se comparan en tiempo
  constante y, tras 5 intentos fallidos, el ingreso se bloquea 5 minutos.
- Todo lo que escribe el usuario se escapa al mostrarse, para evitar XSS. Además se envían las cabeceras `nosniff` y `X-Frame-Options`.
- Ni el listado ni el seguimiento público muestran datos de contacto del ciudadano.

## Instalación

Requisitos: Node.js 18 o superior y un proyecto de Firebase.

1. **Firebase** (https://console.firebase.google.com):
   - Creá un proyecto.
   - Entrá a **Firestore Database → Crear base de datos** (modo producción).
   - Andá a **⚙ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**.
   - Guardá el archivo descargado como `serviceAccountKey.json` en la raíz del proyecto.
2. Configurá e iniciá el proyecto:
   ```bash
   npm install
   cp .env.example .env      # poné ADMIN_PASSWORD y un SESSION_SECRET largo
   npm start
   ```
3. Abrí el portal en http://localhost:3000/ y el panel en http://localhost:3000/admin.html.
   No abras los `.html` con doble clic: tienen que servirse desde el backend.

## Pruebas

```bash
npm test
```

Son 8 pruebas que cubren:
- el flujo completo (registro → persistencia → panel → foto);
- las validaciones por campo;
- el rechazo de archivos que no son imagen;
- la falla de Firebase (503);
- la autenticación;
- la gestión con historial;
- los filtros del panel;
- folios inválidos.

En las pruebas, Firebase se reemplaza por un repositorio en memoria que tiene la misma interfaz.
La aplicación real (`npm start`) **siempre** guarda en Firestore.

## Limitaciones conocidas

- Para miles de reportes, el filtrado del panel debería hacerse con consultas e índices de Firestore. Hoy se hace en memoria sobre los últimos 500.
- Hay un solo usuario administrador, definido en `.env`. Para varios usuarios o roles convendría usar Firebase Authentication.
- El límite de envíos por IP se guarda en memoria y se reinicia cuando se reinicia el servidor.
