import type { ReactNode } from "react";
export declare function Page({ children }: {
    readonly children: ReactNode;
}): import("react").JSX.Element;
export declare function PageHeader({ title, eyebrow, description, actions, }: {
    readonly title: string;
    readonly eyebrow?: string;
    readonly description?: string;
    readonly actions?: ReactNode;
}): import("react").JSX.Element;
export declare function SectionHeader({ id, title, description, actions, }: {
    readonly id?: string;
    readonly title: string;
    readonly description?: string;
    readonly actions?: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=page.d.ts.map