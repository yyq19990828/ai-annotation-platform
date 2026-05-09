import { WorkbenchShell } from "./shell/WorkbenchShell";

export function WorkbenchPage({ mode }: { mode?: "annotate" | "review" }) {
  return <WorkbenchShell mode={mode} />;
}
