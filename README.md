# AWS Cognito Passwordless Authentication for Hereya

A Hereya package that provides passwordless email OTP authentication using AWS Cognito with Custom Auth Flow. Users sign in with their email and receive a 6-digit OTP code instead of using passwords.

## Overview

This package (`hereya/aws-cognito`) provides a complete passwordless authentication solution:
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
hereya add hereya/aws-cognito
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
| `AWS_COGNITO_REGION` | AWS region |

## Outputs

The package exports these values after deployment:

| Output | Description | Example |
|--------|-------------|---------|
| `userPoolId` | Cognito User Pool ID | `eu-west-1_abc123` |
| `userPoolClientId` | User Pool Client ID | `1abc2def3ghi4jkl` |
| `otpTableName` | DynamoDB OTP table name | `Stack-OtpCodesTable-XYZ` |
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

### Hono Server Integration (Secure with Cookies + JSX)

```tsx
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const app = new Hono();
const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_COGNITO_REGION });
const clientId = process.env.AWS_COGNITO_USER_POOL_CLIENT_ID!;

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  path: '/',
};

// Login page
app.get('/login', (c) => {
  return c.html(
    <html>
      <body>
        <h1>Login</h1>
        <form method="post" action="/auth/login">
          <input type="email" name="email" placeholder="Email" required />
          <button type="submit">Send OTP</button>
        </form>
      </body>
    </html>
  );
});

// Handle login - send OTP and show verify form
app.post('/auth/login', async (c) => {
  const { email } = await c.req.parseBody();

  const response = await cognito.send(new InitiateAuthCommand({
    AuthFlow: 'CUSTOM_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: String(email) },
  }));

  // Store session in httpOnly cookie (not exposed to JS)
  setCookie(c, 'auth_session', response.Session!, { ...cookieOptions, maxAge: 300 });
  setCookie(c, 'auth_email', String(email), { ...cookieOptions, maxAge: 300 });

  // Send OTP via your email service
  await sendEmail(String(email), response.ChallengeParameters!.otp);

  return c.html(
    <html>
      <body>
        <h1>Enter OTP</h1>
        <p>We sent a code to {String(email)}</p>
        <form method="post" action="/auth/verify">
          <input type="text" name="otp" placeholder="Enter 6-digit code" maxLength={6} required />
          <button type="submit">Verify</button>
        </form>
      </body>
    </html>
  );
});

// Verify OTP and set auth cookies
app.post('/auth/verify', async (c) => {
  const { otp } = await c.req.parseBody();
  const session = getCookie(c, 'auth_session');
  const email = getCookie(c, 'auth_email');

  if (!session || !email) {
    return c.redirect('/login');
  }

  try {
    const response = await cognito.send(new RespondToAuthChallengeCommand({
      ClientId: clientId,
      ChallengeName: 'CUSTOM_CHALLENGE',
      Session: session,
      ChallengeResponses: { USERNAME: email, ANSWER: String(otp) },
    }));

    const { AccessToken, IdToken, RefreshToken, ExpiresIn } = response.AuthenticationResult!;

    // Clear temporary auth cookies
    deleteCookie(c, 'auth_session');
    deleteCookie(c, 'auth_email');

    // Set tokens in httpOnly cookies (never exposed to JavaScript)
    setCookie(c, 'access_token', AccessToken!, { ...cookieOptions, maxAge: ExpiresIn });
    setCookie(c, 'id_token', IdToken!, { ...cookieOptions, maxAge: ExpiresIn });
    setCookie(c, 'refresh_token', RefreshToken!, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 });

    return c.redirect('/dashboard');
  } catch (error) {
    return c.html(
      <html>
        <body>
          <h1>Invalid OTP</h1>
          <p>Please try again or <a href="/login">request a new code</a></p>
        </body>
      </html>
    );
  }
});

// Protected route example
app.get('/dashboard', async (c) => {
  const accessToken = getCookie(c, 'access_token');
  if (!accessToken) {
    return c.redirect('/login');
  }
  return c.html(
    <html>
      <body>
        <h1>Dashboard</h1>
        <p>You are authenticated!</p>
        <form method="post" action="/auth/logout">
          <button type="submit">Logout</button>
        </form>
      </body>
    </html>
  );
});

// Logout
app.post('/auth/logout', (c) => {
  deleteCookie(c, 'access_token');
  deleteCookie(c, 'id_token');
  deleteCookie(c, 'refresh_token');
  return c.redirect('/login');
});
```

### Token Refresh

```typescript
async function refreshTokens(refreshToken: string) {
  const response = await client.send(new InitiateAuthCommand({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  }));
  return response.AuthenticationResult;
}
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
│  │                    DynamoDB Table                         │  │
│  │  • Partition Key: email                                   │  │
│  │  • TTL: automatic OTP expiration                          │  │
│  │  • PAY_PER_REQUEST billing                                │  │
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
- Create an issue in the [package repository](https://github.com/hereya/aws-cognito)
- Check the [Hereya documentation](https://docs.hereya.dev)

## License

MIT
