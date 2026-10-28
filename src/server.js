'use strict';

const http = require('node:http');
const { createApp } = require('./app');
const { HOST, PORT } = require('./config');

const app = createApp();
const server = http.createServer(app);

// Bound request time so abandoned uploads do not occupy sockets indefinitely.
server.requestTimeout = 120_000;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`FXAP Studio is ready at http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received; closing FXAP Studio...`);
  server.close(() => {
    app.locals.jobStore.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
