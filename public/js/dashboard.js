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

const $roomList = $(".sidebar .roomlist").first();
const $messages = $("#messages");
const $form = $("#messageForm");
const $input = $("#messageText");

function scrollToBottom() {
  if (!$messages.length) return;
  $messages.scrollTop($messages[0].scrollHeight);
}

function appendMessage(msg) {
  if (!msg || !$messages.length) return;
  if (msg.id && msg.id <= lastMessageId) return;
  $messages.find("p.muted").remove();
  $messages.append(buildMessageHtml(msg));
  if (msg.id > lastMessageId) {
    lastMessageId = msg.id;
  }
  scrollToBottom();
}

function removeRoomFromSidebar(targetRoomId) {
  const id = Number(targetRoomId);
  $roomList.find(`[data-room-id="${id}"]`).remove();
  if (!$roomList.find(".roomlist__item").length) {
    $roomList.find(".roomlist__empty").remove();
    $roomList.prepend(
      '<p class="muted roomlist__empty">참여 중인 채팅방이 없습니다.</p>',
    );
  }
}

function addRoomToSidebar(room) {
  if (!room || !room.id) return;
  const id = Number(room.id);
  if ($roomList.find(`[data-room-id="${id}"]`).length) return;

  $roomList.find(".roomlist__empty").remove();
  const prefix = room.type === "DM" ? "" : "# ";
  const isActive = roomId && Number(roomId) === id;
  const $link = $(
    `<a class="roomlist__item${isActive ? " is-active" : ""}" href="/dashboard?roomId=${id}" data-room-id="${id}">${escapeHtml(prefix + room.name)}</a>`,
  );
  $roomList.prepend($link);
}

// 대시보드 전역 소켓 (usi 쿠키로 인증)
const socket = io({
  transports: ["websocket", "polling"],
  withCredentials: true,
});

socket.on("connect", () => {
  if (roomId) {
    socket.emit("room:join", { roomId }, (res) => {
      if (!res?.ok) {
        showAlertModal(res?.message || "채팅방 참여에 실패했습니다.");
      }
    });
  }
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

// 방을 열고 있을 때: room 채널 수신
socket.on("message:new", ({ message }) => {
  appendMessage(message);
});

// 다른 방이거나 방을 아직 열지 않았을 때: user 채널 수신
socket.on("message:incoming", ({ roomId: incomingRoomId, message, room }) => {
  
  if (room) {
    addRoomToSidebar(room);
  }
  if (Number(incomingRoomId) === Number(roomId)) {
    appendMessage(message);
  }
});

socket.on("room:added", ({ room }) => {
  console.log("room:added room: ", room);
  addRoomToSidebar(room);
});

socket.on("room:left", ({ roomId: leftRoomId }) => {
  removeRoomFromSidebar(leftRoomId);
  if (Number(leftRoomId) === Number(roomId)) {
    window.location.href = "/dashboard";
  }
});

if (roomId) {
  scrollToBottom();

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
}

$(window).on("beforeunload", function () {
  socket.disconnect();
});

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
