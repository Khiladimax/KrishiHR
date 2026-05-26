// chatController.js — WhatsApp + Google Meet grade chat system
// Features: reactions, pinned messages, delivery receipts, presence,
//           delete for everyone, scheduled meetings, message search,
//           admin controls, forward messages, group mute

// KrishiHR — no Main_file, using inline defaults
const CONFIG = {
  chatFileMaxSizeMB: 1024,
  chatFileRoute: '/api/chat/files',
  chatBlockedExtensions: ['.exe','.bat','.sh','.cmd','.msi','.ps1','.vbs'],
  chatAdminRoles: ['admin','super_admin','hr'],
      seen_count: 0,
      delivered_count: 0
    };

    // Mark as delivered for sender immediately
    await db.query(
      `INSERT INTO message_delivery_status(message_id, employee_id, delivered_at, seen_at)
       VALUES($1,$2,NOW(),NOW()) ON CONFLICT DO NOTHING`,
      [msg.id, empId]
    );

    // WhatsApp behavior: if this is a DM and the OTHER person had deleted the chat,
    // restore their left_at so the new message appears for them — but deleted_at stays set
    // so getMessages only shows messages AFTER their deletion timestamp (no old history).
    const groupTypeRes = await db.query(`SELECT type FROM chat_groups WHERE id=$1`, [gid]);
    if (groupTypeRes.rows[0]?.type === 'dm') {
      await db.query(
        `UPDATE chat_group_members 
         SET left_at = NULL 
         WHERE group_id=$1 AND employee_id != $2 AND left_at IS NOT NULL`,
        [gid, empId]
      );
    }

    emitToGroup(gid, 'message', full);
    res.json({ success: true, data: full });
  } catch (e) {
    console.error('[chat sendMessage]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.sendFile = async (req, res) => {
  try {
    const empId = req.user.id;
    const gid   = parseInt(req.params.id);
    if (!await isGroupMember(gid, empId))
      return res.status(403).json({ success: false, message: 'Not a member' });
    if (!req.file)
      return res.status(400).json({ success: false, message: 'No file uploaded' });

    const { originalname, mimetype, size, buffer } = req.file;
    let type = 'file';
    if (mimetype.startsWith('image/')) type = 'image';
    if (mimetype.startsWith('audio/')) type = 'audio';
    if (mimetype.startsWith('video/')) type = 'video';

    // Store file in DB (persistent — survives Render restarts, no external storage needed)
    const fileRow = await db.query(
      `INSERT INTO chat_file_data (original_name, mime_type, file_size, file_data)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [originalname, mimetype, size, buffer]
    );
    const fileId  = fileRow.rows[0].id;
    const fileUrl = `/api/chat/files/${fileId}`;

    const r = await db.query(`
      INSERT INTO chat_messages(group_id, sender_id, content, message_type, file_name, file_size, file_mime, file_url)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [gid, empId, originalname, type, originalname, size, mimetype, fileUrl]);

    const msg = r.rows[0];
    const emp = await db.query(
      `SELECT CONCAT(first_name,' ',last_name) AS name, employee_code FROM employees WHERE id=$1`, [empId]
    );
    const full = { ...msg, sender_name: emp.rows[0]?.name, sender_code: emp.rows[0]?.employee_code, reactions: [], seen_count: 0, delivered_count: 0 };
    emitToGroup(gid, 'message', full);
    res.json({ success: true, data: full });
  } catch (e) {
    console.error('[chat sendFile]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

// Edit message
exports.editMessage = async (req, res) => {
  try {
    const empId  = req.user.id;
    const msgId  = parseInt(req.params.id);
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, message: 'Content required' });
    const m = await db.query(`SELECT * FROM chat_messages WHERE id=$1`, [msgId]);
    if (!m.rows.length) return res.status(404).json({ success: false, message: 'Message not found' });
    if (m.rows[0].sender_id !== empId)
      return res.status(403).json({ success: false, message: 'Can only edit own messages' });
    const r = await db.query(
      `UPDATE chat_messages SET content=$1, edited_at=NOW() WHERE id=$2 RETURNING *`,
      [content.trim(), msgId]
    );
    emitToGroup(m.rows[0].group_id, 'messageEdited', { id: msgId, content: content.trim(), edited_at: r.rows[0].edited_at });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Delete for me only
exports.deleteForMe = async (req, res) => {
  try {
    const empId = req.user.id;
    const msgId = parseInt(req.params.id);
    await db.query(
      `UPDATE chat_messages SET deleted_for = array_append(COALESCE(deleted_for, '{}'::int[]), $1)
       WHERE id=$2 AND NOT ($1 = ANY(COALESCE(deleted_for, '{}'::int[])))`,
      [empId, msgId]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Delete for everyone
exports.deleteForEveryone = async (req, res) => {
  try {
    const empId = req.user.id;
    const msgId = parseInt(req.params.id);
    const m = await db.query(`SELECT * FROM chat_messages WHERE id=$1`, [msgId]);
    if (!m.rows.length) return res.status(404).json({ success: false, message: 'Message not found' });
    const msg = m.rows[0];

    // Allow sender within 1 hour, or admin always
    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    const mem   = await isGroupMember(msg.group_id, empId);
    if (msg.sender_id !== empId || ageMs > 3600000) {
      if (!mem || mem.role !== 'admin')
        return res.status(403).json({ success: false, message: 'Cannot delete this message for everyone' });
    }

    await db.query(
      `UPDATE chat_messages SET deleted_for_everyone=true, content='This message was deleted' WHERE id=$1`,
      [msgId]
    );
    emitToGroup(msg.group_id, 'messageDeletedForEveryone', { id: msgId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Mark messages delivered
exports.markDelivered = async (req, res) => {
  try {
    const empId = req.user.id;
    const { message_ids = [] } = req.body;
    if (!message_ids.length) return res.json({ success: true });
    for (const mid of message_ids) {
      await db.query(
        `INSERT INTO message_delivery_status(message_id, employee_id, delivered_at)
         VALUES($1,$2,NOW()) ON CONFLICT(message_id, employee_id) DO UPDATE SET delivered_at=NOW()`,
        [mid, empId]
      );
    }
    // Notify senders
    const senders = await db.query(
      `SELECT DISTINCT cm.sender_id, mds.message_id FROM chat_messages cm
       JOIN message_delivery_status mds ON mds.message_id=cm.id
       WHERE cm.id = ANY($1)`,
      [message_ids]
    );
    senders.rows.forEach(row => {
      emitToUser(row.sender_id, 'messageDelivered', { message_id: row.message_id, by: empId });
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Mark messages seen
exports.markSeen = async (req, res) => {
  try {
    const empId = req.user.id;
    const { group_id, message_ids } = req.body;

    if (group_id) {
      await db.query(`
        INSERT INTO chat_read_receipts(group_id, employee_id, read_at)
        VALUES($1,$2,NOW())
        ON CONFLICT(group_id, employee_id) DO UPDATE SET read_at=NOW()
      `, [group_id, empId]);
      await db.query(`
        INSERT INTO message_delivery_status(message_id, employee_id, delivered_at, seen_at)
        SELECT id, $1, NOW(), NOW()
        FROM chat_messages
        WHERE group_id=$2 AND sender_id != $1
        ON CONFLICT(message_id, employee_id) DO UPDATE SET seen_at=NOW()
      `, [empId, group_id]);
      // Emit to all senders in this group
      const senders = await db.query(
        `SELECT DISTINCT sender_id FROM chat_messages WHERE group_id=$1 AND sender_id != $2`,
        [group_id, empId]
      );
      senders.rows.forEach(row => {
        emitToUser(row.sender_id, 'messageSeen', { group_id, seen_by: empId });
      });
    }

    if (message_ids?.length) {
      for (const mid of message_ids) {
        await db.query(
          `INSERT INTO message_delivery_status(message_id, employee_id, delivered_at, seen_at)
           VALUES($1,$2,NOW(),NOW())
           ON CONFLICT(message_id, employee_id) DO UPDATE SET seen_at=NOW()`,
          [mid, empId]
        );
      }
      const senders = await db.query(
        `SELECT DISTINCT sender_id, id FROM chat_messages WHERE id = ANY($1)`,
        [message_ids]
      );
      senders.rows.forEach(row => {
        emitToUser(row.sender_id, 'messageSeen', { message_id: row.id, seen_by: empId });
      });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Search messages
exports.searchMessages = async (req, res) => {
  try {
    const empId = req.user.id;
    const gid   = parseInt(req.params.id);
    const { q } = req.query;
    if (!q?.trim()) return res.json({ success: true, data: [] });
    if (!await isGroupMember(gid, empId))
      return res.status(403).json({ success: false, message: 'Not a member' });

    const result = await db.query(`
      SELECT cm.id, cm.content, cm.message_type, cm.created_at,
        CONCAT(e.first_name,' ',e.last_name) AS sender_name
      FROM chat_messages cm
      JOIN employees e ON e.id=cm.sender_id
      WHERE cm.group_id=$1
        AND cm.deleted_for_everyone IS NOT TRUE
        AND cm.content ILIKE $2
      ORDER BY cm.created_at DESC LIMIT 50
    `, [gid, `%${q.trim()}%`]);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// REACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

exports.addReaction = async (req, res) => {
  try {
    const empId = req.user.id;
    const msgId = parseInt(req.params.id);
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ success: false, message: 'Emoji required' });

    const msg = await db.query(`SELECT group_id FROM chat_messages WHERE id=$1`, [msgId]);
    if (!msg.rows.length) return res.status(404).json({ success: false, message: 'Message not found' });

    // Toggle: remove if already reacted with same emoji
    const existing = await db.query(
      `SELECT id FROM message_reactions WHERE message_id=$1 AND employee_id=$2 AND emoji=$3`,
      [msgId, empId, emoji]
    );
    if (existing.rows.length) {
      await db.query(`DELETE FROM message_reactions WHERE message_id=$1 AND employee_id=$2 AND emoji=$3`, [msgId, empId, emoji]);
    } else {
      await db.query(
        `INSERT INTO message_reactions(message_id, employee_id, emoji) VALUES($1,$2,$3)
         ON CONFLICT(message_id, employee_id, emoji) DO NOTHING`,
        [msgId, empId, emoji]
      );
    }

    const reactions = await db.query(`
      SELECT mr.emoji, mr.employee_id, CONCAT(e.first_name,' ',e.last_name) AS name
      FROM message_reactions mr JOIN employees e ON e.id=mr.employee_id
      WHERE mr.message_id=$1
    `, [msgId]);

    emitToGroup(msg.rows[0].group_id, 'messageReaction', {
      message_id: msgId,
      reactions: reactions.rows,
      by: empId
    });
    res.json({ success: true, data: reactions.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PINNED MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

exports.pinMessage = async (req, res) => {
  try {
    const empId = req.user.id;
    const msgId = parseInt(req.params.id);
    const msg   = await db.query(`SELECT group_id FROM chat_messages WHERE id=$1`, [msgId]);
    if (!msg.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const gid = msg.rows[0].group_id;
    const mem = await isGroupMember(gid, empId);
    if (!mem || mem.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only admins can pin messages' });
    await db.query(
      `INSERT INTO pinned_messages(group_id, message_id, pinned_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [gid, msgId, empId]
    );
    emitToGroup(gid, 'messagePinned', { message_id: msgId, group_id: gid, pinned_by: empId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.unpinMessage = async (req, res) => {
  try {
    const empId = req.user.id;
    const msgId = parseInt(req.params.id);
    const msg   = await db.query(`SELECT group_id FROM chat_messages WHERE id=$1`, [msgId]);
    if (!msg.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const gid = msg.rows[0].group_id;
    const mem = await isGroupMember(gid, empId);
    if (!mem || mem.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only admins can unpin' });
    await db.query(`DELETE FROM pinned_messages WHERE group_id=$1 AND message_id=$2`, [gid, msgId]);
    emitToGroup(gid, 'messageUnpinned', { message_id: msgId, group_id: gid });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PRESENCE
// ═══════════════════════════════════════════════════════════════════════════════

exports.updatePresence = async (req, res) => {
  try {
    const empId = req.user.id;
    const { is_online } = req.body;
    await db.query(`
      INSERT INTO user_presence(employee_id, is_online, last_seen)
      VALUES($1,$2,NOW())
      ON CONFLICT(employee_id) DO UPDATE SET is_online=$2, last_seen=NOW()
    `, [empId, is_online !== false]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// Called via sendBeacon on tab/window close — marks user offline instantly
exports.markOffline = async (req, res) => {
  try {
    const empId = req.user?.id;
    if (!empId) return res.status(204).end();
    await db.query(
      `UPDATE user_presence SET is_online=false, last_seen=NOW() WHERE employee_id=$1`,
      [empId]
    );
    res.status(204).end();
  } catch (e) {
    res.status(204).end(); // sendBeacon ignores response, always return 204
  }
};

exports.deleteGroupForMe = async (req, res) => {
  try {
    const empId   = req.user.id;
    const groupId = parseInt(req.params.id);

    // 1. Mark all existing messages as "deleted for me" so history is hidden
    //    even if the user re-opens or DMs again later
    await db.query(
      `UPDATE chat_messages
       SET deleted_for = array_append(COALESCE(deleted_for, '{}'::int[]), $1)
       WHERE group_id=$2
         AND NOT ($1 = ANY(COALESCE(deleted_for, '{}'::int[])))`,
      [empId, groupId]
    );

    // 2. Set left_at AND deleted_at — left_at hides from listGroups, deleted_at is permanent
    //    Even if left_at gets reset by some other path, deleted_at keeps it hidden forever
    const r = await db.query(
      `UPDATE chat_group_members
       SET left_at = NOW(), deleted_at = NOW()
       WHERE group_id=$1 AND employee_id=$2
       RETURNING id`,
      [groupId, empId]
    );

    if (!r.rowCount) {
      // Member row didn't exist or already had left_at — still a success
      return res.json({ success: true, note: 'already removed' });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('[chat deleteGroupForMe]', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

exports.clearGroupMessages = async (req, res) => {
  try {
    const empId  = req.user.id;
    const groupId = parseInt(req.params.groupId);
    const mem = await db.query(`SELECT 1 FROM chat_group_members WHERE group_id=$1 AND employee_id=$2 AND left_at IS NULL`, [groupId, empId]);
    if (!mem.rows.length) return res.status(403).json({ success: false, message: 'Not a member' });
    await db.query(`DELETE FROM chat_messages WHERE group_id=$1`, [groupId]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

exports.getPresence = async (req, res) => {
  try {
    const { employee_ids } = req.query;
    const ids = (employee_ids || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.json({ success: true, data: [] });
    // Auto-expire: treat as offline if last_seen > 2 minutes ago (handles tab-close/crash)
    const result = await db.query(
      `SELECT employee_id,
              CASE WHEN is_online = true AND last_seen < NOW() - INTERVAL '2 minutes'
                   THEN false ELSE is_online END AS is_online,
              last_seen
       FROM user_presence WHERE employee_id = ANY($1)`,
      [ids]
    );
    // Also update stale rows to offline so next fetch is consistent
    await db.query(
      `UPDATE user_presence SET is_online = false
       WHERE employee_id = ANY($1) AND is_online = true AND last_seen < NOW() - INTERVAL '2 minutes'`,
      [ids]
    );
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO MEETINGS
// ═══════════════════════════════════════════════════════════════════════════════





exports.serveFile = async (req, res) => {
  try {
    const idOrName = req.params.filename;
    // Check if it's a pure numeric ID (may be too large for JS parseInt/32-bit int)
    const isNumericId = /^\d+$/.test(idOrName);

    if (isNumericId) {
      // New style: numeric ID → serve from DB (pass as string to avoid JS integer overflow)
      const r = await db.query(
        `SELECT original_name, mime_type, file_size, file_data FROM chat_file_data WHERE id=$1`, [idOrName]
      );
      if (!r.rows.length) return res.status(404).json({ success: false, message: 'File not found' });
      const { original_name, mime_type, file_data } = r.rows[0];
      res.setHeader('Content-Type', mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(original_name)}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(file_data);
    }

    // Legacy style: filename on disk (old uploads before this change)
    const uploadDir = require('path').join(__dirname, '..', '..', 'uploads', 'chat');
    const filePath  = require('path').join(uploadDir, idOrName);
    if (!require('fs').existsSync(filePath))
      return res.status(404).json({ success: false, message: 'File not found' });
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── DB Migration ─────────────────────────────────────────────────────────────
exports.migrate = async () => {
  // ── Step 1: CREATE tables if they don't exist at all ─────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS chat_groups (
      id          SERIAL PRIMARY KEY,
      name        TEXT,
      type        TEXT NOT NULL DEFAULT 'group',
      created_by  INT REFERENCES employees(id),
      invite_link TEXT UNIQUE,
      avatar_url  TEXT,
      description TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_group_members (
      id          SERIAL PRIMARY KEY,
      group_id    INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES employees(id),
      role        TEXT DEFAULT 'member',
      joined_at   TIMESTAMPTZ DEFAULT NOW(),
      left_at     TIMESTAMPTZ,
      UNIQUE(group_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id                  SERIAL PRIMARY KEY,
      group_id            INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      sender_id           INT NOT NULL REFERENCES employees(id),
      content             TEXT,
      message_type        TEXT DEFAULT 'text',
      file_name           TEXT,
      file_size           BIGINT,
      file_mime           TEXT,
      file_url            TEXT,
      reply_to_id         INT REFERENCES chat_messages(id),
      forwarded_from_id   INT REFERENCES chat_messages(id),
      mentions            INT[],
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      edited_at           TIMESTAMPTZ,
      deleted_for_everyone BOOLEAN DEFAULT FALSE,
      deleted_for         INT[] DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS chat_read_receipts (
      group_id    INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES employees(id),
      read_at     TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(group_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS chat_file_data (
      id            BIGSERIAL PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type     TEXT NOT NULL,
      file_size     BIGINT,
      file_data     BYTEA NOT NULL,
      uploaded_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_reactions (
      id          SERIAL PRIMARY KEY,
      message_id  INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES employees(id),
      emoji       TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(message_id, employee_id, emoji)
    );

    CREATE TABLE IF NOT EXISTS pinned_messages (
      id         SERIAL PRIMARY KEY,
      group_id   INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      message_id INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      pinned_by  INT REFERENCES employees(id),
      pinned_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(group_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS user_presence (
      employee_id INT PRIMARY KEY REFERENCES employees(id),
      is_online   BOOLEAN DEFAULT FALSE,
      last_seen   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_delivery_status (
      message_id   INT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      employee_id  INT NOT NULL REFERENCES employees(id),
      delivered_at TIMESTAMPTZ,
      seen_at      TIMESTAMPTZ,
      PRIMARY KEY(message_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS chat_group_mutes (
      group_id    INT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      employee_id INT NOT NULL REFERENCES employees(id),
      muted_at    TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY(group_id, employee_id)
    );
  `);

  // ── Step 2: ALTER existing tables — safely add any missing columns ────────
  // These run every deploy; IF NOT EXISTS means they're no-ops if column exists.
  const alters = [
    // chat_groups — columns added in v2 upgrade
    `ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS invite_link  TEXT`,
    `ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS avatar_url   TEXT`,
    `ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS description  TEXT`,

    // chat_messages — columns added in v2 upgrade
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id        INT REFERENCES chat_messages(id)`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS forwarded_from_id  INT REFERENCES chat_messages(id)`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mentions            INT[]`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at           TIMESTAMPTZ`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_for_everyone BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_for         INT[] DEFAULT '{}'`,

    // chat_meetings — scheduled_meeting_id added in v2
    // chat_group_members — role column (may have been added later)
    `ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS role       TEXT DEFAULT 'member'`,
    `ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS left_at    TIMESTAMPTZ`,
    `ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,

    // Ensure invite_link unique constraint (safe — CREATE UNIQUE INDEX IF NOT EXISTS)
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_groups_invite_link ON chat_groups(invite_link) WHERE invite_link IS NOT NULL`,
  ];

  for (const sql of alters) {
    try { await db.query(sql); }
    catch (e) { console.warn('[chat migrate] ALTER skipped:', e.message); }
  }

  // ── Step 3: Indexes ───────────────────────────────────────────────────────
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_group   ON chat_messages(group_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_members_emp      ON chat_group_members(employee_id) WHERE left_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_msg_reactions_msg     ON message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_msg_delivery_msg      ON message_delivery_status(message_id);
    CREATE INDEX IF NOT EXISTS idx_pinned_group          ON pinned_messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_meet_group  ON scheduled_meetings(group_id, scheduled_at);
  `);

  console.log('✅ Chat tables migrated (v3 — ALTER TABLE safe upgrade)');
};

// ─── Call Log ──────────────────────────────────────────────────────────────────

// GET /api/chat/call-log  — returns call history for the logged-in user
