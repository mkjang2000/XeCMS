import { type DisplayMode } from "../../display-mode.js";
/**
 * 간단 모드에서 표현할 수 없는 고급 설정을 만났을 때의 안내.
 * 파괴적 단순화 대신 상위 모드로 안내한다. 오류가 아니라 정보성 톤.
 */
export declare function AdvancedConfigNotice({ message, reasons, targetMode, to, actionLabel, }: {
    readonly message: string;
    readonly reasons?: readonly string[];
    readonly targetMode?: DisplayMode;
    readonly to: string;
    readonly actionLabel?: string;
}): import("react").JSX.Element;
export declare function policyErrorMessage(error: unknown): {
    readonly message: string;
    readonly conflict: boolean;
    readonly technical?: string;
};
/**
 * 정책 뮤테이션 오류를 평이한 한국어로 표시한다.
 * 409 충돌은 정책 쿼리를 무효화해 최신 상태로 복구한다.
 */
export declare function PolicyMutationError({ error, policyKey, }: {
    readonly error: unknown;
    readonly policyKey: readonly string[];
}): import("react").JSX.Element | null;
//# sourceMappingURL=guardrails.d.ts.map