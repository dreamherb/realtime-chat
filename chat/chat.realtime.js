const { Server } = require("socket.io");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const authService = require("../auth/auth.service");
const chatService = require("./chat.service");

const ROOM_PREFIX = "room:";

function roomChannel(roomId) {
  return ROOM_PREFIX + roomId;
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

  return io;
}

module.exports = {
  attachRealtime,
};
