const { attachValidUser, clearSessionCookie } = require("../auth/auth.middleware");

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
};

module.exports = homeController;
