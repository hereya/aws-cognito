# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Test Commands

- `npm run build` - Compile TypeScript to JavaScript
- `npm test` - Run unit tests (CDK stack + Lambda tests)
- `npm run test:e2e` - Run e2e tests (auto-deploys, tests, then destroys stack)
- `npx cdk synth` - Synthesize CloudFormation template
- `npx cdk deploy` - Deploy stack to AWS
- `npx cdk destroy` - Destroy deployed stack

Run a single test file:
```bash
npx jest test/lambda/create-auth-challenge.test.ts
```

## Architecture

This is an AWS CDK stack for passwordless email OTP authentication using Cognito Custom Auth Flow.

**Auth Flow:** User → Cognito (Custom Auth) → Lambda Triggers → DynamoDB

### Stack Resources (lib/aws-cognito-stack.ts)

- **DynamoDB OTP Table**: Stores OTP codes with TTL for automatic expiration
- **DynamoDB Sessions Table**: Server-side session storage for refresh tokens (encrypted, GSI for userId)
- **Cognito User Pool**: Email-only sign-in, custom auth enabled, no auto-verify
- **User Pool Client**: Custom auth and SRP flows enabled

### Lambda Triggers (lambda/)

Four Cognito trigger functions implementing the custom auth flow:

1. **pre-sign-up**: Auto-confirms users, marks email as not verified
2. **define-auth-challenge**: Controls auth flow state machine, allows 3 attempts
3. **create-auth-challenge**: Generates 6-digit OTP, stores in DynamoDB, returns in challenge parameters
4. **verify-auth-challenge**: Validates OTP against DynamoDB, marks email verified on success

### Test Structure

- `test/aws-cognito.test.ts` - CDK infrastructure assertions
- `test/lambda/*.test.ts` - Lambda unit tests with mocked AWS SDK
- `test/e2e/auth.e2e.test.ts` - End-to-end tests against deployed stack

## Stack Deployment

Stack name is set via `STACK_NAME` environment variable. CDK auto-generates unique resource names to allow multiple deployments on the same account.

## Stack Outputs

- `userPoolId` - Cognito User Pool ID
- `userPoolClientId` - User Pool Client ID
- `otpTableName` - DynamoDB OTP table name
- `sessionsTableName` - DynamoDB sessions table name
- `region` - AWS region
- `iamPolicyForCognito` - IAM policy JSON for consuming applications
