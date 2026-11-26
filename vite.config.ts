import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

interface DevAccountApi {
  handle: (request: unknown, response: unknown) => Promise<void>;
}

interface DevHttpRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface DevHttpResponse {
  statusCode: number;
  end(body?: string): void;
}

function loopbackOnly(host: string | string[] | undefined): boolean {
  const raw = Array.isArray(host) ? host[0] : host;
  const name = (raw ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'local-account-api',
      apply: 'serve',
      configureServer(server) {
        let loading: Promise<DevAccountApi> | null = null;
        server.middlewares.use((request, response, next) => {
          const req = request as unknown as DevHttpRequest;
          const res = response as unknown as DevHttpResponse;
          if (!req.url?.startsWith('/functions/v1/app/')) return next();
          if (!loopbackOnly(req.headers.host)) {
            res.statusCode = 403;
            res.end('dev account api is loopback-only');
            return;
          }
          if (!loading) {
            // @ts-expect-error 开发中间件直接复用无类型声明的后端 .mjs 模块
            loading = import('./dev/account-api.mjs').then((module) => module.createDevAccountApi() as DevAccountApi);
          }
          void loading
            .then((api) => api.handle(request, response))
            .catch((error: unknown) => next(error));
        });
      },
    },
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});