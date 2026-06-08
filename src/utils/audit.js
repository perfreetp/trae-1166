const db = require("../database");
const { genId, now } = require("./helpers");

function writeAudit(action, bizType, bizId, operatorId, operatorName, detail) {
  db.prepare(
    "INSERT INTO audit_logs (id, action, biz_type, biz_id, operator_id, operator_name, detail) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(genId(), action, bizType, bizId, operatorId, operatorName, detail || null);
}

function writeAuditFromReq(req, action, bizType, bizId, detail) {
  const user = req.user || {};
  writeAudit(action, bizType, bizId, user.id || "unknown", user.name || "unknown", detail);
}

module.exports = { writeAudit, writeAuditFromReq };
