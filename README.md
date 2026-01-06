# AWS Cognito Passwordless Authentication for Hereya

A Hereya package that provides passwordless email OTP authentication using AWS Cognito with Custom Auth Flow. Users sign in with their email and receive a 6-digit OTP code instead of using passwords.

## Overview

This package (`aws/cognito`) provides a complete passwordless authentication solution:
- **Email-only Sign-in**: Users authenticate with email + OTP, no passwords required
- **Custom Auth Flow**: Cognito Lambda triggers handle OTP generation and verification
- **Auto-confirmation**: Users are auto-confirmed on signup, email verified after first successful OTP
- **Secure OTP Storage**: OTPs stored in DynamoDB with automatic TTL expiration

## Features

- **Passwordless by design** - No password storage, no password resets, no password policies
- **6-digit OTP codes** - Easy to type on mobile devices
- **3 attempt limit** - Brute force protection built-in
- **5-minute expiry** - OTPs expire automatically for security
- **Email verification** - Email marked as verified after successful OTP authentication
- **Multi-deployment safe** - Resource names auto-generated to avoid collisions

## Prerequisites

- AWS account with appropriate permissions
- AWS CLI configured with credentials
- Node.js 22+
- Hereya CLI installed
- Email sending service (Postmark, SES, etc.) for OTP delivery in your application

## Installation

```bash
# Add Cognito authentication to your project
hereya add aws/cognito
```

## Quick Start

### 1. Deploy the Stack

```bash
# Deploy authentication infrastructure
hereya up

# View connection details
hereya env
```

### 2. Integrate with Your Application

```typescript
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_COGNITO_REGION });
const clientId = process.env.AWS_COGNITO_USER_POOL_CLIENT_ID;

// Sign up new user
await client.send(new SignUpCommand({
  ClientId: clientId,
  Username: email,
  Password: crypto.randomUUID() + 'Aa1!', // Required but not used
  UserAttributes: [{ Name: 'email', Value: email }],
}));

// Initiate login (triggers OTP generation)
const initResponse = await client.send(new InitiateAuthCommand({
  AuthFlow: 'CUSTOM_AUTH',
  ClientId: clientId,
  AuthParameters: { USERNAME: email },
}));

// Get OTP from challenge parameters and send via email
const otp = initResponse.ChallengeParameters.otp;
await sendEmail(email, `Your code is: ${otp}`);

// Verify OTP (user submits the code)
const authResponse = await client.send(new RespondToAuthChallengeCommand({
  ClientId: clientId,
  ChallengeName: 'CUSTOM_CHALLENGE',
  Session: initResponse.Session,
  ChallengeResponses: {
    USERNAME: email,
    ANSWER: userSubmittedOtp,
  },
}));

// Success! Tokens available
const { AccessToken, IdToken, RefreshToken } = authResponse.AuthenticationResult;
```

## Configuration

Configure parameters in your Hereya workspace or via environment variables.

### Stack Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `OTP_EXPIRY_SECONDS` | number | OTP validity period in seconds | `300` (5 min) |

### Environment Variables (Output)

| Variable | Description |
|----------|-------------|
| `AWS_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `AWS_COGNITO_USER_POOL_CLIENT_ID` | User Pool Client ID |
| `AWS_COGNITO_OTP_TABLE_NAME` | DynamoDB table for OTP storage |
| `AWS_COGNITO_SESSIONS_TABLE_NAME` | DynamoDB table for server-side sessions |
| `AWS_COGNITO_REGION` | AWS region |

## Outputs

The package exports these values after deployment:

| Output | Description | Example |
|--------|-------------|---------|
| `userPoolId` | Cognito User Pool ID | `eu-west-1_abc123` |
| `userPoolClientId` | User Pool Client ID | `1abc2def3ghi4jkl` |
| `otpTableName` | DynamoDB OTP table name | `Stack-OtpCodesTable-XYZ` |
| `sessionsTableName` | DynamoDB sessions table name | `Stack-SessionsTable-XYZ` |
| `region` | AWS region | `eu-west-1` |
| `iamPolicyForCognito` | IAM policy JSON for app permissions | `{"Version":"2012-10-17",...}` |

Access outputs:
```bash
hereya env
```

## Usage Examples

### Basic Sign Up and Login Flow

```typescript
// 1. Sign up (one-time)
async function signUp(email: string) {
  await client.send(new SignUpCommand({
    ClientId: clientId,
    Username: email,
    Password: crypto.randomUUID() + 'Aa1!',
    UserAttributes: [{ Name: 'email', Value: email }],
  }));
}

