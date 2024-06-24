import * as vscode from "vscode";
import { BazelFileCoverage, parseLcov } from "./lcov_parser";
import {
  BazelWorkspaceInfo,
  BazelQuery,
  BazelTest,
  BazelInfo,
  BazelCoverage,
} from "../bazel";
import { getDefaultBazelExecutablePath } from "../extension/configuration";

let testController: vscode.TestController;
let coverageRunProfile: vscode.TestRunProfile;

export function activateTesting(): vscode.Disposable[] {
  const subscriptions: vscode.Disposable[] = [];

  // Create the test controller
  testController = vscode.tests.createTestController(
    "vscode-bazel.Test",
    "Bazel Test",
  );
  subscriptions.push(testController);

  testController.refreshHandler = refreshHandler;

  // Create the test run profiles
  testController.createRunProfile(
    "Run",
    vscode.TestRunProfileKind.Run,
    runHandler,
    true,
  );
  coverageRunProfile = testController.createRunProfile(
    "Coverage",
    vscode.TestRunProfileKind.Coverage,
    runHandler,
    false,
  );
  // `loadDetailedCoverage` is important so that line coverage data is shown.
  coverageRunProfile.loadDetailedCoverage = (_, coverage) =>
    Promise.resolve((coverage as BazelFileCoverage).details);

  return subscriptions;
}

async function refreshHandler(token: vscode.CancellationToken) {
  const workspaceInfo = await BazelWorkspaceInfo.fromWorkspaceFolders();
  if (!workspaceInfo) {
    return;
  }
  const queryResult = await new BazelQuery(
    getDefaultBazelExecutablePath(),
    workspaceInfo.workspaceFolder.uri.fsPath,
  ).queryTargets("kind('.*_test rule', ...)", { sortByRuleName: true });
  queryResult.target.forEach((target) => {
    if (token.isCancellationRequested) {
      return;
    }
    if (testController.items.get(target.rule.name)) {
      return;
    }
    const test = testController.createTestItem(
      target.rule.name,
      target.rule.name,
    );
    testController.items.add(test);
  });
}

async function runHandler(
  request: vscode.TestRunRequest,
  token: vscode.CancellationToken,
) {
  const run = testController.createTestRun(request);
  const workspaceInfo = await BazelWorkspaceInfo.fromWorkspaceFolders();
  const tests: vscode.TestItem[] = [];
  if (request.include) {
    request.include.forEach((test) => {
      run.enqueued(test);
      tests.push(test);
    });
  } else {
    testController.items.forEach((test) => {
      if (request.exclude?.includes(test)) {
        return;
      }
      run.enqueued(test);
      tests.push(test);
    });
  }
  const isCoverageRun =
    request.profile.kind === vscode.TestRunProfileKind.Coverage;
  while (tests.length > 0 && !token.isCancellationRequested) {
    const test = tests.pop();
    const bazelTest = isCoverageRun
      ? new BazelCoverage(
          getDefaultBazelExecutablePath(),
          workspaceInfo.workspaceFolder.uri.fsPath,
        )
      : new BazelTest(
          getDefaultBazelExecutablePath(),
          workspaceInfo.workspaceFolder.uri.fsPath,
        );
    await runTest(workspaceInfo, run, test, bazelTest, isCoverageRun);
  }
  run.end();
}

async function runTest(
  workspaceInfo: BazelWorkspaceInfo,
  run: vscode.TestRun,
  test: vscode.TestItem,
  bazelTest: BazelTest,
  isCoverageRun: boolean,
) {
  const start = Date.now();
  run.started(test);
  const testResult = await bazelTest.testTarget(
    test.label,
    (output: string) => {
      run.appendOutput(output.toString().replaceAll("\n", "\r\n"), test);
    },
    {
      additionalArgs: [
        "--curses=no",
        "--color=yes",
        "--test_output=all",
        "--combined_report=lcov",
      ],
    },
  );
  const duration = Date.now() - start;
  if (testResult !== 0) {
    run.failed(test, new vscode.TestMessage("failed"), duration);
    return;
  }
  if (isCoverageRun) {
    try {
      await collectCoverage(workspaceInfo, run);
    } catch (e: any) {
      run.errored(
        test,
        new vscode.TestMessage(`Error parsing coverage data: ${e}`),
        duration,
      );
      return;
    }
  }
  run.passed(test, duration);
}

async function collectCoverage(
  workspaceInfo: BazelWorkspaceInfo,
  run: vscode.TestRun,
) {
  const outputPath = await new BazelInfo(
    getDefaultBazelExecutablePath(),
    workspaceInfo.bazelWorkspacePath,
  ).getOne("output_path");
  const lcovRawBytes = await vscode.workspace.fs.readFile(
    vscode.Uri.file(outputPath + "/_coverage/_coverage_report.dat"),
  );
  const lcovData = new TextDecoder("utf8").decode(lcovRawBytes);
  for (const c of await parseLcov(workspaceInfo.bazelWorkspacePath, lcovData)) {
    run.addCoverage(c);
  }
}

/**
 * Display coverage information from a `.lcov` file.
 */
export async function showLcovCoverage(
  description: string,
  baseFolder: string,
  lcov: string,
) {
  const run = testController.createTestRun(
    new vscode.TestRunRequest(undefined, undefined, coverageRunProfile),
    null,
    false,
  );
  run.appendOutput(description.replaceAll("\n", "\r\n"));
  for (const c of await parseLcov(baseFolder, lcov)) {
    run.addCoverage(c);
  }
  run.end();
}
