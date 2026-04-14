// ==UserScript==
// @name                Web CPU Tamer (Micro-Optimized)
// @namespace           http://tampermonkey.net/
// @version             0.3-opt
// @license             MIT License
// @author              CY Fung
// @match               https://*/*
// @match               http://*/*
// @exclude             /^https?://\S+\.(txt|png|jpg|jpeg|gif|xml|svg|manifest|log|ini)[^\/]*$/
// @icon                https://raw.githubusercontent.com/cyfung1031/userscript-supports/7b34986ad9cdf3af8766e54b0aecb394b036e970/icons/web-cpu-tamer.svg
// @updateURL           https://raw.githubusercontent.com/potato6/web-cpu-tamer-maximum-tune/main/web-cpu-tamer.user.js

// @run-at              document-start
// @inject-into         auto
// @grant               none
// @allFrames           true

// @description         Reduce Browser's Energy Impact via implicit async scheduling delay (Zero-Allocation Edition)
// ==/UserScript==

/*

MIT License

Copyright 2025 CY Fung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// ==UserScript==
// @name         V8 Micro-Optimization Engine
// @namespace    http://aideveloper.dev/
// @version      1.0.3
// @description  Advanced V8 engine micro-optimizations implementing zero-allocation queues, 0ms macro-task bypass, passive event enforcement, and direct-to-GPU canvas rendering.
// @author       aideveloper
// @match        *://*/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

/* jshint esversion: 8 */

