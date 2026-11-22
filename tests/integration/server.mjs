// Keep Next's dev watchers in a child process with the same lifetime as the test.
import { once } from 'node:events';
import { createServer } from 'node:http';
import next from 'next';

process.on('disconnect', () => process.exit(0));
const server = createServer().listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const app = next({ dev: true, hostname: 'localhost', port });
await app.prepare();
server.on('request', app.getRequestHandler());
process.send('http://localhost:' + port);
