/**
 * opencode-attention Plugin
 *
 * Flashes the tab when OpenCode (https://opencode.ai) finishes working and
 * is waiting for the user (reply complete, or a permission/confirmation
 * dialog).
 *
 * Detection strategy (state-transition based, not text-pattern based):
 *
 *   1. App detection is NON-STICKY: OpenCode is considered present only
 *      while one of its UI signatures is visible in the CURRENT viewport of
 *      the headless terminal (the "OpenCode x.y.z" status bar, the
 *      "ctrl+p commands" hint, the "esc interrupt" hint). When the user
 *      exits back to a shell the signatures disappear and, after a few
 *      misses, no NEW working episode can start — so a shell prompt can
 *      never arm the engine.
 *
 *   2. "Working" is tracked from two signals:
 *        - working indicators visible in the viewport footer (braille and
 *          block spinner glyphs, "esc to interrupt"/"esc interrupt"), and
 *        - sustained agent-driven output: bytes that arrive while the user
 *          has NOT typed recently (echo/UI responses to keystrokes are
 *          ignored via userEchoWindowMs).
 *
 *   3. The tab flashes ONLY on the working → idle TRANSITION: a working
 *      episode was observed, the working indicator is gone, and no work
 *      signal has been seen for idleThreshold ms. A finished reply and a
 *      permission dialog both look like this transition, so no brittle
 *      prompt regexes ("❯ ", "(y/n)", "allow", ...) are needed — those
 *      match ordinary chat prose, code and shell prompts.
 *
 *   4. User input (keystrokes) ends the current working episode, stops an
 *      active flash and suppresses flashing for cooldownMs — the user is
 *      already there. A genuinely running agent re-arms the episode with
 *      its very next spinner frame, so nothing is lost.
 *
 * Things that made v1.7.3 miss most "waiting for input" events, and how
 * they are handled now:
 *
 *   - The viewport was read through getTerminalState(), which serializes
 *     the whole 10k-line scrollback and returns NULL past its 1MB guard.
 *     Busy agent sessions — exactly the ones worth watching — went blind.
 *     Now it reads getTerminalViewport() (visible screen only) and follows
 *     the alternate-screen marker, so OpenCode's full-screen TUI is read
 *     from the buffer it actually draws on.
 *   - A transition that landed inside the post-keystroke cooldown was
 *     dropped and never retried. The engine now keeps a pendingAttention
 *     flag and retries on every check until the flash actually goes out.
 *   - Losing the app signature (a dialog can cover the status bar) wiped
 *     the pending episode. App misses now only stop NEW episodes from
 *     starting; an armed one still gets to flash.
 *   - A flash the user dismissed by simply looking at the tab left the
 *     server stuck in "already flashing", swallowing every later event.
 *     Clients now report onSessionFocus, and a fresh transition re-emits
 *     the flash anyway.
 *
 * Configuration (in config.json under plugins[].config):
 *   - flashDuration: number     - Flash duration in ms, 0 = flash until focused (default: 0)
 *   - checkInterval: number     - Milliseconds between periodic viewport checks (default: 2000)
 *   - idleThreshold: number     - Milliseconds without a work signal before OpenCode
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
 *                                 signature before new episodes are blocked (default: 3)
 *   - appPatterns: string[]     - Regexes replacing the default app signatures
 *   - spinnerStaleMs: number    - A bare spinner glyph only counts as "working" if
 *                                 output arrived within this window (default: 2000)
 *   - workStaleMs: number       - A screen with no output at all for this long is
 *                                 never considered working (default: 60000)
 *   - workingPatterns: string[] - Regexes replacing the default working indicators
 *   - workingHintPatterns: string[] - Regexes for run hints that count as working
 *                                 even on a quiet screen (default: "esc to interrupt")
 *   - patterns: string[]        - Extra attention regexes (footer lines, idle only)
 *   - excludePatterns: string[] - Remove patterns (by source) from all lists
 */

