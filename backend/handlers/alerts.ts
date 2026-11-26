import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { docClient, TABLE_NAME } from '../lib/db.js';

const sns = new SNSClient({});
const TOPIC_ARN = process.env.ALERTS_TOPIC_ARN!;
const cors = { 'Access-Control-Allow-Origin': '*' };
const res = (code: number, body: unknown): APIGatewayProxyResult =>
  ({ statusCode: code, headers: cors, body: JSON.stringify(body) });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const route = `${event.httpMethod} ${event.resource}`;
    const body = JSON.parse(event.body || '{}');

    switch (route) {
      case 'POST /alerts': {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const { title, message, severity, type, area } = body;
        const item = {
          pk: 'ALERTS', sk: `ALERT#${now}#${id}`, id, title, message,
          severity, type, area, createdAt: now,
        };
        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        await sns.send(new PublishCommand({
          TopicArn: TOPIC_ARN,
          Subject: `[${severity}] ${title}`,
          Message: JSON.stringify({ id, title, message, severity, type, area, createdAt: now }),
        }));
        return res(201, item);
      }

      case 'GET /alerts': {
        const limit = Number(event.queryStringParameters?.limit) || 50;
        const result = await docClient.send(new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': 'ALERTS' },
          ScanIndexForward: false,
          Limit: limit,
        }));
        return res(200, result.Items);
      }

      default:
        return res(400, { message: `Unknown route: ${route}` });
    }
  } catch (err: any) {
    console.error(err);
    return res(500, { message: err.message });
  }
};
