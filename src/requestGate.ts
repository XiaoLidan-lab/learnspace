export class RequestGate {
  private revision = 0;
  private key = "";
  invalidate(key: string) {
    if (key !== this.key) {
      this.key = key;
      this.revision++;
    }
  }
  begin() {
    return ++this.revision;
  }
  isCurrent(ticket: number) {
    return ticket === this.revision;
  }
  cancel() {
    this.revision++;
  }
}
