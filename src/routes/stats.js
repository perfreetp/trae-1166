const express = require("express");
const db = require("../database");
const { success, AppError } = require("../utils/errors");
const { now } = require("../utils/helpers");

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
    const today = now().slice(0, 10);
    const overdueTasks = db.prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE status IN ('pending','claimed') AND plan_date < ?").get(today).cnt;
    const overdueRectify = db.prepare("SELECT COUNT(*) AS cnt FROM rectifications WHERE deadline IS NOT NULL AND deadline < ? AND status != 'closed'").get(today).cnt;
    res.json(success({
      relics: { total: relicTotal },
      tasks: { total: taskTotal, pending: taskPending, claimed: taskClaimed, submitted: taskSubmitted, overdue: overdueTasks },
      rectifications: { total: rectifyTotal, pending: rectifyPending, rectified: rectifyRectified, closed: rectifyClosed, overdue: overdueRectify },
      highRisk,
    }));
  } catch (err) {
    next(err);
  }
});

router.get("/unit-progress", (req, res, next) => {
  try {
    const rows = db.prepare(`
      SELECT rl.unit,
        COUNT(DISTINCT rl.id) AS relic_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit)) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit) AND t.status = 'submitted') AS submitted_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit) AND t.status IN ('pending','claimed')) AS pending_count,
        (SELECT COUNT(*) FROM rectifications rc WHERE rc.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit)) AS rectify_count,
        (SELECT COUNT(*) FROM rectifications rc WHERE rc.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit) AND rc.status = 'closed') AS rectify_closed
      FROM relics rl
      GROUP BY rl.unit
      ORDER BY rl.unit
    `).all();
    const today = now().slice(0, 10);
    for (const row of rows) {
      row.completion_rate = row.task_count > 0 ? Math.round((row.submitted_count / row.task_count) * 100) : 0;
      row.rectify_closure_rate = row.rectify_count > 0 ? Math.round((row.rectify_closed / row.rectify_count) * 100) : 0;
      const overdueTasks = db.prepare("SELECT COUNT(*) AS cnt FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = ?) AND t.status IN ('pending','claimed') AND t.plan_date < ?").get(row.unit, today).cnt;
      row.overdue_count = overdueTasks;
      row.overdue_rate = row.task_count > 0 ? Math.round((overdueTasks / row.task_count) * 100) : 0;
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

    let rcWhere = "WHERE 1=1";
    const rcParams = [];
    if (start_date) { rcWhere += " AND rc.created_at >= ?"; rcParams.push(start_date); }
    if (end_date) { rcWhere += " AND rc.created_at <= ?"; rcParams.push(end_date); }
    if (unit) { rcWhere += " AND rl.unit = ?"; rcParams.push(unit); }

    const rectifyCount = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${rcWhere}`).get(...rcParams).cnt;
    const rectifyClosedCount = db.prepare(
      `SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${rcWhere} AND rc.status = 'closed'`
    ).get(...rcParams).cnt;

    let taskWhere = "WHERE 1=1";
    const taskParams = [];
    if (start_date) { taskWhere += " AND t.created_at >= ?"; taskParams.push(start_date); }
    if (end_date) { taskWhere += " AND t.created_at <= ?"; taskParams.push(end_date); }
    if (unit) { taskWhere += " AND rl.unit = ?"; taskParams.push(unit); }

    const taskCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${taskWhere}`).get(...taskParams).cnt;
    const taskSubmittedCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${taskWhere} AND t.status = 'submitted'`).get(...taskParams).cnt;

    const today = now().slice(0, 10);
    let overdueWhere = "WHERE t.status IN ('pending','claimed') AND t.plan_date < ?";
    const overdueParams = [today];
    if (start_date) { overdueWhere += " AND t.created_at >= ?"; overdueParams.push(start_date); }
    if (end_date) { overdueWhere += " AND t.created_at <= ?"; overdueParams.push(end_date); }
    if (unit) { overdueWhere += " AND rl.unit = ?"; overdueParams.push(unit); }
    const overdueTaskCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${overdueWhere}`).get(...overdueParams).cnt;

    const unitBreakdown = db.prepare(`
      SELECT rl.unit,
        COUNT(DISTINCT r.id) AS inspection_count,
        SUM(CASE WHEN r.risk_level = 'high' THEN 1 ELSE 0 END) AS high_risk,
        (SELECT COUNT(*) FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit) ${start_date ? "AND t.created_at >= '" + start_date + "'" : ""} ${end_date ? "AND t.created_at <= '" + end_date + "'" : ""}) AS task_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.relic_id IN (SELECT id FROM relics WHERE unit = rl.unit) AND t.status = 'submitted' ${start_date ? "AND t.created_at >= '" + start_date + "'" : ""} ${end_date ? "AND t.created_at <= '" + end_date + "'" : ""}) AS task_submitted
      FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where} GROUP BY rl.unit
    `).all(...params);
    for (const ub of unitBreakdown) {
      ub.completion_rate = ub.task_count > 0 ? Math.round((ub.task_submitted / ub.task_count) * 100) : 0;
    }

    res.json(success({
      period: { start_date: start_date || null, end_date: end_date || null },
      summary: {
        inspectionCount,
        highRiskCount,
        taskCount,
        taskSubmittedCount,
        completionRate: taskCount > 0 ? Math.round((taskSubmittedCount / taskCount) * 100) : 0,
        rectifyCount,
        rectifyClosedCount,
        rectifyClosureRate: rectifyCount > 0 ? Math.round((rectifyClosedCount / rectifyCount) * 100) : 0,
        overdueTaskCount,
        overdueRate: taskCount > 0 ? Math.round((overdueTaskCount / taskCount) * 100) : 0,
      },
      unitBreakdown,
    }));
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs", (req, res, next) => {
  try {
    const { biz_type, biz_id, action, operator_id, start_date, end_date, page, pageSize } = req.query;
    const pPage = Math.max(1, parseInt(page) || 1);
    const pPageSize = Math.min(100, Math.max(1, parseInt(pageSize) || 20));
    const offset = (pPage - 1) * pPageSize;

    let where = "WHERE 1=1";
    const params = [];
    if (biz_type) { where += " AND a.biz_type = ?"; params.push(biz_type); }
    if (biz_id) { where += " AND a.biz_id = ?"; params.push(biz_id); }
    if (action) { where += " AND a.action = ?"; params.push(action); }
    if (operator_id) { where += " AND a.operator_id = ?"; params.push(operator_id); }
    if (start_date) { where += " AND a.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND a.created_at <= ?"; params.push(end_date); }

    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM audit_logs a ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM audit_logs a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).all(...params, pPageSize, offset);
    res.json({
      code: 0,
      message: "success",
      data: { list: rows, total, page: pPage, pageSize: pPageSize, totalPages: Math.ceil(total / pPageSize) },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs/by-relic/:relic_id", (req, res, next) => {
  try {
    const { relic_id } = req.params;
    const taskIds = db.prepare("SELECT id FROM tasks WHERE relic_id = ?").all(relic_id).map((t) => t.id);
    const recordIds = db.prepare("SELECT id FROM records WHERE relic_id = ?").all(relic_id).map((r) => r.id);
    const rectifyIds = db.prepare("SELECT id FROM rectifications WHERE relic_id = ?").all(relic_id).map((r) => r.id);

    const clauses = ["(a.biz_type = 'relic' AND a.biz_id = ?)"];
    const params = [relic_id];
    for (const tid of taskIds) { clauses.push("(a.biz_type = 'task' AND a.biz_id = ?)"); params.push(tid); }
    for (const rid of recordIds) { clauses.push("(a.biz_type = 'record' AND a.biz_id = ?)"); params.push(rid); }
    for (const rcid of rectifyIds) { clauses.push("(a.biz_type = 'rectification' AND a.biz_id = ?)"); params.push(rcid); }

    const where = `WHERE ${clauses.join(" OR ")}`;
    const rows = db.prepare(`SELECT * FROM audit_logs a ${where} ORDER BY a.created_at DESC`).all(...params);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs/by-task/:task_id", (req, res, next) => {
  try {
    const { task_id } = req.params;
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task_id);
    if (!task) return next(new AppError("TASK_NOT_FOUND"));
    const recordIds = db.prepare("SELECT id FROM records WHERE task_id = ?").all(task_id).map((r) => r.id);

    const clauses = ["(a.biz_type = 'task' AND a.biz_id = ?)"];
    const params = [task_id];
    for (const rid of recordIds) { clauses.push("(a.biz_type = 'record' AND a.biz_id = ?)"); params.push(rid); }

    const where = `WHERE ${clauses.join(" OR ")}`;
    const rows = db.prepare(`SELECT * FROM audit_logs a ${where} ORDER BY a.created_at DESC`).all(...params);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/report/export", (req, res, next) => {
  try {
    const { start_date, end_date, unit } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (start_date) { where += " AND r.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND r.created_at <= ?"; params.push(end_date); }
    if (unit) { where += " AND rl.unit = ?"; params.push(unit); }

    const inspectionCount = db.prepare(`SELECT COUNT(*) AS cnt FROM records r LEFT JOIN relics rl ON r.relic_id = rl.id ${where}`).get(...params).cnt;

    let rcWhere = "WHERE 1=1";
    const rcParams = [];
    if (start_date) { rcWhere += " AND rc.created_at >= ?"; rcParams.push(start_date); }
    if (end_date) { rcWhere += " AND rc.created_at <= ?"; rcParams.push(end_date); }
    if (unit) { rcWhere += " AND rl.unit = ?"; rcParams.push(unit); }
    const rectifyCount = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${rcWhere}`).get(...rcParams).cnt;
    const rectifyClosedCount = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${rcWhere} AND rc.status = 'closed'`).get(...rcParams).cnt;

    let taskWhere = "WHERE 1=1";
    const taskParams = [];
    if (start_date) { taskWhere += " AND t.created_at >= ?"; taskParams.push(start_date); }
    if (end_date) { taskWhere += " AND t.created_at <= ?"; taskParams.push(end_date); }
    if (unit) { taskWhere += " AND rl.unit = ?"; taskParams.push(unit); }
    const taskCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${taskWhere}`).get(...taskParams).cnt;
    const taskSubmittedCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${taskWhere} AND t.status = 'submitted'`).get(...taskParams).cnt;

    const today = now().slice(0, 10);
    let overdueWhere = "WHERE t.status IN ('pending','claimed') AND t.plan_date < ?";
    const overdueParams = [today];
    if (start_date) { overdueWhere += " AND t.created_at >= ?"; overdueParams.push(start_date); }
    if (end_date) { overdueWhere += " AND t.created_at <= ?"; overdueParams.push(end_date); }
    if (unit) { overdueWhere += " AND rl.unit = ?"; overdueParams.push(unit); }
    const overdueTaskCount = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${overdueWhere}`).get(...overdueParams).cnt;

    const reportData = {
      export_time: now(),
      period: { start_date: start_date || null, end_date: end_date || null },
      unit: unit || null,
      summary: {
        inspectionCount,
        taskCount,
        taskSubmittedCount,
        completionRate: taskCount > 0 ? Math.round((taskSubmittedCount / taskCount) * 100) : 0,
        rectifyCount,
        rectifyClosedCount,
        rectifyClosureRate: rectifyCount > 0 ? Math.round((rectifyClosedCount / rectifyCount) * 100) : 0,
        overdueTaskCount,
        overdueRate: taskCount > 0 ? Math.round((overdueTaskCount / taskCount) * 100) : 0,
      },
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="report_${today}.json"`);
    res.json(reportData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
