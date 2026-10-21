// 手动桌面联调服务：仅监听本机，固定测试回复，不访问任何模型或记录文档内容。
import { createServer } from 'node:http';
import { analysisReply } from './analysis-fixture.mjs';
const server = createServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(text);
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: analysisReply(body.messages),
          },
          finish_reason: 'stop',
        },
      ],
    }),
  );
});
server.listen(5199, '127.0.0.1', () => console.log('Local test model listening on 127.0.0.1:5199'));
process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close();
});
