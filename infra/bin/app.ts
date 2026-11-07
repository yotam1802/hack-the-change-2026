#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { WaitWatchStack } from "../lib/waitwatch-stack";

const app = new App();
new WaitWatchStack(app, "WaitWatch", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ca-central-1",
  },
});
