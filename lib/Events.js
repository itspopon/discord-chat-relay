module.exports = class Events {
  constructor() {
    this.events = new Map();
  }

  on(eventName, handler) {
    if (this.events.has(eventName)) {
      this.events.set(eventName, [...this.events.get(eventName), handler]);
    } else {
      this.events.set(eventName, [handler]);
    }
  }

  send(eventName, data) {
    try {
      if (!this.events.has(eventName)) {
        return console.error(`Error: Event ${eventName} not found.`);
      }
      this.events.get(eventName).forEach(evt => evt(data));
    } catch (e) {
      console.error(e);
    }
  }
};
