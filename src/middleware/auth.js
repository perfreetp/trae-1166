const jwt = require("jsonwebtoken");
const config = require("../config");
const { AppError } = require("../utils/errors");

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("AUTH_REQUIRED"));
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return next(new AppError("AUTH_INVALID"));
  }
}

function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError("AUTH_REQUIRED"));
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new AppError("AUTH_FORBIDDEN"));
    }
    next();
  };
}

module.exports = { authMiddleware, roleMiddleware };
