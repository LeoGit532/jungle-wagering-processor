import { DomainError } from './errors';
export interface InboxState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: string;
  processedAt?: string;
}
export class InboxMessage {
  private constructor(private state: Readonly<InboxState>) {}
  static receive(props: Omit<InboxState, 'processedAt'>): InboxMessage {
    if (!props.messageId || !props.consumerName || !props.payloadHash) {
      throw new DomainError('INVALID_INBOX_MESSAGE');
    }
    return InboxMessage.rehydrate(props);
  }
  static rehydrate(state: InboxState): InboxMessage {
    return new InboxMessage(Object.freeze({ ...state }));
  }
  get snapshot(): Readonly<InboxState> {
    return this.state;
  }
  isProcessed(): boolean {
    return this.state.processedAt !== undefined;
  }
  matchesPayload(hash: string): boolean {
    return this.state.payloadHash === hash;
  }
  markProcessed(at: string): void {
    if (!this.isProcessed()) {
      this.state = Object.freeze({ ...this.state, processedAt: at });
    }
  }
}
