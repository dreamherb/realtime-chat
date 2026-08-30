const express = require("express");
const router = express.Router();
const homeController = require("./home.controller");

// 루트 페이지
router.get("/", homeController.getRoot);
router.get("/health", homeController.getHealth);

// 브라우저가 자동으로 치는 경로 — 404/error 뷰로 안 넘김
router.get("/favicon.ico", homeController.ignoreProbe);
router.get("/apple-touch-icon.png", homeController.ignoreProbe);
router.get("/apple-touch-icon-precomposed.png", homeController.ignoreProbe);
router.get(
  "/.well-known/appspecific/com.chrome.devtools.json",
  homeController.ignoreProbe
);

module.exports = router;
