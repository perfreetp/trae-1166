const ERROR_CODES = {
  AUTH_REQUIRED: { code: 10001, http: 401, msg: "未登录或令牌已过期" },
  AUTH_FORBIDDEN: { code: 10002, http: 403, msg: "无权限访问该资源" },
  AUTH_INVALID: { code: 10003, http: 401, msg: "无效的认证令牌" },

  PARAM_MISSING: { code: 20001, http: 400, msg: "缺少必要参数" },
  PARAM_INVALID: { code: 20002, http: 400, msg: "参数格式不合法" },
  PARAM_DUPLICATE: { code: 20003, http: 409, msg: "编号已存在，不可重复" },

  RELIC_NOT_FOUND: { code: 30001, http: 404, msg: "文物档案不存在" },
  TASK_NOT_FOUND: { code: 30002, http: 404, msg: "巡检任务不存在" },
  RECORD_NOT_FOUND: { code: 30003, http: 404, msg: "现场记录不存在" },
  RECTIFY_NOT_FOUND: { code: 30004, http: 404, msg: "整改记录不存在" },

  TASK_ALREADY_CLAIMED: { code: 40001, http: 409, msg: "任务已被他人领取" },
  TASK_ALREADY_SUBMITTED: { code: 40002, http: 409, msg: "任务已提交，不可重复操作" },
  TASK_NOT_CLAIMED: { code: 40003, http: 400, msg: "任务尚未领取，无法提交" },
  TASK_WRONG_ASSIGNEE: { code: 40004, http: 403, msg: "非任务负责人，无权操作" },
  RECTIFY_ALREADY_CLOSED: { code: 40005, http: 409, msg: "整改已关闭，不可再操作" },
  RECORD_RELIC_MISMATCH: { code: 40006, http: 400, msg: "记录所属文物与任务关联文物不一致" },
  TASK_NOT_CLAIMED_BY_YOU: { code: 40007, http: 403, msg: "任务未由当前用户领取，无法提交记录" },
  TASK_ALREADY_HAS_RECORD: { code: 40008, http: 409, msg: "该任务已有关联记录，不可重复提交" },
  CYCLE_INVALID: { code: 40009, http: 400, msg: "周期类型不合法" },
  DATE_INVALID: { code: 40010, http: 400, msg: "日期格式不合法" },
  COUNT_INVALID: { code: 40011, http: 400, msg: "生成数量不合法" },

  UPLOAD_FAILED: { code: 50001, http: 500, msg: "文件上传失败" },
  UPLOAD_TYPE_NOT_ALLOWED: { code: 50002, http: 400, msg: "不支持的文件类型" },

  INTERNAL_ERROR: { code: 90001, http: 500, msg: "服务器内部错误" },
};

class AppError extends Error {
  constructor(errorKey, detail) {
    const spec = ERROR_CODES[errorKey] || ERROR_CODES.INTERNAL_ERROR;
    super(detail || spec.msg);
    this.code = spec.code;
    this.httpStatus = spec.http;
    this.errorKey = errorKey;
    this.detail = detail;
  }

  toJSON() {
    return {
      code: this.code,
      error: this.errorKey,
      message: this.detail || ERROR_CODES[this.errorKey]?.msg || "未知错误",
    };
  }
}

function success(data, msg) {
  return { code: 0, message: msg || "success", data };
}

function paginate(rows, total, page, pageSize) {
  return {
    code: 0,
    message: "success",
    data: {
      list: rows,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

module.exports = { ERROR_CODES, AppError, success, paginate };
