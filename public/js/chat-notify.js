(function initChatNotify(global) {
  if (!global) return;

  const STORAGE_KEY = "chatNotificationsEnabled";
  const SW_URL = "/sw.js";
  const ICON_URL = "/icons/chat-notification.svg";

  const state = {
    currentUser: "",
    currentRoomId: null,
    baseTitle: "Dashboard",
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

  function isEnabled() {
    if (!isSupported()) return false;
    if (global.Notification.permission !== "granted") return false;
    return global.localStorage.getItem(STORAGE_KEY) !== "0";
  }

  function isActivelyViewingCurrentRoom(msgRoomId) {
    const isCurrentRoom = Number(msgRoomId) === Number(state.currentRoomId);
    if (!isCurrentRoom) return false;
    return !global.document.hidden && global.document.hasFocus();
  }

  function getSkipReason(msgRoomId, message) {
    if (!isSupported()) return "unsupported";
    if (global.Notification.permission !== "granted") return "permission-not-granted";
    if (global.localStorage.getItem(STORAGE_KEY) === "0") return "disabled-by-user";
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

  async function refreshPushSubscriptionState() {
    if (!isPushSupported()) {
      state.pushSubscribed = false;
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      state.pushSubscribed = Boolean(subscription);
      if (subscription && isEnabled()) {
        // 같은 브라우저에서 계정을 바꿔도 현재 user_id로 endpoint를 다시 묶음
        pushAjax({
          url: "/api/push/subscribe",
          type: "POST",
          contentType: "application/json",
          data: JSON.stringify(subscription.toJSON()),
        }).catch(() => {});
      }
      return state.pushSubscribed;
    } catch {
      state.pushSubscribed = false;
      return false;
    }
  }

  async function isPushConfiguredOnServer() {
    try {
      const response = await pushAjax({
        url: "/api/push/vapid-public-key",
        type: "GET",
        dataType: "json",
      });
      return Boolean(response?.success && response.publicKey);
    } catch {
      return false;
    }
  }

  async function enable() {
    if (!isSupported()) {
      return { ok: false, message: "이 브라우저는 알림을 지원하지 않습니다." };
    }

    const permission = await global.Notification.requestPermission();
    if (permission !== "granted") {
      global.localStorage.setItem(STORAGE_KEY, "0");
      return { ok: false, message: "알림 권한이 거부되었습니다." };
    }

    global.localStorage.setItem(STORAGE_KEY, "1");
    const registration = await registerServiceWorker();
    if (!registration) {
      return {
        ok: true,
        warning:
          "알림 권한은 허용됐지만 Service Worker 등록에 실패했습니다. 다른 탭에서 알림이 안 올 수 있습니다.",
      };
    }

    let pushResult = null;
    if (isPushSupported() && (await isPushConfiguredOnServer())) {
      pushResult = await subscribePush();
      await refreshPushSubscriptionState();
    }

    if (pushResult && !pushResult.ok) {
      return {
        ok: true,
        warning: `알림은 켜졌지만 백그라운드 푸시 구독에 실패했습니다: ${pushResult.message}`,
      };
    }

    return { ok: true, pushSubscribed: state.pushSubscribed };
  }

  function disable() {
    global.localStorage.setItem(STORAGE_KEY, "0");
    state.pushSubscribed = false;
    updateTitleBadge(new Map());
    return { ok: true };
  }

  function init(options) {
    Object.assign(state, options || {});
    state.baseTitle = global.document.title || state.baseTitle;

    if (getPermission() === "granted" && global.localStorage.getItem(STORAGE_KEY) !== "0") {
      if (global.localStorage.getItem(STORAGE_KEY) !== "1") {
        global.localStorage.setItem(STORAGE_KEY, "1");
      }
      registerServiceWorker();
      refreshPushSubscriptionState();
    }
  }

  function getDebugState(msgRoomId, message) {
    return {
      supported: isSupported(),
      permission: getPermission(),
      storage: global.localStorage.getItem(STORAGE_KEY),
      enabled: isEnabled(),
      pushSubscribed: state.pushSubscribed,
      hidden: global.document.hidden,
      hasFocus: global.document.hasFocus(),
      currentUser: state.currentUser,
      currentRoomId: state.currentRoomId,
      messageFrom: message?.from ?? null,
      skipReason: getSkipReason(msgRoomId, message),
      swController: Boolean(navigator.serviceWorker?.controller),
    };
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

      const saveResponse = await pushAjax({
        url: "/api/push/subscribe",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(subscription.toJSON()),
      });
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

  async function unsubscribePush() {
    if (!isPushSupported()) {
      state.pushSubscribed = false;
      return { ok: true };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        state.pushSubscribed = false;
        return { ok: true };
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await pushAjax({
        url: "/api/push/subscribe",
        type: "DELETE",
        contentType: "application/json",
        data: JSON.stringify({ endpoint }),
      });

      state.pushSubscribed = false;
      return { ok: true };
    } catch (error) {
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
    enable,
    disable,
    show,
    updateTitleBadge,
    subscribePush,
    unsubscribePush,
    getPushSubscriptionState,
    refreshPushSubscriptionState,
    registerServiceWorker,
    getDebugState,
    isSupported,
    isPushSupported,
    isEnabled,
    getPermission,
  };
})(window);
