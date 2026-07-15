import { createContext, useContext, type ReactNode } from "react";
import type { AdminApi } from "./api.js";

const AdminApiContext = createContext<AdminApi | null>(null);

export function AdminApiProvider({ api, children }: { readonly api: AdminApi; readonly children: ReactNode }) {
  return <AdminApiContext.Provider value={api}>{children}</AdminApiContext.Provider>;
}

export function useAdminApi(): AdminApi {
  const api = useContext(AdminApiContext);
  if (api === null) throw new Error("AdminApiProvider is missing from the component tree.");
  return api;
}
