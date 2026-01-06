#!/usr/bin/env node
import * as cdk from "aws-cdk-lib/core";
import { AwsCognitoStack } from "../lib/aws-cognito-stack";

const app = new cdk.App();
new AwsCognitoStack(app, process.env.STACK_NAME!, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
