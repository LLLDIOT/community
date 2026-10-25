/**
 * Express 4 的异步路由包装器
 *
 * 为什么必须有：Express 4 **不会**自动捕获 async handler 抛出的 Promise rejection。
 * 如果直接写 `router.get('/', async (req,res) => { throw ... })`，
 * 请求会一直挂着直到超时（客户端看到的是"无响应"而不是 500），
 * 而且 process 上会出现 unhandledRejection 告警。
 *
 * 用法：
 *   router.get('/x', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
