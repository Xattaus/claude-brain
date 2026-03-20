// Session tracking — records changes made during a brain session

export class SessionTracker {
  constructor() {
    this.changes = [];
  }

  trackChange(type, id, title) {
    this.changes.push({
      timestamp: new Date().toISOString(),
      type,
      id,
      title
    });
  }

  getChanges() {
    return this.changes;
  }

  clear() {
    this.changes = [];
  }
}
