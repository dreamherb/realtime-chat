const POLL_INTERVAL_MS = 2500;

const roomId = window.__DASHBOARD__.roomId;
const currentUser = window.__DASHBOARD__.currentUser;
let lastMessageId = window.__DASHBOARD__.lastMessageId || 0;
let pollTimer = null;

const $messages = $("#messages");
const $form = $("#messageForm");
const $input = $("#messageText");

// 메시지 아이템 HTML 생성
function buildMessageHtml(msg) {
  const isMe = msg.from === currentUser;
  const cls = isMe ? "msg msg--me" : "msg";
  return `
    <article class="${cls}">
      <div class="msg__meta">${escapeHtml(msg.from)} · ${escapeHtml(msg.time)}</div>
      <div class="msg__body">${escapeHtml(msg.text)}</div>
    </article>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scrollToBottom() {
  $messages.scrollTop($messages[0].scrollHeight);
}

// 초기 스크롤
scrollToBottom();

// 새 메시지 폴링
function pollNewMessages() {
  $.ajax({
    url: `/api/rooms/${roomId}/messages`,
    type: "GET",
    data: { sinceId: lastMessageId },
    success: function (data) {
      if (!data.success || !data.messages.length) return;

      // 안내 문구 제거 (메시지가 처음 들어올 때)
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
      // 인증 만료 시 리로드
      if (xhr.status === 401) {
        clearInterval(pollTimer);
        window.location.href = "/";
      }
    },
  });
}

// 폴링 시작
pollTimer = setInterval(pollNewMessages, POLL_INTERVAL_MS);

// 메시지 전송
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

// Enter 키 전송
$input.on("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $form.trigger("submit");
  }
});

// 페이지 언로드 시 폴링 정리
$(window).on("beforeunload", function () {
  clearInterval(pollTimer);
});
