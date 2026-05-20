const { pool } = require("../infrastructure/database");

const ROOM_TYPE = {
  DM: "DM",
  GROUP: "GROUP",
};

async function listRoomsForUser(userId) {
  const sql = `
    SELECT
      r.id,
      r.type,
      r.name,
      r.created_at,
      CASE
        WHEN r.type = ? THEN (
          SELECT u.nickname
          FROM chat_room_members crm2
          INNER JOIN users u ON u.id = crm2.user_id
          WHERE crm2.room_id = r.id AND crm2.user_id <> ?
          LIMIT 1
        )
        ELSE COALESCE(r.name, '그룹 채팅')
      END AS display_name
    FROM chat_rooms r
    INNER JOIN chat_room_members crm ON crm.room_id = r.id
    WHERE crm.user_id = ?
    ORDER BY r.created_at DESC
  `;

  const [rows] = await pool.query(sql, [ROOM_TYPE.DM, userId, userId]);

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.display_name,
  }));
}

async function findExistingDmRoom(userId, otherUserId) {
  const sql = `
    SELECT r.id
    FROM chat_rooms r
    INNER JOIN chat_room_members m1 ON m1.room_id = r.id AND m1.user_id = ?
    INNER JOIN chat_room_members m2 ON m2.room_id = r.id AND m2.user_id = ?
    WHERE r.type = ?
    LIMIT 1
  `;

  const [rows] = await pool.query(sql, [
    userId,
    otherUserId,
    ROOM_TYPE.DM,
  ]);

  return rows[0]?.id ?? null;
}

async function isRoomMember(roomId, userId) {
  const sql =
    "SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ? LIMIT 1";
  const [rows] = await pool.query(sql, [roomId, userId]);
  return rows.length > 0;
}

async function createRoomWithMembers({ type, name, createdBy, memberIds }) {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [roomResult] = await conn.query(
      "INSERT INTO chat_rooms (type, name, created_by) VALUES (?, ?, ?)",
      [type, name, createdBy],
    );
    const roomId = roomResult.insertId;

    const uniqueMemberIds = [
      ...new Set([createdBy, ...memberIds].map((id) => Number(id))),
    ];

    for (const memberId of uniqueMemberIds) {
      await conn.query(
        "INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)",
        [roomId, memberId],
      );
    }

    await conn.commit();
    return roomId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function createDmRoom(creatorId, targetUserId) {
  if (creatorId === targetUserId) {
    return { ok: false, reason: "SELF_DM" };
  }

  const existingRoomId = await findExistingDmRoom(creatorId, targetUserId);
  if (existingRoomId) {
    return { ok: true, roomId: existingRoomId, existing: true };
  }

  const roomId = await createRoomWithMembers({
    type: ROOM_TYPE.DM,
    name: null,
    createdBy: creatorId,
    memberIds: [targetUserId],
  });

  return { ok: true, roomId, existing: false };
}

async function createGroupRoom(creatorId, name) {
  const roomId = await createRoomWithMembers({
    type: ROOM_TYPE.GROUP,
    name,
    createdBy: creatorId,
    memberIds: [],
  });

  return { ok: true, roomId };
}

function formatMessageTime(createdAt) {
  const date = new Date(createdAt);
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mapMessageRow(row) {
  return {
    id: row.id,
    senderId: row.sender_id,
    from: row.sender_nickname,
    time: formatMessageTime(row.created_at),
    text: row.content,
  };
}

async function getMessagesForRoom(roomId, userId, { sinceId } = {}) {
  const member = await isRoomMember(roomId, userId);
  if (!member) {
    return [];
  }

  const params = [roomId];
  let whereSince = "";
  if (sinceId) {
    whereSince = " AND m.id > ?";
    params.push(Number(sinceId));
  }

  const sql = `
    SELECT m.id, m.sender_id, m.content, m.created_at, u.nickname AS sender_nickname
    FROM messages m
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.room_id = ?${whereSince}
    ORDER BY m.id ASC
    LIMIT 200
  `;

  const [rows] = await pool.query(sql, params);
  return rows.map(mapMessageRow);
}

async function createMessage({ roomId, senderId, content }) {
  const member = await isRoomMember(roomId, senderId);
  if (!member) {
    return { ok: false, reason: "NOT_MEMBER" };
  }

  const trimmed = String(content || "").trim();
  if (!trimmed) {
    return { ok: false, reason: "EMPTY_CONTENT" };
  }

  const [insertResult] = await pool.query(
    "INSERT INTO messages (room_id, sender_id, content) VALUES (?, ?, ?)",
    [roomId, senderId, trimmed],
  );

  const [rows] = await pool.query(
    `SELECT m.id, m.sender_id, m.content, m.created_at, u.nickname AS sender_nickname
     FROM messages m
     INNER JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [insertResult.insertId],
  );

  return { ok: true, message: mapMessageRow(rows[0]) };
}

async function getRoomDisplayName(roomId, userId) {
  const rooms = await listRoomsForUser(userId);
  const room = rooms.find((r) => r.id === Number(roomId));
  return room?.name ?? null;
}

module.exports = {
  ROOM_TYPE,
  listRoomsForUser,
  findExistingDmRoom,
  isRoomMember,
  createDmRoom,
  createGroupRoom,
  getMessagesForRoom,
  getRoomDisplayName,
  createMessage,
};
