const PERMISSION_LABELS = {
  granted: "허용됨",
  denied: "거부됨",
  default: "아직 요청하지 않음",
  unsupported: "지원하지 않음",
};

function setDesktopStatusText() {
  const permission = ChatNotifications.getPermission();
  const enabled = ChatNotifications.isEnabled();
  const label = PERMISSION_LABELS[permission] || permission;

  let text = `브라우저 권한: ${label}`;
  if (enabled) {
    text += " · 이 기기에서 알림이 켜져 있습니다.";
  }
  $("#desktopStatus").text(text);

  $("#enableDesktopBtn").prop("hidden", enabled || permission === "denied");
  $("#disableDesktopBtn").prop("hidden", !enabled);
}

async function setPushStatusText() {
  const pushConfigured = Boolean(window.__NOTIFICATIONS__?.pushConfigured);
  const pushState = await ChatNotifications.getPushSubscriptionState();
  const $status = $("#pushStatus");

  if (!ChatNotifications.isPushSupported()) {
    $status.text("이 브라우저는 푸시 알림을 지원하지 않습니다.");
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  if (!pushConfigured) {
    $status.text(
      "서버 푸시 설정(VAPID)이 아직 준비되지 않았습니다. 데스크톱 알림은 바로 사용할 수 있습니다.",
    );
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  if (!ChatNotifications.isEnabled()) {
    $status.text("푸시 구독 전에 먼저 데스크톱 알림을 켜 주세요.");
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  if (pushState.subscribed) {
    $status.text("이 기기는 푸시 알림에 구독되어 있습니다.");
    $("#enablePushBtn").prop("hidden", true);
    $("#disablePushBtn").prop("hidden", false);
    return;
  }

  $status.text("푸시 알림을 켜면 브라우저가 닫혀 있어도 알림을 받을 수 있습니다.");
  $("#enablePushBtn").prop("hidden", false);
  $("#disablePushBtn").prop("hidden", true);
}

async function refreshStatus() {
  setDesktopStatusText();
  await setPushStatusText();
}

$(function () {
  ChatNotifications.init({
    currentUser: "",
    currentRoomId: null,
    baseTitle: document.title,
  });

  refreshStatus();

  $("#enableDesktopBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    const result = await ChatNotifications.enable();
    $btn.prop("disabled", false);

    if (!result.ok) {
      showAlertModal(result.message || "알림을 켤 수 없습니다.");
    }

    await refreshStatus();
  });

  $("#disableDesktopBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    ChatNotifications.disable();
    await ChatNotifications.unsubscribePush().catch(() => {});

    $btn.prop("disabled", false);
    await refreshStatus();
  });

  $("#enablePushBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    const result = await ChatNotifications.subscribePush().catch((error) => ({
      ok: false,
      message: error?.responseJSON?.message || "푸시 구독에 실패했습니다.",
    }));

    $btn.prop("disabled", false);

    if (!result.ok) {
      showAlertModal(result.message || "푸시 구독에 실패했습니다.");
    }

    await refreshStatus();
  });

  $("#disablePushBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    await ChatNotifications.unsubscribePush().catch(() => {});
    $btn.prop("disabled", false);
    await refreshStatus();
  });
});
