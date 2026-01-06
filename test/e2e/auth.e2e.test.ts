/**
 * E2E tests for passwordless email OTP authentication.
 *
 * These tests run against a deployed stack and verify the full auth flow.
 *
 * Usage:
 *   npm run test:e2e
 *
 * Required: Stack must be deployed first with `npx cdk deploy`
 */

import { execSync } from 'child_process';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  SignUpCommand,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

describe('Passwordless Email OTP Authentication E2E', () => {
  let client: CognitoIdentityProviderClient;
  let userPoolId: string;
  let clientId: string;
  let testEmail: string;
  const region = process.env.AWS_REGION || 'eu-west-1';

  beforeAll(() => {
    // Get stack outputs
    const outputs = getStackOutputs();
    userPoolId = outputs.userPoolId;
    clientId = outputs.clientId;

    client = new CognitoIdentityProviderClient({ region });

    // Generate unique test email for this run
    testEmail = `e2e-test-${Date.now()}@example.com`;
  });

  afterAll(async () => {
    // Cleanup: delete test user
    try {
      await client.send(
        new AdminDeleteUserCommand({
          UserPoolId: userPoolId,
          Username: testEmail,
        })
      );
    } catch {
      // User may not exist, ignore
    }
  });

  function getStackOutputs(): { userPoolId: string; clientId: string } {
    // Try environment variables first
    if (process.env.USER_POOL_ID && process.env.USER_POOL_CLIENT_ID) {
      return {
        userPoolId: process.env.USER_POOL_ID,
        clientId: process.env.USER_POOL_CLIENT_ID,
      };
    }

    // Try CloudFormation describe-stacks
    try {
      const cfnOutputs = execSync(
        `aws cloudformation describe-stacks --stack-name ${process.env.STACK_NAME} --query "Stacks[0].Outputs" --output json 2>/dev/null`,
        { encoding: 'utf-8' }
      );

      const parsed = JSON.parse(cfnOutputs);
      const userPoolId = parsed.find((o: { OutputKey: string }) => o.OutputKey === 'userPoolId')?.OutputValue;
      const clientId = parsed.find((o: { OutputKey: string }) => o.OutputKey === 'userPoolClientId')?.OutputValue;

      if (userPoolId && clientId) {
        return { userPoolId, clientId };
      }
    } catch {
      // Fall through to error
    }

    throw new Error(
      'Could not get stack outputs. Deploy the stack first or set USER_POOL_ID and USER_POOL_CLIENT_ID environment variables.'
    );
  }

  describe('Sign Up', () => {
    it('should create a new user successfully', async () => {
      const response = await client.send(
        new SignUpCommand({
          ClientId: clientId,
          Username: testEmail,
          Password: crypto.randomUUID() + 'Aa1!',
          UserAttributes: [{ Name: 'email', Value: testEmail }],
        })
      );

      expect(response.UserConfirmed).toBe(true); // PreSignUp Lambda auto-confirms
      expect(response.UserSub).toBeDefined();
    });

    it('should handle existing user gracefully', async () => {
      try {
        await client.send(
          new SignUpCommand({
            ClientId: clientId,
            Username: testEmail,
            Password: crypto.randomUUID() + 'Aa1!',
            UserAttributes: [{ Name: 'email', Value: testEmail }],
          })
        );
        fail('Expected UsernameExistsException');
      } catch (error: unknown) {
        expect((error as { name: string }).name).toBe('UsernameExistsException');
      }
    });
  });

  describe('Custom Auth Flow', () => {
    let session: string;
    let otp: string;

    it('should initiate custom auth and return OTP in challenge parameters', async () => {
      const response = await client.send(
        new InitiateAuthCommand({
          AuthFlow: 'CUSTOM_AUTH',
          ClientId: clientId,
          AuthParameters: {
            USERNAME: testEmail,
          },
        })
      );

      expect(response.ChallengeName).toBe('CUSTOM_CHALLENGE');
      expect(response.Session).toBeDefined();
      expect(response.ChallengeParameters).toBeDefined();
      expect(response.ChallengeParameters?.otp).toBeDefined();
      expect(response.ChallengeParameters?.otp).toMatch(/^\d{6}$/); // 6-digit OTP

      session = response.Session!;
      otp = response.ChallengeParameters!.otp;
    });

    it('should reject incorrect OTP', async () => {
      const wrongOtp = otp === '123456' ? '654321' : '123456';

      const response = await client.send(
        new RespondToAuthChallengeCommand({
          ClientId: clientId,
          ChallengeName: 'CUSTOM_CHALLENGE',
          Session: session,
          ChallengeResponses: {
            USERNAME: testEmail,
            ANSWER: wrongOtp,
          },
        })
      );

      // Should get another challenge (retry allowed)
      expect(response.ChallengeName).toBe('CUSTOM_CHALLENGE');
      expect(response.AuthenticationResult).toBeUndefined();

      // Update session for next test
      session = response.Session!;
    });

    it('should accept correct OTP and return tokens', async () => {
      // Need to initiate auth again to get fresh OTP
      const initResponse = await client.send(
        new InitiateAuthCommand({
          AuthFlow: 'CUSTOM_AUTH',
          ClientId: clientId,
          AuthParameters: {
            USERNAME: testEmail,
          },
        })
      );

      const freshOtp = initResponse.ChallengeParameters!.otp;
      const freshSession = initResponse.Session!;

      const response = await client.send(
        new RespondToAuthChallengeCommand({
          ClientId: clientId,
          ChallengeName: 'CUSTOM_CHALLENGE',
          Session: freshSession,
          ChallengeResponses: {
            USERNAME: testEmail,
            ANSWER: freshOtp,
          },
        })
      );

      expect(response.AuthenticationResult).toBeDefined();
      expect(response.AuthenticationResult?.AccessToken).toBeDefined();
      expect(response.AuthenticationResult?.IdToken).toBeDefined();
      expect(response.AuthenticationResult?.RefreshToken).toBeDefined();
      expect(response.AuthenticationResult?.TokenType).toBe('Bearer');
      expect(response.AuthenticationResult?.ExpiresIn).toBeGreaterThan(0);
    });
  });

  describe('Token Validation', () => {
    it('should return valid JWT tokens', async () => {
      // Initiate and complete auth
      const initResponse = await client.send(
        new InitiateAuthCommand({
          AuthFlow: 'CUSTOM_AUTH',
          ClientId: clientId,
          AuthParameters: {
            USERNAME: testEmail,
          },
        })
      );

      const response = await client.send(
        new RespondToAuthChallengeCommand({
          ClientId: clientId,
          ChallengeName: 'CUSTOM_CHALLENGE',
          Session: initResponse.Session!,
          ChallengeResponses: {
            USERNAME: testEmail,
            ANSWER: initResponse.ChallengeParameters!.otp,
          },
        })
      );

      const accessToken = response.AuthenticationResult!.AccessToken!;
      const idToken = response.AuthenticationResult!.IdToken!;

      // Verify tokens are valid JWTs (3 parts separated by dots)
      expect(accessToken.split('.').length).toBe(3);
      expect(idToken.split('.').length).toBe(3);

      // Decode ID token payload and verify claims
      const idTokenPayload = JSON.parse(
        Buffer.from(idToken.split('.')[1], 'base64').toString()
      );

      expect(idTokenPayload.email).toBe(testEmail);
      expect(idTokenPayload.email_verified).toBe(true); // Should be verified after successful OTP
      expect(idTokenPayload.iss).toContain(userPoolId);
      expect(idTokenPayload.aud).toBe(clientId);
      expect(idTokenPayload.token_use).toBe('id');
    });
  });
});
