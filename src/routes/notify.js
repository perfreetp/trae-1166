const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now, RISK_ORDER } = require("../utils/helpers");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { user_id, type, title, content, biz_id } = req.body;
    if (!user_id || !type || !title) return next(new AppError("PARAM_MISSING", "user_id、type、title 为必填项"));
    const id = genId();
    db.prepare("INSERT INTO notifications (id,user_id,type,title,content,biz_id) VALUES (?,?,?,?,?,?)").run(id, user_id, type, title, content, biz_id);
    const n = db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
    res.status(201).json(success(n, "通知创建成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { user_id, type, is_read } = req.query;
    const targetUser = user_id || req.user.id;
    let where = "WHERE n.user_id = ?";
    const params = [targetUser];
    if (type) { where += " AND n.type = ?"; params.push(type); }
    if (is_read !== undefined) { where += " AND n.is_read = ?"; params.push(is_read); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM notifications n ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM notifications n ${where} ORDER BY n.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/unread-count", (req, res, next) => {
  try {
    const cnt = db.prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0").get(req.user.id).cnt;
    res.json(success({ count: cnt }));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/read", (req, res, next) => {
  try {
    const n = db.prepare("SELECT * FROM notifications WHERE id = ?").get(req.params.id);
    if (!n) return next(new AppError("PARAM_INVALID", "通知不存在"));
    db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(req.params.id);
    res.json(success(null, "已标记为已读"));
  } catch (err) {
    next(err);
  }
});

router.put("/read-all", (req, res, next) => {
  try {
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(req.user.id);
    res.json(success(null, "全部标记为已读"));
  } catch (err) {
    next(err);
  }
});

router.post("/push-overdue", (req, res, next) => {
  try {
    const today = now().slice(0, 10);
    const overdueTasks = db.prepare(
      `SELECT t.*, r.name AS relic_name, u.id AS user_id, u.name AS user_name FROM tasks t LEFT JOIN relics r ON t.relic_id = r.id LEFT JOIN users u ON t.assignee_id = u.id WHERE t.status IN ('pending','claimed') AND t.plan_date < ?`
    ).all(today);
    if (overdueTasks.length === 0) return res.json(success({ pushed: 0 }, "无逾期任务"));
    const insert = db.prepare("INSERT INTO notifications (id,user_id,type,title,content,biz_id) VALUES (?,?,?,?,?,?)");
    let count = 0;
    const transaction = db.transaction(() => {
      for (const task of overdueTasks) {
        if (!task.user_id) continue;
        insert.run(genId(), task.user_id, "overdue", "巡检任务逾期提醒", `文物「${task.relic_name}」的巡检任务「${task.title}」已逾期，计划日期：${task.plan_date}`, task.id);
        count++;
      }
    });
    transaction();
    res.json(success({ pushed: count }, `已推送 ${count} 条逾期提醒`));
  } catch (err) {
    next(err);
  }
});

router.get("/supervision-list", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { unit, risk_level } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (unit) { where += " AND r.unit = ?"; params.push(unit); }
    if (risk_level) { where += " AND rc.risk_level = ?"; params.push(risk_level); }
    const total = db.prepare(
      `SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics r ON rc.relic_id = r.id ${where}`
    ).get(...params).cnt;
    const rows = db.prepare(
      `SELECT rc.*, r.name AS relic_name, r.unit, r.level AS relic_level, u.name AS responsible_name, CASE rc.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS risk_sort FROM rectifications rc LEFT JOIN relics r ON rc.relic_id = r.id LEFT JOIN users u ON rc.responsible_id = u.id ${where} ORDER BY risk_sort ASC, rc.deadline ASC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    for (const row of rows) { delete row.risk_sort; }
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

function buildDashboardFilter(req) {
  const { unit, risk_level, overdue, rectify_stage } = req.query;
  const today = now().slice(0, 10);
  const filter = { where: "WHERE 1=1", params: [], today };

  if (unit) { filter.where += " AND rl.unit = ?"; filter.params.push(unit); }
  if (risk_level) { filter.where += " AND rc.risk_level = ?"; filter.params.push(risk_level); }

  if (overdue === "inspection") {
    filter.where += ` AND EXISTS (SELECT 1 FROM tasks t WHERE t.relic_id = rc.relic_id AND t.status IN ('pending','claimed') AND t.plan_date < ?)`;
    filter.params.push(today);
  } else if (overdue === "rectification") {
    filter.where += " AND rc.deadline IS NOT NULL AND rc.deadline < ? AND rc.status != 'closed'";
    filter.params.push(today);
  } else if (overdue === "yes") {
    filter.where += ` AND (rc.deadline IS NOT NULL AND rc.deadline < ? AND rc.status != 'closed' OR EXISTS (SELECT 1 FROM tasks t WHERE t.relic_id = rc.relic_id AND t.status IN ('pending','claimed') AND t.plan_date < ?))`;
    filter.params.push(today);
    filter.params.push(today);
  }

  if (rectify_stage) {
    if (rectify_stage === "pending") { filter.where += " AND rc.status IN ('pending','assigned')"; }
    else if (rectify_stage === "rectified") { filter.where += " AND rc.status = 'rectified'"; }
    else if (rectify_stage === "closed") { filter.where += " AND rc.status = 'closed'"; }
  }

  filter.unit = unit;
  filter.risk_level = risk_level;
  filter.overdue = overdue;
  filter.rectify_stage = rectify_stage;
  return filter;
}

function applyRectifyFilter(where, params, f, alias) {
  const rc = alias || "rc";
  const rl = "rl";
  if (f.unit) { where += ` AND ${rl}.unit = ?`; params.push(f.unit); }
  if (f.risk_level) { where += ` AND ${rc}.risk_level = ?`; params.push(f.risk_level); }
  if (f.overdue === "inspection") {
    where += ` AND EXISTS (SELECT 1 FROM tasks t WHERE t.relic_id = ${rc}.relic_id AND t.status IN ('pending','claimed') AND t.plan_date < ?)`;
    params.push(f.today);
  } else if (f.overdue === "rectification") {
    where += ` AND ${rc}.deadline IS NOT NULL AND ${rc}.deadline < ? AND ${rc}.status != 'closed'`;
    params.push(f.today);
  } else if (f.overdue === "yes") {
    where += ` AND (${rc}.deadline IS NOT NULL AND ${rc}.deadline < ? AND ${rc}.status != 'closed' OR EXISTS (SELECT 1 FROM tasks t WHERE t.relic_id = ${rc}.relic_id AND t.status IN ('pending','claimed') AND t.plan_date < ?))`;
    params.push(f.today);
    params.push(f.today);
  }
  if (f.rectify_stage) {
    if (f.rectify_stage === "pending") { where += ` AND ${rc}.status IN ('pending','assigned')`; }
    else if (f.rectify_stage === "rectified") { where += ` AND ${rc}.status = 'rectified'`; }
    else if (f.rectify_stage === "closed") { where += ` AND ${rc}.status = 'closed'`; }
  }
  return { where, params };
}

router.get("/risk-dashboard", (req, res, next) => {
  try {
    const f = buildDashboardFilter(req);
    const RISK_SORT = "CASE rc.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";

    const rows = db.prepare(
      `SELECT rc.*, rl.name AS relic_name, rl.unit, rl.level AS relic_level, u.name AS responsible_name, ${RISK_SORT} AS risk_sort FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id ${f.where} ORDER BY risk_sort ASC, rc.deadline ASC`
    ).all(...f.params);
    for (const row of rows) { delete row.risk_sort; }

    const showInspectionOv = !f.overdue || f.overdue === "inspection" || f.overdue === "yes";
    const showRectOv = !f.overdue || f.overdue === "rectification" || f.overdue === "yes";

    let highRiskUnclosed = [];
    if (showRectOv || !f.overdue) {
      let hruWhere = "WHERE rc.risk_level = 'high' AND rc.status != 'closed'";
      const hruParams = [];
      const hru = applyRectifyFilter(hruWhere, hruParams, f);
      highRiskUnclosed = db.prepare(
        `SELECT rc.*, rl.name AS relic_name, rl.unit, u.name AS responsible_name FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id ${hru.where} ORDER BY CASE rc.status WHEN 'pending' THEN 1 WHEN 'assigned' THEN 2 WHEN 'rectified' THEN 3 ELSE 4 END, rc.deadline ASC`
      ).all(...hru.params);
    }

    let overdueInspection = [];
    if (showInspectionOv) {
      let oiWhere = "WHERE t.status IN ('pending','claimed') AND t.plan_date < ?";
      const oiParams = [f.today];
      if (f.unit) { oiWhere += " AND rl.unit = ?"; oiParams.push(f.unit); }
      if (f.risk_level) {
        oiWhere += ` AND EXISTS (SELECT 1 FROM rectifications rc2 WHERE rc2.relic_id = t.relic_id AND rc2.risk_level = ?)`;
        oiParams.push(f.risk_level);
      }
      overdueInspection = db.prepare(
        `SELECT t.*, rl.name AS relic_name, rl.unit, u.name AS assignee_name FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id LEFT JOIN users u ON t.assignee_id = u.id ${oiWhere} ORDER BY t.plan_date ASC`
      ).all(...oiParams);
    }

    let overdueRectification = [];
    if (showRectOv) {
      let orWhere = "WHERE rc.deadline IS NOT NULL AND rc.deadline < ? AND rc.status != 'closed'";
      const orParams = [f.today];
      const orF = applyRectifyFilter(orWhere, orParams, f);
      overdueRectification = db.prepare(
        `SELECT rc.*, rl.name AS relic_name, rl.unit, u.name AS responsible_name FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id ${orF.where} ORDER BY ${RISK_SORT}, rc.deadline ASC`
      ).all(...orF.params);
    }

    res.json(success({
      filtered: rows,
      summaries: {
        high_risk_unclosed: highRiskUnclosed,
        overdue_inspection: overdueInspection,
        overdue_rectification: overdueRectification,
      },
    }));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
