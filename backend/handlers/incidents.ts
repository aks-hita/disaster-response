import { PutCommand, GetCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { docClient, TABLE_NAME, geohash } from '../lib/db.js';

const s3 = new S3Client({});
const BUCKET = process.env.PHOTOS_BUCKET!;
const cors = { 'Access-Control-Allow-Origin': '*' };
const res = (code: number, body: unknown): APIGatewayProxyResult =>
  ({ statusCode: code, headers: cors, body: JSON.stringify(body) });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const route = `${event.httpMethod} ${event.resource}`;
    const body = JSON.parse(event.body || '{}');

    switch (route) {
      case 'POST /incidents': {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const { title, description, type, severity, lat, lng, status = 'Open' } = body;
        const item = {
          pk: `INCIDENT#${id}`, sk: 'METADATA', id, title, description, type,
          severity, lat, lng, status, createdAt: now, updatedAt: now,
          gsi1pk: type, gsi1sk: String(severity),
          gsi2pk: status, gsi2sk: now,
          gsi3pk: geohash(lat, lng),
        };
        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return res(201, item);
      }

      case 'GET /incidents': {
        const { status, type } = event.queryStringParameters || {};
        if (status) {
          const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME, IndexName: 'gsi2',
            KeyConditionExpression: 'gsi2pk = :s', ExpressionAttributeValues: { ':s': status },
            ScanIndexForward: false,
          }));
          return res(200, result.Items);
        }
        const params: any = { TableName: TABLE_NAME };
        if (type) {
          params.FilterExpression = '#t = :t';
          params.ExpressionAttributeNames = { '#t': 'type' };
          params.ExpressionAttributeValues = { ':t': type };
        }
        const result = await docClient.send(new ScanCommand(params));
        return res(200, result.Items);
      }

      case 'GET /incidents/{id}': {
        const id = event.pathParameters!.id!;
        const result = await docClient.send(new GetCommand({
          TableName: TABLE_NAME, Key: { pk: `INCIDENT#${id}`, sk: 'METADATA' },
        }));
        if (!result.Item) return res(404, { message: 'Not found' });
        return res(200, result.Item);
      }

      case 'PATCH /incidents/{id}': {
        const id = event.pathParameters!.id!;
        const { status } = body;
        const result = await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME, Key: { pk: `INCIDENT#${id}`, sk: 'METADATA' },
          UpdateExpression: 'SET #s = :s, gsi2pk = :s, updatedAt = :u',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':s': status, ':u': new Date().toISOString() },
          ReturnValues: 'ALL_NEW',
        }));
        return res(200, result.Attributes);
      }

      case 'POST /incidents/{id}/photos': {
        const incidentId = event.pathParameters!.id!;
        const photoId = crypto.randomUUID();
        const key = `photos/${incidentId}/${photoId}.jpg`;
        const url = await getSignedUrl(s3, new PutObjectCommand({
          Bucket: BUCKET, Key: key, ContentType: 'image/jpeg',
        }), { expiresIn: 300 });
        return res(200, { uploadUrl: url, key, photoId });
      }

      default:
        return res(400, { message: `Unknown route: ${route}` });
    }
  } catch (err: any) {
    console.error(err);
    return res(500, { message: err.message });
  }
};
