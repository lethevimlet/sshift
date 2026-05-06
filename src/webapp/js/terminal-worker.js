/**
 * Terminal Data Worker
 *
 * Offloads terminal data buffering and chunking from the main thread.
 * This prevents UI freezes when heavy terminal output (e.g. notcurses-demo)
 * floods the main thread with massive ANSI escape sequence payloads.
 *
 * The worker receives raw data from WebSocket events, buffers it, and
 * feeds it back to the main thread in controlled chunks at a steady rate.
 * This keeps the main thread responsive by avoiding single massive
 * terminal.write() calls that block rendering.
 */

const DEFAULT_CHUNK_SIZE = 16384; // 16KB chunks - small enough to keep UI responsive
const DEFAULT_FLUSH_INTERVAL = 8;  // ~120fps throughput - balances latency vs responsiveness
const MAX_BUFFER_SIZE = 4 * 1024 * 1024; // 4MB max buffer before dropping data

// Per-session state
const sessions = new Map();

// Global config (updated from main thread)
let config = {
  chunkSize: DEFAULT_CHUNK_SIZE,
  flushInterval: DEFAULT_FLUSH_INTERVAL
};

function createSessionState(sessionId) {
  return {
    buffer: '',
    timerActive: false,
    paused: false,
    totalBytesReceived: 0,
    totalBytesSent: 0,
    chunksSent: 0
  };
}

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSessionState());
  }
  return sessions.get(sessionId);
}

function flushChunks(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.paused) {
    session.timerActive = false;
    return;
  }

  if (session.buffer.length === 0) {
    session.timerActive = false;
    return;
  }

  // Take up to chunkSize bytes from the buffer
  const chunk = session.buffer.substring(0, config.chunkSize);
  session.buffer = session.buffer.substring(config.chunkSize);

  session.totalBytesSent += chunk.length;
  session.chunksSent++;

  self.postMessage({
    type: 'data',
    sessionId: sessionId,
    data: chunk
  });

  // If there's more data to send, schedule next chunk
  if (session.buffer.length > 0) {
    setTimeout(() => flushChunks(sessionId), config.flushInterval);
  } else {
    session.timerActive = false;
  }
}

function scheduleFlush(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.timerActive || session.paused) return;

  session.timerActive = true;
  setTimeout(() => flushChunks(sessionId), config.flushInterval);
}

self.onmessage = function(e) {
  const msg = e.data;

  switch (msg.type) {
    case 'config': {
      config.chunkSize = msg.chunkSize || DEFAULT_CHUNK_SIZE;
      config.flushInterval = msg.flushInterval || DEFAULT_FLUSH_INTERVAL;
      break;
    }

    case 'data': {
      const sessionId = msg.sessionId;
      if (!sessionId) break;

      const session = getOrCreateSession(sessionId);
      session.totalBytesReceived += (msg.data || '').length;

      // Drop data if buffer is overwhelmed (prevents memory explosion)
      if (session.buffer.length + (msg.data || '').length > MAX_BUFFER_SIZE) {
        // Emergency: flush entire buffer immediately in one go
        // Better than dropping data silently
        if (session.buffer.length > 0) {
          self.postMessage({
            type: 'data',
            sessionId: sessionId,
            data: session.buffer
          });
          session.totalBytesSent += session.buffer.length;
          session.chunksSent++;
          session.buffer = '';
        }
      }

      session.buffer += msg.data || '';
      scheduleFlush(sessionId);
      break;
    }

    case 'flush': {
      // Immediately flush all buffered data for a session
      const sessionId = msg.sessionId;
      if (!sessionId) break;

      const session = sessions.get(sessionId);
      if (!session || session.buffer.length === 0) break;

      self.postMessage({
        type: 'data',
        sessionId: sessionId,
        data: session.buffer
      });
      session.totalBytesSent += session.buffer.length;
      session.chunksSent++;
      session.buffer = '';
      session.timerActive = false;
      break;
    }

    case 'pause': {
      const sessionId = msg.sessionId;
      if (!sessionId) break;
      const session = sessions.get(sessionId);
      if (session) session.paused = true;
      break;
    }

    case 'resume': {
      const sessionId = msg.sessionId;
      if (!sessionId) break;
      const session = sessions.get(sessionId);
      if (session) {
        session.paused = false;
        if (session.buffer.length > 0) {
          scheduleFlush(sessionId);
        }
      }
      break;
    }

    case 'destroy': {
      const sessionId = msg.sessionId;
      if (!sessionId) break;
      const session = sessions.get(sessionId);
      if (session && session.buffer.length > 0) {
        self.postMessage({
          type: 'data',
          sessionId: sessionId,
          data: session.buffer
        });
      }
      sessions.delete(sessionId);
      break;
    }

    case 'destroy-all': {
      for (const [sessionId, session] of sessions) {
        if (session.buffer.length > 0) {
          self.postMessage({
            type: 'data',
            sessionId: sessionId,
            data: session.buffer
          });
        }
      }
      sessions.clear();
      break;
    }

    case 'stats': {
      const sessionId = msg.sessionId;
      const session = sessions.get(sessionId || '');
      self.postMessage({
        type: 'stats',
        sessionId: sessionId,
        stats: session ? {
          bufferLength: session.buffer.length,
          totalBytesReceived: session.totalBytesReceived,
          totalBytesSent: session.totalBytesSent,
          chunksSent: session.chunksSent,
          paused: session.paused
        } : null
      });
      break;
    }
  }
};