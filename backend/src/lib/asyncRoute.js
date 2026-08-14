/**
 * Express 4 does not catch rejected promises: an `async` handler that throws
 * leaves the request hanging with no response and no log line. That is the same
 * silence the old system produced by never calling `res.send()` at all
 * (docs/business-rules.md, "Transitions"), arrived at from the other direction.
 *
 * Every handler in every router is wrapped in this, so a rejection reaches the
 * one error handler in `app.js` instead of vanishing.
 */
const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

module.exports = { asyncRoute };
