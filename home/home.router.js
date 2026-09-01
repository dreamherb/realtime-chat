const express = require("express");
const router = express.Router();
const homeController = require("./home.controller");

router.get("/", homeController.getRoot);

router.get("/health", (req, res) => {
  if (req.app.get("shuttingDown")) {
    return res.status(503).json({ status: "stopping" });
  }
  return res.status(200).json({ status: "ok" });
});

function ignoreProbe(_req, res) {
  res.status(204).end();
}

router.get("/favicon.ico", ignoreProbe);
router.get("/apple-touch-icon.png", ignoreProbe);
router.get("/apple-touch-icon-precomposed.png", ignoreProbe);
router.get(
  "/.well-known/appspecific/com.chrome.devtools.json",
  ignoreProbe,
);

module.exports = router;
