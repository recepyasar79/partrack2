import '@testing-library/jest-dom';
import { afterEach, beforeEach } from 'vitest';

function makeStorage() {
  let store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: makeStorage(), configurable: true });
  Object.defineProperty(window, 'sessionStorage', { value: makeStorage(), configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: window.localStorage, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: window.sessionStorage, configurable: true });
}

beforeEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});

afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
});
