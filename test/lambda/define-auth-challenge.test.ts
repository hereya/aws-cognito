import type { DefineAuthChallengeTriggerEvent, Context } from 'aws-lambda';
import { handler } from '../../lambda/define-auth-challenge/index';

describe('DefineAuthChallenge Lambda', () => {
  const mockContext = {} as Context;
  const mockCallback = jest.fn();

  const createEvent = (session: DefineAuthChallengeTriggerEvent['request']['session'] = []): DefineAuthChallengeTriggerEvent => ({
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'test-user',
    callerContext: {
      awsSdkVersion: '1.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'DefineAuthChallenge_Authentication',
    request: {
      userAttributes: {
        email: 'test@example.com',
      },
      session,
    },
    response: {
      challengeName: '',
      issueTokens: false,
      failAuthentication: false,
    },
  });

  describe('first call (empty session)', () => {
    test('issues CUSTOM_CHALLENGE', async () => {
      const event = createEvent([]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.challengeName).toBe('CUSTOM_CHALLENGE');
      expect(result?.response.issueTokens).toBe(false);
      expect(result?.response.failAuthentication).toBe(false);
    });
  });

  describe('successful challenge', () => {
    test('issues tokens after successful CUSTOM_CHALLENGE', async () => {
      const event = createEvent([
        {
          challengeName: 'CUSTOM_CHALLENGE',
          challengeResult: true,
          challengeMetadata: undefined,
        },
      ]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.issueTokens).toBe(true);
      expect(result?.response.failAuthentication).toBe(false);
    });
  });

  describe('failed attempts', () => {
    test('fails authentication after 3 failed attempts', async () => {
      const event = createEvent([
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
      ]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.issueTokens).toBe(false);
      expect(result?.response.failAuthentication).toBe(true);
    });

    test('allows retry after first failed attempt', async () => {
      const event = createEvent([
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
      ]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.challengeName).toBe('CUSTOM_CHALLENGE');
      expect(result?.response.issueTokens).toBe(false);
      expect(result?.response.failAuthentication).toBe(false);
    });

    test('allows retry after second failed attempt', async () => {
      const event = createEvent([
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
        { challengeName: 'CUSTOM_CHALLENGE', challengeResult: false, challengeMetadata: undefined },
      ]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.challengeName).toBe('CUSTOM_CHALLENGE');
      expect(result?.response.issueTokens).toBe(false);
      expect(result?.response.failAuthentication).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles session with only failed SRP_A challenge', async () => {
      const event = createEvent([
        { challengeName: 'SRP_A', challengeResult: false, challengeMetadata: undefined },
      ]);
      const result = await handler(event, mockContext, mockCallback);

      expect(result?.response.challengeName).toBe('CUSTOM_CHALLENGE');
      expect(result?.response.issueTokens).toBe(false);
      expect(result?.response.failAuthentication).toBe(false);
    });
  });
});
