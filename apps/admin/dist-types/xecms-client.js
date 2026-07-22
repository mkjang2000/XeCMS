import { createXeCmsClient } from "@xecms/client";
/**
 * The browser client owns the in-memory CSRF token stores. Keep one instance for
 * the whole Admin bundle so route loaders and lazily loaded pages share them.
 */
export const xecmsClient = createXeCmsClient();
//# sourceMappingURL=xecms-client.js.map