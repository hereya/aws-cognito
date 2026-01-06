import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AwsCognitoStack } from '../lib/aws-cognito-stack';

describe('AwsCognitoStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new AwsCognitoStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  describe('DynamoDB OTP Table', () => {
    test('creates table with email partition key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          {
            AttributeName: 'email',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'email',
            AttributeType: 'S',
          },
        ],
      });
    });

    test('has TTL enabled on ttl attribute', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      });
    });

    test('uses PAY_PER_REQUEST billing mode', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });
  });

  describe('DynamoDB Sessions Table', () => {
    test('creates table with sessionId partition key', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          {
            AttributeName: 'sessionId',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: Match.arrayWith([
          {
            AttributeName: 'sessionId',
            AttributeType: 'S',
          },
        ]),
      });
    });

    test('has GSI on userId for logout everywhere', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'userId-index',
            KeySchema: [
              {
                AttributeName: 'userId',
                KeyType: 'HASH',
              },
            ],
          }),
        ]),
      });
    });

    test('has server-side encryption enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true,
        },
      });
    });
  });

  describe('Lambda Functions', () => {
    test('creates 4 Lambda functions', () => {
      template.resourceCountIs('AWS::Lambda::Function', 4);
    });

    test('uses Node.js 22 runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
      });
    });

    test('uses ARM64 architecture', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Architectures: ['arm64'],
      });
    });

    test('has correct timeout (10 seconds)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 10,
      });
    });

    test('has correct memory size (256 MB)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 256,
      });
    });

    test('CreateAuthChallenge has OTP_TABLE_NAME environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            OTP_TABLE_NAME: Match.anyValue(),
            OTP_EXPIRY_SECONDS: '300',
          }),
        },
      });
    });

    test('VerifyAuthChallenge has OTP_TABLE_NAME environment variable', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            OTP_TABLE_NAME: Match.anyValue(),
          }),
        },
      });
    });
  });

  describe('Cognito User Pool', () => {
    test('creates User Pool with email sign-in', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UsernameAttributes: ['email'],
      });
    });

    test('has self sign-up enabled', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AdminCreateUserConfig: {
          AllowAdminCreateUserOnly: false,
        },
      });
    });

    test('has auto-verify email disabled', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AutoVerifiedAttributes: [],
      });
    });

    test('has minimal password policy', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireLowercase: false,
            RequireNumbers: false,
            RequireSymbols: false,
            RequireUppercase: false,
          },
        },
      });
    });

    test('has email-only account recovery', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        AccountRecoverySetting: {
          RecoveryMechanisms: [
            {
              Name: 'verified_email',
              Priority: 1,
            },
          ],
        },
      });
    });

    test('has all Lambda triggers attached', () => {
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        LambdaConfig: {
          PreSignUp: Match.anyValue(),
          DefineAuthChallenge: Match.anyValue(),
          CreateAuthChallenge: Match.anyValue(),
          VerifyAuthChallengeResponse: Match.anyValue(),
        },
      });
    });
  });

  describe('Cognito User Pool Client', () => {
    test('creates User Pool Client', () => {
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    });

    test('has custom auth flow enabled', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ExplicitAuthFlows: Match.arrayWith([
          'ALLOW_CUSTOM_AUTH',
          'ALLOW_USER_SRP_AUTH',
          'ALLOW_REFRESH_TOKEN_AUTH',
        ]),
      });
    });

    test('has no client secret', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        GenerateSecret: false,
      });
    });
  });

  describe('IAM Policies', () => {
    test('CreateAuthChallenge has DynamoDB permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:BatchGetItem',
                'dynamodb:GetRecords',
                'dynamodb:GetShardIterator',
                'dynamodb:Query',
                'dynamodb:GetItem',
                'dynamodb:Scan',
                'dynamodb:ConditionCheckItem',
                'dynamodb:BatchWriteItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:DescribeTable',
              ]),
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    test('VerifyAuthChallenge has Cognito AdminUpdateUserAttributes permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'cognito-idp:AdminUpdateUserAttributes',
              Effect: 'Allow',
              Resource: Match.anyValue(),
            }),
          ]),
        },
      });
    });
  });

  describe('CDK Outputs', () => {
    test('has userPoolId output', () => {
      template.hasOutput('userPoolId', {
        Description: 'Cognito User Pool ID',
      });
    });

    test('has userPoolClientId output', () => {
      template.hasOutput('userPoolClientId', {
        Description: 'Cognito User Pool Client ID',
      });
    });

    test('has otpTableName output', () => {
      template.hasOutput('otpTableName', {
        Description: 'DynamoDB OTP Table Name',
      });
    });

    test('has sessionsTableName output', () => {
      template.hasOutput('sessionsTableName', {
        Description: 'DynamoDB Sessions Table Name',
      });
    });

    test('has region output', () => {
      template.hasOutput('region', {
        Description: 'AWS Region',
      });
    });
  });
});
