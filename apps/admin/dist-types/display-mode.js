import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useMemo, useState, } from "react";
import { Button } from "@xecms/ui";
import styles from "./display-mode.module.css";
export const DISPLAY_MODE_STORAGE_KEY = "xecms.admin.display-mode.v1";
export const displayModes = [
    {
        id: "basic",
        label: "간단",
        description: "콘텐츠와 기본 구조 관리에 필요한 항목만 표시합니다.",
    },
    {
        id: "standard",
        label: "표준",
        description: "사용자·Realm·권한과 계층 설정까지 함께 표시합니다.",
    },
    {
        id: "advanced",
        label: "고급",
        description: "운영·감사·Worker·Plugin과 기술 정보를 모두 표시합니다.",
    },
];
const rank = {
    basic: 0,
    standard: 1,
    advanced: 2,
};
const DisplayModeContext = createContext({
    mode: "basic",
    setMode: () => undefined,
    autoModeChange: null,
    clearAutoModeChange: () => undefined,
});
export function isDisplayMode(value) {
    return value === "basic" || value === "standard" || value === "advanced";
}
export function displayModeAtLeast(current, minimum) {
    return rank[current] >= rank[minimum];
}
export function readStoredDisplayMode(storage) {
    if (storage === undefined)
        return "basic";
    try {
        const value = storage.getItem(DISPLAY_MODE_STORAGE_KEY);
        return isDisplayMode(value) ? value : "basic";
    }
    catch {
        return "basic";
    }
}
export function DisplayModeProvider({ children, initialMode, }) {
    const [mode, setModeState] = useState(() => initialMode ?? readStoredDisplayMode(typeof window === "undefined" ? undefined : window.localStorage));
    // Session-local (never persisted or cross-tab): the mode to revert to after an
    // automatic mode raise. Persisting or syncing this would misfire in other tabs.
    const [autoModeChange, setAutoModeChange] = useState(null);
    const setMode = useMemo(() => (next, options) => {
        setModeState((previous) => {
            if (next === previous)
                return previous;
            setAutoModeChange(options?.auto === true ? { from: previous } : null);
            return next;
        });
    }, []);
    const clearAutoModeChange = useMemo(() => () => setAutoModeChange(null), []);
    useEffect(() => {
        document.documentElement.dataset["displayMode"] = mode;
        try {
            window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
        }
        catch {
            // The preference remains active for this session when storage is unavailable.
        }
    }, [mode]);
    useEffect(() => {
        const syncMode = (event) => {
            if (event.key === DISPLAY_MODE_STORAGE_KEY
                && isDisplayMode(event.newValue)) {
                setModeState(event.newValue);
                setAutoModeChange(null);
            }
        };
        window.addEventListener("storage", syncMode);
        return () => window.removeEventListener("storage", syncMode);
    }, []);
    const value = useMemo(() => ({ mode, setMode, autoModeChange, clearAutoModeChange }), [mode, setMode, autoModeChange, clearAutoModeChange]);
    return (_jsx(DisplayModeContext.Provider, { value: value, children: children }));
}
export function useDisplayMode() {
    return useContext(DisplayModeContext);
}
export function DisplayModeGate({ minimum, children, }) {
    const { mode } = useDisplayMode();
    return displayModeAtLeast(mode, minimum) ? children : null;
}
const MODE_LABEL = {
    basic: "간단",
    standard: "표준",
    advanced: "고급",
};
/**
 * Shown after a screen automatically raised the display mode. Tells the user it
 * happened and offers a one-click revert to the previous mode. Renders nothing
 * when the last change was a manual selection.
 */
export function ModeChangeNotice() {
    const { mode, setMode, autoModeChange, clearAutoModeChange } = useDisplayMode();
    if (autoModeChange === null)
        return null;
    return (_jsxs("div", { className: styles.notice, role: "status", children: [_jsxs("span", { children: ["\uD45C\uC2DC \uBAA8\uB4DC\uAC00 ", _jsx("strong", { children: MODE_LABEL[mode] }), "\uC73C\uB85C \uBC14\uB00C\uC5C8\uC2B5\uB2C8\uB2E4."] }), _jsxs(Button, { size: "small", variant: "quiet", onPress: () => { setMode(autoModeChange.from); clearAutoModeChange(); }, children: [MODE_LABEL[autoModeChange.from], "\uC73C\uB85C \uB418\uB3CC\uB9AC\uAE30"] })] }));
}
export function DisplayModeSelector({ compact = false, }) {
    const { mode, setMode } = useDisplayMode();
    return (_jsx("div", { className: `${styles.selector} ${compact ? styles.compact : ""}`, role: "group", "aria-label": "Admin \uD45C\uC2DC \uBAA8\uB4DC", children: displayModes.map((item) => (_jsxs(Button, { size: "small", variant: mode === item.id ? "secondary" : "quiet", "aria-pressed": mode === item.id, onPress: () => setMode(item.id), className: styles.option, children: [_jsx("span", { children: item.label }), !compact ? _jsx("small", { children: item.description }) : null] }, item.id))) }));
}
//# sourceMappingURL=display-mode.js.map