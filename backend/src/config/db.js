// src/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: false,
      max: 5,                        // hard cap — leaves room for pgAdmin + other tools
      min: 1,                        // keep 1 connection warm
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false,
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME     || 'hrms_db',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: 5,                        // hard cap — leaves room for pgAdmin + other tools
      min: 1,                        // keep 1 connection warm
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false,
      ssl: false,
    };

const pool = new Pool(poolConfig);

pool.on('error', (err) => console.error('Unexpected DB error', err));


module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
