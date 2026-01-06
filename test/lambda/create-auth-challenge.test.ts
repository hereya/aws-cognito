import type { CreateAuthChallengeTriggerEvent, Context } from 'aws-lambda';

// Mock AWS SDK before importing handler
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: mockSend,
    }),
  },
  PutCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

// Mock crypto.randomInt to return predictable values
jest.mock('crypto', () => ({
  randomInt: jest.fn().mockReturnValue(123456),
}));

// Set environment variables before importing handler
process.env.OTP_TABLE_NAME = 'test-otp-table';
process.env.OTP_EXPIRY_SECONDS = '300';

import { handler } from '../../lambda/create-auth-challenge/index';

describe('CreateAuthChallenge Lambda', () => {
  const mockContext = {} as Context;
  const mockCallback = jest.fn();

  const createEvent = (): CreateAuthChallengeTriggerEvent => ({
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'test-user',
    callerContext: {
      awsSdkVersion: '1.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'CreateAuthChallenge_Authentication',
    request: {
      userAttributes: {
        email: 'test@example.com',
      },
      challengeName: 'CUSTOM_CHALLENGE',
      session: [],
    },
    response: {
      publicChallengeParameters: {},
      privateChallengeParameters: {},
      challengeMetadata: '',
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
  });

  test('generates 6-digit OTP', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.response.publicChallengeParameters?.otp).toBe('123456');
  });

  test('stores OTP in DynamoDB with correct parameters', async () => {
    const event = createEvent();
    await handler(event, mockContext, mockCallback);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    expect(PutCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        TableName: 'test-otp-table',
        Item: expect.objectContaining({
          email: 'test@example.com',
          otp: '123456',
          attempts: 0,
        }),
      })
    );
  });

  test('sets TTL based on OTP_EXPIRY_SECONDS', async () => {
    const now = Math.floor(Date.now() / 1000);
    const event = createEvent();
    await handler(event, mockContext, mockCallback);

    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const putCall = PutCommand.mock.calls[0][0];
    const ttl = putCall.Item.ttl;

    // TTL should be approximately now + 300 seconds
    expect(ttl).toBeGreaterThanOrEqual(now + 299);
    expect(ttl).toBeLessThanOrEqual(now + 301);
  });

  test('returns OTP in publicChallengeParameters', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.response.publicChallengeParameters).toEqual({ otp: '123456' });
  });

  test('returns OTP in privateChallengeParameters as answer', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.response.privateChallengeParameters).toEqual({ answer: '123456' });
  });

  test('includes createdAt timestamp in DynamoDB item', async () => {
    const event = createEvent();
    await handler(event, mockContext, mockCallback);

    const { PutCommand } = require('@aws-sdk/lib-dynamodb');
    const putCall = PutCommand.mock.calls[0][0];
    expect(putCall.Item.createdAt).toBeDefined();
    expect(new Date(putCall.Item.createdAt).getTime()).not.toBeNaN();
  });
});
