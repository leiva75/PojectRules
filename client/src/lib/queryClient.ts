import { QueryClient, QueryFunction } from "@tanstack/react-query";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

const NO_REFRESH_URLS = ["/api/auth/login", "/api/auth/employee-login", "/api/auth/refresh", "/api/auth/logout", "/api/auth/employee/login", "/api/auth/employee/refresh", "/api/auth/employee/logout", "/api/auth/employee/me", "/api/me/"];

async function fetchWithRefresh(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);

  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : (input as Request).url;
  const isAuthRoute = NO_REFRESH_URLS.some((p) => url.includes(p));

  if (res.status === 401 && !isAuthRoute) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return fetch(input, init);
    }

    window.dispatchEvent(new CustomEvent("auth:session-expired"));
  }

  return res;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetchWithRefresh(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    let url = queryKey[0] as string;
    
    if (queryKey.length > 1) {
      const params = queryKey[1];
      if (typeof params === "object" && params !== null) {
        const searchParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value));
          }
        }
        const queryString = searchParams.toString();
        if (queryString) {
          url += `?${queryString}`;
        }
      } else if (params !== undefined && params !== null) {
        url += `/${params}`;
      }
    }
    
    const res = await fetchWithRefresh(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
