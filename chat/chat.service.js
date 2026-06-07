const { pool } = require("../infrastructure/database");

const ROOM_TYPE = {
  DM: "DM",
  GROUP: "GROUP",
};

const MESSAGE_TYPE = {
  TEXT: "TEXT",
  SYSTEM_JOIN: "SYSTEM_JOIN",
  SYSTEM_LEAVE: "SYSTEM_LEAVE",
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

async function listJoinableGroups(userId) {
  const sql = `
    SELECT
      r.id,
      r.name,
      r.created_at,
      (SELECT COUNT(*) FROM chat_room_members WHERE room_id = r.id) AS member_count
    FROM chat_rooms r
    WHERE r.type = ?
      AND r.id NOT IN (
        SELECT room_id FROM chat_room_members WHERE user_id = ?
      )
    ORDER BY r.created_at DESC
    LIMIT 50
  `;

  const [rows] = await pool.query(sql, [ROOM_TYPE.GROUP, userId]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name || "그룹 채팅",
    memberCount: Number(row.member_count),
  }));
}

async function leaveRoom(roomId, userId) {
  const [roomRows] = await pool.query(
    "SELECT id FROM chat_rooms WHERE id = ?",
    [roomId],
  );
  if (!roomRows.length) {
    return { ok: false, reason: "ROOM_NOT_FOUND" };
  }

  const [result] = await pool.query(
    "DELETE FROM chat_room_members WHERE room_id = ? AND user_id = ?",
    [roomId, userId],
  );

  if (result.affectedRows === 0) {
    return { ok: false, reason: "NOT_MEMBER" };
  }

  return { ok: true };
}

async function joinGroup(roomId, userId) {
  const [roomRows] = await pool.query(
    "SELECT type FROM chat_rooms WHERE id = ?",
    [roomId],
  );
  const room = roomRows[0];

  if (!room) {
    return { ok: false, reason: "ROOM_NOT_FOUND" };
  }

  if (room.type !== ROOM_TYPE.GROUP) {
    return { ok: false, reason: "NOT_JOINABLE" };
  }

  const alreadyMember = await isRoomMember(roomId, userId);
  if (alreadyMember) {
    return { ok: true, roomId, alreadyMember: true };
  }

  await pool.query(
    "INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?)",
    [roomId, userId],
  );

  return { ok: true, roomId, alreadyMember: false };
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
    type: row.type || MESSAGE_TYPE.TEXT,
    senderId: row.sender_id,
    from: row.sender_nickname,
    time: formatMessageTime(row.created_at),
    text: row.content,
  };
}

async function getMessagesForRoom(roomId, userId) {
  // 본인의 joined_at을 가져와 그 이후 메시지만 노출 (입장 전 기록 숨김)
  const [memberRows] = await pool.query(
    "SELECT joined_at FROM chat_room_members WHERE room_id = ? AND user_id = ? LIMIT 1",
    [roomId, userId],
  );

  if (!memberRows.length) {
    return [];
  }

  const joinedAt = memberRows[0].joined_at;

  const sql = `
    SELECT m.id, m.type, m.sender_id, m.content, m.created_at, u.nickname AS sender_nickname
    FROM messages m
    INNER JOIN users u ON u.id = m.sender_id
    WHERE m.room_id = ? AND m.created_at >= ?
    ORDER BY m.id ASC
    LIMIT 200
  `;

  const [rows] = await pool.query(sql, [roomId, joinedAt]);
  return rows.map(mapMessageRow);
}

async function insertMessageRow({ roomId, senderId, type, content }) {
  const [insertResult] = await pool.query(
    "INSERT INTO messages (room_id, sender_id, type, content) VALUES (?, ?, ?, ?)",
    [roomId, senderId, type, content],
  );

  const [rows] = await pool.query(
    `SELECT m.id, m.type, m.sender_id, m.content, m.created_at, u.nickname AS sender_nickname
     FROM messages m
     INNER JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [insertResult.insertId],
  );

  return mapMessageRow(rows[0]);
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

  const message = await insertMessageRow({
    roomId,
    senderId,
    type: MESSAGE_TYPE.TEXT,
    content: trimmed,
  });

  return { ok: true, message };
}

/**
 * 입장/퇴장 시스템 메시지를 messages 테이블에 저장합니다.
 * sender_id는 행위자(입장자/퇴장자) user.id, content는 빈 문자열.
 */
async function createSystemMessage({ roomId, actorId, kind }) {
  return insertMessageRow({
    roomId,
    senderId: actorId,
    type: kind === "JOIN" ? MESSAGE_TYPE.SYSTEM_JOIN : MESSAGE_TYPE.SYSTEM_LEAVE,
    content: "",
  });
}

async function getRoomDisplayName(roomId, userId) {
  const rooms = await listRoomsForUser(userId);
  const room = rooms.find((r) => r.id === Number(roomId));
  return room?.name ?? null;
}

module.exports = {
  ROOM_TYPE,
  MESSAGE_TYPE,
  listRoomsForUser,
  findExistingDmRoom,
  isRoomMember,
  createDmRoom,
  createGroupRoom,
  getMessagesForRoom,
  getRoomDisplayName,
  createMessage,
  createSystemMessage,
  listJoinableGroups,
  joinGroup,
  leaveRoom,
  formatMessageTime,
};
