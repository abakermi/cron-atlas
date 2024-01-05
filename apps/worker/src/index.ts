import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
  Runtime,
  makeTelemetryFilterString,
  DefaultLogger,
} from "@temporalio/worker";
import * as activities from "@cront-atlas/workflow/activities";
import { constants } from "@cront-atlas/workflow";
import { createLogger } from "./logger";

function ConfigureRuntime() {
  const USE_PINO_LOGGER =
    process.env.AXIOM_DATASET && process.env.AXIOM_API_TOKEN;

  if (USE_PINO_LOGGER) {
    const pino = createLogger();

    // Configure Rust Core runtime to collect logs generated by Node.js Workers and Rust Core.
    Runtime.install({
      // Note: In production, WARN should generally be enough.
      // https://typescript.temporal.io/api/namespaces/worker#loglevel
      logger: new DefaultLogger("INFO", (entry) => {
        const log = {
          label: entry.meta?.activityId
            ? "activity"
            : entry.meta?.workflowId
            ? "workflow"
            : "worker",
          msg: entry.message,
          timestamp: Number(entry.timestampNanos / 1000000n),
          metadata: entry.meta,
        };

        switch (entry.level) {
          case "DEBUG":
            pino.debug(log);
            break;
          case "INFO":
            pino.info(log);
            break;
          case "WARN":
            pino.warn(log);
            break;
          case "ERROR":
            pino.error(log);
            break;
          case "TRACE":
            pino.trace(log);
            break;

          default:
            console.log(log);
            break;
        }
      }),
      // Telemetry options control how logs are exported out of Rust Core.
      telemetryOptions: {
        logging: {
          // This filter determines which logs should be forwarded from Rust Core to the Node.js logger. In production, WARN should generally be enough.
          filter: makeTelemetryFilterString({ core: "WARN" }),
        },
      },
    });
  }
}

async function run() {
  const address = process.env.TEMPORAL_SERVER_ADDRESS || "localhost:7233";
  const certificate = process.env.TEMPORAL_TLS_CERTIFICATE;
  const key = process.env.TEMPORAL_TLS_PRIVATE_KEY;

  ConfigureRuntime();

  const connection = await NativeConnection.connect({
    address,
    tls:
      certificate && key
        ? {
            clientCertPair: {
              crt: Buffer.from(certificate),
              key: Buffer.from(key),
            },
          }
        : undefined,
  });

  const { code } = await bundleWorkflowCode({
    workflowsPath: require.resolve("@cront-atlas/workflow/workflows"),
  });

  const worker = await Worker.create({
    workflowBundle: {
      code,
    },
    activities,
    connection,
    taskQueue: constants.QUEUE,
    namespace: constants.NAMESPACE,
  });

  await worker.run();
  connection.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
