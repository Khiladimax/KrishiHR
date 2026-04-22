// src/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL if set (Neon), otherwise fall back to individual params
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      // ✅ FIX: Only force SSL if DB_SSL=true is explicitly set in .env
      // Neon needs SSL → set DB_SSL=true in Render env vars
      // Local/on-prem PG → leave DB_SSL unset or false
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'hrms_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: false, // ✅ FIX: Local/non-Neon PG never needs SSL
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => console.error('Unexpected DB error', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
