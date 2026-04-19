/**
 * claude-attention Plugin
 *
 * Detects when Claude (https://claude.ai/claude-code) is waiting for user input
 * in an SSH terminal and flashes the tab to alert the user.
 *
 * Detection strategy:
 *   - Detects Claude's TUI by looking for "Claude" in the terminal state (sticky: once detected, stays true)
 *   - Tracks Claude's processing state via spinner characters (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠽⠛ ·✢✳✶✻✽)
 *   - While Claude is working (spinner seen within idleThreshold), ALL flashing is suppressed
 *   - When Claude goes idle (no spinner for > idleThreshold ms after working), flashes the tab
 *   - Schedules an immediate attention check when spinner stops (no delay waiting for timer)
 *   - Detects Claude-specific prompt patterns ("❯", "Do you want", "Allow", "Esc to cancel")
 *   - Prompt detection only activates in confirmed Claude sessions (isClaude gate)
 *   - Suppresses re-flash for a cooldown period after spinner stops a flash
 *
 * Configuration (in config.json under plugins[].config):
 *   - patterns: string[]       - Additional regex patterns to detect attention
 *   - debounceMs: number       - Milliseconds between full-state checks (default: 300)
 *   - flashDuration: number    - Flash duration in ms, 0 = flash until focused (default: 0)
 *   - excludePatterns: string[] - Regex patterns to exclude from detection
 *   - checkInterval: number    - Milliseconds between periodic terminal state checks (default: 2000)
 *   - idleThreshold: number    - Milliseconds without spinner before considered idle (default: 3000)
 *   - cooldownMs: number       - Milliseconds to suppress re-flash after spinner stops a flash (default: 1000)
 */

class ClaudeAttentionPlugin {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = {
      debounceMs: config.debounceMs || 300,
      flashDuration: config.flashDuration || 0,
      checkInterval: config.checkInterval || 2000,
      idleThreshold: config.idleThreshold || 3000,
      cooldownMs: config.cooldownMs || 1000,
      ...config,
    };

    this.patterns = this._buildPatterns(config.patterns || [], config.excludePatterns || []);

