const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../database");
const config = require("../config");
const { success, AppError } = require("../utils/errors");

const router = express.Router();

router.post("/login", (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return next(new AppError("PARAM_MISSING", "用户名和密码为必填项"));
    }
    const user = db.prepare("SELECT * FROM users WHERE username = ? AND password = ?").get(username, password);
    if (!user) {
      return next(new AppError("AUTH_INVALID", "用户名或密码错误"));
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, name: user.name, role: user.role, unit: user.unit },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRES_IN }
    );
    res.json(success({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, unit: user.unit } }));
  } catch (err) {
    next(err);
  }
});

router.get("/profile", (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return next(new AppError("AUTH_REQUIRED"));
    const token = header.slice(7);
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare("SELECT id, username, name, role, unit FROM users WHERE id = ?").get(decoded.id);
    if (!user) return next(new AppError("AUTH_INVALID"));
    res.json(success(user));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
