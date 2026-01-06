import type { PreSignUpTriggerEvent, Context } from 'aws-lambda';
import { handler } from '../../lambda/pre-sign-up/index';

describe('PreSignUp Lambda', () => {
  const mockContext = {} as Context;
  const mockCallback = jest.fn();

  const createEvent = (): PreSignUpTriggerEvent => ({
    version: '1',
    region: 'us-east-1',
    userPoolId: 'us-east-1_test',
    userName: 'test-user',
    callerContext: {
      awsSdkVersion: '1.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'PreSignUp_SignUp',
    request: {
      userAttributes: {
        email: 'test@example.com',
      },
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  });

  test('sets autoConfirmUser to true', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.response.autoConfirmUser).toBe(true);
  });

  test('sets autoVerifyEmail to false', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.response.autoVerifyEmail).toBe(false);
  });

  test('returns the event with modified response', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result).toMatchObject({
      version: '1',
      region: 'us-east-1',
      userPoolId: 'us-east-1_test',
      userName: 'test-user',
      request: {
        userAttributes: {
          email: 'test@example.com',
        },
      },
    });
  });

  test('preserves original event properties', async () => {
    const event = createEvent();
    const result = await handler(event, mockContext, mockCallback);

    expect(result?.triggerSource).toBe('PreSignUp_SignUp');
    expect(result?.callerContext.clientId).toBe('test-client-id');
  });
});
