/**
 * MobileTerminalHandler - Provides mobile touch support for xterm.js terminals
 * 
 * Features:
 * - Touch-based text selection with custom handles
 * - Long-press for word selection and context menu
 * - Double-tap for line selection
 * - Mobile-optimized context menu (Copy, Paste, Clear)
 * - Virtual keyboard viewport management
 * - Coordinate mapping from screen touches to terminal row/column
 */
class MobileTerminalHandler {
  constructor(terminal, session, app) {
    this.terminal = terminal;
    this.session = session;
    this.app = app;
    this.sessionId = session.id;
    
    // Selection state
    this.selection = {
      start: null,  // { x, y } in terminal coordinates
      end: null,    // { x, y } in terminal coordinates
      active: false,
      text: ''
    };
    
    // Touch state
    this.touchState = {
      startTime: 0,
      startX: 0,
      startY: 0,
      lastTapTime: 0,
      isLongPress: false,
      longPressTimer: null,
      isDragging: false,
      dragHandle: null, // 'start' or 'end'
      isSelecting: false // True when in selection mode (prevents keyboard)
    };
    
    // UI elements
    this.container = null;
    this.terminalElement = null;
    this.selectionOverlay = null;
    this.startHandle = null;
    this.endHandle = null;
    this.contextMenu = null;
    this.hiddenTextarea = null;
    this.contextMenuUserPositioned = false; // Track if user has manually positioned the menu
    
    // Configuration
    this.config = {
      longPressDelay: 500, // ms
      doubleTapDelay: 300,  // ms
      handleSize: 20,       // px
      contextMenuWidth: 50, // px (reduced for compact mobile UI)
      minTouchTarget: 44,   // px (Apple HIG recommendation)
      scrollEdgeSize: 50,   // px - trigger scroll when near edge
      scrollSpeed: 2        // lines per frame
    };
    
    // Viewport management
    this.viewport = {
      originalHeight: null,
      keyboardHeight: 0,
      isKeyboardVisible: false
    };
    
    // Bound methods (for event listener management)
    this._boundHandleTouchStart = this._handleTouchStart.bind(this);
    this._boundHandleTouchMove = this._handleTouchMove.bind(this);
    this._boundHandleTouchEnd = this._handleTouchEnd.bind(this);
    this._boundHandleResize = this._handleResize.bind(this);
    this._boundHandleVisualViewport = this._handleVisualViewport.bind(this);
    this._boundHandleContextMenu = this._handleContextMenu.bind(this);
    this._boundHandleKeyDown = this._handleKeyDown.bind(this);
    
    console.log('[MobileTerminal] Handler created for session:', this.sessionId);
  }
  
  /**
   * Initialize the mobile handler - attach to terminal element
   * @param {HTMLElement} terminalElement - The terminal wrapper element
   */
  init(terminalElement) {
    this.terminalElement = terminalElement;
    this.container = terminalElement.querySelector('.terminal-container') || terminalElement;
    
    if (!this.container) {
      console.error('[MobileTerminal] No terminal container found');
      return;
    }
    
    // Create UI elements
    this._createSelectionOverlay();
    this._createSelectionHandles();
    this._createContextMenu();
    this._createHiddenTextarea();
    
    // Attach event listeners
    this._attachEventListeners();
    
    console.log('[MobileTerminal] Initialized for session:', this.sessionId);
  }
  
  /**
   * Create the selection overlay element
   * @private
   */
  _createSelectionOverlay() {
    this.selectionOverlay = document.createElement('div');
    this.selectionOverlay.className = 'mobile-selection-overlay';
    this.selectionOverlay.style.display = 'none';
    this.container.appendChild(this.selectionOverlay);
  }
  
  /**
   * Create selection handles (start and end)
   * @private
   */
  _createSelectionHandles() {
    // Start handle
    this.startHandle = document.createElement('div');
    this.startHandle.className = 'mobile-selection-handle mobile-selection-handle-start';
    this.startHandle.innerHTML = '<div class="handle-visual"></div>';
    this.startHandle.style.display = 'none';
    this.container.appendChild(this.startHandle);
    
    // End handle
    this.endHandle = document.createElement('div');
    this.endHandle.className = 'mobile-selection-handle mobile-selection-handle-end';
    this.endHandle.innerHTML = '<div class="handle-visual"></div>';
    this.endHandle.style.display = 'none';
    this.container.appendChild(this.endHandle);
    
    // Add touch listeners to handles
    this._setupHandleTouchListeners(this.startHandle, 'start');
    this._setupHandleTouchListeners(this.endHandle, 'end');
  }
  
