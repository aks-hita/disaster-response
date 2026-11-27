import { PutCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, SQSEvent } from 'aws-lambda';
import { docClient, TABLE_NAME, geohash } from '../lib/db.js';

const sns = new SNSClient({});
const TOPIC_ARN = process.env.MATCH_TOPIC_ARN!;
const cors = { 'Access-Control-Allow-Origin': '*' };
const res = (code: number, body: unknown): APIGatewayProxyResult =>
  ({ statusCode: code, headers: cors, body: JSON.stringify(body) });

async function handleApi(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const route = `${event.httpMethod} ${event.resource}`;
  const body = JSON.parse(event.body || '{}');

  switch (route) {
    case 'POST /supplies/requests': {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { item, quantity, lat, lng, urgency, incidentId } = body;
      const record = {
        pk: `SUPPLY_REQ#${id}`, sk: 'METADATA', id, item, quantity, lat, lng,
        urgency, incidentId, status: 'Open', createdAt: now,
        gsi4pk: item, gsi4sk: 'Open', gsi3pk: geohash(lat, lng),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
      const sqs = new SQSClient({});
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.MATCH_QUEUE_URL!, MessageBody: JSON.stringify({ requestId: id }),
      }));
      return res(201, record);
    }

    case 'POST /supplies/offers': {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { item, quantity, lat, lng, description } = body;
      const record = {
        pk: `SUPPLY_OFFER#${id}`, sk: 'METADATA', id, item, quantity, lat, lng,
        description, status: 'Open', createdAt: now,
        gsi4pk: item, gsi4sk: 'Open', gsi3pk: geohash(lat, lng),
      };
      await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: record }));
      return res(201, record);
    }

    case 'GET /supplies/requests': {
      const result = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME, IndexName: 'gsi4',
        KeyConditionExpression: 'gsi4pk = :item AND gsi4sk = :s',
        ExpressionAttributeValues: {
          ':item': event.queryStringParameters?.item || 'water',
          ':s': 'Open',
        },
      }));
      return res(200, result.Items);
    }

    default:
      return res(400, { message: `Unknown route: ${route}` });
  }
}

async function handleSqs(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const { requestId } = JSON.parse(record.body);
    const req = await docClient.send(new GetCommand({
      TableName: TABLE_NAME, Key: { pk: `SUPPLY_REQ#${requestId}`, sk: 'METADATA' },
    }));
    if (!req.Item || req.Item.status !== 'Open') continue;

    const offers = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME, IndexName: 'GSI4',
      KeyConditionExpression: 'gsi4pk = :item AND gsi4sk = :s',
      ExpressionAttributeValues: { ':item': req.Item.item, ':s': 'Open' },
    }));
    if (!offers.Items?.length) continue;

    const reqHash = req.Item.gsi3pk as string;
    const best = offers.Items.reduce((a, b) => {
      const aDist = commonPrefix(reqHash, (a.gsi3pk as string) || '');
      const bDist = commonPrefix(reqHash, (b.gsi3pk as string) || '');
      return bDist > aDist ? b : a;
    });

    const now = new Date().toISOString();
    await Promise.all([
      docClient.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: { pk: req.Item.pk, sk: 'METADATA' },
        UpdateExpression: 'SET #s = :m, gsi4sk = :m, matchedOfferId = :o, matchedAt = :n',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':m': 'Matched', ':o': best.id, ':n': now },
      })),
      docClient.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: { pk: best.pk, sk: 'METADATA' },
        UpdateExpression: 'SET #s = :m, gsi4sk = :m, matchedRequestId = :r, matchedAt = :n',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':m': 'Matched', ':r': requestId, ':n': now },
      })),
      sns.send(new PublishCommand({
        TopicArn: TOPIC_ARN,
        Subject: 'Supply Match Found',
        Message: JSON.stringify({ requestId, offerId: best.id, item: req.Item.item }),
      })),
    ]);
  }
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export const handler = async (event: any) => {
  try {
    if (event.httpMethod) return await handleApi(event as APIGatewayProxyEvent);
    if (event.Records) { await handleSqs(event as SQSEvent); return; }
    return res(400, { message: 'Unknown event source' });
  } catch (err: any) {
    console.error(err);
    if (event.httpMethod) return res(500, { message: err.message });
    throw err;
  }
};
