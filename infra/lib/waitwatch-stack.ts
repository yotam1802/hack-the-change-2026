import path from "node:path";
import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kinesis from "aws-cdk-lib/aws-kinesis";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export class WaitWatchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      natGateways: 0,
      maxAzs: 2,
      subnetConfiguration: [{ name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });

    const stream = new kinesis.Stream(this, "Readings", {
      shardCount: 2,
      retentionPeriod: Duration.hours(24),
    });

    const stateTable = new dynamodb.Table(this, "PatientState", {
      partitionKey: { name: "patientId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const connections = new dynamodb.Table(this, "Connections", {
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    connections.addGlobalSecondaryIndex({
      indexName: "byUnit",
      partitionKey: { name: "unitId", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const jobs = new sqs.Queue(this, "GeminiJobs", {
      visibilityTimeout: Duration.seconds(90),
      retentionPeriod: Duration.hours(4),
    });

    const wsFn = new NodejsFunction(this, "WsRoutes", {
      entry: path.join(__dirname, "../../apps/ws-handlers/src/connect.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: { TABLE_NAME: connections.tableName },
    });
    connections.grantReadWriteData(wsFn);

    const wsApi = new apigwv2.WebSocketApi(this, "Live", {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration("Connect", wsFn) },
      disconnectRouteOptions: { integration: new WebSocketLambdaIntegration("Disconnect", wsFn) },
    });
    const wsStage = new apigwv2.WebSocketStage(this, "LiveStage", {
      webSocketApi: wsApi,
      stageName: "prod",
      autoDeploy: true,
    });

    const database = new rds.DatabaseCluster(this, "History", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_4 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 8,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      defaultDatabaseName: "waitwatch",
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPool = new cognito.UserPool(this, "Nurses", {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const userPoolClient = userPool.addClient("Dashboard", { authFlows: { userPassword: true, userSrp: true } });

    const site = new s3.Bucket(this, "Dashboard", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const cdn = new cloudfront.Distribution(this, "Cdn", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "index.html",
    });

    const imageUri = this.node.tryGetContext("imageUri") as string | undefined;
    const image = imageUri
      ? ecs.ContainerImage.fromRegistry(imageUri)
      : ecs.ContainerImage.fromAsset(path.join(__dirname, "../.."), { file: "Dockerfile" });

    const cluster = new ecs.Cluster(this, "Cluster", { vpc });
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", { vpc, internetFacing: true });
    const listener = alb.addListener("Http", { port: 80 });

    const sharedEnv = {
      AWS_REGION: this.region,
      BUS: "kinesis",
      STATE: "dynamodb",
      REALTIME: "apigw",
      KINESIS_STREAM_NAME: stream.streamName,
      DYNAMO_STATE_TABLE: stateTable.tableName,
      DYNAMO_CONN_TABLE: connections.tableName,
      SQS_QUEUE_URL: jobs.queueUrl,
      WS_ENDPOINT: wsStage.callbackUrl,
      DB_HOST: database.clusterEndpoint.hostname,
      DB_PORT: "5432",
      DB_NAME: "waitwatch",
      DB_SSL: "require",
      CLOUDWATCH_METRICS: "1",
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      PORT: "8787",
      HEALTH_PORT: "8787",
    };

    const service = (name: string, roleName: string, desired: number) => {
      const task = new ecs.FargateTaskDefinition(this, `${name}Task`, { cpu: 512, memoryLimitMiB: 1024 });
      task.addContainer(name, {
        image,
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: name, logRetention: logs.RetentionDays.ONE_WEEK }),
        environment: { ...sharedEnv, ROLE: roleName },
        secrets: {
          DB_USER: ecs.Secret.fromSecretsManager(database.secret!, "username"),
          DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, "password"),
        },
        portMappings: [{ containerPort: 8787 }],
      });
      stream.grantReadWrite(task.taskRole);
      stateTable.grantReadWriteData(task.taskRole);
      connections.grantReadWriteData(task.taskRole);
      jobs.grantSendMessages(task.taskRole);
      jobs.grantConsumeMessages(task.taskRole);
      wsApi.grantManageConnections(task.taskRole);
      database.secret?.grantRead(task.taskRole);
      task.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ["cloudwatch:PutMetricData", "cloudwatch:GetMetricData"],
        resources: ["*"],
      }));
      const fargate = new ecs.FargateService(this, name, {
        cluster,
        taskDefinition: task,
        desiredCount: desired,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        circuitBreaker: { rollback: true },
      });
      database.connections.allowDefaultPortFrom(fargate);
      return fargate;
    };

    const ingest = service("Ingest", "ingest", 2);
    const api = service("Api", "api", 2);
    service("Workers", "worker", 2);
    service("Gemini", "ai", 1);

    listener.addTargets("Api", {
      port: 8787,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [api],
      healthCheck: { path: "/api/health" },
    });
    listener.addTargets("Ingest", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/api/readings"])],
      port: 8787,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [ingest],
      healthCheck: { path: "/api/health" },
    });

    new CfnOutput(this, "AlbDns", { value: alb.loadBalancerDnsName });
    new CfnOutput(this, "WebSocketUrl", { value: wsStage.url });
    new CfnOutput(this, "DashboardBucket", { value: site.bucketName });
    new CfnOutput(this, "CdnDomain", { value: cdn.distributionDomainName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "WorkerService", { value: "Workers" });
  }
}
