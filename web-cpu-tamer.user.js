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

/* jshint esversion: 11 */

((globalObject) => {
    "use strict";

    // ========================================================================
    // 1. ENGINE REFERENCE CACHING (BYPASS PROTOTYPE CHAIN)
    // ========================================================================
    const win = typeof unsafeWindow === "object" && unsafeWindow !== null ? unsafeWindow : globalObject;
    
    const HKEY = "_aideveloper_v8_opt_v3";
    if (win[HKEY]) return;
    win[HKEY] = true;

    // Cache unadulterated native functions
    const N_setTimeout = win.setTimeout;
    const N_clearTimeout = win.clearTimeout;
    const N_setInterval = win.setInterval;
    const N_clearInterval = win.clearInterval;
    const N_requestAnimationFrame = win.requestAnimationFrame;
    const N_cancelAnimationFrame = win.cancelAnimationFrame;
    const N_addEventListener = win.EventTarget.prototype.addEventListener;
    const N_getContext = win.HTMLCanvasElement.prototype.getContext;
    
    // Performance timer
    const perf = win.performance;
    const N_now = (perf && perf.now) ? perf.now.bind(perf) : win.Date.now;

    // Error handling - Queue to microtask to prevent pausing the optimization loop
    const throwErr = (e) => queueMicrotask(() => { throw e; });

    // ========================================================================
    // 2. ZERO-ALLOCATION DOUBLE-BUFFERED QUEUES (V8 DENSE ARRAYS)
    // ========================================================================
    // V8 optimizes Arrays with contiguous indices. We avoid `push`, `pop`, 
    // and `...args` to prevent heap allocations and GC pauses.
    const QUEUE_SIZE = 16384; 

    // Timer Queues
    let tqActive = new Array(QUEUE_SIZE);
    let tqFlush  = new Array(QUEUE_SIZE);
    let tqActiveLen = 0;
    
    // 0ms Bypass Queues
    let zqActive = new Array(QUEUE_SIZE);
    let zqFlush  = new Array(QUEUE_SIZE);
    let zqActiveLen = 0;

    // RAF Queues
    let rqActive = new Array(QUEUE_SIZE);
    let rqFlush  = new Array(QUEUE_SIZE);
    let rqActiveLen = 0;

    // Pre-shape queue objects to guarantee Monomorphic Hidden Classes in V8
    for (let i = 0; i < QUEUE_SIZE; i++) {
        tqActive[i] = { id: 0, f: null, a: null, b: null, c: null, d: null, argsLen: 0, isInt: false };
        tqFlush[i]  = { id: 0, f: null, a: null, b: null, c: null, d: null, argsLen: 0, isInt: false };
        zqActive[i] = { id: 0, f: null, a: null, b: null, c: null, d: null, argsLen: 0, isInt: false };
        zqFlush[i]  = { id: 0, f: null, a: null, b: null, c: null, d: null, argsLen: 0, isInt: false };
        rqActive[i] = { id: 0, f: null };
        rqFlush[i]  = { id: 0, f: null };
    }

    // State Tracking: V8 Dictionary Mode (highly optimized for SMI keys)
    const activeStates = Object.create(null);

    // ========================================================================
    // 3. FAST-PATH EXECUTION ENGINE (SWITCH STATEMENT OPTIMIZATION)
    // ========================================================================
    // Avoids `Function.prototype.apply` overhead for common argument lengths.
    const executeTask = (task, timestamp = null) => {
        const f = task.f;
        if (!f) return;
        
        try {
            if (timestamp !== null) {
                f(timestamp);
            } else {
                switch (task.argsLen) {
                    case 0: f(); break;
                    case 1: f(task.a); break;
                    case 2: f(task.a, task.b); break;
                    case 3: f(task.a, task.b, task.c); break;
                    case 4: f(task.a, task.b, task.c, task.d); break;
                }
            }
        } catch (e) {
            throwErr(e);
        } finally {
            // Nullify references to allow Garbage Collection of user variables
            task.f = null;
            task.a = null;
            task.b = null;
            task.c = null;
            task.d = null;
        }
    };

    // ========================================================================
    // 4. THE 0MS MACRO-TASK BYPASS (MESSAGECHANNEL)
    // ========================================================================
    const mc = new MessageChannel();
    let isZeroDelayScheduled = false;

    mc.port1.onmessage = () => {
        isZeroDelayScheduled = false;
        if (zqActiveLen === 0) return;

        // Buffer Swap
        const tasks = zqActive;
        const len = zqActiveLen;
        zqActive = zqFlush;
        zqFlush = tasks;
        zqActiveLen = 0;

        for (let i = 0; i < len; i++) {
            const task = tasks[i];
            if (activeStates[task.id] === 1) {
                activeStates[task.id] = 0; // 0ms is always a one-off (timeout)
                executeTask(task);
            } else {
                // Clean up aborted tasks
                task.f = null; task.a = null; task.b = null; task.c = null; task.d = null;
            }
        }
    };

    // ========================================================================
    // 5. PHASE-ACCURATE RAF AND TIMER FLUSHERS
    // ========================================================================
    let isTimerFlushScheduled = false;
    let isRafFlushScheduled = false;

    const flushTimers = () => {
        isTimerFlushScheduled = false;
        
        if (tqActiveLen === 0) return;

        const tasks = tqActive;
        const len = tqActiveLen;
        tqActive = tqFlush;
        tqFlush = tasks;
        tqActiveLen = 0;

        for (let i = 0; i < len; i++) {
            const task = tasks[i];
            if (activeStates[task.id] === 1) {
                if (!task.isInt) {
                    activeStates[task.id] = 0; // Clear timeout state
                }
                executeTask(task);
            } else {
                task.f = null; task.a = null; task.b = null; task.c = null; task.d = null;
            }
        }
    };

    const flushRafs = (timestamp) => {
        isRafFlushScheduled = false;

        if (rqActiveLen === 0) return;

        const tasks = rqActive;
        const len = rqActiveLen;
        rqActive = rqFlush;
        rqFlush = tasks;
        rqActiveLen = 0;

        for (let i = 0; i < len; i++) {
            const task = tasks[i];
            if (activeStates[task.id] === 1) {
                activeStates[task.id] = 0; // RAF is one-off
                executeTask(task, timestamp);
            } else {
                task.f = null;
            }
        }
    };

    // ========================================================================
    // 6. TIMER OVERRIDES (EXPLICIT ARGUMENTS, NO ARRAY ALLOCATIONS)
    // ========================================================================
    let customIdCounter = -2147483648; // Safe 32-bit SMI integer space

    win.setTimeout = function (f, delay, a, b, c, d) {
        if (typeof f !== "function") return N_setTimeout.apply(win, arguments);

        delay = Number(delay) || 0;
        const argsLen = arguments.length > 2 ? arguments.length - 2 : 0;

        // Bypassing 4ms clamp for instantaneous DOM manipulation
        if (delay <= 0) {
            const id = customIdCounter++;
            activeStates[id] = 1;

            if (zqActiveLen < QUEUE_SIZE) {
                const task = zqActive[zqActiveLen++];
                task.id = id; task.f = f; task.isInt = false; task.argsLen = argsLen;
                if (argsLen > 0) { task.a = a; task.b = b; task.c = c; task.d = d; }
            }

            if (!isZeroDelayScheduled) {
                isZeroDelayScheduled = true;
                mc.port2.postMessage(0);
            }
            return id;
        }

        let id;
        const wrapper = () => {
            if (activeStates[id] !== 1) return;
            if (tqActiveLen < QUEUE_SIZE) {
                const task = tqActive[tqActiveLen++];
                task.id = id; task.f = f; task.isInt = false; task.argsLen = argsLen;
                if (argsLen > 0) { task.a = a; task.b = b; task.c = c; task.d = d; }
            }
            if (!isTimerFlushScheduled) {
                isTimerFlushScheduled = true;
                queueMicrotask(flushTimers);
            }
        };

        id = N_setTimeout(wrapper, delay);
        activeStates[id] = 1;
        return id;
    };

    win.setInterval = function (f, delay, a, b, c, d) {
        if (typeof f !== "function") return N_setInterval.apply(win, arguments);

        delay = Number(delay) || 0;
        const argsLen = arguments.length > 2 ? arguments.length - 2 : 0;

        let id;
        const wrapper = () => {
            if (activeStates[id] !== 1) return;
            if (tqActiveLen < QUEUE_SIZE) {
                const task = tqActive[tqActiveLen++];
                task.id = id; task.f = f; task.isInt = true; task.argsLen = argsLen;
                if (argsLen > 0) { task.a = a; task.b = b; task.c = c; task.d = d; }
            }
            if (!isTimerFlushScheduled) {
                isTimerFlushScheduled = true;
                queueMicrotask(flushTimers);
            }
        };

        id = N_setInterval(wrapper, delay);
        activeStates[id] = 1;
        return id;
    };

    win.clearTimeout = function (id) {
        if (id == null) return;
        activeStates[id] = 0;
        if (id > 0) N_clearTimeout(id); // Only pass native IDs to native clearer
    };

    win.clearInterval = function (id) {
        if (id == null) return;
        activeStates[id] = 0;
        if (id > 0) N_clearInterval(id);
    };

    // ========================================================================
    // 7. ANIMATION FRAME (SYNCHRONOUS VSYNC ALIGNMENT)
    // ========================================================================
    win.requestAnimationFrame = function (f) {
        if (typeof f !== "function") return N_requestAnimationFrame.apply(win, arguments);

        let id;
        const wrapper = (timestamp) => {
            if (activeStates[id] !== 1) return;
            
            if (rqActiveLen < QUEUE_SIZE) {
                const task = rqActive[rqActiveLen++];
                task.id = id;
                task.f = f;
            }

            if (!isRafFlushScheduled) {
                isRafFlushScheduled = true;
                // EXECUTED SYNCHRONOUSLY inside the native RAF task.
                // Prevents VSync tearing and 1-frame jank present in V2.
                flushRafs(timestamp);
            }
        };

        id = N_requestAnimationFrame(wrapper);
        activeStates[id] = 1;
        return id;
    };

    win.cancelAnimationFrame = function (id) {
        if (id == null) return;
        activeStates[id] = 0;
        N_cancelAnimationFrame(id);
    };

    // ========================================================================
    // 8. CHROMIUM EVENT COMPOSITOR OPTIMIZATION
    // ========================================================================
    // Prevent UI thread blocking without mutating read-only objects.
    const PASSIVE_EVENTS = { 'wheel': 1, 'mousewheel': 1, 'touchstart': 1, 'touchmove': 1 };

    win.EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (PASSIVE_EVENTS[type] === 1) {
            if (options === undefined || options === null) {
                options = { passive: true };
            } else if (typeof options === 'boolean') {
                options = { capture: options, passive: true };
            } else if (typeof options === 'object' && !options.passive) {
                // Reconstruct to avoid mutating potentially frozen user objects
                options = { ...options, passive: true };
            }
        }
        return N_addEventListener.call(this, type, listener, options);
    };

    // ========================================================================
    // 9. OPENGL / WEBL DIRECT-TO-GPU OPTIMIZATIONS
    // ========================================================================
    // Instructs Chromium to use the high-performance discrete GPU backend, 
    // and bypass the HTML compositor synchronization via `desynchronized`.
    win.HTMLCanvasElement.prototype.getContext = function (contextType, contextAttributes) {
        const isGL = contextType === 'webgl' || contextType === 'webgl2' || contextType === 'experimental-webgl';
        const is2D = contextType === '2d';

        if (isGL || is2D) {
            if (contextAttributes === undefined || contextAttributes === null) {
                contextAttributes = {};
            } else if (typeof contextAttributes !== 'object') {
                contextAttributes = {};
            } else {
                // Clone to prevent mutating application state
                contextAttributes = { ...contextAttributes };
            }

            // Desynchronized streams pixels directly to display (bypasses Blink compositor latency)
            if (!('desynchronized' in contextAttributes)) {
                contextAttributes.desynchronized = true;
            }

            // Force Dedicated Graphics Card on multi-GPU setups (Massive WebGL boost)
            if (isGL && !('powerPreference' in contextAttributes)) {
                contextAttributes.powerPreference = "high-performance";
            }
        }

        return N_getContext.call(this, contextType, contextAttributes);
    };

})(this);
