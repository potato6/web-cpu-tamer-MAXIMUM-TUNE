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

/* jshint esversion:8 */

((o) => {
    "use strict";

    // --- cached native references (immutable shapes help the engine) ---
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

    const MessageChannel_ = MessageChannel;
    const Error_ = Error;
    const Promise_ = (async () => { })().constructor;
    const performance_ = performance;
    const DocumentTimeline_ = typeof DocumentTimeline === "function" ? DocumentTimeline : null;

    // --- single-key guard to avoid duplicate injections ---
    const HKEY = "nzsxclvflluv";
    if (win[HKEY]) throw new Error_("Duplicated Userscript Calling");
    win[HKEY] = true;

    // --- heartbeat (message-channel) ---
    let resolvePr = () => { };
    let pr;
    const setPr = () => {
        pr = new Promise_((resolve) => {
            resolvePr = resolve;
        });
    };
    setPr();

    const mc = new MessageChannel_();
    const port1 = mc.port1;
    const port2 = mc.port2;

    port1.onmessage = () => {
        resolvePr();
        setPr();
    };

    let lastPr = null;
    const poke = () => {
        if (lastPr !== pr) {
            lastPr = pr;
            port2.postMessage(0);
        }
    };

    // --- timing source (cache a getter) ---
    let getTimelineTime;
    {
        let tl = null;
        try {
            if (DocumentTimeline_) {
                tl = new DocumentTimeline_();
            } else if (typeof Animation === "function") {
                // try animation timeline fallbacks
                let e = document.documentElement;
                if (e) {
                    const anim = e.animate ? e.animate(null) : null;
                    if (anim && "_animation" in anim) {
                        // some sites expose a wrapped animation object
                        tl = anim._animation && anim._animation.timeline;
                    } else if (anim && "timeline" in anim) {
                        tl = anim.timeline;
                    }
                }
                if (!tl) {
                    const ant = new Animation();
                    tl = ant && ant.timeline;
                }
            }
        } catch (err) {
            tl = null;
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

    // --- use plain object maps for fast numeric-keyed sets/maps (V8-optimized) ---
    // Values: 1 = active, 0 = removed (avoids frequent delete)
    const tzMap = Object.create(null); // timers map (id -> 1/0)
    const azMap = Object.create(null); // raf map (id -> 1/0)

    const tzAdd = (id) => { tzMap[id] = 1; };
    const tzHas = (id) => tzMap[id] === 1;
    const tzDelete = (id) => { tzMap[id] = 0; };

    const azAdd = (id) => { azMap[id] = 1; };
    const azHas = (id) => azMap[id] === 1;
    const azDelete = (id) => { azMap[id] = 0; };

    // --- error forwarding ---
    const nativeReportError = typeof reportError === "function" ? reportError : null;
    const errCatch = (e) => {
        if (nativeReportError) {
            nativeReportError(e);
        } else {
            queueMicrotask_(() => { throw e; });
        }
    };

    const dOffset = 2 ** -26; // tiny adjust to avoid hitting timer coalescing boundaries

    // --- run task: inline specialized call handling (0/1/2 args) ---
    const callWithArgs = (f, singleArg, args) => {
        if (args === null) {
            if (singleArg === undefined) {
                // zero args
                f();
            } else {
                // singleArg fast path
                f(singleArg);
            }
        } else {
            // small-args fast path or fallback
            const al = args.length;
            if (al === 1) f(args[0]);
            else if (al === 2) f(args[0], args[1]);
            else f.apply(win, args);
        }
    };

    // --- object pooling (pre-shaped objects for stable hidden classes) ---
    const timerObjPool = [];
    const rafObjPool = [];

    const getTimerObj = (id, f, singleArg, args, isInterval) => {
        let t = timerObjPool.pop();
        if (!t) {
            // pre-shape: all properties declared in order
            t = { id: 0, f: null, singleArg: undefined, args: null, isInterval: false };
        }
        t.id = id;
        t.f = f;
        t.singleArg = singleArg;
        t.args = args;
        t.isInterval = !!isInterval;
        return t;
    };

    const recycleTimerObj = (t) => {
        // clear references
        t.f = null;
        t.singleArg = undefined;
        t.args = null;
        t.isInterval = false;
        // keep id to help predictability (optional)
        t.id = 0;
        timerObjPool.push(t);
    };

    const getRafObj = (id, f, timeRes) => {
        let r = rafObjPool.pop();
        if (!r) {
            r = { id: 0, f: null, timeRes: 0 };
        }
        r.id = id;
        r.f = f;
        r.timeRes = timeRes;
        return r;
    };

    const recycleRafObj = (r) => {
        r.f = null;
        r.timeRes = 0;
        r.id = 0;
        rafObjPool.push(r);
    };

    // --- double-buffered queues ---
    let activeTimerQueue = [];
    let flushTimerQueue = [];
    let isTimerFlushScheduled = false;

    let activeRafQueue = [];
    let flushRafQueue = [];
    let isRafFlushScheduled = false;

    // --- FLUSH: Timers ---
    const flushTimers = () => {
        isTimerFlushScheduled = false;

        // heartbeat
        poke();

        // schedule microtask to run the queued tasks (coalesced)
        queueMicrotask_(() => {
            // swap buffers
            const tasks = activeTimerQueue;
            activeTimerQueue = flushTimerQueue;
            flushTimerQueue = tasks;

            const len = tasks.length;
            if (len === 0) return;

            // iterate with cached locals
            for (let i = 0; i < len; i++) {
                const task = tasks[i];

                const id = task.id;
                const f = task.f;
                const singleArg = task.singleArg;
                const args = task.args;
                const isInterval = task.isInterval;

                // existence check: if interval -> must have active flag; if timeout -> consume/deactivate
                if (isInterval ? tzHas(id) : (tzDelete(id), tzMap[id] === 0)) {
                    // For setTimeout: tzDelete already set to 0 above.
                    try {
                        callWithArgs(f, singleArg, args);
                    } catch (e) {
                        errCatch(e);
                    }
                } else if (isInterval && tzHas(id)) {
                    // unreachable due to branch logic but preserved for clarity
                    try {
                        callWithArgs(f, singleArg, args);
                    } catch (e) {
                        errCatch(e);
                    }
                }

                // cleanup object and recycle
                recycleTimerObj(task);

                // do not null tasks[i]; keep array buffer and just reset length
            }

            tasks.length = 0;
        });
    };

    const scheduleTimerFlush = () => {
        if (isTimerFlushScheduled) return;
        isTimerFlushScheduled = true;
        poke();
        pr.then(flushTimers);
    };

    // --- FLUSH: RAF ---
    const flushRafs = () => {
        isRafFlushScheduled = false;

        // swap buffers
        const tasks = activeRafQueue;
        activeRafQueue = flushRafQueue;
        flushRafQueue = tasks;

        const len = tasks.length;
        if (len === 0) return;

        const q1 = getTimelineTime();
        poke();

        // Cache timeline once per flush (qNow)
        const qNow = getTimelineTime();

        for (let i = 0; i < len; i++) {
            const task = tasks[i];
            const id = task.id;
            const f = task.f;
            const timeRes = task.timeRes;

            // only run if still active
            if (azHas(id)) {
                try {
                    // adjust time delta using the cached qNow and q1
                    f(timeRes + (qNow - q1));
                } catch (e) {
                    errCatch(e);
                }
            }

            recycleRafObj(task);
        }
        tasks.length = 0;
    };

    const scheduleRafFlush = (upr) => {
        if (isRafFlushScheduled) return;
        isRafFlushScheduled = true;
        upr.then(flushRafs);
    };

    // --- OVERRIDE: setTimeout / setInterval / clearX ---
    // Special-case args allocation: 0 args -> singleArg undefined; 1 arg -> singleArg; >1 -> array

    setTimeout = function (f, d) {
        let argLen = arguments.length;
        let args = null;
        let singleArg = undefined;

        if (argLen > 2) {
            if (argLen === 3) {
                singleArg = arguments[2];
            } else if (argLen === 4) {
                // two args - store array of 2 to avoid dynamic resizing in hot path
                args = [arguments[2], arguments[3]];
            } else {
                args = new Array(argLen - 2);
                for (let i = 2; i < argLen; i++) args[i - 2] = arguments[i];
            }
        }

        if (typeof f !== "function") {
            // push through to native; keep provided args shape
            return setTimeout_(f, d, ...(args ? args : (singleArg === undefined ? [] : [singleArg])));
        }

        let id;
        const wrapper = () => {
            // schedule pooled task if still active
            // note: wrapper captures nothing but id
            if (!tzHas(id)) return;
            activeTimerQueue.push(getTimerObj(id, f, singleArg, args, false));
            scheduleTimerFlush();
        };

        // ensure d is a number and adjust slightly if >1 for coalescing consistency
        d = +d;
        if (d > 1) d -= dOffset;

        id = setTimeout_(wrapper, d);
        tzAdd(id);
        return id;
    };

    setInterval = function (f, d) {
        let argLen = arguments.length;
        let args = null;
        let singleArg = undefined;

        if (argLen > 2) {
            if (argLen === 3) {
                singleArg = arguments[2];
            } else if (argLen === 4) {
                args = [arguments[2], arguments[3]];
            } else {
                args = new Array(argLen - 2);
                for (let i = 2; i < argLen; i++) args[i - 2] = arguments[i];
            }
        }

        if (typeof f !== "function") {
            return setInterval_(f, d, ...(args ? args : (singleArg === undefined ? [] : [singleArg])));
        }

        let id;
        const wrapper = () => {
            if (!tzHas(id)) return;
            activeTimerQueue.push(getTimerObj(id, f, singleArg, args, true));
            scheduleTimerFlush();
        };

        d = +d;
        if (d > 1) d -= dOffset;

        id = setInterval_(wrapper, d);
        tzAdd(id);
        return id;
    };

    clearTimeout = function (cid) {
        // mark as removed; leave key in object map to avoid delete overhead
        tzDelete(cid);
        return clearTimeout_(cid);
    };

    clearInterval = function (cid) {
        tzDelete(cid);
        return clearInterval_(cid);
    };

    // --- OVERRIDE: requestAnimationFrame / cancelAnimationFrame ---
    requestAnimationFrame = function (f) {
        let id;
        const upr = pr; // capture current heartbeat promise

        const wrapper = (timeRes) => {
            activeRafQueue.push(getRafObj(id, f, timeRes));
            scheduleRafFlush(upr);
        };

        poke();
        id = requestAnimationFrame_(wrapper);
        azAdd(id);
        return id;
    };

    cancelAnimationFrame = function (aid) {
        azDelete(aid);
        return cancelAnimationFrame_(aid);
    };

    // --- WebGL-specific considerations & cheap detection ---
    // This script does not change WebGL state, but heavy GL pages often use many RAFs and upload buffers.
    // Two light-weight tactics you can enable below (commented) if you want more aggressive CPU/GPU throttling:
    // Visibility-based RAF throttle: if document.hidden -> avoid scheduling RAF flushes entirely.

    const webglDetected = (function () {
        try {
            // cheap check without keeping a reference to the context
            const canvas = document.createElement("canvas");
            return !!(canvas.getContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")));
        } catch (e) {
            return false;
        }
    })();

    // End of IIFE
})([
    setTimeout,
    setInterval,
    requestAnimationFrame,
    clearTimeout,
    clearInterval,
    cancelAnimationFrame,
]);
