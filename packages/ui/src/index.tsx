import type { ReactElement, ReactNode, Ref } from "react";
import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Dialog as AriaDialog,
  FieldError,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  Select,
  SelectValue,
  Text,
  TextArea as AriaTextArea,
  TextField,
  type ButtonProps as AriaButtonProps,
  type CheckboxProps as AriaCheckboxProps,
  type DialogProps as AriaDialogProps,
  type Key,
  type TextFieldProps,
} from "react-aria-components";
// Keep CSS in source so `tsc -b` declarations/JS remain consumable without a second asset pipeline.
import styles from "../src/primitives.module.css";

export interface ButtonProps extends Omit<AriaButtonProps, "className"> {
  readonly variant?: "primary" | "secondary" | "quiet" | "danger";
  readonly size?: "small" | "medium";
  readonly isFullWidth?: boolean;
  readonly className?: string;
}

export function Button({
  variant = "primary",
  size = "medium",
  isFullWidth = false,
  className,
  ...props
}: ButtonProps): ReactElement {
  return (
    <AriaButton
      {...props}
      className={`${styles.button} ${styles[variant]} ${styles[size]} ${isFullWidth ? styles.fullWidth : ""} ${className ?? ""}`}
    />
  );
}

export interface TextInputProps extends Omit<TextFieldProps, "children" | "className"> {
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly type?: "text" | "password" | "email" | "number" | "datetime-local";
  readonly autoComplete?: string;
  readonly errorMessage?: string;
  readonly inputRef?: Ref<HTMLInputElement>;
}

export function TextInput({
  label,
  description,
  placeholder,
  type = "text",
  autoComplete,
  errorMessage,
  inputRef,
  isRequired,
  ...props
}: TextInputProps): ReactElement {
  return (
    <TextField
      {...props}
      isInvalid={errorMessage !== undefined || props.isInvalid}
      isRequired={isRequired}
      className={styles.field}
    >
      <Label className={styles.label}>
        {label}
        {isRequired ? <span className={styles.requiredMark} aria-hidden="true">*</span> : null}
      </Label>
      <Input
        ref={inputRef}
        className={styles.input}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
      />
      {description ? <Text slot="description" className={styles.description}>{description}</Text> : null}
      <FieldError className={styles.error}>{errorMessage}</FieldError>
    </TextField>
  );
}

export interface TextAreaFieldProps extends Omit<TextFieldProps, "children" | "className"> {
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly errorMessage?: string;
  readonly rows?: number;
}

export function TextAreaField({
  label,
  description,
  placeholder,
  errorMessage,
  rows = 5,
  isRequired,
  ...props
}: TextAreaFieldProps): ReactElement {
  return (
    <TextField
      {...props}
      isInvalid={errorMessage !== undefined || props.isInvalid}
      isRequired={isRequired}
      className={styles.field}
    >
      <Label className={styles.label}>
        {label}
        {isRequired ? <span className={styles.requiredMark} aria-hidden="true">*</span> : null}
      </Label>
      <AriaTextArea className={`${styles.input} ${styles.textarea}`} placeholder={placeholder} rows={rows} />
      {description ? <Text slot="description" className={styles.description}>{description}</Text> : null}
      <FieldError className={styles.error}>{errorMessage}</FieldError>
    </TextField>
  );
}

export interface CheckboxFieldProps extends Omit<AriaCheckboxProps, "children" | "className"> {
  readonly children: ReactNode;
}

