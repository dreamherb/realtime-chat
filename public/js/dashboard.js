const roomId = window.__DASHBOARD__.roomId;
const currentUser = window.__DASHBOARD__.currentUser;
let lastMessageId = window.__DASHBOARD__.lastMessageId || 0;

const unreadByRoom = new Map();
const seenMessageIds = new Set();

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

function formatMessagePreview(message) {
  if (message.type === "SYSTEM_JOIN") {
    return `${message.from}님이 입장했습니다.`;
  }
  if (message.type === "SYSTEM_LEAVE") {
    return `${message.from}님이 퇴장했습니다.`;
  }
  const text = String(message.text || "").trim();
  if (!text) return "";
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function applyUnreadState($item, unreadCount, preview) {
  const count = Number(unreadCount) || 0;
  if (count <= 0) {
    $item.removeClass("roomlist__item--unread");
    $item.attr("data-unread-count", "0");
    $item.find(".roomlist__item-preview").prop("hidden", true).text("");
    $item.find(".roomlist__badge").prop("hidden", true).text("");
    syncTitleBadge();
    return;
  }

  $item.addClass("roomlist__item--unread");
  $item.attr("data-unread-count", String(count));
  $item.find(".roomlist__item-preview").text(preview || "").prop("hidden", false);
  $item
    .find(".roomlist__badge")
    .text(count > 99 ? "99+" : String(count))
    .prop("hidden", false);
  syncTitleBadge();
}

function syncTitleBadge() {
  if (window.ChatNotifications) {
    ChatNotifications.updateTitleBadge(unreadByRoom);
  }
}

function buildRoomListItemHtml(room, isActive) {
  const id = Number(room.id);
  const prefix = room.type === "DM" ? "" : "# ";
  const unreadCount = Number(room.unreadCount) || 0;
  const unreadClass = unreadCount > 0 && !isActive ? " roomlist__item--unread" : "";
  const previewHtml = room.unreadPreview
    ? `<span class="roomlist__item-preview">${escapeHtml(room.unreadPreview)}</span>`
    : '<span class="roomlist__item-preview" hidden></span>';
  const badgeHtml =
    unreadCount > 0
      ? `<span class="roomlist__badge" aria-label="읽지 않은 메시지">${unreadCount > 99 ? "99+" : unreadCount}</span>`
      : '<span class="roomlist__badge" hidden aria-label="읽지 않은 메시지"></span>';

  return `
    <a class="roomlist__item${isActive ? " is-active" : ""}${unreadClass}" href="/dashboard?roomId=${id}" data-room-id="${id}" data-unread-count="${unreadCount}">
      <span class="roomlist__item-body">
        <span class="roomlist__item-name">${escapeHtml(prefix + room.name)}</span>
        ${previewHtml}
      </span>
      ${badgeHtml}
    </a>`;
}

const $roomList = $(".sidebar .roomlist").first();
const $messages = $("#messages");
const $form = $("#messageForm");
const $input = $("#messageText");
const COMPOSER_MAX_LINES = 5;

function resizeComposer(el) {
  if (!el) return;
  el.style.height = "auto";
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight);
  const paddingTop = parseFloat(style.paddingTop);
  const paddingBottom = parseFloat(style.paddingBottom);
  const maxHeight = lineHeight * COMPOSER_MAX_LINES + paddingTop + paddingBottom;
  const nextHeight = Math.min(el.scrollHeight, maxHeight);
  el.style.height = `${nextHeight}px`;
  el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

function resetComposer() {
  const el = $input[0];
  if (!el) return;
  $input.val("");
  el.style.height = "auto";
  el.style.overflowY = "hidden";
  resizeComposer(el);
}

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
  markCurrentRoomRead();
}

function getRoomListItem(targetRoomId) {
  return $roomList.find(`[data-room-id="${Number(targetRoomId)}"]`);
}

function markCurrentRoomRead() {
  if (!roomId) return;

  const id = Number(roomId);
  unreadByRoom.delete(id);
  applyUnreadState(getRoomListItem(id), 0, "");
  socket.emit("room:read", { roomId: id });
}

function updateRoomNotification(targetRoomId, message) {
  const id = Number(targetRoomId);
  if (id === Number(roomId)) return;

  const preview = formatMessagePreview(message);
  if (!preview) return;

  const $item = getRoomListItem(id);
  const prevCount = Number($item.attr("data-unread-count")) || unreadByRoom.get(id)?.count || 0;
  const count = prevCount + 1;
  unreadByRoom.set(id, { count, preview });

  if (!$item.length) return;

  applyUnreadState($item, count, preview);
  $roomList.prepend($item);
}

function handleIncomingMessage(msgRoomId, message, room) {
  if (!message) return;
  if (message.id) {
    if (seenMessageIds.has(message.id)) return;
    seenMessageIds.add(message.id);
  }

  if (room) {
    addRoomToSidebar(room);
  }

  if (Number(msgRoomId) === Number(roomId)) {
    appendMessage(message);
    notifyIncomingMessage(msgRoomId, message, room);
    return;
  }

  updateRoomNotification(msgRoomId, message);
  notifyIncomingMessage(msgRoomId, message, room);
}

function notifyIncomingMessage(msgRoomId, message, room) {
  if (!window.ChatNotifications) return;
  ChatNotifications.show(msgRoomId, message, room);
}

