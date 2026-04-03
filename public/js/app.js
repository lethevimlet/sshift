// SSHIFT Client Application
class SSHIFTClient {
  constructor() {
    console.log('[SSHIFT] Initializing client...');
    try {
      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });
      console.log('[SSHIFT] Socket created');
    } catch (e) {
      console.error('[SSHIFT] Failed to create socket:', e);
    }
    this.sessions = new Map();
    this.activeSessionId = null;
    this.bookmarks = [];
    this.folders = [];
    this.currentConnectionType = 'ssh';
    this.sidebarCollapsed = this.loadSidebarState();
    this.sftpSessions = new Map(); // Track SFTP sessions separately
    this.draggedTab = null;
    this.draggedBookmark = null;
    this.draggedFolder = null;
    this.sticky = true; // Default to true - combines stickyTabs and stickySessions
    this.savedTabs = []; // Store tab information
    this.isRestoring = false; // Flag to prevent saving during restoration
    this.sftpClipboard = null; // For cut/copy/paste: { action: 'cut'|'copy', path: string, name: string, sessionId: string }
    this.terminalColorOverride = true; // Default to true, will be loaded in initThemeAndAccent
    this.terminalBgColor = '#0d1117';
    this.terminalFgColor = '#e6edf3';
    this.terminalSelectionColor = '#264f78';
    
    // Mobile scroll behavior
    this.isMobile = window.innerWidth <= 768;
    this.scrollTimeout = null;
    this.headerHidden = false;
    this.tabsHidden = false;
    
    // Mobile keys bar
    this.mobileKeysBarEnabled = true; // Default to enabled
    this.ctrlPressed = false; // Track Ctrl key state
    this.altPressed = false; // Track Alt key state
    
    console.log('[SSHIFT] Mobile detection - isMobile:', this.isMobile, 'window width:', window.innerWidth);
    
    this.init();
  }

  async loadStickyConfig() {
    try {
      const response = await fetch('/api/config');
      const config = await response.json();
      // Load sticky from config
      this.sticky = config.sticky !== undefined ? config.sticky : true;
      // Load SSH keepalive settings from config
      this.sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      this.sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      // Load mobile keys bar setting
      this.mobileKeysBarEnabled = config.mobileKeysBarEnabled !== undefined ? config.mobileKeysBarEnabled : true;
      console.log('[SSHIFT] Sticky:', this.sticky ? 'enabled' : 'disabled',
                  'Keepalive Interval:', this.sshKeepaliveInterval,
                  'Keepalive Count Max:', this.sshKeepaliveCountMax,
                  'Mobile Keys Bar:', this.mobileKeysBarEnabled ? 'enabled' : 'disabled');
    } catch (err) {
      console.error('[SSHIFT] Failed to load config:', err);
      this.sticky = true; // Default to true
      this.sshKeepaliveInterval = 10000;
      this.sshKeepaliveCountMax = 1000;
      this.mobileKeysBarEnabled = true; // Default to true
    }
  }

  saveTabs() {
    if (this.isRestoring) return;
    if (!this.sticky) {
      // If sticky is disabled, clear any saved tabs
      this.clearTabs();
      return;
    }
    
    const tabs = [];
    
    // Get tabs in DOM order from the tabs container
    const tabsContainer = document.getElementById('tabs');
    const tabElements = tabsContainer ? Array.from(tabsContainer.children) : [];
    
    // Save tabs in DOM order
    tabElements.forEach(tabElement => {
      const sessionId = tabElement.dataset.sessionId;
      const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
      
      if (session) {
        tabs.push({
          sessionId,
          name: session.name,
          type: session.type,
          connectionData: session.connectionData,
          active: sessionId === this.activeSessionId
        });
      }
    });
    
    localStorage.setItem('openTabs', JSON.stringify(tabs));
    console.log('[SSHIFT] Saved tabs:', tabs.length);
  }

  loadTabs() {
    try {
      const saved = localStorage.getItem('openTabs');
      return saved ? JSON.parse(saved) : null;
    } catch (err) {
      console.error('[SSHIFT] Failed to load tabs:', err);
      return null;
    }
  }

  clearTabs() {
    localStorage.removeItem('openTabs');
  }

  // Helper method to copy text to clipboard with fallback
  async copyToClipboard(text) {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      console.warn('[SSHIFT] Modern clipboard API failed, trying fallback:', err);
    }
    
    // Fallback to execCommand
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      return success;
    } catch (err) {
      console.error('[SSHIFT] Fallback clipboard copy failed:', err);
      return false;
    }
  }
  
  // Helper method to read text from clipboard with fallback
  async readFromClipboard() {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        return text;
      }
    } catch (err) {
      console.warn('[SSHIFT] Modern clipboard API failed, trying fallback:', err);
    }
    
    // Fallback: create a prompt for user to paste
    return new Promise((resolve) => {
      const text = prompt('Paste your text here (clipboard API not available):');
      resolve(text || '');
    });
  }

  // Legacy method for backwards compatibility
  saveStickySessions() {
    this.saveTabs();
  }

  // Legacy method for backwards compatibility
  loadStickySessions() {
    return this.loadTabs();
  }

  // Legacy method for backwards compatibility
  clearStickySessions() {
    this.clearTabs();
  }

  loadSidebarState() {
    const saved = localStorage.getItem('sidebarCollapsed');
    return saved === 'true';
  }

  saveSidebarState() {
    localStorage.setItem('sidebarCollapsed', this.sidebarCollapsed.toString());
  }

  // Theme and Accent Management
  loadTheme() {
    return localStorage.getItem('theme') || 'dark';
  }

  saveTheme(theme) {
    localStorage.setItem('theme', theme);
  }

  loadAccent() {
    return localStorage.getItem('accent') || 'fuchsia';
  }

  saveAccent(accent) {
    localStorage.setItem('accent', accent);
  }

  hexToRgba(hex, alpha = 0.5) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  getTerminalTheme(theme) {
    const isDark = theme === 'dark';
    
    // If color override is disabled, use dark background with light text, but preserve ANSI colors
    if (!this.terminalColorOverride) {
      const defaultTheme = {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#c10059',
        cursorAccent: '#0d1117',
        selectionBackground: 'rgba(193, 0, 89, 0.3)',
        selectionForeground: '#e6edf3'
        // Don't set ANSI colors - let terminal use its defaults for colored output
      };
      console.log('[SSHIFT] getTerminalTheme (override disabled):', defaultTheme);
      return defaultTheme;
    }
    
    // When override is enabled, use custom colors from settings
    const customTheme = {
      background: this.terminalBgColor || '#0d1117',
      foreground: this.terminalFgColor || '#e6edf3',
      cursor: '#c10059',
      cursorAccent: this.terminalBgColor || '#0d1117',
      selectionBackground: this.hexToRgba(this.terminalSelectionColor || '#264f78', 0.5),
      selectionForeground: this.terminalFgColor || '#e6edf3',
      black: isDark ? '#484f58' : '#6e7681',
      red: '#f85149',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#c10059',
      cyan: '#39c5cf',
      white: isDark ? '#e6edf3' : '#1f2328',
      brightBlack: isDark ? '#6e7681' : '#8c959f',
      brightRed: '#ff7b72',
      brightGreen: '#7ee787',
      brightYellow: '#ffc658',
      brightBlue: '#79c0ff',
      brightMagenta: '#c10059',
      brightCyan: '#56d4dd',
      brightWhite: isDark ? '#ffffff' : '#1f2328'
    };
    console.log('[SSHIFT] getTerminalTheme (override enabled):', customTheme);
    return customTheme;
  }

  toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    // Get the button position for the wave animation
    const themeToggleBtn = document.getElementById('themeToggle');
    const rect = themeToggleBtn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    
    // Determine the new theme's background color
    const newThemeBg = newTheme === 'dark' ? '#0d1117' : '#ffffff';
    
    // Create wave overlay
    const wave = document.createElement('div');
    wave.className = 'theme-wave';
    wave.style.setProperty('--wave-x', `${x}px`);
    wave.style.setProperty('--wave-y', `${y}px`);
    wave.style.setProperty('--wave-color', newThemeBg);
    
    document.body.appendChild(wave);
    
    // Trigger animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wave.classList.add('animate');
      });
    });
    
    // Apply theme change after animation completes
    setTimeout(() => {
      document.documentElement.setAttribute('data-theme', newTheme);
      this.theme = newTheme; // Update instance property
      this.saveTheme(newTheme);
      this.updateThemeIcon(newTheme);
      
      // Load terminal color settings for the new theme
      this.loadTerminalColorSettings();
      
      // Update the UI controls to reflect the new theme's settings
      this.updateTerminalColorOverrideUI();
      
      // Update all terminal themes
      this.updateTerminalThemes(newTheme);
      
      // Fade out the wave
      wave.classList.add('fade-out');
      
      // Remove wave overlay after fade-out
      setTimeout(() => {
        wave.remove();
      }, 200);
    }, 250);
  }

  updateTerminalThemes(theme) {
    console.log('[SSHIFT] updateTerminalThemes called with theme:', theme);
    console.log('[SSHIFT] terminalColorOverride:', this.terminalColorOverride);
    
    // Update all SSH terminal sessions
    this.sessions.forEach((session) => {
      if (session.terminal) {
        const newTheme = this.getTerminalTheme(theme);
        console.log('[SSHIFT] Applying theme to terminal:', newTheme);
        session.terminal.options.theme = newTheme;
        // Force terminal to redraw with new theme
        session.terminal.refresh(0, session.terminal.rows - 1);
        
        // Update wrapper background to match terminal background
        const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
        if (wrapper && this.terminalColorOverride) {
          wrapper.style.backgroundColor = newTheme.background;
        } else if (wrapper) {
          wrapper.style.backgroundColor = '#0d1117';
        }
      }
    });
    
    // Update all SFTP sessions
    this.sftpSessions.forEach((session) => {
      if (session.terminal) {
        const newTheme = this.getTerminalTheme(theme);
        session.terminal.options.theme = newTheme;
        // Force terminal to redraw with new theme
        session.terminal.refresh(0, session.terminal.rows - 1);
        
        // Update wrapper background to match terminal background
        const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
        if (wrapper && this.terminalColorOverride) {
          wrapper.style.backgroundColor = newTheme.background;
        } else if (wrapper) {
          wrapper.style.backgroundColor = '#0d1117';
        }
      }
    });
  }

  toggleTerminalColorOverride() {
    this.terminalColorOverride = !this.terminalColorOverride;
    this.saveTerminalColorSettings();
    this.updateTerminalColorOverrideUI();
    
    // Update all active terminals
    const currentTheme = this.loadTheme();
    this.updateTerminalThemes(currentTheme);
  }

  setTerminalBgColor(color) {
    this.terminalBgColor = color; // Update instance property
    this.saveTerminalColorSettings();
    
    // Update all active terminals
    const currentTheme = this.loadTheme();
    this.updateTerminalThemes(currentTheme);
  }

  setTerminalFgColor(color) {
    this.terminalFgColor = color; // Update instance property
    this.saveTerminalColorSettings();
    
    // Update all active terminals
    const currentTheme = this.loadTheme();
    this.updateTerminalThemes(currentTheme);
  }

  setTerminalSelectionColor(color) {
    this.terminalSelectionColor = color; // Update instance property
    this.saveTerminalColorSettings();
    
    console.log('[SSHIFT] Setting selection color:', color);
    
    // Update all active terminals
    const currentTheme = this.loadTheme();
    this.updateTerminalThemes(currentTheme);
  }

  updateTerminalColorOverrideUI() {
    // Desktop elements
    const checkbox = document.getElementById('terminalColorOverride');
    const options = document.getElementById('terminalColorOptions');
    const bgColorInput = document.getElementById('terminalBgColor');
    const fgColorInput = document.getElementById('terminalFgColor');
    const selectionColorInput = document.getElementById('terminalSelectionColor');
    
    // Mobile elements
    const mobileCheckbox = document.getElementById('mobileTerminalColorOverride');
    const mobileOptions = document.getElementById('mobileTerminalColorOptions');
    const mobileBgColorInput = document.getElementById('mobileTerminalBgColor');
    const mobileFgColorInput = document.getElementById('mobileTerminalFgColor');
    const mobileSelectionColorInput = document.getElementById('mobileTerminalSelectionColor');
    
    // Update desktop checkbox
    if (checkbox) {
      checkbox.checked = this.terminalColorOverride;
    }
    
    // Update mobile checkbox
    if (mobileCheckbox) {
      mobileCheckbox.checked = this.terminalColorOverride;
    }
    
    // Update desktop options visibility
    if (options) {
      if (this.terminalColorOverride) {
        options.classList.add('show');
      } else {
        options.classList.remove('show');
      }
    }
    
    // Update mobile options visibility
    if (mobileOptions) {
      if (this.terminalColorOverride) {
        mobileOptions.classList.add('show');
      } else {
        mobileOptions.classList.remove('show');
      }
    }
    
    // Update desktop color inputs with current values from instance properties
    if (bgColorInput) {
      bgColorInput.value = this.terminalBgColor;
    }
    if (fgColorInput) {
      fgColorInput.value = this.terminalFgColor;
    }
    if (selectionColorInput) {
      selectionColorInput.value = this.terminalSelectionColor;
    }
    
    // Update mobile color inputs with current values from instance properties
    if (mobileBgColorInput) {
      mobileBgColorInput.value = this.terminalBgColor;
    }
    if (mobileFgColorInput) {
      mobileFgColorInput.value = this.terminalFgColor;
    }
    if (mobileSelectionColorInput) {
      mobileSelectionColorInput.value = this.terminalSelectionColor;
    }
  }

  updateThemeIcon(theme) {
    const icon = document.querySelector('#themeToggle i');
    if (icon) {
      icon.className = theme === 'dark' ? 'fas fa-lightbulb' : 'fas fa-moon';
    }
    
    // Update mobile theme toggle text
    const mobileThemeToggleText = document.getElementById('mobileThemeToggleText');
    if (mobileThemeToggleText) {
      mobileThemeToggleText.textContent = theme === 'dark' ? 'Toggle Light' : 'Toggle Dark';
    }
    
    // Update mobile theme toggle icon
    const mobileIcon = document.querySelector('#mobileThemeToggle i');
    if (mobileIcon) {
      mobileIcon.className = theme === 'dark' ? 'fas fa-lightbulb' : 'fas fa-moon';
    }
  }

  setAccent(accent) {
    document.documentElement.setAttribute('data-accent', accent);
    this.saveAccent(accent);
    this.updateAccentPreview(accent);
    this.updateAccentActiveState(accent);
  }

  updateAccentPreview(accent) {
    const preview = document.querySelector('.accent-preview');
    if (preview) {
      const colors = {
        fuchsia: '#c10059',
        green: '#2ea043',
        purple: '#a371f2',
        orange: '#d18616',
        red: '#da3633',
        cyan: '#1f6feb',
        blue: '#58a6ff',
        yellow: '#d29922'
      };
      preview.style.background = colors[accent] || colors.fuchsia;
    }
  }

  updateAccentActiveState(accent) {
    document.querySelectorAll('.accent-option').forEach(option => {
      option.classList.toggle('active', option.dataset.accent === accent);
    });
  }

  initThemeAndAccent() {
    const theme = this.loadTheme();
    const accent = this.loadAccent();
    
    this.theme = theme; // Set instance property
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-accent', accent);
    this.updateThemeIcon(theme);
    this.updateAccentPreview(accent);
    this.updateAccentActiveState(accent);
    
    // Load terminal color settings for current theme
    this.loadTerminalColorSettings();
  }

  async loadBookmarkOrder() {
    try {
      const response = await fetch('/api/bookmarks/order');
      if (response.ok) {
        const order = await response.json();
        if (order && order.length > 0) {
          return order;
        }
      }
    } catch (err) {
      console.error('Failed to load bookmark order from server:', err);
    }
    // Fall back to localStorage
    const saved = localStorage.getItem('bookmarkOrder');
    return saved ? JSON.parse(saved) : null;
  }

  async saveBookmarkOrder() {
    const order = this.bookmarks.map(b => b.id);
    
    // Save to server
    try {
      await fetch('/api/bookmarks/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
    } catch (err) {
      console.error('Failed to save bookmark order to server:', err);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('bookmarkOrder', JSON.stringify(order));
  }

  async init() {
    console.log('[SSHIFT] Setting up listeners...');
    
    // Fix mobile viewport height issues
    this.fixMobileViewport();
    
    // Load sticky config first
    await this.loadStickyConfig();
    
    this.setupSocketListeners();
    this.setupEventListeners();
    this.loadBookmarks(); // This will also load folders
    this.applySidebarState();
    this.initThemeAndAccent(); // Initialize theme and accent
    
    // Update terminal color UI to reflect loaded settings
    this.updateTerminalColorOverrideUI();
    
    // Restore tabs if sticky is enabled
    if (this.sticky) {
      await this.restoreTabs();
    }
    
    // Initialize mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Initialize mobile keys bar
    this.initMobileKeysBar();
    
    this.handleResize();
    console.log('[SSHIFT] Client initialized');
  }
  
  // Fix mobile viewport height issues caused by address/navigation bars
  fixMobileViewport() {
    // Set CSS custom property for actual viewport height
    const setViewportHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      
      // Also set visual viewport height if available (for mobile keyboards)
      if (window.visualViewport) {
        const vvh = window.visualViewport.height * 0.01;
        document.documentElement.style.setProperty('--vvh', `${vvh}px`);
      }
    };
    
    // Set on load
    setViewportHeight();
    
    // Update on resize (with debounce)
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(setViewportHeight, 100);
    });
    
    // Update when virtual keyboard opens/closes on mobile
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setViewportHeight);
    }
    
    // Update mobile detection on resize
    window.addEventListener('resize', () => {
      this.isMobile = window.innerWidth <= 768;
    });
  }

  // Mobile scroll behavior - hide/show header and tabs
  setupMobileScrollBehavior(sessionId) {
    if (!this.isMobile) return;
    
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    const terminal = session.terminal;
    
    console.log('[SSHIFT] Setting up mobile scroll behavior for session:', sessionId);
    
    // Initialize scroll position tracking for this session
    session.lastScrollTop = 0;
    session.lastTouchY = 0;
    session.isScrolling = false;
    session.isAtBottom = true; // Start at bottom
    
    // Use xterm.js onScroll event to track scroll position
    terminal.onScroll(() => {
      console.log('[SSHIFT] xterm onScroll event fired');
      this.handleMobileScroll(sessionId);
      this.checkIfAtBottom(sessionId);
    });
    
    // Also handle touch events on the terminal element for touch scrolling
    const terminalElement = terminal.element;
    if (terminalElement) {
      console.log('[SSHIFT] Terminal element found, setting up touch handlers');
      
      // Try both the viewport and the main terminal element
      const viewportElement = terminalElement.querySelector('.xterm-viewport');
      const xtermScreen = terminalElement.querySelector('.xterm-screen');
      
      const setupTouchHandlers = (element, elementName) => {
        if (!element) {
          console.log(`[SSHIFT] ${elementName} not found`);
          return;
        }
        
        console.log(`[SSHIFT] Setting up touch handlers on ${elementName}`);
        
        // Touch start - record initial position
        element.addEventListener('touchstart', (e) => {
          if (e.touches.length === 1) {
            session.lastTouchY = e.touches[0].clientY;
            session.isScrolling = true;
            console.log(`[SSHIFT] ${elementName} touchstart, Y:`, session.lastTouchY);
          }
        }, { passive: true });
        
        // Touch move - track scrolling
        element.addEventListener('touchmove', (e) => {
          if (!session.isScrolling || e.touches.length !== 1) return;
          
          const currentTouchY = e.touches[0].clientY;
          const touchDiff = session.lastTouchY - currentTouchY;
          
          // Update last touch position
          session.lastTouchY = currentTouchY;
          
          console.log(`[SSHIFT] ${elementName} touchmove, diff:`, touchDiff);
        }, { passive: true });
        
        // Touch end - check if at bottom for auto-scroll
        element.addEventListener('touchend', () => {
          session.isScrolling = false;
          console.log(`[SSHIFT] ${elementName} touchend`);
          
          // Check scroll position after touch ends
          setTimeout(() => {
            this.checkIfAtBottom(sessionId);
          }, 100);
        }, { passive: true });
      };
      
      // Set up on both viewport and screen
      setupTouchHandlers(viewportElement, 'viewport');
      setupTouchHandlers(xtermScreen, 'screen');
      
      // Also set up on the main terminal element as fallback
      setupTouchHandlers(terminalElement, 'terminal');
    } else {
      console.warn('[SSHIFT] Terminal element not found for touch handlers');
    }
  }
  
  // Check if terminal is scrolled to bottom
  checkIfAtBottom(sessionId) {
    if (!this.isMobile) return;
    
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    const terminal = session.terminal;
    const buffer = terminal.buffer.active;
    
    // Check if we're at the bottom
    // ydisp is the current scroll position (number of lines scrolled back from bottom)
    // The terminal is at bottom if ydisp is 0 or very close to 0
    const maxYDisp = buffer.length - terminal.rows;
    const currentYDisp = terminal.buffer.ydisp;
    
    // We're at the bottom if we're within 2 lines of the bottom
    const isAtBottom = currentYDisp >= maxYDisp - 2;
    
    if (session.isAtBottom !== isAtBottom) {
      session.isAtBottom = isAtBottom;
      console.log('[SSHIFT] Terminal isAtBottom changed to:', isAtBottom, 'ydisp:', currentYDisp, 'maxYDisp:', maxYDisp);
    }
  }

  handleMobileScroll(sessionId) {
    if (!this.isMobile) return;
    
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    const terminal = session.terminal;
    
    // Get scroll position from xterm.js buffer
    // ydisp is the scroll position (number of lines scrolled back from bottom)
    // ydisp = 0 means we're at the bottom (most recent content)
    // ydisp > 0 means we've scrolled up into the scrollback buffer (older content)
    const buffer = terminal.buffer.active;
    const scrollTop = buffer.ydisp;
    
    // Get scroll direction
    const scrollDiff = scrollTop - session.lastScrollTop;
    
    // In xterm.js:
    // - Scrolling UP (away from bottom, into scrollback) increases ydisp
    // - Scrolling DOWN (towards bottom) decreases ydisp
    // So: scrollDiff > 0 means scrolling UP into history, scrollDiff < 0 means scrolling DOWN
    
    // Hide/show header and tabs based on scroll direction
    // When scrolling UP (into scrollback, scrollDiff > 0), show header/tabs for navigation
    // When scrolling DOWN (towards bottom, scrollDiff < 0), hide header/tabs to maximize terminal space
    if (scrollDiff > 2) {
      // Scrolling UP (into scrollback history) - show header and tabs
      this.showHeaderAndTabs();
    } else if (scrollDiff < -2) {
      // Scrolling DOWN (towards bottom) - hide header and tabs
      this.hideHeaderAndTabs();
    }
    
    // Update last scroll position
    session.lastScrollTop = scrollTop;
  }
  
  hideHeaderAndTabs() {
    if (this.headerHidden) return;
    
    const header = document.querySelector('.header');
    const tabsContainer = document.querySelector('.tabs-container');
    const appContainer = document.querySelector('.app-container');
    
    if (header) {
      header.classList.add('hidden');
      this.headerHidden = true;
    }
    
    if (tabsContainer) {
      tabsContainer.classList.add('hidden');
      this.tabsHidden = true;
    }
    
    // Add classes to app-container for CSS styling
    if (appContainer) {
      appContainer.classList.add('header-hidden', 'tabs-hidden');
    }
    
    // Refit terminal to use the new space
    this.refitActiveTerminal();
  }
  
  showHeaderAndTabs() {
    if (!this.headerHidden && !this.tabsHidden) return;
    
    const header = document.querySelector('.header');
    const tabsContainer = document.querySelector('.tabs-container');
    const appContainer = document.querySelector('.app-container');
    
    if (header) {
      header.classList.remove('hidden');
      this.headerHidden = false;
    }
    
    if (tabsContainer) {
      tabsContainer.classList.remove('hidden');
      this.tabsHidden = false;
    }
    
    // Remove classes from app-container
    if (appContainer) {
      appContainer.classList.remove('header-hidden', 'tabs-hidden');
    }
    
    // Refit terminal to use the new space
    this.refitActiveTerminal();
  }

  refitActiveTerminal() {
    // Refit the active terminal to fill the available space
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session && session.fitAddon && session.terminal) {
        // Small delay to allow CSS transitions to complete
        setTimeout(() => {
          try {
            const terminalArea = document.querySelector('.terminal-area');
            const terminalWrapper = document.querySelector('.terminal-wrapper.active');
            console.log('[SSHIFT] Terminal dimensions before fit:', {
              terminalAreaHeight: terminalArea?.offsetHeight,
              terminalWrapperHeight: terminalWrapper?.offsetHeight,
              terminalRows: session.terminal.rows,
              terminalCols: session.terminal.cols
            });
            session.fitAddon.fit();
            console.log('[SSHIFT] Terminal refitted after header/tabs change, rows:', session.terminal.rows);
          } catch (e) {
            console.warn('[SSHIFT] Could not refit terminal:', e.message);
          }
        }, 350); // Wait for CSS transition (300ms) + buffer
      }
    }
  }

  // Auto-scroll terminal to bottom on mobile when new data arrives
  scrollTerminalToBottom(sessionId) {
    if (!this.isMobile) return;
    
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    // Only auto-scroll if user is at the bottom
    // This allows users to scroll up and read previous output without being interrupted
    if (!session.isAtBottom) {
      console.log('[SSHIFT] Not auto-scrolling - user has scrolled up');
      return;
    }
    
    const terminal = session.terminal;
    
    try {
      // Use xterm.js scrollToBottom method
      if (typeof terminal.scrollToBottom === 'function') {
        terminal.scrollToBottom();
        console.log('[SSHIFT] Auto-scrolled to bottom');
      }
    } catch (e) {
      console.warn('[SSHIFT] Error scrolling terminal:', e.message);
    }
  }

  // Mobile Keys Bar functionality
  updateMobileKeysBar() {
    const mobileKeysBar = document.querySelector('.mobile-keys-bar');
    if (!mobileKeysBar) return;
    
    // Only show on mobile, when enabled, and when there's an active session
    const shouldShow = this.isMobile && this.mobileKeysBarEnabled && this.activeSessionId;
    
    if (shouldShow) {
      mobileKeysBar.classList.add('visible');
      console.log('[SSHIFT] Mobile keys bar shown');
    } else {
      mobileKeysBar.classList.remove('visible');
      console.log('[SSHIFT] Mobile keys bar hidden');
    }
  }

  setupMobileKeysBarKeyboardHandling() {
    if (!this.isMobile) return;
    
    const mobileKeysBar = document.querySelector('.mobile-keys-bar');
    if (!mobileKeysBar) return;
    
    // Use Visual Viewport API to position keys bar above keyboard
    if (window.visualViewport) {
      let lastKeyboardHeight = -1; // Start at -1 so first call always runs
      
      const updatePosition = () => {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        const keyboardHeight = windowHeight - viewportHeight;
        
        // Only update if keyboard height changed significantly (more than 50px)
        // This prevents the bar from jumping around during normal scrolling
        // when browser UI shows/hides
        // Always run on first call (lastKeyboardHeight === -1)
        if (lastKeyboardHeight === -1 || Math.abs(keyboardHeight - lastKeyboardHeight) > 50) {
          lastKeyboardHeight = keyboardHeight;
          
          if (keyboardHeight > 50) {
            // Keyboard is open - position keys bar above keyboard
            mobileKeysBar.style.bottom = `${keyboardHeight}px`;
            
            // Update terminal area height to account for keyboard
            const terminalArea = document.querySelector('.terminal-area');
            const terminalsContainer = document.querySelector('.terminals-container');
            
            if (terminalArea) {
              // Calculate available height: viewport height minus header and tabs
              const headerHeight = 35; // var(--header-height)
              const headerBorder = 1; // border-bottom
              const tabsHeight = 35; // min-height of tabs-container
              const tabsBorder = 1; // border-bottom
              // Mobile keys bar: 2px padding + 26px key + 2px margin + 26px key + 2px padding + 1px border = 59px
              const mobileKeysBarHeight = 59;
              const bufferHeight = 5; // Add small bottom margin when keyboard is visible
              const availableHeight = viewportHeight - headerHeight - headerBorder - tabsHeight - tabsBorder - mobileKeysBarHeight - bufferHeight;
              
              terminalArea.style.height = `${Math.max(availableHeight, 100)}px`;
              terminalArea.style.maxHeight = `${Math.max(availableHeight, 100)}px`;
              
              // Remove bottom padding from xterm element when keyboard is open
              const activeWrapper = document.querySelector('.terminal-wrapper.active');
              if (activeWrapper) {
                const xtermElement = activeWrapper.querySelector('.xterm');
                if (xtermElement) {
                  xtermElement.style.paddingBottom = '0px';
                }
              }
            }
          } else {
            // Keyboard is closed - reset position
            mobileKeysBar.style.bottom = '0px';
            
            // Set terminal area height based on visualViewport to account for browser UI
            const terminalArea = document.querySelector('.terminal-area');
            
            if (terminalArea) {
              // Calculate available height accounting for all fixed elements
              const headerHeight = 35; // var(--header-height)
              const headerBorder = 1; // border-bottom
              const tabsHeight = 35; // min-height of tabs-container
              const tabsBorder = 1; // border-bottom
              const mobileKeysBarHeight = 59; // includes border-top
              
              // Total fixed space at top and bottom
              const fixedHeight = headerHeight + headerBorder + tabsHeight + tabsBorder + mobileKeysBarHeight;
              const availableHeight = viewportHeight - fixedHeight;
              
              console.log('[SSHIFT] Keyboard closed - viewportHeight:', viewportHeight, 'fixedHeight:', fixedHeight, 'availableHeight:', availableHeight);
              
              // Set height slightly smaller to leave bottom margin
              terminalArea.style.height = `${Math.max(availableHeight - 4, 100)}px`;
              terminalArea.style.maxHeight = `${Math.max(availableHeight - 4, 100)}px`;
            }
          }
          
          // Refit the active terminal to use the new available space
          // Delay to allow CSS changes to take effect
          setTimeout(() => {
            this.refitActiveTerminal();
          }, 100);
        }
      };
      
      window.visualViewport.addEventListener('resize', updatePosition);
      // Don't move bar on scroll - only on keyboard open/close
      // window.visualViewport.addEventListener('scroll', updatePosition);
      
      // Initial update
      updatePosition();
    }
  }

  initMobileKeysBar() {
    if (!this.isMobile) return;
    
    const mobileKeysBar = document.querySelector('.mobile-keys-bar');
    if (!mobileKeysBar) {
      console.log('[SSHIFT] Mobile keys bar element not found');
      return;
    }
    
    console.log('[SSHIFT] Initializing mobile keys bar handlers');
    
    // Setup keyboard handling
    this.setupMobileKeysBarKeyboardHandling();
    
    // Get all key buttons
    const keys = mobileKeysBar.querySelectorAll('.mobile-key');
    
    keys.forEach(key => {
      const keyName = key.dataset.key;
      if (!keyName) return;
      
      // Handle modifier keys (Ctrl, Alt) - toggle behavior
      if (key.classList.contains('mobile-key-modifier')) {
        key.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (keyName === 'ctrl') {
            this.ctrlPressed = !this.ctrlPressed;
            key.classList.toggle('active', this.ctrlPressed);
            console.log('[SSHIFT] Ctrl', this.ctrlPressed ? 'pressed' : 'released');
          } else if (keyName === 'alt') {
            this.altPressed = !this.altPressed;
            key.classList.toggle('active', this.altPressed);
            console.log('[SSHIFT] Alt', this.altPressed ? 'pressed' : 'released');
          }
          
          // Focus terminal after pressing modifier
          this.focusTerminal();
        });
      } else {
        // Regular keys - send on click/tap
        key.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.sendMobileKey(keyName);
        });
      }
    });
    
    // Initial visibility update
    this.updateMobileKeysBar();
  }

  focusTerminal() {
    // Focus the active terminal
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session && session.terminal && session.terminal.textarea) {
        session.terminal.textarea.focus();
      }
    }
  }

  sendMobileKey(keyName) {
    if (!this.activeSessionId) {
      console.log('[SSHIFT] No active session for mobile key');
      return;
    }
    
    const session = this.sessions.get(this.activeSessionId);
    if (!session || !session.terminal) {
      console.log('[SSHIFT] No terminal for mobile key');
      return;
    }
    
    const terminal = session.terminal;
    
    // Map key names to actual key codes
    const keyMap = {
      'esc': '\x1b',
      'tab': '\t',
      'up': '\x1b[A',
      'down': '\x1b[B',
      'right': '\x1b[C',
      'left': '\x1b[D',
      'home': '\x1b[H',
      'end': '\x1b[F',
      'pgup': '\x1b[5~',
      'pgdn': '\x1b[6~',
      'insert': '\x1b[2~',
      'delete': '\x1b[3~',
      'f1': '\x1bOP',
      'f2': '\x1bOQ',
      'f3': '\x1bOR',
      'f4': '\x1bOS',
      'f5': '\x1b[15~',
      'f6': '\x1b[17~',
      'f7': '\x1b[18~',
      'f8': '\x1b[19~',
      'f9': '\x1b[20~',
      'f10': '\x1b[21~',
      'f11': '\x1b[23~',
      'f12': '\x1b[24~',
      '/': '/',
      '-': '-'
    };
    
    let keySequence = keyMap[keyName.toLowerCase()];
    
    if (!keySequence) {
      console.log('[SSHIFT] Unknown mobile key:', keyName);
      return;
    }
    
    // Apply modifiers
    if (this.ctrlPressed) {
      // For Ctrl, we need to send the control character
      // This is a simplified version - real implementation would need proper Ctrl mapping
      if (keyName.toLowerCase() === 'c') {
        keySequence = '\x03'; // Ctrl+C
      } else if (keyName.toLowerCase() === 'd') {
        keySequence = '\x04'; // Ctrl+D
      } else if (keyName.toLowerCase() === 'z') {
        keySequence = '\x1a'; // Ctrl+Z
      }
      // For other keys, Ctrl doesn't make sense, just send the key as-is
      // Reset Ctrl after use
      this.ctrlPressed = false;
      const ctrlKey = document.querySelector('.mobile-key[data-key="ctrl"]');
      if (ctrlKey) ctrlKey.classList.remove('active');
    }
    
    if (this.altPressed) {
      // Prepend ESC for Alt
      keySequence = '\x1b' + keySequence;
      // Reset Alt after use
      this.altPressed = false;
      const altKey = document.querySelector('.mobile-key[data-key="alt"]');
      if (altKey) altKey.classList.remove('active');
    }
    
    // Send to terminal
    if (this.socket && this.socket.connected) {
      this.socket.emit('ssh-data', { sessionId: this.activeSessionId, data: keySequence });
      console.log('[SSHIFT] Sent mobile key:', keyName, 'sequence:', keySequence);
    }
    
    // Focus terminal after sending key
    if (terminal.textarea) {
      terminal.textarea.focus();
    }
  }

  async restoreTabs() {
    const savedTabs = this.loadTabs();
    
    if (!savedTabs || savedTabs.length === 0) {
      console.log('[SSHIFT] No tabs to restore');
      return;
    }
    
    console.log('[SSHIFT] Restoring', savedTabs.length, 'tabs');
    console.log('[SSHIFT] sticky:', this.sticky);
    
    // Set restoring flag to prevent saving during restoration
    this.isRestoring = true;
    
    // Wait for socket to be connected
    if (!this.socket.connected) {
      await new Promise(resolve => {
        this.socket.once('connect', resolve);
        setTimeout(resolve, 1000); // Timeout after 1s
      });
    }
    
    let activeSessionId = null;
    
    // Restore each session
    for (const savedTab of savedTabs) {
      console.log('[SSHIFT] Restoring tab:', savedTab.name, savedTab.type);
      
      let sessionId;
      
      // If sticky is enabled, try to join existing session
      // Otherwise, create a new session with the same connection data
      const restoreSessionId = this.sticky ? savedTab.sessionId : null;
      
      if (savedTab.type === 'ssh') {
        sessionId = this.createSSHTab(savedTab.name, savedTab.connectionData, restoreSessionId);
      } else if (savedTab.type === 'sftp') {
        sessionId = this.createSFTPTab(savedTab.name, savedTab.connectionData, restoreSessionId);
      }
      
      // Track the active session
      if (savedTab.active) {
        activeSessionId = savedTab.sessionId;
      }
      
      // Small delay between sessions
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Restore active session after all sessions are created
    if (activeSessionId) {
      setTimeout(() => {
        console.log('[SSHIFT] Restoring active session:', activeSessionId);
        this.switchTab(activeSessionId);
      }, 500);
    }
    
    // Update mobile tabs dropdown after restoration
    this.updateMobileTabsDropdown();
    
    // Clear restoring flag after restoration is complete
    this.isRestoring = false;
  }

  // Legacy method for backwards compatibility
  async restoreStickySessions() {
    return this.restoreTabs();
  }

  applySidebarState() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    
    if (this.sidebarCollapsed) {
      sidebar.classList.add('collapsed');
      toggleBtn.title = 'Expand Sidebar';
    }
  }

  // Socket.IO Listeners
  setupSocketListeners() {
    this.socket.on('connect', () => {
      console.log('[SSHIFT] Connected to server, socket ID:', this.socket.id);
      this.showToast('Connected to server', 'success');
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[SSHIFT] Disconnected from server:', reason);
      this.showToast('Disconnected from server: ' + reason, 'error');
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SSHIFT] Connection error:', error);
      this.showToast('Connection error: ' + error.message, 'error');
    });

    // Handle receiving open tabs from server (for cross-tab sync)
    this.socket.on('open-tabs', (data) => {
      console.log('[SSHIFT] Received open tabs from server:', data.tabs.length);
      // Only sync if sticky is enabled
      if (this.sticky && data.tabs.length > 0) {
        this.syncTabsFromServer(data.tabs);
      }
    });

    // Handle tab opened event from another client
    this.socket.on('tab-opened', (data) => {
      console.log('[SSHIFT] Tab opened by another client:', data.sessionId, data.name);
      // Only sync if sticky is enabled
      if (this.sticky) {
        this.handleTabOpened(data);
      }
    });

    // Handle tab closed event from another client
    this.socket.on('tab-closed', (data) => {
      console.log('[SSHIFT] Tab closed by another client:', data.sessionId);
      this.handleTabClosed(data.sessionId);
    });

    // Handle tab order update from server
    this.socket.on('tab-order', (data) => {
      console.log('[SSHIFT] Tab order updated:', data.order);
      if (this.sticky) {
        this.reorderTabsInDOM(data.order);
      }
    });

    this.socket.on('tab-renamed', (data) => {
      console.log('[SSHIFT] Tab renamed event:', data.sessionId, 'to', data.name);
      
      // Update session name
      const session = this.sessions.get(data.sessionId) || this.sftpSessions.get(data.sessionId);
      if (session) {
        session.name = data.name;
        
        // Update tab display
        const tab = document.querySelector(`.tab[data-session-id="${data.sessionId}"]`);
        if (tab) {
          const nameSpan = tab.querySelector('.tab-name');
          if (nameSpan) {
            nameSpan.textContent = this.escapeHtml(data.name);
          }
        }
        
        // Save tabs if sticky is enabled
        this.saveTabs();
      }
    });

    this.socket.on('ssh-connected', (data) => {
      this.onSSHConnected(data);
    });

    this.socket.on('ssh-joined', (data) => {
      console.log('[SSHIFT] SSH Joined session:', data.sessionId);
      const session = this.sessions.get(data.sessionId);
      if (session) {
        // Clear any pending sync timeout
        if (session.syncTimeout) {
          clearTimeout(session.syncTimeout);
          session.syncTimeout = null;
        }
        
        session.connected = true;
        session.connecting = false;
        session.isRestoring = false;
        
        // If server doesn't have a terminal state, clear syncing flag
        // This happens when joining a fresh session or one without serialization
        if (data.noTerminalState) {
          console.log('[SSHIFT] No terminal state on server, clearing syncing flag');
          session.syncing = false;
        }
        
        // Focus the terminal
        if (session.terminal) {
          session.terminal.focus();
          console.log('[SSHIFT] Terminal focused after joining session');
        }
      }
    });

    this.socket.on('ssh-screen-sync', (data) => {
      console.log('[SSHIFT] Received screen sync for session:', data.sessionId, 'state size:', data.state?.length || 0, 'encoded:', data.encoded);
      const session = this.sessions.get(data.sessionId);
      if (session && session.terminal) {
        // Clear any pending sync timeout
        if (session.syncTimeout) {
          clearTimeout(session.syncTimeout);
          session.syncTimeout = null;
        }
        
        // Set syncing flag to prevent ssh-data from writing during sync
        session.syncing = true;
        
        // Clear the terminal completely before applying the serialized state
        // Use reset() to clear both the buffer and the scrollback
        session.terminal.reset();
        
        // Decode base64 if the state is encoded
        let state = data.state;
        if (data.encoded) {
          try {
            // Decode base64 to utf-8 string
            state = atob(data.state);
            console.log('[SSHIFT] Decoded base64 state, size:', state.length);
          } catch (e) {
            console.error('[SSHIFT] Error decoding base64 state:', e);
            session.syncing = false;
            return;
          }
        }
        
        // Write the serialized terminal state
        // This includes all escape sequences to reconstruct the screen
        session.terminal.write(state, () => {
          console.log('[SSHIFT] Terminal state synchronized');
          
          // Clear syncing flag after sync is complete
          session.syncing = false;
          
          // Resize terminal to match the session's dimensions if provided
          if (data.cols && data.rows) {
            try {
              session.terminal.resize(data.cols, data.rows);
              // Re-fit the terminal to the container
              if (session.fitAddon) {
                session.fitAddon.fit();
              }
            } catch (e) {
              console.warn('[SSHIFT] Error resizing terminal:', e.message);
            }
          }
          
          // Focus the terminal
          session.terminal.focus();
        });
      }
    });

    this.socket.on('ssh-resize-sync', (data) => {
      console.log('[SSHIFT] Received resize sync for session:', data.sessionId, 'cols:', data.cols, 'rows:', data.rows);
      const session = this.sessions.get(data.sessionId);
      if (session && session.terminal) {
        try {
          // Resize the terminal to match the server's dimensions
          session.terminal.resize(data.cols, data.rows);
          // Re-fit the terminal to the container
          if (session.fitAddon) {
            session.fitAddon.fit();
          }
          console.log('[SSHIFT] Terminal resized to match server dimensions');
        } catch (e) {
          console.warn('[SSHIFT] Error resizing terminal:', e.message);
        }
      }
    });

    // Request screen sync from server
    this.requestScreenSync = (sessionId) => {
      if (!sessionId) {
        sessionId = this.activeSessionId;
      }
      if (!sessionId) {
        console.warn('[SSHIFT] No active session for screen sync');
        return;
      }
      
      const session = this.sessions.get(sessionId);
      if (!session || !session.connected) {
        console.warn('[SSHIFT] Session not connected for screen sync');
        return;
      }
      
      // Clear any existing sync timeout
      if (session.syncTimeout) {
        clearTimeout(session.syncTimeout);
      }
      
      // Set syncing flag to prevent data from being written during sync
      session.syncing = true;
      
      // Safety timeout: clear syncing flag after 5 seconds if ssh-screen-sync never arrives
      session.syncTimeout = setTimeout(() => {
        console.warn('[SSHIFT] Sync timeout, clearing syncing flag for session:', sessionId);
        session.syncing = false;
      }, 5000);
      
      console.log('[SSHIFT] Requesting screen sync for session:', sessionId);
      this.socket.emit('ssh-request-sync', { sessionId });
    };

    this.socket.on('ssh-data', (data) => {
      this.onSSHData(data);
    });

    this.socket.on('ssh-error', (data) => {
      console.error('[SSHIFT] SSH Error:', data.message, 'sessionId:', data.sessionId);
      this.showToast(data.message, 'error');
      
      // If session not found and we're restoring, try to reconnect
      if (data.sessionId && data.message === 'Session not found') {
        const session = this.sessions.get(data.sessionId);
        console.log('[SSHIFT] Session found:', !!session, 'isRestoring:', session?.isRestoring);
        
        if (session && session.isRestoring && session.connectionData) {
          console.log('[SSHIFT] Session not found on server, reconnecting with new connection...');
          session.isRestoring = false;
          session.connecting = true;
          session.connected = false;
          
          // Clear the terminal and show reconnecting message
          if (session.terminal) {
            session.terminal.clear();
            session.terminal.writeln('\x1b[33m⚠ Session expired, reconnecting...\x1b[0m');
            session.terminal.writeln('');
          }
          
          // Emit ssh-connect to create a new connection
          console.log('[SSHIFT] Emitting ssh-connect for reconnection with sessionId:', data.sessionId);
          this.socket.emit('ssh-connect', { ...session.connectionData, sessionId: data.sessionId });
          return; // Don't close the tab
        } else {
          console.log('[SSHIFT] Session not eligible for reconnection, closing tab');
        }
      }
      
      if (data.sessionId) {
        this.closeTab(data.sessionId);
      }
    });

    this.socket.on('ssh-disconnected', (data) => {
      console.log('[SSHIFT] SSH Disconnected:', data.sessionId);
      this.showToast('SSH session disconnected', 'warning');
      if (data.sessionId) {
        this.closeTab(data.sessionId);
      }
    });

    this.socket.on('ssh-exit', (data) => {
      this.showToast(`Process exited with code ${data.code}`, 'warning');
    });

    this.socket.on('sftp-connected', (data) => {
      this.onSFTPConnected(data);
    });

    this.socket.on('sftp-list-result', (data) => {
      console.log('[SSHIFT] sftp-list-result received:', data);
      console.log('[SSHIFT] sessionId from server:', data.sessionId);
      console.log('[SSHIFT] path:', data.path);
      console.log('[SSHIFT] files count:', data.files?.length || 0);
      this.renderSFTPFileList(data.path, data.files, data.sessionId);
    });

    this.socket.on('sftp-error', (data) => {
      this.showToast(data.message, 'error');
    });

    this.socket.on('sftp-download-result', (data) => {
      this.downloadFile(data.path, data.data);
    });

    this.socket.on('sftp-upload-result', (data) => {
      this.showToast(`File uploaded: ${data.path}`, 'success');
      this.refreshSFTP();
    });
  }

  // Event Listeners
  setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      this.toggleTheme();
    });

    // Accent selector
    const accentBtn = document.querySelector('.accent-btn');
    const accentDropdown = document.querySelector('.accent-dropdown');
    
    accentBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      accentDropdown.classList.toggle('show');
      // Close terminal color dropdown if open
      const terminalColorDropdown = document.querySelector('.terminal-color-dropdown');
      if (terminalColorDropdown) {
        terminalColorDropdown.classList.remove('show');
      }
    });

    document.addEventListener('click', (e) => {
      // Only prevent propagation if we're actually closing an open dropdown
      if (accentDropdown.classList.contains('show') && !e.target.closest('.accent-selector')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        accentDropdown.classList.remove('show');
      }
      // Close all folder menus when clicking outside - only block if menus are open
      if (!e.target.closest('.folder-menu-wrapper')) {
        const folderMenus = document.querySelectorAll('.folder-menu-dropdown.show');
        if (folderMenus.length > 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          folderMenus.forEach(menu => {
            menu.classList.remove('show');
          });
        }
      }
    }, true); // Use capture phase

    document.querySelectorAll('.accent-option').forEach(option => {
      option.addEventListener('click', () => {
        const accent = option.dataset.accent;
        this.setAccent(accent);
        accentDropdown.classList.remove('show');
      });
    });

    // Terminal color selector dropdown
    const terminalColorBtn = document.querySelector('.terminal-color-btn');
    const terminalColorDropdown = document.querySelector('.terminal-color-dropdown');
    const terminalColorOverride = document.getElementById('terminalColorOverride');
    const terminalBgColor = document.getElementById('terminalBgColor');
    const terminalFgColor = document.getElementById('terminalFgColor');
    const terminalColorOptions = document.getElementById('terminalColorOptions');
    
    if (terminalColorBtn && terminalColorDropdown) {
      // Toggle dropdown
      terminalColorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        terminalColorDropdown.classList.toggle('show');
        // Close accent dropdown if open
        const accentDropdown = document.querySelector('.accent-dropdown');
        if (accentDropdown) {
          accentDropdown.classList.remove('show');
        }
      });
      
      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        // Only prevent propagation if we're actually closing an open dropdown
        if (terminalColorDropdown.classList.contains('show') && !e.target.closest('.terminal-color-selector')) {
          e.preventDefault();
          e.stopImmediatePropagation();
          terminalColorDropdown.classList.remove('show');
        }
      }, true); // Use capture phase
    }
    
    if (terminalColorOverride) {
      terminalColorOverride.addEventListener('change', () => {
        this.toggleTerminalColorOverride();
      });
    }
    
    if (terminalBgColor) {
      terminalBgColor.addEventListener('input', (e) => {
        this.setTerminalBgColor(e.target.value);
      });
    }
    
    if (terminalFgColor) {
      terminalFgColor.addEventListener('input', (e) => {
        this.setTerminalFgColor(e.target.value);
      });
    }
    
    const terminalSelectionColor = document.getElementById('terminalSelectionColor');
    if (terminalSelectionColor) {
      terminalSelectionColor.addEventListener('input', (e) => {
        this.setTerminalSelectionColor(e.target.value);
      });
    }
    
    // Initialize terminal color override UI state
    this.updateTerminalColorOverrideUI();

    // Menu toggle
    document.getElementById('menuBtn').addEventListener('click', () => {
      this.toggleSidebar();
    });

    // Sidebar overlay click to close
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.classList.contains('open')) {
          this.toggleSidebar();
        }
      });
    }

    // New connection buttons
    document.getElementById('newSshBtn').addEventListener('click', () => {
      this.openConnectionModal('ssh');
    });

    document.getElementById('newSftpBtn').addEventListener('click', () => {
      this.openConnectionModal('sftp');
    });

    document.getElementById('quickSshBtn').addEventListener('click', () => {
      this.openConnectionModal('ssh');
    });

    document.getElementById('quickSftpBtn').addEventListener('click', () => {
      this.openConnectionModal('sftp');
    });

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
      this.openSettingsModal();
    });

    // Initialize settings modal handlers
    this.initSettingsModalHandlers();

    // Mobile overflow menu
    this.setupMobileOverflowMenu();

    // Mobile tabs dropdown
    this.setupMobileTabsDropdown();

    // Connection modal
    document.getElementById('closeConnectionModal').addEventListener('click', () => {
      this.closeModal('connectionModal');
    });

    document.getElementById('cancelConnection').addEventListener('click', () => {
      this.closeModal('connectionModal');
    });

    document.getElementById('connectBtn').addEventListener('click', () => {
      this.handleConnect();
    });

    document.getElementById('togglePassword').addEventListener('click', () => {
      this.togglePasswordVisibility();
    });

    // Bookmark modal
    document.getElementById('addBookmarkBtn').addEventListener('click', () => {
      this.openBookmarkModal();
    });

    // Folder modal
    document.getElementById('addFolderBtn').addEventListener('click', () => {
      this.openFolderModal();
    });

    // Sidebar toggle button
    document.getElementById('sidebarToggle').addEventListener('click', () => {
      this.toggleSidebar();
    });

    document.getElementById('closeBookmarkModal').addEventListener('click', () => {
      this.closeModal('bookmarkModal');
    });

    document.getElementById('cancelBookmark').addEventListener('click', () => {
      this.closeModal('bookmarkModal');
    });

    document.getElementById('saveBookmarkBtn').addEventListener('click', () => {
      this.saveBookmark();
    });

    document.getElementById('toggleBookmarkPassword').addEventListener('click', () => {
      const input = document.getElementById('bookmarkPassword');
      const icon = document.querySelector('#toggleBookmarkPassword i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      }
    });

    // Folder modal event listeners
    document.getElementById('closeFolderModal').addEventListener('click', () => {
      this.closeModal('folderModal');
    });

    document.getElementById('cancelFolder').addEventListener('click', () => {
      this.closeModal('folderModal');
    });

    document.getElementById('saveFolderBtn').addEventListener('click', () => {
      this.saveFolder();
    });

    // Icon selector event listeners
    document.querySelectorAll('.icon-option').forEach(option => {
      option.addEventListener('click', () => {
        // Remove selected from all options
        document.querySelectorAll('.icon-option').forEach(opt => {
          opt.classList.remove('selected');
        });
        // Add selected to clicked option
        option.classList.add('selected');
        // Update hidden input
        document.getElementById('folderIcon').value = option.dataset.icon;
      });
    });

    // Special keys modal
    document.getElementById('specialKeysBtn').addEventListener('click', () => {
      this.openModal('specialKeysModal');
    });

    document.getElementById('closeSpecialKeysModal').addEventListener('click', () => {
      this.closeModal('specialKeysModal');
    });

    // Special key buttons
    document.querySelectorAll('.key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sendSpecialKey(btn.dataset.key);
      });
    });

    // SFTP modal - now handled via tabs, keeping for backward compatibility
    // These event listeners are no longer needed but kept for reference
    // SFTP is now opened in tabs instead of modal

    // Window resize
    window.addEventListener('resize', () => {
      this.handleResize();
    });

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeModal(modal.id);
        }
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Shift+T - New tab
        if (e.shiftKey && e.key === 'T') {
          e.preventDefault();
          this.openConnectionModal('ssh');
        }
        // Ctrl+Shift+B - Toggle sidebar
        if (e.shiftKey && e.key === 'B') {
          e.preventDefault();
          this.toggleSidebar();
        }
        // Ctrl+W - Close current tab
        if (e.key === 'w' && this.activeSessionId) {
          e.preventDefault();
          this.closeTab(this.activeSessionId);
        }
        // Ctrl+Shift+R - Force screen sync (for sticky sessions)
        if (e.shiftKey && e.key === 'R') {
          e.preventDefault();
          if (this.activeSessionId && this.sticky) {
            console.log('[SSHIFT] Manual screen sync triggered');
            this.requestScreenSync(this.activeSessionId);
            this.showToast('Screen synchronized', 'success');
          }
        }
      }
    });
  }

  // Sidebar
  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      // Mobile: toggle sidebar open/close with overlay
      const overlay = document.querySelector('.sidebar-overlay');
      const isOpen = sidebar.classList.contains('open');
      
      if (isOpen) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      } else {
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('active');
      }
    } else {
      // Desktop: toggle sidebar collapsed state
      this.sidebarCollapsed = !this.sidebarCollapsed;
      
      if (this.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
        toggleBtn.title = 'Expand Sidebar';
      } else {
        sidebar.classList.remove('collapsed');
        toggleBtn.title = 'Collapse Sidebar';
      }
      
      // Save state
      this.saveSidebarState();
      
      // Resize terminals after sidebar toggle
      setTimeout(() => {
        this.sessions.forEach(session => {
          if (session.terminal && session.fitAddon) {
            try {
              session.fitAddon.fit();
            } catch (e) {
              // Ignore resize errors
            }
          }
        });
      }, 300);
    }
  }

  // Modals
  openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  // Settings Modal
  openSettingsModal() {
    // Load current sticky setting
    const stickyToggle = document.getElementById('stickyToggle');
    if (stickyToggle) {
      stickyToggle.checked = this.sticky;
    }
    
    // Load current SSH keepalive settings
    const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
    const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
    
    if (keepaliveIntervalInput && this.sshKeepaliveInterval) {
      keepaliveIntervalInput.value = this.sshKeepaliveInterval;
    }
    
    if (keepaliveCountMaxInput && this.sshKeepaliveCountMax) {
      keepaliveCountMaxInput.value = this.sshKeepaliveCountMax;
    }
    
    // Load current mobile keys bar setting
    const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
    if (mobileKeysBarToggle) {
      mobileKeysBarToggle.checked = this.mobileKeysBarEnabled;
    }
    
    this.openModal('settingsModal');
  }

  initSettingsModalHandlers() {
    // Close button
    const closeBtn = document.getElementById('closeSettingsModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeModal('settingsModal');
      });
    }

    // Cancel button
    const cancelBtn = document.getElementById('cancelSettings');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        // Revert toggle to current setting
        const stickyToggle = document.getElementById('stickyToggle');
        if (stickyToggle) {
          stickyToggle.checked = this.sticky;
        }
        
        // Revert SSH keepalive settings
        const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
        const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
        
        if (keepaliveIntervalInput && this.sshKeepaliveInterval) {
          keepaliveIntervalInput.value = this.sshKeepaliveInterval;
        }
        
        if (keepaliveCountMaxInput && this.sshKeepaliveCountMax) {
          keepaliveCountMaxInput.value = this.sshKeepaliveCountMax;
        }
        
        // Revert mobile keys bar setting
        const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
        if (mobileKeysBarToggle) {
          mobileKeysBarToggle.checked = this.mobileKeysBarEnabled;
        }
        
        this.closeModal('settingsModal');
      });
    }

    // Save button
    const saveBtn = document.getElementById('saveSettings');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const stickyToggle = document.getElementById('stickyToggle');
        const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
        const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
        const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
        
        // Save sticky setting
        if (stickyToggle) {
          this.sticky = stickyToggle.checked;
        }
        
        // Save SSH keepalive settings
        if (keepaliveIntervalInput) {
          this.sshKeepaliveInterval = parseInt(keepaliveIntervalInput.value) || 10000;
        }
        
        if (keepaliveCountMaxInput) {
          this.sshKeepaliveCountMax = parseInt(keepaliveCountMaxInput.value) || 1000;
        }
        
        // Save mobile keys bar setting
        if (mobileKeysBarToggle) {
          this.mobileKeysBarEnabled = mobileKeysBarToggle.checked;
          this.updateMobileKeysBar();
        }
        
        // Save all settings to config
        this.saveStickyConfig();
        console.log('[SSHIFT] Settings saved - sticky:', this.sticky, 
                    'keepaliveInterval:', this.sshKeepaliveInterval,
                    'keepaliveCountMax:', this.sshKeepaliveCountMax,
                    'mobileKeysBarEnabled:', this.mobileKeysBarEnabled);
        
        // Show toast notification
        this.showToast('Settings saved successfully', 'success');
        
        this.closeModal('settingsModal');
      });
    }

    // Click outside modal to close
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
          e.preventDefault();
          e.stopImmediatePropagation();
          // Revert toggle to current setting
          const stickyToggle = document.getElementById('stickyToggle');
          if (stickyToggle) {
            stickyToggle.checked = this.sticky;
          }
          
          // Revert SSH keepalive settings
          const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
          const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
          
          if (keepaliveIntervalInput && this.sshKeepaliveInterval) {
            keepaliveIntervalInput.value = this.sshKeepaliveInterval;
          }
          
          if (keepaliveCountMaxInput && this.sshKeepaliveCountMax) {
            keepaliveCountMaxInput.value = this.sshKeepaliveCountMax;
          }
          
          this.closeModal('settingsModal');
        }
      });
    }
  }

  setupMobileOverflowMenu() {
    const overflowToggle = document.getElementById('overflowToggle');
    const overflowDropdown = document.getElementById('overflowDropdown');
    
    if (!overflowToggle || !overflowDropdown) return;

    // Toggle dropdown
    overflowToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      overflowDropdown.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (overflowDropdown.classList.contains('show') && !e.target.closest('.mobile-overflow-menu')) {
        overflowDropdown.classList.remove('show');
      }
    });

    // Mobile theme toggle
    const mobileThemeToggle = document.getElementById('mobileThemeToggle');
    if (mobileThemeToggle) {
      mobileThemeToggle.addEventListener('click', () => {
        this.toggleTheme();
        overflowDropdown.classList.remove('show');
      });
    }

    // Mobile settings button
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    if (mobileSettingsBtn) {
      mobileSettingsBtn.addEventListener('click', () => {
        this.openSettingsModal();
        overflowDropdown.classList.remove('show');
      });
    }

    // Mobile bookmark button
    const mobileBookmarkBtn = document.getElementById('mobileBookmarkBtn');
    if (mobileBookmarkBtn) {
      mobileBookmarkBtn.addEventListener('click', () => {
        this.toggleSidebar();
        overflowDropdown.classList.remove('show');
      });
    }

    // Mobile accent color options
    const mobileAccentSubmenu = document.getElementById('mobileAccentSubmenu');
    if (mobileAccentSubmenu) {
      const submenuToggle = mobileAccentSubmenu.querySelector('.submenu-toggle');
      const submenuContent = mobileAccentSubmenu.querySelector('.submenu-content');
      
      if (submenuToggle && submenuContent) {
        submenuToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          submenuContent.classList.toggle('show');
        });
      }

      // Accent color options
      mobileAccentSubmenu.querySelectorAll('.accent-option').forEach(option => {
        option.addEventListener('click', () => {
          const accent = option.dataset.accent;
          this.setAccent(accent);
          submenuContent.classList.remove('show');
          overflowDropdown.classList.remove('show');
        });
      });
    }

    // Mobile terminal color options
    const mobileTerminalColorSubmenu = document.getElementById('mobileTerminalColorSubmenu');
    if (mobileTerminalColorSubmenu) {
      const submenuToggle = mobileTerminalColorSubmenu.querySelector('.submenu-toggle');
      const submenuContent = mobileTerminalColorSubmenu.querySelector('.submenu-content');
      
      if (submenuToggle && submenuContent) {
        submenuToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          submenuContent.classList.toggle('show');
        });
      }

      // Terminal color override toggle
      const mobileTerminalColorOverride = document.getElementById('mobileTerminalColorOverride');
      if (mobileTerminalColorOverride) {
        mobileTerminalColorOverride.addEventListener('change', () => {
          this.toggleTerminalColorOverride();
          // Sync with desktop toggle
          const desktopToggle = document.getElementById('terminalColorOverride');
          if (desktopToggle) {
            desktopToggle.checked = this.terminalColorOverride;
          }
        });
      }

      // Terminal color inputs
      const mobileTerminalBgColor = document.getElementById('mobileTerminalBgColor');
      if (mobileTerminalBgColor) {
        mobileTerminalBgColor.addEventListener('input', (e) => {
          this.setTerminalBgColor(e.target.value);
          // Sync with desktop input
          const desktopInput = document.getElementById('terminalBgColor');
          if (desktopInput) {
            desktopInput.value = e.target.value;
          }
        });
      }

      const mobileTerminalFgColor = document.getElementById('mobileTerminalFgColor');
      if (mobileTerminalFgColor) {
        mobileTerminalFgColor.addEventListener('input', (e) => {
          this.setTerminalFgColor(e.target.value);
          // Sync with desktop input
          const desktopInput = document.getElementById('terminalFgColor');
          if (desktopInput) {
            desktopInput.value = e.target.value;
          }
        });
      }

      const mobileTerminalSelectionColor = document.getElementById('mobileTerminalSelectionColor');
      if (mobileTerminalSelectionColor) {
        mobileTerminalSelectionColor.addEventListener('input', (e) => {
          this.setTerminalSelectionColor(e.target.value);
          // Sync with desktop input
          const desktopInput = document.getElementById('terminalSelectionColor');
          if (desktopInput) {
            desktopInput.value = e.target.value;
          }
        });
      }
    }
  }

  setupMobileTabsDropdown() {
    const mobileTabsToggle = document.getElementById('mobileTabsToggle');
    const mobileTabsMenu = document.getElementById('mobileTabsMenu');
    
    if (!mobileTabsToggle || !mobileTabsMenu) return;

    // Toggle dropdown
    mobileTabsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileTabsToggle.classList.toggle('active');
      mobileTabsMenu.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (mobileTabsMenu.classList.contains('show') && !e.target.closest('.mobile-tabs-dropdown')) {
        mobileTabsToggle.classList.remove('active');
        mobileTabsMenu.classList.remove('show');
      }
    });
  }

  updateMobileTabsDropdown() {
    const mobileTabsLabel = document.getElementById('mobileTabsLabel');
    const mobileTabsMenu = document.getElementById('mobileTabsMenu');
    const mobileTabsToggle = document.getElementById('mobileTabsToggle');
    
    if (!mobileTabsLabel || !mobileTabsMenu || !mobileTabsToggle) return;

    // Get all tabs
    const tabsContainer = document.getElementById('tabs');
    const tabs = tabsContainer ? Array.from(tabsContainer.children) : [];

    // Clear existing menu
    mobileTabsMenu.innerHTML = '';

    // Find active tab
    let activeTabName = 'No Active Tabs';
    let activeTabIcon = 'fa-terminal';

    // Add menu options for each tab
    tabs.forEach(tab => {
      const sessionId = tab.dataset.sessionId;
      const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
      const isActive = tab.classList.contains('active');
      
      if (session) {
        const icon = session.type === 'sftp' ? 'fa-folder-open' : 'fa-terminal';
        const iconClass = session.type === 'sftp' ? 'sftp' : 'ssh';
        const name = session.name || sessionId;

        if (isActive) {
          activeTabName = name;
          activeTabIcon = icon;
        }

        const option = document.createElement('div');
        option.className = `mobile-tab-option${isActive ? ' active' : ''}`;
        option.dataset.sessionId = sessionId;
        option.innerHTML = `
          <i class="fas ${icon} tab-icon ${iconClass}"></i>
          <span class="tab-name">${name}</span>
          <button class="tab-rename" data-session-id="${sessionId}" title="Rename">
            <i class="fas fa-pen"></i>
          </button>
          <button class="tab-close" data-session-id="${sessionId}" title="Close">
            <i class="fas fa-times"></i>
          </button>
        `;

        // Click to switch tab (on the option div, not on the rename/close buttons)
        option.addEventListener('click', (e) => {
          if (!e.target.closest('.tab-rename') && !e.target.closest('.tab-close')) {
            this.switchTab(sessionId);
            mobileTabsMenu.classList.remove('show');
            mobileTabsToggle.classList.remove('active');
          }
        });

        mobileTabsMenu.appendChild(option);

        // Rename button
        const renameBtn = option.querySelector('.tab-rename');
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.startTabRename(sessionId);
          mobileTabsMenu.classList.remove('show');
          mobileTabsToggle.classList.remove('active');
        });

        // Close button
        const closeBtn = option.querySelector('.tab-close');
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(sessionId);
        });
      }
    });

    // Update toggle button
    const iconElement = mobileTabsToggle.querySelector('.tab-icon-active');
    if (iconElement) {
      iconElement.className = `fas ${activeTabIcon} tab-icon-active`;
    }
    mobileTabsLabel.textContent = activeTabName;
  }

  saveStickyConfig() {
    // Save to localStorage
    localStorage.setItem('sticky', JSON.stringify(this.sticky));
    localStorage.setItem('sshKeepaliveInterval', this.sshKeepaliveInterval || 10000);
    localStorage.setItem('sshKeepaliveCountMax', this.sshKeepaliveCountMax || 1000);
    localStorage.setItem('mobileKeysBarEnabled', JSON.stringify(this.mobileKeysBarEnabled));
    
    // Save to server config
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        sticky: this.sticky,
        sshKeepaliveInterval: this.sshKeepaliveInterval || 10000,
        sshKeepaliveCountMax: this.sshKeepaliveCountMax || 1000,
        mobileKeysBarEnabled: this.mobileKeysBarEnabled
      })
    }).then(response => {
      if (!response.ok) {
        console.error('[SSHIFT] Failed to save config');
      }
    }).catch(err => {
      console.error('[SSHIFT] Error saving config:', err);
    });
  }

  saveTerminalColorSettings() {
    // Save settings for current theme
    const themeKey = this.theme; // 'dark' or 'light'
    localStorage.setItem(`terminalColorOverride_${themeKey}`, this.terminalColorOverride);
    localStorage.setItem(`terminalBgColor_${themeKey}`, this.terminalBgColor);
    localStorage.setItem(`terminalFgColor_${themeKey}`, this.terminalFgColor);
    localStorage.setItem(`terminalSelectionColor_${themeKey}`, this.terminalSelectionColor);
  }

  loadTerminalColorSettings() {
    // Load settings for current theme
    const themeKey = this.theme; // 'dark' or 'light'
    
    // Default colors for each theme
    const defaults = {
      dark: {
        override: true,
        bg: '#0d1117',
        fg: '#e6edf3',
        selection: '#264f78'
      },
      light: {
        override: true,
        bg: '#ffffff',
        fg: '#1f2328',
        selection: '#b6e3ff'
      }
    };
    
    const defaultSet = defaults[themeKey] || defaults.dark;
    
    this.terminalColorOverride = localStorage.getItem(`terminalColorOverride_${themeKey}`) !== 'false';
    // If not set, use default (true for both themes)
    if (localStorage.getItem(`terminalColorOverride_${themeKey}`) === null) {
      this.terminalColorOverride = defaultSet.override;
    }
    
    this.terminalBgColor = localStorage.getItem(`terminalBgColor_${themeKey}`) || defaultSet.bg;
    this.terminalFgColor = localStorage.getItem(`terminalFgColor_${themeKey}`) || defaultSet.fg;
    this.terminalSelectionColor = localStorage.getItem(`terminalSelectionColor_${themeKey}`) || defaultSet.selection;
  }

  updateTerminalColors() {
    // Update all active terminals
    this.sessions.forEach((session, sessionId) => {
      if (session.terminal) {
        const theme = this.getTerminalTheme();
        session.terminal.options.theme = theme;
      }
    });
  }

  // Connection Modal
  openConnectionModal(type) {
    this.currentConnectionType = type;
    document.getElementById('connectionType').value = type;
    document.getElementById('connectionModalTitle').textContent = 
      type === 'ssh' ? 'New SSH Connection' : 'New SFTP Connection';
    document.getElementById('connectionForm').reset();
    document.getElementById('connPort').value = '22';
    this.openModal('connectionModal');
  }

  togglePasswordVisibility() {
    const input = document.getElementById('connPassword');
    const icon = document.querySelector('#togglePassword i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
      input.type = 'password';
      icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
  }

  // Handle Connection
  handleConnect() {
    const host = document.getElementById('connHost').value.trim();
    const port = parseInt(document.getElementById('connPort').value) || 22;
    const username = document.getElementById('connUsername').value.trim();
    const password = document.getElementById('connPassword').value;
    const privateKey = document.getElementById('connPrivateKey').value.trim();
    const passphrase = document.getElementById('connPassphrase').value;
    const name = document.getElementById('connName').value.trim() || `${username}@${host}`;
    const saveBookmark = document.getElementById('saveBookmark').checked;
    const type = this.currentConnectionType;

    console.log('[SSHIFT] handleConnect called');
    console.log('[SSHIFT] Host:', host, 'Port:', port, 'Username:', username, 'Type:', type);

    if (!host || !username) {
      this.showToast('Host and username are required', 'error');
      return;
    }

    // Build connection data - only include auth if provided
    const connectionData = {
      host,
      port,
      username,
      cols: 80,
      rows: 24
    };

    // Only add auth method if provided
    if (password && password.length > 0) {
      connectionData.password = password;
      console.log('[SSHIFT] Using password authentication');
    } else if (privateKey && privateKey.length > 0) {
      connectionData.privateKey = privateKey;
      if (passphrase && passphrase.length > 0) {
        connectionData.passphrase = passphrase;
      }
      console.log('[SSHIFT] Using private key authentication');
    } else {
      console.log('[SSHIFT] No auth provided, will try keyboard-interactive');
    }

    console.log('[SSHIFT] Socket connected:', this.socket.connected);

    // Save bookmark if requested
    if (saveBookmark) {
      this.addBookmark({
        name,
        host,
        port,
        username,
        type
      });
    }

    // Show connecting status
    this.showToast(`Connecting to ${host}...`, 'info');

    if (type === 'ssh') {
      console.log('[SSHIFT] Creating SSH tab...');
      this.createSSHTab(name, connectionData);
    } else {
      console.log('[SSHIFT] Creating SFTP tab...');
      this.createSFTPTab(name, connectionData);
    }

    this.closeModal('connectionModal');
  }

  // SSH Session Management
  createSSHTab(name, connectionData, restoreSessionId = null) {
    const sessionId = restoreSessionId || 'ssh-' + Date.now();
    console.log('[SSHIFT] createSSHTab called:', { 
      name, 
      sessionId, 
      restoreSessionId, 
      isRestoring: !!restoreSessionId,
      host: connectionData.host 
    });
    
    const tab = this.createTabElement(sessionId, name, 'ssh');
    const terminalWrapper = this.createTerminalElement(sessionId);

    document.getElementById('tabs').appendChild(tab);
    document.getElementById('terminalsContainer').appendChild(terminalWrapper);

    this.sessions.set(sessionId, {
      id: sessionId,
      name,
      type: 'ssh',
      terminal: null,
      fitAddon: null,
      connecting: true,
      connected: false,
      connectionData, // Store for sticky sessions
      isRestoring: !!restoreSessionId, // Flag to indicate if this is a restored session
      isAtBottom: true // Auto-scroll by default when new data arrives
    });

    // Switch to the new tab FIRST to make the container visible
    this.switchTab(sessionId);
    this.hideEmptyState();

    // Initialize terminal AFTER container is visible
    // Use multiple requestAnimationFrame to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      // Double RAF to ensure layout is complete
      requestAnimationFrame(() => {
        this.initTerminal(sessionId);

        // If restoring a session, try to join it first (no connecting message)
        if (restoreSessionId) {
          console.log('[SSHIFT] Attempting to join existing session:', restoreSessionId);
          
          // Set syncing flag BEFORE sending join request to prevent race condition
          // where ssh-data arrives before ssh-screen-sync
          const session = this.sessions.get(restoreSessionId);
          if (session) {
            session.syncing = true;
            
            // Safety timeout: clear syncing flag after 5 seconds if ssh-screen-sync never arrives
            // This prevents the terminal from being stuck in syncing state
            session.syncTimeout = setTimeout(() => {
              console.warn('[SSHIFT] Sync timeout, clearing syncing flag for session:', restoreSessionId);
              session.syncing = false;
            }, 5000);
          }
          
          this.socket.emit('ssh-join', { sessionId: restoreSessionId });
        } else {
          // Show connecting message only for new connections
          const session = this.sessions.get(sessionId);
          if (session && session.terminal) {
            session.terminal.writeln('\x1b[36m⏳ Connecting to ' + connectionData.host + '...\x1b[0m');
            session.terminal.writeln('');
          }
          // Connect via socket AFTER terminal is ready
          console.log('[SSHIFT] Emitting ssh-connect for session:', sessionId);
          this.socket.emit('ssh-connect', { ...connectionData, sessionId });
        }
      });
    });
    
    // Save tabs
    this.saveTabs();
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    return sessionId;
  }

  createTabElement(sessionId, name, type) {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.draggable = true;
    tab.dataset.sessionId = sessionId;
    tab.innerHTML = `
      <i class="fas fa-${type === 'ssh' ? 'terminal' : 'folder-open'} tab-icon ${type}"></i>
      <span class="tab-name">${this.escapeHtml(name)}</span>
      <button class="tab-close" title="Close">
        <i class="fas fa-times"></i>
      </button>
    `;

    // Drag and drop events for tabs
    tab.addEventListener('dragstart', (e) => this.handleTabDragStart(e, sessionId));
    tab.addEventListener('dragover', (e) => this.handleTabDragOver(e));
    tab.addEventListener('drop', (e) => this.handleTabDrop(e, sessionId));
    tab.addEventListener('dragend', (e) => this.handleTabDragEnd(e));

    // Right-click context menu for renaming
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showTabContextMenu(sessionId, e);
    });

    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) {
        this.closeTab(sessionId);
      } else {
        // Show special keys popup on tab click (for mobile)
        if (window.innerWidth <= 768) {
          this.openModal('specialKeysModal');
        }
        this.switchTab(sessionId);
      }
    });

    return tab;
  }

  handleTabDragStart(e, sessionId) {
    this.draggedTab = sessionId;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
  }

  handleTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const target = e.target.closest('.tab');
    if (target && target.dataset.sessionId !== this.draggedTab) {
      target.style.borderLeft = '2px solid var(--accent-primary)';
    }
  }

  handleTabDrop(e, targetSessionId) {
    e.preventDefault();
    
    if (!this.draggedTab || this.draggedTab === targetSessionId) {
      return;
    }

    // Get all tabs as array
    const tabsContainer = document.getElementById('tabs');
    const tabs = Array.from(tabsContainer.children);
    
    // Find indices
    const draggedIndex = tabs.findIndex(t => t.dataset.sessionId === this.draggedTab);
    const targetIndex = tabs.findIndex(t => t.dataset.sessionId === targetSessionId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Reorder tabs in DOM
      const draggedTab = tabs[draggedIndex];
      
      if (draggedIndex < targetIndex) {
        tabsContainer.insertBefore(draggedTab, tabs[targetIndex].nextSibling);
      } else {
        tabsContainer.insertBefore(draggedTab, tabs[targetIndex]);
      }
    }
  }

  handleTabDragEnd(e) {
    e.target.style.opacity = '1';
    this.draggedTab = null;
    
    // Remove all border styles
    document.querySelectorAll('.tab').forEach(tab => {
      tab.style.borderLeft = '';
    });
    
    // Save tabs order when sticky is enabled
    this.saveTabs();
    
    // Emit tab reorder to server for cross-client sync
    if (this.sticky && this.socket && this.socket.connected) {
      const tabsContainer = document.getElementById('tabs');
      const order = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
      this.socket.emit('tab-reorder', { order });
    }
  }
  
  reorderTabsInDOM(order) {
    const tabsContainer = document.getElementById('tabs');
    if (!tabsContainer) return;
    
    // Reorder tabs in DOM according to the order array
    order.forEach(sessionId => {
      const tab = tabsContainer.querySelector(`[data-session-id="${sessionId}"]`);
      if (tab) {
        tabsContainer.appendChild(tab);
      }
    });
  }

  createTerminalElement(sessionId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-wrapper';
    wrapper.id = `terminal-wrapper-${sessionId}`;
    
    // Create a dedicated container for xterm
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-container';
    terminalContainer.id = `terminal-${sessionId}`;
    
    wrapper.appendChild(terminalContainer);
    return wrapper;
  }

  initTerminal(sessionId, retryCount = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error('[SSHIFT] Session not found for terminal init:', sessionId);
      return;
    }

    const container = document.getElementById(`terminal-${sessionId}`);
    if (!container) {
      console.error('[SSHIFT] Container not found for terminal:', sessionId);
      return;
    }

    const wrapper = container.parentElement;
    const isVisible = wrapper && wrapper.classList.contains('active');
    
    console.log('[SSHIFT] Initializing terminal for session:', sessionId);
    console.log('[SSHIFT] Container dimensions:', container.offsetWidth, 'x', container.offsetHeight);
    console.log('[SSHIFT] Wrapper visible:', isVisible, 'Display:', wrapper ? getComputedStyle(wrapper).display : 'N/A');

    // Ensure container has dimensions and is visible
    if (container.offsetWidth === 0 || container.offsetHeight === 0 || !isVisible) {
      if (retryCount < 10) {
        console.warn(`[SSHIFT] Container not ready (attempt ${retryCount + 1}/10), waiting...`);
        setTimeout(() => this.initTerminal(sessionId, retryCount + 1), 100);
        return;
      } else {
        console.error('[SSHIFT] Container failed to become visible after 10 attempts');
        this.showToast('Failed to initialize terminal - container not visible', 'error');
        return;
      }
    }

    try {
      // Libraries are normalized in index.html, so we can use window directly
      if (typeof window.Terminal !== 'function') {
        console.error('[SSHIFT] Terminal class not loaded! window.Terminal:', typeof window.Terminal);
        console.error('[SSHIFT] window.Terminal value:', window.Terminal);
        if (typeof window.Terminal === 'object' && window.Terminal !== null) {
          console.error('[SSHIFT] Terminal object keys:', Object.keys(window.Terminal));
        }
        this.showToast('Failed to load terminal library - please refresh the page', 'error');
        return;
      }

      if (typeof window.FitAddon !== 'function') {
        console.error('[SSHIFT] FitAddon class not loaded! window.FitAddon:', typeof window.FitAddon);
        console.error('[SSHIFT] window.FitAddon value:', window.FitAddon);
        if (typeof window.FitAddon === 'object' && window.FitAddon !== null) {
          console.error('[SSHIFT] FitAddon object keys:', Object.keys(window.FitAddon));
        }
        this.showToast('Failed to load terminal addons - please refresh the page', 'error');
        return;
      }

      console.log('[SSHIFT] Creating Terminal instance...');
      console.log('[SSHIFT] Terminal class:', window.Terminal.name || 'Terminal');
      console.log('[SSHIFT] FitAddon class:', window.FitAddon.name || 'FitAddon');
      
      const currentTheme = this.loadTheme();
      const terminalTheme = this.getTerminalTheme(currentTheme);
      const terminal = new window.Terminal({
        theme: terminalTheme,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace",
        fontSize: 14,
        lineHeight: 1.2,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        allowProposedApi: true,
        convertEol: true,
        allowTransparency: true,
        disableStdin: false
      });

      // Set wrapper background color
      if (wrapper) {
        if (this.terminalColorOverride) {
          wrapper.style.backgroundColor = this.terminalBgColor;
        } else {
          wrapper.style.backgroundColor = '#0d1117';
        }
      }

      console.log('[SSHIFT] Terminal instance created');

      const fitAddon = new window.FitAddon();
      
      // Load optional addons if available
      if (typeof window.WebLinksAddon === 'function') {
        try {
          const webLinksAddon = new window.WebLinksAddon();
          terminal.loadAddon(webLinksAddon);
          console.log('[SSHIFT] WebLinksAddon loaded');
        } catch (e) {
          console.warn('[SSHIFT] Failed to load WebLinksAddon:', e.message);
        }
      }
      
      if (typeof window.SearchAddon === 'function') {
        try {
          const searchAddon = new window.SearchAddon();
          terminal.loadAddon(searchAddon);
          console.log('[SSHIFT] SearchAddon loaded');
        } catch (e) {
          console.warn('[SSHIFT] Failed to load SearchAddon:', e.message);
        }
      }

      console.log('[SSHIFT] Loading FitAddon...');
      terminal.loadAddon(fitAddon);

      console.log('[SSHIFT] Opening terminal in container...');
      
      // Ensure container has valid dimensions before opening
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.error('[SSHIFT] Container has zero dimensions:', rect.width, 'x', rect.height);
        this.showToast('Terminal container has invalid dimensions', 'error');
        return;
      }
      
      // Clear any existing content in container
      container.innerHTML = '';
      
      terminal.open(container);
      
      console.log('[SSHIFT] Terminal opened, fitting...');
      
      // Fit after a small delay to ensure container is visible and rendered
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            // Force a reflow to ensure proper rendering
            container.offsetHeight;
            fitAddon.fit();
            console.log('[SSHIFT] Terminal fitted successfully, cols:', terminal.cols, 'rows:', terminal.rows);
          } catch (e) {
            console.warn('[SSHIFT] Could not fit terminal:', e.message);
            // Try again after another delay
            setTimeout(() => {
              try {
                fitAddon.fit();
                console.log('[SSHIFT] Terminal fitted on retry, cols:', terminal.cols, 'rows:', terminal.rows);
              } catch (e2) {
                console.error('[SSHIFT] Fit failed on retry:', e2.message);
              }
            }, 100);
          }
        }, 100);
      });

      // Handle terminal input
      terminal.onData((data) => {
        const sess = this.sessions.get(sessionId);
        console.log('[SSHIFT] Terminal input received, session:', sessionId, 'connected:', sess?.connected, 'connecting:', sess?.connecting);
        if (sess && sess.connected) {
          console.log('[SSHIFT] Sending input to server, sessionId:', sessionId);
          this.socket.emit('ssh-data', { sessionId, data });
        } else if (sess && sess.connecting) {
          // Buffer input while connecting (optional)
          console.log('[SSHIFT] Input received while connecting, ignoring');
        } else {
          console.warn('[SSHIFT] Input received but session not connected! Session:', sess);
        }
      });

      // Handle resize
      terminal.onResize(({ cols, rows }) => {
        const sess = this.sessions.get(sessionId);
        if (sess && sess.connected) {
          this.socket.emit('ssh-resize', { sessionId, cols, rows });
        }
      });

      // Handle copy/paste keyboard shortcuts
      terminal.attachCustomKeyEventHandler((event) => {
        console.log('[SSHIFT] Key event:', event.type, event.key, 'ctrl:', event.ctrlKey, 'shift:', event.shiftKey, 'hasSelection:', terminal.hasSelection());
        
        // Ctrl+C - Copy if there's a selection, otherwise send to terminal
        if (event.ctrlKey && event.key === 'c' && terminal.hasSelection()) {
          const selection = terminal.getSelection();
          if (selection) {
            console.log('[SSHIFT] Copying selection to clipboard');
            this.copyToClipboard(selection).then(success => {
              if (success) {
                console.log('[SSHIFT] Text copied to clipboard');
                this.showToast('Copied to clipboard', 'success');
              } else {
                this.showToast('Failed to copy', 'error');
              }
            });
            return false; // Prevent default behavior
          }
        }
        
        // Ctrl+V - Paste
        if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
          console.log('[SSHIFT] Paste shortcut triggered');
          this.readFromClipboard().then(text => {
            console.log('[SSHIFT] Clipboard content:', text ? 'found' : 'empty');
            if (text) {
              const sess = this.sessions.get(sessionId);
              if (sess && sess.connected) {
                this.socket.emit('ssh-data', { sessionId, data: text });
                this.showToast('Pasted from clipboard', 'success');
              }
            } else {
              this.showToast('Clipboard is empty', 'info');
            }
          });
          return false; // Prevent default behavior
        }
        
        // Ctrl+Shift+C - Force copy
        if (event.ctrlKey && event.shiftKey && event.key === 'C') {
          const selection = terminal.getSelection();
          if (selection) {
            console.log('[SSHIFT] Force copying selection to clipboard');
            this.copyToClipboard(selection).then(success => {
              if (success) {
                console.log('[SSHIFT] Text copied to clipboard');
                this.showToast('Copied to clipboard', 'success');
              } else {
                this.showToast('Failed to copy', 'error');
              }
            });
            return false;
          }
        }
        
        // Ctrl+Shift+V - Force paste
        if (event.ctrlKey && event.shiftKey && event.key === 'V') {
          console.log('[SSHIFT] Force paste shortcut triggered');
          this.readFromClipboard().then(text => {
            if (text) {
              const sess = this.sessions.get(sessionId);
              if (sess && sess.connected) {
                this.socket.emit('ssh-data', { sessionId, data: text });
                this.showToast('Pasted from clipboard', 'success');
              }
            } else {
              this.showToast('Clipboard is empty', 'info');
            }
          });
          return false;
        }
        
        return true; // Allow default behavior for other keys
      });

      // Handle right-click for context menu
      container.addEventListener('contextmenu', (e) => {
        console.log('[SSHIFT] Context menu triggered, hasSelection:', terminal.hasSelection());
        e.preventDefault();
        
        // If there's a selection, copy it
        if (terminal.hasSelection()) {
          const selection = terminal.getSelection();
          console.log('[SSHIFT] Selection:', selection);
          if (selection) {
            this.copyToClipboard(selection).then(success => {
              if (success) {
                this.showToast('Copied to clipboard', 'success');
              } else {
                this.showToast('Failed to copy', 'error');
              }
            });
          }
        } else {
          // Paste from clipboard
          console.log('[SSHIFT] Attempting to paste from clipboard');
          this.readFromClipboard().then(text => {
            console.log('[SSHIFT] Clipboard content:', text ? 'found' : 'empty');
            if (text) {
              const sess = this.sessions.get(sessionId);
              if (sess && sess.connected) {
                this.socket.emit('ssh-data', { sessionId, data: text });
                this.showToast('Pasted from clipboard', 'success');
              }
            } else {
              this.showToast('Clipboard is empty', 'info');
            }
          });
        }
      });

      session.terminal = terminal;
      session.fitAddon = fitAddon;

      // Setup mobile scroll behavior after terminal is ready
      // Use requestAnimationFrame to ensure terminal.element is available
      requestAnimationFrame(() => {
        this.setupMobileScrollBehavior(sessionId);
      });

      console.log('[SSHIFT] Terminal initialized for session:', sessionId);
    } catch (error) {
      console.error('[SSHIFT] Failed to initialize terminal:', error);
      console.error('[SSHIFT] Error stack:', error.stack);
      this.showToast('Failed to initialize terminal: ' + error.message, 'error');
    }
  }

  onSSHConnected(data) {
    console.log('[SSHIFT] onSSHConnected received:', data.sessionId);
    const session = this.sessions.get(data.sessionId);
    if (session) {
      console.log('[SSHIFT] Session state before connected:', {
        connecting: session.connecting,
        connected: session.connected,
        isRestoring: session.isRestoring
      });
      session.connecting = false;
      session.connected = true;
      session.isRestoring = false; // Clear restoring flag
      this.showToast('SSH connection established', 'success');
      console.log('[SSHIFT] Session marked as connected, terminal exists:', !!session.terminal);
      
      // Clear the connecting message and let the shell take over
      if (session.terminal) {
        console.log('[SSHIFT] Terminal exists, clearing connecting message');
        // Clear the terminal to remove connecting messages
        session.terminal.clear();
        
        // Send initial resize
        if (session.fitAddon) {
          try {
            session.fitAddon.fit();
            console.log('[SSHIFT] Terminal fitted, cols:', session.terminal.cols, 'rows:', session.terminal.rows);
            this.socket.emit('ssh-resize', { 
              sessionId: data.sessionId, 
              cols: session.terminal.cols, 
              rows: session.terminal.rows 
            });
          } catch (e) {
            console.warn('[SSHIFT] Could not fit terminal on connect:', e.message);
          }
        }
        
        // Focus the terminal so user can type immediately
        session.terminal.focus();
        console.log('[SSHIFT] Terminal focused after connection');
      } else {
        console.error('[SSHIFT] No terminal in session!');
      }
    } else {
      console.error('[SSHIFT] Session not found:', data.sessionId);
    }
  }

  onSSHData(data) {
    const session = this.sessions.get(data.sessionId);
    if (session && session.terminal) {
      // Skip data if we're currently syncing the terminal state
      // This prevents duplicate data from being written during sync
      if (session.syncing) {
        console.log('[SSHIFT] Skipping data during sync, size:', data.data?.length || 0);
        return;
      }
      
      try {
        session.terminal.write(data.data);
        
        // Auto-scroll to bottom on mobile when new data arrives
        if (this.isMobile) {
          // Use requestAnimationFrame to ensure scroll happens after render
          requestAnimationFrame(() => {
            this.scrollTerminalToBottom(data.sessionId);
          });
        }
      } catch (e) {
        console.error('[SSHIFT] Error writing to terminal:', e.message);
      }
    } else {
      console.warn('[SSHIFT] Received data for missing session/terminal:', data.sessionId);
    }
  }

  // SFTP Session Management
  createSFTPTab(name, connectionData, restoreSessionId = null) {
    const sessionId = restoreSessionId || 'sftp-' + Date.now();
    console.log('[SSHIFT] Creating SFTP tab with sessionId:', sessionId);
    
    const tab = this.createTabElement(sessionId, name, 'sftp');
    
    document.getElementById('tabs').appendChild(tab);

    // Create SFTP content element
    const sftpContent = this.createSFTPContentElement(sessionId);
    console.log('[SSHIFT] SFTP content element created:', sftpContent.id);
    document.getElementById('terminalsContainer').appendChild(sftpContent);

    this.sftpSessions.set(sessionId, {
      id: sessionId,
      name,
      type: 'sftp',
      currentPath: '/',
      connectionData // Store for sticky sessions
    });

    console.log('[SSHIFT] Switching to SFTP tab:', sessionId);
    this.switchTab(sessionId);
    this.hideEmptyState();

    // Verify the wrapper is active
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    console.log('[SSHIFT] Wrapper found:', !!wrapper);
    console.log('[SSHIFT] Wrapper has active class:', wrapper?.classList.contains('active'));
    
    // Verify SFTP container exists
    const sftpContainer = document.getElementById(`sftp-${sessionId}`);
    console.log('[SSHIFT] SFTP container found:', !!sftpContainer);

    // Connect via socket
    console.log('[SSHIFT] Emitting sftp-connect for session:', sessionId);
    this.socket.emit('sftp-connect', { ...connectionData, sessionId });
    
    // Save tabs
    this.saveTabs();
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    return sessionId;
  }

  createSFTPContentElement(sessionId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-wrapper';
    wrapper.id = `terminal-wrapper-${sessionId}`;
    
    const container = document.createElement('div');
    container.className = 'sftp-container';
    container.id = `sftp-${sessionId}`;
    container.innerHTML = `
      <div class="sftp-toolbar">
        <div class="sftp-path">
          <input type="text" class="sftp-path-input" placeholder="/path/to/directory">
          <button class="btn btn-sm sftp-go-btn">
            <i class="fas fa-arrow-right"></i>
          </button>
        </div>
        <div class="sftp-actions">
          <button class="btn btn-sm sftp-refresh-btn" title="Refresh">
            <i class="fas fa-sync-alt"></i>
          </button>
          <button class="btn btn-sm sftp-mkdir-btn" title="New Folder">
            <i class="fas fa-folder-plus"></i>
          </button>
          <button class="btn btn-sm sftp-upload-btn" title="Upload">
            <i class="fas fa-upload"></i>
          </button>
        </div>
      </div>
      <div class="sftp-file-list"></div>
    `;

    // Add event listeners
    const pathInput = container.querySelector('.sftp-path-input');
    const goBtn = container.querySelector('.sftp-go-btn');
    const refreshBtn = container.querySelector('.sftp-refresh-btn');
    const mkdirBtn = container.querySelector('.sftp-mkdir-btn');
    const uploadBtn = container.querySelector('.sftp-upload-btn');

    goBtn.addEventListener('click', () => {
      this.navigateSFTPPath(pathInput.value, sessionId);
    });

    pathInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.navigateSFTPPath(pathInput.value, sessionId);
      }
    });

    refreshBtn.addEventListener('click', () => {
      this.refreshSFTP(sessionId);
    });

    mkdirBtn.addEventListener('click', () => {
      this.createSFTPDirectory(sessionId);
    });

    uploadBtn.addEventListener('click', () => {
      this.uploadFile(sessionId);
    });

    wrapper.appendChild(container);
    return wrapper;
  }

  onSFTPConnected(data) {
    console.log('[SSHIFT] onSFTPConnected received:', data.sessionId);
    const session = this.sftpSessions.get(data.sessionId);
    if (session) {
      session.connected = true;
      this.showToast('SFTP connection established', 'success');
      
      // Debug: Check if container exists
      const sftpContainer = document.getElementById(`sftp-${data.sessionId}`);
      console.log('[SSHIFT] SFTP container found:', !!sftpContainer);
      
      if (sftpContainer) {
        console.log('[SSHIFT] SFTP container classes:', sftpContainer.className);
        console.log('[SSHIFT] SFTP container parent:', sftpContainer.parentElement?.id);
      }
      
      // Update path input and list files
      const pathInput = document.querySelector(`#sftp-${data.sessionId} .sftp-path-input`);
      console.log('[SSHIFT] Path input found:', !!pathInput);
      
      if (pathInput) {
        pathInput.value = session.currentPath || '/';
      } else {
        console.error('[SSHIFT] Path input not found for session:', data.sessionId);
      }
      
      // List files in the current directory
      console.log('[SSHIFT] Emitting sftp-list for path:', session.currentPath || '/');
      this.socket.emit('sftp-list', { sessionId: data.sessionId, path: session.currentPath || '/' });
    } else {
      console.error('[SSHIFT] SFTP session not found:', data.sessionId);
    }
  }

  renderSFTPFileList(path, files, sessionId) {
    console.log('[SSHIFT] renderSFTPFileList called with sessionId:', sessionId, 'path:', path, 'files:', files?.length || 0);
    
    // Find the correct container for this session
    // Try multiple selectors to find the file list
    let container = null;
    
    // Method 1: Direct selector with sessionId
    container = document.querySelector(`#sftp-${sessionId} .sftp-file-list`);
    console.log('[SSHIFT] Method 1 (direct selector):', !!container);
    
    // Method 2: Find by wrapper first, then container
    if (!container) {
      const wrapper = document.querySelector(`#terminal-wrapper-${sessionId}`);
      console.log('[SSHIFT] Wrapper found:', !!wrapper);
      if (wrapper) {
        container = wrapper.querySelector('.sftp-file-list');
        console.log('[SSHIFT] Method 2 (via wrapper):', !!container);
      }
    }
    
    // Method 3: Find active wrapper, then container
    if (!container) {
      const activeWrapper = document.querySelector('.terminal-wrapper.active');
      console.log('[SSHIFT] Active wrapper found:', !!activeWrapper);
      if (activeWrapper) {
        container = activeWrapper.querySelector('.sftp-file-list');
        console.log('[SSHIFT] Method 3 (via active wrapper):', !!container);
      }
    }
    
    if (!container) {
      console.error('[SSHIFT] SFTP file list container not found');
      console.log('[SSHIFT] Available SFTP containers:');
      document.querySelectorAll('.sftp-container').forEach(c => {
        console.log('  -', c.id, 'classes:', c.className, 'display:', window.getComputedStyle(c).display);
      });
      document.querySelectorAll('.sftp-file-list').forEach(c => {
        console.log('  - file-list parent:', c.parentElement?.id, 'display:', window.getComputedStyle(c.parentElement).display);
      });
      document.querySelectorAll('.terminal-wrapper').forEach(w => {
        console.log('  - wrapper:', w.id, 'active:', w.classList.contains('active'), 'display:', window.getComputedStyle(w).display);
      });
      return;
    }
    
    console.log('[SSHIFT] Container found, rendering files');
    container.innerHTML = '';

    // Add parent directory
    if (path !== '/') {
      const parentItem = document.createElement('div');
      parentItem.className = 'sftp-file-item';
      parentItem.innerHTML = `
        <div class="sftp-file-icon directory"><i class="fas fa-folder"></i></div>
        <div class="sftp-file-name">..</div>
      `;
      parentItem.addEventListener('click', () => {
        const parentPath = path.split('/').slice(0, -1).join('/') || '/';
        this.navigateSFTPPath(parentPath, sessionId);
      });
      container.appendChild(parentItem);
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
      if (a.type === 'd' && b.type !== 'd') return -1;
      if (a.type !== 'd' && b.type === 'd') return 1;
      return a.name.localeCompare(b.name);
    });

    files.forEach(file => {
      const item = document.createElement('div');
      item.className = 'sftp-file-item';
      const isDir = file.type === 'd';
      
      item.innerHTML = `
        <div class="sftp-file-icon ${isDir ? 'directory' : ''}">
          <i class="fas fa-${isDir ? 'folder' : 'file'}"></i>
        </div>
        <div class="sftp-file-name">${this.escapeHtml(file.name)}</div>
        ${!isDir ? `<div class="sftp-file-size">${this.formatSize(file.size)}</div>` : ''}
      `;

      item.addEventListener('click', () => {
        if (isDir) {
          const newPath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
          this.navigateSFTPPath(newPath, sessionId);
        } else {
          // Download file
          if (confirm(`Download ${file.name}?`)) {
            this.socket.emit('sftp-download', {
              sessionId,
              path: path === '/' ? `/${file.name}` : `${path}/${file.name}`
            });
          }
        }
      });

      // Add right-click context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const filePath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
        this.showSFTPContextMenu(file, filePath, sessionId, e);
      });

      container.appendChild(item);
    });
  }

  navigateSFTP(sessionId) {
    const pathInput = sessionId
      ? document.querySelector(`#sftp-${sessionId} .sftp-path-input`)
      : document.querySelector('.sftp-path-input.active');
    
    if (pathInput) {
      const path = pathInput.value.trim();
      this.navigateSFTPPath(path, sessionId);
    }
  }

  navigateSFTPPath(path, sessionId) {
    const session = this.sftpSessions.get(sessionId);
    if (session) {
      session.currentPath = path;
      
      const pathInput = document.querySelector(`#sftp-${sessionId} .sftp-path-input`);
      
      if (pathInput) {
        pathInput.value = path;
      }
      
      this.socket.emit('sftp-list', { sessionId, path });
    }
  }

  refreshSFTP(sessionId) {
    const pathInput = document.querySelector(`#sftp-${sessionId} .sftp-path-input`);
    
    if (pathInput) {
      const path = pathInput.value;
      this.socket.emit('sftp-list', { sessionId, path });
    }
  }

  createSFTPDirectory(sessionId) {
    const name = prompt('Enter directory name:');
    if (name) {
      const pathInput = document.querySelector(`#sftp-${sessionId} .sftp-path-input`);
      
      if (pathInput) {
        const path = pathInput.value;
        const newPath = path === '/' ? `/${name}` : `${path}/${name}`;
        this.socket.emit('sftp-mkdir', { sessionId, path: newPath });
        setTimeout(() => this.refreshSFTP(sessionId), 500);
      }
    }
  }

  uploadFile(sessionId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const pathInput = document.querySelector(`#sftp-${sessionId} .sftp-path-input`);
          
          if (pathInput) {
            const path = pathInput.value;
            const remotePath = path === '/' ? `/${file.name}` : `${path}/${file.name}`;
            this.socket.emit('sftp-upload', {
              sessionId,
              path: remotePath,
              data: btoa(event.target.result)
            });
          }
        };
        reader.readAsBinaryString(file);
      }
    };
    input.click();
  }

  downloadFile(path, data) {
    const filename = path.split('/').pop();
    const blob = new Blob([atob(data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Tab Management
  switchTab(sessionId) {
    console.log('[SSHIFT] switchTab called for session:', sessionId);
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
    });

    // Update active terminal - use wrapper ID
    document.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
      const isActive = wrapper.id === `terminal-wrapper-${sessionId}`;
      console.log('[SSHIFT] Setting wrapper', wrapper.id, 'active:', isActive);
      wrapper.classList.toggle('active', isActive);
    });

    this.activeSessionId = sessionId;
    
    // Update mobile keys bar visibility
    this.updateMobileKeysBar();

    // Fit terminal if SSH and focus it
    const session = this.sessions.get(sessionId);
    if (session && session.terminal && session.fitAddon) {
      setTimeout(() => {
        session.fitAddon.fit();
        // Focus the terminal so user can type
        if (session.terminal) {
          session.terminal.focus();
          console.log('[SSHIFT] Terminal focused for session:', sessionId);
        }
        
        // Request screen sync to ensure terminal is up-to-date
        // This is especially important for sticky sessions across different browsers
        if (session.connected && this.sticky) {
          console.log('[SSHIFT] Requesting screen sync for sticky session');
          this.requestScreenSync(sessionId);
        }
      }, 100);
    }
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Save tabs
    this.saveTabs();
  }

  closeTab(sessionId) {
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) return;

    // Notify server that this tab is closing (for cross-client sync)
    this.socket.emit('tab-close', { sessionId });

    // Disconnect
    if (session.type === 'ssh') {
      this.socket.emit('ssh-disconnect', { sessionId });
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
    } else {
      this.socket.emit('sftp-disconnect', { sessionId });
      this.sftpSessions.delete(sessionId);
    }

    // Remove from DOM
    const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    
    if (tab) tab.remove();
    if (wrapper) wrapper.remove();

    // Switch to another tab or show empty state
    if (this.activeSessionId === sessionId) {
      const remainingSessions = [...Array.from(this.sessions.keys()), ...Array.from(this.sftpSessions.keys())];
      if (remainingSessions.length > 0) {
        this.switchTab(remainingSessions[0]);
      } else {
        this.activeSessionId = null;
        this.showEmptyState();
        // Update mobile keys bar visibility when no active session
        this.updateMobileKeysBar();
      }
    }
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Save tabs
    this.saveTabs();
  }

  // Handle tab opened by another client
  handleTabOpened(data) {
    // Check if we already have this session
    if (this.sessions.has(data.sessionId) || this.sftpSessions.has(data.sessionId)) {
      console.log('[SSHIFT] Already have session:', data.sessionId);
      return;
    }

    console.log('[SSHIFT] Creating tab for session from another client:', data.sessionId);
    
    // Create the tab without connecting (we'll join the existing session)
    if (data.type === 'ssh') {
      this.createSSHTab(data.name, data.connectionData, data.sessionId);
    } else if (data.type === 'sftp') {
      this.createSFTPTab(data.name, data.connectionData, data.sessionId);
    }
  }

  // Handle tab closed by another client
  handleTabClosed(sessionId) {
    // Check if we have this session
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) {
      console.log('[SSHIFT] No session to close:', sessionId);
      return;
    }

    console.log('[SSHIFT] Closing tab from another client:', sessionId);
    
    // Clean up the session locally (don't emit tab-close again)
    if (session.type === 'ssh') {
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
    } else {
      this.sftpSessions.delete(sessionId);
    }

    // Remove from DOM
    const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    
    if (tab) tab.remove();
    if (wrapper) wrapper.remove();

    // Switch to another tab or show empty state
    if (this.activeSessionId === sessionId) {
      const remainingSessions = [...Array.from(this.sessions.keys()), ...Array.from(this.sftpSessions.keys())];
      if (remainingSessions.length > 0) {
        this.switchTab(remainingSessions[0]);
      } else {
        this.activeSessionId = null;
        this.showEmptyState();
        // Update mobile keys bar visibility when no active session
        this.updateMobileKeysBar();
      }
    }
    
    // Save tabs
    this.saveTabs();
  }

  // Sync tabs from server (called on connect when sticky is enabled)
  async syncTabsFromServer(tabs) {
    if (this.isRestoring) return;
    
    console.log('[SSHIFT] Syncing tabs from server:', tabs.length);
    this.isRestoring = true;

    for (const tab of tabs) {
      // Check if we already have this session
      if (this.sessions.has(tab.sessionId) || this.sftpSessions.has(tab.sessionId)) {
        console.log('[SSHIFT] Already have session:', tab.sessionId);
        continue;
      }

      console.log('[SSHIFT] Creating tab from server sync:', tab.name, tab.type);
      
      // Create the tab and join the existing session
      if (tab.type === 'ssh') {
        this.createSSHTab(tab.name, tab.connectionData, tab.sessionId);
      } else if (tab.type === 'sftp') {
        this.createSFTPTab(tab.name, tab.connectionData, tab.sessionId);
      }

      // Small delay between sessions
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Reorder tabs in DOM to match server order
    const order = tabs.map(t => t.sessionId);
    this.reorderTabsInDOM(order);

    this.isRestoring = false;
  }

  hideEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
      emptyState.classList.add('hidden');
    }
  }

  showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) {
      emptyState.classList.remove('hidden');
    }
  }

  // Special Keys
  sendSpecialKey(key) {
    if (!this.activeSessionId) {
      this.showToast('No active session', 'warning');
      return;
    }

    const session = this.sessions.get(this.activeSessionId);
    if (!session || session.type !== 'ssh') {
      this.showToast('Special keys only work in SSH sessions', 'warning');
      return;
    }

    const keyMap = {
      'ctrl+c': '\x03',
      'ctrl+d': '\x04',
      'ctrl+z': '\x1a',
      'ctrl+a': '\x01',
      'ctrl+e': '\x05',
      'ctrl+l': '\x0c',
      'ctrl+r': '\x12',
      'ctrl+u': '\x15',
      'ctrl+k': '\x0b',
      'ctrl+w': '\x17',
      'tab': '\t',
      'escape': '\x1b',
      'f1': '\x1bOP',
      'f2': '\x1bOQ',
      'f3': '\x1bOR',
      'f4': '\x1bOS',
      'f5': '\x1b[15~',
      'f6': '\x1b[17~',
      'f7': '\x1b[18~',
      'f8': '\x1b[19~',
      'f9': '\x1b[20~',
      'f10': '\x1b[21~',
      'f11': '\x1b[23~',
      'f12': '\x1b[24~',
      'arrow_up': '\x1b[A',
      'arrow_down': '\x1b[B',
      'arrow_right': '\x1b[C',
      'arrow_left': '\x1b[D',
      'home': '\x1b[H',
      'end': '\x1b[F',
      'pageup': '\x1b[5~',
      'pagedown': '\x1b[6~',
      'insert': '\x1b[2~',
      'delete': '\x1b[3~'
    };

    const sequence = keyMap[key];
    if (sequence) {
      this.socket.emit('ssh-data', { sessionId: this.activeSessionId, data: sequence });
    }

    this.closeModal('specialKeysModal');
  }

  // Bookmarks
  async loadBookmarks() {
    try {
      const response = await fetch('/api/bookmarks');
      let bookmarks = await response.json();
      
      // Apply saved order if exists
      const savedOrder = await this.loadBookmarkOrder();
      if (savedOrder && savedOrder.length > 0) {
        // Sort bookmarks by saved order
        const orderMap = new Map(savedOrder.map((id, index) => [id, index]));
        bookmarks.sort((a, b) => {
          const orderA = orderMap.get(a.id) ?? Infinity;
          const orderB = orderMap.get(b.id) ?? Infinity;
          return orderA - orderB;
        });
      }
      
      this.bookmarks = bookmarks;
      await this.loadFolders(); // Load folders before rendering
      this.renderBookmarks();
    } catch (err) {
      console.error('Failed to load bookmarks:', err);
    }
  }

  renderBookmarks() {
    const container = document.getElementById('bookmarksList');
    container.innerHTML = '';

    // Load expanded states
    const expandedStates = this.loadFolderExpandedStates();
    this.folders.forEach(folder => {
      if (expandedStates[folder.id] !== undefined) {
        folder.expanded = expandedStates[folder.id];
      }
    });

    // Group bookmarks by folder
    const bookmarksByFolder = new Map();
    const rootBookmarks = [];

    this.bookmarks.forEach(bookmark => {
      if (bookmark.folderId) {
        if (!bookmarksByFolder.has(bookmark.folderId)) {
          bookmarksByFolder.set(bookmark.folderId, []);
        }
        bookmarksByFolder.get(bookmark.folderId).push(bookmark);
      } else {
        rootBookmarks.push(bookmark);
      }
    });

    // Render folders
    this.folders.forEach(folder => {
      const folderElement = this.createFolderElement(folder, bookmarksByFolder.get(folder.id) || []);
      container.appendChild(folderElement);
    });

    // Render root bookmarks (no folder)
    // Always create root container to allow dropping bookmarks to root
    const rootContainer = document.createElement('div');
    rootContainer.className = 'bookmarks-root';
    rootContainer.dataset.folderId = 'root';
    
    rootBookmarks.forEach(bookmark => {
      const item = this.createBookmarkElement(bookmark);
      rootContainer.appendChild(item);
    });

    // Add drop zone for root bookmarks
    rootContainer.addEventListener('dragover', (e) => this.handleBookmarkDragOver(e));
    rootContainer.addEventListener('drop', (e) => this.handleBookmarkDropToRoot(e));

    container.appendChild(rootContainer);

    // Show empty state if no bookmarks or folders
    if (this.bookmarks.length === 0 && this.folders.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
          <p>No bookmarks yet</p>
          <p style="font-size: 12px;">Click + to add one</p>
        </div>
      `;
    }
  }

  createFolderElement(folder, bookmarks) {
    const folderContainer = document.createElement('div');
    folderContainer.className = 'folder-container';
    folderContainer.dataset.folderId = folder.id;

    const folderHeader = document.createElement('div');
    folderHeader.className = 'folder-header';
    folderHeader.draggable = true;
    folderHeader.dataset.folderId = folder.id;

    const isExpanded = folder.expanded !== false;
    const bookmarkCount = bookmarks.length;
    
    // Get first letter of folder name (uppercase) for collapsed sidebar state
    const firstLetter = folder.name ? folder.name.charAt(0).toUpperCase() : 'F';

    folderHeader.innerHTML = `
      <div class="folder-toggle">
        <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}"></i>
      </div>
      <div class="folder-icon">
        <i class="fas fa-${folder.icon || 'folder'}"></i>
        <span class="folder-letter">${this.escapeHtml(firstLetter)}</span>
      </div>
      <div class="folder-name">${this.escapeHtml(folder.name)}</div>
      <div class="folder-count">${bookmarkCount}</div>
      <div class="folder-menu-wrapper">
        <button class="folder-menu-btn" title="Folder Options">
          <i class="fas fa-ellipsis-v"></i>
        </button>
        <div class="folder-menu-dropdown">
          <button class="folder-menu-item add-bookmark-to-folder" data-action="add">
            <i class="fas fa-plus"></i>
            <span>Add Bookmark</span>
          </button>
          <button class="folder-menu-item edit-folder" data-action="edit">
            <i class="fas fa-edit"></i>
            <span>Edit Folder</span>
          </button>
          <button class="folder-menu-item delete-folder" data-action="delete">
            <i class="fas fa-trash"></i>
            <span>Delete Folder</span>
          </button>
        </div>
      </div>
    `;

    // Folder drag events
    folderHeader.addEventListener('dragstart', (e) => this.handleFolderDragStart(e, folder));
    folderHeader.addEventListener('dragover', (e) => this.handleFolderDragOver(e));
    folderHeader.addEventListener('drop', (e) => this.handleFolderDrop(e, folder));
    folderHeader.addEventListener('dragend', (e) => this.handleFolderDragEnd(e));

    // Toggle expand/collapse
    folderHeader.querySelector('.folder-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFolderExpand(folder.id);
    });

    // Menu button click handler
    const menuBtn = folderHeader.querySelector('.folder-menu-btn');
    const menuDropdown = folderHeader.querySelector('.folder-menu-dropdown');
    
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all other open menus
      document.querySelectorAll('.folder-menu-dropdown.show').forEach(menu => {
        if (menu !== menuDropdown) {
          menu.classList.remove('show');
        }
      });
      menuDropdown.classList.toggle('show');
    });

    // Menu item click handlers
    menuDropdown.querySelector('.add-bookmark-to-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.remove('show');
      this.openBookmarkModal(null, folder.id);
    });

    menuDropdown.querySelector('.edit-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.remove('show');
      this.openFolderModal(folder);
    });

    menuDropdown.querySelector('.delete-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.remove('show');
      this.deleteFolder(folder.id);
    });

    // Folder header click handler
    folderHeader.addEventListener('click', (e) => {
      // If clicking on menu wrapper, don't do anything (handled by menu button)
      if (e.target.closest('.folder-menu-wrapper')) {
        return;
      }
      // If sidebar is collapsed, show context menu with folder contents
      if (this.sidebarCollapsed) {
        e.preventDefault();
        e.stopPropagation();
        this.showFolderContextMenu(folder, bookmarks, e);
      } else {
        this.toggleFolderExpand(folder.id);
      }
    });

    folderContainer.appendChild(folderHeader);

    // Bookmarks container
    const bookmarksContainer = document.createElement('div');
    bookmarksContainer.className = `folder-bookmarks ${isExpanded ? 'expanded' : 'collapsed'}`;
    bookmarksContainer.dataset.folderId = folder.id;

    bookmarks.forEach(bookmark => {
      const item = this.createBookmarkElement(bookmark, folder.id);
      bookmarksContainer.appendChild(item);
    });

    // Drop zone for bookmarks
    bookmarksContainer.addEventListener('dragover', (e) => this.handleBookmarkDragOver(e, folder.id));
    bookmarksContainer.addEventListener('drop', (e) => this.handleBookmarkDropToFolder(e, folder.id));

    folderContainer.appendChild(bookmarksContainer);

    return folderContainer;
  }

  createBookmarkElement(bookmark, folderId = null) {
    const item = document.createElement('div');
    item.className = 'bookmark-item';
    item.draggable = true;
    item.dataset.bookmarkId = bookmark.id;
    if (folderId) {
      item.dataset.folderId = folderId;
    }
    
    // Create a bookmark object with the correct folderId
    const bookmarkWithFolder = { ...bookmark, folderId: folderId || bookmark.folderId || null };
    
    const firstLetter = bookmark.name.charAt(0).toUpperCase();
    item.innerHTML = `
      <div class="bookmark-icon ${bookmark.type}">
        <i class="fas fa-${bookmark.type === 'ssh' ? 'terminal' : 'folder-open'}"></i>
        <span class="bookmark-letter">${firstLetter}</span>
      </div>
      <div class="bookmark-info">
        <div class="bookmark-name">${this.escapeHtml(bookmark.name)}</div>
        <div class="bookmark-details">${this.escapeHtml(bookmark.username)}@${this.escapeHtml(bookmark.host)}:${bookmark.port}</div>
      </div>
      <div class="bookmark-actions">
        ${bookmark.type === 'ssh' ? '<button class="sftp-bookmark" title="Open SFTP"><i class="fas fa-folder-open"></i></button>' : ''}
        <button class="bookmark-menu-btn" title="Menu">
          <i class="fas fa-ellipsis-v"></i>
        </button>
      </div>
    `;

    // Drag and drop events - use bookmarkWithFolder to ensure folderId is correct
    item.addEventListener('dragstart', (e) => this.handleBookmarkDragStart(e, bookmarkWithFolder));
    item.addEventListener('dragover', (e) => this.handleBookmarkDragOver(e));
    item.addEventListener('drop', (e) => this.handleBookmarkDrop(e, bookmarkWithFolder));
    item.addEventListener('dragend', (e) => this.handleBookmarkDragEnd(e));

    item.addEventListener('click', (e) => {
      const isMobile = window.innerWidth <= 768;
      
      // On mobile or collapsed sidebar, show context menu
      if (isMobile || this.sidebarCollapsed) {
        e.preventDefault();
        e.stopPropagation();
        this.showBookmarkContextMenu(bookmark, e, isMobile);
      } else {
        // Normal behavior when sidebar is expanded on desktop
        if (e.target.closest('.sftp-bookmark')) {
          e.stopPropagation();
          this.openSFTPFromBookmark(bookmark);
        } else if (e.target.closest('.bookmark-menu-btn')) {
          e.stopPropagation();
          this.showBookmarkContextMenu(bookmark, e, true);
        } else if (!e.target.closest('.bookmark-actions')) {
          this.connectFromBookmark(bookmark);
        }
      }
    });

    return item;
  }

  handleBookmarkDragStart(e, bookmark) {
    this.draggedBookmark = bookmark;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'bookmark');
  }

  handleBookmarkDragOver(e, targetFolderId = null) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Highlight drop target
    const target = e.target.closest('.bookmark-item');
    if (target && target.dataset.bookmarkId !== this.draggedBookmark?.id) {
      target.style.borderTop = '2px solid var(--accent-primary)';
    }
    
    // Highlight folder drop zone
    const folderBookmarks = e.target.closest('.folder-bookmarks');
    if (folderBookmarks && this.draggedBookmark) {
      folderBookmarks.style.backgroundColor = 'var(--bg-hover)';
    }
    
    // Highlight root drop zone
    const rootContainer = e.target.closest('.bookmarks-root');
    if (rootContainer && this.draggedBookmark && !e.target.closest('.bookmark-item')) {
      rootContainer.classList.add('drag-over');
    }
  }

  handleBookmarkDrop(e, targetBookmark) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.draggedBookmark || this.draggedBookmark.id === targetBookmark.id) {
      return;
    }

    // Get folder IDs (normalize undefined to null)
    const draggedFolderId = this.draggedBookmark.folderId || null;
    const targetFolderId = targetBookmark.folderId || null;

    console.log('Dragged bookmark:', this.draggedBookmark.name, 'folder:', draggedFolderId);
    console.log('Target bookmark:', targetBookmark.name, 'folder:', targetFolderId);

    // Reorder bookmarks within the same folder
    const sameFolder = draggedFolderId === targetFolderId;
    
    if (sameFolder) {
      // Find indices in the main bookmarks array
      const draggedIndex = this.bookmarks.findIndex(b => b.id === this.draggedBookmark.id);
      const targetIndex = this.bookmarks.findIndex(b => b.id === targetBookmark.id);

      console.log('Same folder reordering. Dragged index:', draggedIndex, 'Target index:', targetIndex);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        // Remove dragged bookmark and insert at target position
        const [removed] = this.bookmarks.splice(draggedIndex, 1);
        this.bookmarks.splice(targetIndex, 0, removed);
        
        console.log('Reordered bookmarks:', this.bookmarks.map(b => b.name));
        
        // Save the new order
        this.saveBookmarkOrder();
        
        // Re-render
        this.renderBookmarks();
      }
    } else {
      // Move to different folder
      console.log('Moving to different folder:', targetFolderId);
      this.moveBookmarkToFolder(this.draggedBookmark.id, targetFolderId);
    }
  }

  handleBookmarkDropToFolder(e, folderId) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.draggedBookmark) {
      return;
    }

    // Move bookmark to folder
    this.moveBookmarkToFolder(this.draggedBookmark.id, folderId);
  }

  handleBookmarkDropToRoot(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!this.draggedBookmark) {
      console.log('No dragged bookmark in drop to root');
      return;
    }

    // Check if we're dropping on a bookmark or on the root container itself
    const targetBookmark = e.target.closest('.bookmark-item');
    if (targetBookmark) {
      // If dropping on a bookmark in root, let the bookmark drop handler deal with it
      console.log('Dropping on bookmark in root, ignoring');
      return;
    }

    console.log('Dropping to root:', this.draggedBookmark.name, 'current folder:', this.draggedBookmark.folderId);
    
    // Move bookmark to root (no folder)
    this.moveBookmarkToFolder(this.draggedBookmark.id, null);
  }

  handleBookmarkDragEnd(e) {
    e.target.style.opacity = '1';
    this.draggedBookmark = null;
    
    // Remove all border styles
    document.querySelectorAll('.bookmark-item').forEach(item => {
      item.style.borderTop = '';
    });
    
    // Remove folder highlight
    document.querySelectorAll('.folder-bookmarks').forEach(container => {
      container.style.backgroundColor = '';
    });
    
    // Remove folder header highlight
    document.querySelectorAll('.folder-header').forEach(header => {
      header.style.backgroundColor = '';
      header.style.border = '';
    });
    
    // Remove root container highlight
    document.querySelectorAll('.bookmarks-root').forEach(container => {
      container.classList.remove('drag-over');
    });
  }

  // Folder drag handlers
  handleFolderDragStart(e, folder) {
    this.draggedFolder = folder;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'folder');
  }

  handleFolderDragOver(e) {
    e.preventDefault();
    
    // Handle folder drag
    if (this.draggedFolder) {
      e.dataTransfer.dropEffect = 'move';
      
      const target = e.target.closest('.folder-header');
      if (target && target.dataset.folderId !== this.draggedFolder?.id) {
        target.style.borderTop = '2px solid var(--accent-primary)';
      }
    } else if (this.draggedBookmark) {
      // Handle bookmark drag - highlight folder as drop target
      e.dataTransfer.dropEffect = 'move';
      
      const target = e.target.closest('.folder-header');
      if (target) {
        target.style.backgroundColor = 'var(--bg-hover)';
        target.style.border = '2px solid var(--accent-primary)';
      }
    }
  }

  handleFolderDrop(e, targetFolder) {
    e.preventDefault();
    e.stopPropagation();
    
    // Handle bookmark drop onto folder header
    if (this.draggedBookmark && !this.draggedFolder) {
      // Move bookmark to this folder
      this.moveBookmarkToFolder(this.draggedBookmark.id, targetFolder.id);
      return;
    }
    
    // Handle folder reorder
    if (!this.draggedFolder || this.draggedFolder.id === targetFolder.id) {
      return;
    }

    // Reorder folders
    const draggedIndex = this.folders.findIndex(f => f.id === this.draggedFolder.id);
    const targetIndex = this.folders.findIndex(f => f.id === targetFolder.id);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Remove dragged folder from array
      const [removed] = this.folders.splice(draggedIndex, 1);
      // Insert at target position
      this.folders.splice(targetIndex, 0, removed);
      
      // Save new order
      this.saveFolderOrder();
      
      // Re-render
      this.renderBookmarks();
    }
  }

  handleFolderDragEnd(e) {
    e.target.style.opacity = '1';
    this.draggedFolder = null;
    
    // Remove all border and background styles
    document.querySelectorAll('.folder-header').forEach(header => {
      header.style.borderTop = '';
      header.style.border = '';
      header.style.backgroundColor = '';
    });
  }

  showBookmarkContextMenu(bookmark, event, fromMenuButton = false) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.bookmark-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'bookmark-context-menu active';
    menu.innerHTML = `
      <div class="bookmark-context-menu-item" data-action="connect">
        <i class="fas fa-plug"></i>
        <span>Connect ${bookmark.type.toUpperCase()}</span>
      </div>
      ${bookmark.type === 'ssh' ? `
        <div class="bookmark-context-menu-item" data-action="sftp">
          <i class="fas fa-folder-open"></i>
          <span>Open SFTP</span>
        </div>
      ` : ''}
      <div class="bookmark-context-menu-divider"></div>
      <div class="bookmark-context-menu-item" data-action="edit">
        <i class="fas fa-edit"></i>
        <span>Edit</span>
      </div>
      <div class="bookmark-context-menu-item" data-action="clone">
        <i class="fas fa-copy"></i>
        <span>Clone</span>
      </div>
      <div class="bookmark-context-menu-item" data-action="delete">
        <i class="fas fa-trash"></i>
        <span>Delete</span>
      </div>
    `;

    // Position the menu
    const isMobile = window.innerWidth <= 768;
    if (isMobile && fromMenuButton) {
      // Center on mobile screen when clicking menu button
      menu.style.left = '50%';
      menu.style.top = '50%';
      menu.style.transform = 'translate(-50%, -50%)';
    } else if (fromMenuButton || this.sidebarCollapsed) {
      // Position at cursor location when from menu button or collapsed sidebar
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
    } else {
      // Position next to bookmark item in expanded sidebar
      const rect = event.target.closest('.bookmark-item').getBoundingClientRect();
      menu.style.left = `${rect.right + 5}px`;
      menu.style.top = `${rect.top}px`;
    }

    // Handle menu item clicks
    menu.querySelectorAll('.bookmark-context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        
        switch (action) {
          case 'connect':
            this.connectFromBookmark(bookmark);
            break;
          case 'sftp':
            this.openSFTPFromBookmark(bookmark);
            break;
          case 'edit':
            this.editBookmark(bookmark);
            break;
          case 'clone':
            this.cloneBookmark(bookmark);
            break;
          case 'delete':
            this.deleteBookmark(bookmark.id);
            break;
        }
        
        menu.remove();
        
        // Close sidebar on mobile after context menu action
        if (isMobile) {
          const sidebar = document.getElementById('sidebar');
          const sidebarOverlay = document.getElementById('sidebarOverlay');
          if (sidebar) sidebar.classList.remove('open');
          if (sidebarOverlay) sidebarOverlay.classList.remove('active');
        }
      });
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    };
    
    // Delay adding the listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu, true); // Use capture phase
    }, 100);
  }

  showFolderContextMenu(folder, bookmarks, event) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.bookmark-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'bookmark-context-menu active folder-context-menu';
    
    // Build menu items from folder bookmarks
    let menuItems = '';
    if (bookmarks.length === 0) {
      menuItems = '<div class="bookmark-context-menu-item disabled"><span>No bookmarks</span></div>';
    } else {
      bookmarks.forEach(bookmark => {
        const icon = bookmark.type === 'ssh' ? 'fa-terminal' : 'fa-folder-open';
        menuItems += `
          <div class="bookmark-context-menu-item" data-bookmark-id="${bookmark.id}">
            <i class="fas ${icon}"></i>
            <span>${this.escapeHtml(bookmark.name)}</span>
          </div>
        `;
      });
    }
    
    menu.innerHTML = `
      <div class="bookmark-context-menu-header">${this.escapeHtml(folder.name)}</div>
      ${menuItems}
    `;

    // Position the menu
    const rect = event.target.closest('.folder-header').getBoundingClientRect();
    menu.style.left = `${rect.right + 5}px`;
    menu.style.top = `${rect.top}px`;

    // Handle menu item clicks - show bookmark context menu instead of connecting directly
    menu.querySelectorAll('.bookmark-context-menu-item[data-bookmark-id]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const bookmarkId = item.dataset.bookmarkId;
        const bookmark = bookmarks.find(b => b.id === bookmarkId);
        if (bookmark) {
          // Remove the folder menu first
          menu.remove();
          // Show the bookmark context menu at cursor position
          this.showBookmarkContextMenu(bookmark, e, true);
        }
      });
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    };
    
    // Delay adding the listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu, true); // Use capture phase
    }, 100);
  }

  showSFTPContextMenu(file, filePath, sessionId, event) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.sftp-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'sftp-context-menu active';
    const isDir = file.type === 'd';
    
    // Check if there's something in the clipboard
    const canPaste = this.sftpClipboard && this.sftpClipboard.sessionId === sessionId;
    
    menu.innerHTML = `
      <div class="sftp-context-menu-item" data-action="rename">
        <i class="fas fa-edit"></i>
        <span>Rename</span>
      </div>
      ${!isDir ? `
        <div class="sftp-context-menu-item" data-action="download">
          <i class="fas fa-download"></i>
          <span>Download</span>
        </div>
      ` : ''}
      <div class="bookmark-context-menu-divider"></div>
      <div class="sftp-context-menu-item" data-action="cut">
        <i class="fas fa-cut"></i>
        <span>Cut</span>
      </div>
      <div class="sftp-context-menu-item" data-action="copy">
        <i class="fas fa-copy"></i>
        <span>Copy</span>
      </div>
      <div class="sftp-context-menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">
        <i class="fas fa-paste"></i>
        <span>Paste</span>
      </div>
      <div class="sftp-context-menu-divider"></div>
      <div class="sftp-context-menu-item danger" data-action="delete">
        <i class="fas fa-trash"></i>
        <span>Delete</span>
      </div>
    `;

    // Position the menu at cursor
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    // Handle menu item clicks
    menu.querySelectorAll('.sftp-context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        
        // Don't do anything if item is disabled
        if (item.classList.contains('disabled')) {
          return;
        }
        
        switch (action) {
          case 'rename':
            this.renameSFTPItem(file.name, filePath, sessionId);
            break;
          case 'download':
            this.downloadSFTPFile(file.name, filePath, sessionId);
            break;
          case 'cut':
            this.cutSFTPItem(file.name, filePath, sessionId);
            break;
          case 'copy':
            this.copySFTPItem(file.name, filePath, sessionId);
            break;
          case 'paste':
            this.pasteSFTPItem(sessionId);
            break;
          case 'delete':
            this.deleteSFTPItem(file.name, filePath, sessionId, isDir);
            break;
        }
        
        menu.remove();
      });
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    };
    
    // Delay adding the listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu, true); // Use capture phase
    }, 100);
  }

  renameSFTPItem(oldName, oldPath, sessionId) {
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;

    const pathParts = oldPath.split('/');
    pathParts.pop();
    const newPath = pathParts.join('/') + '/' + newName;

    this.socket.emit('sftp-rename', {
      sessionId,
      oldPath: oldPath,
      newPath: newPath
    });

    // Listen for result
    this.socket.once('sftp-rename-result', (data) => {
      if (data.success) {
        // Get current path and refresh
        const sftpSession = this.sftpSessions.get(sessionId);
        if (sftpSession) {
          this.navigateSFTPPath(sftpSession.currentPath, sessionId);
        }
      }
    });

    // Listen for errors
    this.socket.once('sftp-error', (data) => {
      alert('Error renaming: ' + data.message);
    });
  }

  showTabContextMenu(sessionId, event) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.tab-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'tab-context-menu active';
    
    menu.innerHTML = `
      <div class="tab-context-menu-item" data-action="rename">
        <i class="fas fa-edit"></i>
        <span>Rename Tab</span>
      </div>
    `;

    // Position the menu at cursor
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    // Handle menu item clicks
    menu.querySelectorAll('.tab-context-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        
        if (action === 'rename') {
          this.startTabRename(sessionId);
        }
        
        menu.remove();
      });
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    };
    
    // Delay adding the listener to prevent immediate close
    setTimeout(() => {
      document.addEventListener('click', closeMenu, true); // Use capture phase
    }, 100);
  }

  startTabRename(sessionId) {
    // Try to find desktop tab first, then mobile tab option
    const tab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    const mobileOption = document.querySelector(`.mobile-tab-option[data-session-id="${sessionId}"]`);
    
    if (!tab && !mobileOption) return;

    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) return;

    const currentName = session.name;
    
    // On mobile, use a prompt dialog for better UX
    if (window.innerWidth <= 768) {
      const newName = prompt('Enter new tab name:', currentName);
      if (newName && newName.trim() && newName.trim() !== currentName) {
        const trimmedName = newName.trim();
        
        // Update session name
        session.name = trimmedName;
        
        // Update mobile tab option display
        if (mobileOption) {
          const nameSpan = mobileOption.querySelector('.tab-name');
          if (nameSpan) {
            nameSpan.textContent = this.escapeHtml(trimmedName);
          }
        }
        
        // Update desktop tab display if it exists
        if (tab) {
          const nameSpan = tab.querySelector('.tab-name');
          if (nameSpan) {
            nameSpan.textContent = this.escapeHtml(trimmedName);
          }
        }
        
        // Emit to server to sync with all sessions
        this.socket.emit('tab-rename', {
          sessionId: sessionId,
          name: trimmedName
        });
        
        // Save tabs if sticky is enabled
        this.saveTabs();
        
        console.log('[SSHIFT] Tab renamed:', sessionId, 'to', trimmedName);
      }
      return;
    }
    
    // Desktop: inline rename
    const nameSpan = tab.querySelector('.tab-name');
    if (!nameSpan) return;
    
    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tab-rename-input';
    input.value = currentName;
    
    // Replace the name span with input
    nameSpan.style.display = 'none';
    nameSpan.parentNode.insertBefore(input, nameSpan);
    
    input.focus();
    input.select();

    const finishRename = () => {
      const newName = input.value.trim();
      
      if (newName && newName !== currentName) {
        // Update session name
        session.name = newName;
        
        // Update tab display
        nameSpan.textContent = this.escapeHtml(newName);
        
        // Emit to server to sync with all sessions
        this.socket.emit('tab-rename', {
          sessionId: sessionId,
          name: newName
        });
        
        // Save tabs if sticky is enabled
        this.saveTabs();
        
        console.log('[SSHIFT] Tab renamed:', sessionId, 'to', newName);
      }
      
      // Remove input and show name span
      input.remove();
      nameSpan.style.display = '';
    };

    // Handle input events
    input.addEventListener('blur', finishRename);
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        input.value = currentName; // Reset to original name
        input.blur();
      }
    });
  }

  downloadSFTPFile(fileName, filePath, sessionId) {
    this.socket.emit('sftp-download', {
      sessionId,
      path: filePath
    });
  }

  deleteSFTPItem(fileName, filePath, sessionId, isDir) {
    const confirmMsg = isDir 
      ? `Are you sure you want to delete the directory "${fileName}"?\n\nNote: Directory must be empty.`
      : `Are you sure you want to delete "${fileName}"?`;
    
    if (!confirm(confirmMsg)) return;

    this.socket.emit('sftp-delete', {
      sessionId,
      path: filePath
    });

    // Listen for result
    this.socket.once('sftp-delete-result', (data) => {
      if (data.success) {
        // Get current path and refresh
        const sftpSession = this.sftpSessions.get(sessionId);
        if (sftpSession) {
          this.navigateSFTPPath(sftpSession.currentPath, sessionId);
        }
      }
    });

    // Listen for errors
    this.socket.once('sftp-error', (data) => {
      alert('Error deleting: ' + data.message);
    });
  }

  cutSFTPItem(fileName, filePath, sessionId) {
    // Store in clipboard with cut action
    this.sftpClipboard = {
      action: 'cut',
      path: filePath,
      name: fileName,
      sessionId: sessionId
    };
    this.showToast(`Cut ${fileName}`, 'success');
  }

  copySFTPItem(fileName, filePath, sessionId) {
    // Store in clipboard with copy action
    this.sftpClipboard = {
      action: 'copy',
      path: filePath,
      name: fileName,
      sessionId: sessionId
    };
    this.showToast(`Copied ${fileName}`, 'success');
  }

  pasteSFTPItem(sessionId) {
    if (!this.sftpClipboard) {
      this.showToast('Nothing to paste', 'error');
      return;
    }

    // Can only paste within the same session
    if (this.sftpClipboard.sessionId !== sessionId) {
      this.showToast('Cannot paste across different sessions', 'error');
      return;
    }

    const sftpSession = this.sftpSessions.get(sessionId);
    if (!sftpSession) {
      this.showToast('Session not found', 'error');
      return;
    }

    const currentPath = sftpSession.currentPath;
    const sourcePath = this.sftpClipboard.path;
    const sourceName = this.sftpClipboard.name;
    const destPath = currentPath === '/' ? `/${sourceName}` : `${currentPath}/${sourceName}`;

    // Check if source and destination are the same
    if (sourcePath === destPath) {
      this.showToast('Source and destination are the same', 'error');
      return;
    }

    if (this.sftpClipboard.action === 'cut') {
      // Move (rename) the file
      this.socket.emit('sftp-rename', {
        sessionId,
        oldPath: sourcePath,
        newPath: destPath
      });

      this.socket.once('sftp-rename-result', (data) => {
        if (data.success) {
          this.showToast(`Moved ${sourceName}`, 'success');
          this.navigateSFTPPath(currentPath, sessionId);
          // Clear clipboard after successful cut
          this.sftpClipboard = null;
        }
      });

      this.socket.once('sftp-error', (data) => {
        this.showToast('Error moving: ' + data.message, 'error');
      });
    } else {
      // Copy operation - need to download and re-upload
      this.showToast('Copy operation requires download/re-upload. Use download button instead.', 'info');
    }
  }

  openBookmarkModal(bookmark = null, folderId = null) {
    document.getElementById('bookmarkForm').reset();
    
    // Populate folder dropdown
    const folderSelect = document.getElementById('bookmarkFolder');
    folderSelect.innerHTML = '<option value="">No Folder</option>';
    this.folders.forEach(folder => {
      const option = document.createElement('option');
      option.value = folder.id;
      option.textContent = folder.name;
      folderSelect.appendChild(option);
    });
    
    if (bookmark) {
      document.getElementById('bookmarkModalTitle').textContent = 'Edit Bookmark';
      document.getElementById('bookmarkId').value = bookmark.id;
      document.getElementById('bookmarkName').value = bookmark.name;
      document.getElementById('bookmarkHost').value = bookmark.host;
      document.getElementById('bookmarkPort').value = bookmark.port;
      document.getElementById('bookmarkUsername').value = bookmark.username;
      document.getElementById('bookmarkPassword').value = bookmark.password || '';
      document.getElementById('bookmarkPrivateKey').value = bookmark.privateKey || '';
      document.getElementById('bookmarkPassphrase').value = bookmark.passphrase || '';
      document.getElementById('bookmarkType').value = bookmark.type;
      document.getElementById('bookmarkFolder').value = bookmark.folderId || '';
    } else {
      document.getElementById('bookmarkModalTitle').textContent = 'Add Bookmark';
      document.getElementById('bookmarkId').value = '';
      document.getElementById('bookmarkPort').value = '22';
      document.getElementById('bookmarkFolder').value = folderId || '';
    }

    this.openModal('bookmarkModal');
  }

  async saveBookmark() {
    const id = document.getElementById('bookmarkId').value;
    const name = document.getElementById('bookmarkName').value.trim();
    const host = document.getElementById('bookmarkHost').value.trim();
    const port = parseInt(document.getElementById('bookmarkPort').value) || 22;
    const username = document.getElementById('bookmarkUsername').value.trim();
    const password = document.getElementById('bookmarkPassword').value;
    const privateKey = document.getElementById('bookmarkPrivateKey').value.trim();
    const passphrase = document.getElementById('bookmarkPassphrase').value;
    const type = document.getElementById('bookmarkType').value;
    const folderId = document.getElementById('bookmarkFolder').value || null;

    if (!name || !host || !username) {
      this.showToast('Name, host, and username are required', 'error');
      return;
    }

    const bookmark = { name, host, port, username, type };
    // Only include password/key if provided (don't store empty strings)
    if (password) bookmark.password = password;
    if (privateKey) bookmark.privateKey = privateKey;
    if (passphrase) bookmark.passphrase = passphrase;
    if (folderId) bookmark.folderId = folderId;

    try {
      let response;
      if (id) {
        response = await fetch(`/api/bookmarks/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookmark)
        });
      } else {
        response = await fetch('/api/bookmarks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bookmark)
        });
      }

      if (response.ok) {
        this.showToast(id ? 'Bookmark updated' : 'Bookmark added', 'success');
        this.loadBookmarks();
        this.closeModal('bookmarkModal');
      } else {
        throw new Error('Failed to save bookmark');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  editBookmark(bookmark) {
    this.openBookmarkModal(bookmark);
  }

  async deleteBookmark(id) {
    if (!confirm('Delete this bookmark?')) return;

    try {
      const response = await fetch(`/api/bookmarks/${id}`, { method: 'DELETE' });
      if (response.ok) {
        this.showToast('Bookmark deleted', 'success');
        this.loadBookmarks();
      } else {
        throw new Error('Failed to delete bookmark');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  async cloneBookmark(bookmark) {
    // Create a copy of the bookmark with "(Copy)" suffix
    const clonedBookmark = {
      name: `${bookmark.name} (Copy)`,
      host: bookmark.host,
      port: bookmark.port,
      username: bookmark.username,
      type: bookmark.type,
      folderId: bookmark.folderId || null
    };

    // Include credentials if they exist
    if (bookmark.password) clonedBookmark.password = bookmark.password;
    if (bookmark.privateKey) clonedBookmark.privateKey = bookmark.privateKey;
    if (bookmark.passphrase) clonedBookmark.passphrase = bookmark.passphrase;

    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clonedBookmark)
      });

      if (response.ok) {
        this.showToast('Bookmark cloned', 'success');
        this.loadBookmarks();
      } else {
        throw new Error('Failed to clone bookmark');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
    }
  }

  connectFromBookmark(bookmark) {
    // Close sidebar on mobile when connecting
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      if (sidebar) sidebar.classList.remove('open');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
    
    // Connect directly using bookmark credentials
    const connectionData = {
      name: bookmark.name,
      host: bookmark.host,
      port: bookmark.port,
      username: bookmark.username,
      password: bookmark.password || '',
      privateKey: bookmark.privateKey || '',
      passphrase: bookmark.passphrase || ''
    };

    // Show connecting status
    this.showToast(`Connecting to ${bookmark.name}...`, 'info');

    if (bookmark.type === 'ssh') {
      console.log('[SSHIFT] Creating SSH tab from bookmark...');
      this.createSSHTab(bookmark.name, connectionData);
    } else if (bookmark.type === 'sftp') {
      console.log('[SSHIFT] Creating SFTP tab from bookmark...');
      this.createSFTPTab(bookmark.name, connectionData);
    }
  }

  openSFTPFromBookmark(bookmark) {
    // Close sidebar on mobile when opening SFTP
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      if (sidebar) sidebar.classList.remove('open');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
    
    // Open SFTP connection using SSH bookmark credentials
    const connectionData = {
      name: `${bookmark.name} (SFTP)`,
      host: bookmark.host,
      port: bookmark.port,
      username: bookmark.username,
      password: bookmark.password || '',
      privateKey: bookmark.privateKey || '',
      passphrase: bookmark.passphrase || ''
    };

    // Show connecting status
    this.showToast(`Opening SFTP for ${bookmark.name}...`, 'info');

    console.log('[SSHIFT] Creating SFTP tab from SSH bookmark...');
    this.createSFTPTab(`${bookmark.name} (SFTP)`, connectionData);
  }

  // Folder Management Methods
  async loadFolders() {
    try {
      const response = await fetch('/api/folders');
      let folders = await response.json();
      
      // Apply saved order if exists
      const savedOrder = await this.loadFolderOrder();
      if (savedOrder && savedOrder.length > 0) {
        const orderMap = new Map(savedOrder.map((id, index) => [id, index]));
        folders.sort((a, b) => {
          const orderA = orderMap.get(a.id) ?? Infinity;
          const orderB = orderMap.get(b.id) ?? Infinity;
          return orderA - orderB;
        });
      }
      
      this.folders = folders;
    } catch (err) {
      console.error('Failed to load folders:', err);
      this.folders = [];
    }
  }

  async loadFolderOrder() {
    try {
      const response = await fetch('/api/folders/order');
      if (response.ok) {
        const order = await response.json();
        if (order && order.length > 0) {
          return order;
        }
      }
    } catch (err) {
      console.error('Failed to load folder order from server:', err);
    }
    // Fall back to localStorage
    const saved = localStorage.getItem('folderOrder');
    return saved ? JSON.parse(saved) : null;
  }

  async saveFolderOrder() {
    const order = this.folders.map(f => f.id);
    
    // Save to server
    try {
      await fetch('/api/folders/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
    } catch (err) {
      console.error('Failed to save folder order to server:', err);
    }
    
    // Also save to localStorage as backup
    localStorage.setItem('folderOrder', JSON.stringify(order));
  }

  loadFolderExpandedStates() {
    const saved = localStorage.getItem('folderExpandedStates');
    return saved ? JSON.parse(saved) : {};
  }

  saveFolderExpandedStates() {
    const states = {};
    this.folders.forEach(folder => {
      states[folder.id] = folder.expanded;
    });
    localStorage.setItem('folderExpandedStates', JSON.stringify(states));
  }

  async createFolder(name, icon = 'folder') {
    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon })
      });

      if (response.ok) {
        const folder = await response.json();
        this.showToast('Folder created', 'success');
        await this.loadFolders();
        this.renderBookmarks();
        return folder;
      } else {
        throw new Error('Failed to create folder');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
      return null;
    }
  }

  async updateFolder(id, updates) {
    try {
      const response = await fetch(`/api/folders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      if (response.ok) {
        this.showToast('Folder updated', 'success');
        await this.loadFolders();
        this.renderBookmarks();
        return true;
      } else {
        throw new Error('Failed to update folder');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
      return false;
    }
  }

  async deleteFolder(id) {
    if (!confirm('Delete this folder? Bookmarks will be moved to root.')) return false;

    try {
      const response = await fetch(`/api/folders/${id}`, { method: 'DELETE' });
      if (response.ok) {
        this.showToast('Folder deleted', 'success');
        await this.loadFolders();
        await this.loadBookmarks();
        return true;
      } else {
        throw new Error('Failed to delete folder');
      }
    } catch (err) {
      this.showToast(err.message, 'error');
      return false;
    }
  }

  async moveBookmarkToFolder(bookmarkId, folderId) {
    try {
      console.log('Moving bookmark', bookmarkId, 'to folder', folderId);
      const response = await fetch(`/api/bookmarks/${bookmarkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: folderId || null })
      });

      if (response.ok) {
        console.log('Successfully moved bookmark to folder', folderId);
        await this.loadBookmarks();
        return true;
      } else {
        throw new Error('Failed to move bookmark');
      }
    } catch (err) {
      console.error('Error moving bookmark:', err);
      this.showToast(err.message, 'error');
      return false;
    }
  }

  toggleFolderExpand(folderId) {
    const folder = this.folders.find(f => f.id === folderId);
    if (folder) {
      folder.expanded = !folder.expanded;
      this.saveFolderExpandedStates();
      this.renderBookmarks();
    }
  }

  openFolderModal(folder = null) {
    document.getElementById('folderForm').reset();
    
    // Reset icon selector to default
    document.querySelectorAll('.icon-option').forEach(opt => {
      opt.classList.remove('selected');
    });
    
    if (folder) {
      document.getElementById('folderModalTitle').textContent = 'Edit Folder';
      document.getElementById('folderId').value = folder.id;
      document.getElementById('folderName').value = folder.name;
      const iconValue = folder.icon || 'folder';
      document.getElementById('folderIcon').value = iconValue;
      // Select the correct icon in the selector
      const iconOption = document.querySelector(`.icon-option[data-icon="${iconValue}"]`);
      if (iconOption) {
        iconOption.classList.add('selected');
      }
    } else {
      document.getElementById('folderModalTitle').textContent = 'Add Folder';
      document.getElementById('folderId').value = '';
      // Select default folder icon
      document.querySelector('.icon-option[data-icon="folder"]').classList.add('selected');
    }

    this.openModal('folderModal');
  }

  async saveFolder() {
    const id = document.getElementById('folderId').value;
    const name = document.getElementById('folderName').value.trim();
    const icon = document.getElementById('folderIcon').value || 'folder';

    if (!name) {
      this.showToast('Folder name is required', 'error');
      return;
    }

    if (id) {
      await this.updateFolder(id, { name, icon });
    } else {
      await this.createFolder(name, icon);
    }

    this.closeModal('folderModal');
  }

  // Resize Handler
  handleResize() {
    this.sessions.forEach((session) => {
      if (session.terminal && session.fitAddon) {
        session.fitAddon.fit();
      }
    });
  }

  // Toast Notifications
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
      success: 'check-circle',
      error: 'exclamation-circle',
      warning: 'exclamation-triangle',
      info: 'info-circle'
    };

    toast.innerHTML = `
      <i class="fas fa-${icons[type] || icons.info} toast-icon"></i>
      <span class="toast-message">${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Utility Functions
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SSHIFTClient();
});