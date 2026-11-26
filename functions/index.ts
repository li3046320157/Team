import { createSiteContext, createDatabaseClient, errorResponse } from './_qoder/backend.mjs';
import { createApplication } from './router.mjs';

// 固定生产来源；不使用请求 Host，避免来源伪造。
const PUBLIC_ORIGIN = 'https://moneyflow-eia97wm6wyg.qoder.zone';

const handle = createApplication({ db: createDatabaseClient(), origin: PUBLIC_ORIGIN });

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request, { forwardApplicationCredentials: true });
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});