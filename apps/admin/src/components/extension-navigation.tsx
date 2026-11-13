import { useQuery } from "@tanstack/react-query";
import { xecmsClient } from "../xecms-client.js";
import type { EngineExtensionDto } from "@xecms/client";
import { Icon } from "./icon.js";
import styles from "../app-shell.module.css";

export function extensionNavigationItems(extensions: readonly EngineExtensionDto[]) {
  return extensions.flatMap((extension) => {
    if (extension.admin === undefined) return [];
    const { href, label } = extension.admin;
    if (!(href.startsWith("/") && !href.startsWith("//")) && !/^https?:\/\//.test(href)) return [];
    return [{ id: extension.id, href, label }];
  });
}

/** Extension links open their own bundles; the engine never imports their UI. */
export function ExtensionNavigation() {
  const extensions = useQuery({
    queryKey: ["engine-extensions"],
    queryFn: () => xecmsClient.extensions.list(),
    retry: false,
  });
  const items = extensionNavigationItems(extensions.data?.items ?? []);
  if (items.length === 0) return null;
  return <section className={styles.navGroup} aria-labelledby="admin-nav-extensions">
    <span className={styles.navGroupLabel} id="admin-nav-extensions">확장</span>
    {items.map((item) => <a key={item.id} href={item.href}>
      <Icon name="workspace" size={18} /><span>{item.label}</span>
    </a>)}
  </section>;
}
