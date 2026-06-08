const { AppError } = require("../utils/errors");

function validateBody(rules) {
  return (req, res, next) => {
    const errors = [];
    for (const [field, rule] of Object.entries(rules)) {
      const val = req.body[field];
      if (rule.required && (val === undefined || val === null || val === "")) {
        errors.push({ field, message: `${field} 为必填项` });
      }
      if (rule.enum && val && !rule.enum.includes(val)) {
        errors.push({ field, message: `${field} 值不合法，可选：${rule.enum.join(",")}` });
      }
      if (rule.type && val !== undefined) {
        if (rule.type === "number" && isNaN(Number(val))) {
          errors.push({ field, message: `${field} 应为数字` });
        }
      }
    }
    if (errors.length) {
      return next(new AppError("PARAM_INVALID", errors.map((e) => e.message).join("; ")));
    }
    next();
  };
}

module.exports = { validateBody };
