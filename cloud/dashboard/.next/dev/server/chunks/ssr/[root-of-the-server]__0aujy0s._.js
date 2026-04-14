module.exports = [
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[project]/cloud/dashboard/src/components/StatCard.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>StatCard
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function StatCard({ label, value, sub, accent, dim = false }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: `card p-4${dim ? " stat-dim" : ""}`,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "text-[11px] uppercase tracking-[0.08em]",
                style: {
                    color: "var(--text-mute)"
                },
                children: label
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/StatCard.tsx",
                lineNumber: 16,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-1 text-2xl font-medium",
                style: {
                    color: accent ?? "var(--text)"
                },
                children: value
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/StatCard.tsx",
                lineNumber: 22,
                columnNumber: 7
            }, this),
            sub ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-0.5 text-xs mono",
                style: {
                    color: "var(--text-dim)"
                },
                children: sub
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/StatCard.tsx",
                lineNumber: 26,
                columnNumber: 9
            }, this) : null
        ]
    }, void 0, true, {
        fileName: "[project]/cloud/dashboard/src/components/StatCard.tsx",
        lineNumber: 15,
        columnNumber: 5
    }, this);
}
}),
"[project]/cloud/dashboard/src/components/UsageChart.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Pure-SVG bar chart. No chart lib — we want zero runtime dependency and
 * consistent dark-mode rendering.
 */ __turbopack_context__.s([
    "default",
    ()=>UsageChart
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
;
function UsageChart({ data, height = 140, accent = "var(--accent)", emptyLabel = "No data in this window yet." }) {
    if (data.length === 0 || data.every((d)=>d.value === 0)) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: "card p-10 text-center text-sm",
            style: {
                color: "var(--text-dim)"
            },
            children: emptyLabel
        }, void 0, false, {
            fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
            lineNumber: 26,
            columnNumber: 7
        }, this);
    }
    const max = Math.max(1, ...data.map((d)=>d.value));
    const gap = 2;
    const barWidth = `calc((100% - ${(data.length - 1) * gap}px) / ${data.length})`;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "card p-4",
        style: {
            background: "var(--bg-card)"
        },
        role: "img",
        "aria-label": "Usage over time",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-end",
                style: {
                    height,
                    gap: `${gap}px`
                },
                children: data.map((d, i)=>{
                    const h = d.value / max * 100;
                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        title: `${d.label}: ${d.value.toLocaleString()}${d.sub ? ` · ${d.sub}` : ""}`,
                        style: {
                            width: barWidth,
                            height: `${Math.max(2, h)}%`,
                            background: `linear-gradient(180deg, ${accent}, rgba(255,90,31,0.25))`,
                            borderRadius: "4px 4px 0 0",
                            transition: "opacity 120ms ease"
                        }
                    }, `${d.label}-${i}`, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                        lineNumber: 53,
                        columnNumber: 13
                    }, this);
                })
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                lineNumber: 46,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "mt-3 flex items-center justify-between text-[10px] mono",
                style: {
                    color: "var(--text-mute)"
                },
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: data[0]?.label
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                        lineNumber: 71,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: [
                            "peak ",
                            max.toLocaleString()
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                        lineNumber: 72,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        children: data[data.length - 1]?.label
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                        lineNumber: 73,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
                lineNumber: 67,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/cloud/dashboard/src/components/UsageChart.tsx",
        lineNumber: 40,
        columnNumber: 5
    }, this);
}
}),
"[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (client reference proxy) <module evaluation>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const __TURBOPACK__default__export__ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call the default export of [project]/cloud/dashboard/src/components/LiveUsage.tsx <module evaluation> from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/cloud/dashboard/src/components/LiveUsage.tsx <module evaluation>", "default");
}),
"[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (client reference proxy)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
// This file is generated by next-core EcmascriptClientReferenceModule.
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-server-dom-turbopack-server.js [app-rsc] (ecmascript)");
;
const __TURBOPACK__default__export__ = (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$server$2d$dom$2d$turbopack$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["registerClientReference"])(function() {
    throw new Error("Attempted to call the default export of [project]/cloud/dashboard/src/components/LiveUsage.tsx from the server, but it's on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.");
}, "[project]/cloud/dashboard/src/components/LiveUsage.tsx", "default");
}),
"[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$LiveUsage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__$3c$module__evaluation$3e$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (client reference proxy) <module evaluation>");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$LiveUsage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (client reference proxy)");
;
__turbopack_context__.n(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$LiveUsage$2e$tsx__$5b$app$2d$rsc$5d$__$28$client__reference__proxy$29$__);
}),
"[project]/cloud/dashboard/src/components/UpgradePrompt.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>UpgradePrompt
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/client/app-dir/link.react-server.js [app-rsc] (ecmascript)");
;
;
function UpgradePrompt({ plan, reason = "quota" }) {
    if (plan === "enterprise") return null;
    const headline = reason === "quota" ? "You've hit your plan quota." : reason === "seats" ? "You're out of seats on this plan." : "Upgrade for managed browser fetches.";
    const body = reason === "quota" ? "Upgrade to keep fetching. Overage pricing at $0.015/fetch on Pro, $0.01/fetch on Team." : reason === "seats" ? "Team plan includes 5 seats + $12/extra. Workspace billing is pro-rated." : "Free is capped at 100 fetches/day. Pro adds pooled provider keys, browser fallback, and 10k included fetches/mo.";
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "card p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4",
        style: {
            background: "linear-gradient(180deg, rgba(255,90,31,0.10), rgba(255,90,31,0.02)) var(--bg-card)",
            borderColor: "rgba(255,90,31,0.35)"
        },
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex flex-col gap-1",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "text-sm font-medium",
                        children: headline
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                        lineNumber: 41,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-xs max-w-2xl",
                        style: {
                            color: "var(--text-dim)"
                        },
                        children: body
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                        lineNumber: 42,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                lineNumber: 40,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "flex items-center gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "https://webfetch.dev/pricing",
                        className: "nav-link",
                        children: "See pricing"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                        lineNumber: 47,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        href: "/billing",
                        className: "btn btn-primary",
                        children: "Upgrade"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                        lineNumber: 50,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
                lineNumber: 46,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/cloud/dashboard/src/components/UpgradePrompt.tsx",
        lineNumber: 32,
        columnNumber: 5
    }, this);
}
}),
"[project]/cloud/dashboard/src/lib/format.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/** Format helpers used across the dashboard. Kept dependency-free. */ __turbopack_context__.s([
    "formatBytes",
    ()=>formatBytes,
    "formatDate",
    ()=>formatDate,
    "formatInt",
    ()=>formatInt,
    "formatPct",
    ()=>formatPct,
    "formatRelative",
    ()=>formatRelative,
    "formatUsd",
    ()=>formatUsd,
    "maskKey",
    ()=>maskKey,
    "toCsv",
    ()=>toCsv
]);
function formatBytes(n) {
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB"
    ];
    let i = 0;
    let v = n;
    while(v >= 1024 && i < units.length - 1){
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function formatUsd(n) {
    if (!Number.isFinite(n)) return "$0.00";
    if (Math.abs(n) < 0.01 && n !== 0) return `$${n.toFixed(4)}`;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2
    }).format(n);
}
function formatInt(n) {
    if (!Number.isFinite(n)) return "0";
    return new Intl.NumberFormat("en-US").format(Math.round(n));
}
function formatPct(fraction, digits = 1) {
    if (!Number.isFinite(fraction)) return "0%";
    return `${(fraction * 100).toFixed(digits)}%`;
}
function formatRelative(ms) {
    if (!ms || !Number.isFinite(ms)) return "never";
    const diff = Date.now() - ms;
    if (diff < 0) return "in the future";
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo ago`;
    return `${Math.floor(mo / 12)}y ago`;
}
function formatDate(ms) {
    if (!ms || !Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}
function maskKey(prefix) {
    return `${prefix}${"•".repeat(24)}`;
}
function toCsv(rows) {
    if (rows.length === 0) return "";
    const headers = Array.from(rows.reduce((set, row)=>{
        for (const k of Object.keys(row))set.add(k);
        return set;
    }, new Set()));
    const esc = (v)=>{
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out = [
        headers.join(",")
    ];
    for (const row of rows)out.push(headers.map((h)=>esc(row[h])).join(","));
    return out.join("\n");
}
}),
"[project]/cloud/shared/pricing.ts [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Pricing ladder — single source of truth for plan configuration.
 *
 * Consumed by:
 *   - cloud/workers/src/quota.ts   (enforces limits)
 *   - cloud/workers/src/billing.ts (builds Stripe Checkout sessions)
 *   - cloud/dashboard/*            (renders pricing cards, usage meters)
 *
 * Keep in sync with the marketing /pricing page copy.
 */ __turbopack_context__.s([
    "PLANS",
    ()=>PLANS,
    "planFor",
    ()=>planFor,
    "unitsFor",
    ()=>unitsFor
]);
const ALL_ENDPOINTS = [
    "/v1/search",
    "/v1/artist",
    "/v1/album",
    "/v1/download",
    "/v1/probe",
    "/v1/license",
    "/v1/similar"
];
const FREE_ENDPOINTS = [
    "/v1/search",
    "/v1/artist",
    "/v1/album",
    "/v1/download",
    "/v1/probe",
    "/v1/license"
];
const PLANS = {
    free: {
        id: "free",
        label: "Free",
        baseMonthlyUsd: 0,
        includedFetches: 100,
        window: "daily",
        overageUsd: -1,
        rateLimitPerMin: 10,
        seats: 1,
        extraSeatUsd: 0,
        allowedEndpoints: FREE_ENDPOINTS
    },
    pro: {
        id: "pro",
        label: "Pro",
        baseMonthlyUsd: 19,
        includedFetches: 10_000,
        window: "monthly",
        overageUsd: 0.015,
        rateLimitPerMin: 100,
        seats: 1,
        extraSeatUsd: 0,
        allowedEndpoints: ALL_ENDPOINTS
    },
    team: {
        id: "team",
        label: "Team",
        baseMonthlyUsd: 79,
        includedFetches: 50_000,
        window: "monthly",
        overageUsd: 0.01,
        rateLimitPerMin: 300,
        seats: 5,
        extraSeatUsd: 12,
        allowedEndpoints: ALL_ENDPOINTS
    },
    enterprise: {
        id: "enterprise",
        label: "Enterprise",
        baseMonthlyUsd: -1,
        includedFetches: 1_000_000,
        window: "monthly",
        overageUsd: -1,
        rateLimitPerMin: 1000,
        seats: 100,
        extraSeatUsd: 0,
        allowedEndpoints: ALL_ENDPOINTS
    }
};
function planFor(id) {
    if (!id) return PLANS.free;
    const p = PLANS[id];
    return p ?? PLANS.free;
}
function unitsFor(endpoint) {
    switch(endpoint){
        case "/v1/download":
            return 2;
        case "/v1/similar":
            return 3;
        default:
            return 1;
    }
}
}),
"[project]/cloud/dashboard/src/app/page.tsx [app-rsc] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>OverviewPage,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/server/route-modules/app-page/vendored/rsc/react-jsx-dev-runtime.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$api$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/api/navigation.react-server.js [app-rsc] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/node_modules/next/dist/client/components/navigation.react-server.js [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/StatCard.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$UsageChart$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/UsageChart.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$LiveUsage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/LiveUsage.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$UpgradePrompt$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/components/UpgradePrompt.tsx [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/lib/api.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$auth$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/lib/auth.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/dashboard/src/lib/format.ts [app-rsc] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$shared$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/cloud/shared/pricing.ts [app-rsc] (ecmascript)");
;
;
;
;
;
;
;
;
;
;
const dynamic = "force-dynamic";
async function OverviewPage() {
    const session = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$auth$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getServerSession"])();
    if (!session) (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$client$2f$components$2f$navigation$2e$react$2d$server$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["redirect"])("/login");
    const overview = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$api$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["getOverview"])();
    const { usage, billing, workspace, perProvider, dailySeries } = overview;
    const plan = __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$shared$2f$pricing$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["PLANS"][workspace.plan];
    const used = usage.used;
    const quotaPct = usage.included === 0 ? 0 : used / usage.included;
    const mrr = plan.baseMonthlyUsd > 0 ? plan.baseMonthlyUsd : 0;
    const avgCost = used > 0 ? used * 0.012 / used : 0;
    const bars = dailySeries.map((d)=>{
        const label = new Date(d.day).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric"
        });
        return {
            label,
            value: d.fetches,
            sub: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatUsd"])(d.costUsd)
        };
    });
    const topProvider = perProvider[0];
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: "flex flex-col gap-8",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "flex flex-col gap-2",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex items-baseline justify-between",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                                className: "text-2xl font-medium tracking-tight",
                                children: [
                                    workspace.name,
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "ml-2 mono text-[12px]",
                                        style: {
                                            color: "var(--text-mute)"
                                        },
                                        children: [
                                            "/",
                                            workspace.slug
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 38,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 36,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: `badge ${workspace.plan === "free" ? "badge-warn" : "badge-accent"}`,
                                children: [
                                    plan.label,
                                    " plan"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 42,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 35,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        className: "text-sm max-w-2xl",
                        style: {
                            color: "var(--text-dim)"
                        },
                        children: [
                            "Welcome back, ",
                            session.user.name ?? session.user.email,
                            ". Here's the pulse of your workspace — usage, spend, and who's hitting the API right now."
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 46,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                lineNumber: 34,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "grid grid-cols-2 md:grid-cols-5 gap-3",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        label: "MRR",
                        value: workspace.plan === "free" ? "$0" : (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatUsd"])(mrr),
                        sub: workspace.plan === "free" ? "free tier" : `renews ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatDate"])(billing.currentPeriodEnd)}`,
                        accent: workspace.plan === "free" ? "var(--text-mute)" : undefined,
                        dim: workspace.plan === "free"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 53,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        label: "Fetches this period",
                        value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatInt"])(used),
                        sub: `of ${(0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatInt"])(usage.included)} included`
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 60,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        label: "Avg cost / fetch",
                        value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatUsd"])(avgCost),
                        sub: "rolling 30d"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 65,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        label: "Quota used",
                        value: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatPct"])(quotaPct, 0),
                        sub: quotaPct >= 0.8 ? "upgrade soon" : "healthy",
                        accent: quotaPct >= 1 ? "var(--danger)" : quotaPct >= 0.8 ? "var(--warn)" : undefined
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 70,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$StatCard$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                        label: "Rate limit",
                        value: `${plan.rateLimitPerMin}/min`,
                        sub: "per API key"
                    }, void 0, false, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 78,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                lineNumber: 52,
                columnNumber: 7
            }, this),
            (workspace.plan === "free" || quotaPct >= 1) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$UpgradePrompt$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                plan: workspace.plan,
                reason: quotaPct >= 1 ? "quota" : "free"
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                lineNumber: 86,
                columnNumber: 9
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "grid grid-cols-1 lg:grid-cols-3 gap-4",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "lg:col-span-2 flex flex-col gap-3",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex items-baseline justify-between",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                                        className: "text-sm font-medium uppercase tracking-[0.08em]",
                                        style: {
                                            color: "var(--text-mute)"
                                        },
                                        children: "30-day fetches"
                                    }, void 0, false, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 92,
                                        columnNumber: 13
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "mono text-[11px]",
                                        style: {
                                            color: "var(--text-mute)"
                                        },
                                        children: [
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatInt"])(dailySeries.reduce((a, b)=>a + b.fetches, 0)),
                                            " total"
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 95,
                                        columnNumber: 13
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 91,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$UsageChart$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {
                                data: bars
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 99,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 90,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "flex flex-col gap-3",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$components$2f$LiveUsage$2e$tsx__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["default"], {}, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 102,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "card p-4 flex flex-col gap-2",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "text-[11px] uppercase tracking-[0.08em]",
                                        style: {
                                            color: "var(--text-mute)"
                                        },
                                        children: "Top provider"
                                    }, void 0, false, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 104,
                                        columnNumber: 13
                                    }, this),
                                    topProvider ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "flex items-baseline justify-between",
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "font-medium mono",
                                                children: topProvider.provider
                                            }, void 0, false, {
                                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                                lineNumber: 109,
                                                columnNumber: 17
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: "mono text-[11px]",
                                                style: {
                                                    color: "var(--text-dim)"
                                                },
                                                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatInt"])(topProvider.fetches)
                                            }, void 0, false, {
                                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                                lineNumber: 110,
                                                columnNumber: 17
                                            }, this)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 108,
                                        columnNumber: 15
                                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                        className: "text-xs",
                                        style: {
                                            color: "var(--text-dim)"
                                        },
                                        children: "No provider traffic yet."
                                    }, void 0, false, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 115,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 103,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 101,
                        columnNumber: 9
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                lineNumber: 89,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: "grid grid-cols-1 md:grid-cols-3 gap-3",
                children: perProvider.slice(0, 6).map((p)=>{
                    const total = perProvider.reduce((a, b)=>a + b.fetches, 0);
                    const pct = total === 0 ? 0 : p.fetches / total;
                    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "card p-4 flex flex-col gap-2",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "flex items-baseline justify-between",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "font-medium mono text-sm",
                                        children: p.provider
                                    }, void 0, false, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 130,
                                        columnNumber: 17
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: "mono text-[11px]",
                                        style: {
                                            color: "var(--text-dim)"
                                        },
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatInt"])(p.fetches)
                                    }, void 0, false, {
                                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                        lineNumber: 131,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 129,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "bar",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    style: {
                                        width: `${Math.max(3, pct * 100)}%`
                                    }
                                }, void 0, false, {
                                    fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                    lineNumber: 136,
                                    columnNumber: 17
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 135,
                                columnNumber: 15
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$rsc$2f$react$2d$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "text-[11px] mono",
                                style: {
                                    color: "var(--text-mute)"
                                },
                                children: [
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$cloud$2f$dashboard$2f$src$2f$lib$2f$format$2e$ts__$5b$app$2d$rsc$5d$__$28$ecmascript$29$__["formatPct"])(pct, 0),
                                    " of traffic"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                                lineNumber: 138,
                                columnNumber: 15
                            }, this)
                        ]
                    }, p.provider, true, {
                        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                        lineNumber: 128,
                        columnNumber: 13
                    }, this);
                })
            }, void 0, false, {
                fileName: "[project]/cloud/dashboard/src/app/page.tsx",
                lineNumber: 123,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/cloud/dashboard/src/app/page.tsx",
        lineNumber: 33,
        columnNumber: 5
    }, this);
}
}),
"[project]/cloud/dashboard/src/app/page.tsx [app-rsc] (ecmascript, Next.js Server Component)", ((__turbopack_context__) => {

__turbopack_context__.n(__turbopack_context__.i("[project]/cloud/dashboard/src/app/page.tsx [app-rsc] (ecmascript)"));
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__0aujy0s._.js.map