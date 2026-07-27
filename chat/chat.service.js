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
      END AS display_name,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
      ) AS unread_count,
      (
        SELECT m.type
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_type,
      (
        SELECT m.content
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_text,
      (
        SELECT u.nickname
        FROM messages m
        INNER JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_from
    FROM chat_rooms r
    INNER JOIN chat_room_members crm ON crm.room_id = r.id
    WHERE crm.user_id = ? AND crm.left_at IS NULL
    ORDER BY r.created_at DESC
  `;

  const [rows] = await pool.query(sql, [
    ROOM_TYPE.DM,
    userId,
    userId,
    userId,
    userId,
    userId,
    userId,
  ]);

  return rows
    .map((row) => {
      const unreadCount = Number(row.unread_count) || 0;
      return {
        id: row.id,
        type: row.type,
        name: row.display_name,
        unreadCount,
        unreadPreview:
          unreadCount > 0
            ? formatMessagePreview(
                row.preview_type,
                row.preview_from,
                row.preview_text,
              )
            : null,
      };
    })
    .sort((a, b) => {
      const aUnread = a.unreadCount > 0 ? 1 : 0;
      const bUnread = b.unreadCount > 0 ? 1 : 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return Number(b.id) - Number(a.id);
    });
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

  const [rows] = await pool.query(sql, [userId, otherUserId, ROOM_TYPE.DM]);

  return rows[0]?.id ?? null;
}

async function isRoomMember(roomId, userId) {
  const sql =
    "SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1";
  const [rows] = await pool.query(sql, [roomId, userId]);
  return rows.length > 0;
}

/**
 * DM 한정: 떠난 멤버 행을 복원합니다.
 * - left_at NULL로 활성화
 * - joined_at을 갱신하여 떠난 기간 동안의 메시지는 보이지 않게 처리
 */
async function restoreDmMembership(roomId, userId) {
  await pool.query(
    `UPDATE chat_room_members
     SET left_at = NULL, joined_at = NOW(), last_read_message_id = 0
     WHERE room_id = ? AND user_id = ? AND left_at IS NOT NULL`,
    [roomId, userId],
  );
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

  // 양쪽이 한 번이라도 멤버였던 방을 찾음 (left_at 무관)
  const existingRoomId = await findExistingDmRoom(creatorId, targetUserId);
  if (existingRoomId) {
    // 내가 나간 상태라면 조용히 복원 (joined_at 갱신으로 떠난 기간 메시지 숨김)
    if (!(await isRoomMember(existingRoomId, creatorId))) {
      await restoreDmMembership(existingRoomId, creatorId);
    }

    let targetRestored = false;
    if (!(await isRoomMember(existingRoomId, targetUserId))) {
      await restoreDmMembership(existingRoomId, targetUserId);
      targetRestored = true;
    }

    return { ok: true, roomId: existingRoomId, existing: true, targetRestored };
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
  // 활성 멤버(left_at IS NULL)만 기준으로 집계:
  // - 본인이 활성 멤버인 방은 제외 (떠난 적 있는 방은 다시 노출)
  // - 활성 멤버가 0명인 빈 그룹은 후보에서 제외
  const sql = `
    SELECT
      r.id,
      r.name,
      r.created_at,
      (
        SELECT COUNT(*) FROM chat_room_members
        WHERE room_id = r.id AND left_at IS NULL
      ) AS member_count
    FROM chat_rooms r
    WHERE r.type = ?
      AND r.id NOT IN (
        SELECT room_id FROM chat_room_members
        WHERE user_id = ? AND left_at IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM chat_room_members
        WHERE room_id = r.id AND left_at IS NULL
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
    "SELECT type FROM chat_rooms WHERE id = ?",
    [roomId],
  );
  if (!roomRows.length) {
    return { ok: false, reason: "ROOM_NOT_FOUND" };
  }

  // DM/그룹 모두 soft-leave (left_at 갱신) — 데이터·상대 멤버십 보존, 재참여 시 복원
  const [result] = await pool.query(
    "UPDATE chat_room_members SET left_at = NOW() WHERE room_id = ? AND user_id = ? AND left_at IS NULL",
    [roomId, userId],
  );

  if (result.affectedRows === 0) {
    return { ok: false, reason: "NOT_MEMBER" };
  }

  return { ok: true, roomType: roomRows[0].type };
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

  // 신규 가입이면 INSERT, 이전에 나갔던 row(left_at NOT NULL)가 있으면 복원
  // uq_room_user UNIQUE 키 덕분에 ON DUPLICATE KEY UPDATE가 한 번에 두 경우를 처리
  await pool.query(
    `INSERT INTO chat_room_members (room_id, user_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE joined_at = NOW(), left_at = NULL`,
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

function formatMessagePreview(type, from, text) {
  if (type === MESSAGE_TYPE.SYSTEM_JOIN) {
    return `${from}님이 입장했습니다.`;
  }
  if (type === MESSAGE_TYPE.SYSTEM_LEAVE) {
    return `${from}님이 퇴장했습니다.`;
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return trimmed.length > 42 ? `${trimmed.slice(0, 42)}…` : trimmed;
}

async function markRoomAsRead(roomId, userId) {
  const [memberRows] = await pool.query(
    "SELECT joined_at FROM chat_room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1",
    [roomId, userId],
  );
  if (!memberRows.length) return;

  const joinedAt = memberRows[0].joined_at;

  const [maxRows] = await pool.query(
    `SELECT COALESCE(MAX(id), 0) AS max_id
     FROM messages
     WHERE room_id = ? AND created_at >= ?`,
    [roomId, joinedAt],
  );

  await pool.query(
    `UPDATE chat_room_members
     SET last_read_message_id = ?
     WHERE room_id = ? AND user_id = ? AND left_at IS NULL`,
    [maxRows[0].max_id, roomId, userId],
  );
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
  // 떠난 멤버(left_at IS NOT NULL)는 빈 결과로 처리
  const [memberRows] = await pool.query(
    "SELECT joined_at FROM chat_room_members WHERE room_id = ? AND user_id = ? AND left_at IS NULL LIMIT 1",
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
    type:
      kind === "JOIN" ? MESSAGE_TYPE.SYSTEM_JOIN : MESSAGE_TYPE.SYSTEM_LEAVE,
    content: "",
  });
}

async function getRoomDisplayName(roomId, userId) {
  const sql = `
    SELECT
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
    WHERE r.id = ? AND crm.user_id = ? AND crm.left_at IS NULL
    LIMIT 1
  `;
  const [rows] = await pool.query(sql, [ROOM_TYPE.DM, userId, roomId, userId]);
  return rows[0]?.display_name ?? null;
}

/** 푸시 title용: 방 1건만 조회. DM은 발신자 nickname, GROUP은 방 이름. */
async function getPushTitleForRoom(roomId, senderNickname) {
  const [rows] = await pool.query(
    "SELECT type, COALESCE(name, '그룹 채팅') AS name FROM chat_rooms WHERE id = ? LIMIT 1",
    [roomId],
  );
  const room = rows[0];
  if (!room) return "새 메시지";
  if (room.type === ROOM_TYPE.DM) return senderNickname || "새 메시지";
  return room.name || "그룹 채팅";
}

async function getRoomSummaryForUser(roomId, userId) {
  const sql = `
    SELECT
      r.id,
      r.type,
      CASE
        WHEN r.type = ? THEN (
          SELECT u.nickname
          FROM chat_room_members crm2
          INNER JOIN users u ON u.id = crm2.user_id
          WHERE crm2.room_id = r.id AND crm2.user_id <> ?
          LIMIT 1
        )
        ELSE COALESCE(r.name, '그룹 채팅')
      END AS display_name,
      (
        SELECT COUNT(*)
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
      ) AS unread_count,
      (
        SELECT m.type
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_type,
      (
        SELECT m.content
        FROM messages m
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_text,
      (
        SELECT u.nickname
        FROM messages m
        INNER JOIN users u ON u.id = m.sender_id
        WHERE m.room_id = r.id
          AND m.id > COALESCE(crm.last_read_message_id, 0)
          AND m.created_at >= crm.joined_at
          AND m.sender_id <> ?
        ORDER BY m.id DESC
        LIMIT 1
      ) AS preview_from
    FROM chat_rooms r
    INNER JOIN chat_room_members crm ON crm.room_id = r.id
    WHERE r.id = ? AND crm.user_id = ? AND crm.left_at IS NULL
    LIMIT 1
  `;

  const [rows] = await pool.query(sql, [
    ROOM_TYPE.DM,
    userId,
    userId,
    userId,
    userId,
    userId,
    roomId,
    userId,
  ]);

  const row = rows[0];
  if (!row) return null;

  const unreadCount = Number(row.unread_count) || 0;
  return {
    id: row.id,
    type: row.type,
    name: row.display_name,
    unreadCount,
    unreadPreview:
      unreadCount > 0
        ? formatMessagePreview(
            row.preview_type,
            row.preview_from,
            row.preview_text,
          )
        : null,
  };
}

/** 소켓 채널 join용 — unread/preview 없이 room_id만 */
async function listActiveRoomIdsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT room_id
     FROM chat_room_members
     WHERE user_id = ? AND left_at IS NULL`,
    [userId],
  );
  return rows.map((row) => Number(row.room_id));
}

async function getDmPeerUserId(roomId, userId) {
  const sql = `
    SELECT crm.user_id
    FROM chat_rooms r
    INNER JOIN chat_room_members crm
      ON crm.room_id = r.id AND crm.left_at IS NULL
    WHERE r.id = ? AND r.type = ? AND crm.user_id <> ?
    LIMIT 1
  `;
  const [rows] = await pool.query(sql, [roomId, ROOM_TYPE.DM, userId]);
  return rows[0]?.user_id ?? null;
}

/**
 * DM 메시지 전송 시 상대가 나간 상태면 멤버십을 복원합니다.
 * @returns {{ peerId: number|null, peerRestored: boolean }}
 */
async function ensureDmPeerForMessage(roomId, senderId) {
  const sql = `
    SELECT crm.user_id, (crm.left_at IS NOT NULL) AS has_left
    FROM chat_rooms r
    INNER JOIN chat_room_members crm ON crm.room_id = r.id
    WHERE r.id = ? AND r.type = ? AND crm.user_id <> ?
    LIMIT 1
  `;
  const [rows] = await pool.query(sql, [roomId, ROOM_TYPE.DM, senderId]);
  const peer = rows[0];
  if (!peer) {
    return { peerId: null, peerRestored: false };
  }

  if (peer.has_left) {
    await restoreDmMembership(roomId, peer.user_id);
    return { peerId: peer.user_id, peerRestored: true };
  }

  return { peerId: peer.user_id, peerRestored: false };
}

async function listActiveRoomMemberIds(roomId) {
  const [rows] = await pool.query(
    `SELECT user_id
     FROM chat_room_members
     WHERE room_id = ? AND left_at IS NULL`,
    [roomId],
  );
  return rows.map((row) => Number(row.user_id));
}

module.exports = {
  ROOM_TYPE,
  MESSAGE_TYPE,
  listRoomsForUser,
  listActiveRoomIdsForUser,
  listActiveRoomMemberIds,
  findExistingDmRoom,
  isRoomMember,
  createDmRoom,
  createGroupRoom,
  getMessagesForRoom,
  getRoomDisplayName,
  getPushTitleForRoom,
  getRoomSummaryForUser,
  getDmPeerUserId,
  ensureDmPeerForMessage,
  createMessage,
  createSystemMessage,
  listJoinableGroups,
  joinGroup,
  leaveRoom,
  markRoomAsRead,
  formatMessageTime,
  formatMessagePreview,
};
