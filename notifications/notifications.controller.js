const { resolveSessionUser } = require("../auth/auth.service");
const notificationsService = require("./notifications.service");

const notificationsController = {
  async getNotificationsPage(req, res, next) {
    try {
      const sessionUser = await resolveSessionUser(req);
      if (!sessionUser) {
        res.clearCookie("usi", { path: "/" });
        return res.redirect("/");
      }

      return res.render("notifications", {
        user: {
          id: sessionUser.id,
          name: sessionUser.nickname,
        },
        pushConfigured: notificationsService.isPushConfigured(),
      });
    } catch (error) {
      console.error("ERROR IN GET /notifications : ", error.stack);
      return res.status(500).render("error");
    }
  },

  getVapidPublicKey(req, res) {
    const publicKey = notificationsService.getVapidPublicKey();
    if (!publicKey) {
      return res.json({
        success: false,
        message: "푸시 알림이 아직 설정되지 않았습니다.",
      });
    }

    return res.json({
      success: true,
      publicKey,
    });
  },

  async getStatus(req, res) {
    try {
      const userId = req.user?.id;
      const enabled = await notificationsService.isPushEnabled(userId);
      return res.json({
        success: true,
        pushConfigured: notificationsService.isPushConfigured(),
        enabled,
      });
    } catch (error) {
      console.error("ERROR IN GET /api/push/status : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "알림 설정을 불러오지 못했습니다.",
      });
    }
  },

  async postPreference(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "인증이 필요합니다.",
        });
      }

      const enabled = Boolean(req.body?.enabled);
      await notificationsService.setPushEnabled(userId, enabled);
      return res.json({ success: true, enabled });
    } catch (error) {
      console.error("ERROR IN POST /api/push/preference : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "알림 설정 저장에 실패했습니다.",
      });
    }
  },

  async postSubscribe(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "인증이 필요합니다.",
        });
      }

      if (!notificationsService.isPushConfigured()) {
        return res.status(503).json({
          success: false,
          message: "푸시 알림이 아직 서버에서 준비되지 않았습니다.",
        });
      }

      const result = await notificationsService.savePushSubscription(
        userId,
        req.body,
        req.headers["user-agent"],
      );

      if (!result.ok) {
        const status = result.reason === "ENDPOINT_OWNED" ? 409 : 400;
        return res.status(status).json({
          success: false,
          reason: result.reason,
          message:
            result.reason === "ENDPOINT_OWNED"
              ? "이 브라우저는 다른 계정에 이미 구독되어 있습니다."
              : "유효하지 않은 구독 정보입니다.",
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("ERROR IN POST /api/push/subscribe : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "구독 저장 중 오류가 발생했습니다.",
      });
    }
  },

  async deleteSubscribe(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "인증이 필요합니다.",
        });
      }

      await notificationsService.removePushSubscription(
        userId,
        req.body?.endpoint || null,
      );

      return res.json({ success: true });
    } catch (error) {
      console.error("ERROR IN DELETE /api/push/subscribe : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "구독 해제 중 오류가 발생했습니다.",
      });
    }
  },
};

module.exports = notificationsController;