    this._dataTimers = new Map();
    this._checkTimers = new Map();
    this._flashing = new Map();
    this._sessionState = new Map();
  }

  _getSessionState(sessionId) {
    if (!this._sessionState.has(sessionId)) {
      this._sessionState.set(sessionId, {
        isClaude: false,
        lastSpinnerTime: 0,
        wasWorking: false,
        cooldownUntil: 0,
        idleCheckScheduled: false,
      });
    }
    return this._sessionState.get(sessionId);
  }

  _isWorking(sessionId) {
    const s = this._getSessionState(sessionId);
    return s.wasWorking && (Date.now() - s.lastSpinnerTime) < this.config.idleThreshold;
  }

  _buildPatterns(extraPatterns, excludePatterns) {
    const defaultPatterns = [
      /\> $/,
      /\> \x1b/,
      /❯ /,
      /waiting for input/i,
      /press enter/i,
      /press any key/i,
      /confirm\s*\?/i,
      /\(y\/n\)/i,
      /\(yes\/no\)/i,
      /\[Y\/n\]/i,
      /\[y\/N\]/i,
      /do you want/i,
      /allow/i,
      /Esc to cancel/i,
    ];

    let patterns = [...defaultPatterns];

    for (const p of extraPatterns) {
      try { patterns.push(new RegExp(p)); } catch (e) {
        console.error(`[claude-attention] Invalid pattern "${p}":`, e.message);
      }
    }

    for (const p of excludePatterns) {
      try {
        const regex = new RegExp(p);
        patterns = patterns.filter(pat => pat.source !== regex.source);
      } catch (e) {
        console.error(`[claude-attention] Invalid exclude pattern "${p}":`, e.message);
      }
    }

    return patterns;
  }

  _matchesPattern(text) {
    for (const pattern of this.patterns) {
      if (pattern.test(text)) return true;
    }
    return false;
  }

  _stripAnsi(str) {
    return str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9]+[hl]/g, '')
      .replace(/\x1b[\(\)]B/g, '')
      .replace(/\x1b[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[^[\]()?P]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f]/g, '')
      .trim();
  }

  _startFlash(sessionId) {
    const sessionState = this._getSessionState(sessionId);
    if (Date.now() < sessionState.cooldownUntil) return;
    if (this._isWorking(sessionId)) return;
    if (this._flashing.get(sessionId)) return;
    this._flashing.set(sessionId, true);
    this.ctx.flashTab(sessionId, { duration: this.config.flashDuration || 0 });
  }

  _stopFlash(sessionId) {
    if (!this._flashing.get(sessionId)) return;
    this._flashing.delete(sessionId);
    this.ctx.stopFlashTab(sessionId);
  }

  _scheduleCheck(sessionId) {
    if (this._dataTimers.has(sessionId)) return;

    const timer = setTimeout(() => {
      this._dataTimers.delete(sessionId);
      this._checkAttention(sessionId);
    }, this.config.debounceMs);

    this._dataTimers.set(sessionId, timer);
  }

  _scheduleIdleCheck(sessionId) {
    const sessionState = this._getSessionState(sessionId);
    if (sessionState.idleCheckScheduled) return;
    sessionState.idleCheckScheduled = true;

    const delay = this.config.idleThreshold + 200;

    setTimeout(() => {
      sessionState.idleCheckScheduled = false;
      if (!sessionState.wasWorking) return;
      if (this._isWorking(sessionId)) return;
      this._checkAttention(sessionId);
    }, delay);
  }

  _isSpinnerChar(text) {
    return /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠽⠛·✢✳✶✻✽]/.test(text);
  }

  _checkAttention(sessionId) {
    if (this._isWorking(sessionId)) return;

    const state = this.ctx.getTerminalState(sessionId);
    if (!state || !state.state) return;

    const lines = state.state.split('\n');
    const recentLines = lines.slice(-30);

    let foundClaude = false;
    let matchedPrompt = false;

    for (const line of recentLines) {
      const stripped = this._stripAnsi(line);
      if (!stripped) continue;

      if (/Claude/i.test(stripped)) {
        foundClaude = true;
      }

      if (this._matchesPattern(stripped) || this._matchesPattern(line)) {
        matchedPrompt = true;
      }
    }

    const sessionState = this._getSessionState(sessionId);
    if (foundClaude) {
      sessionState.isClaude = true;
    }

    if (!sessionState.isClaude) return;

    if (matchedPrompt) {
      this._startFlash(sessionId);
      return;
    }

    const now = Date.now();
    const timeSinceSpinner = now - sessionState.lastSpinnerTime;

    if (sessionState.wasWorking && timeSinceSpinner > this.config.idleThreshold) {
      this._startFlash(sessionId);
      sessionState.wasWorking = false;
    }
  }

  onData(sessionId, data) {
    const stripped = this._stripAnsi(data);
    const sessionState = this._getSessionState(sessionId);

    if (/Claude/i.test(stripped) || /Claude/i.test(data)) {
      sessionState.isClaude = true;
    }

    const isSpinner = this._isSpinnerChar(stripped) || this._isSpinnerChar(data);

    if (isSpinner) {
      sessionState.lastSpinnerTime = Date.now();
      sessionState.wasWorking = true;
      this._scheduleIdleCheck(sessionId);
      if (this._flashing.get(sessionId)) {
        this._stopFlash(sessionId);
        sessionState.cooldownUntil = Date.now() + this.config.cooldownMs;
      }
      return;
    }

    if (!sessionState.isClaude) return;
    if (this._isWorking(sessionId)) return;

    if (this._matchesPattern(stripped) || this._matchesPattern(data)) {
      this._startFlash(sessionId);
    } else {
      this._scheduleCheck(sessionId);
    }
  }

  onTerminalLine(sessionId, strippedLine, rawLine) {
    const sessionState = this._getSessionState(sessionId);

    if (/Claude/i.test(strippedLine)) {
      sessionState.isClaude = true;
    }

    if (!sessionState.isClaude) return;
    if (this._isWorking(sessionId)) return;

    if (this._matchesPattern(strippedLine) || this._matchesPattern(rawLine)) {
      this._startFlash(sessionId);
    }
  }

  onSessionConnect(sessionId) {
    this._sessionState.delete(sessionId);
    this._flashing.delete(sessionId);

    const existingTimer = this._checkTimers.get(sessionId);
    if (existingTimer) clearInterval(existingTimer);

    const timer = setInterval(() => {
      if (!this.ctx.getActiveSessions().includes(sessionId)) {
        clearInterval(timer);
        this._checkTimers.delete(sessionId);
        return;
      }
      this._checkAttention(sessionId);
    }, this.config.checkInterval);

    this._checkTimers.set(sessionId, timer);
  }

  onSessionDisconnect(sessionId) {
    this._stopFlash(sessionId);
    this._sessionState.delete(sessionId);

    const checkTimer = this._checkTimers.get(sessionId);
    if (checkTimer) {
      clearInterval(checkTimer);
      this._checkTimers.delete(sessionId);
    }

    const dataTimer = this._dataTimers.get(sessionId);
    if (dataTimer) {
      clearTimeout(dataTimer);
      this._dataTimers.delete(sessionId);
    }
  }
}

module.exports = ClaudeAttentionPlugin;