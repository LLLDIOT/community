/** 统一响应封装：成功 { code: 0, data } */
export function ok(res, data, httpStatus = 200) {
  return res.status(httpStatus).json({ code: 0, data });
}

/** 统一失败：{ code, message }，httpStatus 默认 400 */
export function fail(res, message, code = 40000, httpStatus = 400) {
  return res.status(httpStatus).json({ code, message });
}

/** 分页参数归一化 */
export function parsePage(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
