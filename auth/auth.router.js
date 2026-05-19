const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");
const passwordResetController = require("./password-reset.controller");
const passwordResetMiddleware = require("./password-reset.middleware");

// 뷰 렌더링
router.get("/login", authController.getLogin);
router.get("/signup", authController.getSignup);

router.get(
  "/forgot/reset",
  passwordResetMiddleware.requirePasswordResetJwtForPage,
  passwordResetController.getResetPage,
);
router.get("/forgot", passwordResetController.getForgotPage);

// API 엔드포인트
router.post("/login", authController.postLogin);
router.post("/signup", authController.postSignup);

router.post("/forgot/send-code", passwordResetController.postSendForgotCode);
router.post("/forgot/verify-code", passwordResetController.postVerifyForgotCode);
router.post(
  "/forgot/reset",
  passwordResetMiddleware.requirePasswordResetJwtForApi,
  passwordResetController.postCompleteReset,
);

module.exports = router;
