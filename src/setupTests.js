// vitest-dom adds custom vitest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';
import { vi, beforeEach, afterEach } from 'vitest';

// Node.js 25 ships a built-in localStorage stub that lacks setItem/getItem/clear.
// Install a fully-functional in-memory replacement so all tests can use the Web
// Storage API as they would in a real browser (jsdom environment).
(function installWebStorage() {
  function makeStorage() {
    let store = Object.create(null);
    return {
      get length() { return Object.keys(store).length; },
      key(n) { return Object.keys(store)[n] ?? null; },
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[String(k)] = String(v); },
      removeItem(k) { delete store[String(k)]; },
      clear() { store = Object.create(null); },
    };
  }
  const ls = makeStorage();
  const ss = makeStorage();
  // Overwrite both the global and window references so any access path works.
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true });
  } catch (_) { /* already defined non-configurable — leave it */ }
  if (typeof window !== 'undefined') {
    try {
      Object.defineProperty(window, 'localStorage', { value: ls, configurable: true, writable: true });
      Object.defineProperty(window, 'sessionStorage', { value: ss, configurable: true, writable: true });
    } catch (_) { /* already non-configurable */ }
  }
}());

// Mock IntersectionObserver for components that use it
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock ResizeObserver for components that use it
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Comprehensive window object mock for browser APIs in Electron apps
if (typeof global.window === 'undefined') {
  global.window = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    location: {
      href: 'http://localhost:3000',
      origin: 'http://localhost:3000',
      pathname: '/',
      search: '',
      hash: ''
    },
    history: {
      pushState: vi.fn(),
      replaceState: vi.fn(),
      back: vi.fn(),
      forward: vi.fn()
    },
    document: global.document,
    getComputedStyle: vi.fn(() => ({
      getPropertyValue: vi.fn(() => ''),
    })),
    requestAnimationFrame: vi.fn((cb) => setTimeout(cb, 0)),
    cancelAnimationFrame: vi.fn((id) => clearTimeout(id)),
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
    console: global.console,
    performance: {
      now: vi.fn(() => Date.now()),
      mark: vi.fn(),
      measure: vi.fn(),
      getEntriesByType: vi.fn(() => []),
      getEntriesByName: vi.fn(() => []),
      clearMarks: vi.fn(),
      clearMeasures: vi.fn()
    }
  };
} else {
  // Ensure existing window has all necessary properties
  global.window.addEventListener = global.window.addEventListener || vi.fn();
  global.window.removeEventListener = global.window.removeEventListener || vi.fn();
  global.window.dispatchEvent = global.window.dispatchEvent || vi.fn();
  global.window.requestAnimationFrame = global.window.requestAnimationFrame || vi.fn((cb) => setTimeout(cb, 0));
  global.window.cancelAnimationFrame = global.window.cancelAnimationFrame || vi.fn((id) => clearTimeout(id));
  global.window.getComputedStyle = global.window.getComputedStyle || vi.fn(() => ({
    getPropertyValue: vi.fn(() => ''),
  }));
  global.window.performance = global.window.performance || {
    now: vi.fn(() => Date.now()),
    mark: vi.fn(),
    measure: vi.fn(),
    getEntriesByType: vi.fn(() => []),
    getEntriesByName: vi.fn(() => []),
    clearMarks: vi.fn(),
    clearMeasures: vi.fn()
  };
}

// Mock document if not available
if (typeof global.document === 'undefined') {
  global.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    createElement: vi.fn(() => ({
      setAttribute: vi.fn(),
      getAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      click: vi.fn(),
      href: '',
      download: ''
    })),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn()
    }
  };
  
  // Create document.hidden as a configurable property
  Object.defineProperty(global.document, 'hidden', {
    value: false,
    writable: true,
    configurable: true
  });
  
  Object.defineProperty(global.document, 'visibilityState', {
    value: 'visible',
    writable: true,
    configurable: true
  });
} else {
  global.document.addEventListener = global.document.addEventListener || vi.fn();
  global.document.removeEventListener = global.document.removeEventListener || vi.fn();
  global.document.dispatchEvent = global.document.dispatchEvent || vi.fn();
  
  // If document exists but doesn't have configurable hidden property, try to add it
  if (!global.document.hasOwnProperty('hidden') || !Object.getOwnPropertyDescriptor(global.document, 'hidden')?.configurable) {
    try {
      Object.defineProperty(global.document, 'hidden', {
        value: false,
        writable: true,
        configurable: true
      });
    } catch (e) {
      console.log('Could not override document.hidden property');
    }
  }
  
  if (!global.document.hasOwnProperty('visibilityState') || !Object.getOwnPropertyDescriptor(global.document, 'visibilityState')?.configurable) {
    try {
      Object.defineProperty(global.document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true
      });
    } catch (e) {
      console.log('Could not override document.visibilityState property');
    }
  }
}

