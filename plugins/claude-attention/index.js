/**
 * claude-attention Plugin
 *
 * Flashes the tab when Claude Code (https://claude.ai/claude-code) finishes
 * working and is waiting for the user (reply complete, or a permission
 * dialog like "Do you want to make this edit?").
 *
 * Detection strategy (state-transition based, not text-pattern based):
 *
 *   1. App detection is NON-STICKY: Claude Code is considered present only
 *      while one of its UI signatures is visible in the CURRENT viewport of
 *      the headless terminal ("Claude", the "? for shortcuts" footer hint,
 *      "esc to interrupt", edit-mode hints). When the user exits back to a
 *      shell the signatures disappear and, after a few misses, all state
 *      resets — so a shell prompt can never flash the tab (the old sticky
 *      flag caused exactly that).
 *
 *   2. "Working" is tracked from two signals:
 *        - working indicators visible in the viewport footer (braille
 *          spinner glyphs, the ✢✳✶✻✽ sparkle spinner frames, and the
 *          "esc to interrupt" hint Claude Code shows while running), and
 *        - sustained agent-driven output: bytes that arrive while the user
 *          has NOT typed recently (echo/UI responses to keystrokes are
 *          ignored via userEchoWindowMs).
 *      NOTE: "·" is deliberately NOT a spinner char anymore — it appears in
 *      every status line ("3.2k tokens · esc to interrupt") and made the
 *      old working-detection fire on ordinary output.
 *
 *   3. The tab flashes ONLY on the working → idle TRANSITION: a working
 *      episode was observed, the working indicator is gone, and no work
 *      signal has been seen for idleThreshold ms. A finished reply and a
 *      permission dialog both look like this transition, so no brittle
 *      prompt regexes ("❯", "Do you want", "allow", ...) are needed.
 *
 *   4. User input (keystrokes) stops an active flash immediately and
 *      suppresses flashing for cooldownMs — the user is already there.
 *
 * There are NO default attention text patterns: strings like "(y/n)",
 * "allow" or "❯ " routinely appear inside chat prose, code and shell
 * prompts and caused constant false flashes. Custom `patterns` from the
 * config are still honored, but they are only evaluated while Claude is on
 * screen and not working.
 *
 * Configuration (in config.json under plugins[].config):
 *   - flashDuration: number     - Flash duration in ms, 0 = flash until focused (default: 0)
 *   - checkInterval: number     - Milliseconds between periodic viewport checks (default: 2000)
 *   - idleThreshold: number     - Milliseconds without a work signal before Claude
 *                                 is considered idle/finished (default: 2500)
 *   - cooldownMs: number        - Milliseconds to suppress flashing after user input
 *                                 or after a flash stops (default: 3000)
 *   - debounceMs: number        - Debounce for output-driven evaluations (default: 300)
 *   - footerLines: number       - Viewport bottom lines scanned for working
 *                                 indicators / custom patterns (default: 8)
 *   - userEchoWindowMs: number  - Output arriving within this window after a
 *                                 keystroke counts as echo, not agent work (default: 1200)
 *   - minWorkBytes: number      - Agent-driven bytes within workWindowMs that
 *                                 mark the session as working (default: 600)
 *   - workWindowMs: number      - Rolling window for minWorkBytes (default: 2000)
 *   - appMissLimit: number      - Consecutive viewport checks without an app
 *                                 signature before state resets (default: 3)
 *   - appPatterns: string[]     - Regexes replacing the default app signatures
 *   - workingPatterns: string[] - Regexes replacing the default working indicators
 *   - patterns: string[]        - Extra attention regexes (footer lines, idle only)
 *   - excludePatterns: string[] - Remove patterns (by source) from all lists
 */