function removeRoomFromSidebar(targetRoomId) {
  const id = Number(targetRoomId);
  unreadByRoom.delete(id);
  $roomList.find(`[data-room-id="${id}"]`).remove();
  if (!$roomList.find(".roomlist__item").length) {
    $roomList.find(".roomlist__empty").remove();
    $roomList.prepend(
      '<p class="muted roomlist__empty">참여 중인 채팅방이 없습니다.</p>',
    );
  }
}

function ensureJoinableSection() {
  let $section = $(".roomlist--joinable");
  if ($section.length) return $section;

  const $sidebar = $(".sidebar");
  const $title = $('<h3 class="roomlist__section-title">참여 가능한 그룹</h3>');
  $section = $('<nav class="roomlist roomlist--joinable"></nav>');
  $sidebar.append($title).append($section);
  return $section;
}

function buildJoinableGroupHtml(group) {
  const id = Number(group.id);
  return `
    <div class="roomlist__joinable-item" data-room-id="${id}">
      <span class="roomlist__joinable-name"># ${escapeHtml(group.name)}</span>
      <button
        class="btn btn--secondary btn--xs js-join-group"
        type="button"
        data-room-id="${id}"
      >참여</button>
    </div>`;
}

function removeJoinableGroupFromSidebar(targetRoomId) {
  const id = Number(targetRoomId);
  const $section = $(".roomlist--joinable");
  if (!$section.length) return;

  $section.find(`[data-room-id="${id}"]`).remove();
  if (!$section.find(".roomlist__joinable-item").length) {
    $section.prev(".roomlist__section-title").remove();
    $section.remove();
  }
}

function addJoinableGroupToSidebar(group) {
  if (!group || !group.id) return;
  const id = Number(group.id);
  if (getRoomListItem(id).length) return;

  const $section = ensureJoinableSection();
  if ($section.find(`[data-room-id="${id}"]`).length) return;

  $section.prepend(buildJoinableGroupHtml(group));
}

function addRoomToSidebar(room) {
  if (!room || !room.id) return;
  const id = Number(room.id);
  if (getRoomListItem(id).length) return;

  removeJoinableGroupFromSidebar(id);
  $roomList.find(".roomlist__empty").remove();
  const isActive = roomId && Number(roomId) === id;
  const unreadCount = isActive ? 0 : Number(room.unreadCount) || 0;
  const roomData = { ...room, unreadCount, unreadPreview: isActive ? null : room.unreadPreview };
  $roomList.prepend(buildRoomListItemHtml(roomData, isActive));

  if (unreadCount > 0 && room.unreadPreview) {
    unreadByRoom.set(id, { count: unreadCount, preview: room.unreadPreview });
  }
}

function initRoomListUnread() {
  const rooms = window.__DASHBOARD__.rooms || [];
  for (const room of rooms) {
    const id = Number(room.id);
    if (id === Number(roomId)) continue;

    const count = Number(room.unreadCount) || 0;
    if (count <= 0) continue;

    unreadByRoom.set(id, {
      count,
      preview: room.unreadPreview || "",
    });

    const $item = getRoomListItem(id);
    if ($item.length) {
      applyUnreadState($item, count, room.unreadPreview);
    }
  }
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
    markCurrentRoomRead();
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

socket.on("message:new", ({ roomId: msgRoomId, message }) => {
  handleIncomingMessage(msgRoomId, message);
});

socket.on("message:incoming", ({ roomId: incomingRoomId, message, room }) => {
  handleIncomingMessage(incomingRoomId, message, room);
});

socket.on("room:added", ({ room }) => {
  addRoomToSidebar(room);
  if (room?.id) {
    socket.emit("room:join", { roomId: room.id });
  }
});

socket.on("group:joinable", ({ group }) => {
  addJoinableGroupToSidebar(group);
});

socket.on("room:left", ({ roomId: leftRoomId }) => {
  removeRoomFromSidebar(leftRoomId);
  if (Number(leftRoomId) === Number(roomId)) {
    window.location.href = "/dashboard";
  }
});

if (window.ChatNotifications) {
  ChatNotifications.init({
    currentUser,
    currentRoomId: roomId,
    baseTitle: document.title,
    getRoomName(targetRoomId) {
      const $item = getRoomListItem(targetRoomId);
      return $item.find(".roomlist__item-name").text().trim() || "새 메시지";
    },
    formatPreview: formatMessagePreview,
  });
}

initRoomListUnread();
syncTitleBadge();

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
      resetComposer();
    });
  });

  $input.on("input", function () {
    resizeComposer(this);
  });

  $input.on("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $form.trigger("submit");
    }
  });

  resizeComposer($input[0]);
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

$(document).on("click", ".js-logout", function () {
  const $btn = $(this);
  $btn.prop("disabled", true);

  $.ajax({
    url: "/auth/logout",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify({}),
    success: function (data) {
      if (!data.success) {
        $btn.prop("disabled", false);
        return showAlertModal(data.message || "로그아웃에 실패했습니다.");
      }
      window.location.href = data.redirectUrl || "/";
    },
    error: function (xhr) {
      $btn.prop("disabled", false);
      try {
        const res = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
        showAlertModal(res.message || "로그아웃에 실패했습니다.");
      } catch {
        showAlertModal("로그아웃 처리 중 오류가 발생했습니다.");
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
