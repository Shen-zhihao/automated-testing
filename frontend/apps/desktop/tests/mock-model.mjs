// 手动桌面联调服务：仅监听本机，固定测试回复，不访问任何模型或记录文档内容。
import { createServer } from 'node:http';
const report =
  '# 登录需求分析（本地联调样例）\n\n> 这是接口与界面的测试数据，不代表真实模型推理。\n\n## 内容摘要\n验证账号密码登录及错误次数限制。\n\n## 测试场景\n| 编号 | 优先级 | 场景 | 预期 |\n| --- | --- | --- | --- |\n| TC-01 | P0 | 提交空密码 | 阻止提交 |\n| TC-02 | P0 | 连续输入 5 次错误密码 | 锁定 15 分钟 |\n\n## 待确认问题\n- 锁定期间是否允许重置密码？\n- 成功登录后是否清零错误次数？';
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
          message: { content: prompt.includes('连接测试') ? 'OK' : report },
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