class ClaudeAttentionPlugin {
  constructor(ctx, config = {}) {
    this.ctx = ctx;
    this.config = {
      flashDuration: config.flashDuration || 0,
      checkInterval: config.checkInterval || 2000,
      idleThreshold: config.idleThreshold || 2500,
      cooldownMs: config.cooldownMs || 3000,
      debounceMs: config.debounceMs || 300,
      footerLines: config.footerLines || 8,
      userEchoWindowMs: config.userEchoWindowMs || 1200,
      minWorkBytes: config.minWorkBytes || 600,
      workWindowMs: config.workWindowMs || 2000,
      appMissLimit: config.appMissLimit || 3,
    };

    // App signatures. Claude Code's welcome box scrolls away in long
    // sessions, so alongside the case-SENSITIVE "Claude" wordmark (keeps
    // lowercase shell text like `cd claude-project` from arming the
    // engine) we accept the persistent footer hints. A false positive
    // here only ARMS the engine; a flash still requires a real
    // working → idle transition.
    this._appPatterns = this._compileList(
      config.appPatterns || [
        'Claude',
        '\\? for shortcuts',
        'esc to interrupt',
        'accept edits',
        'plan mode',
        'bypass permissions',
      ],
      'appPatterns',
      '' // case-sensitive
    );

    // Working indicators, scanned over the viewport footer only:
    //  - the full braille block (U+2800–U+28FF) covers braille spinners,
    //  - ✢✳✶✻✽∗ are Claude Code's sparkle spinner frames,
    //  - "esc to interrupt" is shown for the whole duration of a run.
    this._workingPatterns = this._compileList(
      config.workingPatterns || [
        '[\\u2800-\\u28FF]',
        '[✢✳✶✻✽∗]',
        'esc to interrupt',
      ],
      'workingPatterns'
    );

    // Optional user-supplied attention patterns (none by default).
    this._attentionPatterns = this._compileList(config.patterns || [], 'patterns');

    // excludePatterns removes entries (matched by regex source) from all lists.
    for (const p of (config.excludePatterns || [])) {
      try {
        const source = new RegExp(p).source;
        this._appPatterns = this._appPatterns.filter(r => r.source !== source);
        this._workingPatterns = this._workingPatterns.filter(r => r.source !== source);
        this._attentionPatterns = this._attentionPatterns.filter(r => r.source !== source);
      } catch (e) {
        console.error(`[claude-attention] Invalid exclude pattern "${p}":`, e.message);
      }
    }

    this._sessionState = new Map();
    this._checkTimers = new Map();
    this._dataTimers = new Map();
    this._flashing = new Map();
  }

  _compileList(list, label, flags = 'i') {
    const out = [];
    for (const p of list) {
      try { out.push(new RegExp(p, flags)); } catch (e) {
        console.error(`[claude-attention] Invalid ${label} regex "${p}":`, e.message);
      }
    }
    return out;
  }

  _getSessionState(sessionId) {
    if (!this._sessionState.has(sessionId)) {
      this._sessionState.set(sessionId, {
        appVisible: false,        // signature currently on screen
        appMissStreak: 0,         // consecutive checks without a signature
        working: false,           // inside a working episode
        lastWorkSignalAt: 0,      // last time any work signal was seen
        lastUserInputAt: 0,       // last user keystroke
        lastOutputAt: 0,          // last output of any kind
        agentBytes: 0,            // agent-driven bytes in the rolling window
        agentWindowStart: 0,
        cooldownUntil: 0,
      });
    }
    return this._sessionState.get(sessionId);
  }

  _stripAnsi(str) {
    return str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[\?[0-9]+[hl]/g, '')
      .replace(/\x1b[\(\)]B/g, '')
      .replace(/\x1b[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1b[^[\]()?P]/g, '')
      .replace(/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f]/g, '');
  }

  _matchesAny(patterns, text) {
    for (const p of patterns) {
      if (p.test(text)) return true;
    }
    return false;
  }

  // Extract the current viewport (last `rows` lines) from the serialized
  // terminal state, ANSI-stripped, one entry per screen line.
  _getViewportLines(sessionId) {
    const state = this.ctx.getTerminalState(sessionId);
    if (!state || !state.state) return null;
    const rows = state.rows || 24;
    const lines = state.state.split('\n');
    const viewport = lines.slice(-rows);
    return viewport.map(l => this._stripAnsi(l));
  }

  _startFlash(sessionId) {
    const s = this._getSessionState(sessionId);
    const now = Date.now();
    if (now < s.cooldownUntil) return;
    if (now - s.lastUserInputAt < this.config.userEchoWindowMs) return;
    if (this._flashing.get(sessionId)) return;
    this._flashing.set(sessionId, true);
    this.ctx.flashTab(sessionId, { duration: this.config.flashDuration || 0 });
  }

  _stopFlash(sessionId, { cooldown = false } = {}) {
    if (cooldown) {
      const s = this._getSessionState(sessionId);
      s.cooldownUntil = Date.now() + this.config.cooldownMs;
    }
    if (!this._flashing.get(sessionId)) return;
    this._flashing.delete(sessionId);
    this.ctx.stopFlashTab(sessionId);
  }

  _resetSession(sessionId) {
    this._stopFlash(sessionId);
    this._sessionState.delete(sessionId);
    const dataTimer = this._dataTimers.get(sessionId);
    if (dataTimer) {
      clearTimeout(dataTimer);
      this._dataTimers.delete(sessionId);
    }
  }

  _markWorking(s) {
    const now = Date.now();
    s.working = true;
    s.lastWorkSignalAt = now;
  }

