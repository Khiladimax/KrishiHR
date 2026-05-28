// src/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL if set (Neon), otherwise fall back to individual params
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 8,
      idleTimeoutMillis: 10000,        // release idle connections after 10s
      connectionTimeoutMillis: 5000,   // ✅ fail fast (was 20s — caused request pile-up during DB hiccups)
      allowExitOnIdle: true,           // ✅ free pool when server is idle (prevents zombie connections)
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'hrms_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 8,
      idleTimeoutMillis: 10000,        // release idle connections after 10s
      connectionTimeoutMillis: 5000,   // ✅ fail fast (was 20s)
      allowExitOnIdle: true,           // ✅ free pool when server is idle
      ssl: false,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => console.error('Unexpected DB error', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
