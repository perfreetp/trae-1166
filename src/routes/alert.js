const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now } = require("../utils/helpers");
const { writeAuditFromReq } = require("../utils/audit");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { name, relic_level, unit, risk_level, overdue_days, is_enabled } = req.body;
    if (!name || overdue_days === undefined) return next(new AppError("PARAM_MISSING", "name 和 overdue_days 为必填项"));
    const id = genId();
    db.prepare(
      "INSERT INTO alert_rules (id,name,relic_level,unit,risk_level,overdue_days,is_enabled) VALUES (?,?,?,?,?,?,?)"
    ).run(id, name, relic_level || null, unit || null, risk_level || null, overdue_days, is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1);
    writeAuditFromReq(req, "create_alert_rule", "alert_rule", id, `创建预警规则：${name}`);
    const rule = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id);
    res.status(201).json(success(rule, "预警规则创建成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { is_enabled } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (is_enabled !== undefined) { where += " AND ar.is_enabled = ?"; params.push(is_enabled); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM alert_rules ar ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM alert_rules ar ${where} ORDER BY ar.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/records", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { rule_id, biz_type, biz_id, is_read, start_date, end_date } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (rule_id) { where += " AND ar.rule_id = ?"; params.push(rule_id); }
    if (biz_type) { where += " AND ar.biz_type = ?"; params.push(biz_type); }
    if (biz_id) { where += " AND ar.biz_id = ?"; params.push(biz_id); }
    if (is_read !== undefined) { where += " AND ar.is_read = ?"; params.push(is_read); }
    if (start_date) { where += " AND ar.created_at >= ?"; params.push(start_date); }
    if (end_date) { where += " AND ar.created_at <= ?"; params.push(end_date); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM alert_records ar ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT ar.*, alr.name AS rule_name FROM alert_records ar LEFT JOIN alert_rules alr ON ar.rule_id = alr.id ${where} ORDER BY ar.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.put("/records/:id/read", (req, res, next) => {
  try {
    const rec = db.prepare("SELECT * FROM alert_records WHERE id = ?").get(req.params.id);
    if (!rec) return next(new AppError("PARAM_INVALID", "预警记录不存在"));
    db.prepare("UPDATE alert_records SET is_read = 1 WHERE id = ?").run(req.params.id);
    res.json(success(null, "已标记为已读"));
  } catch (err) {
    next(err);
  }
});

router.post("/trigger", (req, res, next) => {
  try {
    const today = now().slice(0, 10);
    const rules = db.prepare("SELECT * FROM alert_rules WHERE is_enabled = 1").all();
    if (rules.length === 0) return res.json(success({ triggered: 0 }, "无启用的预警规则"));

    let totalTriggered = 0;
    const insertAlert = db.prepare(
      "INSERT INTO alert_records (id,rule_id,biz_type,biz_id,title,content,user_id) VALUES (?,?,?,?,?,?,?)"
    );
    const checkDup = db.prepare(
      "SELECT id FROM alert_records WHERE rule_id = ? AND biz_type = ? AND biz_id = ? AND date(created_at) = ?"
    );

    const transaction = db.transaction(() => {
      for (const rule of rules) {
        const overdueDate = new Date();
        overdueDate.setDate(overdueDate.getDate() - rule.overdue_days);
        const overdueDateStr = overdueDate.toISOString().slice(0, 10);

        let rcWhere = "WHERE rc.status != 'closed' AND rc.created_at <= ?";
        const rcParams = [now()];
        if (rule.relic_level) { rcWhere += " AND rl.level = ?"; rcParams.push(rule.relic_level); }
        if (rule.unit) { rcWhere += " AND rl.unit = ?"; rcParams.push(rule.unit); }
        if (rule.risk_level) { rcWhere += " AND rc.risk_level = ?"; rcParams.push(rule.risk_level); }

        const overdueRects = db.prepare(
          `SELECT rc.id, rc.hazard_desc, rc.risk_level, rl.name AS relic_name, rl.level AS relic_level, rl.unit, rc.responsible_id FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${rcWhere}`
        ).all(...rcParams);

        for (const rc of overdueRects) {
          const dup = checkDup.get(rule.id, "rectification", rc.id, today);
          if (dup) continue;
          const title = `【${rule.name}】整改预警`;
          const content = `文物「${rc.relic_name}」的整改记录触发规则「${rule.name}」，风险等级：${rc.risk_level}，隐患：${rc.hazard_desc || ""}`;
          insertAlert.run(genId(), rule.id, "rectification", rc.id, title, content, rc.responsible_id);
          totalTriggered++;
        }

        let taskWhere = "WHERE t.status IN ('pending','claimed') AND t.plan_date < ?";
        const taskParams = [overdueDateStr];
        if (rule.relic_level) { taskWhere += " AND rl.level = ?"; taskParams.push(rule.relic_level); }
        if (rule.unit) { taskWhere += " AND rl.unit = ?"; taskParams.push(rule.unit); }

        const overdueTasks = db.prepare(
          `SELECT t.id, t.title, rl.name AS relic_name, rl.level AS relic_level, rl.unit, t.assignee_id FROM tasks t LEFT JOIN relics rl ON t.relic_id = rl.id ${taskWhere}`
        ).all(...taskParams);

        for (const t of overdueTasks) {
          const dup = checkDup.get(rule.id, "task", t.id, today);
          if (dup) continue;
          const title = `【${rule.name}】巡检逾期预警`;
          const content = `文物「${t.relic_name}」的巡检任务「${t.title}」触发规则「${rule.name}」，已逾期超过 ${rule.overdue_days} 天`;
          insertAlert.run(genId(), rule.id, "task", t.id, title, content, t.assignee_id);
          totalTriggered++;
        }
      }
    });
    transaction();

    writeAuditFromReq(req, "trigger_alert_rules", "alert_rule", "batch", `手动触发预警规则，生成 ${totalTriggered} 条预警`);
    res.json(success({ triggered: totalTriggered }, `已生成 ${totalTriggered} 条预警（去重）`));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const rule = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(req.params.id);
    if (!rule) return next(new AppError("PARAM_INVALID", "预警规则不存在"));
    res.json(success(rule));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", (req, res, next) => {
  try {
    const rule = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(req.params.id);
    if (!rule) return next(new AppError("PARAM_INVALID", "预警规则不存在"));
    const fields = ["name", "relic_level", "unit", "risk_level", "overdue_days", "is_enabled"];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (updates.length === 0) return res.json(success(rule));
    updates.push("updated_at = ?");
    params.push(now());
    params.push(req.params.id);
    db.prepare(`UPDATE alert_rules SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    writeAuditFromReq(req, "update_alert_rule", "alert_rule", req.params.id, "更新预警规则");
    const updated = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(req.params.id);
    res.json(success(updated, "更新成功"));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    const rule = db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(req.params.id);
    if (!rule) return next(new AppError("PARAM_INVALID", "预警规则不存在"));
    db.prepare("DELETE FROM alert_records WHERE rule_id = ?").run(req.params.id);
    db.prepare("DELETE FROM alert_rules WHERE id = ?").run(req.params.id);
    writeAuditFromReq(req, "delete_alert_rule", "alert_rule", req.params.id, `删除预警规则：${rule.name}`);
    res.json(success(null, "删除成功"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
