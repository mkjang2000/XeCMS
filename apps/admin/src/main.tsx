import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminApiProvider, toAdminApiError } from "@xecms/admin";
import "@xecms/ui/theme.css";
import { createAdminApi } from "./client-adapter.js";
import { DisplayModeProvider } from "./display-mode.js";
import { createAdminRouter } from "./router.js";

const api = createAdminApi();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = toAdminApiError(error).status;
        return status !== 401 && status !== 403 && status !== 404 && failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
const router = createAdminRouter(api, queryClient);
const rootElement = document.getElementById("root");

if (rootElement === null) throw new Error("Admin root element was not found.");

createRoot(rootElement).render(
  <StrictMode>
    <AdminApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <DisplayModeProvider>
          <RouterProvider router={router} />
        </DisplayModeProvider>
      </QueryClientProvider>
    </AdminApiProvider>
  </StrictMode>,
);
