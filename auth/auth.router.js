const express = require("express");
const router = express.Router();
const authController = require("./auth.controller");

// 뷰 렌더링
router.get("/login", authController.getLogin);
router.get("/signup", authController.getSignup);

// API 엔드포인트
router.post("/login", authController.postLogin);
router.post("/signup", authController.postSignup);

module.exports = router;

