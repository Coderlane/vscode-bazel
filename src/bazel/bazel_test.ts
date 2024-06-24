// Copyright 2022 The Bazel Authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as child_process from "child_process";

import { BazelCommand } from "./bazel_command";

/** Provides a promise-based API around the `bazel test` command. */
export class BazelTest extends BazelCommand {
  /**
   * Runs the query and returns a {@code QueryResult} containing the targets
   * that match.
   *
   * @param target The test to run.
   * @param output A callback to fill with output from the test.
   */
  public async testTarget(
    target: string,
    output: (data: string) => void,
    {
      additionalArgs = [],
    }: {
      additionalArgs?: string[];
    } = {},
  ): Promise<number> {
    const testProcess = child_process.spawn(
      this.bazelExecutable,
      this.execArgs([...additionalArgs, target]),
      {
        cwd: this.workingDirectory,
      },
    );
    testProcess.stdout.on("data", output);
    testProcess.stderr.on("data", output);
    return await new Promise((resolve) => {
      testProcess.on("close", resolve);
    });
  }

  protected bazelCommand(): string {
    return "test";
  }
}
