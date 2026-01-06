import type { VerifyAuthChallengeResponseTriggerEvent, Context } from 'aws-lambda';

// Mock AWS SDK before importing handler
const mockDynamoSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: mockDynamoSend,
    }),
  },
  GetCommand: jest.fn().mockImplementation((params) => ({ type: 'Get', input: params })),
  DeleteCommand: jest.fn().mockImplementation((params) => ({ type: 'Delete', input: params })),
  UpdateCommand: jest.fn().mockImplementation((params) => ({ type: 'Update', input: params })),
}));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: mockCognitoSend,
  })),
  AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((params) => ({ type: 'AdminUpdateUserAttributes', input: params })),
}));

// Set environment variables before importing handler
process.env.OTP_TABLE_NAME = 'test-otp-table';

import { handler } from '../../lambda/verify-auth-challenge/index';

describe('VerifyAuthChallenge Lambda', () => {
  const mockContext = {} as Context;
  const mockCallback = jest.fn();

  const createEvent = (
    challengeAnswer: string,
    emailVerified = 'false'
  ): VerifyAuthChallengeResponseTriggerEvent => ({
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'test-user',
    callerContext: {
      awsSdkVersion: '1.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'VerifyAuthChallengeResponse_Authentication',
    request: {
      userAttributes: {
        email: 'test@example.com',
        email_verified: emailVerified,
      },
      privateChallengeParameters: { answer: '123456' },
      challengeAnswer,
    },
    response: {
      answerCorrect: false,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDynamoSend.mockReset();
    mockCognitoSend.mockReset();
  });

  describe('correct OTP', () => {
    test('returns answerCorrect=true for correct OTP', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(true);
    });

    test('deletes OTP from DynamoDB after successful verification', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      await handler(event, mockContext, mockCallback);

      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      expect(DeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-otp-table',
        Key: { email: 'test@example.com' },
      });
    });

    test('sets email_verified to true for unverified users', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});
      mockCognitoSend.mockResolvedValueOnce({});

      const event = createEvent('123456', 'false');
      await handler(event, mockContext, mockCallback);

      const { AdminUpdateUserAttributesCommand } = require('@aws-sdk/client-cognito-identity-provider');
      expect(AdminUpdateUserAttributesCommand).toHaveBeenCalledWith({
        UserPoolId: 'us-east-1_test',
        Username: 'test-user',
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      });
    });

    test('does not update email_verified for already verified users', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456', 'true');
      await handler(event, mockContext, mockCallback);

      expect(mockCognitoSend).not.toHaveBeenCalled();
    });
  });

  describe('incorrect OTP', () => {
    test('returns answerCorrect=false for incorrect OTP', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('wrong-otp');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(false);
    });

    test('increments attempts on incorrect OTP', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('wrong-otp');
      await handler(event, mockContext, mockCallback);

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith({
        TableName: 'test-otp-table',
        Key: { email: 'test@example.com' },
        UpdateExpression: 'SET attempts = if_not_exists(attempts, :zero) + :inc',
        ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
      });
    });
  });

  describe('expired OTP', () => {
    test('returns answerCorrect=false for expired OTP', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) - 100, // Expired
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(false);
    });

    test('deletes expired OTP from DynamoDB', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) - 100, // Expired
            attempts: 0,
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      await handler(event, mockContext, mockCallback);

      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      expect(DeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-otp-table',
        Key: { email: 'test@example.com' },
      });
    });
  });

  describe('max attempts exceeded', () => {
    test('returns answerCorrect=false when max attempts exceeded', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 3, // Max attempts
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(false);
    });

    test('deletes OTP when max attempts exceeded', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({
          Item: {
            email: 'test@example.com',
            otp: '123456',
            ttl: Math.floor(Date.now() / 1000) + 300,
            attempts: 3, // Max attempts
          },
        })
        .mockResolvedValueOnce({});

      const event = createEvent('123456');
      await handler(event, mockContext, mockCallback);

      const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
      expect(DeleteCommand).toHaveBeenCalledWith({
        TableName: 'test-otp-table',
        Key: { email: 'test@example.com' },
      });
    });
  });

  describe('missing OTP record', () => {
    test('returns answerCorrect=false when no OTP record exists', async () => {
      mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

      const event = createEvent('123456');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(false);
    });
  });

  describe('error handling', () => {
    test('returns answerCorrect=false on DynamoDB error', async () => {
      mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createEvent('123456');
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.answerCorrect).toBe(false);
    });
  });
});