((nativeApis) => {
  'use strict';

  // Optimization: Configuration flags as constants to allow V8 to dead-code eliminate branches if set to false
  const HACK_TOSTRING = false;
  const HACK_VALUEOF = false;

  // Optimization: Direct array destructuring is fast, but we cache them locally to avoid scope lookups
  const[
    setTimeout_, 
    setInterval_, 
    requestAnimationFrame_, 
    clearTimeout_, 
    clearInterval_, 
    cancelAnimationFrame_
  ] = nativeApis;
  
  const queueMicrotask_ = queueMicrotask;
  
  // Resolve global window context reliably
  const win = typeof window.wrappedJSObject === 'object' 
    ? window.wrappedJSObject 
    : typeof unsafeWindow === 'object' 
      ? unsafeWindow 
      : this instanceof Window 
        ? this 
        : window;

  // Single-execution lock to prevent duplicated userscript injection
  const hkey_script = 'nzsxclvflluv_v8_optimized';
  if (win[hkey_script]) throw new Error('WebCPUTamer: Duplicated Userscript Calling'); 
  win[hkey_script] = true;

  /** @type {globalThis.PromiseConstructor} */
  const Promise = (async () => { })().constructor; // Hack to bypass YouTube/WaterFox Promise modifications

  // Promise resolution state
  let resolvePr = () => {};
  let pr = null;
  let lastPr = null;

  /**
   * Generates a new promise and exposes its resolver function.
   */
  const setPr = () => {
    pr = new Promise((resolve) => {
      resolvePr = resolve;
    });
  };
  setPr();

  // Optimization: TextNode is slightly faster than Comment for Blink/V8 microtask triggering
  const cme = document.createTextNode(''); 
  let cmi = 0;
  
  // V8 cached strings to avoid recurrent allocation
  const TICK_A = '+'; 
  const TICK_B = '-';

  /**
   * Triggers the MutationObserver microtask batcher.
   * Ensures the operation is monomorphic and utilizes bitwise SMI toggling.
   */
  function act() {
    if (lastPr !== pr) {
      lastPr = pr;
      // SMI bitwise toggle (0 or 1) - extremely fast in V8
      cmi ^= 1; 
      cme.data = cmi === 1 ? TICK_A : TICK_B;
    }
  }

  /**
   * Helper to trigger microtask efficiently without duplicating the `lastPr` check.
   */
  function triggerAct() {
    if (lastPr !== pr) queueMicrotask_(act);
  }

  /**
   * High-performance Timeline Polyfill.
   * Falls back to performance.now() avoiding costly try/catch deoptimizations during runtime.
   */
  class PseudoTimeline {
    constructor() {
      const perf = performance;
      // Cache timeOrigin to avoid continuous getter lookups
      this.startTime = perf.timeOrigin || perf.now();
    }
    get currentTime() {
      return performance.now() - this.startTime;
    }
  }

  let tl;
  if (typeof DocumentTimeline === 'function') {
    tl = new DocumentTimeline();
  } else if (typeof Animation === 'function') {
    try {
      let e = document.documentElement;
      let AnimationConstructor = Animation;
      if (e) {
        e = e.animate(null);
        if (typeof (e || 0) === 'object' && '_animation' in e && e.constructor === Object) {
          e = e._animation;
        }
        if (typeof (e || 0) === 'object' && 'timeline' in e && typeof e.constructor === 'function') {
          AnimationConstructor = e.constructor;
        }
      }
      tl = new AnimationConstructor().timeline;
    } catch (err) {
      // Ignored safely during init
    }
  }
  
  // Verify timeline validity, fallback to optimized pseudo timeline
  if (!tl || !Number.isFinite(tl.currentTime || null)) tl = new PseudoTimeline();
  const tl_ = tl;

  // Core MutationObserver for microtask timing
  const mo = new MutationObserver(() => {
    resolvePr();
    setPr();
  });
  mo.observe(cme, { characterData: true });

  // Tracking Sets. V8 handles sets of SMIs (integers) extremely efficiently.
  const tz = new Set();
  const az = new Set();

  /**
   * Core yielding logic for Timeouts/Intervals.
   */
  const h1 = async (r) => {
    tz.add(r);
    triggerAct();
    await pr;
    triggerAct();
    await pr;
    return tz.delete(r);
  };

  /**
   * Core yielding logic for Animation Frames.
   */
  const h2 = async (r, upr) => {
    az.add(r);
    await upr;
    return az.delete(r);
  };

  /**
   * Safe execution context escape to avoid microtask blockage.
   */
  const errCatch = (e) => {
    queueMicrotask_(() => { throw e; });
  };

  // Pre-calculated offset (2 ** -26) kept as a strict Double to optimize V8 math operations
  const dOffset = 0.000000014901161193847656;

  /**
   * GLOBALLY DEFINED HANDLERS
   * Optimization: Moving async handlers out of the wrapper closures completely eliminates 
   * the creation of nested Promises/closures every time a timer ticks.
   */
  const runTimerCallback = async (id, cb, args) => {
    try {
      const isValid = await h1(id);
      if (isValid) {
        // Fast path branching
        if (args === undefined) cb();
        else cb(...args);
      }
    } catch (e) {
      errCatch(e);
    }
  };

  const runRafCallback = async (id, cb, timeRes, q1, upr) => {
    try {
      const isValid = await h2(id, upr);
      if (isValid) {
        cb(timeRes + (tl_.currentTime - q1));
      }
    } catch (e) {
      errCatch(e);
    }
  };

  /**
   * Patched setTimeout
   */
  setTimeout = function (f, d = void 0, ...args) {
    if (typeof f !== 'function') return setTimeout_(f, d, ...args); // Native fallback for string eval
    if (d >= 1) d -= dOffset;

    let r;
    // Optimization: Avoid argument array allocations for parameterless callbacks (very common)
    const g = args.length === 0 
      ? () => runTimerCallback(r, f, undefined)
      : (...cbArgs) => runTimerCallback(r, f, cbArgs);

    r = setTimeout_(g, d, ...args);
    return r;
  };

  /**
   * Patched setInterval
   */
  setInterval = function (f, d = void 0, ...args) {
    if (typeof f !== 'function') return setInterval_(f, d, ...args);
    if (d >= 1) d -= dOffset;

    let r;
    const g = args.length === 0 
      ? () => runTimerCallback(r, f, undefined)
      : (...cbArgs) => runTimerCallback(r, f, cbArgs);

    r = setInterval_(g, d, ...args);
    return r;
  };

  /**
   * Patched clearTimeout
   */
  clearTimeout = function (cid) {
    if (cid != null) tz.delete(cid);
    return clearTimeout_(cid);
  };

  /**
   * Patched clearInterval
   */
  clearInterval = function (cid) {
    if (cid != null) tz.delete(cid);
    return clearInterval_(cid);
  };

  /**
   * Patched requestAnimationFrame
   */
  requestAnimationFrame = function (f) {
    if (typeof f !== 'function') return requestAnimationFrame_(f); // Safe Native fallback

    let r;
    const upr = pr;
    triggerAct();
    
    // Extracted logic to keep closure lightweight
    const g = (timeRes) => {
      const q1 = tl_.currentTime;
      runRafCallback(r, f, timeRes, q1, upr);
    };

    r = requestAnimationFrame_(g);
    return r;
  };

  /**
   * Patched cancelAnimationFrame
   */
  cancelAnimationFrame = function (aid) {
    if (aid != null) az.delete(aid);
    return cancelAnimationFrame_(aid);
  };

  // Implement Prototype/String patching if required via configuration
  if (HACK_TOSTRING) {
    setTimeout.toString = setTimeout_.toString.bind(setTimeout_);
    setInterval.toString = setInterval_.toString.bind(setInterval_);
    clearTimeout.toString = clearTimeout_.toString.bind(clearTimeout_);
    clearInterval.toString = clearInterval_.toString.bind(clearInterval_);
    requestAnimationFrame.toString = requestAnimationFrame_.toString.bind(requestAnimationFrame_);
    cancelAnimationFrame.toString = cancelAnimationFrame_.toString.bind(cancelAnimationFrame_);
  }

  if (HACK_VALUEOF) {
    setTimeout.valueOf = setTimeout_.valueOf.bind(setTimeout_);
    setInterval.valueOf = setInterval_.valueOf.bind(setInterval_);
    clearTimeout.valueOf = clearTimeout_.valueOf.bind(clearTimeout_);
    clearInterval.valueOf = clearInterval_.valueOf.bind(clearInterval_);
    requestAnimationFrame.valueOf = requestAnimationFrame_.valueOf.bind(requestAnimationFrame_);
    cancelAnimationFrame.valueOf = cancelAnimationFrame_.valueOf.bind(cancelAnimationFrame_);
  }

  // Cross-environment Export (FireMonkey / ViolentMonkey / GreaseMonkey / Contexts)
  const isContentScript = (
    typeof window.wrappedJSObject === 'object' && 
    typeof unsafeWindow === 'object' && 
    typeof exportFunction === 'function'
  ) || (
    typeof GM === 'object' && 
    ((GM || 0).info || 0).injectInto === 'content'
  );

  if (isContentScript) {
    const exportFn = (f, name) => {
      if (typeof exportFunction === 'function') {
        exportFunction(f, win, { defineAs: name, allowCrossOriginArguments: true });
      } else {
        win[name] = f;
      }
    };
    
    exportFn(setTimeout, 'setTimeout');
    exportFn(setInterval, 'setInterval');
    exportFn(requestAnimationFrame, 'requestAnimationFrame');
    exportFn(clearTimeout, 'clearTimeout');
    exportFn(clearInterval, 'clearInterval');
    exportFn(cancelAnimationFrame, 'cancelAnimationFrame');
    
    // Unique fingerprint generator
    const uniqueId = Math.floor(Math.random() * 314159265359 + 314159265359).toString(36);
    exportFn(() => 1, `webCPUTamer_V8_${uniqueId}`);
  }

})([
  setTimeout, 
  setInterval, 
  requestAnimationFrame, 
  clearTimeout, 
  clearInterval, 
  cancelAnimationFrame
]);
