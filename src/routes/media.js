const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../database");
const config = require("../config");
const { success, paginate, AppError } = require("../utils/errors");
const { genId, parsePage } = require("../utils/helpers");

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "audio/wav", "audio/mp3", "audio/mpeg", "audio/webm", "video/mp4"];
const UPLOAD_DIR = config.UPLOAD_DIR;
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new AppError("UPLOAD_TYPE_NOT_ALLOWED"));
  },
});

const router = express.Router();

router.post("/upload", upload.single("file"), (req, res, next) => {
  try {
    if (!req.file) return next(new AppError("PARAM_MISSING", "未选择文件"));
    const { biz_type, biz_id } = req.body;
    if (!biz_type || !biz_id) return next(new AppError("PARAM_MISSING", "biz_type 和 biz_id 为必填项"));
    const id = genId();
    const file_type = req.file.mimetype.startsWith("image") ? "image" : req.file.mimetype.startsWith("audio") ? "audio" : "video";
    db.prepare(
      `INSERT INTO media (id,biz_type,biz_id,file_type,file_name,file_path,file_size,mime_type) VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, biz_type, biz_id, file_type, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype);
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(id);
    res.status(201).json(success(media, "文件上传成功"));
  } catch (err) {
    next(err);
  }
});

router.post("/upload-batch", upload.array("files", 10), (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) return next(new AppError("PARAM_MISSING", "未选择文件"));
    const { biz_type, biz_id } = req.body;
    if (!biz_type || !biz_id) return next(new AppError("PARAM_MISSING", "biz_type 和 biz_id 为必填项"));
    const insert = db.prepare(
      `INSERT INTO media (id,biz_type,biz_id,file_type,file_name,file_path,file_size,mime_type) VALUES (?,?,?,?,?,?,?,?)`
    );
    const results = [];
    const transaction = db.transaction(() => {
      for (const file of req.files) {
        const id = genId();
        const file_type = file.mimetype.startsWith("image") ? "image" : file.mimetype.startsWith("audio") ? "audio" : "video";
        insert.run(id, biz_type, biz_id, file_type, file.originalname, file.filename, file.size, file.mimetype);
        results.push(id);
      }
    });
    transaction();
    res.status(201).json(success({ count: results.length, ids: results }, `${results.length} 个文件上传成功`));
  } catch (err) {
    next(err);
  }
});

router.get("/", (req, res, next) => {
  try {
    const { page, pageSize, offset } = parsePage(req.query);
    const { biz_type, biz_id, file_type } = req.query;
    let where = "WHERE 1=1";
    const params = [];
    if (biz_type) { where += " AND biz_type = ?"; params.push(biz_type); }
    if (biz_id) { where += " AND biz_id = ?"; params.push(biz_id); }
    if (file_type) { where += " AND file_type = ?"; params.push(file_type); }
    const total = db.prepare(`SELECT COUNT(*) AS cnt FROM media ${where}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM media ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json(paginate(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get("/:id/download", (req, res, next) => {
  try {
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
    if (!media) return next(new AppError("PARAM_INVALID", "附件不存在"));
    const filePath = path.join(UPLOAD_DIR, media.file_path);
    if (!fs.existsSync(filePath)) return next(new AppError("PARAM_INVALID", "文件已丢失"));
    res.download(filePath, media.file_name);
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", (req, res, next) => {
  try {
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
    if (!media) return next(new AppError("PARAM_INVALID", "附件不存在"));
    const filePath = path.join(UPLOAD_DIR, media.file_path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare("DELETE FROM media WHERE id = ?").run(req.params.id);
    res.json(success(null, "附件已删除"));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
