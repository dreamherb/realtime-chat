const authService = require("./auth.service");

async function resolveSessionUser(req) {
  if (req.user?.id) {
    const user = await authService.findUserById(req.user.id);
    if (user) {
      return user;
    }
  }

  if (req.user?.email) {
    return authService.findUserByEmail(req.user.email);
  }

  return null;
}

module.exports = {
  resolveSessionUser,
};