// 2. Request OTP
async function requestOtp(email: string) {
  const response = await client.send(new InitiateAuthCommand({
    AuthFlow: 'CUSTOM_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: email },
  }));

  // Send OTP via your email service
  await sendOtpEmail(email, response.ChallengeParameters.otp);

  return response.Session; // Store for verification step
}

// 3. Verify OTP
async function verifyOtp(email: string, otp: string, session: string) {
  const response = await client.send(new RespondToAuthChallengeCommand({
    ClientId: clientId,
    ChallengeName: 'CUSTOM_CHALLENGE',
    Session: session,
    ChallengeResponses: {
      USERNAME: email,
      ANSWER: otp,
    },
  }));

  return response.AuthenticationResult; // Contains tokens
}
```

### Hono Server Integration (Secure with Server-Side Sessions)

This example stores refresh tokens server-side in DynamoDB, with only a session ID sent to the browser.

#### Session Store Library

```typescript
// lib/sessions.ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.SESSIONS_TABLE_NAME!;
const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 days

export interface Session {
  userId: string;
  refreshToken: string;
}

export async function createSession(userId: string, refreshToken: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await client.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { sessionId, userId, refreshToken, createdAt: new Date().toISOString(), ttl: now + SESSION_TTL_SECONDS },
  }));

  return sessionId;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const result = await client.send(new GetCommand({ TableName: TABLE_NAME, Key: { sessionId } }));
  if (!result.Item) return null;
  return { userId: result.Item.userId, refreshToken: result.Item.refreshToken };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await client.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { sessionId } }));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  const result = await client.send(new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: 'userId-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': userId },
    ProjectionExpression: 'sessionId',
  }));

  if (!result.Items?.length) return;

  // Batch delete (max 25 per batch)
  for (let i = 0; i < result.Items.length; i += 25) {
    const batch = result.Items.slice(i, i + 25).map((item) => ({
      DeleteRequest: { Key: { sessionId: item.sessionId } },
    }));
    await client.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: batch } }));
  }
}
```

#### Auth Middleware with Auto-Refresh

```typescript
// middleware/auth.ts
import { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { jwtDecode } from 'jwt-decode';
import { CognitoIdentityProviderClient, InitiateAuthCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getSession, deleteSession } from '../lib/sessions';

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const CLIENT_ID = process.env.COGNITO_CLIENT_ID!;

function isTokenExpired(token: string): boolean {
  try {
    const decoded = jwtDecode<{ exp: number }>(token);
    return decoded.exp * 1000 < Date.now() + 30_000; // 30s buffer
  } catch {
    return true;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const accessToken = getCookie(c, 'access_token');
  const sessionId = getCookie(c, 'session_id');

  // Valid access token - proceed
  if (accessToken && !isTokenExpired(accessToken)) {
    c.set('accessToken', accessToken);
    return next();
  }

  // Try to refresh using server-side stored refresh token
  if (sessionId) {
    const session = await getSession(sessionId);

    if (session) {
      try {
        const response = await cognito.send(new InitiateAuthCommand({
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          ClientId: CLIENT_ID,
          AuthParameters: { REFRESH_TOKEN: session.refreshToken },
        }));

        const newAccessToken = response.AuthenticationResult?.AccessToken;
        if (newAccessToken) {
          setCookie(c, 'access_token', newAccessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: 3600,
            path: '/',
          });

          c.set('accessToken', newAccessToken);
          c.set('userId', session.userId);
          return next();
        }
      } catch (error) {
        console.error('Token refresh failed:', error);
      }
    }

    // Session invalid or refresh failed
    await deleteSession(sessionId);
    deleteCookie(c, 'session_id');
  }

  deleteCookie(c, 'access_token');
  return c.redirect('/login');
}
```

#### Auth Routes with Server-Side Sessions

```tsx
// routes/auth.tsx
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { jwtDecode } from 'jwt-decode';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { createSession, deleteSession, deleteUserSessions } from '../lib/sessions';

const auth = new Hono();
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const clientId = process.env.COGNITO_CLIENT_ID!;

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'Strict' as const,
  path: '/',
};

auth.get('/login', (c) => {
  return c.html(
    <html><body>
      <h1>Login</h1>
      <form method="post" action="/auth/login">
        <input type="email" name="email" placeholder="Email" required />
        <button type="submit">Send OTP</button>
      </form>
    </body></html>
  );
});

auth.post('/login', async (c) => {
  const { email } = await c.req.parseBody();

  const response = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'CUSTOM_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: String(email) },
  }));

  setCookie(c, 'cognito_session', response.Session!, { ...cookieOptions, maxAge: 300 });
  setCookie(c, 'auth_email', String(email), { ...cookieOptions, maxAge: 300 });

  // Send OTP via your email service
  await sendEmail(String(email), response.ChallengeParameters!.otp);

  return c.html(
    <html><body>
      <h1>Enter OTP</h1>
      <p>We sent a code to {String(email)}</p>
      <form method="post" action="/auth/verify">
        <input type="text" name="otp" placeholder="6-digit code" maxLength={6} required />
        <button type="submit">Verify</button>
      </form>
    </body></html>
  );
});

