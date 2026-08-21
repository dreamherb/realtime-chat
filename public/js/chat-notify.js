(function initChatNotify(global) {
  if (!global) return;

  const SW_URL = "/sw.js";
  const ICON_URL = "/icons/chat-notification.svg";

  const state = {
    currentUser: "",
    currentRoomId: null,
    baseTitle: "Dashboard",
    accountEnabled: false,
    pushSubscribed: false,
    getRoomName: () => "새 메시지",
    formatPreview: (message) => String(message?.text || "").trim(),
  };

  function pushAjax(options) {
    return $.ajax({
      ...options,
      xhrFields: { withCredentials: true },
    });
  }

  function isSupported() {
    return typeof global.Notification !== "undefined";
  }

  function isServiceWorkerSupported() {
    return "serviceWorker" in navigator;
  }

  function isPushSupported() {
    return isServiceWorkerSupported() && "PushManager" in global;
  }

  function isAccountEnabled() {
    return Boolean(state.accountEnabled);
  }

  function isEnabled() {
    if (!isSupported()) return false;
    if (global.Notification.permission !== "granted") return false;
    return isAccountEnabled();
  }

  function isActivelyViewingCurrentRoom(msgRoomId) {
    const isCurrentRoom = Number(msgRoomId) === Number(state.currentRoomId);
    if (!isCurrentRoom) return false;
    return !global.document.hidden && global.document.hasFocus();
  }

  function getSkipReason(msgRoomId, message) {
    if (!isSupported()) return "unsupported";
    if (global.Notification.permission !== "granted") return "permission-not-granted";
    if (!state.accountEnabled) return "disabled-by-user";
    if (!message) return "no-message";
    if (message.from === state.currentUser) return "own-message";
    if (message.type === "SYSTEM_JOIN" || message.type === "SYSTEM_LEAVE") {
      return "system-message";
    }
    if (isActivelyViewingCurrentRoom(msgRoomId)) return "viewing-current-room";
    return null;
  }

  function getPermission() {
    if (!isSupported()) return "unsupported";
    return global.Notification.permission;
  }

  function buildNotificationTag(msgRoomId, message) {
    const messageId = message?.id ? String(message.id) : String(Date.now());
    return `chat-${msgRoomId}-msg-${messageId}`;
  }

  async function registerServiceWorker() {
    if (!isServiceWorkerSupported()) return null;
    try {
      return await navigator.serviceWorker.register(SW_URL);
    } catch (error) {
      console.warn("[chat-notify] service worker register failed:", error);
      return null;
    }
  }

  function showViaServiceWorker(title, options) {
    const show = (registration) => {
      registration
        .showNotification(title, options)
        .catch((error) => console.warn("[chat-notify] showNotification failed:", error));
    };

    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(show);
      return;
    }

    registerServiceWorker()
      .then(() => navigator.serviceWorker.ready)
      .then(show)
      .catch((error) => console.warn("[chat-notify] SW path failed:", error));
  }

  function show(msgRoomId, message, room) {
    const skipReason = getSkipReason(msgRoomId, message);
    if (skipReason) {
      return;
    }

    const roomName = room?.name || state.getRoomName(msgRoomId);
    const preview = state.formatPreview(message);
    const body = preview ? `${message.from}: ${preview}` : String(message.from || "");
    const targetUrl = `/dashboard?roomId=${msgRoomId}`;
    const options = {
      body,
      icon: ICON_URL,
      tag: buildNotificationTag(msgRoomId, message),
      data: { url: targetUrl },
    };

    if (isServiceWorkerSupported()) {
      showViaServiceWorker(roomName, options);
      return;
    }

    if (global.document.hidden) {
      return;
    }

    try {
      const notification = new global.Notification(roomName, options);
      notification.onclick = () => {
        global.focus();
        global.location.href = targetUrl;
        notification.close();
      };
    } catch (error) {
      console.warn("[chat-notify] window notification failed:", error);
    }
  }

  function updateTitleBadge(unreadByRoom) {
    let total = 0;
    if (unreadByRoom instanceof Map) {
      for (const entry of unreadByRoom.values()) {
        total += Number(entry.count) || 0;
      }
    }
    global.document.title =
      total > 0 ? `(${total}) ${state.baseTitle}` : state.baseTitle;
  }

  async function fetchPushStatus() {
    try {
      const response = await pushAjax({
        url: "/api/push/status",
        type: "GET",
        dataType: "json",
      });
      return {
        ok: true,
        configured: Boolean(response?.pushConfigured),
        enabled: Boolean(response?.enabled),
      };
    } catch {
      return { ok: false, configured: false, enabled: false };
    }
  }

  async function setAccountEnabled(enabled) {
    const response = await pushAjax({
      url: "/api/push/preference",
      type: "POST",
      contentType: "application/json",
      data: JSON.stringify({ enabled: Boolean(enabled) }),
    });
    state.accountEnabled = Boolean(response?.enabled);
    return state.accountEnabled;
  }

  async function refreshPushSubscriptionState() {
    if (!isPushSupported()) {
      state.pushSubscribed = false;
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      state.pushSubscribed = Boolean(subscription);
      return state.pushSubscribed;
    } catch {
      state.pushSubscribed = false;
      return false;
    }
  }

  async function isPushConfiguredOnServer() {
    const status = await fetchPushStatus();
    return status.configured;
  }

  async function enableAccount() {
    try {
      await setAccountEnabled(true);
    } catch (error) {
      return {
        ok: false,
        message:
          error?.responseJSON?.message || "알림 설정을 저장하지 못했습니다.",
      };
    }

    if (
      isPushSupported() &&
      getPermission() === "granted" &&
      (await isPushConfiguredOnServer())
    ) {
      const pushResult = await subscribePush();
      if (!pushResult.ok) {
        return {
          ok: true,
          warning: `계정 알림은 켜졌지만 이 기기 구독에 실패했습니다: ${pushResult.message}`,
        };
      }
    }

    return { ok: true, pushSubscribed: state.pushSubscribed };
  }

  async function disable() {
    try {
      await setAccountEnabled(false);
    } catch (error) {
      return {
        ok: false,
        message:
          error?.responseJSON?.message || "알림 설정을 저장하지 못했습니다.",
      };
    }
    await releaseDevice({ notifyServer: false });
    updateTitleBadge(new Map());
    return { ok: true };
  }

  function init(options) {
    Object.assign(state, options || {});
    state.baseTitle = global.document.title || state.baseTitle;
    return syncFromServer();
  }

  async function syncFromServer() {
    const status = await fetchPushStatus();
    if (!status.ok) return;

    state.accountEnabled = status.enabled;

    if (!isPushSupported()) {
      state.pushSubscribed = false;
      return;
    }

    if (status.enabled && status.configured) {
      await registerServiceWorker();
      if (getPermission() === "granted") {
        await subscribePush();
      }
      return;
    }

    await releaseDevice();
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = global.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  function getPushSubscribeErrorMessage(error) {
    if (error?.responseJSON?.message) {
      return error.responseJSON.message;
    }

    const raw = String(error?.message || error?.statusText || "");
    if (raw.includes("push service error")) {
      return (
        "브라우저가 푸시 서비스(FCM)에 연결하지 못했습니다. " +
        "광고 차단 확장 프로그램을 끄거나, Brave 사용 시 brave://settings/privacy 에서 " +
        "\"Use Google services for push messaging\"을 켠 뒤 브라우저를 재시작해 보세요."
      );
    }

    return raw || "푸시 구독에 실패했습니다.";
  }

  async function saveSubscription(subscription) {
    try {
      return await pushAjax({
        url: "/api/push/subscribe",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(subscription.toJSON()),
      });
    } catch (error) {
      return error?.responseJSON || { success: false };
    }
  }

  async function subscribePush() {
    if (!isPushSupported()) {
      return { ok: false, message: "이 브라우저는 푸시 알림을 지원하지 않습니다." };
    }
    try {
      await registerServiceWorker();
      const registration = await navigator.serviceWorker.ready;
      if (!registration?.pushManager) {
        return { ok: false, message: "푸시 서비스를 사용할 수 없습니다." };
      }

      const keyResponse = await pushAjax({
        url: "/api/push/vapid-public-key",
        type: "GET",
        dataType: "json",
      });
      if (!keyResponse?.success || !keyResponse.publicKey) {
        return { ok: false, message: "푸시 알림이 아직 서버에서 준비되지 않았습니다." };
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey),
        });
      }

      let saveResponse = await saveSubscription(subscription);
      if (saveResponse?.reason === "ENDPOINT_OWNED") {
        await subscription.unsubscribe();
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey),
        });
        saveResponse = await saveSubscription(subscription);
      }
      if (!saveResponse?.success) {
        return { ok: false, message: saveResponse?.message || "구독 저장에 실패했습니다." };
      }

      state.pushSubscribed = true;
      return { ok: true };
    } catch (error) {
      console.warn("[chat-notify] push subscribe failed:", error);
      return { ok: false, message: getPushSubscribeErrorMessage(error) };
    }
  }

  async function releaseDevice({ notifyServer = true } = {}) {
    if (!isPushSupported()) {
      state.pushSubscribed = false;
      return { ok: true };
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription) {
        state.pushSubscribed = false;
        return { ok: true };
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      if (notifyServer) {
        await pushAjax({
          url: "/api/push/subscribe",
          type: "DELETE",
          contentType: "application/json",
          data: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      state.pushSubscribed = false;
      return { ok: true };
    } catch (error) {
      state.pushSubscribed = false;
      const message =
        error?.responseJSON?.message || error?.statusText || "푸시 해제에 실패했습니다.";
      return { ok: false, message };
    }
  }

  async function getPushSubscriptionState() {
    const subscribed = await refreshPushSubscriptionState();
    return {
      supported: isPushSupported(),
      subscribed,
    };
  }

  global.ChatNotifications = {
    init,
    enableAccount,
    disable,
    show,
    updateTitleBadge,
    subscribePush,
    releaseDevice,
    getPushSubscriptionState,
    isPushSupported,
    isAccountEnabled,
    isEnabled,
    getPermission,
  };
})(window);
