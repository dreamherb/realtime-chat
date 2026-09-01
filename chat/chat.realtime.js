const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const cookie = require("cookie");
const { SESSION_COOKIE, authenticateAccessToken } = require("../auth/auth.middleware");
const { onSessionReplaced } = require("../auth/auth.sessions");
const chatService = require("./chat.service");
const { notifyPushForMessage } = require("./chat.push");
const {
  getRedisClient,
  createRedisDuplicate,
} = require("../infrastructure/redis/redis.client");
const presence = require("../infrastructure/redis/redis.presence");
const {
  publishChatMessageCreated,
} = require("../infrastructure/sqs/sqs.producer");
const { isSqsEnabled } = require("../infrastructure/sqs/sqs.client");

const sendRateByUser = new Map();
const RATE_MAX = 5;
const RATE_WINDOW_MS = 1000;
const BAN_MS = 5000;

// ponytail: 프로세스 메모리. ASG면 Redis(userId)로 옮기면 됨.
function consumeSend(state, now = Date.now()) {
  const next = {
    times: Array.isArray(state?.times) ? state.times.slice() : [],
    bannedUntil: Number(state?.bannedUntil) || 0,
  };

  if (now < next.bannedUntil) {
    return {
      ok: false,
      state: next,
      retryAfterMs: next.bannedUntil - now,
    };
  }

  next.times = next.times.filter((t) => now - t < RATE_WINDOW_MS);
  if (next.times.length >= RATE_MAX) {
    next.bannedUntil = now + BAN_MS;
    return { ok: false, state: next, retryAfterMs: BAN_MS };
  }

  next.times.push(now);
  return { ok: true, state: next, retryAfterMs: 0 };
}

function roomChannel(roomId) {
  return "room:" + roomId;
}

function userChannel(userId) {
  return "user:" + userId;
}

async function listOfflineViaSockets(userIds) {
  if (!ioInstance || !userIds.length) return userIds;

  const offline = [];
  await Promise.all(
    userIds.map(async (userId) => {
      const sockets = await ioInstance.in(userChannel(userId)).fetchSockets();
      if (sockets.length === 0) offline.push(userId);
    }),
  );
  return offline;
}

async function enqueueOrPushMessage(roomId, senderId, message) {
  if (isSqsEnabled()) {
    const published = await publishChatMessageCreated({
      roomId,
      senderId,
      message,
    });
    if (published.ok) return;
  }

  // SQS 미설정/발행 실패 시 기존 경로로 폴백
  notifyPushForMessage(roomId, senderId, message, {
    fallbackOfflineIds: listOfflineViaSockets,
  });
}

// 모듈 전역에서 attach 이후 접근 가능하도록 보관
let ioInstance = null;

function getIo() {
  return ioInstance;
}

async function authenticate(socket, next) {
  try {
    const cookies = cookie.parse(socket.handshake.headers.cookie || "");
    const result = await authenticateAccessToken(cookies[SESSION_COOKIE]);
    if (!result.ok || !result.payload?.id) {
      return next(new Error("UNAUTHORIZED"));
    }

    socket.data.user = {
      id: result.payload.id,
      nickname: result.payload.nickname,
    };
    return next();
  } catch (error) {
    console.error("[socket] auth error:", error.message);
    return next(new Error("UNAUTHORIZED"));
  }
}