auth.post('/verify', async (c) => {
  const { otp } = await c.req.parseBody();
  const cognitoSession = getCookie(c, 'cognito_session');
  const email = getCookie(c, 'auth_email');

  if (!cognitoSession || !email) return c.redirect('/auth/login');

  try {
    const response = await cognito.send(new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'CUSTOM_CHALLENGE',
      Session: cognitoSession,
      ChallengeResponses: { USERNAME: email, ANSWER: String(otp) },
    }));

    const { AccessToken, IdToken, RefreshToken, ExpiresIn } = response.AuthenticationResult!;
    const decoded = jwtDecode<{ sub: string }>(IdToken!);

    // Store refresh token SERVER-SIDE, get session ID
    const sessionId = await createSession(decoded.sub, RefreshToken!);

    // Clear temporary cookies
    deleteCookie(c, 'cognito_session');
    deleteCookie(c, 'auth_email');

    // Session ID cookie (long-lived, used to retrieve refresh token)
    setCookie(c, 'session_id', sessionId, { ...cookieOptions, maxAge: 30 * 24 * 3600 });

    // Access token cookie (short-lived)
    setCookie(c, 'access_token', AccessToken!, { ...cookieOptions, maxAge: ExpiresIn });

    return c.redirect('/dashboard');
  } catch (error) {
    return c.html(
      <html><body>
        <h1>Invalid OTP</h1>
        <a href="/auth/login">Try again</a>
      </body></html>
    );
  }
});

auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session_id');
  if (sessionId) await deleteSession(sessionId);
  deleteCookie(c, 'session_id');
  deleteCookie(c, 'access_token');
  return c.redirect('/auth/login');
});

// Logout from all devices
auth.post('/logout-everywhere', async (c) => {
  const userId = c.get('userId');
  if (userId) await deleteUserSessions(userId);
  deleteCookie(c, 'session_id');
  deleteCookie(c, 'access_token');
  return c.redirect('/auth/login');
});

export { auth };
```

#### Main Application

```typescript
// index.ts
import { Hono } from 'hono';
import { auth } from './routes/auth';
import { authMiddleware } from './middleware/auth';

const app = new Hono();

// Public routes
app.route('/auth', auth);

// Protected routes (middleware auto-refreshes tokens)
app.use('/dashboard/*', authMiddleware);
app.use('/api/*', authMiddleware);

app.get('/dashboard', (c) => {
  return c.html(<html><body><h1>Dashboard</h1><p>Authenticated!</p></body></html>);
});

export default app;
```

## Authentication Flow

### Sign Up Flow
```
User                    App                     Cognito                Lambda
  │                      │                        │                      │
  │──email──────────────▶│                        │                      │
  │                      │──SignUp───────────────▶│                      │
  │                      │                        │──PreSignUp──────────▶│
  │                      │                        │◀──autoConfirm=true───│
  │                      │◀──UserConfirmed=true───│                      │
  │◀──success────────────│                        │                      │
```

### Login Flow
```
User                    App                     Cognito                Lambda              DynamoDB
  │                      │                        │                      │                    │
  │──email──────────────▶│                        │                      │                    │
  │                      │──InitiateAuth─────────▶│                      │                    │
  │                      │                        │──DefineAuthChallenge▶│                    │
  │                      │                        │◀──CUSTOM_CHALLENGE───│                    │
  │                      │                        │──CreateAuthChallenge▶│                    │
  │                      │                        │                      │──store OTP────────▶│
  │                      │◀──{session, otp}───────│◀──{otp}──────────────│                    │
  │                      │                        │                      │                    │
  │◀──email with OTP─────│                        │                      │                    │
  │                      │                        │                      │                    │
  │──enter OTP──────────▶│                        │                      │                    │
  │                      │──RespondToChallenge───▶│                      │                    │
  │                      │                        │──VerifyAuthChallenge▶│                    │
  │                      │                        │                      │──verify OTP───────▶│
  │                      │                        │                      │◀──match────────────│
  │                      │                        │◀──answerCorrect=true─│                    │
  │                      │◀──{tokens}─────────────│                      │                    │
  │◀──authenticated──────│                        │                      │                    │
