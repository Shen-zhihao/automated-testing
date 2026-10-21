import BrandLogo from '@/components/BrandLogo';
import { APP_NAME, APP_DESCRIPTION } from '@/brand';
import './index.less';

export default function WindowTitleBar() {
  const platform = window.desktop?.platform;
  if (!platform) return null;
  return (
    <header className={`windowTitleBar ${platform}`} aria-label="窗口标题栏">
      <BrandLogo size={20} />
      <span>
        {APP_NAME} · {APP_DESCRIPTION}
      </span>
    </header>
  );
}
