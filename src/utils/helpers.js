const { v4: uuidv4 } = require("uuid");

function genId() {
  return uuidv4();
}

function genRelicCode(category, seq) {
  const prefix = (category || "WW").slice(0, 2).toUpperCase();
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const seqStr = String(seq).padStart(4, "0");
  return `${prefix}${date}${seqStr}`;
}

function parsePage(query) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 20));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function like(keyword) {
  return `%${keyword}%`;
}

function now() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function calculateRiskLevel(damageParts, damageDesc) {
  if (!damageParts && !damageDesc) return "none";
  const parts = (damageParts || "").split(",").filter(Boolean).length;
  const desc = (damageDesc || "").toLowerCase();
  const severeKeywords = ["坍塌", "断裂", "严重", "渗水", "倾斜", "裂缝"];
  const hasSevere = severeKeywords.some((k) => desc.includes(k));
  if (hasSevere || parts >= 3) return "high";
  if (parts >= 2 || desc.length > 20) return "medium";
  return "low";
}

const VALID_CYCLES = ["daily", "weekly", "monthly", "quarterly", "yearly"];

const RISK_ORDER = { high: 1, medium: 2, low: 3, none: 4 };

function isValidDate(str) {
  if (!str || typeof str !== "string") return false;
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return d.getFullYear() === Number(match[1]) && d.getMonth() === Number(match[2]) - 1 && d.getDate() === Number(match[3]);
}

function generateCycleDates(cycle, startDate, count) {
  const dates = [];
  const start = new Date(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    switch (cycle) {
      case "daily":
        d.setDate(d.getDate() + i);
        break;
      case "weekly":
        d.setDate(d.getDate() + i * 7);
        break;
      case "monthly":
        d.setMonth(d.getMonth() + i);
        break;
      case "quarterly":
        d.setMonth(d.getMonth() + i * 3);
        break;
      case "yearly":
        d.setFullYear(d.getFullYear() + i);
        break;
      default:
        d.setDate(d.getDate() + i);
    }
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

module.exports = {
  genId,
  genRelicCode,
  parsePage,
  like,
  now,
  calculateRiskLevel,
  generateCycleDates,
  VALID_CYCLES,
  RISK_ORDER,
  isValidDate,
};
