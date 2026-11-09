// Resets the database to the demo starting state.
// Usage: npm run seed              (reads .env.local; restores the saved AI analyses)
//        npm run seed -- --fresh   (pending reports stay un-analysed, for npm run analyse:pending)
import { resetDemo } from "../src/lib/seed";

const fresh = process.argv.includes("--fresh");

resetDemo({ restoreAnalyses: !fresh })
  .then((r) =>
    console.log(`Seeded ${r.tickets} tickets and ${r.feedback} feedback items${fresh ? " (no saved analyses)" : ""}.`),
  )
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
