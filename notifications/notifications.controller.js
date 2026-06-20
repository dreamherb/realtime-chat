const { resolveSessionUser } = require("../auth/auth.session");
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

  getStatus(req, res) {
    return res.json({
      success: true,
      pushConfigured: notificationsService.isPushConfigured(),
    });
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
        return res.status(400).json({
          success: false,
          message: "유효하지 않은 구독 정보입니다.",
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.error("ERROR IN POST /api/notifications/subscribe : ", error.stack);
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
      console.error("ERROR IN DELETE /api/notifications/subscribe : ", error.stack);
      return res.status(500).json({
        success: false,
        message: "구독 해제 중 오류가 발생했습니다.",
      });
    }
  },
};

module.exports = notificationsController;
