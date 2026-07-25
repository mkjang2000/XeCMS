import { useEffect, useRef, useState } from "react";
import type { AdminAppRuntimeDto } from "@xecms/contracts";
import type { ComposedPageDefinition, AppPresentationDefinition } from "@xecms/admin-apps";

import type { AdminRuntimeDataClient } from "./api.js";
import { renderComposedComponent } from "./composed-components.js";
import { ComposedRuntimeProvider, type PluginComponentRegistry } from "./composed-runtime.js";
import {
  CANVAS_WIDTH,
  MAX_SCALE,
  ROW_HEIGHT,
  baseViewportHeight,
  computeShellScale,
  placementStyle,
  type LayoutProfile,
} from "./composed-geometry.js";
import styles from "./runtime.module.css";

export interface ComposedPageProps {
  readonly runtime: AdminAppRuntimeDto;
  readonly page: ComposedPageDefinition;
  readonly client: AdminRuntimeDataClient;
  readonly navigate: (pageId: string) => void;
  /** Trusted Plugin Component renderers, keyed by namespaced kind (CPB-9). */
  readonly plugins?: PluginComponentRegistry;
}

/**
 * Static grid Runtime for a Composed Page. Components are placed on a fixed
 * 48-column canvas; the whole canvas is scaled by a single factor (never
 * enlarged, floored for readability) so smaller viewports scroll instead of
 * reflowing (§4.2, D-03/D-16/D-22). Data binding arrives in CPB-4.
 */
export function ComposedPage({ runtime, page, client, navigate, plugins }: ComposedPageProps) {
  const presentation = runtimePresentation(runtime);
  const profile: LayoutProfile = presentation.layoutProfile;
  const containerRef = useRef<HTMLDivElement>(null);
  const scale = useShellScale(containerRef, profile);
  const fieldNames = new Map<string, string>();
  const fieldTypes = new Map<string, string>();
  for (const collection of runtime.schema.collections) {
    for (const field of collection.fields) {
      fieldNames.set(field.id, field.name);
      fieldTypes.set(field.id, field.type);
    }
  }

  const canvasHeight = Math.max(
    baseViewportHeight(profile),
    // Extend the canvas to fit the lowest component.
    ...page.components.map((component) => (component.placement.y + component.placement.height) * ROW_HEIGHT),
  );

  return (
    <ComposedRuntimeProvider page={page} client={client} fieldNames={fieldNames} fieldTypes={fieldTypes} navigate={navigate} access={runtime.access.actions} plugins={plugins}>
      <div
        ref={containerRef}
        className={styles.composedViewport}
        data-alignment={presentation.canvasAlignment}
      >
        <div
          className={styles.composedCanvas}
          style={{
            width: CANVAS_WIDTH,
            minHeight: canvasHeight,
            transform: `scale(${scale})`,
            transformOrigin: presentation.canvasAlignment === "top-left" ? "top left" : "top center",
          }}
          aria-label={page.title}
        >
          {page.components.map((component) => (
            <div key={component.id} className={styles.composedCell} style={placementStyle(component.placement)}>
              {renderComposedComponent(component)}
            </div>
          ))}
        </div>
      </div>
    </ComposedRuntimeProvider>
  );
}

function runtimePresentation(runtime: AdminAppRuntimeDto): AppPresentationDefinition {
  const manifest = runtime.manifest;
  if (manifest.formatVersion === 2) return manifest.presentation;
  return { layoutProfile: "16:9", menuPosition: "left", canvasAlignment: "top-center" };
}

/** Tracks the container size and derives the single shell scale. */
function useShellScale(
  ref: React.RefObject<HTMLDivElement | null>,
  profile: LayoutProfile,
): number {
  const [scale, setScale] = useState(MAX_SCALE);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const { width, height } = element.getBoundingClientRect();
      setScale(computeShellScale(width, height, profile));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, profile]);
  return scale;
}