export function CheckboxField({ children, ...props }: CheckboxFieldProps): ReactElement {
  return (
    <AriaCheckbox {...props} className={styles.checkbox}>
      {({ isSelected }) => (
        <>
          <span className={styles.checkboxBox} aria-hidden="true">{isSelected ? "✓" : ""}</span>
          <span>{children}</span>
        </>
      )}
    </AriaCheckbox>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectFieldProps {
  readonly label: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly options: readonly SelectOption[];
  readonly description?: string;
  readonly errorMessage?: string;
  readonly isRequired?: boolean;
  readonly isDisabled?: boolean;
  readonly onChange?: (value: string) => void;
}

export function SelectField({
  label,
  value,
  defaultValue,
  options,
  description,
  errorMessage,
  isRequired,
  isDisabled,
  onChange,
}: SelectFieldProps): ReactElement {
  const handleChange = (key: Key | null) => {
    if (key !== null) onChange?.(String(key));
  };
  return (
    <Select
      className={styles.field}
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      isInvalid={errorMessage !== undefined}
      isRequired={isRequired}
      isDisabled={isDisabled}
      onSelectionChange={handleChange}
    >
      <Label className={styles.label}>
        {label}
        {isRequired ? <span className={styles.requiredMark} aria-hidden="true">*</span> : null}
      </Label>
      <AriaButton className={styles.selectButton}>
        <SelectValue />
        <span aria-hidden="true">⌄</span>
      </AriaButton>
      {description ? <Text slot="description" className={styles.description}>{description}</Text> : null}
      <FieldError className={styles.error}>{errorMessage}</FieldError>
      <Popover className={styles.popover}>
        <ListBox className={styles.listBox} items={options}>
          {(option) => <ListBoxItem id={option.value} className={styles.listItem}>{option.label}</ListBoxItem>}
        </ListBox>
      </Popover>
    </Select>
  );
}

export interface ConfirmDialogProps extends Omit<AriaDialogProps, "children" | "className"> {
  readonly title: string;
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly isPending?: boolean;
  readonly isConfirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = "취소",
  danger = false,
  isPending = false,
  isConfirmDisabled = false,
  onConfirm,
  onCancel,
  ...props
}: ConfirmDialogProps): ReactElement {
  return (
    <ModalOverlay isOpen isDismissable={!isPending} className={styles.modalOverlay} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={styles.modal}>
        <AriaDialog {...props} className={styles.dialog}>
          <Heading slot="title" className={styles.dialogHeading}>{title}</Heading>
          <div>{children}</div>
          <div className={styles.dialogActions}>
            <Button variant="secondary" onPress={onCancel} isDisabled={isPending}>{cancelLabel}</Button>
            <Button
              variant={danger ? "danger" : "primary"}
              onPress={onConfirm}
              isDisabled={isPending || isConfirmDisabled}
            >
              {isPending ? "처리 중…" : confirmLabel}
            </Button>
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export interface FormDialogProps extends Omit<AriaDialogProps, "children" | "className"> {
  readonly title: string;
  readonly children: ReactNode;
  readonly submitLabel: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly isPending?: boolean;
  readonly isSubmitDisabled?: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

/**
 * A modal that wraps arbitrary form content in a real <form>, so Enter submits
 * and the primary button is a submit button. Use this for input dialogs;
 * ConfirmDialog remains for simple confirm/cancel prompts.
 */
export function FormDialog({
  title,
  children,
  submitLabel,
  cancelLabel = "취소",
  danger = false,
  isPending = false,
  isSubmitDisabled = false,
  onSubmit,
  onCancel,
  ...props
}: FormDialogProps): ReactElement {
  return (
    <ModalOverlay isOpen isDismissable={!isPending} className={styles.modalOverlay} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal className={styles.modal}>
        <AriaDialog {...props} className={styles.dialog}>
          <form onSubmit={(event) => { event.preventDefault(); if (!isPending && !isSubmitDisabled) onSubmit(); }}>
            <Heading slot="title" className={styles.dialogHeading}>{title}</Heading>
            <div>{children}</div>
            <div className={styles.dialogActions}>
              <Button variant="secondary" type="button" onPress={onCancel} isDisabled={isPending}>{cancelLabel}</Button>
              <Button
                variant={danger ? "danger" : "primary"}
                type="submit"
                isDisabled={isPending || isSubmitDisabled}
              >
                {isPending ? "처리 중…" : submitLabel}
              </Button>
            </div>
          </form>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

export function Callout({
  tone = "info",
  children,
}: {
  readonly tone?: "info" | "warning" | "error" | "success";
  readonly children: ReactNode;
}): ReactElement {
  const toneClass = tone === "error" ? styles.errorCallout : styles[tone];
  return <div role={tone === "error" ? "alert" : undefined} className={`${styles.callout} ${toneClass}`}>{children}</div>;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  readonly tone?: "neutral" | "primary" | "info" | "success" | "warning" | "danger";
  readonly children: ReactNode;
}): ReactElement {
  return <span className={`${styles.badge} ${styles[`badge${tone[0]!.toUpperCase()}${tone.slice(1)}`]}`}>{children}</span>;
}

export function LoadingIndicator({ label = "불러오는 중" }: { readonly label?: string }): ReactElement {
  return <div className={styles.spinner} role="status"><span>{label}</span></div>;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <section className={styles.emptyState}>
      <span className={styles.emptyStateVisual} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export { DialogTrigger } from "react-aria-components";
