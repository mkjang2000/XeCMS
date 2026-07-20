import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Toolbar glyphs drawn to match the app's navigation icons: 24×24 box, 1.8
 * stroke, round caps. Letterform marks (B/I/U/S) are filled paths instead so
 * they read as type samples rather than outlines.
 */
export function FormatIcon({ name, size = 18 }) {
    const stroke = {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        focusable: false,
    };
    const text = {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        "aria-hidden": true,
        focusable: false,
    };
    switch (name) {
        case "bold":
            return (_jsx("svg", { ...text, children: _jsx("text", { x: "12", y: "17.5", textAnchor: "middle", fontSize: "15", fontWeight: "800", fill: "currentColor", fontFamily: "Georgia, serif", children: "B" }) }));
        case "italic":
            return (_jsx("svg", { ...text, children: _jsx("text", { x: "12", y: "17.5", textAnchor: "middle", fontSize: "15", fontStyle: "italic", fill: "currentColor", fontFamily: "Georgia, serif", children: "I" }) }));
        case "underline":
            return (_jsxs("svg", { ...text, children: [_jsx("text", { x: "12", y: "16", textAnchor: "middle", fontSize: "14", fill: "currentColor", fontFamily: "Georgia, serif", children: "U" }), _jsx("rect", { x: "6", y: "18", width: "12", height: "1.7", rx: "0.85", fill: "currentColor" })] }));
        case "strike":
            return (_jsxs("svg", { ...text, children: [_jsx("text", { x: "12", y: "17", textAnchor: "middle", fontSize: "14", fill: "currentColor", fontFamily: "Georgia, serif", children: "S" }), _jsx("rect", { x: "5", y: "11.3", width: "14", height: "1.7", rx: "0.85", fill: "currentColor" })] }));
        case "code":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "m9 8-4 4 4 4" }), _jsx("path", { d: "m15 8 4 4-4 4" })] }));
        case "link":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M10.5 13.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.54 3.54 0 0 0-5-5l-1.2 1.2" }), _jsx("path", { d: "M13.5 10.5a3.5 3.5 0 0 0-5 0L6 13a3.54 3.54 0 0 0 5 5l1.2-1.2" })] }));
        case "unlink":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M11 13.5a3.5 3.5 0 0 0 4.5.4l2.5-2.5a3.54 3.54 0 0 0-5-5L12 7.5" }), _jsx("path", { d: "M13 10.5a3.5 3.5 0 0 0-4.5-.4L6 12.6a3.54 3.54 0 0 0 5 5" }), _jsx("path", { d: "m4 4 16 16" })] }));
        case "bulletList":
            return (_jsxs("svg", { ...stroke, children: [_jsx("circle", { cx: "5", cy: "7", r: "1.2", fill: "currentColor", stroke: "none" }), _jsx("circle", { cx: "5", cy: "12", r: "1.2", fill: "currentColor", stroke: "none" }), _jsx("circle", { cx: "5", cy: "17", r: "1.2", fill: "currentColor", stroke: "none" }), _jsx("path", { d: "M9.5 7h9.5M9.5 12h9.5M9.5 17h9.5" })] }));
        case "orderedList":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M10 7h9M10 12h9M10 17h9" }), _jsx("text", { x: "3", y: "9", fontSize: "7", fill: "currentColor", stroke: "none", fontFamily: "system-ui, sans-serif", children: "1" }), _jsx("text", { x: "3", y: "14", fontSize: "7", fill: "currentColor", stroke: "none", fontFamily: "system-ui, sans-serif", children: "2" }), _jsx("text", { x: "3", y: "19", fontSize: "7", fill: "currentColor", stroke: "none", fontFamily: "system-ui, sans-serif", children: "3" })] }));
        case "blockquote":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M5 5v14", strokeWidth: "2.4" }), _jsx("path", { d: "M10 8.5h9M10 13h9M10 17h5.5" })] }));
        case "alignLeft":
            return (_jsx("svg", { ...stroke, children: _jsx("path", { d: "M4 6h16M4 10.5h10M4 15h16M4 19.5h10" }) }));
        case "alignCenter":
            return (_jsx("svg", { ...stroke, children: _jsx("path", { d: "M4 6h16M7 10.5h10M4 15h16M7 19.5h10" }) }));
        case "alignRight":
            return (_jsx("svg", { ...stroke, children: _jsx("path", { d: "M4 6h16M10 10.5h10M4 15h16M10 19.5h10" }) }));
        case "image":
            return (_jsxs("svg", { ...stroke, children: [_jsx("rect", { x: "3.5", y: "5", width: "17", height: "14", rx: "2" }), _jsx("circle", { cx: "8.75", cy: "10", r: "1.5" }), _jsx("path", { d: "m4.5 16.5 4.2-4.2a1.5 1.5 0 0 1 2.1 0l3 3a1.5 1.5 0 0 0 2.1 0l1.4-1.4a1.5 1.5 0 0 1 2.1 0l1.1 1.1" })] }));
        case "table":
            return (_jsxs("svg", { ...stroke, children: [_jsx("rect", { x: "3.5", y: "5", width: "17", height: "14", rx: "2" }), _jsx("path", { d: "M3.5 9.7h17M3.5 14.3h17M9.8 5v14" })] }));
        case "rule":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M4 12h16", strokeWidth: "2.2" }), _jsx("path", { d: "M6.5 7h11M6.5 17h11", opacity: "0.45" })] }));
        case "undo":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M4 9h9a5 5 0 0 1 0 10h-2" }), _jsx("path", { d: "m7.5 5.5-3.5 3.5 3.5 3.5" })] }));
        case "redo":
            return (_jsxs("svg", { ...stroke, children: [_jsx("path", { d: "M20 9h-9a5 5 0 0 0 0 10h2" }), _jsx("path", { d: "m16.5 5.5 3.5 3.5-3.5 3.5" })] }));
        case "chevronDown":
            return (_jsx("svg", { ...stroke, children: _jsx("path", { d: "m7 10 5 5 5-5" }) }));
    }
}
//# sourceMappingURL=format-icons.js.map