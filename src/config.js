const path = require("path");

module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || "relic-inspection-secret-2026",
  JWT_EXPIRES_IN: "24h",
  DB_PATH: path.join(__dirname, "..", "data", "relic.db"),
  UPLOAD_DIR: path.join(__dirname, "..", "uploads"),
  PAGE_SIZE: 20,
};
