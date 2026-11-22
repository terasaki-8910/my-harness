export class CdpConnection {
  #readable;
  #writable;
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();
  #buffer = "";
  #closed = false;

  constructor(readable, writable, { exitEmitter, exitError } = {}) {
    this.#readable = readable;
    this.#writable = writable;
    readable.setEncoding("utf8");
    readable.on("data", (chunk) => this.#read(chunk));
    readable.on("end", () => this.close(new Error("Chrome CDP pipe closed")));
    readable.on("error", (error) => this.close(error));
    writable.on?.("error", (error) => this.close(error));
    exitEmitter?.once("exit", (code, signal) => this.close(exitError?.(code, signal) ?? new Error(`Chrome exited (${signal ?? code ?? "unknown"})`)));
    exitEmitter?.once("error", (error) => this.close(error));
  }

  send(method, params = {}, sessionId, { timeout = 30 } = {}) {
    if (this.#closed) return Promise.reject(new Error("Chrome CDP pipe is closed"));
    const id = this.#nextId++;
    const message = { id, method, params };
    if (sessionId !== undefined) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeout} s`));
      }, timeout * 1000);
      this.#pending.set(id, { resolve, reject, timer });
      this.#writable.write(`${JSON.stringify(message)}\0`, (error) => {
        if (error) {
          this.#pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  on(method, handler) {
    const handlers = this.#handlers.get(method) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(method, handlers);
    return () => handlers.delete(handler);
  }

  close(error = new Error("Chrome CDP pipe closed")) {
    if (this.#closed) return;
    this.#closed = true;
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
  }

  #read(chunk) {
    this.#buffer += chunk;
    let separator;
    while ((separator = this.#buffer.indexOf("\0")) !== -1) {
      const raw = this.#buffer.slice(0, separator);
      this.#buffer = this.#buffer.slice(separator + 1);
      if (!raw) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.close(new Error(`Invalid CDP message: ${error.message}`));
        return;
      }
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        this.#pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        else pending.resolve(message.result ?? {});
      } else if (message.method) {
        for (const handler of this.#handlers.get(message.method) ?? []) handler(message.params ?? {}, message.sessionId);
      }
    }
  }
}

export async function attachPage(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return sessionId;
}
