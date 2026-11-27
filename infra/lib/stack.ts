import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaBase from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as iam from 'aws-cdk-lib/aws-iam';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export class DisasterResponseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ── Cognito ──
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { fullname: { required: true, mutable: true } },
      passwordPolicy: { minLength: 8 },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    for (const group of ['victims', 'volunteers', 'coordinators']) {
      new cognito.CfnUserPoolGroup(this, `Group-${group}`, {
        userPoolId: userPool.userPoolId,
        groupName: group,
      });
    }

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: { userPassword: true, userSrp: true },
      oAuth: { flows: { implicitCodeGrant: true }, callbackUrls: ['http://localhost:5173/'] },
    });

    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [{
        clientId: userPoolClient.userPoolClientId,
        providerName: userPool.userPoolProviderName,
      }],
    });

    // ── DynamoDB ──
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const gsiDefs: Array<{ name: string; pk: string; sk: string }> = [
      { name: 'gsi1', pk: 'gsi1pk', sk: 'gsi1sk' },
      { name: 'gsi2', pk: 'gsi2pk', sk: 'gsi2sk' },
      { name: 'gsi3', pk: 'gsi3pk', sk: 'gsi3sk' },
      { name: 'gsi4', pk: 'gsi4pk', sk: 'gsi4sk' },
    ];
    for (const gsi of gsiDefs) {
      table.addGlobalSecondaryIndex({
        indexName: gsi.name,
        partitionKey: { name: gsi.pk, type: dynamodb.AttributeType.STRING },
        sortKey: { name: gsi.sk, type: dynamodb.AttributeType.STRING },
      });
    }

    // ── S3 ──
    const photoBucket = new s3.Bucket(this, 'PhotoBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: ['http://localhost:5173', 'https://*'],
        allowedHeaders: ['*'],
      }],
    });

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS,
    });

    // ── SQS ──
    const dlq = new sqs.Queue(this, 'SupplyDLQ', {
      retentionPeriod: cdk.Duration.days(14),
    });

    const supplyQueue = new sqs.Queue(this, 'SupplyQueue', {
      deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },
    });

    // ── SNS ──
    const alertTopic = new sns.Topic(this, 'AlertTopic');

    // ── Lambda helpers ──
    const fnDefaults = {
      runtime: lambdaBase.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      bundling: { minify: true, sourceMap: true },
    };

    const makeFn = (name: string, handler: string, env: Record<string, string>) =>
      new lambda.NodejsFunction(this, name, {
        ...fnDefaults,
        entry: path.join(__dirname, `../../backend/handlers/${handler}.ts`),
        projectRoot: path.join(__dirname, '../../backend'),
        depsLockFilePath: path.join(__dirname, '../../backend/package-lock.json'),
        environment: env,
      });

    // ── Lambda Functions ──
    const incidentsFn = makeFn('IncidentsFn', 'incidents', {
      TABLE_NAME: table.tableName,
      PHOTOS_BUCKET: photoBucket.bucketName,
    });
    const volunteersFn = makeFn('VolunteersFn', 'volunteers', { TABLE_NAME: table.tableName });
    const supplyMatchingFn = makeFn('SupplyMatchingFn', 'supplyMatching', {
      TABLE_NAME: table.tableName,
      MATCH_TOPIC_ARN: alertTopic.topicArn,
      MATCH_QUEUE_URL: supplyQueue.queueUrl,
    });
    const imageAnalysisFn = makeFn('ImageAnalysisFn', 'imageAnalysis', {
      TABLE_NAME: table.tableName,
    });
    const alertsFn = makeFn('AlertsFn', 'alerts', {
      TABLE_NAME: table.tableName,
      ALERTS_TOPIC_ARN: alertTopic.topicArn,
    });
    const authFn = makeFn('AuthFn', 'auth', {});

    // ── Permissions ──
    table.grantReadWriteData(incidentsFn);
    table.grantReadWriteData(volunteersFn);
    table.grantReadWriteData(supplyMatchingFn);
    table.grantReadWriteData(imageAnalysisFn);
    table.grantReadWriteData(alertsFn);

    photoBucket.grantPut(incidentsFn);
    photoBucket.grantRead(imageAnalysisFn);
    supplyQueue.grantSendMessages(supplyMatchingFn);
    alertTopic.grantPublish(supplyMatchingFn);
    alertTopic.grantPublish(alertsFn);

    imageAnalysisFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['rekognition:DetectLabels', 'rekognition:DetectText'],
      resources: ['*'],
    }));

    // ── Event wiring ──
    supplyMatchingFn.addEventSource(new SqsEventSource(supplyQueue, { batchSize: 10 }));
    photoBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(imageAnalysisFn), { prefix: 'photos/' });
    userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, authFn);

    // ── API Gateway ──
    const api = new apigateway.RestApi(this, 'Api', {
      restApiName: 'DisasterResponseAPI',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const auth = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuth', {
      cognitoUserPools: [userPool],
    });
    const authOpts: apigateway.MethodOptions = {
      authorizer: auth,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    const incidentsInteg = new apigateway.LambdaIntegration(incidentsFn);
    const volunteersInteg = new apigateway.LambdaIntegration(volunteersFn);
    const supplyInteg = new apigateway.LambdaIntegration(supplyMatchingFn);
    const alertsInteg = new apigateway.LambdaIntegration(alertsFn);

    const incidents = api.root.addResource('incidents');
    incidents.addMethod('POST', incidentsInteg, authOpts);
    incidents.addMethod('GET', incidentsInteg, authOpts);

    const incidentById = incidents.addResource('{id}');
    incidentById.addMethod('GET', incidentsInteg, authOpts);
    incidentById.addMethod('PATCH', incidentsInteg, authOpts);

    const incidentPhotos = incidentById.addResource('photos');
    incidentPhotos.addMethod('POST', incidentsInteg, authOpts);

    const volunteers = api.root.addResource('volunteers');
    volunteers.addMethod('POST', volunteersInteg, authOpts);
    volunteers.addMethod('GET', volunteersInteg, authOpts);
    volunteers.addMethod('PATCH', volunteersInteg, authOpts);

    const supplies = api.root.addResource('supplies');
    const supplyRequests = supplies.addResource('requests');
    supplyRequests.addMethod('POST', supplyInteg, authOpts);
    supplyRequests.addMethod('GET', supplyInteg, authOpts);

    const supplyOffers = supplies.addResource('offers');
    supplyOffers.addMethod('POST', supplyInteg, authOpts);

    const alerts = api.root.addResource('alerts');
    alerts.addMethod('POST', alertsInteg, authOpts);
    alerts.addMethod('GET', alertsInteg, authOpts);

    // ── AppSync ──
    const graphqlApi = new appsync.GraphqlApi(this, 'GraphqlApi', {
      name: 'DisasterResponseGraphQL',
      definition: appsync.Definition.fromSchema(appsync.SchemaFile.fromAsset(
        this.writeInlineSchema()
      )),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: { userPool },
        },
      },
    });

    const ddbSource = graphqlApi.addDynamoDbDataSource('DDBSource', table);

    ddbSource.createResolver('GetIncidentResolver', {
      typeName: 'Query',
      fieldName: 'getIncident',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbGetItem('pk', 'sk'),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    });

    ddbSource.createResolver('ListIncidentsResolver', {
      typeName: 'Query',
      fieldName: 'listIncidents',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultList(),
    });

    const noneDs = graphqlApi.addNoneDataSource('NoneSource');

    for (const sub of ['onNewIncident', 'onIncidentUpdated', 'onNewAlert']) {
      noneDs.createResolver(`${sub}Resolver`, {
        typeName: 'Subscription',
        fieldName: sub,
        requestMappingTemplate: appsync.MappingTemplate.fromString('{ "version": "2018-05-29", "payload": $util.toJson($context.arguments) }'),
        responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson($context.result)'),
      });
    }

    for (const mutation of ['createIncident', 'updateIncident', 'createAlert']) {
      noneDs.createResolver(`${mutation}Resolver`, {
        typeName: 'Mutation',
        fieldName: mutation,
        requestMappingTemplate: appsync.MappingTemplate.fromString('{ "version": "2018-05-29", "payload": $util.toJson($context.arguments.input) }'),
        responseMappingTemplate: appsync.MappingTemplate.fromString('$util.toJson($context.result)'),
      });
    }

    // ── Outputs ──
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'AppSyncUrl', { value: graphqlApi.graphqlUrl });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'PhotoBucketName', { value: photoBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendBucketName', { value: frontendBucket.bucketName });
    new cdk.CfnOutput(this, 'FrontendUrl', { value: frontendBucket.bucketWebsiteUrl });
    new cdk.CfnOutput(this, 'IdentityPoolId', { value: identityPool.ref });
  }

  private writeInlineSchema(): string {
    const schemaPath = path.join(__dirname, '..', 'cdk.out', 'schema.graphql');
    fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
    fs.writeFileSync(schemaPath, `
type Incident {
  pk: String!
  sk: String!
  id: String!
  title: String!
  description: String
  severity: String!
  status: String!
  location: Location
  reportedBy: String!
  createdAt: String!
  updatedAt: String
}

type Location {
  lat: Float!
  lng: Float!
  address: String
  geohash: String
}

type Alert {
  pk: String!
  sk: String!
  id: String!
  message: String!
  severity: String!
  createdAt: String!
}

input IncidentInput {
  title: String!
  description: String
  severity: String!
  lat: Float
  lng: Float
  address: String
}

input UpdateIncidentInput {
  id: String!
  status: String
  severity: String
  title: String
  description: String
}

input AlertInput {
  message: String!
  severity: String!
}

type Query {
  getIncident(pk: String!, sk: String!): Incident
  listIncidents: [Incident]
}

type Mutation {
  createIncident(input: IncidentInput!): Incident
    @aws_cognito_user_pools
  updateIncident(input: UpdateIncidentInput!): Incident
    @aws_cognito_user_pools
  createAlert(input: AlertInput!): Alert
    @aws_cognito_user_pools
}

type Subscription {
  onNewIncident: Incident
    @aws_subscribe(mutations: ["createIncident"])
  onIncidentUpdated: Incident
    @aws_subscribe(mutations: ["updateIncident"])
  onNewAlert: Alert
    @aws_subscribe(mutations: ["createAlert"])
}

schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}
`);
    return schemaPath;
  }
}
