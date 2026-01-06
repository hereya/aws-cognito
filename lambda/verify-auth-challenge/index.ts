import type {
  VerifyAuthChallengeResponseTriggerEvent,
  VerifyAuthChallengeResponseTriggerHandler,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognitoClient = new CognitoIdentityProviderClient({});

const TABLE_NAME = process.env.OTP_TABLE_NAME!;
const MAX_ATTEMPTS = 3;

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (
  event: VerifyAuthChallengeResponseTriggerEvent
): Promise<VerifyAuthChallengeResponseTriggerEvent> => {
  const email = event.request.userAttributes.email;
  const emailVerified = event.request.userAttributes.email_verified === 'true';
  const providedOtp = event.request.challengeAnswer;
  const userPoolId = event.userPoolId; // Get from event instead of env var

  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { email },
      })
    );

    if (!result.Item) {
      event.response.answerCorrect = false;
      return event;
    }

    const { otp, ttl, attempts = 0 } = result.Item;
    const now = Math.floor(Date.now() / 1000);

    if (ttl < now) {
      await dynamoClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { email } }));
      event.response.answerCorrect = false;
      return event;
    }

    if (attempts >= MAX_ATTEMPTS) {
      await dynamoClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { email } }));
      event.response.answerCorrect = false;
      return event;
    }

    if (otp === providedOtp) {
      await dynamoClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { email } }));

      if (!emailVerified) {
        await cognitoClient.send(
          new AdminUpdateUserAttributesCommand({
            UserPoolId: userPoolId,
            Username: event.userName,
            UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
          })
        );
      }

      event.response.answerCorrect = true;
    } else {
      await dynamoClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { email },
          UpdateExpression: 'SET attempts = if_not_exists(attempts, :zero) + :inc',
          ExpressionAttributeValues: { ':zero': 0, ':inc': 1 },
        })
      );
      event.response.answerCorrect = false;
    }
  } catch (error) {
    console.error('Error:', error);
    event.response.answerCorrect = false;
  }

  return event;
};
