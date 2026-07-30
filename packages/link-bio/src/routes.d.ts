import { Hono } from 'hono';
type AppBindings = {
    Variables: {
        userId: string;
        orgId: string;
    };
};
declare const router: Hono<AppBindings, import("hono/types").BlankSchema, "/">;
export { router as linkBioRoutes };
//# sourceMappingURL=routes.d.ts.map