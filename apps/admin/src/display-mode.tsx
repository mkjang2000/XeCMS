import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@xecms/ui";
import styles from "./display-mode.module.css";

export type DisplayMode = "basic" | "standard" | "advanced";

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
] as const satisfies readonly {
  readonly id: DisplayMode;
  readonly label: string;
  readonly description: string;
}[];

const rank: Readonly<Record<DisplayMode, number>> = {
  basic: 0,
  standard: 1,
  advanced: 2,
};

interface DisplayModeContextValue {
  readonly mode: DisplayMode;
  /**
   * Change the display mode. Pass `{ auto: true }` when a screen raises the mode
   * on the user's behalf (e.g. "manage in standard mode") — this records the
   * previous mode so a revert banner can offer to undo it.
   */
  readonly setMode: (mode: DisplayMode, options?: { readonly auto?: boolean }) => void;
  /** Set only when the last change was automatic; carries the mode to revert to. */
  readonly autoModeChange: { readonly from: DisplayMode } | null;
  readonly clearAutoModeChange: () => void;
}

const DisplayModeContext = createContext<DisplayModeContextValue>({
  mode: "basic",
  setMode: () => undefined,
  autoModeChange: null,
  clearAutoModeChange: () => undefined,
});

export function isDisplayMode(value: unknown): value is DisplayMode {
  return value === "basic" || value === "standard" || value === "advanced";
}

export function displayModeAtLeast(
  current: DisplayMode,
  minimum: DisplayMode,
): boolean {
  return rank[current] >= rank[minimum];
}

export function readStoredDisplayMode(storage?: Pick<Storage, "getItem">): DisplayMode {
  if (storage === undefined) return "basic";
  try {
    const value = storage.getItem(DISPLAY_MODE_STORAGE_KEY);
    return isDisplayMode(value) ? value : "basic";
  } catch {
    return "basic";
  }
}

export function DisplayModeProvider({
  children,
  initialMode,
}: {
  readonly children: ReactNode;
  readonly initialMode?: DisplayMode;
}) {
  const [mode, setModeState] = useState<DisplayMode>(() =>
    initialMode ?? readStoredDisplayMode(
      typeof window === "undefined" ? undefined : window.localStorage,
    ),
  );
  // Session-local (never persisted or cross-tab): the mode to revert to after an
  // automatic mode raise. Persisting or syncing this would misfire in other tabs.
  const [autoModeChange, setAutoModeChange] = useState<{ readonly from: DisplayMode } | null>(null);

  const setMode = useMemo(
    () => (next: DisplayMode, options?: { readonly auto?: boolean }) => {
      setModeState((previous) => {
        if (next === previous) return previous;
        setAutoModeChange(options?.auto === true ? { from: previous } : null);
        return next;
      });
    },
    [],
  );
  const clearAutoModeChange = useMemo(() => () => setAutoModeChange(null), []);

  useEffect(() => {
    document.documentElement.dataset["displayMode"] = mode;
    try {
      window.localStorage.setItem(DISPLAY_MODE_STORAGE_KEY, mode);
    } catch {
      // The preference remains active for this session when storage is unavailable.
    }
  }, [mode]);

  useEffect(() => {
    const syncMode = (event: StorageEvent) => {
      if (
        event.key === DISPLAY_MODE_STORAGE_KEY
        && isDisplayMode(event.newValue)
      ) {
        setModeState(event.newValue);
        setAutoModeChange(null);
      }
    };
    window.addEventListener("storage", syncMode);
    return () => window.removeEventListener("storage", syncMode);
  }, []);

  const value = useMemo<DisplayModeContextValue>(
    () => ({ mode, setMode, autoModeChange, clearAutoModeChange }),
    [mode, setMode, autoModeChange, clearAutoModeChange],
  );
  return (
    <DisplayModeContext.Provider value={value}>
      {children}
    </DisplayModeContext.Provider>
  );
}

export function useDisplayMode(): DisplayModeContextValue {
  return useContext(DisplayModeContext);
}

export function DisplayModeGate({
  minimum,
  children,
}: {
  readonly minimum: DisplayMode;
  readonly children: ReactNode;
}) {
  const { mode } = useDisplayMode();
  return displayModeAtLeast(mode, minimum) ? children : null;
}

const MODE_LABEL: Readonly<Record<DisplayMode, string>> = {
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
  if (autoModeChange === null) return null;
  return (
    <div className={styles.notice} role="status">
      <span>표시 모드가 <strong>{MODE_LABEL[mode]}</strong>으로 바뀌었습니다.</span>
      <Button
        size="small"
        variant="quiet"
        onPress={() => { setMode(autoModeChange.from); clearAutoModeChange(); }}
      >
        {MODE_LABEL[autoModeChange.from]}으로 되돌리기
      </Button>
    </div>
  );
}

export function DisplayModeSelector({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const { mode, setMode } = useDisplayMode();
  return (
    <div
      className={`${styles.selector} ${compact ? styles.compact : ""}`}
      role="group"
      aria-label="Admin 표시 모드"
    >
      {displayModes.map((item) => (
        <Button
          key={item.id}
          size="small"
          variant={mode === item.id ? "secondary" : "quiet"}
          aria-pressed={mode === item.id}
          onPress={() => setMode(item.id)}
          className={styles.option}
        >
          <span>{item.label}</span>
          {!compact ? <small>{item.description}</small> : null}
        </Button>
      ))}
    </div>
  );
}