function bindHandlers(io, socket) {
  const user = socket.data.user;

  // 사용자 단위 채널에 자동 가입 (멀티탭/디바이스 일괄 제어용)
  socket.join(userChannel(user.id));
  presence.markOnline(user.id).catch((error) => {
    console.error("[socket] presence online error:", error.message);
  });

  socket.on("disconnect", () => {
    presence.markOffline(user.id).catch((error) => {
      console.error("[socket] presence offline error:", error.message);
    });
  });

  // 참여 중인 모든 방 socket 채널 가입 (다른 방 메시지 수신용)
  chatService
    .listActiveRoomIdsForUser(user.id)
    .then((roomIds) => {
      for (const id of roomIds) {
        socket.join(roomChannel(id));
      }
    })
    .catch((error) => {
      console.error("[socket] join member rooms error:", error.stack);
    });

  socket.on("room:join", async ({ roomId } = {}, ack) => {
    try {
      const numericRoomId = Number(roomId);
      if (!Number.isFinite(numericRoomId)) {
        return ack?.({ ok: false, message: "유효하지 않은 채팅방입니다." });
      }

      const isMember = await chatService.isRoomMember(numericRoomId, user.id);
      if (!isMember) {
        return ack?.({ ok: false, message: "멤버가 아닙니다." });
      }

      socket.join(roomChannel(numericRoomId));
      ack?.({ ok: true });
    } catch (error) {
      console.error("[socket] room:join error:", error.stack);
      ack?.({ ok: false, message: "참여 처리 중 오류가 발생했습니다." });
    }
  });

  socket.on("room:leave", ({ roomId } = {}, ack) => {
    const numericRoomId = Number(roomId);
    if (Number.isFinite(numericRoomId)) {
      socket.leave(roomChannel(numericRoomId));
    }
    ack?.({ ok: true });
  });

  socket.on("room:read", async ({ roomId } = {}, ack) => {
    try {
      const numericRoomId = Number(roomId);
      if (!Number.isFinite(numericRoomId)) {
        return ack?.({ ok: false, message: "유효하지 않은 채팅방입니다." });
      }

      const isMember = await chatService.isRoomMember(numericRoomId, user.id);
      if (!isMember) {
        return ack?.({ ok: false, message: "멤버가 아닙니다." });
      }

      await chatService.markRoomAsRead(numericRoomId, user.id);
      ack?.({ ok: true });
    } catch (error) {
      console.error("[socket] room:read error:", error.stack);
      ack?.({ ok: false, message: "읽음 처리 중 오류가 발생했습니다." });
    }
  });

  socket.on("message:send", async ({ roomId, content, clientMsgId } = {}, ack) => {
    try {
      const safeClientMsgId =
        typeof clientMsgId === "string" && clientMsgId.length <= 36
          ? clientMsgId
          : null;
      const alreadySaved =
        safeClientMsgId &&
        (await chatService.findMessageByClientMsgId(user.id, safeClientMsgId));

      if (!alreadySaved) {
        const rated = consumeSend(sendRateByUser.get(user.id));
        sendRateByUser.set(user.id, rated.state);
        if (!rated.ok) {
          return ack?.({
            ok: false,
            code: "RATE_LIMITED",
            message: "채팅이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
            retryAfterMs: rated.retryAfterMs,
          });
        }
      }

      const numericRoomId = Number(roomId);
      if (!Number.isFinite(numericRoomId)) {
        return ack?.({ ok: false, message: "유효하지 않은 채팅방입니다." });
      }

      const result = alreadySaved
        ? { ok: true, message: alreadySaved }
        : await chatService.createMessage({
            roomId: numericRoomId,
            senderId: user.id,
            content,
            clientMsgId: safeClientMsgId,
          });

      if (!result.ok) {
        if (result.reason === "NOT_MEMBER") {
          return ack?.({ ok: false, message: "멤버가 아닙니다." });
        }
        if (result.reason === "EMPTY_CONTENT") {
          return ack?.({ ok: false, message: "메시지를 입력해주세요." });
        }
        return ack?.({ ok: false, message: "전송에 실패했습니다." });
      }

      io.to(roomChannel(numericRoomId)).emit("message:new", {
        roomId: numericRoomId,
        message: result.message,
      });

      if (!alreadySaved) {
        enqueueOrPushMessage(numericRoomId, user.id, result.message);
      }

      const { peerId } = await chatService.ensureDmPeerForMessage(
        numericRoomId,
        user.id,
      );
      if (peerId) {
        const room = await chatService.getRoomSummaryForUser(
          numericRoomId,
          peerId,
        );
        io.to(userChannel(peerId)).emit("message:incoming", {
          roomId: numericRoomId,
          message: result.message,
          room,
        });
      }

      ack?.({ ok: true, message: result.message });
    } catch (error) {
      console.error("[socket] message:send error:", error.stack);
      ack?.({ ok: false, message: "메시지 전송 중 오류가 발생했습니다." });
    }
  });
}

