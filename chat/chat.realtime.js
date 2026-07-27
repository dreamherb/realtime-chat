const { Server } = require("socket.io");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const authService = require("../auth/auth.service");
const chatService = require("./chat.service");
const notificationsService = require("../notifications/notifications.service");

const ROOM_PREFIX = "room:";
const USER_PREFIX = "user:";
// ponytail: 푸시 HTTP 동시성 상한. 100명 그룹에서 오프라인만 대상으로도 충분. Redis/BullMQ로 올리면 이 제한은 worker 쪽으로 이동.
const PUSH_CONCURRENCY = 5;

function roomChannel(roomId) {
  return ROOM_PREFIX + roomId;
}

function userChannel(userId) {
  return USER_PREFIX + userId;
}

async function runWithConcurrency(items, concurrency, fn) {
  if (!items.length) return;
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]);
    }
  }
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

async function listOfflineUserIds(userIds) {
  if (!ioInstance || !userIds.length) return userIds;

  const offline = [];
  await runWithConcurrency(userIds, PUSH_CONCURRENCY, async (userId) => {
    // 해당 대시보드가 활성화된 탭이나 기기에 접속중인 유저, 즉, 온라인인지 확인, 오프라인에만 푸시 알림 전송
    const sockets = await ioInstance.in(userChannel(userId)).fetchSockets();
    if (sockets.length === 0) {
      offline.push(userId);
    }
  });
  return offline;
}

/**
 * 메시지 전송 경로와 분리된 fire-and-forget 푸시.
 * - 소켓 접속 중(온라인) 유저는 message:new로 이미 수신 → 푸시 생략
 * - title은 방 1회 조회, 수신자별 getRoomSummaryForUser 제거
 */
async function notifyPushForMessage(roomId, senderId, message) {
  if (!notificationsService.isPushConfigured() || !message) return;

  if (message.type === "SYSTEM_JOIN" || message.type === "SYSTEM_LEAVE") return;

  const preview = chatService.formatMessagePreview(
    message.type,
    message.from,
    message.text,
  );
  if (!preview) return;

  try {
    const memberIds = await chatService.listActiveRoomMemberIds(roomId);
    const candidates = memberIds.filter(
      (memberId) => memberId !== Number(senderId),
    );
    const recipients = await listOfflineUserIds(candidates);
    if (!recipients.length) return;

    const title = await chatService.getPushTitleForRoom(roomId, message.from);
    const body = `${message.from}: ${preview}`;
    const payload = {
      title,
      body,
      tag: `chat-${roomId}-msg-${message.id}`,
      url: `/dashboard?roomId=${roomId}`,
    };

    await runWithConcurrency(recipients, PUSH_CONCURRENCY, async (memberId) => {
      const result = await notificationsService.sendPushToUser(
        memberId,
        payload,
      );
      if (process.env.NODE_ENV === "development") {
        console.log("[push] message notify", {
          roomId,
          messageId: message.id,
          memberId,
          result,
        });
      }
    });
  } catch (error) {
    console.error("[socket] notifyPushForMessage error:", error.stack);
  }
}

// 모듈 전역에서 attach 이후 접근 가능하도록 보관
let ioInstance = null;

function getIo() {
  return ioInstance;
}

async function authenticate(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = cookie.parse(cookieHeader);
    const token = cookies.usi;

    if (!token) {
      return next(new Error("UNAUTHORIZED"));
    }

    const jwtSecret = process.env.JWT_ACCESS_SECRET;
    if (!jwtSecret) {
      return next(new Error("JWT_SECRET_MISSING"));
    }

    const payload = jwt.verify(token, jwtSecret);
    const userId = payload?.id;

    if (!userId) {
      return next(new Error("UNAUTHORIZED"));
    }

    const user = await authService.findUserById(userId);
    if (!user) {
      return next(new Error("UNAUTHORIZED"));
    }

    socket.data.user = {
      id: user.id,
      nickname: user.nickname,
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

  socket.on("message:send", async ({ roomId, content } = {}, ack) => {
    try {
      const numericRoomId = Number(roomId);
      if (!Number.isFinite(numericRoomId)) {
        return ack?.({ ok: false, message: "유효하지 않은 채팅방입니다." });
      }

      const result = await chatService.createMessage({
        roomId: numericRoomId,
        senderId: user.id,
        content,
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

      notifyPushForMessage(numericRoomId, user.id, result.message);

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

function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cookie: false,
    serveClient: true,
  });

  io.use(authenticate);

  io.on("connection", (socket) => {
    bindHandlers(io, socket);
  });

  ioInstance = io;
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
