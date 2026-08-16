/**
 * CropTop Document State Management
 * Handles non-destructive editing state including base image, color parameters, crop, objects, and history.
 */

class CropTopState {
  constructor() {
    this.history = [];
    this.historyIndex = -1;
    this.MAX_HISTORY = 50;

    // Current Document State
    this.doc = this.createDefaultDoc();
  }

  createDefaultDoc() {
    return {
      fileName: 'Untitled Image',
      imageLoaded: false,
      colorParams: this.getDefaultColorParams(),
      crop: null, // {x, y, width, height} in image space
      objects: [], // Array of text/shape elements
      aiMasks: [],
      activeTool: 'ADJUST', // SELECT, CROP, BRUSH, PROTECT, ADJUST, FILTERS, LUTS, FRAME, TEXT, SHAPES
    };
  }

  getDefaultColorParams() {
    // Should match the default params from AIGrader / app.js
    return {
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0,
      saturation: 0,
      skyBoost: 0,
      grassBoost: 0,
      subjectBoost: 0,
      maskExposure: 0,
      maskSaturation: 0,
      maskTemp: 0,
      maskContrast: 0,
      vignette: 0,
      grain: 0,
      clarity: 0
    };
  }

  // Clones a document object for history stack
  cloneDoc(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  pushHistory(actionName) {
    // If we're not at the end of history, truncate the future
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push({
      actionName,
      state: this.cloneDoc(this.doc)
    });

    if (this.history.length > this.MAX_HISTORY) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }

    this.notifyHistoryChange();
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.doc = this.cloneDoc(this.history[this.historyIndex].state);
      this.notifyHistoryChange();
      return true;
    }
    return false;
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.doc = this.cloneDoc(this.history[this.historyIndex].state);
      this.notifyHistoryChange();
      return true;
    }
    return false;
  }

  notifyHistoryChange() {
    // Dispatch custom event that app.js can listen to
    window.dispatchEvent(new CustomEvent('croptop-history-changed', {
      detail: {
        history: this.history,
        currentIndex: this.historyIndex,
        doc: this.doc
      }
    }));
  }
}

// Global instance
window.CropTop = new CropTopState();
