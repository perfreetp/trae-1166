const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const initSQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'inspector',
  unit TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS relics (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  era TEXT,
  level TEXT,
  location TEXT,
  longitude REAL,
  latitude REAL,
  area REAL,
  description TEXT,
  unit TEXT,
  status TEXT DEFAULT 'normal',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  relic_id TEXT NOT NULL,
  title TEXT NOT NULL,
  cycle TEXT NOT NULL,
  plan_date TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  assignee_id TEXT,
  claimed_at TEXT,
  submitted_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (relic_id) REFERENCES relics(id)
);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  relic_id TEXT NOT NULL,
  inspector_id TEXT NOT NULL,
  longitude REAL,
  latitude REAL,
  altitude REAL,
  temperature REAL,
  humidity REAL,
  weather TEXT,
  damage_parts TEXT,
  damage_desc TEXT,
  risk_level TEXT DEFAULT 'none',
  remark TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (relic_id) REFERENCES relics(id)
);

CREATE TABLE IF NOT EXISTS rectifications (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  relic_id TEXT NOT NULL,
  hazard_desc TEXT NOT NULL,
  risk_level TEXT DEFAULT 'medium',
  responsible_id TEXT,
  status TEXT DEFAULT 'pending',
  deadline TEXT,
  result TEXT,
  reviewer_id TEXT,
  review_result TEXT,
  reviewed_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (record_id) REFERENCES records(id),
  FOREIGN KEY (relic_id) REFERENCES relics(id)
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  biz_type TEXT NOT NULL,
  biz_id TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  biz_id TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_relics_code ON relics(code);
CREATE INDEX IF NOT EXISTS idx_relics_unit ON relics(unit);
CREATE INDEX IF NOT EXISTS idx_tasks_relic ON tasks(relic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_records_task ON records(task_id);
CREATE INDEX IF NOT EXISTS idx_records_relic ON records(relic_id);
CREATE INDEX IF NOT EXISTS idx_records_inspector ON records(inspector_id);
CREATE INDEX IF NOT EXISTS idx_rectifications_record ON rectifications(record_id);
CREATE INDEX IF NOT EXISTS idx_rectifications_status ON rectifications(status);
CREATE INDEX IF NOT EXISTS idx_rectifications_responsible ON rectifications(responsible_id);
CREATE INDEX IF NOT EXISTS idx_media_biz ON media(biz_type, biz_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
`;

db.exec(initSQL);

const seedUser = db.prepare("SELECT COUNT(*) AS cnt FROM users").get();
if (seedUser.cnt === 0) {
  const { v4: uuidv4 } = require("uuid");
  const insertUser = db.prepare(
    "INSERT INTO users (id, username, password, name, role, unit) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertUser.run(uuidv4(), "admin", "admin123", "系统管理员", "admin", "管理局");
  insertUser.run(uuidv4(), "inspector1", "123456", "张巡检", "inspector", "第一巡检站");
  insertUser.run(uuidv4(), "inspector2", "123456", "李巡检", "inspector", "第二巡检站");
  insertUser.run(uuidv4(), "supervisor1", "123456", "王监管", "supervisor", "监管中心");
}

module.exports = db;
