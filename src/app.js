const express = require("express");
const path = require("path");
const config = require("./config");
const errorHandler = require("./middleware/errorHandler");
const { authMiddleware, roleMiddleware } = require("./middleware/auth");

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(config.UPLOAD_DIR));

app.use("/api/auth", require("./routes/auth"));

app.use("/api/relics", authMiddleware, require("./routes/relic"));
app.use("/api/tasks", authMiddleware, require("./routes/task"));
app.use("/api/records", authMiddleware, require("./routes/record"));
app.use("/api/rectifications", authMiddleware, require("./routes/rectify"));
app.use("/api/media", authMiddleware, require("./routes/media"));
app.use("/api/notifications", authMiddleware, require("./routes/notify"));
app.use("/api/alert-rules", authMiddleware, require("./routes/alert"));
app.use("/api/stats", authMiddleware, require("./routes/stats"));

app.get("/api/error-codes", (_req, res) => {
  const { ERROR_CODES } = require("./utils/errors");
  const formatted = {};
  for (const [key, val] of Object.entries(ERROR_CODES)) {
    formatted[key] = { code: val.code, httpStatus: val.http, message: val.msg };
  }
  res.json({ code: 0, data: formatted });
});

app.use((_req, res) => {
  res.status(404).json({ code: 404, error: "NOT_FOUND", message: "接口不存在" });
});

app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`[relic-inspection-service] running on http://localhost:${config.PORT}`);
  console.log(`[API] http://localhost:${config.PORT}/api/auth/login`);
  console.log(`[ErrorCodes] http://localhost:${config.PORT}/api/error-codes`);
});

module.exports = app;
