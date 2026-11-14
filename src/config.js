require('dotenv').config();

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const config = {
  port: num(process.env.PORT, 3000),
  admin: {
    user: process.env.ADMIN_USER || '',
    password: process.env.ADMIN_PASSWORD || '',
    secret: process.env.SESSION_SECRET || '',
    ttlMin: num(process.env.SESSION_TTL_MIN, 120),
  },
  firebase: {
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  },
};

module.exports = config;