class OpenCodeAttentionPlugin {
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
      spinnerStaleMs: config.spinnerStaleMs || 2000,
      workStaleMs: config.workStaleMs || 60000,
    };

    // App signatures: the OpenCode TUI always renders its wordmark (status
    // bar "OpenCode x.y.z", splash logo) plus the command hint in the same
    // bar. Case-SENSITIVE on purpose so lowercase shell text (`cd
    // opencode`, paths, package names) can't arm the engine — and even a
    // false positive here only ARMS it; a flash still requires a real
    // working → idle transition.
    this._appPatterns = this._compileList(
      config.appPatterns || [
        'OpenCode',
        'ctrl\\+p commands',
        'esc interrupt',
        'esc to interrupt',
      ],
      'appPatterns',
      '' // case-sensitive
    );

    // Working indicators, scanned over the viewport footer only:
    //  - the full braille block (U+2800–U+28FF) covers every braille
    //    spinner variant across OpenCode versions,
    //  - ⬝■▣ are the legacy OpenCode spinner frames,
    //  - ◐◓◑◒◜◝◞◟ cover the arc/circle spinner frames,
    //  - "esc to interrupt"-style hints cover text-based indicators.
    this._workingPatterns = this._compileList(
      config.workingPatterns || [
        '[\\u2800-\\u28FF]',
        '[⬝■▣]',
        '[◐◓◑◒◜◝◞◟]',
        'esc to interrupt',
        'esc interrupt',
      ],
      'workingPatterns'
    );

    // Text hints that stay on screen for the WHOLE run ("esc to
    // interrupt"). Unlike a spinner glyph these are unambiguous, so they
    // count as "working" even when the screen is completely quiet.
    this._workingHintPatterns = this._compileList(
      config.workingHintPatterns || [
        'esc to interrupt',
        'esc interrupt',
      ],
      'workingHintPatterns'
    );

    // Optional user-supplied attention patterns (none by default).
    this._attentionPatterns = this._compileList(config.patterns || [], 'patterns');

    // excludePatterns removes entries (matched by regex source) from all lists.
    for (const p of (config.excludePatterns || [])) {
      try {
        const source = new RegExp(p).source;
        this._appPatterns = this._appPatterns.filter(r => r.source !== source);
        this._workingPatterns = this._workingPatterns.filter(r => r.source !== source);
        this._workingHintPatterns = this._workingHintPatterns.filter(r => r.source !== source);
        this._attentionPatterns = this._attentionPatterns.filter(r => r.source !== source);
      } catch (e) {
        console.error(`[opencode-attention] Invalid exclude pattern "${p}":`, e.message);
      }
    }

    this._sessionState = new Map();
    this._checkTimers = new Map();
    this._dataTimers = new Map();
    this._idleTimers = new Map();
    this._flashing = new Map();
  }

  _compileList(list, label, flags = 'i') {
    const out = [];
    for (const p of list) {
      try { out.push(new RegExp(p, flags)); } catch (e) {
        console.error(`[opencode-attention] Invalid ${label} regex "${p}":`, e.message);
      }
    }
    return out;
  }

  _getSessionState(sessionId) {
    if (!this._sessionState.has(sessionId)) {
      this._sessionState.set(sessionId, {
        appVisible: false,        // signature currently on screen
        appMissStreak: 0,         // consecutive checks without a signature
        working: false,           // working indicator seen recently
        workEpisode: false,       // a working episode is armed (not yet consumed)
        pendingAttention: false,  // wants to flash, hasn't managed to yet
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

  // Extract the current viewport, ANSI-stripped, one entry per screen line.
  //
  // Prefers the cheap viewport-only serialization; getTerminalState() is a
  // fallback for older hosts (it serializes the entire scrollback and
  // returns null once that exceeds its size guard).
  _getViewportLines(sessionId) {
    let state = null;
    if (typeof this.ctx.getTerminalViewport === 'function') {
      state = this.ctx.getTerminalViewport(sessionId);
    }
    if (!state || !state.state) {
      state = this.ctx.getTerminalState(sessionId);
    }
    if (!state || !state.state) return null;

    const rows = state.rows || 24;
    let text = state.state;

    // OpenCode's TUI runs on the alternate buffer, which the serializer
    // appends after a `\x1b[?1049h` marker — everything before it is the
    // scrolled-away normal buffer, not what the user is looking at.
    const altMarker = text.lastIndexOf('\x1b[?1049h');
    if (altMarker !== -1) {
      text = text.slice(altMarker);
    }

    const lines = text.split('\n');
    const viewport = lines.slice(-rows);
    return viewport.map(l => this._stripAnsi(l));
  }

  _startFlash(sessionId, { force = false } = {}) {
    const s = this._getSessionState(sessionId);
    const now = Date.now();
    // Suppressed for now — pendingAttention keeps it queued for a retry
    // instead of dropping the event on the floor.
    if (now < s.cooldownUntil) return;
    if (now - s.lastUserInputAt < this.config.userEchoWindowMs) return;
    // `force` is used for a fresh transition: re-emitting is harmless and
    // recovers from a flash the client cleared without telling us.
    if (!force && this._flashing.get(sessionId)) return;
    this._flashing.set(sessionId, true);
    s.pendingAttention = false;
    this.ctx.flashTab(sessionId, { duration: this.config.flashDuration || 0 });
  }

  _stopFlash(sessionId, { cooldown = false } = {}) {
    const s = this._getSessionState(sessionId);
    if (cooldown) {
      s.cooldownUntil = Date.now() + this.config.cooldownMs;
    }
    s.pendingAttention = false;
    if (!this._flashing.get(sessionId)) return;
    this._flashing.delete(sessionId);
    this.ctx.stopFlashTab(sessionId);
  }

  _resetSession(sessionId) {
    this._stopFlash(sessionId);
    this._sessionState.delete(sessionId);
    this._clearTimer(this._dataTimers, sessionId);
    this._clearTimer(this._idleTimers, sessionId);
  }

  _clearTimer(map, sessionId) {
    const timer = map.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      map.delete(sessionId);
    }
  }

  _markWorking(s, sessionId) {
    s.working = true;
    s.workEpisode = true;
    s.pendingAttention = false;
    s.lastWorkSignalAt = Date.now();
    // Re-evaluate as soon as the idle threshold could be met, so the flash
    // doesn't wait for the next periodic check (up to checkInterval later).
    this._clearTimer(this._idleTimers, sessionId);
    this._idleTimers.set(sessionId, setTimeout(() => {
      this._idleTimers.delete(sessionId);
      this._evaluate(sessionId);
    }, this.config.idleThreshold + 100));
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
        // OpenCode is off screen: no NEW working episode may start. An
        // already armed episode is kept on purpose — a dialog can hide
        // every signature, and an agent that exited on its own still
        // deserves its one flash. Anything the user did to leave the app
        // went through onUserInput, which clears the episode.
        s.appVisible = false;
        s.working = false;
      }
    }

    // 2) Working indicator in the footer region, in two tiers:
    //      - a run hint ("esc to interrupt") is unambiguous and counts even
    //        on a completely quiet screen;
    //      - a bare spinner glyph only counts while output is actually
    //        flowing. A spinner that animates always produces output, so a
    //        glyph with a quiet stream is a LEFTOVER (the finished status
    //        line pushed up by a dialog, a braille graph, a progress bar).
    //        Treating those as "still working" is what kept sessions
    //        pinned in the working state and swallowed the flash.
    const footer = viewport.slice(-this.config.footerLines);
    const hintVisible = footer.some(line => this._matchesAny(this._workingHintPatterns, line));
    const glyphVisible = !hintVisible &&
      footer.some(line => this._matchesAny(this._workingPatterns, line));
    const spinnerLive = (now - s.lastOutputAt) < this.config.spinnerStaleMs;
    // Last resort against a permanently stuck "working" state: a run that
    // is really in progress keeps repainting its elapsed-time counter, so
    // a screen that has produced NOTHING for workStaleMs is showing a
    // leftover, not a live run.
    const outputStale = (now - s.lastOutputAt) > this.config.workStaleMs;
    const workingVisible = s.appVisible && !outputStale &&
      (hintVisible || (glyphVisible && spinnerLive));

    if (workingVisible) {
      const wasFlashing = this._flashing.get(sessionId) || s.pendingAttention;
      this._markWorking(s, sessionId);
      // Working resumed — anything currently flashing is stale.
      if (wasFlashing) this._stopFlash(sessionId, { cooldown: true });
      return;
    }

    // 3) Idle transition: a working episode ended (indicator gone AND no
    //    work signal for idleThreshold) → the agent finished or is waiting
    //    on a dialog → flash.
    if (s.workEpisode && (now - s.lastWorkSignalAt) >= this.config.idleThreshold) {
      s.workEpisode = false;
      s.working = false;
      s.pendingAttention = true;
      this._startFlash(sessionId, { force: true });
      return;
    }

    // 4) A transition that was suppressed (cooldown after a keystroke)
    //    stays queued and is retried until it goes out or the user shows up.
    if (s.pendingAttention) {
      this._startFlash(sessionId);
      return;
    }

    // 5) Optional custom attention patterns (config-supplied only),
    //    evaluated against the footer while idle.
    if (s.appVisible && !s.working && this._attentionPatterns.length > 0) {
      // Level-triggered (the pattern stays on screen), so the dedupe in
      // _startFlash must apply — no force here.
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
      const wasFlashing = this._flashing.get(sessionId) || s.pendingAttention;
      this._markWorking(s, sessionId);
      if (wasFlashing) this._stopFlash(sessionId, { cooldown: true });
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
        const wasFlashing = this._flashing.get(sessionId) || s.pendingAttention;
        this._markWorking(s, sessionId);
        if (wasFlashing) this._stopFlash(sessionId, { cooldown: true });
      }
    }

    // Debounced evaluation so a burst that ends (stream complete, dialog
    // shown) is noticed quickly instead of waiting for the next interval.
    this._scheduleEvaluate(sessionId);
  }

  onUserInput(sessionId /*, data */) {
    const s = this._getSessionState(sessionId);
    s.lastUserInputAt = Date.now();
    // The user is here — stop flashing and hold off for a while. The
    // current episode is dropped as well: if the agent really is working,
    // its next spinner frame re-arms it within milliseconds, and if the
    // keystroke was the user quitting to a shell there is nothing left to
    // announce.
    s.workEpisode = false;
    s.working = false;
    this._stopFlash(sessionId, { cooldown: true });
  }

  // A client reported the user is looking at this tab.
  onSessionFocus(sessionId) {
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

module.exports = OpenCodeAttentionPlugin;
