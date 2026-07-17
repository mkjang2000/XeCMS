import { type ReactNode } from "react";
export type DisplayMode = "basic" | "standard" | "advanced";
export declare const DISPLAY_MODE_STORAGE_KEY = "xecms.admin.display-mode.v1";
export declare const displayModes: readonly [{
    readonly id: "basic";
    readonly label: "Basic";
    readonly description: "콘텐츠와 기본 구조 관리에 필요한 항목만 표시합니다.";
}, {
    readonly id: "standard";
    readonly label: "Standard";
    readonly description: "사용자·Realm·권한과 계층 설정까지 함께 표시합니다.";
}, {
    readonly id: "advanced";
    readonly label: "Advanced";
    readonly description: "운영·감사·Worker·Plugin과 기술 정보를 모두 표시합니다.";
}];
interface DisplayModeContextValue {
    readonly mode: DisplayMode;
    readonly setMode: (mode: DisplayMode) => void;
}
export declare function isDisplayMode(value: unknown): value is DisplayMode;
export declare function displayModeAtLeast(current: DisplayMode, minimum: DisplayMode): boolean;
export declare function readStoredDisplayMode(storage?: Pick<Storage, "getItem">): DisplayMode;
export declare function DisplayModeProvider({ children, initialMode, }: {
    readonly children: ReactNode;
    readonly initialMode?: DisplayMode;
}): import("react").JSX.Element;
export declare function useDisplayMode(): DisplayModeContextValue;
export declare function DisplayModeGate({ minimum, children, }: {
    readonly minimum: DisplayMode;
    readonly children: ReactNode;
}): ReactNode;
export declare function DisplayModeSelector({ compact, }: {
    readonly compact?: boolean;
}): import("react").JSX.Element;
export {};
//# sourceMappingURL=display-mode.d.ts.map