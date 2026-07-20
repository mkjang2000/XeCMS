import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef, useState } from "react";
import { ConfirmDialog, TextInput } from "@xecms/ui";
import { FormatIcon } from "./format-icons.js";
import styles from "./rich-text-editor.module.css";
/**
 * Picks an image for the body: either an existing library item or a file
 * uploaded on the spot.
 *
 * Upload deliberately inserts nothing until the server returns a media id — an
 * optimistic placeholder node would leave debris in the document when an upload
 * fails, and the document is the thing we must not corrupt.
 */
export function RichTextImageDialog({ mediaItems, canUpload, onUpload, onSelect, onClose }) {
    const [query, setQuery] = useState("");
    const [uploadError, setUploadError] = useState(null);
    const [isUploading, setUploading] = useState(false);
    const [isDragging, setDragging] = useState(false);
    const fileInput = useRef(null);
    const images = mediaItems.filter((item) => item.mimeType.startsWith("image/") && item.status === "available");
    const needle = query.trim().toLowerCase();
    const matches = needle === ""
        ? images
        : images.filter((item) => item.fileName.toLowerCase().includes(needle));
    const shown = matches.slice(0, 50);
    const upload = async (file) => {
        if (onUpload === undefined || isUploading)
            return;
        setUploading(true);
        setUploadError(null);
        try {
            const record = await onUpload(file);
            // The media list has not refetched yet, so hand the URL over directly.
            onSelect(record.id, record.fileName, record.contentUrl);
        }
        catch (error) {
            setUploadError(error instanceof Error ? error.message : "업로드에 실패했습니다.");
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsx(ConfirmDialog, { title: "\uC774\uBBF8\uC9C0 \uB123\uAE30", 
        // Choosing happens by clicking a row, so the footer only needs a way out.
        confirmLabel: "\uB2EB\uAE30", hideCancel: true, onCancel: onClose, onConfirm: onClose, children: _jsxs("div", { className: styles.pickerDialog, children: [canUpload ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.pickerUpload, "data-dragging": isDragging, role: "button", tabIndex: 0, "aria-label": "\uC774\uBBF8\uC9C0 \uC5C5\uB85C\uB4DC", onClick: () => fileInput.current?.click(), onKeyDown: (event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    fileInput.current?.click();
                                }
                            }, onDragOver: (event) => { event.preventDefault(); setDragging(true); }, onDragLeave: () => setDragging(false), onDrop: (event) => {
                                event.preventDefault();
                                setDragging(false);
                                const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
                                if (file !== undefined)
                                    void upload(file);
                            }, children: [_jsx("span", { className: styles.pickerUploadIcon, children: _jsx(FormatIcon, { name: "image", size: 24 }) }), _jsx("span", { className: styles.pickerUploadTitle, children: isUploading ? "업로드 중…" : "이미지를 끌어다 놓거나 클릭해 선택" }), _jsx("span", { className: styles.pickerHint, children: "\uBBF8\uB514\uC5B4 \uB77C\uC774\uBE0C\uB7EC\uB9AC\uC5D0 \uC800\uC7A5\uB41C \uB4A4 \uBCF8\uBB38\uC5D0 \uC0BD\uC785\uB429\uB2C8\uB2E4." })] }), _jsx("input", { ref: fileInput, type: "file", accept: "image/*", hidden: true, disabled: isUploading, onChange: (event) => {
                                const file = event.currentTarget.files?.[0];
                                event.currentTarget.value = "";
                                if (file !== undefined)
                                    void upload(file);
                            } })] })) : null, uploadError !== null ? _jsx("p", { className: styles.pickerError, role: "alert", children: uploadError }) : null, _jsx(TextInput, { label: "\uC774\uBBF8\uC9C0 \uAC80\uC0C9", placeholder: "\uD30C\uC77C \uC774\uB984\uC73C\uB85C \uAC80\uC0C9", value: query, onChange: setQuery }), images.length === 0 ? (_jsx("p", { className: styles.pickerEmpty, children: canUpload
                        ? "라이브러리에 이미지가 없습니다. 위에서 새 이미지를 올려 주세요."
                        : "먼저 미디어 라이브러리에 이미지를 업로드해 주세요." })) : shown.length === 0 ? (_jsx("p", { className: styles.pickerEmpty, children: "\uAC80\uC0C9 \uACB0\uACFC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4." })) : (_jsx("ul", { className: styles.pickerList, children: shown.map((item) => (_jsx("li", { children: _jsxs("button", { type: "button", className: styles.pickerRow, disabled: isUploading, onClick: () => onSelect(item.id, item.fileName), children: [_jsx("img", { src: item.contentUrl, alt: "", loading: "lazy", className: styles.pickerThumb }), _jsx("span", { className: styles.pickerName, children: item.fileName })] }) }, item.id))) })), matches.length > shown.length ? (_jsxs("p", { className: styles.pickerHint, children: [matches.length, "\uAC1C \uC911 ", shown.length, "\uAC1C \uD45C\uC2DC \u2014 \uAC80\uC0C9\uC73C\uB85C \uC881\uD600 \uC8FC\uC138\uC694."] })) : null] }) }));
}
//# sourceMappingURL=rich-text-image-dialog.js.map