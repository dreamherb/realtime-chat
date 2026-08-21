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
    text += " · 이 계정에서 알림이 켜져 있습니다.";
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
      "서버 VAPID가 없어 백그라운드 푸시는 비활성입니다. 같은 탭이 열려 있을 때만 알림이 동작합니다.",
    );
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  if (!ChatNotifications.isEnabled()) {
    $status.text(
      "「알림 켜기」는 계정에 저장됩니다. 다른 브라우저·모바일에서 로그인하면 이 기기도 구독됩니다.",
    );
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  if (pushState.subscribed) {
    $status.text(
      "이 기기는 백그라운드 푸시에 구독되어 있습니다. 로그아웃해도 계정 설정은 유지됩니다.",
    );
    $("#enablePushBtn, #disablePushBtn").prop("hidden", true);
    return;
  }

  $status.text("계정 알림은 켜져 있지만 이 기기 구독이 없습니다. 다시 구독해 주세요.");
  $("#enablePushBtn").prop("hidden", false);
  $("#disablePushBtn").prop("hidden", true);
}

async function refreshStatus() {
  setDesktopStatusText();
  await setPushStatusText();
}

$(function () {
  Promise.resolve(
    ChatNotifications.init({
      currentUser: "",
      currentRoomId: null,
      baseTitle: document.title,
    }),
  ).then(refreshStatus);

  $("#enableDesktopBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    const result = await ChatNotifications.enable();
    $btn.prop("disabled", false);

    if (!result.ok) {
      showAlertModal(result.message || "알림을 켤 수 없습니다.");
    } else if (result.warning) {
      showAlertModal(result.warning);
    }

    await refreshStatus();
  });

  $("#disableDesktopBtn").on("click", async function () {
    const $btn = $(this);
    $btn.prop("disabled", true);

    const result = await ChatNotifications.disable();
    $btn.prop("disabled", false);
    if (result && result.ok === false) {
      showAlertModal(result.message || "알림을 끄지 못했습니다.");
    }
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
});
