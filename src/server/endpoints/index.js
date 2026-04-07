/**
 * Endpoints module index
 * Re-exports all endpoint modules (REST and WebSocket)
 */

const rest = require('./rest');
const ws = require('./ws');

module.exports = {
  rest,
  ws
};