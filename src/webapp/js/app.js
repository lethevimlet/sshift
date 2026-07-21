// SSHIFT Client Application
class SSHIFTClient {
  constructor() {
    console.log('[SSHIFT] Initializing client...');
    try {
      const authToken = localStorage.getItem('sshift_auth_token');
      this.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        auth: authToken ? { token: authToken } : {}
      });
      console.log('[SSHIFT] Socket created');
    } catch (e) {
      console.error('[SSHIFT] Failed to create socket:', e);
    }
    this.sessions = new Map();
    this.activeSessionId = null; // Global active session (for backwards compatibility)
    this.activeSessionsByPanel = new Map(); // Per-panel active sessions: Map<panelId, sessionId>
    this._wasDisconnected = false; // Track reconnection state for toast messages
    this._initReady = false; // Set true once init() completes
    this._pendingOpenTabs = null; // Deferred open-tabs data
    this._pendingOpenTabsIsInitial = false;
    this._suppressTabSwitch = false; // Suppress switchTab during sync
    this.bookmarks = [];
    this.folders = [];
    this.currentConnectionType = 'ssh';
    this.sidebarCollapsed = this.loadSidebarState();
    this.sftpSessions = new Map(); // Track SFTP sessions separately
    this.draggedTab = null;
    this.draggedBookmark = null;
    this.draggedFolder = null;
    this.sticky = true; // Default to true - combines stickyTabs and stickySessions
    this.takeControlDefault = true; // Default to true - automatically take control when joining sessions
    this.savedTabs = []; // Store tab information
    this.isRestoring = false; // Flag to prevent saving during restoration
    this.isSyncingTabs = false; // Flag to prevent saveTabs emission during tabs-sync
    this._serverPanelMap = new Map(); // sessionId -> panelId from server (preserved for mobile)
    this._serverLayout = null; // Layout from server (preserved for mobile saves)
    this._initialSyncDone = false; // Whether initial open-tabs sync from server has completed
    this._serverSyncTimeout = null; // Timeout for fallback to localStorage restore
    // saveTabs dedup/debounce state — prevents redundant localStorage writes
    // and tabs-save broadcasts when called rapidly (e.g. on every tab move,
    // rename, switch, distribute) with the same payload.
    this._saveTabsTimer = null;
    this._saveTabsSignature = null;
    this.sftpClipboard = null; // For cut/copy/paste: { action: 'cut'|'copy', path: string, name: string, sessionId: string }
    this.terminalClipboardContent = null; // Pre-read clipboard content for context menu paste
    this.osc52Buffer = null; // Buffered OSC 52 clipboard content pending write
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
    this.webglRenderer = true; // Default to enabled
    this.imageAddonEnabled = true; // Default to enabled
    this.ctrlPressed = false; // Track Ctrl key state
    this.altPressed = false; // Track Alt key state
    this.currentKeyboardHeight = 0; // Track actual keyboard height for positioning
    
    // Password protection state
    this.passwordEnabled = false;
    this.authToken = localStorage.getItem('sshift_auth_token') || null;
    
    this._origFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      if (typeof url === 'string' && url.startsWith('/api/') && this.authToken) {
        if (!options.headers) options.headers = {};
        if (!(options.headers instanceof Headers)) {
          options.headers = { ...options.headers };
        }
        if (typeof options.headers === 'object' && !options.headers['Authorization']) {
          options.headers['Authorization'] = `Bearer ${this.authToken}`;
        }
      }
      return this._origFetch(url, options);
    };
    
    // Terminal font size (for pinch-to-zoom on mobile)
    this.terminalFontSize = window.innerWidth <= 768 ? 11 : 14;
    this.minFontSize = 8; // Minimum font size
    this.maxFontSize = 32; // Maximum font size
    
    // Layout system
    this.layouts = null; // Will be loaded from config/layouts.json
    this.currentLayout = null; // Current active layout
    this.pendingLayoutSync = null; // Queue for layout sync before layouts are loaded
    
    console.log('[SSHIFT] Mobile detection - isMobile:', this.isMobile, 'window width:', window.innerWidth);
    
    this.init();
  }

  async loadStickyConfig() {
    // First, try to load from localStorage (user's last saved preference)
    const localSticky = localStorage.getItem('sticky');
    const localTakeControl = localStorage.getItem('takeControlDefault');
    const localKeepaliveInterval = localStorage.getItem('sshKeepaliveInterval');
    const localKeepaliveCountMax = localStorage.getItem('sshKeepaliveCountMax');
    const localMobileKeysBar = localStorage.getItem('mobileKeysBarEnabled');
    const localWebglRenderer = localStorage.getItem('webglRenderer');
    const localImageAddonEnabled = localStorage.getItem('imageAddonEnabled');
    const localScrollback = localStorage.getItem('scrollback');
    
    // If we have localStorage values, use them
    if (localSticky !== null) {
      this.sticky = JSON.parse(localSticky);
      this.takeControlDefault = localTakeControl !== null ? JSON.parse(localTakeControl) : true;
      this.sshKeepaliveInterval = localKeepaliveInterval !== null ? parseInt(localKeepaliveInterval) : 10000;
      this.sshKeepaliveCountMax = localKeepaliveCountMax !== null ? parseInt(localKeepaliveCountMax) : 1000;
      this.mobileKeysBarEnabled = localMobileKeysBar !== null ? JSON.parse(localMobileKeysBar) : true;
      this.webglRenderer = localWebglRenderer !== null ? JSON.parse(localWebglRenderer) : true;
      this.imageAddonEnabled = localImageAddonEnabled !== null ? JSON.parse(localImageAddonEnabled) : true;
      this.scrollback = localScrollback !== null ? parseInt(localScrollback) : 10000;
      console.log('[SSHIFT] Loaded from localStorage - Sticky:', this.sticky ? 'enabled' : 'disabled',
                  'Take Control Default:', this.takeControlDefault ? 'enabled' : 'disabled',
                  'Keepalive Interval:', this.sshKeepaliveInterval,
                  'Keepalive Count Max:', this.sshKeepaliveCountMax,
                  'Mobile Keys Bar:', this.mobileKeysBarEnabled ? 'enabled' : 'disabled',
                  'WebGL Renderer:', this.webglRenderer ? 'enabled' : 'disabled',
                  'Image Addon:', this.imageAddonEnabled ? 'enabled' : 'disabled',
                  'Scrollback:', this.scrollback);
      return;
    }
    
    // Otherwise, load from server config
    try {
      const response = await fetch('/api/config');
      const config = await response.json();
      // Load sticky from config
      this.sticky = config.sticky !== undefined ? config.sticky : true;
      // Load takeControlDefault from config
      this.takeControlDefault = config.takeControlDefault !== undefined ? config.takeControlDefault : true;
      // Load SSH keepalive settings from config
      this.sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      this.sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      // Load mobile keys bar setting
      this.mobileKeysBarEnabled = config.mobileKeysBarEnabled !== undefined ? config.mobileKeysBarEnabled : true;
      this.webglRenderer = config.webglRenderer !== undefined ? config.webglRenderer : true;
      this.imageAddonEnabled = config.imageAddonEnabled !== undefined ? config.imageAddonEnabled : true;
      this.scrollback = config.scrollback || 10000;
      this.passwordEnabled = config.passwordEnabled || false;
      console.log('[SSHIFT] Loaded from server - Sticky:', this.sticky ? 'enabled' : 'disabled',
                  'Take Control Default:', this.takeControlDefault ? 'enabled' : 'disabled',
                  'Keepalive Interval:', this.sshKeepaliveInterval,
                  'Keepalive Count Max:', this.sshKeepaliveCountMax,
                  'Mobile Keys Bar:', this.mobileKeysBarEnabled ? 'enabled' : 'disabled',
                  'WebGL Renderer:', this.webglRenderer ? 'enabled' : 'disabled',
                  'Image Addon:', this.imageAddonEnabled ? 'enabled' : 'disabled',
                  'Scrollback:', this.scrollback);
    } catch (err) {
      console.error('[SSHIFT] Failed to load config:', err);
      this.sticky = true; // Default to true
      this.takeControlDefault = true; // Default to true
      this.sshKeepaliveInterval = 10000;
      this.sshKeepaliveCountMax = 1000;
      this.mobileKeysBarEnabled = true; // Default to true
      this.webglRenderer = true; // Default to true
      this.imageAddonEnabled = true; // Default to true
      this.scrollback = 10000;
    }
  }

  async checkAuthStatus() {
    const lockScreen = document.getElementById('lockScreen');
    const lockScreenForm = document.getElementById('lockScreenForm');
    const lockScreenSubtitle = document.getElementById('lockScreenSubtitle');
    
    try {
      const response = await this._origFetch('/api/auth/status');
      const data = await response.json();
      this.passwordEnabled = data.passwordEnabled;
      
      if (!this.passwordEnabled) {
        if (lockScreen) lockScreen.style.display = 'none';
        return;
      }
      
      const storedToken = localStorage.getItem('sshift_auth_token');
      if (storedToken) {
        try {
          const verifyResp = await this._origFetch('/api/config', {
            headers: { 'Authorization': `Bearer ${storedToken}` }
          });
          if (verifyResp.ok) {
            this.authToken = storedToken;
            this.updateSocketAuth();
            if (lockScreen) lockScreen.style.display = 'none';
            return;
          }
        } catch (e) {}
        localStorage.removeItem('sshift_auth_token');
        this.authToken = null;
      }
      
      await this.showLockScreen();
    } catch (err) {
      console.error('[SSHIFT] Failed to check auth status:', err);
      if (lockScreen) lockScreen.style.display = 'none';
    }
  }

  showLockScreen() {
    return new Promise((resolve) => {
      const lockScreen = document.getElementById('lockScreen');
      const lockScreenForm = document.getElementById('lockScreenForm');
      const lockScreenPassword = document.getElementById('lockScreenPassword');
      const lockScreenError = document.getElementById('lockScreenError');
      const lockScreenSubtitle = document.getElementById('lockScreenSubtitle');
      const lockScreenIcon = lockScreen ? lockScreen.querySelector('.lock-screen-icon i') : null;
      
      if (lockScreen) lockScreen.style.display = 'flex';
      if (lockScreenIcon) lockScreenIcon.className = 'fas fa-lock';
      if (lockScreenSubtitle) lockScreenSubtitle.textContent = 'Password Required';
      if (lockScreenForm) lockScreenForm.style.display = 'flex';
      if (lockScreenError) lockScreenError.style.display = 'none';
      if (lockScreenPassword) {
        lockScreenPassword.value = '';
        lockScreenPassword.focus();
      }
      
      const submitHandler = async (e) => {
        e.preventDefault();
        const password = lockScreenPassword.value;
        if (!password) return;
        
        lockScreenError.style.display = 'none';
        try {
          const resp = await this._origFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
          });
          
          if (resp.ok) {
            const data = await resp.json();
            this.authToken = data.token;
            localStorage.setItem('sshift_auth_token', data.token);
            this.updateSocketAuth();
            lockScreen.style.display = 'none';
            this.passwordEnabled = true;
            lockScreenForm.removeEventListener('submit', submitHandler);
            resolve();
          } else {
            const data = await resp.json();
            lockScreenError.textContent = data.error || 'Invalid password';
            lockScreenError.style.display = 'block';
            lockScreenPassword.value = '';
            lockScreenPassword.focus();
          }
        } catch (err) {
          lockScreenError.textContent = 'Connection error';
          lockScreenError.style.display = 'block';
        }
      };
      
      lockScreenForm.addEventListener('submit', submitHandler);
    });
  }

  updateSocketAuth() {
    if (this.socket && this.authToken) {
      this.socket.auth = { token: this.authToken };
      this.socket.disconnect().connect();
    }
  }

  async togglePasswordProtection() {
    if (this.passwordEnabled) {
      this._showPasswordModal({
        title: 'Disable Password Protection',
        label: 'Enter current password',
        confirmText: 'Disable',
        requireConfirm: false
      }, async (password) => {
        try {
          const resp = await fetch('/api/auth/remove-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': this.authToken ? `Bearer ${this.authToken}` : '' },
            body: JSON.stringify({ currentPassword: password })
          });
          
          if (resp.ok) {
            localStorage.removeItem('sshift_auth_token');
            location.reload();
          } else {
            const data = await resp.json();
            this.showToast(data.error || 'Failed to disable password', 'error');
          }
        } catch (err) {
          this.showToast('Failed to disable password', 'error');
        }
      });
    } else {
      this._showPasswordModal({
        title: 'Enable Password Protection',
        label: 'Set a password',
        confirmText: 'Enable',
        requireConfirm: true
      }, async (password) => {
        try {
          const resp = await fetch('/api/auth/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword: password })
          });
          
          if (resp.ok) {
            location.reload();
          } else {
            const data = await resp.json();
            this.showToast(data.error || 'Failed to enable password', 'error');
          }
        } catch (err) {
          this.showToast('Failed to enable password', 'error');
        }
      });
    }
  }

  _showPasswordModal(options, onSubmit, onCancel) {
    const modal = document.getElementById('passwordModal');
    const title = document.getElementById('passwordModalTitle');
    const label = document.getElementById('passwordModalLabel');
    const input = document.getElementById('passwordModalInput');
    const confirmInput = document.getElementById('passwordModalConfirmInput');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const errorEl = document.getElementById('passwordModalError');
    const submitBtn = document.getElementById('passwordModalSubmit');
    const cancelBtn = document.getElementById('passwordModalCancel');
    const closeBtn = document.getElementById('closePasswordModal');

    title.innerHTML = `<i class="fas fa-lock"></i> ${options.title}`;
    label.textContent = options.label;
    submitBtn.innerHTML = `<i class="fas fa-check"></i> ${options.confirmText}`;
    input.value = '';
    confirmInput.value = '';
    errorEl.style.display = 'none';

    if (options.requireConfirm) {
      confirmGroup.style.display = 'block';
    } else {
      confirmGroup.style.display = 'none';
    }

    const cleanup = () => {
      this.closeModal('passwordModal');
      submitBtn.removeEventListener('click', handleSubmit);
      cancelBtn.removeEventListener('click', handleCancel);
      closeBtn.removeEventListener('click', handleCancel);
      modal.removeEventListener('click', handleBackdrop);
      input.removeEventListener('keydown', handleKeydown);
    };

    const handleSubmit = async () => {
      const password = input.value;
      if (!password) {
        errorEl.textContent = 'Password cannot be empty';
        errorEl.style.display = 'block';
        return;
      }
      if (options.requireConfirm && password !== confirmInput.value) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
      }
      cleanup();
      await onSubmit(password);
    };

    const handleCancel = () => { cleanup(); if (onCancel) onCancel(); };
    const handleBackdrop = (e) => { if (e.target === modal) { cleanup(); if (onCancel) onCancel(); } };
    const handleKeydown = (e) => { if (e.key === 'Enter') handleSubmit(); };

    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdrop);
    input.addEventListener('keydown', handleKeydown);

    this.openModal('passwordModal');
    setTimeout(() => input.focus(), 100);
  }

  updatePasswordToggleUI() {
    const btn = document.getElementById('togglePasswordBtn');
    const label = document.getElementById('togglePasswordLabel');
    if (btn && label) {
      if (this.passwordEnabled) {
        btn.querySelector('i').className = 'fas fa-lock';
        label.textContent = 'Disable Password';
      } else {
        btn.querySelector('i').className = 'fas fa-lock-open';
        label.textContent = 'Enable Password';
      }
    }
  }

  // Update sticky checkbox to reflect loaded value
  updateStickyCheckbox() {
    const stickyToggle = document.getElementById('stickyToggle');
    if (stickyToggle) {
      stickyToggle.checked = this.sticky;
      console.log('[SSHIFT] Updated sticky checkbox to:', this.sticky);
    }
    
    const takeControlToggle = document.getElementById('takeControlDefaultToggle');
    if (takeControlToggle) {
      takeControlToggle.checked = this.takeControlDefault;
    }
    
    const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
    if (keepaliveIntervalInput && this.sshKeepaliveInterval) {
      keepaliveIntervalInput.value = this.sshKeepaliveInterval;
    }
    
    const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
    if (keepaliveCountMaxInput && this.sshKeepaliveCountMax) {
      keepaliveCountMaxInput.value = this.sshKeepaliveCountMax;
    }
    
    const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
    if (mobileKeysBarToggle) {
      mobileKeysBarToggle.checked = this.mobileKeysBarEnabled;
    }
    
    const webglRendererToggle = document.getElementById('webglRendererToggle');
    if (webglRendererToggle) {
      webglRendererToggle.checked = this.webglRenderer;
    }
    
    const imageAddonToggle = document.getElementById('imageAddonToggle');
    if (imageAddonToggle) {
      imageAddonToggle.checked = this.imageAddonEnabled;
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

    // Get tabs from all panels
    const panels = this.getAllPanels();

    panels.forEach(panelId => {
      const tabsContainer = this.getTabsContainer(panelId);
      if (!tabsContainer) return;

      const tabElements = Array.from(tabsContainer.children);
      const activeInThisPanel = this.activeSessionsByPanel.get(panelId);

      tabElements.forEach(tabElement => {
        const sessionId = tabElement.dataset.sessionId;
        const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);

        if (session) {
          // On mobile (single panel), preserve the server-assigned panel instead of panel-0
          const effectivePanelId = this.isMobile
            ? (this._serverPanelMap.get(sessionId) || panelId)
            : panelId;
          // Keep server panel map in sync with desktop reality
          this._serverPanelMap.set(sessionId, effectivePanelId);
          tabs.push({
            sessionId,
            name: session.name,
            type: session.type,
            connectionData: session.connectionData,
            active: sessionId === activeInThisPanel, // Active in this specific panel
            panelId: effectivePanelId
          });
        }
      });
    });

    // Save tabs with current layout (mobile saves server layout, not 'single')
    const savedLayout = this.isMobile
      ? (this._serverLayout || 'single')
      : (this.currentLayout?.id || 'single');
    const tabsData = {
      tabs,
      layout: savedLayout
    };

    // Debounce + dedup: collapse rapid-fire saveTabs calls into one
    // tabs-save broadcast. Many call sites (switchTab, distributeTabs,
    // drag-end, handleTabClosed, createSSHTab/SFTPTab, distribution)
    // fire saveTabs in tight succession with identical payloads; that
    // amplified duplicates across clients and spammed the server.
    const signature = JSON.stringify(tabsData);
    if (this._saveTabsTimer) clearTimeout(this._saveTabsTimer);
    this._saveTabsTimer = setTimeout(() => {
      this._saveTabsTimer = null;
      // Only persist + broadcast if payload actually changed since the
      // last write (signature dedup suppresses no-op re-exports).
      if (this._saveTabsSignature === signature) return;
      this._saveTabsSignature = signature;

      localStorage.setItem('openTabs', signature);
      console.log('[SSHIFT] Saved tabs:', tabs.length, 'layout:', tabsData.layout);

      // Sync to server for cross-tab sync
      // Don't emit if we're currently syncing from another client to prevent loops
      if (this.socket && this.socket.connected && !this.isSyncingTabs) {
        this.socket.emit('tabs-save', tabsData);
      }
    }, 150);
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

  // Get all panel IDs in current layout
  getAllPanels() {
    const layoutContainer = document.getElementById('layoutContainer');
    if (!layoutContainer) return ['panel-0'];
    
    const panels = layoutContainer.querySelectorAll('.layout-panel');
    if (panels.length === 0) return ['panel-0'];
    
    return Array.from(panels).map(p => p.id);
  }

  getClockwisePanels() {
    const panels = this.getAllPanels();
    if (panels.length <= 1) return panels;
    
    // Parse panel IDs: 'panel-0' (single) or 'panel-{col}-{row}' (multi)
    const parsed = panels.map(id => {
      const parts = id.replace('panel-', '').split('-');
      if (parts.length === 1) return { id, col: 0, row: 0 };
      return { id, col: parseInt(parts[0]), row: parseInt(parts[1]) };
    });
    
    // Group panels by row
    const rows = {};
    parsed.forEach(p => {
      if (!rows[p.row]) rows[p.row] = [];
      rows[p.row].push(p);
    });
    
    // Sort rows numerically
    const sortedRowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
    
    // Clockwise from top-left: row 0 left→right, row 1 right→left (snake/boustrophedon)
    // This gives: top-left, top-right, bottom-right, bottom-left for a 2x2 grid
    const result = [];
    sortedRowKeys.forEach((rowKey, rowIndex) => {
      const rowPanels = rows[rowKey].sort((a, b) => a.col - b.col);
      if (rowIndex % 2 === 0) {
        // Even rows: left to right
        result.push(...rowPanels);
      } else {
        // Odd rows: right to left
        result.push(...rowPanels.reverse());
      }
    });
    
    return result.map(p => p.id);
  }

  // Get tabs container for a panel
  getTabsContainer(panelId) {
    // For single panel (panel-0), use original IDs without prefix
    if (panelId === 'panel-0' || panelId === '0') {
      return document.getElementById('tabs');
    }
    // For multi-panel layouts, use prefixed IDs
    return document.getElementById(`${panelId}-tabs`);
  }

  // Get terminals container for a panel
  getTerminalsContainer(panelId) {
    // For single panel (panel-0), use original IDs without prefix
    if (panelId === 'panel-0' || panelId === '0') {
      return document.getElementById('terminalsContainer');
    }
    // For multi-panel layouts, use prefixed IDs
    return document.getElementById(`${panelId}-terminalsContainer`);
  }

  // Get panel ID for a session (find which panel contains the session)
  getPanelForSession(sessionId) {
    const panels = this.getAllPanels();
    for (const panelId of panels) {
      const tabsContainer = this.getTabsContainer(panelId);
      if (tabsContainer) {
        const tab = tabsContainer.querySelector(`[data-session-id="${sessionId}"]`);
        if (tab) return panelId;
      }
    }
    return 'panel-0'; // Default to first panel
  }

  // Distribute tabs across panels when layout changes
  distributeTabsToPanels(syncedTabs = null) {
    // Get all sessions
    const allSessions = [...this.sessions.keys(), ...this.sftpSessions.keys()];
    if (allSessions.length === 0) return;
    
    const panels = this.getAllPanels();
    const panelCount = panels.length;
    const clockwisePanels = this.getClockwisePanels();
    
    console.log('[SSHIFT] Distributing', allSessions.length, 'tabs across', panelCount, 'panels (clockwise order:', clockwisePanels.join(', '), ')');
    
    // Store current active sessions before redistribution
    const previousActiveSessions = new Map(this.activeSessionsByPanel);
    
    // If we have synced tabs from another browser tab, use them
    if (syncedTabs && Array.isArray(syncedTabs) && syncedTabs.length > 0) {
      // Group tabs by panelId
      const tabsByPanel = {};
      panels.forEach(p => tabsByPanel[p] = []);
      
      syncedTabs.forEach(tabData => {
        const targetPanel = tabData.panelId && panels.includes(tabData.panelId) 
          ? tabData.panelId 
          : clockwisePanels[0];
        tabsByPanel[targetPanel].push(tabData);
      });
      
      // Move tabs to their assigned panels
      Object.entries(tabsByPanel).forEach(([panelId, tabs]) => {
        tabs.forEach(tabData => {
          this.moveTabToPanel(tabData.sessionId, panelId);
        });
      });
      
      // Restore active sessions per panel - only activate the first active tab in each panel
      const activatedPanels = new Set();
      syncedTabs.forEach(tabData => {
        if (tabData.active && !activatedPanels.has(tabData.panelId)) {
          this.switchTab(tabData.sessionId, tabData.panelId);
          activatedPanels.add(tabData.panelId);
        }
      });
    } else {
      // No synced data - collect all existing tabs in clockwise panel order
      const existingTabs = [];
      clockwisePanels.forEach(panelId => {
        const tabsContainer = this.getTabsContainer(panelId);
        if (tabsContainer) {
          Array.from(tabsContainer.children).forEach(tab => {
            existingTabs.push({
              sessionId: tab.dataset.sessionId,
              panelId: panelId
            });
          });
        }
      });
      
      if (panelCount === 1) {
        existingTabs.forEach(tabData => {
          this.moveTabToPanel(tabData.sessionId, 'panel-0');
        });
      } else {
        // Distribute in clockwise order: tab 1→first panel, tab 2→second panel, etc.
        existingTabs.forEach((tabData, index) => {
          const targetPanel = clockwisePanels[index % panelCount];
          this.moveTabToPanel(tabData.sessionId, targetPanel);
        });
      }
      
      // Build tabsByPanel for activation
      const tabsByPanel = {};
      panels.forEach(p => tabsByPanel[p] = []);
      
      existingTabs.forEach((tabData, index) => {
        const targetPanel = panelCount === 1 ? 'panel-0' : clockwisePanels[index % panelCount];
        tabsByPanel[targetPanel].push(tabData.sessionId);
      });
      
      // Restore active sessions or activate first tab in each panel
      Object.entries(tabsByPanel).forEach(([panelId, sessionIds]) => {
        if (sessionIds.length > 0) {
          const previousActive = previousActiveSessions.get(panelId);
          
          if (previousActive && sessionIds.includes(previousActive)) {
            this.switchTab(previousActive, panelId);
          } else {
            this.switchTab(sessionIds[0], panelId);
          }
        }
      });
    }
    
    // Update mobile dropdowns for all panels
    panels.forEach(panelId => {
      this.updateMobileTabsDropdown(panelId);
    });
    
    // Save tabs after distribution
    this.saveTabs();
  }

  // Move a tab to a specific panel
  moveTabToPanel(sessionId, targetPanelId) {
    const currentPanelId = this.getPanelForSession(sessionId);
    if (currentPanelId === targetPanelId) return; // Already in target panel
    
    const sourceTabsContainer = this.getTabsContainer(currentPanelId);
    const targetTabsContainer = this.getTabsContainer(targetPanelId);
    const sourceTerminalsContainer = this.getTerminalsContainer(currentPanelId);
    const targetTerminalsContainer = this.getTerminalsContainer(targetPanelId);
    
    if (!sourceTabsContainer || !targetTabsContainer) return;
    if (!sourceTerminalsContainer || !targetTerminalsContainer) return;
    
// Move ALL tab elements matching this session (defensive against duplicates)
    const tabElements = sourceTabsContainer.querySelectorAll(`[data-session-id="${sessionId}"]`);
    tabElements.forEach(el => targetTabsContainer.appendChild(el));

    // Move terminal element(s)
    const terminalElements = sourceTerminalsContainer.querySelectorAll(`[data-session-id="${sessionId}"]`);
    terminalElements.forEach(el => targetTerminalsContainer.appendChild(el));
    
    // Hide empty state in target panel if it has tabs now
    const targetTabs = targetTabsContainer.children;
    if (targetTabs.length > 0) {
      this.hideEmptyState(targetPanelId);
    }
    
    // Show empty state in source panel if it has no tabs now
    const sourceTabs = sourceTabsContainer.children;
    if (sourceTabs.length === 0) {
      this.showEmptyState(currentPanelId);
    }
    
    // Update active sessions:
    // 1. Make the moved tab active in the target panel
    this.switchTab(sessionId, targetPanelId);

    // 2. Activate the first remaining tab in the source panel (if any)
    if (sourceTabs.length > 0) {
      const firstRemainingSessionId = sourceTabs[0].dataset.sessionId;
      this.switchTab(firstRemainingSessionId, currentPanelId);
    } else {
      // No tabs left in source panel, clear its active session
      this.activeSessionsByPanel.delete(currentPanelId);
    }
    
    console.log('[SSHIFT] Moved tab', sessionId, 'from', currentPanelId, 'to', targetPanelId);
    
    // Update server panel map for mobile preservation
    this._serverPanelMap.set(sessionId, targetPanelId);

    // After moving the terminal wrapper to a new container, the
    // terminal's internal canvas/renderer dimensions are still tied
    // to the old panel's size. The WebGL atlas has glyphs rasterised
    // for the old cell size. If we fit() immediately the browser
    // hasn't committed the new layout yet, so fit() measures stale
    // dimensions — producing the interlaced/alternating-black-band
    // rendering bug. Fix: double-RAF to let the browser commit the
    // new layout, then fit + clear atlas + force refresh.
    // Also refit ALL terminals (the source panel's remaining tab may
    // have changed container size too).
    const session = this.sessions.get(sessionId);
    if (session && session.terminal && session.fitAddon && session.isController) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!session.terminal || !session.fitAddon || !session.isController) return;
          // Re-measure char size (font may have loaded differently in
          // the new container) then fit, clear atlas, and refresh.
          const core = session.terminal._core;
          if (core && core._charSizeService && typeof core._charSizeService.measure === 'function') {
            try { core._charSizeService.measure(); } catch (_) {}
          }
          this._fitTerminal(session);
          this._resetWebGLAtlas(session);
        });
      });
    }

    // Refit ALL visible terminals — the source panel's remaining tab
    // may have a different container width now that the moved tab is
    // gone. Use the existing staggered refit helper.
    this.refitAllTerminals();
  }

  // Hide empty state for a specific panel
  hideEmptyState(panelId = 'panel-0') {
    const emptyState = document.getElementById(panelId === 'panel-0' ? 'emptyState' : `${panelId}-emptyState`);
    if (emptyState) {
      emptyState.classList.add('hidden');
    }
  }

  // Show empty state for a specific panel
  showEmptyState(panelId = 'panel-0') {
    const emptyState = document.getElementById(panelId === 'panel-0' ? 'emptyState' : `${panelId}-emptyState`);
    if (emptyState) {
      emptyState.classList.remove('hidden');
    }
  }

  // Helper method to copy text to clipboard with fallback
  async copyToClipboard(text) {
    // Try modern clipboard API first (requires secure context + user gesture)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        console.log('[SSHIFT] Clipboard API write succeeded, length:', text.length);
        return true;
      } catch (err) {
        console.warn('[SSHIFT] Clipboard API write failed:', err.name, err.message);
      }
    } else {
      console.warn('[SSHIFT] Clipboard API not available');
    }
    
    // Fallback to execCommand (also requires user gesture in modern browsers)
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (success) {
        console.log('[SSHIFT] execCommand copy succeeded, length:', text.length);
      } else {
        console.warn('[SSHIFT] execCommand copy returned false');
      }
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
      console.warn('[SSHIFT] Modern clipboard API failed:', err);
    }
    
    // Fallback: return empty string - paste will be handled by browser's native paste event
    // or the user can use Ctrl+Shift+V for force paste
    return '';
  }

  // Helper method to paste from clipboard using hidden textarea (more reliable for context menus)
  async pasteFromClipboard() {
    // Try modern clipboard API first
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          return text;
        }
      }
    } catch (err) {
      console.warn('[SSHIFT] Clipboard API failed, trying textarea fallback:', err);
    }
    
    // Fallback: Create a hidden textarea and use execCommand
    return new Promise((resolve) => {
      const textarea = document.createElement('textarea');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      
      textarea.focus();
      textarea.select();
      
      let pastedText = '';
      try {
        // Try to paste using execCommand
        const successful = document.execCommand('paste');
        if (successful) {
          pastedText = textarea.value;
        }
      } catch (err) {
        console.warn('[SSHIFT] execCommand paste failed:', err);
      }
      
      document.body.removeChild(textarea);
      resolve(pastedText);
    });
  }

sendChunkedInput(sessionId, data, chunkSize = 2048) {
    if (!data || !this.sessions.has(sessionId)) return;
    const session = this.sessions.get(sessionId);
    if (!session || !session.connected) return;

    // Terminal emulators convert \n to \r before sending to the PTY.
    // Clipboard text contains \n line endings, but PTY input expects \r
    // as the "Enter" character. Without this conversion, programs like
    // nano interpret \n as a raw newline that doesn't trigger line actions.
    data = data.replace(/\r\n/g, '\r').replace(/\n/g, '\r');

    // Wrap in bracketed paste sequences so the remote shell treats this as
    // a single paste rather than individual keystrokes.
    const BP_START = '\x1b[200~';
    const BP_END = '\x1b[201~';

    const wrapped = BP_START + data + BP_END;

    if (wrapped.length <= chunkSize) {
      this.socket.emit('ssh-data', { sessionId, data: wrapped });
      return;
    }

    // For large pastes, send the start bracket, then chunk the content,
    // then send the end bracket. This keeps bracketed paste mode intact
    // across all chunks.
    let offset = 0;
    let isFirst = true;
    const sendNext = () => {
      if (offset >= data.length) {
        this.socket.emit('ssh-data', { sessionId, data: BP_END });
        return;
      }
      let end = Math.min(offset + chunkSize, data.length);
      if (end < data.length) {
        // Split at the last \r to keep line boundaries intact
        const lastCr = data.lastIndexOf('\r', end);
        if (lastCr > offset) {
          end = lastCr + 1;
        }
      }
      let chunk = data.substring(offset, end);
      if (isFirst) {
        chunk = BP_START + chunk;
        isFirst = false;
      }
      offset = end;
      this.socket.emit('ssh-data', { sessionId, data: chunk });
      if (offset < data.length) {
        setTimeout(sendNext, 5);
      } else {
        this.socket.emit('ssh-data', { sessionId, data: BP_END });
      }
    };
    sendNext();
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

  // Terminal Font Size Management (for pinch-to-zoom and buttons)
  loadTerminalFontSize() {
    // Don't persist - always start with default
    return window.innerWidth <= 768 ? 11 : 14;
  }

  saveTerminalFontSize(size) {
    // Don't persist - font size is session-only
  }

  // Clear the WebGL glyph texture atlas and force a full repaint.
  // The atlas caches rasterised glyphs; if it was built before the web font
  // finished loading (or after a DPR / font-size change) those cached glyphs
  // are blank or stale, producing the "black box" rendering artefacts.
  // Clearing forces every cell to be re-rasterised with correct glyphs.
  _resetWebGLAtlas(session) {
    if (!session || !session.terminal) return;
    if (session.webglAddon) {
      try {
        session.webglAddon.clearTextureAtlas();
      } catch (_) {}
    }
    session.terminal.refresh(0, session.terminal.rows - 1);
  }

// Sub-pixel seam mitigation is handled by canvas/WebGL renderer +
  // customGlyphs: true, which draws block/box characters as vector fills
  // that meet exactly.  letterSpacing nudging doesn't work because xterm.js
  // only accepts integer letterSpacing values.  Origin-snapping transforms
  // are also unnecessary because the canvas/WebGL renderer paints the cell
  // grid in its own coordinate system.  The remaining mitigation is:
  //  - customGlyphs: true (set in Terminal options)
  //  - canvas or WebGL renderer as default (not DOM)
  //  - clearTextureAtlas() on DPR change (handled by _setupDPRListener)
  //  - clean base metrics: letterSpacing: 0, lineHeight: 1.0 in _fitTerminal
  _snapCellWidth() { /* no-op: see comment above */ }

  // Initialize (or re-initialize) the WebGL renderer addon for a session.
  // Handles context-loss tracking with a retry cap: after 3 losses the session
  // permanently falls back to the canvas renderer so we don't loop endlessly.
  // The `initialLoad` flag controls whether we wait for web fonts before
  // clearing the atlas (only needed on first creation, not on recreation).
  _initWebGLAddon(session, initialLoad = false) {
    if (!session || !session.terminal) return false;
    if (!this.webglRenderer || typeof window.WebglAddon !== 'function') return false;

    if ((session.webglContextLossCount || 0) >= 3) {
      // xterm v6 does NOT ship a built-in canvas renderer — without
      // @xterm/addon-caddon-canvas packaged, the post-WebGL fallback
      // is the default DOM renderer, which is slower but functional.
      // Log explicitly so the degraded state is observable.
      console.warn('[SSHIFT] Too many WebGL context losses for session — staying on the default DOM renderer (slower than WebGL/canvas). Consider restarting the tab if rendering feels sluggish.');
      return false;
    }

    // Guard: don't initialise WebGL while the terminal is hidden (display:none).
    // A hidden canvas has zero dimensions, producing corrupt glyph caches (Bug 3).
    const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
    if (wrapper && !wrapper.classList.contains('active')) {
      session._webglInitPending = true;
      console.log('[SSHIFT] Delaying WebGL init — wrapper is hidden');
      return false;
    }

    if (session._webglInitPending && session.webglAddon) {
      // A previous call set the pending flag and we already have an addon;
      // don't double-initialise.
      return false;
    }
    session._webglInitPending = true;

    if (session.webglAddon) {
      try { session.webglAddon.dispose(); } catch (_) {}
      session.webglAddon = null;
    }

    try {
      const webglAddon = new window.WebglAddon();

      webglAddon.onContextLoss(() => {
        console.warn('[SSHIFT] WebGL context lost');
        try { webglAddon.dispose(); } catch (_) {}
        session.webglAddon = null;
        session.webglContextLossCount = (session.webglContextLossCount || 0) + 1;

        if (session.webglContextLossCount < 3) {
          console.log('[SSHIFT] Scheduling WebGL addon recreation via requestAnimationFrame');
          requestAnimationFrame(() => {
            if (session.terminal && !session.webglAddon && (session.webglContextLossCount || 0) < 3) {
              console.log('[SSHIFT] Attempting WebGL addon recreation after context loss');
              this._initWebGLAddon(session, false);
              if (session.fitAddon && !document.hidden) {
                try { session.fitAddon.fit(); } catch (_) {}
              }
              // After context loss the local terminal's rasterised
              // cells may have been cleared; reconcile with the
              // server's headless terminal state to avoid divergence.
              // Only do this if the session is connected (a connecting
              // session hasn't received its first sync yet).
              const sid = session.id;
              if (sid && session.connected) {
                try { this.requestScreenSync(sid); } catch (_) {}
              }
            }
          });
        } else {
          console.warn('[SSHIFT] Repeated WebGL context loss, permanently falling back to canvas renderer');
        }

        session.terminal.refresh(0, session.terminal.rows - 1);
      });

      session.terminal.loadAddon(webglAddon);
      session.webglAddon = webglAddon;

      const canvas = session.terminal.element?.querySelector('canvas');
      if (canvas) {
        const onCanvasContextLoss = () => {
          if (session.webglAddon) {
            console.warn('[SSHIFT] Raw canvas webglcontextlost event caught');
            try { session.webglAddon.dispose(); } catch (_) {}
            session.webglAddon = null;
            session.webglContextLossCount = (session.webglContextLossCount || 0) + 1;
            session.terminal.refresh(0, session.terminal.rows - 1);
          }
          canvas.removeEventListener('webglcontextlost', onCanvasContextLoss);
        };
        canvas.addEventListener('webglcontextlost', onCanvasContextLoss);
      }

      session._webglInitPending = false;
      console.log('[SSHIFT] WebglAddon loaded');

      if (initialLoad) {
        document.fonts.ready.then(() => {
          if (session.webglAddon) {
            try { session.webglAddon.clearTextureAtlas(); } catch (_) {}
          }
          if (session.terminal) {
            session.terminal.refresh(0, session.terminal.rows - 1);
          }
          console.log('[SSHIFT] WebGL atlas cleared after fonts ready');
        });
      } else {
        try { webglAddon.clearTextureAtlas(); } catch (_) {}
        session.terminal.refresh(0, session.terminal.rows - 1);
        if (session.fitAddon) {
          try { session.fitAddon.fit(); } catch (_) {}
        }
      }

      return true;
    } catch (e) {
      session._webglInitPending = false;
      console.warn('[SSHIFT] Failed to load WebglAddon, falling back to canvas renderer:', e.message);
      return false;
    }
  }

  // Called on visibilitychange (tab becomes visible).  Browsers may reclaim
  // GPU memory from background tabs, which can invalidate the WebGL glyph
  // texture atlas or cause a full context loss.  For sessions that still have
  // a WebGL addon we clear the stale atlas and force a repaint; for sessions
  // whose addon was lost while the tab was hidden we attempt to recreate it
  // (up to the 3-loss cap in _initWebGLAddon).
  // Wrapped in requestAnimationFrame to ensure layout is recalculated before
  // we touch the canvas — the container may have had zero dimensions while
  // the tab was hidden.
  _refreshAllWebGLSessions() {
    requestAnimationFrame(() => {
      const refresh = (session) => {
        if (!session || !session.terminal || !this.webglRenderer) return;
        if (session.webglAddon) {
          try { session.webglAddon.clearTextureAtlas(); } catch (_) {}
          session.terminal.refresh(0, session.terminal.rows - 1);
        } else if ((session.webglContextLossCount || 0) < 3 && typeof window.WebglAddon === 'function') {
          this._initWebGLAddon(session, false);
          if (session.fitAddon) {
            try { session.fitAddon.fit(); } catch (_) {}
          }
        }
      };
      this.sessions.forEach(refresh);
      this.sftpSessions.forEach(refresh);
    });
  }

  // Watch for devicePixelRatio changes (zoom, monitor move, DPI switch).
  // When DPR changes the WebGL glyph atlas is built for the old pixel ratio
  // and every glyph becomes mis-scaled; clearing the atlas forces a rebuild.
  // We also refit terminals so they recalculate at the new DPR.
  _setupDPRListener() {
    let currentDPR = window.devicePixelRatio;
    const query = matchMedia(`(resolution: ${currentDPR}dppx)`);
    const onChange = () => {
      const newDPR = window.devicePixelRatio;
      if (newDPR !== currentDPR) {
        console.log('[SSHIFT] devicePixelRatio changed from', currentDPR, 'to', newDPR);
        currentDPR = newDPR;
        this.sessions.forEach(session => {
          this._resetWebGLAtlas(session);
          if (session.fitAddon && session.terminal && session.isController) {
            const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
            if (wrapper && wrapper.classList.contains('active')) {
              this._fitTerminal(session);
            } else if (wrapper) {
              session.needsResize = true;
            }
          }
        });
        this.sftpSessions.forEach(session => {
          this._resetWebGLAtlas(session);
        });
      }
      // Re-register for the new DPR value
      this._setupDPRListener();
    };
    if (query.addEventListener) {
      query.addEventListener('change', onChange, { once: true });
    } else if (query.addListener) {
      query.addListener(onChange);
    }
  }

  // Robust terminal fit with validation and retry.
  // Sometimes fit() is called before the browser finishes laying out a
  // container that just became visible (display:none -> display:flex).
  // When that happens proposeDimensions() reads stale or zero width/height
  // and the terminal ends up with far fewer cols than the container can hold
  // (the "narrow column" bug).  This wrapper validates the result and
  // retries on the next animation frame when it detects a bad fit.
  _fitTerminal(session, retryCount = 0) {
    if (!session || !session.fitAddon || !session.terminal) return false;

    const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
    const container = document.getElementById(`terminal-${session.id}`);
    if (!wrapper || !container) return false;

    if (!wrapper.classList.contains('active')) {
      session.needsResize = true;
      return false;
    }

    // Guard: refuse to fit if the container hasn't reached a usable size.
    // A zero/very small container (e.g. a pane mid-layout-transition that
    // is briefly ~100x100px) produces bogus col/row counts.  Those propagate
    // to the remote PTY and cause the "tiny ~10-column terminal" bug.
    //
    // 50px is below every real pane size (terms-container min-height 200px,
    // layout-panel min-width/height enforce 200px+ even on mobile) but above
    // transient collapsed states (display:none, mid-flex-grow).  Retrying on
    // the next animation frame lets the browser finish laying out first.
    const rect = container.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) {
      session.needsResize = true;
      if (retryCount < 5) {
        requestAnimationFrame(() => this._fitTerminal(session, retryCount + 1));
      }
      return false;
    }

    // Note: do NOT mutate term.options.lineHeight / letterSpacing here.
    // Both options are set to their base values (1, 0) at Terminal construction
    // and nothing else modifies them, so a reset would be a no-op — except that
    // xterm.js's option setter invalidates _renderService.dimensions
    // asynchronously.  Then fitAddon.fit() can read the stale (pre-invalidation)
    // cell height, computing cols/rows for one cell height while the renderer
    // paints at another.  That mismatch shows every other row empty (the
    // "alternating black band" rendering bug).
    const term = session.terminal;

    void container.offsetHeight;
    void wrapper.offsetHeight;

    try {
      session.fitAddon.fit();
    } catch (e) {
      console.warn('[SSHIFT] Could not fit terminal:', e.message);
      return false;
    }

    const terminal = session.terminal;
    const core = terminal._core;
    if (core) {
      const cellWidth = core._renderService?.dimensions?.css?.cell?.width || 0;
      const containerWidth = container.getBoundingClientRect().width;
      if (cellWidth > 0 && containerWidth > 80) {
        const expectedCols = Math.floor(containerWidth / cellWidth);
        if (terminal.cols < expectedCols * 0.5 && retryCount < 5) {
          console.warn(`[SSHIFT] Terminal fit seems incorrect (cols: ${terminal.cols}, expected: ~${expectedCols}, container: ${containerWidth}px), retrying (attempt ${retryCount + 1})...`);
          requestAnimationFrame(() => {
            this._fitTerminal(session, retryCount + 1);
          });
          return false;
        }
      }
    }

    console.log('[SSHIFT] Terminal fitted, cols:', terminal.cols, 'rows:', terminal.rows);

    // Resize changes cell metrics; clear the WebGL atlas so glyphs are
    // re-rasterised at the new size rather than stretched from the old cache.
    this._resetWebGLAtlas(session);

    // Force a full repaint to flush stale cells from the previous dimensions.
    // This prevents bottom-row garbage and garbled status lines after resize.
    try {
      terminal.refresh(0, terminal.rows - 1);
    } catch (_) {}

    return true;
  }

  forceResizeTerminal(sessionId) {
    if (!sessionId) return;
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session || !session.terminal || !session.fitAddon) return;

    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    const container = document.getElementById(`terminal-${sessionId}`);
    if (!wrapper || !container) return;

    if (!wrapper.classList.contains('active')) {
      this.switchTab(sessionId);
      setTimeout(() => this._fitTerminal(session), 50);
    } else {
      this._fitTerminal(session);
    }
  }

  // Set font size for a specific session
  setSessionFontSize(sessionId, size) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) {
      console.log('[SSHIFT] Cannot set font size: session not found or no terminal');
      return;
    }
    
    // Clamp size to min/max bounds
    size = Math.max(this.minFontSize, Math.min(this.maxFontSize, size));
    
    // Update session's font size
    session.fontSize = size;
    
    // Update the terminal
    session.terminal.options.fontSize = size;

    // Font-size changes invalidate the glyph atlas — clear it so
    // glyphs are re-rasterised at the new size.
    this._resetWebGLAtlas(session);

    if (session.fitAddon && session.isController) {
      this._fitTerminal(session);
    }

    // Refresh mobile selection overlay after font change
    if (session.mobileHandler) {
      session.mobileHandler.refreshSelection();
    }
    
    console.log('[SSHIFT] Font size set to', size, 'for session', sessionId);
  }

  // Legacy method for global font size (kept for compatibility)
  setTerminalFontSize(size) {
    // Clamp size to min/max bounds
    size = Math.max(this.minFontSize, Math.min(this.maxFontSize, size));
    
    if (size === this.terminalFontSize) {
      return; // No change needed
    }
    
    this.terminalFontSize = size;
    
    // Update all active SSH terminals
    this.sessions.forEach((session) => {
      if (session.terminal) {
        session.terminal.options.fontSize = size;
        this._resetWebGLAtlas(session);
        if (session.fitAddon && session.isController) {
          this._fitTerminal(session);
        }
        if (session.mobileHandler) {
          session.mobileHandler.refreshSelection();
        }
      }
    });
    
    this.sftpSessions.forEach((session) => {
      if (session.terminal) {
        session.terminal.options.fontSize = size;
        this._resetWebGLAtlas(session);
        if (session.fitAddon) {
          this._fitTerminal(session);
        }
      }
    });
    
    console.log('[SSHIFT] Terminal font size set to:', size);
  }

  increaseFontSize() {
    this.setTerminalFontSize(this.terminalFontSize + 1);
  }

  decreaseFontSize() {
    this.setTerminalFontSize(this.terminalFontSize - 1);
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

  getScrollbarColors(bgColor) {
    const hex = (bgColor || '#0d1117').replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

    let trackR, trackG, trackB;
    let thumbR, thumbG, thumbB;
    if (luminance > 128) {
      trackR = Math.max(0, r - 8);
      trackG = Math.max(0, g - 8);
      trackB = Math.max(0, b - 8);
      thumbR = Math.max(0, r - 80);
      thumbG = Math.max(0, g - 80);
      thumbB = Math.max(0, b - 80);
    } else {
      trackR = Math.min(255, r + 8);
      trackG = Math.min(255, g + 8);
      trackB = Math.min(255, b + 8);
      thumbR = Math.min(255, r + 60);
      thumbG = Math.min(255, g + 60);
      thumbB = Math.min(255, b + 60);
    }

    const track = `rgb(${trackR}, ${trackG}, ${trackB})`;
    const thumb = `rgb(${thumbR}, ${thumbG}, ${thumbB})`;

    return { track, thumb };
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
        selectionBackground: 'rgba(193, 0, 89, 0.3)'
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
      
      // Sync theme to server for cross-device sync
      if (this.socket && this.socket.connected) {
        this.socket.emit('theme-change', { theme: newTheme });
      }
      
      // Fade out the wave
      wave.classList.add('fade-out');
      
      // Remove wave overlay after fade-out
      setTimeout(() => {
        wave.remove();
      }, 200);
    }, 250);
  }

  applyScrollbarColors(wrapper, bgColor) {
    if (!wrapper) return;
    const colors = this.getScrollbarColors(bgColor);
    wrapper.style.setProperty('--terminal-scrollbar-track', colors.track);
    wrapper.style.setProperty('--terminal-scrollbar-thumb', colors.thumb);
  }

  updateViewportBackground(session) {
    if (!session || !session.terminal || !session.terminal.element) return;
    const bgColor = this.terminalColorOverride
      ? (this.terminalBgColor || '#0d1117')
      : '#0d1117';
    const viewport = session.terminal.element.querySelector('.xterm-viewport');
    if (viewport) {
      viewport.style.backgroundColor = bgColor;
    }
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
        this._resetWebGLAtlas(session);
        
        // Update wrapper background to match terminal background
        const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
        if (wrapper && this.terminalColorOverride) {
          wrapper.style.backgroundColor = newTheme.background;
          this.applyScrollbarColors(wrapper, newTheme.background);
        } else if (wrapper) {
          wrapper.style.backgroundColor = '#0d1117';
          this.applyScrollbarColors(wrapper, '#0d1117');
        }

        this.updateViewportBackground(session);
      }
    });
    
    // Update all SFTP sessions
    this.sftpSessions.forEach((session) => {
      if (session.terminal) {
        const newTheme = this.getTerminalTheme(theme);
        session.terminal.options.theme = newTheme;
        this._resetWebGLAtlas(session);
        
        // Update wrapper background to match terminal background
        const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
        if (wrapper && this.terminalColorOverride) {
          wrapper.style.backgroundColor = newTheme.background;
          this.applyScrollbarColors(wrapper, newTheme.background);
        } else if (wrapper) {
          wrapper.style.backgroundColor = '#0d1117';
          this.applyScrollbarColors(wrapper, '#0d1117');
        }

        this.updateViewportBackground(session);
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

    // Repaint existing terminals so the new accent's color is reflected
    // immediately. Previously terminals only picked up the accent at
    // construction time, so live accent changes left existing tabs with
    // the stale accent until reload.
    try {
      const currentTheme = this.loadTheme();
      this.updateTerminalThemes(currentTheme);
    } catch (e) {
      console.warn('[SSHIFT] Failed to re-apply terminal themes after accent change:', e.message);
    }

    // Sync accent to server for cross-device sync
    if (this.socket && this.socket.connected) {
      this.socket.emit('accent-change', { accent: accent });
    }
  }

  updateAccentPreview(accent) {
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
    const color = colors[accent] || colors.fuchsia;
    
    // Update all accent-preview elements (desktop and mobile)
    const previews = document.querySelectorAll('.accent-preview');
    previews.forEach(preview => {
      preview.style.background = color;
    });
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

  // Layout Management
  async loadLayouts() {
    try {
      // First try to get layouts from config.json via API
      const configResponse = await fetch('/api/config');
      if (configResponse.ok) {
        const config = await configResponse.json();
        if (config.layouts && Array.isArray(config.layouts) && config.layouts.length > 0) {
          console.log('[SSHIFT] Loaded layouts from config');
          return config.layouts;
        }
      }
    } catch (err) {
      console.warn('[SSHIFT] Failed to load layouts from config:', err);
    }
    
    // Fallback to layouts.json
    try {
      const layoutsResponse = await fetch('/layouts.json');
      if (layoutsResponse.ok) {
        const data = await layoutsResponse.json();
        if (data.layouts && Array.isArray(data.layouts)) {
          console.log('[SSHIFT] Loaded layouts from layouts.json');
          return data.layouts;
        }
      }
    } catch (err) {
      console.warn('[SSHIFT] Failed to load layouts.json:', err);
    }
    
    // Default fallback layouts
    console.log('[SSHIFT] Using default layouts');
    return [
      { id: 'single', name: 'Single', icon: 'square', columns: [{ width: '100%', rows: [{ height: '100%' }] }] },
      { id: '2-columns', name: '2 Columns', icon: 'columns', columns: [{ width: '50%', rows: [{ height: '100%' }] }, { width: '50%', rows: [{ height: '100%' }] }] },
      { id: '3-columns', name: '3 Columns', icon: 'grip-lines-vertical', columns: [{ width: '33.33%', rows: [{ height: '100%' }] }, { width: '33.33%', rows: [{ height: '100%' }] }, { width: '33.34%', rows: [{ height: '100%' }] }] },
      { id: '1-column-2-rows', name: '1 Column 2 Rows', icon: 'grip-lines', columns: [{ width: '100%', rows: [{ height: '50%' }, { height: '50%' }] }] },
      { id: 'cross', name: 'Cross', icon: 'th-large', columns: [{ width: '50%', rows: [{ height: '50%' }, { height: '50%' }] }, { width: '50%', rows: [{ height: '50%' }, { height: '50%' }] }] }
    ];
  }

  loadCurrentLayout() {
    return localStorage.getItem('currentLayout') || 'single';
  }

  saveCurrentLayout(layoutId) {
    localStorage.setItem('currentLayout', layoutId);
  }

  async initLayoutSelector() {
    const layoutBtn = document.querySelector('.layout-btn');
    const layoutDropdown = document.getElementById('layoutDropdown');
    
    if (!layoutBtn || !layoutDropdown) {
      console.warn('[SSHIFT] Layout selector elements not found');
      return;
    }
    
    // Use already loaded layouts or load them
    if (!this.layouts) {
      this.layouts = await this.loadLayouts();
    }
    
    // Populate dropdown
    this.populateLayoutDropdown();
    
    // Set current layout
    const currentLayout = this.currentLayout?.id || this.loadCurrentLayout();
    this.updateLayoutActiveState(currentLayout);
    
    // Toggle dropdown on button click
    layoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      layoutDropdown.classList.toggle('show');
      // Close other dropdowns
      const accentDropdown = document.querySelector('.accent-dropdown');
      const terminalColorDropdown = document.querySelector('.terminal-color-dropdown');
      if (accentDropdown) accentDropdown.classList.remove('show');
      if (terminalColorDropdown) terminalColorDropdown.classList.remove('show');
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (layoutDropdown.classList.contains('show') && !e.target.closest('.layout-selector')) {
        layoutDropdown.classList.remove('show');
      }
    }, true);
  }

  populateLayoutDropdown() {
    const layoutDropdown = document.getElementById('layoutDropdown');
    if (!layoutDropdown || !this.layouts) return;
    
    layoutDropdown.innerHTML = '';
    
    this.layouts.forEach(layout => {
      const button = document.createElement('button');
      button.className = 'layout-option';
      button.dataset.layoutId = layout.id;
      button.innerHTML = `
        <i data-lucide="${layout.icon || 'grid'}"></i>
        <span class="layout-label">${layout.name}</span>
      `;
      button.addEventListener('click', () => {
        this.setLayout(layout.id);
        layoutDropdown.classList.remove('show');
      });
      layoutDropdown.appendChild(button);
    });
    
    // Initialize Lucide icons in the dropdown
    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  }

  setLayout(layoutId) {
    console.log('[SSHIFT] Setting layout:', layoutId);
    this.saveCurrentLayout(layoutId);
    this.updateLayoutActiveState(layoutId);
    
    // Find the layout definition
    const layout = this.layouts?.find(l => l.id === layoutId);
    if (layout) {
      // Emit event for layout change (to be implemented later)
      this.onLayoutChange(layout);
    }
    
    // Sync layout to server for cross-tab sync
    if (this.sticky && this.socket) {
      this.socket.emit('layout-change', { layoutId });
    }
  }

  setLayoutFromServer(layoutId, syncedTabs = null) {
    console.log('[SSHIFT] Setting layout from server:', layoutId);
    
    // If layouts aren't loaded yet, queue this for later
    if (!this.layouts) {
      console.log('[SSHIFT] Layouts not loaded yet, queuing layout sync for:', layoutId);
      this.pendingLayoutSync = layoutId;
      this.pendingLayoutTabs = syncedTabs;
      return;
    }
    
    // Don't sync back to server (avoid loop)
    this.saveCurrentLayout(layoutId);
    this.updateLayoutActiveState(layoutId);
    
    // Find the layout definition
    const layout = this.layouts.find(l => l.id === layoutId);
    if (layout) {
      this.currentLayout = layout;
      // Pass syncedTabs to applyLayout which will handle distribution
      this.applyLayout(layout, syncedTabs);
      
      setTimeout(() => this.handleResize(), 50);
    }
  }

  updateLayoutActiveState(layoutId) {
    document.querySelectorAll('.layout-option').forEach(option => {
      option.classList.toggle('active', option.dataset.layoutId === layoutId);
    });
    
    // Update button active state
    const layoutBtn = document.querySelector('.layout-btn');
    if (layoutBtn) {
      layoutBtn.classList.toggle('active', layoutId !== 'single');
    }
  }

  onLayoutChange(layout) {
    console.log('[SSHIFT] Layout changed to:', layout.name, layout);
    
    // Store current layout
    this.currentLayout = layout;
    
    // Apply the layout
    this.applyLayout(layout);
    
    // Force refit all visible terminals after layout change
    // This is more reliable than relying on ResizeObserver
    this.refitAllTerminals();
    
    this.showToast(`Layout: ${layout.name}`, 'info');
  }
  
  // Refit all visible terminals
  refitAllTerminals() {
    console.log('[SSHIFT] Refitting all terminals');
    
    const delays = [50, 150, 300, 500];
    
    delays.forEach((delay, index) => {
      setTimeout(() => {
        console.log(`[SSHIFT] Refit attempt ${index + 1}/${delays.length}`);
        
        this.sessions.forEach((session, sessionId) => {
          if (session.terminal && session.fitAddon && session.isController) {
            const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
            if (wrapper && wrapper.classList.contains('active')) {
              this._fitTerminal(session);
            }
          }
        });
        
        this.sftpSessions.forEach((session, sessionId) => {
          if (session.terminal && session.fitAddon) {
            const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
            if (wrapper && wrapper.classList.contains('active')) {
              this._fitTerminal(session);
            }
          }
        });
      }, delay);
    });
  }

  applyLayout(layout, syncedTabs = null) {
    const layoutContainer = document.getElementById('layoutContainer');
    if (!layoutContainer) {
      console.error('[SSHIFT] Layout container not found');
      return;
    }
    
    // On mobile, always force single panel mode
    const effectiveLayout = this.isMobile 
      ? { id: 'single', name: 'Single (Mobile)', icon: 'square', columns: [{ width: '100%', rows: [{ height: '100%' }] }] }
      : layout;
    
    console.log('[SSHIFT] Applying layout:', effectiveLayout.id, this.isMobile ? '(mobile override)' : '');
    
    // Store tabs before clearing layout (for sync from other tabs)
    const storedTabs = syncedTabs;
    
    // Store terminal elements before clearing layout (to prevent black tabs)
    const storedTerminals = new Map();
    document.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
      const sessionId = wrapper.dataset.sessionId || wrapper.id.replace('terminal-wrapper-', '');
      storedTerminals.set(sessionId, wrapper);
    });
    
    // Store tab elements before clearing layout
    const storedTabElements = new Map();
    document.querySelectorAll('.tab').forEach(tab => {
      const sessionId = tab.dataset.sessionId;
      storedTabElements.set(sessionId, tab);
    });
    
    // Check if single layout (use existing structure)
    if (effectiveLayout.id === 'single') {
      // For single layout, just ensure the container has the right class
      layoutContainer.className = 'layout-container columns';
      
      // Check if we need to restore the original single panel structure
      const existingPanel = document.getElementById('panel-0');
      if (!existingPanel) {
        // Clear and recreate single panel
        layoutContainer.innerHTML = '';
        this.createSinglePanel(layoutContainer, 0);
      }
      
      this.currentLayout = layout;
      
      // Get the single panel containers
      const tabsContainer = this.getTabsContainer('panel-0');
      const terminalsContainer = this.getTerminalsContainer('panel-0');
      
      // Restore tab elements to the single panel
      storedTabElements.forEach((tab, sessionId) => {
        if (tabsContainer && !tabsContainer.contains(tab)) {
          tabsContainer.appendChild(tab);
        }
      });
      
      // Restore terminal elements to the single panel
      storedTerminals.forEach((wrapper, sessionId) => {
        if (terminalsContainer && !terminalsContainer.contains(wrapper)) {
          terminalsContainer.appendChild(wrapper);
        }
      });
      
      // Hide empty state if we have tabs
      if (storedTabElements.size > 0) {
        this.hideEmptyState('panel-0');
      }
      
      // When switching to single panel, ensure only one tab is active
      // Priority: first panel's active tab, then second panel's, etc.
      if (!syncedTabs) {
        // Find the first active tab across all panels
        let activeTabToKeep = null;
        const panels = this.getAllPanels();
        
        // Check each panel in order for an active session
        for (const panelId of panels) {
          const activeSessionId = this.activeSessionsByPanel.get(panelId);
          if (activeSessionId && this.sessions.has(activeSessionId)) {
            activeTabToKeep = activeSessionId;
            break;
          }
        }
        
        // If no active tab found, use the first tab in the panel
        if (!activeTabToKeep) {
          const firstTab = tabsContainer.querySelector('.tab');
          if (firstTab) {
            activeTabToKeep = firstTab.dataset.sessionId;
          }
        }
        
        // Deactivate all tabs first
        tabsContainer.querySelectorAll('.tab').forEach(tab => {
          tab.classList.remove('active');
        });
        
        // Hide all terminal wrappers
        terminalsContainer.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
          wrapper.classList.remove('active');
        });
        
        // Activate only the selected tab
        if (activeTabToKeep) {
          const activeTab = tabsContainer.querySelector(`[data-session-id="${activeTabToKeep}"]`);
          const activeWrapper = terminalsContainer.querySelector(`[data-session-id="${activeTabToKeep}"]`);
          
          if (activeTab) activeTab.classList.add('active');
          if (activeWrapper) activeWrapper.classList.add('active');
          
          // Update activeSessionsByPanel for single panel
          this.activeSessionsByPanel.clear();
          this.activeSessionsByPanel.set('panel-0', activeTabToKeep);
          
          // Update global active session (for mobile dropdown)
          this.activeSessionId = activeTabToKeep;
        }
        
        // Update mobile dropdown and save tabs
        this.updateMobileTabsDropdown('panel-0');
        this.saveTabs();
      } else {
        // Use syncedTabs distribution
        this.distributeTabsToPanels(syncedTabs);
      }
      
      // Resize terminals after restoration.
      // Use requestAnimationFrame so the browser has committed the new
      // flex/grid layout before we measure container widths (Bug 2 & 3).
      // Stagger a second pass for late fonts or animations.
      requestAnimationFrame(() => {
        this._refreshAllWebGLSessions();
        this.handleResize();
        requestAnimationFrame(() => {
          this.handleResize();
        });
      });
      
      // Final resize attempt for slow rendering / font swaps
      setTimeout(() => this.handleResize(), 300);
      return;
    }
    
    // For multi-panel layouts, clear existing layout
    layoutContainer.innerHTML = '';
    layoutContainer.className = 'layout-container columns';
    
    // Create panels based on layout definition
    layout.columns.forEach((columnDef, colIndex) => {
      const column = this.createColumn(columnDef, colIndex);
      layoutContainer.appendChild(column);
    });
    
    // Attach event listeners to all panels
    const panels = this.getAllPanels();
    panels.forEach(panelId => {
      this.attachPanelEventListeners(panelId);
    });
    
    this.currentLayout = layout;
    
    // Restore tab elements to the first panel temporarily
    const firstPanel = this.getAllPanels()[0];
    const firstTabsContainer = this.getTabsContainer(firstPanel);
    storedTabElements.forEach((tab, sessionId) => {
      if (firstTabsContainer && !firstTabsContainer.contains(tab)) {
        firstTabsContainer.appendChild(tab);
      }
    });
    
    // Restore terminal elements to the first panel temporarily
    const firstTerminalsContainer = this.getTerminalsContainer(firstPanel);
    storedTerminals.forEach((wrapper, sessionId) => {
      if (firstTerminalsContainer && !firstTerminalsContainer.contains(wrapper)) {
        firstTerminalsContainer.appendChild(wrapper);
      }
    });
    
    // Hide empty state in first panel if we have tabs
    if (storedTabElements.size > 0) {
      this.hideEmptyState(firstPanel);
    }
    
    // Distribute tabs across panels
    // Use syncedTabs if available (from another browser tab), otherwise distribute evenly
    this.distributeTabsToPanels(syncedTabs);
    
// Resize terminals after restoration.
    // Use requestAnimationFrame so the browser has committed the new
    // flex/grid layout before we measure container widths (Bug 2 & 3).
    requestAnimationFrame(() => {
      this._refreshAllWebGLSessions();
      this.handleResize();
      requestAnimationFrame(() => {
        this.handleResize();
      });
    });
    
    // Final resize attempt for slow rendering / font swaps
    setTimeout(() => this.handleResize(), 300);

    // Update scroll arrows for all panels
    setTimeout(() => this.updateTabsScrollArrows(), 150);
  }

  // Get all tabs in order across all panels
  getAllTabsInOrder() {
    const tabs = [];
    const panels = this.getAllPanels();
    
    panels.forEach(panelId => {
      const tabsContainer = this.getTabsContainer(panelId);
      if (tabsContainer) {
        Array.from(tabsContainer.children).forEach(tab => {
          const sessionId = tab.dataset.sessionId;
          const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
          if (session) {
            tabs.push({
              sessionId,
              name: session.name,
              type: session.type,
              connectionData: session.connectionData,
              panelId: panelId
            });
          }
        });
      }
    });
    
    return tabs;
  }

  createColumn(columnDef, colIndex) {
    const column = document.createElement('div');
    column.className = 'layout-column';
    column.style.width = columnDef.width;
    column.dataset.columnIndex = colIndex;
    
    // Create rows within the column
    columnDef.rows.forEach((rowDef, rowIndex) => {
      const panel = this.createPanel(colIndex, rowIndex, rowDef.height);
      column.appendChild(panel);
    });
    
    return column;
  }

  createPanel(colIndex, rowIndex, height) {
    const panelId = `panel-${colIndex}-${rowIndex}`;
    const panel = document.createElement('div');
    panel.className = 'layout-panel';
    panel.id = panelId;
    panel.dataset.panelId = `${colIndex}-${rowIndex}`;
    panel.style.height = height;
    
    // Create tabs container for this panel
    const tabsContainer = this.createTabsContainer(panelId);
    panel.appendChild(tabsContainer);
    
    // Create terminals container for this panel
    const terminalsContainer = this.createTerminalsContainer(panelId);
    panel.appendChild(terminalsContainer);
    
    return panel;
  }

  createSinglePanel(container, panelId) {
    const panel = document.createElement('div');
    panel.className = 'layout-panel';
    panel.id = 'panel-0';
    panel.dataset.panelId = '0';
    panel.style.width = '100%';
    panel.style.height = '100%';
    
    // Create tabs container with original IDs (no prefix for single panel)
    const tabsContainer = this.createTabsContainer('panel-0', true);
    panel.appendChild(tabsContainer);
    
    // Create terminals container with original IDs (no prefix for single panel)
    const terminalsContainer = this.createTerminalsContainer('panel-0', true);
    panel.appendChild(terminalsContainer);
    
    container.appendChild(panel);
    
    // Re-attach event listeners for the new panel
    this.attachPanelEventListeners('panel-0');
  }

  createTabsContainer(panelId, isSingle = false) {
    const container = document.createElement('div');
    container.className = 'tabs-container';
    // For single panel, use original IDs without prefix
    container.id = isSingle ? 'tabs-container' : `${panelId}-tabs-container`;
    
    // Desktop tabs
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.id = isSingle ? 'tabs' : `${panelId}-tabs`;
    
    // Add drag-and-drop event listeners to the tabs container for dropping tabs on empty panels
    tabs.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      
      // Highlight tabs container when dragging over it
      if (this.draggedTab) {
        tabs.classList.add('drag-over');
      }
    });
    
    tabs.addEventListener('dragleave', (e) => {
      // Remove highlight when leaving
      tabs.classList.remove('drag-over');
    });
    
    tabs.addEventListener('drop', (e) => {
      e.preventDefault();
      tabs.classList.remove('drag-over');
      
      // Handle drop on tabs container (empty or with tabs)
      if (this.draggedTab) {
        const sourcePanelId = this.getPanelForSession(this.draggedTab);
        const targetPanelId = panelId;
        
        // If dropping on a different panel or empty container
        if (sourcePanelId !== targetPanelId) {
          console.log('[SSHIFT] Moving tab from panel', sourcePanelId, 'to panel', targetPanelId);
          this.moveTabToPanel(this.draggedTab, targetPanelId);
          this.saveTabs();
        }
      }
    });
    
    container.appendChild(tabs);
    
    // Scroll arrows
    const scrollArrows = document.createElement('div');
    scrollArrows.className = 'tabs-scroll-arrows';
    scrollArrows.id = isSingle ? 'tabsScrollArrows' : `${panelId}-tabsScrollArrows`;
    
    const scrollLeftBtn = document.createElement('button');
    scrollLeftBtn.className = 'tabs-scroll-arrow';
    scrollLeftBtn.id = isSingle ? 'scrollLeftBtn' : `${panelId}-scrollLeftBtn`;
    scrollLeftBtn.title = 'Scroll Left';
    scrollLeftBtn.innerHTML = '<i class="fas fa-chevron-left"></i>';
    scrollArrows.appendChild(scrollLeftBtn);
    
    const scrollRightBtn = document.createElement('button');
    scrollRightBtn.className = 'tabs-scroll-arrow';
    scrollRightBtn.id = isSingle ? 'scrollRightBtn' : `${panelId}-scrollRightBtn`;
    scrollRightBtn.title = 'Scroll Right';
    scrollRightBtn.innerHTML = '<i class="fas fa-chevron-right"></i>';
    scrollArrows.appendChild(scrollRightBtn);
    
    container.appendChild(scrollArrows);
    
    // Mobile tabs dropdown
    const mobileDropdown = document.createElement('div');
    mobileDropdown.className = 'mobile-tabs-dropdown';
    mobileDropdown.id = isSingle ? 'mobileTabsDropdown' : `${panelId}-mobileTabsDropdown`;
    
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'mobile-tabs-toggle';
    mobileToggle.id = isSingle ? 'mobileTabsToggle' : `${panelId}-mobileTabsToggle`;
    mobileToggle.innerHTML = `
      <i class="fas fa-terminal tab-icon-active"></i>
      <span class="mobile-tabs-label" id="${isSingle ? 'mobileTabsLabel' : `${panelId}-mobileTabsLabel`}">No Active Tabs</span>
      <i class="fas fa-chevron-down dropdown-arrow"></i>
    `;
    mobileDropdown.appendChild(mobileToggle);
    
    const forceResizeBtn = document.createElement('button');
    forceResizeBtn.className = 'mobile-force-resize-btn';
    forceResizeBtn.id = isSingle ? 'mobileForceResizeBtn' : `${panelId}-mobileForceResizeBtn`;
    forceResizeBtn.title = 'Force Resize';
    forceResizeBtn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i>';
    mobileDropdown.appendChild(forceResizeBtn);
    
    const mobileMenu = document.createElement('div');
    mobileMenu.className = 'mobile-tabs-menu';
    mobileMenu.id = isSingle ? 'mobileTabsMenu' : `${panelId}-mobileTabsMenu`;
    mobileDropdown.appendChild(mobileMenu);
    
    container.appendChild(mobileDropdown);
    
    // Tabs actions (font size, special keys)
    const actions = document.createElement('div');
    actions.className = 'tabs-actions';
    
    const decreaseBtn = document.createElement('button');
    decreaseBtn.className = 'btn btn-sm';
    decreaseBtn.id = isSingle ? 'decreaseFontBtn' : `${panelId}-decreaseFontBtn`;
    decreaseBtn.title = 'Decrease Font Size';
    decreaseBtn.innerHTML = '<i class="fas fa-minus"></i>';
    actions.appendChild(decreaseBtn);
    
    const increaseBtn = document.createElement('button');
    increaseBtn.className = 'btn btn-sm';
    increaseBtn.id = isSingle ? 'increaseFontBtn' : `${panelId}-increaseFontBtn`;
    increaseBtn.title = 'Increase Font Size';
    increaseBtn.innerHTML = '<i class="fas fa-plus"></i>';
    actions.appendChild(increaseBtn);
    
    const specialKeysBtn = document.createElement('button');
    specialKeysBtn.className = 'btn btn-sm';
    specialKeysBtn.id = isSingle ? 'specialKeysBtn' : `${panelId}-specialKeysBtn`;
    specialKeysBtn.title = 'Special Keys';
    specialKeysBtn.innerHTML = '<i class="fas fa-keyboard"></i>';
    actions.appendChild(specialKeysBtn);

    const speechToTextBtn = document.createElement('button');
    speechToTextBtn.className = 'btn btn-sm';
    speechToTextBtn.id = isSingle ? 'speechToTextBtn' : `${panelId}-speechToTextBtn`;
    speechToTextBtn.title = 'Speech to Text';
    speechToTextBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    actions.appendChild(speechToTextBtn);
    
    container.appendChild(actions);
    
    return container;
  }

  createTerminalsContainer(panelId, isSingle = false) {
    const container = document.createElement('div');
    container.className = 'terminals-container';
    container.id = isSingle ? 'terminalsContainer' : `${panelId}-terminalsContainer`;
    
    // Add empty state
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.id = isSingle ? 'emptyState' : `${panelId}-emptyState`;
    emptyState.innerHTML = `
      <i class="fas fa-terminal"></i>
      <h3>No Active Sessions</h3>
      <p>Connect to a server using SSH or SFTP</p>
      <div class="empty-actions">
        <button class="btn btn-primary" id="${isSingle ? 'quickSshBtn' : `${panelId}-quickSshBtn`}">
          <i class="fas fa-plug"></i> Quick SSH
        </button>
        <button class="btn btn-primary" id="${isSingle ? 'quickSftpBtn' : `${panelId}-quickSftpBtn`}">
          <i class="fas fa-folder-open"></i> Quick SFTP
        </button>
      </div>
    `;
    container.appendChild(emptyState);
    
    return container;
  }

  attachPanelEventListeners(panelId) {
    // For single panel (panel-0), use original IDs without prefix
    const isSingle = panelId === 'panel-0';
    const prefix = isSingle ? '' : `${panelId}-`;
    
    // Font size buttons
    const decreaseBtn = document.getElementById(isSingle ? 'decreaseFontBtn' : `${panelId}-decreaseFontBtn`);
    const increaseBtn = document.getElementById(isSingle ? 'increaseFontBtn' : `${panelId}-increaseFontBtn`);
    
    if (decreaseBtn) {
      decreaseBtn.addEventListener('click', () => this.handleFontSizeChange(panelId, -1));
    }
    if (increaseBtn) {
      increaseBtn.addEventListener('click', () => this.handleFontSizeChange(panelId, 1));
    }
    
    // Special keys button — touch + click pattern so it works on mobile & desktop
    const specialKeysBtn = document.getElementById(isSingle ? 'specialKeysBtn' : `${panelId}-specialKeysBtn`);
    this._wireActionBtn(specialKeysBtn, () => this.handleSpecialKeys(panelId));

    // Speech-to-text button (terminal tabs only — gating handled in handler)
    const speechToTextBtn = document.getElementById(isSingle ? 'speechToTextBtn' : `${panelId}-speechToTextBtn`);
    this._wireActionBtn(speechToTextBtn, () => this.handleSpeechToText(panelId));
    
    // Quick SSH/SFTP buttons in empty state
    const quickSshBtn = document.getElementById(isSingle ? 'quickSshBtn' : `${panelId}-quickSshBtn`);
    const quickSftpBtn = document.getElementById(isSingle ? 'quickSftpBtn' : `${panelId}-quickSftpBtn`);
    
    if (quickSshBtn) {
      quickSshBtn.addEventListener('click', () => {
        this.openConnectionModal('ssh');
      });
    }
    if (quickSftpBtn) {
      quickSftpBtn.addEventListener('click', () => {
        this.openConnectionModal('sftp');
      });
    }
    
    // Scroll arrows
    const scrollLeftBtn = document.getElementById(isSingle ? 'scrollLeftBtn' : `${panelId}-scrollLeftBtn`);
    const scrollRightBtn = document.getElementById(isSingle ? 'scrollRightBtn' : `${panelId}-scrollRightBtn`);
    const tabsContainer = document.getElementById(isSingle ? 'tabs' : `${panelId}-tabs`);
    
    if (scrollLeftBtn && tabsContainer) {
      scrollLeftBtn.addEventListener('click', () => {
        tabsContainer.scrollBy({ left: -100, behavior: 'smooth' });
      });
    }
    if (scrollRightBtn && tabsContainer) {
      scrollRightBtn.addEventListener('click', () => {
        tabsContainer.scrollBy({ left: 100, behavior: 'smooth' });
      });
    }
    
    // Add scroll event listener to update arrow states
    if (tabsContainer) {
      tabsContainer.addEventListener('scroll', () => {
        this.updateTabsScrollArrows();
      });
      
      // Add ResizeObserver to update arrows when container size changes
      const resizeObserver = new ResizeObserver(() => {
        this.updateTabsScrollArrows();
      });
      resizeObserver.observe(tabsContainer);
    }
    
    // Mobile tabs dropdown
    const mobileToggle = document.getElementById(isSingle ? 'mobileTabsToggle' : `${panelId}-mobileTabsToggle`);
    const mobileMenu = document.getElementById(isSingle ? 'mobileTabsMenu' : `${panelId}-mobileTabsMenu`);
    
    if (mobileToggle && mobileMenu) {
      mobileToggle.addEventListener('click', () => {
        mobileMenu.classList.toggle('show');
      });
    }

    // Force resize button
    const forceResizeBtn = document.getElementById(isSingle ? 'mobileForceResizeBtn' : `${panelId}-mobileForceResizeBtn`);
    if (forceResizeBtn) {
      forceResizeBtn.addEventListener('click', () => {
        const activeSessionId = this.activeSessionsByPanel.get(panelId) || this.activeSessionId;
        if (activeSessionId) {
          this.forceResizeTerminal(activeSessionId);
        }
      });
    }
  }

  // Panel-specific button handlers
  handleFontSizeChange(panelId, delta) {
    console.log('[SSHIFT] Font size change for panel:', panelId, 'delta:', delta);
    
    // Get the active session for this panel
    const activeSessionId = this.activeSessionsByPanel.get(panelId);
    
    if (!activeSessionId) {
      this.showToast('No active session in this panel', 'warning');
      return;
    }
    
    // Check if it's an SSH session
    const session = this.sessions.get(activeSessionId);
    if (session && session.terminal) {
      // Get current font size for this session (or use default)
      const currentSize = session.fontSize || this.terminalFontSize;
      const newSize = currentSize + delta;
      
      // Set font size for this session only
      this.setSessionFontSize(activeSessionId, newSize);
      return;
    }
    
    // Check if it's an SFTP session
    const sftpSession = this.sftpSessions.get(activeSessionId);
    if (sftpSession && sftpSession.terminal) {
      // Get current font size for this session (or use default)
      const currentSize = sftpSession.fontSize || this.terminalFontSize;
      const newSize = currentSize + delta;
      
      // Set font size for this SFTP session
      sftpSession.fontSize = Math.max(this.minFontSize, Math.min(this.maxFontSize, newSize));
      sftpSession.terminal.options.fontSize = sftpSession.fontSize;
      this._resetWebGLAtlas(sftpSession);
      
      if (sftpSession.fitAddon) {
        this._fitTerminal(sftpSession);
      }
      
      console.log('[SSHIFT] SFTP font size set to', sftpSession.fontSize, 'for session', activeSessionId);
      return;
    }
    
    this.showToast('No terminal found for this session', 'warning');
  }

  handleSpecialKeys(panelId) {
    console.log('[SSHIFT] Toggle special keys for panel:', panelId);
    
    // Get the active session for this panel
    const activeSessionId = this.activeSessionsByPanel.get(panelId);
    
    if (!activeSessionId) {
      this.showToast('No active session in this panel', 'warning');
      return;
    }
    
    const session = this.sessions.get(activeSessionId);
    if (!session || session.type !== 'ssh') {
      this.showToast('Special keys only work in SSH sessions', 'warning');
      return;
    }
    
    // Set this as the active session for special keys
    this.activeSessionId = activeSessionId;
    
    // Open the special keys modal
    this.openModal('specialKeysModal');
  }

  handleSpeechToText(panelId) {
    console.log('[SSHIFT] Open speech-to-text for panel:', panelId);

    const activeSessionId = this.activeSessionsByPanel.get(panelId);

    if (!activeSessionId) {
      this.showToast('No active session in this panel', 'warning');
      return;
    }

    const session = this.sessions.get(activeSessionId);
    if (!session || session.type !== 'ssh') {
      this.showToast('Speech to text only works in SSH sessions', 'warning');
      return;
    }

    // Set this as the active session so Send writes to the right terminal
    this.activeSessionId = activeSessionId;

    // Reset transcript + record button state for a fresh session
    const transcript = document.getElementById('sttTranscript');
    if (transcript) transcript.value = '';
    this._resetSttRecordButton();

    // Open the speech-to-text modal (TTS/record/wand logic comes later)
    this.openModal('speechToTextModal');
  }

  // Wire a tab-action button (keyboard, mic, etc.) with the standard
  // touch+click pattern used throughout the app. On touch devices, the
  // action fires from touchend (with a dedupe flag so the synthetic
  // click doesn't double-fire). On non-touch devices, the action fires
  // from click. The focus handler keeps focus on the terminal so the
  // virtual keyboard never pops up when the user taps a tab-action button.
  _wireActionBtn(btn, action) {
    if (!btn) return;
    btn.setAttribute('tabindex', '-1');
    btn.addEventListener('focus', () => {
      btn.blur();
      if (this.isMobile) this.focusTerminal();
    });
    let touchHandled = false;
    btn.addEventListener('touchstart', (e) => {
      if (this.isMobile) e.preventDefault();
      touchHandled = true;
    }, { passive: false });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      touchHandled = true;
      action();
    }, { passive: false });
    btn.addEventListener('mousedown', (e) => {
      if (this.isMobile) e.preventDefault();
    });
    btn.addEventListener('click', () => {
      if (touchHandled) { touchHandled = false; return; }
      action();
    });
  }

  // Cycle the merged Record/Pause button. Solving for the cleanest UX:
//   idle (label "Record") —— click ——> recording (label "Pause", red pulse)
//   recording —— click ——> stop & transcribe ——> back to idle
// "Pause" therefore really means "stop+transcribe", with the next Record
// appending additional speech to the same transcript. This avoids a 4-state
// cycle (record/pause/resume/stop) and matches the spec of "the same button
// for record and pause depending on state" — when not recording it's Record,
// when recording it's Pause.
  async _toggleSttRecord() {
    const btn = document.getElementById('sttRecordBtn');
    if (!btn) return;
    const labelEl = btn.querySelector('.stt-btn-label');
    const iconEl = btn.querySelector('i');

    if (btn.classList.contains('recording')) {
      // recording -> stop & transcribe
      btn.classList.remove('recording');
      if (iconEl) iconEl.className = 'fas fa-microphone';
      if (labelEl) labelEl.textContent = 'Record';
      btn.title = 'Start / Pause / Resume recording';
      btn.disabled = true;
      try {
        await this._sttStopAndTranscribe();
      } finally {
        btn.disabled = false;
      }
      return;
    }

    // idle -> recording
    try {
      await this._startSttRecording();
      btn.classList.add('recording');
      if (iconEl) iconEl.className = 'fas fa-pause';
      if (labelEl) labelEl.textContent = 'Pause';
      btn.title = 'Stop recording and transcribe';
    } catch (err) {
      console.error('[SSHIFT] STT start failed:', err);
      this.showToast('Could not start recording: ' + (err.message || err), 'error');
      this._resetSttRecordButton();
    }
  }

  // Stop the recorder (without resetting the button UI) and return the
  // resulting audio Blob. Resolves to null if nothing was recorded.
  _stopSttRecording() {
    return new Promise((resolve) => {
      const rec = this._sttRecorder;
      if (!rec || rec.state === 'inactive') {
        resolve(null);
        return;
      }
      const chunks = this._sttChunks || [];
      const finish = () => {
        try {
          const type = rec.mimeType || 'audio/webm';
          resolve(new Blob(chunks, { type }));
        } catch (e) {
          resolve(null);
        }
      };
      rec.addEventListener('stop', finish, { once: true });
      try { rec.requestData(); } catch (_) {}
      try { rec.stop(); } catch (_) { resolve(null); }
      if (this._sttStream) {
        this._sttStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
        this._sttStream = null;
      }
    });
  }

  async _startSttRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access is not available in this browser');
    }

    // Tear down any previous session first.
    this._cleanupSttRecording();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    this._sttStream = stream;
    this._sttChunks = [];

    // Pick a supported mime type: webm/opus first (Chrome), then ogg, then
    // whatever the browser offers. DeepInfra's whisper endpoint accepts the
    // common container formats.
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4'
    ];
    const mimeType = candidates.find(c => window.MediaRecorder && MediaRecorder.isTypeSupported(c)) || '';

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    this._sttRecorder = recorder;
    this._sttRecorderMime = mimeType || recorder.mimeType || 'audio/webm';

    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) this._sttChunks.push(e.data);
    });

    recorder.start(1000); // collect data in 1s chunks so stop() is fast
  }

  _cleanupSttRecording() {
    try {
      if (this._sttRecorder && this._sttRecorder.state !== 'inactive') {
        this._sttRecorder.stop();
      }
    } catch (_) {}
    if (this._sttStream) {
      this._sttStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
      this._sttStream = null;
    }
    this._sttRecorder = null;
    this._sttChunks = null;
  }

  // Transcribe whatever is currently recorded by sending it to the STT
  // proxy. Appends the returned text to the transcript textarea.
  async _sttStopAndTranscribe() {
    const transcript = document.getElementById('sttTranscript');
    const blob = await this._stopSttRecording();
    this._resetSttRecordButton();
    if (!blob || blob.size === 0) {
      this.showToast('No audio to transcribe', 'warning');
      return;
    }
    const ext = (this._sttRecorderMime || 'audio/webm').includes('mp4') ? 'm4a'
              : (this._sttRecorderMime || '').includes('ogg') ? 'ogg'
              : 'webm';
    const filename = `sshift-recording-${Date.now()}.${ext}`;
    // Show an inline spinner + "Transcribing…" label in the modal controls
    // row instead of a toast, so the user sees feedback right where they
    // clicked. Also disable the Record/Wand buttons while in flight.
    const setStatus = (visible, label) => {
      const s = document.getElementById('sttStatus');
      if (s) {
        s.hidden = !visible;
        const l = s.querySelector('.stt-status-label');
        if (l && label) l.textContent = label;
      }
      const recBtn = document.getElementById('sttRecordBtn');
      const wandBtn = document.getElementById('sttWandBtn');
      if (recBtn) recBtn.disabled = visible;
      if (wandBtn) wandBtn.disabled = visible;
    };
    try {
      setStatus(true, 'Transcribing…');
      const res = await fetch('/api/speech-ai/stt', {
        method: 'POST',
        headers: {
          'Content-Type': this._sttRecorderMime || 'audio/webm',
          'X-Audio-Filename': filename
        },
        body: blob
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const data = await res.json();
      const text = (data.text || '').trim();
      if (!text) {
        this.showToast('No speech detected', 'warning');
        return;
      }
      if (transcript) {
        const prev = transcript.value.trim();
        transcript.value = prev ? (prev + ' ' + text) : text;
        transcript.scrollTop = transcript.scrollHeight;
      }
    } catch (err) {
      console.error('[SSHIFT] STT transcription failed:', err);
      this.showToast('Transcription failed: ' + (err.message || err), 'error');
    } finally {
      setStatus(false, 'Transcribing…');
    }
  }

  // Send the transcript to the Wand proxy and replace the textarea with the
  // cleaned version returned by the LLM.
  async _sttRunWand() {
    const transcript = document.getElementById('sttTranscript');
    if (!transcript) return;
    const text = transcript.value.trim();
    if (!text) {
      this.showToast('Nothing to clean up yet', 'warning');
      return;
    }
    const wandBtn = document.getElementById('sttWandBtn');
    const setBusy = (busy) => {
      if (!wandBtn) return;
      wandBtn.disabled = busy;
      wandBtn.style.opacity = busy ? '0.6' : '';
      const iconEl = wandBtn.querySelector('i');
      const labelEl = wandBtn.querySelector('.stt-btn-label');
      if (busy) {
        wandBtn.dataset.origIcon = iconEl ? iconEl.className : '';
        if (iconEl) iconEl.className = 'fas fa-spinner fa-spin';
        if (labelEl) labelEl.textContent = 'Cleaning…';
      } else {
        if (iconEl && wandBtn.dataset.origIcon) iconEl.className = wandBtn.dataset.origIcon;
        if (labelEl) labelEl.textContent = 'Wand';
      }
    };
    setBusy(true);
    try {
      const res = await fetch('/api/speech-ai/wand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${txt}`);
      }
      const data = await res.json();
      const cleaned = (data.text || '').trim();
      if (cleaned) {
        transcript.value = cleaned;
        transcript.scrollTop = transcript.scrollHeight;
        this.showToast('Cleaned up', 'success');
      } else {
        this.showToast('Wand returned nothing', 'warning');
      }
    } catch (err) {
      console.error('[SSHIFT] Wand failed:', err);
      this.showToast('Wand failed: ' + (err.message || err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Reset the Record/Pause button to its idle state and stop any active
  // mic stream. Used when the modal closes.
  _resetSttRecordButton() {
    this._cleanupSttRecording();
    const btn = document.getElementById('sttRecordBtn');
    if (!btn) return;
    btn.classList.remove('recording', 'paused');
    btn.disabled = false;
    const labelEl = btn.querySelector('.stt-btn-label');
    const iconEl = btn.querySelector('i');
    if (iconEl) iconEl.className = 'fas fa-microphone';
    if (labelEl) labelEl.textContent = 'Record';
    btn.title = 'Start / Pause / Resume recording';
  }

  // Enable/disable terminal-only tab action buttons (keyboard + mic) based
  // on the active session type for the given panel. SFTP tabs disable them.
  updateTabActionButtons(panelId) {
    const isSingle = panelId === 'panel-0';
    const keysBtnId = isSingle ? 'specialKeysBtn' : `${panelId}-specialKeysBtn`;
    const micBtnId = isSingle ? 'speechToTextBtn' : `${panelId}-speechToTextBtn`;

    const keysBtn = document.getElementById(keysBtnId);
    const micBtn = document.getElementById(micBtnId);

    const activeSessionId = this.activeSessionsByPanel.get(panelId);
    const session = activeSessionId ? this.sessions.get(activeSessionId) : null;
    const enabled = !!(session && session.type === 'ssh');

    [keysBtn, micBtn].forEach(btn => {
      if (!btn) return;
      if (enabled) {
        btn.removeAttribute('disabled');
        btn.classList.remove('disabled');
      } else {
        btn.setAttribute('disabled', 'disabled');
        btn.classList.add('disabled');
      }
    });
  }

  async initLayoutSystem() {
    console.log('[SSHIFT] Initializing layout system...');
    
    // Load layouts
    this.layouts = await this.loadLayouts();
    
    // Apply any pending layout sync that arrived before layouts were loaded
    if (this.pendingLayoutSync) {
      console.log('[SSHIFT] Applying pending layout sync:', this.pendingLayoutSync);
      const pendingLayoutId = this.pendingLayoutSync;
      this.pendingLayoutSync = null;
      this.setLayoutFromServer(pendingLayoutId);
      return; // setLayoutFromServer handles everything
    }
    
    // Get saved layout or default to 'single'
    const savedLayoutId = this.loadCurrentLayout();
    const layout = this.layouts.find(l => l.id === savedLayoutId) || this.layouts[0];
    
    // Check if we should defer layout application (sticky mode with saved tabs)
    const savedData = this.loadTabs();
    const savedTabs = Array.isArray(savedData) ? savedData : (savedData?.tabs || []);
    const shouldDeferLayout = this.sticky && savedTabs.length > 0;
    
    if (layout) {
      this.currentLayout = layout;
      this.updateLayoutActiveState(layout.id);
      
      // Only apply layout if not deferring to restoreTabs()
      if (!shouldDeferLayout) {
        this.applyLayout(layout);
        // Resize terminals after initial layout (with delay for DOM to settle)
        setTimeout(() => this.handleResize(), 100);
      }
    }
    
    console.log('[SSHIFT] Layout system initialized with layout:', layout?.name, 
                shouldDeferLayout ? '(deferred to restoreTabs)' : '');
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
    
    // Register socket listeners FIRST, before any async operations,
    // so we don't miss the open-tabs event on initial connection.
    this.setupSocketListeners();
    
    await this.checkAuthStatus();
    
    // Fix mobile viewport height issues
    this.fixMobileViewport();
    
    // Listen for devicePixelRatio changes (browser zoom, monitor move, etc.).
    // DPR changes invalidate the WebGL glyph atlas because cell metrics are
    // derived from CSS pixels * DPR — a different DPR means every cached
    // glyph is now the wrong size and must be re-rasterised.
    this._setupDPRListener();
    
    // Load sticky config first
    await this.loadStickyConfig();
    
    // Update sticky checkbox to reflect loaded value
    this.updateStickyCheckbox();
    
    // Initialize layout system (must be before setupEventListeners)
    await this.initLayoutSystem();
    
    this.setupEventListeners();
    this.loadBookmarks(); // This will also load folders
    this.applySidebarState();
    this.initThemeAndAccent(); // Initialize theme and accent
    
    // Load terminal font size
    this.terminalFontSize = this.loadTerminalFontSize();
    
    // Update terminal color UI to reflect loaded settings
    this.updateTerminalColorOverrideUI();
    
    // In sticky mode, the server is the single source of truth for tabs.
    // We WAIT for the open-tabs event from the server instead of
    // restoring from localStorage. If the server is unreachable or
    // reports 0 active tabs (e.g. after a server restart), we treat it
    // as a fresh slate and DO NOT resurrect stale localStorage tabs —
    // the SSH sessions those tabs represented are GONE on the server,
    // so reopening them as fresh connections would silently spawn
    // duplicate sessions and confuse every other connected client.
    //
    // The 3s fallback below used to call restoreTabs() on timeout,
    // which auto-reconnected to all sessions in localStorage. That
    // behavior is removed: if the server doesn't respond within 3s we
    // just clear the stale localStorage cache so the next saveTabs()
    // doesn't re-broadcast it to other clients.
    if (this.sticky) {
      this._serverSyncTimeout = setTimeout(() => {
        if (!this._initialSyncDone) {
          console.warn('[SSHIFT] Server tabs not received within 3s timeout — starting with a fresh slate.');
          // Clear any stale localStorage tab cache so a future saveTabs
          // doesn't broadcast dead sessions to other clients.
          try { this.clearTabs(); } catch (_) {}
          // Drop the wait flag so any pending syncTabsFromServer busy-wait
          // doesn't block forever (it watches `this.isRestoring`).
          this.isRestoring = false;
          this._initialSyncDone = true;
        }
      }, 3000);
    }
    
    // Initialize mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Initialize mobile keys bar
    this.initMobileKeysBar();
    
    // Initialize security info dialog
    this.initSecurityInfoDialog();
    
    // Initialize version check and update functionality
    this.initVersionCheck();
    
    this.handleResize();
    console.log('[SSHIFT] Client initialized');
    
    // Mark init as complete and process any deferred open-tabs
    this._initReady = true;
    if (this._pendingOpenTabs) {
      console.log('[SSHIFT] Processing deferred open-tabs');
      const pendingData = this._pendingOpenTabs;
      const isInitialSync = this._pendingOpenTabsIsInitial;
      this._pendingOpenTabs = null;
      this._pendingOpenTabsIsInitial = null;
      
      // Store server layout for mobile preservation
      if (pendingData.layout) {
        this._serverLayout = pendingData.layout;
      }
      
      // Prevent saveTabs from emitting to server during deferred sync
      const wasSyncingTabs = this.isSyncingTabs;
      this.isSyncingTabs = true;
      
      try {
        if (pendingData.tabs.length > 0) {
          // Sync layout BEFORE tabs so panels exist before distribution
          if (pendingData.layout && !this.isMobile) {
            this.setLayoutFromServer(pendingData.layout);
          }
          this.syncTabsFromServer(pendingData.tabs, isInitialSync, pendingData.activeTabsByPanel);
        } else {
          // Server has no tabs (e.g. right after restart). Treat it as a
          // fresh slate: clear stale localStorage and DO NOT resurrect
          // those sessions — they're gone on the server.
          if (pendingData.layout && !this.isMobile) {
            this.setLayoutFromServer(pendingData.layout);
          }
          try { this.clearTabs(); } catch (_) {}
        }
      } finally {
        this.isSyncingTabs = wasSyncingTabs;
      }
    }
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
    
    // Update mobile detection on resize and re-apply layout if needed
    window.addEventListener('resize', () => {
      const wasMobile = this.isMobile;
      this.isMobile = window.innerWidth <= 768;
      
      // If we switched between mobile and desktop, re-apply the layout
      if (wasMobile !== this.isMobile && this.currentLayout) {
        console.log('[SSHIFT] Viewport changed, re-applying layout for', this.isMobile ? 'mobile' : 'desktop');
        this.terminalFontSize = this.isMobile ? 11 : 14;
        this.setTerminalFontSize(this.terminalFontSize);
        this.applyLayout(this.currentLayout);
        this.updateMobileTabsDropdown();
      }
    });
  }

  // Mobile scroll behavior - hide/show header and tabs
  setupMobileScrollBehavior(sessionId) {
    if (!this.isMobile) return;
    
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    const terminal = session.terminal;
    
    console.log('[SSHIFT] Setting up mobile scroll behavior for session:', sessionId);
    
    session.lastScrollTop = 0;
    session.lastTouchY = 0;
    session.isScrolling = false;
    session.isAtBottom = true;
    session.touchAccumulator = 0;
    
    session.initialPinchDistance = 0;
    session.lastPinchDistance = 0;
    session.isPinching = false;
    
    terminal.onScroll(() => {
      this.handleMobileScroll(sessionId);
      this.checkIfAtBottom(sessionId);
    });
    
    const terminalElement = terminal.element;
    if (terminalElement) {
      console.log('[SSHIFT] Terminal element found, setting up touch handlers');
      
      const scrollableElement = terminalElement.querySelector('.xterm-scrollable-element') || terminalElement;
      const viewportElement = terminalElement.querySelector('.xterm-viewport');
      
      const setupTouchScrollHandlers = (element, elementName) => {
        if (!element) {
          console.log(`[SSHIFT] ${elementName} not found`);
          return;
        }
        
        console.log(`[SSHIFT] Setting up touch scroll handlers on ${elementName}`);
        
        element.addEventListener('touchstart', (e) => {
          if (e.touches.length === 1) {
            session.lastTouchY = e.touches[0].clientY;
            session.isScrolling = true;
            session.touchAccumulator = 0;
          } else if (e.touches.length === 2) {
            session.isPinching = true;
            session.isScrolling = false;
            session.initialPinchDistance = this.getPinchDistance(e.touches[0], e.touches[1]);
            session.lastPinchDistance = session.initialPinchDistance;
          }
        }, { passive: true });
        
        element.addEventListener('touchmove', (e) => {
          if (e.touches.length === 1 && session.isScrolling) {
            e.preventDefault();

            const currentTouchY = e.touches[0].clientY;
            const touchDiff = session.lastTouchY - currentTouchY;
            session.lastTouchY = currentTouchY;
            session.touchAccumulator += touchDiff;

            const lineHeight = terminal._core?._renderService?.dimensions?.css?.cell?.height || 20;
            const lineH = Math.max(lineHeight, 14);

            // When a TUI app has mouse tracking enabled (DECSET
            // 1000/1002/1003), scrolling should send mouse wheel
            // escape sequences directly to the PTY. Instead of
            // dispatching synthetic WheelEvents (which xterm's own
            // document-level touch handler can interfere with), we
            // generate the SGR mouse format ourselves and emit it via
            // ssh-data. SGR format: \x1b[<button;col;row;M
            // Wheel up = button 64, wheel down = button 65.
            const mouseProtocol = terminal._core?.coreMouseService?.activeProtocol;
            const tuiMouseActive = mouseProtocol && mouseProtocol !== 'NONE';

            if (tuiMouseActive) {
              if (Math.abs(session.touchAccumulator) >= lineH) {
                // Compute the terminal cell under the touch point.
                const screenEl = terminal.element?.querySelector('.xterm-screen');
                if (screenEl) {
                  const rect = screenEl.getBoundingClientRect();
                  const cellW = terminal._core?._renderService?.dimensions?.css?.cell?.width || 8;
                  const cellH = lineHeight;
                  const touchX = e.touches[0].clientX - rect.left;
                  const touchY = e.touches[0].clientY - rect.top;
                  const col = Math.max(1, Math.min(terminal.cols, Math.floor(touchX / cellW) + 1));
                  const row = Math.max(1, Math.min(terminal.rows, Math.floor(touchY / cellH) + 1));

                  const scrollLines = Math.trunc(Math.abs(session.touchAccumulator) / lineH);
                  const direction = session.touchAccumulator > 0 ? 1 : -1; // 1 = scroll down, -1 = scroll up
                  for (let i = 0; i < scrollLines; i++) {
                    // button 64 = wheel up, 65 = wheel down
                    const button = direction > 0 ? 65 : 64;
                    const seq = `\x1b[<${button};${col};${row}M`;
                    if (session.connected && session.isController) {
                      this.socket.emit('ssh-data', { sessionId, data: seq });
                    }
                  }
                  session.touchAccumulator = 0;
                }
              }
            } else {
              const linesToScroll = Math.trunc(Math.abs(session.touchAccumulator) / lineH);
              if (linesToScroll > 0) {
                const direction = session.touchAccumulator > 0 ? 1 : -1;
                terminal.scrollLines(direction * linesToScroll);
                session.touchAccumulator -= direction * linesToScroll * lineH;
              }
            }
          } else if (e.touches.length === 2 && session.isPinching) {
            e.preventDefault();
            
            const currentDistance = this.getPinchDistance(e.touches[0], e.touches[1]);
            const distanceDiff = currentDistance - session.lastPinchDistance;
            
            const fontSizeChange = distanceDiff * 0.1;
            
            if (Math.abs(fontSizeChange) >= 0.5) {
              // Per-session font sizing: use setSessionFontSize so we
              // don't clobber other sessions' personalised font sizes
              // when pinch-zooming. (The legacy setTerminalFontSize()
              // would force every terminal to the same value.)
              const currentSessionSize = session.fontSize || this.terminalFontSize;
              const newFontSize = Math.round(currentSessionSize + fontSizeChange);

              if (newFontSize !== currentSessionSize) {
                this.setSessionFontSize(session.id, newFontSize);
              }
            }

            session.lastPinchDistance = currentDistance;
          }
        }, { passive: false });
        
        element.addEventListener('touchend', (e) => {
          if (e.touches.length === 0) {
            if (session.isPinching) {
              session.isPinching = false;
            }
            session.isScrolling = false;
            session.initialPinchDistance = 0;
            session.lastPinchDistance = 0;
            session.touchAccumulator = 0;
            
            setTimeout(() => {
              this.checkIfAtBottom(sessionId);
            }, 100);
          } else if (e.touches.length === 1) {
            session.isPinching = false;
            session.initialPinchDistance = 0;
            session.lastPinchDistance = 0;
            session.lastTouchY = e.touches[0].clientY;
            session.isScrolling = true;
            session.touchAccumulator = 0;
          }
        }, { passive: true });
      };
      
      setupTouchScrollHandlers(scrollableElement, 'scrollable');
      if (viewportElement && viewportElement !== scrollableElement) {
        setupTouchScrollHandlers(viewportElement, 'viewport');
      }
      
      console.log('[SSHIFT] Mobile touch scroll enabled with terminal.scrollLines()');
      
    } else {
      console.warn('[SSHIFT] Terminal element not found for touch handlers');
    }
  }
  
  // Calculate distance between two touch points
  getPinchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  // Setup wheel scroll handler for desktop
  // xterm v6's ScrollableElement handles wheel events on the viewport,
  // but .xterm-screen (z-index: 1) sits above the viewport and intercepts
  // wheel events before they reach the scroll handler.
  // This method adds a wheel listener on the terminal element itself.
  setupWheelScroll(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) return;
    
    const terminal = session.terminal;
    const terminalElement = terminal.element;
    if (!terminalElement) return;
    
const wheelHandler = (e) => {
      if (e.deltaY === 0) return;

      // If the event target is inside the custom scrollbar,
      // let xterm's ScrollableElement handle it to avoid double-scroll
      const target = e.target;
      if (target && target.closest && target.closest('.xterm-scrollable-element')) {
        return;
      }

      // When a TUI app has mouse tracking enabled, let xterm's own
      // wheel handler process the event so it translates to mouse
      // tracking escape sequences sent to the PTY. Don't intercept.
      const mouseProtocol = terminal._core?.coreMouseService?.activeProtocol;
      if (mouseProtocol && mouseProtocol !== 'NONE') {
        return;
      }

      e.preventDefault();

      let lines = 1;
      if (e.deltaMode === 1) {
        lines = Math.abs(e.deltaY);
      } else if (e.deltaMode === 0) {
        const lineHeight = terminal._core?._renderService?.dimensions?.css?.cell?.height || 20;
        lines = Math.max(1, Math.round(Math.abs(e.deltaY) / Math.max(lineHeight, 14)));
      } else {
        lines = Math.abs(e.deltaY) * terminal.rows;
      }

      const fastScrollModifier = terminal.options.fastScrollModifier;
      if (fastScrollModifier === 'alt' && e.altKey ||
          fastScrollModifier === 'ctrl' && e.ctrlKey ||
          fastScrollModifier === 'shift' && e.shiftKey) {
        lines *= (terminal.options.fastScrollSensitivity || 5);
      }

      terminal.scrollLines((e.deltaY > 0 ? 1 : -1) * lines);
    };
    
    terminalElement.addEventListener('wheel', wheelHandler, { passive: false });
    
    // Store handler for cleanup
    session.wheelHandler = wheelHandler;
    session.wheelElement = terminalElement;
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
    const currentYDisp = terminal.buffer.active.viewportY;
    
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
    const scrollTop = buffer.viewportY;
    
    // Get scroll direction
    const scrollDiff = scrollTop - session.lastScrollTop;
    
    // In xterm.js:
    // - Scrolling UP (away from bottom, into scrollback) increases ydisp
    // - Scrolling DOWN (towards bottom) decreases ydisp
    // So: scrollDiff > 0 means scrolling UP into history, scrollDiff < 0 means scrolling DOWN
    
    // On mobile, header and tabs should always remain visible
    // Only show (never hide) in case they were hidden by some other mechanism
    if (scrollDiff > 2) {
      this.showHeaderAndTabs();
    }
    
    // Update last scroll position
    session.lastScrollTop = scrollTop;
  }
  
  hideHeaderAndTabs() {
    if (this.isMobile) return;
    if (this.headerHidden) return;
    
    console.log('[SSHIFT] Hiding header and tabs');
    
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
    
    console.log('[SSHIFT] Header/tabs hidden - headerHidden:', this.headerHidden, 'tabsHidden:', this.tabsHidden);
    
    // Update mobile keys bar position if keyboard is visible
    this.updateMobileKeysBarPosition();
    
    // Refit terminal to use the new space
    this.refitActiveTerminal();
  }
  
  showHeaderAndTabs() {
    if (!this.headerHidden && !this.tabsHidden) return;
    
    console.log('[SSHIFT] Showing header and tabs');
    
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
    
    console.log('[SSHIFT] Header/tabs shown - headerHidden:', this.headerHidden, 'tabsHidden:', this.tabsHidden);
    
    // Update mobile keys bar position if keyboard is visible
    this.updateMobileKeysBarPosition();
    
    // Refit terminal to use the new space
    this.refitActiveTerminal();
  }

  refitActiveTerminal() {
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session && session.fitAddon && session.terminal && session.isController) {
        setTimeout(() => {
          this._fitTerminal(session);
        }, 350);
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
    let shouldShow = this.isMobile && this.mobileKeysBarEnabled && this.activeSessionId;
    
    // Hide mobile keys bar for SFTP tabs (SFTP doesn't need terminal input)
    if (shouldShow && this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId) || this.sftpSessions.get(this.activeSessionId);
      if (session && session.type === 'sftp') {
        shouldShow = false;
        console.log('[SSHIFT] Mobile keys bar hidden for SFTP tab');
      }
    }
    
    // Add/remove class on body to adjust layout for mobile keys bar visibility
    if (this.isMobile) {
      const wasHidden = document.body.classList.contains('mobile-keys-bar-hidden');
      const shouldHide = !shouldShow;
      
      if (shouldHide !== wasHidden) {
        console.log('[SSHIFT] Updating body class, shouldHide:', shouldHide, 'wasHidden:', wasHidden);
        if (shouldHide) {
          document.body.classList.add('mobile-keys-bar-hidden');
        } else {
          document.body.classList.remove('mobile-keys-bar-hidden');
        }
        // Force layout recalculation
        void document.body.offsetHeight;
        
        // Trigger resize event to recalculate terminal and SFTP container sizes
        window.dispatchEvent(new Event('resize'));
      }
    }
    
    if (shouldShow) {
      mobileKeysBar.classList.add('visible');
      // Set the mobile keys bar height CSS variable for layout calculations
      const heights = this.getFixedUIHeights();
      document.documentElement.style.setProperty('--mobile-keys-bar-height', `${heights.mobileKeysBar}px`);
      console.log('[SSHIFT] Mobile keys bar shown');
    } else {
      mobileKeysBar.classList.remove('visible');
      // Remove the mobile keys bar height CSS variable when hidden
      document.documentElement.style.removeProperty('--mobile-keys-bar-height');
      console.log('[SSHIFT] Mobile keys bar hidden');
    }
  }

  // Helper to get actual element heights from computed styles
  getComputedHeight(selector, defaultHeight) {
    const element = document.querySelector(selector);
    if (!element) return defaultHeight;
    
    const style = window.getComputedStyle(element);
    const height = parseFloat(style.height) || 0;
    const marginTop = parseFloat(style.marginTop) || 0;
    const marginBottom = parseFloat(style.marginBottom) || 0;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    
    // Return total occupied height
    return height + marginTop + marginBottom + paddingTop + paddingBottom + borderTop + borderBottom;
  }

  // Calculate all fixed UI element heights dynamically
  getFixedUIHeights() {
    const headerHeight = this.getComputedHeight('.header', 43);
    const tabsHeight = this.getComputedHeight('.tabs-container', 35);
    const mobileKeysBarHeight = this.getComputedHeight('.mobile-keys-bar', 75);
    
    return {
      header: headerHeight,
      tabs: tabsHeight,
      mobileKeysBar: mobileKeysBarHeight,
      total: headerHeight + tabsHeight + mobileKeysBarHeight
    };
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
          
          // Get heights dynamically
          const heights = this.getFixedUIHeights();
          
          if (keyboardHeight > 50) {
            this.currentKeyboardHeight = keyboardHeight;
            
            if (this.headerHidden || this.tabsHidden) {
              this.showHeaderAndTabs();
            }
            
            const header = document.querySelector('.header');
            const tabsContainer = document.querySelector('.tabs-container');
            const vvOffsetTop = window.visualViewport.offsetTop || 0;
            
            if (header) {
              header.style.position = 'fixed';
              header.style.top = `${vvOffsetTop}px`;
              header.style.left = '0';
              header.style.right = '0';
              header.style.zIndex = '100';
            }
            if (tabsContainer) {
              tabsContainer.style.position = 'fixed';
              tabsContainer.style.top = `${vvOffsetTop + heights.header}px`;
              tabsContainer.style.left = '0';
              tabsContainer.style.right = '0';
              tabsContainer.style.zIndex = '45';
            }
            
            let keysBarBottom = keyboardHeight;
            keysBarBottom += 3;
            keysBarBottom = Math.max(0, keysBarBottom);
            
            console.log('[SSHIFT] Keyboard open - keyboardHeight:', keyboardHeight, 
                       'header hidden:', this.headerHidden, '(' + heights.header + 'px)',
                       'tabs hidden:', this.tabsHidden, '(' + heights.tabs + 'px)',
                       'keysBarBottom:', keysBarBottom);
            
            mobileKeysBar.style.bottom = `${keysBarBottom}px`;
            
            document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
            document.documentElement.style.setProperty('--viewport-height', `${viewportHeight}px`);
            document.documentElement.style.setProperty('--mobile-keys-bar-height', `${heights.mobileKeysBar}px`);
            document.documentElement.style.setProperty('--vv-offset-top', `${vvOffsetTop}px`);
            
            document.body.classList.add('keyboard-visible');
          } else {
            mobileKeysBar.style.bottom = '0px';
            this.currentKeyboardHeight = 0;
            
            const header = document.querySelector('.header');
            const tabsContainer = document.querySelector('.tabs-container');
            
            if (header) {
              header.style.top = '';
              header.style.left = '';
              header.style.right = '';
            }
            if (tabsContainer) {
              tabsContainer.style.top = '';
              tabsContainer.style.left = '';
              tabsContainer.style.right = '';
            }
            
            if (this.headerHidden || this.tabsHidden) {
              this.showHeaderAndTabs();
            }
            
            document.documentElement.style.removeProperty('--keyboard-height');
            document.documentElement.style.removeProperty('--viewport-height');
            document.documentElement.style.removeProperty('--mobile-keys-bar-height');
            document.documentElement.style.removeProperty('--vv-offset-top');
            
            document.body.classList.remove('keyboard-visible');
          }
          
          // Refit the active terminal to use the new available space
          // Delay to allow CSS changes to take effect
          setTimeout(() => {
            this.refitActiveTerminal();
          }, 100);
        }
      };
      
      window.visualViewport.addEventListener('resize', updatePosition);
      
      // Also listen for visual viewport scroll to keep header/tabs pinned
      // Android can scroll the visual viewport when keyboard is open
      const updateHeaderPosition = () => {
        if (this.currentKeyboardHeight > 50) {
          const header = document.querySelector('.header');
          const tabsContainer = document.querySelector('.tabs-container');
          const heights = this.getFixedUIHeights();
          const vvOffsetTop = window.visualViewport.offsetTop || 0;
          
          if (header) {
            header.style.position = 'fixed';
            header.style.top = `${vvOffsetTop}px`;
            header.style.left = '0';
            header.style.right = '0';
          }
          if (tabsContainer) {
            tabsContainer.style.position = 'fixed';
            tabsContainer.style.top = `${vvOffsetTop + heights.header}px`;
            tabsContainer.style.left = '0';
            tabsContainer.style.right = '0';
          }
          document.documentElement.style.setProperty('--vv-offset-top', `${vvOffsetTop}px`);
        }
      };
      
      window.visualViewport.addEventListener('scroll', updateHeaderPosition);
      
      // Initial update
      updatePosition();
    }
  }
  
  // Update mobile keys bar position when header/tabs visibility changes
  updateMobileKeysBarPosition() {
    if (!this.isMobile) return;
    
    const mobileKeysBar = document.querySelector('.mobile-keys-bar');
    if (!mobileKeysBar) return;
    
    // Only update if keyboard is visible
    if (this.currentKeyboardHeight <= 50) return;
    
    // Position the mobile keys bar just above the keyboard
    // The keyboard height is measured from the bottom of the window,
    // so we position the bar at that height plus a small buffer
    let keysBarBottom = this.currentKeyboardHeight;
    
    // Add small buffer to prevent gap between bar and keyboard
    keysBarBottom += 3;
    
    // Ensure we don't go below 0
    keysBarBottom = Math.max(0, keysBarBottom);
    
    // Update the position
    mobileKeysBar.style.bottom = `${keysBarBottom}px`;
    
    console.log('[SSHIFT] Updated mobile keys bar position:', keysBarBottom, 'px (keyboardHeight:', this.currentKeyboardHeight, 'header hidden:', this.headerHidden, 'tabs hidden:', this.tabsHidden, ')');
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
    
    // Make all mobile key buttons unfocusable - they must never steal focus
    // from the terminal's hidden textarea (which would close the virtual keyboard)
    keys.forEach(key => key.setAttribute('tabindex', '-1'));
    
    keys.forEach(key => {
      const keyName = key.dataset.key;
      if (!keyName) return;
      
      // If a button ever receives focus, immediately redirect it back
      // to the terminal. On mobile this prevents the virtual keyboard
      // from collapsing when a key bar button is tapped.
      key.addEventListener('focus', () => {
        key.blur();
        this.focusTerminal();
      });
      
      let touchHandled = false;
      
      key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchHandled = true;
      }, { passive: false });
      
      key.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (key.classList.contains('mobile-key-modifier')) {
          if (keyName === 'ctrl') {
            this.ctrlPressed = !this.ctrlPressed;
            key.classList.toggle('active', this.ctrlPressed);
          } else if (keyName === 'alt') {
            this.altPressed = !this.altPressed;
            key.classList.toggle('active', this.altPressed);
          }
        } else {
          this.sendMobileKey(keyName);
        }
      }, { passive: false });
      
      key.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      
      key.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (touchHandled) { touchHandled = false; return; }
        
        if (key.classList.contains('mobile-key-modifier')) {
          if (keyName === 'ctrl') {
            this.ctrlPressed = !this.ctrlPressed;
            key.classList.toggle('active', this.ctrlPressed);
          } else if (keyName === 'alt') {
            this.altPressed = !this.altPressed;
            key.classList.toggle('active', this.altPressed);
          }
          this.focusTerminal();
        } else {
          this.sendMobileKey(keyName);
        }
      });
    });
    
    // Safety net: if focus somehow lands inside the keys bar, redirect
    // it back to the terminal immediately
    mobileKeysBar.addEventListener('focusin', (e) => {
      if (e.target) e.target.blur();
      this.focusTerminal();
    });
    
    // Initial visibility update
    this.updateMobileKeysBar();
  }

  focusTerminal() {
    // Focus the active terminal
    if (this.activeSessionId) {
      const session = this.sessions.get(this.activeSessionId);
      if (session) {
        // On mobile, use the mobile handler's hidden textarea
        if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
          session.mobileHandler._focusHiddenTextarea();
        } else if (session.terminal && session.terminal.textarea) {
          session.terminal.textarea.focus();
        }
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
    if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
      session.mobileHandler._focusHiddenTextarea();
    } else if (terminal.textarea) {
      terminal.textarea.focus();
    }
  }

  async restoreTabs() {
    /**
     * DEPRECATED — server restart now produces a fresh slate with
     * 0 active sessions (no localStorage-based tab reconstruction).
     *
     * The previous behavior auto-SSH-connected to every tab the user
     * had open before the restart. Because the underlying SSH
     * sessions are GONE on the server, this silently spawned brand-
     * new SSH connections AND broadcast them to every other client
     * as if they were the original sessions — confusing sticky
     * state across devices. The user-visible contract is now: server
     * restart = blank client.
     *
     * Former call sites now invoke clearTabs() to drop the stale
     * localStorage cache and start empty. This method remains as a
     * no-op for any external callers (legacy extensions, plugins) so
     * they don't accidentally resurrect sessions.
     */
    console.log('[SSHIFT] restoreTabs() is deprecated — clearing stale localStorage cache.');
    try { this.clearTabs(); } catch (_) {}
    this.isRestoring = false;
    this._initialSyncDone = true;
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
      const wasDisconnected = this._wasDisconnected;
      this._wasDisconnected = false;
      if (wasDisconnected && !this.isUpdating) {
        this.showToast('Reconnected to server', 'success');
      } else if (!this.isUpdating) {
        this.showToast('Connected to server', 'success');
      }
      this.loadBookmarks();
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[SSHIFT] Disconnected from server:', reason);
      this._wasDisconnected = true;
      if (reason === 'io server disconnect') {
        // Server intentionally disconnected us (e.g. auth failure) — don't auto-reconnect
        // Socket.IO won't retry after server-initiated disconnect anyway
      } else if (!this.isUpdating) {
        this.showToast('Disconnected from server — will reconnect automatically', 'warning');
      }
    });

    // When the tab becomes visible again, reconnect the socket if needed
    // and refresh WebGL terminal renderers (the browser may reclaim GPU
    // memory from background tabs, invalidating the glyph texture atlas).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (!this.socket.connected) {
        console.log('[SSHIFT] Tab visible and socket disconnected, triggering reconnect');
        this.socket.connect();
      }
      this._refreshAllWebGLSessions();
      // Refit visible terminals after tab becomes visible — the container
      // may have had zero dimensions while hidden (Bugs 1 & 2).
      requestAnimationFrame(() => this.handleResize());
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SSHIFT] Connection error:', error);
      if (error.message === 'Authentication required') {
        this.authToken = null;
        localStorage.removeItem('sshift_auth_token');
        this.showLockScreen();
      }
      // Don't show generic connection error toasts during reconnection —
      // the user already sees "Disconnected" and the auto-reconnect handles it.
      // Only show for explicit user actions (not isUpdating suppresses during update).
    });

    // Handle receiving open tabs from server (for cross-tab sync)
    this.socket.on('open-tabs', (data) => {
      console.log('[SSHIFT] Received open tabs from server:', data.tabs.length);

      // Clear fallback timeout - server has responded
      if (this._serverSyncTimeout) {
        clearTimeout(this._serverSyncTimeout);
        this._serverSyncTimeout = null;
      }
      
      // Sync theme and accent from server
      if (data.theme) {
        const savedTheme = this.loadTheme();
        if (savedTheme !== data.theme) {
          console.log('[SSHIFT] Syncing theme from server:', data.theme);
          document.documentElement.setAttribute('data-theme', data.theme);
          this.theme = data.theme;
          this.saveTheme(data.theme);
          this.updateThemeIcon(data.theme);
          this.updateTerminalThemes(data.theme);
        }
      }
      
      if (data.accent) {
        const savedAccent = this.loadAccent();
        if (savedAccent !== data.accent) {
          console.log('[SSHIFT] Syncing accent from server:', data.accent);
          document.documentElement.setAttribute('data-accent', data.accent);
          this.saveAccent(data.accent);
          this.updateAccentPreview(data.accent);
          this.updateAccentActiveState(data.accent);
        }
      }
      
      // Only sync if sticky is enabled and init has completed.
      // If init hasn't finished yet (DOM not ready), defer processing
      // until init completes and the open-tabs event queue is flushed.
      if (this.sticky) {
        // Store server layout for mobile tab preservation
        if (data.layout) {
          this._serverLayout = data.layout;
        }
        // Prevent saveTabs from emitting to server during initial sync
        // (the server is our source of truth; we don't want to broadcast
        // incomplete state back to other clients)
        const wasSyncingTabs = this.isSyncingTabs;
        this.isSyncingTabs = true;
        
        try {
          if (!this._initReady) {
            console.log('[SSHIFT] Deferring open-tabs processing until init completes');
            this._pendingOpenTabs = data;
            this._pendingOpenTabsIsInitial = !this._initialSyncDone;
            this._initialSyncDone = true;
          } else if (data.tabs.length > 0) {
            const isInitialSync = !this._initialSyncDone;
            // Sync layout BEFORE tabs so panels exist before distribution
            if (data.layout && !this.isMobile) {
              this.setLayoutFromServer(data.layout);
            }
            this.syncTabsFromServer(data.tabs, isInitialSync, data.activeTabsByPanel);
          } else if (!this._initialSyncDone) {
            // Server has no tabs and this is the first sync. This is the
            // post-restart / fresh-install / single-client-with-no-sessions
            // case. Per the user contract, a server restart = new slate:
            // we do NOT auto-reconnect stale localStorage tabs (those SSH
            // sessions are gone on the server, recreating them as new
            // connections silently spawns duplicates and confuses other
            // clients). Drop the stale cache and start fresh.
            if (data.layout && !this.isMobile) {
              this.setLayoutFromServer(data.layout);
            }
            try { this.clearTabs(); } catch (_) {}
          } else if (data.layout && !this.isMobile) {
            // No tabs change, but layout may have changed
            this.setLayoutFromServer(data.layout);
          }
          this._initialSyncDone = true;
        } finally {
          // Restore previous syncing state (syncTabsFromServer manages its own)
          this.isSyncingTabs = wasSyncingTabs;
        }
      }
      // Layout sync is handled above before tab sync; skip redundant call on mobile
      // (mobile always uses single panel)
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

    this.socket.on('sessions-updated', () => {
      const modal = document.getElementById('manageSessionsModal');
      if (modal && modal.classList.contains('active')) {
        if (this._sessionsUpdateTimer) clearTimeout(this._sessionsUpdateTimer);
        this._sessionsUpdateTimer = setTimeout(() => this.loadSessions(), 300);
      }
    });

    // Handle tab order update from server
    this.socket.on('tab-order', (data) => {
      console.log('[SSHIFT] Tab order updated:', data.order);
      if (this.sticky) {
        this.reorderTabsInDOM(data.order);
        this.updateMobileTabsDropdown();
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
        
        // Update mobile tabs dropdown
        this.updateMobileTabsDropdown();
        
        // Save tabs if sticky is enabled
        this.saveTabs();
      }
    });

    // Handle layout change from another client
    this.socket.on('layout-changed', (data) => {
      console.log('[SSHIFT] Layout changed by another client:', data.layoutId);
      // Always store server layout even on mobile (for preservation in saves)
      this._serverLayout = data.layoutId;
      if (this.sticky && !this.isMobile) {
        this.setLayoutFromServer(data.layoutId);
      }
    });

    // Handle theme change from another client
    this.socket.on('theme-changed', (data) => {
      console.log('[SSHIFT] Theme changed by another client:', data.theme);
      const savedTheme = this.loadTheme();
      if (savedTheme !== data.theme) {
        document.documentElement.setAttribute('data-theme', data.theme);
        this.theme = data.theme;
        this.saveTheme(data.theme);
        this.updateThemeIcon(data.theme);
        this.updateTerminalThemes(data.theme);
      }
    });

    // Handle accent change from another client
    this.socket.on('accent-changed', (data) => {
      console.log('[SSHIFT] Accent changed by another client:', data.accent);
      const savedAccent = this.loadAccent();
      if (savedAccent !== data.accent) {
        document.documentElement.setAttribute('data-accent', data.accent);
        this.saveAccent(data.accent);
        this.updateAccentPreview(data.accent);
        this.updateAccentActiveState(data.accent);
      }
    });

    // Handle tabs sync from another client
    this.socket.on('tabs-sync', (data) => {
      console.log('[SSHIFT] Tabs sync:', data.tabs?.length || 0, 'tabs, layout:', data.layout);
      if (this.sticky) {
        // Set flag to prevent re-emission during sync
        this.isSyncingTabs = true;
        
        try {
          // Update server panel map and layout for mobile preservation
          if (data.tabs && Array.isArray(data.tabs)) {
            data.tabs.forEach(tab => {
              if (tab.sessionId && tab.panelId) {
                this._serverPanelMap.set(tab.sessionId, tab.panelId);
              }
            });
          }
          if (data.layout) {
            this._serverLayout = data.layout;
          }
          
          // Apply layout first if it's different
          if (data.layout && data.layout !== this.currentLayout?.id) {
            this.setLayoutFromServer(data.layout, data.tabs);
          } else if (data.tabs && Array.isArray(data.tabs)) {
            // Just reorder tabs without layout change
            this.distributeTabsToPanels(data.tabs);
          }
        } finally {
          // Clear flag after processing
          this.isSyncingTabs = false;
        }
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
        
        // Handle controller status
        session.isController = data.isController;
        session.controllerSocket = data.controllerSocket;
        console.log('[SSHIFT] Controller status:', data.isController ? 'in control' : 'observer', 'controller:', data.controllerSocket, 'socketCount:', data.socketCount);
        
        // Show/hide control overlay based on controller status
        this.updateControlOverlay(data.sessionId);
        
        // If takeControlDefault is enabled and we're not the controller, take control
        // BUT only if there's no controller OR we're the only client in the session
        // This prevents "control wars" where multiple clients keep taking control from each other
        if (this.takeControlDefault && !data.isController) {
          const noController = !data.controllerSocket;
          const onlyClient = data.socketCount === 1;
          
          if (noController || onlyClient) {
            console.log('[SSHIFT] takeControlDefault enabled, taking control (no controller or only client)...');
            // Delay to ensure the session is fully set up
            const delay = 100 + Math.random() * 200; // 100-300ms
            setTimeout(() => {
              this.requestTakeControl(sessionId);
            }, delay);
          } else {
            console.log('[SSHIFT] takeControlDefault enabled but not taking control - another client is already in control');
          }
        }
        
        // Focus the terminal
        if (session.terminal) {
          if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
            session.mobileHandler._focusHiddenTextarea();
          } else {
            session.terminal.focus();
          }
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
            // Decode base64 to UTF-8 string (atob produces Latin-1 binary;
            // we must re-decode as UTF-8 to preserve multi-byte characters)
            const binaryString = atob(data.state);
            const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
            state = new TextDecoder().decode(bytes);
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
          console.log('[SSHIFT] Terminal state synchronized, partial:', data.partial);

          // Clear syncing flag after sync is complete
          session.syncing = false;
          // Sync succeeded — reset the retry counter used by the
          // requestScreenSync safety timeout.
          session._syncRetries = 0;
          if (session.syncTimeout) {
            clearTimeout(session.syncTimeout);
            session.syncTimeout = null;
          }

          // If full scrollback was restored, scroll to bottom to show latest output
          if (!data.partial) {
            session.terminal.scrollToBottom();
          }
          
          // Resize terminal to match the session's dimensions if provided
          // Note: We do NOT call fit() here because:
          // 1. This client is joining an existing session and is not the controller
          // 2. The controller determines the terminal dimensions
          // 3. fit() would recalculate dimensions for the local container
          // 4. This can cause resize feedback loops between clients
          if (data.cols && data.rows) {
            try {
              // Set resyncing flag BEFORE calling resize to prevent resize feedback loop
              session.isResyncing = true;

              session.terminal.resize(data.cols, data.rows);
              console.log('[SSHIFT] Terminal resized to match server dimensions:', data.cols, 'x', data.rows);

              // The serialized state was just written into a fresh
              // buffer + the terminal was just resized. The WebGL
              // renderer's glyph atlas still holds glyphs rasterised
              // at the pre-resize cell size — painting them now would
              // produce the "interlaced / every-other-row blank" bug
              // (visible after "Take Control" on a just-refreshed
              // browser tab; fixed when the user manually resizes the
              // window because that re-runs _fitTerminal → _resetWebGLAtlas).
              // Clear the atlas here so the renderer re-rasterises at
              // the post-sync cell dimensions.
              this._resetWebGLAtlas(session);

              // Clear the resyncing flag after a short delay
              setTimeout(() => {
                session.isResyncing = false;
              }, 150);
            } catch (e) {
              console.warn('[SSHIFT] Error resizing terminal:', e.message);
              session.isResyncing = false;
            }
          }
          
          // Focus the terminal
          if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
            session.mobileHandler._focusHiddenTextarea();
          } else {
            session.terminal.focus();
          }
        });
      }
    });

    this.socket.on('ssh-resize-sync', (data) => {
      console.log('[SSHIFT] Received resize sync for session:', data.sessionId, 'cols:', data.cols, 'rows:', data.rows);
      const session = this.sessions.get(data.sessionId);
      if (session && session.terminal) {
        // Skip if dimensions are the same (no need to resize)
        if (session.terminal.cols === data.cols && session.terminal.rows === data.rows) {
          console.log('[SSHIFT] Terminal already at correct dimensions, skipping resize');
          return;
        }
        
        try {
          // Mark that we're syncing to prevent resize feedback loop
          session.isResyncing = true;
          
          // Clear any pending resize timeout to prevent duplicate resize events
          if (session.resizeTimeout) {
            clearTimeout(session.resizeTimeout);
            session.resizeTimeout = null;
          }
          
          // Resize the terminal to match the server's dimensions
          // Note: We do NOT call fit() here because:
          // 1. Non-controllers should display at the server's dimensions
          // 2. fit() would recalculate dimensions for the local container
          // 3. This can cause resize feedback loops between clients
          // The controller is responsible for determining terminal dimensions
          session.terminal.resize(data.cols, data.rows);
          console.log('[SSHIFT] Terminal resized to match server dimensions');
          
          // Clear the syncing flag after a delay to ensure resize events settle
          // Mobile browsers can have delayed resize events
          setTimeout(() => {
            session.isResyncing = false;
          }, 200);
        } catch (e) {
          console.warn('[SSHIFT] Error resizing terminal:', e.message);
          session.isResyncing = false;
        }
      }
    });

    // Handle control taken event (another client took control)
    this.socket.on('ssh-control-taken', (data) => {
      console.log('[SSHIFT] Control taken for session:', data.sessionId, 'by', data.controllerSocket);
      const session = this.sessions.get(data.sessionId);
      if (session) {
        const wasController = session.isController;
        session.isController = data.controllerSocket === this.socket.id;
        session.controllerSocket = data.controllerSocket;
        
        if (session.isController && !wasController) {
          // We just became the controller — hide overlay immediately
          // to avoid measuring stale dimensions, then resize after layout settles
          const overlay = document.getElementById(`control-overlay-${data.sessionId}`);
          if (overlay) overlay.style.display = 'none';
        }
        
        this.updateControlOverlay(data.sessionId);
        
        if (session.isController && !wasController) {
          // Resize to our container after browser finishes layout
          if (session.terminal && session.fitAddon) {
            if (session.resizeTimeout) {
              clearTimeout(session.resizeTimeout);
              session.resizeTimeout = null;
            }
            
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                if (!session.terminal || !session.fitAddon || !session.isController) return;
                try {
                  session.isResyncing = true;
                  const fitted = this._fitTerminal(session);
                  session.isResyncing = false;
                  
                  // Only send the resize if we actually fitted successfully.
                  if (fitted && session.terminal && session.connected) {
                    this.socket.emit('ssh-resize', {
                      sessionId: data.sessionId,
                      cols: session.terminal.cols,
                      rows: session.terminal.rows
                    });
                    console.log('[SSHIFT] Resized terminal after becoming controller:', session.terminal.cols, 'x', session.terminal.rows);
                  }
                  
                  setTimeout(() => {
                    if (session.terminal && session.fitAddon && session.isController) {
                      session.isResyncing = true;
                      const prevCols = session.terminal.cols;
                      const prevRows = session.terminal.rows;
                      const corrected = this._fitTerminal(session);
                      session.isResyncing = false;
                      if (corrected && (session.terminal.cols !== prevCols || session.terminal.rows !== prevRows)) {
                        this.socket.emit('ssh-resize', {
                          sessionId: data.sessionId,
                          cols: session.terminal.cols,
                          rows: session.terminal.rows
                        });
                        console.log('[SSHIFT] Corrected dimensions after becoming controller:', session.terminal.cols, 'x', session.terminal.rows);
                      }
                    }
                  }, 300);

                  setTimeout(() => {
                    if (session.terminal && session.connected && session.isController) {
                      console.log('[SSHIFT] Requesting screen sync after becoming controller to redraw at local dimensions');
                      this.requestScreenSync(data.sessionId);
                    }
                  }, 500);
                } catch (e) {
                  console.warn('[SSHIFT] Error resizing terminal after becoming controller:', e.message);
                  session.isResyncing = false;
                }
              });
            });
          }
          this.showToast('You are now in control (previous controller left)', 'info');
        } else if (!session.isController) {
          this.showToast('Another device took control', 'info');
        }
      }
    });

    // Handle control released event
    this.socket.on('ssh-control-released', (data) => {
      console.log('[SSHIFT] Control released for session:', data.sessionId, 'new controller:', data.controllerSocket);
      const session = this.sessions.get(data.sessionId);
      if (session) {
        // Update controller info
        session.controllerSocket = data.controllerSocket || null;
        session.isController = data.controllerSocket === this.socket.id;
        this.updateControlOverlay(data.sessionId);
      }
    });

    // Handle successful take control response
    this.socket.on('ssh-control-acquired', (data) => {
      console.log('[SSHIFT] Successfully took control of session:', data.sessionId);
      const session = this.sessions.get(data.sessionId);
      if (session) {
        session.isController = true;
        session.controllerSocket = this.socket.id;
        
        // Immediately hide the overlay so the terminal container can recalculate
        // its dimensions before we fit. Skip the 50ms debounce in updateControlOverlay
        // to avoid measuring stale dimensions.
        const overlay = document.getElementById(`control-overlay-${data.sessionId}`);
        if (overlay) overlay.style.display = 'none';
        this.updateControlOverlay(data.sessionId);
        
        // Resize the SSH terminal to match our local terminal dimensions
        // Use double requestAnimationFrame to ensure the browser has finished
        // layout after hiding the overlay (same pattern as tab switching).
        if (session.terminal && session.fitAddon) {
          // Clear any pending resize timeout to prevent duplicate resize events
          if (session.resizeTimeout) {
            clearTimeout(session.resizeTimeout);
            session.resizeTimeout = null;
          }
          
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (!session.terminal || !session.fitAddon || !session.isController) return;
              try {
                session.isResyncing = true;
                const fitted = this._fitTerminal(session);
                session.isResyncing = false;
                
                // Only send the resize to the server if we actually fitted the
                // terminal.  If _fitTerminal returned false (container too small,
                // not visible, etc.), the cols/rows are stale and would confuse
                // the remote PTY.  A successful retry will trigger onResize
                // which emits ssh-resize via the debounced handler.
                if (fitted && session.terminal && session.connected) {
                  this.socket.emit('ssh-resize', {
                    sessionId: data.sessionId,
                    cols: session.terminal.cols,
                    rows: session.terminal.rows
                  });
                  console.log('[SSHIFT] Resized SSH terminal after taking control:', session.terminal.cols, 'x', session.terminal.rows);
                }
                
                setTimeout(() => {
                  if (session.terminal && session.fitAddon && session.isController) {
                    session.isResyncing = true;
                    const prevCols = session.terminal.cols;
                    const prevRows = session.terminal.rows;
                    const corrected = this._fitTerminal(session);
                    session.isResyncing = false;
                    if (corrected && (session.terminal.cols !== prevCols || session.terminal.rows !== prevRows)) {
                      this.socket.emit('ssh-resize', {
                        sessionId: data.sessionId,
                        cols: session.terminal.cols,
                        rows: session.terminal.rows
                      });
                      console.log('[SSHIFT] Corrected dimensions after take control:', session.terminal.cols, 'x', session.terminal.rows);
                    }
                  }
                }, 300);

                setTimeout(() => {
                  if (session.terminal && session.connected && session.isController) {
                    console.log('[SSHIFT] Requesting screen sync after taking control to redraw at local dimensions');
                    this.requestScreenSync(data.sessionId);
                  }
                }, 500);
              } catch (e) {
                console.warn('[SSHIFT] Error resizing terminal after taking control:', e.message);
                session.isResyncing = false;
              }
            });
          });
        }
        
        this.showToast('You are now in control', 'success');
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

    // Safety timeout: if ssh-screen-sync never arrives within 5s the
    // terminal would otherwise be stuck silently dropping all output.
    // Clear the flag AND request a fresh sync. After 2 failed attempts
    // we give up to avoid hammering the server when the session is
    // actually gone.
    session._syncRetries = (session._syncRetries || 0);
    session.syncTimeout = setTimeout(() => {
      console.warn('[SSHIFT] Sync timeout for session:', sessionId, 'retries:', session._syncRetries);
      session.syncing = false;
      if (session._syncRetries < 2 && session.connected) {
        session._syncRetries += 1;
        // Re-arm by calling ourselves once more. We pass a flag via the
        // session so we don't recurse infinitely (the new timeout will
        // run with retries incremented and bail at the cap above).
        this.requestScreenSync(sessionId);
      } else {
        session._syncRetries = 0;
      }
    }, 5000);

    console.log('[SSHIFT] Requesting screen sync for session:', sessionId);
    this.socket.emit('ssh-request-sync', { sessionId });
    };

    this.socket.on('ssh-data', (data) => {
      this.onSSHData(data);
    });

    this.socket.on('ssh-error', (data) => {
      console.error('[SSHIFT] SSH Error:', data.message, 'sessionId:', data.sessionId);
      
      // If session not found and we're restoring, try to reconnect
      if (data.sessionId && data.message === 'Session not found') {
        const session = this.sessions.get(data.sessionId);
        console.log('[SSHIFT] Session found:', !!session, 'isRestoring:', session?.isRestoring);
        
        if (session && session.isRestoring && session.connectionData) {
          // Only attempt reconnection if we have auth credentials.
          // When syncing from the server, password/privateKey are stripped,
          // so reconnecting without them would fail with a misleading auth error.
          const hasCredentials = session.connectionData.password || session.connectionData.privateKey;
          if (hasCredentials) {
            console.log('[SSHIFT] Session not found on server, reconnecting with new connection...');
            this.showToast('Session expired, reconnecting...', 'warning');
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
            // No credentials available - show a user-friendly message
            console.log('[SSHIFT] Session expired and no credentials available for reconnection');
            this.showToast('Session expired. Please reconnect manually.', 'warning');
            if (session.terminal) {
              session.terminal.writeln('\x1b[33m⚠ Session expired. Please close this tab and reconnect.\x1b[0m');
            }
            // Don't close the tab - let the user see the message
            if (session.terminal) {
              session.connecting = false;
            }
            return;
          }
        } else {
          console.log('[SSHIFT] Session not eligible for reconnection, closing tab');
        }
      }
      
      // Show error toast for genuine errors (not auth failures from stripped credentials)
      const isStrippedAuthError = data.message && data.message.includes('authentication methods failed');
      if (isStrippedAuthError) {
        const session = data.sessionId ? this.sessions.get(data.sessionId) : null;
        // Suppress the auth error toast if this is a restoring/joined session without credentials
        if (session && session.isRestoring) {
          console.log('[SSHIFT] Suppressing auth error toast for restoring session without credentials');
        } else {
          this.showToast(data.message, 'error');
        }
      } else if (data.advisory) {
        // Advisory errors (rate-limit, invalid payload, bufferFull, etc.)
        // are operational warnings — log them but do NOT show a toast.
        // Showing toasts for every rate-limited sync or buffer-full event
        // is extremely annoying during normal usage like scrolling in a
        // TUI app.
        console.warn('[SSHIFT] Advisory ssh-error (tab kept open):', data.message);
      } else {
        this.showToast(data.message, 'error');
      }

      // Only close the tab for hard errors that actually break the session.
      // `advisory: true` errors (rate-limit, invalid payload, bufferFull) are
      // operational warnings and must NOT close the tab. Previously a single
      // mobile dropdown tab switch would close every tab because switchTab
      // triggers ssh-request-sync, which hit the Phase-3 rate-limit and
      // emitted an advisory ssh-error; the old closeTab-on-any-error path
      // then chained the close into server-side teardown cascades.
      if (data.sessionId && data.message !== 'Session not found' && !data.advisory) {
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

    this.socket.on('sftp-joined', (data) => {
      console.log('[SSHIFT] SFTP Joined session:', data.sessionId);
      const session = this.sftpSessions.get(data.sessionId);
      if (session) {
        session.connecting = false;
        session.isRestoring = false;
        // Navigate to the stored path or root to show the session is active
        const path = session.currentPath || '/';
        this.socket.emit('sftp-list', { sessionId: data.sessionId, path });
      }
    });

    this.socket.on('sftp-home-result', (data) => {
      console.log('[SSHIFT] sftp-home-result received:', data);
      const session = this.sftpSessions.get(data.sessionId);
      if (session && data.homeDir) {
        session.homeDir = data.homeDir;
        console.log('[SSHIFT] Stored home directory for session:', data.homeDir);

        // If the session still shows "/" as current path (initial load),
        // and listing "/" hasn't succeeded yet, navigate to home instead.
        // This gives users with chrooted SFTP a working starting directory.
        if (session.currentPath === '/' && !session._rootListSucceeded) {
          console.log('[SSHIFT] Navigating to home directory:', data.homeDir);
          session.currentPath = data.homeDir;
          const pathInput = document.querySelector(`#sftp-${data.sessionId} .sftp-path-input`);
          if (pathInput) pathInput.value = data.homeDir;
          this.socket.emit('sftp-list', { sessionId: data.sessionId, path: data.homeDir });
        }
      }
    });

    this.socket.on('sftp-list-result', (data) => {
      console.log('[SSHIFT] sftp-list-result received:', data);
      console.log('[SSHIFT] sessionId from server:', data.sessionId);
      console.log('[SSHIFT] path:', data.path);
      console.log('[SSHIFT] files count:', data.files?.length || 0);

      // Track whether root listing has succeeded (used by sftp-home-result
      // to decide whether to redirect to home directory).
      const session = this.sftpSessions.get(data.sessionId);
      if (session) {
        if (data.path === '/' && !data.redirectedFrom) {
          session._rootListSucceeded = true;
        }
        session.currentPath = data.path;
      }

      // If listing was auto-redirected from "/" to home, notify the user.
      if (data.redirectedFrom) {
        this.showToast(`Root directory (${data.redirectedFrom}) is not accessible. Showing home directory instead.`, 'info');
      }

      this.renderSFTPFileList(data.path, data.files, data.sessionId);
    });

    this.socket.on('sftp-error', (data) => {
      console.error('[SSHIFT] SFTP Error:', data.message, 'sessionId:', data?.sessionId);

      // If session not found and we're restoring, try to reconnect
      if (data?.sessionId && data.message === 'Session not found') {
        const session = this.sftpSessions.get(data.sessionId);
        
        if (session && session.isRestoring && session.connectionData) {
          // Only attempt reconnection if we have auth credentials
          const hasCredentials = session.connectionData.password || session.connectionData.privateKey;
          if (hasCredentials) {
            console.log('[SFTP] Session not found on server, reconnecting...');
            this.showToast('SFTP session expired, reconnecting...', 'warning');
            session.isRestoring = false;
            session.connecting = true;
            this.socket.emit('sftp-connect', { ...session.connectionData, sessionId: data.sessionId });
            return;
          } else {
            // No credentials available - show a user-friendly message
            console.log('[SFTP] Session expired and no credentials available for reconnection');
            this.showToast('SFTP session expired. Please reconnect manually.', 'warning');
            session.connecting = false;
            return;
          }
        }
      }

      // Suppress auth error toast for restoring sessions without credentials
      const isStrippedAuthError = data.message && data.message.includes('authentication methods failed');
      if (isStrippedAuthError) {
        const session = data?.sessionId ? this.sftpSessions.get(data.sessionId) : null;
        if (session && session.isRestoring) {
          console.log('[SSHIFT] Suppressing auth error toast for restoring SFTP session without credentials');
        } else {
          this.showToast(data.message, 'error');
        }
      } else if (data.isPermissionDenied && data.homeDir) {
        // Permission denied with a known home directory — show a helpful
        // error with a "Go Home" action instead of a bare error toast.
        this.showToast(`Permission denied: ${data.message}. Try navigating to your home directory.`, 'error');
        // Auto-navigate to home directory if we're stuck at an inaccessible path
        const session = data?.sessionId ? this.sftpSessions.get(data.sessionId) : null;
        if (session) {
          session.homeDir = data.homeDir;
          const currentPath = session.currentPath || '/';
          // Only auto-redirect if we haven't already navigated away
          const pathInput = document.querySelector(`#sftp-${data.sessionId} .sftp-path-input`);
          if (pathInput && pathInput.value === currentPath) {
            console.log('[SSHIFT] Auto-navigating SFTP to home directory:', data.homeDir);
            this.navigateSFTPPath(data.homeDir, data.sessionId);
          }
        }
      } else {
        this.showToast(data.message, 'error');
      }

      if (this._activeDownload) {
        this.hideTransferProgress(this._activeDownload.sessionId);
        this._activeDownload = null;
      }
    });

    this.socket.on('sftp-download-start', (data) => {
      this._activeDownload = {
        sessionId: data.sessionId,
        path: data.path,
        fileName: data.fileName,
        totalBytes: data.size,
        bytesDownloaded: 0,
        chunks: []
      };
      this.showTransferProgress(data.sessionId, data.fileName, 0, 0, data.size, 0, 0, false);
    });

    this.socket.on('sftp-download-chunk', (data) => {
      const dl = this._activeDownload;
      if (dl && dl.path === data.path) {
        const binaryStr = atob(data.data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        dl.chunks.push(bytes);
        dl.bytesDownloaded = data.bytesDownloaded;
        dl.totalBytes = data.totalBytes;
        const percent = data.totalBytes > 0 ? Math.round((data.bytesDownloaded / data.totalBytes) * 100) : 0;
        this.showTransferProgress(dl.sessionId, dl.fileName, percent, data.bytesDownloaded, data.totalBytes, 0, 0, false);
      }
    });

    this.socket.on('sftp-download-end', (data) => {
      const dl = this._activeDownload;
      if (dl && dl.path === data.path) {
        if (data.success) {
          const blob = new Blob(dl.chunks, { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = dl.fileName;
          a.click();
          URL.revokeObjectURL(url);
          this.showToast(`Downloaded: ${dl.fileName}`, 'success');
        }
        this.hideTransferProgress(dl.sessionId);
        this._activeDownload = null;
      }
    });

    // Bookmark sync events
    this.socket.on('bookmark-added', (bookmark) => {
      console.log('[SSHIFT] Bookmark added by another client:', bookmark.id);
      this.bookmarks.push(bookmark);
      this.renderBookmarks();
    });

    this.socket.on('bookmark-updated', (bookmark) => {
      console.log('[SSHIFT] Bookmark updated by another client:', bookmark.id);
      const index = this.bookmarks.findIndex(b => b.id === bookmark.id);
      if (index !== -1) {
        this.bookmarks[index] = bookmark;
        this.renderBookmarks();
      }
    });

    this.socket.on('bookmark-deleted', (data) => {
      console.log('[SSHIFT] Bookmark deleted by another client:', data.id);
      this.bookmarks = this.bookmarks.filter(b => b.id !== data.id);
      this.renderBookmarks();
    });

    // Folder sync events
    this.socket.on('folder-added', (folder) => {
      console.log('[SSHIFT] Folder added by another client:', folder.id);
      this.folders.push(folder);
      this.renderBookmarks();
    });

    this.socket.on('folder-updated', (folder) => {
      console.log('[SSHIFT] Folder updated by another client:', folder.id);
      const index = this.folders.findIndex(f => f.id === folder.id);
      if (index !== -1) {
        this.folders[index] = folder;
        this.renderBookmarks();
      }
    });

    this.socket.on('folder-deleted', (data) => {
      console.log('[SSHIFT] Folder deleted by another client:', data.id);
      this.folders = this.folders.filter(f => f.id !== data.id);
      // Move bookmarks from deleted folder to root
      this.bookmarks.forEach(b => {
        if (b.folderId === data.id) {
          b.folderId = null;
        }
      });
      this.renderBookmarks();
    });

    // Folder expanded states sync
    this.socket.on('folder-expanded-states', (data) => {
      console.log('[SSHIFT] Folder expanded states updated by another client');
      // Update local folder expanded states
      if (data.states) {
        this.folders.forEach(folder => {
          if (data.states.hasOwnProperty(folder.id)) {
            folder.expanded = data.states[folder.id];
          }
        });
        this.renderBookmarks();
      }
    });

    // Plugin-driven tab flash events
    this.socket.on('tab-flash', (data) => {
      this.startTabFlash(data.sessionId, data);
    });

    this.socket.on('tab-flash-stop', (data) => {
      this.stopTabFlash(data.sessionId);
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

    // Layout selector
    this.initLayoutSelector();

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
    
    // Initialize password toggle
    this.initPasswordToggle();
    
    // Initialize debug info dialog
    this.initDebugInfoDialog();
    
    // Initialize sessions modal handlers
    this.initSessionsModalHandlers();

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

    // Private key upload - connection modal
    document.getElementById('connKeyUploadBtn').addEventListener('click', () => {
      document.getElementById('connKeyFileInput').click();
    });
    document.getElementById('connKeyFileInput').addEventListener('change', (e) => {
      this.handleKeyFileUpload(e, 'connPrivateKey', 'connKeyFormatBadge', 'connKeyClearBtn');
    });
    document.getElementById('connKeyClearBtn').addEventListener('click', () => {
      this.clearKeyField('connPrivateKey', 'connKeyFormatBadge', 'connKeyClearBtn');
    });

    // Private key upload - bookmark modal
    document.getElementById('bookmarkKeyUploadBtn').addEventListener('click', () => {
      document.getElementById('bookmarkKeyFileInput').click();
    });
    document.getElementById('bookmarkKeyFileInput').addEventListener('change', (e) => {
      this.handleKeyFileUpload(e, 'bookmarkPrivateKey', 'bookmarkKeyFormatBadge', 'bookmarkKeyClearBtn');
    });
    document.getElementById('bookmarkKeyClearBtn').addEventListener('click', () => {
      this.clearKeyField('bookmarkPrivateKey', 'bookmarkKeyFormatBadge', 'bookmarkKeyClearBtn');
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

    // Toggle form fields based on bookmark type
    document.getElementById('bookmarkType').addEventListener('change', (e) => {
      this.toggleBookmarkTypeFields(e.target.value);
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

    // Special keys modal — panel-0 static instance uses the shared tap wiring
    // so it behaves identically on mobile and desktop (same as mic button).
    const specialKeysBtnEl = document.getElementById('specialKeysBtn');
    this._wireActionBtn(specialKeysBtnEl, () => this.handleSpecialKeys('panel-0'));

    // Speech-to-text button (panel-0 static instance) — wired the same way
    // as the keyboard button so both behave the same on mobile & desktop.
    const speechToTextBtnEl = document.getElementById('speechToTextBtn');
    this._wireActionBtn(speechToTextBtnEl, () => this.handleSpeechToText('panel-0'));

    // Speech-to-text modal close / cancel / send / record / wand handlers
    const closeSttBtn = document.getElementById('closeSpeechToTextModal');
    const sttCancelBtn = document.getElementById('sttCancelBtn');
    const sttSendBtn = document.getElementById('sttSendBtn');
    const sttRecordBtn = document.getElementById('sttRecordBtn');
    const sttWandBtn = document.getElementById('sttWandBtn');

    const closeSpeechToTextModal = () => {
      this.closeModal('speechToTextModal');
      const transcript = document.getElementById('sttTranscript');
      if (transcript) transcript.value = '';
      const status = document.getElementById('sttStatus');
      if (status) status.hidden = true;
      this._resetSttRecordButton();
      // Always return focus to the terminal (desktop + mobile) so the user
      // can keep typing/backspacing immediately after Send/Cancel/Close.
      this.focusTerminal();
    };

    const attachSttClose = (btn) => {
      if (!btn) return;
      btn.setAttribute('tabindex', '-1');
      btn.addEventListener('focus', () => {
        btn.blur();
        if (this.isMobile) this.focusTerminal();
      });
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
      }, { passive: false });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btn.addEventListener('click', closeSpeechToTextModal);
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        closeSpeechToTextModal();
      }, { passive: false });
    };

    attachSttClose(closeSttBtn);
    attachSttClose(sttCancelBtn);

    // Record / Pause / Resume toggle (STT endpoint wiring comes later).
    // Uses a basic touch+click handler — no focus stealing since the modal
    // is the topmost layer and we don't want to yank focus to the terminal.
    const attachSttAction = (btn, action) => {
      if (!btn) return;
      btn.setAttribute('tabindex', '-1');
      let touchHandled = false;
      btn.addEventListener('touchstart', (e) => {
        if (this.isMobile) e.preventDefault();
        touchHandled = true;
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        touchHandled = true;
        action();
      }, { passive: false });
      btn.addEventListener('mousedown', (e) => {
        if (this.isMobile) e.preventDefault();
      });
      btn.addEventListener('click', () => {
        if (touchHandled) { touchHandled = false; return; }
        action();
      });
    };

    attachSttAction(sttRecordBtn, () => this._toggleSttRecord());
    // Wand: pipe transcript through LLM proxy and replace text in place.
    attachSttAction(sttWandBtn, () => this._sttRunWand());

    if (sttSendBtn) {
      sttSendBtn.setAttribute('tabindex', '-1');
      const sendStt = async () => {
        // If still recording/paused, stop the mic first (any pending audio
        // that hasn't been transcribed yet is discarded — Send sends what's
        // currently in the textarea).
        if (this._sttRecorder && this._sttRecorder.state !== 'inactive') {
          try { this._sttRecorder.stop(); } catch (_) {}
          this._cleanupSttRecording();
          this._resetSttRecordButton();
        }
        const transcript = document.getElementById('sttTranscript');
        const text = transcript ? transcript.value : '';
        if (text) {
          const session = this.sessions.get(this.activeSessionId);
          // Pipe text to the remote shell via the SSH socket channel so the
          // shell actually receives it as input. terminal.write() would only
          // paint pixels locally and the keystrokes would never reach the
          // server (backspace/enter had no effect because the shell never
          // saw the input).
          if (session && session.type === 'ssh' && session.id && session.connected && session.isController) {
            this.socket.emit('ssh-data', { sessionId: session.id, data: text });
          } else if (session && session.type === 'ssh' && session.terminal) {
            // Fallback (non-controller or disconnected): at least render
            // locally so the user sees what would have been sent.
            session.terminal.write(text);
            this.showToast('Not connected as controller — text not sent', 'warning');
          } else if (session && session.terminal) {
            session.terminal.write(text);
          }
        }
        closeSpeechToTextModal();
      };
      let sendTouchHandled = false;
      sttSendBtn.addEventListener('touchstart', (e) => {
        if (this.isMobile) e.preventDefault();
        sendTouchHandled = true;
      }, { passive: false });
      sttSendBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        sendTouchHandled = true;
        sendStt();
      }, { passive: false });
      sttSendBtn.addEventListener('mousedown', (e) => {
        if (this.isMobile) e.preventDefault();
      });
      sttSendBtn.addEventListener('click', () => {
        if (sendTouchHandled) { sendTouchHandled = false; return; }
        sendStt();
      });
    }

    const closeSpecialKeysBtn = document.getElementById('closeSpecialKeysModal');
    closeSpecialKeysBtn.setAttribute('tabindex', '-1');
    closeSpecialKeysBtn.addEventListener('focus', () => {
      closeSpecialKeysBtn.blur();
      if (this.isMobile) this.focusTerminal();
    });
    closeSpecialKeysBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
    }, { passive: false });
    closeSpecialKeysBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.closeModal('specialKeysModal');
      this.focusTerminal();
    }, { passive: false });
    closeSpecialKeysBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    closeSpecialKeysBtn.addEventListener('click', () => {
      this.closeModal('specialKeysModal');
      this.focusTerminal();
    });

    // Speech & AI settings — show/hide auth key toggles + Reset wand prompt
    const toggleSttAuth = document.getElementById('toggleSttAuthKey');
    if (toggleSttAuth) {
      toggleSttAuth.addEventListener('click', () => {
        const input = document.getElementById('sttAuthKey');
        const icon = toggleSttAuth.querySelector('i');
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
          input.type = 'password';
          if (icon) icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
      });
    }
    const toggleLlmAuth = document.getElementById('toggleLlmAuthKey');
    if (toggleLlmAuth) {
      toggleLlmAuth.addEventListener('click', () => {
        const input = document.getElementById('llmAuthKey');
        const icon = toggleLlmAuth.querySelector('i');
        if (!input) return;
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
          input.type = 'password';
          if (icon) icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
      });
    }
    const resetWandBtn = document.getElementById('resetWandPromptBtn');
    if (resetWandBtn) {
      resetWandBtn.addEventListener('click', () => this.resetWandPromptToDefault());
    }

    // Special key buttons
    const specialKeysModal = document.getElementById('specialKeysModal');
    document.querySelectorAll('.key-btn').forEach(btn => {
      btn.setAttribute('tabindex', '-1');
      btn.addEventListener('focus', () => {
        btn.blur();
        if (this.isMobile) this.focusTerminal();
      });
      let btnTouchHandled = false;
      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        btnTouchHandled = true;
      }, { passive: false });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.sendSpecialKey(btn.dataset.key);
      }, { passive: false });
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
      });
      btn.addEventListener('click', () => {
        if (btnTouchHandled) { btnTouchHandled = false; return; }
        this.sendSpecialKey(btn.dataset.key);
      });
    });
    
    // Safety net: refocus terminal if focus lands inside special keys modal
    if (specialKeysModal) {
      specialKeysModal.addEventListener('focusin', (e) => {
        if (e.target) e.target.blur();
        if (this.isMobile) this.focusTerminal();
      });
    }

    // Font size buttons
    document.getElementById('increaseFontBtn').addEventListener('click', () => {
      // Use the handler for consistency
      this.handleFontSizeChange('panel-0', 1);
    });

    document.getElementById('decreaseFontBtn').addEventListener('click', () => {
      // Use the handler for consistency
      this.handleFontSizeChange('panel-0', -1);
    });

    // Initialise terminal-only tab action gating (disabled until an SSH
    // session becomes active in the panel).
    this.updateTabActionButtons('panel-0');

    // SFTP modal - now handled via tabs, keeping for backward compatibility
    // These event listeners are no longer needed but kept for reference
    // SFTP is now opened in tabs instead of modal

    // Tabs scroll arrows
    const scrollLeftBtn = document.getElementById('scrollLeftBtn');
    const scrollRightBtn = document.getElementById('scrollRightBtn');
    
    if (scrollLeftBtn) {
      scrollLeftBtn.addEventListener('click', () => {
        this.scrollTabs(-150);
      });
    }
    
    if (scrollRightBtn) {
      scrollRightBtn.addEventListener('click', () => {
        this.scrollTabs(150);
      });
    }
    
    // Update scroll arrows when tabs container is scrolled
    // Attach scroll listeners to all panels
    const panels = this.getAllPanels ? this.getAllPanels() : ['panel-0'];
    panels.forEach(panelId => {
      const tabsContainer = this.getTabsContainer(panelId);
      if (tabsContainer) {
        tabsContainer.addEventListener('scroll', () => {
          this.updateTabsScrollArrows();
        });
      }
    });

    // Window resize with debouncing to prevent resize storms
    // Mobile browsers fire many resize events (orientation, keyboard, etc.)
    let windowResizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(windowResizeTimeout);
      windowResizeTimeout = setTimeout(() => {
        this.handleResize();
        this.updateTabsScrollArrows();
      }, 100); // 100ms debounce
    });

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('mousedown', (e) => {
        if (e.target === modal && this.isMobile) e.preventDefault();
      });
      modal.addEventListener('touchstart', (e) => {
        if (e.target === modal) e.preventDefault();
      }, { passive: false });
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeModal(modal.id);
          if (this.isMobile) this.focusTerminal();
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
      // Only fit for controllers - non-controllers will receive resize sync
      setTimeout(() => {
        this.sessions.forEach(session => {
          if (session.terminal && session.fitAddon && session.isController) {
            this._fitTerminal(session);
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
  switchSettingsCategory(category) {
    const categories = document.querySelectorAll('.settings-category');
    const navItems = document.querySelectorAll('.settings-nav-item');
    const select = document.getElementById('settingsCategorySelect');
    
    categories.forEach(el => {
      el.style.display = 'none';
    });
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.category === category);
    });
    if (select) select.value = category;
    
    const target = document.getElementById('settings-category-' + category);
    if (target) target.style.display = 'block';
  }

  openSettingsModal() {
    // Load current sticky setting
    const stickyToggle = document.getElementById('stickyToggle');
    if (stickyToggle) {
      stickyToggle.checked = this.sticky;
    }
    
    // Load current takeControlDefault setting
    const takeControlDefaultToggle = document.getElementById('takeControlDefaultToggle');
    if (takeControlDefaultToggle) {
      takeControlDefaultToggle.checked = this.takeControlDefault;
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
    
    // Load current WebGL renderer setting
    const webglRendererToggle = document.getElementById('webglRendererToggle');
    if (webglRendererToggle) {
      webglRendererToggle.checked = this.webglRenderer;
    }
    
    // Load current image addon setting
    const imageAddonToggle = document.getElementById('imageAddonToggle');
    if (imageAddonToggle) {
      imageAddonToggle.checked = this.imageAddonEnabled;
    }
    
    // Update password toggle button state
    this.updatePasswordToggleUI();
    
    // Load plugins
    this.loadPlugins();

    // Load Speech & AI config from server (auth keys are redacted by the
    // server — we only get back a "set" flag and fill the auth inputs with
    // the sentinel placeholder so unchanged values aren't overwritten on save).
    this.loadSpeechAiConfig().catch(err => {
      console.error('[SSHIFT] Failed to load Speech & AI config:', err);
    });

    // Reset to first category
    this.switchSettingsCategory('sessions');
    
    this.openModal('settingsModal');
  }

  // ---- Speech & AI: settings load/save ---------------------------------
  // Auth keys are never sent back to the client. When the user doesn't type
  // a new one, we post the "__UNCHANGED__" sentinel so the server preserves
  // the existing value.
  async loadSpeechAiConfig() {
    const res = await fetch('/api/speech-ai/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    this._speechAiConfig = cfg;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('sttEndpoint', cfg.sttEndpoint || '');
    set('sttLanguage', cfg.sttLanguage || '');
    set('llmEndpoint', cfg.llmEndpoint || '');
    set('llmModel', cfg.llmModel || '');
    set('wandSystemPrompt', cfg.wandSystemPrompt || '');

    // Auth keys: redacted. Show a placeholder describing current state and
    // leave the input blank so a Save without typing keeps the existing key.
    const sttAuth = document.getElementById('sttAuthKey');
    if (sttAuth) {
      sttAuth.value = '';
      sttAuth.placeholder = cfg.sttAuthKeySet
        ? 'API key set — leave blank to keep'
        : 'sk-...';
    }
    const llmAuth = document.getElementById('llmAuthKey');
    if (llmAuth) {
      llmAuth.value = '';
      llmAuth.placeholder = cfg.llmAuthKeySet
        ? 'API key set — leave blank to keep'
        : 'sk-...';
    }
  }

  async saveSpeechAiConfig() {
    const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const sttAuth = document.getElementById('sttAuthKey');
    const llmAuth = document.getElementById('llmAuthKey');

    // Sentinel preserves existing keys when the user didn't type a new one.
    const sttAuthKey = (sttAuth && sttAuth.value.trim()) ? sttAuth.value.trim() : '__UNCHANGED__';
    const llmAuthKey = (llmAuth && llmAuth.value.trim()) ? llmAuth.value.trim() : '__UNCHANGED__';

    const body = {
      sttEndpoint:     val('sttEndpoint'),
      sttLanguage:     val('sttLanguage'),
      llmEndpoint:     val('llmEndpoint'),
      llmModel:        val('llmModel'),
      wandSystemPrompt:val('wandSystemPrompt'),
      sttAuthKey,
      llmAuthKey
    };

    const res = await fetch('/api/speech-ai/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${txt}`);
    }
    // Reload so the redacted placeholders reflect the new state.
    return this.loadSpeechAiConfig();
  }

  async resetWandPromptToDefault() {
    try {
      const res = await fetch('/api/speech-ai/wand-default');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const ta = document.getElementById('wandSystemPrompt');
      if (ta) ta.value = data.prompt || '';
      this.showToast('Wand prompt reset to default', 'info');
    } catch (err) {
      console.error('[SSHIFT] Failed to load default wand prompt:', err);
      this.showToast('Failed to load default prompt', 'error');
    }
  }

  initSettingsModalHandlers() {
    // Settings category navigation (sidebar + mobile dropdown)
    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        this.switchSettingsCategory(item.dataset.category);
      });
    });
    
    const categorySelect = document.getElementById('settingsCategorySelect');
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        this.switchSettingsCategory(e.target.value);
      });
    }

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
        
        // Revert takeControlDefault toggle
        const takeControlDefaultToggle = document.getElementById('takeControlDefaultToggle');
        if (takeControlDefaultToggle) {
          takeControlDefaultToggle.checked = this.takeControlDefault;
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
        
        const scrollbackInput = document.getElementById('scrollbackLines');
        if (scrollbackInput && this.scrollback) {
          scrollbackInput.value = this.scrollback;
        }
        
        // Revert mobile keys bar setting
        const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
        if (mobileKeysBarToggle) {
          mobileKeysBarToggle.checked = this.mobileKeysBarEnabled;
        }
        
        // Revert WebGL renderer setting
        const webglRendererToggle = document.getElementById('webglRendererToggle');
        if (webglRendererToggle) {
          webglRendererToggle.checked = this.webglRenderer;
        }
        
        // Revert image addon setting
        const imageAddonToggle = document.getElementById('imageAddonToggle');
        if (imageAddonToggle) {
          imageAddonToggle.checked = this.imageAddonEnabled;
        }
        
        this.closeModal('settingsModal');
      });
    }

    // Save button
    const saveBtn = document.getElementById('saveSettings');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const stickyToggle = document.getElementById('stickyToggle');
        const takeControlDefaultToggle = document.getElementById('takeControlDefaultToggle');
        const keepaliveIntervalInput = document.getElementById('sshKeepaliveInterval');
        const keepaliveCountMaxInput = document.getElementById('sshKeepaliveCountMax');
        const mobileKeysBarToggle = document.getElementById('mobileKeysBarToggle');
        
        // Save sticky setting
        if (stickyToggle) {
          this.sticky = stickyToggle.checked;
        }
        
        // Save takeControlDefault setting
        if (takeControlDefaultToggle) {
          this.takeControlDefault = takeControlDefaultToggle.checked;
        }
        
        // Save SSH keepalive settings
        if (keepaliveIntervalInput) {
          this.sshKeepaliveInterval = parseInt(keepaliveIntervalInput.value) || 10000;
        }
        
        if (keepaliveCountMaxInput) {
          this.sshKeepaliveCountMax = parseInt(keepaliveCountMaxInput.value) || 1000;
        }
        
        const scrollbackInput = document.getElementById('scrollbackLines');
        if (scrollbackInput) {
          this.scrollback = Math.max(0, Math.min(100000, parseInt(scrollbackInput.value) || 10000));
        }
        
        // Save mobile keys bar setting
        if (mobileKeysBarToggle) {
          this.mobileKeysBarEnabled = mobileKeysBarToggle.checked;
          this.updateMobileKeysBar();
        }
        
        // Save WebGL renderer setting
        if (webglRendererToggle) {
          this.webglRenderer = webglRendererToggle.checked;
        }
        
        // Save image addon setting
        const imageAddonToggle = document.getElementById('imageAddonToggle');
        if (imageAddonToggle) {
          this.imageAddonEnabled = imageAddonToggle.checked;
        }
        
        // Save all settings to config
        this.saveStickyConfig();

        // Persist Speech & AI settings (server-side, redacted keys preserved
        // when the user left the auth inputs blank).
        this.saveSpeechAiConfig().catch(err => {
          console.error('[SSHIFT] Failed to save Speech & AI config:', err);
          this.showToast('Speech & AI settings failed to save', 'error');
        });

        console.log('[SSHIFT] Settings saved - sticky:', this.sticky, 
                    'takeControlDefault:', this.takeControlDefault,
                    'keepaliveInterval:', this.sshKeepaliveInterval,
                    'keepaliveCountMax:', this.sshKeepaliveCountMax,
                    'scrollback:', this.scrollback,
                    'mobileKeysBarEnabled:', this.mobileKeysBarEnabled,
                    'webglRenderer:', this.webglRenderer,
                    'imageAddonEnabled:', this.imageAddonEnabled);
        
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
          
          const webglRendererToggle = document.getElementById('webglRendererToggle');
          if (webglRendererToggle) {
            webglRendererToggle.checked = this.webglRenderer;
          }
          
          const imageAddonToggle = document.getElementById('imageAddonToggle');
          if (imageAddonToggle) {
            imageAddonToggle.checked = this.imageAddonEnabled;
          }
          
          this.closeModal('settingsModal');
        }
      });
    }
  }

  initSecurityInfoDialog() {
    const showBtn = document.getElementById('showSecurityInfoBtn');
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        this.closeModal('settingsModal');
        this.openSecurityInfoDialog();
      });
    }

    const closeBtn = document.getElementById('closeSecurityInfoModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeModal('securityInfoModal');
      });
    }

    const closeBtn2 = document.getElementById('closeSecurityInfoBtn');
    if (closeBtn2) {
      closeBtn2.addEventListener('click', () => {
        const dontShow = document.getElementById('dontShowSecurityInfo');
        if (dontShow && dontShow.checked) {
          localStorage.setItem('dontShowSecurityInfo', 'true');
        } else {
          localStorage.removeItem('dontShowSecurityInfo');
        }
        this.closeModal('securityInfoModal');
      });
    }

    const downloadCertBtn = document.getElementById('downloadCertBtn');
    const customCertWarning = document.getElementById('customCertWarning');

    fetch('/api/security-info').then(r => r.json()).then(info => {
      if (info.usesCustomCert) {
        if (downloadCertBtn) {
          downloadCertBtn.disabled = true;
          downloadCertBtn.style.opacity = '0.5';
          downloadCertBtn.style.cursor = 'not-allowed';
        }
        if (customCertWarning) {
          customCertWarning.style.display = 'flex';
        }
      }
    }).catch(() => {});

    if (downloadCertBtn) {
      downloadCertBtn.addEventListener('click', () => {
        if (downloadCertBtn.disabled) return;
        window.open('/api/cert', '_blank');
      });
    }

    const modal = document.getElementById('securityInfoModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal('securityInfoModal');
        }
      });
    }

    const dontShowCheckbox = document.getElementById('dontShowSecurityInfo');
    if (dontShowCheckbox) {
      const stored = localStorage.getItem('dontShowSecurityInfo');
      dontShowCheckbox.checked = stored === 'true';
    }

    // Auto-show on startup if not dismissed and cert not already installed
    const dontShow = localStorage.getItem('dontShowSecurityInfo');
    if (dontShow === 'true') return;

    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
    const swActive = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (isLocalhost || swActive) return;

    setTimeout(() => this.openSecurityInfoDialog(), 1000);
  }

  openSecurityInfoDialog() {
    const swStatusIcon = document.getElementById('swStatusIcon');
    const swStatusTitle = document.getElementById('swStatusTitle');
    const swStatusText = document.getElementById('swStatusText');
    const swStatusContainer = document.getElementById('swStatusContainer');

    let swStatus = window._swStatus;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      swStatus = 'active';
      window._swStatus = 'active';
    }

    if (swStatusIcon && swStatusTitle && swStatusText && swStatusContainer) {
      swStatusContainer.classList.remove('sw-status-active', 'sw-status-failed', 'sw-status-unsupported');

      if (swStatus === 'active') {
        swStatusContainer.classList.add('sw-status-active');
        swStatusIcon.innerHTML = '<i class="fas fa-check-circle"></i>';
        swStatusTitle.textContent = 'Connected';
        swStatusText.innerHTML =
          '<ul class="sw-feature-list">' +
          '<li><i class="fas fa-check"></i> No browser security warnings</li>' +
          '<li><i class="fas fa-check"></i> Installable as app (PWA)</li>' +
          '<li><i class="fas fa-check"></i> Clipboard API access</li>' +
          '</ul>';
      } else if (swStatus === 'failed') {
        swStatusContainer.classList.add('sw-status-failed');
        swStatusIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        swStatusTitle.textContent = 'Connection Failed';
        swStatusText.innerHTML =
          '<p>' + (window._swError || 'Unknown error') + '</p>' +
          '<ul class="sw-feature-list">' +
          '<li><i class="fas fa-times"></i> No browser security warnings</li>' +
          '<li><i class="fas fa-times"></i> Installable as app (PWA)</li>' +
          '<li><i class="fas fa-times"></i> Clipboard API access</li>' +
          '</ul>' +
          '<p class="sw-hint">Trust the HTTPS certificate to enable all features.</p>';
      } else if (swStatus === 'redundant') {
        swStatusContainer.classList.add('sw-status-failed');
        swStatusIcon.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        swStatusTitle.textContent = 'Connection Failed';
        swStatusText.innerHTML =
          '<p>' + (window._swError || 'The HTTPS certificate may not be trusted.') + '</p>' +
          '<ul class="sw-feature-list">' +
          '<li><i class="fas fa-times"></i> No browser security warnings</li>' +
          '<li><i class="fas fa-times"></i> Installable as app (PWA)</li>' +
          '<li><i class="fas fa-times"></i> Clipboard API access</li>' +
          '</ul>' +
          '<p class="sw-hint">Trust the HTTPS certificate to enable all features.</p>';
      } else if (swStatus === 'unsupported') {
        swStatusContainer.classList.add('sw-status-unsupported');
        swStatusIcon.innerHTML = '<i class="fas fa-info-circle"></i>';
        swStatusTitle.textContent = 'Not Supported';
        swStatusText.innerHTML =
          '<p>Service Workers are not available in this browser.</p>' +
          '<ul class="sw-feature-list">' +
          '<li><i class="fas fa-times"></i> No browser security warnings</li>' +
          '<li><i class="fas fa-times"></i> Installable as app (PWA)</li>' +
          '<li><i class="fas fa-times"></i> Clipboard API access</li>' +
          '</ul>';
      } else {
        swStatusIcon.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        swStatusTitle.textContent = 'Checking...';
        swStatusText.textContent = 'Detecting service worker status';
        setTimeout(() => this.openSecurityInfoDialog(), 500);
        return;
      }
    }

    this.openModal('securityInfoModal');
  }

  // Debug Info Dialog
  initDebugInfoDialog() {
    const showBtn = document.getElementById('showDebugInfoBtn');
    if (showBtn) {
      showBtn.addEventListener('click', () => {
        this.openDebugInfoDialog();
      });
    }

    const closeBtn = document.getElementById('closeDebugInfoModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeModal('debugInfoModal');
      });
    }

    const closeBtn2 = document.getElementById('closeDebugInfoBtn');
    if (closeBtn2) {
      closeBtn2.addEventListener('click', () => {
        this.closeModal('debugInfoModal');
      });
    }

    const modal = document.getElementById('debugInfoModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal('debugInfoModal');
        }
      });
    }
  }

  openDebugInfoDialog() {
    fetch('/api/debug-info').then(r => r.json()).then(info => {
      const configPathEl = document.getElementById('debugConfigPath');
      const dataDirEl = document.getElementById('debugDataDir');
      const certPathEl = document.getElementById('debugCertPath');
      const keyPathEl = document.getElementById('debugKeyPath');
      const certTypeEl = document.getElementById('debugCertType');

      if (configPathEl) configPathEl.textContent = info.configPath || 'N/A';
      if (dataDirEl) dataDirEl.textContent = info.dataDir || 'N/A';
      if (certPathEl) certPathEl.textContent = info.certPath || 'N/A';
      if (keyPathEl) keyPathEl.textContent = info.keyPath || 'N/A';
      if (certTypeEl) certTypeEl.textContent = info.usesCustomCert ? 'Custom' : 'Self-signed';
    }).catch(() => {
      const ids = ['debugConfigPath', 'debugDataDir', 'debugCertPath', 'debugKeyPath', 'debugCertType'];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Error loading';
      });
    });

    this.openModal('debugInfoModal');
  }

  // Sessions Modal
  async openSessionsModal() {
    this.openModal('manageSessionsModal');
    await this.loadSessions();
  }

  async loadSessions() {
    const sessionsList = document.getElementById('sessionsList');
    if (!sessionsList) return;
    
    sessionsList.innerHTML = '<div class="loading">Loading sessions...</div>';
    
    try {
      const response = await fetch('/api/sessions');
      const sessions = await response.json();
      
      if (sessions.length === 0) {
        sessionsList.innerHTML = '<div class="no-sessions">No active sessions</div>';
        return;
      }
      
      sessionsList.innerHTML = sessions.map(session => `
        <div class="session-item" data-session-id="${session.id}">
          <div class="session-info">
            <div class="session-name">${this.escapeHtml(session.name || session.host)}</div>
            <div class="session-details">
              <span class="session-type">${session.type.toUpperCase()}</span>
              <span class="session-host">${this.escapeHtml(session.host)}:${session.port}</span>
              <span class="session-user">${this.escapeHtml(session.username)}</span>
              ${session.activeSockets > 0 ? `<span class="session-clients">${session.activeSockets} client${session.activeSockets > 1 ? 's' : ''}</span>` : ''}
            </div>
          </div>
          <button class="btn-close-session" data-session-id="${session.id}" title="Close session">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `).join('');
      
      // Add event listeners to close buttons
      sessionsList.querySelectorAll('.btn-close-session').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const sessionId = btn.dataset.sessionId;
          this.closeSession(sessionId);
        });
      });
      
    } catch (err) {
      console.error('[SSHIFT] Failed to load sessions:', err);
      sessionsList.innerHTML = '<div class="error">Failed to load sessions</div>';
    }
  }

  async closeSession(sessionId) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      if (response.ok) {
        this.showToast('Session closed', 'success');
        await this.loadSessions();
      } else {
        const data = await response.json();
        this.showToast(data.error || 'Failed to close session', 'error');
      }
    } catch (err) {
      console.error('[SSHIFT] Failed to close session:', err);
      this.showToast('Failed to close session', 'error');
    }
  }

  async closeAllSessions() {
    if (!confirm('Are you sure you want to close all sessions? This will disconnect all clients.')) {
      return;
    }
    
    try {
      const response = await fetch('/api/sessions/close-all', { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        this.showToast(`Closed ${data.closedCount} session(s)`, 'success');
        await this.loadSessions();
      } else {
        const data = await response.json();
        this.showToast(data.error || 'Failed to close sessions', 'error');
      }
    } catch (err) {
      console.error('[SSHIFT] Failed to close all sessions:', err);
      this.showToast('Failed to close sessions', 'error');
    }
  }

  initPasswordToggle() {
    const toggleBtn = document.getElementById('togglePasswordBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.togglePasswordProtection();
      });
    }
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      if (this.passwordEnabled) logoutBtn.style.display = '';
      logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('sshift_auth_token');
        location.reload();
      });
    }
    this.updatePasswordToggleUI();
  }

  initSessionsModalHandlers() {
    const closeBtn = document.getElementById('closeManageSessionsModal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.closeModal('manageSessionsModal');
      });
    }
    
    const closeFooterBtn = document.getElementById('closeManageSessions');
    if (closeFooterBtn) {
      closeFooterBtn.addEventListener('click', () => {
        this.closeModal('manageSessionsModal');
      });
    }
    
    const closeAllBtn = document.getElementById('closeAllSessions');
    if (closeAllBtn) {
      closeAllBtn.addEventListener('click', () => {
        this.closeAllSessions();
      });
    }
    
    // Manage Sessions button in settings
    const manageBtn = document.getElementById('manageSessionsBtn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        this.closeModal('settingsModal');
        this.openSessionsModal();
      });
    }
    
    // Click outside modal to close
    const sessionsModal = document.getElementById('manageSessionsModal');
    if (sessionsModal) {
      sessionsModal.addEventListener('click', (e) => {
        if (e.target === sessionsModal) {
          this.closeModal('manageSessionsModal');
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

    // Force resize button (static dropdown)
    const forceResizeBtn = document.getElementById('mobileForceResizeBtn');
    if (forceResizeBtn) {
      forceResizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.forceResizeTerminal(this.activeSessionId);
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (mobileTabsMenu.classList.contains('show') && !e.target.closest('.mobile-tabs-dropdown')) {
        mobileTabsToggle.classList.remove('active');
        mobileTabsMenu.classList.remove('show');
      }
    });
  }

  updateMobileTabsDropdown(panelId = null) {
    // On mobile, we always show a single dropdown that combines all tabs from all panels
    // On desktop with multi-panel, we show separate dropdowns per panel
    const isMobileView = window.innerWidth <= 768;
    
    if (isMobileView || this.isMobile) {
      // Mobile: Single dropdown with all tabs from all panels
      const mobileTabsLabel = document.getElementById('mobileTabsLabel');
      const mobileTabsMenu = document.getElementById('mobileTabsMenu');
      const mobileTabsToggle = document.getElementById('mobileTabsToggle');
      
      if (!mobileTabsLabel || !mobileTabsMenu || !mobileTabsToggle) return;

      // Get all tabs from all panels in order
      const allTabs = this.getAllTabsInOrder();

      // Clear existing menu
      mobileTabsMenu.innerHTML = '';

      // Find active tab (the globally active one)
      let activeTabName = 'No Active Tabs';
      let activeTabIcon = 'fa-terminal';

      // Add menu options for each tab
      allTabs.forEach(tabData => {
        const { sessionId, name, type } = tabData;
        const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
        const isActive = sessionId === this.activeSessionId;
        
        if (session) {
          const icon = type === 'sftp' ? 'fa-folder-open' : 'fa-terminal';
          const iconClass = type === 'sftp' ? 'sftp' : 'ssh';
          const displayName = name || sessionId;

          if (isActive) {
            activeTabName = displayName;
            activeTabIcon = icon;
          }

          const option = document.createElement('div');
          option.className = `mobile-tab-option${isActive ? ' active' : ''}`;
          option.dataset.sessionId = sessionId;
          if (this._flashingSessions && this._flashingSessions.has(sessionId)) {
            option.classList.add('flashing');
          }
          option.innerHTML = `
            <i class="fas ${icon} tab-icon ${iconClass}"></i>
            <span class="tab-name">${displayName}</span>
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
              // On mobile, always switch to panel-0 since we're in single panel mode
              this.switchTab(sessionId, 'panel-0');
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

      // Restore flashing state on toggle if any tab is flashing
      if (this._flashingSessions && this._flashingSessions.size > 0) {
        mobileTabsToggle.classList.add('flashing');
      } else {
        mobileTabsToggle.classList.remove('flashing');
      }
    } else {
      // Desktop multi-panel: Each panel's dropdown shows ALL tabs with panel indicators
      const allPanels = this.getAllPanels();
      const isSingleLayout = allPanels.length <= 1;
      const panelsToUpdate = panelId ? [panelId] : allPanels;
      const allTabsByPanel = {};
      allPanels.forEach(pid => {
        const tabsContainer = this.getTabsContainer(pid);
        allTabsByPanel[pid] = tabsContainer ? Array.from(tabsContainer.children) : [];
      });
      const allPanelTabs = [];
      const clockwisePanels = isSingleLayout ? allPanels : this.getClockwisePanels();
      clockwisePanels.forEach(pid => {
        allPanelTabs.push(...(allTabsByPanel[pid] || []).map(tab => ({
          sessionId: tab.dataset.sessionId,
          panelId: pid,
          tabElement: tab
        })));
      });

      panelsToUpdate.forEach(pid => {
        const mobileTabsLabel = document.getElementById(pid === 'panel-0' ? 'mobileTabsLabel' : `${pid}-mobileTabsLabel`);
        const mobileTabsMenu = document.getElementById(pid === 'panel-0' ? 'mobileTabsMenu' : `${pid}-mobileTabsMenu`);
        const mobileTabsToggle = document.getElementById(pid === 'panel-0' ? 'mobileTabsToggle' : `${pid}-mobileTabsToggle`);
        
        if (!mobileTabsLabel || !mobileTabsMenu || !mobileTabsToggle) return;

        // For single layout, only show this panel's tabs; for multi-panel, show all tabs
        const tabsToShow = isSingleLayout
          ? (allTabsByPanel[pid] || []).map(tab => ({
              sessionId: tab.dataset.sessionId,
              panelId: pid,
              tabElement: tab
            }))
          : allPanelTabs;

        mobileTabsMenu.innerHTML = '';

        let activeTabName = 'No Active Tabs';
        let activeTabIcon = 'fa-terminal';

        tabsToShow.forEach(({ sessionId, panelId: tabPanelId }) => {
          const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
          const isActiveInPanel = this.activeSessionsByPanel.get(pid) === sessionId;
          const isActive = this.activeSessionsByPanel.get(tabPanelId) === sessionId;
          
          if (session) {
            const icon = session.type === 'sftp' ? 'fa-folder-open' : 'fa-terminal';
            const iconClass = session.type === 'sftp' ? 'sftp' : 'ssh';
            const name = session.name || sessionId;

            if (isActiveInPanel) {
              activeTabName = name;
              activeTabIcon = icon;
            }

            const option = document.createElement('div');
            option.className = `mobile-tab-option${isActive ? ' active' : ''}`;
            option.dataset.sessionId = sessionId;
            if (this._flashingSessions && this._flashingSessions.has(sessionId)) {
              option.classList.add('flashing');
            }
            const panelIndicator = !isSingleLayout && tabPanelId !== pid
              ? `<span class="tab-panel-badge">${tabPanelId.replace('panel-', '')}</span>`
              : '';
            option.innerHTML = `
              <i class="fas ${icon} tab-icon ${iconClass}"></i>
              <span class="tab-name">${name}</span>
              ${panelIndicator}
              <button class="tab-rename" data-session-id="${sessionId}" title="Rename">
                <i class="fas fa-pen"></i>
              </button>
              <button class="tab-close" data-session-id="${sessionId}" title="Close">
                <i class="fas fa-times"></i>
              </button>
            `;

            option.addEventListener('click', (e) => {
              if (!e.target.closest('.tab-rename') && !e.target.closest('.tab-close')) {
                const targetPanel = this.getPanelForSession(sessionId);
                this.switchTab(sessionId, targetPanel);
                mobileTabsMenu.classList.remove('show');
                mobileTabsToggle.classList.remove('active');
              }
            });

            mobileTabsMenu.appendChild(option);

            const renameBtn = option.querySelector('.tab-rename');
            renameBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.startTabRename(sessionId);
              mobileTabsMenu.classList.remove('show');
              mobileTabsToggle.classList.remove('active');
            });

            const closeBtn = option.querySelector('.tab-close');
            closeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.closeTab(sessionId);
            });
          }
        });

        const iconElement = mobileTabsToggle.querySelector('.tab-icon-active');
        if (iconElement) {
          iconElement.className = `fas ${activeTabIcon} tab-icon-active`;
        }
        mobileTabsLabel.textContent = activeTabName;

        if (mobileTabsToggle) {
          if (this._flashingSessions && this._flashingSessions.size > 0) {
            mobileTabsToggle.classList.add('flashing');
          } else {
            mobileTabsToggle.classList.remove('flashing');
          }
        }
      });
    }
  }

  // Scroll tabs left or right
  scrollTabs(amount) {
    // Update scroll arrows for all panels
    const panels = this.getAllPanels();
    panels.forEach(panelId => {
      const tabsContainer = this.getTabsContainer(panelId);
      if (tabsContainer) {
        tabsContainer.scrollBy({
          left: amount,
          behavior: 'smooth'
        });
      }
    });
  }

  // Update scroll arrows visibility based on tabs overflow
  updateTabsScrollArrows() {
    // Update scroll arrows for all panels
    const panels = this.getAllPanels();
    panels.forEach(panelId => {
      const tabsContainer = this.getTabsContainer(panelId);
      const scrollArrows = document.getElementById(panelId === 'panel-0' ? 'tabsScrollArrows' : `${panelId}-tabsScrollArrows`);
      const scrollLeftBtn = document.getElementById(panelId === 'panel-0' ? 'scrollLeftBtn' : `${panelId}-scrollLeftBtn`);
      const scrollRightBtn = document.getElementById(panelId === 'panel-0' ? 'scrollRightBtn' : `${panelId}-scrollRightBtn`);
      
      if (!tabsContainer || !scrollArrows) return;
      
      // Only show arrows on desktop (width > 768px)
      const isDesktop = window.innerWidth > 768;
      if (!isDesktop) {
        scrollArrows.classList.remove('visible');
        return;
      }
      
      // Check if tabs overflow the container
      const hasOverflow = tabsContainer.scrollWidth > tabsContainer.clientWidth;
      
      if (hasOverflow) {
        scrollArrows.classList.add('visible');
        
        // Update arrow states based on scroll position
        if (scrollLeftBtn) {
          scrollLeftBtn.disabled = tabsContainer.scrollLeft <= 0;
        }
        if (scrollRightBtn) {
          const maxScrollLeft = tabsContainer.scrollWidth - tabsContainer.clientWidth;
          scrollRightBtn.disabled = tabsContainer.scrollLeft >= maxScrollLeft - 1; // -1 for rounding
        }
      } else {
        scrollArrows.classList.remove('visible');
      }
    });
  }

  saveStickyConfig() {
    // Save to localStorage
    localStorage.setItem('sticky', JSON.stringify(this.sticky));
    localStorage.setItem('takeControlDefault', JSON.stringify(this.takeControlDefault));
    localStorage.setItem('sshKeepaliveInterval', this.sshKeepaliveInterval || 10000);
    localStorage.setItem('sshKeepaliveCountMax', this.sshKeepaliveCountMax || 1000);
    localStorage.setItem('mobileKeysBarEnabled', JSON.stringify(this.mobileKeysBarEnabled));
    localStorage.setItem('webglRenderer', JSON.stringify(this.webglRenderer));
    localStorage.setItem('imageAddonEnabled', JSON.stringify(this.imageAddonEnabled));
    localStorage.setItem('scrollback', this.scrollback || 10000);
    
    // Save to server config
    const headers = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
    fetch('/api/config', {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        sticky: this.sticky,
        takeControlDefault: this.takeControlDefault,
        sshKeepaliveInterval: this.sshKeepaliveInterval || 10000,
        sshKeepaliveCountMax: this.sshKeepaliveCountMax || 1000,
        mobileKeysBarEnabled: this.mobileKeysBarEnabled,
        webglRenderer: this.webglRenderer,
        imageAddonEnabled: this.imageAddonEnabled,
        scrollback: this.scrollback || 10000
      })
    }).then(response => {
      if (!response.ok) {
        console.error('[SSHIFT] Failed to save config');
      }
    }).catch(err => {
      console.error('[SSHIFT] Error saving config:', err);
    });
  }

  async loadPlugins() {
    const pluginsList = document.getElementById('pluginsList');
    if (!pluginsList) return;

    pluginsList.innerHTML = '<div class="plugins-loading">Loading plugins...</div>';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
      const response = await fetch('/api/plugins', { headers });

      if (!response.ok) {
        pluginsList.innerHTML = '<div class="plugins-loading">Failed to load plugins</div>';
        return;
      }

      const plugins = await response.json();

      if (plugins.length === 0) {
        pluginsList.innerHTML = '<div class="plugins-loading">No plugins available</div>';
        return;
      }

      pluginsList.innerHTML = plugins.map(plugin => {
        const name = this.escapeHtml(plugin.name);
        const description = this.escapeHtml(plugin.description || '');
        const isMissing = plugin.missing === true;
        const missingClass = isMissing ? ' missing' : '';
        const missingHtml = isMissing ? '<div class="plugin-card-missing"><i class="fas fa-exclamation-triangle"></i> Plugin directory not found</div>' : '';

        return `
          <div class="plugin-card${missingClass}" data-plugin="${name}">
            <div class="plugin-card-info">
              <div class="plugin-card-name">${name}</div>
              ${description ? `<div class="plugin-card-description">${description}</div>` : ''}
              ${missingHtml}
            </div>
            <label class="toggle-switch">
              <input type="checkbox" class="plugin-toggle" data-plugin="${name}" ${plugin.enabled ? 'checked' : ''} ${isMissing ? 'disabled' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        `;
      }).join('');

      pluginsList.querySelectorAll('.plugin-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
          const pluginName = e.target.dataset.plugin;
          const enabled = e.target.checked;
          this.togglePlugin(pluginName, enabled, e.target);
        });
      });
    } catch (err) {
      console.error('[SSHIFT] Error loading plugins:', err);
      pluginsList.innerHTML = '<div class="plugins-loading">Failed to load plugins</div>';
    }
  }

  async togglePlugin(name, enabled, toggleEl) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
      const response = await fetch('/api/plugins', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, enabled })
      });

      if (!response.ok) {
        toggleEl.checked = !enabled;
        this.showToast('Failed to update plugin', 'error');
        return;
      }

      this.showToast(`Plugin "${name}" ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      console.error('[SSHIFT] Error toggling plugin:', err);
      toggleEl.checked = !enabled;
      this.showToast('Failed to update plugin', 'error');
    }
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
        const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
        if (wrapper) {
          const bgColor = this.terminalColorOverride
            ? (this.terminalBgColor || '#0d1117')
            : '#0d1117';
          wrapper.style.backgroundColor = bgColor;
          this.applyScrollbarColors(wrapper, bgColor);
        }
        this.updateViewportBackground(session);
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
    this.clearKeyField('connPrivateKey', 'connKeyFormatBadge', 'connKeyClearBtn');
    this.openModal('connectionModal');
  }

  async handleKeyFileUpload(event, textareaId, badgeId, clearBtnId) {
    const file = event.target.files[0];
    if (!file) return;

    const badge = document.getElementById(badgeId);
    const clearBtn = document.getElementById(clearBtnId);
    const textarea = document.getElementById(textareaId);

    const passphraseId = textareaId === 'connPrivateKey' ? 'connPassphrase' : 'bookmarkPassphrase';
    const passphraseEl = document.getElementById(passphraseId);

    badge.style.display = 'inline-flex';
    badge.textContent = 'Reading...';
    badge.className = 'key-format-badge';

    try {
      const content = await file.text();
      if (!content || !content.trim()) {
        badge.textContent = 'Empty file';
        badge.classList.add('format-error');
        badge.style.display = 'inline-flex';
        return;
      }

      let passphrase = passphraseEl ? passphraseEl.value : '';

      if (!passphrase) {
        const needsPassphrase = this._keyNeedsPassphrase(content);
        if (needsPassphrase) {
          const promptedPassphrase = await this._promptForKeyPassphrase();
          if (promptedPassphrase === null) {
            badge.textContent = 'Encrypted key';
            badge.classList.add('format-warning');
            badge.style.display = 'inline-flex';
            textarea.value = content;
            clearBtn.style.display = 'inline-flex';
            this.showToast('Encrypted key requires a passphrase', 'info');
            event.target.value = '';
            return;
          }
          passphrase = promptedPassphrase;
          if (passphraseEl) passphraseEl.value = passphrase;
        }
      }

      const detectResult = await this.detectAndConvertKey(content, passphrase);
      if (detectResult.error) {
        if (this._isPassphraseError(detectResult.error) && !passphrase) {
          const promptedPassphrase = await this._promptForKeyPassphrase();
          if (promptedPassphrase !== null) {
            passphrase = promptedPassphrase;
            if (passphraseEl) passphraseEl.value = passphrase;
            const retryResult = await this.detectAndConvertKey(content, passphrase);
            if (!retryResult.error) {
              this._applyKeyResult(textarea, badge, clearBtn, retryResult);
              event.target.value = '';
              return;
            }
            this.showToast(retryResult.error, 'error');
          }
        }
        badge.textContent = detectResult.format || 'Error';
        badge.classList.add('format-error');
        badge.style.display = 'inline-flex';
        textarea.value = content;
        clearBtn.style.display = 'inline-flex';
        this.showToast(detectResult.error, 'error');
        return;
      }

      this._applyKeyResult(textarea, badge, clearBtn, detectResult);
    } catch (err) {
      badge.textContent = 'Error';
      badge.classList.add('format-error');
      badge.style.display = 'inline-flex';
      this.showToast('Failed to read key file: ' + err.message, 'error');
    }

    event.target.value = '';
  }

  _keyNeedsPassphrase(content) {
    const trimmed = (content || '').trim();
    if (/^PuTTY-User-Key-File-/im.test(trimmed)) {
      const lines = trimmed.split('\n');
      for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          const key = line.substring(0, colonIdx).trim();
          const value = line.substring(colonIdx + 1).trim();
          if (key === 'Encryption' && value !== 'none') return true;
        }
      }
    }
    if (trimmed.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) return true;
    if (trimmed.includes('ENCRYPTED') && trimmed.includes('-----BEGIN')) return true;
    return false;
  }

  _promptForKeyPassphrase() {
    return new Promise((resolve) => {
      this._showPasswordModal(
        {
          title: 'Encrypted Key',
          label: 'Enter the key passphrase',
          confirmText: 'Decrypt'
        },
        (passphrase) => { resolve(passphrase); },
        () => { resolve(null); }
      );
    });
  }

  _isPassphraseError(errorMessage) {
    if (!errorMessage) return false;
    const lower = errorMessage.toLowerCase();
    return lower.includes('encrypted') || lower.includes('passphrase') || lower.includes('password');
  }

  _applyKeyResult(textarea, badge, clearBtn, detectResult) {
    textarea.value = detectResult.key;

    let formatLabel = detectResult.format;
    if (detectResult.wasConverted) {
      formatLabel = `PPK → OpenSSH`;
    } else if (detectResult.format === 'openssh') {
      formatLabel = 'OpenSSH';
    } else if (detectResult.format === 'pem-rsa') {
      formatLabel = 'PEM (RSA)';
    } else if (detectResult.format === 'pem-ec') {
      formatLabel = 'PEM (EC)';
    } else if (detectResult.format === 'pem-dsa') {
      formatLabel = 'PEM (DSA)';
    } else if (detectResult.format === 'pkcs8') {
      formatLabel = 'PKCS8';
    } else if (detectResult.format === 'pkcs8-encrypted') {
      formatLabel = 'PKCS8 (Encrypted)';
    }

    badge.textContent = formatLabel;
    badge.className = 'key-format-badge';
    if (detectResult.encrypted) {
      badge.classList.add('format-warning');
    }
    badge.style.display = 'inline-flex';
    clearBtn.style.display = 'inline-flex';

    if (detectResult.wasConverted) {
      this.showToast('PPK key converted to OpenSSH format', 'success');
    } else if (detectResult.format === 'openssh') {
      this.showToast('OpenSSH key loaded', 'success');
    } else if (detectResult.format === 'pem-rsa' || detectResult.format === 'pem-ec' || detectResult.format === 'pem-dsa') {
      this.showToast('PEM key loaded', 'success');
    } else if (detectResult.format === 'pkcs8') {
      this.showToast('PKCS8 key loaded', 'success');
    } else if (detectResult.format === 'pkcs8-encrypted') {
      this.showToast('Encrypted PKCS8 key loaded - passphrase required for connection', 'info');
    }
  }

  async detectAndConvertKey(content, passphrase) {
    try {
      const response = await fetch('/api/utils/detect-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });

      if (!response.ok) {
        return { format: 'unknown', key: content, error: 'Failed to detect key format' };
      }

      const info = await response.json();

      if (info.format === 'ppk') {
        try {
          const convertResponse = await fetch('/api/utils/convert-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, passphrase: passphrase || '' })
          });

          if (!convertResponse.ok) {
            const errData = await convertResponse.json().catch(() => ({}));
            return {
              format: 'PPK',
              key: content,
              encrypted: info.encrypted,
              wasConverted: false,
              error: errData.error || 'Failed to convert PPK key. Try converting with PuTTYgen first.'
            };
          }

          const result = await convertResponse.json();
          return {
            format: 'openssh',
            key: result.key,
            encrypted: false,
            wasConverted: true
          };
        } catch (e) {
          return {
            format: 'PPK',
            key: content,
            encrypted: info.encrypted,
            wasConverted: false,
            error: 'Network error converting PPK key: ' + e.message
          };
        }
      }

      if (info.format === 'unknown') {
        if (content.includes('BEGIN')) {
          return { format: 'unknown', key: content, error: 'Unrecognized key format. The SSH library (ssh2) supports OpenSSH, PEM, and PKCS8 formats.' };
        }
        return { format: 'unknown', key: content, error: 'Unrecognized key format. Please upload a valid SSH private key file.' };
      }

      if (info.format === 'pkcs8-encrypted') {
        return {
          format: info.format,
          key: content,
          encrypted: true
        };
      }

      return {
        format: info.format,
        key: content,
        encrypted: info.encrypted || false
      };
    } catch (e) {
      if (/PuTTY-User-Key-File-/i.test(content)) {
        return {
          format: 'PPK',
          key: content,
          encrypted: content.includes('Encryption:') && !content.includes('Encryption: none'),
          wasConverted: false,
          error: 'Cannot convert PPK offline. Please try again when connected to the server, or convert using PuTTYgen.'
        };
      }
      return {
        format: this.detectKeyFormatOffline(content),
        key: content,
        encrypted: content.includes('ENCRYPTED') || (content.includes('Encryption:') && !content.includes('Encryption: none'))
      };
    }
  }

  detectKeyFormatOffline(content) {
    if (content.includes('BEGIN OPENSSH PRIVATE KEY')) return 'openssh';
    if (content.includes('BEGIN RSA PRIVATE KEY')) return 'pem-rsa';
    if (content.includes('BEGIN EC PRIVATE KEY')) return 'pem-ec';
    if (content.includes('BEGIN DSA PRIVATE KEY')) return 'pem-dsa';
    if (content.includes('BEGIN PRIVATE KEY')) return 'pkcs8';
    if (content.includes('BEGIN ENCRYPTED PRIVATE KEY')) return 'pkcs8-encrypted';
    if (/PuTTY-User-Key-File-/i.test(content)) return 'ppk';
    return 'unknown';
  }

  clearKeyField(textareaId, badgeId, clearBtnId) {
    document.getElementById(textareaId).value = '';
    const badge = document.getElementById(badgeId);
    badge.style.display = 'none';
    badge.textContent = '';
    badge.className = 'key-format-badge';
    document.getElementById(clearBtnId).style.display = 'none';
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
    // Use actual terminal dimensions when available (falls back to 80x24
    // for the initial connection, then immediately resized via ssh-resize
    // after terminal is fitted)
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
      const bookmarkData = { name, host, port, username, type };
      if (password) bookmarkData.password = password;
      if (privateKey) bookmarkData.privateKey = privateKey;
      if (passphrase) bookmarkData.passphrase = passphrase;
      this.addBookmark(bookmarkData);
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

    // Idempotency: if a tab for this sessionId already exists (DOM +
    // session map), return the existing id rather than creating a
    // duplicate. Guards against duplicate tab-opened echoes and any
    // future regressions of the mobile tab-count bug.
    const existingDomTab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    if (existingDomTab && this.sessions.has(sessionId)) {
      console.log('[SSHIFT] createSSHTab: session already exists, returning existing id:', sessionId);
      return sessionId;
    }
    if (existingDomTab) {
      // Stale DOM tab without a session entry — remove it before re-creating.
      existingDomTab.remove();
      const existingWrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
      if (existingWrapper) existingWrapper.remove();
    }

    console.log('[SSHIFT] createSSHTab called:', { 
      name, 
      sessionId, 
      restoreSessionId, 
      isRestoring: !!restoreSessionId,
      host: connectionData.host 
    });
    
    const tab = this.createTabElement(sessionId, name, 'ssh');
    const terminalWrapper = this.createTerminalElement(sessionId);

    // Always add new tabs to the first panel
    const panels = this.getAllPanels();
    const firstPanelId = panels[0];
    const tabsContainer = this.getTabsContainer(firstPanelId);
    const terminalsContainer = this.getTerminalsContainer(firstPanelId);
    
    if (!tabsContainer || !terminalsContainer) {
      console.error('[SSHIFT] Could not find tabs or terminals container for first panel:', firstPanelId);
      return null;
    }
    
    tabsContainer.appendChild(tab);
    terminalsContainer.appendChild(terminalWrapper);
    
    // Update scroll arrows visibility
    this.updateTabsScrollArrows();

    this.sessions.set(sessionId, {
      id: sessionId,
      name,
      type: 'ssh',
      terminal: null,
      fitAddon: null,
      webglAddon: null,
      webglContextLossCount: 0,
      _webglInitPending: false,
      connecting: true,
      connected: false,
      connectionData,
      isRestoring: !!restoreSessionId,
      isAtBottom: true,
      isController: false,
      syncing: false,
      fontSize: this.terminalFontSize,
      mobileHandler: null,
      writeChunks: [],
      writeRAF: null,
      flushRemaining: null,
      originalScrollback: null,
      scrollbackRestoreTimer: null,
      // Per-session buffer for OSC 52 / DCS sequences that arrive split
      // across two write-chunk frames (see _handleOsc52).
      pendingOsc52: null
    });

    // Switch to the new tab FIRST to make the container visible
    const panelId = this.getPanelForSession(sessionId);
    this.switchTab(sessionId, panelId);
    this.hideEmptyState(panelId);

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
            session._syncRetries = 0;

            // Safety timeout: if sync never arrives within 5s the
            // terminal would be stuck silently dropping all output.
            // Clear the flag AND request a fresh sync (up to 2 retries)
            // so a slow/lost ssh-screen-sync doesn't permanently lose
            // output for this client.
            session.syncTimeout = setTimeout(() => {
              console.warn('[SSHIFT] Sync timeout for session:', restoreSessionId, 'retries:', session._syncRetries);
              session.syncing = false;
              if (session._syncRetries < 2 && session.connected) {
                session._syncRetries += 1;
                this.requestScreenSync(restoreSessionId);
              } else {
                session._syncRetries = 0;
              }
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
        const panelId = this.getPanelForSession(sessionId);
        this.switchTab(sessionId, panelId);
      }
    });

    // Middle-click (mouse button 3/wheel) to close tab
    tab.addEventListener('auxclick', (e) => {
      // Button 1 is the middle mouse button
      if (e.button === 1) {
        e.preventDefault();
        this.closeTab(sessionId);
      }
    });

    return tab;
  }

  handleTabDragStart(e, sessionId) {
    this.draggedTab = sessionId;
    e.target.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sessionId); // Store sessionId for cross-panel drops
    
    // Add dragging class to prevent cursor changes
    document.body.classList.add('dragging-tabs');
  }

  handleTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    // Find the tabs container (full width drop zone)
    const tabsContainer = e.target.closest('.tabs');
    
    if (tabsContainer) {
      // Highlight the entire tabs container
      tabsContainer.classList.add('drag-over');
      
      // Also highlight individual tabs for reordering indication
      const target = e.target.closest('.tab');
      if (target && target.dataset.sessionId !== this.draggedTab) {
        target.style.borderLeft = '2px solid var(--accent-primary)';
      }
    }
  }

  handleTabDrop(e, targetSessionId) {
    e.preventDefault();
    
    if (!this.draggedTab || this.draggedTab === targetSessionId) {
      return;
    }

    // Find the panel containing the target tab
    const targetPanelId = this.getPanelForSession(targetSessionId);
    const sourcePanelId = this.getPanelForSession(this.draggedTab);
    const tabsContainer = this.getTabsContainer(targetPanelId);
    
    if (!tabsContainer) {
      console.error('[SSHIFT] Could not find tabs container for panel:', targetPanelId);
      return;
    }
    
    // If dragging to a different panel, move the tab
    if (sourcePanelId !== targetPanelId) {
      console.log('[SSHIFT] Moving tab from panel', sourcePanelId, 'to panel', targetPanelId);
      this.moveTabToPanel(this.draggedTab, targetPanelId);
      
      // Reorder within the target panel after moving
      const tabs = Array.from(tabsContainer.children);
      const targetIndex = tabs.findIndex(t => t.dataset.sessionId === targetSessionId);
      const draggedTabElement = tabs.find(t => t.dataset.sessionId === this.draggedTab);
      
      if (draggedTabElement && targetIndex !== -1) {
        // Insert at the position of the target tab
        const draggedIndex = tabs.indexOf(draggedTabElement);
        if (draggedIndex < targetIndex) {
          tabsContainer.insertBefore(draggedTabElement, tabs[targetIndex].nextSibling);
        } else {
          tabsContainer.insertBefore(draggedTabElement, tabs[targetIndex]);
        }
      }
    } else {
      // Same panel - just reorder
      const tabs = Array.from(tabsContainer.children);
      const draggedIndex = tabs.findIndex(t => t.dataset.sessionId === this.draggedTab);
      const targetIndex = tabs.findIndex(t => t.dataset.sessionId === targetSessionId);

      if (draggedIndex !== -1 && targetIndex !== -1) {
        const draggedTab = tabs[draggedIndex];
        
        if (draggedIndex < targetIndex) {
          tabsContainer.insertBefore(draggedTab, tabs[targetIndex].nextSibling);
        } else {
          tabsContainer.insertBefore(draggedTab, tabs[targetIndex]);
        }
      }
    }
    
    // Save tabs after reordering
    this.saveTabs();
  }

  handleTabDragEnd(e) {
    e.target.style.opacity = '1';
    this.draggedTab = null;
    
    // Remove dragging class
    document.body.classList.remove('dragging-tabs');
    
    // Remove all border styles from tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.style.borderLeft = '';
    });
    
    // Remove drag-over class from all tabs containers
    document.querySelectorAll('.tabs').forEach(container => {
      container.classList.remove('drag-over');
    });
    
    // Save tabs order when sticky is enabled
    this.saveTabs();
    
    // Emit tab reorder to server for cross-client sync
    if (this.sticky && this.socket && this.socket.connected) {
      const panels = this.getAllPanels();
      panels.forEach(panelId => {
        const tabsContainer = this.getTabsContainer(panelId);
        if (tabsContainer) {
          const order = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
          this.socket.emit('tab-reorder', { order, panelId });
        }
      });
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
    wrapper.dataset.sessionId = sessionId; // Add data attribute for easier querying
    
    // Create a dedicated container for xterm
    const terminalContainer = document.createElement('div');
    terminalContainer.className = 'terminal-container';
    terminalContainer.id = `terminal-${sessionId}`;
    
    wrapper.appendChild(terminalContainer);
    
    // Create control overlay (hidden by default)
    const controlOverlay = document.createElement('div');
    controlOverlay.className = 'terminal-control-overlay';
    controlOverlay.id = `control-overlay-${sessionId}`;
    controlOverlay.style.display = 'none'; // Hidden by default
    
    const controlContent = document.createElement('div');
    controlContent.className = 'terminal-control-content';
    
    const controlIcon = document.createElement('i');
    controlIcon.className = 'fas fa-eye terminal-control-icon';
    
    const controlText = document.createElement('div');
    controlText.className = 'terminal-control-text';
    controlText.innerHTML = `
      <div class="terminal-control-title">View Only</div>
      <div class="terminal-control-subtitle">Another device is controlling this terminal</div>
      <div class="terminal-control-manage" id="manage-sessions-link-${sessionId}">Manage Sessions</div>
    `;
    
    const takeControlBtn = document.createElement('button');
    takeControlBtn.className = 'btn btn-primary terminal-control-btn';
    takeControlBtn.id = `take-control-btn-${sessionId}`;
    takeControlBtn.innerHTML = '<i class="fas fa-hand-pointer"></i> Take Control';
    takeControlBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.requestTakeControl(sessionId);
    });
    
    controlContent.appendChild(controlIcon);
    controlContent.appendChild(controlText);
    controlContent.appendChild(takeControlBtn);
    controlOverlay.appendChild(controlContent);
    
    // Add click handler for Manage Sessions link
    const manageLink = controlText.querySelector('.terminal-control-manage');
    if (manageLink) {
      manageLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openSessionsModal();
      });
    }
    wrapper.appendChild(controlOverlay);
    
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

    // Ensure container has dimensions large enough for a usable terminal
    // before opening it.  A pane that is mid-layout-transition can briefly
    // measure ~100x100px; terminal.open() at that size computes bogus
    // cols/rows that get sent to the remote PTY, and the terminal stays
    // tiny from then on.  See _fitTerminal's matching threshold comment.
    const rect = container.getBoundingClientRect();
    if (
      !isVisible ||
      rect.width < 50 || rect.height < 50 ||
      container.offsetWidth === 0 || container.offsetHeight === 0
    ) {
      if (retryCount < 10) {
        console.warn(`[SSHIFT] Container not ready (attempt ${retryCount + 1}/10, ${rect.width}x${rect.height}px), waiting...`);
        setTimeout(() => this.initTerminal(sessionId, retryCount + 1), 100);
        return;
      } else {
        console.error('[SSHIFT] Container failed to become visible after 10 attempts, retrying...');
        // Don't show a toast — the terminal will initialize on the next resize
        // or when the tab becomes active. Showing a toast is disruptive and confusing.
        setTimeout(() => this.initTerminal(sessionId, 0), 500);
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
        fontSize: this.terminalFontSize,
        lineHeight: 1.0,
        letterSpacing: 0,
        cursorBlink: false,
        cursorStyle: 'block',
        scrollback: this.scrollback || 10000,
        allowProposedApi: true,
        convertEol: true,
        allowTransparency: false,
        disableStdin: false,
        logLevel: 'warn',
        fastScrollModifier: 'alt',
        fastScrollSensitivity: 5,
        smoothScrollDuration: 80,
        overviewRuler: { width: 0 },
        customGlyphs: true
      });

      // Set wrapper background color
      if (wrapper) {
        if (this.terminalColorOverride) {
          wrapper.style.backgroundColor = this.terminalBgColor;
          this.applyScrollbarColors(wrapper, this.terminalBgColor);
        } else {
          wrapper.style.backgroundColor = '#0d1117';
          this.applyScrollbarColors(wrapper, '#0d1117');
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

      // Load Unicode11 addon for correct wide/ambiguous character width handling.
      // Without this, xterm.js uses its built-in width table (Unicode 6),
      // which mis-calculates many characters — causing cursor positioning
      // and erase-line operations to desync from the remote PTY's layout.
      // This is the primary fix for "dropped characters" in TUI apps
      // like OpenCode whose input line repaints depend on exact cell widths.
      if (typeof window.Unicode11Addon === 'function') {
        try {
          const unicode11Addon = new window.Unicode11Addon();
          terminal.loadAddon(unicode11Addon);
          terminal.unicode.activeVersion = '11';
          console.log('[SSHIFT] Unicode11 addon loaded, activeVersion set to 11');
        } catch (e) {
          console.warn('[SSHIFT] Failed to load Unicode11 addon:', e.message);
        }
      } else {
        console.warn('[SSHIFT] Unicode11 addon not available (window.Unicode11Addon type:', typeof window.Unicode11Addon, ')');
      }

      console.log('[SSHIFT] Opening terminal in container...');
      
      // Ensure container has valid dimensions before opening.
      // xterm.js's terminal.open() inlines a sized <div> based on whatever
      // cols/rows the Terminal was constructed with; if the container is
      // collapsed at open() time the inline styles get pinned to near-zero
      // pixels and subsequent fit()s can fail to recover from that state.
      // The matching load-time retry above already keeps us waiting until
      // the container is usable; re-check here as a hard invariant.
      const rect = container.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) {
        console.error('[SSHIFT] Container not usable before open():', rect.width, 'x', rect.height);
        this.showToast('Terminal container has invalid dimensions', 'error');
        return;
      }
      
      // Clear any existing content in container
      container.innerHTML = '';
      
      terminal.open(container);
      
      // Initialise the WebGL renderer only if the wrapper is currently
      // visible.  Loading WebGL on a hidden (display:none) terminal
      // produces a zero-size canvas, corrupting the glyph texture atlas
      // and causing dim/invisible text (Bug 3).
      if (wrapper.classList.contains('active')) {
        this._initWebGLAddon(session, true);
      } else {
        session._webglInitPending = true;
        console.log('[SSHIFT] Deferring WebGL init — terminal not yet visible');
      }
      
      // Load image addon if enabled and available (Sixel/iTerm2/Kitty image protocols)
      if (this.imageAddonEnabled && typeof window.ImageAddon === 'function') {
        try {
          const imageAddon = new window.ImageAddon();
          terminal.loadAddon(imageAddon);
          console.log('[SSHIFT] ImageAddon loaded');
        } catch (e) {
          console.warn('[SSHIFT] Failed to load ImageAddon:', e.message);
        }
      } else if (this.imageAddonEnabled) {
        console.warn('[SSHIFT] ImageAddon not available (window.ImageAddon type:', typeof window.ImageAddon, ')');
      } else {
        console.log('[SSHIFT] Image addon disabled in settings');
      }
      
      // Register OSC 52 handler for clipboard operations from remote terminals
      // This allows programs like opencode, tmux, vim, etc. to set the clipboard
      // via the OSC 52 escape sequence: \e]52;c;<base64-text>\007
      //
      // Browser Clipboard API requires a user gesture, but OSC 52 data arrives
      // asynchronously from the SSH stream. We buffer the content synchronously
      // and flush it on the next user interaction (click, keydown, touchstart).
      // Immediate writes are also attempted but may fail without a user gesture.
      try {
        const flushOsc52Buffer = () => {
          if (this.osc52Buffer !== null && this.osc52Buffer !== undefined) {
            const text = this.osc52Buffer;
            this.osc52Buffer = null;
            console.log('[SSHIFT] Flushing OSC 52 clipboard buffer, length:', text.length);
            this.copyToClipboard(text).then(success => {
              if (success) {
                console.log('[SSHIFT] OSC 52 clipboard write succeeded (flushed on user gesture)');
                this.showToast('Copied to clipboard', 'success');
              } else {
                console.warn('[SSHIFT] OSC 52 clipboard write failed after flush, re-buffering');
                this.osc52Buffer = text;
              }
            }).catch(err => {
              console.warn('[SSHIFT] OSC 52 clipboard write failed:', err);
              this.osc52Buffer = text;
            });
          }
        };
        document.addEventListener('click', flushOsc52Buffer, true);
        document.addEventListener('keydown', flushOsc52Buffer, true);
        document.addEventListener('touchstart', flushOsc52Buffer, true);

        // Store for cleanup when the session is closed
        const sess = this.sessions.get(sessionId);
        if (sess) sess.osc52FlushListener = flushOsc52Buffer;

// Also register as fallback with xterm.js's OSC handler in case any
        // OSC 52 sequences slip through the data stream interceptor (e.g. from
        // screen sync restoration). The data stream interceptor is the primary handler.
        terminal.registerOscHandler(52, (data) => {
          console.log('[SSHIFT] OSC 52 handler fallback triggered (should be handled by stream interceptor)');
          const semicolonIndex = data.indexOf(';');
          if (semicolonIndex === -1) return true;
          const content = data.substring(semicolonIndex + 1);
          if (!content) {
            this.osc52Buffer = '';
            return true;
          }
          try {
            const decoded = atob(content);
            this.osc52Buffer = decoded;
            this.copyToClipboard(decoded).then(success => {
              if (success) this.osc52Buffer = null;
            }).catch(() => {});
          } catch (e) {
            console.warn('[SSHIFT] OSC 52 base64 decode failed:', e);
          }
          return true;
        });
        console.log('[SSHIFT] OSC 52 clipboard handler registered');
      } catch (e) {
        console.warn('[SSHIFT] Failed to register OSC 52 handler:', e.message);
      }
      
      // Enable cursor blink after addons are loaded to avoid
      // repaint interference during initial render
      terminal.options.cursorBlink = true;
      
      console.log('[SSHIFT] Terminal opened, waiting for fonts before fitting...');
      
      // CRITICAL: Wait for custom monospace fonts (JetBrains Mono etc.) to
      // finish loading before calling fitAddon.fit().  If we fit before the
      // web font swaps in, the browser measures the fallback font's glyph
      // width which is typically narrower, producing far fewer columns than
      // the container can actually hold.  Those bogus dimensions are then
      // sent to the remote PTY, wrapping every ~10 characters (Bug 1).
      // After fonts are ready we delay by one animation frame so the
      // browser has repainted with the correct metrics.
      const fontReady = document.fonts
        ? document.fonts.ready
        : Promise.resolve();

      fontReady.then(() => {
        // Force the CharSizeService to re-measure the glyph dimensions now
        // that the web font has swapped in.  xterm.js v6's CharSizeService
        // only re-measures on fontFamily/fontSize option changes or on
        // resize() — it does NOT observe document.fonts.ready itself.  A
        // competing fit() (e.g. from the ResizeObserver) that runs before
        // font load completes leaves the renderer's dimensions stuck at the
        // fallback font's metrics.  That mismatch paints every other row as
        // an empty black band (the "interlace" bug) because the atlas
        // rasters glyphs at the real font size while the cell layout keeps
        // the fallback's smaller row pitch.  Calling measure() here fires
        // onCharSizeChange synchronously, which the RenderService listens to
        // and forwards to the renderer's handleCharSizeChanged so
        // _updateDimensions + _refreshCharAtlas run before our fit().
        const core = terminal._core;
        if (core && core._charSizeService && typeof core._charSizeService.measure === 'function') {
          try { core._charSizeService.measure(); } catch (_) {}
        }

        // Clear the WebGL texture atlas after the font swap — glyphs cached
        // before the swap were rasterised at the fallback font's metrics.
        if (session.webglAddon) {
          try { session.webglAddon.clearTextureAtlas(); } catch (_) {}
        }

        // Also check if WebGL init was deferred due to hidden wrapper
        // (Bug 3) — the terminal may now be visible.
        if (session._webglInitPending && wrapper.classList.contains('active')) {
          session._webglInitPending = false;
          this._initWebGLAddon(session, true);
        }

        requestAnimationFrame(() => {
          const fitted = this._fitTerminal(session);
          if (fitted) {
            console.log('[SSHIFT] Terminal fitted after fonts ready, cols:', terminal.cols, 'rows:', terminal.rows);
          } else {
            // If _fitTerminal couldn't fit (e.g. wrapper not visible yet),
            // it will have set needsResize = true so switchTab() picks it up.
            console.log('[SSHIFT] Could not fit after fonts ready — deferred to tab activation');
          }

          // Safety net: the first fit may have measured a pane mid-layout
          // (Browser is still committing display:none -> display:flex, or a
          // sidebar is collapsing/opening).  Re-fit after layout settles so
          // a transient small pane size doesn't leave the terminal stuck in
          // a ~100x100px box (the "tiny terminal" bug).  Mirrors the same
          // fix already used in switchTab().
          setTimeout(() => {
            if (!session.terminal || !session.fitAddon || !session.isController) return;
            const w = document.getElementById(`terminal-wrapper-${session.id}`);
            if (w && w.classList.contains('active')) {
              this._fitTerminal(session);
            }
          }, 250);
          setTimeout(() => {
            if (!session.terminal || !session.fitAddon || !session.isController) return;
            const w = document.getElementById(`terminal-wrapper-${session.id}`);
            if (w && w.classList.contains('active')) {
              this._fitTerminal(session);
            }
          }, 600);
        });
      });

      // Handle terminal input
      terminal.onData((data) => {
        const sess = this.sessions.get(sessionId);
        
        // Only allow input if this client is the controller
        if (sess && !sess.isController) {
          return;
        }
        
        // Handle mobile Ctrl/Alt modifiers for physical keyboard input
        // When mobile Ctrl or Alt is active, modify the input
        if (sess && sess.connected) {
          // Check if this is a single character input (from physical keyboard on mobile)
          if (data.length === 1 && (this.ctrlPressed || this.altPressed)) {
            const char = data.toLowerCase();
            const charCode = data.charCodeAt(0);
            
            // Only process printable ASCII characters (letters, numbers, symbols)
            if (charCode >= 32 && charCode <= 126) {
              if (this.ctrlPressed && /[a-z]/.test(char)) {
                // Send Ctrl+key sequence
                const ctrlSequences = {
                  'a': '\x01', 'b': '\x02', 'c': '\x03', 'd': '\x04', 'e': '\x05',
                  'f': '\x06', 'g': '\x07', 'h': '\x08', 'i': '\x09', 'j': '\x0a',
                  'k': '\x0b', 'l': '\x0c', 'm': '\x0d', 'n': '\x0e', 'o': '\x0f',
                  'p': '\x10', 'q': '\x11', 'r': '\x12', 's': '\x13', 't': '\x14',
                  'u': '\x15', 'v': '\x16', 'w': '\x17', 'x': '\x18', 'y': '\x19',
                  'z': '\x1a'
                };
                const sequence = ctrlSequences[char];
                if (sequence) {
                  this.socket.emit('ssh-data', { sessionId, data: sequence });
                  // Reset Ctrl after use
                  this.ctrlPressed = false;
                  const ctrlKey = document.querySelector('.mobile-key[data-key="ctrl"]');
                  if (ctrlKey) ctrlKey.classList.remove('active');
                  return; // Don't send the original character
                }
              } else if (this.altPressed) {
                // Send ESC + key for Alt
                this.socket.emit('ssh-data', { sessionId, data: '\x1b' + data });
                // Reset Alt after use
                this.altPressed = false;
                const altKey = document.querySelector('.mobile-key[data-key="alt"]');
                if (altKey) altKey.classList.remove('active');
                return; // Don't send the original character
              }
            }
          }
          
          this.socket.emit('ssh-data', { sessionId, data });
        } else if (sess && sess.connecting) {
          // Buffer input while connecting (optional)
        } else {
          console.warn('[SSHIFT] Input received but session not connected! Session:', sess);
        }
      });

      // Handle resize
      terminal.onResize(({ cols, rows }) => {
        const sess = this.sessions.get(sessionId);
        if (sess && sess.connected) {
          // Only allow resize if this client is the controller
          if (!sess.isController) {
            return;
          }
          
          // Skip if we're currently syncing from another client's resize
          // This prevents resize feedback loops between clients
          if (sess.isResyncing) {
            return;
          }
          
          // Debounce resize events to prevent resize storms between clients
          if (sess.resizeTimeout) {
            clearTimeout(sess.resizeTimeout);
          }
          sess.resizeTimeout = setTimeout(() => {
            this.socket.emit('ssh-resize', { sessionId, cols, rows });
          }, 100); // 100ms debounce
        }
      });

      // Handle copy/paste keyboard shortcuts
      terminal.attachCustomKeyEventHandler((event) => {
        // Handle mobile Ctrl modifier - apply to physical keyboard input
        // When mobile Ctrl is active and user types a key, send Ctrl+key
        if (event.type === 'keydown' && this.ctrlPressed && !event.ctrlKey) {
          const key = event.key.toLowerCase();
          // Only apply Ctrl to single character keys (letters, numbers)
          if (key.length === 1 && /[a-z0-9]/.test(key)) {
            // Send Ctrl+key sequence
            const ctrlSequences = {
              'a': '\x01', 'b': '\x02', 'c': '\x03', 'd': '\x04', 'e': '\x05',
              'f': '\x06', 'g': '\x07', 'h': '\x08', 'i': '\x09', 'j': '\x0a',
              'k': '\x0b', 'l': '\x0c', 'm': '\x0d', 'n': '\x0e', 'o': '\x0f',
              'p': '\x10', 'q': '\x11', 'r': '\x12', 's': '\x13', 't': '\x14',
              'u': '\x15', 'v': '\x16', 'w': '\x17', 'x': '\x18', 'y': '\x19',
              'z': '\x1a'
            };
            const sequence = ctrlSequences[key];
            const sess = this.sessions.get(sessionId);
            if (sequence && sess && sess.connected) {
              this.socket.emit('ssh-data', { sessionId, data: sequence });
            }
            // Reset Ctrl after use
            this.ctrlPressed = false;
            const ctrlKey = document.querySelector('.mobile-key[data-key="ctrl"]');
            if (ctrlKey) ctrlKey.classList.remove('active');
            return false; // Prevent default
          }
        }
        
        // Handle mobile Alt modifier - apply to physical keyboard input
        if (event.type === 'keydown' && this.altPressed && !event.altKey) {
          const key = event.key;
          // Only apply Alt to single character keys
          if (key.length === 1) {
            // Send ESC + key for Alt
            const sess = this.sessions.get(sessionId);
            if (sess && sess.connected) {
              this.socket.emit('ssh-data', { sessionId, data: '\x1b' + key });
            }
            // Reset Alt after use
            this.altPressed = false;
            const altKey = document.querySelector('.mobile-key[data-key="alt"]');
            if (altKey) altKey.classList.remove('active');
            return false; // Prevent default
          }
        }
        
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
            if (session.webglAddon) {
              terminal.refresh(0, terminal.rows - 1);
            }
            return false; // Prevent default behavior
          }
        }
        
        // Ctrl+V - Paste
        if (event.ctrlKey && event.key === 'v' && event.type === 'keydown') {
          event.preventDefault(); // Prevent browser paste event to avoid double-paste
          this.readFromClipboard().then(text => {
            if (text) {
              const sess = this.sessions.get(sessionId);
              if (sess && sess.connected) {
                this.sendChunkedInput(sessionId, text);
                this.showToast('Pasted from clipboard', 'success');
              }
            } else {
              this.showToast('Clipboard is empty', 'info');
            }
          });
          return false; // Prevent xterm key handling
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
            if (session.webglAddon) {
              terminal.refresh(0, terminal.rows - 1);
            }
            return false;
          }
        }
        
        // Ctrl+Shift+V - Force paste
        if (event.ctrlKey && event.shiftKey && event.key === 'V') {
          event.preventDefault(); // Prevent browser paste event to avoid double-paste
          this.readFromClipboard().then(text => {
            if (text) {
              const sess = this.sessions.get(sessionId);
              if (sess && sess.connected) {
                this.sendChunkedInput(sessionId, text);
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

      // Handle right-click for context menu (desktop only)
      container.addEventListener('contextmenu', async (e) => {
        // On mobile, skip custom context menu - use native selection UI instead
        if (this.isMobile) {
          console.log('[SSHIFT] Mobile device - using native selection UI, skipping custom context menu');
          // Don't prevent default - let native selection work
          return;
        }
        
        console.log('[SSHIFT] Context menu triggered, hasSelection:', terminal.hasSelection());
        e.preventDefault();
        
        // Pre-read clipboard content during user gesture (right-click)
        // This is needed because clipboard API requires user gesture
        this.terminalClipboardContent = null;
        
        // Try modern Clipboard API first
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            console.log('[SSHIFT] Attempting to read clipboard via Clipboard API...');
            const text = await navigator.clipboard.readText();
            this.terminalClipboardContent = text;
            console.log('[SSHIFT] Pre-read clipboard content successfully, length:', text?.length || 0);
          } else {
            console.warn('[SSHIFT] Clipboard API not available, will use fallback on paste');
          }
        } catch (err) {
          console.warn('[SSHIFT] Could not pre-read clipboard:', err.name, err.message);
        }
        
        // Show terminal context menu
        this.showTerminalContextMenu(sessionId, terminal, e);
      });

      // When the selection is cleared (e.g. after copy / deselect) the
      // WebGL renderer can leave behind blank cells because the texture atlas
      // cached the "selected" version of the glyph and never re-rasterised
      // the deselected state.  Force a full repaint on every selection change
      // so deselected cells are always redrawn with the correct glyph.
      terminal.onSelectionChange(() => {
        if (session.webglAddon) {
          session.terminal.refresh(0, session.terminal.rows - 1);
        }
      });

      // Defensive activation: clear stuck `isResyncing` on user interaction.
      // Backgrounded / throttled browser tabs can leave `isResyncing` set
      // (setTimeout was deferred by the browser's power saver) which
      // suppresses onResize emits. After inactivity on a TUI app, mouse
      // clicks and scroll can stop working until the user refreshes.
      // Fix: on mouse/wheel interaction (desktop), clear the flag AND
      // re-focus the terminal so xterm's mouse-service fires.
      // On mobile touch, ONLY clear the flag — do NOT re-focus the
      // hidden textarea because that would pop the on-screen keyboard
      // on every scroll drag. The mobile handler manages keyboard
      // visibility separately.
      const clearResyncing = () => {
        if (!session) return;
        if (session.isResyncing) {
          session.isResyncing = false;
        }
      };
      const activateAndFocus = () => {
        clearResyncing();
        requestAnimationFrame(() => {
          if (session.terminal && !this.isMobile) {
            try { session.terminal.focus(); } catch (_) {}
          }
        });
      };
      container.addEventListener('mousedown', activateAndFocus, true);
      container.addEventListener('wheel', clearResyncing, true);
      // On mobile, only clear isResyncing on touchstart — do NOT focus.
      container.addEventListener('touchstart', clearResyncing, true);

      session.terminal = terminal;
      session.fitAddon = fitAddon;

      this.updateViewportBackground(session);

      // Flush any data that was buffered before the terminal was ready
      if (session.writeChunks.length > 0 || session.flushRemaining) {
        this._flushWriteChunks(sessionId);
      }

      // Initialize mobile terminal handler for touch interactions
      if (this.isMobile && typeof window.MobileTerminalHandler === 'function') {
        try {
          const terminalWrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
          if (terminalWrapper) {
            session.mobileHandler = new window.MobileTerminalHandler(terminal, session, this);
            session.mobileHandler.init(terminalWrapper);
            console.log('[SSHIFT] Mobile terminal handler initialized for session:', sessionId);
          }
        } catch (e) {
          console.warn('[SSHIFT] Failed to initialize mobile handler:', e);
        }
      }

      // Setup ResizeObserver to handle container size changes
      // This ensures the terminal is refitted when the container is resized
      // We observe the wrapper (parent) because it persists across layout changes
      const resizeObserver = new ResizeObserver((entries) => {
        // Only fit if this is the controller and terminal is visible
        if (session.isController && session.terminal && wrapper.classList.contains('active')) {
          try {
            if (session.resizeTimeout) {
              clearTimeout(session.resizeTimeout);
            }
            session.resizeTimeout = setTimeout(() => {
              try {
                if (session.fitAddon && session.terminal && wrapper.classList.contains('active')) {
                  this._fitTerminal(session);
                }
              } catch (e) {
                console.warn('[SSHIFT] Could not refit terminal on resize:', e.message);
              }
            }, 100);
          } catch (e) {
            console.warn('[SSHIFT] ResizeObserver error:', e.message);
          }
        }
      });
      
      // Observe the terminal wrapper (parent of container)
      // The wrapper persists across layout changes
      resizeObserver.observe(wrapper);
      session.resizeObserver = resizeObserver;

      // Keep xterm's scrollbar dimensions + slider bg consistent.
      // xterm sets inline width: 14px and bg: rgb(73,77,83) on the
      // slider every time it re-renders; a MutationObserver catches
      // each change and overrides it back.
      {
        const targetW = this.isMobile ? '4px' : '8px';
        const fixScrollbar = () => {
          const sbs = wrapper.querySelectorAll('.xterm-scrollable-element > .scrollbar.vertical');
          sbs.forEach(sb => {
            if (sb.style.width !== targetW) {
              sb.style.width = targetW;
              sb.style.minWidth = targetW;
              sb.style.maxWidth = targetW;
            }
            const slider = sb.querySelector('.slider');
            if (slider) {
              if (slider.style.width !== targetW) {
                slider.style.width = targetW;
                slider.style.minWidth = targetW;
                slider.style.maxWidth = targetW;
              }
              // Override xterm's inline !important bg (lighter shade
              // that looks like a white line) with a dark thumb color.
              slider.style.setProperty('background-color', '#3d444d', 'important');
            }
          });
        };
        requestAnimationFrame(fixScrollbar);
        const mo = new MutationObserver(fixScrollbar);
        const scrollableEl = wrapper.querySelector('.xterm-scrollable-element');
        if (scrollableEl) {
          mo.observe(scrollableEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
        session._scrollbarObserver = mo;
      }

      // Setup mobile scroll behavior after terminal is ready
      // Use requestAnimationFrame to ensure terminal.element is available
      requestAnimationFrame(() => {
        this.setupMobileScrollBehavior(sessionId);
        this.setupWheelScroll(sessionId);

        // Force thinner scrollbar on mobile. xterm v6 sets an inline
        // width: 14px on the vertical scrollbar AND its slider — override
        // both via inline style since CSS !important on the slider doesn't
        // always survive against xterm's re-renders.
        // On desktop, override the slider bg color which xterm sets inline
        // to rgb(73,77,83) — a lighter shade that looks like a white line
        // against the dark terminal background.
        const targetWidth = this.isMobile ? '4px' : '8px';
        {
          const scrollbars = wrapper.querySelectorAll('.xterm-scrollable-element > .scrollbar');
          scrollbars.forEach(sb => {
            if (sb.classList.contains('vertical')) {
              sb.style.width = targetWidth;
              sb.style.minWidth = targetWidth;
              sb.style.maxWidth = targetWidth;
              const slider = sb.querySelector('.slider');
              if (slider) {
                slider.style.width = targetWidth;
                slider.style.minWidth = targetWidth;
                slider.style.maxWidth = targetWidth;
                // Override xterm's inline !important bg with a dark shade
                // that's visible but doesn't look like a white line.
                slider.style.setProperty('background-color', '#3d444d', 'important');
              }
            }
          });
        }
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
      
      // The client that creates the session is the controller
      session.isController = true;
      session.controllerSocket = this.socket.id;
      console.log('[SSHIFT] Client is controller for new session');
      
      // Update control overlay (should be hidden since we're controller)
      this.updateControlOverlay(data.sessionId);
      
      this.showToast('SSH connection established', 'success');
      console.log('[SSHIFT] Session marked as connected, terminal exists:', !!session.terminal);
      
      // Clear the connecting message and let the shell take over
      if (session.terminal) {
        console.log('[SSHIFT] Terminal exists, clearing connecting message');
        // Clear the terminal to remove connecting messages
        session.terminal.clear();
        
        // Send initial resize — but wait for fonts first so we send
        // the correct column/row count (Bug 1).  If fonts haven't
        // loaded yet, the fallback font's narrower glyphs would make
        // fit() report far fewer cols than the container can actually
        // hold.  The PTY on the server wraps at those bogus dimensions.
        const sendResize = () => {
          if (session.fitAddon) {
            const fitted = this._fitTerminal(session);
            // Only send the resize to the server if we actually fitted
            // successfully — otherwise the remote PTY would get stale
            // dimensions.  A deferred retry will trigger onResize which
            // sends ssh-resize via the debounced handler.
            if (fitted) {
              this.socket.emit('ssh-resize', { 
                sessionId: data.sessionId, 
                cols: session.terminal.cols, 
                rows: session.terminal.rows 
              });
            }
          }
        };

        if (document.fonts && document.fonts.status !== 'loaded') {
          document.fonts.ready.then(sendResize);
        } else {
          sendResize();
        }
        
        // Focus the terminal so user can type immediately
        if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
          session.mobileHandler._focusHiddenTextarea();
        } else {
          session.terminal.focus();
        }
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
      if (session.syncing) {
        return;
      }
      
      try {
        session.writeChunks.push(data.data);
        
        if (!session.writeRAF) {
          session.writeRAF = requestAnimationFrame(() => {
            this._flushWriteChunks(data.sessionId);
          });
        }
        
        // Auto-scroll to bottom on mobile when new data arrives
        if (this.isMobile) {
          if (session.scrollRAF) {
            cancelAnimationFrame(session.scrollRAF);
          }
          session.scrollRAF = requestAnimationFrame(() => {
            this.scrollTerminalToBottom(data.sessionId);
            session.scrollRAF = null;
          });
        }
      } catch (e) {
        console.error('[SSHIFT] Error writing to terminal:', e.message);
      }
    } else {
      console.warn('[SSHIFT] Received data for missing session/terminal:', data.sessionId);
    }
  }

  // Pure helper used by _flushWriteChunks to pick a frame-write split point
  // that doesn't bisect a UTF-16 surrogate pair or an ANSI escape sequence.
  // Exposed as a static method so it can be unit-tested without a Terminal.
  static findSafeWriteSplitPoint(combined, maxLen, scanWindow = 4096) {
    if (typeof combined !== 'string' || combined.length <= maxLen) return combined ? combined.length : 0;
    let splitAt = maxLen;
    const startScan = Math.max(0, maxLen - scanWindow);
    for (let i = maxLen - 1; i > startScan && i > 0; i--) {
      const code = combined.charCodeAt(i);
      // ESC (\x1b) always begins a new control sequence — safe to split before it.
      if (code === 0x1b) {
        splitAt = i;
        break;
      }
      // Don't split inside a UTF-16 surrogate pair. Two arrangements
      // need to back off:
      //  (a) i is a TRAIL surrogate (0xDC00-0xDFFF) and i-1 is its
      //      LEAD partner (0xD800-0xDBFF). Splitting at i would leave
      //      the lone lead at the end of chunk-1 — and the lone trail
      //      at the start of chunk-2 — both halves rendering as
      //      U+FFFD. Move split back to before the LEAD.
      //  (b) i is itself a LEAD surrogate (0xD800-0xDBFF) whose TRAIL
      //      partner is at i+1. Splitting at i would put the LEAD at
      //      the END of chunk-1 with no partner. Split at i instead
      //      moves the entire pair into chunk-2.
      if (code >= 0xDC00 && code <= 0xDFFF) {
        if (i > 0) {
          const prev = combined.charCodeAt(i - 1);
          if (prev >= 0xD800 && prev <= 0xDBFF) {
            splitAt = i - 1;
            break;
          }
        }
        splitAt = i;
        break;
      }
      if (code >= 0xD800 && code <= 0xDBFF) {
        splitAt = i;
        break;
      }
    }
    return splitAt;
  }

  // Parse and handle OSC 52 clipboard sequences from terminal data stream.
  // Extracts clipboard content, writes it to browser clipboard, and safely
  // handles sequences that span across data chunks.
  // Also handles tmux DCS passthrough: \x1bPtmux;\x1b\x1b]52;c;...\x07\x1b\\
  //
  // Cross-chunk handling: an OSC 52 sequence may arrive split across two
  // `_flushWriteChunks` calls (e.g. `\x1b]52;c;` in one frame and the
  // base64 + BEL in the next). When we detect an incomplete sequence we
  // stash the partial bytes on `session.pendingOsc52` and strip them
  // from the data sent to xterm.js; the next call prepends that buffer
  // and processes the whole sequence as one.
  _handleOsc52(session, data) {
    if (!data) return data;

    // If a previous frame left a pending partial OSC 52 / DCS sequence,
    // prepend it so the now-complete sequence can be processed as a unit.
    let working = data;
    if (session.pendingOsc52) {
      working = session.pendingOsc52 + working;
      session.pendingOsc52 = null;
    }

    // Fast path: nothing OSC-52-shaped in the payload (and no pending
    // partial). Skip the heavy reshaping work below.
    if (working.indexOf('52;') === -1 && working.indexOf('\x1bPtmux;') === -1 && working.indexOf('\x1bP\x1b') === -1) {
      return working;
    }

    let result = working;

    // Handle tmux/screen DCS passthrough wrapper:
    // \x1bPtmux;\x1b wraps an inner escape sequence, terminated by \x1b\\
    // \x1bP\x1b (screen) similarly
    // We unwrap these by extracting the inner OSC 52 sequence.
    while (true) {
      const tmuxStart = result.indexOf('\x1bPtmux;\x1b');
      const screenStart = result.indexOf('\x1bP\x1b');
      let dcsStart = -1;
      let dcsPrefixLen = 0;

      if (tmuxStart !== -1 && (screenStart === -1 || tmuxStart < screenStart)) {
        dcsStart = tmuxStart;
        dcsPrefixLen = '\x1bPtmux;\x1b'.length;
      } else if (screenStart !== -1) {
        dcsStart = screenStart;
        dcsPrefixLen = '\x1bP\x1b'.length;
      }

      if (dcsStart !== -1) {
        // Find the DCS terminator: \x1b\\ (ST)
        const dcsEnd = result.indexOf('\x1b\\', dcsStart + dcsPrefixLen);
        if (dcsEnd !== -1) {
          // Extract the inner sequence and replace the whole DCS block with just the inner sequence
          const inner = result.substring(dcsStart + dcsPrefixLen, dcsEnd);
          result = result.substring(0, dcsStart) + inner + result.substring(dcsEnd + 2);
        } else {
          // Incomplete DCS — save the tail (from dcsStart onward) onto
          // pendingOsc52 so the next frame can finish processing it.
          // Strip it from `result` so xterm doesn't buffer the partial
          // DCS itself.
          session.pendingOsc52 = result.substring(dcsStart);
          result = result.substring(0, dcsStart);
          break;
        }
      } else {
        break;
      }
    }

    // Now process plain OSC 52 sequences
    if (result.indexOf('\x1b]52;') === -1) return result;

    let searchFrom = 0;

    while (true) {
      const startIdx = result.indexOf('\x1b]52;', searchFrom);
      if (startIdx === -1) break;

      // Find end of OSC sequence: BEL (\x07) or ST (\x1b\\)
      let endIdx = -1;
      let endLen = 1;
      const belIdx = result.indexOf('\x07', startIdx + 5);
      const stIdx = result.indexOf('\x1b\\', startIdx + 5);

      if (belIdx !== -1 && (stIdx === -1 || belIdx < stIdx)) {
        endIdx = belIdx;
        endLen = 1;
      } else if (stIdx !== -1) {
        endIdx = stIdx;
        endLen = 2;
      }

      if (endIdx === -1) {
        // Incomplete OSC 52 — save the tail (from startIdx onward) onto
        // pendingOsc52 so the next frame can finish processing it.
        // Strip it from `result` so xterm doesn't buffer the partial
        // OSC sequence itself (which would cause the eventual clipboard
        // payload to leak through to xterm.js as soon as the rest of
        // the sequence arrives in the next frame).
        session.pendingOsc52 = result.substring(startIdx);
        result = result.substring(0, startIdx);
        break;
      }

      // Extract the payload: everything between "ESC]52;" and the terminator
      const payloadStart = startIdx + 5; // skip \x1b]52;
      const payload = result.substring(payloadStart, endIdx);
      console.log('[SSHIFT] OSC 52 intercepted from stream, payload length:', payload.length);

      // Parse: <target>;<base64>
      const semiIdx = payload.indexOf(';');
      if (semiIdx !== -1) {
        const clipboardTarget = payload.substring(0, semiIdx);
        const content = payload.substring(semiIdx + 1);
        if (content) {
          try {
            const decoded = atob(content);
            console.log('[SSHIFT] OSC 52 decoded, target:', clipboardTarget, 'length:', decoded.length, 'preview:', decoded.substring(0, 60));
            // Buffer synchronously, then try immediate write
            this.osc52Buffer = decoded;
            this.copyToClipboard(decoded).then(success => {
              if (success) {
                this.osc52Buffer = null;
                console.log('[SSHIFT] OSC 52 immediate clipboard write succeeded');
              } else {
                console.log('[SSHIFT] OSC 52 immediate write failed, will flush on next user gesture');
              }
            }).catch(() => {
              console.log('[SSHIFT] OSC 52 immediate write rejected, will flush on next user gesture');
            });
          } catch (e) {
            console.warn('[SSHIFT] OSC 52 base64 decode failed:', e);
          }
        } else {
          // Clear clipboard request
          this.osc52Buffer = '';
          navigator.clipboard.writeText('').catch(() => {});
        }
      }

      // Remove the OSC 52 sequence from the data so xterm.js doesn't render garbage
      result = result.substring(0, startIdx) + result.substring(endIdx + endLen);
      searchFrom = startIdx;
    }

    return result;
  }

  _flushWriteChunks(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal) {
      if (session) session.writeRAF = null;
      return;
    }

    session.writeRAF = null;

    // Combine any remaining data from last frame with new chunks
    let combined;
    if (session.writeChunks.length > 0) {
      const chunks = session.writeChunks;
      session.writeChunks = [];
      combined = chunks.length === 1 ? chunks[0] : chunks.join('');
      if (session.flushRemaining) {
        combined = session.flushRemaining + combined;
        session.flushRemaining = null;
      }
    } else if (session.flushRemaining) {
      combined = session.flushRemaining;
      session.flushRemaining = null;
    } else {
      return;
    }

    const terminal = session.terminal;

    // When the buffer grows large, reduce scrollback to keep write() fast.
    // terminal.write() cost is proportional to buffer size because adding lines
    // that overflow the viewport triggers O(buffer_length) buffer maintenance.
    // Dynamically lowering scrollback during heavy output limits the max buffer
    // size, keeping each write() consistently fast. It's restored after output
    // settles. We do NOT use terminal.clear() because that wipes visible content.
    const bufferLen = terminal.buffer.active.length;
    const rows = terminal.rows || 24;
    const highWatermark = rows + 200;
    const lowWatermark = rows + 100;

    if (bufferLen > highWatermark) {
      // Buffer is large — reduce scrollback to cap the max buffer size
      const currentScrollback = terminal.options.scrollback;
      if (currentScrollback > 200 || !session.originalScrollback) {
        if (!session.originalScrollback) {
          session.originalScrollback = currentScrollback;
        }
        terminal.options.scrollback = 200;
      }
      // Cancel any pending restore since we're still in heavy output
      clearTimeout(session.scrollbackRestoreTimer);
      session.scrollbackRestoreTimer = null;
    } else if (session.originalScrollback) {
      // Schedule scrollback restoration — use a timer so it also restores
      // if the buffer stays between low and high watermarks (output stopped
      // but buffer didn't drain below lowWatermark)
      clearTimeout(session.scrollbackRestoreTimer);
      session.scrollbackRestoreTimer = setTimeout(() => {
        if (session.terminal && session.originalScrollback) {
          session.terminal.options.scrollback = session.originalScrollback;
          session.originalScrollback = null;
        }
        session.scrollbackRestoreTimer = null;
      }, 3000);
    }

    // Intercept OSC 52 clipboard sequences before writing to terminal.
    // OSC 52 format: ESC ] 52 ; <target> ; <base64> (BEL or ST)
    // This is more reliable than registerOscHandler which may not fire.
    combined = this._handleOsc52(session, combined);

    // Cap write size per frame. terminal.write() is synchronous and blocks
    // the main thread. We spill overflow to the next frame via flushRemaining.
    const MAX_WRITE_PER_FRAME = 32768;

    if (combined.length > MAX_WRITE_PER_FRAME) {
      // Find a safe split point using the static helper so the logic is
      // unit-testable without an xterm.js terminal instance.
      const splitAt = SSHIFTClient.findSafeWriteSplitPoint(combined, MAX_WRITE_PER_FRAME);
      terminal.write(combined.substring(0, splitAt));
      session.flushRemaining = combined.substring(splitAt);
      session.writeRAF = requestAnimationFrame(() => {
        this._flushWriteChunks(sessionId);
      });
    } else {
      terminal.write(combined);
    }
  }

  // SFTP Session Management
  createSFTPTab(name, connectionData, restoreSessionId = null) {
    const sessionId = restoreSessionId || 'sftp-' + Date.now();

    // Idempotency: bail out if this session is already in the DOM + map.
    const existingDomTab = document.querySelector(`.tab[data-session-id="${sessionId}"]`);
    if (existingDomTab && this.sftpSessions.has(sessionId)) {
      console.log('[SSHIFT] createSFTPTab: session already exists, returning existing id:', sessionId);
      return sessionId;
    }
    if (existingDomTab) {
      existingDomTab.remove();
      const existingWrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
      if (existingWrapper) existingWrapper.remove();
    }

    console.log('[SSHIFT] Creating SFTP tab with sessionId:', sessionId);
    
    const tab = this.createTabElement(sessionId, name, 'sftp');
    
    // Always add new tabs to the first panel
    const panels = this.getAllPanels();
    const firstPanelId = panels[0];
    const tabsContainer = this.getTabsContainer(firstPanelId);
    const terminalsContainer = this.getTerminalsContainer(firstPanelId);
    
    if (!tabsContainer || !terminalsContainer) {
      console.error('[SSHIFT] Could not find tabs or terminals container for first panel:', firstPanelId);
      return null;
    }
    
    tabsContainer.appendChild(tab);

    // Create SFTP content element
    const sftpContent = this.createSFTPContentElement(sessionId);
    console.log('[SSHIFT] SFTP content element created:', sftpContent.id);
    terminalsContainer.appendChild(sftpContent);
    
    // Update scroll arrows visibility
    this.updateTabsScrollArrows();

    this.sftpSessions.set(sessionId, {
      id: sessionId,
      name,
      type: 'sftp',
      currentPath: '/',
      homeDir: null,             // Resolved from server via sftp-home
      _rootListSucceeded: false,  // Whether listing "/" worked (used for auto-redirect)
      connectionData, // Store for sticky sessions
      fontSize: this.terminalFontSize, // Initialize with default font size
      isRestoring: !!restoreSessionId, // Flag to indicate if this is a restored session
      connecting: !restoreSessionId, // Only show connecting state for new connections
    });

    console.log('[SSHIFT] Switching to SFTP tab:', sessionId);
    const panelId = this.getPanelForSession(sessionId);
    this.switchTab(sessionId, panelId);
    this.hideEmptyState(panelId);

    // Verify the wrapper is active
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    console.log('[SSHIFT] Wrapper found:', !!wrapper);
    console.log('[SSHIFT] Wrapper has active class:', wrapper?.classList.contains('active'));
    
    // Verify SFTP container exists
    const sftpContainer = document.getElementById(`sftp-${sessionId}`);
    console.log('[SSHIFT] SFTP container found:', !!sftpContainer);

    // If restoring a session, try to join it first (no new SSH connection needed)
    if (restoreSessionId) {
      console.log('[SSHIFT] Attempting to join existing SFTP session:', restoreSessionId);
      this.socket.emit('sftp-join', { sessionId: restoreSessionId });
    } else {
      // Connect via socket for new sessions
      console.log('[SSHIFT] Emitting sftp-connect for session:', sessionId);
      this.socket.emit('sftp-connect', { ...connectionData, sessionId });
    }
    
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
    wrapper.dataset.sessionId = sessionId; // Add data attribute for easier querying
    
    const container = document.createElement('div');
    container.className = 'sftp-container';
    container.id = `sftp-${sessionId}`;
    container.innerHTML = `
      <div class="sftp-toolbar">
        <div class="sftp-path">
          <button class="btn btn-sm sftp-home-btn" title="Home directory">
            <i class="fas fa-home"></i>
          </button>
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
    const homeBtn = container.querySelector('.sftp-home-btn');
    const goBtn = container.querySelector('.sftp-go-btn');
    const refreshBtn = container.querySelector('.sftp-refresh-btn');
    const mkdirBtn = container.querySelector('.sftp-mkdir-btn');
    const uploadBtn = container.querySelector('.sftp-upload-btn');

    homeBtn.addEventListener('click', () => {
      const session = this.sftpSessions.get(sessionId);
      const homePath = session?.homeDir || '~';
      this.navigateSFTPPath(homePath, sessionId);
    });

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

    const fileList = container.querySelector('.sftp-file-list');
    fileList.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('drag-over');
    });

    fileList.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.add('drag-over');
    });

    fileList.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!container.contains(e.relatedTarget)) {
        container.classList.remove('drag-over');
      }
    });

    fileList.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      container.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;
      const pathInput2 = container.querySelector('.sftp-path-input');
      if (!pathInput2) return;
      this.uploadFiles(sessionId, files, pathInput2.value);
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
      
      // Request the server's home directory for this session so we can
      // start there instead of "/" (which may be denied by chroot / perms)
      this.socket.emit('sftp-home', { sessionId: data.sessionId });
      
      // Also start listing the current path (or "/") immediately; if the
      // home-directory response arrives first we'll navigate there instead.
      const pathInput = document.querySelector(`#sftp-${data.sessionId} .sftp-path-input`);
      console.log('[SSHIFT] Path input found:', !!pathInput);
      
      if (pathInput) {
        pathInput.value = session.currentPath || '/';
      } else {
        console.error('[SSHIFT] Path input not found for session:', data.sessionId);
      }
      
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
      // Resolve ~ to the user's home directory
      if (path === '~' || path.startsWith('~/')) {
        if (session.homeDir) {
          path = path === '~' ? session.homeDir : session.homeDir + path.slice(1);
        } else {
          // Ask the server to resolve ~ if we don't have the home dir yet
          this.socket.emit('sftp-home', { sessionId });
        }
      }
      
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
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      document.body.removeChild(input);
      if (files.length === 0) return;
      const pathInput = document.querySelector(`#sftp-${sessionId} .sftp-path-input`);
      if (!pathInput) return;
      const dirPath = pathInput.value;
      this.uploadFiles(sessionId, files, dirPath);
    });
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
    });
    input.click();
  }

  async uploadFiles(sessionId, files, dirPath) {
    if (!this._activeUploads) this._activeUploads = new Map();

    for (let i = 0; i < files.length; i++) {
      try {
        await this.uploadSingleFile(sessionId, files[i], dirPath, i + 1, files.length);
      } catch (err) {
        if (err.message === 'cancelled') {
          return;
        }
        this.showToast(`Upload failed: ${files[i].name} - ${err.message}`, 'error');
        this.hideTransferProgress(sessionId);
        break;
      }
    }
  }

  async uploadSingleFile(sessionId, file, dirPath, fileIndex, totalFiles) {
    const CHUNK_SIZE = 1024 * 1024;
    const remotePath = dirPath === '/' ? `/${file.name}` : `${dirPath}/${file.name}`;

    this.showTransferProgress(sessionId, file.name, 0, 0, file.size, fileIndex, totalFiles, true);

    try {
      const uploadId = await new Promise((resolve, reject) => {
        this.socket.emit('sftp-upload-start', {
          sessionId,
          path: remotePath,
          fileName: file.name,
          fileSize: file.size
        }, (response) => {
          if (response.error) reject(new Error(response.error));
          else resolve(response.uploadId);
        });
      });

      this._activeUploads.set(sessionId, { uploadId, cancelled: false });

      let offset = 0;
      while (offset < file.size) {
        const upload = this._activeUploads.get(sessionId);
        if (!upload || upload.cancelled) {
          throw new Error('cancelled');
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const slice = file.slice(offset, end);
        const chunkData = await this.readFileAsBase64(slice);

        const result = await new Promise((resolve, reject) => {
          this.socket.emit('sftp-upload-chunk', {
            sessionId,
            uploadId,
            data: chunkData
          }, (response) => {
            if (response.error) reject(new Error(response.error));
            else resolve(response);
          });
        });

        offset = end;
        const percent = file.size > 0 ? Math.round((offset / file.size) * 100) : 100;
        this.showTransferProgress(sessionId, file.name, percent, offset, file.size, fileIndex, totalFiles, true);
      }

      const upload = this._activeUploads.get(sessionId);
      if (!upload || upload.cancelled) {
        throw new Error('cancelled');
      }

      await new Promise((resolve, reject) => {
        this.socket.emit('sftp-upload-end', {
          sessionId,
          uploadId
        }, (response) => {
          if (response.error) reject(new Error(response.error));
          else resolve(response);
        });
      });

      this._activeUploads.delete(sessionId);
      this.hideTransferProgress(sessionId);
      this.showToast(`Uploaded: ${file.name}`, 'success');
      this.refreshSFTP(sessionId);
    } catch (err) {
      this._activeUploads.delete(sessionId);
      this.hideTransferProgress(sessionId);
      throw err;
    }
  }

  readFileAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  showTransferProgress(sessionId, fileName, percent, transferred, total, fileIndex, totalFiles, isUpload) {
    let progressEl = document.querySelector(`#sftp-${sessionId} .sftp-transfer-progress`);
    const container = document.querySelector(`#sftp-${sessionId}`);

    if (!container) return;

    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.className = 'sftp-transfer-progress';
      progressEl.innerHTML = `
        <div class="sftp-transfer-info">
          <span class="sftp-transfer-icon"><i class="fas fa-${isUpload ? 'upload' : 'download'}"></i></span>
          <span class="sftp-transfer-filename"></span>
          <span class="sftp-transfer-count"></span>
          <span class="sftp-transfer-size"></span>
          <span class="sftp-transfer-percent"></span>
          <button class="sftp-transfer-cancel" title="Cancel"><i class="fas fa-times"></i></button>
        </div>
        <div class="sftp-transfer-bar">
          <div class="sftp-transfer-bar-fill"></div>
        </div>
      `;
      const fileList = container.querySelector('.sftp-file-list');
      if (fileList) {
        container.insertBefore(progressEl, fileList);
      }
      const cancelBtn = progressEl.querySelector('.sftp-transfer-cancel');
      cancelBtn.addEventListener('click', () => {
        this.cancelTransfer(sessionId);
      });
    }

    progressEl.querySelector('.sftp-transfer-icon').innerHTML = `<i class="fas fa-${isUpload ? 'upload' : 'download'}"></i>`;
    progressEl.querySelector('.sftp-transfer-filename').textContent = fileName;
    progressEl.querySelector('.sftp-transfer-filename').title = fileName;
    progressEl.querySelector('.sftp-transfer-count').textContent = totalFiles > 1 ? `${fileIndex} / ${totalFiles}` : '';
    const sizeText = total > 0 ? `${this.formatSize(transferred)} / ${this.formatSize(total)}` : this.formatSize(transferred);
    progressEl.querySelector('.sftp-transfer-size').textContent = sizeText;
    progressEl.querySelector('.sftp-transfer-percent').textContent = `${percent}%`;
    progressEl.querySelector('.sftp-transfer-bar-fill').style.width = `${percent}%`;
    progressEl.style.display = '';
  }

  cancelTransfer(sessionId) {
    const upload = this._activeUploads && this._activeUploads.get(sessionId);
    if (upload) {
      upload.cancelled = true;
      this._activeUploads.delete(sessionId);
      this.socket.emit('sftp-upload-cancel', { sessionId, uploadId: upload.uploadId });
    }

    const download = this._activeDownload;
    if (download && download.sessionId === sessionId) {
      this._activeDownload = null;
    }

    this.hideTransferProgress(sessionId);
    this.showToast('Transfer cancelled', 'error');
  }

  hideTransferProgress(sessionId) {
    const progressEl = document.querySelector(`#sftp-${sessionId} .sftp-transfer-progress`);
    if (progressEl) {
      progressEl.remove();
    }
  }

// Tab Management

  startTabFlash(sessionId, options = {}) {
    const flashingSessions = this._flashingSessions || (this._flashingSessions = new Set());
    flashingSessions.add(sessionId);

    document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`).forEach(tab => {
      tab.classList.add('flashing');
    });

    document.querySelectorAll(`.mobile-tab-option[data-session-id="${sessionId}"]`).forEach(mobileOption => {
      mobileOption.classList.add('flashing');
    });

    document.querySelectorAll('.mobile-tabs-toggle').forEach(toggle => {
      toggle.classList.add('flashing');
    });

    if (!this._tabFlashTimers) this._tabFlashTimers = new Map();
    if (options.duration) {
      const existing = this._tabFlashTimers.get(sessionId);
      if (existing) clearTimeout(existing);
      this._tabFlashTimers.set(sessionId, setTimeout(() => {
        this.stopTabFlash(sessionId);
      }, options.duration));
    }

    // Safety net: schedule a delayed applyFlashStates in case DOM elements
    // didn't exist yet when this call was made (e.g., during tab sync)
    if (!this._flashApplyTimer) this._flashApplyTimer = null;
    clearTimeout(this._flashApplyTimer);
    this._flashApplyTimer = setTimeout(() => this.applyFlashStates(), 150);
  }

  stopTabFlash(sessionId) {
    const flashingSessions = this._flashingSessions;
    if (flashingSessions) {
      flashingSessions.delete(sessionId);
    }

    document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`).forEach(tab => {
      tab.classList.remove('flashing');
    });

    document.querySelectorAll(`.mobile-tab-option[data-session-id="${sessionId}"]`).forEach(mobileOption => {
      mobileOption.classList.remove('flashing');
    });

    document.querySelectorAll('.mobile-tabs-toggle').forEach(toggle => {
      if (!flashingSessions || flashingSessions.size === 0) {
        toggle.classList.remove('flashing');
      }
    });

    if (this._tabFlashTimers) {
      const timer = this._tabFlashTimers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        this._tabFlashTimers.delete(sessionId);
      }
    }
  }

  applyFlashStates() {
    const flashingSessions = this._flashingSessions;
    if (!flashingSessions || flashingSessions.size === 0) return;

    for (const sessionId of flashingSessions) {
      document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`).forEach(tab => {
        tab.classList.add('flashing');
      });

      document.querySelectorAll(`.mobile-tab-option[data-session-id="${sessionId}"]`).forEach(mobileOption => {
        mobileOption.classList.add('flashing');
      });
    }

    document.querySelectorAll('.mobile-tabs-toggle').forEach(toggle => {
      toggle.classList.add('flashing');
    });
  }

  switchTab(sessionId, panelId = null) {
    // During sync, skip switchTab calls — we'll activate the correct tab at the end.
    // But we still need to ensure the terminal wrapper is visible for initTerminal,
    // so we temporarily show the wrapper without updating active state.
    if (this._suppressTabSwitch) {
      const targetPanelId = panelId || this.getPanelForSession(sessionId);
      const wrapperId = `terminal-wrapper-${sessionId}`;
      const wrapper = document.getElementById(wrapperId);
      if (wrapper) {
        wrapper.classList.add('active');
      }
      return;
    }
    
    console.log('[SSHIFT] switchTab called for session:', sessionId, 'panel:', panelId);
    
    // Stop any active flash on this tab since user is viewing it
    this.stopTabFlash(sessionId);
    
    // Determine which panel this session belongs to
    if (!panelId) {
      panelId = this.getPanelForSession(sessionId);
    }
    
    // Update per-panel active session
    this.activeSessionsByPanel.set(panelId, sessionId);
    
    // Update global active session (for backwards compatibility)
    this.activeSessionId = sessionId;
    
    // Get the tabs container for this panel
    const tabsContainer = this.getTabsContainer(panelId);
    if (tabsContainer) {
      // Update active tab only within this panel
      tabsContainer.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
      });
    }

    // Get the terminals container for this panel
    const terminalsContainer = this.getTerminalsContainer(panelId);
    if (terminalsContainer) {
      // Update active terminal only within this panel
      terminalsContainer.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
        const isActive = wrapper.id === `terminal-wrapper-${sessionId}`;
        console.log('[SSHIFT] Setting wrapper', wrapper.id, 'active:', isActive, 'in panel:', panelId);
        wrapper.classList.toggle('active', isActive);
      });
    }

    // Update mobile keys bar visibility
    this.updateMobileKeysBar();

    // Fit terminal if SSH and focus it
    // Only fit for controllers - non-controllers will receive resize sync
    const session = this.sessions.get(sessionId);
    if (session && session.terminal && session.fitAddon && session.isController) {
      // Use requestAnimationFrame to wait for the browser to finish
      // computing layout after the display:none -> display:flex change.
      // A second RAF ensures the paint is complete before we measure.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // If WebGL init was deferred because this terminal was hidden
          // (Bug 3), initialise it now that the wrapper is visible.
          if (session._webglInitPending && this.webglRenderer && typeof window.WebglAddon === 'function') {
            session._webglInitPending = false;
            console.log('[SSHIFT] Initializing deferred WebGL for session:', sessionId);
            this._initWebGLAddon(session, true);
          }

          // Always clear the WebGL texture atlas when a tab becomes visible.
          // While display:none, the terminal canvas has zero dimensions and
          // any cached glyphs are rendered at wrong colours/sizes (Bug 3).
          // Clearing + refreshing forces a clean redraw at the correct size.
          this._resetWebGLAtlas(session);

          // Restore font size for this session
          if (session.fontSize && session.terminal) {
            session.terminal.options.fontSize = session.fontSize;
            console.log('[SSHIFT] Restored font size', session.fontSize, 'for session', sessionId);
          }

          if (session.needsResize || session.terminal.cols === 0 || session.terminal.rows === 0) {
            console.log('[SSHIFT] Terminal needs resize, fitting now');
            session.needsResize = false;
          }

          const fitted = this._fitTerminal(session);

          // If fitting failed (e.g. container not yet laid out), retry
          // with delays until the browser commits the layout change.
          if (!fitted) {
            console.log('[SSHIFT] Initial fit failed during tab switch, scheduling retries');
            let retriesLeft = 4;
            const retryFit = () => {
              if (!session.terminal || !session.fitAddon || !session.isController) return;
              const ok = this._fitTerminal(session);
              if (!ok && retriesLeft > 0) {
                retriesLeft--;
                setTimeout(retryFit, 100);
              }
            };
            setTimeout(retryFit, 50);
          }

          // Safety net: always schedule a delayed refit after tab switch.
          // Sometimes the initial fit succeeds at a small intermediate size
          // (e.g. 100×100px) because the browser hasn't fully committed the
          // display:none → display:flex layout change. A delayed refit
          // corrects this once the layout has settled.
          setTimeout(() => {
            if (!session.terminal || !session.fitAddon || !session.isController) return;
            const wrapper = document.getElementById(`terminal-wrapper-${session.id}`);
            if (wrapper && wrapper.classList.contains('active')) {
              this._fitTerminal(session);
            }
          }, 150);

          // Focus the terminal so user can type
          if (session.terminal) {
            if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
              session.mobileHandler._focusHiddenTextarea();
            } else {
              session.terminal.focus();
            }
            console.log('[SSHIFT] Terminal focused for session:', sessionId);
          }

          // Request screen sync to ensure terminal is up-to-date
          // This is especially important for sticky sessions across different browsers
          if (session.connected && this.sticky) {
            console.log('[SSHIFT] Requesting screen sync for sticky session');
            this.requestScreenSync(sessionId);
          }
        });
      });
    } else if (session && session.terminal) {
      // For non-controllers, just focus the terminal and restore font size.
      // Also clear the WebGL atlas since this tab was hidden.
      this._resetWebGLAtlas(session);
      if (session.fontSize) {
        session.terminal.options.fontSize = session.fontSize;
      }
      if (this.isMobile && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
        session.mobileHandler._focusHiddenTextarea();
      } else {
        session.terminal.focus();
      }
    }
    
    // Handle SFTP sessions
    const sftpSession = this.sftpSessions.get(sessionId);
    if (sftpSession && sftpSession.terminal) {
      if (sftpSession.fontSize) {
        sftpSession.terminal.options.fontSize = sftpSession.fontSize;
        this._resetWebGLAtlas(sftpSession);
      }
    }
    
    // Update mobile tabs dropdown for this panel
    this.updateMobileTabsDropdown(panelId);
    
    // Enable/disable terminal-only tab actions (keyboard + mic) for this panel
    this.updateTabActionButtons(panelId);
    
    // Save tabs
    this.saveTabs();
  }

  closeTab(sessionId) {
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) return;

    // Get the panel this session belongs to before removing it
    const panelId = this.getPanelForSession(sessionId);
    
    // Clean up server panel map
    this._serverPanelMap.delete(sessionId);

    // Notify server that this tab is closing (for cross-client sync)
    this.socket.emit('tab-close', { sessionId });

    // Disconnect
    if (session.type === 'ssh') {
      this.socket.emit('ssh-disconnect', { sessionId });
      // Clean up ResizeObserver
      if (session.resizeObserver) {
        session.resizeObserver.disconnect();
        session.resizeObserver = null;
      }
      // Clean up resize timeout
      if (session.resizeTimeout) {
        clearTimeout(session.resizeTimeout);
        session.resizeTimeout = null;
      }
      // Clean up scrollbar MutationObserver (mobile-only)
      if (session._scrollbarObserver) {
        session._scrollbarObserver.disconnect();
        session._scrollbarObserver = null;
      }
      // Clean up write buffer RAF
      if (session.writeRAF) {
        cancelAnimationFrame(session.writeRAF);
        session.writeRAF = null;
      }
      // Clean up scrollback restore timer
      if (session.scrollbackRestoreTimer) {
        clearTimeout(session.scrollbackRestoreTimer);
        session.scrollbackRestoreTimer = null;
      }
      // Restore scrollback if it was dynamically reduced
      if (session.originalScrollback && session.terminal) {
        session.terminal.options.scrollback = session.originalScrollback;
      }
      // Clean up mobile handler
      if (session.mobileHandler) {
        session.mobileHandler.destroy();
        session.mobileHandler = null;
      }
      // Clean up wheel handler
      if (session.wheelHandler && session.wheelElement) {
        session.wheelElement.removeEventListener('wheel', session.wheelHandler);
        session.wheelHandler = null;
        session.wheelElement = null;
      }
      // Clean up OSC 52 clipboard flush listeners
      if (session.osc52FlushListener) {
        document.removeEventListener('click', session.osc52FlushListener, true);
        document.removeEventListener('keydown', session.osc52FlushListener, true);
        document.removeEventListener('touchstart', session.osc52FlushListener, true);
        session.osc52FlushListener = null;
      }
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
    } else {
      this.socket.emit('sftp-disconnect', { sessionId });
      this.sftpSessions.delete(sessionId);
    }

    // Remove from DOM (use querySelectorAll to catch any duplicates)
    const tabs = document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`);
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    tabs.forEach(t => t.remove());
    if (wrapper) wrapper.remove();

    // Update scroll arrows visibility
    this.updateTabsScrollArrows();

    // Check if this was the active session in its panel
    const activeInPanel = this.activeSessionsByPanel.get(panelId);
    if (activeInPanel === sessionId) {
      // Remove the panel's active session entry
      this.activeSessionsByPanel.delete(panelId);
      
      // Find remaining sessions in the same panel
      const tabsContainer = this.getTabsContainer(panelId);
      const remainingInPanel = tabsContainer ? Array.from(tabsContainer.children).map(t => t.dataset.sessionId) : [];
      
      if (remainingInPanel.length > 0) {
        // Switch to the first remaining tab in this panel
        this.switchTab(remainingInPanel[0], panelId);
      } else {
        // No more tabs in this panel - show empty state for this panel
        this.showEmptyState(panelId);
        
        // If this was also the global active session, find another session to activate
        if (this.activeSessionId === sessionId) {
          const remainingSessions = [...Array.from(this.sessions.keys()), ...Array.from(this.sftpSessions.keys())];
          if (remainingSessions.length > 0) {
            // Find the panel for the first remaining session
            const firstRemainingPanelId = this.getPanelForSession(remainingSessions[0]);
            this.switchTab(remainingSessions[0], firstRemainingPanelId);
          } else {
            this.activeSessionId = null;
            // Update mobile keys bar visibility when no active session
            this.updateMobileKeysBar();
          }
        }
      }
    }

    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown(panelId);
    
    // Save tabs
    this.saveTabs();
  }

  // Remove a tab locally without notifying the server.
  // Used during initial sync to remove stale tabs from localStorage
  // that don't exist on the server (prevents cross-device duplication).
  removeTabLocally(sessionId) {
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) return;

    console.log('[SSHIFT] Removing tab locally:', sessionId);
    
    // Clean up server panel map
    this._serverPanelMap.delete(sessionId);

    const panelId = this.getPanelForSession(sessionId);

    // Disconnect from server session (without emitting tab-close)
    if (session.type === 'ssh') {
      this.socket.emit('ssh-disconnect', { sessionId });
      if (session.writeRAF) cancelAnimationFrame(session.writeRAF);
      if (session.scrollbackRestoreTimer) clearTimeout(session.scrollbackRestoreTimer);
      if (session.originalScrollback && session.terminal) {
        session.terminal.options.scrollback = session.originalScrollback;
      }
      if (session.resizeObserver) {
        session.resizeObserver.disconnect();
        session.resizeObserver = null;
      }
      if (session.resizeTimeout) {
        clearTimeout(session.resizeTimeout);
        session.resizeTimeout = null;
      }
      if (session.wheelHandler && session.wheelElement) {
        session.wheelElement.removeEventListener('wheel', session.wheelHandler);
      }
      if (session.osc52FlushListener) {
        document.removeEventListener('click', session.osc52FlushListener, true);
        document.removeEventListener('keydown', session.osc52FlushListener, true);
        document.removeEventListener('touchstart', session.osc52FlushListener, true);
      }
      if (session.terminal) session.terminal.dispose();
      if (session.mobileHandler) {
        session.mobileHandler.destroy();
        session.mobileHandler = null;
      }
      this.sessions.delete(sessionId);
    } else {
      this.socket.emit('sftp-disconnect', { sessionId });
      this.sftpSessions.delete(sessionId);
    }

    // Remove from DOM (use querySelectorAll to catch any duplicates)
    const tabs = document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`);
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    tabs.forEach(t => t.remove());
    if (wrapper) wrapper.remove();

    // Update scroll arrows
    this.updateTabsScrollArrows();

    // Check if this was the active session
    if (this.activeSessionId === sessionId) {
      const remainingSessions = [...Array.from(this.sessions.keys()), ...Array.from(this.sftpSessions.keys())];
      if (remainingSessions.length > 0) {
        this.switchTab(remainingSessions[0]);
      } else {
        this.activeSessionId = null;
        this.updateMobileKeysBar();
      }
    }

    // Check if this was the active session in its panel
    const activeInPanel = this.activeSessionsByPanel.get(panelId);
    if (activeInPanel === sessionId) {
      this.activeSessionsByPanel.delete(panelId);
      const tabsContainer = this.getTabsContainer(panelId);
      const remainingInPanel = tabsContainer ? Array.from(tabsContainer.children) : [];
      if (remainingInPanel.length === 0) {
        this.showEmptyState(panelId);
      }
    }
  }

  // Handle tab opened by another client
handleTabOpened(data) {
    // Check if we already have this session
    if (this.sessions.has(data.sessionId) || this.sftpSessions.has(data.sessionId)) {
      console.log('[SSHIFT] Already have session:', data.sessionId);
      return;
    }

    console.log('[SSHIFT] Creating tab for session from another client:', data.sessionId);
    
    // Store server panel assignment for mobile preservation
    if (data.panelId) {
      this._serverPanelMap.set(data.sessionId, data.panelId);
    }
    
    // Create the tab without connecting (we'll join the existing session).
    // Defensive dedupe: only create if no DOM tab exists yet for this session.
    const existingTabNodes = document.querySelectorAll(
      `.tab[data-session-id="${data.sessionId}"]`
    );
    if (existingTabNodes.length === 0) {
      if (data.type === 'ssh') {
        this.createSSHTab(data.name, data.connectionData, data.sessionId);
      } else if (data.type === 'sftp') {
        this.createSFTPTab(data.name, data.connectionData, data.sessionId);
      }
    } else {
      console.log('[SSHIFT] Tab DOM already exists for session, skipping:', data.sessionId);
    }
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Apply any flash states that may have arrived before the tab DOM existed
    this.applyFlashStates();
  }
  handleTabClosed(sessionId) {
    // Check if we have this session
    const session = this.sessions.get(sessionId) || this.sftpSessions.get(sessionId);
    if (!session) {
      console.log('[SSHIFT] No session to close:', sessionId);
      return;
    }

    console.log('[SSHIFT] Closing tab from another client:', sessionId);
    
    // Get the panel for this session before removing
    const panelId = this.getPanelForSession(sessionId);
    
    // Clean up the session locally (don't emit tab-close again)
    if (session.type === 'ssh') {
      if (session.writeRAF) {
        cancelAnimationFrame(session.writeRAF);
      }
      if (session.scrollbackRestoreTimer) {
        clearTimeout(session.scrollbackRestoreTimer);
      }
      if (session.originalScrollback && session.terminal) {
        session.terminal.options.scrollback = session.originalScrollback;
      }
      if (session.wheelHandler && session.wheelElement) {
        session.wheelElement.removeEventListener('wheel', session.wheelHandler);
      }
      if (session.osc52FlushListener) {
        document.removeEventListener('click', session.osc52FlushListener, true);
        document.removeEventListener('keydown', session.osc52FlushListener, true);
        document.removeEventListener('touchstart', session.osc52FlushListener, true);
        session.osc52FlushListener = null;
      }
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
    } else {
      this.sftpSessions.delete(sessionId);
    }

    // Remove from DOM (querySelectorAll to handle any duplicates)
    const tabs = document.querySelectorAll(`.tab[data-session-id="${sessionId}"]`);
    const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
    tabs.forEach(t => t.remove());
    if (wrapper) wrapper.remove();

    // Check if there are remaining tabs in the panel
    const tabsContainer = this.getTabsContainer(panelId);
    const remainingInPanel = tabsContainer ? Array.from(tabsContainer.children).map(t => t.dataset.sessionId) : [];
    
    if (remainingInPanel.length === 0) {
      // No more tabs in this panel - show empty state for this panel
      this.showEmptyState(panelId);
    }
    
    // Switch to another tab or show empty state
    if (this.activeSessionId === sessionId) {
      const remainingSessions = [...Array.from(this.sessions.keys()), ...Array.from(this.sftpSessions.keys())];
      if (remainingSessions.length > 0) {
        this.switchTab(remainingSessions[0]);
      } else {
        this.activeSessionId = null;
        // Update mobile keys bar visibility when no active session
        this.updateMobileKeysBar();
      }
    }
    
    // Update mobile tabs dropdown
    this.updateMobileTabsDropdown();
    
    // Save tabs
    this.saveTabs();
  }

  // Sync tabs from server (called on connect when sticky is enabled)
async syncTabsFromServer(tabs, isInitialSync = false, activeTabsByPanel = null) {
    // Wait for any in-progress restoration to complete before syncing
    // This prevents the race condition where restoreTabs starts first,
    // sets isRestoring=true, and then this function returns early, missing
    // server tabs that aren't in localStorage
    let waitCount = 0;
    while (this.isRestoring && waitCount < 200) {
      await new Promise(resolve => setTimeout(resolve, 50));
      waitCount++;
    }
    
    console.log('[SSHIFT] Syncing tabs from server:', tabs.length, 'isInitialSync:', isInitialSync);
    this.isRestoring = true;

    // Store server panel assignments and layout for mobile preservation
    tabs.forEach(tab => {
      this._serverPanelMap.set(tab.sessionId, tab.panelId || 'panel-0');
    });

    // Suppress switchTab during creation so we can activate the correct tab at the end
    this._suppressTabSwitch = true;

    try {
    // On initial sync, remove any client-side tabs that don't exist on the server.
    // This ensures the server is the single source of truth and prevents duplicates
    // from stale localStorage caches (e.g. when switching between devices).
    if (isInitialSync) {
      const serverSessionIds = new Set(tabs.map(t => t.sessionId));
      const clientSessionIds = [
        ...Array.from(this.sessions.keys()),
        ...Array.from(this.sftpSessions.keys())
      ];

      for (const sessionId of clientSessionIds) {
        if (!serverSessionIds.has(sessionId)) {
          console.log('[SSHIFT] Removing local tab not on server during initial sync:', sessionId);
          this.removeTabLocally(sessionId);
        }
      }
    }

    // Merge credentials from localStorage into server tab data.
    // The server strips password/privateKey from open-tabs for security,
    // but we need them locally for auto-reconnection if ssh-join fails
    // (e.g. server restarted while sessions were active).
    const localTabsData = this.loadTabs();
    const localTabs = Array.isArray(localTabsData) ? localTabsData : (localTabsData?.tabs || []);
    const localTabsBySessionId = new Map();
    for (const lt of localTabs) {
      if (lt.sessionId && lt.connectionData) {
        localTabsBySessionId.set(lt.sessionId, lt.connectionData);
      }
    }

    for (const tab of tabs) {
      // Check if we already have this session
      if (this.sessions.has(tab.sessionId) || this.sftpSessions.has(tab.sessionId)) {
        console.log('[SSHIFT] Already have session:', tab.sessionId);
        continue;
      }

      // Merge saved credentials into the server's stripped connectionData
      const localConnData = localTabsBySessionId.get(tab.sessionId);
      if (localConnData && (localConnData.password || localConnData.privateKey)) {
        tab.connectionData = { ...tab.connectionData, ...localConnData };
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

    // Distribute tabs to panels based on panel assignments (desktop only)
    if (tabs.some(t => t.panelId) && !this.isMobile) {
      this.distributeTabsToPanels(tabs);
    }

    // Apply any flash states that arrived before DOM elements existed
    this.applyFlashStates();
    } finally {
      // Guarantee the sync flags clear even if a throw happens mid-sync.
      // Without this the UI would dead-lock (switchTab suppressed forever
      // and restoreTabs blocked waiting on isRestoring).
      this.isRestoring = false;
      this._suppressTabSwitch = false;
    }

    // Activate the correct tab per panel based on server state
    if (activeTabsByPanel && !this.isMobile) {
      for (const [panelId, sessionId] of Object.entries(activeTabsByPanel)) {
        if (this.sessions.has(sessionId) || this.sftpSessions.has(sessionId)) {
          this.switchTab(sessionId, panelId);
        }
      }
    } else if (activeTabsByPanel) {
      // Mobile: use the first active tab from any panel
      const firstActive = Object.values(activeTabsByPanel).find(id => this.sessions.has(id) || this.sftpSessions.has(id));
      if (firstActive) {
        this.switchTab(firstActive);
      }
} else if (tabs.length > 0) {
      // No active tab info from server — default to first tab
      const firstTab = tabs[0];
      if (this.sessions.has(firstTab.sessionId) || this.sftpSessions.has(firstTab.sessionId)) {
        this.switchTab(firstTab.sessionId, firstTab.panelId);
      }
    }

    // Update mobile tabs dropdown after activating the correct tab
    this.updateMobileTabsDropdown();

    // Save the final tab state to localStorage after sync completes
    this.saveTabs();
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
    this.focusTerminal();
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

    // Apply expanded states from folders (already loaded in loadFolders)
    // Note: expanded states are now loaded asynchronously in loadFolders()

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
    
    // Determine icon and details based on type
    let iconClass, details;
    if (bookmark.type === 'url') {
      iconClass = 'fa-globe';
      details = bookmark.url || '';
    } else if (bookmark.type === 'sftp') {
      iconClass = 'fa-folder-open';
      details = `${this.escapeHtml(bookmark.username)}@${this.escapeHtml(bookmark.host)}:${bookmark.port}`;
    } else {
      iconClass = 'fa-terminal';
      details = `${this.escapeHtml(bookmark.username)}@${this.escapeHtml(bookmark.host)}:${bookmark.port}`;
    }
    
    item.innerHTML = `
      <div class="bookmark-icon ${bookmark.type}">
        <i class="fas ${iconClass}"></i>
        <span class="bookmark-letter">${firstLetter}</span>
      </div>
      <div class="bookmark-info">
        <div class="bookmark-name">${this.escapeHtml(bookmark.name)}</div>
        <div class="bookmark-details">${details}</div>
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

  _clampMenuToViewport(menu, margin = 5) {
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    let top = rect.top;

    if (rect.right > vw) {
      left = vw - rect.width - margin;
    }
    if (rect.bottom > vh) {
      top = vh - rect.height - margin;
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;

    menu.style.transform = '';
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  showBookmarkContextMenu(bookmark, event, fromMenuButton = false) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.bookmark-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'bookmark-context-menu active';
    
    // Build menu items based on bookmark type
    let menuItems = '';
    if (bookmark.type === 'url') {
      menuItems = `
        <div class="bookmark-context-menu-item" data-action="connect">
          <i class="fas fa-external-link-alt"></i>
          <span>Open in New Tab</span>
        </div>
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
    } else {
      menuItems = `
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
    }
    menu.innerHTML = menuItems;

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
    this._clampMenuToViewport(menu);

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
        let icon;
        if (bookmark.type === 'url') {
          icon = 'fa-globe';
        } else if (bookmark.type === 'sftp') {
          icon = 'fa-folder-open';
        } else {
          icon = 'fa-terminal';
        }
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
    this._clampMenuToViewport(menu);

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
    this._clampMenuToViewport(menu);

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

  async showTerminalContextMenu(sessionId, terminal, event) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.terminal-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'terminal-context-menu active';
    
    const hasSelection = terminal.hasSelection();
    const selection = hasSelection ? terminal.getSelection() : '';
    
    menu.innerHTML = `
      <div class="terminal-context-menu-item ${hasSelection ? '' : 'disabled'}" data-action="copy">
        <i class="fas fa-copy"></i>
        <span>Copy</span>
      </div>
      <div class="terminal-context-menu-item" data-action="paste">
        <i class="fas fa-paste"></i>
        <span>Paste</span>
      </div>
      <div class="terminal-context-menu-divider"></div>
      <div class="terminal-context-menu-item" data-action="selectall">
        <i class="fas fa-object-group"></i>
        <span>Select All</span>
      </div>
    `;

    // Position the menu at cursor
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    // Handle menu item clicks
    menu.querySelectorAll('.terminal-context-menu-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        
        // Don't do anything if item is disabled
        if (item.classList.contains('disabled')) {
          return;
        }
        
        switch (action) {
          case 'copy':
            if (hasSelection && selection) {
              const success = await this.copyToClipboard(selection);
              if (success) {
                this.showToast('Copied to clipboard', 'success');
                terminal.clearSelection();
                // Focus terminal after copy
                const session = this.sessions.get(sessionId);
                if (this.isMobile && session && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
                  session.mobileHandler._focusHiddenTextarea();
                } else {
                  terminal.focus();
                }
              } else {
                this.showToast('Failed to copy', 'error');
              }
            }
            break;
          case 'paste':
            console.log('[SSHIFT] Paste menu item clicked');
            // Try to paste - use pre-read content first, then try reading on click
            const doPaste = async () => {
              let clipboardContent = this.terminalClipboardContent;
              
              // If no pre-read content, try to read now (click is also a user gesture)
              if (!clipboardContent) {
                console.log('[SSHIFT] No pre-read content, attempting to read clipboard on click...');
                try {
                  if (navigator.clipboard && navigator.clipboard.readText) {
                    clipboardContent = await navigator.clipboard.readText();
                    console.log('[SSHIFT] Read clipboard on click, length:', clipboardContent?.length || 0);
                  }
                } catch (err) {
                  console.warn('[SSHIFT] Could not read clipboard on click:', err.name, err.message);
                }
              }
              
              console.log('[SSHIFT] Final clipboard content:', clipboardContent?.length || 0);
              
              if (clipboardContent) {
                // We have clipboard content, paste it
                const sess = this.sessions.get(sessionId);
                if (sess && sess.connected) {
                  this.sendChunkedInput(sessionId, clipboardContent);
                  this.showToast('Pasted from clipboard', 'success');
                  // Focus terminal after paste
                  if (this.isMobile && sess.mobileHandler && sess.mobileHandler.hiddenTextarea) {
                    sess.mobileHandler._focusHiddenTextarea();
                  } else {
                    terminal.focus();
                  }
                } else {
                  console.error('[SSHIFT] Session not connected');
                  this.showToast('Session not connected', 'error');
                }
              } else {
                // Clipboard API not available (HTTP context), show paste modal
                console.log('[SSHIFT] Clipboard API not available, showing paste modal');
                this.showPasteModal(sessionId);
              }
              
              // Clear the stored clipboard content
              this.terminalClipboardContent = null;
            };
            
            doPaste();
            break;
          case 'selectall':
            terminal.selectAll();
            // Focus terminal after select all
            const session = this.sessions.get(sessionId);
            if (this.isMobile && session && session.mobileHandler && session.mobileHandler.hiddenTextarea) {
              session.mobileHandler._focusHiddenTextarea();
            } else {
              terminal.focus();
            }
            break;
        }
        
        menu.remove();
      });
    });

    document.body.appendChild(menu);
    this._clampMenuToViewport(menu);

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

  showPasteModal(sessionId) {
    // Remove any existing paste modal
    const existingModal = document.querySelector('.paste-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'paste-modal';
    modal.innerHTML = `
      <div class="paste-modal-content">
        <div class="paste-modal-header">
          <h3>Paste to Terminal</h3>
          <button class="paste-modal-close">&times;</button>
        </div>
        <div class="paste-modal-body">
          <p>Clipboard access requires HTTPS. Please paste your text below:</p>
          <textarea class="paste-textarea" placeholder="Paste your text here (Ctrl+V or right-click → Paste)..." rows="6"></textarea>
        </div>
        <div class="paste-modal-footer">
          <button class="paste-modal-btn paste-modal-cancel">Cancel</button>
          <button class="paste-modal-btn paste-modal-submit">Paste</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Get elements
    const textarea = modal.querySelector('.paste-textarea');
    const closeBtn = modal.querySelector('.paste-modal-close');
    const cancelBtn = modal.querySelector('.paste-modal-cancel');
    const submitBtn = modal.querySelector('.paste-modal-submit');

    // Focus textarea
    setTimeout(() => textarea.focus(), 100);

    // Handle paste in textarea
    textarea.addEventListener('paste', (e) => {
      // Let the paste happen naturally in the textarea
      // Then auto-submit after a short delay
      setTimeout(() => {
        if (textarea.value.trim()) {
          submitBtn.click();
        }
      }, 100);
    });

    // Handle submit
    const handleSubmit = () => {
      const text = textarea.value;
      if (text) {
        const sess = this.sessions.get(sessionId);
        if (sess && sess.connected) {
          this.sendChunkedInput(sessionId, text);
          this.showToast('Pasted from clipboard', 'success');
          // Focus terminal after paste
          if (sess.terminal) {
            if (this.isMobile && sess.mobileHandler && sess.mobileHandler.hiddenTextarea) {
              sess.mobileHandler._focusHiddenTextarea();
            } else {
              sess.terminal.focus();
            }
          }
        } else {
          this.showToast('Session not connected', 'error');
        }
      }
      modal.remove();
    };

    // Handle cancel
    const handleCancel = () => {
      modal.remove();
    };

    // Event listeners
    submitBtn.addEventListener('click', handleSubmit);
    cancelBtn.addEventListener('click', handleCancel);
    closeBtn.addEventListener('click', handleCancel);
    
    // Close on escape
    const handleKeydown = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
        document.removeEventListener('keydown', handleKeydown);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        handleSubmit();
        document.removeEventListener('keydown', handleKeydown);
      }
    };
    document.addEventListener('keydown', handleKeydown);

    // Close on outside click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        handleCancel();
      }
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
      <div class="tab-context-menu-item" data-action="force-resize">
        <i class="fas fa-expand-arrows-alt"></i>
        <span>Force Resize</span>
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
        } else if (action === 'force-resize') {
          this.forceResizeTerminal(sessionId);
        }
        
        menu.remove();
      });
    });

    document.body.appendChild(menu);
    this._clampMenuToViewport(menu);

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
        
        // Update mobile tabs dropdown to reflect the name change
        this.updateMobileTabsDropdown();
        
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
        
        // Update mobile tabs dropdown to reflect the name change
        this.updateMobileTabsDropdown();
        
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
    this.clearKeyField('bookmarkPrivateKey', 'bookmarkKeyFormatBadge', 'bookmarkKeyClearBtn');
    
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
      document.getElementById('bookmarkType').value = bookmark.type;
      document.getElementById('bookmarkFolder').value = bookmark.folderId || '';
      
      // Handle URL type
      if (bookmark.type === 'url') {
        document.getElementById('bookmarkUrl').value = bookmark.url || '';
      } else {
        document.getElementById('bookmarkHost').value = bookmark.host;
        document.getElementById('bookmarkPort').value = bookmark.port;
        document.getElementById('bookmarkUsername').value = bookmark.username;
        document.getElementById('bookmarkPassword').value = bookmark.password || '';
        document.getElementById('bookmarkPrivateKey').value = bookmark.privateKey || '';
        document.getElementById('bookmarkPassphrase').value = bookmark.passphrase || '';
        if (bookmark.privateKey) {
          const fmt = this.detectKeyFormatOffline(bookmark.privateKey);
          const badge = document.getElementById('bookmarkKeyFormatBadge');
          const clearBtn = document.getElementById('bookmarkKeyClearBtn');
          const formatLabels = {
            'openssh': 'OpenSSH', 'pem-rsa': 'PEM (RSA)', 'pem-ec': 'PEM (EC)',
            'pem-dsa': 'PEM (DSA)', 'pkcs8': 'PKCS8', 'pkcs8-encrypted': 'PKCS8 (Encrypted)',
            'ppk': 'PPK'
          };
          badge.textContent = formatLabels[fmt] || fmt;
          badge.className = 'key-format-badge';
          if (bookmark.privateKey.includes('ENCRYPTED') || fmt === 'pkcs8-encrypted') {
            badge.classList.add('format-warning');
          }
          badge.style.display = 'inline-flex';
          clearBtn.style.display = 'inline-flex';
        }
      }
    } else {
      document.getElementById('bookmarkModalTitle').textContent = 'Add Bookmark';
      document.getElementById('bookmarkId').value = '';
      document.getElementById('bookmarkPort').value = '22';
      document.getElementById('bookmarkFolder').value = folderId || '';
    }

    // Toggle fields based on type
    this.toggleBookmarkTypeFields(bookmark?.type || 'ssh');

    this.openModal('bookmarkModal');
  }

  toggleBookmarkTypeFields(type) {
    const sshFields = document.getElementById('sshFields');
    const urlGroup = document.getElementById('bookmarkUrlGroup');
    const nameInput = document.getElementById('bookmarkName');
    
    if (type === 'url') {
      sshFields.style.display = 'none';
      urlGroup.style.display = 'block';
      // Update required fields
      document.getElementById('bookmarkHost').removeAttribute('required');
      document.getElementById('bookmarkUsername').removeAttribute('required');
      document.getElementById('bookmarkUrl').setAttribute('required', '');
    } else {
      sshFields.style.display = 'block';
      urlGroup.style.display = 'none';
      // Update required fields
      document.getElementById('bookmarkHost').setAttribute('required', '');
      document.getElementById('bookmarkUsername').setAttribute('required', '');
      document.getElementById('bookmarkUrl').removeAttribute('required');
    }
  }

  async saveBookmark() {
    const id = document.getElementById('bookmarkId').value;
    const name = document.getElementById('bookmarkName').value.trim();
    const type = document.getElementById('bookmarkType').value;
    const folderId = document.getElementById('bookmarkFolder').value || null;

    let bookmark = { name, type };
    if (folderId) bookmark.folderId = folderId;

    // Handle URL type
    if (type === 'url') {
      const url = document.getElementById('bookmarkUrl').value.trim();
      if (!name || !url) {
        this.showToast('Name and URL are required', 'error');
        return;
      }
      bookmark.url = url;
    } else {
      // SSH/SFTP type
      const host = document.getElementById('bookmarkHost').value.trim();
      const port = parseInt(document.getElementById('bookmarkPort').value) || 22;
      const username = document.getElementById('bookmarkUsername').value.trim();
      const password = document.getElementById('bookmarkPassword').value;
      const privateKey = document.getElementById('bookmarkPrivateKey').value.trim();
      const passphrase = document.getElementById('bookmarkPassphrase').value;

      if (!name || !host || !username) {
        this.showToast('Name, host, and username are required', 'error');
        return;
      }

      bookmark.host = host;
      bookmark.port = port;
      bookmark.username = username;
      // Only include password/key if provided (don't store empty strings)
      if (password) bookmark.password = password;
      if (privateKey) bookmark.privateKey = privateKey;
      if (passphrase) bookmark.passphrase = passphrase;
    }

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

  async addBookmark(bookmarkData) {
    try {
      const response = await fetch('/api/bookmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookmarkData)
      });

      if (response.ok) {
        this.showToast('Bookmark added', 'success');
        this.loadBookmarks();
      } else {
        throw new Error('Failed to add bookmark');
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
      type: bookmark.type,
      folderId: bookmark.folderId || null
    };

    // Handle URL type
    if (bookmark.type === 'url') {
      clonedBookmark.url = bookmark.url;
    } else {
      // SSH/SFTP type
      clonedBookmark.host = bookmark.host;
      clonedBookmark.port = bookmark.port;
      clonedBookmark.username = bookmark.username;
      // Include credentials if they exist
      if (bookmark.password) clonedBookmark.password = bookmark.password;
      if (bookmark.privateKey) clonedBookmark.privateKey = bookmark.privateKey;
      if (bookmark.passphrase) clonedBookmark.passphrase = bookmark.passphrase;
    }

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

  async connectFromBookmark(bookmark) {
    // Close sidebar on mobile when connecting
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      if (sidebar) sidebar.classList.remove('open');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
    
    // Handle URL type - open in new tab
    if (bookmark.type === 'url') {
      if (bookmark.url) {
        window.open(bookmark.url, '_blank');
      }
      return;
    }

    // Build connection data from bookmark
    const connectionData = {
      name: bookmark.name,
      host: bookmark.host,
      port: bookmark.port,
      username: bookmark.username,
      password: bookmark.password || '',
      privateKey: bookmark.privateKey || '',
      passphrase: bookmark.passphrase || ''
    };

    // Auto-convert PPK keys to OpenSSH format before connecting
    if (connectionData.privateKey && /PuTTY-User-Key-File-/i.test(connectionData.privateKey)) {
      try {
        const convertResult = await this.detectAndConvertKey(connectionData.privateKey);
        if (convertResult.key && !convertResult.error) {
          connectionData.privateKey = convertResult.key;
          this.showToast('PPK key converted to OpenSSH format', 'success');
        } else if (convertResult.error) {
          this.showToast('PPK key conversion failed: ' + convertResult.error, 'error');
          return;
        }
      } catch (e) {
        this.showToast('PPK key conversion failed: ' + e.message, 'error');
        return;
      }
    }

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

  async openSFTPFromBookmark(bookmark) {
    // Close sidebar on mobile when opening SFTP
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const sidebar = document.getElementById('sidebar');
      const sidebarOverlay = document.getElementById('sidebarOverlay');
      if (sidebar) sidebar.classList.remove('open');
      if (sidebarOverlay) sidebarOverlay.classList.remove('active');
    }
    
    // Build connection data from bookmark
    const connectionData = {
      name: `${bookmark.name} (SFTP)`,
      host: bookmark.host,
      port: bookmark.port,
      username: bookmark.username,
      password: bookmark.password || '',
      privateKey: bookmark.privateKey || '',
      passphrase: bookmark.passphrase || ''
    };

    // Auto-convert PPK keys to OpenSSH format before connecting
    if (connectionData.privateKey && /PuTTY-User-Key-File-/i.test(connectionData.privateKey)) {
      try {
        const convertResult = await this.detectAndConvertKey(connectionData.privateKey);
        if (convertResult.key && !convertResult.error) {
          connectionData.privateKey = convertResult.key;
          this.showToast('PPK key converted to OpenSSH format', 'success');
        } else if (convertResult.error) {
          this.showToast('PPK key conversion failed: ' + convertResult.error, 'error');
          return;
        }
      } catch (e) {
        this.showToast('PPK key conversion failed: ' + e.message, 'error');
        return;
      }
    }

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
      
      // Load expanded states from server
      const expandedStates = await this.loadFolderExpandedStates();
      folders.forEach(folder => {
        folder.expanded = expandedStates[folder.id] !== false; // Default to true
      });
      
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

  async loadFolderExpandedStates() {
    try {
      const response = await fetch('/api/folders/expanded');
      if (response.ok) {
        const states = await response.json();
        return states;
      }
    } catch (err) {
      console.error('Failed to load folder expanded states from server:', err);
    }
    // Fall back to localStorage
    const saved = localStorage.getItem('folderExpandedStates');
    return saved ? JSON.parse(saved) : {};
  }

  async saveFolderExpandedStates() {
    const states = {};
    this.folders.forEach(folder => {
      states[folder.id] = folder.expanded;
    });
    
    // Save to server
    try {
      await fetch('/api/folders/expanded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ states })
      });
    } catch (err) {
      console.error('Failed to save folder expanded states to server:', err);
    }
    
    // Also save to localStorage as backup
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

  async toggleFolderExpand(folderId) {
    const folder = this.folders.find(f => f.id === folderId);
    if (folder) {
      folder.expanded = !folder.expanded;
      await this.saveFolderExpandedStates();
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
    console.log('[SSHIFT] handleResize called');
    
    // Resize SSH terminals
    this.sessions.forEach((session, sessionId) => {
      if (session.terminal && session.fitAddon) {
        if (session.isController) {
          const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
          if (wrapper && wrapper.classList.contains('active')) {
            this._fitTerminal(session);
          } else if (wrapper) {
            session.needsResize = true;
            console.log(`[SSHIFT] Terminal ${sessionId} not visible, marked for resize`);
          }
        }
      }
    });
    
    // Resize SFTP terminals (no controller concept, always fit)
    this.sftpSessions.forEach((session, sessionId) => {
      if (session.terminal && session.fitAddon) {
        const wrapper = document.getElementById(`terminal-wrapper-${sessionId}`);
        if (wrapper && wrapper.classList.contains('active')) {
          this._fitTerminal(session);
        } else if (wrapper) {
          session.needsResize = true;
        }
      }
    });
  }

  // Control Overlay Management
  updateControlOverlay(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const overlay = document.getElementById(`control-overlay-${sessionId}`);
    if (!overlay) return;
    
    // Clear any pending overlay update timeout to prevent rapid flashing
    if (session.overlayUpdateTimeout) {
      clearTimeout(session.overlayUpdateTimeout);
      session.overlayUpdateTimeout = null;
    }
    
    // Debounce overlay updates to prevent rapid flashing when control changes quickly
    // This is especially important when multiple clients are fighting for control
    session.overlayUpdateTimeout = setTimeout(() => {
      // Re-check session state after debounce
      const currentSession = this.sessions.get(sessionId);
      if (!currentSession) return;
      
      const currentOverlay = document.getElementById(`control-overlay-${sessionId}`);
      if (!currentOverlay) return;
      
      // Show overlay if not in control (isController is false or undefined)
      // Hide overlay if in control (isController is true)
      if (currentSession.isController === true) {
        currentOverlay.style.display = 'none';
      } else {
        currentOverlay.style.display = 'flex';
      }
      
      currentSession.overlayUpdateTimeout = null;
    }, 50); // 50ms debounce to prevent flashing
  }

  requestTakeControl(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.connected) {
      this.showToast('Session not connected', 'error');
      return;
    }
    
    console.log('[SSHIFT] Requesting control for session:', sessionId);
    this.socket.emit('ssh-take-control', { sessionId });
  }

  // Toast Notifications
  showToast(message, type = 'info') {
    const MAX_TOASTS = 5;
    const DEDUP_INTERVAL = 3000;
    const container = document.getElementById('toastContainer');

    if (!this._toastDedup) this._toastDedup = new Map();
    const dedupKey = `${type}:${message}`;
    const lastShown = this._toastDedup.get(dedupKey);
    if (lastShown && Date.now() - lastShown < DEDUP_INTERVAL) return;
    this._toastDedup.set(dedupKey, Date.now());

    while (container.children.length >= MAX_TOASTS) {
      container.firstChild.remove();
    }

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

  // Version and Update Management
  async initVersionCheck() {
    // Load and display current version
    await this.loadVersion();
    
    // Set up auto-check interval (6 hours + 0-2 minute random delay)
    const lastCheck = localStorage.getItem('lastUpdateCheck');
    const now = Date.now();
    const sixHours = 6 * 60 * 60 * 1000;
    
    // Check if we need to do initial check
    if (!lastCheck || (now - parseInt(lastCheck)) > sixHours) {
      // Add random delay (0-2 minutes) to avoid thundering herd
      const randomDelay = Math.floor(Math.random() * 2 * 60 * 1000);
      setTimeout(() => this.checkForUpdates(false), randomDelay);
    }
    
    // Set up periodic check every 6 hours
    setInterval(() => {
      const randomDelay = Math.floor(Math.random() * 2 * 60 * 1000);
      setTimeout(() => this.checkForUpdates(false), randomDelay);
    }, sixHours);
    
    // Set up manual check handler
    const checkUpdatesLink = document.getElementById('checkUpdates');
    if (checkUpdatesLink) {
      checkUpdatesLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.checkForUpdates(true);
      });
    }
    
    // Set up update button handler
    const updateBtn = document.getElementById('updateBtn');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => this.executeUpdate());
    }
  }

  async loadVersion() {
    try {
      const response = await fetch('/api/version');
      if (response.ok) {
        const data = await response.json();
        const versionNumber = document.getElementById('versionNumber');
        if (versionNumber) {
          versionNumber.textContent = data.version || 'Unknown';
        }
        
        // Show "Check Updates" link in update section
        const checkUpdatesLink = document.getElementById('checkUpdates');
        if (checkUpdatesLink) {
          checkUpdatesLink.textContent = 'Check Updates';
        }
        
        // Show update info section
        const updateInfo = document.getElementById('updateInfo');
        if (updateInfo) {
          updateInfo.style.display = 'flex';
        }
      }
    } catch (error) {
      console.error('Failed to load version:', error);
      const versionNumber = document.getElementById('versionNumber');
      if (versionNumber) {
        versionNumber.textContent = 'Error';
      }
      const checkUpdatesLink = document.getElementById('checkUpdates');
      if (checkUpdatesLink) {
        checkUpdatesLink.textContent = 'Error';
      }
    }
  }

  async checkForUpdates(manual = false) {
    try {
      const response = await fetch('/api/check-update');
      if (response.ok) {
        const data = await response.json();
        
        // Update last check time
        localStorage.setItem('lastUpdateCheck', Date.now().toString());
        
        const updateBtn = document.getElementById('updateBtn');
        const checkUpdatesLink = document.getElementById('checkUpdates');
        
        if (data.updateAvailable) {
          // Show update button
          if (updateBtn) {
            updateBtn.style.display = 'inline-flex';
          }
          if (checkUpdatesLink) {
            checkUpdatesLink.textContent = 'Update available!';
            checkUpdatesLink.style.color = '#f59e0b'; // Warning color
          }
          
          if (manual) {
            this.showToast('A new version is available!', 'info');
          }
        } else {
          // Hide update button
          if (updateBtn) {
            updateBtn.style.display = 'none';
          }
          // Show "Check Updates" link
          if (checkUpdatesLink) {
            checkUpdatesLink.textContent = 'Check Updates';
            checkUpdatesLink.style.color = '';
          }
          
          if (manual) {
            this.showToast('You are running the latest version', 'success');
          }
        }
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      if (manual) {
        this.showToast('Failed to check for updates', 'error');
      }
    }
  }

  async executeUpdate() {
    this.isUpdating = true;
    const updateBtn = document.getElementById('updateBtn');
    const updateOverlay = document.getElementById('updateOverlay');
    const updateMessage = document.getElementById('updateMessage');
    const updateProgressBar = document.getElementById('updateProgressBar');
    const updateStatus = document.getElementById('updateStatus');
    
    // Store the current version for comparison
    let currentVersion = 'unknown';
    try {
      const versionResponse = await fetch('/api/version');
      if (versionResponse.ok) {
        const versionData = await versionResponse.json();
        currentVersion = versionData.version;
      }
    } catch (e) {
      console.error('[UPDATE] Failed to get current version:', e);
    }
    
    // Show update overlay
    if (updateOverlay) {
      updateOverlay.classList.add('active');
    }
    
    // Update UI to show update is starting
    if (updateBtn) {
      updateBtn.disabled = true;
      updateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    }
    
    if (updateMessage) {
      updateMessage.textContent = 'Starting update process...';
    }
    
    if (updateProgressBar) {
      updateProgressBar.style.width = '10%';
    }
    
    if (updateStatus) {
      updateStatus.textContent = `Current version: ${currentVersion}`;
    }
    
    try {
      const response = await fetch('/api/update', { method: 'POST' });
      if (response.ok) {
        if (updateMessage) {
          updateMessage.textContent = 'Update in progress. Please wait...';
        }
        
        if (updateProgressBar) {
          updateProgressBar.style.width = '30%';
        }
        
        // Start polling for update status
        this.pollUpdateStatus(currentVersion, updateProgressBar, updateMessage, updateStatus);
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Update failed');
      }
    } catch (error) {
      console.error('Failed to execute update:', error);
      this.isUpdating = false;
      
      // Hide overlay on error
      if (updateOverlay) {
        updateOverlay.classList.remove('active');
      }
      
      this.showToast('Failed to update: ' + error.message, 'error');
      
      // Re-enable update button
      if (updateBtn) {
        updateBtn.disabled = false;
        updateBtn.innerHTML = '<i class="fas fa-download"></i> Update';
      }
    }
  }
  
  async pollUpdateStatus(oldVersion, progressBar, messageEl, statusEl) {
    const maxAttempts = 120; // 2 minutes max (1 second per attempt)
    let attempts = 0;
    let lastProgress = 30;
    
    const poll = async () => {
      attempts++;
      
      try {
        const response = await fetch('/api/update-status');
        
        if (!response.ok) {
          // Server might be restarting, wait and retry
          if (attempts < maxAttempts) {
            // Update progress bar to show we're waiting for server
            const progress = Math.min(90, lastProgress + (attempts * 0.5));
            if (progressBar) {
              progressBar.style.width = `${progress}%`;
            }
            
            if (statusEl) {
              statusEl.textContent = `Waiting for server to restart... (${attempts}/${maxAttempts})`;
            }
            
            setTimeout(poll, 1000);
            return;
          }
        }
        
        const data = await response.json();
        
        // Check for update error from server
        if (data.updateError) {
          const logMsg = data.updateLog ? '\n\n' + data.updateLog : '';
          this.handleUpdateError(data.updateError + logMsg);
          return;
        }
        
        // Update progress based on status
        if (data.updating) {
          // Still updating
          const progress = Math.min(70, 30 + (attempts * 2));
          if (progressBar) {
            progressBar.style.width = `${progress}%`;
          }
          
          if (statusEl) {
            statusEl.textContent = `Installing update... (${attempts}/${maxAttempts})`;
          }
          
          if (attempts < maxAttempts) {
            setTimeout(poll, 1000);
          } else {
            // Timeout reached
            this.handleUpdateError('Update timed out. Please refresh the page manually.');
          }
        } else if (data.ready && data.version !== oldVersion) {
          // Update complete! New version is running
          if (progressBar) {
            progressBar.style.width = '100%';
          }
          
          if (messageEl) {
            messageEl.textContent = 'Update complete! Reloading page...';
          }
          
          if (statusEl) {
            statusEl.textContent = `New version: ${data.version}`;
          }
          
          setTimeout(() => {
            this.forceReloadAfterUpdate();
          }, 1000);
        } else if (data.ready && data.version === oldVersion) {
          // Server is back and ready. Same version could mean:
          // 1. Already at the latest version (npm install succeeded but no newer version exists)
          // 2. Update failed silently
          // Either way, the server is back and functional — just reload.
          if (progressBar) {
            progressBar.style.width = '100%';
          }
          
          if (messageEl) {
            messageEl.textContent = 'Server restarted. Reloading page...';
          }
          
          if (statusEl) {
            statusEl.textContent = `Current version: ${data.version}`;
          }
          
          setTimeout(() => {
            this.forceReloadAfterUpdate();
          }, 1000);
        } else {
          // Unexpected state
          if (attempts < maxAttempts) {
            setTimeout(poll, 1000);
          } else {
            this.handleUpdateError('Unexpected update state. Please refresh the page.');
          }
        }
      } catch (error) {
        // Network error - server might be restarting
        if (attempts < maxAttempts) {
          const progress = Math.min(90, lastProgress + (attempts * 0.5));
          if (progressBar) {
            progressBar.style.width = `${progress}%`;
          }
          
          if (statusEl) {
            statusEl.textContent = `Server restarting... (${attempts}/${maxAttempts})`;
          }
          
          setTimeout(poll, 1000);
        } else {
          this.handleUpdateError('Connection lost during update. Please refresh the page.');
        }
      }
    };
    
    // Start polling
    setTimeout(poll, 1000);
  }
  
  handleUpdateError(message) {
    this.isUpdating = false;
    const updateOverlay = document.getElementById('updateOverlay');
    const updateBtn = document.getElementById('updateBtn');
    
    // Hide overlay
    if (updateOverlay) {
      updateOverlay.classList.remove('active');
    }
    
    // Show error toast
    this.showToast(message, 'error');
    
    // Re-enable update button
    if (updateBtn) {
      updateBtn.disabled = false;
      updateBtn.innerHTML = '<i class="fas fa-download"></i> Update';
    }
  }

  forceReloadAfterUpdate() {
    const cleanup = [];
    if ('caches' in window) {
      cleanup.push(caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))));
    }
    if ('serviceWorker' in navigator) {
      cleanup.push(navigator.serviceWorker.getRegistrations().then((regs) => Promise.all(regs.map((r) => r.unregister()))));
    }
    Promise.all(cleanup).catch(() => {}).finally(() => {
      window.location.href = window.location.origin + window.location.pathname + '?v=' + Date.now();
    });
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SSHIFTClient();
  // Initialize Lucide icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});