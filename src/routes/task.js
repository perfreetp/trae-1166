const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now, generateCycleDates } = require("../utils/helpers");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { relic_id, title, cycle, plan_date } = req.body;
    if (!relic_id || !title || !cycle || !plan_date) {
      return next(new AppError("PARAM_MISSING", "relic_id、title、cycle、plan_date 为必填项"));
    }
    const relic = db.prepare("SELECT id FROM relics WHERE id = ?").get(relic_id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    const id = genId();
    db.prepare("INSERT INTO tasks (id,relic_id,title,cycle,plan_date) VALUES (?,?,?,?,?)").run(id, relic_id, title, cycle, plan_date);
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    res.status(201).json(success(task, "任务创建成功"));
  } catch (err) {
    next(err);
  }
});

router.post("/generate-cycle", (req, res, next) => {
  try {
    const { relic_id, cycle, start_date, count } = req.body;
    if (!relic_id || !cycle || !start_date || !count) {
      return next(new AppError("PARAM_MISSING", "relic_id、cycle、start_date、count 为必填项"));
    }
    const relic = db.prepare("SELECT id, name FROM relics WHERE id = ?").get(relic_id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    const dates = generateCycleDates(cycle, start_date, Math.min(count, 365));
    const insert = db.prepare("INSERT INTO tasks (id,relic_id,title,cycle,plan_date) VALUES (?,?,?,?,?)");
    const created = [];
    const transaction = db.transaction(() => {
      for (const d of dates) {
        const id = genId();
        insert.run(id, relic_id, `${relic.name}巡检-${d}`, cycle, d);
        created.push(id);
      }
    });
    transaction();
    res.status(201).json(success({ created: created.length, ids: created }, `已生成 ${created.length} 个周期任务`));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { status, relic_id, assignee_id, cycle, start_date, end_date } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { where += " AND t.status = ?"; params.push(status); }
    if (relic_id) { where += " AND t.relic_id = ?"; params.push(relic_id); }
    if (assignee_id) { where += " AND t.assignee_id = ?"; params.push(assignee_id); }
    if (cycle) { where += " AND t.cycle = ?"; params.push(cycle); }
    if (start_date) { where += " AND t.plan_date >= ?"; params.push(start_date); }
    if (end_date) { where += " AND t.plan_date <= ?"; params.push(end_date); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM tasks t ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT t.*, r.name AS relic_name, r.code AS relic_code FROM tasks t LEFT JOIN relics r ON t.relic_id = r.id ${where} ORDER BY t.plan_date DESC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/overdue", (req, res, next) => {
  try {
    const today = now().slice(0, 10);
    const rows = db.prepare(
      `SELECT t.*, r.name AS relic_name FROM tasks t LEFT JOIN relics r ON t.relic_id = r.id WHERE t.status IN ('pending','claimed') AND t.plan_date < ? ORDER BY t.plan_date`
    ).all(today);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const task = db.prepare(
      `SELECT t.*, r.name AS relic_name, r.code AS relic_code FROM tasks t LEFT JOIN relics r ON t.relic_id = r.id WHERE t.id = ?`
    ).get(req.params.id);
    if (!task) return next(new AppError("TASK_NOT_FOUND"));
    res.json(success(task));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/claim", (req, res, next) => {
  try {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    if (!task) return next(new AppError("TASK_NOT_FOUND"));
    if (task.status !== "pending") return next(new AppError("TASK_ALREADY_CLAIMED"));
    const assignee_id = req.user.id;
    db.prepare("UPDATE tasks SET status = 'claimed', assignee_id = ?, claimed_at = ? WHERE id = ?").run(assignee_id, now(), req.params.id);
    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    res.json(success(updated, "任务领取成功"));
  } catch (err) {
    next(err);
  }
});

router.post("/:id/submit", (req, res, next) => {
  try {
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    if (!task) return next(new AppError("TASK_NOT_FOUND"));
    if (task.status === "pending") return next(new AppError("TASK_NOT_CLAIMED"));
    if (task.status === "submitted") return next(new AppError("TASK_ALREADY_SUBMITTED"));
    if (task.assignee_id !== req.user.id) return next(new AppError("TASK_WRONG_ASSIGNEE"));
    db.prepare("UPDATE tasks SET status = 'submitted', submitted_at = ? WHERE id = ?").run(now(), req.params.id);
    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    res.json(success(updated, "任务提交成功"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
