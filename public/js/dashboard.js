const roomId = window.__DASHBOARD__.roomId;
const currentUser = window.__DASHBOARD__.currentUser;
const currentUserId = window.__DASHBOARD__.currentUserId;

function numericId(id) {
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

let lastMessageId = numericId(window.__DASHBOARD__.lastMessageId);

const unreadByRoom = new Map();
const seenMessageIds = new Set();
const inFlightClientMsgIds = new Set();

function newClientMsgId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
  const pending = Boolean(msg.pending);
  const cls = `msg${isMe ? " msg--me" : ""}${pending ? " msg--pending" : ""}`;
  const clientAttr = msg.clientMsgId
    ? ` data-client-msg-id="${escapeHtml(msg.clientMsgId)}"`
    : "";
  const timeLabel = pending ? `${msg.time} · 전송 대기` : msg.time;
  return `
    <article class="${cls}"${clientAttr}>
      <div class="msg__meta">${escapeHtml(msg.from)} · ${escapeHtml(timeLabel)}</div>
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
  if (msg.clientMsgId) {
    removePendingMessage(msg.clientMsgId);
  }
  const id = numericId(msg.id);
  if (id && id <= lastMessageId) return;
  $messages.find("p.muted").remove();
  $messages.append(buildMessageHtml(msg));
  if (id > lastMessageId) {
    lastMessageId = id;
  }
  scrollToBottom();
  markCurrentRoomRead();
}

function removePendingMessage(clientMsgId) {
  if (!clientMsgId || !$messages.length) return;
  // 확정 메시지에도 data-client-msg-id가 있음. pending만 지워야 함.
  $messages.find(`.msg--pending[data-client-msg-id="${clientMsgId}"]`).remove();
}

function appendPendingRow(row) {
  if (!row || Number(row.roomId) !== Number(roomId)) return;
  if ($messages.find(`[data-client-msg-id="${row.clientMsgId}"]`).length) return;
  $messages.find("p.muted").remove();
  $messages.append(
    buildMessageHtml({
      from: row.from,
      time: row.time,
      text: row.text,
      pending: true,
      clientMsgId: row.clientMsgId,
    }),
  );
  scrollToBottom();
}

function settlePending(clientMsgId, message, msgRoomId) {
  if (clientMsgId) {
    removePendingMessage(clientMsgId);
    if (window.ChatOutbox) {
      window.ChatOutbox.removePending(clientMsgId);
    }
    inFlightClientMsgIds.delete(clientMsgId);
  }
  if (message && Number(msgRoomId) === Number(roomId)) {
    appendMessage(message);
  }
}

function pendingTimeLabel() {
  return new Date().toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emitOutboxRow(row, skipClientRate) {
  if (!row?.clientMsgId || inFlightClientMsgIds.has(row.clientMsgId)) return;
  if (!skipClientRate && !tryConsumeChatSend()) {
    showChatToast(CHAT_RATE_MESSAGE);
    return;
  }

  inFlightClientMsgIds.add(row.clientMsgId);
  const releaseTimer = setTimeout(() => {
    inFlightClientMsgIds.delete(row.clientMsgId);
  }, 20000);

  socket.emit(
    "message:send",
    { roomId: row.roomId, content: row.text, clientMsgId: row.clientMsgId },
    (res) => {
      clearTimeout(releaseTimer);
      if (!res?.ok) {
        inFlightClientMsgIds.delete(row.clientMsgId);
        if (res?.code === "RATE_LIMITED") {
          applyChatBan(res.retryAfterMs || CHAT_BAN_MS);
          showChatToast(res.message || CHAT_RATE_MESSAGE);
          return;
        }
        if (res?.message) showAlertModal(res.message);
        return;
      }
      settlePending(row.clientMsgId, res.message, row.roomId);
    },
  );
}

async function restorePendingForCurrentRoom() {
  if (!roomId || !currentUserId || !window.ChatOutbox) return;
  const rows = await window.ChatOutbox.listPendingForRoom(currentUserId, roomId);
  for (const row of rows) {
    if ($messages.find(`[data-client-msg-id="${row.clientMsgId}"]`).length) {
      await window.ChatOutbox.removePending(row.clientMsgId);
      continue;
    }
    appendPendingRow(row);
  }
}

async function flushOutbox() {
  if (!currentUserId || !window.ChatOutbox || !socket.connected) return;
  const rows = await window.ChatOutbox.listPendingForUser(currentUserId);
  for (const row of rows) {
    emitOutboxRow(row, true);
  }
}

function getRoomListItem(targetRoomId) {
  return $roomList.find(`[data-room-id="${Number(targetRoomId)}"]`);
}

// ponytail: 연속 message:new 마다 DB UPDATE 치지 않도록 디바운스. 탭 닫을 때는 pagehide에서 flush.
const READ_DEBOUNCE_MS = 2000;
let readFlushTimer = null;
let pendingReadRoomId = null;

function flushRoomRead() {
  if (pendingReadRoomId == null) return;
  const id = pendingReadRoomId;
  pendingReadRoomId = null;
  if (readFlushTimer) {
    clearTimeout(readFlushTimer);
    readFlushTimer = null;
  }
  socket.emit("room:read", { roomId: id });
}

function markCurrentRoomRead() {
  if (!roomId) return;

  const id = Number(roomId);
  unreadByRoom.delete(id);
  applyUnreadState(getRoomListItem(id), 0, "");

  pendingReadRoomId = id;
  if (readFlushTimer) clearTimeout(readFlushTimer);
  readFlushTimer = setTimeout(() => {
    readFlushTimer = null;
    flushRoomRead();
  }, READ_DEBOUNCE_MS);
}

window.addEventListener("pagehide", flushRoomRead);

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
  if (message.clientMsgId) {
    removePendingMessage(message.clientMsgId);
    if (window.ChatOutbox) {
      window.ChatOutbox.removePending(message.clientMsgId);
    }
    inFlightClientMsgIds.delete(message.clientMsgId);
  }
  const seenKey = message.id != null ? String(message.id) : "";
  if (seenKey && seenMessageIds.has(seenKey)) return;
  if (seenKey) {
    seenMessageIds.add(seenKey);
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
  flushOutbox();
});

$(window).on("online", flushOutbox);

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

socket.on("session:replaced", () => {
  const go = () => {
    window.location.href = "/auth/logout";
  };
  if (window.ChatNotifications?.releaseDevice) {
    ChatNotifications.releaseDevice().finally(go);
    return;
  }
  go();
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

const CHAT_RATE_MAX = 5;
const CHAT_RATE_WINDOW_MS = 1000;
const CHAT_BAN_MS = 5000;
const CHAT_RATE_MESSAGE =
  "채팅이 너무 빠릅니다. 잠시 후 다시 시도해주세요.";
const chatSendTimes = [];
let chatBannedUntil = 0;
let chatToastTimer;

function showChatToast(message) {
  const el = document.getElementById("chatToast");
  if (!el) {
    return showAlertModal(message);
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.remove("is-visible");
  void el.offsetWidth; // 애니메이션 실행 CSS 변경 감지를 위한 트릭
  el.classList.add("is-visible");
  clearTimeout(chatToastTimer);
  chatToastTimer = setTimeout(() => {
    el.classList.remove("is-visible");
    el.hidden = true;
  }, 2600);
}

function applyChatBan(retryAfterMs) {
  const until = Date.now() + Math.max(Number(retryAfterMs) || 0, 0);
  if (until > chatBannedUntil) chatBannedUntil = until;
}

function tryConsumeChatSend() {
  const now = Date.now();
  if (now < chatBannedUntil) return false;
  while (chatSendTimes.length && now - chatSendTimes[0] >= CHAT_RATE_WINDOW_MS) {
    chatSendTimes.shift();
  }
  if (chatSendTimes.length >= CHAT_RATE_MAX) {
    applyChatBan(CHAT_BAN_MS);
    return false;
  }
  chatSendTimes.push(now);
  return true;
}

if (roomId) {
  scrollToBottom();
  restorePendingForCurrentRoom();

  $form.on("submit", function (e) {
    e.preventDefault();
    const content = $input.val().trim();
    if (!content) return;

    if (!tryConsumeChatSend()) {
      showChatToast(CHAT_RATE_MESSAGE);
      return;
    }

    const clientMsgId = newClientMsgId();
    const row = {
      clientMsgId,
      userId: Number(currentUserId),
      roomId: Number(roomId),
      from: currentUser,
      text: content,
      time: pendingTimeLabel(),
      createdAt: Date.now(),
    };

    resetComposer();
    appendPendingRow(row);
    const persist = window.ChatOutbox
      ? window.ChatOutbox.putPending(row)
      : Promise.resolve();
    persist.finally(() => emitOutboxRow(row, true));
  });

  $input.on("input", function () {
    resizeComposer(this);
  });

  $input.on("keydown", function (e) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // 한글 IME: Enter 1회에 keydown이 두 번 옴(229 조합 확정 + 실제 Enter).
    // 가드 없으면 본문 전송 직후 마지막 글자가 입력창에 남고 한 번 더 전송됨.
    // 한글은 글자 입력 중 끝맺지 않은 구간 (composition 상태)일 수 있음.
    // composition 상태일 때 음절 확정 keydown한번 후 실제 엔터 한번 더 옴.
    if (e.isComposing || e.originalEvent?.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    $form.trigger("submit");
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

  const logout = function () {
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
  };

  if (window.ChatNotifications?.releaseDevice) {
    ChatNotifications.releaseDevice().finally(logout);
    return;
  }
  logout();
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