  // Core evaluation: reads the live viewport and drives the state machine.
  _evaluate(sessionId) {
    const viewport = this._getViewportLines(sessionId);
    if (!viewport) return;

    const s = this._getSessionState(sessionId);
    const now = Date.now();

    // 1) App presence (non-sticky, with a small miss streak so a single
    //    mid-redraw check can't reset state).
    const appOnScreen = viewport.some(line => this._matchesAny(this._appPatterns, line));
    if (appOnScreen) {
      s.appVisible = true;
      s.appMissStreak = 0;
    } else {
      s.appMissStreak++;
      if (s.appMissStreak >= this.config.appMissLimit) {
        // Claude left the screen (user exited to shell, switched apps).
        const wasFlashing = this._flashing.get(sessionId);
        s.appVisible = false;
        s.working = false;
        if (wasFlashing) this._stopFlash(sessionId);
      }
      return;
    }

    // 2) Working indicator in the footer region.
    const footer = viewport.slice(-this.config.footerLines);
    const workingVisible = footer.some(line => this._matchesAny(this._workingPatterns, line));

    if (workingVisible) {
      this._markWorking(s);
      // Working resumed — anything currently flashing is stale.
      if (this._flashing.get(sessionId)) {
        this._stopFlash(sessionId, { cooldown: true });
      }
      return;
    }

    // 3) Idle transition: a working episode ended (indicator gone AND no
    //    work signal for idleThreshold) → the reply finished or a
    //    permission dialog is waiting → flash.
    if (s.working && (now - s.lastWorkSignalAt) >= this.config.idleThreshold) {
      s.working = false;
      this._startFlash(sessionId);
      return;
    }

    // 4) Optional custom attention patterns (config-supplied only),
    //    evaluated against the footer while idle.
    if (!s.working && this._attentionPatterns.length > 0) {
      if (footer.some(line => this._matchesAny(this._attentionPatterns, line))) {
        this._startFlash(sessionId);
      }
    }
  }

  _scheduleEvaluate(sessionId) {
    if (this._dataTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this._dataTimers.delete(sessionId);
      this._evaluate(sessionId);
    }, this.config.debounceMs);
    this._dataTimers.set(sessionId, timer);
  }

  onData(sessionId, data) {
    const s = this._getSessionState(sessionId);
    const now = Date.now();
    s.lastOutputAt = now;

    // Cheap inline work signal: spinner/indicator glyphs in the stream
    // keep the working state fresh without waiting for a viewport check.
    if (s.appVisible && this._matchesAny(this._workingPatterns, data)) {
      this._markWorking(s);
      if (this._flashing.get(sessionId)) {
        this._stopFlash(sessionId, { cooldown: true });
      }
      return;
    }

    // Agent-driven output heuristic: bytes arriving while the user hasn't
    // typed recently. Echo/UI reactions to keystrokes don't count.
    if (now - s.lastUserInputAt > this.config.userEchoWindowMs) {
      if (now - s.agentWindowStart > this.config.workWindowMs) {
        s.agentWindowStart = now;
        s.agentBytes = 0;
      }
      s.agentBytes += data.length;
      if (s.appVisible && s.agentBytes >= this.config.minWorkBytes) {
        this._markWorking(s);
        if (this._flashing.get(sessionId)) {
          this._stopFlash(sessionId, { cooldown: true });
        }
      }
    }

    // Debounced evaluation so a burst that ends (stream complete, dialog
    // shown) is noticed quickly instead of waiting for the next interval.
    this._scheduleEvaluate(sessionId);
  }

  onUserInput(sessionId /*, data */) {
    const s = this._getSessionState(sessionId);
    s.lastUserInputAt = Date.now();
    // The user is here — stop flashing and hold off for a while.
    this._stopFlash(sessionId, { cooldown: true });
  }

  onSessionConnect(sessionId) {
    this._resetSession(sessionId);
    this._flashing.delete(sessionId);

    const existingTimer = this._checkTimers.get(sessionId);
    if (existingTimer) clearInterval(existingTimer);

    const timer = setInterval(() => {
      if (!this.ctx.getActiveSessions().includes(sessionId)) {
        clearInterval(timer);
        this._checkTimers.delete(sessionId);
        return;
      }
      this._evaluate(sessionId);
    }, this.config.checkInterval);

    this._checkTimers.set(sessionId, timer);
  }

  onSessionDisconnect(sessionId) {
    this._resetSession(sessionId);

    const checkTimer = this._checkTimers.get(sessionId);
    if (checkTimer) {
      clearInterval(checkTimer);
      this._checkTimers.delete(sessionId);
    }
  }
}

module.exports = ClaudeAttentionPlugin;