async function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cookie: false,
    serveClient: true
  });

  // Redis adapter: Node 인스턴스를 여러 개 띄워도 room broadcast가 공유됨
  const redisPub = await getRedisClient();
  if (redisPub) {
    const redisSub = await createRedisDuplicate();
    if (redisSub) {
      io.adapter(createAdapter(redisPub, redisSub));
      if (process.env.NODE_ENV === "development") {
        console.log("[socket] redis adapter enabled");
      }
    }
  }

  io.use(authenticate);

  io.on("connection", (socket) => {
    bindHandlers(io, socket);
  });

  ioInstance = io;
  onSessionReplaced(({ userId, platform }) => {
    io.to(userChannel(userId)).emit("session:replaced", { platform });
  });
  return io;
}

/**
 * 새 멤버 가입 처리:
 * 1) DB에 SYSTEM_JOIN 메시지 저장 (새로고침해도 보이도록 영속화)
 * 2) 채팅방의 현재 접속자에게 message:new로 broadcast
 */
async function notifyRoomMemberJoined(roomId, actorId) {
  if (!ioInstance) return;
  try {
    const message = await chatService.createSystemMessage({
      roomId,
      actorId,
      kind: "JOIN",
    });
    ioInstance.to(roomChannel(roomId)).emit("message:new", {
      roomId,
      message,
    });
  } catch (error) {
    console.error("[socket] notifyRoomMemberJoined error:", error.stack);
  }
}

/**
 * 멤버 퇴장 처리:
 * 1) 퇴장자의 모든 소켓을 room에서 leave (이후 broadcast 수신 차단)
 * 2) announce=true일 때만 DB에 SYSTEM_LEAVE 저장 + 남은 멤버에 broadcast
 *    (DM은 announce=false로 호출하여 시스템 메시지를 띄우지 않음)
 * 3) 퇴장자의 모든 탭에 room:left push → 자동 /dashboard 이동
 */
/**
 * 새 DM 방 생성 시 수신자에게 사이드바 갱신용 이벤트를 push합니다.
 */
async function notifyDmRoomCreated(roomId, recipientUserId) {
  if (!ioInstance) return;
  try {
    const room = await chatService.getRoomSummaryForUser(
      roomId,
      recipientUserId,
    );
    if (!room) return;

    ioInstance.to(userChannel(recipientUserId)).emit("room:added", { room });
  } catch (error) {
    console.error("[socket] notifyDmRoomCreated error:", error.stack);
  }
}

/**
 * 새 그룹 생성 시:
 * 1) 생성자의 다른 탭에 room:added push
 * 2) 그 외 접속 중인 대시보드에 group:joinable push
 */
async function notifyGroupCreated(roomId, creatorId, groupName) {
  if (!ioInstance) return;
  try {
    const room = await chatService.getRoomSummaryForUser(roomId, creatorId);
    if (room) {
      ioInstance.to(userChannel(creatorId)).emit("room:added", { room });
    }

    ioInstance.except(userChannel(creatorId)).emit("group:joinable", {
      group: {
        id: roomId,
        name: groupName || room?.name || "그룹 채팅",
        memberCount: 1,
      },
    });
  } catch (error) {
    console.error("[socket] notifyGroupCreated error:", error.stack);
  }
}

async function notifyRoomMemberLeft(userId, roomId, { announce = true } = {}) {
  if (!ioInstance) return;
  const userRoom = userChannel(userId);
  try {
    ioInstance.in(userRoom).socketsLeave(roomChannel(roomId));

    if (announce) {
      const message = await chatService.createSystemMessage({
        roomId,
        actorId: userId,
        kind: "LEAVE",
      });
      ioInstance.to(roomChannel(roomId)).emit("message:new", {
        roomId,
        message,
      });
    }

    ioInstance.to(userRoom).emit("room:left", { roomId });
  } catch (error) {
    console.error("[socket] notifyRoomMemberLeft error:", error.stack);
  }
}

module.exports = {
  attachRealtime,
  getIo,
  notifyDmRoomCreated,
  notifyGroupCreated,
  notifyRoomMemberJoined,
  notifyRoomMemberLeft,
};
