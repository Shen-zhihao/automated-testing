// 手动桌面联调服务：仅监听本机，固定测试回复，不访问任何模型或记录文档内容。
import { createServer } from 'node:http';
import { reportFixture } from './report-fixture.mjs';
const server = createServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const body = JSON.parse(text);
  const prompt = body.messages.at(-1)?.content ?? '';
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: body.messages[0]?.content.includes('独立的工程范围与安全审查器')
              ? '{"decision":"allow"}'
              : prompt.includes('连接测试')
                ? 'OK'
                : reportFixture,
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
