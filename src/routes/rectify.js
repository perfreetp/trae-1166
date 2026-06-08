const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now } = require("../utils/helpers");
const { writeAuditFromReq } = require("../utils/audit");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { record_id, relic_id, hazard_desc, risk_level, responsible_id, deadline } = req.body;
    if (!record_id || !relic_id || !hazard_desc) return next(new AppError("PARAM_MISSING", "record_id、relic_id、hazard_desc 为必填项"));
    const record = db.prepare("SELECT id FROM records WHERE id = ?").get(record_id);
    if (!record) return next(new AppError("RECORD_NOT_FOUND"));
    const id = genId();
    db.prepare(
      `INSERT INTO rectifications (id,record_id,relic_id,hazard_desc,risk_level,responsible_id,deadline) VALUES (?,?,?,?,?,?,?)`
    ).run(id, record_id, relic_id, hazard_desc, risk_level || "medium", responsible_id, deadline);
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(id);
    res.status(201).json(success(rect, "隐患整改记录创建成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { status, relic_id, responsible_id, risk_level } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { where += " AND rc.status = ?"; params.push(status); }
    if (relic_id) { where += " AND rc.relic_id = ?"; params.push(relic_id); }
    if (responsible_id) { where += " AND rc.responsible_id = ?"; params.push(responsible_id); }
    if (risk_level) { where += " AND rc.risk_level = ?"; params.push(risk_level); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT rc.*, rl.name AS relic_name, u.name AS responsible_name FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id ${where} ORDER BY rc.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const rect = db.prepare(
      `SELECT rc.*, rl.name AS relic_name, u.name AS responsible_name, rv.name AS reviewer_name FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id LEFT JOIN users rv ON rc.reviewer_id = rv.id WHERE rc.id = ?`
    ).get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    res.json(success(rect));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/assign", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    const { responsible_id } = req.body;
    if (!responsible_id) return next(new AppError("PARAM_MISSING", "responsible_id 为必填项"));
    db.prepare("UPDATE rectifications SET responsible_id = ?, status = 'assigned', updated_at = ? WHERE id = ?").run(responsible_id, now(), req.params.id);
    writeAuditFromReq(req, "assign_rectification", "rectification", req.params.id, `分配整改责任人：${responsible_id}`);
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, "责任人已分配"));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/rectify", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    if (rect.status === "closed") return next(new AppError("RECTIFY_ALREADY_CLOSED"));
    const { result } = req.body;
    db.prepare("UPDATE rectifications SET result = ?, status = 'rectified', updated_at = ? WHERE id = ?").run(result || "", now(), req.params.id);
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, "整改结果已更新"));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/review", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    if (rect.status !== "rectified") return next(new AppError("PARAM_INVALID", "仅已整改状态可进行复查"));
    const { review_result } = req.body;
    if (!review_result) return next(new AppError("PARAM_MISSING", "review_result 为必填项"));
    const finalStatus = review_result === "pass" ? "closed" : "pending";
    db.prepare(
      "UPDATE rectifications SET reviewer_id = ?, review_result = ?, status = ?, reviewed_at = ?, updated_at = ? WHERE id = ?"
    ).run(req.user.id, review_result, finalStatus, now(), now(), req.params.id);
    writeAuditFromReq(req, "review_rectification", "rectification", req.params.id, review_result === "pass" ? "复查通过，整改关闭" : "复查未通过，需重新整改");
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, review_result === "pass" ? "复查通过，整改关闭" : "复查未通过，需重新整改"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
