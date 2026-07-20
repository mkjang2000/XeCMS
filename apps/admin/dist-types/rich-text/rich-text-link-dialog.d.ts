/** Replaces window.prompt so link editing looks like the rest of the studio. */
export declare function RichTextLinkDialog({ initialHref, onSubmit, onRemove, onClose }: {
    readonly initialHref: string;
    readonly onSubmit: (href: string) => void;
    readonly onRemove: () => void;
    readonly onClose: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=rich-text-link-dialog.d.ts.map