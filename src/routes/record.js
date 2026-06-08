const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now, calculateRiskLevel } = require("../utils/helpers");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { task_id, relic_id, longitude, latitude, altitude, temperature, humidity, weather, damage_parts, damage_desc, risk_level, remark } = req.body;
    if (!task_id || !relic_id) return next(new AppError("PARAM_MISSING", "task_id 和 relic_id 为必填项"));
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id);
    if (!task) return next(new AppError("TASK_NOT_FOUND"));
    const finalRiskLevel = risk_level || calculateRiskLevel(damage_parts, damage_desc);
    const id = genId();
    db.prepare(
      `INSERT INTO records (id,task_id,relic_id,inspector_id,longitude,latitude,altitude,temperature,humidity,weather,damage_parts,damage_desc,risk_level,remark) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, task_id, relic_id, req.user.id, longitude, latitude, altitude, temperature, humidity, weather, damage_parts, damage_desc, finalRiskLevel, remark);
    const record = db.prepare("SELECT * FROM records WHERE id = ?").get(id);
    res.status(201).json(success(record, "现场记录保存成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { task_id, relic_id, inspector_id, risk_level, start_date, end_date } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (task_id) { where += " AND r.task_id = ?"; params.push(task_id); }
    if (relic_id) { where += " AND r.relic_id = ?"; params.push(relic_id); }
    if (inspector_id) { where += " AND r.inspector_id = ?"; params.push(inspector_id); }
    if (risk_level) { where += " AND r.risk_level = ?"; params.push(risk_level); }
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM records r ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT r.*, rl.name AS relic_name FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/track/:relic_id", (req, res, next) => {
  try {
    const { relic_id } = req.params;
    const { start_date, end_date } = req.query;
    let where = "WHERE r.relic_id = ?";
    const params = [relic_id];
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    const rows = db.prepare(
      `SELECT r.id, r.longitude, r.latitude, r.risk_level, r.damage_parts, r.created_at, u.name AS inspector_name FROM records r LEFT JOIN users u ON r.inspector_id = u.id ${where} ORDER BY r.created_at`
    ).all(...params);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const record = db.prepare(
      `SELECT r.*, rl.name AS relic_name, u.name AS inspector_name FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id LEFT JOIN users u ON r.inspector_id = u.id WHERE r.id = ?`
    ).get(req.params.id);
    if (!record) return next(new AppError("RECORD_NOT_FOUND"));
    res.json(success(record));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
