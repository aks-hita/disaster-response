import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { S3Event } from 'aws-lambda';
import { docClient, TABLE_NAME } from '../lib/db.js';

const rek = new RekognitionClient({});

const SEVERITY_MAP: Record<string, number> = {
  fire: 5, explosion: 5, flame: 5,
  flood: 4, collapse: 4, earthquake: 4,
  damage: 3, debris: 3, destruction: 3, rubble: 3,
  smoke: 2, storm: 2, wind: 2,
  rain: 1, cloud: 1,
};

export const handler = async (event: S3Event): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    const parts = key.split('/');
    if (parts.length < 3 || parts[0] !== 'photos') continue;
    const incidentId = parts[1];
    const photoId = parts[2].replace('.jpg', '');

    const labelsResult = await rek.send(new DetectLabelsCommand({
      Image: { S3Object: { Bucket: bucket, Name: key } },
      MaxLabels: 20, MinConfidence: 70,
    }));

    const labels = (labelsResult.Labels || []).map(l => ({
      name: l.Name!, confidence: Math.round(l.Confidence! * 10) / 10,
    }));

    const disasterLabels = labels.filter(l =>
      Object.keys(SEVERITY_MAP).some(k => l.name.toLowerCase().includes(k))
    );

    const autoSeverity = disasterLabels.reduce((max, l) => {
      const match = Object.entries(SEVERITY_MAP).find(([k]) => l.name.toLowerCase().includes(k));
      return match ? Math.max(max, match[1]) : max;
    }, 0);

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { pk: `INCIDENT#${incidentId}`, sk: `PHOTO#${photoId}` },
      UpdateExpression: 'SET s3Key = :k, labels = :l, disasterLabels = :d, autoSeverity = :s, analyzedAt = :a',
      ExpressionAttributeValues: {
        ':k': key, ':l': labels, ':d': disasterLabels,
        ':s': autoSeverity, ':a': new Date().toISOString(),
      },
    }));

    if (autoSeverity > 0) {
      const incident = await docClient.send(new GetCommand({
        TableName: TABLE_NAME, Key: { pk: `INCIDENT#${incidentId}`, sk: 'METADATA' },
      }));
      const currentSeverity = (incident.Item?.autoSeverity as number) || 0;
      if (autoSeverity > currentSeverity) {
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { pk: `INCIDENT#${incidentId}`, sk: 'METADATA' },
          UpdateExpression: 'SET aiLabels = list_append(if_not_exists(aiLabels, :empty), :l), autoSeverity = :s',
          ExpressionAttributeValues: {
            ':l': disasterLabels, ':s': autoSeverity, ':empty': [],
          },
        }));
      }
    }
  }
};