// Mock process for Node.js environment detection
if (typeof global.process === 'undefined') {
  global.process = {
    platform: 'test',
    env: {
      NODE_ENV: 'test'
    }
  };
}

// Mock Electron API with proper cleanup tracking
const createMockElectronAPI = () => ({
  getFlashPathData: vi.fn().mockResolvedValue({
    current_used_paths: {},
    saved_paths: [],
    certificate_folder_path: ''
  }),
  updateFlashPathData: vi.fn().mockResolvedValue({ success: true }),
  selectFile: vi.fn().mockResolvedValue(null),
  selectDirectory: vi.fn().mockResolvedValue(null),
  onConfigUpdated: vi.fn(),
  removeConfigListener: vi.fn(),
  runCommandWithRealTimeOutput: vi.fn().mockRejectedValue(new Error('not ported')),
  runProgramWithRealTimeOutput: vi.fn().mockRejectedValue(new Error('not ported')),
  runK6WithRealTimeOutput: vi.fn().mockResolvedValue(0),
  stopCommand: vi.fn().mockResolvedValue(),
  loadConfig: vi.fn().mockResolvedValue({}),
  saveConfig: vi.fn().mockResolvedValue({ success: true }),
  getSelectedCertificate: vi.fn().mockResolvedValue(null),
  scanCredentials: vi.fn().mockResolvedValue([]),
  loadUserData: vi.fn().mockResolvedValue({}),
  saveUserData: vi.fn().mockResolvedValue({ success: true }),
  readDirectory: vi.fn().mockResolvedValue([]),
  readFileContent: vi.fn().mockResolvedValue(''),
  findHexFile: vi.fn().mockResolvedValue(''),
  getCredentialsPath: vi.fn().mockResolvedValue(''),
  closeWindow: vi.fn(),
  quitApp: vi.fn(),
  minimizeWindow: vi.fn(),
  maximizeWindow: vi.fn()
});

// Global cleanup tracking
const timeouts = new Set();
const intervals = new Set();
const eventListeners = new Map();

// Override setTimeout/setInterval to track them
const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

global.setTimeout = (...args) => {
  const id = originalSetTimeout(...args);
  timeouts.add(id);
  return id;
};

global.setInterval = (...args) => {
  const id = originalSetInterval(...args);
  intervals.add(id);
  return id;
};

global.clearTimeout = (id) => {
  timeouts.delete(id);
  return originalClearTimeout(id);
};

global.clearInterval = (id) => {
  intervals.delete(id);
  return originalClearInterval(id);
};

// Track event listeners
const originalAddEventListener = global.window.addEventListener;
const originalRemoveEventListener = global.window.removeEventListener;

global.window.addEventListener = (event, handler, options) => {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event).add(handler);
  return originalAddEventListener.call(global.window, event, handler, options);
};

global.window.removeEventListener = (event, handler, options) => {
  if (eventListeners.has(event)) {
    eventListeners.get(event).delete(handler);
  }
  return originalRemoveEventListener.call(global.window, event, handler, options);
};

// Setup and cleanup for each test
beforeEach(() => {
  // Reset window.electronAPI for each test
  global.window.electronAPI = createMockElectronAPI();

  // Reset the shared in-memory localStorage so no state bleeds between tests
  // (the shim above is a single instance for the worker). No-op for files that
  // reinstall their own storage in beforeEach.
  try { localStorage.clear(); } catch (e) { /* storage unavailable — ignore */ }

  // Clear all timers and event listeners
  timeouts.clear();
  intervals.clear();
  eventListeners.clear();
  
  // Reset document state safely
  try {
    if (Object.getOwnPropertyDescriptor(global.document, 'hidden')?.writable) {
      global.document.hidden = false;
    }
    if (Object.getOwnPropertyDescriptor(global.document, 'visibilityState')?.writable) {
      global.document.visibilityState = 'visible';
    }
  } catch (e) {
    // If we can't set the properties, that's fine for tests
  }
  
  // Reset all mocks
  vi.clearAllMocks();
});

afterEach(() => {
  // Clean up all pending timers
  timeouts.forEach(id => originalClearTimeout(id));
  intervals.forEach(id => originalClearInterval(id));
  timeouts.clear();
  intervals.clear();
  
  // Clean up event listeners
  eventListeners.forEach((handlers, event) => {
    handlers.forEach(handler => {
      global.window.removeEventListener(event, handler);
    });
  });
  eventListeners.clear();
  
  // Reset mocks
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Mock CSS imports for tests - simplified approach with identity-obj-proxy handling most cases
// Only mock the specific problematic CSS file
vi.mock('@mui/x-data-grid/esm/index.css', () => ({
  default: {}
}));

// Mock any other CSS files that might cause issues
vi.mock('*.css', () => ({
  default: {}
}));
