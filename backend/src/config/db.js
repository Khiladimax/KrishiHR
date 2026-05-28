// src/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: false,  // DB does not support SSL
      max: 8,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'hrms_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 8,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
      ssl: false,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => console.error('Unexpected DB error', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
