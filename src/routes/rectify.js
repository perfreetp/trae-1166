const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, now } = require("../utils/helpers");
const { writeAuditFromReq } = require("../utils/audit");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { record_id, relic_id, hazard_desc, risk_level, responsible_id, deadline, rectify_plan } = req.body;
    if (!record_id || !relic_id || !hazard_desc) return next(new AppError("PARAM_MISSING", "record_id、relic_id、hazard_desc 为必填项"));
    const record = db.prepare("SELECT id FROM records WHERE id = ?").get(record_id);
    if (!record) return next(new AppError("RECORD_NOT_FOUND"));
    const id = genId();
    db.prepare(
      `INSERT INTO rectifications (id,record_id,relic_id,hazard_desc,risk_level,responsible_id,deadline,rectify_plan) VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, record_id, relic_id, hazard_desc, risk_level || "medium", responsible_id, deadline, rectify_plan || null);
    writeAuditFromReq(req, "create_rectification", "rectification", id, `创建整改：${hazard_desc}`);
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(id);
    res.status(201).json(success(rect, "隐患整改记录创建成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { status, relic_id, responsible_id, risk_level, supervised } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (status) { where += " AND rc.status = ?"; params.push(status); }
    if (relic_id) { where += " AND rc.relic_id = ?"; params.push(relic_id); }
    if (responsible_id) { where += " AND rc.responsible_id = ?"; params.push(responsible_id); }
    if (risk_level) { where += " AND rc.risk_level = ?"; params.push(risk_level); }
    if (supervised !== undefined) { where += " AND rc.supervised = ?"; params.push(supervised ? 1 : 0); }
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
    if (rect.created_at && rect.status === "closed" && rect.updated_at) {
      rect.total_days = Math.round((new Date(rect.updated_at) - new Date(rect.created_at)) / 86400000);
    }
    res.json(success(rect));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/assign", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    const { responsible_id, rectify_plan } = req.body;
    if (!responsible_id) return next(new AppError("PARAM_MISSING", "responsible_id 为必填项"));
    db.prepare("UPDATE rectifications SET responsible_id = ?, status = 'assigned', rectify_plan = COALESCE(?, rectify_plan), updated_at = ? WHERE id = ?").run(responsible_id, rectify_plan || null, now(), req.params.id);
    writeAuditFromReq(req, "assign_rectification", "rectification", req.params.id, `分配整改责任人：${responsible_id}`);
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, "责任人已分配"));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/feedback", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    if (rect.status === "closed") return next(new AppError("RECTIFY_ALREADY_CLOSED"));
    const { process_feedback } = req.body;
    if (!process_feedback) return next(new AppError("PARAM_MISSING", "process_feedback 为必填项"));
    db.prepare("UPDATE rectifications SET process_feedback = ?, updated_at = ? WHERE id = ?").run(process_feedback, now(), req.params.id);
    writeAuditFromReq(req, "rectify_feedback", "rectification", req.params.id, `整改过程反馈：${process_feedback}`);
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, "过程反馈已保存"));
  } catch (err) {
    next(err);
  }
});

router.put("/:id/extend", (req, res, next) => {
  try {
    const rect = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    if (!rect) return next(new AppError("RECTIFY_NOT_FOUND"));
    if (rect.status === "closed") return next(new AppError("RECTIFY_ALREADY_CLOSED"));
    const { extension_request, new_deadline } = req.body;
    if (!extension_request) return next(new AppError("PARAM_MISSING", "extension_request 为必填项"));
    db.prepare("UPDATE rectifications SET extension_request = ?, deadline = COALESCE(?, deadline), updated_at = ? WHERE id = ?").run(extension_request, new_deadline || null, now(), req.params.id);
    writeAuditFromReq(req, "rectify_extension", "rectification", req.params.id, `延期申请：${extension_request}`);
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, "延期申请已提交"));
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
    writeAuditFromReq(req, "submit_rectification", "rectification", req.params.id, `提交整改结果：${result || ""}`);
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
    const { review_result, review_comment } = req.body;
    if (!review_result) return next(new AppError("PARAM_MISSING", "review_result 为必填项"));

    if (review_result === "pass") {
      db.prepare(
        "UPDATE rectifications SET reviewer_id = ?, review_result = ?, review_comment = ?, status = 'closed', reviewed_at = ?, updated_at = ? WHERE id = ?"
      ).run(req.user.id, review_result, review_comment || null, now(), now(), req.params.id);
      writeAuditFromReq(req, "review_rectification", "rectification", req.params.id, `复查通过，整改关闭${review_comment ? '，意见：' + review_comment : ''}`);
    } else {
      db.prepare(
        "UPDATE rectifications SET reviewer_id = ?, previous_review_result = ?, previous_review_comment = ?, review_result = NULL, review_comment = NULL, status = 'pending', result = NULL, reviewed_at = ?, updated_at = ? WHERE id = ?"
      ).run(req.user.id, review_result, review_comment || null, now(), now(), req.params.id);
      writeAuditFromReq(req, "review_rectification", "rectification", req.params.id, `复查未通过，退回待整改${review_comment ? '，意见：' + review_comment : ''}`);
    }
    const updated = db.prepare("SELECT * FROM rectifications WHERE id = ?").get(req.params.id);
    res.json(success(updated, review_result === "pass" ? "复查通过，整改关闭" : "复查未通过，退回待整改"));
  } catch (err) {
    next(err);
  }
});

router.post("/auto-supervise", (req, res, next) => {
  try {
    const today = now().slice(0, 10);
    const result = db.prepare(
      "UPDATE rectifications SET supervised = 1, updated_at = ? WHERE deadline IS NOT NULL AND deadline < ? AND status != 'closed' AND supervised = 0"
    ).run(now(), today);
    writeAuditFromReq(req, "auto_supervise", "rectification", "batch", `自动督办：${result.changes} 条逾期整改进入督办清单`);
    res.json(success({ count: result.changes }, `${result.changes} 条逾期整改已自动进入督办清单`));
  } catch (err) {
    next(err);
  }
});

router.get("/supervision/list", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { unit, risk_level } = req.query;
    const today = now().slice(0, 10);
    let where = "WHERE rc.deadline IS NOT NULL AND rc.deadline < ? AND rc.status != 'closed'";
    const params = [today];
    if (unit) { where += " AND rl.unit = ?"; params.push(unit); }
    if (risk_level) { where += " AND rc.risk_level = ?"; params.push(risk_level); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id ${where}`).get(...params).cnt;
    const rows = db.prepare(
      `SELECT rc.*, rl.name AS relic_name, rl.unit, u.name AS responsible_name, CASE rc.risk_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END AS risk_sort FROM rectifications rc LEFT JOIN relics rl ON rc.relic_id = rl.id LEFT JOIN users u ON rc.responsible_id = u.id ${where} ORDER BY risk_sort ASC, rc.deadline ASC LIMIT ? OFFSET ?`
    ).all(...params, pageSize, offset);
    for (const row of rows) {
      delete row.risk_sort;
      if (row.deadline) {
        row.overdue_days = Math.max(0, Math.ceil((new Date(today) - new Date(row.deadline)) / 86400000));
      }
      row.supervision_reason = `整改期限 ${row.deadline}，已逾期 ${row.overdue_days || 0} 天，当前状态 ${row.status}${row.supervised ? "，已自动打标" : ""}`;
    }
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
