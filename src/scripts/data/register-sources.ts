import { OFFICIAL_SOURCES, registerSource, runIngestion } from "../../lib/data-platform.js";

await runIngestion({ domain: "platform", jobName: "register-official-sources", mode: (process.env.INGESTION_MODE as any) ?? "incremental" }, async ({ dryRun }) => {
  if (!dryRun) for (const source of OFFICIAL_SOURCES) await registerSource(source);
  console.log(`${dryRun ? "Would register" : "Registered"} ${OFFICIAL_SOURCES.length} official sources.`);
  return { result: undefined, rowsRead: OFFICIAL_SOURCES.length, rowsWritten: dryRun ? 0 : OFFICIAL_SOURCES.length };
});
