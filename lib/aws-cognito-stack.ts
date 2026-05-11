import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class AwsCognitoStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly otpTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly authUsersTable: dynamodb.Table;
  public readonly authRolesTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // DynamoDB Table for OTP codes
    this.otpTable = new dynamodb.Table(this, 'OtpCodesTable', {
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DynamoDB Table for user sessions (server-side refresh token storage)
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI to find all sessions for a user (logout everywhere)
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'userId-index',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
    });

    // -----------------------------------------------------------------------
    // RBAC tables (DDB is the authorization DB)
    //
    // The application owns identity & authorization records here, so authz
    // checks never wake Aurora. Cognito remains authn-only.
    //
    //   AuthUsersTable  — one item per user (id, email, roleName, suspended,
    //                     cognitoSub, createdAt). GSI on email for lookup.
    //                     Also stores a `__bootstrap__` sentinel item to make
    //                     first-user-admin assignment exactly-once.
    //
    //   AuthRolesTable  — one item per role (roleName, permissions Set,
    //                     description). Lookup by name only.
    // -----------------------------------------------------------------------

    this.authUsersTable = new dynamodb.Table(this, 'AuthUsersTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // GSI to look up a user by email (signup gating, allowlist add).
    this.authUsersTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.authRolesTable = new dynamodb.Table(this, 'AuthRolesTable', {
      partitionKey: { name: 'roleName', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Common Lambda configuration
    const lambdaConfig: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        minify: true,
        sourceMap: true,
        target: 'node22',
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module';const require = createRequire(import.meta.url);",
      },
    };

    // Pre Sign Up Lambda
    const preSignUpLambda = new nodejs.NodejsFunction(this, 'PreSignUpLambda', {
      ...lambdaConfig,
      entry: path.join(__dirname, '../lambda/pre-sign-up/index.ts'),
      handler: 'handler',
    });

    // Define Auth Challenge Lambda
    const defineAuthChallengeLambda = new nodejs.NodejsFunction(this, 'DefineAuthChallengeLambda', {
      ...lambdaConfig,
      entry: path.join(__dirname, '../lambda/define-auth-challenge/index.ts'),
      handler: 'handler',
    });

    // Create Auth Challenge Lambda
    const createAuthChallengeLambda = new nodejs.NodejsFunction(this, 'CreateAuthChallengeLambda', {
      ...lambdaConfig,
      entry: path.join(__dirname, '../lambda/create-auth-challenge/index.ts'),
      handler: 'handler',
      environment: {
        OTP_TABLE_NAME: this.otpTable.tableName,
        OTP_EXPIRY_SECONDS: '300',
      },
    });

    // Grant DynamoDB permissions to CreateAuthChallenge Lambda
    this.otpTable.grantReadWriteData(createAuthChallengeLambda);

    // Verify Auth Challenge Lambda (gets User Pool ID from event.userPoolId)
    const verifyAuthChallengeLambda = new nodejs.NodejsFunction(this, 'VerifyAuthChallengeLambda', {
      ...lambdaConfig,
      entry: path.join(__dirname, '../lambda/verify-auth-challenge/index.ts'),
      handler: 'handler',
      environment: {
        OTP_TABLE_NAME: this.otpTable.tableName,
      },
    });

    // Grant DynamoDB permissions to VerifyAuthChallenge Lambda
    this.otpTable.grantReadWriteData(verifyAuthChallengeLambda);

    // Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
        username: false,
        phone: false,
      },
      autoVerify: {
        email: false,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lambdaTriggers: {
        preSignUp: preSignUpLambda,
        defineAuthChallenge: defineAuthChallengeLambda,
        createAuthChallenge: createAuthChallengeLambda,
        verifyAuthChallengeResponse: verifyAuthChallengeLambda,
      },
    });

    // Grant Cognito AdminUpdateUserAttributes permission to VerifyAuthChallenge Lambda
    // Create as separate policy to avoid cyclic dependency (UserPool -> Lambda -> Policy -> UserPool)
    const cognitoPolicy = new iam.Policy(this, 'VerifyAuthChallengeCognitoPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['cognito-idp:AdminUpdateUserAttributes'],
          resources: [this.userPool.userPoolArn],
        }),
      ],
    });
    verifyAuthChallengeLambda.role?.attachInlinePolicy(cognitoPolicy);

    // Cognito User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      generateSecret: false,
      authFlows: {
        custom: true,
        userSrp: true,
      },
      idTokenValidity: cdk.Duration.days(1),
      accessTokenValidity: cdk.Duration.days(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // CDK Outputs
    new cdk.CfnOutput(this, 'userPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'userPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'otpTableName', {
      value: this.otpTable.tableName,
      description: 'DynamoDB OTP Table Name',
    });

    new cdk.CfnOutput(this, 'sessionsTableName', {
      value: this.sessionsTable.tableName,
      description: 'DynamoDB Sessions Table Name',
    });

    new cdk.CfnOutput(this, 'awsCognitoRegion', {
      value: this.region,
      description: 'AWS Region',
    });

    // IAM Policy for applications using these resources
    const appPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'CognitoAuthOperations',
          Effect: 'Allow',
          Action: [
            'cognito-idp:SignUp',
            'cognito-idp:InitiateAuth',
            'cognito-idp:RespondToAuthChallenge',
            'cognito-idp:GetUser',
            'cognito-idp:GlobalSignOut',
            'cognito-idp:RevokeToken',
            'cognito-idp:ForgotPassword',
            'cognito-idp:ConfirmForgotPassword',
            'cognito-idp:ChangePassword',
          ],
          Resource: this.userPool.userPoolArn,
        },
        {
          Sid: 'SessionsTableOperations',
          Effect: 'Allow',
          Action: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:BatchWriteItem',
          ],
          Resource: [
            this.sessionsTable.tableArn,
            `${this.sessionsTable.tableArn}/index/userId-index`,
          ],
        },
      ],
    };

    new cdk.CfnOutput(this, 'iamPolicyForCognito', {
      value: JSON.stringify(appPolicy),
      description: 'IAM policy for applications to use Cognito authentication',
    });

    // -----------------------------------------------------------------------
    // RBAC table outputs + IAM policy
    //
    // `iamPolicyAuthRbac` is auto-attached to the consumer's Lambda role and
    // to dev IAM users via hereya's iamPolicy* convention. Includes Scan
    // (admin "list users" page and the count-active-admins safeguard), tightly
    // scoped to these two tables + the email GSI.
    // -----------------------------------------------------------------------

    new cdk.CfnOutput(this, 'authUsersTableName', {
      value: this.authUsersTable.tableName,
      description: 'DynamoDB table holding the authoritative user records',
    });

    new cdk.CfnOutput(this, 'authRolesTableName', {
      value: this.authRolesTable.tableName,
      description: 'DynamoDB table holding role definitions (permissions per role)',
    });

    const rbacPolicy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'AuthUsersTableAccess',
          Effect: 'Allow',
          Action: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchWriteItem',
            'dynamodb:BatchGetItem',
            'dynamodb:TransactWriteItems',
            'dynamodb:ConditionCheckItem',
          ],
          Resource: [
            this.authUsersTable.tableArn,
            `${this.authUsersTable.tableArn}/index/email-index`,
          ],
        },
        {
          Sid: 'AuthRolesTableAccess',
          Effect: 'Allow',
          Action: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchWriteItem',
            'dynamodb:BatchGetItem',
            'dynamodb:TransactWriteItems',
            'dynamodb:ConditionCheckItem',
          ],
          Resource: [this.authRolesTable.tableArn],
        },
      ],
    };

    new cdk.CfnOutput(this, 'iamPolicyAuthRbac', {
      value: JSON.stringify(rbacPolicy),
      description:
        'IAM policy granting CRUD + Query/Scan on the auth users + roles DDB tables',
    });
  }
}
