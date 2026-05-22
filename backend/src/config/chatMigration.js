// chatMigration.js — Run this ONCE to upgrade the chat_file_data table
// Usage: node src/config/chatMigration.js
require('dotenv').config();
const db = require('./db');

async function migrate() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Add disk_path column to chat_file_data (for files > 10 MB)
    await client.query(`
      ALTER TABLE chat_file_data
        ADD COLUMN IF NOT EXISTS disk_path TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
    `);

    // Make file_data nullable (disk files won't have it)
    await client.query(`
      ALTER TABLE chat_file_data
        ALTER COLUMN file_data DROP NOT NULL
    `).catch(() => {}); // ignore if already nullable

    // Create the table if it doesn't exist at all
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_file_data (
        id            SERIAL PRIMARY KEY,
        original_name TEXT NOT NULL,
        mime_type     TEXT,
        file_size     BIGINT,
        file_data     BYTEA,
        disk_path     TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Index for faster lookups
    await client.query(`CREATE INDEX IF NOT EXISTS idx_chat_file_data_id ON chat_file_data(id)`);

    // Extend chat_messages to support 1 GB file sizes
    await client.query(`
      ALTER TABLE chat_messages
        ALTER COLUMN file_size TYPE BIGINT USING file_size::BIGINT
    `).catch(() => {});

    await client.query('COMMIT');
    console.log('✅ Chat file migration complete');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrate();
