import {
  SQSClient,
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  type Message,
} from '@aws-sdk/client-sqs';
import { MAX_DELIVERY_ATTEMPTS, MESSAGE_VISIBILITY_SECONDS } from './queue-policy';

export interface QueueUrls {
  requests: string;
  dlq: string;
  events: string;
}
export class SqsGateway {
  readonly client: SQSClient;
  private initialization?: Promise<QueueUrls>;
  constructor(
    private readonly prefix = '',
    endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566',
  ) {
    this.client = new SQSClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      endpoint,
      useQueueUrlAsEndpoint: false,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'test',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'test',
      },
      maxAttempts: 2,
      requestHandler: { connectionTimeout: 2000, requestTimeout: 10000 },
    });
  }
  queues(): Promise<QueueUrls> {
    if (!this.initialization) {
      this.initialization = this.initialize().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    }
    return this.initialization;
  }
  private async initialize(): Promise<QueueUrls> {
    const dlq = await this.createQueue('wager-transactions-dlq.fifo');
    const deadLetterArn = (
      await this.client.send(
        new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ['QueueArn'] }),
      )
    ).Attributes!.QueueArn!;
    const requests = await this.createQueue('wager-transactions.fifo', {
      VisibilityTimeout: String(MESSAGE_VISIBILITY_SECONDS),
      RedrivePolicy: JSON.stringify({
        deadLetterTargetArn: deadLetterArn,
        maxReceiveCount: String(MAX_DELIVERY_ATTEMPTS),
      }),
    });
    const events = await this.createQueue('wager-events.fifo');
    return { requests, dlq, events };
  }
  private async createQueue(
    name: string,
    attributes: Record<string, string> = {},
  ): Promise<string> {
    const response = await this.client.send(
      new CreateQueueCommand({
        QueueName: this.prefix + name,
        Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false', ...attributes },
      }),
    );
    return response.QueueUrl!;
  }

  async ready(): Promise<void> {
    const queues = await this.queues();
    await Promise.all(
      Object.values(queues).map((QueueUrl) =>
        this.client.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] })),
      ),
    );
  }
  async publish(event: Record<string, unknown>): Promise<void> {
    const { events } = await this.queues();
    await this.send(events, event, String(event.aggregateId), String(event.eventId));
  }
  async send(queue: string, body: unknown, group: string, deduplicationId: string): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queue,
        MessageBody: typeof body === 'string' ? body : JSON.stringify(body),
        MessageGroupId: group,
        MessageDeduplicationId: deduplicationId,
      }),
    );
  }
  async receive(queue: string, wait = 5): Promise<Message[]> {
    return (
      (
        await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: queue,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: wait,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
            VisibilityTimeout: MESSAGE_VISIBILITY_SECONDS,
          }),
        )
      ).Messages ?? []
    );
  }
  async ack(queue: string, message: Message): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: queue, ReceiptHandle: message.ReceiptHandle! }),
    );
  }
  async visibility(queue: string, message: Message, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queue,
        ReceiptHandle: message.ReceiptHandle!,
        VisibilityTimeout: seconds,
      }),
    );
  }
  close(): void {
    this.client.destroy();
  }
}
