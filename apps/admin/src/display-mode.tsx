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
  readonly setMode: (mode: DisplayMode) => void;
}

const DisplayModeContext = createContext<DisplayModeContextValue>({
  mode: "basic",
  setMode: () => undefined,
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
      }
    };
    window.addEventListener("storage", syncMode);
    return () => window.removeEventListener("storage", syncMode);
  }, []);

  const value = useMemo<DisplayModeContextValue>(
    () => ({ mode, setMode: setModeState }),
    [mode],
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
