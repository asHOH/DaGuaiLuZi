import { z } from "zod";

import { createApp } from "./app.js";

const RuntimeConfigurationSchema = z.object({
  DGLZ_ALLOWED_ORIGIN: z.url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }),
  DGLZ_DB_PATH: z.string().min(1).default("data/daguailuzi.sqlite"),
  DGLZ_HOST: z.string().min(1).default("127.0.0.1"),
  DGLZ_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DGLZ_SECURE_COOKIES: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

async function start(): Promise<void> {
  const configuration = RuntimeConfigurationSchema.parse(process.env);
  const app = await createApp({
    allowedOrigin: configuration.DGLZ_ALLOWED_ORIGIN,
    dbPath: configuration.DGLZ_DB_PATH,
    logger: true,
    secureCookies: configuration.DGLZ_SECURE_COOKIES,
  });
  await app.listen({
    host: configuration.DGLZ_HOST,
    port: configuration.DGLZ_PORT,
  });
}

start().catch(() => {
  process.stderr.write("服务器启动失败\n");
  process.exitCode = 1;
});
