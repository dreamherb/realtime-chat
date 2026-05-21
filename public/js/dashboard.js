const POLL_INTERVAL_MS = 2500;

const roomId = window.__DASHBOARD__.roomId;
const currentUser = window.__DASHBOARD__.currentUser;
let lastMessageId = window.__DASHBOARD__.lastMessageId || 0;
let pollTimer = null;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMessageHtml(msg) {
  const isMe = msg.from === currentUser;
  const cls = isMe ? "msg msg--me" : "msg";
  return `
    <article class="${cls}">
      <div class="msg__meta">${escapeHtml(msg.from)} · ${escapeHtml(msg.time)}</div>
      <div class="msg__body">${escapeHtml(msg.text)}</div>
    </article>`;
}

// 채팅방 메시지 폴링/전송 (roomId 있을 때만)
if (roomId) {
  const $messages = $("#messages");
  const $form = $("#messageForm");
  const $input = $("#messageText");

  function scrollToBottom() {
    $messages.scrollTop($messages[0].scrollHeight);
  }

  scrollToBottom();

  function pollNewMessages() {
    $.ajax({
      url: `/api/rooms/${roomId}/messages`,
      type: "GET",
      data: { sinceId: lastMessageId },
      success: function (data) {
        if (!data.success || !data.messages.length) return;

        $messages.find("p.muted").remove();

        data.messages.forEach(function (msg) {
          $messages.append(buildMessageHtml(msg));
          if (msg.id > lastMessageId) {
            lastMessageId = msg.id;
          }
        });

        scrollToBottom();
      },
      error: function (xhr) {
        if (xhr.status === 401) {
          clearInterval(pollTimer);
          window.location.href = "/";
        }
      },
    });
  }

  pollTimer = setInterval(pollNewMessages, POLL_INTERVAL_MS);

  $form.on("submit", function (e) {
    e.preventDefault();
    const content = $input.val().trim();
    if (!content) return;

    $input.prop("disabled", true);

    $.ajax({
      url: `/api/rooms/${roomId}/messages`,
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ content }),
      success: function (data) {
        if (!data.success) {
          return showAlertModal(data.message || "전송에 실패했습니다.");
        }

        $messages.find("p.muted").remove();
        $messages.append(buildMessageHtml(data.message));
        if (data.message.id > lastMessageId) {
          lastMessageId = data.message.id;
        }

        scrollToBottom();
        $input.val("");
      },
      error: function (xhr) {
        try {
          const res = xhr.responseJSON || JSON.parse(xhr.responseText || "{}");
          showAlertModal(res.message || "전송에 실패했습니다.");
        } catch {
          showAlertModal("메시지 전송 중 오류가 발생했습니다.");
        }
      },
      complete: function () {
        $input.prop("disabled", false).focus();
      },
    });
  });

  $input.on("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $form.trigger("submit");
    }
  });

  $(window).on("beforeunload", function () {
    clearInterval(pollTimer);
  });
}

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