  /**
   * Setup touch listeners for selection handles
   * @private
   */
  _setupHandleTouchListeners(handle, type) {
    handle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Set selecting mode to prevent keyboard
      this.touchState.isSelecting = true;
      this.touchState.isDragging = true;
      this.touchState.dragHandle = type;
      handle.classList.add('active');
    }, { passive: false });
    
    handle.addEventListener('touchmove', (e) => {
      if (!this.touchState.isDragging) return;
      e.preventDefault();
      
      const touch = e.touches[0];
      const coords = this._screenToTerminalCoords(touch.clientX, touch.clientY);
      
      if (coords) {
        // Update the appropriate handle position
        if (type === 'start') {
          // When dragging start handle, update start position
          this.selection.start = coords;
        } else {
          // When dragging end handle, update end position
          this.selection.end = coords;
        }
        
        // Ensure start is always before end in buffer order
        // This prevents selection from inverting
        this._normalizeSelection();
        this._updateSelection();
      }
    }, { passive: false });
    
    handle.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchState.isDragging = false;
      this.touchState.dragHandle = null;
      handle.classList.remove('active');
      
      // Update context menu position after handle drag
      if (this.selection.active) {
        this._positionContextMenu();
      }
    }, { passive: false });
  }
  
  /**
   * Normalize selection so start is always before end
   * @private
   */
  _normalizeSelection() {
    if (!this.selection.start || !this.selection.end) return;
    
    const start = this.selection.start;
    const end = this.selection.end;
    
    // Compare positions (row first, then column)
    const startPos = start.y * this.terminal.cols + start.x;
    const endPos = end.y * this.terminal.cols + end.x;
    
    // If end is before start, swap them
    if (endPos < startPos) {
      const temp = this.selection.start;
      this.selection.start = this.selection.end;
      this.selection.end = temp;
    }
  }
  
  /**
   * Create the mobile context menu
   * @private
   */
  _createContextMenu() {
    this.contextMenu = document.createElement('div');
    this.contextMenu.className = 'mobile-context-menu';
    this.contextMenu.innerHTML = `
      <div class="mobile-menu-drag-handle">
        <i class="fas fa-grip-lines"></i>
      </div>
      <div class="mobile-menu-row">
        <button class="mobile-menu-btn" data-action="copy">
          <i class="fas fa-copy"></i>
          <span>Copy</span>
        </button>
        <button class="mobile-menu-btn" data-action="paste">
          <i class="fas fa-paste"></i>
          <span>Paste</span>
        </button>
        <button class="mobile-menu-btn" data-action="clear">
          <i class="fas fa-times"></i>
          <span>Clear</span>
        </button>
      </div>
    `;
    this.contextMenu.style.display = 'none';
    document.body.appendChild(this.contextMenu);
    
    // Setup drag handle
    this._setupContextMenuDrag();
    
    // Add click handlers
    this.contextMenu.querySelectorAll('.mobile-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        this._handleMenuAction(action);
      });
      
      // Prevent context menu from closing on item touch
      btn.addEventListener('touchstart', (e) => {
        e.stopPropagation();
      }, { passive: true });
    });
    
    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!this.contextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });
  }
  
  /**
   * Setup drag functionality for context menu
   * @private
   */
  _setupContextMenuDrag() {
    const dragHandle = this.contextMenu.querySelector('.mobile-menu-drag-handle');
    if (!dragHandle) return;
    
    let isDragging = false;
    let startX, startY;
    let menuX, menuY;
    
    dragHandle.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      isDragging = true;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      
      // Get current menu position
      const rect = this.contextMenu.getBoundingClientRect();
      menuX = rect.left;
      menuY = rect.top;
      
      dragHandle.style.cursor = 'grabbing';
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
      if (!isDragging) return;
      
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      
      // Update menu position
      const newX = menuX + deltaX;
      const newY = menuY + deltaY;
      
      // Keep menu within viewport bounds
      const maxX = window.innerWidth - this.contextMenu.offsetWidth;
      const maxY = window.innerHeight - this.contextMenu.offsetHeight;
      
      this.contextMenu.style.left = `${Math.max(0, Math.min(maxX, newX))}px`;
      this.contextMenu.style.top = `${Math.max(0, Math.min(maxY, newY))}px`;
      
      // Mark that user has manually positioned the menu
      this.contextMenuUserPositioned = true;
    }, { passive: true });
    
    document.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        dragHandle.style.cursor = 'grab';
      }
    });
  }
  
  /**
   * Create hidden textarea for clipboard operations and keyboard input
   * @private
   */
  _createHiddenTextarea() {
    this.hiddenTextarea = document.createElement('textarea');
    this.hiddenTextarea.className = 'mobile-hidden-textarea';
    this.hiddenTextarea.setAttribute('autocomplete', 'off');
    this.hiddenTextarea.setAttribute('autocorrect', 'off');
    this.hiddenTextarea.setAttribute('autocapitalize', 'off');
    this.hiddenTextarea.setAttribute('spellcheck', 'false');
    this.hiddenTextarea.setAttribute('contenteditable', 'true');
    this.hiddenTextarea.setAttribute('readonly', 'true'); // Prevent keyboard on focus by default
    this.hiddenTextarea.style.position = 'absolute';
    this.hiddenTextarea.style.left = '-9999px';
    this.hiddenTextarea.style.top = '0';
    this.hiddenTextarea.style.width = '1px';
    this.hiddenTextarea.style.height = '1px';
    this.hiddenTextarea.style.opacity = '0';
    this.hiddenTextarea.style.fontSize = '16px'; // Prevent zoom on iOS
    document.body.appendChild(this.hiddenTextarea);
    
    // Handle paste events
    this.hiddenTextarea.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text');
      this._pasteText(text);
    });
    
    // Handle input events (for virtual keyboard)
    this.hiddenTextarea.addEventListener('input', (e) => {
      // Don't process input if in selection mode
      if (this.touchState.isSelecting) {
        e.preventDefault();
        this.hiddenTextarea.value = '';
        return;
      }
      
      if (e.data && !this.touchState.isDragging) {
        // Send input to terminal
        this._sendToTerminal(e.data);
        this.hiddenTextarea.value = '';
      }
    });
    
    // Handle keydown for special keys
    this.hiddenTextarea.addEventListener('keydown', (e) => {
      // Don't process keys if in selection mode
      if (this.touchState.isSelecting) {
        e.preventDefault();
        return;
      }
      
      if (e.key === 'Enter') {
        e.preventDefault();
        this._sendToTerminal('\r');
        this.hiddenTextarea.value = '';
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        this._sendToTerminal('\x7f');
        this.hiddenTextarea.value = '';
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this._sendToTerminal('\t');
        this.hiddenTextarea.value = '';
      }
    });
    
    // Prevent focus when in selection mode
    this.hiddenTextarea.addEventListener('focus', (e) => {
      if (this.touchState.isSelecting) {
        e.preventDefault();
        this.hiddenTextarea.blur();
      }
    });
  }
  
  /**
   * Attach event listeners to terminal element
   * @private
   */
  _attachEventListeners() {
    // Touch events for selection
    this.container.addEventListener('touchstart', this._boundHandleTouchStart, { passive: false });
    this.container.addEventListener('touchmove', this._boundHandleTouchMove, { passive: false });
    this.container.addEventListener('touchend', this._boundHandleTouchEnd, { passive: false });
    
    // Context menu (right-click on desktop)
    this.container.addEventListener('contextmenu', this._boundHandleContextMenu);
    
    // Viewport management
    window.addEventListener('resize', this._boundHandleResize);
    
    // Visual viewport API for keyboard detection
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._boundHandleVisualViewport);
      window.visualViewport.addEventListener('scroll', this._boundHandleVisualViewport);
    }
    
    // Keyboard events
    document.addEventListener('keydown', this._boundHandleKeyDown);
  }
  
  /**
   * Detach all event listeners
   */
  destroy() {
    if (this.container) {
      this.container.removeEventListener('touchstart', this._boundHandleTouchStart);
      this.container.removeEventListener('touchmove', this._boundHandleTouchMove);
      this.container.removeEventListener('touchend', this._boundHandleTouchEnd);
      this.container.removeEventListener('contextmenu', this._boundHandleContextMenu);
    }
    
    window.removeEventListener('resize', this._boundHandleResize);
    
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._boundHandleVisualViewport);
      window.visualViewport.removeEventListener('scroll', this._boundHandleVisualViewport);
    }
    
    document.removeEventListener('keydown', this._boundHandleKeyDown);
    
    // Remove UI elements
    if (this.selectionOverlay && this.selectionOverlay.parentNode) {
      this.selectionOverlay.parentNode.removeChild(this.selectionOverlay);
    }
    if (this.startHandle && this.startHandle.parentNode) {
      this.startHandle.parentNode.removeChild(this.startHandle);
    }
    if (this.endHandle && this.endHandle.parentNode) {
      this.endHandle.parentNode.removeChild(this.endHandle);
    }
    if (this.contextMenu && this.contextMenu.parentNode) {
      this.contextMenu.parentNode.removeChild(this.contextMenu);
    }
    if (this.hiddenTextarea && this.hiddenTextarea.parentNode) {
      this.hiddenTextarea.parentNode.removeChild(this.hiddenTextarea);
    }
    
    console.log('[MobileTerminal] Handler destroyed for session:', this.sessionId);
  }
  
  /**
   * Handle touch start event
   * @private
   */
  _handleTouchStart(e) {
    // Ignore if not on mobile or if dragging a handle
    if (!this.app.isMobile || this.touchState.isDragging) return;
    
    // Always prevent keyboard from appearing during touch interactions
    this._collapseKeyboard();
    
    const touch = e.touches[0];
    const now = Date.now();
    
    this.touchState.startTime = now;
    this.touchState.startX = touch.clientX;
    this.touchState.startY = touch.clientY;
    this.touchState.isLongPress = false;
    
    // Check for double-tap
    const timeSinceLastTap = now - this.touchState.lastTapTime;
    if (timeSinceLastTap < this.config.doubleTapDelay) {
      // Double-tap detected - select line
      e.preventDefault();
      this._handleDoubleTap(touch);
      this.touchState.lastTapTime = 0;
      return;
    }
    
    // Start long-press timer
    this.touchState.longPressTimer = setTimeout(() => {
      this.touchState.isLongPress = true;
      this._handleLongPress(touch);
    }, this.config.longPressDelay);
    
    this.touchState.lastTapTime = now;
  }
  
  /**
   * Handle touch move event
   * @private
   */
  _handleTouchMove(e) {
    if (!this.app.isMobile) return;
    
    // Cancel long-press if moved too much
    if (this.touchState.longPressTimer) {
      const touch = e.touches[0];
      const dx = touch.clientX - this.touchState.startX;
      const dy = touch.clientY - this.touchState.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 10) { // 10px threshold
        clearTimeout(this.touchState.longPressTimer);
        this.touchState.longPressTimer = null;
      }
    }
    
    // Handle selection dragging
    if (this.selection.active && this.touchState.isDragging) {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = this._screenToTerminalCoords(touch.clientX, touch.clientY);
      
      if (coords) {
        this.selection.end = coords;
        this._updateSelection();
      }
    }
  }
  
  /**
   * Handle touch end event
   * @private
   */
  _handleTouchEnd(e) {
    if (!this.app.isMobile) return;
    
    // Clear long-press timer
    if (this.touchState.longPressTimer) {
      clearTimeout(this.touchState.longPressTimer);
      this.touchState.longPressTimer = null;
    }
    
    // If it was a long-press, don't do anything else
    if (this.touchState.isLongPress) {
      return;
    }
    
    // If we're dragging, finalize selection
    if (this.touchState.isDragging) {
      this.touchState.isDragging = false;
      return;
    }
    
    // Single tap - clear selection if exists, otherwise focus for input
    const touch = e.changedTouches[0];
    const timeSinceStart = Date.now() - this.touchState.startTime;
    
    if (timeSinceStart < 200) { // Quick tap
      if (this.selection.active) {
        this.clearSelection();
      } else {
        // Focus hidden textarea for keyboard input
        this._focusHiddenTextarea();
      }
    }
  }
  
  /**
   * Handle double-tap - select line
   * @private
   */
  _handleDoubleTap(touch) {
    const coords = this._screenToTerminalCoords(touch.clientX, touch.clientY);
    if (!coords) return;
    
    // Set selecting mode to prevent keyboard from appearing
    this.touchState.isSelecting = true;
    
    // Force keyboard to collapse
    this._collapseKeyboard();
    
    // Select the entire line
    this.selection.start = { x: 0, y: coords.y };
    this.selection.end = { x: this.terminal.cols - 1, y: coords.y };
    this.selection.active = true;
    
    this._updateSelection();
    this._showContextMenu(touch.clientX, touch.clientY);
  }
  
  /**
   * Handle long-press - select word and show context menu
   * @private
   */
  _handleLongPress(touch) {
    const coords = this._screenToTerminalCoords(touch.clientX, touch.clientY);
    if (!coords) return;
    
    // Set selecting mode to prevent keyboard from appearing
    this.touchState.isSelecting = true;
    
    // Force keyboard to collapse
    this._collapseKeyboard();
    
    // Select word at position
    const wordRange = this._getWordAtPosition(coords.x, coords.y);
    if (wordRange) {
      this.selection.start = wordRange.start;
      this.selection.end = wordRange.end;
      this.selection.active = true;
      
      this._updateSelection();
      this._showContextMenu(touch.clientX, touch.clientY);
    }
  }
  
  /**
   * Get word boundaries at position
   * @private
   */
  _getWordAtPosition(x, y) {
    // Get the line buffer
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(y);
    
    if (!line) return null;
    
    const lineText = line.translateToString(true);
    
    // Find word boundaries
    let start = x;
    let end = x;
    
    // Expand left
    while (start > 0 && this._isWordChar(lineText[start - 1])) {
      start--;
    }
    
    // Expand right
    while (end < lineText.length && this._isWordChar(lineText[end])) {
      end++;
    }
    
    if (start === end) {
      // No word found, select single character
      return { start: { x, y }, end: { x, y } };
    }
    
    return { start: { x: start, y }, end: { x: end - 1, y } };
  }
  
  /**
   * Check if character is part of a word
   * @private
   */
  _isWordChar(char) {
    return /[\w\-_./@]/.test(char);
  }
  
  /**
   * Convert screen coordinates to terminal coordinates
   * @private
   */
  _screenToTerminalCoords(screenX, screenY) {
    if (!this.terminal || !this.container) return null;
    
    const rect = this.container.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    
    // Get terminal dimensions
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    
    // Get cell dimensions
    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;
    
    // Convert to terminal coordinates
    const termX = Math.floor(x / cellWidth);
    const termY = Math.floor(y / cellHeight);
    
    // Add scroll offset to get actual buffer line
    // ydisp is the number of lines scrolled back from the bottom
    const scrollOffset = this.terminal.buffer.ydisp || 0;
    const bufferY = termY + scrollOffset;
    
    // Get buffer length for clamping
    const bufferLength = this.terminal.buffer.active.length;
    
    // Clamp to valid range
    return {
      x: Math.max(0, Math.min(cols - 1, termX)),
      y: Math.max(0, Math.min(bufferLength - 1, bufferY))
    };
  }
  
  /**
   * Convert terminal coordinates to screen position
   * @private
   */
  _terminalToScreenCoords(termX, termY) {
    if (!this.terminal || !this.container) return null;
    
    const rect = this.container.getBoundingClientRect();
    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    
    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;
    
    // Subtract scroll offset to get viewport coordinates
    const scrollOffset = this.terminal.buffer.ydisp || 0;
    const viewportY = termY - scrollOffset;
    
    return {
      x: rect.left + (termX * cellWidth),
      y: rect.top + (viewportY * cellHeight),
      width: cellWidth,
      height: cellHeight
    };
  }
  
  /**
   * Update selection overlay and handles
   * @private
   */
  _updateSelection() {
    if (!this.selection.active || !this.selection.start || !this.selection.end) {
      this.selectionOverlay.style.display = 'none';
      this.startHandle.style.display = 'none';
      this.endHandle.style.display = 'none';
      return;
    }
    
    // Normalize selection (start should be before end)
    const start = this.selection.start;
    const end = this.selection.end;
    
    // Get selection text
    this.selection.text = this._getSelectionText();
    
    // Update selection overlay
    this._updateSelectionOverlay(start, end);
    
    // Update handles
    this._updateHandles(start, end);
  }
  
  /**
   * Get selected text from terminal
   * @private
   */
  _getSelectionText() {
    if (!this.selection.active || !this.selection.start || !this.selection.end) {
      return '';
    }
    
    const buffer = this.terminal.buffer.active;
    
    // Determine actual start and end positions (handle reversed selection)
    const startPos = (this.selection.start.y < this.selection.end.y) || 
                     (this.selection.start.y === this.selection.end.y && this.selection.start.x <= this.selection.end.x)
                   ? this.selection.start : this.selection.end;
    const endPos = (this.selection.start.y < this.selection.end.y) || 
                   (this.selection.start.y === this.selection.end.y && this.selection.start.x <= this.selection.end.x)
                 ? this.selection.end : this.selection.start;
    
    let text = '';
    
    for (let y = startPos.y; y <= endPos.y; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      
      let lineText = '';
      
      if (startPos.y === endPos.y) {
        // Single line selection
        lineText = line.translateToString(false, startPos.x, endPos.x + 1);
      } else if (y === startPos.y) {
        // First line - from start.x to end of line
        lineText = line.translateToString(false, startPos.x);
      } else if (y === endPos.y) {
        // Last line - from beginning to end.x
        lineText = line.translateToString(false, 0, endPos.x + 1);
      } else {
        // Middle lines - full line
        lineText = line.translateToString(false);
      }
      
      text += lineText;
      if (y < endPos.y) {
        text += '\n';
      }
    }
    
    return text.trim();
  }
  
  /**
   * Update selection overlay visual
   * @private
   */
  _updateSelectionOverlay(start, end) {
    const startPos = this._terminalToScreenCoords(start.x, start.y);
    const endPos = this._terminalToScreenCoords(end.x, end.y);
    
    if (!startPos || !endPos) return;
    
    const containerRect = this.container.getBoundingClientRect();
    
    // Calculate selection rectangle
    const startY = Math.min(start.y, end.y);
    const endY = Math.max(start.y, end.y);
    
    // Clear existing overlay
    this.selectionOverlay.innerHTML = '';
    
    // Create selection rectangles for each line
    for (let y = startY; y <= endY; y++) {
      const lineStartX = (y === startY) ? Math.min(start.x, end.x) : 0;
      const lineEndX = (y === endY) ? Math.max(start.x, end.x) : this.terminal.cols - 1;
      
      const lineStartPos = this._terminalToScreenCoords(lineStartX, y);
      const lineEndPos = this._terminalToScreenCoords(lineEndX, y);
      
      if (lineStartPos && lineEndPos) {
        const rect = document.createElement('div');
        rect.className = 'mobile-selection-rect';
        rect.style.position = 'absolute';
        rect.style.left = `${lineStartPos.x - containerRect.left}px`;
        rect.style.top = `${lineStartPos.y - containerRect.top}px`;
        rect.style.width = `${lineEndPos.x - lineStartPos.x + lineEndPos.width}px`;
        rect.style.height = `${lineStartPos.height}px`;
        this.selectionOverlay.appendChild(rect);
      }
    }
    
    this.selectionOverlay.style.display = 'block';
  }
  
  /**
   * Update selection handles positions
   * @private
   */
  _updateHandles(start, end) {
    const containerRect = this.container.getBoundingClientRect();
    
    // Determine which is start and which is end based on position
    const isStartFirst = (start.y < end.y) || (start.y === end.y && start.x <= end.x);
    
    const actualStart = isStartFirst ? start : end;
    const actualEnd = isStartFirst ? end : start;
    
    // Position start handle
    const startPos = this._terminalToScreenCoords(actualStart.x, actualStart.y);
    if (startPos) {
      this.startHandle.style.display = 'block';
      this.startHandle.style.left = `${startPos.x - containerRect.left}px`;
      this.startHandle.style.top = `${startPos.y - containerRect.top + startPos.height}px`;
    }
    
    // Position end handle
    const endPos = this._terminalToScreenCoords(actualEnd.x, actualEnd.y);
    if (endPos) {
      this.endHandle.style.display = 'block';
      this.endHandle.style.left = `${endPos.x - containerRect.left + endPos.width}px`;
      this.endHandle.style.top = `${endPos.y - containerRect.top + endPos.height}px`;
    }
  }
  
  /**
   * Show context menu at position
   * @private
   */
  _showContextMenu(x, y) {
    if (!this.contextMenu) return;
    
    // Position menu above the start handle
    this._positionContextMenu();
    
    // Pre-read clipboard for paste action
    this._readClipboard();
  }
  
  /**
   * Position context menu above the start selection handle
   * @private
   */
  _positionContextMenu() {
    if (!this.contextMenu || !this.selection.active) return;
    
    // If user has manually positioned the menu, keep it there
    if (this.contextMenuUserPositioned) {
      this.contextMenu.style.display = 'block';
      return;
    }
    
    // Get start handle position
    const startHandleRect = this.startHandle.getBoundingClientRect();
    const menuWidth = this.config.contextMenuWidth;
    const menuHeight = 50; // Approximate height for single row menu
    
    // Position above the start handle
    let posX = startHandleRect.left + (startHandleRect.width / 2) - (menuWidth / 2);
    let posY = startHandleRect.top - menuHeight - 10; // 10px gap above handle
    
    // Adjust position to stay within viewport
    if (posX + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (posX < 10) {
      posX = 10;
    }
    
    // If menu would go above viewport, position below start handle instead
    if (posY < 10) {
      posY = startHandleRect.bottom + 10;
    }
    
    this.contextMenu.style.left = `${posX}px`;
    this.contextMenu.style.top = `${posY}px`;
    this.contextMenu.style.display = 'block';
  }
  
  /**
   * Hide context menu
   */
  hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.style.display = 'none';
    }
  }
  
  /**
   * Handle context menu action
   * @private
   */
  async _handleMenuAction(action) {
    switch (action) {
      case 'copy':
        await this._copySelection();
        // Reset selecting mode after copy
        this.touchState.isSelecting = false;
        break;
      case 'paste':
        await this._pasteFromClipboard();
        // Reset selecting mode after paste
        this.touchState.isSelecting = false;
        break;
      case 'clear':
        this.clearSelection(); // Already resets isSelecting
        break;
      case 'selectAll':
        this._selectAll();
        break;
    }
    
    this.hideContextMenu();
  }
  
  /**
   * Copy selection to clipboard
   * @private
   */
  async _copySelection() {
    if (!this.selection.text) return;
    
    try {
      await navigator.clipboard.writeText(this.selection.text);
      this.app.showToast('Copied to clipboard', 'success');
    } catch (err) {
      console.error('[MobileTerminal] Failed to copy:', err);
      this.app.showToast('Failed to copy', 'error');
    }
  }
  
  /**
   * Paste from clipboard
   * @private
   */
  async _pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this._pasteText(text);
    } catch (err) {
      console.error('[MobileTerminal] Failed to paste:', err);
      this.app.showToast('Failed to paste', 'error');
    }
  }
  
  /**
   * Paste text into terminal
   * @private
   */
  _pasteText(text) {
    if (!text) return;
    
    // Send paste to server
    const session = this.app.sessions.get(this.sessionId);
    if (session && session.socket && session.connected) {
      session.socket.emit('terminal:input', {
        sessionId: this.sessionId,
        data: text
      });
    }
    
    this.app.showToast('Pasted', 'success');
  }
  
  /**
   * Read clipboard content (pre-read for context menu)
   * @private
   */
  async _readClipboard() {
    try {
      this.app.terminalClipboardContent = await navigator.clipboard.readText();
    } catch (err) {
      // Clipboard read might fail due to permissions
      this.app.terminalClipboardContent = null;
    }
  }
  
  /**
   * Select all terminal content
   * @private
   */
  _selectAll() {
    const buffer = this.terminal.buffer.active;
    const maxY = buffer.length - 1;
    
    // Set selecting mode to prevent keyboard
    this.touchState.isSelecting = true;
    
    this.selection.start = { x: 0, y: 0 };
    this.selection.end = { x: this.terminal.cols - 1, y: maxY };
    this.selection.active = true;
    
    this._updateSelection();
  }
  
  /**
   * Clear selection
   */
  clearSelection() {
    this.selection.active = false;
    this.selection.start = null;
    this.selection.end = null;
    this.selection.text = '';
    
    // Reset selecting mode to allow keyboard input
    this.touchState.isSelecting = false;
    
    // Reset context menu positioning flag
    this.contextMenuUserPositioned = false;
    
    this._updateSelection();
  }
  
  /**
   * Focus hidden textarea for keyboard input
   * @private
   */
  _focusHiddenTextarea() {
    // Don't focus keyboard if we're in selection mode
    if (this.touchState.isSelecting) {
      return;
    }
    
    if (this.hiddenTextarea) {
      // Remove readonly to allow keyboard
      this.hiddenTextarea.removeAttribute('readonly');
      this.hiddenTextarea.focus();
    }
  }
  
  /**
   * Collapse keyboard by blurring hidden textarea
   * @private
   */
  _collapseKeyboard() {
    if (this.hiddenTextarea) {
      this.hiddenTextarea.blur();
      // Restore readonly to prevent keyboard on any accidental focus
      this.hiddenTextarea.setAttribute('readonly', 'true');
    }
  }
  
  /**
   * Send text to terminal
   * @private
   */
  _sendToTerminal(text) {
    const session = this.app.sessions.get(this.sessionId);
    if (session && session.socket && session.connected && session.isController) {
      session.socket.emit('terminal:input', {
        sessionId: this.sessionId,
        data: text
      });
    }
  }
  
  /**
   * Handle context menu event (right-click)
   * @private
   */
  _handleContextMenu(e) {
    if (!this.app.isMobile) return;
    
    e.preventDefault();
    
    const coords = this._screenToTerminalCoords(e.clientX, e.clientY);
    if (coords) {
      // If no selection, select word at position
      if (!this.selection.active) {
        const wordRange = this._getWordAtPosition(coords.x, coords.y);
        if (wordRange) {
          this.selection.start = wordRange.start;
          this.selection.end = wordRange.end;
          this.selection.active = true;
          this._updateSelection();
        }
      }
      
      this._showContextMenu(e.clientX, e.clientY);
    }
  }
  
  /**
   * Handle window resize
   * @private
   */
  _handleResize() {
    // Update selection overlay if active
    if (this.selection.active) {
      this._updateSelection();
    }
  }
  
  /**
   * Handle visual viewport changes (keyboard show/hide)
   * @private
   */
  _handleVisualViewport() {
    if (!window.visualViewport) return;
    
    const viewportHeight = window.visualViewport.height;
    const windowHeight = window.innerHeight;
    
    // Detect keyboard visibility
    const keyboardHeight = windowHeight - viewportHeight;
    const wasKeyboardVisible = this.viewport.isKeyboardVisible;
    this.viewport.isKeyboardVisible = keyboardHeight > 100; // Threshold for keyboard detection
    this.viewport.keyboardHeight = keyboardHeight;
    
    // Adjust terminal container if keyboard is visible
    if (this.viewport.isKeyboardVisible !== wasKeyboardVisible) {
      this._adjustForKeyboard();
    }
  }
  
  /**
   * Adjust terminal for virtual keyboard
   * @private
   */
  _adjustForKeyboard() {
    if (!this.terminalElement) return;
    
    if (this.viewport.isKeyboardVisible) {
      // Keyboard is visible - adjust viewport
      const availableHeight = window.visualViewport.height;
      this.terminalElement.style.height = `${availableHeight}px`;
      
      // Scroll terminal into view
      this.terminalElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Keyboard is hidden - restore original height
      this.terminalElement.style.height = '';
    }
    
    // Refit terminal
    if (this.session.fitAddon) {
      requestAnimationFrame(() => {
        try {
          this.session.fitAddon.fit();
        } catch (err) {
          console.warn('[MobileTerminal] Failed to fit terminal:', err);
        }
      });
    }
  }
  
  /**
   * Handle keydown events
   * @private
   */
  _handleKeyDown(e) {
    // Handle keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'c':
          if (this.selection.active) {
            e.preventDefault();
            this._copySelection();
          }
          break;
        case 'v':
          e.preventDefault();
          this._pasteFromClipboard();
          break;
        case 'a':
          e.preventDefault();
          this._selectAll();
          break;
      }
    }
  }
}

// Export for use in app.js
if (typeof window !== 'undefined') {
  window.MobileTerminalHandler = MobileTerminalHandler;
}