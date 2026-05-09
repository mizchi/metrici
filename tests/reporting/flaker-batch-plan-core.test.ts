import { describe, expect, it } from "vitest";
import {
  buildFlakerBatchPlan,
  renderFlakerBatchPlanMarkdown,
  renderGitHubMatrix,
} from "../../src/cli/reporting/flaker-batch-plan-core.js";

const FLAKER_STAR = `
workflow(name="crater-tests", max_parallel=4)

node(id="layout", depends_on=[])
node(id="browser", depends_on=["layout"])

task(
  id="paint-vrt",
  node="layout",
  cmd=["pnpm", "exec", "playwright", "test", "tests/paint-vrt.test.ts"],
  srcs=["src/layout/**"],
  needs=[],
  trigger="auto",
)

task(
  id="wpt-vrt",
  node="layout",
  cmd=["pnpm", "exec", "playwright", "test", "tests/wpt-vrt.test.ts"],
  srcs=["src/layout/**"],
  needs=["paint-vrt"],
  trigger="auto",
)

task(
  id="manual-investigation",
  node="browser",
  cmd=["pnpm", "exec", "playwright", "test", "tests/manual.test.ts"],
  srcs=["browser/**"],
  needs=[],
  trigger="manual",
)
`;

describe("buildFlakerBatchPlan", () => {
  it("selects auto-trigger tasks by default", () => {
    const plan = buildFlakerBatchPlan(FLAKER_STAR);

    expect(plan.workflowName).toBe("crater-tests");
    expect(plan.tasks.map((task) => task.id)).toEqual([
      "paint-vrt",
      "wpt-vrt",
    ]);
  });

  it("filters by task ids and nodes", () => {
    const plan = buildFlakerBatchPlan(FLAKER_STAR, {
      tasks: ["paint-vrt", "wpt-vrt", "manual-investigation"],
      nodes: ["layout"],
    });

    expect(plan.tasks.map((task) => task.id)).toEqual(["paint-vrt", "wpt-vrt"]);
  });
});

describe("renderers", () => {
  it("renders markdown and GitHub matrix output", () => {
    const plan = buildFlakerBatchPlan(FLAKER_STAR, { tasks: ["paint-vrt", "wpt-vrt"] });

    expect(renderFlakerBatchPlanMarkdown(plan)).toContain("| paint-vrt | layout |");
    expect(renderGitHubMatrix(plan)).toBe(
      JSON.stringify({
        include: [
          { task_id: "paint-vrt", node: "layout" },
          { task_id: "wpt-vrt", node: "layout" },
        ],
      }),
    );
  });
});
