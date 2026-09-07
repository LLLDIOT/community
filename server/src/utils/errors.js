/** 业务异常：携带 code 与 httpStatus，由错误中间件统一转响应 */
export class BizError extends Error {
  constructor(message, { code = 40000, httpStatus = 400 } = {}) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 快捷：资源不存在 */
export function notFound(message = '资源不存在') {
  return new BizError(message, { code: 40400, httpStatus: 404 });
}

/** 快捷：权限不足 */
export function forbidden(message = '权限不足') {
  return new BizError(message, { code: 40300, httpStatus: 403 });
}

/** 快捷：参数校验失败 */
export function badRequest(message = '参数校验失败') {
  return new BizError(message, { code: 40001 });
}