```

## Architecture

### Resources Created

```
┌─────────────────────────────────────────────────────────────────┐
│                        AWS Account                               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Cognito User Pool                      │  │
│  │  • Email-only sign-in                                     │  │
│  │  • Custom auth flow enabled                               │  │
│  │  • Minimal password policy (not used)                     │  │
│  │                                                           │  │
│  │  Lambda Triggers:                                         │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │  │
│  │  │ PreSignUp   │ │DefineAuth   │ │ CreateAuthChallenge │ │  │
│  │  │ (auto-      │ │Challenge    │ │ (generate OTP,      │ │  │
│  │  │  confirm)   │ │(flow ctrl)  │ │  store in DynamoDB) │ │  │
│  │  └─────────────┘ └─────────────┘ └──────────┬──────────┘ │  │
│  │  ┌───────────────────────────────┐          │            │  │
│  │  │ VerifyAuthChallengeResponse   │          │            │  │
│  │  │ (validate OTP, mark verified) │          │            │  │
│  │  └───────────────┬───────────────┘          │            │  │
│  └──────────────────│──────────────────────────│────────────┘  │
│                     │                          │                │
│  ┌──────────────────▼──────────────────────────▼────────────┐  │
│  │                 DynamoDB OTP Table                        │  │
│  │  • Partition Key: email                                   │  │
│  │  • TTL: automatic OTP expiration                          │  │
│  │  • PAY_PER_REQUEST billing                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              DynamoDB Sessions Table                      │  │
│  │  • Partition Key: sessionId                               │  │
│  │  • GSI: userId-index (for logout everywhere)              │  │
│  │  • TTL: automatic session expiration (30 days)            │  │
│  │  • AWS-managed encryption at rest                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  User Pool Client                         │  │
│  │  • CUSTOM_AUTH flow                                       │  │
│  │  • USER_SRP_AUTH flow                                     │  │
│  │  • No client secret                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Lambda Functions

| Function | Purpose |
|----------|---------|
| PreSignUp | Auto-confirms user, sets `email_verified=false` |
| DefineAuthChallenge | Controls auth state machine, allows 3 attempts |
| CreateAuthChallenge | Generates 6-digit OTP, stores in DynamoDB |
| VerifyAuthChallengeResponse | Validates OTP, marks email as verified on success |

## Testing

### Run Unit Tests
```bash
npm test
```

### Run E2E Tests
```bash
# Automatically deploys, tests, and destroys
npm run test:e2e
```

### Run Single Test File
```bash
npx jest test/lambda/create-auth-challenge.test.ts
```

## Troubleshooting

### User Already Exists
```
UsernameExistsException: An account with the given email already exists.
```
This is expected for returning users. Proceed directly to `InitiateAuth`.

### Invalid OTP
After 3 failed attempts, the user must request a new OTP via `InitiateAuth`.

### OTP Expired
OTPs expire after 5 minutes. Call `InitiateAuth` again to generate a new one.

### Session Expired
Cognito sessions expire. If `RespondToAuthChallenge` fails with session error, restart the flow with `InitiateAuth`.

### NotAuthorizedException: Incorrect username or password
This can occur when:
- User doesn't exist (need to SignUp first)
- Using wrong auth flow (must use `CUSTOM_AUTH`)

### ResourceNotFoundException: User pool does not exist
Check that `AWS_COGNITO_USER_POOL_ID` and region are correct:
```bash
hereya env
```

## IAM Permissions

Your application needs these Cognito permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "cognito-idp:SignUp",
      "cognito-idp:InitiateAuth",
      "cognito-idp:RespondToAuthChallenge",
      "cognito-idp:GetUser",
      "cognito-idp:GlobalSignOut",
      "cognito-idp:RevokeToken",
      "cognito-idp:ForgotPassword",
      "cognito-idp:ConfirmForgotPassword",
      "cognito-idp:ChangePassword"
    ],
    "Resource": "arn:aws:cognito-idp:REGION:ACCOUNT:userpool/POOL_ID"
  }]
}
```

The exact policy is available in the `iamPolicyForCognito` stack output.

## Best Practices

### Security
- Always use HTTPS for OTP transmission
- Implement rate limiting on your login endpoint
- Store tokens securely (httpOnly cookies or secure storage)
- Validate JWT tokens on protected routes

### User Experience
- Show clear feedback when OTP is sent
- Provide "Resend OTP" option with rate limiting
- Handle expired OTP gracefully with clear messaging
- Auto-focus OTP input field

### Production
- Set up CloudWatch alarms for failed auth attempts
- Monitor DynamoDB capacity
- Configure proper CORS for your domain
- Use environment-specific stack names

## Related Packages

- Application framework integrations (coming soon)

## Support

For issues or questions:
- Create an issue in the [package repository](https://github.com/hereya/aws-cognito-package)
- Check the [Hereya documentation](https://docs.hereya.dev)

## License

MIT
