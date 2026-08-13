/**
 * One error type for anything the client should be told about.
 *
 * Everything else is a 500 with no detail: the old system leaked driver errors
 * straight to the client and, worse, answered several failures with no response
 * at all (`server.js:216-253` — see docs/business-rules.md, "Transitions").
 * Every route here answers exactly once.
 */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message  shown to the client
   * @param {object} [detail] extra fields merged into the JSON body
   */
  constructor(status, message, detail) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }

  static badRequest(message, detail) { return new HttpError(400, message, detail); }
  static unauthorized(message = 'ไม่ได้เข้าสู่ระบบ') { return new HttpError(401, message); }
  static forbidden(message = 'ไม่มีสิทธิ์ใช้งาน') { return new HttpError(403, message); }
  static notFound(message = 'ไม่พบข้อมูล') { return new HttpError(404, message); }
}

module.exports = { HttpError };
