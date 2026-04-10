/**
 * Post-deployment integration test for passwordless email OTP authentication.
 *
 * Usage:
 *   npm run test:e2e
 *
 * Environment variables (auto-fetched from CDK outputs if not set):
 *   USER_POOL_ID       - Cognito User Pool ID
 *   USER_POOL_CLIENT_ID - Cognito User Pool Client ID
 *   AWS_REGION         - AWS Region (default: eu-west-1)
 *   TEST_EMAIL         - Email for testing (default: test-user@example.com)
 */

import { execSync } from 'child_process';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logStep(step: number, message: string) {
  log(`\n[${step}/4] ${message}`, colors.cyan);
}

function logSuccess(message: string) {
  log(`  ✓ ${message}`, colors.green);
}

function logError(message: string) {
  log(`  ✗ ${message}`, colors.red);
}

function logInfo(message: string) {
  log(`  → ${message}`, colors.dim);
}

// Get CDK stack outputs
function getStackOutputs(): { userPoolId: string; clientId: string } {
  // Try environment variables first
  if (process.env.USER_POOL_ID && process.env.USER_POOL_CLIENT_ID) {
    return {
      userPoolId: process.env.USER_POOL_ID,
      clientId: process.env.USER_POOL_CLIENT_ID,
    };
  }

  // Try to get from CDK outputs
  log('\nFetching stack outputs from CDK...', colors.dim);
  try {
    const outputs = execSync('npx cdk context --json 2>/dev/null || echo "{}"', {
      encoding: 'utf-8',
    });

    // Try CloudFormation describe-stacks
    const cfnOutputs = execSync(
      'aws cloudformation describe-stacks --stack-name AwsCognitoStack --query "Stacks[0].Outputs" --output json 2>/dev/null',
      { encoding: 'utf-8' }
    );

    const parsed = JSON.parse(cfnOutputs);
    const userPoolId = parsed.find((o: { OutputKey: string }) => o.OutputKey === 'UserPoolId')?.OutputValue;
    const clientId = parsed.find((o: { OutputKey: string }) => o.OutputKey === 'UserPoolClientId')?.OutputValue;

    if (userPoolId && clientId) {
      return { userPoolId, clientId };
    }
  } catch {
    // Fall through to error
  }

  throw new Error(
    'Could not get stack outputs. Set USER_POOL_ID and USER_POOL_CLIENT_ID environment variables.'
  );
}

async function main() {
  log('\n' + '='.repeat(60), colors.bright);
  log('  Passwordless Email OTP Authentication Test', colors.bright);
  log('='.repeat(60), colors.bright);

  // Step 1: Get configuration
  logStep(1, 'Getting configuration...');

  let userPoolId: string;
  let clientId: string;

  try {
    const outputs = getStackOutputs();
    userPoolId = outputs.userPoolId;
    clientId = outputs.clientId;
    logSuccess(`User Pool ID: ${userPoolId}`);
    logSuccess(`Client ID: ${clientId}`);
  } catch (error) {
    logError((error as Error).message);
    process.exit(1);
  }

  const region = process.env.AWS_REGION || 'eu-west-1';
  const testEmail = process.env.TEST_EMAIL || `test-${Date.now()}@example.com`;

  logInfo(`Region: ${region}`);
  logInfo(`Test Email: ${testEmail}`);

  const client = new CognitoIdentityProviderClient({ region });

  // Step 2: Sign up user (if not exists)
  logStep(2, 'Signing up user...');

  try {
    await client.send(
      new SignUpCommand({
        ClientId: clientId,
        Username: testEmail,
        Password: crypto.randomUUID() + 'Aa1!', // Random password (not used for login)
        UserAttributes: [{ Name: 'email', Value: testEmail }],
      })
    );
    logSuccess('User created successfully');
  } catch (error: unknown) {
    if ((error as { name?: string }).name === 'UsernameExistsException') {
      logInfo('User already exists, continuing...');
    } else {
      logError(`Sign up failed: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  // Step 3: Initiate custom auth
  logStep(3, 'Initiating custom auth flow...');

  let session: string;
  let otp: string;

  try {
    const authResponse = await client.send(
      new InitiateAuthCommand({
        AuthFlow: 'CUSTOM_AUTH',
        ClientId: clientId,
        AuthParameters: {
          USERNAME: testEmail,
        },
      })
    );

    if (!authResponse.Session || !authResponse.ChallengeParameters?.otp) {
      throw new Error('Missing session or OTP in response');
    }

    session = authResponse.Session;
    otp = authResponse.ChallengeParameters.otp;

    logSuccess(`Challenge received: ${authResponse.ChallengeName}`);
    logSuccess(`OTP received: ${otp}`);
    logInfo(`Session: ${session.substring(0, 20)}...`);
  } catch (error) {
    logError(`Auth initiation failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Step 4: Respond to challenge
  logStep(4, 'Verifying OTP...');

  try {
    const verifyResponse = await client.send(
      new RespondToAuthChallengeCommand({
        ClientId: clientId,
        ChallengeName: 'CUSTOM_CHALLENGE',
        Session: session,
        ChallengeResponses: {
          USERNAME: testEmail,
          ANSWER: otp,
        },
      })
    );

    if (!verifyResponse.AuthenticationResult?.AccessToken) {
      throw new Error('No tokens received');
    }

    logSuccess('Authentication successful!');
    logSuccess(`Access Token: ${verifyResponse.AuthenticationResult.AccessToken.substring(0, 30)}...`);
    logSuccess(`ID Token: ${verifyResponse.AuthenticationResult.IdToken?.substring(0, 30)}...`);
    logSuccess(`Refresh Token: ${verifyResponse.AuthenticationResult.RefreshToken?.substring(0, 30)}...`);
    logInfo(`Token Type: ${verifyResponse.AuthenticationResult.TokenType}`);
    logInfo(`Expires In: ${verifyResponse.AuthenticationResult.ExpiresIn} seconds`);
  } catch (error) {
    logError(`Verification failed: ${(error as Error).message}`);
    process.exit(1);
  }

  // Summary
  log('\n' + '='.repeat(60), colors.bright);
  log('  All tests passed!', colors.green + colors.bright);
  log('='.repeat(60), colors.bright);
  log('');
}

main().catch((error) => {
  logError(`Unexpected error: ${error.message}`);
  process.exit(1);
});
