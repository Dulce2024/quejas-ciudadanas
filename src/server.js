const config = require('./config');
const { createApp } = require('./app');
const { crearFirestoreRepo } = require('./repo/firestoreRepo');
const { crearAuth } = require('./middleware/auth');

let repo;
try {
  repo = crearFirestoreRepo(config.firebase);
} catch (e) {
  console.error(`\n[ERROR] Firebase: ${e.message}\nRevisá el archivo .env (ver .env.example).\n`);
  process.exit(1);
}

const auth = crearAuth(config.admin);
const app = createApp({ repo, auth });

app.listen(config.port, () => {
  console.log(`Servidor listo en http://localhost:${config.port}`);
  console.log(`  Portal ciudadano: http://localhost:${config.port}/`);
  console.log(`  Panel municipal:  http://localhost:${config.port}/admin.html`);
  if (!auth.configurado) console.warn('  [AVISO] ADMIN_USER / ADMIN_PASSWORD / SESSION_SECRET (>=16) no configurados: el panel no permitirá ingresar.');
});
