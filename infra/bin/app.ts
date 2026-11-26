#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DisasterResponseStack } from '../lib/stack';

const app = new cdk.App();
new DisasterResponseStack(app, 'DisasterResponse', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
