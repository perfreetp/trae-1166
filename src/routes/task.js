const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now, generateCycleDates, VALID_CYCLES, isValidDate } = require("../utils/helpers");
const { writeAuditFromReq } = require("../utils/audit");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { relic_id, title, cycle, plan_date } = req.body;
    if (!relic_id || !title || !cycle || !plan_date) {
      return next(new AppError("PARAM_MISSING", "relic_id、title、cycle、plan_date 为必填项"));
    }
    if (!VALID_CYCLES.includes(cycle)) {
      return next(new AppError("CYCLE_INVALID", `周期类型不合法，可选值：${VALID_CYCLES.join(", ")}`));
    }
    if (!isValidDate(plan_date)) {
      return next(new AppError("DATE_INVALID", "plan_date 日期格式不合法，要求 YYYY-MM-DD"));
    }
    const relic = db.prepare("SELECT id FROM relics WHERE id = ?").get(relic_id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    const id = genId();
    db.prepare("INSERT INTO tasks (id,relic_id,title,cycle,plan_date) VALUES (?,?,?,?,?)").run(id, relic_id, title, cycle, plan_date);
    writeAuditFromReq(req, "create_task", "task", id, `创建巡检任务：${title}`);
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    res.status(201).json(success(task, "任务创建成功"));
  } catch (err) {
    next(err);
  }
});

router.post("/generate-cycle", (req, res, next) => {
  try {
    const { relic_id, cycle, start_date, count } = req.body;
    if (!relic_id || !cycle || !start_date || count === undefined || count === null) {
      return next(new AppError("PARAM_MISSING", "relic_id、cycle、start_date、count 为必填项"));
    }
    if (!VALID_CYCLES.includes(cycle)) {
      return next(new AppError("CYCLE_INVALID", `周期类型不合法，可选值：${VALID_CYCLES.join(", ")}`));
    }
    if (!isValidDate(start_date)) {
      return next(new AppError("DATE_INVALID", "start_date 日期格式不合法，要求 YYYY-MM-DD"));
    }
    const numCount = Number(count);
    if (!Number.isInteger(numCount) || numCount <= 0) {
      return next(new AppError("COUNT_INVALID", "count 必须为大于 0 的整数"));
    }
    if (numCount > 365) {
      return next(new AppError("COUNT_INVALID", "单次生成数量不可超过 365"));
    }
    const relic = db.prepare("SELECT id, name FROM relics WHERE id = ?").get(relic_id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    const dates = generateCycleDates(cycle, start_date, numCount);
    const insert = db.prepare("INSERT INTO tasks (id,relic_id,title,cycle,plan_date) VALUES (?,?,?,?,?)");
    const created = [];
    const transaction = db.transaction(() => {
      for (const d of dates) {
        const id = genId();
        insert.run(id, relic_id, `${relic.name}巡检-${d}`, cycle, d);
        created.push(id);
      }
      writeAuditFromReq(req, "generate_cycle_tasks", "relic", relic_id, `按周期批量生成 ${created.length} 个任务，周期：${cycle}，起始：${start_date}`);
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
    writeAuditFromReq(req, "claim_task", "task", req.params.id, `领取巡检任务：${task.title}`);
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
    writeAuditFromReq(req, "submit_task", "task", req.params.id, `手动提交巡检任务：${task.title}`);
    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
    res.json(success(updated, "任务提交成功"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
