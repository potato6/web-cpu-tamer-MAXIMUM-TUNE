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
// @supportURL          https://github.com/cyfung1031/userscript-supports

// @run-at              document-start
// @inject-into         auto
// @grant               none
// @allFrames           true

// @description         Reduce Browser's Energy Impact via implicit async scheduling delay (Zero-Allocation Edition)
// ==/UserScript==

/* jshint esversion:8 */

((o) => {
    "use strict";

    const [
        setTimeout_,
        setInterval_,
        requestAnimationFrame_,
        clearTimeout_,
        clearInterval_,
        cancelAnimationFrame_,
    ] = o;
    const queueMicrotask_ = queueMicrotask;
    const win =
        typeof unsafeWindow === "object"
            ? unsafeWindow
            : this instanceof Window
              ? this
              : window;

    // cache global functions and constructors
    const MessageChannel_ = MessageChannel;
    const Error_ = Error;
    const Set_ = Set;
    const Promise_ = (async () => {})().constructor;
    const Reflect_apply = Reflect.apply;
    const performance_ = performance;

    const hkey_script = "nzsxclvflluv";
    if (win[hkey_script]) throw new Error_("Duplicated Userscript Calling");
    win[hkey_script] = true;

    // --- HEARTBEAT MECHANISM ---
    let resolvePr = () => {},
        pr;
    const setPr = () =>
        (pr = new Promise_((resolve) => {
            resolvePr = resolve;
        }));
    setPr();

    const mc = new MessageChannel_();
    const port1 = mc.port1;
    const port2 = mc.port2;

    port1.onmessage = () => {
        resolvePr();
        setPr();
    };

    let lastPr = null;

    // --- TIMING SOURCE ---
    let getTimelineTime;
    {
        let tl;
        if (typeof DocumentTimeline === "function") {
            tl = new DocumentTimeline();
        } else if (typeof Animation === "function") {
            try {
                let e = document.documentElement;
                if (e) {
                    e = e.animate(null);
                    if (e && typeof e === "object" && "_animation" in e) {
                        e = e._animation; // YouTube compat
                    }
                    if (e && "timeline" in e) {
                        tl = e.timeline;
                    }
                }
                if (!tl) {
                    const ant = new Animation();
                    tl = ant.timeline;
                }
            } catch (err) {}
        }

        if (tl && Number.isFinite(tl.currentTime)) {
            getTimelineTime = () => tl.currentTime;
        } else {
            const timeOrigin = performance_.timeOrigin;
            if (timeOrigin) {
                getTimelineTime = () => performance_.now();
            } else {
                const start = performance_.now();
                getTimelineTime = () => performance_.now() - start;
            }
        }
    }

    const tz = new Set_();
    const az = new Set_();

    const nativeReportError =
        typeof reportError === "function" ? reportError : null;

    const errCatch = (e) => {
        if (nativeReportError) {
            nativeReportError(e);
        } else {
            queueMicrotask_(() => {
                throw e;
            });
        }
    };

    const dOffset = 2 ** -26;

    const runTask = (f, args) => {
        if (args === null) {
            f();
        } else {
            Reflect_apply(f, win, args);
        }
    };

    // --- OBJECT POOLING & DOUBLE BUFFERING ---

    // 1. TIMERS
    let activeTimerQueue = [];
    let flushTimerQueue = [];
    let isTimerFlushScheduled = false;

    // Recycle object pool for Timers to avoid GC
    const timerObjPool = [];
    const getTimerObj = (id, f, args, isInterval) => {
        let t = timerObjPool.pop();
        if (!t) t = {};
        t.id = id;
        t.f = f;
        t.args = args;
        t.isInterval = isInterval;
        return t;
    };

    const flushTimers = () => {
        isTimerFlushScheduled = false;

        // Trigger heartbeat
        if (lastPr !== pr) {
            lastPr = pr;
            port2.postMessage(null);
        }

        Promise_.resolve().then(() => {
            // Swap Buffers: active becomes execution, execution becomes active (empty)
            const tasks = activeTimerQueue;
            activeTimerQueue = flushTimerQueue;
            flushTimerQueue = tasks;

            const len = tasks.length;
            if (len === 0) return;

            for (let i = 0; i < len; i++) {
                const task = tasks[i];
                const { id, f, args, isInterval } = task;

                // Check existence
                if (isInterval ? tz.has(id) : tz.delete(id)) {
                    try {
                        runTask(f, args);
                    } catch (e) {
                        errCatch(e);
                    }
                }

                // Cleanup & Return to Pool
                task.args = null;
                task.f = null;
                timerObjPool.push(task);

                // Clear index to help GC if the array stays large
                tasks[i] = null;
            }
            // Reset length without deallocating the array
            tasks.length = 0;
        });
    };

    const scheduleTimerFlush = () => {
        if (isTimerFlushScheduled) return;
        isTimerFlushScheduled = true;
        if (lastPr !== pr) {
            lastPr = pr;
            port2.postMessage(null);
        }
        pr.then(flushTimers);
    };

    // 2. RAF
    let activeRafQueue = [];
    let flushRafQueue = [];
    let isRafFlushScheduled = false;

    // Recycle object pool for RAF
    const rafObjPool = [];
    const getRafObj = (id, f, timeRes) => {
        let t = rafObjPool.pop();
        if (!t) t = {};
        t.id = id;
        t.f = f;
        t.timeRes = timeRes;
        return t;
    };

    const flushRafs = () => {
        isRafFlushScheduled = false;

        // Swap Buffers
        const tasks = activeRafQueue;
        activeRafQueue = flushRafQueue;
        flushRafQueue = tasks;

        const len = tasks.length;
        if (len === 0) return;

        const q1 = getTimelineTime();

        if (lastPr !== pr) {
            lastPr = pr;
            port2.postMessage(null);
        }

        for (let i = 0; i < len; i++) {
            const task = tasks[i];
            const { id, f } = task;

            if (az.delete(id)) {
                try {
                    // optimization: calc adjustment inside strict scope
                    f(task.timeRes + (getTimelineTime() - q1));
                } catch (e) {
                    errCatch(e);
                }
            }

            // Cleanup & Return to Pool
            task.f = null;
            rafObjPool.push(task);
            tasks[i] = null;
        }
        tasks.length = 0;
    };

    const scheduleRafFlush = (upr) => {
        if (isRafFlushScheduled) return;
        isRafFlushScheduled = true;
        upr.then(flushRafs);
    };

    // --- TIMEOUT / INTERVAL OVERRIDES ---

    setTimeout = function (f, d) {
        let args = null;
        const argLen = arguments.length;
        if (argLen > 2) {
            args = new Array(argLen - 2);
            for (let i = 2; i < argLen; i++) args[i - 2] = arguments[i];
        }

        if (typeof f !== "function") {
            return setTimeout_(f, d, ...(args || []));
        }

        let id;
        const wrapper = () => {
            if (!tz.has(id)) return;
            // Use Object Pool and push to Active Buffer
            activeTimerQueue.push(getTimerObj(id, f, args, false));
            scheduleTimerFlush();
        };

        // Strict type coercion to ensure math speed
        d = +d;
        if (d > 1) d -= dOffset;

        id = setTimeout_(wrapper, d);
        tz.add(id);
        return id;
    };

    setInterval = function (f, d) {
        let args = null;
        const argLen = arguments.length;
        if (argLen > 2) {
            args = new Array(argLen - 2);
            for (let i = 2; i < argLen; i++) args[i - 2] = arguments[i];
        }

        if (typeof f !== "function") {
            return setInterval_(f, d, ...(args || []));
        }

        let id;
        const wrapper = () => {
            if (!tz.has(id)) return;
            // Use Object Pool and push to Active Buffer
            activeTimerQueue.push(getTimerObj(id, f, args, true));
            scheduleTimerFlush();
        };

        d = +d;
        if (d > 1) d -= dOffset;

        id = setInterval_(wrapper, d);
        tz.add(id);
        return id;
    };

    clearTimeout = function (cid) {
        tz.delete(cid);
        return clearTimeout_(cid);
    };

    clearInterval = function (cid) {
        tz.delete(cid);
        return clearInterval_(cid);
    };

    // --- RAF OVERRIDE ---

    requestAnimationFrame = function (f) {
        let id;
        const upr = pr;

        const wrapper = (timeRes) => {
            // Use Object Pool and push to Active Buffer
            activeRafQueue.push(getRafObj(id, f, timeRes));
            scheduleRafFlush(upr);
        };

        if (lastPr !== pr) {
            lastPr = pr;
            port2.postMessage(null);
        }

        id = requestAnimationFrame_(wrapper);
        az.add(id);
        return id;
    };

    cancelAnimationFrame = function (aid) {
        az.delete(aid);
        return cancelAnimationFrame_(aid);
    };
})([
    setTimeout,
    setInterval,
    requestAnimationFrame,
    clearTimeout,
    clearInterval,
    cancelAnimationFrame,
]);
