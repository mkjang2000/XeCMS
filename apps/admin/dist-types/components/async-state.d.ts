export declare function PageLoading({ label }: {
    readonly label?: string;
}): import("react").JSX.Element;
export declare function LoadError({ error, onRetry }: {
    readonly error: unknown;
    readonly onRetry?: () => void;
}): import("react").JSX.Element;
export declare function ConflictNotice({ onReload }: {
    readonly onReload: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=async-state.d.ts.map