// Minimal URL and abort primitives for native SDK packages; URL algorithms are Rust.
(function () {
  'use strict';
  const paramsState = new WeakMap(), urlState = new WeakMap();
  function notify(params) {
    const state = paramsState.get(params);
    if (state.changed) state.changed(params.toString());
  }
  class URLSearchParams {
    constructor(input = '') {
      let pairs;
      if (input != null && typeof input !== 'string' && typeof input[Symbol.iterator] === 'function') {
        pairs = Array.from(input, pair => {
          if (pair == null || typeof pair[Symbol.iterator] !== 'function') throw new TypeError('Invalid query pair');
          const values = Array.from(pair);
          if (values.length !== 2) throw new TypeError('Invalid query pair');
          return values.map(String);
        });
      } else if (input != null && typeof input === 'object') {
        pairs = Object.entries(input).map(([k,v]) => [k,String(v)]);
      } else {
        pairs = JSON.parse(__baka.form_parse(input == null ? '' : String(input).replace(/^\?/, '')));
      }
      paramsState.set(this, {pairs, changed:null});
    }
    get size() { return paramsState.get(this).pairs.length; }
    append(name,value) { paramsState.get(this).pairs.push([String(name),String(value)]); notify(this); }
    set(name,value) {
      name = String(name); value = String(value);
      const state = paramsState.get(this); let found = false;
      state.pairs = state.pairs.filter(pair => {
        if (pair[0] !== name) return true;
        if (found) return false;
        pair[1] = value; found = true; return true;
      });
      if (!found) state.pairs.push([name,value]);
      notify(this);
    }
    get(name) { const pair = paramsState.get(this).pairs.find(p => p[0] === String(name)); return pair ? pair[1] : null; }
    getAll(name) { return paramsState.get(this).pairs.filter(p => p[0] === String(name)).map(p => p[1]); }
    has(name,value) { return paramsState.get(this).pairs.some(p => p[0] === String(name) && (value === undefined || p[1] === String(value))); }
    delete(name,value) {
      const state = paramsState.get(this);
      state.pairs = state.pairs.filter(p => p[0] !== String(name) || (value !== undefined && p[1] !== String(value)));
      notify(this);
    }
    sort() { paramsState.get(this).pairs.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); notify(this); }
    *entries() { for (let i = 0; i < this.size; i++) yield [...paramsState.get(this).pairs[i]]; }
    *keys() { for (const [key] of this) yield key; }
    *values() { for (const [,value] of this) yield value; }
    [Symbol.iterator]() { return this.entries(); }
    forEach(callback,thisArg) { for (const [key,value] of this) callback.call(thisArg,value,key,this); }
    toString() { return __baka.form_encode(JSON.stringify(paramsState.get(this).pairs)); }
  }
  class URL {
    constructor(input,base) {
      const fields = JSON.parse(__baka.url(String(input),base === undefined ? undefined : String(base),undefined,undefined));
      const params = new URLSearchParams(fields.search);
      urlState.set(this,{fields,params});
      paramsState.get(params).changed = value => { this.search = value; };
    }
    get searchParams() { return urlState.get(this).params; }
    get origin() { return urlState.get(this).fields.origin; }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static canParse(input,base) { try { new URL(input,base); return true; } catch (_) { return false; } }
    static parse(input,base) { try { return new URL(input,base); } catch (_) { return null; } }
  }
  for (const key of ['href','protocol','username','password','host','hostname','port','pathname','search','hash']) {
    Object.defineProperty(URL.prototype,key,{
      enumerable:true, configurable:true,
      get() { return urlState.get(this).fields[key]; },
      set(value) {
        const state = urlState.get(this);
        state.fields = JSON.parse(__baka.url(state.fields.href,undefined,key,String(value)));
        // Preserve searchParams identity when href or search is reassigned.
        paramsState.get(state.params).pairs = JSON.parse(__baka.form_parse(state.fields.search.replace(/^\?/,'')));
      }
    });
  }
  const signalState = new WeakMap();
  function abortError(name,message) { const error = new Error(message); error.name = name; return error; }
  function abort(signal,reason) {
    const state = signalState.get(signal);
    if (state.aborted) return;
    state.aborted = true;
    state.reason = reason === undefined ? abortError('AbortError','This operation was aborted') : reason;
    const event = {type:'abort',target:signal,currentTarget:signal};
    const listeners = [...state.listeners];
    for (const item of listeners) {
      if (!state.listeners.includes(item)) continue;
      if (item.once) signal.removeEventListener('abort',item.listener);
      try {
        if (typeof item.listener === 'function') item.listener.call(signal,event);
        else item.listener.handleEvent(event);
      } catch (error) { console.error('Abort listener failed:',error.message); }
    }
  }
  class AbortSignal {
    constructor(token) {
      if (token !== signalState) throw new TypeError('Illegal constructor');
      signalState.set(this,{aborted:false,reason:undefined,listeners:[],onabort:null,onabortListener:null});
    }
    get aborted() { return signalState.get(this).aborted; }
    get reason() { return signalState.get(this).reason; }
    get onabort() { return signalState.get(this).onabort; }
    set onabort(callback) {
      const state = signalState.get(this);
      state.onabort = typeof callback === 'function' ? callback : null;
      if (state.onabort && !state.onabortListener) {
        state.onabortListener = event => state.onabort.call(this,event);
        this.addEventListener('abort',state.onabortListener);
      } else if (!state.onabort && state.onabortListener) {
        this.removeEventListener('abort',state.onabortListener);
        state.onabortListener = null;
      }
    }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    addEventListener(type,listener,options) {
      if (type !== 'abort' || listener == null) return;
      if (typeof listener !== 'function' && typeof listener !== 'object') throw new TypeError('Invalid event listener');
      const listeners = signalState.get(this).listeners;
      if (!listeners.some(v => v.listener === listener)) listeners.push({listener,once:!!(options && options.once)});
    }
    removeEventListener(type,listener) {
      if (type === 'abort') signalState.get(this).listeners = signalState.get(this).listeners.filter(v => v.listener !== listener);
    }
    static abort(reason) { const signal = new AbortSignal(signalState); abort(signal,reason); return signal; }
    static timeout(ms) {
      if (!Number.isInteger(ms) || ms < 0 || ms > 2147483647) throw new RangeError('Invalid timeout');
      const signal = new AbortSignal(signalState);
      setTimeout(() => abort(signal,abortError('TimeoutError','The operation was aborted due to timeout')),ms);
      return signal;
    }
  }
  const controllerState = new WeakMap();
  class AbortController {
    constructor() { controllerState.set(this,new AbortSignal(signalState)); }
    get signal() { return controllerState.get(this); }
    abort(reason) { abort(this.signal,reason); }
  }
  globalThis.URL = URL;
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.AbortController = AbortController;
  globalThis.AbortSignal = AbortSignal;
})();
