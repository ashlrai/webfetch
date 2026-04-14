(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>LiveUsage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
function LiveUsage() {
    _s();
    const [connected, setConnected] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [ticks, setTicks] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])([]);
    const [flash, setFlash] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const flashTimer = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "LiveUsage.useEffect": ()=>{
            if (typeof EventSource === "undefined") return;
            const es = new EventSource("/usage/stream");
            es.onopen = ({
                "LiveUsage.useEffect": ()=>setConnected(true)
            })["LiveUsage.useEffect"];
            es.onerror = ({
                "LiveUsage.useEffect": ()=>setConnected(false)
            })["LiveUsage.useEffect"];
            const onTick = {
                "LiveUsage.useEffect.onTick": (ev)=>{
                    try {
                        const t = JSON.parse(ev.data);
                        setTicks({
                            "LiveUsage.useEffect.onTick": (prev)=>[
                                    t,
                                    ...prev
                                ].slice(0, 20)
                        }["LiveUsage.useEffect.onTick"]);
                        setFlash(true);
                        if (flashTimer.current) clearTimeout(flashTimer.current);
                        flashTimer.current = setTimeout({
                            "LiveUsage.useEffect.onTick": ()=>setFlash(false)
                        }["LiveUsage.useEffect.onTick"], 900);
                    } catch  {
                    // ignore malformed
                    }
                }
            }["LiveUsage.useEffect.onTick"];
            es.addEventListener("tick", onTick);
            return ({
                "LiveUsage.useEffect": ()=>{
                    es.removeEventListener("tick", onTick);
                    es.close();
                    if (flashTimer.current) clearTimeout(flashTimer.current);
                }
            })["LiveUsage.useEffect"];
        }
    }["LiveUsage.useEffect"], []);
    const color = connected ? "var(--ok)" : "var(--text-mute)";
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "card p-4 flex flex-col gap-3",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center justify-between",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-center gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                style: {
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background: color,
                                    boxShadow: flash ? `0 0 10px ${color}` : undefined,
                                    animation: connected ? "pulse 1.4s ease-in-out infinite" : undefined,
                                    transition: "box-shadow 200ms ease"
                                }
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                                lineNumber: 56,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "text-sm font-medium",
                                children: "Live usage"
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                                lineNumber: 67,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                        lineNumber: 55,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "mono text-[11px]",
                        style: {
                            color: "var(--text-mute)"
                        },
                        children: connected ? "streaming" : "offline"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                        lineNumber: 69,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                lineNumber: 54,
                columnNumber: 7
            }, this),
            ticks.length === 0 ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-xs",
                style: {
                    color: "var(--text-dim)"
                },
                children: "Waiting for the next fetch…"
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                lineNumber: 74,
                columnNumber: 9
            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
                className: "flex flex-col gap-1",
                children: ticks.slice(0, 6).map((t, i)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("li", {
                        className: "flex items-center justify-between text-[12px] mono",
                        style: {
                            color: i === 0 ? "var(--text)" : "var(--text-dim)"
                        },
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: t.endpoint
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                                lineNumber: 85,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: `badge ${t.status >= 500 ? "badge-err" : t.status >= 400 ? "badge-warn" : "badge-ok"}`,
                                    children: t.status
                                }, void 0, false, {
                                    fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                                    lineNumber: 87,
                                    columnNumber: 17
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                                lineNumber: 86,
                                columnNumber: 15
                            }, this)
                        ]
                    }, `${t.ts}-${i}`, true, {
                        fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                        lineNumber: 80,
                        columnNumber: 13
                    }, this))
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
                lineNumber: 78,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/cloud/dashboard/src/components/LiveUsage.tsx",
        lineNumber: 53,
        columnNumber: 5
    }, this);
}
_s(LiveUsage, "hXusnAcsiaMNLIbB0OPci60/kKk=");
_c = LiveUsage;
var _c;
__turbopack_context__.k.register(_c, "LiveUsage");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=cloud_dashboard_src_components_LiveUsage_tsx_0-ovt4p._.js.map