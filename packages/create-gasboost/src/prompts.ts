import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import {
  normalizeCapabilities,
  type CapabilitySelection,
} from "./capabilities.js";

export async function promptCapabilities({
  input = process.stdin,
  output = process.stdout,
}: {
  readonly input?: Readable;
  readonly output?: Writable;
} = {}): Promise<CapabilitySelection> {
  const readline = createInterface({
    input,
    output,
  });

  try {
    let database = await askYesNo({
      readline,
      output,
      question: "Database? (Sheets)",
      description: "Store application data in Google Sheets.",
    });

    let authentication = await askYesNo({
      readline,
      output,
      question: "Authentication?",
      description:
        "Add application user accounts. Selecting Yes also enables Database.",
    });

    if (authentication && !database) {
      database = true;
      output.write("Database enabled because Authentication requires it.\n");
    }

    let frontend = await askYesNo({
      readline,
      output,
      question: "Frontend? (React)",
      description: "Add a React browser application.",
    });

    let realtime = false;

    if (database && frontend) {
      realtime = await askYesNo({
        readline,
        output,
        question: "Realtime? (Firebase RTDB)",
        description:
          "Keep browser data synchronized through Firebase. Selecting Yes also enables Authentication.",
      });

      if (realtime && !authentication) {
        authentication = true;
        output.write("Authentication enabled because Realtime requires it.\n");
      }
    }

    return normalizeCapabilities({
      database,
      authentication,
      frontend,
      realtime,
    });
  } finally {
    readline.close();
  }
}

async function askYesNo({
  readline,
  output,
  question,
  description,
}: {
  readonly readline: ReturnType<typeof createInterface>;
  readonly output: Writable;
  readonly question: string;
  readonly description: string;
}): Promise<boolean> {
  output.write(`\n${question}\n`);
  output.write(`${description}\n`);

  while (true) {
    const answer = (await readline.question("[y/N] ")).trim().toLowerCase();

    if (answer === "" || answer === "n" || answer === "no") {
      return false;
    }

    if (answer === "y" || answer === "yes") {
      return true;
    }

    output.write("Please answer y or n.\n");
  }
}
