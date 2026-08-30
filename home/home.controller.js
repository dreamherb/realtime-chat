const {
  attachValidUser,
  clearSessionCookie,
} = require("../auth/auth.middleware");

const homeController = {
  // GET /
  async getRoot(req, res, next) {
    try {
      try {
        const result = await attachValidUser(req);
        if (result.ok) {
          return res.redirect("/dashboard");
        }
        if (result.reason === "REVOKED") {
          clearSessionCookie(res);
        }
      } catch {
        clearSessionCookie(res);
      }

      return res.render("login");
    } catch (error) {
      console.error("ERROR IN GET / : ", error.stack);
      res.status(500).send("An error occurred while getting index.");
      return res.render("error");
    }
  },
  getHealth(req, res) {
    if (req.app.get("shuttingDown")) {
      return res.status(503).json({ status: "stopping" });
    }
    return res.status(200).json({ status: "ok" });
  },
  // favicon / Chrome DevTools 등 브라우저 프로브 — 본문 없이 204
  ignoreProbe(req, res) {
    res.status(204).end();
  },
};

module.exports = homeController;
