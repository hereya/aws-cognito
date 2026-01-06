import type {
  CreateAuthChallengeTriggerEvent,
  CreateAuthChallengeTriggerHandler,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE_NAME = process.env.OTP_TABLE_NAME!;
const OTP_EXPIRY_SECONDS = parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10);

export const handler: CreateAuthChallengeTriggerHandler = async (
  event: CreateAuthChallengeTriggerEvent
): Promise<CreateAuthChallengeTriggerEvent> => {
  const email = event.request.userAttributes.email;
  const otp = crypto.randomInt(100000, 999999).toString();
  const ttl = Math.floor(Date.now() / 1000) + OTP_EXPIRY_SECONDS;

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        email,
        otp,
        ttl,
        attempts: 0,
        createdAt: new Date().toISOString(),
      },
    })
  );

  event.response.publicChallengeParameters = { otp };
  event.response.privateChallengeParameters = { answer: otp };

  return event;
};
