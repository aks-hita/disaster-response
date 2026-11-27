import { PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { docClient, TABLE_NAME, geohash } from '../lib/db.js';

const cors = { 'Access-Control-Allow-Origin': '*' };
const res = (code: number, body: unknown): APIGatewayProxyResult =>
  ({ statusCode: code, headers: cors, body: JSON.stringify(body) });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const route = `${event.httpMethod} ${event.resource}`;
    const body = JSON.parse(event.body || '{}');
    const userId = event.requestContext.authorizer?.claims?.sub;

    switch (route) {
      case 'POST /volunteers': {
        const now = new Date().toISOString();
        const { name, skills, lat, lng, phone } = body;
        const item = {
          pk: `USER#${userId}`, sk: 'PROFILE', userId, name, skills, phone,
          lat, lng, isAvailable: true, createdAt: now, updatedAt: now,
          gsi3pk: geohash(lat, lng),
        };
        await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
        return res(201, item);
      }

      case 'PATCH /volunteers/{id}/status': {
        const id = event.pathParameters!.id!;
        const { isAvailable } = body;
        const result = await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME, Key: { pk: `USER#${id}`, sk: 'PROFILE' },
          UpdateExpression: 'SET isAvailable = :a, updatedAt = :u',
          ExpressionAttributeValues: { ':a': isAvailable, ':u': new Date().toISOString() },
          ReturnValues: 'ALL_NEW',
        }));
        return res(200, result.Attributes);
      }

      case 'GET /volunteers': {
        const { geohashPrefix } = event.queryStringParameters || {};
        if (geohashPrefix) {
          const result = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME, IndexName: 'gsi3',
            KeyConditionExpression: 'begins_with(gsi3pk, :g)',
            FilterExpression: 'isAvailable = :a',
            ExpressionAttributeValues: { ':g': geohashPrefix, ':a': true },
          }));
          return res(200, result.Items);
        }
        const result = await docClient.send(new QueryCommand({
          TableName: TABLE_NAME, IndexName: 'GSI3',
          KeyConditionExpression: 'gsi3pk > :empty',
          FilterExpression: 'isAvailable = :a AND begins_with(pk, :prefix)',
          ExpressionAttributeValues: { ':empty': ' ', ':a': true, ':prefix': 'USER#' },
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
