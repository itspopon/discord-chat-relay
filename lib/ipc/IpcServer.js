const net = require('net');
const events = require('events');

class IpcServer {
  constructor(path, cb) {
    this.clients = [];
    this.queue = [];

    this.server = net.createServer((client) => {
      client.setEncoding('utf8');
      client.setNoDelay(true);
      this.clients.push(client);

      // set up events
      let buffer = '';
      client.on('data', (data) => {
        data = (buffer + data).split('\n');
        buffer = data.pop();
        for (const line of data) {
          cb.apply(cb, JSON.parse(line));
        }
      });

      client.on('end', () => {
        const index = this.clients.indexOf(client);
        if (index !== -1) {
          this.clients.splice(index, 1);
        }
      });

      // flush queue
      if (this.queue.length > 0) {
        client.write(this.queue.join(''));
        this.queue = [];
      }
    });

    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        require('fs').unlink(path, (err2) => {
          if (err2) {
            throw err2;
          } // error freeing socket
          this.server.listen(path);
        });
      } else {
        throw err;
      }
    });

    this.server.listen(path);
  }

  send(...args) {
    const line = `${JSON.stringify(args)}\n`;
    const len = this.clients.length;
    if (len > 0) {
      for (const client of this.clients) {
        client.write(line);
      }
    } else {
      this.queue.push(line);
    }
  }
}

/* Wraps IpcServer with events */
class IpcServerModule extends events.EventEmitter {
  constructor(socketName) {
    super();

    let path;
    if (process.platform === 'win32') {
      path = `\\\\.\\pipe\\${socketName}`;
    } else {
      path = `/tmp/${socketName}.sock`;
    }
    this.ipc_server = new IpcServer(path, this.emit.bind(this));
  }

  send() {
    this.ipc_server.send(...arguments);
  }
}

module.exports = IpcServerModule;
