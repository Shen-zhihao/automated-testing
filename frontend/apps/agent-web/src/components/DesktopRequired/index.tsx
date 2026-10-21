import { APP_NAME } from '@/brand';

export default function DesktopRequired() {
  return (
    <div className="workEmpty">
      <h2>请在桌面 App 中使用</h2>
      <p>文档读取、飞书连接和模型设置需要本机能力。请启动{APP_NAME}桌面应用。</p>
    </div>
  );
}
