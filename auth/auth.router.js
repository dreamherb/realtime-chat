const express = require("express");
const router = express.Router();
const homeController = require("../home/home.controller");
const authController = require("./auth.controller");
const passwordResetController = require("./password-reset.controller");
const { requirePasswordResetJwt } = require("./password-reset.auth");

router.get("/login", homeController.getRoot);
router.get("/logout", authController.getLogout);
router.get("/signup", (req, res) => res.render("signup"));

router.get(
  "/forgot/reset",
  requirePasswordResetJwt("page"),
  (req, res) => res.render("forgot-reset"),
);
router.get("/forgot", (req, res) =>
  res.render("forgot", { reason: req.query.reason || null }),
);

router.post("/login", authController.postLogin);
router.post("/logout", authController.postLogout);
router.post("/signup", authController.postSignup);

router.post("/forgot/send-code", passwordResetController.postSendForgotCode);
router.post("/forgot/verify-code", passwordResetController.postVerifyForgotCode);
router.post(
  "/forgot/reset",
  requirePasswordResetJwt("api"),
  passwordResetController.postCompleteReset,
);

module.exports = router;
