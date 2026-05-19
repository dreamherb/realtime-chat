const { getUsiToken, verifyUsiToken } = require("../auth/auth.middleware");

const homeController = {
  // GET /
  async getRoot(req, res, next) {
    try {
      const token = getUsiToken(req);
      if (token) {
        try {
          verifyUsiToken(token);
          return res.redirect("/dashboard");
        } catch {
          res.clearCookie("usi", { path: "/" });
        }
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

