// One-click sync to GitHub:  npm run sync  ["your message"]
// Stages everything, commits (skips if nothing changed), and pushes to origin.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "pipe" }).toString().trim();
const say = (m) => process.stdout.write(m + "\n");

try {
  // 1. stage all changes
  run("git add -A");

  // 2. anything to commit?
  const staged = run("git diff --cached --name-only");
  if (!staged) {
    say("✓ Nothing changed — already in sync with GitHub.");
  } else {
    const files = staged.split("\n").length;
    const msg =
      process.argv.slice(2).join(" ").trim() ||
      `sync: ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    run(`git commit -m ${JSON.stringify(msg)}`);
    say(`✓ Committed ${files} file(s): "${msg}"`);
  }

  // 3. push (works even if only an earlier commit was unpushed)
  const branch = run("git rev-parse --abbrev-ref HEAD");
  say(`↑ Pushing ${branch} to GitHub…`);
  run(`git push origin ${branch}`);
  say("✅ Synced to GitHub.");
} catch (e) {
  const out = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
  say("✗ Sync failed:\n" + out.trim());
  say(
    "\nTip: if it mentions auth, complete the GitHub device login first " +
      "(https://github.com/login/device)."
  );
  process.exit(1);
}
