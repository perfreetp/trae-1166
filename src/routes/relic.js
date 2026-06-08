const express = require("express");
const db = require("../database");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage, like, now } = require("../utils/helpers");

const router = express.Router();

router.post("/", (req, res, next) => {
  try {
    const { code, name, category, era, level, location, longitude, latitude, area, description, unit } = req.body;
    if (!code || !name) return next(new AppError("PARAM_MISSING", "编号和名称为必填项"));
    const exists = db.prepare("SELECT id FROM relics WHERE code = ?").get(code);
    if (exists) return next(new AppError("PARAM_DUPLICATE", `编号 ${code} 已存在，不可重复`));
    const id = genId();
    db.prepare(
      `INSERT INTO relics (id,code,name,category,era,level,location,longitude,latitude,area,description,unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(id, code, name, category, era, level, location, longitude, latitude, area, description, unit);
    const relic = db.prepare("SELECT * FROM relics WHERE id = ?").get(id);
    res.status(201).json(success(relic, "文物档案创建成功"));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { keyword, category, level, unit, status } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (keyword) { where += " AND (name LIKE ? OR code LIKE ? OR description LIKE ?)"; params.push(like(keyword), like(keyword), like(keyword)); }
    if (category) { where += " AND category = ?"; params.push(category); }
    if (level) { where += " AND level = ?"; params.push(level); }
    if (unit) { where += " AND unit = ?"; params.push(unit); }
    if (status) { where += " AND status = ?"; params.push(status); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM relics ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM relics ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/search", (req, res, next) => {
  try {
    const { keyword, category, level, unit } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (keyword) { where += " AND (name LIKE ? OR code LIKE ? OR era LIKE ?)"; params.push(like(keyword), like(keyword), like(keyword)); }
    if (category) { where += " AND category = ?"; params.push(category); }
    if (level) { where += " AND level = ?"; params.push(level); }
    if (unit) { where += " AND unit = ?"; params.push(unit); }
    const rows = db.prepare(`SELECT id, code, name, category, era, level, location, unit, status FROM relics ${where} ORDER BY name LIMIT 50`).all(...params);
    res.json(success(rows));
  } catch (err) {
    next(err);
  }
});

router.get("/check-code", (req, res, next) => {
  try {
    const { code, excludeId } = req.query;
    if (!code) return next(new AppError("PARAM_MISSING", "编号为必填项"));
    let sql = "SELECT id FROM relics WHERE code = ?";
    const params = [code];
    if (excludeId) { sql += " AND id != ?"; params.push(excludeId); }
    const exists = db.prepare(sql).get(...params);
    res.json(success({ code, duplicate: !!exists }));
  } catch (err) {
    next(err);
  }
});

router.get("/:id", (req, res, next) => {
  try {
    const relic = db.prepare("SELECT * FROM relics WHERE id = ?").get(req.params.id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    res.json(success(relic));
  } catch (err) {
    next(err);
  }
});

router.put("/:id", (req, res, next) => {
  try {
    const relic = db.prepare("SELECT * FROM relics WHERE id = ?").get(req.params.id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    if (req.body.code && req.body.code !== relic.code) {
      const dup = db.prepare("SELECT id FROM relics WHERE code = ? AND id != ?").get(req.body.code, req.params.id);
      if (dup) return next(new AppError("PARAM_DUPLICATE", `编号 ${req.body.code} 已存在`));
    }
    const fields = ["name", "category", "era", "level", "location", "longitude", "latitude", "area", "description", "unit", "status", "code"];
    const updates = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
    }
    if (updates.length === 0) return res.json(success(relic));
    updates.push("updated_at = ?");
    params.push(now());
    params.push(req.params.id);
    db.prepare(`UPDATE relics SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    const updated = db.prepare("SELECT * FROM relics WHERE id = ?").get(req.params.id);
    res.json(success(updated, "更新成功"));
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    const relic = db.prepare("SELECT * FROM relics WHERE id = ?").get(req.params.id);
    if (!relic) return next(new AppError("RELIC_NOT_FOUND"));
    db.prepare("DELETE FROM relics WHERE id = ?").run(req.params.id);
    res.json(success(null, "删除成功"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
