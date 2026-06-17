const { Server } = require("socket.io");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const authService = require("../auth/auth.service");
const chatService = require("./chat.service");

const ROOM_PREFIX = "room:";
const USER_PREFIX = "user:";

function roomChannel(roomId) {
  return ROOM_PREFIX + roomId;
}

function userChannel(userId) {
  return USER_PREFIX + userId;
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
    .listRoomsForUser(user.id)
    .then((rooms) => {
      for (const room of rooms) {
        socket.join(roomChannel(room.id));
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
  notifyRoomMemberJoined,
  notifyRoomMemberLeft,
};
