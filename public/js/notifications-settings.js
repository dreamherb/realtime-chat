const PERMISSION_LABELS = {
  granted: "허용됨",
  denied: "거부됨",
  default: "아직 요청하지 않음",
  unsupported: "지원하지 않음",
};

function setAccountStatusText() {
  const on = ChatNotifications.isAccountEnabled();
  $("#accountToggle").prop("checked", on);
  $("#accountStatus").text(
    on ? "이 계정은 알림이 켜져 있습니다." : "이 계정은 알림이 꺼져 있습니다.",
  );
}

function isMobileDevice() {
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function devicePermissionLabel() {
  if (isMobileDevice() && isStandalonePwa()) return "모바일 기기 권한";
  if (isMobileDevice()) return "모바일 브라우저 권한";
  return "브라우저 권한";
}

function devicePermissionHint(permission) {
  if (permission !== "denied" && permission !== "default") return "";
  if (isMobileDevice() && isStandalonePwa()) {
    return " · 허용하려면 휴대폰 설정에서 이 앱 알림을 켜 주세요.";
  }
  return " · 허용하려면 주소창 왼쪽 자물쇠에서 알림을 허용하세요.";
}

function setDeviceStatusText() {
  const permission = ChatNotifications.getPermission();
  const $status = $("#deviceStatus");

  if (permission === "unsupported" || !ChatNotifications.isPushSupported()) {
    $status.text("이 기기는 알림을 지원하지 않습니다.");
    return;
  }

  const permLabel = PERMISSION_LABELS[permission] || permission;
  let text = `${devicePermissionLabel()}: ${permLabel}`;
  if (!window.__NOTIFICATIONS__?.pushConfigured) {
    text += " · 서버 푸시 미설정(탭이 열려 있을 때만 알림)";
  }
  $status.text(text + devicePermissionHint(permission));
}

async function refreshStatus() {
  setAccountStatusText();
  setDeviceStatusText();
}

function showResult(result, fallback) {
  if (!result?.ok) {
    showAlertModal(result?.message || fallback);
    return false;
  }
  if (result.warning) showAlertModal(result.warning);
  return true;
}

$(function () {
  Promise.resolve(
    ChatNotifications.init({
      currentUser: "",
      currentRoomId: null,
      baseTitle: document.title,
    }),
  ).then(refreshStatus);

  $(document).on("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshStatus();
  });

  $("#accountToggle").on("change", async function () {
    const on = this.checked;
    this.disabled = true;
    const result = on
      ? await ChatNotifications.enableAccount()
      : await ChatNotifications.disable();
    this.disabled = false;
    if (!showResult(result, on ? "계정 알림을 켜지 못했습니다." : "계정 알림을 끄지 못했습니다.")) {
      this.checked = !on;
    }
    await refreshStatus();
  });
});
