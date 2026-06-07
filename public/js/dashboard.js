const roomId = window.__DASHBOARD__.roomId;
const currentUser = window.__DASHBOARD__.currentUser;
let lastMessageId = window.__DASHBOARD__.lastMessageId || 0;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMessageHtml(msg) {
  if (msg.type === "SYSTEM_JOIN" || msg.type === "SYSTEM_LEAVE") {
    const verb = msg.type === "SYSTEM_JOIN" ? "입장" : "퇴장";
    const text = `${msg.from}님이 ${verb}했습니다.`;
    return `
      <div class="msg msg--system">
        <span class="msg--system__body">${escapeHtml(text)}</span>
        <span class="msg--system__time">${escapeHtml(msg.time)}</span>
      </div>`;
  }

  const isMe = msg.from === currentUser;
  const cls = isMe ? "msg msg--me" : "msg";
  return `
    <article class="${cls}">
      <div class="msg__meta">${escapeHtml(msg.from)} · ${escapeHtml(msg.time)}</div>
      <div class="msg__body">${escapeHtml(msg.text)}</div>
    </article>`;
}

// 채팅방 실시간 통신 (roomId 있을 때만)
if (roomId) {
  const $messages = $("#messages");
  const $form = $("#messageForm");
  const $input = $("#messageText");

  function scrollToBottom() {
    $messages.scrollTop($messages[0].scrollHeight);
  }

  function appendMessage(msg) {
    if (!msg || (msg.id && msg.id <= lastMessageId)) return;
    $messages.find("p.muted").remove();
    $messages.append(buildMessageHtml(msg));
    if (msg.id > lastMessageId) {
      lastMessageId = msg.id;
    }
    scrollToBottom();
  }

  scrollToBottom();

  // socket.io 연결 (usi 쿠키로 인증)
  const socket = io({
    transports: ["websocket", "polling"],
    withCredentials: true,
  });

  socket.on("connect", () => {
    socket.emit("room:join", { roomId }, (res) => {
      if (!res?.ok) {
        showAlertModal(res?.message || "채팅방 참여에 실패했습니다.");
      }
    });
  });

  socket.on("connect_error", (err) => {
    if (err && err.message === "UNAUTHORIZED") {
      window.location.href = "/";
      return;
    }
    console.error("[socket] connect_error:", err?.message || err);
  });

  socket.on("disconnect", (reason) => {
    console.warn("[socket] disconnected:", reason);
  });

  // 일반 메시지 + 시스템 메시지(입장/퇴장) 모두 message:new로 수신
  socket.on("message:new", ({ message }) => {
    appendMessage(message);
  });

  // 다른 탭/디바이스에서 이 방을 나갔을 때 자동으로 대시보드로 이동
  socket.on("room:left", ({ roomId: leftRoomId }) => {
    if (Number(leftRoomId) === Number(roomId)) {
      window.location.href = "/dashboard";
    }
  });

  $form.on("submit", function (e) {
    e.preventDefault();
    const content = $input.val().trim();
    if (!content) return;

    $input.prop("disabled", true);

    socket.emit("message:send", { roomId, content }, (res) => {
      $input.prop("disabled", false).focus();

      if (!res?.ok) {
        return showAlertModal(res?.message || "전송에 실패했습니다.");
      }

      appendMessage(res.message);
      $input.val("");
    });
  });

  $input.on("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $form.trigger("submit");
    }
  });

  $(window).on("beforeunload", function () {
    socket.disconnect();
  });
}

// 채팅방 나가기
$(document).on("click", ".js-leave-room", function () {
  const $btn = $(this);
  const targetRoomId = $btn.data("room-id");
  if (!targetRoomId) return;

  if (!window.confirm("이 채팅방에서 나가시겠습니까? 다시 초대받거나 참여해야 합니다.")) {
    return;
  }

  $btn.prop("disabled", true);

  $.ajax({
    url: `/api/rooms/${targetRoomId}/leave`,
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({}),
    success: function (data) {
      if (!data.success) {
        $btn.prop("disabled", false);
        return showAlertModal(data.message || "퇴장에 실패했습니다.");
      }
      window.location.href = data.redirectUrl || "/dashboard";
    },
    error: function (xhr) {
      $btn.prop("disabled", false);
      try {
        const res = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(res.message || "퇴장에 실패했습니다.");
      } catch {
        showAlertModal("퇴장 처리 중 오류가 발생했습니다.");
      }
    },
  });
});

// 그룹 참여 버튼 (roomId 없어도 항상 활성)
$(document).on("click", ".js-join-group", function () {
  const $btn = $(this);
  const targetRoomId = $btn.data("room-id");
  if (!targetRoomId) return;

  $btn.prop("disabled", true);

  $.ajax({
    url: `/api/rooms/${targetRoomId}/join`,
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({}),
    success: function (data) {
      if (!data.success) {
        $btn.prop("disabled", false);
        return showAlertModal(data.message || "참여에 실패했습니다.");
      }
      window.location.href = data.redirectUrl || `/dashboard?roomId=${targetRoomId}`;
    },
    error: function (xhr) {
      $btn.prop("disabled", false);
      try {
        const res = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(res.message || "참여에 실패했습니다.");
      } catch {
        showAlertModal("그룹 참여 중 오류가 발생했습니다.");
      }
    },
  });
});
