const express = require("express");
const db = require("../database");
const { success, AppError } = require("../utils/errors");

const router = express.Router();

router.get("/overview", (req, res, next) => {
  try {
    const relicTotal = db.prepare("SELECT COUNT(*) AS cnt FROM relics").get().cnt;
    const taskTotal = db.prepare("SELECT COUNT(*) AS cnt FROM tasks").get().cnt;
    const taskPending = db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'pending'").get().cnt;
    const taskClaimed = db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'claimed'").get().cnt;
    const taskSubmitted = db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE status = 'submitted'").get().cnt;
    const rectifyTotal = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications").get().cnt;
    const rectifyPending = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications WHERE status IN ('pending','assigned')").get().cnt;
    const rectifyRectified = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications WHERE status = 'rectified'").get().cnt;
    const rectifyClosed = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications WHERE status = 'closed'").get().cnt;
    const highRisk = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications WHERE risk_level = 'high' AND status != 'closed'").get().cnt;
    res.json(success({
      relics: { total: relicTotal },
      tasks: { total: taskTotal, pending: taskPending, claimed: taskClaimed, submitted: taskSubmitted },
      rectifications: { total: rectifyTotal, pending: rectifyPending, rectified: rectifyRectified, closed: rectifyClosed },
      highRisk,
    }));
  } catch (err) {
    next(err);
  }
});

router.get("/unit-progress", (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT r.unit,
        COUNT(DISTINCT r.id) AS relic_count,
        COUNT(DISTINCT t.id) AS task_count,
        SUM(CASE WHEN t.status = 'submitted' THEN 1 ELSE 0 END) AS submitted_count,
        SUM(CASE WHEN t.status IN ('pending','claimed') THEN 1 ELSE 0 END) AS pending_count,
        COUNT(DISTINCT rc.id) AS rectify_count,
        SUM(CASE WHEN rc.status = 'closed' THEN 1 ELSE 0 END) AS rectify_closed
      FROM relics r
      LEFT JOIN tasks t ON t.relic_id = r.id
      LEFT JOIN rectifications rc ON rc.relic_id = r.id
      GROUP BY r.unit
      ORDER BY r.unit
    `).all();
    for (const row of rows) {
      row.completion_rate = row.task_count > 0 ? Math.round((row.submitted_count / row.task_count) * 100) : 0;
    }
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/relic-history/:relic_id", (req, res, next) => {
  try {
    const { relic_id } = req.params;
    const { start_date, end_date } = req.query;
    const relic = db.prepare("SELECT * FROM relics WHERE id = ?").get(relic_id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    let where = "WHERE r.relic_id = ?";
    const params = [relic_id];
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    const records = db.prepare(
      `SELECT r.id, r.inspector_id, r.longitude, r.latitude, r.temperature, r.humidity, r.damage_parts, r.damage_desc, r.risk_level, r.created_at, u.name AS inspector_name FROM records r LEFT JOIN users u ON r.inspector_id = u.id ${where} ORDER BY r.created_at DESC`
    ).all(...params);
    const tasks = db.prepare(
      `SELECT t.id, t.title, t.cycle, t.plan_date, t.status, t.claimed_at, t.submitted_at FROM tasks t WHERE t.relic_id = ? ORDER BY t.plan_date DESC`
    ).all(relic_id);
    const rectifications = db.prepare(
      `SELECT rc.*, u.name AS responsible_name FROM rectifications rc LEFT JOIN users u ON rc.responsible_id = u.id WHERE rc.relic_id = ? ORDER BY rc.created_at DESC`
    ).all(relic_id);
    res.json(success({ relic, records, tasks, rectifications }));
  } catch (err) {
    next(err);
  }
});

router.get("/risk-distribution", (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT risk_level, COUNT(*) AS count FROM records GROUP BY risk_level
    `).all();
    const rectifyRows = db.prepare(`
      SELECT risk_level, COUNT(*) AS count FROM rectifications GROUP BY risk_level
    `).all();
    res.json(success({ record_risk: rows, rectify_risk: rectifyRows }));
  } catch (err) {
    next(err);
  }
});

router.get("/inspection-trend", (req, res, next) => {
  try {
    const { start_date, end_date, unit } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    if (unit) {
      where += " AND rl.unit = ?";
      params.push(unit);
    }
    const rows = db.prepare(`
      SELECT DATE(r.created_at) AS date, COUNT(*) AS count FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where} GROUP BY DATE(r.created_at) ORDER BY date
    `).all(...params);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/report", (req, res, next) => {
  try {
    const { start_date, end_date, unit } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    if (unit) {
      where += " AND rl.unit = ?";
      params.push(unit);
    }
    const inspectionCount = db.prepare(`SELECT COUNT(*) AS cnt FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where}`).get(...params).cnt;
    const highRiskCount = db.prepare(
      `SELECT COUNT(*) AS cnt FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where} AND r.risk_level = 'high'`
    ).get(...params).cnt;
    const rectifyCount = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${where.replace(/r\./g, "rc.")}`).get(...params).cnt;
    const rectifyClosedCount = db.prepare(
      `SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${where.replace(/r\./g, "rc.")} AND rc.status = 'closed'`
    ).get(...params).cnt;
    const unitBreakdown = db.prepare(`
      SELECT rl.unit, COUNT(DISTINCT r.id) AS inspection_count, SUM(CASE WHEN r.risk_level = 'high' THEN 1 ELSE 0 END) AS high_risk
      FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where} GROUP BY rl.unit
    `).all(...params);
    res.json(success({
      period: { start_date, end_date },
      summary: { inspectionCount, highRiskCount, rectifyCount, rectifyClosedCount },
      unitBreakdown,
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
