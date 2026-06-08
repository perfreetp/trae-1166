const { ERROR_CODES, AppError } = require("../utils/errors");

function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.httpStatus).json(err.toJSON());
  }
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json(new AppError("AUTH_INVALID").toJSON());
  }
  if (err.name === "TokenExpiredError") {
    return res.status(401).json(new AppError("AUTH_REQUIRED").toJSON());
  }
  console.error("[Unhandled Error]", err);
  const internal = new AppError("INTERNAL_ERROR", process.env.NODE_ENV === "production" ? undefined : err.message);
  res.status(internal.httpStatus).json(internal.toJSON());
}

module.exports = errorHandler;
