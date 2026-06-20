(function initChatNotifications(global) {
  const STORAGE_KEY = "chatNotificationsEnabled";
  const SW_URL = "/sw.js";
  const ICON_URL = "/icons/chat-notification.svg";

  const state = {
    currentUser: "",
    currentRoomId: null,
    baseTitle: "Dashboard",
    getRoomName: () => "새 메시지",
    formatPreview: (message) => String(message?.text || "").trim(),
  };

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
    return (
      global.localStorage.getItem(STORAGE_KEY) === "1" &&
      isSupported() &&
      global.Notification.permission === "granted"
    );
  }

  function getPermission() {
    if (!isSupported()) return "unsupported";
    return global.Notification.permission;
  }

  function shouldNotify(msgRoomId, message) {
    if (!isEnabled() || !message) return false;
    if (message.from === state.currentUser) return false;
    if (message.type === "SYSTEM_JOIN" || message.type === "SYSTEM_LEAVE") {
      return false;
    }

    const isCurrentRoom = Number(msgRoomId) === Number(state.currentRoomId);
    const isPageVisible = !global.document.hidden && global.document.hasFocus();
    if (isCurrentRoom && isPageVisible) return false;
    return true;
  }

  async function registerServiceWorker() {
    if (!isServiceWorkerSupported()) return null;
    try {
      return await navigator.serviceWorker.register(SW_URL);
    } catch (error) {
      console.warn("[notifications] service worker register failed:", error);
      return null;
    }
  }

  function show(msgRoomId, message, room) {
    if (!shouldNotify(msgRoomId, message)) return;

    const roomName = room?.name || state.getRoomName(msgRoomId);
    const preview = state.formatPreview(message);
    const body = preview ? `${message.from}: ${preview}` : String(message.from || "");

    const notification = new global.Notification(roomName, {
      body,
      icon: ICON_URL,
      tag: `room-${msgRoomId}`,
      renotify: true,
    });

    notification.onclick = () => {
      global.focus();
      global.location.href = `/dashboard?roomId=${msgRoomId}`;
      notification.close();
    };
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
    await registerServiceWorker();
    return { ok: true };
  }

  function disable() {
    global.localStorage.setItem(STORAGE_KEY, "0");
    updateTitleBadge(new Map());
    return { ok: true };
  }

  function init(options) {
    Object.assign(state, options || {});
    state.baseTitle = global.document.title || state.baseTitle;

    if (isEnabled()) {
      registerServiceWorker();
    }
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

  async function subscribePush() {
    if (!isPushSupported()) {
      return { ok: false, message: "이 브라우저는 푸시 알림을 지원하지 않습니다." };
    }

    try {
      const registration = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
      if (!registration?.pushManager) {
        return { ok: false, message: "푸시 서비스를 사용할 수 없습니다." };
      }

      const keyResponse = await $.ajax({
        url: "/api/notifications/vapid-public-key",
        type: "GET",
        dataType: "json",
      });

      if (!keyResponse?.success || !keyResponse.publicKey) {
        return { ok: false, message: "푸시 알림이 아직 서버에서 준비되지 않았습니다." };
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyResponse.publicKey),
      });

      const saveResponse = await $.ajax({
        url: "/api/notifications/subscribe",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify(subscription.toJSON()),
      });

      if (!saveResponse?.success) {
        return { ok: false, message: saveResponse?.message || "구독 저장에 실패했습니다." };
      }

      return { ok: true };
    } catch (error) {
      const message =
        error?.responseJSON?.message || error?.statusText || "푸시 구독에 실패했습니다.";
      return { ok: false, message };
    }
  }

  async function unsubscribePush() {
    if (!isPushSupported()) {
      return { ok: true };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        return { ok: true };
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();

      await $.ajax({
        url: "/api/notifications/subscribe",
        type: "DELETE",
        contentType: "application/json",
        data: JSON.stringify({ endpoint }),
      });

      return { ok: true };
    } catch (error) {
      const message =
        error?.responseJSON?.message || error?.statusText || "푸시 해제에 실패했습니다.";
      return { ok: false, message };
    }
  }

  async function getPushSubscriptionState() {
    if (!isPushSupported()) {
      return { supported: false, subscribed: false };
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      return { supported: true, subscribed: Boolean(subscription) };
    } catch {
      return { supported: true, subscribed: false };
    }
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
    registerServiceWorker,
    isSupported,
    isPushSupported,
    isEnabled,
    getPermission,
  };
})(window);
